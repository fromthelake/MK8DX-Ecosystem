"""Opt-in paired QA from a continuously sampled webcam.

The webcam cannot take an Android-style shutter photo. Keep a short ring of
decoded frames and select the one nearest the capture-card frame's arrival.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path
import queue
import re
import subprocess
import threading
import time

import cv2
import numpy as np

from .pairedqa import PairedQaCapture, _CASE, _hash


_SIZE = re.compile(r"^([1-9][0-9]{1,3})x([1-9][0-9]{1,3})$")
_SCENARIOS = frozenset(("result", "ghost_collapsed", "ghost_expanded",
                        "lap_report", "replay_finish", "state_probe"))
MAX_FRAME_OFFSET_MS = 500
# A decoded almost-black camera frame is not optical evidence of the TV. This
# only rejects near-zero signal; ordinary dark camera photos stay eligible.
MAX_BLANK_LUMA_P99 = 16


class WebcamQaCapture(PairedQaCapture):
    """Capture-card triggers paired with the nearest Logitech/webcam frame."""

    def __init__(self, root: Path, session: str, device: str, *, size: str = "1280x720",
                 fps: int = 15, vcodec: str | None = None,
                 ffmpeg: str = "ffmpeg", popen=subprocess.Popen,
                 clock=time.time):
        super().__init__(root, session, "webcam")
        match = _SIZE.fullmatch(size)
        if not device or "\n" in device or "\r" in device or not match \
                or not 1 <= fps <= 60 or vcodec not in (None, "mjpeg", "rawvideo"):
            raise ValueError("Invalid paired-QA webcam device, size or frame rate")
        self.device = device
        self.size = size
        self.fps = fps
        self.vcodec = vcodec
        self.ffmpeg = ffmpeg
        self._popen = popen
        self._clock = clock
        self._width, self._height = map(int, match.groups())
        self._latest_lock = threading.Lock()
        self._latest = None
        self._frames = deque(maxlen=45)
        self._first_frame = threading.Event()
        self._stop_reader = threading.Event()
        self._process = None
        self._reader_thread = None
        self._stderr_thread = None

    def _source_metadata(self) -> dict:
        metadata = {"sourceType": "webcam", "webcamDevice": self.device,
                    "webcamSize": self.size, "webcamFps": self.fps}
        if self.vcodec:
            metadata["webcamCodec"] = self.vcodec
        return metadata

    def _read_frames(self) -> None:
        nbytes = self._width * self._height * 3
        while not self._stop_reader.is_set():
            raw = self._process.stdout.read(nbytes)
            if len(raw) != nbytes:
                break
            frame = np.frombuffer(raw, dtype=np.uint8).reshape(
                self._height, self._width, 3).copy()
            with self._latest_lock:
                self._latest = (frame, int(self._clock() * 1000))
                self._frames.append(self._latest)
            self._first_frame.set()

    def _drain_stderr(self) -> None:
        for _line in iter(self._process.stderr.readline, b""):
            if self._stop_reader.is_set():
                break

    def start(self) -> None:
        # Same private-output boundary as the phone mode, with no ADB required.
        for ancestor in Path(__file__).resolve().parents:
            if (ancestor / ".git").exists() and (
                    self.root == ancestor or ancestor in self.root.parents):
                raise ValueError("Paired-QA evidence must be outside Git")
        if self.directory.exists():
            raise FileExistsError("Paired-QA session already exists")
        command = [self.ffmpeg, "-hide_banner", "-loglevel", "warning", "-f", "dshow",
                   "-rtbufsize", "32M"]
        if self.vcodec:
            command += ["-vcodec", self.vcodec]
        command += ["-video_size", self.size,
                   "-framerate", str(self.fps), "-i", f"video={self.device}",
                   "-pix_fmt", "bgr24", "-f", "rawvideo", "-"]
        self._process = self._popen(command, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE)
        self._reader_thread = threading.Thread(target=self._read_frames, daemon=True)
        self._stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self._reader_thread.start()
        self._stderr_thread.start()
        if not self._first_frame.wait(timeout=10):
            self._stop_camera()
            raise RuntimeError("Paired-QA webcam delivered no frame")
        try:
            self.directory.mkdir(parents=True)
            self._thread = threading.Thread(target=self._worker, name="livetrial-webcam-qa",
                                            daemon=False)
            self._thread.start()
        except Exception:
            self._stop_camera()
            raise

    def submit(self, case: str, scenario: str, source_ms: int, capture_bgr,
               observed: dict | None = None, *, capture_at_ms: int | None = None) -> bool:
        if not _CASE.fullmatch(case) or scenario not in _SCENARIOS:
            raise ValueError("Invalid paired-QA case or scenario")
        if self._thread is None or case in self._seen:
            return False
        trigger_ms = int(self._clock() * 1000)
        target_ms = capture_at_ms if capture_at_ms is not None else trigger_ms
        with self._latest_lock:
            closest = min(self._frames, key=lambda item: abs(item[1] - target_ms)) \
                if self._frames else self._latest
            camera = None if closest is None else (closest[0].copy(), closest[1])
        self._seen.add(case)
        try:
            self._jobs.put_nowait((case, scenario, source_ms, capture_bgr.copy(),
                                   observed or {}, trigger_ms, target_ms, camera))
        except queue.Full:
            self._write_manifest(case, {"status": "queue_full", "scenario": scenario,
                                        "sourceMs": source_ms})
            return False
        return True

    def _capture_one(self, case: str, scenario: str, source_ms: int, bgr,
                     observed: dict, trigger_ms: int, capture_at_ms: int, camera) -> None:
        pair = self.directory / case
        pair.mkdir(exist_ok=True)
        card_file = pair / "capture.png"
        record = {"status": "capture_failed", "scenario": scenario,
                  "sourceMs": source_ms, "triggerAtMs": trigger_ms,
                  "captureFrameAtMs": capture_at_ms,
                  "captureSource": "decoded-card-frame", "observed": observed}
        try:
            if not cv2.imwrite(str(card_file), bgr):
                raise RuntimeError("Could not save capture-card frame")
            record.update(captureFile=card_file.name, captureSha256=_hash(card_file),
                          status="webcam_missing")
            if camera is not None:
                frame, frame_ms = camera
                webcam_file = pair / "webcam.png"
                if not cv2.imwrite(str(webcam_file), frame):
                    raise RuntimeError("Could not save webcam frame")
                age_ms = trigger_ms - frame_ms
                offset_ms = frame_ms - capture_at_ms
                luma_p99 = int(np.percentile(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), 99))
                status = ("webcam_stale" if abs(offset_ms) > MAX_FRAME_OFFSET_MS
                          else "webcam_blank" if luma_p99 <= MAX_BLANK_LUMA_P99
                          else "paired")
                record.update(webcamFile=webcam_file.name,
                              webcamSha256=_hash(webcam_file), webcamFrameAtMs=frame_ms,
                              webcamAgeMs=age_ms, webcamOffsetMs=offset_ms,
                              webcamLumaP99=luma_p99, status=status)
        except (OSError, RuntimeError) as exc:
            record.update(status="webcam_failed" if card_file.is_file()
                          else "capture_failed", error=type(exc).__name__ + ": " + str(exc))
        self._write_manifest(case, record)

    def _stop_camera(self) -> None:
        self._stop_reader.set()
        if self._process is not None:
            if self._process.poll() is None:
                self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)
        if self._reader_thread is not None:
            self._reader_thread.join(timeout=5)
        if self._stderr_thread is not None:
            self._stderr_thread.join(timeout=5)

    def close(self) -> None:
        try:
            super().close()
        finally:
            self._stop_camera()
