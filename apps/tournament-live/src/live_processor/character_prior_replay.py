from __future__ import annotations

import json
import os
import re
import threading
import time
from collections import Counter, defaultdict
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .baseline_export_metadata import character_index, character_roster_name
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .run_context import attach_run_id, current_run_id

import sys


from mk8dx_tournament_extraction.engine.ocr_scoreboard_consensus import (  # type: ignore  # noqa: E402
    CHARACTER_SHORTLIST_STATS,
    player_identity_key,
    replay_character_prior_match,
    reset_character_shortlist_state,
)


_REPLAY_LOCK = threading.Lock()


def apply_stream_character_prior_replay(
    *,
    stream_id: str,
    video_context: str,
    race_sequence: int,
    scoreboard_rows: list[dict[str, str]],
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    """Replay baseline character priors over accumulated validated rows for one stream."""
    if not scoreboard_rows:
        return scoreboard_rows, {
            "enabled": True,
            "stream_id": stream_id,
            "video_context": video_context,
            "race_sequence": race_sequence,
            "rows_processed": 0,
            "changes": [],
        }
    with _REPLAY_LOCK:
        started = time.perf_counter()
        state = _load_state(stream_id)
        races = state.setdefault("races", {})
        race_key = str(int(race_sequence))
        races[race_key] = [_raw_replay_row(row, stream_id, video_context, race_sequence) for row in scoreboard_rows]

        raw_rows = _sorted_rows([row for items in races.values() for row in items])
        replayed_rows, replay_report = _replay_rows(raw_rows)
        replayed_by_race = defaultdict(list)
        for row in replayed_rows:
            replayed_by_race[str(int(row.get("race_sequence") or 0))].append(row)

        races_out = {
            key: [_public_replayed_row(row) for row in _sorted_rows(value)]
            for key, value in replayed_by_race.items()
        }
        state["run_id"] = current_run_id()
        state["stream_id"] = stream_id
        state["video_context"] = video_context
        state["updated_at"] = time.time()
        state["replayed_races"] = races_out
        state["last_replay"] = replay_report
        _write_state(stream_id, state)

        current_rows = [
            _scoreboard_row_from_replayed(row)
            for row in _sorted_rows(replayed_by_race.get(race_key, []))
        ]
        report = {
            **replay_report,
            "duration_seconds": round(time.perf_counter() - started, 4),
            "current_race_rows": len(current_rows),
            "current_race_changes": [
                change for change in replay_report["changes"]
                if int(change.get("race_sequence") or 0) == int(race_sequence)
            ],
        }
        _write_report(stream_id, report)
        return current_rows, report


def _replay_rows(raw_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    reset_character_shortlist_state()
    before_stats = dict(CHARACTER_SHORTLIST_STATS)
    race_key_counts: dict[tuple[str, int], Counter[str]] = defaultdict(Counter)
    for row in raw_rows:
        player_key = player_identity_key(str(row.get("Player") or ""))
        if len(player_key) >= 3:
            race_key_counts[(str(row.get("video_context") or ""), int(row.get("race_sequence") or 0))][player_key] += 1

    replayed_rows: list[dict[str, Any]] = []
    changes: list[dict[str, Any]] = []
    with _disabled_baseline_character_trace():
        for row in raw_rows:
            raw_match = _raw_match(row)
            player = str(row.get("Player") or "")
            player_key = player_identity_key(player)
            race_key = (str(row.get("video_context") or ""), int(row.get("race_sequence") or 0))
            allow_prior = bool(player_key) and race_key_counts[race_key][player_key] <= 1
            replayed_match = replay_character_prior_match(
                str(row.get("video_context") or ""),
                player,
                _float(row.get("NameConfidence"), 0.0),
                raw_match,
                race_id_number=int(row.get("race_sequence") or 0),
                allow_prior=allow_prior,
            )
            replayed = dict(row)
            _apply_match(replayed, replayed_match)
            if not _known_character(replayed.get("Character")) and _known_character(row.get("Character")):
                replayed = dict(row)
                replayed["CharacterReplaySuppressed"] = "invalid_replay_downgrade"
            replayed_rows.append(replayed)
            if _character_changed(row, replayed):
                changes.append(
                    {
                        "stream_id": row.get("stream_id", ""),
                        "video_context": row.get("video_context", ""),
                        "race_sequence": int(row.get("race_sequence") or 0),
                        "position": row.get("Position", ""),
                        "player": player,
                        "before_character": row.get("Character", ""),
                        "after_character": replayed.get("Character", ""),
                        "before_method": row.get("CharacterMatchMethod", ""),
                        "after_method": replayed.get("CharacterMatchMethod", ""),
                    }
                )

    after_stats = dict(CHARACTER_SHORTLIST_STATS)
    stats_delta = {
        key: int(after_stats.get(key, 0)) - int(before_stats.get(key, 0))
        for key in sorted(set(before_stats) | set(after_stats))
    }
    return replayed_rows, {
        "run_id": current_run_id(),
        "enabled": True,
        "rows_processed": len(raw_rows),
        "races_processed": len({(row.get("stream_id"), int(row.get("race_sequence") or 0)) for row in raw_rows}),
        "changes": changes,
        "stats_delta": stats_delta,
    }


def _raw_replay_row(row: dict[str, str], stream_id: str, video_context: str, race_sequence: int) -> dict[str, Any]:
    raw = dict(row)
    raw["stream_id"] = stream_id
    raw["video_context"] = video_context
    raw["race_sequence"] = int(race_sequence)
    if _optional_int(raw.get("CharacterIndex")) is None:
        raw["CharacterIndex"] = character_index(raw.get("Character"))
    raw.setdefault("CharacterMatchConfidence", raw.get("CharacterConfidence", 0.0))
    raw.setdefault("CharacterMatchMethod", raw.get("CharacterMatchMethod", ""))
    raw.setdefault("NameConfidence", raw.get("NameConfidence", 100.0))
    return raw


def _raw_match(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "Character": row.get("Character", ""),
        "CharacterIndex": _optional_int(row.get("CharacterIndex")),
        "CharacterMatchConfidence": _float(row.get("CharacterMatchConfidence"), 0.0),
        "CharacterMatchMethod": row.get("CharacterMatchMethod", ""),
        "CharacterMatchRawBest": _optional_float(row.get("CharacterMatchRawBest")),
        "CharacterMatchRawMargin": _optional_float(row.get("CharacterMatchRawMargin")),
        "CharacterMatchRawTop5Spread": _optional_float(row.get("CharacterMatchRawTop5Spread")),
        "CharacterMatchRawTop5FamilyCount": _optional_float(row.get("CharacterMatchRawTop5FamilyCount")),
    }


def _apply_match(row: dict[str, Any], match: dict[str, Any]) -> None:
    row["Character"] = str(match.get("Character") or "")
    row["CharacterIndex"] = match.get("CharacterIndex")
    row["CharacterMatchConfidence"] = match.get("CharacterMatchConfidence", 0.0)
    row["CharacterMatchMethod"] = match.get("CharacterMatchMethod", "")
    row["CharacterMatchRawBest"] = match.get("CharacterMatchRawBest")
    row["CharacterMatchRawMargin"] = match.get("CharacterMatchRawMargin")
    row["CharacterMatchRawTop5Spread"] = match.get("CharacterMatchRawTop5Spread")
    row["CharacterMatchRawTop5FamilyCount"] = match.get("CharacterMatchRawTop5FamilyCount")


def _scoreboard_row_from_replayed(row: dict[str, Any]) -> dict[str, str]:
    result = {key: "" if value is None else str(value) for key, value in row.items() if not str(key).startswith("_")}
    result["Character Roster"] = character_roster_name(result.get("Character"))
    return result


def _public_replayed_row(row: dict[str, Any]) -> dict[str, Any]:
    public = dict(row)
    public["Character Roster"] = character_roster_name(public.get("Character"))
    return public


def _character_changed(before: dict[str, Any], after: dict[str, Any]) -> bool:
    return (
        str(before.get("Character", "")) != str(after.get("Character", ""))
        or str(before.get("CharacterMatchMethod", "")) != str(after.get("CharacterMatchMethod", ""))
    )


def _known_character(value: Any) -> bool:
    text = str(value or "").strip()
    if not text or text == "?":
        return False
    index = character_index(text)
    return index is not None and index >= 0


def _sorted_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            str(row.get("video_context") or row.get("stream_id") or ""),
            int(row.get("race_sequence") or 0),
            int(row.get("Position") or 0),
        ),
    )


def _state_path(stream_id: str) -> Path:
    run_id = _safe_path_part(current_run_id() or "unknown_run")
    stream = _safe_path_part(stream_id or "unknown_stream")
    return assert_write_allowed(DIAGNOSTICS_ROOT / "pipeline_state" / "character_prior_replay_state" / run_id / f"{stream}.json")


def _load_state(stream_id: str) -> dict[str, Any]:
    path = _state_path(stream_id)
    if not path.exists():
        return {"run_id": current_run_id(), "stream_id": stream_id, "races": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"run_id": current_run_id(), "stream_id": stream_id, "races": {}}


def _write_state(stream_id: str, state: dict[str, Any]) -> None:
    path = _state_path(stream_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(attach_run_id(state), indent=2, sort_keys=True), encoding="utf-8")


def _write_report(stream_id: str, report: dict[str, Any]) -> None:
    path = assert_write_allowed(DIAGNOSTICS_ROOT / "character_prior_replay_report.json")
    existing: dict[str, Any] = {"run_id": current_run_id(), "streams": {}}
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {"run_id": current_run_id(), "streams": {}}
    existing.setdefault("streams", {})[stream_id] = report
    existing["updated_at"] = time.time()
    path.write_text(json.dumps(attach_run_id(existing), indent=2, sort_keys=True), encoding="utf-8")

    lines = ["# Character Prior Replay Report", ""]
    for stream, item in sorted(existing.get("streams", {}).items()):
        lines.append(f"## {stream}")
        lines.append(f"- rows processed: {item.get('rows_processed', 0)}")
        lines.append(f"- races processed: {item.get('races_processed', 0)}")
        lines.append(f"- current race rows: {item.get('current_race_rows', 0)}")
        lines.append(f"- current race changes: {len(item.get('current_race_changes', []))}")
        stats = item.get("stats_delta", {})
        lines.append(f"- prior accepts: {stats.get('prior_accepts', 0)}")
        lines.append(f"- prior fallbacks: {stats.get('prior_fallbacks', 0)}")
        lines.append("")
    assert_write_allowed(DIAGNOSTICS_ROOT / "character_prior_replay_report.md").write_text("\n".join(lines), encoding="utf-8")


@contextmanager
def _disabled_baseline_character_trace():
    previous = os.environ.get("MK8_TRACE_CHARACTER_PRIORS")
    os.environ["MK8_TRACE_CHARACTER_PRIORS"] = ""
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("MK8_TRACE_CHARACTER_PRIORS", None)
        else:
            os.environ["MK8_TRACE_CHARACTER_PRIORS"] = previous


def _safe_path_part(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "")).strip("_") or "unknown"


def _optional_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(float(str(value)))
    except Exception:
        return None


def _optional_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(str(value))
    except Exception:
        return None


def _float(value: Any, default: float) -> float:
    parsed = _optional_float(value)
    return default if parsed is None else parsed
