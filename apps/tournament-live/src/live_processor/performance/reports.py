from __future__ import annotations

from pathlib import Path

from .tracker import PerformanceTracker


def generate_reports(tracker: PerformanceTracker) -> Path:
    tracker.write_reports()
    return tracker.output_root
