"""Production-local LiveTrial profile and report-to-outbox composition."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Protocol
import uuid

from livetrial_runtime_root import install_outbox_reference_path


# Resource lookups must survive a frozen bundle, so the shared outbox reference
# is resolved through the runtime resource root instead of this file's parents.
install_outbox_reference_path()

from livetrial_adapter import LiveTrialSubmissionContext
from livetrial_asset_catalog import Schema9LiveTrialAssetCatalog
from livetrial_report import LiveTrialReportCandidate
from livetrial_report import parse_livetrial_report
from livetrial_report_output import deliver_livetrial_report_run
from mk8dx_local_outbox import entry_key_for


PROFILE_SCHEMA_VERSION = "mk8dx.livetrial-local-profile.v1"
CATALOG_SOURCE_SHA256 = (
    "2375050f7a332c5bbe89a9109356e07759cc7432f5f804ba004d298c479950c0"
)
MAX_JSON_BYTES = 1024 * 1024
MAX_TIMESTAMP_MS = 253_402_300_799_999
_INSTALLATION_ID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_PRODUCER_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_PLAYER_ID = re.compile(r"^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")


class LiveTrialProductError(RuntimeError):
    """Bounded product-composition failure without private input detail."""


class LiveTrialProductOutbox(Protocol):
    def create(
        self,
        canonical_submission: dict,
        created_at_ms: int,
        private_evidence: dict | None = None,
    ) -> dict: ...

    def read(self, entry_key: str) -> dict: ...

    def read_private_evidence(self, entry_key: str) -> dict: ...


def _fail() -> None:
    raise LiveTrialProductError("LiveTrial product operation failed.") from None


def create_local_profile_document(
    producer_version: str,
    installation_id: str | None = None,
) -> dict:
    """Create an untrusted local profile, never a central Player claim."""
    identifier = str(uuid.uuid4()) if installation_id is None else installation_id
    document = {
        "schemaVersion": PROFILE_SCHEMA_VERSION,
        "installationId": identifier,
        "producerVersion": producer_version,
    }
    return parse_local_profile_document(document)


def parse_local_profile_document(document: object) -> dict:
    """Validate the exact non-authenticated product-local profile shape."""
    if (
        not isinstance(document, dict)
        or set(document)
        != {"schemaVersion", "installationId", "producerVersion"}
        or document.get("schemaVersion") != PROFILE_SCHEMA_VERSION
        or not isinstance(document.get("installationId"), str)
        or _INSTALLATION_ID.fullmatch(document["installationId"]) is None
        or not isinstance(document.get("producerVersion"), str)
        or _PRODUCER_VERSION.fullmatch(document["producerVersion"]) is None
    ):
        _fail()
    return deepcopy(document)


def read_local_profile(path: str | Path) -> dict:
    return parse_local_profile_document(_read_json(path, 16 * 1024))


def product_report_run_numbers(path: str | Path) -> tuple[int, ...]:
    """List eligible finished-run numbers from one strict report input."""
    try:
        return tuple(
            candidate.run_number
            for candidate in parse_livetrial_report(_read_json(path))
        )
    except Exception:
        _fail()


def write_new_local_profile(path: str | Path, document: object) -> None:
    profile = parse_local_profile_document(document)
    try:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = (
            json.dumps(profile, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        ).encode("utf-8")
        with target.open("xb") as stream:
            stream.write(payload)
            stream.flush()
        try:
            target.chmod(0o600)
        except OSError:
            pass
    except (OSError, TypeError, ValueError):
        _fail()


def _read_json(path: str | Path, maximum: int = MAX_JSON_BYTES) -> object:
    try:
        target = Path(path)
        if target.is_symlink() or not target.is_file():
            _fail()
        payload = target.read_bytes()
        if not payload or len(payload) > maximum:
            _fail()
        return json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except LiveTrialProductError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
        _fail()


def _reject_constant(_: str) -> None:
    raise ValueError


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _canonical_bytes(value: object) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        _fail()


def _candidate_timestamp(candidate: LiveTrialReportCandidate, fallback_ms: int) -> int:
    value = candidate.run.get("closedAt")
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        timestamp = round(value * 1000)
    else:
        timestamp = fallback_ms
    if not isinstance(timestamp, int) or not 0 <= timestamp <= MAX_TIMESTAMP_MS:
        _fail()
    return timestamp


def _context_for_candidate(
    profile: dict,
    source_kind: str,
    candidate: LiveTrialReportCandidate,
    fallback_timestamp_ms: int,
    player_id: str | None,
) -> LiveTrialSubmissionContext:
    if (
        source_kind not in {"livetrial_capture", "livetrial_recorded_video"}
        or (source_kind == "livetrial_capture")
        != candidate.source_input.startswith("live:")
    ):
        _fail()
    coordinate = {
        "installationId": profile["installationId"],
        "sourceKind": source_kind,
        "sourceInput": candidate.source_input,
        "runNumber": candidate.run_number,
        "run": candidate.run,
    }
    digest = hashlib.sha256(_canonical_bytes(coordinate)).hexdigest()
    timestamp = _candidate_timestamp(candidate, fallback_timestamp_ms)
    evidence_kind = "capture_session" if source_kind == "livetrial_capture" else "video"
    if player_id is not None and (
        not isinstance(player_id, str)
        or len(player_id) > 135
        or _PLAYER_ID.fullmatch(player_id) is None
    ):
        _fail()
    return LiveTrialSubmissionContext(
        submission_id=f"user_submission.time.LIVETRIAL{digest}",
        revision=1,
        source_kind=source_kind,
        player_reference=(
            {"namespace": "player", "value": player_id}
            if player_id is not None
            else {
                "namespace": "producer_local_profile",
                "value": f"livetrial.{profile['installationId']}",
            }
        ),
        producer_version=profile["producerVersion"],
        local_record_id=f"livetrial.{digest}",
        created_at_ms=timestamp,
        occurred_at_ms=timestamp,
        captured_at_ms=timestamp,
        evidence=(
            {
                "kind": evidence_kind,
                "reference": f"livetrial/{digest}",
            },
        ),
        source_input=candidate.source_input,
    )


def _existing_matches(outbox: LiveTrialProductOutbox, envelope: dict) -> dict | None:
    submission = envelope["canonicalSubmission"]
    entry_key = entry_key_for(submission["submissionId"], submission["revision"])
    try:
        record = outbox.read(entry_key)
        private_document = outbox.read_private_evidence(entry_key)
    except Exception:
        return None
    existing_submission = record.get("canonicalSubmission")
    same_submission = existing_submission == submission
    if isinstance(existing_submission, dict):
        existing_without_identity = deepcopy(existing_submission)
        candidate_without_identity = deepcopy(submission)
        existing_without_identity.pop("playerReference", None)
        candidate_without_identity.pop("playerReference", None)
        same_run_with_first_saved_identity = (
            existing_without_identity == candidate_without_identity
        )
    else:
        same_run_with_first_saved_identity = False
    if (
        not (same_submission or same_run_with_first_saved_identity)
        or private_document.get("privateEvidence") != envelope["localEvidence"]
    ):
        _fail()
    return record


def race_fingerprint(submission: object) -> tuple | None:
    """What makes two saved submissions the same race, whatever their ids say."""
    try:
        return (
            submission["source"]["kind"],
            submission["timestamps"]["capturedAtMs"],
            submission["trackId"],
            submission["mode"],
            submission["totalTimeMs"],
            tuple(lap["timeMs"] for lap in submission["laps"]),
        )
    except (KeyError, TypeError):
        return None


def _saved_same_race(outbox: LiveTrialProductOutbox, envelope: dict) -> dict | None:
    """The record already holding this race under an earlier id, if any.

    The id digest covers the whole report run, and the engine rewrites a
    finished run's report (end screen, identity) moments after first writing
    it, so one race could otherwise be saved - and sent - twice.
    """
    listing = getattr(outbox, "list", None)
    fingerprint = race_fingerprint(envelope["canonicalSubmission"])
    if listing is None or fingerprint is None:
        return None
    try:
        records = listing()
    except Exception:
        return None
    for record in records:
        if race_fingerprint(record.get("canonicalSubmission")) == fingerprint:
            return deepcopy(record)
    return None


def deliver_product_report_run_to_outbox(
    report_path: str | Path,
    catalog_path: str | Path,
    profile: object,
    source_kind: str,
    run_number: int,
    outbox_created_at_ms: int,
    outbox: LiveTrialProductOutbox,
    player_id: str | None = None,
) -> tuple[dict, bool]:
    """Idempotently save one explicit finished run through the production-local path."""
    parsed_profile = parse_local_profile_document(profile)
    if (
        not isinstance(outbox_created_at_ms, int)
        or isinstance(outbox_created_at_ms, bool)
        or not 0 <= outbox_created_at_ms <= MAX_TIMESTAMP_MS
    ):
        _fail()
    report_document = _read_json(report_path)
    catalog_document = _read_json(catalog_path, 4 * 1024 * 1024)
    try:
        report_timestamp_ms = Path(report_path).stat().st_mtime_ns // 1_000_000
        catalog = Schema9LiveTrialAssetCatalog(
            catalog_document,
            CATALOG_SOURCE_SHA256,
        )
    except Exception:
        _fail()
    envelopes: list[dict] = []
    try:
        deliver_livetrial_report_run(
            report_document,
            run_number,
            lambda candidate: _context_for_candidate(
                parsed_profile,
                source_kind,
                candidate,
                report_timestamp_ms,
                player_id,
            ),
            catalog,
            envelopes.append,
        )
    except Exception:
        _fail()
    if len(envelopes) != 1:
        _fail()
    envelope = envelopes[0]
    existing = _existing_matches(outbox, envelope)
    if existing is not None:
        return existing, False
    same_race = _saved_same_race(outbox, envelope)
    if same_race is not None:
        return same_race, False
    try:
        record = outbox.create(
            envelope["canonicalSubmission"],
            outbox_created_at_ms,
            envelope["localEvidence"],
        )
    except Exception:
        existing = _existing_matches(outbox, envelope)
        if existing is None:
            _fail()
        return existing, False
    return deepcopy(record), True
