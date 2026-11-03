"""Non-destructive Player corrections for recognition-derived LiveTrial runs."""

from __future__ import annotations

from copy import deepcopy
from typing import Callable


RECOGNITION_SOURCES = {"livetrial_capture", "livetrial_recorded_video"}
LOADOUT_FIELDS = {
    "characterId": "character",
    "characterVariantId": "characterVariant",
    "bodyId": "body",
    "bodyVariantId": "bodyVariant",
    "tireId": "tire",
    "gliderId": "glider",
    "gliderVariantId": "gliderVariant",
}


class LiveTrialCorrectionError(RuntimeError):
    """Bounded correction failure without paths or private evidence."""


def _fail() -> None:
    raise LiveTrialCorrectionError("LiveTrial result correction is invalid.") from None


def latest_records(records: list[dict]) -> list[dict]:
    latest: dict[str, dict] = {}
    try:
        for record in records:
            submission = record["canonicalSubmission"]
            current = latest.get(submission["submissionId"])
            if current is None or submission["revision"] > current["canonicalSubmission"]["revision"]:
                latest[submission["submissionId"]] = record
        return sorted(
            latest.values(),
            key=lambda row: row["canonicalSubmission"]["timestamps"]["createdAtMs"],
            reverse=True,
        )
    except Exception:
        _fail()


def create_corrected_revision(
    outbox: object,
    prior_record: dict,
    changes: dict,
    created_at_ms: int,
) -> tuple[dict, tuple[str, ...]]:
    """Append one next revision; the prior local/synced revision remains intact."""
    try:
        if not isinstance(changes, dict) or not isinstance(created_at_ms, int) or created_at_ms < 0:
            _fail()
        prior = prior_record["canonicalSubmission"]
        source_kind = prior["source"]["kind"]
        if source_kind not in RECOGNITION_SOURCES:
            _fail()
        allowed = {"trackId", "mode", "totalTimeMs", "laps", "loadout", "countryId", "observedPlayerName"}
        if any(key not in allowed for key in changes):
            _fail()
        updated = deepcopy(prior)
        fields: list[str] = []
        scalar_names = {
            "trackId": "track",
            "mode": "mode",
            "totalTimeMs": "totalTime",
            "countryId": "country",
            "observedPlayerName": "playerName",
        }
        for key, field in scalar_names.items():
            if key in changes and changes[key] != prior.get(key):
                if changes[key] is None:
                    updated.pop(key, None)
                else:
                    updated[key] = deepcopy(changes[key])
                fields.append(field)
        if "laps" in changes and changes["laps"] != prior.get("laps", []):
            old_laps = prior.get("laps", [])
            new_laps = deepcopy(changes["laps"])
            if [lap.get("timeMs") for lap in old_laps] != [lap.get("timeMs") for lap in new_laps]:
                fields.append("laps")
            if [lap.get("coinsCollected") for lap in old_laps] != [lap.get("coinsCollected") for lap in new_laps]:
                fields.append("coins")
            if [lap.get("mushroomsUsed") for lap in old_laps] != [lap.get("mushroomsUsed") for lap in new_laps]:
                fields.append("mushrooms")
            updated["laps"] = new_laps
        if "loadout" in changes and changes["loadout"] != prior.get("loadout"):
            old_loadout = prior.get("loadout") or {}
            new_loadout = changes["loadout"] or {}
            for key, field in LOADOUT_FIELDS.items():
                if old_loadout.get(key) != new_loadout.get(key):
                    fields.append(field)
            if new_loadout:
                updated["loadout"] = deepcopy(new_loadout)
            else:
                updated.pop("loadout", None)
        fields = list(dict.fromkeys(fields))
        if not fields:
            _fail()
        laps = updated.get("laps", [])
        if laps and sum(lap["timeMs"] for lap in laps) != updated["totalTimeMs"]:
            _fail()
        updated["revision"] = prior["revision"] + 1
        updated["timestamps"] = {
            **{key: value for key, value in prior["timestamps"].items()
               if key in {"occurredAtMs", "capturedAtMs"}},
            "createdAtMs": created_at_ms,
        }
        verification = deepcopy(prior.get("verification") or {})
        verification.update({
            "status": "not_checked",
            "method": "player_corrected_after_livetrial",
            "lapSumMatches": not laps or sum(lap["timeMs"] for lap in laps) == updated["totalTimeMs"],
            "correctedFields": fields,
        })
        updated["verification"] = verification
        evidence = None
        if prior_record["entry"].get("privateEvidencePresent"):
            evidence = outbox.read_private_evidence(prior_record["entry"]["entryKey"])["privateEvidence"]
        return outbox.create(updated, created_at_ms, evidence), tuple(fields)
    except LiveTrialCorrectionError:
        raise
    except Exception:
        _fail()


def parse_time(value: str) -> int:
    try:
        minute, rest = value.strip().split(":", 1)
        second, millis = rest.split(".", 1)
        if len(millis) != 3:
            _fail()
        result = int(minute) * 60_000 + int(second) * 1_000 + int(millis)
        if not 0 <= int(second) <= 59 or not 1 <= result <= 599_999:
            _fail()
        return result
    except LiveTrialCorrectionError:
        raise
    except Exception:
        _fail()


def format_time(value: int) -> str:
    return f"{value // 60_000}:{value % 60_000 // 1_000:02d}.{value % 1_000:03d}"
