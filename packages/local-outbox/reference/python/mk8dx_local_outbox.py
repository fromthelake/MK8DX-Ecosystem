"""Filesystem reference for the MK8DX local Time Trial outbox contract."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Callable
import uuid


ENTRY_SCHEMA_VERSION = "mk8dx.local-time-trial-outbox-entry.v1"
STATE_SCHEMA_VERSION = "mk8dx.local-time-trial-outbox-state.v1"
EVIDENCE_SCHEMA_VERSION = "mk8dx.local-private-evidence.v1"
TIME_TRIAL_SCHEMA_VERSION = "mk8dx.time-trial-submission.v1"
MAX_TIMESTAMP_MS = 253_402_300_799_999
MAX_SUBMISSION_BYTES = 64 * 1024
MAX_PRIVATE_EVIDENCE_BYTES = 1024 * 1024
MAX_STATE_REVISIONS = 10_000

_ENTRY_KEY = re.compile(r"^[0-9a-f]{64}$")
_STATE_FILE = re.compile(r"^(?P<revision>[0-9]{10})\.json$")
_FAILURE_CODE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")


class LocalOutboxError(RuntimeError):
    """Bounded local outbox error without paths or private values."""


class LocalOutboxValidationError(LocalOutboxError):
    """Input or persisted contract validation failed."""


class LocalOutboxConflictError(LocalOutboxError):
    """An entry exists or its expected state changed."""


class LocalOutboxNotFoundError(LocalOutboxError):
    """The requested canonical entry does not exist."""


CanonicalSubmissionValidator = Callable[[dict], None]


def entry_key_for(submission_id: str, revision: int) -> str:
    """Return the specified path-safe SHA-256 coordinate."""
    if (
        not isinstance(submission_id, str)
        or not submission_id
        or isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 1
    ):
        raise LocalOutboxValidationError("Local outbox input is invalid.")
    coordinate = submission_id.encode("utf-8") + b"\0" + str(revision).encode("ascii")
    return hashlib.sha256(coordinate).hexdigest()


def _valid_timestamp(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= MAX_TIMESTAMP_MS
    )


def _json_bytes(value: object) -> bytes:
    try:
        return (
            json.dumps(
                value,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            )
            + "\n"
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise LocalOutboxValidationError("Local outbox input is invalid.") from None


def _reject_constant(_: str) -> None:
    raise ValueError


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _parse_json(payload: bytes, maximum: int) -> object:
    if not payload or len(payload) > maximum:
        raise LocalOutboxValidationError("Local outbox data is invalid.")
    try:
        return json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeError, json.JSONDecodeError, ValueError):
        raise LocalOutboxValidationError("Local outbox data is invalid.") from None


def _write_new_file(path: Path, payload: bytes) -> None:
    created = False
    try:
        with path.open("xb") as stream:
            created = True
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except OSError:
        if created:
            try:
                path.unlink()
            except OSError:
                pass
        raise LocalOutboxError("Local outbox write failed.") from None


def _fsync_directory(path: Path) -> None:
    flags = getattr(os, "O_RDONLY", 0)
    directory_flag = getattr(os, "O_DIRECTORY", 0)
    try:
        descriptor = os.open(path, flags | directory_flag)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def _install_file_exclusive(target: Path, payload: bytes) -> None:
    temporary = target.parent / f".{target.name}.{uuid.uuid4().hex}.tmp"
    try:
        _write_new_file(temporary, payload)
        try:
            os.link(temporary, target)
        except FileExistsError:
            raise LocalOutboxConflictError("Local outbox entry already exists.") from None
        except OSError:
            raise LocalOutboxError("Local outbox write failed.") from None
        _fsync_directory(target.parent)
    finally:
        try:
            temporary.unlink()
        except OSError:
            pass


def _read_regular_file(path: Path, maximum: int) -> bytes:
    try:
        if path.is_symlink() or not path.is_file():
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        size = path.stat().st_size
        if size < 1 or size > maximum:
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        payload = path.read_bytes()
    except LocalOutboxError:
        raise
    except OSError:
        raise LocalOutboxError("Local outbox read failed.") from None
    if len(payload) != size:
        raise LocalOutboxValidationError("Local outbox data is invalid.")
    return payload


def _exact_keys(value: object, required: set[str], optional: set[str] | None = None) -> bool:
    return isinstance(value, dict) and set(value) == required | (optional or set())


class LocalTimeTrialOutbox:
    """No-network, append-only-state filesystem outbox."""

    def __init__(
        self,
        canonical_root: str | Path,
        private_evidence_root: str | Path,
        validate_submission: CanonicalSubmissionValidator,
    ) -> None:
        if not callable(validate_submission):
            raise LocalOutboxValidationError("Local outbox configuration is invalid.")
        try:
            canonical = Path(canonical_root).resolve(strict=False)
            private = Path(private_evidence_root).resolve(strict=False)
            if (
                canonical == private
                or canonical in private.parents
                or private in canonical.parents
            ):
                raise LocalOutboxValidationError(
                    "Local outbox configuration is invalid."
                )
            canonical.mkdir(parents=True, exist_ok=True)
            private.mkdir(parents=True, exist_ok=True)
            canonical = canonical.resolve(strict=True)
            private = private.resolve(strict=True)
        except LocalOutboxError:
            raise
        except (OSError, TypeError, ValueError):
            raise LocalOutboxValidationError(
                "Local outbox configuration is invalid."
            ) from None
        if (
            not canonical.is_dir()
            or not private.is_dir()
            or canonical == private
            or canonical in private.parents
            or private in canonical.parents
        ):
            raise LocalOutboxValidationError("Local outbox configuration is invalid.")
        self._canonical_root = canonical
        self._private_root = private
        self._validate_submission_port = validate_submission

    def create(
        self,
        canonical_submission: dict,
        created_at_ms: int,
        private_evidence: dict | None = None,
    ) -> dict:
        """Atomically publish a complete pending canonical entry."""
        submission = self._validated_submission(canonical_submission)
        if not _valid_timestamp(created_at_ms):
            raise LocalOutboxValidationError("Local outbox input is invalid.")
        submission_payload = _json_bytes(submission)
        if len(submission_payload) > MAX_SUBMISSION_BYTES:
            raise LocalOutboxValidationError("Local outbox input is invalid.")

        entry_key = entry_key_for(submission["submissionId"], submission["revision"])
        target = self._canonical_root / entry_key
        evidence_target = self._private_root / f"{entry_key}.json"
        if target.exists() or target.is_symlink():
            raise LocalOutboxConflictError("Local outbox entry already exists.")

        evidence_payload: bytes | None = None
        if private_evidence is not None:
            if not isinstance(private_evidence, dict) or len(private_evidence) > 64:
                raise LocalOutboxValidationError("Local outbox input is invalid.")
            evidence_document = {
                "schemaVersion": EVIDENCE_SCHEMA_VERSION,
                "entryKey": entry_key,
                "createdAtMs": created_at_ms,
                "privateEvidence": deepcopy(private_evidence),
            }
            evidence_payload = _json_bytes(evidence_document)
            if len(evidence_payload) > MAX_PRIVATE_EVIDENCE_BYTES:
                raise LocalOutboxValidationError("Local outbox input is invalid.")
        elif evidence_target.exists() or evidence_target.is_symlink():
            raise LocalOutboxConflictError("Local outbox entry already exists.")

        entry = {
            "schemaVersion": ENTRY_SCHEMA_VERSION,
            "entryKey": entry_key,
            "submissionSha256": hashlib.sha256(submission_payload).hexdigest(),
            "createdAtMs": created_at_ms,
            "privateEvidencePresent": evidence_payload is not None,
        }
        initial_state = {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "entryKey": entry_key,
            "stateRevision": 1,
            "state": "pending",
            "attemptCount": 0,
            "updatedAtMs": created_at_ms,
        }

        evidence_created = False
        temporary_directory: Path | None = None
        published = False
        try:
            if evidence_payload is not None:
                _install_file_exclusive(evidence_target, evidence_payload)
                evidence_created = True

            temporary_directory = Path(
                tempfile.mkdtemp(prefix=".entry-", dir=self._canonical_root)
            )
            states = temporary_directory / "states"
            states.mkdir()
            _write_new_file(temporary_directory / "entry.json", _json_bytes(entry))
            _write_new_file(temporary_directory / "submission.json", submission_payload)
            _write_new_file(states / "0000000001.json", _json_bytes(initial_state))
            _fsync_directory(states)
            _fsync_directory(temporary_directory)
            try:
                os.rename(temporary_directory, target)
            except FileExistsError:
                raise LocalOutboxConflictError(
                    "Local outbox entry already exists."
                ) from None
            except OSError:
                raise LocalOutboxError("Local outbox write failed.") from None
            published = True
            _fsync_directory(self._canonical_root)
        except LocalOutboxError:
            raise
        except OSError:
            raise LocalOutboxError("Local outbox write failed.") from None
        finally:
            if temporary_directory is not None and temporary_directory.exists():
                shutil.rmtree(temporary_directory, ignore_errors=True)
            if evidence_created and not published:
                try:
                    evidence_target.unlink()
                    _fsync_directory(self._private_root)
                except OSError:
                    pass
        return self.read(entry_key)

    def read(self, entry_key: str) -> dict:
        """Return canonical data and latest state, never private evidence."""
        entry_path = self._entry_path(entry_key)
        if not entry_path.exists():
            raise LocalOutboxNotFoundError("Local outbox entry was not found.")
        if entry_path.is_symlink() or not entry_path.is_dir():
            raise LocalOutboxValidationError("Local outbox data is invalid.")

        manifest = _parse_json(
            _read_regular_file(entry_path / "entry.json", 4096), 4096
        )
        self._validate_manifest(manifest, entry_key)
        submission_payload = _read_regular_file(
            entry_path / "submission.json", MAX_SUBMISSION_BYTES
        )
        if hashlib.sha256(submission_payload).hexdigest() != manifest["submissionSha256"]:
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        submission = _parse_json(submission_payload, MAX_SUBMISSION_BYTES)
        submission = self._validated_submission(submission)
        if entry_key_for(submission["submissionId"], submission["revision"]) != entry_key:
            raise LocalOutboxValidationError("Local outbox data is invalid.")

        evidence_path = self._private_root / f"{entry_key}.json"
        present = evidence_path.exists() or evidence_path.is_symlink()
        if present != manifest["privateEvidencePresent"]:
            raise LocalOutboxValidationError("Local outbox data is invalid.")

        states = self._read_states(entry_path, entry_key, manifest["createdAtMs"])
        return {
            "entry": deepcopy(manifest),
            "canonicalSubmission": deepcopy(submission),
            "state": deepcopy(states[-1]),
        }

    def read_private_evidence(self, entry_key: str) -> dict:
        """Use a separate explicit operation to access local private evidence."""
        record = self.read(entry_key)
        if not record["entry"]["privateEvidencePresent"]:
            raise LocalOutboxNotFoundError("Local private evidence was not found.")
        path = self._private_root / f"{entry_key}.json"
        document = _parse_json(
            _read_regular_file(path, MAX_PRIVATE_EVIDENCE_BYTES),
            MAX_PRIVATE_EVIDENCE_BYTES,
        )
        required = {"schemaVersion", "entryKey", "createdAtMs", "privateEvidence"}
        if (
            not _exact_keys(document, required)
            or document["schemaVersion"] != EVIDENCE_SCHEMA_VERSION
            or document["entryKey"] != entry_key
            or document["createdAtMs"] != record["entry"]["createdAtMs"]
            or not isinstance(document["privateEvidence"], dict)
            or len(document["privateEvidence"]) > 64
        ):
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        return deepcopy(document)

    def list(self, state: str | None = None) -> list[dict]:
        """List canonical records only, optionally filtered by latest state."""
        if state is not None and state not in {"pending", "failed", "synced"}:
            raise LocalOutboxValidationError("Local outbox input is invalid.")
        records: list[dict] = []
        try:
            children = sorted(self._canonical_root.iterdir(), key=lambda item: item.name)
        except OSError:
            raise LocalOutboxError("Local outbox read failed.") from None
        for child in children:
            if child.name.startswith(".entry-"):
                continue
            if not _ENTRY_KEY.fullmatch(child.name):
                raise LocalOutboxValidationError("Local outbox data is invalid.")
            record = self.read(child.name)
            if state is None or record["state"]["state"] == state:
                records.append(record)
        return records

    def mark_failed(
        self,
        entry_key: str,
        expected_state_revision: int,
        attempted_at_ms: int,
        failure_code: str,
    ) -> dict:
        if (
            not isinstance(failure_code, str)
            or len(failure_code) > 64
            or _FAILURE_CODE.fullmatch(failure_code) is None
        ):
            raise LocalOutboxValidationError("Local outbox input is invalid.")
        return self._transition(
            entry_key,
            expected_state_revision,
            attempted_at_ms,
            "failed",
            failure_code,
        )

    def request_retry(
        self,
        entry_key: str,
        expected_state_revision: int,
        requested_at_ms: int,
    ) -> dict:
        return self._transition(
            entry_key,
            expected_state_revision,
            requested_at_ms,
            "pending",
            None,
        )

    def mark_synced(
        self,
        entry_key: str,
        expected_state_revision: int,
        attempted_at_ms: int,
    ) -> dict:
        return self._transition(
            entry_key,
            expected_state_revision,
            attempted_at_ms,
            "synced",
            None,
        )

    def _transition(
        self,
        entry_key: str,
        expected_state_revision: int,
        updated_at_ms: int,
        target_state: str,
        failure_code: str | None,
    ) -> dict:
        if (
            isinstance(expected_state_revision, bool)
            or not isinstance(expected_state_revision, int)
            or expected_state_revision < 1
            or not _valid_timestamp(updated_at_ms)
        ):
            raise LocalOutboxValidationError("Local outbox input is invalid.")
        current_record = self.read(entry_key)
        current = current_record["state"]
        if current["stateRevision"] != expected_state_revision:
            raise LocalOutboxConflictError("Local outbox state changed.")
        if updated_at_ms < current["updatedAtMs"]:
            raise LocalOutboxValidationError("Local outbox input is invalid.")

        revision = expected_state_revision + 1
        if revision > MAX_STATE_REVISIONS:
            raise LocalOutboxValidationError("Local outbox state limit was reached.")
        next_state = {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "entryKey": entry_key,
            "stateRevision": revision,
            "state": target_state,
            "attemptCount": current["attemptCount"],
            "updatedAtMs": updated_at_ms,
        }
        if current["state"] == "pending" and target_state in {"failed", "synced"}:
            next_state["attemptCount"] += 1
            next_state["lastAttemptAtMs"] = updated_at_ms
            if target_state == "failed":
                if failure_code is None:
                    raise LocalOutboxValidationError("Local outbox input is invalid.")
                next_state["failureCode"] = failure_code
            else:
                next_state["syncedAtMs"] = updated_at_ms
        elif current["state"] == "failed" and target_state == "pending":
            pass
        else:
            raise LocalOutboxValidationError("Local outbox transition is invalid.")

        state_dir = self._entry_path(entry_key) / "states"
        if state_dir.is_symlink() or not state_dir.is_dir():
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        target = state_dir / f"{revision:010d}.json"
        _install_file_exclusive(target, _json_bytes(next_state))
        return self.read(entry_key)

    def _validated_submission(self, value: object) -> dict:
        if not isinstance(value, dict):
            raise LocalOutboxValidationError("Local outbox input is invalid.")
        candidate = deepcopy(value)
        if (
            candidate.get("schemaVersion") != TIME_TRIAL_SCHEMA_VERSION
            or not isinstance(candidate.get("submissionId"), str)
            or isinstance(candidate.get("revision"), bool)
            or not isinstance(candidate.get("revision"), int)
        ):
            raise LocalOutboxValidationError("Local outbox input is invalid.")
        try:
            self._validate_submission_port(deepcopy(candidate))
        except Exception:
            raise LocalOutboxValidationError("Local outbox input is invalid.") from None
        return candidate

    def _entry_path(self, entry_key: str) -> Path:
        if not isinstance(entry_key, str) or _ENTRY_KEY.fullmatch(entry_key) is None:
            raise LocalOutboxValidationError("Local outbox input is invalid.")
        return self._canonical_root / entry_key

    @staticmethod
    def _validate_manifest(value: object, entry_key: str) -> None:
        required = {
            "schemaVersion",
            "entryKey",
            "submissionSha256",
            "createdAtMs",
            "privateEvidencePresent",
        }
        if (
            not _exact_keys(value, required)
            or value["schemaVersion"] != ENTRY_SCHEMA_VERSION
            or value["entryKey"] != entry_key
            or not isinstance(value["submissionSha256"], str)
            or _ENTRY_KEY.fullmatch(value["submissionSha256"]) is None
            or not _valid_timestamp(value["createdAtMs"])
            or not isinstance(value["privateEvidencePresent"], bool)
        ):
            raise LocalOutboxValidationError("Local outbox data is invalid.")

    def _read_states(
        self, entry_path: Path, entry_key: str, created_at_ms: int
    ) -> list[dict]:
        state_dir = entry_path / "states"
        if state_dir.is_symlink() or not state_dir.is_dir():
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        try:
            children = sorted(state_dir.iterdir(), key=lambda item: item.name)
        except OSError:
            raise LocalOutboxError("Local outbox read failed.") from None
        files: list[tuple[int, Path]] = []
        for child in children:
            if child.name.startswith(".state-") or child.name.endswith(".tmp"):
                continue
            match = _STATE_FILE.fullmatch(child.name)
            if match is None:
                raise LocalOutboxValidationError("Local outbox data is invalid.")
            files.append((int(match.group("revision")), child))
        if not files or len(files) > MAX_STATE_REVISIONS:
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        if [revision for revision, _ in files] != list(range(1, len(files) + 1)):
            raise LocalOutboxValidationError("Local outbox data is invalid.")

        states: list[dict] = []
        for revision, path in files:
            state = _parse_json(_read_regular_file(path, 4096), 4096)
            self._validate_state_document(state, entry_key, revision)
            states.append(state)
        self._validate_state_chain(states, created_at_ms)
        return states

    @staticmethod
    def _validate_state_document(value: object, entry_key: str, revision: int) -> None:
        base = {
            "schemaVersion",
            "entryKey",
            "stateRevision",
            "state",
            "attemptCount",
            "updatedAtMs",
        }
        if not isinstance(value, dict):
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        state = value.get("state")
        optional_by_state = {
            "pending": set(),
            "failed": {"lastAttemptAtMs", "failureCode"},
            "synced": {"lastAttemptAtMs", "syncedAtMs"},
        }
        optional = optional_by_state.get(state)
        if (
            optional is None
            or not _exact_keys(value, base, optional)
            or value["schemaVersion"] != STATE_SCHEMA_VERSION
            or value["entryKey"] != entry_key
            or value["stateRevision"] != revision
            or isinstance(value["attemptCount"], bool)
            or not isinstance(value["attemptCount"], int)
            or not 0 <= value["attemptCount"] <= 9_999_999_999
            or not _valid_timestamp(value["updatedAtMs"])
        ):
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        if state == "failed" and (
            not _valid_timestamp(value["lastAttemptAtMs"])
            or not isinstance(value["failureCode"], str)
            or len(value["failureCode"]) > 64
            or _FAILURE_CODE.fullmatch(value["failureCode"]) is None
        ):
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        if state == "synced" and (
            not _valid_timestamp(value["lastAttemptAtMs"])
            or not _valid_timestamp(value["syncedAtMs"])
        ):
            raise LocalOutboxValidationError("Local outbox data is invalid.")

    @staticmethod
    def _validate_state_chain(states: list[dict], created_at_ms: int) -> None:
        first = states[0]
        if (
            first["state"] != "pending"
            or first["attemptCount"] != 0
            or first["updatedAtMs"] != created_at_ms
        ):
            raise LocalOutboxValidationError("Local outbox data is invalid.")
        for previous, current in zip(states, states[1:]):
            if current["updatedAtMs"] < previous["updatedAtMs"]:
                raise LocalOutboxValidationError("Local outbox data is invalid.")
            if previous["state"] == "pending" and current["state"] in {
                "failed",
                "synced",
            }:
                if (
                    current["attemptCount"] != previous["attemptCount"] + 1
                    or current["lastAttemptAtMs"] != current["updatedAtMs"]
                ):
                    raise LocalOutboxValidationError("Local outbox data is invalid.")
                if (
                    current["state"] == "synced"
                    and current["syncedAtMs"] != current["updatedAtMs"]
                ):
                    raise LocalOutboxValidationError("Local outbox data is invalid.")
            elif previous["state"] == "failed" and current["state"] == "pending":
                if current["attemptCount"] != previous["attemptCount"]:
                    raise LocalOutboxValidationError("Local outbox data is invalid.")
            else:
                raise LocalOutboxValidationError("Local outbox data is invalid.")
