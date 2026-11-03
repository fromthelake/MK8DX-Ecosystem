from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .baseline_row_ocr import BaselineRowOcrExtractor
from .paths import DIAGNOSTICS_ROOT, assert_read_allowed, assert_write_allowed
from .performance import PerformanceTracker


@dataclass(frozen=True)
class OcrResult:
    stream_id: str
    screen_type: str
    frame_index: int
    timestamp: float
    crop_path: Path
    raw_text: list[str]
    parsed_rows: list[dict[str, str]]
    confidence: float
    parsing_status: str
    validation_status: bool
    error_message: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class FrameOcrAdapter:
    """OCR adapter that only works from live frame/crop inputs."""

    def __init__(self, tracker: PerformanceTracker, languages: list[str] | None = None) -> None:
        self.tracker = tracker
        self.languages = languages or ["en"]
        self.row_extractor = BaselineRowOcrExtractor(self.languages)

    def read_score_screen(
        self,
        *,
        stream_id: str,
        screen_type: str,
        frame_index: int,
        timestamp: float,
        crop_path: Path,
        race_sequence: int = 0,
    ) -> OcrResult:
        with self.tracker.track("ocr.read_score_screen", stream_id=stream_id, screen_type=screen_type):
            try:
                crop_path = assert_read_allowed(crop_path)
                if not crop_path.exists():
                    raise FileNotFoundError(f"OCR crop does not exist: {crop_path}")
                attempt = self.row_extractor.extract(
                    stream_id=stream_id,
                    screen_type=screen_type,
                    frame_index=frame_index,
                    timestamp=timestamp,
                    crop_path=crop_path,
                    race_sequence=race_sequence,
                )
                ocr_result = OcrResult(
                    stream_id=stream_id,
                    screen_type=screen_type,
                    frame_index=frame_index,
                    timestamp=timestamp,
                    crop_path=crop_path,
                    raw_text=attempt.raw_text,
                    parsed_rows=attempt.validated_rows,
                    confidence=attempt.confidence,
                    parsing_status=attempt.parsing_status,
                    validation_status=attempt.validation_status,
                    error_message=attempt.error_message,
                    metadata={
                        "method": "baseline_row_level_layout_ocr",
                        "layout_id": attempt.layout_id,
                        "race_sequence": race_sequence,
                        "row_summary": attempt.summary,
                        "row_attempt_count": len(attempt.rows),
                        "validated_row_count": len(attempt.validated_rows),
                    },
                )
            except Exception as exc:
                self.tracker.record_error("ocr.read_score_screen", type(exc).__name__, str(exc), stream_id=stream_id)
                ocr_result = OcrResult(
                    stream_id=stream_id,
                    screen_type=screen_type,
                    frame_index=frame_index,
                    timestamp=timestamp,
                    crop_path=crop_path,
                    raw_text=[],
                    parsed_rows=[],
                    confidence=0.0,
                    parsing_status="failed",
                    validation_status=False,
                    error_message=str(exc),
                )
            write_ocr_diagnostic(ocr_result)
            self.tracker.record_ocr(
                stream_id=stream_id,
                screen_type=screen_type,
                frame_index=frame_index,
                crop_path=str(crop_path),
                raw_text_count=len(ocr_result.raw_text),
                parsed_row_count=len(ocr_result.parsed_rows),
                validation_status=ocr_result.validation_status,
                error=ocr_result.error_message or "",
            )
            return ocr_result


def parse_score_rows(lines: list[str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for line in lines:
        cleaned = " ".join(line.strip().split())
        if not cleaned:
            continue
        match = re.match(r"^(?P<name>.+?)\s+(?P<score>\d{1,3})$", cleaned)
        if match:
            rows.append({"Player": match.group("name").strip(), "Total": match.group("score")})
    return rows


def write_ocr_diagnostic(result: OcrResult) -> Path:
    root = DIAGNOSTICS_ROOT / "ocr_debug" / "ocr"
    root.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(root / f"{result.stream_id}_{result.frame_index}_{result.screen_type}.txt")
    text = [
        f"stream_id={result.stream_id}",
        f"screen_type={result.screen_type}",
        f"frame_index={result.frame_index}",
        f"timestamp={result.timestamp}",
        f"crop_path={result.crop_path}",
        f"confidence={result.confidence}",
        f"parsing_status={result.parsing_status}",
        f"validation_status={result.validation_status}",
        f"error_message={result.error_message or ''}",
        "raw_text:",
        *result.raw_text,
    ]
    path.write_text("\n".join(text) + "\n", encoding="utf-8")
    return path
