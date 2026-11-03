from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .performance import PerformanceTracker


@dataclass(frozen=True)
class DetectionEvent:
    stream_id: str
    video_path: str
    frame_index: int
    timestamp: float
    screen_type: str
    confidence: float
    complete: bool
    event_id: str
    reason: str = ""
    features: dict[str, float] | None = None
    crop_path: Path | None = None


class DetectionStateMachine:
    def __init__(self, tracker: PerformanceTracker, min_confidence: float = 0.75) -> None:
        self.tracker = tracker
        self.min_confidence = min_confidence
        self._accepted: dict[str, set[str]] = {}

    def process_candidate(self, event: DetectionEvent) -> DetectionEvent | None:
        with self.tracker.track("detection.process_candidate", stream_id=event.stream_id):
            accepted_for_stream = self._accepted.setdefault(event.stream_id, set())
            is_accepted = (
                event.complete
                and event.confidence >= self.min_confidence
                and event.event_id not in accepted_for_stream
            )
            self.tracker.record_detection(
                stream_id=event.stream_id,
                frame_index=event.frame_index,
                timestamp_value=event.timestamp,
                screen_type=event.screen_type,
                confidence=event.confidence,
                complete=event.complete,
                accepted=is_accepted,
                crop_path=str(event.crop_path or ""),
                reason=event.reason,
            )
            if not is_accepted:
                return None
            accepted_for_stream.add(event.event_id)
            return event


class FrameScoreScreenDetector:
    def __init__(self, tracker: PerformanceTracker, min_confidence: float = 0.72) -> None:
        self.tracker = tracker
        self.min_confidence = min_confidence

    def analyze_frame(
        self,
        *,
        stream_id: str,
        video_path: Path,
        frame_index: int,
        timestamp: float,
        frame: Any,
    ) -> DetectionEvent | None:
        with self.tracker.track("detection.analyze_frame", stream_id=stream_id):
            features = frame_features(frame)
            confidence = score_features(features)
            if confidence < self.min_confidence:
                self.tracker.record_detection(
                    stream_id=stream_id,
                    frame_index=frame_index,
                    timestamp_value=timestamp,
                    screen_type="none",
                    confidence=confidence,
                    complete=False,
                    accepted=False,
                    reason="feature_score_below_threshold",
                )
                return None
            crop_path = write_detection_crop(stream_id, frame_index, frame)
            screen_type = "total_score" if features["bottom_edge_density"] >= features["top_edge_density"] else "race_score"
            reason = (
                f"edge_density={features['edge_density']:.4f}; "
                f"bottom_edge_density={features['bottom_edge_density']:.4f}; "
                f"noise_score={features['noise_score']:.4f}"
            )
            return DetectionEvent(
                stream_id=stream_id,
                video_path=str(video_path),
                frame_index=frame_index,
                timestamp=timestamp,
                screen_type=screen_type,
                confidence=confidence,
                complete=True,
                event_id=f"{stream_id}:{screen_type}:{frame_index // 300}",
                reason=reason,
                features=features,
                crop_path=crop_path,
            )


def frame_features(frame: Any) -> dict[str, float]:
    import cv2  # type: ignore
    import numpy as np  # type: ignore

    if frame is None:
        return {
            "brightness": 0.0,
            "stddev": 0.0,
            "edge_density": 0.0,
            "top_edge_density": 0.0,
            "bottom_edge_density": 0.0,
            "noise_score": 1.0,
            "horizontal_structure": 0.0,
        }
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    height = gray.shape[0]
    edges = cv2.Canny(gray, 80, 160)
    edge_density = float(np.count_nonzero(edges) / edges.size)
    top = edges[: max(1, height // 3), :]
    bottom = edges[(height * 2) // 3 :, :]
    row_strength = np.mean(edges > 0, axis=1)
    horizontal_structure = float(np.percentile(row_strength, 95) - np.percentile(row_strength, 50))
    return {
        "brightness": float(np.mean(gray)),
        "stddev": float(np.std(gray)),
        "edge_density": edge_density,
        "top_edge_density": float(np.count_nonzero(top) / top.size),
        "bottom_edge_density": float(np.count_nonzero(bottom) / bottom.size),
        "noise_score": float(edge_density if edge_density > 0.30 else 0.0),
        "horizontal_structure": horizontal_structure,
    }


def score_features(features: dict[str, float]) -> float:
    if features["brightness"] < 18 or features["stddev"] < 8:
        return 0.0
    if features["noise_score"] > 0.0:
        return 0.0
    edge = features["edge_density"]
    if edge < 0.025 or edge > 0.24:
        return 0.0
    edge_score = min(1.0, edge / 0.09)
    structure_score = min(1.0, features["horizontal_structure"] / 0.08)
    bottom_bias = min(1.0, features["bottom_edge_density"] / max(features["top_edge_density"], 0.001))
    return max(0.0, min(1.0, 0.45 * edge_score + 0.35 * structure_score + 0.20 * bottom_bias))


def write_detection_crop(stream_id: str, frame_index: int, frame: Any) -> Path:
    import cv2  # type: ignore

    height, width = frame.shape[:2]
    crop = frame[height // 4 : height, 0:width]
    root = DIAGNOSTICS_ROOT / "frame_debug" / "detection_crops"
    root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(crop.tobytes()).hexdigest()[:12]
    path = assert_write_allowed(root / f"{stream_id}_{frame_index}_{digest}.jpg")
    cv2.imwrite(str(path), crop)
    return path
