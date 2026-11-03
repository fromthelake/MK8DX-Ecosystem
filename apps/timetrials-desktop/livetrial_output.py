"""Single-envelope output bridge for canonical LiveTrial finished runs."""

from __future__ import annotations

from copy import deepcopy
from typing import Callable

from livetrial_adapter import (
    LiveTrialAssetCatalog,
    LiveTrialSubmissionContext,
    adapt_livetrial_finished_run,
)


class LiveTrialOutputDeliveryError(RuntimeError):
    """Bounded downstream delivery error without private output detail."""


LiveTrialOutputPort = Callable[[dict], None]


def deliver_livetrial_finished_run(
    run: dict,
    context: LiveTrialSubmissionContext,
    asset_catalog: LiveTrialAssetCatalog,
    output_port: LiveTrialOutputPort,
) -> dict:
    """Adapt and deliver canonical/local values through one indivisible port call."""
    submission, local_evidence = adapt_livetrial_finished_run(
        run,
        context,
        asset_catalog,
    )
    envelope = {
        "canonicalSubmission": submission,
        "localEvidence": local_evidence,
    }
    try:
        output_port(deepcopy(envelope))
    except Exception:
        raise LiveTrialOutputDeliveryError(
            "LiveTrial output delivery failed."
        ) from None
    return deepcopy(envelope)
