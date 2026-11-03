from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2  # type: ignore

from .baseline_consensus import get_race_points
from .live_frame_bundles import LiveBundleRaceGroup
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .shared_export_characters import apply_export_field_reader



from mk8dx_tournament_extraction.engine.extract_common import extract_exported_frame_number  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction.engine.extract_score_screen_selection import is_static_gallery_race_bundle  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction.engine.ocr_name_matching import preprocess_name, weighted_similarity  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction.engine.ocr_scoreboard_consensus import build_consensus_observation  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction.engine.score_layouts import score_layout_id_from_filename  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction.engine.extract_text import extract_player_names_batched  # type: ignore  # noqa: E402


class StaticGalleryRaceError(Exception):
    """Raised when a RaceScore bundle is effectively a static gallery view, not a
    real race — the original's defence against scoring a race opened in the gallery
    (``is_static_gallery_race_bundle``). The live consensus skips these bundles."""

    def __init__(self, stream_id: str, race_sequence: int, similarity: Any) -> None:
        self.stream_id = stream_id
        self.race_sequence = race_sequence
        self.similarity = similarity
        super().__init__(f"static gallery RaceScore bundle for {stream_id} race {race_sequence}")


def _static_gallery_filter_disabled() -> bool:
    # Mirrors extract_frames.DISABLE_STATIC_GALLERY_RACE_FILTER without importing it.
    return os.environ.get("MK8_DISABLE_STATIC_GALLERY_RACE_FILTER", "0").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class BaselineBundleConsensusResult:
    stream_id: str
    race_sequence: int
    race_score_frame_index: int
    total_score_frame_index: int
    race_score_timestamp: float
    total_score_timestamp: float
    consensus: dict[str, Any]
    scoreboard_rows: list[dict[str, str]]
    validation: dict[str, Any]
    duration_seconds: float
    timing: dict[str, float]
    diagnostics_path: str


def run_baseline_bundle_consensus(
    *,
    bundle_group: LiveBundleRaceGroup,
    race_entry: dict[str, Any],
    total_entry: dict[str, Any],
    stream_id: str,
    race_sequence: int,
) -> BaselineBundleConsensusResult:
    """Run the exact bundle consensus: OCR the ~7 RaceScore frames + the TotalScore
    frames to produce the confirmed finishing order and cumulative totals/Excel."""
    started = time.perf_counter()
    load_started = time.perf_counter()
    race_entries = load_race_score_entries(bundle_group)
    total_entries = load_total_score_entries(bundle_group)
    load_finished = time.perf_counter()
    if not race_entries:
        raise FileNotFoundError(f"No RaceScore bundle frames for {stream_id} race {race_sequence}")
    if not total_entries:
        raise FileNotFoundError(f"No TotalScore bundle frames for {stream_id} race {race_sequence}")

    # A RaceScore opened in the gallery is a frozen image (no points roll-up), so
    # its frames are near-identical. The original drops these; do the same here so
    # the live path never scores a race that was only viewed in the gallery.
    if not _static_gallery_filter_disabled():
        # is_static_gallery_race_bundle / summarize_first_frame_similarity expect the
        # (frame_number, frame_image) entries exactly as the original passes them —
        # not bare frames — so it can iterate `for _frame_number, frame_image in ...`.
        is_static, similarity = is_static_gallery_race_bundle(race_entries)
        if is_static:
            raise StaticGalleryRaceError(stream_id, race_sequence, similarity)

    race_context_entries = load_race_score_context_entries(bundle_group)
    preselected_anchor = None
    preselected_point_frames = None
    preselected_late_frames = None
    if race_context_entries:
        mid_index = len(race_context_entries) // 2
        preselected_anchor = int(race_context_entries[mid_index][0])
        preselected_point_frames = [frame for _frame_number, frame in race_context_entries[: mid_index + 1]]
        preselected_late_frames = [frame for _frame_number, frame in race_context_entries[mid_index:]]

    score_layout_id = detect_score_layout_id(bundle_group, race_entry, total_entry)
    consensus_started = time.perf_counter()
    consensus = build_consensus_observation(
        [frame for _frame_number, frame in race_entries],
        [frame for _frame_number, frame in total_entries],
        extract_player_names_batched,
        preprocess_name,
        weighted_similarity,
        frame_numbers=[frame_number for frame_number, _frame in race_entries],
        annotate_path=None,
        total_annotate_path=None,
        annotate_paths=None,
        total_annotate_paths=None,
        video_context=bundle_group.video_label,
        race_id_number=race_sequence,
        is_low_res=False,
        score_layout_id=score_layout_id,
        preselected_race_point_anchor_frame=preselected_anchor,
        preselected_point_frames=preselected_point_frames,
        preselected_late_frames=preselected_late_frames,
        character_match_mode="raw_stateless",
    )
    consensus_finished = time.perf_counter()
    lobby_frame = (cv2.imread(str(bundle_group.track_name_path))
                   if bundle_group.track_name_path is not None and bundle_group.track_name_path.is_file() else None)
    field_reader = apply_export_field_reader(
        consensus, [frame for _frame_number, frame in race_entries], score_layout_id, lobby_frame)
    field_reader_finished = time.perf_counter()
    race_frame_index = int(race_entry.get("frame_index") or race_entries[len(race_entries) // 2][0])
    total_frame_index = int(
        total_entry.get("frame_index")
        or total_entries[len(total_entries) // 2][0]
    )
    scoreboard_rows, validation = baseline_consensus_to_scoreboard_rows(
        consensus=consensus,
        stream_id=stream_id,
        race_sequence=race_sequence,
        race_score_frame_index=race_frame_index,
        total_score_frame_index=total_frame_index,
    )
    validation["fieldReader"] = field_reader
    finished = time.perf_counter()
    diagnostics_path = consensus_job_report_path(stream_id, race_sequence)
    result = BaselineBundleConsensusResult(
        stream_id=stream_id,
        race_sequence=race_sequence,
        race_score_frame_index=race_frame_index,
        total_score_frame_index=total_frame_index,
        race_score_timestamp=float(race_entry.get("timestamp") or 0.0),
        total_score_timestamp=float(total_entry.get("timestamp") or 0.0),
        consensus=consensus,
        scoreboard_rows=scoreboard_rows,
        validation=validation,
        duration_seconds=round(finished - started, 3),
        timing={
            "frame_loading_seconds": round(load_finished - load_started, 3),
            "baseline_consensus_seconds": round(consensus_finished - consensus_started, 3),
            "field_reader_seconds": round(field_reader_finished - consensus_finished, 3),
            "row_conversion_seconds": round(finished - field_reader_finished, 3),
        },
        diagnostics_path=str(diagnostics_path),
    )
    write_baseline_bundle_ocr_report(result)
    return result


def load_race_score_entries(bundle_group: LiveBundleRaceGroup) -> list[tuple[int, Any]]:
    paths = list(bundle_group.race_score_context_paths)
    if not paths and bundle_group.race_score_anchor_path is not None:
        paths = [bundle_group.race_score_anchor_path]
    return load_numbered_frames(paths)


def load_race_score_context_entries(bundle_group: LiveBundleRaceGroup) -> list[tuple[int, Any]]:
    return load_numbered_frames(bundle_group.race_score_context_paths)


def load_total_score_entries(bundle_group: LiveBundleRaceGroup) -> list[tuple[int, Any]]:
    paths = list(bundle_group.total_score_consensus_paths)
    if not paths and bundle_group.total_score_anchor_path is not None:
        paths = [bundle_group.total_score_anchor_path]
    return load_numbered_frames(paths)


def load_numbered_frames(paths: list[Path]) -> list[tuple[int, Any]]:
    entries: list[tuple[int, Any]] = []
    for path in sorted(paths, key=frame_number_from_path):
        frame = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if frame is None:
            continue
        frame_number = frame_number_from_path(path)
        if frame_number < 0:
            continue
        entries.append((frame_number, frame))
    return entries


def frame_number_from_path(path: Path) -> int:
    value = extract_exported_frame_number(path.stem)
    if value >= 0:
        return int(value)
    for pattern in (r"Race_\d+_F(\d+)", r"anchor_(\d+)", r"frame_(\d+)"):
        match = re.search(pattern, path.stem)
        if match:
            return int(match.group(1))
    return -1


def detect_score_layout_id(
    bundle_group: LiveBundleRaceGroup,
    race_entry: dict[str, Any],
    total_entry: dict[str, Any],
) -> str:
    for path in [
        bundle_group.race_score_anchor_path,
        *bundle_group.race_score_context_paths,
        bundle_group.total_score_anchor_path,
    ]:
        if path is None:
            continue
        layout = score_layout_id_from_filename(path)
        if layout:
            return str(layout)
    return str(race_entry.get("layout_id") or total_entry.get("layout_id") or "lan2_split_2p")


def baseline_consensus_to_scoreboard_rows(
    *,
    consensus: dict[str, Any],
    stream_id: str,
    race_sequence: int,
    race_score_frame_index: int,
    total_score_frame_index: int,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    rows = list(consensus.get("rows") or [])
    num_players = len(rows)
    scoreboard_rows: list[dict[str, str]] = []
    review_count = 0
    rejected: list[dict[str, Any]] = []
    for row in rows:
        position = parse_int(row.get("RacePosition"))
        race_points = get_race_points(position, num_players) if position else None
        detected_old = parse_int(row.get("DetectedOldTotalScore"))
        detected_new = parse_int(row.get("DetectedNewTotalScore") or row.get("DetectedTotalScore"))
        detected_race = parse_int(row.get("DetectedRacePoints"))
        player_name = str(row.get("PlayerName") or "").strip()
        character = str(row.get("Character") or "").strip()
        errors: list[str] = []
        review_reasons: list[str] = []
        if not position:
            errors.append("missing RacePosition")
        if race_points is None:
            errors.append("missing computed race points")
        if not player_name:
            errors.append("missing PlayerName")
        if not character:
            errors.append("missing Character")
        old_total = detected_old
        if old_total is None and int(race_sequence) <= 1:
            old_total = 0
        authoritative_total = None
        if old_total is not None and race_points is not None:
            authoritative_total = old_total + race_points
        elif detected_new is not None:
            authoritative_total = detected_new
        if authoritative_total is None:
            errors.append("missing NewTotalScore")
        if detected_new is not None and authoritative_total is not None and detected_new != authoritative_total:
            review_reasons.append(f"total_score_mismatch: expected {authoritative_total}, OCR {detected_new}")
        if errors:
            rejected.append({"row": row, "errors": errors})
            continue
        if review_reasons:
            review_count += 1
        method = str(row.get("CharacterMatchMethod") or "")
        shared = method.startswith("shared_field_")
        scoreboard_rows.append(
            {
                # A shared field decision is carried so later post-steps cannot
                # rewrite it (shared_export_characters.reassert_shared_characters).
                **({"SharedFieldCharacter": character,
                    "SharedFieldCharacterIndex": str(row.get("CharacterIndex")),
                    "SharedFieldMethod": method,
                    "CharacterLegacy": str(row.get("CharacterLegacy") or "")} if shared else {}),
                "Position": str(position),
                "Character": character,
                "CharacterIndex": "" if row.get("CharacterIndex") is None else str(row.get("CharacterIndex")),
                "CharacterMatchConfidence": "0" if row.get("CharacterMatchConfidence") is None else str(row.get("CharacterMatchConfidence")),
                "CharacterMatchMethod": str(row.get("CharacterMatchMethod") or ""),
                "CharacterMatchRawBest": "" if row.get("CharacterMatchRawBest") is None else str(row.get("CharacterMatchRawBest")),
                "CharacterMatchRawMargin": "" if row.get("CharacterMatchRawMargin") is None else str(row.get("CharacterMatchRawMargin")),
                "CharacterMatchRawTop5Spread": "" if row.get("CharacterMatchRawTop5Spread") is None else str(row.get("CharacterMatchRawTop5Spread")),
                "CharacterMatchRawTop5FamilyCount": "" if row.get("CharacterMatchRawTop5FamilyCount") is None else str(row.get("CharacterMatchRawTop5FamilyCount")),
                "Player": player_name,
                "NameConfidence": "0" if row.get("NameConfidence") is None else str(row.get("NameConfidence")),
                "RacePoints": str(race_points),
                "DetectedRacePoints": "" if detected_race is None else str(detected_race),
                "DetectedRacePointsSource": str(row.get("DetectedRacePointsSource") or ""),
                "PreviousTotal": "" if old_total is None else str(old_total),
                "OldTotalScore": "" if old_total is None else str(old_total),
                "DetectedOldTotalScore": "" if detected_old is None else str(detected_old),
                "CorrectedOldTotalScore": "" if old_total is None else str(old_total),
                "Total": str(authoritative_total),
                "NewTotalRacePoint": str(authoritative_total),
                "DetectedNewTotalScore": "" if detected_new is None else str(detected_new),
                "ReviewNeeded": str(bool(review_reasons)),
                "ReviewReasonCodes": "total_score_mismatch" if review_reasons else "",
                "ReviewReason": " | ".join(review_reasons),
                "ScoreValidationStatus": "total_score_mismatch" if review_reasons else "validated",
                "stream_id": stream_id,
                "race_sequence": str(race_sequence),
                "race_score_frame_index": str(race_score_frame_index),
                "total_score_frame_index": str(total_score_frame_index),
                "join_method": str(row.get("TotalScoreMappingMethod") or ""),
                "validation_status": "VALIDATED_CONSENSUS_ROW",
            }
        )
    validation_status = "validated" if scoreboard_rows and not rejected else "partial"
    validation = {
        "race_sequence": race_sequence,
        "final_validation_status": validation_status,
        "validation_output": {
            "validated_row_count": len(scoreboard_rows),
            "input_row_count": len(rows),
            "visible_player_row_count": len(rows),
            "status": validation_status,
            "review_row_count": review_count,
        },
        "rejected_rows": rejected,
        "review_row_count": review_count,
        "score_visible_rows": consensus.get("score_visible_rows"),
        "total_visible_rows": consensus.get("total_visible_rows"),
        "row_count_confidence": consensus.get("row_count_confidence"),
        "score_count_votes": consensus.get("score_count_votes"),
        "total_count_votes": consensus.get("total_count_votes"),
        "race_point_anchor_frame": consensus.get("race_point_anchor_frame"),
    }
    return scoreboard_rows, validation


def parse_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def write_baseline_bundle_ocr_report(result: BaselineBundleConsensusResult) -> None:
    report_path = assert_write_allowed(Path(result.diagnostics_path))
    record = {
        "stream_id": result.stream_id,
        "race_sequence": result.race_sequence,
        "race_score_frame_index": result.race_score_frame_index,
        "total_score_frame_index": result.total_score_frame_index,
        "duration_seconds": result.duration_seconds,
        "timing": result.timing,
        "scoreboard_rows": len(result.scoreboard_rows),
        "validation": result.validation,
        "score_visible_rows": result.consensus.get("score_visible_rows"),
        "total_visible_rows": result.consensus.get("total_visible_rows"),
        "row_count_confidence": result.consensus.get("row_count_confidence"),
        "score_count_votes": result.consensus.get("score_count_votes"),
        "total_count_votes": result.consensus.get("total_count_votes"),
        "race_point_anchor_frame": result.consensus.get("race_point_anchor_frame"),
        "diagnostics_path": result.diagnostics_path,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(record, indent=2, sort_keys=True), encoding="utf-8")


def consensus_job_report_path(stream_id: str, race_sequence: int) -> Path:
    safe_stream = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(stream_id or "unknown")).strip("_") or "unknown"
    run_id = re.sub(
        r"[^A-Za-z0-9_.-]+",
        "_",
        str(os.environ.get("MK8DX_LIVE_RUN_ID") or os.environ.get("MK8DX_CLEAN_REPLAY_RUN_ID") or "unknown_run"),
    )
    return DIAGNOSTICS_ROOT / "pipeline_state" / "consensus_jobs" / run_id / safe_stream / f"Race_{int(race_sequence):03d}" / "baseline_exact_bundle_ocr_report.json"
