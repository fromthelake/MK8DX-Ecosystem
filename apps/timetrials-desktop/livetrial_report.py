"""Pure adapter for preserved LiveTrial report.json envelopes."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import math


class LiveTrialReportError(ValueError):
    """Bounded invalid-report error without source or run detail."""


@dataclass(frozen=True)
class LiveTrialReportCandidate:
    report_run_index: int
    run_number: int
    source_input: str
    run: dict


def _fail() -> None:
    raise LiveTrialReportError("LiveTrial report is invalid.") from None


def parse_livetrial_report(document: object) -> tuple[LiveTrialReportCandidate, ...]:
    """Return deep-copied legacy-exporter-eligible runs with local coordinates."""
    if (
        not isinstance(document, dict)
        or set(document) != {"video", "fps", "framesAnalyzed", "runs"}
        or not isinstance(document.get("video"), str)
        or not document["video"]
        or not isinstance(document.get("fps"), (int, float))
        or isinstance(document["fps"], bool)
        or not math.isfinite(document["fps"])
        or document["fps"] < 0
        or not isinstance(document.get("framesAnalyzed"), int)
        or isinstance(document["framesAnalyzed"], bool)
        or document["framesAnalyzed"] < 0
        or not isinstance(document.get("runs"), list)
    ):
        _fail()

    seen_run_numbers: set[int] = set()
    candidates: list[LiveTrialReportCandidate] = []
    for report_run_index, run in enumerate(document["runs"]):
        if not isinstance(run, dict):
            _fail()
        run_number = run.get("run")
        if (
            not isinstance(run_number, int)
            or isinstance(run_number, bool)
            or run_number < 1
            or run_number in seen_run_numbers
        ):
            _fail()
        seen_run_numbers.add(run_number)

        results = run.get("results")
        if results is None:
            continue
        if not isinstance(results, dict):
            _fail()
        player = results.get("player")
        if player is None:
            continue
        if not isinstance(player, dict):
            _fail()
        if player.get("totalMs") is None:
            continue
        candidates.append(
            LiveTrialReportCandidate(
                report_run_index=report_run_index,
                run_number=run_number,
                source_input=document["video"],
                run=deepcopy(run),
            )
        )
    return tuple(candidates)
