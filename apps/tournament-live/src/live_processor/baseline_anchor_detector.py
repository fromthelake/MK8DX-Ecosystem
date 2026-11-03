from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2  # type: ignore
import numpy as np  # type: ignore

from .baseline_vision import (
    TARGET_HEIGHT,
    TARGET_WIDTH,
    TemplateImage,
    load_initial_scan_templates,
    locale_race_candidates,
    match_template,
    preprocess_initial_scan_roi,
)
from .baseline_score_detector import normalize_frame_to_canvas
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed


INITIAL_SCAN_TARGETS: tuple[dict[str, object], ...] = (
    {
        "kind": "score",
        "label": "Score",
        "match_threshold": 0.3,
        "skip_seconds": 20,
        "roi": (315, 57, 52, 610),
    },
    {
        "kind": "track",
        "label": "TrackName",
        "match_threshold": 0.6,
        "skip_seconds": 0,
        "roi": (141, 607, 183, 101),
        "template_name": "track",
    },
    {
        "kind": "race",
        "label": "RaceNumber",
        "match_threshold": 0.6,
        "skip_seconds": 60,
        "roi": (540, 590, 144, 48),
        "template_name": "race",
        "alternate_matches": (
            {"roi": (640, 590, 144, 48), "template_name": "race"},
            {"roi": (694, 594, 130, 40), "template_name": "race_nl"},
        ),
    },
)

TARGET_PROCESS_INDEX = {"score": 0, "track": 1, "race": 2}


@dataclass(frozen=True)
class AnchorMatch:
    kind: str
    label: str
    matched: bool
    confidence: float
    threshold: float
    roi: tuple[int, int, int, int]
    template_name: str
    reason: str
    features: dict[str, object]
    debug_frame_path: Path | None
    crop_path: Path | None


class BaselineAnchorDetector:
    """Live-owned copy of baseline initial-scan race/track template target matching."""

    def __init__(self) -> None:
        self.templates = load_initial_scan_templates()
        self.locale_race_candidates = locale_race_candidates()

    def detect_race_anchor(
        self,
        *,
        frame: Any,
        stream_id: str,
        frame_index: int,
        write_debug: bool = False,
    ) -> AnchorMatch:
        working_frame = normalize_frame_to_canvas(frame)
        gray = cv2.cvtColor(working_frame, cv2.COLOR_BGR2GRAY)
        target = next(target for target in INITIAL_SCAN_TARGETS if target["kind"] == "race")
        confidence, rejected_as_blank, best_roi, template_name, processed_roi = self._match_initial_scan_target(gray, target)
        threshold = float(target["match_threshold"])
        matched = (not rejected_as_blank) and confidence > threshold and not np.isinf(confidence)
        crop_path = None
        debug_path = None
        if write_debug or matched:
            crop_path = write_anchor_crop(
                processed_roi=processed_roi,
                stream_id=stream_id,
                frame_index=frame_index,
                kind=str(target["kind"]),
                template_name=template_name,
            )
            debug_path = write_anchor_debug_frame(
                working_frame=working_frame,
                stream_id=stream_id,
                frame_index=frame_index,
                kind=str(target["kind"]),
                roi=best_roi,
                confidence=confidence,
                threshold=threshold,
                matched=matched,
            )
        return AnchorMatch(
            kind=str(target["kind"]),
            label=str(target["label"]),
            matched=matched,
            confidence=float(confidence),
            threshold=threshold,
            roi=best_roi,
            template_name=template_name,
            reason="baseline_initial_scan_race_template_passed" if matched else "baseline_initial_scan_race_template_below_threshold",
            features={
                "method": "baseline_initial_scan_template_matching",
                "working_canvas": [TARGET_WIDTH, TARGET_HEIGHT],
                "target_label": str(target["label"]),
                "target_roi": list(target["roi"]),
                "matched_roi": list(best_roi),
                "template_name": template_name,
                "match_threshold": threshold,
                "rejected_as_blank": rejected_as_blank,
            },
            debug_frame_path=debug_path,
            crop_path=crop_path,
        )

    def _match_initial_scan_target(
        self,
        gray_image: Any,
        target: dict[str, object],
    ) -> tuple[float, bool, tuple[int, int, int, int], str, Any]:
        best_processed_roi = None
        best_match_val = 0.0
        best_roi = tuple(target["roi"])  # type: ignore[arg-type]
        best_template_name = str(target.get("template_name", ""))
        saw_non_blank_roi = False
        candidate_matches = (
            {"roi": target["roi"], "template_name": target.get("template_name", "")},
            *tuple(target.get("alternate_matches", ())),
            *(self.locale_race_candidates if target.get("kind") == "race" else ()),
        )
        process_type = TARGET_PROCESS_INDEX[str(target["kind"])]
        for candidate in candidate_matches:
            template_name = str(candidate["template_name"])
            template = self.templates[template_name]
            roi_definition = tuple(candidate["roi"])  # type: ignore[arg-type]
            roi_x, roi_y, roi_width, roi_height = expanded_roi(gray_image, roi_definition)
            roi = gray_image[roi_y : roi_y + roi_height, roi_x : roi_x + roi_width]
            processed_roi = preprocess_initial_scan_roi(roi, process_type)
            black_pixel_percentage = np.mean(processed_roi == 0)
            if black_pixel_percentage >= 0.97:
                if best_processed_roi is None:
                    best_processed_roi = processed_roi
                continue
            saw_non_blank_roi = True
            score = match_template(processed_roi, template.gray, template.alpha_mask)
            if best_processed_roi is None or score > best_match_val:
                best_processed_roi = processed_roi
                best_match_val = float(score)
                best_roi = (roi_x, roi_y, roi_width, roi_height)
                best_template_name = template_name
        if best_processed_roi is None:
            best_processed_roi = np.zeros((1, 1), dtype=np.uint8)
        return best_match_val, not saw_non_blank_roi, best_roi, best_template_name, best_processed_roi


def expanded_roi(gray_image: Any, roi_definition: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    roi_x, roi_y, roi_width, roi_height = roi_definition
    roi_x = max(int(roi_x) - 25, 0)
    roi_y = max(int(roi_y) - 25, 0)
    roi_width = min(int(roi_width) + 50, gray_image.shape[1] - roi_x)
    roi_height = min(int(roi_height) + 50, gray_image.shape[0] - roi_y)
    return roi_x, roi_y, roi_width, roi_height


def write_anchor_crop(
    *,
    processed_roi: Any,
    stream_id: str,
    frame_index: int,
    kind: str,
    template_name: str,
) -> Path:
    root = DIAGNOSTICS_ROOT / "frame_debug" / "detection_crops"
    root.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(root / f"{stream_id}_{frame_index}_{kind}_{template_name}_roi.jpg")
    cv2.imwrite(str(path), processed_roi)
    return path


def write_anchor_debug_frame(
    *,
    working_frame: Any,
    stream_id: str,
    frame_index: int,
    kind: str,
    roi: tuple[int, int, int, int],
    confidence: float,
    threshold: float,
    matched: bool,
) -> Path:
    debug = working_frame.copy()
    x, y, w, h = roi
    color = (0, 255, 0) if matched else (0, 0, 255)
    cv2.rectangle(debug, (x, y), (x + w, y + h), color, 2)
    cv2.putText(
        debug,
        f"{kind} {confidence:.3f}/{threshold:.3f}",
        (max(0, x), max(20, y - 8)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        color,
        1,
        cv2.LINE_AA,
    )
    root = DIAGNOSTICS_ROOT / "frame_debug" / "race_anchor_debug_frames"
    root.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(root / f"{stream_id}_{frame_index}_{kind}_debug.jpg")
    cv2.imwrite(str(path), debug)
    return path
