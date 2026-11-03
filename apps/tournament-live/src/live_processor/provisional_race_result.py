"""Fast 'Latest race' (provisional) RaceScore result.

Emits ``PROVISIONAL_RACE_RESULT_*`` events from a lightweight single-frame OCR
of the already-selected RaceScore crop, so the broadcast can show the finishing
order ASAP -- before the heavy TotalScore consensus and the confirmed export.

Display-only: this NEVER feeds the Excel/tournament rows. The confirmed pair
consensus (``SCOREBOARD_UPDATED``) remains the authoritative source and runs
unchanged, so FULL_PASS is unaffected. The selected RaceScore frame is the
row-12-refined anchor, so the finishing order (incl. 12th place) is consistent
with the frame the confirmed consensus is built around.

The Qt operator console + web/OBS broadcast already consume these events
(``apply_provisional``); the forward-signal pipeline emits the same events. This
module is the shared producer so the default incremental-exact pipeline can too.
"""

from __future__ import annotations

from typing import Any

from .baseline_consensus import (
    get_race_points,
    official_visible_row_count_from_attempt,
    race_points_source_for_player_count,
)
from .baseline_row_ocr import BaselineRowOcrExtractor
from .exact_baseline_method import ExactSelectionFrame
from .gui_events import GuiEventBus


def extract_provisional_race_rows(
    extractor: BaselineRowOcrExtractor, selected: ExactSelectionFrame
) -> tuple[list[dict[str, Any]], int, dict[str, Any]]:
    """OCR the selected RaceScore crop into finishing-order rows with race points."""
    attempt = extractor.extract(
        stream_id=selected.stream_id,
        race_sequence=selected.race_sequence,
        screen_type="race_score",
        frame_index=selected.frame_index,
        timestamp=selected.timestamp,
        crop_path=selected.crop_path,
    )
    visible_player_count = official_visible_row_count_from_attempt(attempt)
    rows: list[dict[str, Any]] = []
    for row in attempt.rows[:visible_player_count]:
        report = row.to_report()
        try:
            position = int(report.get("position") or row.row_index)
        except (TypeError, ValueError):
            position = row.row_index
        race_points = get_race_points(position, visible_player_count)
        if race_points is not None:
            report["race_points"] = str(race_points)
            report["race_points_source"] = race_points_source_for_player_count(visible_player_count)
            report["player_count_for_scoring"] = str(visible_player_count)
        rows.append(report)
    return rows, visible_player_count, attempt.summary


def emit_provisional_race_result(
    *,
    event_bus: GuiEventBus,
    source_id: str,
    stream_label: str,
    selected: ExactSelectionFrame,
    extractor: BaselineRowOcrExtractor,
) -> None:
    """Run provisional RaceScore OCR and emit the OCR_STARTED/UPDATED/FAILED events."""
    event_bus.emit(
        "PROVISIONAL_RACE_RESULT_OCR_STARTED",
        source_id=source_id,
        stream_label=stream_label,
        timestamp=selected.timestamp,
        frame_index=selected.frame_index,
        race_sequence=selected.race_sequence,
        message="RaceScore OCR running for provisional race outcome",
        data={"crop_path": str(selected.crop_path), "selection_reason": selected.selection_reason},
    )
    try:
        rows, visible_player_count, summary = extract_provisional_race_rows(extractor, selected)
        event_bus.emit(
            "PROVISIONAL_RACE_RESULT_UPDATED",
            source_id=source_id,
            stream_label=stream_label,
            timestamp=selected.timestamp,
            frame_index=selected.frame_index,
            race_sequence=selected.race_sequence,
            message=f"provisional RaceScore result extracted: {len(rows)} visible rows",
            data={
                "rows": rows,
                "summary": summary,
                "visible_player_count": visible_player_count,
                "crop_path": str(selected.crop_path),
                "source_status": "provisional_race_score_only",
            },
        )
    except Exception as exc:  # noqa: BLE001 - provisional path must never break the worker
        event_bus.emit(
            "PROVISIONAL_RACE_RESULT_FAILED",
            source_id=source_id,
            stream_label=stream_label,
            timestamp=selected.timestamp,
            frame_index=selected.frame_index,
            race_sequence=selected.race_sequence,
            message=f"provisional RaceScore OCR failed: {exc}",
            data={"crop_path": str(selected.crop_path), "error": str(exc)},
        )
