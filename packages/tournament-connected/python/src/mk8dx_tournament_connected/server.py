"""One public Tournament Manager server choice; tokens and queues stay per origin."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


OWNER_ORIGIN = "https://example.invalid"


def base_dir() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share"))
    return base / "MK8DX" / "TournamentTools"


def exact_origin(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Use one exact community website address")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError):
        raise ValueError("Use one exact community website address") from None
    loopback = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
    if (not value.isascii() or value.endswith("/") or
            not parsed.hostname or parsed.username or parsed.password or parsed.path or
            parsed.query or parsed.fragment or
            not ((parsed.scheme == "https" and port is None) or
                 (loopback and port is not None and 1 <= port <= 65535))):
        raise ValueError("Use HTTPS, or HTTP on this PC only, without a final slash or path")
    return value


def selected_origin() -> str | None:
    path = base_dir() / "server.json"
    try:
        if path.is_symlink() or path.stat().st_size > 1024:
            return None
        document = json.loads(path.read_text(encoding="utf-8"))
        return exact_origin(document["origin"]) if document.get("schemaVersion") == "mk8dx.tournament-server.v1" else None
    except (OSError, KeyError, ValueError, UnicodeError, json.JSONDecodeError):
        return None


def effective_origin() -> str:
    return os.environ.get("MK8DX_TOURNAMENT_API_ORIGIN") or selected_origin() or OWNER_ORIGIN


def save_origin(value: str) -> None:
    value = exact_origin(value)
    root = base_dir()
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink():
        raise ValueError("Tournament settings path is a link")
    path = root / "server.json"
    if path.is_symlink():
        raise ValueError("Tournament server setting is a link")
    descriptor, name = tempfile.mkstemp(prefix=".server.", suffix=".tmp", dir=root)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump({"schemaVersion": "mk8dx.tournament-server.v1", "origin": value}, stream)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def server_data_dir() -> Path:
    origin = effective_origin()
    if origin == OWNER_ORIGIN:
        return base_dir()
    exact_origin(origin)
    marker = hashlib.sha256(origin.encode("ascii")).hexdigest()[:24]
    return base_dir() / "servers" / marker
