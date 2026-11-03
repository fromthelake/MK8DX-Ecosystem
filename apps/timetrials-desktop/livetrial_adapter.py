"""Pure LiveTrial finished-run to TimeTrialSubmissionV1 adapter."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import re
from typing import Literal, Protocol


_SUBMISSION_ID = re.compile(
    r"^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$"
)
_PLAYER_ID = re.compile(r"^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")
_TRACK_ID = re.compile(r"^track\.[a-z0-9]+(?:_[a-z0-9]+)*$")
_CHARACTER_ID = re.compile(r"^character\.[a-z0-9]+(?:_[a-z0-9]+)*$")
_CHARACTER_VARIANT_ID = re.compile(
    r"^character_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$"
)
_BODY_ID = re.compile(r"^body\.[a-z0-9]+(?:_[a-z0-9]+)*$")
_BODY_VARIANT_ID = re.compile(
    r"^body_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$"
)
_TIRE_ID = re.compile(r"^tire\.[a-z0-9]+(?:_[a-z0-9]+)*$")
_GLIDER_ID = re.compile(r"^glider\.[a-z0-9]+(?:_[a-z0-9]+)*$")
_GLIDER_VARIANT_ID = re.compile(
    r"^glider_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$"
)
_COUNTRY_ID = re.compile(r"^country\.[a-z]{2}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_MEDIA_TYPE = re.compile(
    r"^[a-z0-9][a-z0-9!#$&^_.+\-]*/[a-z0-9][a-z0-9!#$&^_.+\-]*$"
)
_MAX_EPOCH_MS = 253_402_300_799_999


class LiveTrialAdapterError(ValueError):
    """Bounded invalid-source/context error without private input detail."""


@dataclass(frozen=True)
class LiveTrialSubmissionContext:
    submission_id: str
    revision: int
    source_kind: Literal["livetrial_capture", "livetrial_recorded_video"]
    player_reference: dict
    producer_version: str
    local_record_id: str
    created_at_ms: int
    occurred_at_ms: int | None = None
    captured_at_ms: int | None = None
    evidence: tuple[dict, ...] = ()
    source_input: str | None = None


@dataclass(frozen=True)
class LiveTrialAssetRecord:
    asset_type: str
    parent_id: str | None = None


class LiveTrialAssetCatalog(Protocol):
    def resolve(self, stable_id: str) -> LiveTrialAssetRecord | None:
        """Resolve one stable ID without exposing storage to the adapter."""


def _fail() -> None:
    raise LiveTrialAdapterError("LiveTrial finished run is invalid.") from None


def _bounded_string(value: object, maximum: int) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= maximum


def _epoch(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= _MAX_EPOCH_MS
    )


def _valid_player_reference(value: object) -> bool:
    if not isinstance(value, dict) or set(value) != {"namespace", "value"}:
        return False
    namespace = value.get("namespace")
    identifier = value.get("value")
    if namespace == "player":
        return isinstance(identifier, str) and bool(_PLAYER_ID.fullmatch(identifier))
    return namespace in {
        "legacy_firebase_user",
        "producer_local_profile",
        "unresolved_observation",
    } and _bounded_string(identifier, 128)


def _valid_evidence(value: object) -> bool:
    if not isinstance(value, tuple) or len(value) > 8:
        return False
    for item in value:
        if not isinstance(item, dict):
            return False
        if not {"kind", "reference"} <= set(item) <= {
            "kind",
            "reference",
            "sha256",
            "mediaType",
        }:
            return False
        if item.get("kind") not in {
            "screenshot",
            "video",
            "capture_session",
            "scan_result",
        } or not _bounded_string(item.get("reference"), 512):
            return False
        sha256 = item.get("sha256")
        media_type = item.get("mediaType")
        if sha256 is not None and (
            not isinstance(sha256, str) or not _SHA256.fullmatch(sha256)
        ):
            return False
        if media_type is not None and (
            not isinstance(media_type, str) or not _MEDIA_TYPE.fullmatch(media_type)
        ):
            return False
    return True


def validate_livetrial_submission_context(context: object) -> None:
    """Fail bounded unless context can populate the canonical V1 fields."""
    if not isinstance(context, LiveTrialSubmissionContext):
        _fail()
    if (
        not isinstance(context.submission_id, str)
        or not _SUBMISSION_ID.fullmatch(context.submission_id)
        or not isinstance(context.revision, int)
        or isinstance(context.revision, bool)
        or context.revision < 1
        or context.source_kind not in (
            "livetrial_capture",
            "livetrial_recorded_video",
        )
        or not _valid_player_reference(context.player_reference)
        or not _bounded_string(context.producer_version, 64)
        or not _bounded_string(context.local_record_id, 128)
        or not _epoch(context.created_at_ms)
        or (
            context.occurred_at_ms is not None
            and not _epoch(context.occurred_at_ms)
        )
        or (
            context.captured_at_ms is not None
            and not _epoch(context.captured_at_ms)
        )
        or not _valid_evidence(context.evidence)
    ):
        _fail()


def _require_asset(
    catalog: LiveTrialAssetCatalog,
    stable_id: str,
    expected_type: str,
    expected_parent: str | None = None,
) -> None:
    try:
        record = catalog.resolve(stable_id)
    except Exception:
        _fail()
    if (
        not isinstance(record, LiveTrialAssetRecord)
        or record.asset_type != expected_type
        or record.parent_id != expected_parent
    ):
        _fail()


def _validate_assets(
    catalog: LiveTrialAssetCatalog,
    track_id: str,
    loadout: dict | None,
    country_id: str | None,
) -> None:
    _require_asset(catalog, track_id, "track")
    if loadout:
        for key, asset_type in (
            ("characterId", "character"),
            ("bodyId", "body"),
            ("tireId", "tire"),
            ("gliderId", "glider"),
        ):
            if key in loadout:
                _require_asset(catalog, loadout[key], asset_type)
        for variant_key, base_key, asset_type in (
            ("characterVariantId", "characterId", "character_variant"),
            ("bodyVariantId", "bodyId", "body_variant"),
            ("gliderVariantId", "gliderId", "glider_variant"),
        ):
            if variant_key in loadout:
                _require_asset(
                    catalog,
                    loadout[variant_key],
                    asset_type,
                    loadout[base_key],
                )
    if country_id:
        _require_asset(catalog, country_id, "country")


def _slot_id(
    identity: dict,
    name: str,
    patterns: tuple[re.Pattern[str], ...],
) -> str | None:
    value = identity.get(name)
    if value is None:
        return None
    if not isinstance(value, dict) or not isinstance(value.get("id"), str):
        _fail()
    identifier = value["id"]
    if not any(pattern.fullmatch(identifier) for pattern in patterns):
        _fail()
    return identifier


def _scan_result_identity(scan: dict) -> dict:
    """The accepted parts and the printed name of a central scan result, in the identity shape
    ``_loadout`` reads (an unaccepted part carries no id)."""
    parts = scan.get("parts") if isinstance(scan.get("parts"), dict) else {}
    identity: dict = {}
    for part_name, field in (("character", "character"), ("body", "kart"), ("tire", "wheel"),
                             ("glider", "glider"), ("country", "flag")):
        part = parts.get(part_name)
        if isinstance(part, dict) and part.get("accepted") is True and isinstance(part.get("id"), str):
            identity[field] = {"id": part["id"]}
    if isinstance(scan.get("observedPlayerName"), str):
        identity["name"] = scan["observedPlayerName"]
    return identity


def _loadout(identity: dict) -> tuple[dict | None, str | None]:
    out: dict[str, str] = {}
    character = _slot_id(
        identity,
        "character",
        (_CHARACTER_ID, _CHARACTER_VARIANT_ID),
    )
    if character:
        if character.startswith("character_variant."):
            parts = character.split(".")
            if len(parts) != 3:
                _fail()
            out["characterId"] = f"character.{parts[1]}"
            out["characterVariantId"] = character
        else:
            out["characterId"] = character
    body = _slot_id(identity, "kart", (_BODY_ID, _BODY_VARIANT_ID))
    if body:
        if body.startswith("body_variant."):
            parts = body.split(".")
            if len(parts) != 3:
                _fail()
            out["bodyId"] = f"body.{parts[1]}"
            out["bodyVariantId"] = body
        else:
            out["bodyId"] = body
    tire = _slot_id(identity, "wheel", (_TIRE_ID,))
    if tire:
        out["tireId"] = tire
    glider = _slot_id(identity, "glider", (_GLIDER_ID, _GLIDER_VARIANT_ID))
    if glider:
        if glider.startswith("glider_variant."):
            parts = glider.split(".")
            if len(parts) != 3:
                _fail()
            out["gliderId"] = f"glider.{parts[1]}"
            out["gliderVariantId"] = glider
        else:
            out["gliderId"] = glider
    return out or None, _slot_id(identity, "flag", (_COUNTRY_ID,))


def _event_time_ms(event: object) -> int | None:
    """An event's moment on the race clock: `race` where the engine has it,
    else its capture-relative `t`; both count from GO in milliseconds."""
    if not isinstance(event, dict):
        return None
    for key in ("race", "t"):
        value = event.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
    return None


def derive_lap_pickups(run: dict) -> tuple[list[int] | None, list[int] | None]:
    """Per-lap coin balance and mushrooms used, read from the run's events.

    LiveTrial watches the HUD while the run is driven and records every coin
    change (`coin`, from -> to) and every mushroom use (`mushroom_use_*`, or
    `mushrooms` from -> to on older recordings). The end screen the adapter
    otherwise reads carries neither, so without this the Home page said "lap
    times and coins not recorded" for every LiveTrial run.

    Coins are the balance at the end of each lap, mushrooms the uses inside
    each lap; the lap windows are the cumulative lap times, and the last lap
    keeps anything that lands after the finish time by a few frames. Either
    list is None when the run holds no evidence for it at all, so a recording
    made before the engine tracked it never claims zeros.
    """
    try:
        lap_times = run["results"]["player"]["lapTimesMs"]
    except (KeyError, TypeError):
        return None, None
    if not isinstance(lap_times, list) or not lap_times:
        return None, None
    events = run.get("events") or []
    if not isinstance(events, list):
        return None, None
    coin_events = sorted(
        (moment, event["to"])
        for event in events
        if isinstance(event, dict)
        and event.get("type") == "coin"
        and isinstance(event.get("to"), int)
        and not isinstance(event.get("to"), bool)
        and (moment := _event_time_ms(event)) is not None
    )
    use_moments = sorted(
        moment
        for event in events
        if isinstance(event, dict)
        and isinstance(event.get("type"), str)
        and event["type"].startswith("mushroom_use")
        and (moment := _event_time_ms(event)) is not None
    )
    if not use_moments:
        use_moments = sorted(
            moment
            for event in events
            if isinstance(event, dict)
            and event.get("type") == "mushrooms"
            and isinstance(event.get("from"), int)
            and isinstance(event.get("to"), int)
            and event["to"] < event["from"]
            and (moment := _event_time_ms(event)) is not None
        )
    coins_tracked = bool(coin_events) or isinstance(run.get("coins"), int)
    mushrooms_tracked = bool(use_moments) or isinstance(run.get("mushrooms"), int)
    boundaries: list[int] = []
    elapsed = 0
    for value in lap_times:
        elapsed += value if isinstance(value, int) and not isinstance(value, bool) else 0
        boundaries.append(elapsed)
    coins: list[int] = []
    mushrooms: list[int] = []
    previous = 0
    for index, boundary in enumerate(boundaries):
        last_lap = index == len(boundaries) - 1
        balance = 0
        for moment, to in coin_events:
            if last_lap or moment <= boundary:
                balance = to
        coins.append(min(max(balance, 0), 10))
        used = sum(
            1 for moment in use_moments
            if moment > previous and (last_lap or moment <= boundary)
        )
        mushrooms.append(min(used, 3))
        previous = boundary
    return (
        coins if coins_tracked else None,
        mushrooms if mushrooms_tracked and sum(mushrooms) <= 3 else None,
    )


def adapt_livetrial_finished_run(
    run: dict,
    context: LiveTrialSubmissionContext,
    asset_catalog: LiveTrialAssetCatalog,
) -> tuple[dict, dict]:
    """Return canonical V1 plus source-specific local evidence kept outside V1."""
    validate_livetrial_submission_context(context)
    try:
        source_context = run["context"]
        player = run["results"]["player"]
        source_mode = source_context["cc"]
        track = source_context["trackName"]
        track_id = track["trackId"]
        lap_count = run["lapCount"]
        total = player["totalMs"]
        lap_times = player["lapTimesMs"]
    except (KeyError, TypeError):
        _fail()
    mode = int(source_mode) if source_mode in ("150", "200") else source_mode
    if (
        not isinstance(mode, int)
        or isinstance(mode, bool)
        or mode not in (150, 200)
        or not isinstance(track_id, str)
        or not _TRACK_ID.fullmatch(track_id)
        or lap_count not in (3, 7)
        or not isinstance(total, int)
        or isinstance(total, bool)
        or total < 1
        or total > 599_999
        or not isinstance(lap_times, list)
        or len(lap_times) != lap_count
        or any(
            not isinstance(value, int)
            or isinstance(value, bool)
            or value < 1
            or value > 599_999
            for value in lap_times
        )
        or sum(lap_times) != total
        or player.get("lapSumOk") is not True
    ):
        _fail()
    identity = run.get("identity") or {}
    if not isinstance(identity, dict) or not isinstance(identity.get("player", {}), dict):
        _fail()
    player_identity = identity.get("player") or {}
    scan = (run.get("scanResult") or {}).get("player") if isinstance(run.get("scanResult"), dict) else None
    if isinstance(scan, dict):
        # The engine's central scan result (packages/icon-matcher scan_result, the Web scanner's
        # and Android's result contract) decides which parts count and whether the laps close.
        if scan.get("status") != "ok" or scan.get("totalMs") != total or scan.get("lapSumMatches") is not True:
            _fail()
        player_identity = _scan_result_identity(scan)
    loadout, country_id = _loadout(player_identity)
    _validate_assets(asset_catalog, track_id, loadout, country_id)
    observed_name = player_identity.get("name")
    if observed_name is not None and (
        not isinstance(observed_name, str)
        or not 1 <= len(observed_name) <= 64
    ):
        _fail()

    timestamps = {"createdAtMs": context.created_at_ms}
    if context.occurred_at_ms is not None:
        timestamps["occurredAtMs"] = context.occurred_at_ms
    if context.captured_at_ms is not None:
        timestamps["capturedAtMs"] = context.captured_at_ms
    lap_coins, lap_mushrooms = derive_lap_pickups(run)
    laps = []
    for index, value in enumerate(lap_times, 1):
        lap = {"lapNumber": index, "timeMs": value}
        if lap_coins is not None:
            lap["coinsCollected"] = lap_coins[index - 1]
        if lap_mushrooms is not None:
            lap["mushroomsUsed"] = lap_mushrooms[index - 1]
        laps.append(lap)
    submission = {
        "schemaVersion": "mk8dx.time-trial-submission.v1",
        "submissionId": context.submission_id,
        "revision": context.revision,
        "mode": mode,
        "trackId": track_id,
        "totalTimeMs": total,
        "laps": laps,
        "playerReference": deepcopy(context.player_reference),
        "source": {
            "kind": context.source_kind,
            "producerVersion": context.producer_version,
            "localRecordId": context.local_record_id,
        },
        "timestamps": timestamps,
        "verification": {
            "status": "producer_check_passed",
            "method": "livetrial_result_card_lap_sum_v1",
            "lapSumMatches": True,
        },
    }
    if loadout:
        submission["loadout"] = loadout
    if country_id:
        submission["countryId"] = country_id
    if observed_name:
        submission["observedPlayerName"] = observed_name
    if context.evidence:
        submission["evidence"] = [deepcopy(item) for item in context.evidence]

    local_evidence = {
        "runIndex": run.get("run"),
        "ghost": deepcopy((run.get("results") or {}).get("ghost")),
        "playerIdentity": deepcopy(identity.get("player")),
        "ghostIdentity": deepcopy(identity.get("ghost")),
        "events": deepcopy(run.get("events") or []),
        "category": run.get("category"),
        "outcome": run.get("outcome"),
        "runDiagnostics": {
            "finishGateMissed": run.get("finishGateMissed"),
            "goEstimated": run.get("goEstimated"),
            "lapCountCorrected": run.get("lapCountCorrected"),
        },
        "rawTrackName": track.get("raw") if isinstance(track, dict) else None,
        "sourceInput": context.source_input,
    }
    return submission, local_evidence


def adapt_livetrial_ghost(
    ghost: dict,
    context: LiveTrialSubmissionContext,
    asset_catalog: LiveTrialAssetCatalog,
) -> tuple[dict, dict]:
    """A detected ghost the Player said is theirs (ADR-0210) as canonical V1.

    Read from the Select-a-Ghost panel, so `captureLayout` is `ghost_details`.
    Laps only when the panel was seen expanded with a closing lap sum; per-lap
    coin balance and mushrooms only from a replay watched to its finish (the
    engine keeps nothing else). The panel does not say when the ghost was
    driven: `occurredAtMs` is never set. Staff ghosts never get here."""
    validate_livetrial_submission_context(context)
    if context.occurred_at_ms is not None or ghost.get("staffGhost"):
        _fail()
    try:
        track_id = ghost["trackId"]
        mode = int(ghost["cc"])
        total = ghost["totalMs"]
    except (KeyError, TypeError, ValueError):
        _fail()
    if (
        not isinstance(track_id, str)
        or not _TRACK_ID.fullmatch(track_id)
        or mode not in (150, 200)
        or not isinstance(total, int)
        or isinstance(total, bool)
        or not 1 <= total <= 599_999
    ):
        _fail()
    lap_times = ghost.get("lapTimesMs") if ghost.get("lapSumOk") is True else None
    if lap_times is not None and (
        not isinstance(lap_times, list)
        or len(lap_times) not in (3, 7)
        or any(not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 599_999 for v in lap_times)
        or sum(lap_times) != total
    ):
        _fail()
    identity = {
        name: {"id": ghost[key]}
        for name, key in (("character", "characterId"), ("kart", "bodyId"), ("wheel", "tireId"),
                          ("glider", "gliderId"), ("flag", "countryId"))
        if isinstance(ghost.get(key), str)
    }
    loadout, country_id = _loadout(identity)
    _validate_assets(asset_catalog, track_id, loadout, country_id)
    observed_name = ghost.get("nameRaw") or ghost.get("name")
    if observed_name is not None and (not isinstance(observed_name, str) or not 1 <= len(observed_name) <= 64):
        _fail()
    replay = ghost.get("replay") if isinstance(ghost.get("replay"), dict) else None
    laps = []
    for index, value in enumerate(lap_times or [], 1):
        lap = {"lapNumber": index, "timeMs": value}
        if replay is not None:
            coins, mushrooms = replay.get("coinBalanceAtLapEnd"), replay.get("mushroomsPerLap")
            if isinstance(coins, list) and len(coins) == len(lap_times):
                lap["coinsCollected"] = min(max(int(coins[index - 1]), 0), 10)
            if isinstance(mushrooms, list) and len(mushrooms) == len(lap_times) and sum(mushrooms) <= 3:
                lap["mushroomsUsed"] = int(mushrooms[index - 1])
        laps.append(lap)
    timestamps = {"createdAtMs": context.created_at_ms}
    if context.captured_at_ms is not None:
        timestamps["capturedAtMs"] = context.captured_at_ms
    submission = {
        "schemaVersion": "mk8dx.time-trial-submission.v1",
        "submissionId": context.submission_id,
        "revision": context.revision,
        "mode": mode,
        "trackId": track_id,
        "totalTimeMs": total,
        "laps": laps,
        "playerReference": deepcopy(context.player_reference),
        "source": {
            "kind": context.source_kind,
            "captureLayout": "ghost_details",
            "producerVersion": context.producer_version,
            "localRecordId": context.local_record_id,
        },
        "timestamps": timestamps,
        "verification": (
            {"status": "producer_check_passed", "method": "livetrial_ghost_panel_lap_sum_v1",
             "lapSumMatches": True}
            if laps else {"status": "not_checked", "method": "livetrial_ghost_panel_total_only_v1"}
        ),
    }
    if loadout:
        submission["loadout"] = loadout
    if country_id:
        submission["countryId"] = country_id
    if observed_name:
        submission["observedPlayerName"] = observed_name
    if context.evidence:
        submission["evidence"] = [deepcopy(item) for item in context.evidence]
    local_evidence = {
        "ghost": deepcopy(ghost),
        "sourceInput": context.source_input,
    }
    return submission, local_evidence
