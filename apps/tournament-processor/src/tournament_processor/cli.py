from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path
from typing import Sequence

from .recorded_export import write_recorded_results


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mk8dx-tournament-processor",
        description="Produce TournamentRaceResultV1 from a confirmed Tournament Results CSV.",
    )
    parser.add_argument("input", type=Path, help="Existing Tournament_Results.csv export")
    parser.add_argument("--output", type=Path, required=True, help="Canonical JSON output path")
    parser.add_argument("--session-id", required=True, help="Stable local extraction session ID")
    parser.add_argument("--source-media-id", help="Opaque source-video ID; defaults to the input stem")
    parser.add_argument("--producer-version", default="tournament-processor-0.3.0")
    parser.add_argument("--created-at-ms", type=int, help="UTC epoch milliseconds; defaults to now")
    parser.add_argument("--send-to-manager", action="store_true", help="Upload new stable races to the explicitly configured Tournament group; queues safely when offline")
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    with args.input.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    results = write_recorded_results(
        rows,
        args.output,
        session_id=args.session_id,
        producer_version=args.producer_version,
        created_at_ms=args.created_at_ms if args.created_at_ms is not None else time.time_ns() // 1_000_000,
        source_media_id=args.source_media_id or args.input.stem,
    )
    print(f"Wrote {len(results)} canonical race result(s) to {args.output}")
    if args.send_to_manager:
        from mk8dx_tournament_connected.client import publish_incremental_results

        sent = publish_incremental_results(args.output)
        print(f"Sent {sent} new race(s) to the pending Tournament group feed; local output is unchanged.")
    return 0


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
