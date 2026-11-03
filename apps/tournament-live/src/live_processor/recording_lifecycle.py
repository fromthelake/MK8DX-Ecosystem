from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Iterable

from .paths import assert_write_allowed


class RecordingLifecycle(str, Enum):
    CREATED = "created"
    PREFLIGHTING = "preflighting"
    ARMING = "arming"
    ACTIVE = "active"
    PAUSED_ANALYSIS = "paused_analysis"
    STOPPING_CAPTURE = "stopping_capture"
    CLOSING_WORKING_PARTS = "closing_working_parts"
    DRAINING_FINAL_ANALYSIS = "draining_final_analysis"
    FINALIZING_RESULTS = "finalizing_results"
    PERSISTING_ECOSYSTEM_DATA = "persisting_ecosystem_data"
    DELIVERING_CONNECTED_RESULTS = "delivering_connected_results"
    WAITING_FOR_ECOSYSTEM_DELIVERY = "waiting_for_ecosystem_delivery"
    ASSEMBLING_RECORDINGS = "assembling_recordings"
    VERIFYING_RECORDINGS = "verifying_recordings"
    COMPLETED = "completed"
    COMPLETED_WITH_EVIDENCE_GAPS = "completed_with_evidence_gaps"
    COMPLETED_WITH_PENDING_DELIVERY = "completed_with_pending_delivery"
    FINALIZATION_FAILED = "finalization_failed"
    ARMING_FAILED = "arming_failed"


TERMINAL_RECORDING_STATES = frozenset({
    RecordingLifecycle.COMPLETED,
    RecordingLifecycle.COMPLETED_WITH_EVIDENCE_GAPS,
    RecordingLifecycle.COMPLETED_WITH_PENDING_DELIVERY,
    RecordingLifecycle.ARMING_FAILED,
})


_TRANSITIONS: dict[RecordingLifecycle, frozenset[RecordingLifecycle]] = {
    RecordingLifecycle.CREATED: frozenset({RecordingLifecycle.PREFLIGHTING}),
    RecordingLifecycle.PREFLIGHTING: frozenset({RecordingLifecycle.ARMING, RecordingLifecycle.ARMING_FAILED}),
    RecordingLifecycle.ARMING: frozenset({RecordingLifecycle.ACTIVE, RecordingLifecycle.ARMING_FAILED}),
    RecordingLifecycle.ACTIVE: frozenset({RecordingLifecycle.PAUSED_ANALYSIS, RecordingLifecycle.STOPPING_CAPTURE}),
    RecordingLifecycle.PAUSED_ANALYSIS: frozenset({RecordingLifecycle.ACTIVE, RecordingLifecycle.STOPPING_CAPTURE}),
    RecordingLifecycle.STOPPING_CAPTURE: frozenset({RecordingLifecycle.CLOSING_WORKING_PARTS}),
    RecordingLifecycle.CLOSING_WORKING_PARTS: frozenset({RecordingLifecycle.DRAINING_FINAL_ANALYSIS}),
    RecordingLifecycle.DRAINING_FINAL_ANALYSIS: frozenset({RecordingLifecycle.FINALIZING_RESULTS}),
    RecordingLifecycle.FINALIZING_RESULTS: frozenset({RecordingLifecycle.PERSISTING_ECOSYSTEM_DATA}),
    RecordingLifecycle.PERSISTING_ECOSYSTEM_DATA: frozenset({RecordingLifecycle.DELIVERING_CONNECTED_RESULTS}),
    RecordingLifecycle.DELIVERING_CONNECTED_RESULTS: frozenset({
        RecordingLifecycle.WAITING_FOR_ECOSYSTEM_DELIVERY,
        RecordingLifecycle.ASSEMBLING_RECORDINGS,
    }),
    RecordingLifecycle.WAITING_FOR_ECOSYSTEM_DELIVERY: frozenset({
        RecordingLifecycle.DELIVERING_CONNECTED_RESULTS,
        RecordingLifecycle.ASSEMBLING_RECORDINGS,
    }),
    RecordingLifecycle.ASSEMBLING_RECORDINGS: frozenset({
        RecordingLifecycle.VERIFYING_RECORDINGS,
        RecordingLifecycle.FINALIZATION_FAILED,
    }),
    RecordingLifecycle.VERIFYING_RECORDINGS: frozenset({
        RecordingLifecycle.COMPLETED,
        RecordingLifecycle.COMPLETED_WITH_EVIDENCE_GAPS,
        RecordingLifecycle.COMPLETED_WITH_PENDING_DELIVERY,
        RecordingLifecycle.FINALIZATION_FAILED,
    }),
    RecordingLifecycle.COMPLETED_WITH_PENDING_DELIVERY: frozenset({RecordingLifecycle.COMPLETED}),
    RecordingLifecycle.FINALIZATION_FAILED: frozenset({RecordingLifecycle.ASSEMBLING_RECORDINGS}),
}


def require_transition(current: RecordingLifecycle, target: RecordingLifecycle) -> None:
    if target not in _TRANSITIONS.get(current, frozenset()):
        raise ValueError(f"Invalid recording lifecycle transition: {current.value} -> {target.value}")


def safe_feed_name(value: str) -> str:
    name = "".join(character if character.isalnum() or character in "-_" else "_" for character in value)
    return name.strip("_") or "feed"


def allocate_run_id(
    recordings_root: Path,
    *,
    now: Callable[[], float] = time.time,
    token: Callable[[], str] = lambda: uuid.uuid4().hex[:8],
) -> str:
    """Allocate a readable, collision-safe run identity without creating it."""
    root = assert_write_allowed(recordings_root)
    stamp = time.strftime("run-%Y%m%d-%H%M%S", time.localtime(now()))
    for _ in range(100):
        candidate = f"{stamp}-{safe_feed_name(token())[:12]}"
        if not (root / candidate).exists():
            return candidate
    raise FileExistsError("Could not allocate a unique recording run ID")


@dataclass(frozen=True)
class RecordingRunPaths:
    root: Path
    run_id: str

    @property
    def run_root(self) -> Path:
        return assert_write_allowed(self.root / safe_feed_name(self.run_id))

    @property
    def working_root(self) -> Path:
        return assert_write_allowed(self.run_root / "working")

    @property
    def manifest(self) -> Path:
        return assert_write_allowed(self.run_root / "recording-run.json")

    @property
    def event_log(self) -> Path:
        return assert_write_allowed(self.run_root / "recording-events.jsonl")

    def feed_working_dir(self, feed: str) -> Path:
        return assert_write_allowed(self.working_root / safe_feed_name(feed))

    def part(self, feed: str, number: int) -> Path:
        if number < 1:
            raise ValueError("Recording part numbers start at one")
        return assert_write_allowed(self.feed_working_dir(feed) / f"part-{number:03d}.mkv")

    def final(self, feed: str) -> Path:
        return assert_write_allowed(self.run_root / f"{safe_feed_name(self.run_id)}_{safe_feed_name(feed)}.mkv")

    def partial_final(self, feed: str) -> Path:
        return assert_write_allowed(self.run_root / f".{safe_feed_name(self.run_id)}_{safe_feed_name(feed)}.partial.mkv")

    def concat_list(self, feed: str) -> Path:
        return assert_write_allowed(self.feed_working_dir(feed) / "concat.txt")

    def create(self, feeds: Iterable[str]) -> None:
        feed_names = [safe_feed_name(feed) for feed in feeds]
        if len(feed_names) != len(set(feed_names)):
            raise ValueError("Feed names must remain unique after filename normalization")
        if self.run_root.exists():
            raise FileExistsError(f"Recording run already exists: {self.run_root}")
        self.run_root.mkdir(parents=True)
        for feed in feed_names:
            self.feed_working_dir(feed).mkdir(parents=True)


@dataclass(frozen=True)
class RecordingPreflightResult:
    ok: bool
    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RecordingValidationResult:
    ok: bool
    path: str
    format_name: str = ""
    duration_seconds: float = 0.0
    video_streams: int = 0
    audio_streams: int = 0
    video_codec: str = ""
    width: int = 0
    height: int = 0
    pixel_format: str = ""
    frame_rate: str = ""
    sha256: str = ""
    bytes: int = 0
    errors: tuple[str, ...] = ()


class RecordingRunManifest:
    """Crash-consistent snapshot plus append-only lifecycle evidence."""

    def __init__(self, paths: RecordingRunPaths, *, feeds: Iterable[dict[str, Any]]) -> None:
        self.paths = paths
        self.document: dict[str, Any] = {
            "schema": "mk8dx.tournament-live.recording-run.v1",
            "run_id": paths.run_id,
            "state": RecordingLifecycle.CREATED.value,
            "created_at_ms": time.time_ns() // 1_000_000,
            "updated_at_ms": time.time_ns() // 1_000_000,
            "feeds": list(feeds),
            "timestamps": {},
            "evidence_gaps": [],
            "retryable_action": None,
        }
        self._write_snapshot()
        self.append_event("run_created")

    @classmethod
    def load(cls, path: Path) -> "RecordingRunManifest":
        document = json.loads(path.read_text(encoding="utf-8"))
        instance = cls.__new__(cls)
        instance.paths = RecordingRunPaths(path.parent.parent, str(document["run_id"]))
        instance.document = document
        return instance

    @property
    def state(self) -> RecordingLifecycle:
        return RecordingLifecycle(str(self.document["state"]))

    def transition(self, target: RecordingLifecycle, **details: Any) -> None:
        require_transition(self.state, target)
        now_ms = time.time_ns() // 1_000_000
        self.document["state"] = target.value
        self.document["updated_at_ms"] = now_ms
        self.document.setdefault("timestamps", {})[target.value] = now_ms
        if details:
            self.document.update(details)
        self._write_snapshot()
        self.append_event("state_changed", state=target.value, **details)

    def update(self, **details: Any) -> None:
        self.document.update(details)
        self.document["updated_at_ms"] = time.time_ns() // 1_000_000
        self._write_snapshot()
        self.append_event("manifest_updated", **details)

    def begin_recovery(self) -> None:
        if self.state in TERMINAL_RECORDING_STATES:
            raise ValueError("A completed recording run does not need recovery")
        previous = self.state
        now_ms = time.time_ns() // 1_000_000
        self.document["state"] = RecordingLifecycle.ASSEMBLING_RECORDINGS.value
        self.document["updated_at_ms"] = now_ms
        self.document.setdefault("timestamps", {})["recovery_started"] = now_ms
        self._write_snapshot()
        self.append_event("recovery_started", previous_state=previous.value)

    def append_event(self, event: str, **details: Any) -> None:
        self.paths.event_log.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "event": event,
            "run_id": self.paths.run_id,
            "state": self.document["state"],
            "wall_time_ms": time.time_ns() // 1_000_000,
            **details,
        }
        with self.paths.event_log.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def _write_snapshot(self) -> None:
        self.paths.manifest.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.paths.manifest.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(self.document, indent=2, sort_keys=True), encoding="utf-8")
        os.replace(temporary, self.paths.manifest)


def unfinished_recording_runs(root: Path) -> list[Path]:
    root = assert_write_allowed(root)
    unfinished: list[Path] = []
    if not root.is_dir():
        return unfinished
    for manifest_path in root.glob("*/recording-run.json"):
        try:
            state = RecordingLifecycle(json.loads(manifest_path.read_text(encoding="utf-8"))["state"])
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            unfinished.append(manifest_path)
            continue
        if state not in TERMINAL_RECORDING_STATES:
            unfinished.append(manifest_path)
    return sorted(unfinished)
