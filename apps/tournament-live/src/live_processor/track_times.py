"""World-record track times, used to predict when the next race result is due.

Reads the TimeTrials firestore export and exposes, per track index, the 150cc
WorldRecord lap time. The broadcast overlay turns ``world record + 30s`` into a
countdown that starts when a track name is detected: when it elapses we show
"waiting"; when results arrive first the countdown stops and we show "in sync".

The data ships in-repo (``reference_data/world_record_track_times.json``,
stripped from the TimeTrials firestore export) so the countdown always works on
a fresh clone. Set ``MK8DX_TIMETRIALS_EXPORT`` to a full firestore export to
override with fresher/complete data; when neither is readable the loader
degrades gracefully and the overlay simply omits the countdown.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .paths import PROJECT_ROOT

# Committed, in-repo source of truth for the overlay countdown: the 150cc
# WorldRecord lap time per track index. Regenerate with
# _archive/cleanup_2026-07-06/scripts/build_world_record_track_times.py.
REPO_WORLD_RECORDS = PROJECT_ROOT / "reference_data" / "world_record_track_times.json"

RESULT_BUFFER_SECONDS = 70

_cache: dict[int, int] | None = None


def _latest_version(entry: dict[str, Any]) -> dict[str, Any] | None:
    version_id = entry.get("latestVersionId")
    for key, value in entry.items():
        if key.endswith("/versions") and isinstance(value, dict):
            if version_id in value:
                return value[version_id]
            return next(iter(value.values()), None)
    return None


def parse_firestore_export(source: Path) -> dict[int, int]:
    """Extract ``{track_index: 150cc WorldRecord tracktimeMs}`` from a full
    TimeTrials firestore export (the only field the countdown uses)."""

    times: dict[int, int] = {}
    data = json.loads(source.read_text(encoding="utf-8"))
    for entry in data.get("submissions", {}).values():
        version = _latest_version(entry)
        if not version:
            continue
        if str(version.get("mode")) != "150cc":
            continue
        if str(version.get("playerUid")) != "WorldRecord":
            continue
        track_index = version.get("trackIndex")
        track_time = version.get("tracktimeMs")
        if track_index is None or track_time is None:
            continue
        times[int(track_index)] = int(track_time)
    return times


def _parse_repo_times(source: Path) -> dict[int, int]:
    """Read the committed stripped JSON (``track_times_ms`` index -> ms)."""

    data = json.loads(source.read_text(encoding="utf-8"))
    return {int(index): int(ms) for index, ms in data.get("track_times_ms", {}).items()}


def _load(path: Path | None = None) -> dict[int, int]:
    global _cache
    if path is None and _cache is not None:
        return _cache
    times: dict[int, int] = {}
    try:
        if path is not None:
            # Explicit path is always a full firestore export (used by tests).
            times = parse_firestore_export(path)
        else:
            override = os.environ.get("MK8DX_TIMETRIALS_EXPORT")
            if override and Path(override).exists():
                times = parse_firestore_export(Path(override))
            else:
                times = _parse_repo_times(REPO_WORLD_RECORDS)
    except (OSError, ValueError):
        times = {}
    if path is None:
        _cache = times
    return times


def world_record_ms(track_index: int | str | None) -> int | None:
    if track_index in (None, ""):
        return None
    try:
        index = int(track_index)
    except (TypeError, ValueError):
        return None
    return _load().get(index)


def next_update_seconds(track_index: int | str | None) -> int | None:
    """World-record seconds + buffer — the expected time until the next result."""

    track_time = world_record_ms(track_index)
    if track_time is None:
        return None
    return round(track_time / 1000) + RESULT_BUFFER_SECONDS
