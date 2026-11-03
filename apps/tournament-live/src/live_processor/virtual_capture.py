from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2  # type: ignore

from .gui_events import GuiEventBus


VALID_VIDEO_SUFFIXES = {".mkv", ".mp4", ".avi"}


@dataclass
class LocalVideoVirtualCaptureSource:
    source_id: str
    display_label: str
    video_path: Path
    stream_label: str
    event_bus: GuiEventBus
    playback_speed: float = 1.0
    preview_fps: float = 6.0
    analysis_fps: float = 10.0
    frame_sink: Any | None = None
    # Capture-card tap: called with EVERY decoded frame (full framerate) so the
    # recorder captures the stream, not a transcode of the source file. Must be
    # non-blocking (it drops frames if the encoder lags) — see recording.py.
    recorder_sink: Any | None = None
    # Live-faithful selection tap: called with EVERY decoded frame (full
    # framerate) so the analysis-window buffer holds a contiguous, lossless,
    # full-resolution recent window for the validated frame selector. Like the
    # recorder tap, it must be cheap and non-blocking. Signature: (frame_index, frame).
    analysis_sink: Any | None = None
    start_frame: int = 0
    end_frame: int | None = None
    state: str = "initialized"
    current_timestamp: float = 0.0
    current_frame_index: int = 0
    latest_preview_frame: Any | None = None
    error_state: str = ""
    fps: float = 0.0
    duration: float = 0.0
    total_frames: int = 0
    frames_decoded: int = 0
    frame_hashes: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._capture: cv2.VideoCapture | None = None

    def open(self) -> None:
        if self.video_path.suffix.lower() not in VALID_VIDEO_SUFFIXES:
            raise ValueError(f"Unsupported local video type: {self.video_path}")
        capture = cv2.VideoCapture(str(self.video_path))
        if not capture.isOpened():
            self.state = "failed"
            self.error_state = f"Could not open video: {self.video_path}"
            raise RuntimeError(self.error_state)
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        self.fps = fps if fps > 0 else 30.0
        self.total_frames = total_frames
        self.duration = total_frames / self.fps if total_frames > 0 else 0.0
        self._capture = capture
        if self.start_frame > 0:
            capture.set(cv2.CAP_PROP_POS_FRAMES, int(self.start_frame))
        self.state = "ready"
        self.event_bus.emit(
            "SOURCE_STARTED",
            source_id=self.source_id,
            stream_label=self.stream_label,
            message="source ready",
            data=self.summary(),
        )

    def start(self) -> None:
        if self.state == "initialized":
            self.open()
        if self.state not in {"ready", "paused", "stopped"}:
            return
        self._stop_event.clear()
        self._pause_event.clear()
        self.state = "running"
        self._thread = threading.Thread(target=self._run, name=f"virtual-capture-{self.source_id}", daemon=True)
        self._thread.start()

    def pause(self) -> None:
        if self.state == "running":
            self._pause_event.set()
            self.state = "paused"
            self.event_bus.emit("SOURCE_PAUSED", source_id=self.source_id, stream_label=self.stream_label, timestamp=self.current_timestamp, frame_index=self.current_frame_index)

    def resume(self) -> None:
        if self.state == "paused":
            self._pause_event.clear()
            self.state = "running"
            self.event_bus.emit("SOURCE_RESUMED", source_id=self.source_id, stream_label=self.stream_label, timestamp=self.current_timestamp, frame_index=self.current_frame_index)

    def stop(self) -> None:
        self._stop_event.set()
        self._pause_event.clear()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)
        self._release()
        if self.state not in {"ended", "failed"}:
            self.state = "stopped"
            self.event_bus.emit("SOURCE_STOPPED", source_id=self.source_id, stream_label=self.stream_label, timestamp=self.current_timestamp, frame_index=self.current_frame_index)

    def wait(self, timeout: float | None = None) -> None:
        if self._thread:
            self._thread.join(timeout=timeout)

    def summary(self) -> dict[str, Any]:
        with self._lock:
            return {
                "source_id": self.source_id,
                "display_label": self.display_label,
                "video_path": str(self.video_path),
                "stream_label": self.stream_label,
                "state": self.state,
                "current_timestamp": self.current_timestamp,
                "current_frame_index": self.current_frame_index,
                "error_state": self.error_state,
                "fps": self.fps,
                "duration": self.duration,
                "playback_speed": self.playback_speed,
                "analysis_fps": self.analysis_fps,
                "start_frame": self.start_frame,
                "end_frame": self.end_frame,
                "frames_decoded": self.frames_decoded,
                "total_frames": self.total_frames,
                "frame_hashes": list(self.frame_hashes),
            }

    def _run(self) -> None:
        assert self._capture is not None
        next_preview_time = 0.0
        next_analysis_time = 0.0
        last_frame_wall = time.perf_counter()
        try:
            while not self._stop_event.is_set():
                while self._pause_event.is_set() and not self._stop_event.is_set():
                    time.sleep(0.03)
                ok, frame = self._capture.read()
                if not ok:
                    self.state = "ended"
                    self.event_bus.emit("SOURCE_ENDED", source_id=self.source_id, stream_label=self.stream_label, timestamp=self.current_timestamp, frame_index=self.current_frame_index, data=self.summary())
                    return
                frame_index = int(self._capture.get(cv2.CAP_PROP_POS_FRAMES) or 0)
                if self.end_frame is not None and frame_index > int(self.end_frame):
                    self.state = "ended"
                    self.event_bus.emit("SOURCE_ENDED", source_id=self.source_id, stream_label=self.stream_label, timestamp=self.current_timestamp, frame_index=self.current_frame_index, data=self.summary())
                    return
                timestamp = frame_index / self.fps
                with self._lock:
                    self.current_frame_index = frame_index
                    self.current_timestamp = timestamp
                    self.frames_decoded += 1
                    if len(self.frame_hashes) < 3 or frame_index >= max(1, self.total_frames - 2):
                        self.frame_hashes.append(frame_hash(frame))
                # Tap every decoded frame to the recorder (full framerate, 1x),
                # like a capture card; non-blocking and independent of analysis.
                if self.recorder_sink is not None:
                    self.recorder_sink(frame)
                # Buffer every frame losslessly for live-faithful selection.
                if self.analysis_sink is not None:
                    self.analysis_sink(frame_index, frame)
                if self.frame_sink is not None and timestamp + 1e-9 >= next_analysis_time:
                    self.frame_sink(
                        source_id=self.source_id,
                        stream_label=self.stream_label,
                        video_path=self.video_path,
                        frame_index=frame_index,
                        timestamp=timestamp,
                        frame=frame,
                    )
                    next_analysis_time = timestamp + (1.0 / max(1.0, self.analysis_fps))
                if timestamp >= next_preview_time:
                    with self._lock:
                        self.latest_preview_frame = preview_frame(frame)
                    self.event_bus.emit(
                        "FRAME_DECODED",
                        source_id=self.source_id,
                        stream_label=self.stream_label,
                        timestamp=timestamp,
                        frame_index=frame_index,
                        message="preview frame decoded",
                    )
                    next_preview_time = timestamp + (1.0 / max(1.0, self.preview_fps))
                if self.playback_speed > 0:
                    elapsed = time.perf_counter() - last_frame_wall
                    target = (1.0 / self.fps) / self.playback_speed
                    if target > elapsed:
                        time.sleep(target - elapsed)
                    last_frame_wall = time.perf_counter()
        except Exception as exc:
            self.state = "failed"
            self.error_state = str(exc)
            self.event_bus.emit("SOURCE_FAILED", source_id=self.source_id, stream_label=self.stream_label, timestamp=self.current_timestamp, frame_index=self.current_frame_index, message=str(exc), data=self.summary())
        finally:
            self._release()

    def _release(self) -> None:
        if self._capture is not None:
            self._capture.release()
            self._capture = None


def preview_frame(frame: Any, width: int = 260) -> Any:
    height = max(1, int(frame.shape[0] * (width / max(1, frame.shape[1]))))
    resized = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)


def frame_hash(frame: Any) -> str:
    sample = cv2.resize(frame, (64, 36), interpolation=cv2.INTER_AREA)
    return hashlib.sha256(sample.tobytes()).hexdigest()
