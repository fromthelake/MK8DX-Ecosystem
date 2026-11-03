"""Small non-secret LiveTrial product settings.

Settings live beside the local profile and outbox, but never contain account
credentials or private evidence. An unreadable or unknown document safely
falls back to the product defaults.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from livetrial_languages import CODES as LANGUAGE_CODES
import tempfile
import hashlib
from urllib.parse import urlsplit


SETTINGS_SCHEMA_VERSION = "mk8dx.livetrial-settings.v4"
V3_SETTINGS_SCHEMA_VERSION = "mk8dx.livetrial-settings.v3"
V2_SETTINGS_SCHEMA_VERSION = "mk8dx.livetrial-settings.v2"
LEGACY_SETTINGS_SCHEMA_VERSION = "mk8dx.livetrial-settings.v1"
_KEYS = {"schemaVersion", "autoSyncCompletedRuns", "language", "captureDevice", "consoleLanguage"}
_V3_KEYS = _KEYS - {"consoleLanguage"}
# The Switch's system language, which Mario Kart 8 Deluxe follows: "auto"
# detects it at the start of each capture or analysis (the engine's
# consolelang.py), any other value is the player's choice and is kept. The
# codes and labels are Clean Assets' `consoleLanguages` (the console's own
# list and wording, in its order).
CONSOLE_LANGUAGE_AUTO = "auto"
CONSOLE_LANGUAGES = (
    ("en", "English"), ("fr", "Français"), ("de", "Deutsch"), ("es", "Español"),
    ("it", "Italiano"), ("nl", "Nederlands"), ("pt", "Português"), ("ru", "Русский"),
    ("ja", "日本語"), ("zh-tw", "繁體中文"), ("zh-cn", "简体中文"), ("ko", "한국어"),
)
_CONSOLE_CODES = {CONSOLE_LANGUAGE_AUTO} | {code for code, _label in CONSOLE_LANGUAGES}
MAX_CAPTURE_DEVICE_CHARACTERS = 300
SETTINGS_FILE_NAME = "settings.json"
MAX_SETTINGS_BYTES = 8 * 1024
SERVER_FILE_NAME = "server.json"


def read_server_origin(base_root: str | Path) -> str | None:
    path = Path(base_root) / SERVER_FILE_NAME
    try:
        if path.is_symlink() or path.stat().st_size > 1024:
            return None
        document = json.loads(path.read_text(encoding="utf-8"))
        value = document.get("origin")
        return valid_server_origin(value) if document.get("schemaVersion") == "mk8dx.livetrial-server.v1" else None
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError):
        return None


def valid_server_origin(value: object) -> str:
    if not isinstance(value, str) or not value.isascii() or value.endswith("/"):
        raise ValueError("Enter one exact HTTPS website address without a final slash.")
    parsed = urlsplit(value)
    if (not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or
            (parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}))):
        raise ValueError("Enter one exact HTTPS website address; HTTP is allowed only on this PC.")
    return value


def write_server_origin(base_root: str | Path, origin: str) -> None:
    origin = valid_server_origin(origin)
    root = Path(base_root)
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink():
        raise LiveTrialSettingsError("Server settings are unavailable.")
    path = root / SERVER_FILE_NAME
    if path.is_symlink():
        raise LiveTrialSettingsError("Server settings are unavailable.")
    descriptor, name = tempfile.mkstemp(prefix=".server.", suffix=".tmp", dir=root)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump({"schemaVersion": "mk8dx.livetrial-server.v1", "origin": origin}, stream)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def server_data_root(base_root: str | Path, origin: str | None) -> Path:
    if origin is None:
        return Path(base_root)
    return Path(base_root) / "servers" / hashlib.sha256(origin.encode("ascii")).hexdigest()[:24]


class LiveTrialSettingsError(RuntimeError):
    """Bounded local-settings failure without private path detail."""


def default_settings() -> dict:
    return {
        "schemaVersion": SETTINGS_SCHEMA_VERSION,
        "autoSyncCompletedRuns": False,
        "language": "en",
        # The DirectShow name (or unique alternative name) of the capture
        # card chosen last time; None until a person has picked one.
        "captureDevice": None,
        "consoleLanguage": CONSOLE_LANGUAGE_AUTO,
    }


def _valid_capture_device(value: object) -> bool:
    return value is None or (
        isinstance(value, str)
        and 1 <= len(value) <= MAX_CAPTURE_DEVICE_CHARACTERS
        and "\n" not in value
    )


def read_settings(product_root: str | Path) -> dict:
    path = Path(product_root) / SETTINGS_FILE_NAME
    try:
        if not path.exists() or path.is_symlink() or not path.is_file():
            return default_settings()
        payload = path.read_bytes()
        if not payload or len(payload) > MAX_SETTINGS_BYTES:
            return default_settings()
        document = json.loads(payload.decode("utf-8"))
        if not isinstance(document, dict):
            return default_settings()
        if (
            document.get("schemaVersion") == LEGACY_SETTINGS_SCHEMA_VERSION
            and set(document) == {"schemaVersion", "autoSyncCompletedRuns"}
            and isinstance(document.get("autoSyncCompletedRuns"), bool)
        ):
            migrated = default_settings()
            migrated["autoSyncCompletedRuns"] = document["autoSyncCompletedRuns"]
            return migrated
        if (
            document.get("schemaVersion") == V2_SETTINGS_SCHEMA_VERSION
            and set(document) == {"schemaVersion", "autoSyncCompletedRuns", "language"}
            and isinstance(document.get("autoSyncCompletedRuns"), bool)
            and document.get("language") in LANGUAGE_CODES
        ):
            migrated = default_settings()
            migrated["autoSyncCompletedRuns"] = document["autoSyncCompletedRuns"]
            migrated["language"] = document["language"]
            return migrated
        if (
            document.get("schemaVersion") == V3_SETTINGS_SCHEMA_VERSION
            and set(document) == _V3_KEYS
            and isinstance(document.get("autoSyncCompletedRuns"), bool)
            and document.get("language") in LANGUAGE_CODES
            and _valid_capture_device(document.get("captureDevice"))
        ):
            migrated = default_settings()
            for key in ("autoSyncCompletedRuns", "language", "captureDevice"):
                migrated[key] = document[key]
            return migrated
        if not _valid_document(document):
            return default_settings()
        return dict(document)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return default_settings()


def _valid_document(document: dict) -> bool:
    return (
        set(document) == _KEYS
        and document.get("schemaVersion") == SETTINGS_SCHEMA_VERSION
        and isinstance(document.get("autoSyncCompletedRuns"), bool)
        and document.get("language") in LANGUAGE_CODES
        and _valid_capture_device(document.get("captureDevice"))
        and document.get("consoleLanguage") in _CONSOLE_CODES
    )


def _write_settings(product_root: str | Path, document: dict) -> dict:
    if not _valid_document(document):
        raise LiveTrialSettingsError("LiveTrial settings are unavailable.") from None
    path = Path(product_root) / SETTINGS_FILE_NAME
    temporary: Path | None = None
    try:
        payload = json.dumps(
            document,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.parent.is_symlink() or not path.parent.is_dir():
            raise OSError
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
        )
        temporary = Path(temporary_name)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            temporary.chmod(0o600)
        except OSError:
            pass
        os.replace(temporary, path)
        temporary = None
        return document
    except (OSError, TypeError, ValueError, UnicodeError):
        raise LiveTrialSettingsError("LiveTrial settings are unavailable.") from None
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except OSError:
                pass


def write_auto_sync(product_root: str | Path, enabled: bool) -> dict:
    if not isinstance(enabled, bool):
        raise LiveTrialSettingsError("LiveTrial settings are unavailable.") from None
    document = read_settings(product_root)
    document["autoSyncCompletedRuns"] = enabled
    return _write_settings(product_root, document)


def write_language(product_root: str | Path, language: str) -> dict:
    if language not in LANGUAGE_CODES:
        raise LiveTrialSettingsError("LiveTrial settings are unavailable.") from None
    document = read_settings(product_root)
    document["language"] = language
    return _write_settings(product_root, document)


def write_capture_device(product_root: str | Path, device: str | None) -> dict:
    """Remember which video device is the capture card; None forgets it."""
    if not _valid_capture_device(device):
        raise LiveTrialSettingsError("LiveTrial settings are unavailable.") from None
    document = read_settings(product_root)
    document["captureDevice"] = device
    return _write_settings(product_root, document)


def write_console_language(product_root: str | Path, code: str) -> dict:
    """Remember the Switch's language; "auto" detects it per session."""
    if code not in _CONSOLE_CODES:
        raise LiveTrialSettingsError("LiveTrial settings are unavailable.") from None
    document = read_settings(product_root)
    document["consoleLanguage"] = code
    return _write_settings(product_root, document)
