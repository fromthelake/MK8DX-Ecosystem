from __future__ import annotations

import ctypes
import json
import os
from ctypes import wintypes
from pathlib import Path
from .server import effective_origin, server_data_dir


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _blob(data: bytes) -> tuple[_Blob, ctypes.Array[ctypes.c_char]]:
    buffer = ctypes.create_string_buffer(data)
    return _Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))), buffer


def _protect(data: bytes) -> bytes:
    if os.name != "nt":
        return data
    source, keepalive = _blob(data)
    output = _Blob()
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(source), "MK8DX Tournament", None, None, None, 0,
        ctypes.byref(output),
    ):
        raise OSError("Windows credential protection failed")
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)
        del keepalive


def _unprotect(data: bytes) -> bytes:
    if os.name != "nt":
        return data
    source, keepalive = _blob(data)
    output = _Blob()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(source), None, None, None, None, 0, ctypes.byref(output),
    ):
        raise OSError("Windows credential recovery failed")
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)
        del keepalive


def data_dir() -> Path:
    target = server_data_dir()
    target.mkdir(parents=True, exist_ok=True)
    return target


class SessionStore:
    def __init__(self, path: Path | None = None) -> None:
        self._origin = effective_origin() if path is None else None
        self.path = path or data_dir() / "session.bin"

    def _check_origin(self) -> None:
        if self._origin is not None and self._origin != effective_origin():
            raise ValueError("Community server changed; reopen the Tournament tool")

    def save(self, access_token: str) -> None:
        self._check_origin()
        payload = json.dumps({"access_token": access_token}, separators=(",", ":")).encode()
        self.path.write_bytes(_protect(payload))
        if os.name != "nt":
            self.path.chmod(0o600)

    def load(self) -> str | None:
        self._check_origin()
        if not self.path.exists():
            return None
        value = json.loads(_unprotect(self.path.read_bytes()).decode())
        token = value.get("access_token")
        return token if isinstance(token, str) and token else None

    def clear(self) -> None:
        self._check_origin()
        self.path.unlink(missing_ok=True)
