from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2  # type: ignore
import numpy as np  # type: ignore

from .baseline_vision import (
    POSITION_GATE_THRESHOLD,
    POSITION_SCAN_MIN_AVG_COEFF,
    POSITION_SCAN_MIN_PLAYERS,
    POSITION_SCAN_MIN_ROW_COEFF,
    SCORE_LAYOUTS,
    TARGET_HEIGHT,
    TARGET_WIDTH,
    ScoreLayout,
    gate_tile_roi,
    load_score_gate_templates,
    match_template,
    preprocess_score_roi,
    template_gate_tile,
    to_working_canvas,
)
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed


@dataclass(frozen=True)
class RowMatch:
    row_number: int
    best_score: float
    best_variant: str
    accepted: bool


@dataclass(frozen=True)
class ScoreScreenMatch:
    is_score_screen: bool
    confidence: float
    layout_id: str
    accepted_rows: int
    average_accepted_score: float
    row_matches: list[RowMatch]
    reason: str
    features: dict[str, object]
    crop_path: Path | None
    full_frame_debug_path: Path | None
    crop_paths: dict[str, str]


class BaselineScoreScreenDetector:
    """Live-owned detector copied from the baseline ROI/template strategy."""

    def __init__(self) -> None:
        self.templates = load_score_gate_templates()

    def detect_score_screen(
        self,
        *,
        frame: Any,
        stream_id: str,
        frame_index: int,
        candidate_type: str,
        write_debug: bool = False,
    ) -> ScoreScreenMatch:
        working_frame = normalize_frame_to_canvas(frame)
        gray = cv2.cvtColor(working_frame, cv2.COLOR_BGR2GRAY)
        best_match: ScoreScreenMatch | None = None
        for layout in SCORE_LAYOUTS.values():
            match = self._detect_layout(
                working_frame=working_frame,
                gray=gray,
                layout=layout,
                stream_id=stream_id,
                frame_index=frame_index,
                candidate_type=candidate_type,
                write_debug=write_debug,
            )
            if best_match is None or match.confidence > best_match.confidence:
                best_match = match
        assert best_match is not None
        return best_match

    def _detect_layout(
        self,
        *,
        working_frame: Any,
        gray: Any,
        layout: ScoreLayout,
        stream_id: str,
        frame_index: int,
        candidate_type: str,
        write_debug: bool,
    ) -> ScoreScreenMatch:
        row_matches: list[RowMatch] = []
        for row_number in range(1, 13):
            tile = gate_tile_roi(gray, row_number, layout)
            if tile.shape[:2] != (52, 52):
                row_matches.append(RowMatch(row_number, 0.0, "missing_roi", False))
                continue
            best_score = 0.0
            best_variant = ""
            for variant, template in self.templates.items():
                template_tile, alpha_mask = template_gate_tile(template, row_number)
                if template_tile.shape[:2] != (52, 52):
                    continue
                score = match_template(tile, template_tile, alpha_mask)
                if score > best_score:
                    best_score = score
                    best_variant = variant
            row_matches.append(
                RowMatch(
                    row_number=row_number,
                    best_score=best_score,
                    best_variant=best_variant,
                    accepted=best_score >= POSITION_GATE_THRESHOLD,
                )
            )

        accepted = [row for row in row_matches if row.accepted]
        accepted_rows = len(accepted)
        avg_score = float(np.mean([row.best_score for row in accepted])) if accepted else 0.0
        enough_rows = accepted_rows >= POSITION_SCAN_MIN_PLAYERS
        enough_avg = avg_score >= POSITION_SCAN_MIN_AVG_COEFF
        enough_individual_rows = sum(row.best_score >= POSITION_SCAN_MIN_ROW_COEFF for row in row_matches) >= POSITION_SCAN_MIN_PLAYERS
        is_score_screen = enough_rows and enough_avg and enough_individual_rows
        confidence = min(1.0, (accepted_rows / 12.0) * 0.45 + avg_score * 0.55)
        crop_path = None
        crop_paths: dict[str, str] = {}
        full_frame_path = None
        if write_debug or is_score_screen:
            crop_paths = write_score_ocr_crops(
                working_frame=working_frame,
                stream_id=stream_id,
                frame_index=frame_index,
                candidate_type=candidate_type,
                layout=layout,
            )
            crop_path = Path(crop_paths["ocr_ready_table"])
            full_frame_path = write_score_debug_frame(
                working_frame=working_frame,
                stream_id=stream_id,
                frame_index=frame_index,
                candidate_type=candidate_type,
                layout=layout,
                row_matches=row_matches,
            )
        reason = "baseline_roi_template_gate_passed" if is_score_screen else "baseline_roi_template_gate_below_threshold"
        return ScoreScreenMatch(
            is_score_screen=is_score_screen,
            confidence=confidence,
            layout_id=layout.layout_id,
            accepted_rows=accepted_rows,
            average_accepted_score=avg_score,
            row_matches=row_matches,
            reason=reason,
            features={
                "method": "baseline_roi_template_matching",
                "working_canvas": [TARGET_WIDTH, TARGET_HEIGHT],
                "layout_id": layout.layout_id,
                "score_anchor_roi": list(layout.score_anchor_roi),
                "position_gate_threshold": POSITION_GATE_THRESHOLD,
                "min_players": POSITION_SCAN_MIN_PLAYERS,
                "min_row_coeff": POSITION_SCAN_MIN_ROW_COEFF,
                "min_average_coeff": POSITION_SCAN_MIN_AVG_COEFF,
                "accepted_rows": accepted_rows,
                "average_accepted_score": avg_score,
                "row_scores": [
                    {
                        "row_number": row.row_number,
                        "best_score": row.best_score,
                        "best_variant": row.best_variant,
                        "accepted": row.accepted,
                    }
                    for row in row_matches
                ],
            },
            crop_path=crop_path,
            full_frame_debug_path=full_frame_path,
            crop_paths=crop_paths,
        )


def normalize_frame_to_canvas(frame: Any) -> Any:
    if frame is None:
        raise ValueError("frame is required for ROI/template score detection")
    height, width = frame.shape[:2]
    if width == TARGET_WIDTH and height == TARGET_HEIGHT:
        return frame
    try:
        return to_working_canvas(frame)
    except Exception:
        return cv2.resize(frame, (TARGET_WIDTH, TARGET_HEIGHT), interpolation=cv2.INTER_LINEAR)


def write_score_ocr_crops(
    *,
    working_frame: Any,
    stream_id: str,
    frame_index: int,
    candidate_type: str,
    layout: ScoreLayout,
) -> dict[str, str]:
    root = DIAGNOSTICS_ROOT / "frame_debug" / "detection_crops"
    root.mkdir(parents=True, exist_ok=True)

    paths: dict[str, str] = {}

    full_path = assert_write_allowed(root / f"{stream_id}_{frame_index}_{candidate_type}_{layout.layout_id}_full_frame.jpg")
    cv2.imwrite(str(full_path), working_frame)
    paths["full_frame"] = str(full_path)

    paths["score_anchor"] = str(
        write_named_crop(working_frame, layout.score_anchor_roi, root / f"{stream_id}_{frame_index}_{candidate_type}_{layout.layout_id}_score_anchor.jpg")
    )
    paths["scoreboard_points"] = str(
        write_named_crop(
            working_frame,
            layout.scoreboard_points_roi,
            root / f"{stream_id}_{frame_index}_{candidate_type}_{layout.layout_id}_scoreboard_points.jpg",
        )
    )
    table_roi = score_table_roi(layout)
    table_path = write_named_crop(
        working_frame,
        table_roi,
        root / f"{stream_id}_{frame_index}_{candidate_type}_{layout.layout_id}_score_table.jpg",
    )
    paths["score_table"] = str(table_path)

    row_roi = first_row_table_roi(layout)
    paths["first_row_table"] = str(
        write_named_crop(
            working_frame,
            row_roi,
            root / f"{stream_id}_{frame_index}_{candidate_type}_{layout.layout_id}_row_01.jpg",
        )
    )

    table = cv2.imread(str(table_path), cv2.IMREAD_COLOR)
    if table is None:
        table = working_frame[table_roi[1] : table_roi[1] + table_roi[3], table_roi[0] : table_roi[0] + table_roi[2]]
    gray = cv2.cvtColor(table, cv2.COLOR_BGR2GRAY)
    ocr_ready = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 17, 3)
    ocr_path = assert_write_allowed(root / f"{stream_id}_{frame_index}_{candidate_type}_{layout.layout_id}_ocr_ready_table.jpg")
    cv2.imwrite(str(ocr_path), ocr_ready)
    paths["ocr_ready_table"] = str(ocr_path)
    return paths


def write_named_crop(working_frame: Any, roi: tuple[int, int, int, int], output_path: Path) -> Path:
    x, y, w, h = roi
    crop = working_frame[y : y + h, x : x + w]
    path = assert_write_allowed(output_path)
    cv2.imwrite(str(path), crop)
    return path


def score_table_roi(layout: ScoreLayout) -> tuple[int, int, int, int]:
    x1 = min(layout.base_position_strip_roi[0][0], layout.character_roi_left, layout.player_name_coords[0][0][0])
    y1 = min(layout.scoreboard_points_roi[1], layout.player_name_coords[0][0][1])
    x2 = max(layout.total_points_coords[-1][1][0], layout.race_points_coords[-1][1][0], layout.player_name_coords[-1][1][0])
    y2 = max(layout.total_points_coords[-1][1][1], layout.player_name_coords[-1][1][1])
    return (x1, y1, x2 - x1, y2 - y1)


def first_row_table_roi(layout: ScoreLayout) -> tuple[int, int, int, int]:
    x1 = min(layout.base_position_strip_roi[0][0], layout.character_roi_left, layout.player_name_coords[0][0][0])
    y1 = min(layout.player_name_coords[0][0][1], layout.race_points_coords[0][0][1], layout.total_points_coords[0][0][1])
    x2 = max(layout.total_points_coords[0][1][0], layout.race_points_coords[0][1][0], layout.player_name_coords[0][1][0])
    y2 = max(layout.player_name_coords[0][1][1], layout.race_points_coords[0][1][1], layout.total_points_coords[0][1][1])
    return (x1, y1, x2 - x1, y2 - y1)


def write_score_debug_frame(
    *,
    working_frame: Any,
    stream_id: str,
    frame_index: int,
    candidate_type: str,
    layout: ScoreLayout,
    row_matches: list[RowMatch],
) -> Path:
    debug = working_frame.copy()
    x, y, w, h = layout.score_anchor_roi
    color = (0, 255, 0) if sum(row.accepted for row in row_matches) >= POSITION_SCAN_MIN_PLAYERS else (0, 0, 255)
    cv2.rectangle(debug, (x, y), (x + w, y + h), color, 2)
    for row in row_matches:
        ty = 46 + ((row.row_number - 1) * 52)
        row_color = (0, 255, 0) if row.accepted else (0, 0, 255)
        cv2.rectangle(debug, (x - 2, ty), (x + 50, ty + 52), row_color, 1)
        cv2.putText(
            debug,
            f"{row.best_score:.2f}",
            (x + 56, ty + 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.35,
            row_color,
            1,
            cv2.LINE_AA,
        )
    root = DIAGNOSTICS_ROOT / "frame_debug" / "baseline_score_debug_frames"
    root.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(root / f"{stream_id}_{frame_index}_{candidate_type}_{layout.layout_id}_debug.jpg")
    cv2.imwrite(str(path), debug)
    return path


def extract_score_ocr_crop(source_path: Path) -> Path:
    return source_path
