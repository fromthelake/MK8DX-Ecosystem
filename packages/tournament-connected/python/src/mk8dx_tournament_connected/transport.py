"""Exact-origin JSON transport for the optional Tournament connection.

Every request goes to one validated community origin that is fixed before the
request is made. Redirects are never followed: an answer with a 3xx status is a
refused request, so a bearer token, a device code or a request body is never
sent to another host, port or scheme, and a POST is never silently repeated.
Response bodies are read with a byte bound (also when the server streams them
in chunks) and with an overall time bound, and a success must be a JSON object
with a JSON content type.

HTTPS uses the normal system trust, or the certificate named by
``MK8DX_TOURNAMENT_CA_CERTIFICATE`` (a local QA mirror); verification is never
turned off. Plain HTTP is accepted only for a website on this PC
(``http://127.0.0.1:<port>`` or ``http://localhost:<port>``), see
``server.exact_origin``.
"""
from __future__ import annotations

import http.client
import json
import os
import re
import ssl
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .server import exact_origin


MAX_AUTH_RESPONSE_BYTES = 16 * 1024
MAX_ERROR_RESPONSE_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
# The administrator's incoming-results list and the own evidence-record list
# carry complete race documents; they are bounded too, just higher.
MAX_LIST_RESPONSE_BYTES = 64 * 1024 * 1024
TIMEOUT_SECONDS = 20.0
TOTAL_READ_SECONDS = 120.0
_READ_CHUNK = 64 * 1024
_JSON_TYPE = re.compile(r"application/(?:[a-z0-9.+-]+\+)?json(?:\s*;.*)?", re.IGNORECASE)
_PATH = re.compile(r"/[A-Za-z0-9._~%!$&'()*+,;=:@/-]*")

DEVICE_CODE_PATH = "/api/auth/device/code"
DEVICE_TOKEN_PATH = "/api/auth/device/token"
SIGN_OUT_PATH = "/api/auth/sign-out"
_UNAUTHENTICATED_PATHS = frozenset({DEVICE_CODE_PATH, DEVICE_TOKEN_PATH})


class TransportError(RuntimeError):
    """A bounded transport failure. ``status`` is the HTTP status when one was received."""

    def __init__(self, message: str, *, status: int | None = None,
                 document: dict[str, Any] | None = None, retry_after: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.document = document if document is not None else {}
        self.retry_after = retry_after


@dataclass(frozen=True)
class Origin:
    """One exact community origin: scheme, lower-case host and effective port."""

    value: str
    scheme: str
    host: str
    port: int

    @classmethod
    def parse(cls, value: str) -> "Origin":
        exact = exact_origin(value)
        parsed = urlsplit(exact)
        host = (parsed.hostname or "").lower()
        port = parsed.port if parsed.port is not None else 443
        authority = f"[{host}]" if ":" in host else host
        if parsed.port is not None:
            authority = f"{authority}:{parsed.port}"
        return cls(f"{parsed.scheme}://{authority}", parsed.scheme, host, port)

    @property
    def display_host(self) -> str:
        """The host a person should recognise in the browser address bar."""
        default = (self.scheme == "https" and self.port == 443)
        return self.host if default else f"{self.host}:{self.port}"

    def same_origin(self, url: str) -> bool:
        try:
            parsed = urlsplit(url)
            port = parsed.port
        except (TypeError, ValueError):
            return False
        if parsed.scheme != self.scheme or not parsed.hostname:
            return False
        effective = port if port is not None else (443 if parsed.scheme == "https" else 80)
        return parsed.hostname.lower() == self.host and effective == self.port


class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect; urllib then reports the 3xx answer as an HTTPError."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401 - urllib hook
        return None


def tls_context() -> ssl.SSLContext | None:
    certificate = os.environ.get("MK8DX_TOURNAMENT_CA_CERTIFICATE")
    if not certificate:
        return None
    path = Path(certificate)
    if not path.is_file():
        raise TransportError("Configured Tournament Manager CA certificate was not found")
    return ssl.create_default_context(cafile=str(path))


def _opener() -> urllib.request.OpenerDirector:
    context = tls_context()
    handlers: list[Any] = [_RefuseRedirect()]
    if context is not None:
        handlers.insert(0, urllib.request.HTTPSHandler(context=context))
    return urllib.request.build_opener(*handlers)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def _reject_constant(_value: str) -> Any:
    raise ValueError("non-finite number")


def parse_json_object(payload: bytes) -> dict[str, Any]:
    value = json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_object,
                       parse_constant=_reject_constant)
    if not isinstance(value, dict):
        raise ValueError("not a JSON object")
    return value


def _read_bounded(response: Any, maximum: int) -> bytes:
    """Read at most ``maximum`` bytes; more (declared or streamed) is a refusal."""
    declared = response.headers.get("Content-Length") if response.headers is not None else None
    if declared is not None:
        try:
            if int(declared) > maximum:
                raise TransportError("The server answer is too large")
        except ValueError:
            raise TransportError("The server answer is malformed") from None
    deadline = time.monotonic() + TOTAL_READ_SECONDS
    parts: list[bytes] = []
    size = 0
    while True:
        if time.monotonic() > deadline:
            raise TransportError("The server answer took too long")
        part = response.read(min(_READ_CHUNK, maximum + 1 - size))
        if not part:
            return b"".join(parts)
        parts.append(part)
        size += len(part)
        if size > maximum:
            raise TransportError("The server answer is too large")


def safe_server_message(document: dict[str, Any]) -> str:
    """A short, printable server message, or an empty string."""
    message = document.get("message")
    if not isinstance(message, str):
        return ""
    message = message.strip()
    if not message or len(message) > 300 or any(
        unicodedata.category(character).startswith("C") for character in message
    ):
        return ""
    return message


def request_json(
    origin: Origin,
    path: str,
    *,
    body: object | None = None,
    token: str | None = None,
    max_bytes: int = MAX_RESPONSE_BYTES,
    opener: urllib.request.OpenerDirector | None = None,
) -> dict[str, Any]:
    """POST (with ``body``) or GET one fixed path on ``origin``; return the JSON object.

    Raises TransportError for a refused redirect, an HTTP error status (with the
    bounded error document), an oversized/slow/malformed answer or a network
    failure. Nothing is retried here.
    """
    if not isinstance(origin, Origin):
        raise TransportError("No validated community website address")
    if (not isinstance(path, str) or len(path) > 2048 or not path.isascii()
            or _PATH.fullmatch(path) is None or path.startswith("//")):
        raise TransportError("Invalid request path")
    if token is not None and (path in _UNAUTHENTICATED_PATHS or not isinstance(token, str)
                              or not token or any(c in token for c in "\r\n")):
        raise TransportError("Invalid request credentials")
    if not 1 <= max_bytes <= MAX_LIST_RESPONSE_BYTES:
        raise TransportError("Invalid response bound")
    target = f"{origin.value}{path}"
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, separators=(",", ":")).encode()
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    outbound = urllib.request.Request(target, data=data, headers=headers,
                                      method="POST" if body is not None else "GET")
    try:
        response = (opener or _opener()).open(outbound, timeout=TIMEOUT_SECONDS)
    except urllib.error.HTTPError as error:
        try:
            status = int(error.code)
            if 300 <= status <= 399:
                raise TransportError("The server answered with a redirect; it was not followed",
                                     status=status) from None
            document: dict[str, Any] = {}
            content_type = error.headers.get("Content-Type", "") if error.headers is not None else ""
            if _JSON_TYPE.fullmatch(content_type or ""):
                try:
                    document = parse_json_object(_read_bounded(error, MAX_ERROR_RESPONSE_BYTES))
                except (TransportError, ValueError, UnicodeError, OSError):
                    document = {}
            retry_after = error.headers.get("Retry-After") if error.headers is not None else None
            raise TransportError(safe_server_message(document) or f"Server returned HTTP {status}",
                                 status=status, document=document, retry_after=retry_after) from None
        finally:
            error.close()
    except TransportError:
        raise
    except (OSError, ValueError, http.client.HTTPException) as error:
        raise TransportError(f"Connection unavailable: {type(error).__name__}") from None
    try:
        if response.geturl() != target:
            raise TransportError("The server answer came from another address")
        status = int(response.status)
        if not 200 <= status <= 299:
            raise TransportError(f"Server returned HTTP {status}", status=status)
        content_type = response.headers.get("Content-Type", "")
        if not _JSON_TYPE.fullmatch(content_type or ""):
            raise TransportError("The server answer is not JSON", status=status)
        payload = _read_bounded(response, max_bytes)
        try:
            return parse_json_object(payload)
        except (ValueError, UnicodeError):
            raise TransportError("The server answer is malformed", status=status) from None
    except TransportError:
        raise
    except (OSError, ValueError, http.client.HTTPException) as error:
        raise TransportError(f"Connection unavailable: {type(error).__name__}") from None
    finally:
        response.close()
