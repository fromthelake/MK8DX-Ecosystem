"""Account actions the LiveTrial dashboard can ask for: list, switch, remove, sign in.

The console performed these through numbered menu choices; the dashboard needs
them as small request/response calls, and sign-in must not block a request
while a person approves in the browser. A sign-in therefore runs as a
background *flow*: ``start_sign_in`` returns the code to show at once, the page
asks ``sign_in_status`` until the flow ends, and ``cancel_sign_in`` stops it.

Every function answers plain dictionaries with no credential in them: a bearer
token never leaves the account directory's protected slot files.
"""

from __future__ import annotations

import secrets
import threading
import time
from typing import Callable

from livetrial_accounts import MAX_REMEMBERED_ACCOUNTS, is_slot_id
from livetrial_native_auth import revoke_current_session
import livetrial_product_cli as cli


class LiveTrialAccountActionError(RuntimeError):
    """A bounded, person-readable failure; never carries a path or token."""


def _fail(message: str) -> None:
    raise LiveTrialAccountActionError(message) from None


FLOW_STATES = {"pending", "signed_in", "expired", "denied", "failed", "cancelled"}


class _SignInFlow:
    def __init__(self, flow_id: str, pending: dict, started_ms: int) -> None:
        self.flow_id = flow_id
        self.pending = pending
        self.started_ms = started_ms
        self.state = "pending"
        self.account: dict | None = None
        self.cancelled = threading.Event()
        self.thread: threading.Thread | None = None
        self.email_requested = False
        self.code_accepted = False

    def public(self) -> dict:
        document = {
            "flowId": self.flow_id,
            "state": self.state,
            "userCode": self.pending["userCode"],
            "verificationUri": self.pending["verificationUri"],
            "verificationUriComplete": self.pending["verificationUriComplete"],
            "expiresAtMs": self.started_ms + self.pending["expiresInSeconds"] * 1000,
        }
        if self.account is not None:
            document["account"] = self.account
        document["emailRequested"] = self.email_requested
        document["codeAccepted"] = self.code_accepted
        return document


class LiveTrialAccountActions:
    """What the dashboard may do with the remembered accounts on this PC."""

    def __init__(
        self,
        directory_factory: Callable[[], object],
        client_factory: Callable[[], object],
        session_path: object = None,
        clock_ms: Callable[[], int] = lambda: time.time_ns() // 1_000_000,
        sleep: Callable[[float], None] = time.sleep,
        on_change: Callable[[], None] = lambda: None,
        outbox_factory: Callable[[], object] | None = None,
        owners_factory: Callable[[], object] | None = None,
        api_origin: str = cli.DEFAULT_API_ORIGIN,
    ) -> None:
        self._directory_factory = directory_factory
        self._client_factory = client_factory
        self._session_path = session_path
        self._clock_ms = clock_ms
        self._sleep = sleep
        self._on_change = on_change
        self._outbox_factory = outbox_factory
        self._owners_factory = owners_factory
        self._api_origin = api_origin
        self._lock = threading.Lock()
        self._flow: _SignInFlow | None = None

    # -- listing, switching, removing -------------------------------------

    def list_accounts(self) -> dict:
        now_ms = self._clock_ms()
        rows = cli.account_listing(self._directory_factory(), now_ms)
        accounts = [
            {
                "slotId": row["slotId"],
                "label": cli.account_label(row),
                "playerId": row["playerId"],
                "active": row["active"],
                "signedIn": not row["expired"],
                "lastUsedAtMs": row["lastUsedAtMs"],
            }
            for row in rows
        ]
        # The account in use first, then the most recently used.
        accounts.sort(key=lambda row: (not row["active"], -row["lastUsedAtMs"]))
        return {"accounts": accounts, "limit": MAX_REMEMBERED_ACCOUNTS}

    def _known_slot(self, slot_id: object) -> str:
        if not isinstance(slot_id, str) or not is_slot_id(slot_id):
            _fail("That account is not remembered on this PC.")
        if self._directory_factory().get(slot_id) is None:
            _fail("That account is not remembered on this PC.")
        return slot_id

    def switch(self, slot_id: object) -> dict:
        slot = self._known_slot(slot_id)
        self._directory_factory().set_active(slot, self._clock_ms())
        self._on_change()
        return self.list_accounts()

    def remove(self, slot_id: object) -> dict:
        """Forget one account: revoke its session, keep every saved run."""
        slot = self._known_slot(slot_id)
        now_ms = self._clock_ms()
        directory = self._directory_factory()
        try:
            revoke_current_session(self._client_factory(), directory.store(slot), now_ms)
        except Exception:
            # Offline or already revoked: forgetting it locally still has to work.
            pass
        directory.remove(slot)
        cli._clear_adopted_single_account_session(self._session_path, slot, now_ms)
        self._on_change()
        return self.list_accounts()

    # -- signing in ----------------------------------------------------------

    def start_sign_in(self) -> dict:
        """Ask the site for a device code and approve it in the background."""
        with self._lock:
            if self._flow is not None and self._flow.state == "pending":
                self._flow.cancelled.set()
                self._flow.state = "cancelled"
            try:
                client = self._client_factory()
                pending = client.request_device_authorization()
            except Exception:
                _fail("The sign-in could not be started. Check the internet connection and try again.")
            flow = _SignInFlow(secrets.token_urlsafe(12), pending, self._clock_ms())
            self._flow = flow
        flow.thread = threading.Thread(
            target=self._run_flow, args=(flow, client), name="livetrial-sign-in", daemon=True,
        )
        flow.thread.start()
        return flow.public()

    def _run_flow(self, flow: _SignInFlow, client: object) -> None:
        delay = flow.pending["pollingIntervalSeconds"]
        deadline = flow.started_ms + flow.pending["expiresInSeconds"] * 1000
        try:
            while not flow.cancelled.is_set():
                if self._clock_ms() + delay * 1000 > deadline:
                    flow.state = "expired"
                    return
                self._sleep(delay)
                if flow.cancelled.is_set():
                    return
                result = client.poll(flow.pending["deviceCode"])
                if result["state"] == "pending":
                    continue
                if result["state"] == "slow_down":
                    delay = min(60, delay + result["additionalDelaySeconds"])
                    continue
                if result["state"] in {"expired", "denied"}:
                    flow.state = result["state"]
                    return
                if result["state"] != "authorized":
                    flow.state = "failed"
                    return
                session = client.establish_session(result["bearerToken"], result["expiresInSeconds"])
                if flow.cancelled.is_set():
                    # Cancelled while the site was answering: never keep a session nobody asked for.
                    try:
                        client.revoke(result["bearerToken"])
                    except Exception:
                        pass
                    return
                now_ms = self._clock_ms()
                store = cli._SlotBindingSessionStore(self._directory_factory(), now_ms)
                store.save(session)
                flow.account = {"slotId": store.slot_id, "label": session.get("displayName") or cli.account_label(session)}
                flow.state = "signed_in"
                self._on_change()
                return
        except Exception:
            if flow.state == "pending":
                flow.state = "failed"

    def request_email(self, flow_id: object, email: object) -> dict:
        """Email a link and a code for the running sign-in (ADR-0209)."""
        flow = self._current(flow_id)
        if flow.state != "pending":
            _fail("That sign-in is no longer running.")
        if not isinstance(email, str) or "@" not in email or not 3 <= len(email.strip()) <= 320:
            _fail("Enter the email address of your MK8DX account.")
        try:
            self._client_factory().request_email_approval(flow.pending["userCode"], email)
        except Exception:
            _fail("The email could not be requested. Check the internet connection and try again.")
        flow.email_requested = True
        return flow.public()

    def submit_code(self, flow_id: object, code: object) -> dict:
        """Check the six-digit code from the email; the flow then signs in by itself."""
        flow = self._current(flow_id)
        if flow.state != "pending":
            _fail("That sign-in is no longer running.")
        digits = code.replace(" ", "") if isinstance(code, str) else ""
        if len(digits) != 6 or not digits.isdigit():
            _fail("Type the six digits from the email.")
        try:
            outcome = self._client_factory().verify_email_code(flow.pending["userCode"], digits)
        except Exception:
            _fail("The code could not be checked. Check the internet connection and try again.")
        if outcome["status"] == "invalid":
            left = outcome.get("attemptsLeft", 0)
            _fail(f"That code is not right. {left} {'try' if left == 1 else 'tries'} left.")
        if outcome["status"] == "locked":
            _fail("Too many wrong codes. Ask for a new email.")
        if outcome["status"] == "expired":
            _fail("That code has expired or was already used. Ask for a new email.")
        flow.code_accepted = True
        return flow.public()

    def _current(self, flow_id: object) -> _SignInFlow:
        flow = self._flow
        if flow is None or not isinstance(flow_id, str) or not secrets.compare_digest(flow.flow_id, flow_id):
            _fail("That sign-in is no longer running.")
        return flow

    def sign_in_status(self, flow_id: object) -> dict:
        return self._current(flow_id).public()

    def cancel_sign_in(self, flow_id: object) -> dict:
        flow = self._current(flow_id)
        flow.cancelled.set()
        if flow.state == "pending":
            flow.state = "cancelled"
        return flow.public()

    # -- results waiting to be sent -----------------------------------------

    # Why a waiting result cannot go out yet, in words a person acts on.
    _WAITING_REASONS = {
        None: "ready",
        cli.ACCOUNT_REAUTHORIZATION_REQUIRED: "sign_in_again",
        cli.ACCOUNT_UNKNOWN_OWNER: "account_removed",
        cli.ACCOUNT_LOCAL_PROFILE_ENTRY: "no_account",
        cli.ACCOUNT_PLAYER_MISMATCH: "account_mismatch",
        cli.CLIENT_UPDATE_REQUIRED: "update_required",
    }

    def waiting(self) -> dict:
        """Results still to send, grouped by the account that recorded them.

        Owner 2026-09-27: runs recorded offline on several accounts each wait
        for their own account; the page shows which ones can go now and which
        wait for a sign-in.
        """
        if self._outbox_factory is None or self._owners_factory is None:
            _fail("Results are not available here.")
        now_ms = self._clock_ms()
        outbox = self._outbox_factory()
        directory = self._directory_factory()
        owners = self._owners_factory()
        records = list(outbox.list("pending")) + [
            record for record in outbox.list("failed")
            if record.get("state", {}).get("failureCode") in cli.RETRYABLE_DELIVERY_FAILURES
        ]
        groups: dict[tuple, dict] = {}
        for record in records:
            resolution = cli.owning_slot(
                directory, owners, record["entry"]["entryKey"], record["canonicalSubmission"], now_ms,
            )
            reason = self._WAITING_REASONS.get(resolution["failureCode"], "ready")
            slot_id = resolution["slotId"]
            row = directory.get(slot_id) if slot_id else None
            key = (slot_id, reason)
            group = groups.setdefault(key, {
                "slotId": slot_id,
                "label": cli.account_label(row) if row is not None else None,
                "reason": reason,
                "count": 0,
            })
            group["count"] += 1
        ordered = sorted(groups.values(), key=lambda group: (group["reason"] != "ready", group["label"] or ""))
        return {"total": len(records), "groups": ordered}

    def send_waiting(self) -> dict:
        """Send everything that can go now, each with its own account."""
        if self._outbox_factory is None or self._owners_factory is None:
            _fail("Results are not available here.")
        try:
            report = cli.synchronize_pending(
                self._outbox_factory(), self._directory_factory(), self._owners_factory(),
                self._api_origin, self._clock_ms(),
            )
        except Exception:
            _fail("Nothing could be sent right now. Your results are safe on this PC.")
        self._on_change()
        return {"sent": report["synced"], "attempted": report["attempted"], "waiting": self.waiting()}

    # -- the dashboard's action table ------------------------------------

    def dashboard_actions(self) -> dict[str, Callable[[dict], dict]]:
        return {
            "accounts.list": lambda _body: self.list_accounts(),
            "accounts.switch": lambda body: self.switch(body.get("slotId")),
            "accounts.remove": lambda body: self.remove(body.get("slotId")),
            "signin.start": lambda _body: self.start_sign_in(),
            "signin.status": lambda body: self.sign_in_status(body.get("flowId")),
            "signin.cancel": lambda body: self.cancel_sign_in(body.get("flowId")),
            "signin.email": lambda body: self.request_email(body.get("flowId"), body.get("email")),
            "signin.code": lambda body: self.submit_code(body.get("flowId"), body.get("code")),
            "results.waiting": lambda _body: self.waiting(),
            "results.send": lambda _body: self.send_waiting(),
        }
