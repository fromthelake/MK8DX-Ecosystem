from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Iterable, Mapping

from .catalog import TRACK_PLACEHOLDER, is_missing_track, resolve_character_id, resolve_track_id


SCHEMA_VERSION = "mk8dx.tournament-race-result.v1"
SOURCE_KINDS = {
    "tournament_recorded_video",
    "tournament_live_capture",
    "tournament_spreadsheet_import",
    "tournament_manual_entry",
}


class CanonicalizationError(ValueError):
    """Raised when confirmed legacy rows cannot safely form a canonical race."""


@dataclass(frozen=True)
class SourceDescriptor:
    kind: str
    session_id: str
    producer_version: str
    source_media_id: str | None = None
    stream_id: str | None = None
    transport: str = "native_contract"

    def __post_init__(self) -> None:
        if self.kind not in SOURCE_KINDS:
            raise ValueError(f"Unsupported tournament source kind: {self.kind}")
        if not self.session_id.strip():
            raise ValueError("session_id is required")
        if not self.producer_version.strip():
            raise ValueError("producer_version is required")


def _text(row: Mapping[str, object], *names: str) -> str:
    for name in names:
        value = row.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _integer(row: Mapping[str, object], *names: str) -> int:
    text = _text(row, *names)
    try:
        value = int(text)
    except (TypeError, ValueError) as exc:
        raise CanonicalizationError(f"{names[0]} must be an integer, got {text!r}") from exc
    if value < 0:
        raise CanonicalizationError(f"{names[0]} cannot be negative")
    return value


def _boolean(row: Mapping[str, object], *names: str, default: bool) -> bool:
    text = _text(row, *names)
    if not text:
        return default
    normalized = text.casefold()
    if normalized in {"true", "1", "yes"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    raise CanonicalizationError(f"{names[0]} must be a boolean, got {text!r}")


def _opaque_id(*parts: object, length: int = 32) -> str:
    material = "\x1f".join(str(part) for part in parts)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:length]


def _race_key(row: Mapping[str, object]) -> tuple[str, int]:
    video = _text(row, "Video", "RaceClass")
    race = _integer(row, "Race", "RaceIDNumber")
    if race < 1:
        raise CanonicalizationError("Race must be at least 1")
    return video, race


def _competition_ranks(totals: list[int]) -> list[int]:
    return [1 + sum(1 for candidate in totals if candidate > total) for total in totals]


def _single_value(rows: list[Mapping[str, object]], label: str, getter) -> object:
    values = {getter(row) for row in rows}
    if len(values) != 1:
        raise CanonicalizationError(f"Race rows disagree on {label}: {sorted(values)!r}")
    return next(iter(values))


def _verification(rows: list[Mapping[str, object]]) -> dict[str, object]:
    issues: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        needs_review = _boolean(row, "Needs Review", "ReviewNeeded", default=False)
        reason = _text(row, "Review Reason", "ReviewReason")
        if needs_review:
            message = reason or "Producer marked this confirmed row for review."
            if message not in seen:
                seen.add(message)
                issues.append({"code": "producer.review_needed", "message": message[:240]})
    if issues:
        return {
            "status": "needs_review",
            "method": "legacy_confirmed_scoreboard_rows",
            "issues": issues,
        }
    return {"status": "producer_check_passed", "method": "legacy_confirmed_scoreboard_rows"}


def _participant_reference(
    row: Mapping[str, object],
    source: SourceDescriptor,
    video: str,
    race_number: int,
    position: int,
    observed_name: str,
) -> dict[str, str]:
    identity_label = _text(row, "Identity Label", "IdentityLabel")
    if identity_label:
        return {
            "namespace": "producer_local_player",
            "value": f"local-player.{_opaque_id(source.session_id, video, identity_label)}",
        }
    # A displayed name is evidence, not an identity merge key. Without the
    # extractor's explicit local identity label, retain one opaque observation
    # per race placement and let Tournament Manager reconcile it deliberately.
    return {
        "namespace": "unresolved_observation",
        "value": f"observation.{_opaque_id(source.session_id, video, race_number, position, observed_name)}",
    }


# ADR-0217: the race class (track-intro badge, race_class.py) in the workbook/CSV "Class" column
CLASS_MODES = {"50cc": (50, False), "100cc": (100, False), "150cc": (150, False), "200cc": (200, False),
               "mirror": (150, True)}


def race_mode(text: str) -> tuple[int, bool] | None:
    """(mode, mirror) of a Class cell ("50cc" ... "200cc", "Mirror"; case and spaces aside), None when empty."""
    key = "".join(str(text or "").split()).lower()
    if not key:
        return None
    if key in ("50", "100", "150", "200"):
        key += "cc"
    if key not in CLASS_MODES:
        raise CanonicalizationError(f"Class {text!r} is not 50cc, 100cc, 150cc, 200cc or Mirror")
    return CLASS_MODES[key]


def _canonical_race(
    rows: list[Mapping[str, object]],
    source: SourceDescriptor,
    created_at_ms: int,
) -> dict[str, object]:
    video, race_number = _race_key(rows[0])
    if any(is_missing_track(_text(row, "Track", "TrackName")) for row in rows):
        raise CanonicalizationError(
            f"{video or 'session'} race {race_number}: track not filled in yet "
            f"(empty or placeholder {TRACK_PLACEHOLDER}); fill in the Track before importing"
        )
    track_id = _single_value(rows, "track", lambda row: resolve_track_id(_text(row, "Track", "TrackName")))
    counts = bool(
        _single_value(
            rows,
            "Counts Toward Totals",
            lambda row: _boolean(row, "Counts Toward Totals", "CountsTowardTotals", default=True),
        )
    )
    scoring_note = str(
        _single_value(
            rows,
            "Scoring Note",
            lambda row: _text(row, "Scoring Note", "ExcludedFromTotalsReason"),
        )
    )
    if not counts and not scoring_note:
        raise CanonicalizationError("An excluded race requires a Scoring Note")

    segment = int(
        _single_value(rows, "scoring segment", lambda row: _integer(row, "Session", "SessionIndex") if _text(row, "Session", "SessionIndex") else 1)
    )
    placements: list[dict[str, object]] = []
    observed_positions: list[int] = []
    totals: list[int] = []
    for row in rows:
        position = _integer(row, "Position", "RacePosition")
        if position < 1 or position > 12:
            raise CanonicalizationError(f"Position {position} is outside 1..12")
        name = _text(row, "Player", "FixPlayerName")
        if not name:
            raise CanonicalizationError("Player is required for every confirmed placement")
        race_points = _integer(row, "Race Points", "RacePoints")
        total_before = _integer(row, "Total Before Race", "OldTotalScore")
        total_after = _integer(row, "Total After Race", "NewTotalScore")
        expected_after = total_before + race_points if counts else total_before
        if total_after != expected_after:
            raise CanonicalizationError(
                f"Race {race_number} position {position} total is {total_after}; expected {expected_after}"
            )
        placement: dict[str, object] = {
            "finishPosition": position,
            "participantReference": _participant_reference(
                row, source, video, race_number, position, name
            ),
            "observedPlayerName": name,
            "scoring": {
                "racePoints": race_points,
                "totalBeforeRace": total_before,
                "totalAfterRace": total_after,
                "rankAfterRace": 0,
            },
        }
        character_id = resolve_character_id(_text(row, "Character Roster", "CharacterRosterName", "Character"))
        if character_id:
            placement["characterId"] = character_id
        placements.append(placement)
        observed_positions.append(position)
        totals.append(total_after)

    expected_positions = list(range(1, len(rows) + 1))
    if sorted(observed_positions) != expected_positions:
        raise CanonicalizationError(
            f"Race {race_number} positions must be contiguous {expected_positions}; got {sorted(observed_positions)}"
        )
    ranks = _competition_ranks(totals)
    for placement, rank in zip(placements, ranks, strict=True):
        placement["scoring"]["rankAfterRace"] = rank  # type: ignore[index]
    placements.sort(key=lambda placement: int(placement["finishPosition"]))

    local_record_id = f"{video or 'session'}:race:{race_number}"
    result: dict[str, object] = {
        "schemaVersion": SCHEMA_VERSION,
        "raceResultId": f"tournament_race_result.{_opaque_id(source.kind, source.session_id, local_record_id)}",
        "revision": 1,
        "raceNumber": race_number,
        "scoringSegment": segment,
        "trackId": track_id,
        "countsTowardStandings": counts,
        "placements": placements,
        "source": {
            "kind": source.kind,
            "transport": source.transport,
            "producerVersion": source.producer_version,
            "localRecordId": local_record_id,
            "sessionId": source.session_id,
        },
        "timestamps": {"createdAtMs": created_at_ms},
        "verification": _verification(rows),
    }
    if scoring_note:
        result["scoringNote"] = scoring_note
    race_class = _single_value(rows, "Class", lambda row: race_mode(_text(row, "Class")))
    if race_class is not None:
        result["mode"] = race_class[0]
        if race_class[1]:
            result["mirror"] = True
    if source.source_media_id:
        result["source"]["sourceMediaId"] = source.source_media_id  # type: ignore[index]
    if source.stream_id:
        result["source"]["streamId"] = source.stream_id  # type: ignore[index]
    return result


def races_with_missing_track(rows: Iterable[Mapping[str, object]]) -> list[tuple[str, int]]:
    """The (video, race) keys whose Track is empty or still the placeholder."""
    missing = {_race_key(row) for row in rows if is_missing_track(_text(row, "Track", "TrackName"))}
    return sorted(missing)


def canonicalize_confirmed_rows(
    rows: Iterable[Mapping[str, object]],
    *,
    source: SourceDescriptor,
    created_at_ms: int,
) -> list[dict[str, object]]:
    """Convert confirmed legacy workbook rows to ordered V1 race documents.

    This boundary deliberately accepts only post-OCR, post-session-validation rows.
    Provisional live observations cannot enter the canonical result stream.
    """
    materialized = [dict(row) for row in rows]
    if not materialized:
        raise CanonicalizationError("At least one confirmed tournament row is required")
    if created_at_ms < 0:
        raise CanonicalizationError("created_at_ms cannot be negative")

    grouped: dict[tuple[str, int], list[Mapping[str, object]]] = {}
    for row in materialized:
        grouped.setdefault(_race_key(row), []).append(row)
    return [
        _canonical_race(grouped[key], source, created_at_ms)
        for key in sorted(grouped, key=lambda item: (item[0], item[1]))
    ]
