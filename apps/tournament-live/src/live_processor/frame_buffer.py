from __future__ import annotations

import hashlib
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import LiveConfig
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed


@dataclass
class FrameBufferEntry:
    stream_id: str
    video_path: str
    frame_index: int
    timestamp_seconds: float
    monotonic_received_time: float
    frame_width: int
    frame_height: int
    frame_hash: str
    analysis_frame: Any
    full_resolution_frame: Any | None = None
    compressed_full_resolution_bytes: bytes | None = None
    detection_metadata: dict[str, object] = field(default_factory=dict)
    preserved: bool = False

    @property
    def estimated_memory_bytes(self) -> int:
        total = 0
        if hasattr(self.analysis_frame, "nbytes"):
            total += int(self.analysis_frame.nbytes)
        if self.full_resolution_frame is not None and hasattr(self.full_resolution_frame, "nbytes"):
            total += int(self.full_resolution_frame.nbytes)
        if self.compressed_full_resolution_bytes is not None:
            total += len(self.compressed_full_resolution_bytes)
        return total


class RollingFrameBuffer:
    def __init__(self, stream_id: str, config: LiveConfig) -> None:
        self.stream_id = stream_id
        self.config = config
        self.entries: deque[FrameBufferEntry] = deque()
        self.total_frames_seen = 0
        self.total_frames_buffered = 0
        self.total_frames_evicted = 0
        self.total_full_resolution_frames_preserved = 0
        self.memory_pressure_events: list[dict[str, object]] = []
        self.eviction_events: list[dict[str, object]] = []
        self._last_buffered_timestamp: float | None = None

    def add_frame(self, video_path: Path, frame_index: int, timestamp_seconds: float, frame: Any) -> FrameBufferEntry | None:
        self.total_frames_seen += 1
        if not self._should_buffer(timestamp_seconds):
            return None
        analysis = downscale_frame(frame)
        compressed = compress_frame(frame)
        entry = FrameBufferEntry(
            stream_id=self.stream_id,
            video_path=str(video_path),
            frame_index=frame_index,
            timestamp_seconds=timestamp_seconds,
            monotonic_received_time=time.monotonic(),
            frame_width=int(frame.shape[1]),
            frame_height=int(frame.shape[0]),
            frame_hash=hash_frame(frame),
            analysis_frame=analysis,
            compressed_full_resolution_bytes=compressed,
        )
        self.entries.append(entry)
        self.total_frames_buffered += 1
        self._last_buffered_timestamp = timestamp_seconds
        self.evict_old(timestamp_seconds)
        self.enforce_memory_limit()
        return entry

    def preserve_frame(self, frame_index: int, frame: Any | None = None) -> None:
        for entry in self.entries:
            if entry.frame_index == frame_index:
                entry.preserved = True
                if frame is not None and entry.full_resolution_frame is None:
                    entry.full_resolution_frame = frame.copy()
                    self.total_full_resolution_frames_preserved += 1
                return

    def query_range(self, start_timestamp: float, end_timestamp: float) -> list[FrameBufferEntry]:
        return [
            entry
            for entry in self.entries
            if start_timestamp <= entry.timestamp_seconds <= end_timestamp
        ]

    def evict_old(self, newest_timestamp: float) -> None:
        cutoff = newest_timestamp - self.config.frame_buffer_seconds
        while self.entries and self.entries[0].timestamp_seconds < cutoff and not self.entries[0].preserved:
            removed = self.entries.popleft()
            self.total_frames_evicted += 1
            self.eviction_events.append(
                {"reason": "retention_seconds", "frame_index": removed.frame_index, "timestamp": removed.timestamp_seconds}
            )
        while self.entries and self.entries[0].timestamp_seconds < cutoff and self.entries[0].preserved:
            break

    def enforce_memory_limit(self) -> None:
        limit_bytes = int(self.config.frame_buffer_max_memory_mb_per_stream * 1024 * 1024)
        while self.estimated_memory_bytes() > limit_bytes:
            removable_index = next((idx for idx, entry in enumerate(self.entries) if not entry.preserved), None)
            if removable_index is None:
                self.memory_pressure_events.append({"reason": "all_entries_preserved", "memory_bytes": self.estimated_memory_bytes()})
                return
            removed = self.entries[removable_index]
            del self.entries[removable_index]
            self.total_frames_evicted += 1
            self.memory_pressure_events.append(
                {"reason": "memory_limit", "frame_index": removed.frame_index, "memory_bytes": self.estimated_memory_bytes()}
            )

    def estimated_memory_bytes(self) -> int:
        return sum(entry.estimated_memory_bytes for entry in self.entries)

    def report(self) -> dict[str, object]:
        timestamps = [entry.timestamp_seconds for entry in self.entries]
        return {
            "stream_id": self.stream_id,
            "configured_buffer_seconds": self.config.frame_buffer_seconds,
            "configured_buffer_max_fps": self.config.frame_buffer_max_fps,
            "frame_entries_currently_stored": len(self.entries),
            "total_frames_seen": self.total_frames_seen,
            "total_frames_buffered": self.total_frames_buffered,
            "total_frames_evicted": self.total_frames_evicted,
            "total_full_resolution_frames_preserved": self.total_full_resolution_frames_preserved,
            "estimated_memory_usage_mb": self.estimated_memory_bytes() / (1024 * 1024),
            "oldest_buffered_timestamp": min(timestamps) if timestamps else None,
            "newest_buffered_timestamp": max(timestamps) if timestamps else None,
            "candidate_frames_preserved": [entry.frame_index for entry in self.entries if entry.preserved],
            "memory_pressure_events": self.memory_pressure_events,
            "eviction_events": self.eviction_events[-25:],
        }

    def _should_buffer(self, timestamp_seconds: float) -> bool:
        if self._last_buffered_timestamp is None:
            return True
        min_delta = 1.0 / max(self.config.frame_buffer_max_fps, 0.001)
        return (timestamp_seconds - self._last_buffered_timestamp) >= min_delta


def downscale_frame(frame: Any, max_width: int = 640) -> Any:
    import cv2  # type: ignore

    height, width = frame.shape[:2]
    if width <= max_width:
        return frame.copy()
    scale = max_width / width
    return cv2.resize(frame, (max_width, int(height * scale)), interpolation=cv2.INTER_AREA)


def hash_frame(frame: Any) -> str:
    return hashlib.sha256(frame.tobytes()).hexdigest()


def compress_frame(frame: Any) -> bytes | None:
    try:
        import cv2  # type: ignore

        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            return None
        return bytes(encoded)
    except Exception:
        return None


def decode_compressed_frame(frame_bytes: bytes | None) -> Any | None:
    if not frame_bytes:
        return None
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore

        buffer = np.frombuffer(frame_bytes, dtype=np.uint8)
        return cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    except Exception:
        return None


def write_frame_buffer_report(buffers: list[RollingFrameBuffer]) -> Path:
    import json

    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(DIAGNOSTICS_ROOT / "frame_buffer_report.json")
    path.write_text(json.dumps([buffer.report() for buffer in buffers], indent=2, sort_keys=True), encoding="utf-8")
    return path
