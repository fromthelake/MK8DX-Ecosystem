"""Real HDMI capture-card source (Windows/DirectShow via ffmpeg).

Sibling producer to :class:`~live_processor.virtual_capture.LocalVideoVirtualCaptureSource`
with the same analysis tap contract (``analysis_sink`` / ``frame_sink``
/ preview / event bus), per ``docs/real_capture_plan.md``:

- The device is opened **once**. Selecting it in the GUI opens a lightweight
  *preview* session (frames go only to the preview tile); **Start All** promotes
  the same open session to *running* (enables the analysis/recorder/frame taps).
- Frames are downscaled by ffmpeg to the pipeline's 1280x720 (full frame, no
  crop — the game is played fullscreen 16:9).
- A live device has no duration and no end: a dropped/black frame or a dead
  ffmpeg process is **never** ``SOURCE_ENDED``. Signal loss is surfaced via
  ``SOURCE_SIGNAL_LOST`` / ``SOURCE_SIGNAL_RESTORED`` events and the ffmpeg
  reader is respawned until :meth:`stop` (Runtime Isolation).

Backend: ffmpeg dshow -> raw ``bgr24`` frames over a pipe — one ffmpeg codepath
with recording, full pixel-format control, and (crucially) it can open a device
by its unique DirectShow *alternative name*, which is the only way to tell apart
multiple identical cards (e.g. three "UGREEN 35287").
"""

from __future__ import annotations

import os
import queue
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from .gui_events import GuiEventBus
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .virtual_capture import preview_frame

# Wall seconds without a decoded frame before the feed counts as signal-lost.
SIGNAL_TIMEOUT_SECONDS = 2.5
# Backoff between ffmpeg respawn attempts while the signal is lost.
RESPAWN_BACKOFF_SECONDS = 2.0
# Content box smaller than this fraction of the frame counts as "black borders"
# (playback not fullscreen / GPU overscan compensation). Detection templates
# degrade on the re-upscaled pixels, so the operator must fix it at the source.
BORDER_CLEAN_FRACTION = 0.98
# Border CALIBRATION: 1 sample/second over this window from signal-alive; the
# most common box (clustered ±4px) becomes the feed's FIXED border verdict.
# Dark frames (no geometry information) are excluded from the vote. This
# replaces continuous measurement, which flapped on dark scenes/title cards.
BORDER_CALIBRATION_SECONDS = 30.0
BORDER_CALIBRATION_MIN_SAMPLES = 5
BORDER_CALIBRATION_MAX_SECONDS = 90.0
BORDER_BOX_CLUSTER_TOLERANCE_PX = 4
BORDER_DARK_FRAME_MEAN_INTENSITY = 8.0


def usable_capture_content_box(box: dict[str, int], width: int, height: int) -> bool:
    """A uniform HDMI border preserves the full frame's game aspect ratio.

    Bright HUD fragments in a dark frame can pass the intensity threshold but
    are not a complete game image. Do not freeze one as the analysis crop.
    Allow small edge-measurement/overscan differences, not anisotropic scaling.
    """
    left, top = box["left"], box["top"]
    right, bottom = box["right"], box["bottom"]
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        return False
    relative_aspect = ((right - left) / (bottom - top)) / (width / height)
    return abs(relative_aspect - 1.0) <= 0.05


def majority_border_box(boxes: list[dict[str, int]]) -> tuple[dict[str, int], int]:
    """Cluster measured boxes (±tolerance per edge) and return the most common
    box with its vote count. Physical borders are constant; content-driven
    measurements wander, so the true chain geometry wins the vote."""
    clusters: list[tuple[dict[str, int], int]] = []
    for box in boxes:
        for index, (representative, count) in enumerate(clusters):
            if all(
                abs(box[key] - representative[key]) <= BORDER_BOX_CLUSTER_TOLERANCE_PX
                for key in ("left", "top", "right", "bottom")
            ):
                clusters[index] = (representative, count + 1)
                break
        else:
            clusters.append((dict(box), 1))
    return max(clusters, key=lambda item: item[1])


def measure_border_state(frame: Any) -> tuple[str, dict[str, int]]:
    """Detect black borders around the game content in a full frame.

    Same content-bounds principle as the vendored baseline's
    ``extract_common.find_borders`` (row/column intensity above a threshold),
    scaled to the frame size. Returns ("clean" | "borders", measured box).
    """
    import cv2  # local: keep module import light

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    row_sums = gray.sum(axis=1, dtype=np.int64)
    col_sums = gray.sum(axis=0, dtype=np.int64)
    # Baseline uses 15000 for 1280-wide rows (~12 avg intensity); scale to size.
    row_threshold = int(15000 * (width / 1280.0))
    col_threshold = int(15000 * (height / 720.0))
    top = next((i for i, v in enumerate(row_sums) if v > row_threshold), 0)
    bottom = height - next((i for i, v in enumerate(row_sums[::-1]) if v > row_threshold), 0)
    left = next((i for i, v in enumerate(col_sums) if v > col_threshold), 0)
    right = width - next((i for i, v in enumerate(col_sums[::-1]) if v > col_threshold), 0)
    box = {"left": left, "top": top, "right": right, "bottom": bottom}
    content_w = max(0, right - left)
    content_h = max(0, bottom - top)
    clean = content_w >= width * BORDER_CLEAN_FRACTION and content_h >= height * BORDER_CLEAN_FRACTION
    return ("clean" if clean else "borders"), box


class CaptureCardSource:
    def __init__(
        self,
        source_id: str,
        display_label: str,
        stream_label: str,
        event_bus: GuiEventBus,
        device_name: str,
        device_alternative_name: str = "",
        audio_device_name: str = "",
        audio_device_alternative_name: str = "",
        width: int = 1280,
        height: int = 720,
        requested_fps: float = 30.0,
        preview_fps: float = 6.0,
        analysis_fps: float = 10.0,
    ) -> None:
        self.source_id = source_id
        self.display_label = display_label
        self.stream_label = stream_label
        self.event_bus = event_bus
        self.device_name = device_name
        self.device_alternative_name = device_alternative_name
        self.audio_device_name = audio_device_name
        self.audio_device_alternative_name = audio_device_alternative_name
        self.width = int(width)
        self.height = int(height)
        self.requested_fps = float(requested_fps)
        self.preview_fps = float(preview_fps)
        self.analysis_fps = float(analysis_fps)

        # Tap contract shared with LocalVideoVirtualCaptureSource.
        self.frame_sink: Any | None = None
        self.analysis_sink: Any | None = None

        # A capture device has no file; expose a display path for manifests/GUI.
        self.video_path = Path("capture:/") / (display_label or device_name)
        self.is_capture_card = True

        self.state = "initialized"
        self.mode = "preview"  # "preview" (tile only) or "running" (all taps)
        self.error_state = ""
        self.fps = self.requested_fps  # nominal rate for buffer retention/recording
        self.measured_fps = 0.0
        self.duration = 0.0  # a live device has no known duration
        self.total_frames = 0  # nor a frame count
        self.current_frame_index = 0
        self.current_timestamp = 0.0
        self.frames_decoded = 0
        self.latest_preview_frame: Any | None = None
        # Black-border CALIBRATION: from signal-alive, 1 sample/second for
        # ~30s; the majority box becomes the FIXED verdict ("clean"/"borders").
        # Status is "calibrating" until then; recalibrates after signal loss.
        self.border_status = "calibrating"
        self.border_box: dict[str, int] | None = None
        self._calibration_samples: list[dict[str, int]] = []
        self._calibration_started_wall: float | None = None
        self._last_calibration_sample_wall = 0.0

        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._process: subprocess.Popen[bytes] | None = None
        self._decoder_process: subprocess.Popen[bytes] | None = None
        self._transport_queue: queue.Queue[bytes | None] | None = None
        self._transport_drain_thread: threading.Thread | None = None
        self._transport_feed_thread: threading.Thread | None = None
        self._direct_recording: Any | None = None
        self._analysis_drain_deadline = 0.0
        self._archive_abandoned = False
        self._recording_armed = threading.Event()
        self._last_recording_status_wall = 0.0
        self._last_frame_wall: float | None = None
        self._signal_lost_emitted = False
        self._stderr_handle: Any | None = None
        self._fps_window: list[float] = []

    # ------------------------------------------------------------- liveness
    @property
    def signal_alive(self) -> bool:
        last = self._last_frame_wall
        return last is not None and (time.perf_counter() - last) < SIGNAL_TIMEOUT_SECONDS

    # ------------------------------------------------------------ lifecycle
    def open(self) -> None:
        """Open the device in preview mode (idempotent; restartable after stop).

        Called when the operator assigns the device to a feed — the live preview
        streams immediately, before Start All. Never blocks on the device: the
        reader thread owns all ffmpeg I/O.
        """
        if self._thread is not None and self._thread.is_alive():
            return
        if not shutil.which("ffmpeg"):
            self.state = "failed"
            self.error_state = "ffmpeg was not found on PATH"
            raise RuntimeError(self.error_state)
        if self._stop_event.is_set():
            # The completed run owns its recording evidence. Reopening its device
            # must not append another working part or feed the old analysis buffer.
            self._direct_recording = None
            self._archive_abandoned = False
            self._recording_armed.clear()
            self.analysis_sink = None
            self.frame_sink = None
            self.mode = "preview"
        self._stop_event.clear()
        self._pause_event.clear()
        self.state = "ready"
        self._thread = threading.Thread(
            target=self._run, name=f"capture-card-{self.source_id}", daemon=True
        )
        self._thread.start()
        self.event_bus.emit(
            "SOURCE_STARTED",
            source_id=self.source_id,
            stream_label=self.stream_label,
            message=f"capture device preview opened: {self.device_name}",
            data=self.summary(),
        )

    def start(self) -> None:
        """Promote the already-open preview session to running (all taps live)."""
        if self._thread is None or not self._thread.is_alive():
            self.open()
        self._pause_event.clear()
        self.mode = "running"
        self.state = "running"

    def arm_recording(self, recording: Any, timeout: float = 20.0) -> None:
        """Sequentially hand the already-previewed device to archive-first FFmpeg."""
        if not self.signal_alive:
            raise RuntimeError(f"Capture signal is not ready for {self.stream_label}")
        self._direct_recording = recording
        self._archive_abandoned = False
        self._recording_armed.clear()
        self._kill_process()
        if not self._recording_armed.wait(timeout):
            error = recording.error or f"Recording did not arm for {self.stream_label}"
            self.disarm_recording()
            raise RuntimeError(error)

    def disarm_recording(self) -> None:
        """Roll a failed transactional Start back to the preview-only process."""
        self._direct_recording = None
        self._archive_abandoned = False
        self._recording_armed.clear()
        self._kill_process()

    def pause(self) -> None:
        # A live device cannot pause. Only analysis taps are suspended; the
        # recording-first FFmpeg process and preview keep running uninterrupted.
        if self.state == "running":
            self._pause_event.set()
            self.state = "paused"
            self.event_bus.emit(
                "SOURCE_PAUSED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=self.current_timestamp,
                frame_index=self.current_frame_index,
                message="capture taps suspended (device keeps streaming)",
            )

    def resume(self) -> None:
        if self.state == "paused":
            self._pause_event.clear()
            self.state = "running"
            self.event_bus.emit(
                "SOURCE_RESUMED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=self.current_timestamp,
                frame_index=self.current_frame_index,
            )

    def stop(self) -> None:
        # Close the archive now, then let already-captured analysis bytes reach
        # the scanner. The deadline bounds a stuck secondary decoder independently
        # of the archive writer's own graceful-close deadline.
        self._analysis_drain_deadline = time.monotonic() + 15.0
        self._stop_event.set()
        self._pause_event.clear()
        process = self._process
        if self._direct_recording is not None and process is not None and process.poll() is None:
            # FFmpeg's interactive quit closes Matroska normally and writes Cues.
            try:
                if process.stdin is not None:
                    process.stdin.write(b"q\n")
                    process.stdin.flush()
            except (BrokenPipeError, OSError):
                pass
        else:
            self._kill_process()  # preview reader has no artifact to finalize
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=15.0)
        if self._thread and self._thread.is_alive() and self._direct_recording is not None:
            self.event_bus.emit(
                "ANALYSIS_DRAIN_INCOMPLETE", source_id=self.source_id,
                stream_label=self.stream_label,
                message="Capture closed; the secondary decoder did not drain within the Stop deadline",
            )
        # The reader may have respawned ffmpeg between the kill and observing
        # the stop event; sweep again so no orphan keeps the device open.
        self._kill_process()
        if self._direct_recording is not None:
            self._direct_recording.stopped_at = time.time()
        if self.state != "failed":
            self.state = "stopped"
            self.event_bus.emit(
                "SOURCE_STOPPED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=self.current_timestamp,
                frame_index=self.current_frame_index,
            )

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
                "device_name": self.device_name,
                "device_alternative_name": self.device_alternative_name,
                "audio_device_name": self.audio_device_name,
                "audio_device_alternative_name": self.audio_device_alternative_name,
                "state": self.state,
                "mode": self.mode,
                "signal_alive": self.signal_alive,
                "border_status": self.border_status,
                "border_box": dict(self.border_box) if self.border_box else None,
                "current_timestamp": self.current_timestamp,
                "current_frame_index": self.current_frame_index,
                "error_state": self.error_state,
                "fps": self.fps,
                "measured_fps": round(self.measured_fps, 2),
                "analysis_fps": self.analysis_fps,
                "frames_decoded": self.frames_decoded,
                "width": self.width,
                "height": self.height,
                "recording": self._direct_recording.summary() if self._direct_recording is not None else None,
            }

    # ---------------------------------------------------------------- ffmpeg
    def _ffmpeg_args(self, request_rate: bool) -> list[str]:
        input_spec = f"video={self.device_alternative_name or self.device_name}"
        rate_args = ["-framerate", str(int(self.requested_fps))] if request_rate else []
        return [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-f",
            "dshow",
            "-rtbufsize",
            "128M",
            *rate_args,
            "-i",
            input_spec,
            "-an",
            "-vf",
            f"scale={self.width}:{self.height}",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
            "pipe:1",
        ]

    def _open_stderr_log(self) -> Any:
        if self._stderr_handle is None:
            DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
            log_dir = assert_write_allowed(DIAGNOSTICS_ROOT / "capture")
            log_dir.mkdir(parents=True, exist_ok=True)
            safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in self.stream_label)
            path = assert_write_allowed(log_dir / f"{safe or 'capture'}_ffmpeg_stderr.log")
            self._stderr_handle = path.open("a", encoding="utf-8", errors="replace")
        return self._stderr_handle

    def _spawn(self, request_rate: bool) -> subprocess.Popen[bytes] | None:
        if self._direct_recording is not None and not self._archive_abandoned:
            return self._spawn_recording_first()
        try:
            return subprocess.Popen(
                self._ffmpeg_args(request_rate),
                stdout=subprocess.PIPE,
                stderr=self._open_stderr_log(),
                stdin=subprocess.DEVNULL,
            )
        except Exception as exc:  # spawn failure only; device errors surface via EOF
            self.error_state = str(exc)
            return None

    def _spawn_recording_first(self) -> subprocess.Popen[bytes] | None:
        recording = self._direct_recording
        if recording is None:
            return None
        try:
            command = recording.next_command()
            creationflags = getattr(subprocess, "ABOVE_NORMAL_PRIORITY_CLASS", 0) if os.name == "nt" else 0
            capture = subprocess.Popen(
                command.capture_args,
                stdout=subprocess.PIPE,
                stderr=self._open_stderr_log(),
                stdin=subprocess.PIPE,
                creationflags=creationflags,
            )
            self._transport_queue = queue.Queue(
                maxsize=max(4, int(recording.config.analysis_transport_queue_chunks))
            )
            self._decoder_process = self._spawn_analysis_decoder(command.decoder_args)
            if self._decoder_process is None:
                capture.kill()
                capture.wait(timeout=5.0)
                recording.error = "Could not start the recording analysis decoder"
                recording.archive_failed = True
                return None
            self._transport_drain_thread = threading.Thread(
                target=self._drain_analysis_transport,
                args=(capture, recording),
                name=f"capture-transport-drain-{self.source_id}",
                daemon=True,
            )
            self._transport_feed_thread = threading.Thread(
                target=self._feed_analysis_decoder,
                args=(self._decoder_process,),
                name=f"capture-transport-feed-{self.source_id}",
                daemon=True,
            )
            self._transport_drain_thread.start()
            self._transport_feed_thread.start()
            return capture
        except Exception as exc:
            recording.error = str(exc)
            recording.archive_failed = True
            if recording.recovery_exhausted:
                self._archive_abandoned = True
                self.event_bus.emit(
                    "RECORDING_FAILED",
                    source_id=self.source_id,
                    stream_label=self.stream_label,
                    message="archive recovery limit reached; analysis continues without new video evidence",
                    data=recording.summary(),
                )
            self.error_state = str(exc)
            return None

    def _spawn_analysis_decoder(self, args: list[str]) -> subprocess.Popen[bytes] | None:
        try:
            return subprocess.Popen(
                args,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=self._open_stderr_log(),
            )
        except Exception as exc:
            self.error_state = str(exc)
            return None

    def _drain_analysis_transport(self, capture: subprocess.Popen[bytes], recording: Any) -> None:
        stdout = capture.stdout
        transport = self._transport_queue
        if stdout is None or transport is None:
            return
        chunk_bytes = max(4096, int(recording.config.analysis_transport_chunk_bytes))
        try:
            # Drain through EOF even after Stop was requested. Closing the
            # consumer early could strand tee's analysis FIFO while FFmpeg is
            # trying to write the Matroska trailer.
            while True:
                chunk = stdout.read(chunk_bytes)
                if not chunk:
                    break
                recording.analysis_transport_chunks += 1
                try:
                    transport.put_nowait(chunk)
                except queue.Full:
                    recording.analysis_transport_dropped += 1
                    try:
                        transport.get_nowait()
                    except queue.Empty:
                        pass
                    try:
                        transport.put_nowait(chunk)
                    except queue.Full:
                        pass
        finally:
            self._offer_transport_sentinel(drain=True)

    def _offer_transport_sentinel(self, *, drain: bool = False) -> None:
        transport = self._transport_queue
        if transport is None:
            return
        while True:
            try:
                transport.put_nowait(None)
                return
            except queue.Full:
                decoder = self._decoder_process
                if (drain and decoder is not None and decoder.poll() is None
                        and (not self._stop_event.is_set()
                             or time.monotonic() < self._analysis_drain_deadline)):
                    # Normal EOF must not evict the last encoded result packets.
                    try:
                        transport.put(None, timeout=0.1)
                        return
                    except queue.Full:
                        continue
                try:
                    transport.get_nowait()
                except queue.Empty:
                    return

    def _feed_analysis_decoder(self, decoder: subprocess.Popen[bytes]) -> None:
        transport = self._transport_queue
        stdin = decoder.stdin
        if transport is None or stdin is None:
            return
        try:
            while True:
                chunk = transport.get()
                if chunk is None:
                    break
                try:
                    stdin.write(chunk)
                    stdin.flush()
                except (BrokenPipeError, OSError):
                    break
        finally:
            try:
                stdin.close()
            except OSError:
                pass

    def _kill_process(self) -> None:
        process = self._process
        self._process = None
        recording = self._direct_recording
        if process is not None and recording is not None and self._stop_event.is_set():
            # The read loop exits as soon as Stop is set. Its finally block must
            # still let the archive writer flush its trailer before killing the
            # secondary decoder. Killing here used to leave every real MKV
            # without duration/Cues despite the earlier interactive quit.
            if process.poll() is None:
                try:
                    if process.stdin is not None:
                        process.stdin.write(b"q\n")
                        process.stdin.flush()
                except (BrokenPipeError, OSError):
                    pass
                try:
                    process.wait(timeout=10.0)
                except subprocess.TimeoutExpired:
                    recording.unclean_stop = True
                    recording.error = "Archive writer did not close within the Stop deadline"
        if process is not None and process.poll() is None:
            process.kill()
            try:
                process.wait(timeout=3.0)
            except subprocess.TimeoutExpired:
                pass
        if process is not None and recording is not None and self._stop_event.is_set():
            code = process.poll()
            recording.capture_exit_codes.append(code)
            if code != 0:
                recording.unclean_stop = True
                recording.error = recording.error or f"Archive writer exited with code {code} during Stop"
        decoder = self._decoder_process
        self._decoder_process = None
        if decoder is not None and decoder.poll() is None:
            decoder.kill()
            try:
                decoder.wait(timeout=3.0)
            except subprocess.TimeoutExpired:
                pass
        self._offer_transport_sentinel()

    # ------------------------------------------------------------- read loop
    def _read_exact(self, stream: Any, count: int) -> bytes | None:
        chunks: list[bytes] = []
        remaining = count
        while remaining > 0:
            chunk = stream.read(remaining)
            if not chunk:
                return None
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _mark_signal_lost(self, reason: str) -> None:
        if not self._signal_lost_emitted:
            self._signal_lost_emitted = True
            if self._direct_recording is not None:
                self._direct_recording.signal_intervals.append({
                    "started_at": time.time(), "ended_at": None, "reason": reason,
                })
            self.event_bus.emit(
                "SOURCE_SIGNAL_LOST",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=self.current_timestamp,
                frame_index=self.current_frame_index,
                message=f"no frames from {self.device_name}: {reason}",
            )

    def _mark_signal_restored(self) -> None:
        if self._signal_lost_emitted:
            self._signal_lost_emitted = False
            if self._direct_recording is not None and self._direct_recording.signal_intervals:
                current = self._direct_recording.signal_intervals[-1]
                if current.get("ended_at") is None:
                    current["ended_at"] = time.time()
            # The chain may have changed (cable/output settings): recalibrate.
            self.border_status = "calibrating"
            self._calibration_samples = []
            self._calibration_started_wall = None
            self.event_bus.emit(
                "SOURCE_SIGNAL_RESTORED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=self.current_timestamp,
                frame_index=self.current_frame_index,
                message=f"frames flowing again from {self.device_name}",
            )

    def _calibrate_borders(self, frame: Any, now: float, timestamp: float, frame_index: int) -> None:
        """Collect ~1 border measurement per second; after the calibration
        window, the majority box becomes the feed's fixed verdict."""
        if self.border_status != "calibrating":
            return  # verdict is fixed until a signal loss triggers recalibration
        if self._calibration_started_wall is None:
            self._calibration_started_wall = now
        if now - self._last_calibration_sample_wall >= 1.0:
            self._last_calibration_sample_wall = now
            if float(frame.mean()) >= BORDER_DARK_FRAME_MEAN_INTENSITY:
                _status, box = measure_border_state(frame)
                if usable_capture_content_box(box, self.width, self.height):
                    self._calibration_samples.append(box)
        elapsed = now - self._calibration_started_wall
        window_done = (
            elapsed >= BORDER_CALIBRATION_SECONDS
            and len(self._calibration_samples) >= BORDER_CALIBRATION_MIN_SAMPLES
        )
        timed_out = elapsed >= BORDER_CALIBRATION_MAX_SECONDS
        if not (window_done or timed_out):
            return
        if not self._calibration_samples:
            return  # keep waiting for any lit frame at all
        box, votes = majority_border_box(self._calibration_samples)
        content_w = max(0, box["right"] - box["left"])
        content_h = max(0, box["bottom"] - box["top"])
        clean = (
            content_w >= self.width * BORDER_CLEAN_FRACTION
            and content_h >= self.height * BORDER_CLEAN_FRACTION
        )
        self.border_box = box
        self.border_status = "clean" if clean else "borders"
        self.event_bus.emit(
            "CAPTURE_BORDER_CALIBRATED",
            source_id=self.source_id,
            stream_label=self.stream_label,
            timestamp=timestamp,
            frame_index=frame_index,
            message=(
                f"border calibration: {self.border_status} "
                f"(box {box}, {votes}/{len(self._calibration_samples)} votes"
                + (", check fullscreen/overscan on the playback source)" if not clean else ")")
            ),
            data={"border_box": box, "votes": votes, "samples": len(self._calibration_samples)},
        )

    def _run(self) -> None:
        frame_bytes = self.width * self.height * 3
        next_preview_time = 0.0
        next_analysis_time = 0.0
        # First spawn requests the nominal rate; if the device rejects it (ffmpeg
        # exits before producing a frame), fall back to the device default rate.
        request_rate = True
        produced_any_at_rate = False
        spawn_count = 0
        try:
            while (not self._stop_event.is_set()
                   or (self._direct_recording is not None and self._decoder_process is not None
                       and time.monotonic() < self._analysis_drain_deadline)):
                if (not self._stop_event.is_set()
                        and (self._process is None or self._process.poll() is not None)):
                    rate_fallback = False
                    if spawn_count > 0:
                        self._mark_signal_lost("capture reader exited")
                        if request_rate and not produced_any_at_rate:
                            request_rate = False  # -framerate rejected by the device
                            rate_fallback = True  # retry immediately, once
                    if spawn_count > 0 and not rate_fallback:
                        if self._stop_event.wait(RESPAWN_BACKOFF_SECONDS):
                            break
                    self._kill_process()
                    self._process = self._spawn(request_rate)
                    spawn_count += 1
                    if self._process is None:
                        self._mark_signal_lost(self.error_state or "could not spawn ffmpeg")
                        if self._stop_event.wait(RESPAWN_BACKOFF_SECONDS):
                            break
                        continue
                stdout = (
                    self._decoder_process.stdout
                    if self._direct_recording is not None and not self._archive_abandoned and self._decoder_process is not None
                    else self._process.stdout
                )
                if stdout is None:
                    self._kill_process()
                    continue
                raw = self._read_exact(stdout, frame_bytes)
                if raw is None:
                    if self._stop_event.is_set():
                        break  # normal decoder EOF after archive close; never respawn
                    if (
                        self._direct_recording is not None
                        and self._process is not None
                        and self._process.poll() is None
                        and not self._stop_event.is_set()
                    ):
                        # Decoder failure is analysis-only. Keep capture/archive
                        # alive and attach a fresh decoder at the next keyframe.
                        old_decoder = self._decoder_process
                        if old_decoder is not None and old_decoder.poll() is None:
                            old_decoder.kill()
                        command = self._direct_recording.current_command
                        if command is not None:
                            self._decoder_process = self._spawn_analysis_decoder(command.decoder_args)
                            if self._decoder_process is not None:
                                self._direct_recording.analysis_decoder_restarts += 1
                                self._transport_feed_thread = threading.Thread(
                                    target=self._feed_analysis_decoder,
                                    args=(self._decoder_process,),
                                    name=f"capture-transport-feed-{self.source_id}",
                                    daemon=True,
                                )
                                self._transport_feed_thread.start()
                                continue
                    if self._direct_recording is not None and self._process is not None:
                        if not self._stop_event.is_set():
                            self._direct_recording.capture_exit_codes.append(self._process.poll())
                            self._direct_recording.archive_failed = True
                            self.event_bus.emit(
                                "RECORDING_FAILED",
                                source_id=self.source_id,
                                stream_label=self.stream_label,
                                message="archive writer exited; starting a recovery part",
                                data=self._direct_recording.summary(),
                            )
                    self._kill_process()
                    # EOF: device gone/busy or format rejected. Never SOURCE_ENDED —
                    # loop back, respawn, and keep trying until stop().
                    continue
                frame = np.frombuffer(raw, dtype=np.uint8).reshape(self.height, self.width, 3)
                now = time.perf_counter()
                if request_rate:
                    produced_any_at_rate = True
                self._mark_signal_restored()
                self._update_measured_fps(now)
                self._last_frame_wall = now
                # After Stop the writer is deliberately closing; decoded tail
                # frames are still useful, but archive growth is no longer due.
                if self._direct_recording is not None and not self._stop_event.is_set():
                    part = self._direct_recording.current_part
                    if part is not None and part.exists() and part.stat().st_size > 0:
                        self._recording_armed.set()
                    if now - self._last_recording_status_wall >= 1.0:
                        self._last_recording_status_wall = now
                        healthy = self._direct_recording.observe_health()
                        self.event_bus.emit(
                            "RECORDING_STATUS" if healthy and not self._archive_abandoned else "RECORDING_FAILED",
                            source_id=self.source_id,
                            stream_label=self.stream_label,
                            message=(
                                "archive and analysis transport active"
                                if healthy and not self._archive_abandoned
                                else self._direct_recording.error or "archive recording failed"
                            ),
                            data=self._direct_recording.summary(),
                        )
                        if not healthy and self._direct_recording.error == "Archive file/progress stalled":
                            self._kill_process()
                with self._lock:
                    self.current_frame_index += 1
                    frame_index = self.current_frame_index
                    self.frames_decoded += 1
                    timestamp = frame_index / (self.fps or 30.0)
                    self.current_timestamp = timestamp
                analysis_active = self.mode == "running" and not self._pause_event.is_set()
                if analysis_active:
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
                    if self.border_status == "calibrating":
                        self._calibrate_borders(frame, now, timestamp, frame_index)
                    with self._lock:
                        self.latest_preview_frame = preview_frame(frame)
                    self.event_bus.emit(
                        "FRAME_DECODED",
                        source_id=self.source_id,
                        stream_label=self.stream_label,
                        timestamp=timestamp,
                        frame_index=frame_index,
                        message="capture preview frame decoded",
                    )
                    next_preview_time = timestamp + (1.0 / max(1.0, self.preview_fps))
        except Exception as exc:
            self.state = "failed"
            self.error_state = str(exc)
            self.event_bus.emit(
                "SOURCE_FAILED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=self.current_timestamp,
                frame_index=self.current_frame_index,
                message=str(exc),
                data=self.summary(),
            )
        finally:
            self._kill_process()
            if self._stderr_handle is not None:
                try:
                    self._stderr_handle.close()
                except OSError:
                    pass
                self._stderr_handle = None

    def _update_measured_fps(self, now: float) -> None:
        self._fps_window.append(now)
        cutoff = now - 2.0
        while self._fps_window and self._fps_window[0] < cutoff:
            self._fps_window.pop(0)
        if len(self._fps_window) >= 2:
            span = self._fps_window[-1] - self._fps_window[0]
            if span > 0:
                self.measured_fps = (len(self._fps_window) - 1) / span
