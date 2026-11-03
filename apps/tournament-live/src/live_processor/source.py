from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class SourceRole(str, Enum):
    MK8_FEED = "mk8_feed"
    IGNORED_WEBCAM = "ignored_webcam"


class SourceState(str, Enum):
    INITIALIZED = "initialized"
    PREVIEWING = "previewing"
    RUNNING = "running"
    ENDED = "ended"
    FAILED = "failed"
    STOPPED = "stopped"


@dataclass
class SourceMetrics:
    frames_processed: int = 0
    frames_rejected: int = 0
    frames_intentionally_skipped: int = 0
    frames_dropped_overload: int = 0
    backlog: int = 0


@dataclass
class LiveSource:
    source_id: str
    display_label: str
    role: SourceRole
    path: Path | None = None
    current_timestamp: float = 0.0
    lifecycle_state: SourceState = SourceState.INITIALIZED
    latest_preview_frame: object | None = None
    error_state: str | None = None
    metrics: SourceMetrics = field(default_factory=SourceMetrics)

    @property
    def eligible_for_analysis(self) -> bool:
        return self.role == SourceRole.MK8_FEED

    def transition(self, new_state: SourceState) -> None:
        valid = {
            SourceState.INITIALIZED: {
                SourceState.PREVIEWING,
                SourceState.RUNNING,
                SourceState.FAILED,
                SourceState.STOPPED,
            },
            SourceState.PREVIEWING: {SourceState.RUNNING, SourceState.FAILED, SourceState.STOPPED},
            SourceState.RUNNING: {SourceState.ENDED, SourceState.FAILED, SourceState.STOPPED},
            SourceState.ENDED: {SourceState.STOPPED},
            SourceState.FAILED: {SourceState.STOPPED},
            SourceState.STOPPED: set(),
        }
        if new_state not in valid[self.lifecycle_state]:
            raise ValueError(f"Invalid source transition {self.lifecycle_state} -> {new_state}")
        self.lifecycle_state = new_state

    def fail(self, message: str) -> None:
        self.error_state = message
        if self.lifecycle_state != SourceState.STOPPED:
            self.lifecycle_state = SourceState.FAILED
