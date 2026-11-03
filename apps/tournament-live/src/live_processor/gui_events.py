from __future__ import annotations

import json
import queue
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .run_context import current_run_id


@dataclass(frozen=True)
class LiveEvent:
    event_type: str
    run_id: str
    source_id: str
    stream_label: str
    timestamp: float = 0.0
    frame_index: int | None = None
    race_sequence: int | None = None
    message: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    wall_time: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class GuiEventBus:
    def __init__(self, run_id: str | None = None) -> None:
        self.run_id = run_id or current_run_id() or time.strftime("gui_%Y%m%d_%H%M%S")
        self._queue: queue.Queue[LiveEvent] = queue.Queue()
        self._events: list[LiveEvent] = []
        self._lock = threading.Lock()
        DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
        self.event_log_path = assert_write_allowed(DIAGNOSTICS_ROOT / "gui_virtual_capture_events.jsonl")
        self.event_log_path.write_text("", encoding="utf-8")

    def emit(
        self,
        event_type: str,
        *,
        source_id: str = "",
        stream_label: str = "",
        timestamp: float = 0.0,
        frame_index: int | None = None,
        race_sequence: int | None = None,
        message: str = "",
        data: dict[str, Any] | None = None,
    ) -> LiveEvent:
        event = LiveEvent(
            event_type=event_type,
            run_id=self.run_id,
            source_id=source_id,
            stream_label=stream_label,
            timestamp=timestamp,
            frame_index=frame_index,
            race_sequence=race_sequence,
            message=message,
            data=data or {},
        )
        with self._lock:
            self._events.append(event)
            with self.event_log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(event.to_dict(), sort_keys=True) + "\n")
        self._queue.put(event)
        return event

    def poll(self, limit: int = 100) -> list[LiveEvent]:
        events: list[LiveEvent] = []
        for _ in range(limit):
            try:
                events.append(self._queue.get_nowait())
            except queue.Empty:
                break
        return events

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return [event.to_dict() for event in self._events]

    def write_scoreboard_log(self) -> Path:
        scoreboard_events = [
            event.to_dict()
            for event in self.snapshot_events()
            if event.event_type == "SCOREBOARD_UPDATED"
        ]
        path = assert_write_allowed(DIAGNOSTICS_ROOT / "gui_scoreboard_update_log.json")
        path.write_text(json.dumps(scoreboard_events, indent=2, sort_keys=True), encoding="utf-8")
        return path

    def snapshot_events(self) -> list[LiveEvent]:
        with self._lock:
            return list(self._events)
