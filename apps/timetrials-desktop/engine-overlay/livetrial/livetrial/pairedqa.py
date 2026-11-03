"""Opt-in, local paired phone/capture evidence for LiveTrial development.

The capture analyzer only enqueues a frame. A worker asks the already open
Android camera for a shutter JPEG and copies its original bytes over ADB.
Failures remain explicit private evidence and never affect a race result.
"""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import queue
import re
import subprocess
import threading
import time

import cv2


_SERIAL = re.compile(r"^[A-Za-z0-9._:-]+$")
_CAMERA_DIR = re.compile(r"^/[-A-Za-z0-9_./]+$")
_CASE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


def _hash(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class PairedQaCapture:
    """One private output session; each unique case produces at most one pair."""

    def __init__(self, root: Path, session: str, serial: str, *, adb: str = "adb",
                 camera_dir: str = "/sdcard/DCIM/Camera", run_command=subprocess.run,
                 sleep=time.sleep, monotonic=time.monotonic):
        if not _SERIAL.fullmatch(serial) or not _CAMERA_DIR.fullmatch(camera_dir) \
                or not _CASE.fullmatch(session):
            raise ValueError("Invalid paired-QA phone serial or camera directory")
        self.root = Path(root).resolve()
        self.session = session
        self.serial = serial
        self.adb = adb
        self.camera_dir = camera_dir.rstrip("/")
        self._run_command = run_command
        self._sleep = sleep
        self._monotonic = monotonic
        self._jobs: queue.Queue = queue.Queue(maxsize=4)
        self._seen: set[str] = set()
        self._thread: threading.Thread | None = None
        self.directory = self.root / session

    def _adb(self, *args: str, timeout: int = 20) -> str:
        result = self._run_command(
            [self.adb, "-s", self.serial, *args], capture_output=True,
            text=True, timeout=timeout, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"ADB {args[0]} failed (exit {result.returncode})")
        return result.stdout

    def _photos(self) -> set[str]:
        names = self._adb("shell", "ls", "-1", self.camera_dir)
        return {name.strip() for name in names.splitlines()
                if name.strip().lower().endswith((".jpg", ".jpeg"))
                and "/" not in name and "\\" not in name}

    def start(self) -> None:
        # Fail before capturing if the specified physical phone is unavailable.
        for ancestor in Path(__file__).resolve().parents:
            if (ancestor / ".git").exists() and (
                    self.root == ancestor or ancestor in self.root.parents):
                raise ValueError("Paired-QA evidence must be outside Git")
        devices = self._run_command([self.adb, "devices"], capture_output=True,
                                    text=True, timeout=10, check=False)
        if devices.returncode != 0 or not any(
                line.split()[:2] == [self.serial, "device"]
                for line in devices.stdout.splitlines()):
            raise RuntimeError("Paired-QA phone is not an authorized ADB device")
        self._photos()
        if self.directory.exists():
            raise FileExistsError("Paired-QA session already exists")
        self.directory.mkdir(parents=True)
        self._thread = threading.Thread(target=self._worker, name="livetrial-paired-qa",
                                        daemon=False)
        self._thread.start()

    def submit(self, case: str, scenario: str, source_ms: int, capture_bgr,
               observed: dict | None = None, *, capture_at_ms: int | None = None) -> bool:
        """Copy only this frame and return immediately to the analyzer."""
        if not _CASE.fullmatch(case) or scenario not in ("result", "ghost_collapsed",
                                                           "ghost_expanded", "lap_report",
                                                           "replay_finish"):
            raise ValueError("Invalid paired-QA case or scenario")
        if self._thread is None or case in self._seen:
            return False
        self._seen.add(case)
        try:
            self._jobs.put_nowait((case, scenario, source_ms, capture_bgr.copy(),
                                   observed or {}, int(time.time() * 1000)))
        except queue.Full:
            self._write_manifest(case, {"status": "queue_full", "scenario": scenario,
                                        "sourceMs": source_ms})
            return False
        return True

    def _write_manifest(self, case: str, document: dict) -> None:
        target = self.directory / case
        target.mkdir(exist_ok=True)
        path = target / "pair.json"
        temporary = target / "pair.json.tmp"
        temporary.write_text(json.dumps({"schema": "mk8dx.livetrial-paired-qa.v1",
                                         "pairId": f"{self.session}-{case}",
                                         **self._source_metadata(), **document},
                                        indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)

    def _source_metadata(self) -> dict:
        return {"sourceType": "android_phone", "phoneSerial": self.serial}

    def _capture_one(self, case: str, scenario: str, source_ms: int, bgr,
                     observed: dict, trigger_ms: int) -> None:
        pair = self.directory / case
        pair.mkdir(exist_ok=True)
        card = pair / "capture.png"
        record = {"status": "capture_failed", "scenario": scenario,
                  "sourceMs": source_ms, "triggerAtMs": trigger_ms,
                  "captureSource": "decoded-card-frame", "observed": observed}
        try:
            if not cv2.imwrite(str(card), bgr):
                raise RuntimeError("Could not save capture-card frame")
            record.update(captureFile=card.name, captureSha256=_hash(card),
                          status="phone_pending")
            before = self._photos()
            shutter_ms = int(time.time() * 1000)
            record["shutterRequestedAtMs"] = shutter_ms
            record["shutterDelayMs"] = shutter_ms - trigger_ms
            self._adb("shell", "input", "keyevent", "27")
            deadline = self._monotonic() + 15
            fresh: set[str] = set()
            while self._monotonic() < deadline:
                self._sleep(.5)
                fresh = self._photos() - before
                if fresh:
                    break
            if len(fresh) != 1:
                raise RuntimeError("Expected exactly one new camera JPEG")
            original = next(iter(fresh))
            phone = pair / f"phone_original_{original}"
            self._adb("pull", f"{self.camera_dir}/{original}", str(phone), timeout=30)
            if not phone.is_file() or phone.stat().st_size == 0:
                raise RuntimeError("Camera JPEG copy is empty")
            record.update(status="paired", phoneFile=phone.name,
                          phoneSourceFile=original, phoneSha256=_hash(phone),
                          phoneBytes=phone.stat().st_size,
                          photoObservedAtMs=int(time.time() * 1000),
                          timingQuality=("late" if record["shutterDelayMs"] > 3000
                                         else "timely"))
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
            record.update(status="phone_failed" if card.is_file() else "capture_failed",
                          error=type(exc).__name__ + ": " + str(exc))
        self._write_manifest(case, record)

    def _worker(self) -> None:
        while True:
            job = self._jobs.get()
            if job is None:
                self._jobs.task_done()
                return
            try:
                self._capture_one(*job)
            except Exception as exc:
                try:
                    self._write_manifest(job[0], {"status": "worker_failed",
                                                  "scenario": job[1],
                                                  "sourceMs": job[2],
                                                  "error": type(exc).__name__})
                except OSError:
                    pass
            finally:
                self._jobs.task_done()

    def close(self) -> None:
        if self._thread is None:
            return
        self._jobs.put(None)
        self._thread.join()
        self._thread = None
