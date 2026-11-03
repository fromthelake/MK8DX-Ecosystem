"""Exact HTTPS execution for LiveTrial authentication and canonical sync."""

from __future__ import annotations

import json
import os
import re
import ssl
import time
from pathlib import Path
from typing import Callable
from urllib import error, parse, request


DEVICE_CODE_PATH = "/api/auth/device/code"
DEVICE_TOKEN_PATH = "/api/auth/device/token"
# The v2 bootstrap names the Player (username + display name) so the account
# list can stop presenting raw canonical identifiers. The server keeps serving
# v1 for older installed builds.
NATIVE_BOOTSTRAP_PATH = "/v1/time-trial-submissions/native-bootstrap-v2"
SIGN_OUT_PATH = "/api/auth/sign-out"
CANONICAL_SUBMISSION_PATH = "/v1/time-trial-submissions"
ECOSYSTEM_BOOTSTRAP_PATH = "/v1/bootstrap"
PLAYER_INSIGHTS_PATH = "/v1/me/player-insights"
PLAYER_ACTIVITY_PATH = "/v1/me/player-activity"
APP_DOWNLOADS_PATH = "/v1/app-downloads"
# ADR-0209: approve the pending device code from the account's inbox.
EMAIL_APPROVAL_PATH = "/v1/native/device-authorization/email"
EMAIL_APPROVAL_VERIFY_PATH = "/v1/native/device-authorization/email/verify"
MAX_AUTH_RESPONSE_BYTES = 16 * 1024
MAX_CANONICAL_RESPONSE_BYTES = 4 * 1024
MAX_CANONICAL_REQUEST_BYTES = 64 * 1024
MAX_ECOSYSTEM_RESPONSE_BYTES = 3 * 1024 * 1024
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{20,255}$")
REFERENCE_GHOST_READING_PATH = "/v1/reference-ghost-readings"
_ALLOWED = {
    ("POST", DEVICE_CODE_PATH),
    ("POST", DEVICE_TOKEN_PATH),
    ("GET", NATIVE_BOOTSTRAP_PATH),
    ("POST", SIGN_OUT_PATH),
    ("POST", CANONICAL_SUBMISSION_PATH),
    ("GET", ECOSYSTEM_BOOTSTRAP_PATH),
    ("GET", APP_DOWNLOADS_PATH),
    ("GET", PLAYER_INSIGHTS_PATH),
    ("GET", PLAYER_ACTIVITY_PATH),
    ("POST", EMAIL_APPROVAL_PATH),
    ("POST", EMAIL_APPROVAL_VERIFY_PATH),
    # ADR-0212: a proven Nintendo staff or World Record ghost reading; signed-in only.
    ("POST", REFERENCE_GHOST_READING_PATH),
}


# ADR-0213: the optional YouTube upload talks to Google directly, never through
# the product API. Exactly three requests are allowed, each on one host and path:
# the OAuth token exchange/refresh, starting a resumable video upload, and
# sending that upload's bytes to the session address Google returned. The
# consent page itself opens in the person's browser and is never requested here.
GOOGLE_TOKEN_HOST = "oauth2.googleapis.com"
GOOGLE_TOKEN_PATH = "/token"
YOUTUBE_UPLOAD_HOST = "www.googleapis.com"
YOUTUBE_UPLOAD_PATH = "/upload/youtube/v3/videos"


def allowed_google_request(method: object, url: object) -> bool:
    """True only for the three Google requests the YouTube integration makes."""
    if not isinstance(method, str) or not isinstance(url, str) or len(url) > 4096:
        return False
    try:
        parsed = parse.urlsplit(url)
        port = parsed.port
        query = parse.parse_qs(parsed.query, keep_blank_values=True, strict_parsing=bool(parsed.query))
    except (TypeError, ValueError):
        return False
    if (parsed.scheme != "https" or port not in (None, 443) or parsed.username is not None
            or parsed.password is not None or parsed.fragment):
        return False
    if method == "POST" and parsed.hostname == GOOGLE_TOKEN_HOST:
        return parsed.path == GOOGLE_TOKEN_PATH and not query
    if parsed.hostname != YOUTUBE_UPLOAD_HOST or parsed.path != YOUTUBE_UPLOAD_PATH:
        return False
    if query.get("uploadType") != ["resumable"]:
        return False
    if method == "POST":
        return set(query) == {"uploadType", "part"} and query["part"] == ["snippet,status"]
    if method == "PUT":
        # The session address Google hands back: the same path with its upload_id.
        upload_id = query.get("upload_id")
        return (set(query) <= {"uploadType", "part", "upload_id"} and upload_id is not None
                and len(upload_id) == 1 and re.fullmatch(r"[A-Za-z0-9_-]{8,1024}", upload_id[0]) is not None
                and query.get("part", ["snippet,status"]) == ["snippet,status"])
    return False


# ADR-0210 rule 10: fill in what the account's own published result lacks.
_COMPLETION_PATH = re.compile(
    r"/v1/time-trial-submissions/user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}/completions")


def _is_completion(method: object, path: object) -> bool:
    return method == "POST" and isinstance(path, str) and _COMPLETION_PATH.fullmatch(path) is not None


def _allowed_public_get(path: object) -> bool:
    if path == "/v1/public/world-records":
        return True
    if not isinstance(path, str) or len(path) > 1024:
        return False
    try:
        parsed = parse.urlsplit(path)
        if parsed.scheme or parsed.netloc or parsed.fragment:
            return False
        query = parse.parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
        if parsed.path == "/v1/public/time-trial-standings":
            return query in ({"mode": ["150"]}, {"mode": ["200"]})
        if parsed.path == "/v1/public/player-directory":
            return set(query) == {"query"} and len(query["query"]) == 1 and 2 <= len(query["query"][0]) <= 64
        if not query and re.fullmatch(r"/v1/players/player\.[a-z0-9]+(?:[._-][a-z0-9]+)*", parsed.path):
            return True
        if not query and re.fullmatch(
            r"/v1/public/players/player\.[a-z0-9]+(?:[._-][a-z0-9]+)*/(?:time-trials|rating-history)", parsed.path,
        ):
            return True
        if parsed.path == "/v1/public/track-bests" and set(query) == {"players"} and len(query["players"]) == 1:
            players = query["players"][0].split(",")
            return 1 <= len(players) <= 10 and len(players) == len(set(players)) and all(
                re.fullmatch(r"player\.[a-z0-9]+(?:[._-][a-z0-9]+)*", player) is not None
                for player in players
            )
    except (TypeError, ValueError):
        return False
    return False


class LiveTrialHttpsError(RuntimeError):
    """Bounded HTTPS/configuration failure."""


def _fail() -> None:
    raise LiveTrialHttpsError("LiveTrial HTTPS request failed.") from None


class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def exact_https_origin(value: str) -> str:
    """Accept HTTPS, plus plain HTTP only for this PC's loopback website.

    Local Docker and XAMPP installations deliberately use a loopback URL. It
    cannot be sent to another computer; every other client origin needs TLS.
    """
    try:
        parsed = parse.urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError):
        _fail()
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 2048
        or (parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname.lower() in {"127.0.0.1", "localhost"}
        ))
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or (port is not None and not 1 <= port <= 65535)
    ):
        _fail()
    hostname = parsed.hostname.lower()
    authority = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None:
        authority = f"{authority}:{port}"
    return f"{parsed.scheme}://{authority}"


def _default_handlers() -> tuple:
    """
    Ordinary system trust, unless a certificate is deliberately configured.

    `MK8DX_LIVETRIAL_CA_CERTIFICATE` mirrors the Tournament connected client's
    existing `MK8DX_TOURNAMENT_CA_CERTIFICATE`: it exists so a disposable local
    QA mirror, which can only offer a self-signed loopback certificate, can be
    reached without turning verification off anywhere. Absent - which is every
    installed copy - nothing changes and system trust applies.
    """
    certificate = os.environ.get("MK8DX_LIVETRIAL_CA_CERTIFICATE", "").strip()
    if not certificate:
        return ()
    path = Path(certificate)
    if not path.is_file():
        raise ValueError("Configured LiveTrial CA certificate was not found")
    return (request.HTTPSHandler(context=ssl.create_default_context(cafile=str(path))),)


class LiveTrialHttpsExecutor:
    """Execute fixed MK8DX requests with bounded bodies and exact origins."""

    def __init__(
        self,
        origin: str,
        opener=None,
        timeout_seconds: float = 15.0,
    ) -> None:
        self.origin = exact_https_origin(origin)
        if (
            not isinstance(timeout_seconds, (int, float))
            or isinstance(timeout_seconds, bool)
            or not 0.1 <= timeout_seconds <= 60.0
        ):
            _fail()
        self._timeout = float(timeout_seconds)
        self._opener = opener or request.build_opener(
            *_default_handlers(), _NoRedirect(),
        )
        if not callable(getattr(self._opener, "open", None)):
            _fail()

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None,
        bearer_token: str | None = None,
        response_max_bytes: int = MAX_AUTH_RESPONSE_BYTES,
    ) -> dict:
        if (
            (method, path) not in _ALLOWED and not (method == "GET" and _allowed_public_get(path))
            and not _is_completion(method, path)
            or _is_completion(method, path) and bearer_token is None
            or (method == "GET") != (body is None)
            or body is not None
            and (not isinstance(body, bytes) or not 2 <= len(body) <= MAX_CANONICAL_REQUEST_BYTES)
            or bearer_token is not None
            and (
                not isinstance(bearer_token, str)
                or _TOKEN.fullmatch(bearer_token) is None
            )
            or path in {
                NATIVE_BOOTSTRAP_PATH,
                SIGN_OUT_PATH,
                CANONICAL_SUBMISSION_PATH,
                ECOSYSTEM_BOOTSTRAP_PATH,
                PLAYER_INSIGHTS_PATH,
                PLAYER_ACTIVITY_PATH,
                REFERENCE_GHOST_READING_PATH,
            }
            and bearer_token is None
            or path in {DEVICE_CODE_PATH, DEVICE_TOKEN_PATH, EMAIL_APPROVAL_PATH, EMAIL_APPROVAL_VERIFY_PATH}
            and bearer_token is not None
            or response_max_bytes not in {
                MAX_AUTH_RESPONSE_BYTES,
                MAX_CANONICAL_RESPONSE_BYTES,
                MAX_ECOSYSTEM_RESPONSE_BYTES,
            }
        ):
            _fail()
        target = f"{self.origin}{path}"
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        if bearer_token is not None:
            headers["Authorization"] = f"Bearer {bearer_token}"
        outbound = request.Request(target, data=body, headers=headers, method=method)
        try:
            response = self._opener.open(outbound, timeout=self._timeout)
            return self._read_response(response, target, response_max_bytes)
        except error.HTTPError as response:
            return self._read_response(response, target, response_max_bytes)
        except Exception:
            _fail()

    @staticmethod
    def _read_response(response, target: str, maximum: int) -> dict:
        try:
            if response.geturl() != target:
                _fail()
            payload = response.read(maximum + 1)
            status = int(response.status)
            content_type = response.headers.get("Content-Type")
        except LiveTrialHttpsError:
            raise
        except Exception:
            _fail()
        finally:
            try:
                response.close()
            except Exception:
                pass
        if len(payload) > maximum or not 100 <= status <= 599:
            _fail()
        return {
            "statusCode": status,
            "contentType": content_type,
            "body": payload,
        }


class LiveTrialStoredSessionRequestExecutor:
    """Inject one current protected bearer into canonical-only synchronization."""

    def __init__(
        self,
        https: LiveTrialHttpsExecutor,
        session_store,
        clock_ms: Callable[[], int] = lambda: time.time_ns() // 1_000_000,
    ) -> None:
        if not callable(clock_ms) or not callable(getattr(session_store, "load", None)):
            _fail()
        self._https = https
        self._session_store = session_store
        self._clock_ms = clock_ms

    def execute(self, path: str, headers: dict[str, str], body: bytes) -> dict:
        if (
            path != CANONICAL_SUBMISSION_PATH
            or headers
            != {
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8",
            }
            or not isinstance(body, bytes)
            or not 2 <= len(body) <= MAX_CANONICAL_REQUEST_BYTES
        ):
            _fail()
        session = self._session_store.load(self._clock_ms())
        if session is None:
            _fail()
        response = self._https.request(
            "POST",
            path,
            body,
            session["bearerToken"],
            MAX_CANONICAL_RESPONSE_BYTES,
        )
        return {"statusCode": response["statusCode"], "body": response["body"]}


def compact_json(document: object) -> bytes:
    try:
        return json.dumps(
            document,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        _fail()
