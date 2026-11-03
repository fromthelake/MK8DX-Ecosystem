from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path
from typing import Sequence

from mk8dx_tournament_extraction import TRACK_PLACEHOLDER, races_with_missing_track

from .canonical_export import write_final_live_results


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mk8dx-tournament-live-results",
        description="Publish finalized live Tournament workbook rows as TournamentRaceResultV1.",
    )
    parser.add_argument("input", type=Path, help="Final live Tournament_Results.csv export")
    parser.add_argument("--output", type=Path, required=True, help="Canonical JSON output path")
    parser.add_argument("--session-id", required=True, help="Stable live session ID")
    parser.add_argument("--producer-version", default="tournament-live-0.1.0")
    parser.add_argument("--created-at-ms", type=int, help="UTC epoch milliseconds; defaults to now")
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    with args.input.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    missing = races_with_missing_track(rows)
    if missing:
        # The extractor leaves the placeholder where the recording had no track
        # card; importing needs the real track, so name every race at once.
        listed = ", ".join(f"{video or 'session'} race {race}" for video, race in missing)
        print(
            f"Not imported: {len(missing)} race(s) have no track yet (empty or {TRACK_PLACEHOLDER}): "
            f"{listed}. Fill in the Track column for these races and run again."
        )
        return 2
    results = write_final_live_results(
        rows,
        args.output,
        session_id=args.session_id,
        producer_version=args.producer_version,
        created_at_ms=args.created_at_ms if args.created_at_ms is not None else time.time_ns() // 1_000_000,
    )
    print(f"Wrote {len(results)} confirmed live race result(s) to {args.output}")
    return 0


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
