"""Per-stream rolling buffer of recent full-resolution frames for live selection.

This is the live-faithful frame source for V2. Unlike the existing
:class:`~live_processor.frame_buffer.RollingFrameBuffer` (which throttles to a
few fps and stores JPEG-compressed frames -- proven to shift TotalScore frame
selection, see ``_archive/cleanup_2026-07-06/scripts/run_buffer_selection_equivalence.py``), this buffer
keeps **every** decoded frame **losslessly** (raw ndarray references) for a
bounded recent window. The validated selector needs a contiguous, full-fps,
full-resolution window: it seeks frame-by-frame and collects consensus ranges,
and the TotalScore stable-frame search is sensitive to pixel-level changes.

Sizing: the selector reads ``[anchor - 3s, anchor + 13s]`` and the confirmed
selection is event-triggered when the TotalScore settles (~anchor + 8s), so at
selection time the oldest needed frame is ~11s old; with the streaming detector
also reading this buffer, retention must be >= ~24s of frames to stay safe.
Memory is therefore ``retention_seconds * fps`` raw frames per stream -- the
price of lossless, contiguous fidelity. Feed it from the capture device's
full-rate tap.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Any

from .buffer_capture import BufferCapture


class AnalysisWindowBuffer:
    def __init__(self, stream_id: str, retention_frames: int) -> None:
        self.stream_id = stream_id
        self.retention_frames = max(1, int(retention_frames))
        self._frames: "OrderedDict[int, Any]" = OrderedDict()
        self._lock = threading.Lock()
        self.total_added = 0
        self.total_evicted = 0
        # Anchor pins: while a score anchor awaits its selection, its window
        # head must survive eviction. Live timeline worst case (late points
        # roll-up + TotalScore settle) exceeds the steady retention, and a live
        # device has no file fallback to re-read evicted frames. pin() holds
        # frames >= start_frame until unpin(); the hard cap bounds memory if a
        # pin is ever left dangling.
        self._pins: dict[int, int] = {}
        self.hard_cap_frames = self.retention_frames * 3

    def pin(self, key: int, start_frame: int) -> None:
        with self._lock:
            self._pins[int(key)] = max(0, int(start_frame))

    def unpin(self, key: int) -> None:
        with self._lock:
            self._pins.pop(int(key), None)

    def add(self, frame_index: int, frame: Any) -> None:
        """Buffer one decoded frame. ``frame`` must not be mutated by the caller
        afterwards (cv2.VideoCapture.read() returns a fresh array each call, so
        storing the reference without a copy is safe and avoids a copy cost)."""
        idx = int(frame_index)
        with self._lock:
            if idx in self._frames:
                self._frames.move_to_end(idx)
            self._frames[idx] = frame
            self.total_added += 1
            pin_floor = min(self._pins.values()) if self._pins else None
            while len(self._frames) > self.retention_frames:
                oldest = next(iter(self._frames))
                if (
                    pin_floor is not None
                    and oldest >= pin_floor
                    and len(self._frames) <= self.hard_cap_frames
                ):
                    break  # pinned window: grow (bounded) instead of evicting
                self._frames.popitem(last=False)
                self.total_evicted += 1

    def covers(self, start_frame: int, end_frame: int) -> bool:
        """True if every integer index in [start, end] is currently buffered.

        The selector reads contiguously, so a gap anywhere in the window would
        make a read fail. We require full contiguous coverage to consider the
        window safe for buffered selection.
        """
        start = max(0, int(start_frame))
        end = int(end_frame)
        if end < start:
            return False
        with self._lock:
            if not self._frames:
                return False
            keys = self._frames
            return all(i in keys for i in range(start, end + 1))

    def build_capture(self, start_frame: int, end_frame: int, fps: float) -> BufferCapture:
        """Snapshot frames in [start, end] into a :class:`BufferCapture`.

        Takes a shallow snapshot under the lock so the returned capture is stable
        even as the buffer keeps receiving/evicting frames.
        """
        start = max(0, int(start_frame))
        end = int(end_frame)
        width = height = 0
        with self._lock:
            frames = {i: self._frames[i] for i in range(start, end + 1) if i in self._frames}
        for frame in frames.values():
            if hasattr(frame, "shape") and len(frame.shape) >= 2:
                height = height or int(frame.shape[0])
                width = width or int(frame.shape[1])
                break
        return BufferCapture(frames, fps=float(fps), width=width, height=height)

    def buffered_range(self) -> tuple[int, int] | None:
        with self._lock:
            if not self._frames:
                return None
            keys = self._frames.keys()
            return (min(keys), max(keys))

    def stats(self) -> dict[str, int | str | None]:
        with self._lock:
            rng = (min(self._frames), max(self._frames)) if self._frames else None
            return {
                "stream_id": self.stream_id,
                "retention_frames": self.retention_frames,
                "buffered_frames": len(self._frames),
                "total_added": self.total_added,
                "total_evicted": self.total_evicted,
                "oldest_frame": rng[0] if rng else None,
                "newest_frame": rng[1] if rng else None,
            }


def retention_frames_for(fps: float, retention_seconds: float) -> int:
    return max(1, int(round(float(fps) * float(retention_seconds))))
