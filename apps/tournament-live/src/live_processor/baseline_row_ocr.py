from __future__ import annotations

import csv
import json
import math
import os
import re
from hashlib import sha256
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2  # type: ignore
import numpy as np  # type: ignore
from PIL import Image  # type: ignore

from .baseline_assets import imported_character_template_paths, load_imported_game_catalog
from .baseline_vision import (
    SCORE_LAYOUTS,
    TARGET_HEIGHT,
    TARGET_WIDTH,
    ScoreLayout,
    gate_tile_roi,
    load_score_gate_templates,
    match_template,
    template_gate_tile,
    to_working_canvas,
)
from .ocr_runtime import optimize_easyocr_reader, write_ocr_runtime_report
from .paths import DIAGNOSTICS_ROOT, assert_read_allowed, assert_write_allowed
from .run_context import attach_run_id


from mk8dx_icon_matcher.frame_geometry import scoreboard_frames  # noqa: E402

# The score rows from the central scoreboard frames (one copy with the score layouts).
_BOARD = scoreboard_frames()["scoreboard"]
ROW_HEIGHT = int(_BOARD["rowHeight"])
ROW_TOP = int(_BOARD["rowTop"])
CHARACTER_TOP = int(_BOARD["character"]["top"])
CHARACTER_WIDTH = int(_BOARD["character"]["width"])
CHARACTER_HEIGHT = int(_BOARD["character"]["height"])
POSITION_ACCEPT_THRESHOLD = 0.28
POSITION_PRESENT_COEFF_THRESHOLD = 0.50
POSITION_PRESENT_ROW1_COEFF_THRESHOLD = 0.30
POSITION_PRESENT_LOW_RES_COEFF_THRESHOLD = 0.35
CHARACTER_ACCEPT_THRESHOLD = 0.52
SEGMENT_LABELS_HORIZONTAL = {"top_middle", "center", "middle_bottom_edge"}
SEGMENT_LABELS_VERTICAL = {
    "left_middle",
    "right_middle",
    "left_bottom",
    "right_bottom",
    "middle_middle",
    "middle_bottom",
}
DIGIT_PATTERNS = [
    (8, {"top_middle", "left_middle", "right_middle", "center", "right_bottom", "left_bottom", "middle_bottom_edge"}),
    (0, {"top_middle", "left_middle", "right_middle", "left_bottom", "right_bottom", "middle_bottom_edge"}),
    (6, {"top_middle", "left_middle", "center", "right_bottom", "left_bottom", "middle_bottom_edge"}),
    (9, {"top_middle", "left_middle", "right_middle", "center", "right_bottom", "middle_bottom_edge"}),
    (2, {"top_middle", "right_middle", "center", "left_bottom", "middle_bottom_edge"}),
    (3, {"top_middle", "right_middle", "center", "right_bottom", "middle_bottom_edge"}),
    (5, {"top_middle", "left_middle", "center", "right_bottom", "middle_bottom_edge"}),
    (4, {"right_middle", "left_middle", "center", "right_bottom"}),
    (7, {"top_middle", "right_middle", "right_bottom"}),
    (1, {"middle_middle", "middle_bottom"}),
]
CANONICAL_SEVEN_SEGMENT_BOXES = {
    "top_middle": {"x": 28, "y": 8, "width": 17, "height": 9},
    "left_middle": {"x": 9, "y": 17, "width": 16, "height": 23},
    "middle_middle": {"x": 32, "y": 21, "width": 9, "height": 18},
    "right_middle": {"x": 51, "y": 17, "width": 15, "height": 23},
    "left_bottom": {"x": 9, "y": 57, "width": 16, "height": 23},
    "middle_bottom": {"x": 32, "y": 59, "width": 9, "height": 18},
    "right_bottom": {"x": 51, "y": 57, "width": 16, "height": 23},
    "middle_bottom_edge": {"x": 28, "y": 82, "width": 17, "height": 9},
    "center": {"x": 24, "y": 44, "width": 25, "height": 9},
}


@dataclass(frozen=True)
class CropSet:
    row: Path
    position: Path
    character: Path
    name: Path
    race_points: Path
    total_points: Path


@dataclass(frozen=True)
class FieldResult:
    value: str
    confidence: float
    status: str
    error: str = ""
    raw_text: str = ""
    crop_path: str = ""
    candidates: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class RowExtraction:
    stream_id: str
    race_sequence: int
    screen_type: str
    frame_index: int
    timestamp: float
    source_crop_path: str
    row_index: int
    row_bbox: tuple[int, int, int, int]
    row_crop_path: str
    position: FieldResult
    character: FieldResult
    name: FieldResult
    race_points: FieldResult
    total_points: FieldResult
    validation_statuses: list[str]
    validation_errors: list[str]

    @property
    def validated(self) -> bool:
        return "VALIDATED_ROW" in self.validation_statuses

    def to_report(self) -> dict[str, Any]:
        return {
            "stream_id": self.stream_id,
            "race_sequence": self.race_sequence,
            "screen_type": self.screen_type,
            "source_frame_index": self.frame_index,
            "source_timestamp": self.timestamp,
            "source_crop_path": self.source_crop_path,
            "row_index": self.row_index,
            "row_bbox": list(self.row_bbox),
            "row_crop_path": self.row_crop_path,
            "position": self.position.value,
            "character_icon": self.character.value,
            "player_name": self.name.value,
            "race_points": self.race_points.value,
            "previous_total_points": "",
            "new_total_race_points": self.total_points.value,
            "raw_name_ocr_text": self.name.raw_text,
            "raw_score_ocr_text": " ".join(v for v in [self.race_points.raw_text, self.total_points.raw_text] if v),
            "position_confidence": self.position.confidence,
            "character_confidence": self.character.confidence,
            "name_confidence": self.name.confidence,
            "score_confidence": max(self.race_points.confidence, self.total_points.confidence),
            "row_validation_status": ";".join(self.validation_statuses),
            "row_validation_errors": ";".join(self.validation_errors),
        }

    def to_scoreboard_row(self) -> dict[str, str]:
        total = self.total_points.value
        return {
            "Position": self.position.value,
            "Character": self.character.value,
            "Player": self.name.value,
            "RacePoints": self.race_points.value,
            "PreviousTotal": "",
            "Total": total,
            "NewTotalRacePoint": total,
            "stream_id": self.stream_id,
            "race_sequence": str(self.race_sequence),
            "source_frame_index": str(self.frame_index),
            "source_timestamp": f"{self.timestamp:.3f}",
        }


@dataclass(frozen=True)
class RowOcrAttempt:
    stream_id: str
    race_sequence: int
    screen_type: str
    frame_index: int
    timestamp: float
    crop_path: Path
    layout_id: str
    rows: list[RowExtraction]
    validated_rows: list[dict[str, str]]
    raw_text: list[str]
    confidence: float
    parsing_status: str
    validation_status: bool
    error_message: str | None
    summary: dict[str, Any]


class BaselineRowOcrExtractor:
    """Live-owned row extractor derived from baseline score layout and template steps."""

    def __init__(self, languages: list[str] | None = None) -> None:
        self.languages = languages or ["en"]
        self.position_templates = load_score_gate_templates()
        self.character_templates = load_character_templates()
        self.reader: Any | None = None
        self.reader_error: str | None = None
        self.shared_shadow = None
        if os.environ.get("MK8DX_TOURNAMENT_SHARED_FIELD_SHADOW") == "1":
            from .shared_field_shadow import TournamentFieldShadow
            asset_root = os.environ.get("MK8_CLEAN_ASSETS_ROOT")
            if not asset_root:
                raise ValueError("Shared field shadow needs MK8_CLEAN_ASSETS_ROOT")
            self.shared_shadow = TournamentFieldShadow(
                Path(asset_root), DIAGNOSTICS_ROOT / "shared-field-shadow.jsonl")

    def extract(
        self,
        *,
        stream_id: str,
        screen_type: str,
        frame_index: int,
        timestamp: float,
        crop_path: Path,
        race_sequence: int = 0,
    ) -> RowOcrAttempt:
        crop_path = assert_read_allowed(crop_path)
        if not crop_path.exists():
            raise FileNotFoundError(f"Selected OCR crop does not exist: {crop_path}")
        layout = layout_from_path(crop_path)
        frame, source_path = load_source_frame_for_crop(crop_path)
        working = normalize_frame(frame)
        frame_hash = sha256(working.tobytes()).hexdigest() if self.shared_shadow else ""

        rows: list[RowExtraction] = []
        row_detection_rows: list[dict[str, Any]] = []
        for row_index in range(1, 13):
            crops = write_row_crops(
                working=working,
                layout=layout,
                stream_id=stream_id,
                screen_type=screen_type,
                frame_index=frame_index,
                row_index=row_index,
            )
            row_bbox = row_bounds(layout, row_index)
            position = self.extract_position(working, layout, row_index, crops.position)
            character = self.extract_character(crops.character)
            if self.shared_shadow is not None:
                self.shared_shadow.record_row(
                    working=working, frame_hash=frame_hash, layout=layout,
                    row=row_index, character_crop_path=crops.character,
                    character_box=character_bounds(layout, row_index),
                    position_present=position_signal_is_present(position, row_index),
                    old_character=character)
            name = self.extract_name(crops.name)
            race_points = self.extract_points(working, layout, row_index, crops.race_points, "race_points")
            total_points = self.extract_points(working, layout, row_index, crops.total_points, "total_points")
            statuses, errors = validate_row(
                screen_type=screen_type,
                position=position,
                character=character,
                name=name,
                race_points=race_points,
                total_points=total_points,
            )
            row = RowExtraction(
                stream_id=stream_id,
                race_sequence=race_sequence,
                screen_type=screen_type,
                frame_index=frame_index,
                timestamp=timestamp,
                source_crop_path=str(source_path),
                row_index=row_index,
                row_bbox=row_bbox,
                row_crop_path=str(crops.row),
                position=position,
                character=character,
                name=name,
                race_points=race_points,
                total_points=total_points,
                validation_statuses=statuses,
                validation_errors=errors,
            )
            rows.append(row)
            row_detection_rows.append(
                {
                    "stream_id": stream_id,
                    "race_sequence": race_sequence,
                    "screen_type": screen_type,
                    "frame_index": frame_index,
                    "crop_path": str(source_path),
                    "row_index": row_index,
                    "row_bbox": list(row_bbox),
                    "confidence": position.confidence,
                    "debug_crop_path": str(crops.row),
                    "rejection_reasons": errors,
                }
            )

        position_guided_visible_rows = determine_position_guided_visible_rows(rows)
        official_rows = rows[:position_guided_visible_rows]
        validated = [row.to_scoreboard_row() for row in official_rows if row.validated]
        raw_text = [row.name.raw_text for row in rows if row.name.raw_text] + [
            row.total_points.raw_text for row in rows if row.total_points.raw_text
        ]
        confidence_values = [
            value
            for row in rows
            for value in [
                row.position.confidence,
                row.character.confidence,
                row.name.confidence,
                row.race_points.confidence,
                row.total_points.confidence,
            ]
            if value > 0
        ]
        confidence = float(sum(confidence_values) / len(confidence_values)) if confidence_values else 0.0
        parsing_status = "validated_rows" if validated else ("row_fields_extracted" if any_field_extracted(rows) else "row_detection_only")
        validation_status = screen_type == "total_score" and len(official_rows) > 0 and len(validated) == len(official_rows)
        error_message = None if validation_status else first_failure_reason(rows)
        summary = build_summary(
            selected_frames_processed=1,
            rows=rows,
            validation_status=validation_status,
            screen_type=screen_type,
            crop_path=str(crop_path),
            position_guided_visible_rows=position_guided_visible_rows,
        )
        attempt = RowOcrAttempt(
            stream_id=stream_id,
            race_sequence=race_sequence,
            screen_type=screen_type,
            frame_index=frame_index,
            timestamp=timestamp,
            crop_path=crop_path,
            layout_id=layout.layout_id,
            rows=rows,
            validated_rows=validated,
            raw_text=raw_text,
            confidence=confidence,
            parsing_status=parsing_status,
            validation_status=validation_status,
            error_message=error_message,
            summary=summary,
        )
        write_row_level_reports(attempt, row_detection_rows)
        write_review_pack(attempt)
        return attempt

    def extract_position(self, working: Any, layout: ScoreLayout, row_index: int, crop_path: Path) -> FieldResult:
        tile = gate_tile_roi(cv2.cvtColor(working, cv2.COLOR_BGR2GRAY), row_index, layout)
        if tile.shape[:2] != (ROW_HEIGHT, ROW_HEIGHT):
            return FieldResult("", 0.0, "REJECTED_ROW", "position ROI outside frame", crop_path=str(crop_path))
        best_position = ""
        best_score = 0.0
        best_template = ""
        candidates: list[dict[str, Any]] = []
        for variant, template in self.position_templates.items():
            for template_row in range(1, 13):
                template_tile, alpha_mask = template_gate_tile(template, template_row)
                if template_tile.shape[:2] != (ROW_HEIGHT, ROW_HEIGHT):
                    continue
                score = match_template(tile, template_tile, alpha_mask)
                candidates.append({"position": template_row, "template": variant, "confidence": score})
                if score > best_score:
                    best_score = score
                    best_position = str(template_row)
                    best_template = variant
        status = "POSITION_EXTRACTED" if best_score >= POSITION_ACCEPT_THRESHOLD else "REJECTED_ROW"
        error = "" if status == "POSITION_EXTRACTED" else "position template score below threshold"
        return FieldResult(
            best_position if status == "POSITION_EXTRACTED" else "",
            float(best_score),
            status,
            error,
            crop_path=str(crop_path),
            candidates=sorted(candidates, key=lambda item: item["confidence"], reverse=True)[:5],
            raw_text=best_template,
        )
    def extract_character(self, crop_path: Path) -> FieldResult:
        crop = cv2.imread(str(crop_path), cv2.IMREAD_COLOR)
        if crop is None:
            return FieldResult("", 0.0, "REJECTED_ROW", "character crop could not be read", crop_path=str(crop_path))
        best_value = ""
        best_score = 0.0
        top: list[dict[str, Any]] = []
        for template in self.character_templates:
            score = character_match_score(crop, template["image"], template.get("alpha"))
            item = {"character": template["name"], "template": template["path"], "confidence": score}
            top.append(item)
            if score > best_score:
                best_score = score
                best_value = template["name"]
        top = sorted(top, key=lambda item: item["confidence"], reverse=True)[:5]
        status = "CHARACTER_EXTRACTED" if best_score >= CHARACTER_ACCEPT_THRESHOLD else "REJECTED_ROW"
        error = "" if status == "CHARACTER_EXTRACTED" else "character match score below threshold"
        return FieldResult(
            best_value if status == "CHARACTER_EXTRACTED" else "",
            float(best_score),
            status,
            error,
            crop_path=str(crop_path),
            candidates=top,
        )

    def extract_name(self, crop_path: Path) -> FieldResult:
        return self._read_text(crop_path, "NAME_EXTRACTED", "name")

    def extract_points(
        self,
        working: Any,
        layout: ScoreLayout,
        row_index: int,
        crop_path: Path,
        field: str,
    ) -> FieldResult:
        crop_path = assert_read_allowed(crop_path)
        if not crop_path.exists():
            return FieldResult("", 0.0, "REJECTED_ROW", f"{field} crop does not exist", crop_path=str(crop_path))
        digit = extract_digit_field_from_frame(working, layout, row_index, field)
        status_name = "RACE_POINTS_EXTRACTED" if field == "race_points" else "TOTAL_POINTS_EXTRACTED"
        value = digit["value"]
        if value != "":
            return FieldResult(
                str(value),
                float(digit["confidence"]),
                status_name,
                "",
                str(digit["raw_output"]),
                str(crop_path),
                digit["candidates"],
            )
        text_result = self._read_text(crop_path, "SCORE_DIGITS_EXTRACTED", field)
        digits = "".join(re.findall(r"\d+", text_result.raw_text))
        if digits:
            return FieldResult(digits, text_result.confidence, status_name, "", text_result.raw_text, str(crop_path), text_result.candidates)
        reason = str(digit["failure_reason"]) or text_result.error or f"{field} digits not parsed"
        raw = str(digit["raw_output"]) if digit["raw_output"] else text_result.raw_text
        return FieldResult("", max(float(digit["confidence"]), text_result.confidence), "REJECTED_ROW", reason, raw, str(crop_path), digit["candidates"])

    def _read_text(self, crop_path: Path, success_status: str, field: str) -> FieldResult:
        crop_path = assert_read_allowed(crop_path)
        if not crop_path.exists():
            return FieldResult("", 0.0, "REJECTED_ROW", f"{field} crop does not exist", crop_path=str(crop_path))
        try:
            reader = self._get_reader()
            result = reader.readtext(str(crop_path), detail=1)
        except Exception as exc:
            return FieldResult("", 0.0, "REJECTED_ROW", f"OCR backend unavailable: {exc}", crop_path=str(crop_path))
        texts: list[str] = []
        confidences: list[float] = []
        for item in result:
            if len(item) >= 3:
                texts.append(str(item[1]))
                confidences.append(float(item[2]))
        raw = " ".join(texts).strip()
        confidence = float(sum(confidences) / len(confidences)) if confidences else 0.0
        if not raw:
            return FieldResult("", confidence, "REJECTED_ROW", f"{field} OCR returned no text", crop_path=str(crop_path))
        value = normalize_name(raw) if field == "name" else raw
        status = success_status if confidence >= 0.2 else "REJECTED_ROW"
        error = "" if status == success_status else f"{field} OCR confidence below threshold"
        return FieldResult(value if status == success_status else "", confidence, status, error, raw, str(crop_path))

    def _get_reader(self) -> Any:
        if self.reader is not None:
            return self.reader
        if self.reader_error is not None:
            raise RuntimeError(self.reader_error)
        try:
            import easyocr  # type: ignore
            import torch  # type: ignore

            gpu_requested = bool(torch.cuda.is_available())
            write_ocr_runtime_report("row_ocr_reader", gpu_requested=gpu_requested, languages=self.languages)
            self.reader = easyocr.Reader(self.languages, gpu=gpu_requested, verbose=False)
            optimize_easyocr_reader(self.reader)
            return self.reader
        except Exception as exc:
            self.reader_error = f"EasyOCR unavailable or failed to initialize: {exc}"
            raise RuntimeError(self.reader_error) from exc


def determine_position_guided_visible_rows(rows: list[RowExtraction]) -> int:
    for row in reversed(rows):
        if position_row_is_present(row):
            return row.row_index
    return 0


def position_row_is_present(row: RowExtraction) -> bool:
    return position_signal_is_present(row.position, row.row_index)


def position_signal_is_present(position: FieldResult, row_index: int) -> bool:
    if position.status != "POSITION_EXTRACTED":
        return False
    threshold = POSITION_PRESENT_ROW1_COEFF_THRESHOLD if row_index == 1 else POSITION_PRESENT_COEFF_THRESHOLD
    return float(position.confidence or 0.0) >= threshold


def layout_from_path(path: Path) -> ScoreLayout:
    name = path.name
    for layout_id, layout in SCORE_LAYOUTS.items():
        if layout_id in name:
            return layout
    return SCORE_LAYOUTS["lan2_split_2p"]


def load_source_frame_for_crop(crop_path: Path) -> tuple[Any, Path]:
    full_path = derive_peer_path(crop_path, "full_frame")
    if full_path.exists():
        image = cv2.imread(str(full_path), cv2.IMREAD_COLOR)
        if image is not None:
            return image, full_path
    table_path = derive_peer_path(crop_path, "score_table")
    if table_path.exists():
        image = cv2.imread(str(table_path), cv2.IMREAD_COLOR)
        if image is not None:
            return image, table_path
    image = cv2.imread(str(crop_path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Selected OCR image could not be read: {crop_path}")
    return image, crop_path


def derive_peer_path(crop_path: Path, target_suffix: str) -> Path:
    name = crop_path.name
    suffixes = [
        "ocr_ready_table",
        "score_table",
        "full_frame",
        "score_anchor",
        "scoreboard_points",
        "row_01",
    ]
    stem = crop_path.stem
    for suffix in suffixes:
        marker = f"_{suffix}"
        if stem.endswith(marker):
            return crop_path.with_name(stem[: -len(marker)] + f"_{target_suffix}{crop_path.suffix}")
    return crop_path.with_name(stem + f"_{target_suffix}{crop_path.suffix}")


def normalize_frame(frame: Any) -> Any:
    height, width = frame.shape[:2]
    if width == TARGET_WIDTH and height == TARGET_HEIGHT:
        return frame
    try:
        return to_working_canvas(frame)
    except Exception:
        return cv2.resize(frame, (TARGET_WIDTH, TARGET_HEIGHT), interpolation=cv2.INTER_LINEAR)


def row_bounds(layout: ScoreLayout, row_index: int) -> tuple[int, int, int, int]:
    x1 = min(layout.base_position_strip_roi[0][0], layout.character_roi_left, layout.player_name_coords[row_index - 1][0][0])
    y1 = ROW_TOP + ((row_index - 1) * ROW_HEIGHT)
    x2 = max(
        layout.total_points_coords[row_index - 1][1][0],
        layout.race_points_coords[row_index - 1][1][0],
        layout.player_name_coords[row_index - 1][1][0],
    )
    return (x1, y1, x2 - x1, ROW_HEIGHT)


def character_bounds(layout: ScoreLayout, row_index: int) -> tuple[int, int, int, int]:
    return (
        layout.character_roi_left,
        CHARACTER_TOP + ((row_index - 1) * ROW_HEIGHT),
        CHARACTER_WIDTH,
        CHARACTER_HEIGHT,
    )


def box_from_points(points: tuple[tuple[int, int], tuple[int, int]]) -> tuple[int, int, int, int]:
    return (points[0][0], points[0][1], points[1][0] - points[0][0], points[1][1] - points[0][1])


def write_row_crops(
    *,
    working: Any,
    layout: ScoreLayout,
    stream_id: str,
    screen_type: str,
    frame_index: int,
    row_index: int,
) -> CropSet:
    root = assert_write_allowed(DIAGNOSTICS_ROOT / "ocr_debug" / "ocr_row_review_pack" / "crops")
    root.mkdir(parents=True, exist_ok=True)
    prefix = f"{stream_id}_{frame_index}_{screen_type}_{layout.layout_id}_row_{row_index:02d}"
    row_path = write_crop(working, row_bounds(layout, row_index), root / f"{prefix}_row.jpg")
    pos_path = write_crop(working, position_bounds(layout, row_index), root / f"{prefix}_position.jpg")
    char_path = write_crop(working, character_bounds(layout, row_index), root / f"{prefix}_character.jpg")
    name_path = write_crop(working, box_from_points(layout.player_name_coords[row_index - 1]), root / f"{prefix}_name.jpg")
    race_path = write_crop(working, box_from_points(layout.race_points_coords[row_index - 1]), root / f"{prefix}_race_points.jpg")
    total_path = write_crop(working, box_from_points(layout.total_points_coords[row_index - 1]), root / f"{prefix}_total_points.jpg")
    return CropSet(row_path, pos_path, char_path, name_path, race_path, total_path)


def position_bounds(layout: ScoreLayout, row_index: int) -> tuple[int, int, int, int]:
    x1, _ = layout.base_position_strip_roi[0]
    x2, _ = layout.base_position_strip_roi[1]
    return (x1, ROW_TOP + ((row_index - 1) * ROW_HEIGHT), x2 - x1, ROW_HEIGHT)


def write_crop(image: Any, roi: tuple[int, int, int, int], path: Path) -> Path:
    x, y, w, h = roi
    crop = image[max(0, y) : max(0, y) + h, max(0, x) : max(0, x) + w]
    path = assert_write_allowed(path)
    cv2.imwrite(str(path), crop)
    return path


def load_character_templates() -> list[dict[str, Any]]:
    catalog = load_imported_game_catalog()
    names: dict[str, str] = {}
    for item in catalog.get("characters", []):  # type: ignore[union-attr]
        if isinstance(item, dict):
            index = item.get("characterIndex")
            name = item.get("nameUK") or item.get("nameUS") or item.get("slug")
            if index is not None and name:
                names[str(index)] = str(name)
    templates: list[dict[str, Any]] = []
    for path in imported_character_template_paths():
        if not path.stem.isdigit():
            continue
        character_index = int(path.stem)
        if character_index in {79, 80, 81}:
            continue
        path = assert_read_allowed(path)
        image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if image is None:
            continue
        stem = path.stem
        name = names.get(stem, stem)
        if image.ndim == 3 and image.shape[2] == 4:
            bgr = image[:, :, :3]
            alpha = image[:, :, 3]
        else:
            bgr = image[:, :, :3] if image.ndim == 3 else cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
            alpha = None
        templates.append({"name": name, "path": str(path), "image": bgr, "alpha": alpha, "character_index": character_index})
    return templates


def character_match_score(crop: Any, template: Any, alpha: Any | None) -> float:
    if crop.size == 0 or template.size == 0:
        return 0.0
    resized = cv2.resize(crop, (template.shape[1], template.shape[0]), interpolation=cv2.INTER_AREA)
    crop_lab = cv2.cvtColor(resized, cv2.COLOR_BGR2LAB)
    template_lab = cv2.cvtColor(template, cv2.COLOR_BGR2LAB)
    diff = cv2.absdiff(crop_lab, template_lab).astype(np.float32)
    if alpha is not None:
        mask = (alpha.astype(np.float32) / 255.0)[:, :, None]
        denom = float(np.sum(mask) * 3.0)
        if denom <= 0:
            return 0.0
        mean_diff = float(np.sum(diff * mask) / denom)
    else:
        mean_diff = float(np.mean(diff))
    return max(0.0, min(1.0, 1.0 - (mean_diff / 255.0)))


def normalize_name(raw: str) -> str:
    return " ".join(raw.strip().split())


def preprocess_image_v_channel(image: Any, threshold_value: int = 205) -> Any:
    if len(image.shape) == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    hsv_image = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    _, _, v_channel = cv2.split(hsv_image)
    _, binary_v = cv2.threshold(v_channel, threshold_value, 255, cv2.THRESH_BINARY)
    return binary_v


def crop_and_process_image(frame: Any, coordinates: list[tuple[tuple[int, int], tuple[int, int]]], image_type: str) -> list[Any]:
    cropped_images: list[Any] = []
    for (x1, y1), (x2, y2) in coordinates:
        section_img = frame[y1:y2, x1:x2]
        binary_section = preprocess_image_v_channel(section_img, 205)
        black_pixels = int(np.count_nonzero(binary_section == 0))
        white_pixels = int(np.count_nonzero(binary_section == 255))
        if white_pixels > black_pixels:
            section_img = Image.fromarray(cv2.bitwise_not(binary_section))
        else:
            section_img = Image.fromarray(binary_section)
        if image_type in {"race_points", "total_points"}:
            section_img_np = np.array(section_img)
            if len(section_img_np.shape) == 3 and section_img_np.shape[2] == 3:
                gray_image = cv2.cvtColor(section_img_np, cv2.COLOR_RGB2GRAY)
            else:
                gray_image = section_img_np
            kernel = np.ones((2, 2), np.uint8)
            dilated_image = cv2.dilate(gray_image, kernel, iterations=1)
            section_img = Image.fromarray(cv2.cvtColor(dilated_image, cv2.COLOR_GRAY2RGB))
        cropped_images.append(np.array(section_img))
    return cropped_images


def process_score_image(image_source: Any, layout: ScoreLayout) -> Any:
    image = image_source
    if image is None:
        raise ValueError("score image is required")
    processed_image = preprocess_image_v_channel(image)
    if len(processed_image.shape) == 2:
        processed_image = cv2.cvtColor(processed_image, cv2.COLOR_GRAY2BGR)
    coordinates = {
        "player_name": layout.player_name_coords,
        "race_points": layout.race_points_coords,
        "total_points": layout.total_points_coords,
    }
    for region_type, coord_list in coordinates.items():
        rois = crop_and_process_image(processed_image, coord_list, region_type)
        for roi, ((x1, y1), (x2, y2)) in zip(rois, coord_list):
            if len(roi.shape) == 2:
                roi = cv2.cvtColor(roi, cv2.COLOR_GRAY2BGR)
            processed_image[y1:y2, x1:x2] = roi
    return processed_image


def scale_coords(coords: list[tuple[int, int]], scale_factor: int) -> list[tuple[int, int]]:
    return [(int(x * scale_factor), int(y * scale_factor)) for x, y in coords]


def scale_segment_boxes(boxes: dict[str, dict[str, int]], source_box_width: int, source_box_height: int, target_box_width: int, target_box_height: int) -> dict[str, dict[str, int]]:
    scale_x = target_box_width / float(source_box_width)
    scale_y = target_box_height / float(source_box_height)
    return {
        label: {
            "x": int(round(box["x"] * scale_x)),
            "y": int(round(box["y"] * scale_y)),
            "width": max(1, int(round(box["width"] * scale_x))),
            "height": max(1, int(round(box["height"] * scale_y))),
        }
        for label, box in boxes.items()
    }


def score_digit_layout(scale_factor: int, layout: ScoreLayout) -> dict[str, tuple[Any, ...]]:
    race_digit_box = (13 * scale_factor, 19 * scale_factor)
    total_digit_box = (16 * scale_factor, 24 * scale_factor)
    race_boxes = {label: dict(box) for label, box in CANONICAL_SEVEN_SEGMENT_BOXES.items()}
    total_boxes = scale_segment_boxes(
        CANONICAL_SEVEN_SEGMENT_BOXES,
        source_box_width=race_digit_box[0],
        source_box_height=race_digit_box[1],
        target_box_width=total_digit_box[0],
        target_box_height=total_digit_box[1],
    )
    return {
        "race_points": (scale_coords(layout.race_digit_starts, scale_factor), 52 * scale_factor, race_digit_box, race_boxes, 12, 2, 1, 15),
        "total_points": (scale_coords(layout.total_digit_starts, scale_factor), 52 * scale_factor, total_digit_box, total_boxes, 12, 3, 0, 999),
    }


def segment_roi_bounds(box_top_left: tuple[int, int], point_offset: dict[str, int], label: str) -> tuple[int, int, int, int]:
    if {"x", "y", "width", "height"}.issubset(point_offset):
        return (
            box_top_left[0] + point_offset["x"],
            box_top_left[1] + point_offset["y"],
            box_top_left[0] + point_offset["x"] + point_offset["width"],
            box_top_left[1] + point_offset["y"] + point_offset["height"],
        )
    anchor_x = box_top_left[0] + point_offset["x"]
    anchor_y = box_top_left[1] + point_offset["y"]
    if label in SEGMENT_LABELS_HORIZONTAL:
        half_width = 8
        half_height = 3
    elif label in SEGMENT_LABELS_VERTICAL:
        half_width = 2
        half_height = 8
    else:
        half_width = 3
        half_height = 3
    extra_right = 12 if label in {"left_middle", "right_middle", "left_bottom", "right_bottom"} else 0
    return (anchor_x - half_width, anchor_y - half_height, anchor_x + half_width + 1 + extra_right, anchor_y + half_height + 1)


def segment_roi_stats(image: Image.Image, bounds: tuple[int, int, int, int], white_threshold: int = 180) -> dict[str, float]:
    x1, y1, x2, y2 = bounds
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(image.width, x2)
    y2 = min(image.height, y2)
    total_pixels = max(0, x2 - x1) * max(0, y2 - y1)
    if total_pixels <= 0:
        return {"white_ratio": 0.0, "black_ratio": 1.0}
    crop = np.array(image.crop((x1, y1, x2, y2)).convert("RGB"))
    white = np.all(crop > white_threshold, axis=2)
    white_pixels = int(np.count_nonzero(white))
    black_pixels = int(total_pixels - white_pixels)
    return {"white_ratio": white_pixels / total_pixels, "black_ratio": black_pixels / total_pixels}


def score_digit_candidate(segment_stats: dict[str, dict[str, float]], pattern: set[str], active_black_penalty: float) -> float:
    score = 0.0
    for label, stats in segment_stats.items():
        white_ratio = stats["white_ratio"]
        black_ratio = stats["black_ratio"]
        if label in pattern:
            score += white_ratio
            score -= black_ratio * active_black_penalty
        else:
            score += (1.0 - white_ratio) * 0.08
            score -= white_ratio * 0.45
    return score


def analyze_digit_segments(image: Image.Image, box_top_left: tuple[int, int], segment_boxes: dict[str, dict[str, int]]) -> tuple[int, dict[str, dict[str, float]], set[str], float]:
    segment_stats = {
        label: segment_roi_stats(image, segment_roi_bounds(box_top_left, offset, label))
        for label, offset in segment_boxes.items()
    }
    strong_active_labels = {label for label, stats in segment_stats.items() if stats["white_ratio"] >= 0.45}
    for digit, pattern in DIGIT_PATTERNS:
        if pattern.issubset(strong_active_labels):
            confidence = len(pattern & strong_active_labels) / max(1, len(pattern))
            return digit, segment_stats, strong_active_labels, float(confidence)
    if not strong_active_labels:
        return -1, segment_stats, strong_active_labels, 0.0
    aggregate_scores: dict[int, float] = {}
    pattern_lookup = {digit: pattern for digit, pattern in DIGIT_PATTERNS}
    method_votes: list[int] = []
    for active_black_penalty in (1.0, 2.0, 3.0):
        best_digit = -1
        best_score = float("-inf")
        for digit, pattern in DIGIT_PATTERNS:
            candidate_score = score_digit_candidate(segment_stats, pattern, active_black_penalty)
            aggregate_scores[digit] = aggregate_scores.get(digit, 0.0) + candidate_score
            if candidate_score > best_score:
                best_score = candidate_score
                best_digit = digit
        if best_digit != -1:
            method_votes.append(best_digit)
    if method_votes:
        best_digit = max(set(method_votes), key=method_votes.count)
        if method_votes.count(best_digit) >= 2:
            pattern = pattern_lookup[best_digit]
            confidence = len(pattern & strong_active_labels) / max(1, len(pattern))
            return best_digit, segment_stats, strong_active_labels, float(confidence)
    best_digit = max(aggregate_scores.items(), key=lambda item: item[1])[0]
    pattern = pattern_lookup[best_digit]
    matched_ratio = len(pattern & strong_active_labels) / max(1, len(pattern))
    return (best_digit if matched_ratio >= 0.5 else -1), segment_stats, strong_active_labels, float(matched_ratio)


def parse_detected_int(value: str) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    if re.fullmatch(r"[+-]?\d+(?:\.0+)?", text):
        return int(float(text))
    stripped = re.sub(r"[^0-9]", "", text)
    return int(stripped) if stripped else None


def extract_digit_field_from_frame(working: Any, layout: ScoreLayout, row_index: int, field: str) -> dict[str, Any]:
    processed = process_score_image(working, layout)
    processed_rgb = cv2.cvtColor(processed, cv2.COLOR_BGR2RGB)
    image = Image.fromarray(processed_rgb).convert("RGB")
    scale_factor = 5
    scaled = image.resize((image.width * scale_factor, image.height * scale_factor), Image.NEAREST)
    digit_layout = score_digit_layout(scale_factor, layout)[field]
    start_coords, row_offset, box_dims, segment_boxes, _num_rows, boxes_per_row, valid_min, valid_max = digit_layout
    y_offset = (row_index - 1) * row_offset
    row_digits: list[str] = []
    candidates: list[dict[str, Any]] = []
    has_unknown = False
    for box_index in range(boxes_per_row):
        start_x, start_y = start_coords[box_index]
        top_left = (start_x, start_y + y_offset)
        digit, segment_stats, active_labels, confidence = analyze_digit_segments(scaled, top_left, segment_boxes)
        if digit == -1:
            row_digits.append("")
            has_unknown = True
        else:
            row_digits.append(str(digit))
        candidates.append(
            {
                "box_index": box_index,
                "digit": "" if digit == -1 else str(digit),
                "confidence": confidence,
                "active_segments": sorted(active_labels),
                "segment_stats": segment_stats,
            }
        )
    raw_output = "".join(row_digits)
    numeric = parse_detected_int(raw_output)
    recognized_indices = [idx for idx, text in enumerate(row_digits) if text]
    contiguous = False
    if recognized_indices:
        first = recognized_indices[0]
        last = recognized_indices[-1]
        contiguous = all(text != "" for text in row_digits[first : last + 1])
    valid = numeric is not None and valid_min <= numeric <= valid_max and (not has_unknown or contiguous)
    confidence_values = [float(item["confidence"]) for item in candidates if item["digit"]]
    confidence = float(sum(confidence_values) / len(confidence_values)) if confidence_values else 0.0
    return {
        "value": "" if not valid else str(numeric),
        "raw_output": raw_output,
        "confidence": confidence,
        "candidates": candidates,
        "failure_reason": "" if valid else field_failure_reason(field, raw_output, numeric, valid_min, valid_max, has_unknown, contiguous),
        "method": "baseline_seven_segment_digit_rois",
    }


def field_failure_reason(field: str, raw_output: str, numeric: int | None, valid_min: int, valid_max: int, has_unknown: bool, contiguous: bool) -> str:
    if not raw_output:
        return f"{field} seven-segment digits not detected"
    if numeric is None:
        return f"{field} seven-segment output could not be parsed"
    if not (valid_min <= numeric <= valid_max):
        return f"{field} value {numeric} outside expected range {valid_min}-{valid_max}"
    if has_unknown and not contiguous:
        return f"{field} digit sequence contains non-contiguous unknown digits"
    return f"{field} digit validation failed"


def validate_row(
    *,
    screen_type: str,
    position: FieldResult,
    character: FieldResult,
    name: FieldResult,
    race_points: FieldResult,
    total_points: FieldResult,
) -> tuple[list[str], list[str]]:
    statuses = ["ROW_CROPPED"]
    errors: list[str] = []
    if position.status == "POSITION_EXTRACTED":
        statuses.append("POSITION_EXTRACTED")
    else:
        errors.append(position.error)
    if character.status == "CHARACTER_EXTRACTED":
        statuses.append("CHARACTER_EXTRACTED")
    else:
        errors.append(character.error)
    statuses.append("NAME_OCR_ATTEMPTED")
    if name.status == "NAME_EXTRACTED":
        statuses.append("NAME_EXTRACTED")
    else:
        errors.append(name.error)
    statuses.append("SCORE_DIGITS_ATTEMPTED")
    if race_points.status == "RACE_POINTS_EXTRACTED":
        statuses.append("RACE_POINTS_EXTRACTED")
    else:
        errors.append(race_points.error)
    if total_points.status == "TOTAL_POINTS_EXTRACTED":
        statuses.append("TOTAL_POINTS_EXTRACTED")
        statuses.append("NEW_TOTAL_RACE_POINTS_EXTRACTED")
    else:
        errors.append(total_points.error)
    required = {"POSITION_EXTRACTED", "NAME_EXTRACTED", "RACE_POINTS_EXTRACTED", "TOTAL_POINTS_EXTRACTED", "NEW_TOTAL_RACE_POINTS_EXTRACTED"}
    if screen_type == "total_score" and required.issubset(set(statuses)):
        statuses.append("VALIDATED_ROW")
    elif len(statuses) > 1:
        statuses.append("PARTIAL_ROW")
    else:
        statuses.append("REJECTED_ROW")
    return statuses, [error for error in errors if error]


def any_field_extracted(rows: list[RowExtraction]) -> bool:
    return any(len(row.validation_statuses) > 2 or "PARTIAL_ROW" in row.validation_statuses for row in rows)


def first_failure_reason(rows: list[RowExtraction]) -> str:
    counts: dict[str, int] = {}
    for row in rows:
        for error in row.validation_errors:
            counts[error] = counts.get(error, 0) + 1
    if not counts:
        return "no validated total-score rows"
    return max(counts.items(), key=lambda item: item[1])[0]


def build_summary(
    *,
    selected_frames_processed: int,
    rows: list[RowExtraction],
    validation_status: bool,
    screen_type: str,
    crop_path: str,
    position_guided_visible_rows: int,
) -> dict[str, Any]:
    def count_status(status: str) -> int:
        return sum(1 for row in rows if status in row.validation_statuses)

    failures: dict[str, int] = {}
    for row in rows:
        for error in row.validation_errors:
            failures[error] = failures.get(error, 0) + 1
    top_failure = max(failures.items(), key=lambda item: item[1])[0] if failures else ""
    failure_stage = classify_failure_stage(top_failure)
    return {
        "selected_frames_processed": selected_frames_processed,
        "screen_type": screen_type,
        "source_crop_path": crop_path,
        "row_regions_detected": len(rows),
        "position_guided_visible_rows": position_guided_visible_rows,
        "visible_player_count": position_guided_visible_rows,
        "positions_extracted": count_status("POSITION_EXTRACTED"),
        "characters_extracted": count_status("CHARACTER_EXTRACTED"),
        "names_ocr_attempted": count_status("NAME_OCR_ATTEMPTED"),
        "names_extracted": count_status("NAME_EXTRACTED"),
        "score_digit_attempts": count_status("SCORE_DIGITS_ATTEMPTED"),
        "race_points_extracted": count_status("RACE_POINTS_EXTRACTED"),
        "total_points_extracted": count_status("TOTAL_POINTS_EXTRACTED"),
        "new_total_race_points_extracted": count_status("NEW_TOTAL_RACE_POINTS_EXTRACTED"),
        "partial_rows": count_status("PARTIAL_ROW"),
        "validated_rows": count_status("VALIDATED_ROW"),
        "rejected_rows": count_status("REJECTED_ROW"),
        "top_failure_reason": top_failure,
        "failure_stage": failure_stage,
        "validation_status": validation_status,
    }


def classify_failure_stage(reason: str) -> str:
    text = reason.lower()
    if "roi" in text or "crop" in text:
        return "crop"
    if "ocr" in text:
        return "OCR"
    if "digits" in text:
        return "parser"
    if "threshold" in text or "score" in text:
        return "layout"
    if text:
        return "validation"
    return ""


def write_row_level_reports(attempt: RowOcrAttempt, row_detection_rows: list[dict[str, Any]]) -> None:
    write_json("row_detection_report.json", [
        {
            "stream_id": attempt.stream_id,
            "race_sequence": attempt.race_sequence,
            "screen_type": attempt.screen_type,
            "frame_id": f"{attempt.stream_id}:{attempt.frame_index}",
            "crop_path": str(attempt.crop_path),
            "detected_row_count": len(attempt.rows),
            "row_bounding_boxes": [list(row.row_bbox) for row in attempt.rows],
            "rows": row_detection_rows,
        }
    ])
    write_json(
        "position_extraction_report.json",
        [
            {
                "stream_id": row.stream_id,
                "race_sequence": row.race_sequence,
                "row_index": row.row_index,
                "position_crop_path": row.position.crop_path,
                "matched_position": row.position.value,
                "confidence": row.position.confidence,
                "template_used": row.position.raw_text,
                "candidate_matches": row.position.candidates,
                "rejection_reason": row.position.error,
            }
            for row in attempt.rows
        ],
    )
    write_json(
        "character_extraction_report.json",
        [
            {
                "stream_id": row.stream_id,
                "race_sequence": row.race_sequence,
                "row_index": row.row_index,
                "character_crop_path": row.character.crop_path,
                "matched_character": row.character.value,
                "confidence": row.character.confidence,
                "candidate_matches": row.character.candidates,
                "rejection_reason": row.character.error,
            }
            for row in attempt.rows
        ],
    )
    write_json(
        "player_name_ocr_report.json",
        [
            {
                "stream_id": row.stream_id,
                "race_sequence": row.race_sequence,
                "row_index": row.row_index,
                "name_crop_path": row.name.crop_path,
                "raw_ocr_text": row.name.raw_text,
                "normalized_name": row.name.value,
                "confidence": row.name.confidence,
                "backend_used": "easyocr",
                "preprocessing_variant": "baseline_layout_name_crop",
                "rejection_reason": row.name.error,
            }
            for row in attempt.rows
        ],
    )
    write_json(
        "score_digit_extraction_report.json",
        [
            {
                "stream_id": row.stream_id,
                "race_sequence": row.race_sequence,
                "row_index": row.row_index,
                "race_point_crop_path": row.race_points.crop_path,
                "total_point_crop_path": row.total_points.crop_path,
                "preprocessing_variant": "baseline_process_image_v_channel_scale_5",
                "extraction_method": "baseline_seven_segment_digit_rois_with_easyocr_crop_fallback",
                "raw_ocr_digit_output": " ".join(
                    value for value in [row.race_points.raw_text, row.total_points.raw_text] if value
                ),
                "parsed_race_points": row.race_points.value,
                "parsed_total_points": row.total_points.value,
                "parsed_new_total_race_points": row.total_points.value,
                "confidence": max(row.race_points.confidence, row.total_points.confidence),
                "rejection_reason": ";".join(
                    value for value in [row.race_points.error, row.total_points.error] if value
                ),
            }
            for row in attempt.rows
        ],
    )
    write_json("row_validation_report.json", [row.to_report() for row in attempt.rows])
    write_json("baseline_row_ocr_attempt_report.json", {"summary": attempt.summary, "rows": [row.to_report() for row in attempt.rows]})
    write_attempt_markdown(attempt)


def write_json(name: str, payload: Any) -> Path:
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(DIAGNOSTICS_ROOT / name)
    path.write_text(json.dumps(attach_run_id(payload), indent=2, sort_keys=True), encoding="utf-8")
    return path


def write_attempt_markdown(attempt: RowOcrAttempt) -> Path:
    path = assert_write_allowed(DIAGNOSTICS_ROOT / "baseline_row_ocr_attempt_report.md")
    lines = [
        "# Baseline Row OCR Attempt Report",
        "",
        f"- Stream: {attempt.stream_id}",
        f"- Race sequence: {attempt.race_sequence}",
        f"- Screen type: {attempt.screen_type}",
        f"- Frame index: {attempt.frame_index}",
        f"- Timestamp: {attempt.timestamp}",
        f"- Crop path: {attempt.crop_path}",
        f"- Layout: {attempt.layout_id}",
        f"- Validation status: {attempt.validation_status}",
        f"- Parsing status: {attempt.parsing_status}",
        f"- Error: {attempt.error_message or ''}",
        "",
        "## Summary",
        "",
    ]
    for key, value in attempt.summary.items():
        lines.append(f"- {key}: {value}")
    lines += ["", "## Rows", ""]
    for row in attempt.rows:
        lines.append(
            f"- Row {row.row_index}: pos={row.position.value or '-'} "
            f"char={row.character.value or '-'} name={row.name.value or '-'} "
            f"race={row.race_points.value or '-'} total={row.total_points.value or '-'} "
            f"status={','.join(row.validation_statuses)}"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def write_review_pack(attempt: RowOcrAttempt) -> None:
    root = assert_write_allowed(DIAGNOSTICS_ROOT / "ocr_debug" / "ocr_row_review_pack")
    root.mkdir(parents=True, exist_ok=True)
    index_path = assert_write_allowed(root / "row_review_index.csv")
    with index_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "stream_id",
                "race_sequence",
                "frame_index",
                "timestamp",
                "row_index",
                "source_crop",
                "position_crop",
                "character_crop",
                "name_crop",
                "race_point_crop",
                "total_point_crop",
                "position",
                "character_icon",
                "player_name",
                "race_points",
                "new_total_race_points",
                "position_confidence",
                "character_confidence",
                "name_confidence",
                "score_confidence",
                "validation_status",
                "failure_reason",
            ],
        )
        writer.writeheader()
        for row in attempt.rows:
            writer.writerow(
                {
                    "stream_id": row.stream_id,
                    "race_sequence": row.race_sequence,
                    "frame_index": row.frame_index,
                    "timestamp": row.timestamp,
                    "row_index": row.row_index,
                    "source_crop": row.row_crop_path,
                    "position_crop": row.position.crop_path,
                    "character_crop": row.character.crop_path,
                    "name_crop": row.name.crop_path,
                    "race_point_crop": row.race_points.crop_path,
                    "total_point_crop": row.total_points.crop_path,
                    "position": row.position.value,
                    "character_icon": row.character.value,
                    "player_name": row.name.value,
                    "race_points": row.race_points.value,
                    "new_total_race_points": row.total_points.value,
                    "position_confidence": f"{row.position.confidence:.4f}",
                    "character_confidence": f"{row.character.confidence:.4f}",
                    "name_confidence": f"{row.name.confidence:.4f}",
                    "score_confidence": f"{max(row.race_points.confidence, row.total_points.confidence):.4f}",
                    "validation_status": ";".join(row.validation_statuses),
                    "failure_reason": ";".join(row.validation_errors),
                }
            )
    summary_path = assert_write_allowed(root / "row_review_summary.json")
    summary_path.write_text(json.dumps(attempt.summary, indent=2, sort_keys=True), encoding="utf-8")
    html = build_review_html(attempt.rows, include_failed=False)
    failed_html = build_review_html([row for row in attempt.rows if not row.validated], include_failed=True)
    for name, content in {
        "row_contact_sheet.html": html,
        "failed_rows_contact_sheet.html": failed_html,
        "score_digit_contact_sheet.html": build_field_html(attempt.rows, "score"),
        "name_ocr_contact_sheet.html": build_field_html(attempt.rows, "name"),
        "character_match_contact_sheet.html": build_field_html(attempt.rows, "character"),
    }.items():
        assert_write_allowed(root / name).write_text(content, encoding="utf-8")


def build_review_html(rows: list[RowExtraction], include_failed: bool) -> str:
    title = "Failed Row Review" if include_failed else "Row Review"
    body = [
        "<html><head><meta charset='utf-8'><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px;vertical-align:top}img{max-height:70px}</style></head><body>",
        f"<h1>{title}</h1><table><tr><th>Row</th><th>Crop</th><th>Fields</th><th>Status</th></tr>",
    ]
    for row in rows:
        body.append(
            "<tr>"
            f"<td>{row.row_index}</td>"
            f"<td><img src='{Path(row.row_crop_path).as_posix()}'></td>"
            f"<td>pos={row.position.value or '-'}<br>char={row.character.value or '-'}<br>name={row.name.value or '-'}<br>race={row.race_points.value or '-'}<br>total={row.total_points.value or '-'}</td>"
            f"<td>{'; '.join(row.validation_statuses)}<br>{'; '.join(row.validation_errors)}</td>"
            "</tr>"
        )
    body.append("</table></body></html>")
    return "\n".join(body)


def build_field_html(rows: list[RowExtraction], field: str) -> str:
    body = [
        "<html><head><meta charset='utf-8'><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px;vertical-align:top}img{max-height:70px}</style></head><body>",
        f"<h1>{field} review</h1><table><tr><th>Row</th><th>Crop A</th><th>Crop B</th><th>Value</th><th>Confidence</th><th>Error</th></tr>",
    ]
    for row in rows:
        if field == "score":
            crop_a, crop_b = row.race_points.crop_path, row.total_points.crop_path
            value = f"race={row.race_points.value or '-'} total={row.total_points.value or '-'}"
            confidence = max(row.race_points.confidence, row.total_points.confidence)
            error = "; ".join(value for value in [row.race_points.error, row.total_points.error] if value)
        elif field == "name":
            crop_a, crop_b = row.name.crop_path, ""
            value = row.name.value or row.name.raw_text or "-"
            confidence = row.name.confidence
            error = row.name.error
        else:
            crop_a, crop_b = row.character.crop_path, ""
            value = row.character.value or "-"
            confidence = row.character.confidence
            error = row.character.error
        second = f"<img src='{Path(crop_b).as_posix()}'>" if crop_b else ""
        body.append(
            "<tr>"
            f"<td>{row.row_index}</td>"
            f"<td><img src='{Path(crop_a).as_posix()}'></td>"
            f"<td>{second}</td>"
            f"<td>{value}</td>"
            f"<td>{confidence:.4f}</td>"
            f"<td>{error}</td>"
            "</tr>"
        )
    body.append("</table></body></html>")
    return "\n".join(body)
