"""Explicit single-run coordinator from LiveTrial report to output bridge."""

from __future__ import annotations

from copy import deepcopy
from typing import Callable

from livetrial_adapter import LiveTrialAssetCatalog, LiveTrialSubmissionContext
from livetrial_output import LiveTrialOutputPort, deliver_livetrial_finished_run
from livetrial_report import LiveTrialReportCandidate, parse_livetrial_report


class LiveTrialReportCoordinationError(ValueError):
    """Bounded selection/context error without report or provider detail."""


LiveTrialContextProvider = Callable[
    [LiveTrialReportCandidate],
    LiveTrialSubmissionContext,
]


def _fail() -> None:
    raise LiveTrialReportCoordinationError(
        "LiveTrial report delivery request is invalid."
    ) from None


def deliver_livetrial_report_run(
    document: object,
    run_number: int,
    context_provider: LiveTrialContextProvider,
    asset_catalog: LiveTrialAssetCatalog,
    output_port: LiveTrialOutputPort,
) -> dict:
    """Select one eligible run, bind explicit context, and deliver exactly once."""
    if (
        not isinstance(run_number, int)
        or isinstance(run_number, bool)
        or run_number < 1
    ):
        _fail()
    matches = [
        candidate
        for candidate in parse_livetrial_report(document)
        if candidate.run_number == run_number
    ]
    if len(matches) != 1:
        _fail()
    candidate = matches[0]
    try:
        context = context_provider(deepcopy(candidate))
    except Exception:
        _fail()
    if (
        not isinstance(context, LiveTrialSubmissionContext)
        or context.source_input != candidate.source_input
    ):
        _fail()
    return deliver_livetrial_finished_run(
        candidate.run,
        context,
        asset_catalog,
        output_port,
    )
