"""OS-protected LiveTrial native authentication session storage."""

from __future__ import annotations

import base64
import ctypes
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Callable


SESSION_SCHEMA_VERSION = "mk8dx.livetrial-native-session.v1"
MAX_SESSION_FILE_BYTES = 16 * 1024
MAX_TIMESTAMP_MS = 253_402_300_799_999
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{20,255}$")
_PLAYER = re.compile(r"^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")
_USERNAME = re.compile(r"^[a-z0-9_-]{3,16}$")
_REQUIRED_SESSION_KEYS = {"schemaVersion", "bearerToken", "expiresAtMs", "playerId"}
# Sessions written by 3.11.0 and earlier carry only the required keys; the
# v2-bootstrap identity is optional so those stored sessions keep loading.
_OPTIONAL_SESSION_KEYS = {"username", "displayName"}


def _valid_display_name(value: object) -> bool:
    return (
        isinstance(value, str)
        and 1 <= len(value) <= 64
        and not any(ord(char) < 0x20 or ord(char) == 0x7F for char in value)
    )
_ENTROPY = b"mk8dx.livetrial.auth-session.v1"
_DPAPI_UI_FORBIDDEN = 0x1


class LiveTrialSessionError(RuntimeError):
    """Bounded protected-session failure."""


def _fail() -> None:
    raise LiveTrialSessionError("LiveTrial authentication session is unavailable.") from None


def parse_native_session(document: object, now_ms: int | None = None) -> dict:
    if (
        not isinstance(document, dict)
        or not _REQUIRED_SESSION_KEYS
        <= set(document)
        <= _REQUIRED_SESSION_KEYS | _OPTIONAL_SESSION_KEYS
        or ("username" in document and (
            not isinstance(document["username"], str)
            or _USERNAME.fullmatch(document["username"]) is None
        ))
        or ("displayName" in document and not _valid_display_name(document["displayName"]))
        or document.get("schemaVersion") != SESSION_SCHEMA_VERSION
        or not isinstance(document.get("bearerToken"), str)
        or _TOKEN.fullmatch(document["bearerToken"]) is None
        or not isinstance(document.get("expiresAtMs"), int)
        or isinstance(document["expiresAtMs"], bool)
        or not 1 <= document["expiresAtMs"] <= MAX_TIMESTAMP_MS
        or not isinstance(document.get("playerId"), str)
        or len(document["playerId"]) > 135
        or _PLAYER.fullmatch(document["playerId"]) is None
        or (
            now_ms is not None
            and (
                not isinstance(now_ms, int)
                or isinstance(now_ms, bool)
                or now_ms < 0
                or document["expiresAtMs"] <= now_ms
            )
        )
    ):
        _fail()
    return dict(document)


class LiveTrialProtectedSessionStore:
    """Persist one replaceable session only through an injected OS protector."""

    def __init__(
        self,
        path: str | Path,
        protect: Callable[[bytes], bytes],
        unprotect: Callable[[bytes], bytes],
    ) -> None:
        if not callable(protect) or not callable(unprotect):
            _fail()
        self._path = Path(path)
        self._protect = protect
        self._unprotect = unprotect

    def load(self, now_ms: int) -> dict | None:
        if not isinstance(now_ms, int) or isinstance(now_ms, bool) or now_ms < 0:
            _fail()
        try:
            if not self._path.exists():
                return None
            if self._path.is_symlink() or not self._path.is_file():
                _fail()
            payload = self._path.read_bytes()
            if not payload or len(payload) > MAX_SESSION_FILE_BYTES:
                _fail()
            protected = base64.b64decode(payload, validate=True)
            plaintext = self._unprotect(protected)
            if not isinstance(plaintext, bytes) or not plaintext:
                _fail()
            document = json.loads(plaintext.decode("utf-8"))
            return parse_native_session(document, now_ms)
        except LiveTrialSessionError:
            self._remove_invalid()
            return None
        except Exception:
            self._remove_invalid()
            return None

    def save(self, session: object) -> None:
        parsed = parse_native_session(session)
        try:
            plaintext = json.dumps(
                parsed,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
            protected = self._protect(plaintext)
            if not isinstance(protected, bytes) or not protected:
                _fail()
            payload = base64.b64encode(protected)
            if len(payload) > MAX_SESSION_FILE_BYTES:
                _fail()
            self._path.parent.mkdir(parents=True, exist_ok=True)
            if self._path.parent.is_symlink() or not self._path.parent.is_dir():
                _fail()
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{self._path.name}.",
                suffix=".tmp",
                dir=self._path.parent,
            )
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
        except LiveTrialSessionError:
            raise
        except Exception:
            _fail()

    def clear(self) -> None:
        try:
            self._path.unlink(missing_ok=True)
        except OSError:
            _fail()

    def _remove_invalid(self) -> None:
        try:
            self._path.unlink(missing_ok=True)
        except OSError:
            pass


# ctypes.wintypes only exists on Windows. The protected store above is portable
# and the modules that merely import it must not fail elsewhere, so the DPAPI
# structure is defined only where DPAPI itself can be used.
if os.name == "nt":  # pragma: no branch - platform selection
    from ctypes import wintypes

    class _DataBlob(ctypes.Structure):
        _fields_ = [
            ("cbData", wintypes.DWORD),
            ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
        ]


def _blob(payload: bytes) -> tuple[_DataBlob, object]:
    buffer = ctypes.create_string_buffer(payload, len(payload))
    return (
        _DataBlob(len(payload), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))),
        buffer,
    )


class WindowsDpapiProtector:
    """Delegate session protection to Windows DPAPI for the current user."""

    def __init__(self) -> None:
        if os.name != "nt" or not hasattr(ctypes, "windll"):
            _fail()
        self._crypt32 = ctypes.windll.crypt32
        self._kernel32 = ctypes.windll.kernel32

    def protect(self, plaintext: bytes) -> bytes:
        if not isinstance(plaintext, bytes) or not plaintext:
            _fail()
        input_blob, input_buffer = _blob(plaintext)
        entropy_blob, entropy_buffer = _blob(_ENTROPY)
        output_blob = _DataBlob()
        try:
            success = self._crypt32.CryptProtectData(
                ctypes.byref(input_blob),
                "MK8DX LiveTrial session",
                ctypes.byref(entropy_blob),
                None,
                None,
                _DPAPI_UI_FORBIDDEN,
                ctypes.byref(output_blob),
            )
            if not success:
                _fail()
            return ctypes.string_at(output_blob.pbData, output_blob.cbData)
        finally:
            _ = input_buffer, entropy_buffer
            if output_blob.pbData:
                self._kernel32.LocalFree(output_blob.pbData)

    def unprotect(self, protected: bytes) -> bytes:
        if not isinstance(protected, bytes) or not protected:
            _fail()
        input_blob, input_buffer = _blob(protected)
        entropy_blob, entropy_buffer = _blob(_ENTROPY)
        output_blob = _DataBlob()
        description = ctypes.c_void_p()
        try:
            success = self._crypt32.CryptUnprotectData(
                ctypes.byref(input_blob),
                ctypes.byref(description),
                ctypes.byref(entropy_blob),
                None,
                None,
                _DPAPI_UI_FORBIDDEN,
                ctypes.byref(output_blob),
            )
            if not success:
                _fail()
            return ctypes.string_at(output_blob.pbData, output_blob.cbData)
        finally:
            _ = input_buffer, entropy_buffer
            if output_blob.pbData:
                self._kernel32.LocalFree(output_blob.pbData)
            if description.value:
                self._kernel32.LocalFree(description)


def create_windows_session_store(path: str | Path) -> LiveTrialProtectedSessionStore:
    protector = WindowsDpapiProtector()
    return LiveTrialProtectedSessionStore(path, protector.protect, protector.unprotect)
