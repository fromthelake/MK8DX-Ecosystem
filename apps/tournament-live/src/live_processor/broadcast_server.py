"""Local HTTP + Server-Sent-Events server for the live broadcast scoreboard.

The server runs inside the GUI process on a background thread. It serves a
single-page scoreboard overlay (``broadcast_web/``), the Mario Kart character /
track / cup icons (by index, from the project's own ``assets`` tree), and an
SSE stream that pushes per-feed scoreboard payloads to any connected browser
(including an OBS browser source).

SSE is used instead of WebSockets deliberately: it is one-directional (server →
page, which is all a scoreboard needs), needs no third-party dependency, and is
natively supported by browsers and OBS's embedded Chromium, with automatic
reconnection built in.
"""

from __future__ import annotations

import json
import queue
import re
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .baseline_assets import IMPORTED_ASSETS_ROOT

WEB_ROOT = Path(__file__).resolve().parent / "broadcast_web"

_ASSET_KINDS = {"character", "track", "cup", "gui"}
_ASSET_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+\.(png|webp|jpg|jpeg)$")
_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".json": "application/json; charset=utf-8",
}

# Sentinel pushed to subscriber queues to unblock SSE loops during shutdown.
_STOP = object()
_SSE_RETRY_MS = 1000
_SSE_KEEPALIVE_SECONDS = 5.0
_EVENT_HISTORY_LIMIT = 512


def _is_expected_client_disconnect(exc: BaseException) -> bool:
    if isinstance(exc, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
        return True
    if isinstance(exc, OSError):
        return getattr(exc, "winerror", None) in {10053, 10054}
    return False


class _QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Suppress normal browser/SSE disconnect tracebacks from http.server."""

    daemon_threads = True

    def handle_error(self, request: Any, client_address: Any) -> None:
        exc = sys.exc_info()[1]
        if exc is not None and _is_expected_client_disconnect(exc):
            return
        super().handle_error(request, client_address)


class BroadcastServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8800) -> None:
        self.host = host
        self.port = port
        self.session_id = f"broadcast_{int(time.time() * 1000)}"
        self._latest: dict[str, dict[str, Any]] = {}
        self._order: list[str] = []
        self._subscribers: set[queue.Queue[Any]] = set()
        self._history: deque[dict[str, Any]] = deque(maxlen=_EVENT_HISTORY_LIMIT)
        self._event_id = 0
        self._lock = threading.Lock()
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    # -- lifecycle -------------------------------------------------------
    def start(self) -> str:
        """Start serving on a free port at/after the requested one. Returns base URL."""

        if self._httpd is not None:
            return self.base_url
        last_error: OSError | None = None
        for candidate in range(self.port, self.port + 20):
            try:
                httpd = _QuietThreadingHTTPServer(
                    (self.host, candidate), self._make_handler()
                )
            except OSError as exc:
                last_error = exc
                continue
            self.port = candidate
            self._httpd = httpd
            self._thread = threading.Thread(
                target=httpd.serve_forever,
                name="broadcast-http-server",
                daemon=True,
            )
            self._thread.start()
            return self.base_url
        raise RuntimeError(
            f"Could not bind broadcast server near port {self.port}: {last_error}"
        )

    def stop(self) -> None:
        with self._lock:
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            try:
                subscriber.put_nowait(_STOP)
            except queue.Full:
                pass
        httpd = self._httpd
        if httpd is not None:
            httpd.shutdown()
            httpd.server_close()
        self._httpd = None
        self._thread = None

    @property
    def running(self) -> bool:
        return self._httpd is not None

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}/"

    def feed_url(self, feed: str | None = None) -> str:
        if not feed:
            return self.base_url
        return f"{self.base_url}?feed={feed}"

    # -- data flow -------------------------------------------------------
    def publish(self, payload: dict[str, Any]) -> None:
        """Store the latest payload for a feed and fan it out to subscribers."""

        feed = str(payload.get("feed") or "")
        with self._lock:
            if feed and feed not in self._latest:
                self._order.append(feed)
            self._latest[feed] = payload
            event = self._record_event_locked("scoreboard", payload)
            subscribers = list(self._subscribers)
        # Monitoring (gated): record the publish hop with the SSE event_id so the
        # browser render beacon can be correlated back to this payload.
        from .monitoring import log_publish

        log_publish(payload, int(event.get("id") or 0), float(event.get("server_time") or time.time()))
        message = self._encode_event(event)
        for subscriber in subscribers:
            self._queue_subscriber_message(subscriber, message)

    def reset(self) -> None:
        with self._lock:
            self._latest.clear()
            self._order.clear()
            event = self._record_event_locked("reset", {})
            subscribers = list(self._subscribers)
        reset_message = self._encode_event(event)
        for subscriber in subscribers:
            self._queue_subscriber_message(subscriber, reset_message)

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return [self._latest[feed] for feed in self._order if feed in self._latest]

    def handshake(self) -> dict[str, Any]:
        with self._lock:
            feeds = [self._latest[feed] for feed in self._order if feed in self._latest]
            latest_event_id = self._event_id
        now = time.time()
        return {
            "session_id": self.session_id,
            "server_time": now,
            "latest_event_id": latest_event_id,
            "retry_ms": _SSE_RETRY_MS,
            "feeds": [{**payload, "server_time": now, "event_id": latest_event_id} for payload in feeds],
        }

    # -- internals -------------------------------------------------------
    def _record_event_locked(self, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._event_id += 1
        event = {
            "id": self._event_id,
            "type": event_type,
            "payload": dict(payload),
            "server_time": time.time(),
            "session_id": self.session_id,
        }
        self._history.append(event)
        return event

    def _history_after(self, last_event_id: int) -> list[dict[str, Any]]:
        with self._lock:
            if not self._history:
                return []
            oldest_id = int(self._history[0]["id"])
            if last_event_id and last_event_id < oldest_id - 1:
                return []
            return [event for event in self._history if int(event["id"]) > last_event_id]

    def _snapshot_events(self) -> list[dict[str, Any]]:
        with self._lock:
            latest_event_id = self._event_id
            now = time.time()
            return [
                {
                    "id": latest_event_id,
                    "type": "scoreboard",
                    "payload": payload,
                    "server_time": now,
                    "session_id": self.session_id,
                }
                for payload in [self._latest[feed] for feed in self._order if feed in self._latest]
            ]

    def _encode_event(self, event: dict[str, Any]) -> str:
        # Stamp the send time so clients can run an accurate countdown even after
        # a reconnect (their clock offset is derived from this).
        payload = dict(event.get("payload") or {})
        payload["server_time"] = event.get("server_time", time.time())
        payload["event_id"] = int(event.get("id") or 0)
        payload["server_session"] = event.get("session_id", self.session_id)
        return (
            f"id: {int(event.get('id') or 0)}\n"
            f"event: {event.get('type') or 'scoreboard'}\n"
            f"data: {json.dumps(payload)}\n\n"
        )

    def _queue_subscriber_message(self, subscriber: queue.Queue[Any], message: str) -> None:
        try:
            subscriber.put_nowait(message)
            return
        except queue.Full:
            pass
        try:
            subscriber.get_nowait()
        except queue.Empty:
            pass
        try:
            subscriber.put_nowait(message)
        except queue.Full:
            pass

    def _subscribe(self) -> queue.Queue[Any]:
        subscriber: queue.Queue[Any] = queue.Queue(maxsize=256)
        with self._lock:
            self._subscribers.add(subscriber)
        return subscriber

    def _unsubscribe(self, subscriber: queue.Queue[Any]) -> None:
        with self._lock:
            self._subscribers.discard(subscriber)

    def _make_handler(self) -> type[BaseHTTPRequestHandler]:
        server = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: Any) -> None:  # noqa: D401 - silence stdout
                pass

            def do_GET(self) -> None:  # noqa: N802 - http.server API
                path = self.path.split("?", 1)[0]
                if path in ("/", "/index.html"):
                    self._send_static("index.html")
                elif path.startswith("/static/"):
                    self._send_static(path[len("/static/"):])
                elif path.startswith("/assets/"):
                    self._send_asset(path[len("/assets/"):])
                elif path == "/api/feeds":
                    now = time.time()
                    latest_event_id = server.handshake()["latest_event_id"]
                    feeds = [{**payload, "server_time": now, "event_id": latest_event_id} for payload in server.snapshot()]
                    self._send_json({"feeds": feeds})
                elif path == "/api/handshake":
                    self._send_json(server.handshake())
                elif path == "/events":
                    self._stream_events()
                else:
                    self.send_error(404)

            def do_POST(self) -> None:  # noqa: N802 - http.server API
                # Render-timing beacon from the overlay (monitoring only).
                path = self.path.split("?", 1)[0]
                if path != "/timing":
                    self.send_error(404)
                    return
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                    body = self.rfile.read(length) if length else b"{}"
                    record = json.loads(body.decode("utf-8") or "{}")
                    if isinstance(record, dict):
                        from .monitoring import log_render

                        log_render(record)
                except Exception:
                    pass
                self.send_response(204)
                self.send_header("Content-Length", "0")
                self.end_headers()

            # -- responses ------------------------------------------------
            def _send_static(self, rel: str) -> None:
                static_root = WEB_ROOT.resolve()
                candidate = (static_root / rel).resolve()
                if not candidate.is_relative_to(static_root) or not candidate.is_file():
                    self.send_error(404)
                    return
                self._send_file(candidate)

            def _send_asset(self, rel: str) -> None:
                from .display_assets import canonical_asset_file, canonical_asset_paths

                if rel in canonical_asset_paths():
                    candidate = canonical_asset_file(rel)
                    if candidate is None:
                        self.send_error(404)
                        return
                    self._send_file(candidate, cache=True)
                    return
                parts = rel.split("/")
                if len(parts) != 2:
                    self.send_error(404)
                    return
                kind, name = parts
                if kind not in _ASSET_KINDS or not _ASSET_NAME_RE.match(name):
                    self.send_error(404)
                    return
                imported_root = IMPORTED_ASSETS_ROOT.resolve()
                candidate = (imported_root / kind / name).resolve()
                if not candidate.is_relative_to(imported_root) or not candidate.is_file():
                    self.send_error(404)
                    return
                self._send_file(candidate, cache=True)

            def _send_file(self, path: Path, cache: bool = False) -> None:
                try:
                    body = path.read_bytes()
                except OSError:
                    self.send_error(404)
                    return
                content_type = _CONTENT_TYPES.get(
                    path.suffix.lower(), "application/octet-stream"
                )
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                if cache:
                    self.send_header("Cache-Control", "public, max-age=86400")
                else:
                    self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(body)

            def _send_json(self, data: dict[str, Any]) -> None:
                body = json.dumps(data).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", _CONTENT_TYPES[".json"])
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(body)

            def _stream_events(self) -> None:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                subscriber = server._subscribe()
                try:
                    self.wfile.write(f"retry: {_SSE_RETRY_MS}\n\n".encode("utf-8"))
                    last_event_id = self._last_event_id()
                    replay = server._history_after(last_event_id) if last_event_id else []
                    startup_events = replay or server._snapshot_events()
                    for event in startup_events:
                        self.wfile.write(server._encode_event(event).encode("utf-8"))
                    self.wfile.flush()
                    while True:
                        try:
                            message = subscriber.get(timeout=_SSE_KEEPALIVE_SECONDS)
                        except queue.Empty:
                            self.wfile.write(b": keepalive\n\n")
                            self.wfile.flush()
                            continue
                        if message is _STOP:
                            break
                        self.wfile.write(message.encode("utf-8"))
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass
                finally:
                    server._unsubscribe(subscriber)

            def _last_event_id(self) -> int:
                raw = self.headers.get("Last-Event-ID") or "0"
                try:
                    return max(0, int(raw))
                except ValueError:
                    return 0

        return Handler
