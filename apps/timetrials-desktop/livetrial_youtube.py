"""Optional YouTube upload for LiveTrial clips (ADR-0213).

A Player may connect their own YouTube channel and upload one of their local
clips to it by hand. The video goes from this PC straight to YouTube; the
MK8DX website never receives it. What comes back is the ordinary
``https://youtu.be/<id>`` link the website already accepts as evidence.

Nothing here is required. Without the OAuth client file, without a
connection, or when Google is unreachable, LiveTrial works exactly as before.

This module is the whole Google-facing side, with no knowledge of Mario Kart:

* ``find_oauth_client`` - where the Desktop OAuth client file comes from;
* ``YouTubeAuthorizationStore`` - one Player's authorization, protected by the
  same OS mechanism as that Player's LiveTrial session (``<slot>.youtube.dat``);
* ``YouTubeAuthorizationFlow`` - Google's installed-app flow: the consent page
  in the person's own browser, a one-time loopback redirect, ``state`` and
  PKCE (S256);
* ``YouTubeClient`` - token exchange and refresh, and the documented
  resumable upload protocol.

Every request goes through a ``transport`` object, so the transport can later
be replaced (for example by Google's own library) without touching the
callers, and tests never reach the network. No token, code, secret or
response body is ever logged or put into an error message.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
import hashlib
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import socket
import ssl
import tempfile
import threading
import time
from typing import BinaryIO, Callable, Mapping, Protocol
from urllib import parse

from livetrial_https import (
    GOOGLE_TOKEN_HOST,
    GOOGLE_TOKEN_PATH,
    YOUTUBE_UPLOAD_HOST,
    YOUTUBE_UPLOAD_PATH,
    allowed_google_request,
)


OAUTH_CLIENT_VARIABLE = "LIVETRIAL_YOUTUBE_OAUTH_CLIENT"
OAUTH_CLIENT_FILE_NAME = "youtube-oauth-client.json"
INTEGRATIONS_FOLDER = "integrations"
UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"
AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = f"https://{GOOGLE_TOKEN_HOST}{GOOGLE_TOKEN_PATH}"
UPLOAD_ENDPOINT = f"https://{YOUTUBE_UPLOAD_HOST}{YOUTUBE_UPLOAD_PATH}?uploadType=resumable&part=snippet,status"
AUTHORIZATION_SCHEMA_VERSION = "mk8dx.livetrial-youtube-authorization.v1"
AUTHORIZATION_SUFFIX = ".youtube.dat"
MAX_CLIENT_FILE_BYTES = 64 * 1024
MAX_AUTHORIZATION_FILE_BYTES = 32 * 1024
MAX_RESPONSE_BYTES = 256 * 1024
# A multiple of 256 KiB, as the resumable protocol requires for every chunk but the last.
UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
MAX_UPLOAD_BYTES = 256 * 1024 * 1024 * 1024
UPLOAD_RETRIES = 5
CONNECT_TIMEOUT_SECONDS = 300
REFRESH_MARGIN_MS = 60_000
# YouTube's minimum functionality asks upload clients to let the person choose
# Public, Private or Unlisted. The model carries all three; an API project that
# has not passed Google's audit has every upload forced to Private, so only
# Private is offered until the project is audited. Changing this tuple is the
# only step needed then.
PRIVACY_STATUSES = ("private", "unlisted", "public")
AVAILABLE_PRIVACY_STATUSES = ("private",)
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_CLIENT_ID = re.compile(r"^[A-Za-z0-9._-]{8,200}\.apps\.googleusercontent\.com$")
_TOKEN = re.compile(r"^[\x21-\x7e]{8,4096}$")
_SLOT_ID = re.compile(r"^slot\.[0-9a-f]{32}$")
_TITLE_FORBIDDEN = re.compile(r"[<>\x00-\x08\x0b\x0c\x0e-\x1f]")


class LiveTrialYouTubeError(RuntimeError):
    """A person-readable YouTube failure. It never carries a token, a code,
    a client secret, a private path or a Google response body."""

    def __init__(self, message: str, code: str = "failed") -> None:
        super().__init__(message)
        self.code = code


def _fail(message: str, code: str = "failed") -> None:
    raise LiveTrialYouTubeError(message, code) from None


# ---------------------------------------------------------------- the OAuth client

@dataclass(frozen=True)
class OAuthClient:
    client_id: str
    client_secret: str = field(repr=False)
    source: str  # "environment" or "app-data": where it came from, never the file's content


def oauth_client_locations(environment: Mapping[str, str], data_root: str | Path) -> list[tuple[str, Path]]:
    """Where the Desktop OAuth client is looked for, in order."""
    explicit = environment.get(OAUTH_CLIENT_VARIABLE)
    if isinstance(explicit, str) and explicit.strip():
        # Set on purpose: the only place looked at, so a wrong path is reported
        # instead of another file being used without anyone noticing.
        return [("environment", Path(explicit.strip().strip('"')))]
    return [("app-data", default_client_location(data_root))]


def default_client_location(data_root: str | Path) -> Path:
    return Path(data_root) / INTEGRATIONS_FOLDER / OAUTH_CLIENT_FILE_NAME


def parse_oauth_client(document: object, source: str = "app-data") -> OAuthClient:
    """A Google *Desktop app* client ("installed"). A Web client does not work
    with a loopback redirect and is refused with a plain explanation."""
    if not isinstance(document, dict):
        _fail("The YouTube client file is not a Google OAuth client file.", "invalid_client")
    if "installed" not in document:
        if "web" in document:
            _fail("The YouTube client file is for a Web application. Create a Desktop app client instead.",
                  "invalid_client")
        _fail("The YouTube client file is not a Google OAuth client file.", "invalid_client")
    installed = document["installed"]
    client_id = installed.get("client_id") if isinstance(installed, dict) else None
    client_secret = installed.get("client_secret") if isinstance(installed, dict) else None
    if not isinstance(client_id, str) or _CLIENT_ID.fullmatch(client_id) is None:
        _fail("The YouTube client file has no valid client id.", "invalid_client")
    if not isinstance(client_secret, str) or not 8 <= len(client_secret) <= 512 or not client_secret.isprintable():
        _fail("The YouTube client file has no valid client secret.", "invalid_client")
    return OAuthClient(client_id, client_secret, source)


def find_oauth_client(environment: Mapping[str, str], data_root: str | Path) -> OAuthClient | None:
    """The configured client, or ``None`` when YouTube is simply not set up.

    A file that exists but cannot be used raises a readable error; a missing
    file in LiveTrial's own folder is not an error at all.
    """
    for source, path in oauth_client_locations(environment, data_root):
        try:
            if not path.exists():
                if source == "environment":
                    _fail(f"{OAUTH_CLIENT_VARIABLE} points to a file that does not exist.", "invalid_client")
                continue
            if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_CLIENT_FILE_BYTES:
                _fail("The YouTube client file cannot be read.", "invalid_client")
            document = json.loads(path.read_text(encoding="utf-8"))
        except LiveTrialYouTubeError:
            raise
        except (OSError, UnicodeDecodeError, ValueError):
            _fail("The YouTube client file cannot be read.", "invalid_client")
        return parse_oauth_client(document, source)
    return None


# ---------------------------------------------------------------- the stored authorization

def authorization_path(accounts_root: str | Path, slot_id: str) -> Path:
    if not isinstance(slot_id, str) or _SLOT_ID.fullmatch(slot_id) is None:
        _fail("That account is not on this PC.", "no_account")
    return Path(accounts_root) / f"{slot_id}{AUTHORIZATION_SUFFIX}"


def _valid_authorization(document: object) -> dict | None:
    if not isinstance(document, dict) or document.get("schemaVersion") != AUTHORIZATION_SCHEMA_VERSION:
        return None
    if document.get("reconnectRequired") is True:
        return {"schemaVersion": AUTHORIZATION_SCHEMA_VERSION, "reconnectRequired": True,
                "connectedAtMs": document.get("connectedAtMs") if isinstance(document.get("connectedAtMs"), int) else None}
    refresh = document.get("refreshToken")
    client_id = document.get("clientId")
    if not isinstance(refresh, str) or _TOKEN.fullmatch(refresh) is None or not isinstance(client_id, str):
        return None
    result = {
        "schemaVersion": AUTHORIZATION_SCHEMA_VERSION,
        "refreshToken": refresh,
        "clientId": client_id,
        "connectedAtMs": document.get("connectedAtMs") if isinstance(document.get("connectedAtMs"), int) else None,
    }
    access = document.get("accessToken")
    expires = document.get("accessExpiresAtMs")
    if isinstance(access, str) and _TOKEN.fullmatch(access) and isinstance(expires, int) and not isinstance(expires, bool):
        result["accessToken"] = access
        result["accessExpiresAtMs"] = expires
    return result


class YouTubeAuthorizationStore:
    """One Player's YouTube authorization in one OS-protected file.

    The file format is the one ``LiveTrialProtectedSessionStore`` uses for the
    Player's LiveTrial session: base64 of the protector's output. A file that
    cannot be read is removed and treated as "not connected", never as an error
    that stops LiveTrial.
    """

    def __init__(self, path: str | Path, protect: Callable[[bytes], bytes],
                 unprotect: Callable[[bytes], bytes]) -> None:
        if not callable(protect) or not callable(unprotect):
            _fail("YouTube storage is unavailable.")
        self._path = Path(path)
        self._protect = protect
        self._unprotect = unprotect

    @property
    def path(self) -> Path:
        return self._path

    def load(self) -> dict | None:
        try:
            if not self._path.exists():
                return None
            if self._path.is_symlink() or not self._path.is_file():
                self._remove_quietly()
                return None
            payload = self._path.read_bytes()
            if not payload or len(payload) > MAX_AUTHORIZATION_FILE_BYTES:
                self._remove_quietly()
                return None
            plaintext = self._unprotect(base64.b64decode(payload, validate=True))
            document = _valid_authorization(json.loads(plaintext.decode("utf-8")))
        except Exception:
            self._remove_quietly()
            return None
        if document is None:
            self._remove_quietly()
        return document

    def save(self, document: dict) -> None:
        parsed = _valid_authorization(document)
        if parsed is None:
            _fail("YouTube storage is unavailable.")
        try:
            plaintext = json.dumps(parsed, sort_keys=True, separators=(",", ":")).encode("utf-8")
            payload = base64.b64encode(self._protect(plaintext))
            if len(payload) > MAX_AUTHORIZATION_FILE_BYTES:
                _fail("YouTube storage is unavailable.")
            self._path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary_name = tempfile.mkstemp(prefix=f".{self._path.name}.", suffix=".tmp",
                                                          dir=self._path.parent)
            temporary = Path(temporary_name)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(payload)
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    temporary.chmod(0o600)
                except OSError:
                    pass
                os.replace(temporary, self._path)
            finally:
                try:
                    temporary.unlink()
                except OSError:
                    pass
        except LiveTrialYouTubeError:
            raise
        except Exception:
            _fail("YouTube storage is unavailable.")

    def clear(self) -> None:
        try:
            self._path.unlink(missing_ok=True)
        except OSError:
            _fail("The YouTube connection could not be removed from this PC.")

    def _remove_quietly(self) -> None:
        try:
            self._path.unlink(missing_ok=True)
        except OSError:
            pass


def windows_authorization_store(path: str | Path) -> YouTubeAuthorizationStore:
    """The same Windows DPAPI protection as the Player's LiveTrial session."""
    from livetrial_session import WindowsDpapiProtector

    protector = WindowsDpapiProtector()
    return YouTubeAuthorizationStore(path, protector.protect, protector.unprotect)


# ---------------------------------------------------------------- transport

@dataclass
class TransportResponse:
    status: int
    headers: dict  # lower-case names
    body: bytes = field(repr=False, default=b"")


class YouTubeTransport(Protocol):
    def request(self, method: str, url: str, headers: dict, body: bytes | None) -> TransportResponse: ...


class HttpsTransport:
    """Standard-library HTTPS, only for the three allowed Google requests.

    Redirects are never followed. A refused address raises before any
    connection is made. Only the response headers and a bounded body are
    kept; nothing is logged.
    """

    def __init__(self, timeout_seconds: float = 60.0, context: ssl.SSLContext | None = None) -> None:
        self._timeout = timeout_seconds
        self._context = context or ssl.create_default_context()

    def request(self, method: str, url: str, headers: dict, body: bytes | None) -> TransportResponse:
        if not allowed_google_request(method, url):
            _fail("LiveTrial does not contact that address.", "refused")
        parsed = parse.urlsplit(url)
        target = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        connection = http.client.HTTPSConnection(parsed.hostname, 443, timeout=self._timeout, context=self._context)
        try:
            connection.request(method, target, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                payload = b""
            return TransportResponse(response.status, {k.lower(): v for k, v in response.getheaders()}, payload)
        finally:
            connection.close()


# ---------------------------------------------------------------- authorization flow

def pkce_pair() -> tuple[str, str]:
    """(verifier, S256 challenge) as RFC 7636 describes."""
    verifier = secrets.token_urlsafe(64)[:96]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def authorization_url(client: OAuthClient, redirect_uri: str, state: str, challenge: str) -> str:
    return AUTHORIZATION_ENDPOINT + "?" + parse.urlencode({
        "client_id": client.client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": UPLOAD_SCOPE,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        # A refresh token, so an upload next week does not need the browser again.
        "access_type": "offline",
        "prompt": "consent",
    })


_DONE_PAGE = """<!doctype html><html lang="en"><meta charset="utf-8"><title>LiveTrial</title>
<body style="font-family:Segoe UI,Arial,sans-serif;background:#0e1422;color:#eef1fa;display:grid;place-items:center;height:100vh;margin:0">
<main style="text-align:center"><h1 style="font-size:22px">{title}</h1><p>{body}</p></main></body></html>"""


class _LoopbackReceiver:
    """A one-time HTTP listener on 127.0.0.1 for Google's redirect.

    It answers exactly one request carrying the matching ``state``; any other
    request (a favicon, a stray visit, a wrong state) is refused and does not
    end the flow.
    """

    def __init__(self, state: str) -> None:
        self.state = state
        self.result: dict | None = None
        self.arrived = threading.Event()
        receiver = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: object) -> None:
                return

            def do_GET(self) -> None:  # noqa: N802
                parsed = parse.urlsplit(self.path)
                query = parse.parse_qs(parsed.query)
                offered = (query.get("state") or [""])[0]
                if parsed.path != "/" or not hmac.compare_digest(offered.encode("utf-8"), receiver.state.encode("ascii")):
                    self._page(400, "This page was not expected.", "Return to LiveTrial.")
                    return
                if receiver.arrived.is_set():
                    self._page(200, "Already done", "You can close this window and return to LiveTrial.")
                    return
                code = (query.get("code") or [""])[0]
                error = (query.get("error") or [""])[0]
                scope = (query.get("scope") or [""])[0]
                receiver.result = {"code": code, "error": error, "scope": scope}
                if code:
                    self._page(200, "YouTube is connected to LiveTrial",
                               "You can close this window and return to LiveTrial.")
                else:
                    self._page(200, "YouTube was not connected", "Nothing was changed. You can close this window.")
                receiver.arrived.set()

            def _page(self, status: int, title: str, body: str) -> None:
                payload = _DONE_PAGE.format(title=title, body=body).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.end_headers()
                self.wfile.write(payload)

        self._server = HTTPServer(("127.0.0.1", 0), Handler)
        self._server.timeout = 0.5
        self.redirect_uri = f"http://127.0.0.1:{self._server.server_address[1]}/"
        self._closed = False

    def wait(self, deadline: float, cancelled: threading.Event, clock: Callable[[], float]) -> dict | None:
        while not self.arrived.is_set() and not cancelled.is_set() and clock() < deadline:
            self._server.handle_request()
        return self.result

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._server.server_close()


FLOW_STATES = ("pending", "connected", "cancelled", "denied", "expired", "failed")


class YouTubeAuthorizationFlow:
    """Connect one Player's channel, in the background.

    ``start`` opens the consent page in the person's browser and returns at
    once; ``state`` tells the page how it ended. The authorization is saved to
    the store of the Player who clicked Connect, even if another Player is made
    active meanwhile.
    """

    def __init__(self, client: "YouTubeClient", store: YouTubeAuthorizationStore, slot_id: str,
                 open_browser: Callable[[str], object], clock: Callable[[], float] = time.monotonic,
                 now_ms: Callable[[], int] | None = None, timeout_seconds: float = CONNECT_TIMEOUT_SECONDS,
                 receiver_factory: Callable[[str], _LoopbackReceiver] = _LoopbackReceiver) -> None:
        self.flow_id = secrets.token_urlsafe(12)
        self.slot_id = slot_id
        self.state = "pending"
        self.message = ""
        self._client = client
        self._store = store
        self._open_browser = open_browser
        self._clock = clock
        self._now_ms = now_ms or (lambda: time.time_ns() // 1_000_000)
        self._timeout = timeout_seconds
        self._receiver_factory = receiver_factory
        self._cancelled = threading.Event()
        self._thread: threading.Thread | None = None
        self.done = threading.Event()

    def public(self) -> dict:
        return {"flowId": self.flow_id, "state": self.state, "message": self.message}

    def start(self) -> None:
        state = secrets.token_urlsafe(32)
        verifier, challenge = pkce_pair()
        receiver = self._receiver_factory(state)
        url = authorization_url(self._client.oauth_client, receiver.redirect_uri, state, challenge)
        try:
            opened = self._open_browser(url)
        except Exception:
            opened = False
        if opened is False:
            receiver.close()
            self._finish("failed", "The browser could not be opened for Google's sign-in.")
            return
        self._thread = threading.Thread(target=self._run, args=(receiver, verifier), daemon=True,
                                        name="livetrial-youtube-connect")
        self._thread.start()

    def cancel(self) -> None:
        self._cancelled.set()

    def _run(self, receiver: _LoopbackReceiver, verifier: str) -> None:
        try:
            result = receiver.wait(self._clock() + self._timeout, self._cancelled, self._clock)
        finally:
            receiver.close()
        if self._cancelled.is_set():
            self._finish("cancelled", "Connecting YouTube was cancelled.")
            return
        if result is None:
            self._finish("expired", "Google's sign-in took too long. Try again.")
            return
        if result.get("error") == "access_denied":
            self._finish("denied", "YouTube was not connected: the permission was not given.")
            return
        if result.get("error") or not result.get("code"):
            self._finish("failed", "Google did not complete the sign-in. Try again.")
            return
        if UPLOAD_SCOPE not in (result.get("scope") or "").split():
            self._finish("denied", "YouTube was not connected: the upload permission was not ticked.")
            return
        try:
            tokens = self._client.exchange_code(result["code"], verifier, receiver.redirect_uri)
            self._store.save({
                "schemaVersion": AUTHORIZATION_SCHEMA_VERSION,
                "refreshToken": tokens["refreshToken"],
                "clientId": self._client.oauth_client.client_id,
                "accessToken": tokens["accessToken"],
                "accessExpiresAtMs": self._now_ms() + tokens["expiresInSeconds"] * 1000,
                "connectedAtMs": self._now_ms(),
            })
        except LiveTrialYouTubeError as error:
            self._finish("failed", str(error))
            return
        except Exception:
            self._finish("failed", "YouTube could not be connected. Try again.")
            return
        self._finish("connected", "")

    def _finish(self, state: str, message: str) -> None:
        self.state = state
        self.message = message
        self.done.set()


# ---------------------------------------------------------------- metadata and results

@dataclass(frozen=True)
class VideoMetadata:
    """What a profile (MK8DX, later others) says about a clip. Generic on purpose."""

    title: str
    description: str = ""
    tags: tuple[str, ...] = ()
    category_id: str = "20"  # Gaming


def clean_metadata(metadata: VideoMetadata, fallback_title: str = "LiveTrial clip") -> VideoMetadata:
    """YouTube refuses ``<`` and ``>`` and titles over 100 characters."""
    title = _TITLE_FORBIDDEN.sub("", metadata.title or "").strip()[:100] or fallback_title
    description = _TITLE_FORBIDDEN.sub("", metadata.description or "").strip()[:4900]
    tags: list[str] = []
    for tag in metadata.tags:
        cleaned = _TITLE_FORBIDDEN.sub("", tag).strip()[:60]
        if cleaned and sum(len(item) + 1 for item in tags) + len(cleaned) < 450:
            tags.append(cleaned)
    return VideoMetadata(title, description, tuple(tags), metadata.category_id)


MAX_TITLE_CHARACTERS = 100
MAX_DESCRIPTION_BYTES = 5000
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def validate_upload_text(title: object, description: object) -> VideoMetadata:
    """The Player's title and description exactly as typed, or a readable refusal.

    Nothing is trimmed, shortened or replaced: text YouTube would refuse
    (``<``/``>``, a title over 100 characters, a description over 5000 bytes)
    is refused here so the Player can change it (owner 2026-09-29: "do not
    silently modify user-edited text before upload").
    """
    if not isinstance(title, str) or not title.strip():
        _fail("Enter a title for the video.", "invalid_metadata")
    if not isinstance(description, str):
        _fail("The description is not valid.", "invalid_metadata")
    if len(title) > MAX_TITLE_CHARACTERS:
        _fail(f"The title is {len(title)} characters; YouTube allows {MAX_TITLE_CHARACTERS}.", "invalid_metadata")
    if len(description.encode("utf-8")) > MAX_DESCRIPTION_BYTES:
        _fail(f"The description is too long for YouTube ({len(description.encode('utf-8'))} of "
              f"{MAX_DESCRIPTION_BYTES} bytes).", "invalid_metadata")
    if "<" in title or ">" in title or "<" in description or ">" in description:
        _fail("YouTube does not accept < or > in a title or description.", "invalid_metadata")
    if _CONTROL.search(title) or "\n" in title or "\r" in title or _CONTROL.search(description):
        _fail("The title or description contains characters YouTube does not accept.", "invalid_metadata")
    return VideoMetadata(title=title, description=description, tags=())


def video_url(video_id: object) -> str:
    """The evidence link the website accepts: exactly ``https://youtu.be/<id>``."""
    if not isinstance(video_id, str) or _VIDEO_ID.fullmatch(video_id) is None:
        _fail("YouTube did not return a video id.")
    return f"https://youtu.be/{video_id}"


def available_privacy_statuses() -> tuple[str, ...]:
    return AVAILABLE_PRIVACY_STATUSES


# ---------------------------------------------------------------- the client

def _json(response: TransportResponse) -> dict:
    try:
        document = json.loads(response.body.decode("utf-8")) if response.body else {}
    except (UnicodeDecodeError, ValueError):
        return {}
    return document if isinstance(document, dict) else {}


def _google_error_reason(document: dict) -> str:
    error = document.get("error")
    if isinstance(error, str):
        return error
    if isinstance(error, dict):
        errors = error.get("errors")
        if isinstance(errors, list) and errors and isinstance(errors[0], dict):
            reason = errors[0].get("reason")
            if isinstance(reason, str):
                return reason
    return ""


_UPLOAD_REFUSALS = {
    "quotaExceeded": "YouTube's daily upload allowance for LiveTrial is used up. Try again tomorrow.",
    "uploadLimitExceeded": "Your YouTube channel has reached its upload limit for now. Try again later.",
    "youtubeSignupRequired": "This Google account has no YouTube channel yet. Create one on youtube.com first.",
    "forbidden": "YouTube refused the upload for this account.",
    "insufficientPermissions": "YouTube refused the upload: connect YouTube again and allow uploads.",
    "invalidTitle": "YouTube refused the video's title.",
    "invalidDescription": "YouTube refused the video's description.",
}


class YouTubeClient:
    """Token exchange, refresh and the resumable upload, through ``transport``."""

    def __init__(self, oauth_client: OAuthClient, transport: YouTubeTransport | None = None,
                 now_ms: Callable[[], int] | None = None, sleep: Callable[[float], None] = time.sleep) -> None:
        self.oauth_client = oauth_client
        self._transport = transport or HttpsTransport()
        self._now_ms = now_ms or (lambda: time.time_ns() // 1_000_000)
        self._sleep = sleep

    # -- tokens --------------------------------------------------------------

    def _token_request(self, fields: dict) -> TransportResponse:
        body = parse.urlencode(fields).encode("ascii")
        try:
            return self._transport.request("POST", TOKEN_ENDPOINT, {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "Content-Length": str(len(body)),
            }, body)
        except LiveTrialYouTubeError:
            raise
        except Exception:
            _fail("Google could not be reached. Check the internet connection and try again.", "offline")

    def exchange_code(self, code: str, verifier: str, redirect_uri: str) -> dict:
        response = self._token_request({
            "code": code,
            "client_id": self.oauth_client.client_id,
            "client_secret": self.oauth_client.client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        })
        document = _json(response)
        refresh = document.get("refresh_token")
        access = document.get("access_token")
        expires = document.get("expires_in")
        if response.status != 200 or not isinstance(access, str) or not isinstance(refresh, str):
            _fail("Google did not complete the sign-in. Try again.")
        if UPLOAD_SCOPE not in str(document.get("scope") or UPLOAD_SCOPE).split():
            _fail("YouTube was not connected: the upload permission was not given.", "denied")
        return {"accessToken": access, "refreshToken": refresh,
                "expiresInSeconds": expires if isinstance(expires, int) and 0 < expires <= 86_400 else 3600}

    def access_token(self, store: YouTubeAuthorizationStore, force_refresh: bool = False) -> str:
        """A usable access token for this Player, refreshed when needed.

        When Google no longer accepts the refresh token (revoked, or older than
        seven days while the Google app is in Testing), the stored tokens are
        dropped and the Player is marked as needing to connect again.
        """
        stored = store.load()
        if stored is None:
            _fail("Connect YouTube first.", "not_connected")
        if stored.get("reconnectRequired"):
            _fail("Connect YouTube again: Google ended LiveTrial's access.", "reconnect_required")
        if stored.get("clientId") != self.oauth_client.client_id:
            store.save({"schemaVersion": AUTHORIZATION_SCHEMA_VERSION, "reconnectRequired": True,
                        "connectedAtMs": stored.get("connectedAtMs")})
            _fail("Connect YouTube again: LiveTrial's YouTube client changed.", "reconnect_required")
        if (not force_refresh and isinstance(stored.get("accessToken"), str)
                and stored.get("accessExpiresAtMs", 0) - REFRESH_MARGIN_MS > self._now_ms()):
            return stored["accessToken"]
        response = self._token_request({
            "client_id": self.oauth_client.client_id,
            "client_secret": self.oauth_client.client_secret,
            "refresh_token": stored["refreshToken"],
            "grant_type": "refresh_token",
        })
        document = _json(response)
        access = document.get("access_token")
        if response.status == 400 and _google_error_reason(document) in {"invalid_grant", "unauthorized_client"}:
            store.save({"schemaVersion": AUTHORIZATION_SCHEMA_VERSION, "reconnectRequired": True,
                        "connectedAtMs": stored.get("connectedAtMs")})
            _fail("Connect YouTube again: Google ended LiveTrial's access.", "reconnect_required")
        if response.status != 200 or not isinstance(access, str):
            _fail("Google could not refresh YouTube access right now. Try again later.", "offline")
        expires = document.get("expires_in")
        updated = dict(stored)
        updated["accessToken"] = access
        updated["accessExpiresAtMs"] = self._now_ms() + (expires if isinstance(expires, int) and 0 < expires <= 86_400 else 3600) * 1000
        if isinstance(document.get("refresh_token"), str):
            updated["refreshToken"] = document["refresh_token"]
        store.save(updated)
        return access

    # -- upload --------------------------------------------------------------

    def _authorized(self, method: str, url: str, headers: dict, body: bytes | None,
                    store: YouTubeAuthorizationStore, token: list[str]) -> TransportResponse:
        """One request with the current token; a 401 refreshes it once."""
        for attempt in range(2):
            try:
                response = self._transport.request(method, url, {**headers, "Authorization": f"Bearer {token[0]}"}, body)
            except LiveTrialYouTubeError:
                raise
            except Exception:
                raise ConnectionError() from None
            if response.status == 401 and attempt == 0:
                token[0] = self.access_token(store, force_refresh=True)
                continue
            return response
        return response  # pragma: no cover

    def upload(self, store: YouTubeAuthorizationStore, video: Path, metadata: VideoMetadata,
               privacy_status: str = "private",
               progress: Callable[[str, int, int], None] | None = None) -> str:
        """Upload one local video and answer its YouTube video id.

        The file is only ever opened for reading. ``progress`` receives
        ``(phase, sent_bytes, total_bytes)`` with phase ``preparing``,
        ``uploading`` or ``processing``.
        """
        report = progress or (lambda _phase, _sent, _total: None)
        if privacy_status not in PRIVACY_STATUSES:
            _fail("Choose Private, Unlisted or Public.")
        if privacy_status not in AVAILABLE_PRIVACY_STATUSES:
            _fail("Google allows LiveTrial to upload Private videos only for now.", "privacy_unavailable")
        try:
            total = video.stat().st_size
        except OSError:
            _fail("That clip is not on this PC any more.", "missing_clip")
        if not 0 < total <= MAX_UPLOAD_BYTES:
            _fail("That clip cannot be uploaded.", "missing_clip")
        report("preparing", 0, total)
        token = [self.access_token(store)]
        # Exactly what the Player approved: checked, never changed.
        checked = validate_upload_text(metadata.title, metadata.description)
        resource = json.dumps({
            "snippet": {"title": checked.title, "description": checked.description,
                        "categoryId": metadata.category_id},
            "status": {"privacyStatus": privacy_status, "selfDeclaredMadeForKids": False},
        }, ensure_ascii=False).encode("utf-8")
        try:
            started = self._authorized("POST", UPLOAD_ENDPOINT, {
                "Content-Type": "application/json; charset=UTF-8",
                "Content-Length": str(len(resource)),
                "X-Upload-Content-Length": str(total),
                "X-Upload-Content-Type": "video/mp4",
            }, resource, store, token)
        except ConnectionError:
            _fail("YouTube could not be reached. Check the internet connection and try again.", "offline")
        if started.status != 200:
            self._refused(started)
        session = started.headers.get("location", "")
        if not allowed_google_request("PUT", session):
            _fail("YouTube did not accept the upload. Try again later.")
        return self._send(store, token, session, video, total, report)

    def _refused(self, response: TransportResponse) -> None:
        reason = _google_error_reason(_json(response))
        if reason in _UPLOAD_REFUSALS:
            _fail(_UPLOAD_REFUSALS[reason], reason)
        if response.status == 401:
            _fail("Connect YouTube again: Google ended LiveTrial's access.", "reconnect_required")
        _fail("YouTube did not accept the upload. Try again later.")

    def _send(self, store: YouTubeAuthorizationStore, token: list[str], session: str, video: Path,
              total: int, report: Callable[[str, int, int], None]) -> str:
        offset = 0
        failures = 0
        with open(video, "rb") as handle:
            while True:
                try:
                    if failures:
                        # After a broken connection or a 5xx, ask where YouTube is.
                        response = self._authorized("PUT", session, {"Content-Length": "0",
                                                    "Content-Range": f"bytes */{total}"}, b"", store, token)
                    else:
                        handle.seek(offset)
                        chunk = handle.read(UPLOAD_CHUNK_BYTES)
                        last = offset + len(chunk) - 1
                        response = self._authorized("PUT", session, {
                            "Content-Length": str(len(chunk)),
                            "Content-Type": "video/mp4",
                            "Content-Range": f"bytes {offset}-{last}/{total}",
                        }, chunk, store, token)
                except ConnectionError:
                    response = None
                if response is None or response.status in (500, 502, 503, 504):
                    failures += 1
                    if failures > UPLOAD_RETRIES:
                        _fail("The upload stopped: YouTube could not be reached. Try again.", "offline")
                    self._sleep(min(2 ** failures, 30))
                    continue
                if response.status in (200, 201):
                    report("processing", total, total)
                    video_id = _json(response).get("id")
                    video_url(video_id)  # refuses anything that is not a YouTube video id
                    return video_id
                if response.status == 308:
                    failures = 0
                    received = re.fullmatch(r"bytes=0-(\d+)", response.headers.get("range", ""))
                    offset = int(received.group(1)) + 1 if received else 0
                    report("uploading", offset, total)
                    continue
                if response.status in (404, 410):
                    _fail("The upload expired on YouTube's side. Start it again.")
                self._refused(response)
