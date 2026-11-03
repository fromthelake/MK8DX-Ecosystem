"""Strict versioned local context document for a future LiveTrial executable."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import replace

from livetrial_adapter import (
    LiveTrialAdapterError,
    LiveTrialSubmissionContext,
    validate_livetrial_submission_context,
)


class LiveTrialContextDocumentError(ValueError):
    """Bounded invalid-context-document error without input detail."""


def _fail() -> None:
    raise LiveTrialContextDocumentError(
        "LiveTrial context document is invalid."
    ) from None


def parse_livetrial_context_document(document: object) -> LiveTrialSubmissionContext:
    """Return a validated context template deliberately unbound to source input."""
    required = {
        "schemaVersion",
        "submissionId",
        "revision",
        "sourceKind",
        "playerReference",
        "producerVersion",
        "localRecordId",
        "timestamps",
    }
    if (
        not isinstance(document, dict)
        or not required <= set(document)
        or not set(document) <= required | {"evidence"}
        or document.get("schemaVersion")
        != "mk8dx.livetrial-submission-context.v1"
        or not isinstance(document.get("timestamps"), dict)
        or "createdAtMs" not in document["timestamps"]
        or not set(document["timestamps"])
        <= {"createdAtMs", "occurredAtMs", "capturedAtMs"}
        or (
            "evidence" in document
            and not isinstance(document["evidence"], list)
        )
    ):
        _fail()
    timestamps = document["timestamps"]
    context = LiveTrialSubmissionContext(
        submission_id=document["submissionId"],
        revision=document["revision"],
        source_kind=document["sourceKind"],
        player_reference=deepcopy(document["playerReference"]),
        producer_version=document["producerVersion"],
        local_record_id=document["localRecordId"],
        created_at_ms=timestamps["createdAtMs"],
        occurred_at_ms=timestamps.get("occurredAtMs"),
        captured_at_ms=timestamps.get("capturedAtMs"),
        evidence=tuple(deepcopy(document.get("evidence", []))),
        source_input=None,
    )
    try:
        validate_livetrial_submission_context(context)
    except LiveTrialAdapterError:
        _fail()
    return context


def bind_livetrial_context_source(
    context: LiveTrialSubmissionContext,
    source_input: object,
) -> LiveTrialSubmissionContext:
    """Bind one unbound parsed template to its selected report source."""
    if (
        not isinstance(context, LiveTrialSubmissionContext)
        or context.source_input is not None
        or not isinstance(source_input, str)
        or not source_input
    ):
        _fail()
    bound = replace(deepcopy(context), source_input=source_input)
    try:
        validate_livetrial_submission_context(bound)
    except LiveTrialAdapterError:
        _fail()
    return bound
