"""Explicit canonical-only LiveTrial synchronization composition."""

from __future__ import annotations

from copy import deepcopy
import json
import re
from typing import Callable, Protocol

from livetrial_runtime_root import install_outbox_reference_path


# The shared outbox reference lives beside the bundled resources, never at a
# path derived from this file's position in a repository checkout.
install_outbox_reference_path()

from mk8dx_outbox_delivery import (
    CanonicalDeliveryConfigurationError,
    CanonicalDeliveryStateError,
    CanonicalDeliveryTransportError,
    ExplicitCanonicalOutboxDeliveryCoordinator,
)


CANONICAL_SUBMISSION_PATH = "/v1/time-trial-submissions"
MAX_CANONICAL_REQUEST_BYTES = 64 * 1024
MAX_CANONICAL_RESPONSE_BYTES = 4 * 1024
MAX_TIMESTAMP_MS = 253_402_300_799_999
_ENTRY_KEY = re.compile(r"^[0-9a-f]{64}$")
_FAILURE_CODE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
IMPLAUSIBLE_TIME = "http.implausible-time"


def _is_implausible_time(body: bytes) -> bool:
    try:
        document = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return False
    return isinstance(document, dict) and document.get("code") == "time_trial_time_implausible"


class LiveTrialAuthenticatedRequestExecutor(Protocol):
    def execute(
        self,
        path: str,
        headers: dict[str, str],
        body: bytes,
    ) -> object: ...


class LiveTrialCanonicalSynchronizationPort(Protocol):
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

    def request_retry(
        self,
        entry_key: str,
        expected_state_revision: int,
        requested_at_ms: int,
    ) -> dict: ...


class LiveTrialSynchronizationError(RuntimeError):
    """Bounded synchronization failure without local or remote detail."""


def _timestamp(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= MAX_TIMESTAMP_MS
    )


def _submission_identity(submission: object) -> tuple[str, int]:
    if (
        not isinstance(submission, dict)
        or not isinstance(submission.get("submissionId"), str)
        or not submission["submissionId"]
        or not isinstance(submission.get("revision"), int)
        or isinstance(submission["revision"], bool)
        or submission["revision"] < 1
    ):
        raise CanonicalDeliveryTransportError("request.invalid")
    return submission["submissionId"], submission["revision"]


class LiveTrialCanonicalSubmissionRequestTransport:
    """Project canonical V1 onto one already authenticated request executor."""

    def __init__(self, executor: LiveTrialAuthenticatedRequestExecutor) -> None:
        if not callable(getattr(executor, "execute", None)):
            raise CanonicalDeliveryConfigurationError(
                "LiveTrial synchronization transport is invalid."
            )
        self._executor = executor

    def __call__(self, submission: dict) -> object:
        submission_id, revision = _submission_identity(submission)
        try:
            body = json.dumps(
                deepcopy(submission),
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        except Exception:
            raise CanonicalDeliveryTransportError("request.invalid") from None
        if not body or len(body) > MAX_CANONICAL_REQUEST_BYTES:
            raise CanonicalDeliveryTransportError("request.invalid")
        try:
            response = self._executor.execute(
                CANONICAL_SUBMISSION_PATH,
                {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8",
                },
                body,
            )
        except Exception:
            raise CanonicalDeliveryTransportError("http.unavailable") from None
        if not isinstance(response, dict) or set(response) != {"statusCode", "body"}:
            return None
        status = response["statusCode"]
        response_body = response["body"]
        if (
            not isinstance(status, int)
            or isinstance(status, bool)
            or not isinstance(response_body, bytes)
            or len(response_body) > MAX_CANONICAL_RESPONSE_BYTES
        ):
            return None
        if status == 400 and _is_implausible_time(response_body):
            # More than 12 % faster than the World Record (owner 2026-09-28): said as such, not retried.
            raise CanonicalDeliveryTransportError(IMPLAUSIBLE_TIME)
        if status != 201:
            failure_code = {
                401: "http.unauthorized",
                403: "http.forbidden",
                409: "http.conflict",
            }.get(status, "http.unavailable" if 500 <= status <= 599 else "http.failed")
            raise CanonicalDeliveryTransportError(failure_code)
        try:
            acknowledgement = json.loads(response_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        if acknowledgement != {
            "submissionId": submission_id,
            "revision": revision,
        }:
            return None
        return acknowledgement


class LiveTrialExplicitSynchronizationHost:
    """Synchronize or retry only one caller-selected local canonical entry."""

    def __init__(
        self,
        outbox: LiveTrialCanonicalSynchronizationPort,
        authenticated_executor: LiveTrialAuthenticatedRequestExecutor,
        reviewed_evidence_allowlist: Callable[[tuple[dict, ...]], bool],
        clock: Callable[[], int],
    ) -> None:
        if (
            not callable(getattr(outbox, "request_retry", None))
            or not callable(clock)
        ):
            raise CanonicalDeliveryConfigurationError(
                "LiveTrial synchronization configuration is invalid."
            )
        self._outbox = outbox
        self._clock = clock
        self._coordinator = ExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            LiveTrialCanonicalSubmissionRequestTransport(authenticated_executor),
            reviewed_evidence_allowlist,
        )

    def synchronize_entry(self, entry_key: str) -> dict:
        return _status(self._coordinator.deliver(entry_key, self._now()))

    def request_retry(self, entry_key: str) -> dict:
        if not isinstance(entry_key, str) or _ENTRY_KEY.fullmatch(entry_key) is None:
            raise LiveTrialSynchronizationError("LiveTrial synchronization input is invalid.")
        try:
            record = self._outbox.read(entry_key)
            state = record["state"]
            if state.get("state") != "failed":
                raise LiveTrialSynchronizationError(
                    "LiveTrial synchronization retry requires a failed entry."
                )
            return _status(
                self._outbox.request_retry(
                    entry_key,
                    state["stateRevision"],
                    self._now(),
                )
            )
        except LiveTrialSynchronizationError:
            raise
        except Exception:
            raise LiveTrialSynchronizationError(
                "LiveTrial synchronization retry failed."
            ) from None

    def _now(self) -> int:
        value = self._clock()
        if not _timestamp(value):
            raise LiveTrialSynchronizationError(
                "LiveTrial synchronization clock is invalid."
            )
        return value


def _status(record: object) -> dict:
    try:
        entry = record["entry"]
        state = record["state"]
        result = {
            "entryKey": entry["entryKey"],
            "state": state["state"],
            "stateRevision": state["stateRevision"],
            "attemptCount": state["attemptCount"],
            "updatedAtMs": state["updatedAtMs"],
        }
        if "failureCode" in state:
            result["failureCode"] = state["failureCode"]
        if "syncedAtMs" in state:
            result["syncedAtMs"] = state["syncedAtMs"]
    except Exception:
        raise LiveTrialSynchronizationError(
            "LiveTrial synchronization state is invalid."
        ) from None
    if (
        not isinstance(result["entryKey"], str)
        or _ENTRY_KEY.fullmatch(result["entryKey"]) is None
        or result["state"] not in {"pending", "failed", "synced"}
        or not isinstance(result["stateRevision"], int)
        or isinstance(result["stateRevision"], bool)
        or result["stateRevision"] < 1
        or not isinstance(result["attemptCount"], int)
        or isinstance(result["attemptCount"], bool)
        or result["attemptCount"] < 0
        or not _timestamp(result["updatedAtMs"])
    ):
        raise LiveTrialSynchronizationError(
            "LiveTrial synchronization state is invalid."
        )
    failure_code = result.get("failureCode")
    synced_at_ms = result.get("syncedAtMs")
    if (
        (result["state"] == "failed" and (
            not isinstance(failure_code, str)
            or len(failure_code) > 64
            or _FAILURE_CODE.fullmatch(failure_code) is None
            or synced_at_ms is not None
        ))
        or (result["state"] == "synced" and (
            failure_code is not None or not _timestamp(synced_at_ms)
        ))
        or (result["state"] == "pending" and (
            failure_code is not None or synced_at_ms is not None
        ))
    ):
        raise LiveTrialSynchronizationError(
            "LiveTrial synchronization state is invalid."
        )
    return result
