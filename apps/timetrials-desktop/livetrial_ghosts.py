"""Detected ghosts in the desktop app (ADR-0210).

The engine writes every ghost it saw to ``runs/<session>/ghosts.json`` — one
record per ghost, never anybody's. This module turns them into rows for the
Live tab's *This session* list and carries out the Player's decision:

- **Mine**: one normal local LiveTrial result for the account chosen at that
  moment (``adapt_livetrial_ghost``), which then follows the usual waiting-to-
  send path. Refused for Nintendo Staff ghosts, for a time the account already
  has, and for a world-record time without a second confirmation.
- **Not mine**: the row is hidden; the record stays for export.
- **Export**: a ``mk8dx.detected-ghost.v1`` document the Player can share. No
  account, device or PC identifiers.

Nothing is ever linked to an account without Mine. Names only *suggest*
("probably yours" when the ghost carries a name this account confirmed before);
they never decide (ADR-0178).
"""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re

from livetrial_adapter import LiveTrialSubmissionContext, adapt_livetrial_ghost

GHOSTS_FILE = "ghosts.json"
DETECTED_GHOSTS_FORMAT = "mk8dx.detected-ghosts.v1"
EXPORT_FORMAT = "mk8dx.detected-ghost.v1"
DECISIONS_FILE = "ghost-decisions.json"
MAX_GHOSTS_FILE_BYTES = 2 * 1024 * 1024
MAX_SESSIONS = 40


class LiveTrialGhostError(ValueError):
    """A bounded, user-readable refusal."""


def _fail(message: str) -> None:
    raise LiveTrialGhostError(message)


def _norm_name(name: object) -> str:
    return re.sub(r"[^0-9a-z]", "", str(name or "").lower())


def ghost_id(session: str, key: str) -> str:
    return f"{session}#{key}"


def read_session_ghosts(runs_root: str | Path, since_epoch_ms: int | None = None) -> list[dict]:
    """Every detected ghost of the recent sessions, newest session first.
    Each item: {"id", "session", "ghost"}. A broken or oversized file is skipped."""
    root = Path(runs_root)
    if not root.is_dir():
        return []
    files = []
    for path in root.glob(f"*/{GHOSTS_FILE}"):
        try:
            if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_GHOSTS_FILE_BYTES:
                continue
            modified = path.stat().st_mtime_ns // 1_000_000
        except OSError:
            continue
        if since_epoch_ms is not None and modified < since_epoch_ms:
            continue
        files.append((modified, path))
    out = []
    for _modified, path in sorted(files, reverse=True)[:MAX_SESSIONS]:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(document, dict) or document.get("format") != DETECTED_GHOSTS_FORMAT:
            continue
        for ghost in document.get("ghosts") or []:
            if isinstance(ghost, dict) and isinstance(ghost.get("key"), str) \
                    and isinstance(ghost.get("totalMs"), int) and ghost.get("cc") in ("150", "200"):
                out.append({"id": ghost_id(path.parent.name, ghost["key"]), "session": path.parent.name,
                            "source": str(document.get("source") or ""), "ghost": ghost})
    return out


class GhostDecisions:
    """The Player's choices, kept beside the local data (never sent)."""

    def __init__(self, data_root: str | Path):
        self.path = Path(data_root) / DECISIONS_FILE

    def load(self) -> dict:
        try:
            document = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"decisions": {}, "confirmedNames": {}, "ownNames": {}}
        if not isinstance(document, dict):
            return {"decisions": {}, "confirmedNames": {}, "ownNames": {}}
        document.setdefault("decisions", {})
        document.setdefault("confirmedNames", {})
        document.setdefault("ownNames", {})
        return document

    def save(self, document: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.part")
        tmp.write_text(json.dumps(document, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)

    def decide(self, gid: str, decision: dict) -> None:
        document = self.load()
        document["decisions"][gid] = decision
        self.save(document)

    def confirm_name(self, slot_id: str, name: str | None) -> None:
        if not name:
            return
        document = self.load()
        names = document["confirmedNames"].setdefault(slot_id, [])
        if _norm_name(name) not in {_norm_name(n) for n in names}:
            names.append(name[:64])
        self.save(document)


def display_loadout(ghost: dict) -> dict:
    """The ghost's parts in the shape results use: a colour variant
    (`character_variant.shy_guy.028_light_blue`) becomes its base id plus the
    variant id, as `livetrial_adapter._loadout` does for a submission, so the
    row's icon strip finds the character (it looks base parts up by id)."""
    out: dict = {}
    for key, base_prefix, variant_key in (("characterId", "character", "characterVariantId"),
                                          ("bodyId", "body", "bodyVariantId"),
                                          ("tireId", "tire", None),
                                          ("gliderId", "glider", "gliderVariantId")):
        value = ghost.get(key)
        if not isinstance(value, str) or not value:
            continue
        parts = value.split(".")
        if variant_key and parts[0] == f"{base_prefix}_variant" and len(parts) == 3:
            out[key] = f"{base_prefix}.{parts[1]}"
            out[variant_key] = value
        else:
            out[key] = value
    return out


def _published_best(reference: dict | None, track_id: str | None, cc: str) -> int | None:
    try:
        value = reference["tracks"][track_id][cc]["pb"]
    except (KeyError, TypeError):
        return None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _saved_times(results: list[dict], player_id: str | None) -> set[tuple]:
    """(trackId, mode, totalTimeMs) of the account's local results."""
    out = set()
    for value in results:
        reference = value.get("playerReference") or {}
        if player_id and reference.get("namespace") == "player" and reference.get("value") == player_id:
            out.add((value.get("trackId"), value.get("mode"), value.get("totalTimeMs")))
    return out


def ghost_rows(items: list[dict], decisions: dict, *, player_id: str | None, slot_id: str | None,
               reference: dict | None, local_results: list[dict], world_records: dict | None,
               published: list[dict] | None = None) -> list[dict]:
    """Rows for This session (ADR-0210 rules 3-4, 10). Not-mine rows are left out.
    `published`: the account's website results when known; otherwise only its best
    (player-reference.json) tells that a time is already on the website."""
    saved = _saved_times(local_results, player_id)
    confirmed = {_norm_name(n) for n in (decisions.get("confirmedNames") or {}).get(slot_id or "", [])}
    rows = []
    for item in items:
        g = item["ghost"]
        decision = (decisions.get("decisions") or {}).get(item["id"]) or {}
        if decision.get("decision") == "not_mine":
            continue
        track_id, cc, total = g.get("trackId"), str(g.get("cc")), g.get("totalMs")
        wr = (world_records or {}).get(f"{track_id}|{cc}") or {}
        world_record = bool(g.get("worldRecord")) or (isinstance(wr.get("timeMs"), int) and wr["timeMs"] == total)
        pb = _published_best(reference, track_id, cc)
        match = website_match(published, g) if published is not None else None
        on_website = (pb is not None and pb == total) or match is not None
        already = ("website" if on_website else
                   "saved" if (track_id, int(cc), total) in saved else None)
        mine = decision.get("decision") == "mine"
        completed = decision.get("decision") == "completed"
        richer = completed and any(n and not b for n, b in zip(_richness(g), decision.get("richness") or (False, False)))
        replay = g.get("replay") if isinstance(g.get("replay"), dict) else {}
        balances, used = replay.get("coinBalanceAtLapEnd") or [], replay.get("mushroomsPerLap") or []
        laps = [{"time": t,
                 "coins": balances[i] if i < len(balances) else None,
                 "mushrooms": used[i] if i < len(used) else None}
                for i, t in enumerate(g.get("lapTimes") or [])]
        rows.append({
            "id": item["id"],
            "seenAtMs": g.get("lastSeenAtMs") or g.get("firstSeenAtMs"),
            "trackId": track_id, "mode": int(cc), "totalMs": total, "total": g.get("total"),
            "name": g.get("name"), "characterId": g.get("characterId"), "countryId": g.get("countryId"),
            "state": g.get("state"), "lapTimes": g.get("lapTimes"), "laps": laps,
            "loadout": display_loadout(g),
            "replay": ({"coinsPerLap": g["replay"].get("coinCountsPerLap"),
                        "mushroomsPerLap": g["replay"].get("mushroomsPerLap")}
                       if isinstance(g.get("replay"), dict) else None),
            "staffGhost": bool(g.get("staffGhost")),
            "worldRecord": world_record,
            "already": already,
            "probablyYours": bool(_norm_name(g.get("nameRaw") or g.get("name")) in confirmed) and not mine,
            "decision": decision.get("decision"),
            "entryKey": decision.get("entryKey"),
            # the website result it matched, so "Already on the website" can open it
            "websiteResultId": match.get("resultId") if match else None,
            "canClaim": not g.get("staffGhost") and already is None and not mine and bool(track_id),
            # rule 10: your own ghost of a result already on the website fills in what it lacks
            "canComplete": (not g.get("staffGhost") and already == "website" and bool(track_id)
                            and (not decision or (richer and decision.get("outcome") != "website_differs"))),
            "completion": ({key: decision.get(key) for key in ("outcome", "fields", "auto", "byName")}
                           if completed else None),
        })
    return rows


def claim(item: dict, account: dict, *, outbox, owners, decisions: GhostDecisions, catalog,
          now_ms: int, producer_version: str, reference: dict | None, local_results: list[dict],
          world_records: dict | None, confirm_world_record: bool = False) -> dict:
    """Mine: one normal local result for `account` from the detected ghost."""
    g = item["ghost"]
    if g.get("staffGhost"):
        _fail("A Nintendo staff ghost is never a Player's time.")
    if not g.get("trackId"):
        _fail("The track of this ghost was not read, so it cannot be saved.")
    player_id = account.get("playerId")
    if not player_id:
        _fail("Add or choose an account first.")
    row = ghost_rows([item], {"decisions": {}, "confirmedNames": {}}, player_id=player_id, slot_id=None,
                     reference=reference, local_results=local_results, world_records=world_records)[0]
    if row["already"] == "website":
        _fail("This time is already on the website for this account.")
    if row["already"] == "saved":
        _fail("This time is already saved for this account.")
    if row["worldRecord"] and not confirm_world_record:
        _fail("This is the world record time. Confirm that it is really yours.")
    digest = hashlib.sha256(f"ghost|{item['id']}|{player_id}".encode("utf-8")).hexdigest()
    source_kind = "livetrial_capture" if item.get("source", "").startswith("live:") else "livetrial_recorded_video"
    context = LiveTrialSubmissionContext(
        submission_id=f"user_submission.time.LIVETRIALGHOST{digest[:48]}",
        revision=1,
        source_kind=source_kind,
        # the one evidence reference the LiveTrial sender allows (livetrial_product_cli
        # _reviewed_livetrial_evidence): the capture session or video it was read from
        evidence=({"kind": "capture_session" if source_kind == "livetrial_capture" else "video",
                   "reference": f"livetrial/{digest}"},),
        player_reference={"namespace": "player", "value": player_id},
        producer_version=producer_version,
        local_record_id=f"ghost:{item['id']}"[:128],
        created_at_ms=now_ms,
        captured_at_ms=g.get("firstSeenAtMs") if isinstance(g.get("firstSeenAtMs"), int) else None,
        source_input=None,
    )
    submission, evidence = adapt_livetrial_ghost(g, context, catalog)
    record = outbox.create(submission, now_ms, evidence)
    entry_key = record["entry"]["entryKey"]
    owners.record(entry_key, account["slotId"], submission["playerReference"], now_ms)
    decisions.decide(item["id"], {"decision": "mine", "entryKey": entry_key, "slotId": account["slotId"],
                                  "atMs": now_ms, "richness": list(_richness(g))})
    decisions.confirm_name(account["slotId"], g.get("nameRaw") or g.get("name"))
    return {"entryKey": entry_key}


# --- the Player's own ghost names (owner 2026-09-28) -------------------------------
# "I as a user can set a name that when detected in a ghost time it should be
# automatically linked to my account ... BAwSer ... and more recently BasAi."
# Declaring a name is the Player's own act, so a ghost carrying it EXACTLY
# (case and spacing aside) is linked without a click — never a staff ghost,
# never a world-record time (that still asks), never a time the account has.
# Nintendo names are not unique, so the link says why and can be undone
# while it has not been sent.
MAX_OWN_NAMES = 10
GHOST_UNDONE = "local.ghost-undone"
SETTLE_MS = 30_000          # a ghost left alone this long is complete enough to link


def own_names(decisions: dict, slot_id: str | None) -> list[str]:
    return list((decisions.get("ownNames") or {}).get(slot_id or "", []))


def set_own_names(store: GhostDecisions, slot_id: str, names: list) -> list[str]:
    if not isinstance(names, list) or len(names) > MAX_OWN_NAMES:
        _fail(f"Up to {MAX_OWN_NAMES} names.")
    clean: list[str] = []
    for name in names:
        if not isinstance(name, str):
            _fail("A name is text.")
        name = name.strip()
        if not name:
            continue
        if len(name) > 32 or len(_norm_name(name)) < 2:
            _fail("A ghost name has 2 to 32 characters.")
        if _norm_name(name) not in {_norm_name(n) for n in clean}:
            clean.append(name)
    document = store.load()
    document.setdefault("ownNames", {})[slot_id] = clean
    store.save(document)
    return clean


def _owner_by_name(decisions: dict, name: object) -> str | None:
    """The one account that declared this name, or None (none, or ambiguous)."""
    wanted = _norm_name(name)
    if not wanted:
        return None
    slots = [slot for slot, names in (decisions.get("ownNames") or {}).items()
             if wanted in {_norm_name(n) for n in names}]
    return slots[0] if len(slots) == 1 else None


def auto_link(items: list[dict], *, accounts: dict, outbox, owners, decisions: GhostDecisions, catalog,
              now_ms: int, producer_version: str, references: dict, local_results: list[dict],
              world_records: dict | None, capture_running: bool, wall_ms: int | None = None) -> list[str]:
    """Link every settled, undecided ghost that carries a declared name. Returns
    the ghost ids linked. `accounts`: slotId -> account; `references`: playerId ->
    player-reference.json document (or absent). `wall_ms` is the wall clock the
    ENGINE stamps sightings with (time.time), for the settle test; `now_ms` is
    the app's clock for the records it writes."""
    wall_ms = now_ms if wall_ms is None else wall_ms
    linked = []
    document = decisions.load()
    for item in items:
        g = item["ghost"]
        if item["id"] in document["decisions"] or g.get("staffGhost") or not g.get("trackId"):
            continue
        seen = g.get("lastSeenAtMs") or g.get("firstSeenAtMs") or wall_ms
        if capture_running and wall_ms - seen < SETTLE_MS:
            continue                                   # still on screen: wait for the full read
        slot = _owner_by_name(document, g.get("nameRaw") or g.get("name"))
        account = accounts.get(slot) if slot else None
        if not account or not account.get("playerId"):
            continue
        try:
            claim(item, account, outbox=outbox, owners=owners, decisions=decisions, catalog=catalog,
                  now_ms=now_ms, producer_version=producer_version,
                  reference=references.get(account["playerId"]), local_results=local_results,
                  world_records=world_records, confirm_world_record=False)
        except LiveTrialGhostError:
            continue                                   # world record / already known: left to the Player
        stored = decisions.load()
        stored["decisions"][item["id"]].update({"auto": True, "byName": g.get("nameRaw") or g.get("name")})
        decisions.save(stored)
        document = stored
        linked.append(item["id"])
    return linked


def _richness(ghost: dict) -> tuple[bool, bool]:
    return bool(ghost.get("lapSumOk") and ghost.get("lapTimesMs")), isinstance(ghost.get("replay"), dict)


def enrich_claimed(items: list[dict], *, outbox, owners, decisions: GhostDecisions, catalog, now_ms: int,
                   producer_version: str, latest_by_entry: dict) -> list[str]:
    """A ghost marked Mine that the engine later saw more of (its panel
    expanded, its replay watched to the end) gets a next revision of the SAME
    result with that data — produced from the panel, not a Player correction."""
    enriched = []
    document = decisions.load()
    for item in items:
        decision = document["decisions"].get(item["id"]) or {}
        if decision.get("decision") != "mine":
            continue
        record = latest_by_entry.get(decision.get("entryKey"))
        if record is None or record["state"].get("failureCode") == GHOST_UNDONE:
            continue
        before = tuple(decision.get("richness") or (False, False))
        now = _richness(item["ghost"])
        if not any(n and not b for n, b in zip(now, before)):
            continue
        prior = record["canonicalSubmission"]
        context = LiveTrialSubmissionContext(
            submission_id=prior["submissionId"], revision=prior["revision"] + 1,
            source_kind=prior["source"]["kind"], player_reference=deepcopy(prior["playerReference"]),
            producer_version=producer_version, local_record_id=prior["source"]["localRecordId"],
            created_at_ms=now_ms, captured_at_ms=prior["timestamps"].get("capturedAtMs"), source_input=None,
            evidence=tuple(deepcopy(prior.get("evidence") or [])))
        submission, evidence = adapt_livetrial_ghost(item["ghost"], context, catalog)
        created = outbox.create(submission, now_ms, evidence)
        owners.record(created["entry"]["entryKey"], decision.get("slotId"), submission["playerReference"], now_ms)
        decision.update({"entryKey": created["entry"]["entryKey"], "richness": list(now)})
        document["decisions"][item["id"]] = decision
        decisions.save(document)
        enriched.append(item["id"])
    return enriched


# --- completing a result already on the website (ADR-0210 rule 10) ------------------
# Owner 2026-09-28: "for my replays it can also mean data is still missing on
# character, body, tire, glider, lap times, coins, mushroom, so it should still be
# added if it's there." Your own ghost with exactly the time of a result you
# already published fills in what that result lacks. The server fills only empty
# fields and refuses a reading that disagrees; the result keeps its date and source.
COMPLETION_SCHEMA = "mk8dx.time-trial-completion.v1"
MAX_PUBLIC_RESULTS_BYTES = 3 * 1024 * 1024


def website_results(executor, player_id: str, bearer: str | None) -> list[dict]:
    """The Player's published results (the public list, as Web's My records reads it)."""
    from urllib.parse import quote
    response = executor.request("GET", f"/v1/public/players/{quote(player_id, safe='')}/time-trials",
                                None, bearer, MAX_PUBLIC_RESULTS_BYTES)
    if not isinstance(response, dict) or response.get("statusCode") != 200:
        _fail("Your results on the website could not be read.")
    try:
        document = json.loads(response["body"].decode("utf-8"))
    except (ValueError, UnicodeError, AttributeError):
        _fail("Your results on the website could not be read.")
    return [row for row in (document.get("results") or []) if isinstance(row, dict)
            and row.get("playerId") == player_id and isinstance(row.get("resultId"), str)
            and isinstance(row.get("revision"), int)]


def website_match(results: list[dict], ghost: dict) -> dict | None:
    """The published result of this exact run: same track, engine and time to the millisecond."""
    try:
        wanted = (ghost["trackId"], int(ghost["cc"]), ghost["totalMs"])
    except (KeyError, TypeError, ValueError):
        return None
    return next((row for row in results
                 if (row.get("trackId"), row.get("mode"), row.get("totalTimeMs")) == wanted), None)


RESULT_ID_PREFIX = "user_submission.time."


def run_code(result_id: str) -> str:
    """The 8-character code of a Share run link (apps/timetrials-web/src/short-links.ts runCode):
    the result id without `user_submission.time.` and `firebase_` / `LIVETRIAL`, letters and digits."""
    short = result_id[len(RESULT_ID_PREFIX):] if result_id.startswith(RESULT_ID_PREFIX) else result_id
    short = re.sub(r"^(?:firebase_|livetrial)", "", short, flags=re.IGNORECASE)
    return re.sub(r"[^a-z0-9]", "", short.lower())[:8]


def website_result_url(origin: str | None, track_id: str | None, cc: object, track_index: object = None,
                       result_id: str | None = None) -> str | None:
    """Where a result is on the website (ADR-0199 short forms): the track's leaderboard in that
    class, opened on the result when its id is known (`&run=<code>`), else just the leaderboard."""
    if not origin or not isinstance(track_id, str) or not track_id.startswith("track.") or str(cc) not in {"150", "200"}:
        return None
    board = (f"lb={track_index}" if isinstance(track_index, int) and not isinstance(track_index, bool)
             else f"leaderboard={track_id}")
    url = f"{origin.rstrip('/')}/?{board}&mode={cc}"
    if isinstance(result_id, str) and result_id:
        code = run_code(result_id)
        from urllib.parse import quote
        url += f"&run={code if len(code) == 8 else quote(result_id, safe='')}"
    return url


def completion_document(item: dict, match: dict, player_id: str, *, catalog, producer_version: str) -> dict | None:
    """What this ghost can tell the website about `match`, or None when it knows nothing extra."""
    g = item["ghost"]
    digest = hashlib.sha256(f"ghost|{item['id']}|{player_id}".encode("utf-8")).hexdigest()
    source_kind = "livetrial_capture" if item.get("source", "").startswith("live:") else "livetrial_recorded_video"
    context = LiveTrialSubmissionContext(
        submission_id=f"user_submission.time.LIVETRIALGHOST{digest[:48]}", revision=1, source_kind=source_kind,
        evidence=(), player_reference={"namespace": "player", "value": player_id},
        producer_version=producer_version, local_record_id=f"ghost:{item['id']}"[:128],
        created_at_ms=0, captured_at_ms=None, source_input=None)
    reading, _evidence = adapt_livetrial_ghost(g, context, catalog)   # the same mapping Mine uses
    document = {
        "schemaVersion": COMPLETION_SCHEMA,
        "expectedRevision": match["revision"],
        "trackId": reading["trackId"], "mode": reading["mode"], "totalTimeMs": reading["totalTimeMs"],
        "source": {"kind": source_kind, "producerVersion": producer_version},
        "evidence": [{"kind": "capture_session" if source_kind == "livetrial_capture" else "video",
                      "reference": f"livetrial/{digest}"}],
    }
    if reading.get("laps"):
        document["laps"] = reading["laps"]
    if reading.get("loadout"):
        document["loadout"] = reading["loadout"]
    return document if _fills_something(match, document) else None


def _fills_something(match: dict, document: dict) -> bool:
    """The server's fill rule, seen from here, so an unchanged ghost costs no request."""
    stored = match.get("loadout") if isinstance(match.get("loadout"), dict) else {}
    if any(key not in stored for key in (document.get("loadout") or {})):
        return True
    laps = document.get("laps") or []
    stored_laps = match.get("laps") if isinstance(match.get("laps"), list) else []
    if laps and not stored_laps:
        return True
    return any(key in lap and key not in (stored_laps[i] if i < len(stored_laps) else {})
               for i, lap in enumerate(laps) for key in ("coinsCollected", "mushroomsUsed"))


def complete_on_website(item: dict, account: dict, *, executor, bearer: str, decisions: GhostDecisions,
                        catalog, producer_version: str, now_ms: int, by_name: str | None = None) -> dict:
    """Add what this ghost knows to the account's matching published result.
    Records the outcome as the ghost's decision, so it is not asked twice for the same reading."""
    g = item["ghost"]
    if g.get("staffGhost"):
        _fail("A Nintendo staff ghost is never a Player's time.")
    player_id = account.get("playerId")
    if not player_id or not bearer:
        _fail("Sign in with this account first.")
    outcome, fields, match = "nothing_missing", [], None
    for _attempt in range(2):                      # a result changed meanwhile is read once more
        match = website_match(website_results(executor, player_id, bearer), g)
        if match is None:
            _fail("This time is not on the website for this account.")
        document = completion_document(item, match, player_id, catalog=catalog,
                                       producer_version=producer_version)
        if document is None:
            break
        response = executor.request(
            "POST", f"/v1/time-trial-submissions/{match['resultId']}/completions",
            json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), bearer, 4 * 1024)
        status = response.get("statusCode") if isinstance(response, dict) else None
        try:
            body = json.loads(response["body"].decode("utf-8"))
        except Exception:
            body = {}
        if status == 200:
            outcome, fields = "completed", list(body.get("completedFields") or [])
            break
        code = body.get("code") if isinstance(body, dict) else None
        if code == "time_trial_completion_revision_conflict":
            continue
        if code == "time_trial_completion_nothing_missing":
            break
        if code == "time_trial_completion_different_result":
            outcome = "website_differs"
            break
        _fail("The website could not add these details right now. Try again later.")
    else:
        _fail("Your result on the website kept changing. Try again later.")
    decision = {"decision": "completed", "outcome": outcome, "fields": fields,
                "resultId": match["resultId"], "slotId": account.get("slotId"), "atMs": now_ms,
                "richness": list(_richness(g))}
    if by_name:
        decision.update({"auto": True, "byName": by_name})
    decisions.decide(item["id"], decision)
    return decision


def _completion_candidates(items: list[dict], document: dict, slot_id: str | None, *,
                           capture_running: bool, wall_ms: int) -> list[dict]:
    """Ghosts worth asking the website about, decided without the network: carrying the active
    account's declared name and undecided, or completed earlier and seen with more data since."""
    out = []
    for item in items:
        g = item["ghost"]
        if g.get("staffGhost") or not g.get("trackId"):
            continue
        decision = document["decisions"].get(item["id"]) or {}
        if decision:
            richer = any(n and not b for n, b in zip(_richness(g), decision.get("richness") or (False, False)))
            if decision.get("decision") != "completed" or decision.get("outcome") == "website_differs" or not richer:
                continue
        elif slot_id is None or _owner_by_name(document, g.get("nameRaw") or g.get("name")) != slot_id:
            continue
        seen = g.get("lastSeenAtMs") or g.get("firstSeenAtMs") or wall_ms
        if capture_running and wall_ms - seen < SETTLE_MS:
            continue                                   # still on screen: wait for the full read
        out.append(item)
    return out


def complete_by_name(items: list[dict], *, account: dict | None, executor, bearer: str | None,
                     decisions: GhostDecisions, catalog, producer_version: str, now_ms: int,
                     capture_running: bool, wall_ms: int, published) -> list[str]:
    """Your declared name on a ghost whose exact time is already on the website: fill in that
    result (the same trust as linking by name). Also retries a completed ghost that the engine
    has since seen more of. `published()` returns the account's website results; it is only
    called when some ghost is a candidate, so an ordinary list refresh costs no request."""
    if not account or not account.get("playerId") or not bearer:
        return []
    document = decisions.load()
    candidates = _completion_candidates(items, document, account.get("slotId"),
                                        capture_running=capture_running, wall_ms=wall_ms)
    if not candidates:
        return []
    try:
        results = published()
    except LiveTrialGhostError:
        return []
    done = []
    for item in candidates:
        g = item["ghost"]
        if website_match(results, g) is None:
            continue
        decision = document["decisions"].get(item["id"]) or {}
        name = g.get("nameRaw") or g.get("name")
        try:
            complete_on_website(item, account, executor=executor, bearer=bearer, decisions=decisions,
                                catalog=catalog, producer_version=producer_version, now_ms=now_ms,
                                by_name=decision.get("byName") or name)
        except LiveTrialGhostError:
            continue
        document = decisions.load()
        done.append(item["id"])
    return done


# ADR-0212: a proven Nintendo staff or World Record ghost goes to the website by itself. It
# describes Nintendo's ghost or the public record, never the Player, so nothing is chosen on the row.
REFERENCE_READING_SCHEMA = "mk8dx.reference-ghost-reading.v1"
REFERENCE_READING_PATH = "/v1/reference-ghost-readings"
REFERENCE_LEDGER_FILE = "reference-readings-sent.json"
REFERENCE_LEDGER_FORMAT = "mk8dx.reference-readings-sent.v1"
REFERENCE_LEDGER_LIMIT = 2000
# A World Record the website does not (yet) hold as current is offered again after this long:
# its daily import may still be behind the game.
REFERENCE_RETRY_MS = 6 * 60 * 60 * 1000
_PART_KEYS = ("characterId", "bodyId", "tireId", "gliderId")


def _int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _events(value, laps: int) -> dict | None:
    if not isinstance(value, dict) or value.get("status") != "available" or value.get("timeBase") != "race_elapsed_ms":
        return None
    coins, mushrooms = value.get("coinEvents"), value.get("mushroomEvents")
    if not isinstance(coins, list) or not isinstance(mushrooms, list) or len(coins) > 400 or len(mushrooms) > 3:
        return None
    try:
        return {
            "status": "available", "timeBase": "race_elapsed_ms",
            "coinEvents": [{"raceMs": e["raceMs"], "lap": e["lap"], "from": e["from"], "to": e["to"]} for e in coins
                           if all(_int(e.get(k)) for k in ("raceMs", "lap", "from", "to")) and 1 <= e["lap"] <= laps],
            "mushroomEvents": [{"raceMs": e["raceMs"], "lap": e["lap"]} for e in mushrooms
                               if _int(e.get("raceMs")) and _int(e.get("lap")) and 1 <= e["lap"] <= laps],
        }
    except (AttributeError, TypeError):
        return None


def reference_reading(item: dict, world_records: dict | None) -> dict | None:
    """The reading the website takes for a proven staff or World Record ghost, or None.
    Staff: the engine matched track, class, total, name and kart setup (``staffGhost``).
    World Record: the total equals the record this PC last read from the website."""
    g = item["ghost"]
    track_id, cc, total = g.get("trackId"), str(g.get("cc")), g.get("totalMs")
    laps = g.get("lapTimesMs")
    if not isinstance(track_id, str) or cc not in ("150", "200") or not _int(total) \
            or not g.get("lapSumOk") or not isinstance(laps, list) or not 3 <= len(laps) <= 7 \
            or not all(_int(lap) and lap > 0 for lap in laps) or sum(laps) != total:
        return None
    if g.get("staffGhost"):
        kind = "nintendo_staff"
    else:
        wr = (world_records or {}).get(f"{track_id}|{cc}") or {}
        if not (_int(wr.get("timeMs")) and wr["timeMs"] == total):
            return None
        kind = "world_record"
    name = str(g.get("name") or g.get("nameRaw") or "").strip()[:64]
    if not name:
        return None
    document = {"schemaVersion": REFERENCE_READING_SCHEMA, "kind": kind, "trackId": track_id, "mode": int(cc),
                "totalTimeMs": total, "observedName": name, "lapTimesMs": list(laps)}
    country = g.get("countryId")
    if isinstance(country, str) and re.fullmatch(r"country\.[a-z0-9_]{2,40}", country):
        document["countryId"] = country
    parts = {k: g.get(k) for k in _PART_KEYS}
    if all(isinstance(v, str) and v for v in parts.values()):
        document["loadout"] = parts
    elif kind == "nintendo_staff":
        return None                                   # the website proves staff by its kart setup
    replay = g.get("replay") if isinstance(g.get("replay"), dict) else {}
    coins, used = replay.get("coinCountsPerLap"), replay.get("mushroomsPerLap")
    if isinstance(coins, list) and isinstance(used, list) and len(coins) == len(laps) == len(used) \
            and all(_int(c) and 0 <= c <= 10 for c in coins) and all(_int(m) and 0 <= m <= 3 for m in used) \
            and sum(used) <= 3:
        document["coinsPerLap"], document["mushroomsPerLap"] = list(coins), list(used)
        events = _events(replay.get("events"), len(laps))
        if events is not None:
            document["events"] = events
    return document


def reading_fingerprint(document: dict) -> str:
    """Same reading, same fingerprint: a richer read later (a replay) is a new one to send."""
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class ReferenceReadingLedger:
    """Which readings the website already answered, kept beside the local data."""

    def __init__(self, data_root: str | Path) -> None:
        self._path = Path(data_root) / REFERENCE_LEDGER_FILE

    def load(self) -> dict:
        try:
            if self._path.is_file() and not self._path.is_symlink() and self._path.stat().st_size <= MAX_GHOSTS_FILE_BYTES:
                document = json.loads(self._path.read_text(encoding="utf-8"))
                if isinstance(document, dict) and document.get("format") == REFERENCE_LEDGER_FORMAT \
                        and isinstance(document.get("sent"), dict):
                    return document
        except (OSError, ValueError):
            pass
        return {"format": REFERENCE_LEDGER_FORMAT, "sent": {}}

    def save(self, document: dict) -> None:
        sent = document["sent"]
        if len(sent) > REFERENCE_LEDGER_LIMIT:
            keep = sorted(sent.items(), key=lambda kv: kv[1].get("atMs") or 0)[-REFERENCE_LEDGER_LIMIT:]
            document["sent"] = dict(keep)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(document, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self._path)


def _due(entry: dict | None, now_ms: int) -> bool:
    if entry is None:
        return True
    return entry.get("outcome") == "not_current" and now_ms - int(entry.get("atMs") or 0) >= REFERENCE_RETRY_MS


def send_reference_readings(items: list[dict], *, world_records: dict | None, executor, bearer: str | None,
                            ledger: ReferenceReadingLedger, now_ms: int, capture_running: bool,
                            wall_ms: int) -> list[dict]:
    """Send every proven staff and World Record reading the website has not answered yet.
    Stops at the first network or sign-in failure; the rest waits for the next round."""
    if not bearer:
        return []
    document = ledger.load()
    done = []
    for item in items:
        g = item["ghost"]
        seen = g.get("lastSeenAtMs") or g.get("firstSeenAtMs") or wall_ms
        if capture_running and wall_ms - seen < SETTLE_MS:
            continue                                   # still on screen: wait for the full read
        reading = reference_reading(item, world_records)
        if reading is None:
            continue
        fingerprint = reading_fingerprint(reading)
        if not _due(document["sent"].get(fingerprint), now_ms):
            continue
        try:
            response = executor.request(
                "POST", REFERENCE_READING_PATH,
                json.dumps(reading, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), bearer, 4 * 1024)
        except Exception:
            break
        status = response.get("statusCode") if isinstance(response, dict) else None
        try:
            body = json.loads(response["body"].decode("utf-8"))
        except Exception:
            body = {}
        code = body.get("code") if isinstance(body, dict) else None
        if status == 200 and isinstance(body, dict) and body.get("outcome") in ("recorded", "completed", "confirmed", "conflict"):
            outcome = body["outcome"]
        elif status == 409 and code == "reference_ghost_not_a_reference":
            outcome = "not_current" if reading["kind"] == "world_record" else "not_a_reference"
        elif status == 400:
            outcome = "refused"                        # this reading will never be taken; do not repeat it
        else:
            break                                      # signed out, rate limited or unavailable: later
        document["sent"][fingerprint] = {"outcome": outcome, "kind": reading["kind"], "trackId": reading["trackId"],
                                         "mode": reading["mode"], "totalTimeMs": reading["totalTimeMs"], "atMs": now_ms}
        done.append({"id": item["id"], "kind": reading["kind"], "outcome": outcome})
    if done:
        ledger.save(document)
    return done


def undo_auto_link(gid: str, *, outbox, decisions: GhostDecisions, latest_by_entry: dict, now_ms: int) -> None:
    """Undo a link made because of a declared name, while it has not been sent."""
    document = decisions.load()
    decision = document["decisions"].get(gid) or {}
    if decision.get("decision") != "mine" or not decision.get("auto"):
        _fail("Only a ghost linked by your name can be undone here.")
    record = latest_by_entry.get(decision.get("entryKey"))
    if record is None or record["state"]["state"] != "pending":
        _fail("It was already sent; retire it on the website instead.")
    outbox.mark_failed(record["entry"]["entryKey"], record["state"]["stateRevision"], now_ms, GHOST_UNDONE)
    document["decisions"][gid] = {"decision": "not_mine", "undoneAtMs": now_ms, "undoneFrom": decision}
    decisions.save(document)


def export_document(items: list[dict]) -> dict:
    """What the Player may share: the ghosts as the game showed them."""
    keep = ("trackId", "cc", "total", "totalMs", "name", "countryId", "characterId", "state",
            "lapTimes", "lapTimesMs", "bodyId", "tireId", "gliderId", "staffGhost", "worldRecord",
            "firstSeenAtMs")
    ghosts = []
    for item in items:
        g = item["ghost"]
        out = {k: deepcopy(g[k]) for k in keep if g.get(k) is not None}
        if isinstance(g.get("replay"), dict):
            out["replay"] = {k: deepcopy(g["replay"][k]) for k in (
                "coinCountsPerLap", "coinBalanceAtLapEnd", "mushroomsPerLap", "events") if k in g["replay"]}
        ghosts.append(out)
    return {"format": EXPORT_FORMAT, "ghosts": ghosts}
