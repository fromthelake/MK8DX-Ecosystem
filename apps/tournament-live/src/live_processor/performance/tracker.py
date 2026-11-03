from __future__ import annotations

import csv
import json
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from live_processor.paths import PERFORMANCE_ROOT, assert_write_allowed

from .metrics import FunctionStats
from .system_stats import collect_system_sample, sample_as_dict


class PerformanceTracker:
    def __init__(self, output_root: Path = PERFORMANCE_ROOT, enabled: bool = True) -> None:
        self.output_root = assert_write_allowed(output_root)
        self.enabled = enabled
        self._lock = threading.Lock()
        self.functions: dict[str, FunctionStats] = {}
        self.events: list[dict[str, object]] = []
        self.stream_rows: list[dict[str, object]] = []
        self.queue_rows: list[dict[str, object]] = []
        self.ocr_rows: list[dict[str, object]] = []
        self.detection_rows: list[dict[str, object]] = []
        self.replay_rows: list[dict[str, object]] = []
        self.system_rows: list[dict[str, object]] = []
        self.export_rows: list[dict[str, object]] = []
        self.error_rows: list[dict[str, object]] = []
        if self.enabled:
            self.output_root.mkdir(parents=True, exist_ok=True)

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled

    @contextmanager
    def track(self, function_name: str, **fields: object) -> Iterator[None]:
        if not self.enabled:
            yield
            return
        start = time.perf_counter()
        exception = False
        try:
            yield
        except Exception as exc:
            exception = True
            self.record_error(function_name, type(exc).__name__, str(exc), **fields)
            raise
        finally:
            duration = time.perf_counter() - start
            self.record_function(function_name, duration, exception, **fields)

    def record_function(
        self, function_name: str, duration: float, exception: bool = False, **fields: object
    ) -> None:
        if not self.enabled:
            return
        with self._lock:
            stats = self.functions.setdefault(function_name, FunctionStats(function_name))
            stats.record(duration, exception=exception)
            row = {
                "timestamp": time.time(),
                "event": "function_timing",
                "function": function_name,
                "duration": duration,
                "exception": exception,
                **fields,
            }
            self.events.append(row)

    def record_stream(self, **fields: object) -> None:
        self._append(self.stream_rows, "stream_timing", fields)

    def record_queue(self, **fields: object) -> None:
        self._append(self.queue_rows, "queue_backlog", fields)

    def record_ocr(self, **fields: object) -> None:
        self._append(self.ocr_rows, "ocr_timing", fields)

    def record_detection(self, **fields: object) -> None:
        self._append(self.detection_rows, "detection_timing", fields)

    def record_replay(self, **fields: object) -> None:
        self._append(self.replay_rows, "replay_speed", fields)

    def record_export(self, **fields: object) -> None:
        self._append(self.export_rows, "export_timing", fields)

    def record_error(self, scope: str, error_type: str, message: str, **fields: object) -> None:
        self._append(
            self.error_rows,
            "error",
            {"scope": scope, "error_type": error_type, "message": message, **fields},
        )

    def sample_system(self) -> None:
        if not self.enabled:
            return
        sample = sample_as_dict(collect_system_sample())
        self._append(self.system_rows, "system_resource", sample, add_timestamp=False)

    def _append(
        self,
        target: list[dict[str, object]],
        event: str,
        fields: dict[str, object],
        add_timestamp: bool = True,
    ) -> None:
        if not self.enabled:
            return
        with self._lock:
            row = {"event": event, **fields}
            if add_timestamp:
                row = {"timestamp": time.time(), **row}
            target.append(row)
            self.events.append(row)

    def write_reports(self) -> None:
        if not self.enabled:
            return
        self.output_root.mkdir(parents=True, exist_ok=True)
        self._write_jsonl("performance_events.jsonl", self.events)
        self._write_json(
            "performance_summary.json",
            {
                "generated_at": time.time(),
                "functions": [stats.as_dict() for stats in self.functions.values()],
                "stream_count": len({row.get("stream_id") for row in self.stream_rows}),
                "error_count": len(self.error_rows),
            },
        )
        self._write_csv("function_call_summary.csv", [s.as_dict() for s in self.functions.values()])
        self._write_csv("stream_timing_summary.csv", self.stream_rows)
        self._write_csv("queue_backlog_summary.csv", self.queue_rows)
        self._write_csv("ocr_timing_summary.csv", self.ocr_rows)
        self._write_csv("detection_timing_summary.csv", self.detection_rows)
        self._write_csv("replay_speed_summary.csv", self.replay_rows)
        self._write_csv("system_resource_summary.csv", self.system_rows)
        self._write_csv("export_timing_summary.csv", self.export_rows)
        self._write_csv("error_summary.csv", self.error_rows)

    def _write_jsonl(self, name: str, rows: list[dict[str, object]]) -> None:
        path = assert_write_allowed(self.output_root / name)
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, sort_keys=True) + "\n")

    def _write_json(self, name: str, payload: dict[str, object]) -> None:
        path = assert_write_allowed(self.output_root / name)
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    def _write_csv(self, name: str, rows: list[dict[str, object]]) -> None:
        path = assert_write_allowed(self.output_root / name)
        fieldnames: list[str] = []
        for row in rows:
            for key in row:
                if key not in fieldnames:
                    fieldnames.append(key)
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames or ["empty"])
            writer.writeheader()
            for row in rows:
                writer.writerow(row)
