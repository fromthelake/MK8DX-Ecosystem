"""Several remembered LiveTrial accounts on one shared local machine.

One PC is regularly shared by several independent players, so the
product must remember more than one signed-in Player at a time and must never
deliver one Player's run with another Player's credential.

Storage layout, all under one accounts root:

    <root>/<slotId>.session.dat  OS-protected session, one file per account
    <root>/<slotId>.youtube.dat  optional OS-protected YouTube authorization (ADR-0213)
    <root>/index.json            which accounts are remembered, and which is active
    <root>/entry-owners.json     which account owns which local outbox entry

Deliberate properties:

* a slot id is derived from the central ``playerId`` only, so the same Player
  always maps to the same file and re-signing-in replaces instead of duplicating;
* the index never contains a bearer token: it exists so the shell can list and
  name accounts without unprotecting any credential;
* one expired or removed slot never touches another slot's file, and never
  touches the canonical outbox, which is shared local product data;
* an expired slot keeps its index row so the product can say "sign in again"
  instead of silently forgetting the account.
"""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Callable

from livetrial_session import parse_native_session


ACCOUNTS_INDEX_SCHEMA_VERSION = "mk8dx.livetrial-accounts-index.v1"
ENTRY_OWNERS_SCHEMA_VERSION = "mk8dx.livetrial-entry-owners.v1"
ACCOUNTS_INDEX_NAME = "index.json"
ENTRY_OWNERS_NAME = "entry-owners.json"
MAX_REMEMBERED_ACCOUNTS = 16
# Per-account files that belong to the account and go when it is removed.
SLOT_COMPANION_SUFFIXES = (".youtube.dat",)
MAX_OWNED_ENTRIES = 20_000
MAX_INDEX_BYTES = 64 * 1024
MAX_OWNERS_BYTES = 8 * 1024 * 1024
MAX_TIMESTAMP_MS = 253_402_300_799_999
SLOT_ID_PREFIX = "slot."
_SLOT_ID = re.compile(r"^slot\.[0-9a-f]{32}$")
_PLAYER_ID = re.compile(r"^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")
_ENTRY_KEY = re.compile(r"^[0-9a-f]{64}$")
_NAMESPACE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class LiveTrialAccountsError(RuntimeError):
    """Bounded accounts failure that never carries a token or a private path."""


def _fail() -> None:
    raise LiveTrialAccountsError("LiveTrial account storage is unavailable.") from None


def _timestamp(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= MAX_TIMESTAMP_MS
    )


def slot_id_for(player_id: object) -> str:
    """Derive the stable per-Player slot id.

    A digest is used rather than the raw ``playerId`` because the value becomes a
    file name; truncating to 32 hex characters keeps paths short while leaving
    collisions unreachable for an ordinary shared-device account list.
    """
    if (
        not isinstance(player_id, str)
        or len(player_id) > 135
        or _PLAYER_ID.fullmatch(player_id) is None
    ):
        _fail()
    digest = hashlib.sha256(player_id.encode("utf-8")).hexdigest()
    return f"{SLOT_ID_PREFIX}{digest[:32]}"


def is_slot_id(value: object) -> bool:
    return isinstance(value, str) and _SLOT_ID.fullmatch(value) is not None


def _write_json_atomically(path: Path, document: object) -> None:
    """Replace one small local index without ever leaving a partial file."""
    try:
        payload = json.dumps(
            document,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.parent.is_symlink() or not path.parent.is_dir():
            _fail()
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=path.parent,
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                temporary.chmod(0o600)
            except OSError:
                pass
            os.replace(temporary, path)
        finally:
            try:
                temporary.unlink()
            except OSError:
                pass
    except LiveTrialAccountsError:
        raise
    except (OSError, TypeError, ValueError, UnicodeError):
        _fail()


def _read_json(path: Path, maximum: int) -> object | None:
    """Read one local index, treating anything unusable as simply absent."""
    try:
        if not path.exists() or path.is_symlink() or not path.is_file():
            return None
        payload = path.read_bytes()
        if not payload or len(payload) > maximum:
            return None
        return json.loads(payload.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return None


_REQUIRED_ACCOUNT_KEYS = {"slotId", "playerId", "addedAtMs", "lastUsedAtMs"}


def _valid_display_name(value: object) -> bool:
    return (
        isinstance(value, str)
        and 1 <= len(value) <= 64
        and not any(ord(char) < 0x20 or ord(char) == 0x7F for char in value)
    )


def _account_row(value: object) -> dict | None:
    # Rows written before the v2-bootstrap identity have exactly the required
    # keys; newer rows may add the Player's public display name. Note that
    # 3.11.0 and earlier reject a named row (and with it the whole index), so
    # rolling the product back means signing accounts in again — nothing else
    # is lost.
    if (
        not isinstance(value, dict)
        or not _REQUIRED_ACCOUNT_KEYS
        <= set(value)
        <= _REQUIRED_ACCOUNT_KEYS | {"displayName"}
        or ("displayName" in value and not _valid_display_name(value["displayName"]))
        or not is_slot_id(value.get("slotId"))
        or not isinstance(value.get("playerId"), str)
        or len(value["playerId"]) > 135
        or _PLAYER_ID.fullmatch(value["playerId"]) is None
        or value["slotId"] != slot_id_for(value["playerId"])
        or not _timestamp(value.get("addedAtMs"))
        or not _timestamp(value.get("lastUsedAtMs"))
    ):
        return None
    return dict(value)


def _parse_index(document: object) -> dict:
    """Accept only an exact index document; anything else means "no accounts"."""
    empty = {"activeSlotId": None, "accounts": []}
    if (
        not isinstance(document, dict)
        or set(document) != {"schemaVersion", "activeSlotId", "accounts"}
        or document.get("schemaVersion") != ACCOUNTS_INDEX_SCHEMA_VERSION
        or not isinstance(document.get("accounts"), list)
        or len(document["accounts"]) > MAX_REMEMBERED_ACCOUNTS
    ):
        return empty
    accounts: list[dict] = []
    seen: set[str] = set()
    for candidate in document["accounts"]:
        try:
            row = _account_row(candidate)
        except LiveTrialAccountsError:
            row = None
        if row is None or row["slotId"] in seen:
            return empty
        seen.add(row["slotId"])
        accounts.append(row)
    active = document.get("activeSlotId")
    if active is not None and (not is_slot_id(active) or active not in seen):
        active = None
    accounts.sort(key=lambda row: (row["addedAtMs"], row["slotId"]))
    return {"activeSlotId": active, "accounts": accounts}


class LiveTrialAccountDirectory:
    """Remember several protected sessions, one replaceable file per Player."""

    def __init__(self, root: str | Path, store_factory: Callable[[Path], object]) -> None:
        if not callable(store_factory):
            _fail()
        self._root = Path(root)
        self._store_factory = store_factory

    @property
    def root(self) -> Path:
        return self._root

    def session_path(self, slot_id: str) -> Path:
        if not is_slot_id(slot_id):
            _fail()
        return self._root / f"{slot_id}.session.dat"

    def store(self, slot_id: str) -> object:
        """Build the per-slot protected store; each slot is fully independent."""
        try:
            return self._store_factory(self.session_path(slot_id))
        except LiveTrialAccountsError:
            raise
        except Exception:
            _fail()

    def list(self) -> tuple[dict, ...]:
        return tuple(deepcopy(row) for row in self._index()["accounts"])

    def active(self) -> dict | None:
        index = self._index()
        for row in index["accounts"]:
            if row["slotId"] == index["activeSlotId"]:
                return dict(row)
        return None

    def get(self, slot_id: str) -> dict | None:
        if not is_slot_id(slot_id):
            return None
        for row in self._index()["accounts"]:
            if row["slotId"] == slot_id:
                return dict(row)
        return None

    def find_by_player(self, player_id: object) -> dict | None:
        """Infer ownership from a Player value, as pre-account builds did."""
        if not isinstance(player_id, str):
            return None
        for row in self._index()["accounts"]:
            if row["playerId"] == player_id:
                return dict(row)
        return None

    def add(self, slot_id: str, session: object, now_ms: int) -> dict:
        """Remember one established session and make it the active account."""
        parsed = parse_native_session(session)
        derived = slot_id_for(parsed["playerId"])
        if not is_slot_id(slot_id) or slot_id != derived or not _timestamp(now_ms):
            _fail()
        index = self._index()
        existing = next(
            (row for row in index["accounts"] if row["slotId"] == slot_id),
            None,
        )
        if existing is None and len(index["accounts"]) >= MAX_REMEMBERED_ACCOUNTS:
            _fail()
        # The credential is persisted first: an index row without a usable
        # session file would advertise an account that cannot sign anything.
        try:
            self.store(slot_id).save(parsed)
        except LiveTrialAccountsError:
            raise
        except Exception:
            _fail()
        row = {
            "slotId": slot_id,
            "playerId": parsed["playerId"],
            "addedAtMs": existing["addedAtMs"] if existing else now_ms,
            "lastUsedAtMs": now_ms,
        }
        display_name = parsed.get("displayName")
        if isinstance(display_name, str):
            row["displayName"] = display_name
        accounts = [item for item in index["accounts"] if item["slotId"] != slot_id]
        accounts.append(row)
        self._save_index(slot_id, accounts)
        return dict(row)

    def remove(self, slot_id: str) -> bool:
        """Forget one account only.

        Nothing in the canonical outbox is touched: already saved runs stay on
        this machine and stay owned by the Player who recorded them.
        """
        if not is_slot_id(slot_id):
            _fail()
        index = self._index()
        remaining = [row for row in index["accounts"] if row["slotId"] != slot_id]
        known = len(remaining) != len(index["accounts"])
        try:
            self.store(slot_id).clear()
            for suffix in SLOT_COMPANION_SUFFIXES:
                (self._root / f"{slot_id}{suffix}").unlink(missing_ok=True)
        except LiveTrialAccountsError:
            raise
        except Exception:
            _fail()
        if not known:
            return False
        active = index["activeSlotId"]
        if active == slot_id:
            # No implicit promotion: choosing whose runs are recorded next is a
            # person's decision, never a side effect of signing out.
            active = None
        self._save_index(active, remaining)
        return True

    def load(self, slot_id: str, now_ms: int) -> dict | None:
        """Unprotect one slot's session; expiry of one slot never affects others."""
        if not is_slot_id(slot_id) or not _timestamp(now_ms):
            _fail()
        try:
            session = self.store(slot_id).load(now_ms)
        except LiveTrialAccountsError:
            raise
        except Exception:
            return None
        if session is None:
            return None
        try:
            parsed = parse_native_session(session, now_ms)
        except Exception:
            return None
        if slot_id_for(parsed["playerId"]) != slot_id:
            # A slot may only ever hold the Player its file name is derived from.
            return None
        return parsed

    def set_active(self, slot_id: str, now_ms: int | None = None) -> dict:
        if not is_slot_id(slot_id):
            _fail()
        index = self._index()
        row = next(
            (item for item in index["accounts"] if item["slotId"] == slot_id),
            None,
        )
        if row is None:
            _fail()
        accounts = index["accounts"]
        if _timestamp(now_ms):
            row = {**row, "lastUsedAtMs": now_ms}
            accounts = [
                row if item["slotId"] == slot_id else item for item in accounts
            ]
        self._save_index(slot_id, accounts)
        return dict(row)

    def mark_used(self, slot_id: str, now_ms: int) -> None:
        """Best-effort recency, never a precondition for using an account."""
        if not is_slot_id(slot_id) or not _timestamp(now_ms):
            return
        index = self._index()
        accounts = []
        found = False
        for row in index["accounts"]:
            if row["slotId"] == slot_id:
                found = True
                row = {**row, "lastUsedAtMs": now_ms}
            accounts.append(row)
        if not found:
            return
        try:
            self._save_index(index["activeSlotId"], accounts)
        except LiveTrialAccountsError:
            return

    def _index(self) -> dict:
        return _parse_index(
            _read_json(self._root / ACCOUNTS_INDEX_NAME, MAX_INDEX_BYTES)
        )

    def _save_index(self, active_slot_id: str | None, accounts: list[dict]) -> None:
        rows = sorted(
            ({**row} for row in accounts),
            key=lambda row: (row["addedAtMs"], row["slotId"]),
        )
        if len(rows) > MAX_REMEMBERED_ACCOUNTS:
            _fail()
        _write_json_atomically(
            self._root / ACCOUNTS_INDEX_NAME,
            {
                "schemaVersion": ACCOUNTS_INDEX_SCHEMA_VERSION,
                "activeSlotId": active_slot_id,
                "accounts": rows,
            },
        )


def _owner_row(value: object) -> dict | None:
    if (
        not isinstance(value, dict)
        or set(value) != {"slotId", "playerReference", "createdAtMs"}
        or not is_slot_id(value.get("slotId"))
        or not isinstance(value.get("playerReference"), dict)
        or set(value["playerReference"]) != {"namespace", "value"}
        or not isinstance(value["playerReference"].get("namespace"), str)
        or _NAMESPACE.fullmatch(value["playerReference"]["namespace"]) is None
        or not isinstance(value["playerReference"].get("value"), str)
        or not 1 <= len(value["playerReference"]["value"]) <= 255
        or not _timestamp(value.get("createdAtMs"))
    ):
        return None
    return deepcopy(value)


class LiveTrialEntryOwnerIndex:
    """Which remembered account produced which local canonical entry.

    The outbox entry and state documents are a closed contract shared with the
    Android product, so ownership is kept in this side index owned by the
    desktop product instead of widening that contract. The index is treated as
    append-only: an entry's owner is decided once, when it is saved, and is
    never rewritten by a later sign-in.
    """

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)

    def owners(self) -> dict:
        document = _read_json(self._path, MAX_OWNERS_BYTES)
        if (
            not isinstance(document, dict)
            or set(document) != {"schemaVersion", "owners"}
            or document.get("schemaVersion") != ENTRY_OWNERS_SCHEMA_VERSION
            or not isinstance(document.get("owners"), dict)
            or len(document["owners"]) > MAX_OWNED_ENTRIES
        ):
            # Unknown ownership is a supported state: the caller falls back to
            # matching the entry's Player against the remembered accounts.
            return {}
        result: dict[str, dict] = {}
        for entry_key, value in document["owners"].items():
            if not isinstance(entry_key, str) or _ENTRY_KEY.fullmatch(entry_key) is None:
                return {}
            row = _owner_row(value)
            if row is None:
                return {}
            result[entry_key] = row
        return result

    def owner_of(self, entry_key: str) -> dict | None:
        if not isinstance(entry_key, str) or _ENTRY_KEY.fullmatch(entry_key) is None:
            return None
        return self.owners().get(entry_key)

    def record(
        self,
        entry_key: str,
        slot_id: str,
        player_reference: object,
        now_ms: int,
    ) -> dict:
        """Bind one entry to the account that produced it, once and for good."""
        if (
            not isinstance(entry_key, str)
            or _ENTRY_KEY.fullmatch(entry_key) is None
            or not is_slot_id(slot_id)
            or not _timestamp(now_ms)
        ):
            _fail()
        candidate = _owner_row(
            {
                "slotId": slot_id,
                "playerReference": deepcopy(player_reference),
                "createdAtMs": now_ms,
            }
        )
        if candidate is None:
            _fail()
        owners = self.owners()
        existing = owners.get(entry_key)
        if existing is not None:
            return deepcopy(existing)
        if len(owners) >= MAX_OWNED_ENTRIES:
            _fail()
        owners[entry_key] = candidate
        _write_json_atomically(
            self._path,
            {"schemaVersion": ENTRY_OWNERS_SCHEMA_VERSION, "owners": owners},
        )
        return deepcopy(candidate)
