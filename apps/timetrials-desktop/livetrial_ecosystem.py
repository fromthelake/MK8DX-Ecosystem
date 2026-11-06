"""Authenticated canonical Player progress with an owner-local offline cache.

LiveTrial capture stays local-first. This read companion asks the same bounded
Home bootstrap as web and Android only when a person opens Player progress,
then atomically caches the public/product document without ever caching a
bearer token.
"""

from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Callable
from urllib.parse import quote
import re

from livetrial_https import (
    ECOSYSTEM_BOOTSTRAP_PATH,
    MAX_ECOSYSTEM_RESPONSE_BYTES,
    PLAYER_ACTIVITY_PATH,
    PLAYER_INSIGHTS_PATH,
    LiveTrialHttpsExecutor,
)
import livetrial_mastery_thresholds as _mastery_thresholds
from livetrial_mastery_thresholds import (
    TIER_LABELS,
    apply_world_record_mastery_baseline,
    track_mastery_label,
    track_mastery_ladder,
    track_mastery_tier,
)


CACHE_SCHEMA_VERSION = "mk8dx.livetrial-ecosystem-cache.v1"
CACHE_NAME = "ecosystem-cache.json"
MAX_CACHE_BYTES = 3 * 1024 * 1024
PLAYER_ID_PATTERN = re.compile(r"^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")
NINTENDO_STAFF_REFERENCE_ID = "reference.nintendo_staff"
WORLD_RECORD_REFERENCE_ID = "reference.world_record"


class LiveTrialEcosystemError(RuntimeError):
    """Bounded canonical-read/cache failure without credentials or paths."""


UNPLAYED_TRACK_MS = 600_000


def _overall_mastery(bests_by_track: dict[str, int], mode: int) -> dict:
    """Overall Mastery exactly as Web's My records: every track counts, an
    unplayed one at the 10-minute fallback, against the per-tier sum of the
    current (World-Record-derived when known) track thresholds."""
    rows = _mastery_thresholds.TRACK_THRESHOLDS
    total_ms = sum(bests_by_track.get(track_id, UNPLAYED_TRACK_MS) for track_id in rows)
    thresholds = [sum(row[str(mode)][tier] for row in rows.values()) for tier in range(len(TIER_LABELS))]
    tier = next((index for index, limit in enumerate(thresholds) if total_ms <= limit), len(thresholds) - 1)
    return {
        "label": TIER_LABELS[tier],
        "nextLabel": TIER_LABELS[tier - 1] if tier > 0 else None,
        "improveByMs": max(0, total_ms - thresholds[tier - 1]) if tier > 0 else None,
        "totalMs": total_ms,
    }


def _fail() -> None:
    raise LiveTrialEcosystemError("LiveTrial Player progress is unavailable.") from None


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _get_json(executor: object, path: str, bearer: object) -> dict | None:
    response = executor.request("GET", path, None, bearer, MAX_ECOSYSTEM_RESPONSE_BYTES)
    if not isinstance(response, dict) or response.get("statusCode") != 200:
        return None
    document = json.loads(response["body"].decode("utf-8"))
    return document if isinstance(document, dict) else None


def _my_records_sources(executor: object, player_id: str, bearer: object) -> dict:
    """The documents Web's My records draws on, trimmed to what the page shows.
    Each is optional: a failure leaves that part of the page out."""
    sources: dict = {}
    try:
        insights = _get_json(executor, PLAYER_INSIGHTS_PATH, bearer)
        trials = insights.get("timeTrials") if isinstance(insights, dict) else None
        if (isinstance(insights, dict) and insights.get("schemaVersion") == "mk8dx.player-insights.v1"
                and insights.get("playerId") == player_id and isinstance(trials, dict)):
            sources["playerInsights"] = {
                "submissionCount": trials.get("submissionCount") if _is_int(trials.get("submissionCount")) else 0,
                "personalBests": [
                    {"trackId": row["trackId"], "mode": row["modeCC"],
                     "bestTimeMs": row["bestTimeMs"], "attemptCount": row["attemptCount"]}
                    for row in trials.get("personalBests", []) if isinstance(row, dict)
                    and isinstance(row.get("trackId"), str) and row.get("modeCC") in {150, 200}
                    and _is_int(row.get("bestTimeMs")) and _is_int(row.get("attemptCount"))
                ],
                "tournaments": {
                    key: value for key, value in (insights.get("tournaments") or {}).items()
                    if key in {"raceCount", "countedRaceCount", "wins", "podiums", "countedFinishPositionTotal"}
                    and _is_int(value)
                },
            }
    except Exception:
        pass
    try:
        activity = _get_json(executor, PLAYER_ACTIVITY_PATH, bearer)
        if isinstance(activity, dict) and activity.get("schemaVersion") == "mk8dx.player-activity.v1":
            sources["playerActivity"] = [
                {"trackId": run["trackId"], "mode": run["modeCC"], "totalTimeMs": run["totalTimeMs"],
                 "atMs": run["occurredAtMs"] if _is_int(run.get("occurredAtMs")) else run["createdAtMs"]}
                for run in activity.get("timeTrials", [])[:100] if isinstance(run, dict)
                and isinstance(run.get("trackId"), str) and run.get("modeCC") in {150, 200}
                and _is_int(run.get("totalTimeMs")) and _is_int(run.get("createdAtMs"))
            ]
    except Exception:
        pass
    encoded = quote(player_id, safe="")
    try:
        results = _get_json(executor, f"/v1/public/players/{encoded}/time-trials", bearer)
        if isinstance(results, dict) and isinstance(results.get("results"), list):
            loadout_keys = {"characterId", "characterVariantId", "bodyId", "bodyVariantId", "tireId", "gliderId", "gliderVariantId"}
            sources["playerResults"] = [
                {"trackId": row["trackId"], "mode": row["mode"], "totalTimeMs": row["totalTimeMs"],
                 "resultAtMs": row["resultAtMs"],
                 "loadout": {key: value for key, value in row["loadout"].items() if key in loadout_keys and isinstance(value, str)}
                 if isinstance(row.get("loadout"), dict) else None}
                for row in results["results"][:200] if isinstance(row, dict) and row.get("playerId") == player_id
                and isinstance(row.get("trackId"), str) and row.get("mode") in {150, 200}
                and _is_int(row.get("totalTimeMs")) and _is_int(row.get("resultAtMs"))
            ]
    except Exception:
        pass
    try:
        history = _get_json(executor, f"/v1/public/players/{encoded}/rating-history", bearer)
        if isinstance(history, dict) and history.get("schemaVersion") == "mk8dx.public-rating-history.v1":
            sources["ratingHistory"] = [
                {"sequence": point["sequence"], "tournamentNumber": point["tournamentNumber"],
                 "sectionLabel": point.get("sectionLabel") if isinstance(point.get("sectionLabel"), str) else "",
                 "raceIndex": point.get("raceIndex") if _is_int(point.get("raceIndex")) else 0,
                 "finishPosition": point.get("finishPosition") if _is_int(point.get("finishPosition")) else 0,
                 "score": float(point["score"])}
                for point in history.get("points", [])[:2000] if isinstance(point, dict)
                and _is_int(point.get("sequence")) and _is_int(point.get("tournamentNumber"))
                and isinstance(point.get("score"), (int, float)) and not isinstance(point.get("score"), bool)
            ]
    except Exception:
        pass
    return sources


def _favourite_combo(results: list, mode: int) -> dict | None:
    """The combo most of your published runs at this engine were driven with (Web's rule)."""
    counts: dict[tuple, dict] = {}
    with_loadout = [row for row in results if row.get("mode") == mode and isinstance(row.get("loadout"), dict) and row["loadout"]]
    for row in with_loadout:
        loadout = row["loadout"]
        key = tuple(loadout.get(name) for name in ("characterId", "bodyId", "tireId", "gliderId"))
        entry = counts.setdefault(key, {"runs": 0, "loadout": loadout})
        entry["runs"] += 1
    if not counts:
        return None
    top = max(counts.values(), key=lambda entry: entry["runs"])
    return {"loadout": top["loadout"], "runs": top["runs"], "of": len(with_loadout)}


def _my_records(bootstrap: dict, mine: list, focus_rows: list, player_id: str, track_catalog: dict | None) -> dict:
    """Web's My records model: every track per engine, raced or not, with Mastery,
    the next level, your rank, attempts and when the record was set."""
    catalog = track_catalog if isinstance(track_catalog, dict) else {}
    thresholds = _mastery_thresholds.TRACK_THRESHOLDS
    order = [track_id for track_id in catalog if track_id in thresholds]
    order += [track_id for track_id in thresholds if track_id not in order]
    insights = bootstrap.get("playerInsights") if isinstance(bootstrap.get("playerInsights"), dict) else None
    bests: dict[tuple[str, int], dict] = {}
    if insights is not None:
        for row in insights.get("personalBests", []):
            bests[(row["trackId"], row["mode"])] = {"timeMs": row["bestTimeMs"], "attempts": row["attemptCount"]}
    else:
        for row in mine:
            if isinstance(row, dict) and isinstance(row.get("trackId"), str) and row.get("mode") in {150, 200} \
                    and _is_int(row.get("totalTimeMs")):
                bests[(row["trackId"], row["mode"])] = {"timeMs": row["totalTimeMs"], "attempts": None}
    board_rank = {(row.get("trackId"), row.get("mode")): row.get("rank") for row in mine if isinstance(row, dict)}
    focus_by = {(row.get("trackId"), row.get("mode")): row for row in focus_rows if isinstance(row, dict)}
    results = bootstrap.get("playerResults") if isinstance(bootstrap.get("playerResults"), list) else []
    standings = [row for row in bootstrap.get("rankStandings", []) if isinstance(row, dict)]
    modes = {}
    for mode in (150, 200):
        cards = []
        for track_id in order:
            record = catalog.get(track_id) if isinstance(catalog.get(track_id), dict) else {}
            card = {**_track_view(track_id, catalog), "cupId": record.get("cupId"), "cupName": record.get("cupName")}
            best = bests.get((track_id, mode))
            if best is not None:
                time_ms = best["timeMs"]
                ladder = track_mastery_ladder(track_id, mode) or []
                tier = track_mastery_tier(track_id, mode, time_ms)
                tier = len(TIER_LABELS) - 1 if tier is None else tier
                focus = focus_by.get((track_id, mode)) or {}
                rank = focus.get("myRank") if _is_int(focus.get("myRank")) else board_rank.get((track_id, mode))
                set_at = [row["resultAtMs"] for row in results
                          if row.get("trackId") == track_id and row.get("mode") == mode and row.get("totalTimeMs") == time_ms]
                card["best"] = {
                    "timeMs": time_ms, "attempts": best["attempts"], "tier": tier, "label": TIER_LABELS[tier],
                    "nextLabel": TIER_LABELS[tier - 1] if tier > 0 and len(ladder) >= tier else None,
                    "gapMs": max(0, time_ms - ladder[tier - 1]) if tier > 0 and len(ladder) >= tier else None,
                    "rank": rank if _is_int(rank) and rank > 0 else None,
                    "field": focus.get("humanCount") if _is_int(focus.get("humanCount")) else None,
                    "leaderMs": focus.get("leaderBestMs") if _is_int(focus.get("leaderBestMs")) else None,
                    "setAtMs": min(set_at) if set_at else None,
                }
            cards.append(card)
        field = [row for row in standings if row.get("mode") == mode]
        own = next((row for row in field if row.get("playerId") == player_id), None)
        modes[str(mode)] = {
            "cards": cards,
            "standing": None if own is None else {
                "rank": own.get("rank"), "of": len(field), "totalMs": own.get("totalTimeMs"),
            },
            "combo": _favourite_combo(results, mode),
            "attempts": sum(row["attempts"] or 0 for key, row in bests.items() if key[1] == mode),
            "cells": sum(1 for key in bests if key[1] == mode),
        }
    return {
        "detailed": insights is not None,
        "submissionCount": insights.get("submissionCount") if insights is not None else None,
        "modes": modes,
        "runs": bootstrap.get("playerActivity") if isinstance(bootstrap.get("playerActivity"), list) else None,
        "tournaments": insights.get("tournaments") if insights is not None else None,
        "ratingHistory": bootstrap.get("ratingHistory") if isinstance(bootstrap.get("ratingHistory"), list) else [],
    }


def _unique(pairs: list[tuple[str, object]]) -> dict:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _decode_response(response: object, player_id: str) -> dict:
    try:
        if (
            not isinstance(response, dict)
            or set(response) != {"statusCode", "contentType", "body"}
            or response["statusCode"] != 200
            or not isinstance(response["contentType"], str)
            or not response["contentType"].lower().startswith("application/json")
            or not isinstance(response["body"], bytes)
            or not 1 <= len(response["body"]) <= MAX_ECOSYSTEM_RESPONSE_BYTES
        ):
            _fail()
        document = json.loads(
            response["body"].decode("utf-8"),
            object_pairs_hook=_unique,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()),
        )
        comeback = document.get("comeback")
        player = comeback.get("player") if isinstance(comeback, dict) else None
        if (
            not isinstance(document, dict)
            or document.get("schemaVersion") != "mk8dx.home-bootstrap.v1"
            or document.get("authenticated") is not True
            or not isinstance(player, dict)
            or player.get("playerId") != player_id
            or not isinstance(player.get("displayName"), str)
            or not isinstance(document.get("focus"), dict)
            or not isinstance(document.get("trackBests"), dict)
        ):
            _fail()
        return document
    except LiveTrialEcosystemError:
        raise
    except Exception:
        _fail()


def _cache_document(player_id: str, fetched_at_ms: int, bootstrap: dict) -> dict:
    if (
        not isinstance(player_id, str)
        or not player_id.startswith("player.")
        or not isinstance(fetched_at_ms, int)
        or isinstance(fetched_at_ms, bool)
        or fetched_at_ms < 0
    ):
        _fail()
    return {
        "schemaVersion": CACHE_SCHEMA_VERSION,
        "playerId": player_id,
        "fetchedAtMs": fetched_at_ms,
        "bootstrap": deepcopy(bootstrap),
    }


def _write_cache(path: Path, document: dict) -> None:
    temporary: Path | None = None
    try:
        payload = json.dumps(
            document,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
            allow_nan=False,
        ).encode("utf-8")
        if not 1 <= len(payload) <= MAX_CACHE_BYTES:
            _fail()
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(prefix=".ecosystem-", suffix=".tmp", dir=path.parent)
        temporary = Path(name)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except LiveTrialEcosystemError:
        raise
    except Exception:
        _fail()
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except OSError:
                pass


def load_cached_progress(data_root: str | Path, player_id: str) -> dict | None:
    try:
        path = Path(data_root) / CACHE_NAME
        if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_CACHE_BYTES:
            return None
        document = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_unique)
        if (
            not isinstance(document, dict)
            or set(document) != {"schemaVersion", "playerId", "fetchedAtMs", "bootstrap"}
            or document.get("schemaVersion") != CACHE_SCHEMA_VERSION
            or document.get("playerId") != player_id
            or not isinstance(document.get("fetchedAtMs"), int)
            or not isinstance(document.get("bootstrap"), dict)
        ):
            return None
        return document
    except Exception:
        return None


def refresh_player_progress(
    data_root: str | Path,
    player_id: str,
    session_store: object,
    api_origin: str,
    clock_ms: Callable[[], int] = lambda: time.time_ns() // 1_000_000,
    https_factory: Callable[[str], object] = LiveTrialHttpsExecutor,
) -> dict:
    try:
        now_ms = clock_ms()
        session = session_store.load(now_ms)
        if not isinstance(session, dict) or session.get("playerId") != player_id:
            _fail()
        executor = https_factory(api_origin)
        response = executor.request(
            "GET",
            ECOSYSTEM_BOOTSTRAP_PATH,
            None,
            session.get("bearerToken"),
            MAX_ECOSYSTEM_RESPONSE_BYTES,
        )
        bootstrap = _decode_response(response, player_id)
        try:
            profile_response = executor.request(
                "GET", f"/v1/players/{quote(player_id, safe='')}", None,
                session.get("bearerToken"), MAX_ECOSYSTEM_RESPONSE_BYTES,
            )
            profile = json.loads(profile_response["body"].decode("utf-8")) if profile_response.get("statusCode") == 200 else {}
            if profile.get("playerId") == player_id:
                bootstrap["publicPlayerProfile"] = profile
        except Exception:
            pass
        # Mastery follows the latest complete central 96+96 WR snapshot. A
        # missing/empty/malformed response leaves the packaged safe baseline.
        try:
            wr_response = executor.request(
                "GET", "/v1/public/world-records", None,
                session.get("bearerToken"), MAX_ECOSYSTEM_RESPONSE_BYTES,
            )
            if wr_response.get("statusCode") == 200:
                wr_document = json.loads(wr_response["body"].decode("utf-8"))
                if wr_document.get("schemaVersion") == "mk8dx.world-records.v1":
                    apply_world_record_mastery_baseline(wr_document.get("records", []))
                    if len(wr_document.get("records", [])) == 192:
                        bootstrap["worldRecords"] = wr_document["records"]
        except Exception:
            pass
        try:
            standings = []
            for mode in (150, 200):
                standing_response = executor.request("GET", f"/v1/public/time-trial-standings?mode={mode}", None, session.get("bearerToken"), MAX_ECOSYSTEM_RESPONSE_BYTES)
                standing_document = json.loads(standing_response["body"].decode("utf-8")) if standing_response.get("statusCode") == 200 else {}
                if standing_document.get("schemaVersion") != "mk8dx.public-time-trial-standings.v1":
                    raise ValueError
                standings.extend(standing_document.get("standings", []))
            bootstrap["rankStandings"] = standings
        except Exception:
            pass
        try:
            group_response = executor.request("GET", "/v1/account/groups", None, session.get("bearerToken"), MAX_ECOSYSTEM_RESPONSE_BYTES)
            group_document = json.loads(group_response["body"].decode("utf-8")) if group_response.get("statusCode") == 200 else {}
            if group_document.get("schemaVersion") == "mk8dx.social-groups.v1":
                bootstrap["socialGroups"] = group_document
                preference = group_document.get("rankScope", {})
                selected = set(preference.get("groupIds", [])) if isinstance(preference, dict) else set()
                group_players = {
                    member.get("playerId")
                    for group in group_document.get("groups", []) if isinstance(group, dict) and group.get("groupId") in selected
                    for member in group.get("members", []) if isinstance(member, dict) and member.get("status") == "active"
                }
                wanted = sorted(value for value in group_players if isinstance(value, str))[:10]
                if wanted:
                    path = "/v1/public/track-bests?players=" + ",".join(quote(value, safe="") for value in wanted)
                    best_response = executor.request("GET", path, None, session.get("bearerToken"), MAX_ECOSYSTEM_RESPONSE_BYTES)
                    best_document = json.loads(best_response["body"].decode("utf-8")) if best_response.get("statusCode") == 200 else {}
                    if best_document.get("schemaVersion") == "mk8dx.public-track-bests.v1":
                        existing = {row.get("playerId"): row for row in bootstrap["trackBests"].get("players", []) if isinstance(row, dict)}
                        existing.update({row.get("playerId"): row for row in best_document.get("players", []) if isinstance(row, dict)})
                        bootstrap["trackBests"]["players"] = list(existing.values())
        except Exception:
            pass
        bootstrap.update(_my_records_sources(executor, player_id, session.get("bearerToken")))
        document = _cache_document(player_id, now_ms, bootstrap)
        _write_cache(Path(data_root) / CACHE_NAME, document)
        return document
    except LiveTrialEcosystemError:
        raise
    except Exception:
        _fail()


def fetch_rank_comparison(
    session_store: object | None,
    api_origin: str,
    query: str = "",
    player_ids: tuple[str, ...] = (),
    track_catalog: dict | None = None,
    clock_ms: Callable[[], int] = lambda: time.time_ns() // 1_000_000,
    https_factory: Callable[[str], object] = LiveTrialHttpsExecutor,
) -> dict:
    """Bounded loopback Rank lookup without returning the bearer session."""
    clean_query = query.strip()
    wanted = tuple(dict.fromkeys(player_ids))
    if ((clean_query and not 2 <= len(clean_query) <= 64) or len(wanted) > 5 or
            any(PLAYER_ID_PATTERN.fullmatch(value) is None for value in wanted) or
            (not clean_query and not wanted)):
        _fail()
    try:
        session = session_store.load(clock_ms()) if session_store is not None else None
        bearer = session.get("bearerToken") if isinstance(session, dict) else None
        executor = https_factory(api_origin)
        result: dict = {"players": [], "perTrack": []}
        if clean_query:
            response = executor.request(
                "GET", f"/v1/public/player-directory?query={quote(clean_query, safe='')}",
                None, bearer, MAX_ECOSYSTEM_RESPONSE_BYTES,
            )
            document = json.loads(response["body"].decode("utf-8")) if response.get("statusCode") == 200 else {}
            if document.get("schemaVersion") != "mk8dx.player-directory.v1" or not isinstance(document.get("players"), list):
                _fail()
            result["players"] = [
                {"playerId": row["playerId"], "displayName": row["displayName"]}
                for row in document["players"][:20]
                if isinstance(row, dict) and isinstance(row.get("playerId"), str)
                and PLAYER_ID_PATTERN.fullmatch(row["playerId"]) is not None
                and isinstance(row.get("displayName"), str)
            ]
        if wanted:
            response = executor.request(
                "GET", "/v1/public/track-bests?players=" + ",".join(quote(value, safe="") for value in wanted),
                None, bearer, MAX_ECOSYSTEM_RESPONSE_BYTES,
            )
            document = json.loads(response["body"].decode("utf-8")) if response.get("statusCode") == 200 else {}
            if document.get("schemaVersion") != "mk8dx.public-track-bests.v1" or not isinstance(document.get("players"), list):
                _fail()
            per_track: dict[tuple[str, int], dict] = {}
            for player in document["players"]:
                player_id = player.get("playerId") if isinstance(player, dict) else None
                if player_id not in wanted or not isinstance(player.get("bests"), list):
                    continue
                for best in player["bests"]:
                    if not isinstance(best, dict):
                        continue
                    track_id, mode, total = best.get("trackId"), best.get("mode"), best.get("totalTimeMs")
                    if not isinstance(track_id, str) or mode not in {150, 200} or not isinstance(total, int) or total <= 0:
                        continue
                    key = (track_id, mode)
                    row = per_track.setdefault(key, {**_track_view(track_id, track_catalog), "mode": mode, "players": []})
                    row["players"].append({"playerId": player_id, "timeMs": total, "mastery": track_mastery_label(track_id, mode, total)})
            result["perTrack"] = sorted(per_track.values(), key=lambda row: (row["mode"], row["trackName"]))
        return result
    except LiveTrialEcosystemError:
        raise
    except Exception:
        _fail()


def _reference_per_track(track_catalog: dict | None, world_records: list | None) -> list[dict]:
    catalog = track_catalog if isinstance(track_catalog, dict) else {}
    records = world_records if isinstance(world_records, list) else []
    world_by_key = {
        (row.get("trackId"), row.get("mode")): row
        for row in records if isinstance(row, dict) and row.get("mode") in {150, 200}
        and isinstance(row.get("trackId"), str) and isinstance(row.get("totalTimeMs"), int)
    }
    rows = []
    for track_id, track in catalog.items():
        if not isinstance(track_id, str) or not track_id.startswith("track.") or not isinstance(track, dict):
            continue
        staff = track.get("nintendoStaff") if isinstance(track.get("nintendoStaff"), dict) else {}
        for mode in (150, 200):
            players = []
            staff_row = staff.get(str(mode)) if isinstance(staff, dict) else None
            if isinstance(staff_row, dict) and isinstance(staff_row.get("timeMs"), int):
                total = staff_row["timeMs"]
                players.append({"playerId": NINTENDO_STAFF_REFERENCE_ID, "displayName": "Nintendo Ghost",
                                "timeMs": total, "rank": 1,
                                "mastery": track_mastery_label(track_id, mode, total)})
            wr = world_by_key.get((track_id, mode))
            if isinstance(wr, dict):
                total = wr["totalTimeMs"]
                players.append({"playerId": WORLD_RECORD_REFERENCE_ID, "displayName": "World Record",
                                "timeMs": total, "rank": 1,
                                "mastery": track_mastery_label(track_id, mode, total)})
            if players:
                rows.append({**_track_view(track_id, catalog), "mode": mode, "players": players})
    return sorted(rows, key=lambda row: (row["mode"], row["trackName"]))


def public_rank_view(
    api_origin: str,
    track_catalog: dict | None = None,
    https_factory: Callable[[str], object] = LiveTrialHttpsExecutor,
) -> dict:
    """Credential-free Rank projection; public reads never refresh external WR sources."""
    try:
        executor = https_factory(api_origin)
        standings = []
        for mode in (150, 200):
            response = executor.request("GET", f"/v1/public/time-trial-standings?mode={mode}", None, None, MAX_ECOSYSTEM_RESPONSE_BYTES)
            document = json.loads(response["body"].decode("utf-8")) if response.get("statusCode") == 200 else {}
            if document.get("schemaVersion") != "mk8dx.public-time-trial-standings.v1":
                _fail()
            standings.extend(document.get("standings", []))
        response = executor.request("GET", "/v1/public/world-records", None, None, MAX_ECOSYSTEM_RESPONSE_BYTES)
        wr_document = json.loads(response["body"].decode("utf-8")) if response.get("statusCode") == 200 else {}
        world_records = wr_document.get("records", []) if wr_document.get("schemaVersion") == "mk8dx.world-records.v1" else []
        references = _reference_per_track(track_catalog, world_records)
        modes = []
        for mode in (150, 200):
            counts = {label: 0 for label in TIER_LABELS}
            for row in references:
                if row["mode"] != mode:
                    continue
                staff = next((player for player in row["players"] if player["playerId"] == NINTENDO_STAFF_REFERENCE_ID), None)
                if staff is not None and staff.get("mastery") in counts:
                    counts[staff["mastery"]] += 1
            modes.append({"mode": mode, "driven": sum(counts.values()), "totalMs": 0,
                          "mastery": [{"label": label, "count": counts[label]} for label in TIER_LABELS]})
        return {
            "schemaVersion": "mk8dx.livetrial-progress-view.v1",
            "fetchedAtMs": int(time.time() * 1000),
            "player": {"playerId": NINTENDO_STAFF_REFERENCE_ID, "displayName": "Nintendo Ghost"},
            "standing": {"rank": None, "of": len([row for row in standings if row.get("mode") == 150]),
                         "totalMs": None, "averageMs": None},
            "publishedBests": 0, "modes": modes,
            "focus": {"lowestMastery": None, "closestGap": None, "biggestGap": None, "closestRival": None},
            "rivals": [], "rivalBattleCount": 0, "rivalBattles": [], "rankPlayers": [],
            "globalStandings": standings,
            "rankScopes": {"preference": {"global": True, "rivals": False, "groupIds": []}, "groups": []},
            "perTrack": references, "worldRecords": world_records, "activity": [],
            "notifications": [], "unreadNotificationCount": 0,
        }
    except LiveTrialEcosystemError:
        raise
    except Exception:
        _fail()


def _track_view(track_id: object, track_catalog: dict | None = None) -> dict:
    if not isinstance(track_id, str) or not track_id.startswith("track."):
        _fail()
    catalog = track_catalog or {}
    record = catalog.get(track_id) if isinstance(catalog, dict) else None
    name = record.get("name") if isinstance(record, dict) else None
    if not isinstance(name, str) or not name.strip():
        name = track_id.removeprefix("track.").replace("_", " ").title()
    return {"trackId": track_id, "trackName": name.strip()}


def _bounded_integer(value: object, minimum: int = 0) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        _fail()
    return value


def player_progress_view(cache: dict, track_catalog: dict | None = None) -> dict:
    """Build one credential-free UI projection for console and local dashboard."""
    try:
        bootstrap = cache["bootstrap"]
        comeback = bootstrap["comeback"]
        player = comeback["player"]
        time_trials = comeback.get("timeTrials") or {}
        rivals = comeback.get("rivals") or []
        focus_rows = bootstrap["focus"].get("rows") or []
        grouped = bootstrap["trackBests"].get("players") or []
        # Mastery follows the latest World Records this PC has seen, also when
        # the view is rebuilt from the offline cache (owner 2026-09-26).
        cached_records = bootstrap.get("worldRecords")
        if isinstance(cached_records, list) and len(cached_records) == 192:
            apply_world_record_mastery_baseline(cached_records)
        mine = next((row.get("bests", []) for row in grouped
                     if row.get("playerId") == player["playerId"]), [])
        if not isinstance(mine, list) or not isinstance(focus_rows, list):
            _fail()

        mode_summaries = []
        for mode in (150, 200):
            bests = [row for row in mine if row.get("mode") == mode]
            counts = {label: 0 for label in TIER_LABELS}
            total_ms = 0
            bests_by_track: dict[str, int] = {}
            strongest = None
            top3 = 0
            order = {track_id: index for index, track_id in enumerate(_mastery_thresholds.TRACK_THRESHOLDS)}
            for best in bests:
                total = _bounded_integer(best.get("totalTimeMs"), 1)
                track_id = str(best.get("trackId"))
                label = track_mastery_label(track_id, mode, total)
                if label is not None:
                    counts[label] += 1
                total_ms += total
                if track_id in order:
                    bests_by_track[track_id] = min(total, bests_by_track.get(track_id, total))
                rank = best.get("rank")
                rank = rank if isinstance(rank, int) and not isinstance(rank, bool) and rank > 0 else 99
                if rank <= 3:
                    top3 += 1
                tier = track_mastery_tier(track_id, mode, total)
                if tier is not None:
                    key = (tier, rank, order.get(track_id, len(order)))
                    if strongest is None or key < strongest[0]:
                        strongest = (key, track_id, label)
            mode_summaries.append({
                "mode": mode,
                "driven": len(bests),
                "totalMs": total_ms,
                "mastery": [
                    {"label": label, "count": counts[label]}
                    for label in TIER_LABELS
                ],
                "trackCount": len(order),
                "top3": top3,
                "overallMastery": _overall_mastery(bests_by_track, mode),
                "strongest": None if strongest is None else {
                    **_track_view(strongest[1], track_catalog), "mastery": strongest[2],
                },
            })

        mine_by_key = {
            (row.get("trackId"), row.get("mode")): row
            for row in mine
            if isinstance(row, dict)
        }
        rival_rows = []
        rival_names: dict[str, str] = {}
        seen_rivals: set[str] = set()
        for rival in rivals:
            rival_id = rival.get("playerId") if isinstance(rival, dict) else None
            if not isinstance(rival_id, str) or rival_id in seen_rivals:
                continue
            seen_rivals.add(rival_id)
            display_name = rival.get("displayName")
            if not isinstance(display_name, str) or not display_name.strip():
                display_name = "Rival"
            rival_names[rival_id] = display_name.strip()
            rival_rows.append({
                "playerId": rival_id,
                "displayName": display_name.strip(),
                "tracksAhead": _bounded_integer(rival.get("tracksAhead", 0)),
                "tracksBehind": _bounded_integer(rival.get("tracksBehind", 0)),
                "sharedCombos": _bounded_integer(rival.get("sharedCombos", 0)),
            })

        social_document = bootstrap.get("socialGroups") if isinstance(bootstrap.get("socialGroups"), dict) else {}
        groups = social_document.get("groups", []) if isinstance(social_document, dict) else []
        rank_scope = social_document.get("rankScope", {"global": True, "rivals": False, "groupIds": []}) if isinstance(social_document, dict) else {"global": True, "rivals": False, "groupIds": []}
        player_names = {player["playerId"]: str(player["displayName"]), **rival_names}
        group_views = []
        for group in groups if isinstance(groups, list) else []:
            if not isinstance(group, dict) or group.get("myStatus") != "active":
                continue
            members = []
            for member in group.get("members", []):
                if isinstance(member, dict) and member.get("status") == "active" and isinstance(member.get("playerId"), str):
                    name = member.get("displayName") if isinstance(member.get("displayName"), str) else member["playerId"]
                    player_names[member["playerId"]] = name
                    members.append(member["playerId"])
            group_views.append({"groupId": group.get("groupId"), "name": group.get("name"), "playerIds": list(dict.fromkeys(members))})

        rank_players = []
        per_track: dict[tuple[object, object], dict] = {}
        for group in grouped:
            candidate_id = group.get("playerId") if isinstance(group, dict) else None
            if not isinstance(candidate_id, str) or not isinstance(group.get("bests"), list):
                continue
            for mode in (150, 200):
                bests = [row for row in group["bests"] if isinstance(row, dict) and row.get("mode") == mode]
                by_track = {row.get("trackId"): row for row in bests if isinstance(row.get("trackId"), str)}
                total = sum(_bounded_integer(row.get("totalTimeMs"), 1) for row in by_track.values()) + (96 - len(by_track)) * 600_000
                rank_players.append({
                    "playerId": candidate_id, "displayName": player_names.get(candidate_id, candidate_id.removeprefix("player.")),
                    "mode": mode, "totalMs": total, "playedTracks": len(by_track),
                    "gold": sum(1 for row in by_track.values() if row.get("rank") == 1),
                    "silver": sum(1 for row in by_track.values() if row.get("rank") == 2),
                    "bronze": sum(1 for row in by_track.values() if row.get("rank") == 3),
                })
                for track_id, best in by_track.items():
                    key = (track_id, mode)
                    row = per_track.setdefault(key, {**_track_view(track_id, track_catalog), "mode": mode, "players": []})
                    time_ms = _bounded_integer(best.get("totalTimeMs"), 1)
                    row["players"].append({"playerId": candidate_id, "displayName": player_names.get(candidate_id, candidate_id),
                                           "timeMs": time_ms, "rank": _bounded_integer(best.get("rank", 0)),
                                           "mastery": track_mastery_label(track_id, mode, time_ms)})

        for reference in _reference_per_track(track_catalog, bootstrap.get("worldRecords", [])):
            key = (reference["trackId"], reference["mode"])
            row = per_track.setdefault(key, {**_track_view(reference["trackId"], track_catalog),
                                             "mode": reference["mode"], "players": []})
            existing = {player.get("playerId") for player in row["players"] if isinstance(player, dict)}
            row["players"].extend(player for player in reference["players"] if player.get("playerId") not in existing)

        battles = []
        seen_battles: set[tuple[str, str, object]] = set()
        for group in grouped:
            rival_id = group.get("playerId") if isinstance(group, dict) else None
            if rival_id not in rival_names or not isinstance(group.get("bests"), list):
                continue
            for rival_best in group["bests"]:
                if not isinstance(rival_best, dict):
                    continue
                key = (rival_best.get("trackId"), rival_best.get("mode"))
                my_best = mine_by_key.get(key)
                battle_key = (rival_id, key[0], key[1])
                if my_best is None or battle_key in seen_battles:
                    continue
                seen_battles.add(battle_key)
                track = _track_view(key[0], track_catalog)
                battles.append({
                    **track,
                    "mode": _bounded_integer(key[1], 1),
                    "rival": rival_names[rival_id],
                    "rivalPlayerId": rival_id,
                    "myBestMs": _bounded_integer(my_best.get("totalTimeMs"), 1),
                    "rivalBestMs": _bounded_integer(rival_best.get("totalTimeMs"), 1),
                    "deltaMs": (
                        _bounded_integer(my_best.get("totalTimeMs"), 1)
                        - _bounded_integer(rival_best.get("totalTimeMs"), 1)
                    ),
                })
        battles.sort(key=lambda row: (abs(row["deltaMs"]), row["trackName"], row["rival"]))
        # The Rank tab's engine switch: who leads where, counted per engine class
        # from the same shared bests (the rival rows above mix both classes).
        rivals_by_mode: dict[str, list[dict]] = {}
        battles_by_mode: dict[str, dict] = {}
        for mode in (150, 200):
            in_mode = [row for row in battles if row["mode"] == mode]
            rivals_by_mode[str(mode)] = [
                {
                    "playerId": row["playerId"],
                    "displayName": row["displayName"],
                    "tracksAhead": sum(1 for battle in in_mode if battle["rivalPlayerId"] == row["playerId"] and battle["deltaMs"] < 0),
                    "tracksBehind": sum(1 for battle in in_mode if battle["rivalPlayerId"] == row["playerId"] and battle["deltaMs"] > 0),
                }
                for row in rival_rows
            ]
            # Every shared comparison: the dashboard sorts them and shows twelve until "Show all".
            battles_by_mode[str(mode)] = {"count": len(in_mode), "battles": in_mode}

        focus_candidates = []
        for row in focus_rows:
            if not isinstance(row, dict):
                continue
            track = _track_view(row.get("trackId"), track_catalog)
            mode = _bounded_integer(row.get("mode"), 1)
            my_best = _bounded_integer(row.get("myBestMs"), 1)
            leader_best = _bounded_integer(row.get("leaderBestMs"), 1)
            target = row.get("above") if isinstance(row.get("above"), dict) else {}
            target_best = target.get("bestMs")
            focus_candidates.append({
                **track,
                "mode": mode,
                "myBestMs": my_best,
                "leaderBestMs": leader_best,
                "globalGapMs": max(0, my_best - leader_best),
                "targetName": target.get("displayName") if isinstance(target.get("displayName"), str) else None,
                "targetBestMs": target_best if isinstance(target_best, int) and not isinstance(target_best, bool) else None,
                "nextGapMs": (
                    max(0, my_best - target_best)
                    if isinstance(target_best, int) and not isinstance(target_best, bool)
                    else None
                ),
                "rank": _bounded_integer(row.get("myRank", 0)),
                "humanCount": _bounded_integer(row.get("humanCount", 0)),
                "mastery": track_mastery_label(track["trackId"], mode, my_best),
            })

        next_rows = [row for row in focus_candidates if row["nextGapMs"] is not None and row["nextGapMs"] > 0]
        closest_gap = min(next_rows, key=lambda row: row["nextGapMs"]) if next_rows else None
        biggest_gap = max(next_rows, key=lambda row: row["nextGapMs"]) if next_rows else None
        mastery_candidates = []
        for best in mine:
            mode = best.get("mode")
            total = best.get("totalTimeMs")
            track_id = best.get("trackId")
            if mode not in {150, 200} or not isinstance(total, int) or not isinstance(track_id, str):
                continue
            tier = track_mastery_tier(track_id, mode, total)
            if tier is None:
                continue
            ladder = track_mastery_ladder(track_id, mode)
            next_tier = tier - 1 if tier > 0 else None
            mastery_candidates.append({
                **_track_view(track_id, track_catalog),
                "mode": mode,
                "myBestMs": total,
                "mastery": TIER_LABELS[tier],
                "masteryTier": tier,
                "nextMastery": TIER_LABELS[next_tier] if next_tier is not None else None,
                "improveByMs": max(0, total - ladder[next_tier]) if next_tier is not None and ladder else None,
            })
        lowest_mastery = max(
            mastery_candidates,
            key=lambda row: (row["masteryTier"], row["myBestMs"], row["trackId"]),
            default=None,
        )
        focus_by_mode = {}
        for focus_mode in (150, 200):
            mode_next = [row for row in next_rows if row["mode"] == focus_mode]
            mode_mastery = [row for row in mastery_candidates if row["mode"] == focus_mode]
            focus_by_mode[str(focus_mode)] = {
                "lowestMastery": max(mode_mastery, key=lambda row: (row["masteryTier"], row["myBestMs"], row["trackId"]), default=None),
                "closestGap": min(mode_next, key=lambda row: row["nextGapMs"], default=None),
                "biggestGap": max(mode_next, key=lambda row: row["nextGapMs"], default=None),
            }

        stories_document = bootstrap.get("stories")
        raw_stories = stories_document.get("stories", []) if isinstance(stories_document, dict) else []
        activity = []
        for story in raw_stories[:10] if isinstance(raw_stories, list) else []:
            if not isinstance(story, dict) or not isinstance(story.get("player"), dict):
                continue
            track_id = story.get("trackId")
            mode = story.get("mode")
            best_ms = story.get("bestMs")
            latest_at = story.get("latestAtMs")
            player_name = story["player"].get("displayName")
            if (not isinstance(track_id, str) or mode not in {150, 200}
                    or not isinstance(best_ms, int) or not isinstance(latest_at, int)
                    or not isinstance(player_name, str)):
                continue
            run_details = story.get("runDetails")
            best_run = min(
                (run for run in run_details if isinstance(run, dict) and isinstance(run.get("timeMs"), int)),
                key=lambda run: run["timeMs"],
                default={},
            ) if isinstance(run_details, list) else {}
            source_kind = best_run.get("sourceKind")
            platform = "android" if isinstance(source_kind, str) and source_kind.startswith("android_") \
                else "windows" if isinstance(source_kind, str) and source_kind.startswith("livetrial_") \
                else "web" if source_kind == "web_manual" else "unknown"
            viewer = mine_by_key.get((track_id, mode))
            viewer_best = viewer.get("totalTimeMs") if isinstance(viewer, dict) else None
            rank = story.get("rank")
            activity.append({
                **_track_view(track_id, track_catalog),
                "mode": mode,
                "bestMs": best_ms,
                "latestAtMs": latest_at,
                "playerName": player_name,
                "playerId": story["player"].get("playerId"),
                "personalBest": story.get("personalBest") is True,
                "rankAfter": rank.get("after") if isinstance(rank, dict) and isinstance(rank.get("after"), int) else None,
                "platform": platform,
                "viewerBestMs": viewer_best if isinstance(viewer_best, int) else None,
                "loadout": best_run.get("loadout") if isinstance(best_run.get("loadout"), dict) else None,
            })

        notification_document = bootstrap.get("notifications")
        notifications = notification_document.get("notifications", []) if isinstance(notification_document, dict) else []
        unread_count = notification_document.get("unreadCount", 0) if isinstance(notification_document, dict) else 0
        if not isinstance(notifications, list) or not isinstance(unread_count, int):
            notifications, unread_count = [], 0

        standing = time_trials.get("standing") if isinstance(time_trials, dict) else None
        standing_of = time_trials.get("of") if isinstance(time_trials, dict) else None
        standing_total = time_trials.get("totalMs") if isinstance(time_trials, dict) else None
        for value in (standing, standing_of, standing_total):
            if value is not None:
                _bounded_integer(value)
        global_standings = [row for row in bootstrap.get("rankStandings", []) if isinstance(row, dict) and row.get("mode") in {150, 200}]

        return {
            "schemaVersion": "mk8dx.livetrial-progress-view.v1",
            "fetchedAtMs": _bounded_integer(cache.get("fetchedAtMs")),
            "player": {"playerId": str(player["playerId"]), "displayName": str(player["displayName"])},
            "standing": {
                "rank": standing,
                "of": standing_of,
                "totalMs": standing_total,
                "averageMs": round(standing_total / 96) if standing_total is not None else None,
            },
            "publishedBests": len(mine),
            "modes": mode_summaries,
            "focus": {
                "lowestMastery": lowest_mastery,
                "closestGap": closest_gap,
                "biggestGap": biggest_gap,
                "closestRival": battles[0] if battles else None,
            },
            "focusByMode": focus_by_mode,
            "modePreference": bootstrap.get("focus", {}).get("modePreference", "all"),
            "publicPlayerProfile": bootstrap.get("publicPlayerProfile", {}),
            "rivals": rival_rows,
            "myRecords": _my_records(bootstrap, mine, focus_rows, str(player["playerId"]), track_catalog),
            "rivalBattleCount": len(battles),
            "rivalBattles": battles[:12],
            "rivalsByMode": rivals_by_mode,
            "rivalBattlesByMode": battles_by_mode,
            "rankPlayers": rank_players,
            "globalStandings": global_standings,
            "rankScopes": {"preference": rank_scope, "groups": group_views},
            "perTrack": sorted(per_track.values(), key=lambda row: (row["mode"], row["trackName"])),
            "worldRecords": bootstrap.get("worldRecords", []),
            "activity": activity,
            "notifications": notifications[:30],
            "unreadNotificationCount": max(0, unread_count),
        }
    except Exception:
        _fail()


def player_progress_lines(cache: dict) -> tuple[str, ...]:
    """Compact console projection of the same model used by the dashboard."""
    view = player_progress_view(cache)
    standing = view["standing"]
    lines = [f"Player progress for {view['player']['displayName']}"]
    if standing["rank"] is not None:
        lines.append(f"  Global standing : #{standing['rank']} of {standing['of']}")
    lines.append(f"  Published bests : {view['publishedBests']} track/mode combinations")
    mode = next((row for row in view["modes"] if row["mode"] == 150), view["modes"][0])
    mastery = [row for row in mode["mastery"] if row["count"]]
    if mastery:
        lines.append("  Mastery         : " + ", ".join(
            f"{row['label']} {row['count']}" for row in mastery
        ))
    lines.append(f"  Rivals          : {len(view['rivals'])}")
    for rival in view["rivals"][:10]:
        lines.append(
            f"    {rival['displayName']} | ahead {rival['tracksAhead']}"
            f" | behind {rival['tracksBehind']}"
        )
    lowest = view["focus"]["lowestMastery"]
    if lowest is not None:
        lines.append(
            f"  Lowest Mastery  : {lowest['trackId']} {lowest['mode']}cc"
        )
        lines.append(f"    Current Mastery: {lowest['mastery']}")
    closest_gap = view["focus"]["closestGap"]
    if closest_gap is not None:
        lines.append(
            f"  Smallest gap    : {closest_gap['trackId']} {closest_gap['mode']}cc"
            + (f" vs {closest_gap['targetName']}" if closest_gap["targetName"] else "")
        )
    biggest = view["focus"]["biggestGap"]
    if biggest is not None:
        lines.append(f"  Biggest gap     : {biggest['trackId']} {biggest['mode']}cc | Global")
    lines.append(f"  Rival battles   : {view['rivalBattleCount']} shared comparisons cached")
    closest = view["focus"]["closestRival"]
    if closest is not None:
        lines.append(
            f"  Closest battle  : {closest['trackId']} {closest['mode']}cc"
            f" vs {closest['rival']} | Rival"
        )
    lines.append("  Offline cache   : refreshed safely; no sign-in token was written to it")
    return tuple(lines)
