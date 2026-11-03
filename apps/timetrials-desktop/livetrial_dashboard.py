"""Loopback-only graphical Player progress shell for LiveTrial.

The historical vision dashboard remains the owner of live preview and local run
history on port 8777. This target-owned shell adds canonical Player progress and
Rivalen on port 8776, then embeds the historical view behind a second tab. It
never receives or serves a bearer token.
"""

from __future__ import annotations

import argparse
import hmac
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import threading
import time
from typing import Callable

from livetrial_languages import CODES as LANGUAGE_CODES, parse_language, template_bucket
from urllib.parse import parse_qs, urlparse
import re

from livetrial_ecosystem import load_cached_progress, player_progress_view
from livetrial_runtime_root import resource_root


DEFAULT_PORT = 8776
DEFAULT_HISTORY_URL = "http://127.0.0.1:8777/"
MAX_STATIC_BYTES = 2 * 1024 * 1024
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_ACTION_BYTES = 16 * 1024
# A chosen video is streamed to disk in chunks (ADR-0208 step 2), never held in memory.
MAX_UPLOAD_BYTES = 32 * 1024 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024
UPLOAD_SUFFIXES = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".ts"}
ACTION_PREFIX = "/api/action/"
ACTION_HEADER = "X-LiveTrial-Action"
FALLBACK_ICON = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#ff3b4f"/><stop offset="1" stop-color="#9b1233"/></linearGradient></defs>
<rect width="64" height="64" rx="14" fill="url(#g)"/><path d="M10 10h11v11H10zm22 0h11v11H32zM21 21h11v11H21zm22 0h11v11H43z" fill="#fff" opacity=".18"/>
<text x="32" y="48" text-anchor="middle" font-family="Segoe UI,Arial" font-size="38" font-style="italic" font-weight="900" fill="white">8</text></svg>'''


class LiveTrialDashboardError(RuntimeError):
    """Bounded dashboard failure without private paths or response details."""


def _fail() -> None:
    raise LiveTrialDashboardError("The LiveTrial progress dashboard is unavailable.") from None


def dashboard_root(environment: dict[str, str] | None = None) -> Path:
    return resource_root(environment or {}).joinpath(
        "apps", "timetrials-desktop", "dashboard"
    )


def load_track_catalog(runtime_root: str | Path) -> tuple[dict, Path | None]:
    """Load friendly track names/image paths from the packaged private assets."""
    try:
        assets_root = Path(runtime_root) / "MK8DX Clean Assets"
        database = assets_root / "database.json"
        if (
            not database.is_file()
            or database.is_symlink()
            or database.stat().st_size > 12 * 1024 * 1024
        ):
            return {}, None
        document = json.loads(database.read_text(encoding="utf-8"))
        tracks = document["collections"]["tracks"]
        cups = document["collections"]["cups"]
        staff_times = document["collections"].get("nintendoStaffTimes", [])
        if not isinstance(tracks, list) or len(tracks) > 128:
            return {}, None
        cup_images = {
            cup.get("id"): ((cup.get("assets") or {}).get("icon") or {}).get("path")
            for cup in cups if isinstance(cup, dict)
        } if isinstance(cups, list) else {}
        cup_names = {
            cup.get("id"): (cup.get("names") or {}).get("en-US")
            for cup in cups if isinstance(cup, dict) and isinstance(cup.get("names"), dict)
        } if isinstance(cups, list) else {}
        result = {}
        for record in tracks:
            track_id = record.get("id") if isinstance(record, dict) else None
            if not isinstance(track_id, str) or not track_id.startswith("track."):
                continue
            names = record.get("names") if isinstance(record.get("names"), dict) else {}
            name = names.get("en-US") or names.get("nl-NL")
            preview = (record.get("assets") or {}).get("preview") or {}
            image_path = preview.get("path")
            result[track_id] = {
                "name": name if isinstance(name, str) and name.strip() else track_id,
                "imagePath": image_path if isinstance(image_path, str) else None,
                "cupImagePath": cup_images.get(record.get("cupId")),
                "cupId": record.get("cupId") if isinstance(record.get("cupId"), str) else None,
                "cupName": cup_names.get(record.get("cupId")) if isinstance(cup_names.get(record.get("cupId")), str) else None,
                "lapCount": record.get("lapCount") if record.get("lapCount") in (3, 7) else None,
                # the schema-9 index the website's short leaderboard address uses (?lb=<index>)
                "index": record.get("index") if isinstance(record.get("index"), int)
                and not isinstance(record.get("index"), bool) and 0 <= record.get("index") < 1000 else None,
                "nintendoStaff": {},
            }
        for row in staff_times if isinstance(staff_times, list) else []:
            track_id = row.get("trackId") if isinstance(row, dict) else None
            mode = row.get("mode") if isinstance(row, dict) else None
            time_ms = row.get("timeMs") if isinstance(row, dict) else None
            if track_id in result and mode in {150, 200} and isinstance(time_ms, int) and time_ms > 0:
                result[track_id]["nintendoStaff"][str(mode)] = {
                    "timeMs": time_ms,
                    "name": row.get("playerName") if isinstance(row.get("playerName"), str) else "Nintendo Staff",
                }
        return result, assets_root.resolve(strict=False)
    except Exception:
        return {}, None


def _safe_static(root: Path, name: str, maximum: int) -> bytes | None:
    try:
        target = (root / name).resolve(strict=True)
        if (
            target.is_symlink()
            or not target.is_file()
            or root.resolve(strict=True) not in target.parents
            or target.stat().st_size > maximum
        ):
            return None
        return target.read_bytes()
    except (OSError, ValueError):
        return None


PRODUCT_ICON_VARIABLE = "MK8DX_LIVETRIAL_PRODUCT_ICON"


def product_icon_path(root: Path) -> Path | None:
    """Where the owner's app icon is: packaged beside the dashboard, else the
    source-run override. The engine's run history page is told this path so
    both pages carry the same favicon."""
    for name in ("app-icon.png", "app-icon.ico"):
        candidate = root / name
        if candidate.is_file() and not candidate.is_symlink():
            return candidate
    override = os.environ.get(PRODUCT_ICON_VARIABLE)
    if override:
        candidate = Path(override)
        if candidate.suffix.lower() in {".png", ".ico"} and candidate.is_file():
            return candidate
    return None


def _product_icon(root: Path) -> tuple[bytes, str] | None:
    """The owner's private app icon: packaged beside the dashboard, or, for a
    run from source, the same file the package builder takes (--product-icon)."""
    for name in ("app-icon.png", "app-icon.ico"):
        payload = _safe_static(root, name, MAX_IMAGE_BYTES)
        if payload:
            return payload, "image/png" if name.endswith(".png") else "image/x-icon"
    override = os.environ.get(PRODUCT_ICON_VARIABLE)
    if override:
        try:
            target = Path(override).resolve(strict=True)
            if (target.suffix.lower() in {".png", ".ico"} and target.is_file()
                    and target.stat().st_size <= MAX_IMAGE_BYTES):
                return target.read_bytes(), "image/png" if target.suffix.lower() == ".png" else "image/x-icon"
        except (OSError, ValueError):
            return None
    return None


def _build_catalog(assets_root: Path | None) -> dict:
    try:
        if assets_root is None:
            return {"categories": {}}
        document = json.loads((assets_root / "database.json").read_text(encoding="utf-8"))
        collections = document["collections"]
        definitions = (("character", "characters", "menu"), ("body", "vehicleBodies", "default"),
                       ("tire", "vehicleTires", "default"), ("glider", "vehicleGliders", "default"))
        categories = {}
        for category, collection, asset_key in definitions:
            categories[category] = [{"id": row["id"], "name": row["names"]["en-US"],
                                     "iconPath": row["assets"][asset_key]["path"], "stats": row["stats"]}
                                    for row in collections[collection]]
        return {"schemaVersion": "mk8dx.desktop-build-catalog.v1", "categories": categories,
                "effectiveCap": document["statModel"]["effectiveCap"]}
    except Exception:
        return {"schemaVersion": "mk8dx.desktop-build-catalog.v1", "categories": {}}


class ProgressDashboard:
    def __init__(self, server: ThreadingHTTPServer, thread: threading.Thread):
        self._server = server
        self._thread = thread

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._server.server_address[1]}/"

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=2.0)


def start_progress_dashboard(
    static_root: str | Path,
    progress_provider: Callable[[bool], dict],
    track_catalog: dict | None = None,
    assets_root: str | Path | None = None,
    history_url: str = DEFAULT_HISTORY_URL,
    port: int = DEFAULT_PORT,
    language: str = "en",
    rank_provider: Callable[[str, tuple[str, ...]], dict] | None = None,
    actions: dict[str, Callable[[dict], dict]] | None = None,
    language_provider: Callable[[], str] | None = None,
    uploads_root: str | Path | None = None,
    preview_file: str | Path | None = None,
    clip_still: Callable[[str], Path | None] | None = None,
) -> ProgressDashboard:
    """Start the dashboard on loopback and return its lifecycle.

    Reading is open to the loopback page. Doing something (sign in, switch or
    remove an account) goes through ``POST /api/action/<name>`` and is only
    accepted from the dashboard page itself: the request's Host and Origin must
    be this loopback server, the body JSON, and the ``X-LiveTrial-Action``
    header must carry the secret made for this launch, which exists only in the
    page this server hands out. Another website cannot read that page, cannot
    send the header without a CORS preflight (which is never answered), and a
    DNS-rebound name fails the Host check.
    """
    root = Path(static_root)
    if (
        not callable(progress_provider)
        or not root.is_dir()
        or root.is_symlink()
        or port < 0
        or port > 65535
        or history_url != DEFAULT_HISTORY_URL
        or language not in LANGUAGE_CODES
    ):
        _fail()
    catalog = track_catalog if isinstance(track_catalog, dict) else {}
    action_table = dict(actions or {})
    if not all(isinstance(name, str) and callable(handler) for name, handler in action_table.items()):
        _fail()
    action_secret = secrets.token_urlsafe(32)
    image_root = Path(assets_root).resolve(strict=False) if assets_root else None
    build_catalog = _build_catalog(image_root)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, _format: str, *_args: object) -> None:
            return

        def _trusted_host(self) -> bool:
            host = self.headers.get("Host", "").split(":", 1)[0].lower()
            return host in {"127.0.0.1", "localhost", "[::1]"}

        def _send(self, status: int, payload: bytes, content_type: str, cache: str = "no-store") -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", cache)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                "script-src 'self'; frame-src http://127.0.0.1:8777; "
                "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            )
            self.end_headers()
            self.wfile.write(payload)

        def _json(self, document: object, status: int = 200) -> None:
            try:
                payload = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            except (TypeError, ValueError):
                payload = b'{"status":"unavailable"}'
                status = 503
            self._send(status, payload, "application/json; charset=utf-8")

        def do_GET(self) -> None:  # noqa: N802
            if not self._trusted_host():
                self._send(421, b"untrusted host", "text/plain; charset=utf-8")
                return
            parsed = urlparse(self.path)
            if parsed.path == "/":
                payload = _safe_static(root, "index.html", MAX_STATIC_BYTES)
                if payload and action_table:
                    payload = payload.replace(
                        b"</head>",
                        b'  <meta name="livetrial-action" content="' + action_secret.encode("ascii") + b'">\n</head>',
                        1,
                    )
                self._send(200, payload, "text/html; charset=utf-8") if payload else self._send(
                    404, b"not found", "text/plain; charset=utf-8"
                )
                return
            if parsed.path in {
                "/app.css",
                "/app.js",
                "/dutch-presentation.generated.js",
                "/loadout-variants.json",
            }:
                name = parsed.path.removeprefix("/")
                payload = _safe_static(root, name, MAX_STATIC_BYTES)
                content_type = "text/css; charset=utf-8" if name.endswith(".css") else "application/json; charset=utf-8" if name.endswith(".json") else "text/javascript; charset=utf-8"
                self._send(200, payload, content_type, "no-cache") if payload else self._send(
                    404, b"not found", "text/plain; charset=utf-8"
                )
                return
            language_file = re.fullmatch(r"/i18n/([A-Za-z0-9-]{2,6})\.json", parsed.path)
            if language_file is not None and parse_language(language_file.group(1)) == language_file.group(1):
                # The language catalogs (livetrial_languages.py), one file per language beside app.js.
                payload = _safe_static(root, f"i18n/{language_file.group(1)}.json", MAX_STATIC_BYTES * 4)
                self._send(200, payload, "application/json; charset=utf-8", "no-cache") if payload else self._send(
                    404, b"not found", "text/plain; charset=utf-8"
                )
                return
            if parsed.path in {"/app-icon", "/favicon.ico"}:
                icon = _product_icon(root)
                self._send(
                    200,
                    icon[0] if icon else FALLBACK_ICON,
                    icon[1] if icon else "image/svg+xml",
                    "max-age=3600",
                )
                return
            if parsed.path == "/api/config":
                current = language
                if language_provider is not None:
                    try:
                        current = language_provider() if language_provider() in LANGUAGE_CODES else language
                    except Exception:
                        current = language
                # "product" lets a second start find this window instead of starting a copy.
                self._json({"historyUrl": history_url, "language": current, "product": "livetrial",
                            "app": bool(action_table)})
                return
            if parsed.path == "/api/capture-preview":
                picture = Path(preview_file) if preview_file else None
                payload = picture.read_bytes() if picture is not None and picture.is_file() and picture.stat().st_size <= MAX_IMAGE_BYTES else None
                self._send(200, payload, "image/jpeg") if payload else self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            if parsed.path == "/api/clip-still":
                # A clip's end-screen picture (ADR-0213): resolved by the clip id, never by a path.
                clip_id = (parse_qs(parsed.query).get("clip") or [""])[0]
                still = clip_still(clip_id) if clip_still is not None else None
                payload = still.read_bytes() if still is not None and still.stat().st_size <= MAX_IMAGE_BYTES else None
                self._send(200, payload, "image/jpeg", "max-age=3600") if payload else self._send(
                    404, b"not found", "text/plain; charset=utf-8")
                return
            if parsed.path == "/api/build-catalog":
                self._json(build_catalog)
                return
            if parsed.path == "/api/game-asset":
                relative = (parse_qs(parsed.query).get("path") or [""])[0]
                # items/icons: the coin, rupee, bell, shine and mushroom per-lap icons (as on Home).
                allowed = ("images/characters/", "images/vehicles/", "images/items/icons/")
                if image_root is None or not isinstance(relative, str) or not relative.startswith(allowed):
                    self._send(404, b"not found", "text/plain; charset=utf-8")
                    return
                payload = _safe_static(image_root, relative, MAX_IMAGE_BYTES)
                suffix = Path(relative).suffix.lower()
                self._send(200, payload, mimetypes.types_map.get(suffix, "image/png"), "max-age=3600") if payload else self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            if parsed.path == "/api/progress":
                refresh = (parse_qs(parsed.query).get("refresh") or ["0"])[0] == "1"
                try:
                    self._json(progress_provider(refresh))
                except Exception:
                    self._json({"status": "unavailable", "message": "Progress is unavailable right now."}, 503)
                return
            if parsed.path == "/api/rank-data":
                if rank_provider is None:
                    self._send(404, b"not found", "text/plain; charset=utf-8")
                    return
                query = (parse_qs(parsed.query).get("query") or [""])[0].strip()
                players_value = (parse_qs(parsed.query).get("players") or [""])[0]
                player_ids = tuple(dict.fromkeys(value for value in players_value.split(",") if value))
                valid_player = re.compile(r"^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$").fullmatch
                if ((query and not 2 <= len(query) <= 64) or len(player_ids) > 5 or
                        any(valid_player(value) is None for value in player_ids) or
                        (not query and not player_ids)):
                    self._json({"status": "invalid"}, 400)
                    return
                try:
                    self._json(rank_provider(query, player_ids))
                except Exception:
                    self._json({"status": "unavailable"}, 503)
                return
            if parsed.path == "/api/track-image":
                track_id = (parse_qs(parsed.query).get("trackId") or [""])[0]
                record = catalog.get(track_id) if isinstance(track_id, str) else None
                relative = record.get("imagePath") if isinstance(record, dict) else None
                if image_root is None or not isinstance(relative, str):
                    self._send(404, b"not found", "text/plain; charset=utf-8")
                    return
                payload = _safe_static(image_root, relative, MAX_IMAGE_BYTES)
                suffix = Path(relative).suffix.lower()
                content_type = mimetypes.types_map.get(suffix, "image/png")
                self._send(200, payload, content_type, "max-age=3600") if payload else self._send(
                    404, b"not found", "text/plain; charset=utf-8"
                )
                return
            if parsed.path == "/api/cup-image":
                track_id = (parse_qs(parsed.query).get("trackId") or [""])[0]
                record = catalog.get(track_id) if isinstance(track_id, str) else None
                relative = record.get("cupImagePath") if isinstance(record, dict) else None
                if image_root is None or not isinstance(relative, str):
                    self._send(404, b"not found", "text/plain; charset=utf-8")
                    return
                payload = _safe_static(image_root, relative, MAX_IMAGE_BYTES)
                self._send(200, payload, "image/png", "max-age=3600") if payload else self._send(
                    404, b"not found", "text/plain; charset=utf-8"
                )
                return
            if parsed.path == "/api/finish-banner":
                outcome = (parse_qs(parsed.query).get("outcome") or [""])[0]
                file_name = {
                    "won": "070_finish_banner_won.png",
                    "record": "071_finish_banner_new_record.png",
                    "lost": "072_finish_banner_lost.png",
                }.get(outcome)
                relative = f"images/hud/templates/{template_bucket(language)}/{file_name}" if file_name else None
                payload = _safe_static(image_root, relative, MAX_IMAGE_BYTES) if image_root and relative else None
                self._send(200, payload, "image/png", "max-age=3600") if payload else self._send(
                    404, b"not found", "text/plain; charset=utf-8"
                )
                return
            self._send(404, b"not found", "text/plain; charset=utf-8")

        def _action_allowed(self) -> bool:
            if not self._trusted_host():
                return False
            port_now = self.server.server_address[1]
            origin = self.headers.get("Origin", "")
            if origin not in {f"http://127.0.0.1:{port_now}", f"http://localhost:{port_now}"}:
                return False
            if self.headers.get("Sec-Fetch-Site", "same-origin") != "same-origin":
                return False
            offered = self.headers.get(ACTION_HEADER, "")
            return bool(offered) and hmac.compare_digest(offered.encode("utf-8"), action_secret.encode("ascii"))

        def _drain(self) -> None:
            """Read a small refused body first, so Windows delivers the refusal
            instead of resetting the connection; a large one just closes."""
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if 0 < length <= UPLOAD_CHUNK_BYTES:
                self.rfile.read(length)
            else:
                self.close_connection = True

        def _upload(self, parsed) -> None:
            """Stream one chosen video to the uploads folder; answer its id."""
            if uploads_root is None or not self._action_allowed():
                self._drain()
                self.close_connection = True
                self._send(403, b'{"error":"not allowed"}', "application/json; charset=utf-8")
                return
            try:
                length = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                length = -1
            name = (parse_qs(parsed.query).get("name") or [""])[0]
            suffix = Path(name).suffix.lower()
            if not 0 < length <= MAX_UPLOAD_BYTES or suffix not in UPLOAD_SUFFIXES:
                self._drain()
                self._send(400, b'{"ok":false,"message":"Choose a video file (mp4, mkv, mov, avi, webm)."}', "application/json; charset=utf-8")
                return
            folder = Path(uploads_root)
            folder.mkdir(parents=True, exist_ok=True)
            stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(name).stem)[:60] or "video"
            target = folder / f"{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}-{stem}{suffix}"
            partial = target.with_name(target.name + ".partial")
            remaining = length
            try:
                with open(partial, "wb") as handle:
                    while remaining > 0:
                        chunk = self.rfile.read(min(UPLOAD_CHUNK_BYTES, remaining))
                        if not chunk:
                            raise OSError("upload ended early")
                        handle.write(chunk)
                        remaining -= len(chunk)
                partial.replace(target)
            except OSError:
                try:
                    partial.unlink()
                except OSError:
                    pass
                self.close_connection = True
                self._send(400, b'{"ok":false,"message":"The video could not be received completely. Try again."}', "application/json; charset=utf-8")
                return
            self._json({"ok": True, "result": {"uploadId": target.name, "bytes": length}})

        def do_POST(self) -> None:  # noqa: N802
            parsed_path = urlparse(self.path)
            if parsed_path.path == "/api/upload":
                self._upload(parsed_path)
                return
            # Read the (bounded) body first: answering before it is read makes
            # Windows reset the connection instead of delivering the refusal.
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if not 0 <= length <= MAX_ACTION_BYTES:
                self.close_connection = True
                self._send(400, b'{"error":"bad request"}', "application/json; charset=utf-8")
                return
            raw = self.rfile.read(length) if length else b""
            parsed = urlparse(self.path)
            if not parsed.path.startswith(ACTION_PREFIX):
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            if not self._action_allowed():
                self._send(403, b'{"error":"not allowed"}', "application/json; charset=utf-8")
                return
            handler = action_table.get(parsed.path[len(ACTION_PREFIX):])
            if handler is None:
                self._send(404, b'{"error":"unknown action"}', "application/json; charset=utf-8")
                return
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/json":
                self._send(400, b'{"error":"bad request"}', "application/json; charset=utf-8")
                return
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except (UnicodeDecodeError, ValueError):
                body = None
            if not isinstance(body, dict):
                self._send(400, b'{"error":"bad request"}', "application/json; charset=utf-8")
                return
            try:
                self._json({"ok": True, "result": handler(body)})
            except Exception as error:
                # Action errors are written for people; anything else stays generic.
                readable = {"LiveTrialAccountActionError", "LiveTrialDesktopError", "LiveTrialYouTubeError"}
                message = str(error) if type(error).__name__ in readable else "That did not work. Nothing was changed."
                self._json({"ok": False, "message": message}, 409)

        def do_OPTIONS(self) -> None:  # noqa: N802
            # No CORS: a preflight is never approved, so no other site can call an action.
            self._send(405, b"", "text/plain; charset=utf-8")

    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return ProgressDashboard(server, thread)
    except (OSError, ValueError):
        _fail()


def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--player-id", required=True)
    parser.add_argument("--runtime-root", required=True)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    arguments = parser.parse_args()
    catalog, assets = load_track_catalog(arguments.runtime_root)

    def cached(_refresh: bool) -> dict:
        cache = load_cached_progress(arguments.data_root, arguments.player_id)
        if cache is None:
            return {"status": "unavailable", "message": "No cached Player progress is available."}
        return {"status": "cached", "view": player_progress_view(cache, catalog)}

    dashboard = start_progress_dashboard(
        dashboard_root(), cached, catalog, assets, port=arguments.port
    )
    print(dashboard.url, flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        dashboard.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
