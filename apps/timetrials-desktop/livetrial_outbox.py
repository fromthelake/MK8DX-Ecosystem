"""LiveTrial composition into the shared local canonical outbox boundary."""

from __future__ import annotations

from typing import Protocol

from livetrial_local_host import deliver_livetrial_report_context_file


class LiveTrialOutboxPort(Protocol):
    def create(
        self,
        canonical_submission: dict,
        created_at_ms: int,
        private_evidence: dict | None = None,
    ) -> dict:
        """Persist one canonical submission plus separate private evidence."""


class LiveTrialOutboxError(RuntimeError):
    """Bounded outbox composition error without private output detail."""


def deliver_livetrial_report_context_to_outbox(
    report_path: str,
    catalog_path: str,
    context_path: str,
    expected_catalog_source_sha256: str,
    run_number: int,
    outbox_created_at_ms: int,
    outbox: LiveTrialOutboxPort,
) -> dict:
    """Select one report run and make durable outbox publication its output call."""
    published: list[dict] = []

    def publish(envelope: dict) -> None:
        if published:
            raise LiveTrialOutboxError("LiveTrial outbox delivery failed.")
        try:
            record = outbox.create(
                envelope["canonicalSubmission"],
                outbox_created_at_ms,
                envelope["localEvidence"],
            )
        except Exception:
            raise LiveTrialOutboxError("LiveTrial outbox delivery failed.") from None
        published.append(record)

    envelope = deliver_livetrial_report_context_file(
        report_path,
        catalog_path,
        context_path,
        expected_catalog_source_sha256,
        run_number,
        publish,
    )
    if (
        len(published) != 1
        or published[0].get("canonicalSubmission")
        != envelope.get("canonicalSubmission")
        or published[0].get("entry", {}).get("privateEvidencePresent") is not True
    ):
        raise LiveTrialOutboxError("LiveTrial outbox delivery failed.")
    return published[0]
