from __future__ import annotations

import hashlib
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import unicodedata
import webbrowser
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping

from .session import SessionStore, data_dir
from .server import OWNER_ORIGIN, exact_origin, selected_origin


DEFAULT_BASE_URL = OWNER_ORIGIN
CLIENT_ID = "mk8dx.tournament.desktop.v1"
DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"


class ConnectedError(RuntimeError):
    pass


def session_identity_key(token: str) -> str:
    """Bind optional display-only identity cache to this session and API origin."""
    # This local display lookup must remain usable even if API configuration is
    # invalid. Actual requests still validate HTTPS through api_origin().
    origin = os.environ.get("MK8DX_TOURNAMENT_API_ORIGIN") or selected_origin() or DEFAULT_BASE_URL
    return hashlib.sha256(f"{origin}\0{token}".encode()).hexdigest()


def api_origin() -> str:
    value = os.environ.get("MK8DX_TOURNAMENT_API_ORIGIN") or selected_origin() or DEFAULT_BASE_URL
    loopback_development = (
        os.environ.get("MK8DX_TOURNAMENT_ALLOW_INSECURE_LOOPBACK") == "1"
        and (value.startswith("http://127.0.0.1:") or value.startswith("http://localhost:"))
    )
    try:
        exact_origin(value)
    except ValueError:
        raise ConnectedError("Tournament Manager needs an exact HTTPS origin, or HTTP on this PC only") from None
    if value.startswith("http://") and not loopback_development:
        raise ConnectedError("Tournament Manager connection requires HTTPS")
    return value


def _tls_context() -> ssl.SSLContext | None:
    certificate = os.environ.get("MK8DX_TOURNAMENT_CA_CERTIFICATE")
    if not certificate:
        return None
    path = Path(certificate)
    if not path.is_file():
        raise ConnectedError("Configured Tournament Manager CA certificate was not found")
    return ssl.create_default_context(cafile=str(path))


def _request(
    path: str,
    *,
    body: object | None = None,
    token: str | None = None,
    accept_error_status: int | None = None,
) -> Any:
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, separators=(",", ":")).encode()
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"{api_origin()}{path}", data=data, headers=headers,
                                     method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=20, context=_tls_context()) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        if error.code == 429 and path == "/api/auth/device/token":
            return {"error": "slow_down"}
        try:
            document = json.loads(error.read().decode())
        except (ValueError, AttributeError):
            document = {}
        if error.code == accept_error_status and isinstance(document, dict):
            return document
        detail = document.get("message", "") if isinstance(document, dict) else ""
        raise ConnectedError(detail or f"Server returned HTTP {error.code}") from None
    except OSError as error:
        raise ConnectedError(f"Connection unavailable: {error}") from None


def sign_in(
    store: SessionStore,
    *,
    on_authorization: Callable[[str, str], None] | None = None,
    open_browser: bool = True,
) -> None:
    authorization = _request("/api/auth/device/code", body={"client_id": CLIENT_ID})
    device_code = authorization["device_code"]
    user_code = authorization["user_code"]
    verification_url = authorization.get("verification_uri_complete") or authorization["verification_uri"]
    if on_authorization is not None:
        on_authorization(str(user_code), str(verification_url))
    print(f"Browser sign-in code: {user_code}")
    print("A browser window will open. This application never asks for your password.")
    if open_browser:
        webbrowser.open(verification_url)
    interval = max(2, int(authorization.get("interval", 5)))
    deadline = time.monotonic() + int(authorization.get("expires_in", 600))
    while time.monotonic() < deadline:
        time.sleep(interval)
        try:
            token = _request("/api/auth/device/token", body={
                "grant_type": DEVICE_GRANT, "device_code": device_code, "client_id": CLIENT_ID,
            }, accept_error_status=400)
        except ConnectedError:
            raise
        error_code = token.get("error") if isinstance(token, dict) else None
        if error_code is not None:
            if error_code == "authorization_pending":
                continue
            if error_code == "slow_down":
                interval = min(60, interval + 5)
                continue
            if error_code in {"access_denied", "expired_token", "invalid_grant"}:
                raise ConnectedError("The browser authorization was denied or expired")
            raise ConnectedError("The authorization server rejected the device request")
        access_token = token.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise ConnectedError("The server returned no access token")
        store.save(access_token)
        print("Signed in. Local processing and file export still work without this session.")
        return
    raise ConnectedError("The browser authorization expired")


@dataclass(frozen=True)
class TournamentChoice:
    tournament_id: str
    name: str
    start_at_ms: int | None
    stage: str
    groups: tuple[dict[str, Any], ...]
    workflow_step: int | None = None
    series_label: str | None = None
    edition_number: int | None = None
    timezone: str | None = None


@dataclass(frozen=True)
class ConnectionTarget:
    tournament_id: str
    tournament_name: str
    group_id: str
    group_name: str
    phase: str


@dataclass(frozen=True)
class ConnectionContext:
    tournament_id: str
    tournament_name: str
    start_at_ms: int | None
    stage: str
    groups: tuple[dict[str, Any], ...]
    source_group_ids: dict[str, str]
    workflow_step: int | None = None
    source_aliases: dict[str, str] = field(default_factory=dict)
    source_display_labels: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_choice(cls, tournament: TournamentChoice) -> "ConnectionContext":
        return cls(
            tournament_id=tournament.tournament_id,
            tournament_name=tournament.name,
            start_at_ms=tournament.start_at_ms,
            stage=tournament.stage,
            groups=tournament.groups,
            source_group_ids={},
            workflow_step=score_workflow_step(tournament.workflow_step, tournament.stage),
        )


def score_workflow_step(value: int | None, stage: str = "") -> int:
    """Return the Manager checkpoint used only as advisory evidence context."""

    if isinstance(value, int) and 2 <= value <= 9:
        return int(value)
    return 9 if stage.strip().casefold() in {"final", "finals"} else 5


def _connection_context_payload(context: ConnectionContext) -> dict[str, Any]:
    return {
        **context.__dict__,
        "groups": list(context.groups),
        "workflow_step": score_workflow_step(context.workflow_step, context.stage),
    }


def _connection_context_from_payload(value: object) -> ConnectionContext | None:
    if not isinstance(value, dict):
        return None
    try:
        return ConnectionContext(
            tournament_id=str(value["tournament_id"]),
            tournament_name=str(value["tournament_name"]),
            start_at_ms=int(value["start_at_ms"]) if value.get("start_at_ms") is not None else None,
            stage=str(value["stage"]),
            groups=tuple(group for group in value["groups"] if isinstance(group, dict)),
            source_group_ids={str(key): str(group_id) for key, group_id in dict(value.get("source_group_ids", {})).items()},
            workflow_step=score_workflow_step(
                int(value["workflow_step"]) if value.get("workflow_step") is not None else None,
                str(value["stage"]),
            ),
            source_aliases={str(key): str(label) for key, label in dict(value.get("source_aliases", {})).items()},
            source_display_labels={str(key): str(label) for key, label in dict(value.get("source_display_labels", {})).items()},
        )
    except (KeyError, TypeError, ValueError):
        return None


def _connection_target_payload(target: ConnectionTarget) -> dict[str, str]:
    return dict(target.__dict__)


def _connection_target_from_payload(value: object) -> ConnectionTarget | None:
    if not isinstance(value, dict):
        return None
    try:
        return ConnectionTarget(
            tournament_id=str(value["tournament_id"]),
            tournament_name=str(value.get("tournament_name") or value["tournament_id"]),
            group_id=str(value["group_id"]),
            group_name=str(value.get("group_name") or value["group_id"]),
            phase=str(value.get("phase") or "qualifier"),
        )
    except (KeyError, TypeError, ValueError):
        return None


class _FrozenStore:
    def __init__(self, value: Any) -> None:
        self.value = value

    def load(self) -> Any:
        return self.value


@dataclass(frozen=True)
class ConnectedUploadReceipt:
    tournament_id: str
    group_id: str
    incoming_result_ids: tuple[str, ...]
    race_result_ids: tuple[str, ...]
    visible: bool


@dataclass(frozen=True)
class EvidenceRecordReceipt:
    record_id: str
    client_record_id: str
    result_count: int
    complete: bool
    visible: bool


class ConnectionContextStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or data_dir() / "connection-context.json"

    def save(self, context: ConnectionContext) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({
            **context.__dict__,
            "groups": list(context.groups),
            "workflow_step": score_workflow_step(context.workflow_step, context.stage),
        }, indent=2), encoding="utf-8")

    def load(self) -> ConnectionContext | None:
        if not self.path.is_file():
            return None
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            groups = tuple(group for group in value["groups"] if isinstance(group, dict))
            source_group_ids = {
                str(key): str(group_id)
                for key, group_id in dict(value.get("source_group_ids", {})).items()
            }
            source_aliases = {
                str(key): str(label)
                for key, label in dict(value.get("source_aliases", {})).items()
            }
            source_display_labels = {
                str(key): str(label)
                for key, label in dict(value.get("source_display_labels", {})).items()
            }
            return ConnectionContext(
                tournament_id=str(value["tournament_id"]),
                tournament_name=str(value["tournament_name"]),
                start_at_ms=int(value["start_at_ms"]) if value.get("start_at_ms") is not None else None,
                stage=str(value["stage"]),
                groups=groups,
                source_group_ids=source_group_ids,
                workflow_step=score_workflow_step(value.get("workflow_step"), str(value["stage"])),
                source_aliases=source_aliases,
                source_display_labels=source_display_labels,
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            return None

    def assign_source(self, source_label: str, group_id: str) -> ConnectionContext | None:
        context = self.load()
        if context is None or not any(str(group.get("groupId")) == group_id for group in context.groups):
            return None
        updated = ConnectionContext(
            **{**context.__dict__, "source_group_ids": {**context.source_group_ids, source_label: group_id}},
        )
        self.save(updated)
        return updated

    def clear(self) -> None:
        self.path.unlink(missing_ok=True)


class ConnectionTargetStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or data_dir() / "connection-target.json"

    def save(self, target: ConnectionTarget) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(target.__dict__, indent=2), encoding="utf-8")

    def load(self) -> ConnectionTarget | None:
        if not self.path.is_file():
            return None
        value = json.loads(self.path.read_text(encoding="utf-8"))
        try:
            return ConnectionTarget(**{field: str(value[field]) for field in ConnectionTarget.__dataclass_fields__})
        except (KeyError, TypeError, ValueError):
            return None

    def clear(self) -> None:
        self.path.unlink(missing_ok=True)


class ConnectedClient:
    def __init__(self, store: SessionStore | None = None) -> None:
        self.store = store or SessionStore()

    def _token(self) -> str:
        token = self.store.load()
        if token is None:
            raise ConnectedError("Not signed in. Run: mk8dx-tournament-connect sign-in")
        return token

    def tournaments(self) -> tuple[TournamentChoice, ...]:
        response = _request("/v1/tournament-connections", token=self._token())
        return tuple(TournamentChoice(
            tournament_id=item["tournamentId"], name=item["name"],
            start_at_ms=item.get("startAtMs"), stage=item["stage"],
            groups=tuple(item.get("groups", ())),
            workflow_step=score_workflow_step(item.get("workflowStep"), str(item["stage"])),
            series_label=item.get("seriesLabel"), edition_number=item.get("editionNumber"),
            timezone=item.get("timezone"),
        ) for item in response.get("tournaments", ()))

    def account_identity(self) -> dict[str, str]:
        """Read the server-verified Player name for this account, without writes.

        The existing native bootstrap is optional display information. An
        account without a verified Player can still capture and upload.
        """
        token = self._token()
        response = _request("/v1/time-trial-submissions/native-bootstrap-v2", token=token)
        name = response.get("displayName") if isinstance(response, dict) else None
        if (not isinstance(response, dict)
                or response.get("schemaVersion") != "mk8dx.native-time-trial-bootstrap.v2"
                or not isinstance(name, str) or not name.strip() or len(name) > 64
                or any(unicodedata.category(c).startswith("C") for c in name)):
            raise ConnectedError("The account display name is unavailable")
        return {"sessionKey": session_identity_key(token), "displayName": name.strip()}

    def upload(self, file: Path, tournament: TournamentChoice, group: dict[str, Any], race_number: int) -> None:
        payload = json.loads(file.read_text(encoding="utf-8"))
        documents = payload if isinstance(payload, list) else [payload]
        entries = [{
            "result": document,
            "suggestedPhase": group.get("phase"),
            "suggestedGroupId": group["groupId"],
            "suggestedRaceNumber": race_number + index,
            "occurredAtMs": document.get("timestamps", {}).get("occurredAtMs"),
        } for index, document in enumerate(documents)]
        _request("/v1/tournament-incoming-results", body={
            "tournamentId": tournament.tournament_id, "entries": entries,
        }, token=self._token())

    def upload_documents(self, documents: list[dict[str, Any]], target: ConnectionTarget) -> ConnectedUploadReceipt | None:
        entries = [{
            "result": document,
            "suggestedPhase": target.phase,
            "suggestedGroupId": target.group_id,
            "suggestedRaceNumber": int(document.get("raceNumber", index + 1)),
            "occurredAtMs": document.get("timestamps", {}).get("occurredAtMs"),
        } for index, document in enumerate(documents)]
        if not entries:
            return None
        response = _request("/v1/tournament-incoming-results", body={
                "tournamentId": target.tournament_id,
                "entries": entries,
            }, token=self._token())
        stored = response.get("results", ()) if isinstance(response, dict) else ()
        incoming_ids = tuple(
            str(item.get("incomingResultId"))
            for item in stored
            if isinstance(item, dict) and item.get("incomingResultId") and item.get("status") == "pending"
        )
        race_ids = tuple(str(document.get("raceResultId")) for document in documents)
        if len(incoming_ids) != len(documents):
            raise ConnectedError("Tournament Manager did not acknowledge every pending result")
        self.verify_documents_visible(target.tournament_id, race_ids, incoming_ids)
        return ConnectedUploadReceipt(target.tournament_id, target.group_id, incoming_ids, race_ids, True)

    def upload_evidence_record(
        self,
        file: Path,
        documents: list[dict[str, Any]],
        *,
        context: ConnectionContext | None = None,
        target: ConnectionTarget | None = None,
        complete: bool,
        started_at_ms: int | None = None,
        stopped_at_ms: int | None = None,
        analysis_completed_at_ms: int | None = None,
    ) -> EvidenceRecordReceipt:
        if not documents:
            raise ConnectedError("An evidence record needs at least one race result")
        session_ids = {
            str(document.get("source", {}).get("sessionId", "")).strip()
            for document in documents if isinstance(document.get("source"), dict)
        } - {""}
        client_record_id = (
            next(iter(session_ids)) if len(session_ids) == 1
            else hashlib.sha256(str(file.resolve()).encode()).hexdigest()
        )
        entries: list[dict[str, Any]] = []
        for index, document in enumerate(documents):
            label = source_label(document) or str(document.get("source", {}).get("streamId", "")) or f"Feed {index + 1}"
            routing_label = _routing_label(context, label) if context is not None else label
            group = infer_group(context, routing_label) if context is not None else None
            if group is None and target is not None:
                group = {"groupId": target.group_id, "name": target.group_name, "phase": target.phase}
            # Keep the physical/sticker feed identity stable. The selected
            # Tournament group is advisory metadata and may be repaired by the
            # director without pretending the capture card itself changed.
            observed_group = (
                context.source_display_labels.get(routing_label)
                if context is not None else None
            ) or Path(label).stem
            entries.append({
                "entryKey": f"{document.get('raceResultId')}:{document.get('revision', 1)}",
                "result": document,
                "observedGroupLabel": observed_group,
                **({"suggestedPhase": group.get("phase")} if group is not None else {}),
                **({"suggestedGroupId": group.get("groupId")} if group is not None else {}),
                "suggestedRaceNumber": int(document.get("raceNumber", index + 1)),
                **({"occurredAtMs": document.get("timestamps", {}).get("occurredAtMs")}
                   if document.get("timestamps", {}).get("occurredAtMs") is not None else {}),
            })
        timestamps = [
            int(value)
            for document in documents
            for value in (
                document.get("timestamps", {}).get("capturedAtMs"),
                document.get("timestamps", {}).get("occurredAtMs"),
                document.get("timestamps", {}).get("createdAtMs"),
            )
            if isinstance(value, int) and value >= 0
        ]
        suggested_tournament_id = context.tournament_id if context is not None else (
            target.tournament_id if target is not None else None
        )
        body = {
            "clientRecordId": client_record_id,
            "complete": complete,
            "entries": entries,
            **({"suggestedTournamentId": suggested_tournament_id} if suggested_tournament_id else {}),
            **({"startedAtMs": started_at_ms} if started_at_ms is not None else (
                {"startedAtMs": min(timestamps)} if timestamps else {}
            )),
            **({"stoppedAtMs": stopped_at_ms} if stopped_at_ms is not None else (
                {"stoppedAtMs": max(timestamps)} if complete and timestamps else {}
            )),
            **({"analysisCompletedAtMs": analysis_completed_at_ms}
               if analysis_completed_at_ms is not None else (
                   {"analysisCompletedAtMs": int(time.time() * 1000)} if complete else {}
               )),
        }
        response = _request("/v1/tournament-evidence-records", body=body, token=self._token())
        record = response.get("record", {}) if isinstance(response, dict) else {}
        if not isinstance(record, dict) or not record.get("recordId"):
            raise ConnectedError("Tournament Manager did not acknowledge the evidence record")
        own = _request("/v1/tournament-evidence-records/own", token=self._token())
        visible = any(
            isinstance(item, dict) and item.get("recordId") == record.get("recordId")
            for item in (own.get("records", ()) if isinstance(own, dict) else ())
        )
        if not visible:
            raise ConnectedError("Uploaded evidence record is not yet visible online")
        return EvidenceRecordReceipt(
            record_id=str(record["recordId"]),
            client_record_id=str(record.get("clientRecordId") or client_record_id),
            result_count=int(record.get("resultCount") or len(documents)),
            complete=bool(record.get("complete")),
            visible=True,
        )

    def register_live_run(
        self,
        run_id: str,
        context: ConnectionContext,
        source_labels: list[str],
        *,
        observed_labels: Mapping[str, str] | None = None,
        started_at_ms: int | None = None,
    ) -> EvidenceRecordReceipt:
        groups = {str(group.get("groupId")): group for group in context.groups}
        mappings: list[dict[str, str]] = []
        for label in source_labels:
            group_id = context.source_group_ids.get(label)
            group = groups.get(str(group_id))
            if group is None:
                raise ConnectedError(f"Live feed {label} has no current Tournament group")
            observed_label = str((observed_labels or {}).get(label) or Path(label).stem).strip()
            mappings.append({
                "observedGroupLabel": observed_label,
                "groupId": str(group["groupId"]),
                "phase": str(group.get("phase") or group.get("stage") or "qualifier"),
            })
        if not mappings or len({item["groupId"] for item in mappings}) != len(mappings):
            raise ConnectedError("Every live feed needs a different Tournament group")
        response = _request("/v1/tournament-evidence-records", body={
            "clientRecordId": run_id,
            "sourceKind": "tournament_live_capture",
            "suggestedTournamentId": context.tournament_id,
            "complete": False,
            "entries": [],
            "liveMappings": mappings,
            **({"startedAtMs": started_at_ms} if started_at_ms is not None else {}),
        }, token=self._token())
        record = response.get("record", {}) if isinstance(response, dict) else {}
        if not isinstance(record, dict) or not record.get("recordId"):
            raise ConnectedError("Tournament Manager did not acknowledge the live run")
        return EvidenceRecordReceipt(
            record_id=str(record["recordId"]),
            client_record_id=str(record.get("clientRecordId") or run_id),
            result_count=int(record.get("resultCount") or 0),
            complete=bool(record.get("complete")),
            visible=True,
        )

    def mark_live_stopping(self, record_id: str) -> None:
        _request(
            f"/v1/tournament-evidence-records/{urllib.parse.quote(record_id, safe='')}/actions/stopping",
            body={}, token=self._token(),
        )

    def verify_documents_visible(
        self,
        tournament_id: str,
        race_result_ids: tuple[str, ...],
        incoming_result_ids: tuple[str, ...] = (),
    ) -> None:
        response = _request(
            f"/v1/administrator/tournaments/{urllib.parse.quote(tournament_id, safe='')}/incoming-results",
            token=self._token(),
        )
        results = response.get("results", ()) if isinstance(response, dict) else ()
        visible_incoming = {
            str(item.get("incomingResultId")) for item in results if isinstance(item, dict)
        }
        visible_races = {
            str(item.get("result", {}).get("raceResultId"))
            for item in results
            if isinstance(item, dict) and isinstance(item.get("result"), dict)
        }
        if incoming_result_ids and not set(incoming_result_ids).issubset(visible_incoming):
            raise ConnectedError("Uploaded results are not yet visible in Tournament Manager")
        if not set(race_result_ids).issubset(visible_races):
            raise ConnectedError("Uploaded race evidence is not yet visible in Tournament Manager")


def _normalized(value: str) -> str:
    return "".join(character.casefold() for character in value if character.isalnum())


_GROUP_NAME_EQUIVALENTS = (
    frozenset(("champion", "kampioen")),
)


def _group_name_matches_label(group_name: str, label: str) -> bool:
    normalized_name = _normalized(group_name)
    if normalized_name in label:
        return True
    equivalents = next(
        (values for values in _GROUP_NAME_EQUIVALENTS if normalized_name in values),
        (),
    )
    return any(value in label for value in equivalents)


def source_label(document: dict[str, Any]) -> str:
    local_record_id = str(document.get("source", {}).get("localRecordId", ""))
    return local_record_id.rsplit(":race:", 1)[0]


def _routing_label(context: ConnectionContext, label: str) -> str:
    direct = context.source_aliases.get(label)
    if direct is not None:
        return direct
    # Canonical race exports sanitize the capture path in localRecordId, for
    # example ``capture:__UGREEN_35287_#3``. Device discovery deliberately
    # stores the readable Windows name (``UGREEN 35287 #3``), so compare their
    # normalized suffixes and only accept an unambiguous physical-card match.
    normalized_label = _normalized(label)
    matches = {
        routing
        for physical, routing in context.source_aliases.items()
        if _normalized(physical) and normalized_label.endswith(_normalized(physical))
    }
    return next(iter(matches)) if len(matches) == 1 else label


def infer_group(context: ConnectionContext, label: str) -> dict[str, Any] | None:
    expected_phase = "final" if score_workflow_step(context.workflow_step, context.stage) >= 7 else "qualifier"
    active_groups = tuple(
        group for group in context.groups if str(group.get("phase", "")).casefold() == expected_phase
    ) or context.groups
    assigned = context.source_group_ids.get(label)
    if assigned is not None:
        return next((group for group in active_groups if str(group.get("groupId")) == assigned), None)
    haystack = _normalized(Path(label).stem)
    matches = [
        group for group in active_groups
        if _group_name_matches_label(str(group.get("name", "")), haystack)
    ]
    return matches[0] if len(matches) == 1 else None


def _target(context: ConnectionContext, group: dict[str, Any]) -> ConnectionTarget:
    return ConnectionTarget(
        tournament_id=context.tournament_id,
        tournament_name=context.tournament_name,
        group_id=str(group["groupId"]),
        group_name=str(group["name"]),
        phase=str(group["phase"]),
    )


def publish_incremental_results(
    file: Path,
    *,
    client: ConnectedClient | None = None,
    target_store: ConnectionTargetStore | None = None,
    context_store: ConnectionContextStore | None = None,
    ledger_path: Path | None = None,
) -> int:
    """Update the operator's independent online record with stable local results.

    Tournament/group context is an advisory suggestion. A signed-in operator
    can therefore upload before selecting a Tournament; capture and local files
    remain authoritative when no session or network exists.
    """
    context = (context_store or ConnectionContextStore()).load()
    fallback_target = (target_store or ConnectionTargetStore()).load()
    if not file.is_file():
        return 0
    if client is None and context is None and fallback_target is None and SessionStore().load() is None:
        return 0
    payload = json.loads(file.read_text(encoding="utf-8"))
    documents = payload if isinstance(payload, list) else [payload]
    documents = [document for document in documents if isinstance(document, dict)]
    if not documents:
        return 0
    ledger = ledger_path or data_dir() / "incremental-feed-ledger.json"
    sent = set(json.loads(ledger.read_text(encoding="utf-8"))) if ledger.is_file() else set()
    keys = {
        f"{document.get('raceResultId')}:{document.get('revision', 1)}"
        for document in documents
    }
    pending = keys - sent
    if not pending:
        return 0
    try:
        (client or ConnectedClient()).upload_evidence_record(
            file, documents, context=context, target=fallback_target, complete=False,
        )
        sent.update(keys)
    except ConnectedError:
        queued_context: dict[str, Any] = {"incremental": True, "evidence_record": True}
        if context is not None:
            queued_context["connection_context"] = _connection_context_payload(context)
        elif fallback_target is not None:
            queued_context["connection_target"] = _connection_target_payload(fallback_target)
        queue_upload(file, queued_context)
        return 0
    ledger.parent.mkdir(parents=True, exist_ok=True)
    ledger.write_text(json.dumps(sorted(sent), indent=2), encoding="utf-8")
    return len(pending)


def connected_delivery_barrier(
    file: Path,
    *,
    client: ConnectedClient | None = None,
    target_store: ConnectionTargetStore | None = None,
    context_store: ConnectionContextStore | None = None,
    ledger_path: Path | None = None,
    started_at_ms: int | None = None,
    stopped_at_ms: int | None = None,
    analysis_completed_at_ms: int | None = None,
) -> dict[str, Any]:
    """Finalize the independent online record and retain retry work on failure."""
    context = (context_store or ConnectionContextStore()).load()
    fallback_target = (target_store or ConnectionTargetStore()).load()
    signed_in = client is not None or SessionStore().load() is not None
    if not signed_in and context is None and fallback_target is None:
        return {"connected": False, "delivered": True, "uploaded": 0, "visible": 0, "queued": False}
    active_client = client or ConnectedClient()
    payload = json.loads(file.read_text(encoding="utf-8"))
    documents = payload if isinstance(payload, list) else [payload]
    documents = [document for document in documents if isinstance(document, dict)]
    queued = False
    visible = 0
    uploaded = 0
    try:
        receipt = active_client.upload_evidence_record(
            file, documents, context=context, target=fallback_target, complete=True,
            started_at_ms=started_at_ms, stopped_at_ms=stopped_at_ms,
            analysis_completed_at_ms=analysis_completed_at_ms,
        )
        uploaded = receipt.result_count
        visible = receipt.result_count if receipt.visible else 0
        _clear_source_queued_uploads(file)
    except (ConnectedError, OSError, ValueError, json.JSONDecodeError):
        queued = True
    if queued:
        queued_context: dict[str, Any] = {
            "incremental": True, "final_delivery_barrier": True, "evidence_record": True,
            **({"started_at_ms": started_at_ms} if started_at_ms is not None else {}),
            **({"stopped_at_ms": stopped_at_ms} if stopped_at_ms is not None else {}),
            **({"analysis_completed_at_ms": analysis_completed_at_ms} if analysis_completed_at_ms is not None else {}),
        }
        if context is not None:
            queued_context["connection_context"] = _connection_context_payload(context)
        elif fallback_target is not None:
            queued_context["connection_target"] = _connection_target_payload(fallback_target)
        queue_upload(file, queued_context)
    return {
        "connected": True,
        "delivered": not queued and visible == len(documents),
        "uploaded": uploaded,
        "visible": visible,
        "queued": queued,
    }


def _clear_source_queued_uploads(file: Path) -> None:
    outbox = data_dir() / "outbox"
    if not outbox.is_dir():
        return
    resolved = str(file.resolve())
    for queued in outbox.glob("*.pending.json"):
        try:
            value = json.loads(queued.read_text(encoding="utf-8"))
            if str(value.get("source_file")) == resolved:
                queued.unlink(missing_ok=True)
        except (OSError, json.JSONDecodeError):
            continue


def _source_has_queued_upload(file: Path) -> bool:
    outbox = data_dir() / "outbox"
    if not outbox.is_dir():
        return False
    resolved = str(file.resolve())
    for queued in outbox.glob("*.pending.json"):
        try:
            value = json.loads(queued.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if str(value.get("source_file")) == resolved:
            return True
    return False


def queued_upload_exists(file: Path) -> bool:
    """Return whether durable connected delivery work remains for this source."""

    return _source_has_queued_upload(file)


def queued_upload_count() -> int:
    """Count distinct local result sources still awaiting connected delivery."""

    outbox = data_dir() / "outbox"
    if not outbox.is_dir():
        return 0
    sources: set[str] = set()
    for queued in outbox.glob("*.pending.json"):
        try:
            value = json.loads(queued.read_text(encoding="utf-8"))
            sources.add(str(Path(str(value["source_file"])).resolve()))
        except (KeyError, TypeError, ValueError, json.JSONDecodeError, OSError):
            sources.add(str(queued.resolve()))
    return len(sources)


def queue_upload(file: Path, context: dict[str, Any]) -> Path:
    outbox = data_dir() / "outbox"
    outbox.mkdir(parents=True, exist_ok=True)
    queued_context = dict(context)
    try:
        token = SessionStore().load()
    except (OSError, ValueError, json.JSONDecodeError):
        token = None
    if token is not None:
        # Keep only a one-way session binding in the durable queue. This lets
        # background retry reject a different signed-in account without ever
        # copying the access token into plaintext outbox metadata.
        queued_context["account_session_key"] = session_identity_key(token)
    identity = hashlib.sha256(json.dumps({
        "source_file": str(file.resolve()), **queued_context,
    }, sort_keys=True).encode()).hexdigest()[:16]
    queued = outbox / f"{identity}-{file.name}.pending.json"
    temporary = queued.with_name(f".{queued.name}.{os.getpid()}-{time.time_ns()}.tmp")
    try:
        temporary.write_text(
            json.dumps({"source_file": str(file.resolve()), **queued_context}, indent=2),
            encoding="utf-8",
        )
        temporary.replace(queued)
    finally:
        temporary.unlink(missing_ok=True)
    return queued


def retry_queued_uploads(
    *,
    client: ConnectedClient | None = None,
    enforce_account_binding: bool = False,
    allow_unbound: bool = True,
) -> tuple[int, int]:
    """Retry each source once while preserving its frozen connection context.

    GUI callers enforce the stored session binding. Automatic retry also sets
    ``allow_unbound=False`` so queues made by an older build require one
    conscious manual retry before they can be attributed to an account.
    """
    outbox = data_dir() / "outbox"
    if not outbox.is_dir():
        return 0, 0
    current_session_key: str | None = None
    if enforce_account_binding:
        try:
            token = SessionStore().load()
        except (OSError, ValueError, json.JSONDecodeError):
            token = None
        current_session_key = session_identity_key(token) if token is not None else None
    uploaded = 0
    retained = 0
    grouped: dict[str, list[tuple[Path, str, dict[str, Any]]]] = {}
    for queued in sorted(outbox.glob("*.pending.json")):
        try:
            original = queued.read_text(encoding="utf-8")
            value = json.loads(original)
            source_key = str(Path(str(value["source_file"])).resolve())
            grouped.setdefault(source_key, []).append((queued, original, value))
        except (KeyError, TypeError, ValueError, json.JSONDecodeError, OSError):
            retained += 1
    for source_key, entries in grouped.items():
        bindings = {
            str(value["account_session_key"])
            for _, _, value in entries
            if isinstance(value.get("account_session_key"), str)
            and value["account_session_key"]
        }
        has_unbound_entry = any(
            not isinstance(value.get("account_session_key"), str)
            or not value["account_session_key"]
            for _, _, value in entries
        )
        if enforce_account_binding and (
            (bindings and bindings != {current_session_key})
            or (has_unbound_entry and not allow_unbound)
            or current_session_key is None
        ):
            retained += 1
            continue
        source = Path(source_key)
        context = next(
            (_connection_context_from_payload(value.get("connection_context")) for _, _, value in entries
             if value.get("connection_context") is not None),
            None,
        )
        target = next(
            (_connection_target_from_payload(value.get("connection_target") or value) for _, _, value in entries
             if value.get("connection_target") is not None or value.get("tournament_id") is not None),
            None,
        )
        try:
            for queued, _, _ in entries:
                queued.unlink(missing_ok=True)
            delivery = connected_delivery_barrier(
                source,
                client=client,
                context_store=(
                    _FrozenStore(context)
                    if context is not None else
                    _FrozenStore(None)
                    if target is not None else
                    None
                ),
                target_store=_FrozenStore(target) if target is not None else None,
                started_at_ms=next((value.get("started_at_ms") for _, _, value in entries if value.get("started_at_ms") is not None), None),
                stopped_at_ms=next((value.get("stopped_at_ms") for _, _, value in entries if value.get("stopped_at_ms") is not None), None),
                analysis_completed_at_ms=next((value.get("analysis_completed_at_ms") for _, _, value in entries if value.get("analysis_completed_at_ms") is not None), None),
            )
            uploaded += int(delivery.get("uploaded") or 0)
            if not delivery.get("delivered"):
                retained += 1
        except (ConnectedError, KeyError, TypeError, ValueError, json.JSONDecodeError, OSError):
            for queued, original, _ in entries:
                if not queued.exists():
                    queued.write_text(original, encoding="utf-8")
            retained += 1
    return uploaded, retained
