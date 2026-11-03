"""Production-local LiveTrial canonical result commands."""

from __future__ import annotations

import argparse
import functools
import json
import os
from pathlib import Path
import re
import sys
import time
from typing import Mapping
import webbrowser

from livetrial_runtime_root import (
    bundled_vision_python,
    bundled_vision_runtime_root,
    asset_catalog_path,
    domain_package_root,
    install_outbox_reference_path,
)


# Bundled resources are resolved through the runtime resource root so the same
# code runs from the repository checkout and from a frozen desktop bundle.
install_outbox_reference_path()

from livetrial_capture_requirements import (
    capture_requirements,
    engine_environment,
    ffmpeg_found_lines,
    missing_ffmpeg_lines,
)
from livetrial_accounts import (
    ENTRY_OWNERS_NAME,
    LiveTrialAccountDirectory,
    LiveTrialAccountsError,
    LiveTrialEntryOwnerIndex,
    is_slot_id,
    slot_id_for,
)
from livetrial_product import (
    create_local_profile_document,
    deliver_product_report_run_to_outbox,
    read_local_profile,
    write_new_local_profile,
)
from livetrial_product_runtime import (
    default_process_factory,
    run_livetrial_source_process,
)
from livetrial_https import LiveTrialHttpsExecutor, LiveTrialStoredSessionRequestExecutor
from livetrial_native_auth import (
    LiveTrialDeviceAuthorizationClient,
    complete_device_sign_in,
    revoke_current_session,
)
from livetrial_session import create_windows_session_store
from livetrial_settings import read_settings, read_server_origin, server_data_root
from livetrial_updates import unsupported_by_floor
from livetrial_sync import LiveTrialExplicitSynchronizationHost
from mk8dx_local_outbox import LocalTimeTrialOutbox
from mk8dx_time_trial_validator import OfflineTimeTrialSubmissionV1Validator


class LiveTrialProductCliError(ValueError):
    """Bounded command error."""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise LiveTrialProductCliError("LiveTrial product command is invalid.") from None


def product_base_root(environment: Mapping[str, str] = os.environ) -> Path:
    if os.name == "nt":
        base = environment.get("LOCALAPPDATA")
    else:
        base = environment.get("XDG_DATA_HOME")
    if not base:
        base = str(Path.home() / ("AppData/Local" if os.name == "nt" else ".local/share"))
    return Path(base) / "MK8DX" / "LiveTrial"


def product_data_root(environment: Mapping[str, str] = os.environ) -> Path:
    root = product_base_root(environment)
    origin = read_server_origin(root)
    # The owner's existing accounts and waiting runs predate server.json and
    # live directly under root. Returning to that packaged server must reopen
    # those same files, rather than create an empty hash-named profile.
    if origin is None or origin == DEFAULT_API_ORIGIN:
        return root
    return server_data_root(root, origin)


# Retained name for existing internal callers and tests.
_product_data_root = product_data_root


DEFAULT_API_ORIGIN = "https://example.invalid"
_ENTRY_KEY = re.compile(r"^[0-9a-f]{64}$")
_EVIDENCE_REFERENCE = re.compile(r"^livetrial/[0-9a-f]{64}$")

# Bounded, non-destructive account outcomes. They describe why this machine
# cannot sign a delivery right now; they are never written into outbox state,
# so the affected entries stay pending and stay retryable.
ACCOUNT_LOCAL_PROFILE_ENTRY = "account.local_profile_entry"
ACCOUNT_UNKNOWN_OWNER = "account.unknown_owner"
ACCOUNT_PLAYER_MISMATCH = "account.player_mismatch"
ACCOUNT_REAUTHORIZATION_REQUIRED = "account.reauthorization_required"
ACCOUNT_SYNCHRONIZATION_UNAVAILABLE = "account.synchronization_unavailable"
# This LiveTrial is older than the floor the site publishes: nothing is sent until
# it is updated, and every entry stays pending (owner 2026-09-28).
CLIENT_UPDATE_REQUIRED = "client.update_required"

# A delivery that failed only because the site could not be reached (or a 5xx),
# or because the owning account's sign-in had run out, is not a verdict on the
# run. Sending again puts it back in the queue by the outbox's own explicit
# retry transition; a real rejection (conflict, forbidden, invalid) stays failed
# so a person sees it. Owner 2026-09-27: runs recorded offline on several
# accounts must all go out once the connection is back.
RETRYABLE_DELIVERY_FAILURES = frozenset({"http.unavailable", "http.unauthorized"})


def requeue_retryable_failures(outbox, now_ms: int) -> int:
    """Move temporarily failed deliveries back to pending; return how many."""
    moved = 0
    try:
        failed = outbox.list("failed")
    except Exception:
        return 0
    for record in failed:
        state = record.get("state", {})
        if state.get("failureCode") not in RETRYABLE_DELIVERY_FAILURES:
            continue
        try:
            outbox.request_retry(record["entry"]["entryKey"], state["stateRevision"], now_ms)
            moved += 1
        except Exception:
            continue
    return moved


def waiting_count(outbox) -> int:
    """Results still to be sent: pending plus temporarily failed ones."""
    failed = [
        record for record in outbox.list("failed")
        if record.get("state", {}).get("failureCode") in RETRYABLE_DELIVERY_FAILURES
    ]
    return len(outbox.list("pending")) + len(failed)

# Exit status of ``capture`` and ``check-capture`` when live capture cannot
# start because FFmpeg is missing. The explanation has already been printed,
# so a caller must not add a failure message of its own.
EXIT_CAPTURE_REQUIREMENTS_MISSING = 3


def _parser(environment: Mapping[str, str] = os.environ) -> argparse.ArgumentParser:
    product_root = product_data_root(environment)
    selected_origin = read_server_origin(product_base_root(environment)) or DEFAULT_API_ORIGIN
    parser = _Parser(description="Manage local canonical LiveTrial results.")
    subparsers = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)

    initialize = subparsers.add_parser("init-profile")
    initialize.add_argument("--profile", default=str(product_root / "profile.json"))
    initialize.add_argument("--producer-version", default="livetrial-phase4")

    sign_in = subparsers.add_parser("sign-in")
    sign_in.add_argument("--api-origin", default=selected_origin)
    sign_in.add_argument("--no-browser", action="store_true")

    sign_out = subparsers.add_parser("sign-out")
    sign_out.add_argument("--api-origin", default=selected_origin)
    sign_out.add_argument("--slot")

    status = subparsers.add_parser("session-status")
    accounts = subparsers.add_parser("accounts")
    switch = subparsers.add_parser("switch")
    switch.add_argument("--slot", required=True)

    listing = subparsers.add_parser("list-results")
    listing.add_argument("--state", choices=("pending", "failed", "synced"))

    sync = subparsers.add_parser("sync")
    sync.add_argument("--entry-key", required=True)
    sync.add_argument("--api-origin", default=selected_origin)
    sync_all = subparsers.add_parser("sync-all")
    sync_all.add_argument("--api-origin", default=selected_origin)
    retry = subparsers.add_parser("retry")
    retry.add_argument("--entry-key", required=True)

    save = subparsers.add_parser("save-run")
    save.add_argument("--report", required=True)
    save.add_argument(
        "--source-kind",
        required=True,
        choices=("livetrial_capture", "livetrial_recorded_video"),
    )
    save.add_argument("--run-number", required=True, type=int)
    save.add_argument("--api-origin", default=selected_origin)
    save.add_argument("--profile", default=str(product_root / "profile.json"))
    save.add_argument("--catalog", default=str(asset_catalog_path(environment)))

    # Reports whether live capture can start on this PC, without starting it.
    # The numbered console menu, kept for troubleshooting now that LiveTrial opens as a window.
    subparsers.add_parser("menu")
    check_capture = subparsers.add_parser("check-capture")
    check_capture.add_argument("--json", action="store_true")

    runtimes = []
    for command in ("capture", "analyze"):
        runtime = subparsers.add_parser(command)
        # A packaged installation ships the engine, so a normal user never
        # supplies a runtime root; a checkout still must.
        runtime.add_argument("--runtime-root")
        runtime.add_argument("--python")
        runtime.add_argument("--profile", default=str(product_root / "profile.json"))
        runtime.add_argument("--catalog", default=str(asset_catalog_path(environment)))
        runtime.add_argument("--api-origin", default=selected_origin)
        if command == "capture":
            runtime.add_argument("--runs-root", default=str(product_root / "runs"))
        else:
            runtime.add_argument("--video", required=True)
            runtime.add_argument("--out")
        runtimes.append(runtime)

    # Every command that touches a remembered account or the local outbox shares
    # the same roots, so the shell and the flag-driven CLI stay interchangeable.
    for command in (
        sign_in,
        sign_out,
        status,
        accounts,
        switch,
        listing,
        sync,
        sync_all,
        retry,
        save,
        *runtimes,
    ):
        command.add_argument("--session", default=str(product_root / "auth-session.dat"))
        command.add_argument("--accounts-root", default=str(product_root / "accounts"))
    for command in (listing, sync, sync_all, retry, save, *runtimes):
        command.add_argument(
            "--canonical-outbox-root",
            default=str(product_root / "canonical-outbox"),
        )
        command.add_argument(
            "--private-evidence-root",
            default=str(product_root / "private-evidence"),
        )
    for runtime in runtimes:
        runtime.add_argument("source_arguments", nargs=argparse.REMAINDER)
    return parser


def _source_arguments(arguments: list[str]) -> list[str]:
    return arguments[1:] if arguments and arguments[0] == "--" else arguments


def _protected(arguments: list[str], name: str) -> bool:
    return any(value == name or value.startswith(f"{name}=") for value in arguments)


def _session_store(path: str):
    return create_windows_session_store(path)


def open_outbox(canonical_root: str, private_root: str) -> LocalTimeTrialOutbox:
    return LocalTimeTrialOutbox(
        canonical_root,
        private_root,
        OfflineTimeTrialSubmissionV1Validator(domain_package_root()),
    )


_outbox = open_outbox


def entry_owner_index(accounts_root: str | Path) -> LiveTrialEntryOwnerIndex:
    return LiveTrialEntryOwnerIndex(Path(accounts_root) / ENTRY_OWNERS_NAME)


def account_directory(
    accounts_root: str | Path,
    session_path: str | Path | None,
    now_ms: int,
) -> LiveTrialAccountDirectory:
    """Open the remembered accounts, adopting a pre-accounts session once."""
    directory = LiveTrialAccountDirectory(
        accounts_root,
        # Late binding keeps the protected-store factory replaceable in tests and
        # keeps every slot on its own independent file.
        lambda path: _session_store(path),
    )
    _adopt_single_account_session(directory, session_path, now_ms)
    return directory


def _adopt_single_account_session(
    directory: LiveTrialAccountDirectory,
    session_path: str | Path | None,
    now_ms: int,
) -> None:
    """Carry a session written by the earlier single-account build into a slot.

    Users who already signed in must not appear signed out after the upgrade.
    Adoption is skipped once that Player has a slot, so removing an account can
    never resurrect it, and the original file is left untouched because it is
    still the only copy a downgraded build could read.
    """
    if session_path is None:
        return
    try:
        session = _session_store(session_path).load(now_ms)
        if session is None:
            return
        slot_id = slot_id_for(session["playerId"])
        if directory.get(slot_id) is not None:
            return
        directory.add(slot_id, session, now_ms)
    except Exception:
        return


def _clear_adopted_single_account_session(
    session_path: str | Path | None,
    slot_id: str,
    now_ms: int,
) -> None:
    """Drop the pre-accounts copy of a credential that was just revoked."""
    if session_path is None:
        return
    try:
        store = _session_store(session_path)
        session = store.load(now_ms)
        if session is not None and slot_id_for(session["playerId"]) == slot_id:
            store.clear()
    except Exception:
        return


def active_account(directory: LiveTrialAccountDirectory, now_ms: int) -> dict | None:
    """Return the active account together with its usable session, if any."""
    try:
        row = directory.active()
        if row is None:
            return None
        session = directory.load(row["slotId"], now_ms)
        if session is None:
            return {**row, "playerId": row["playerId"], "signedIn": False}
        return {**row, "playerId": session["playerId"], "signedIn": True}
    except Exception:
        return None


def _active_player(
    directory: LiveTrialAccountDirectory,
    now_ms: int,
) -> tuple[str | None, str | None]:
    """Resolve the Player whose runs are being recorded right now."""
    account = active_account(directory, now_ms)
    if account is None or not account["signedIn"]:
        return None, None
    return account["slotId"], account["playerId"]


def account_label(row: object) -> str:
    """The name a person recognizes, never a raw canonical identifier.

    Accounts remembered by 3.11.0 and earlier carry no display name; they
    fall back to the identifier suffix until that Player signs in again.
    """
    if not isinstance(row, dict):
        return "unknown"
    display = row.get("displayName")
    if isinstance(display, str) and display.strip():
        return display
    player = row.get("playerId")
    if isinstance(player, str) and player.startswith("player."):
        return player.removeprefix("player.")
    return "unknown"


def account_listing(directory: LiveTrialAccountDirectory, now_ms: int) -> list[dict]:
    """List remembered accounts without unprotecting anything unnecessary."""
    active = directory.active()
    active_slot = active["slotId"] if active is not None else None
    listing = []
    for row in directory.list():
        listing.append(
            {
                "slotId": row["slotId"],
                "playerId": row["playerId"],
                "displayName": row.get("displayName"),
                "addedAtMs": row["addedAtMs"],
                "lastUsedAtMs": row["lastUsedAtMs"],
                "active": row["slotId"] == active_slot,
                "expired": directory.load(row["slotId"], now_ms) is None,
            }
        )
    return listing


def _reviewed_livetrial_evidence(submission: dict):
    source = submission.get("source", {}).get("kind")
    expected_kind = {
        "livetrial_capture": "capture_session",
        "livetrial_recorded_video": "video",
    }.get(source)

    def review(evidence: tuple[dict, ...]) -> bool:
        return (
            expected_kind is not None
            and len(evidence) == 1
            and isinstance(evidence[0], dict)
            and set(evidence[0]) == {"kind", "reference"}
            and evidence[0].get("kind") == expected_kind
            and isinstance(evidence[0].get("reference"), str)
            and _EVIDENCE_REFERENCE.fullmatch(evidence[0]["reference"]) is not None
        )

    return review


def _result_summary(record: dict, owners: dict) -> dict:
    submission = record["canonicalSubmission"]
    state = record["state"]
    entry_key = record["entry"]["entryKey"]
    reference = submission["playerReference"]
    owner = owners.get(entry_key)
    result = {
        "entryKey": entry_key,
        "state": state["state"],
        "stateRevision": state["stateRevision"],
        "attemptCount": state["attemptCount"],
        "mode": submission["mode"],
        "trackId": submission["trackId"],
        "totalTimeMs": submission["totalTimeMs"],
        "sourceKind": submission["source"]["kind"],
        "playerNamespace": reference["namespace"],
        # Only a central Player identifier is shown; a local profile reference
        # carries this installation's identity and stays out of listings.
        "playerId": reference["value"] if reference["namespace"] == "player" else None,
        "ownerSlotId": owner["slotId"] if owner is not None else None,
        "createdAtMs": submission["timestamps"]["createdAtMs"],
    }
    if "failureCode" in state:
        result["failureCode"] = state["failureCode"]
    return result


def result_listing(outbox, owners: LiveTrialEntryOwnerIndex, state: str | None) -> list[dict]:
    known = owners.owners()
    return sorted(
        (_result_summary(record, known) for record in outbox.list(state)),
        key=lambda value: (value["createdAtMs"], value["entryKey"]),
        reverse=True,
    )


def owning_slot(
    directory: LiveTrialAccountDirectory,
    owners: LiveTrialEntryOwnerIndex,
    entry_key: str,
    submission: dict,
    now_ms: int,
) -> dict:
    """Decide which remembered account, if any, may deliver one entry.

    Credentials are never chosen by "whoever is signed in now": the owner is the
    account that produced the entry, recorded when it was saved, with a fallback
    onto the Player recorded inside the entry itself for runs saved before the
    owner index existed.
    """
    try:
        if unsupported_by_floor(Path(directory.root).parent) is not None:
            return {"slotId": None, "failureCode": CLIENT_UPDATE_REQUIRED}
    except (AttributeError, TypeError):
        pass
    reference = submission.get("playerReference")
    if not isinstance(reference, dict) or reference.get("namespace") != "player":
        return {"slotId": None, "failureCode": ACCOUNT_LOCAL_PROFILE_ENTRY}
    recorded = owners.owner_of(entry_key)
    slot_id = recorded["slotId"] if recorded is not None else None
    if slot_id is None or directory.get(slot_id) is None:
        inferred = directory.find_by_player(reference.get("value"))
        slot_id = inferred["slotId"] if inferred is not None else None
    if slot_id is None:
        return {"slotId": None, "failureCode": ACCOUNT_UNKNOWN_OWNER}
    row = directory.get(slot_id)
    if row is None or row["playerId"] != reference.get("value"):
        return {"slotId": slot_id, "failureCode": ACCOUNT_PLAYER_MISMATCH}
    if directory.load(slot_id, now_ms) is None:
        return {"slotId": slot_id, "failureCode": ACCOUNT_REAUTHORIZATION_REQUIRED}
    return {"slotId": slot_id, "failureCode": None}


def _record_owner(
    owners: LiveTrialEntryOwnerIndex,
    record: object,
    slot_id: str | None,
    now_ms: int,
) -> None:
    """Bind a freshly saved entry to the account that produced it."""
    if slot_id is None or not isinstance(record, dict):
        return
    try:
        submission = record["canonicalSubmission"]
        reference = submission["playerReference"]
        if reference.get("namespace") != "player":
            return
        owners.record(record["entry"]["entryKey"], slot_id, reference, now_ms)
    except Exception:
        # Ownership can always be re-inferred from the entry's Player, so a
        # failed side-index write must never fail a saved run.
        return


def synchronize_pending(
    outbox,
    directory: LiveTrialAccountDirectory,
    owners: LiveTrialEntryOwnerIndex,
    api_origin: str,
    now_ms: int,
) -> dict:
    """Deliver every pending entry using its own owning account's credential."""
    requeue_retryable_failures(outbox, now_ms)
    grouped: dict[str, list[dict]] = {}
    results: list[dict] = []
    for record in sorted(
        outbox.list("pending"),
        key=lambda value: value["canonicalSubmission"]["timestamps"]["createdAtMs"],
    ):
        entry_key = record["entry"]["entryKey"]
        resolution = owning_slot(
            directory,
            owners,
            entry_key,
            record["canonicalSubmission"],
            now_ms,
        )
        if resolution["failureCode"] is not None:
            results.append(
                {
                    "entryKey": entry_key,
                    "slotId": resolution["slotId"],
                    "outcome": "skipped",
                    "state": "pending",
                    "failureCode": resolution["failureCode"],
                }
            )
            continue
        grouped.setdefault(resolution["slotId"], []).append(record)

    for slot_id, records in grouped.items():
        # One executor per slot: the bearer token can only come from this slot's
        # own protected file, so no entry can ever be signed by another account.
        executor = LiveTrialStoredSessionRequestExecutor(
            LiveTrialHttpsExecutor(api_origin),
            directory.store(slot_id),
        )
        for record in records:
            entry_key = record["entry"]["entryKey"]
            try:
                status = LiveTrialExplicitSynchronizationHost(
                    outbox,
                    executor,
                    _reviewed_livetrial_evidence(record["canonicalSubmission"]),
                    lambda: time.time_ns() // 1_000_000,
                ).synchronize_entry(entry_key)
            except Exception:
                results.append(
                    {
                        "entryKey": entry_key,
                        "slotId": slot_id,
                        "outcome": "skipped",
                        "state": "pending",
                        "failureCode": ACCOUNT_SYNCHRONIZATION_UNAVAILABLE,
                    }
                )
                continue
            outcome = "synced" if status["state"] == "synced" else "failed"
            result = {
                "entryKey": entry_key,
                "slotId": slot_id,
                "outcome": outcome,
                "state": status["state"],
            }
            if "failureCode" in status:
                result["failureCode"] = status["failureCode"]
            results.append(result)
        directory.mark_used(slot_id, now_ms)

    results.sort(key=lambda value: value["entryKey"])
    return {
        "attempted": len(results),
        "synced": sum(1 for value in results if value["outcome"] == "synced"),
        "failed": sum(1 for value in results if value["outcome"] == "failed"),
        "skipped": sum(1 for value in results if value["outcome"] == "skipped"),
        "results": results,
    }


def synchronize_created_entry(
    outbox,
    directory: LiveTrialAccountDirectory,
    owners: LiveTrialEntryOwnerIndex,
    api_origin: str,
    now_ms: int,
    record: dict,
) -> dict:
    """Try one newly-created entry once, without changing a safe pending run."""
    entry_key = record["entry"]["entryKey"]
    resolution = owning_slot(
        directory,
        owners,
        entry_key,
        record["canonicalSubmission"],
        now_ms,
    )
    if resolution["failureCode"] is not None:
        return {
            "entryKey": entry_key,
            "slotId": resolution["slotId"],
            "outcome": "skipped",
            "state": "pending",
            "failureCode": resolution["failureCode"],
        }
    slot_id = resolution["slotId"]
    try:
        executor = LiveTrialStoredSessionRequestExecutor(
            LiveTrialHttpsExecutor(api_origin),
            directory.store(slot_id),
        )
        status = LiveTrialExplicitSynchronizationHost(
            outbox,
            executor,
            _reviewed_livetrial_evidence(record["canonicalSubmission"]),
            lambda: time.time_ns() // 1_000_000,
        ).synchronize_entry(entry_key)
        directory.mark_used(slot_id, now_ms)
    except Exception:
        return {
            "entryKey": entry_key,
            "slotId": slot_id,
            "outcome": "skipped",
            "state": "pending",
            "failureCode": ACCOUNT_SYNCHRONIZATION_UNAVAILABLE,
        }
    result = {
        "entryKey": entry_key,
        "slotId": slot_id,
        "outcome": "synced" if status["state"] == "synced" else "failed",
        "state": status["state"],
    }
    if "failureCode" in status:
        result["failureCode"] = status["failureCode"]
    return result


def _auto_sync_summary(results: list[dict]) -> str:
    if not results:
        return ""
    synced = sum(1 for result in results if result["outcome"] == "synced")
    waiting = len(results) - synced
    if waiting == 0:
        return f" Automatic send completed for {synced} result(s)."
    return (
        f" Automatic send completed for {synced} result(s); "
        f"{waiting} remain safely saved for later."
    )


class _SlotBindingSessionStore:
    """Route a newly established session into the slot its Player owns.

    The slot id can only be derived once the central Player is known, which is
    after the browser approval completes, so sign-in hands the authentication
    flow this adapter instead of a fixed file path.
    """

    def __init__(self, directory: LiveTrialAccountDirectory, now_ms: int) -> None:
        self._directory = directory
        self._now_ms = now_ms
        self.slot_id: str | None = None

    def load(self, _now_ms: int) -> None:
        # Sign-in never reads an existing credential.
        return None

    def save(self, session: object) -> None:
        slot_id = slot_id_for(session["playerId"])
        self._directory.add(slot_id, session, self._now_ms)
        self._directory.set_active(slot_id, self._now_ms)
        self.slot_id = slot_id

    def clear(self) -> None:
        return None


def _check_capture(
    environment: Mapping[str, str],
    as_json: bool,
    quiet_when_found: bool = False,
) -> int:
    """Explain, in plain language, whether live capture can start here."""
    data_root = product_data_root(environment)
    status = capture_requirements(environment, data_root)
    if as_json:
        print(json.dumps(status, separators=(",", ":"), ensure_ascii=False))
    elif status["ffmpegAvailable"]:
        if not quiet_when_found:
            for line in ffmpeg_found_lines(status["ffmpeg"]):
                print(line)
    else:
        for line in missing_ffmpeg_lines(data_root):
            print(line)
    return 0 if status["ffmpegAvailable"] else EXIT_CAPTURE_REQUIREMENTS_MISSING


class _RetryOnlyExecutor:
    def execute(self, _path: str, _headers: dict[str, str], _body: bytes) -> object:
        raise LiveTrialProductCliError("retry cannot use the network")


def main(
    argv: list[str] | None = None,
    environment: Mapping[str, str] = os.environ,
) -> int:
    try:
        arguments = _parser(environment).parse_args(argv)
        if arguments.command == "init-profile":
            write_new_local_profile(
                arguments.profile,
                create_local_profile_document(arguments.producer_version),
            )
            print("LiveTrial local profile created.")
            return 0

        if arguments.command == "menu":
            import livetrial_app

            return livetrial_app.main(environment=environment)
        if arguments.command == "check-capture":
            return _check_capture(environment, arguments.json)

        now_ms = time.time_ns() // 1_000_000
        directory = account_directory(
            arguments.accounts_root,
            arguments.session,
            now_ms,
        )
        owners = entry_owner_index(arguments.accounts_root)

        if arguments.command == "sign-in":
            client = LiveTrialDeviceAuthorizationClient(
                LiveTrialHttpsExecutor(arguments.api_origin)
            )
            complete_device_sign_in(
                client,
                _SlotBindingSessionStore(directory, now_ms),
                (lambda _uri: False) if arguments.no_browser else webbrowser.open,
                lambda pending: print(
                    "Approve LiveTrial in your browser: "
                    f"{pending['verificationUriComplete']} "
                    f"(code {pending['userCode']})",
                    flush=True,
                ),
            )
            print("LiveTrial synchronization session established.")
            return 0
        if arguments.command == "sign-out":
            selected = arguments.slot
            if selected is None:
                active = directory.active()
                selected = active["slotId"] if active is not None else None
            if selected is None or not is_slot_id(selected):
                print("LiveTrial is already signed out.")
                return 0
            signed_out = revoke_current_session(
                LiveTrialDeviceAuthorizationClient(
                    LiveTrialHttpsExecutor(arguments.api_origin)
                ),
                directory.store(selected),
                now_ms,
            )
            directory.remove(selected)
            _clear_adopted_single_account_session(arguments.session, selected, now_ms)
            print(
                "LiveTrial synchronization session revoked."
                if signed_out
                else "LiveTrial is already signed out."
            )
            return 0
        if arguments.command == "session-status":
            _slot_id, player_id = _active_player(directory, now_ms)
            print(
                "LiveTrial protected synchronization session is available."
                if player_id is not None
                else "LiveTrial is signed out; local capture remains available."
            )
            return 0
        if arguments.command == "accounts":
            print(
                json.dumps(
                    account_listing(directory, now_ms),
                    separators=(",", ":"),
                    ensure_ascii=False,
                )
            )
            return 0
        if arguments.command == "switch":
            if not is_slot_id(arguments.slot):
                raise LiveTrialProductCliError("invalid account slot")
            row = directory.set_active(arguments.slot, now_ms)
            print(f"LiveTrial active account is now {account_label(row)}.")
            return 0
        if arguments.command == "list-results":
            print(
                json.dumps(
                    result_listing(
                        open_outbox(
                            arguments.canonical_outbox_root,
                            arguments.private_evidence_root,
                        ),
                        owners,
                        arguments.state,
                    ),
                    separators=(",", ":"),
                    ensure_ascii=False,
                )
            )
            return 0
        if arguments.command == "sync-all":
            print(
                json.dumps(
                    synchronize_pending(
                        open_outbox(
                            arguments.canonical_outbox_root,
                            arguments.private_evidence_root,
                        ),
                        directory,
                        owners,
                        arguments.api_origin,
                        now_ms,
                    ),
                    separators=(",", ":"),
                    ensure_ascii=False,
                )
            )
            return 0
        if arguments.command in {"sync", "retry"}:
            if _ENTRY_KEY.fullmatch(arguments.entry_key) is None:
                raise LiveTrialProductCliError("invalid entry key")
            outbox = open_outbox(
                arguments.canonical_outbox_root,
                arguments.private_evidence_root,
            )
            selected = outbox.read(arguments.entry_key)
            if arguments.command == "retry":
                host = LiveTrialExplicitSynchronizationHost(
                    outbox,
                    _RetryOnlyExecutor(),
                    _reviewed_livetrial_evidence(
                        selected["canonicalSubmission"]
                    ),
                    lambda: time.time_ns() // 1_000_000,
                )
                result = host.request_retry(arguments.entry_key)
                print(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
                return 0
            resolution = owning_slot(
                directory,
                owners,
                arguments.entry_key,
                selected["canonicalSubmission"],
                now_ms,
            )
            if resolution["failureCode"] is not None:
                # Bounded and non-destructive: the entry keeps its own state and
                # stays deliverable once its own account is available again. The
                # outcome is reported in the same shape as sync-all uses, so a
                # caller can act on it without parsing an error message.
                print(
                    json.dumps(
                        {
                            "entryKey": arguments.entry_key,
                            "slotId": resolution["slotId"],
                            "outcome": "skipped",
                            "state": selected["state"]["state"],
                            "failureCode": resolution["failureCode"],
                        },
                        separators=(",", ":"),
                        ensure_ascii=False,
                    )
                )
                raise LiveTrialProductCliError(resolution["failureCode"])
            executor = LiveTrialStoredSessionRequestExecutor(
                LiveTrialHttpsExecutor(arguments.api_origin),
                directory.store(resolution["slotId"]),
            )
            host = LiveTrialExplicitSynchronizationHost(
                outbox,
                executor,
                _reviewed_livetrial_evidence(selected["canonicalSubmission"]),
                lambda: time.time_ns() // 1_000_000,
            )
            result = host.synchronize_entry(arguments.entry_key)
            directory.mark_used(resolution["slotId"], now_ms)
            print(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
            return 0

        profile = read_local_profile(arguments.profile)
        outbox = open_outbox(
            arguments.canonical_outbox_root,
            arguments.private_evidence_root,
        )
        slot_id, player_id = _active_player(directory, now_ms)
        automatic_send = read_settings(product_data_root(environment))[
            "autoSyncCompletedRuns"
        ]
        automatic_results: list[dict] = []

        def auto_sync(record: dict) -> None:
            if not automatic_send:
                return
            automatic_results.append(
                synchronize_created_entry(
                    outbox,
                    directory,
                    owners,
                    arguments.api_origin,
                    time.time_ns() // 1_000_000,
                    record,
                )
            )

        if arguments.command == "save-run":
            record, created = deliver_product_report_run_to_outbox(
                arguments.report,
                arguments.catalog,
                profile,
                arguments.source_kind,
                arguments.run_number,
                time.time_ns() // 1_000_000,
                outbox,
                player_id,
            )
            _record_owner(owners, record, slot_id, now_ms)
            if created:
                auto_sync(record)
        else:
            configured_root = arguments.runtime_root or (
                str(bundled_vision_runtime_root(environment) or "")
            )
            if not configured_root:
                raise LiveTrialProductCliError("vision runtime unavailable")
            runtime_root = Path(configured_root).resolve(strict=False)
            # sys.executable is the product itself once frozen, so a packaged
            # installation must launch the interpreter shipped with the engine.
            interpreter = (
                arguments.python
                or bundled_vision_python(environment)
                or (None if getattr(sys, "frozen", False) else sys.executable)
            )
            if not interpreter:
                raise LiveTrialProductCliError("vision runtime unavailable")
            source_arguments = _source_arguments(arguments.source_arguments)
            if arguments.command == "capture":
                if _protected(source_arguments, "--runs-dir"):
                    raise LiveTrialProductCliError("protected source argument")
                if _check_capture(environment, False, quiet_when_found=True) != 0:
                    return EXIT_CAPTURE_REQUIREMENTS_MISSING
                runs_root = Path(arguments.runs_root)
                script = runtime_root / "livetrial" / "watch.py"
                source_kind = "livetrial_capture"
                command = [
                    interpreter,
                    "-B",
                    str(script),
                    *source_arguments,
                    "--runs-dir",
                    str(runs_root),
                ]
            else:
                if _protected(source_arguments, "--out"):
                    raise LiveTrialProductCliError("protected source argument")
                source_kind = "livetrial_recorded_video"
                out = (
                    Path(arguments.out)
                    if arguments.out
                    else product_data_root(environment)
                    / "runs"
                    / f"recorded_{time.time_ns()}"
                )
                runs_root = out
                script = runtime_root / "livetrial" / "analyze.py"
                command = [
                    interpreter,
                    "-B",
                    str(script),
                    arguments.video,
                    *source_arguments,
                    "--out",
                    str(out),
                ]
            if script.is_symlink() or not script.is_file():
                raise LiveTrialProductCliError("runtime script unavailable")
            runs_root.mkdir(parents=True, exist_ok=True)
            result = run_livetrial_source_process(
                command,
                runtime_root,
                runs_root,
                arguments.catalog,
                profile,
                source_kind,
                outbox,
                lambda: time.time_ns() // 1_000_000,
                # The engine inherits the product's environment, with the
                # product-local FFmpeg folder first on PATH when it exists.
                functools.partial(
                    default_process_factory,
                    environment=engine_environment(
                        environment, product_data_root(environment), runtime_root
                    ),
                ),
                player_id=player_id,
                entry_observer=lambda record: _record_owner(
                    owners,
                    record,
                    slot_id,
                    now_ms,
                ),
                created_entry_observer=auto_sync,
            )
            print(
                f"LiveTrial runtime completed; {result.created} canonical result(s) saved."
                + _auto_sync_summary(automatic_results)
            )
            return 130 if result.interrupted else 0
    except KeyboardInterrupt:
        print("LiveTrial product command cancelled.", file=sys.stderr)
        return 130
    except Exception:
        print("LiveTrial product command failed.", file=sys.stderr)
        return 1
    print(
        (
            "LiveTrial canonical result saved."
            if created
            else "LiveTrial canonical result was already saved."
        )
        + _auto_sync_summary(automatic_results)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
