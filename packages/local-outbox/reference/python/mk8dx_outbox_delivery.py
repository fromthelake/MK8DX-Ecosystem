"""Explicit canonical-only delivery coordinator for the local Time Trial outbox."""

from __future__ import annotations

from copy import deepcopy
import re
from threading import Lock
from typing import Callable, Protocol


MAX_TIMESTAMP_MS = 253_402_300_799_999
FAILURE_EVIDENCE_NOT_ALLOWLISTED = "evidence.not_allowlisted"
FAILURE_EVIDENCE_REVIEW_FAILED = "evidence.review_failed"
FAILURE_TRANSPORT_FAILED = "transport.failed"
FAILURE_RESPONSE_INVALID = "response.invalid"

_ENTRY_KEY = re.compile(r"^[0-9a-f]{64}$")
_FAILURE_CODE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")


class CanonicalDeliveryError(RuntimeError):
    """Bounded delivery failure without canonical, private, or transport detail."""


class CanonicalDeliveryConfigurationError(CanonicalDeliveryError):
    """The required explicit transport or review policy is absent."""


class CanonicalDeliveryStateError(CanonicalDeliveryError):
    """The selected outbox entry is not eligible for one delivery attempt."""


class CanonicalDeliveryTransportError(CanonicalDeliveryError):
    """Typed transport failure carrying only an outbox-safe failure code."""

    def __init__(self, failure_code: str) -> None:
        self.failure_code = (
            failure_code
            if _valid_failure_code(failure_code)
            else FAILURE_TRANSPORT_FAILED
        )
        super().__init__("Canonical submission transport failed.")


class CanonicalOutboxDeliveryPort(Protocol):
    def read(self, entry_key: str) -> dict: ...

    def mark_failed(
        self,
        entry_key: str,
        expected_state_revision: int,
        attempted_at_ms: int,
        failure_code: str,
    ) -> dict: ...

    def mark_synced(
        self,
        entry_key: str,
        expected_state_revision: int,
        attempted_at_ms: int,
    ) -> dict: ...


AuthenticatedCanonicalSubmissionTransport = Callable[[dict], object]
ReviewedEvidenceReferenceAllowlist = Callable[[tuple[dict, ...]], bool]


def _valid_failure_code(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) <= 64
        and _FAILURE_CODE.fullmatch(value) is not None
    )


def _valid_timestamp(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= MAX_TIMESTAMP_MS
    )


def _valid_outbox_port(value: object) -> bool:
    try:
        return all(
            callable(getattr(value, method, None))
            for method in ("read", "mark_failed", "mark_synced")
        )
    except Exception:
        return False


def _evidence_references(submission: object) -> tuple[dict, ...]:
    if (
        not isinstance(submission, dict)
        or not isinstance(submission.get("submissionId"), str)
        or not submission["submissionId"]
        or isinstance(submission.get("revision"), bool)
        or not isinstance(submission.get("revision"), int)
        or submission["revision"] < 1
    ):
        raise CanonicalDeliveryStateError("Canonical delivery state is invalid.")
    evidence = submission.get("evidence", [])
    if not isinstance(evidence, list) or not all(
        isinstance(reference, dict) for reference in evidence
    ):
        raise CanonicalDeliveryStateError("Canonical delivery state is invalid.")
    return tuple(deepcopy(reference) for reference in evidence)


def _acknowledges(response: object, submission: dict) -> bool:
    return (
        isinstance(response, dict)
        and set(response) == {"submissionId", "revision"}
        and isinstance(response["submissionId"], str)
        and isinstance(response["revision"], int)
        and not isinstance(response["revision"], bool)
        and response["submissionId"] == submission.get("submissionId")
        and response["revision"] == submission.get("revision")
    )


class ExplicitCanonicalOutboxDeliveryCoordinator:
    """Deliver one caller-selected pending entry without private-evidence access."""

    def __init__(
        self,
        outbox: CanonicalOutboxDeliveryPort,
        authenticated_transport: AuthenticatedCanonicalSubmissionTransport,
        reviewed_evidence_allowlist: ReviewedEvidenceReferenceAllowlist,
    ) -> None:
        if (
            not _valid_outbox_port(outbox)
            or not callable(authenticated_transport)
            or not callable(reviewed_evidence_allowlist)
        ):
            raise CanonicalDeliveryConfigurationError(
                "Canonical delivery configuration is invalid."
            )
        self._outbox = outbox
        self._transport = authenticated_transport
        self._evidence_allowlist = reviewed_evidence_allowlist
        # One reference-process coordinator serializes attempts. Durable state
        # revisions remain the cross-instance conflict authority.
        self._attempt_lock = Lock()

    def deliver(self, entry_key: str, attempted_at_ms: int) -> dict:
        """Perform one explicit attempt and append exactly one result state."""
        if (
            not isinstance(entry_key, str)
            or _ENTRY_KEY.fullmatch(entry_key) is None
            or not _valid_timestamp(attempted_at_ms)
        ):
            raise CanonicalDeliveryStateError("Canonical delivery input is invalid.")

        with self._attempt_lock:
            record = self._outbox.read(entry_key)
            if (
                not isinstance(record, dict)
                or set(record) != {"entry", "canonicalSubmission", "state"}
                or not isinstance(record.get("entry"), dict)
                or record["entry"].get("entryKey") != entry_key
                or not isinstance(record.get("state"), dict)
                or record["state"].get("entryKey") != entry_key
                or record["state"].get("state") != "pending"
                or isinstance(record["state"].get("stateRevision"), bool)
                or not isinstance(record["state"].get("stateRevision"), int)
                or record["state"]["stateRevision"] < 1
                or not _valid_timestamp(record["state"].get("updatedAtMs"))
                or attempted_at_ms < record["state"]["updatedAtMs"]
            ):
                raise CanonicalDeliveryStateError(
                    "Canonical delivery requires a pending outbox entry."
                )

            submission = record["canonicalSubmission"]
            evidence = _evidence_references(submission)
            state_revision = record["state"]["stateRevision"]

            try:
                allowed = self._evidence_allowlist(deepcopy(evidence))
            except Exception:
                return self._outbox.mark_failed(
                    entry_key,
                    state_revision,
                    attempted_at_ms,
                    FAILURE_EVIDENCE_REVIEW_FAILED,
                )
            if allowed is not True:
                return self._outbox.mark_failed(
                    entry_key,
                    state_revision,
                    attempted_at_ms,
                    FAILURE_EVIDENCE_NOT_ALLOWLISTED,
                )

            try:
                response = self._transport(deepcopy(submission))
            except CanonicalDeliveryTransportError as error:
                return self._outbox.mark_failed(
                    entry_key,
                    state_revision,
                    attempted_at_ms,
                    error.failure_code,
                )
            except Exception:
                return self._outbox.mark_failed(
                    entry_key,
                    state_revision,
                    attempted_at_ms,
                    FAILURE_TRANSPORT_FAILED,
                )

            if not _acknowledges(response, submission):
                return self._outbox.mark_failed(
                    entry_key,
                    state_revision,
                    attempted_at_ms,
                    FAILURE_RESPONSE_INVALID,
                )
            return self._outbox.mark_synced(
                entry_key,
                state_revision,
                attempted_at_ms,
            )
