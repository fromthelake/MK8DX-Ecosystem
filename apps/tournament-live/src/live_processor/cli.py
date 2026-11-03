from __future__ import annotations

import argparse
import json

from .capture import discover_capture_devices
from .fixtures import discover_replay_fixtures, write_discovery_diagnostics
from .paths import PERFORMANCE_ROOT, get_project_paths
from .performance import PerformanceTracker


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("dry-run")
    sub.add_parser("discover-fixtures")
    replay = sub.add_parser("replay")
    replay.add_argument("--streams", choices=["one", "all"], default="all")
    replay.add_argument("--speed", type=float, default=30.0)
    replay.add_argument("--sample-mode", choices=["full", "middle", "start"], default="middle")
    replay.add_argument("--sample-duration-seconds", type=float, default=900.0)
    replay.add_argument("--analysis-fps", type=float, default=1.0)
    replay.add_argument("--gui", action="store_true")
    sub.add_parser("capture-devices")
    args = parser.parse_args()

    get_project_paths().ensure_output_dirs()
    tracker = PerformanceTracker(PERFORMANCE_ROOT, enabled=True)

    if args.command == "dry-run":
        paths = get_project_paths()
        payload = {
            "live_root": str(paths.live_root),
            "output_root": str(paths.live_output),
            "export_root": str(paths.export_root),
            "diagnostics_root": str(paths.diagnostics_root),
            "performance_root": str(paths.performance_root),
            "reference_results_root": str(paths.reference_results_root),
            "fixture_folder": str(paths.fixture_folder),
        }
        print(json.dumps(payload, indent=2))
        return 0

    if args.command == "discover-fixtures":
        fixtures = discover_replay_fixtures()
        write_discovery_diagnostics(fixtures)
        for fixture in fixtures:
            print(f"{fixture.stream_id}\t{fixture.label}\t{fixture.path}")
        return 0

    if args.command == "replay":
        # Keep diagnostics and capture discovery usable without loading the
        # optional vision runtime until an operator actually starts replay.
        from .replay import ReplayEngine
        from .replay import ReplayOptions

        fixtures = discover_replay_fixtures()
        limit = 1 if args.streams == "one" else None
        options = ReplayOptions(
            sample_mode=args.sample_mode,
            sample_duration_seconds=args.sample_duration_seconds,
            analysis_fps=args.analysis_fps,
            show_gui=args.gui,
        )
        session, exports = ReplayEngine(tracker, speed=args.speed, options=options).run(fixtures, limit=limit)
        print(
            json.dumps(
                {
                    "session_id": session.session_id,
                    "scoreboard_updates": session.scoreboard.update_count,
                    "source_states": session.source_states,
                    "detection_candidate_count": session.detection_candidate_count,
                    "ocr_success_count": session.ocr_success_count,
                    "ocr_failure_count": session.ocr_failure_count,
                    "export_status": session.export_status,
                    "exports": {key: str(value) for key, value in exports.items()},
                },
                indent=2,
            )
        )
        return 0

    if args.command == "capture-devices":
        capture_tracker = PerformanceTracker(PERFORMANCE_ROOT / "capture", enabled=True)
        devices = discover_capture_devices(capture_tracker)
        capture_tracker.write_reports()
        print(json.dumps([device.__dict__ for device in devices], indent=2))
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
