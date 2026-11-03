"""Bounded Windows release check used only for a permanent local notification."""

from __future__ import annotations

import json
from pathlib import Path
import re

from livetrial_https import APP_DOWNLOADS_PATH, MAX_AUTH_RESPONSE_BYTES, LiveTrialHttpsExecutor


CURRENT_WINDOWS_VERSION = "3.34.0"
_VERSION = re.compile(r"^[0-9]+(?:\.[0-9]+){1,3}$")


def _parts(value: str) -> tuple[int, ...]:
    if not isinstance(value, str) or not _VERSION.fullmatch(value):
        raise ValueError
    return tuple(int(part) for part in value.split("."))


def windows_release_status(api_origin: str, bearer_token: str, https_factory=LiveTrialHttpsExecutor) -> dict | None:
    """The published LiveTrial release and its floor, or None when it could not be read."""
    try:
        response = https_factory(api_origin).request(
            "GET", APP_DOWNLOADS_PATH, None, bearer_token, MAX_AUTH_RESPONSE_BYTES
        )
        if response.get("statusCode") != 200 or not response.get("contentType", "").lower().startswith("application/json"):
            return None
        document = json.loads(response["body"].decode("utf-8"))
        if document.get("schemaVersion") != "mk8dx.app-downloads.v1" or not isinstance(document.get("entries"), list):
            return None
        row = next((entry for entry in document["entries"]
                    if isinstance(entry, dict) and entry.get("id") == "livetrial-windows"
                    and entry.get("platform") == "windows"), None)
        version = row.get("version") if isinstance(row, dict) else None
        released_on = row.get("releasedOn") if isinstance(row, dict) else None
        if not isinstance(version, str) or not isinstance(released_on, str):
            return None
        _parts(version)
        minimum = row.get("minimumSupportedVersion")
        if minimum is not None:
            _parts(minimum)
        return {
            "version": version,
            "releasedOn": released_on,
            "minimumVersion": minimum,
            "downloadUrl": api_origin.rstrip("/") + "/?apps=1",
        }
    except Exception:
        return None


def update_from_status(status: dict | None) -> dict | None:
    """The reminder the dashboard shows: None when this version is the newest."""
    if status is None or _parts(status["version"]) <= _parts(CURRENT_WINDOWS_VERSION):
        return None
    minimum = status.get("minimumVersion")
    return {
        "version": status["version"],
        "releasedOn": status["releasedOn"],
        "downloadUrl": status["downloadUrl"],
        "currentVersion": CURRENT_WINDOWS_VERSION,
        "required": minimum is not None and _parts(CURRENT_WINDOWS_VERSION) < _parts(minimum),
    }


def latest_windows_update(api_origin: str, bearer_token: str, https_factory=LiveTrialHttpsExecutor) -> dict | None:
    try:
        return update_from_status(windows_release_status(api_origin, bearer_token, https_factory))
    except Exception:
        return None


# The floor last read from the site, kept on this PC so sending stays paused while
# offline too; it only ever pauses sending - capture, analysis and saved runs go on.
SUPPORT_FILE_NAME = "windows-support.json"


def remember_support_floor(data_root: str | Path, status: dict | None) -> None:
    if status is None:
        return
    try:
        path = Path(data_root) / SUPPORT_FILE_NAME
        minimum = status.get("minimumVersion")
        if minimum is None:
            path.unlink(missing_ok=True)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"minimumVersion": minimum, "latestVersion": status["version"]}), encoding="utf-8")
    except Exception:
        return


def unsupported_by_floor(data_root: str | Path) -> dict | None:
    """{minimumVersion, latestVersion} when this LiveTrial is older than the site's floor."""
    try:
        path = Path(data_root) / SUPPORT_FILE_NAME
        if not path.is_file() or path.stat().st_size > 4096:
            return None
        document = json.loads(path.read_text(encoding="utf-8"))
        minimum = document.get("minimumVersion")
        if _parts(CURRENT_WINDOWS_VERSION) < _parts(minimum):
            return {"minimumVersion": minimum, "latestVersion": document.get("latestVersion")}
        return None
    except Exception:
        return None
