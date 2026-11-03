from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .baseline_row_ocr import RowExtraction, RowOcrAttempt
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .run_context import attach_run_id

RACE_POINTS_BY_PLAYER_COUNT = {
    12: {1: 15, 2: 12, 3: 10, 4: 9, 5: 8, 6: 7, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1},
    11: {1: 13, 2: 11, 3: 9, 4: 8, 5: 7, 6: 6, 7: 5, 8: 4, 9: 3, 10: 2, 11: 1},
    10: {1: 12, 2: 10, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1},
    9: {1: 11, 2: 9, 3: 7, 4: 6, 5: 5, 6: 4, 7: 3, 8: 2, 9: 1},
    8: {1: 10, 2: 8, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1},
    7: {1: 9, 2: 7, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1},
    6: {1: 7, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1},
}

RACE_POINTS_BY_POSITION_12 = RACE_POINTS_BY_PLAYER_COUNT[12]
RACE_POINTS_BY_POSITION_10 = RACE_POINTS_BY_PLAYER_COUNT[10]


@dataclass
class LivePointsTransitionObservation:
    stream_id: str
    race_sequence: int
    race_score_frame_index: int
    race_score_timestamp: float
    race_score_frame_path: str
    rows: list[dict[str, Any]]
    extraction_status: str
    extraction_errors: list[str] = field(default_factory=list)


@dataclass
class LiveTotalPointsObservation:
    stream_id: str
    race_sequence: int
    total_score_frame_index: int
    total_score_timestamp: float
    total_score_frame_path: str
    rows: list[dict[str, Any]]
    extraction_status: str
    extraction_errors: list[str] = field(default_factory=list)


@dataclass
class JoinedConsensusRow:
    race_row_index: int
    total_row_index: int | None
    position: str
    character_icon: str
    player_name: str
    race_points: str
    previous_total_points: str
    corrected_old_total_points: str
    total_points: str
    detected_total_points: str
    new_total_race_points: str
    join_method: str
    join_confidence: float
    validation_status: str
    validation_errors: list[str]
    review_needed: bool
    review_reason_codes: list[str]
    review_reason: str
    score_validation_status: str
    race_row: dict[str, Any]
    total_row: dict[str, Any] | None

    def to_report(self) -> dict[str, Any]:
        return {
            "race_row_index": self.race_row_index,
            "total_row_index": self.total_row_index,
            "position": self.position,
            "character_icon": self.character_icon,
            "player_name": self.player_name,
            "race_points": self.race_points,
            "detected_race_points": self.race_row.get("detected_race_points", ""),
            "race_points_source": self.race_row.get("race_points_source", ""),
            "previous_total_points": self.previous_total_points,
            "corrected_old_total_points": self.corrected_old_total_points,
            "total_points": self.total_points,
            "detected_total_points": self.detected_total_points,
            "new_total_race_points": self.new_total_race_points,
            "join_method": self.join_method,
            "join_confidence": self.join_confidence,
            "validation_status": self.validation_status,
            "validation_errors": self.validation_errors,
            "review_needed": self.review_needed,
            "review_reason_codes": self.review_reason_codes,
            "review_reason": self.review_reason,
            "score_validation_status": self.score_validation_status,
            "race_row": self.race_row,
            "total_row": self.total_row,
        }

    def to_scoreboard_row(self, stream_id: str, race_sequence: int, race_frame: int, total_frame: int) -> dict[str, str]:
        return {
            "Position": self.position,
            "Character": self.character_icon,
            "Player": self.player_name,
            "RacePoints": self.race_points,
            "DetectedRacePoints": str(self.race_row.get("detected_race_points", "")),
            "DetectedRacePointsSource": str(self.race_row.get("detected_race_points_source", "")),
            "PreviousTotal": self.previous_total_points,
            "OldTotalScore": self.previous_total_points,
            "DetectedOldTotalScore": self.previous_total_points,
            "CorrectedOldTotalScore": self.corrected_old_total_points,
            "Total": self.total_points,
            "NewTotalRacePoint": self.new_total_race_points,
            "DetectedNewTotalScore": self.detected_total_points,
            "ReviewNeeded": str(bool(self.review_needed)),
            "ReviewReasonCodes": ";".join(self.review_reason_codes),
            "ReviewReason": self.review_reason,
            "ScoreValidationStatus": self.score_validation_status,
            "stream_id": stream_id,
            "race_sequence": str(race_sequence),
            "race_score_frame_index": str(race_frame),
            "total_score_frame_index": str(total_frame),
            "join_method": self.join_method,
            "validation_status": self.validation_status,
        }


@dataclass
class LiveConsensusObservation:
    stream_id: str
    race_sequence: int
    race_score_frame_index: int
    total_score_frame_index: int
    race_score_timestamp: float
    total_score_timestamp: float
    joined_rows: list[JoinedConsensusRow]
    join_status: str
    validation_status: str
    validation_errors: list[str] = field(default_factory=list)
    scoreboard_rows: list[dict[str, str]] = field(default_factory=list)

    def to_report(self) -> dict[str, Any]:
        return {
            "stream_id": self.stream_id,
            "race_sequence": self.race_sequence,
            "race_score_frame_index": self.race_score_frame_index,
            "total_score_frame_index": self.total_score_frame_index,
            "race_score_timestamp": self.race_score_timestamp,
            "total_score_timestamp": self.total_score_timestamp,
            "joined_rows": [row.to_report() for row in self.joined_rows],
            "join_status": self.join_status,
            "validation_status": self.validation_status,
            "validation_errors": self.validation_errors,
            "scoreboard_rows": self.scoreboard_rows,
        }


def build_points_transition_observation(attempt: RowOcrAttempt) -> LivePointsTransitionObservation:
    visible_row_count = official_visible_row_count_from_attempt(attempt)
    rows = [race_score_row_from_extraction(row) for row in attempt.rows[:visible_row_count]]
    apply_variable_field_size_points(rows, visible_row_count)
    errors = collect_row_errors(rows, required_fields=("race_points",))
    extracted_count = sum(1 for row in rows if row.get("race_points"))
    status = "extracted" if extracted_count else "failed"
    observation = LivePointsTransitionObservation(
        stream_id=attempt.stream_id,
        race_sequence=attempt.race_sequence,
        race_score_frame_index=attempt.frame_index,
        race_score_timestamp=attempt.timestamp,
        race_score_frame_path=str(attempt.crop_path),
        rows=rows,
        extraction_status=status,
        extraction_errors=errors,
    )
    write_points_transition_report(observation)
    return observation


def get_race_points(position: int, num_players: int) -> int | None:
    points_table = RACE_POINTS_BY_PLAYER_COUNT.get(num_players)
    if points_table is None:
        points_table = RACE_POINTS_BY_POSITION_12
    return points_table.get(position)


def race_points_source_for_player_count(num_players: int) -> str:
    if num_players in RACE_POINTS_BY_PLAYER_COUNT:
        return f"row_order_points_table_{num_players}p"
    return "row_order_points_table_12p_default_for_unsupported_player_count"


def official_visible_row_count_from_attempt(attempt: RowOcrAttempt) -> int:
    summary_value = attempt.summary.get("position_guided_visible_rows") if isinstance(attempt.summary, dict) else None
    count = parse_int(summary_value)
    if count is None:
        count = highest_position_guided_row(attempt.rows)
    if count is None:
        return len(attempt.rows)
    return max(0, min(count, len(attempt.rows)))


def highest_position_guided_row(rows: list[RowExtraction]) -> int | None:
    for row in reversed(rows):
        if row_position_counts_as_visible(row):
            return int(row.row_index)
    return None


def row_position_counts_as_visible(row: RowExtraction) -> bool:
    if row.position.status != "POSITION_EXTRACTED":
        return False
    threshold = 0.30 if row.row_index == 1 else 0.50
    return float(row.position.confidence or 0.0) >= threshold


def apply_variable_field_size_points(rows: list[dict[str, Any]], num_players: int | None = None) -> None:
    player_count = num_players or len(rows)
    source = race_points_source_for_player_count(player_count)
    for row in rows:
        row_index = parse_int(row.get("row_index"))
        points = get_race_points(row_index or 0, player_count)
        if points is None:
            continue
        row["race_points"] = str(points)
        row["race_points_source"] = source
        row["player_count_for_scoring"] = str(player_count)
        confidence = row.setdefault("confidence", {})
        if isinstance(confidence, dict):
            confidence["race_points"] = 1.0


def build_total_points_observation(attempt: RowOcrAttempt) -> LiveTotalPointsObservation:
    visible_row_count = official_visible_row_count_from_attempt(attempt)
    rows = [total_score_row_from_extraction(row) for row in attempt.rows[:visible_row_count]]
    errors = collect_row_errors(rows, required_fields=("total_points",))
    extracted_count = sum(1 for row in rows if row.get("total_points"))
    status = "extracted" if extracted_count else "failed"
    observation = LiveTotalPointsObservation(
        stream_id=attempt.stream_id,
        race_sequence=attempt.race_sequence,
        total_score_frame_index=attempt.frame_index,
        total_score_timestamp=attempt.timestamp,
        total_score_frame_path=str(attempt.crop_path),
        rows=rows,
        extraction_status=status,
        extraction_errors=errors,
    )
    write_total_points_report(observation)
    return observation


def build_consensus_observation(
    points_observation: LivePointsTransitionObservation,
    total_observation: LiveTotalPointsObservation,
) -> LiveConsensusObservation:
    joined = map_total_rows_to_race_rows(
        points_observation.rows,
        total_observation.rows,
        race_sequence=points_observation.race_sequence,
    )
    visible_rows = [row for row in joined if consensus_row_has_player_evidence(row)]
    complete_rows = [row for row in visible_rows if row.validation_status == "VALIDATED_CONSENSUS_ROW"]
    validation_errors: list[str] = []
    if not joined:
        validation_errors.append("no RaceScore rows available for consensus")
    if not visible_rows:
        validation_errors.append("no visible player rows available for consensus")
    if len(complete_rows) != len(visible_rows):
        validation_errors.append(f"only {len(complete_rows)} of {len(visible_rows)} visible consensus rows validated")
    join_status = "mapped" if any(row.total_row_index is not None for row in joined) else "unmapped"
    validation_status = "validated" if visible_rows and len(complete_rows) == len(visible_rows) else "partial"
    scoreboard_rows = [
        row.to_scoreboard_row(
            points_observation.stream_id,
            points_observation.race_sequence,
            points_observation.race_score_frame_index,
            total_observation.total_score_frame_index,
        )
        for row in complete_rows
    ]
    observation = LiveConsensusObservation(
        stream_id=points_observation.stream_id,
        race_sequence=points_observation.race_sequence,
        race_score_frame_index=points_observation.race_score_frame_index,
        total_score_frame_index=total_observation.total_score_frame_index,
        race_score_timestamp=points_observation.race_score_timestamp,
        total_score_timestamp=total_observation.total_score_timestamp,
        joined_rows=joined,
        join_status=join_status,
        validation_status=validation_status,
        validation_errors=validation_errors,
        scoreboard_rows=scoreboard_rows,
    )
    write_consensus_reports(points_observation, total_observation, observation)
    return observation


def map_total_rows_to_race_rows(
    race_rows: list[dict[str, Any]],
    total_rows: list[dict[str, Any]],
    race_sequence: int | None = None,
) -> list[JoinedConsensusRow]:
    assigned_total_indices: set[int] = set()
    joined: list[JoinedConsensusRow] = []
    normalized_total_names = {
        index: normalize_join_text(str(row.get("player_name", "")))
        for index, row in enumerate(total_rows)
    }
    for race_index, race_row in enumerate(race_rows):
        total_index, method, confidence = choose_total_row(race_row, total_rows, assigned_total_indices, normalized_total_names)
        total_row = total_rows[total_index] if total_index is not None else None
        if total_index is not None:
            assigned_total_indices.add(total_index)
        joined.append(build_joined_row(race_index, race_row, total_index, total_row, method, confidence, race_sequence))
    write_mapping_report(joined)
    return joined


def choose_total_row(
    race_row: dict[str, Any],
    total_rows: list[dict[str, Any]],
    assigned_total_indices: set[int],
    normalized_total_names: dict[int, str],
) -> tuple[int | None, str, float]:
    race_name = normalize_join_text(str(race_row.get("player_name", "")))
    if race_name:
        same_name = [
            index
            for index, total_name in normalized_total_names.items()
            if index not in assigned_total_indices and total_name and total_name == race_name
        ]
        if len(same_name) == 1:
            return same_name[0], "same_name", 1.0
        if len(same_name) > 1:
            row_index = int(race_row.get("row_index") or 0)
            nearest = min(same_name, key=lambda index: abs(int(total_rows[index].get("row_index") or 0) - row_index))
            return nearest, "same_name_nearest_row", 0.95

    continuity_matches: list[tuple[int, float]] = []
    old_total = parse_int(race_row.get("previous_total_points"))
    race_points = parse_int(race_row.get("race_points"))
    if old_total is not None and race_points is not None:
        expected_total = old_total + race_points
        for index, total_row in enumerate(total_rows):
            if index in assigned_total_indices:
                continue
            detected_total = parse_int(total_row.get("total_points"))
            if detected_total is None:
                continue
            if detected_total == expected_total:
                row_delta = abs(int(total_row.get("row_index") or 0) - int(race_row.get("row_index") or 0))
                continuity_matches.append((index, max(0.75, 0.92 - (row_delta * 0.02))))
    if continuity_matches:
        index, confidence = max(continuity_matches, key=lambda item: item[1])
        return index, "score_continuity", confidence

    race_position = str(race_row.get("position", ""))
    if race_position:
        for index, total_row in enumerate(total_rows):
            if index not in assigned_total_indices and str(total_row.get("position", "")) == race_position:
                return index, "same_position", 0.65

    row_number = int(race_row.get("row_index") or 0)
    for index, total_row in enumerate(total_rows):
        if index not in assigned_total_indices and int(total_row.get("row_index") or 0) == row_number:
            return index, "row_order", 0.55
    return None, "missing_total_row", 0.0


def build_joined_row(
    race_index: int,
    race_row: dict[str, Any],
    total_index: int | None,
    total_row: dict[str, Any] | None,
    method: str,
    confidence: float,
    race_sequence: int | None = None,
) -> JoinedConsensusRow:
    detected_total_points = str((total_row or {}).get("total_points", ""))
    race_points = str(race_row.get("race_points", ""))
    previous_total = str(race_row.get("previous_total_points", ""))
    name = str(race_row.get("player_name") or (total_row or {}).get("player_name") or "")
    character = str(race_row.get("character_icon") or (total_row or {}).get("character_icon") or "")
    position = str(race_row.get("position") or (total_row or {}).get("position") or "")
    errors: list[str] = []
    review_reason_codes: list[str] = []
    review_messages: list[str] = []
    if total_row is None:
        errors.append("no TotalScore row mapped")
    if not race_points:
        errors.append("missing RaceScore race_points")
    if not detected_total_points:
        errors.append("missing TotalScore total_points")
    if not name:
        errors.append("missing player_name")
    if not character:
        errors.append("missing character_icon")
    old_total = parse_int(previous_total)
    points = parse_int(race_points)
    detected_total = parse_int(detected_total_points)
    if old_total is None and int(race_sequence or 0) <= 1 and points is not None:
        old_total = 0
        previous_total = "0"
    corrected_old_total = ""
    authoritative_total = detected_total
    if old_total is not None and points is not None:
        authoritative_total = old_total + points
        corrected_old_total = str(old_total)
    elif old_total is not None:
        corrected_old_total = str(old_total)
    elif points is not None and detected_total is not None:
        corrected_old_total = str(max(0, detected_total - points))
        authoritative_total = detected_total
    if old_total is not None and points is not None and detected_total is not None and detected_total != old_total + points:
        review_reason_codes.append("total_score_mismatch")
        review_messages.append(
            f"Total mismatch: expected {old_total + points}, OCR {detected_total}."
        )
    total_points = str(authoritative_total) if authoritative_total is not None else detected_total_points
    if old_total is not None and points is not None and detected_total is not None and old_total + points != detected_total:
        corrected_old_total = str(old_total)
    elif old_total is not None:
        corrected_old_total = str(old_total)
    elif points is not None and detected_total is not None:
        corrected_old_total = str(max(0, detected_total - points))
    corrected_old_int = parse_int(corrected_old_total)
    if corrected_old_total and corrected_old_int is not None and corrected_old_int < 0:
        errors.append(f"impossible corrected old total score: {corrected_old_total}")
    score_validation_status = "validated"
    if review_reason_codes:
        score_validation_status = "total_score_mismatch"
    if errors:
        score_validation_status = "partial"
    status = "VALIDATED_CONSENSUS_ROW" if not errors else "PARTIAL_CONSENSUS_ROW"
    return JoinedConsensusRow(
        race_row_index=int(race_row.get("row_index") or race_index + 1),
        total_row_index=int((total_row or {}).get("row_index")) if total_row else None,
        position=position,
        character_icon=character,
        player_name=name,
        race_points=race_points,
        previous_total_points=previous_total,
        corrected_old_total_points=corrected_old_total,
        total_points=total_points,
        detected_total_points=detected_total_points,
        new_total_race_points=total_points,
        join_method=method,
        join_confidence=round(float(confidence), 4),
        validation_status=status,
        validation_errors=errors,
        review_needed=bool(review_reason_codes),
        review_reason_codes=sorted(set(review_reason_codes)),
        review_reason=" | ".join(review_messages),
        score_validation_status=score_validation_status,
        race_row=race_row,
        total_row=total_row,
    )


def race_score_row_from_extraction(row: RowExtraction) -> dict[str, Any]:
    race_position = row.row_index
    detected_race_points = row.race_points.value
    return {
        "row_index": row.row_index,
        "position": str(race_position),
        "detected_position": row.position.value,
        "character_icon": row.character.value,
        "player_name": row.name.value,
        "race_points": "",
        "race_points_source": "pending_visible_player_count",
        "detected_race_points": detected_race_points,
        "detected_race_points_source": "race_score_digit_ocr" if detected_race_points else "",
        "previous_total_points": row.total_points.value,
        "raw_score_crop_path": row.race_points.crop_path,
        "raw_total_crop_path": row.total_points.crop_path,
        "raw_name_crop_path": row.name.crop_path,
        "row_crop_path": row.row_crop_path,
        "confidence": {
            "position": row.position.confidence,
            "character": row.character.confidence,
            "name": row.name.confidence,
            "race_points": 0.0,
            "detected_race_points": row.race_points.confidence,
            "previous_total_points": row.total_points.confidence,
        },
        "validation_status": row.validation_statuses,
        "validation_errors": row.validation_errors,
    }


def total_score_row_from_extraction(row: RowExtraction) -> dict[str, Any]:
    return {
        "row_index": row.row_index,
        "position": row.position.value,
        "character_icon": row.character.value,
        "player_name": row.name.value,
        "total_points": row.total_points.value,
        "new_total_race_points": row.total_points.value,
        "raw_score_crop_path": row.total_points.crop_path,
        "raw_name_crop_path": row.name.crop_path,
        "row_crop_path": row.row_crop_path,
        "confidence": {
            "position": row.position.confidence,
            "character": row.character.confidence,
            "name": row.name.confidence,
            "total_points": row.total_points.confidence,
        },
        "validation_status": row.validation_statuses,
        "validation_errors": row.validation_errors,
    }


def apply_session_validation_live(observation: LiveConsensusObservation) -> dict[str, Any]:
    rows = [row.to_report() for row in observation.joined_rows]
    visible_rows = [row for row in observation.joined_rows if consensus_row_has_player_evidence(row)]
    valid_rows = [row for row in visible_rows if row.validation_status == "VALIDATED_CONSENSUS_ROW"]
    rebase_candidate = False
    connection_reset = False
    obvious_total_score_reset = False
    validation_status = "validated" if visible_rows and len(valid_rows) == len(visible_rows) else "partial"
    result = {
        "race_sequence": observation.race_sequence,
        "input_observation_rows": rows,
        "rebase_candidate_detected": rebase_candidate,
        "connection_reset_detected": connection_reset,
        "obvious_total_score_reset_detected": obvious_total_score_reset,
        "validation_output": {
            "validated_row_count": len(valid_rows),
            "input_row_count": len(observation.joined_rows),
            "visible_player_row_count": len(visible_rows),
            "status": validation_status,
        },
        "rejected_rows": [
            row.to_report()
            for row in visible_rows
            if row.validation_status != "VALIDATED_CONSENSUS_ROW"
        ],
        "ignored_empty_rows": [
            row.to_report()
            for row in observation.joined_rows
            if not consensus_row_has_player_evidence(row)
        ],
        "corrected_rebased_rows": [],
        "final_validation_status": validation_status,
    }
    write_json("session_validation_report.json", result)
    return result


def consensus_row_has_player_evidence(row: JoinedConsensusRow) -> bool:
    """Treat trailing empty rows as absent players, matching variable-size groups."""
    fields = [
        row.player_name,
        str((row.race_row or {}).get("player_name", "")),
        str((row.total_row or {}).get("player_name", "")),
    ]
    return any(str(value).strip() for value in fields)


def normalize_join_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def parse_int(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value)
    digits = "".join(re.findall(r"\d+", text))
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def collect_row_errors(rows: list[dict[str, Any]], required_fields: tuple[str, ...]) -> list[str]:
    errors: list[str] = []
    for row in rows:
        for field in required_fields:
            if not row.get(field):
                errors.append(f"row {row.get('row_index')} missing {field}")
    return errors


def write_points_transition_report(observation: LivePointsTransitionObservation) -> None:
    write_json(
        "points_transition_observation_report.json",
        {
            "selected_race_score_frame_path": observation.race_score_frame_path,
            "frame_index": observation.race_score_frame_index,
            "timestamp": observation.race_score_timestamp,
            "row_count": len(observation.rows),
            "race_points_extracted": sum(1 for row in observation.rows if row.get("race_points")),
            "failed_rows": [row for row in observation.rows if not row.get("race_points")],
            "rows": observation.rows,
            "extraction_status": observation.extraction_status,
            "extraction_errors": observation.extraction_errors,
        },
    )


def write_total_points_report(observation: LiveTotalPointsObservation) -> None:
    write_json(
        "total_points_observation_report.json",
        {
            "selected_total_score_frame_path": observation.total_score_frame_path,
            "frame_index": observation.total_score_frame_index,
            "timestamp": observation.total_score_timestamp,
            "row_count": len(observation.rows),
            "total_points_extracted": sum(1 for row in observation.rows if row.get("total_points")),
            "failed_rows": [row for row in observation.rows if not row.get("total_points")],
            "rows": observation.rows,
            "extraction_status": observation.extraction_status,
            "extraction_errors": observation.extraction_errors,
        },
    )


def write_mapping_report(joined: list[JoinedConsensusRow]) -> None:
    payload = {
        "mapping_attempts": [
            {
                "race_row_id": row.race_row_index,
                "total_row_id": row.total_row_index,
                "baseline_mapping_rule_used": row.join_method,
                "matched": row.total_row_index is not None,
                "confidence": row.join_confidence,
                "rejection_reason": "; ".join(row.validation_errors),
                "final_attached_row_result": row.to_report(),
            }
            for row in joined
        ]
    }
    write_json("race_total_mapping_report.json", payload)
    lines = [
        "# RaceScore To TotalScore Mapping Report",
        "",
        "| Race Row | Total Row | Rule | Matched | Confidence | Validation | Rejection Reason |",
        "| -------- | --------- | ---- | ------- | ---------- | ---------- | ---------------- |",
    ]
    for row in joined:
        lines.append(
            f"| {row.race_row_index} | {row.total_row_index or ''} | {row.join_method} | "
            f"{row.total_row_index is not None} | {row.join_confidence:.3f} | {row.validation_status} | "
            f"{'; '.join(row.validation_errors)} |"
        )
    write_text("race_total_mapping_report.md", "\n".join(lines) + "\n")


def write_consensus_reports(
    points_observation: LivePointsTransitionObservation,
    total_observation: LiveTotalPointsObservation,
    observation: LiveConsensusObservation,
) -> None:
    write_json(
        "consensus_rows_report.json",
        {
            "row_count": len(observation.joined_rows),
            "row_fields": [row.to_report() for row in observation.joined_rows],
            "source_screen_types": ["race_score", "total_score"],
            "confidence_values": [row.join_confidence for row in observation.joined_rows],
            "rejected_rows": [row.to_report() for row in observation.joined_rows if row.validation_status != "VALIDATED_CONSENSUS_ROW"],
            "rejection_reasons": [error for row in observation.joined_rows for error in row.validation_errors],
        },
    )
    write_json(
        "consensus_observation_report.json",
        {
            "stream_id": observation.stream_id,
            "race_sequence": observation.race_sequence,
            "RaceScore_frame_index": observation.race_score_frame_index,
            "TotalScore_frame_index": observation.total_score_frame_index,
            "number_of_RaceScore_rows": len(points_observation.rows),
            "number_of_TotalScore_rows": len(total_observation.rows),
            "number_of_mapped_rows": sum(1 for row in observation.joined_rows if row.total_row_index is not None),
            "number_of_complete_rows": len(observation.scoreboard_rows),
            "observation_validation_status": observation.validation_status,
            "validation_errors": observation.validation_errors,
            "observation": observation.to_report(),
        },
    )


def write_digit_detection_report(race_attempt: RowOcrAttempt, total_attempt: RowOcrAttempt) -> None:
    records: list[dict[str, Any]] = []
    for attempt in [race_attempt, total_attempt]:
        for row in attempt.rows:
            if attempt.screen_type == "race_score":
                fields = [("race_points", row.race_points), ("previous_total_points", row.total_points)]
            else:
                fields = [("total_points", row.total_points)]
            for field_name, result in fields:
                records.append(
                    {
                        "screen_type": attempt.screen_type,
                        "row_index": row.row_index,
                        "crop_path": result.crop_path,
                        "digit_layout_used": field_name,
                        "raw_digit_detections": result.raw_text,
                        "parsed_number": result.value,
                        "confidence": result.confidence,
                        "fallback_used": "SCORE_DIGITS_EXTRACTED" == result.status,
                        "failure_reason": result.error,
                    }
                )
    write_json("digit_detection_report.json", records)


def write_scoreboard_update_report(
    observation: LiveConsensusObservation,
    updated: bool,
    previous_hash: str,
    new_hash: str,
) -> None:
    write_json(
        "scoreboard_update_report.json",
        {
            "stream_id": observation.stream_id,
            "race_sequence_number": observation.race_sequence,
            "RaceScore_source_frame_index": observation.race_score_frame_index,
            "TotalScore_source_frame_index": observation.total_score_frame_index,
            "rows_updated": len(observation.scoreboard_rows) if updated else 0,
            "validation_status": observation.validation_status,
            "previous_scoreboard_state_hash": previous_hash,
            "new_scoreboard_state_hash": new_hash,
            "updated": updated,
        },
    )


def write_review_pack(observation: LiveConsensusObservation) -> None:
    pack = assert_write_allowed(DIAGNOSTICS_ROOT / "pass_4_consensus_review_pack")
    pack.mkdir(parents=True, exist_ok=True)
    index_path = assert_write_allowed(pack / "consensus_review_index.csv")
    fieldnames = [
        "race_row_index",
        "total_row_index",
        "player_name",
        "character_icon",
        "race_points",
        "previous_total_points",
        "total_points",
        "join_method",
        "validation_status",
        "validation_errors",
        "race_row_crop",
        "total_row_crop",
    ]
    with index_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in observation.joined_rows:
            writer.writerow(
                {
                    "race_row_index": row.race_row_index,
                    "total_row_index": row.total_row_index or "",
                    "player_name": row.player_name,
                    "character_icon": row.character_icon,
                    "race_points": row.race_points,
                    "previous_total_points": row.previous_total_points,
                    "total_points": row.total_points,
                    "join_method": row.join_method,
                    "validation_status": row.validation_status,
                    "validation_errors": "; ".join(row.validation_errors),
                    "race_row_crop": row.race_row.get("row_crop_path", ""),
                    "total_row_crop": (row.total_row or {}).get("row_crop_path", ""),
                }
            )
    html = consensus_html(observation)
    for name in [
        "points_transition_rows.html",
        "total_points_rows.html",
        "mapping_review.html",
        "consensus_rows.html",
        "rejected_rows.html",
    ]:
        (assert_write_allowed(pack / name)).write_text(html, encoding="utf-8")


def consensus_html(observation: LiveConsensusObservation) -> str:
    rows = []
    for row in observation.joined_rows:
        rows.append(
            "<tr>"
            f"<td>{row.race_row_index}</td>"
            f"<td>{row.total_row_index or ''}</td>"
            f"<td>{escape_html(row.player_name)}</td>"
            f"<td>{escape_html(row.character_icon)}</td>"
            f"<td>{escape_html(row.race_points)}</td>"
            f"<td>{escape_html(row.previous_total_points)}</td>"
            f"<td>{escape_html(row.total_points)}</td>"
            f"<td>{escape_html(row.join_method)}</td>"
            f"<td>{escape_html(row.validation_status)}</td>"
            f"<td>{escape_html('; '.join(row.validation_errors))}</td>"
            f"<td><img src='{escape_html(row.race_row.get('row_crop_path', ''))}' width='360'></td>"
            f"<td><img src='{escape_html((row.total_row or {}).get('row_crop_path', ''))}' width='360'></td>"
            "</tr>"
        )
    return (
        "<!doctype html><html><head><meta charset='utf-8'><title>Pass 4 Consensus Review</title>"
        "<style>body{font-family:Arial,sans-serif}td,th{border:1px solid #ccc;padding:4px}table{border-collapse:collapse}</style>"
        "</head><body><h1>Pass 4 Consensus Review</h1><table><thead><tr>"
        "<th>Race Row</th><th>Total Row</th><th>Name</th><th>Character</th><th>Race Points</th>"
        "<th>Previous Total</th><th>Total</th><th>Join</th><th>Status</th><th>Errors</th>"
        "<th>RaceScore crop</th><th>TotalScore crop</th></tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table></body></html>"
    )


def escape_html(value: Any) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def write_json(name: str, payload: Any) -> Path:
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(DIAGNOSTICS_ROOT / name)
    path.write_text(json.dumps(attach_run_id(payload), indent=2, sort_keys=True), encoding="utf-8")
    return path


def write_text(name: str, content: str) -> Path:
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(DIAGNOSTICS_ROOT / name)
    path.write_text(content, encoding="utf-8")
    return path
