"""The signed-in Player's published bests and rivals, handed to the engine.

The engine's local dashboard only knows the runs captured on this PC. The
wrapper already keeps a safe offline copy of the Player's canonical progress
(``livetrial_ecosystem``); this module reduces that copy to what a run card
and the Goals page need, per track and engine class, and writes it beside the
runs so the engine can serve it. No token or private detail is ever written:
only names, times and ranks that the site shows to the Player already.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile

from livetrial_ecosystem import load_cached_progress, player_progress_view

REFERENCE_FORMAT = "livetrial.reference.v1"
REFERENCE_FILE_NAME = "player-reference.json"
MAX_REFERENCE_BYTES = 512 * 1024
MAX_OTHERS_PER_TRACK = 12


class LiveTrialReferenceError(RuntimeError):
    """Bounded reference failure without paths or credentials."""


def _mastery_card(row: dict | None) -> dict | None:
    if not isinstance(row, dict) or row.get("trackId") is None:
        return None
    return {
        "kind": "mastery",
        "trackId": row["trackId"],
        "mode": row.get("mode"),
        "myBestMs": row.get("myBestMs"),
        "masteryLabel": row.get("mastery"),
        "nextMasteryLabel": row.get("nextMastery"),
        "improveByMs": row.get("improveByMs"),
    }


def _global_card(row: dict | None) -> dict | None:
    """The next human position above the Player on a track, as the site's
    Global focus shows it: the gap, their time and rank, and the Player's."""
    if not isinstance(row, dict) or row.get("trackId") is None or row.get("nextGapMs") is None:
        return None
    my_rank = row.get("rank")
    return {
        "kind": "global",
        "trackId": row["trackId"],
        "mode": row.get("mode"),
        "gapMs": row["nextGapMs"],
        "myBestMs": row.get("myBestMs"),
        "myRank": my_rank,
        "targetLabel": row.get("targetName"),
        "targetMs": row.get("targetBestMs"),
        "targetRank": (my_rank - 1) if isinstance(my_rank, int) and not isinstance(my_rank, bool) and my_rank > 1 else None,
        "humanCount": row.get("humanCount"),
    }


def _rival_cards(view: dict, player_id: str, modes: tuple[int, ...]) -> tuple[dict | None, dict | None]:
    """Closest and biggest gap to a rival who is ahead, as the site's Rivals
    focus builds them: every (my best, faster rival) pair on a track."""
    candidates = []
    for row in view.get("perTrack") or []:
        if row.get("mode") not in modes:
            continue
        players = [p for p in row.get("players") or [] if isinstance(p.get("timeMs"), int)]
        mine = next((p for p in players if p.get("playerId") == player_id), None)
        if mine is None:
            continue
        for other in players:
            if other is mine or other["timeMs"] >= mine["timeMs"]:
                continue
            candidates.append({
                "kind": "rival",
                "trackId": row["trackId"],
                "mode": row["mode"],
                "gapMs": mine["timeMs"] - other["timeMs"],
                "myBestMs": mine["timeMs"],
                "myRank": mine.get("rank"),
                "targetLabel": str(other.get("displayName") or other.get("playerId") or "?")[:64],
                "targetMs": other["timeMs"],
                "targetRank": other.get("rank"),
            })
    if not candidates:
        return None, None
    order = lambda c: (c["trackId"], c["mode"], c["targetLabel"])
    closest = min(candidates, key=lambda c: (c["gapMs"], order(c)))
    biggest = max(candidates, key=lambda c: (c["gapMs"], tuple(-ord(ch) for ch in c["trackId"])))
    return closest, biggest


def build_focus(view: dict) -> dict:
    """The home page's "Your focus" trio, per scope and engine class.

    ``focus[scope][mode]`` holds ``best`` (lowest Mastery), ``closest`` and
    ``biggest``; scope is ``rivals`` (the Player's Rival list) or ``global``
    (every human above the Player); mode is ``150``, ``200`` or ``all``.
    """
    player_id = str((view.get("player") or {}).get("playerId") or "")
    by_mode = view.get("focusByMode") or {}
    overall = view.get("focus") or {}
    out: dict = {"rivals": {}, "global": {}}
    for mode_key, modes in (("150", (150,)), ("200", (200,)), ("all", (150, 200))):
        source = overall if mode_key == "all" else (by_mode.get(mode_key) or {})
        best = _mastery_card(source.get("lowestMastery"))
        out["global"][mode_key] = {
            "best": best,
            "closest": _global_card(source.get("closestGap")),
            "biggest": _global_card(source.get("biggestGap")),
        }
        closest, biggest = _rival_cards(view, player_id, modes)
        out["rivals"][mode_key] = {"best": best, "closest": closest, "biggest": biggest}
    return out


def build_reference(view: dict, product_version: str | None = None, update: dict | None = None) -> dict:
    """Reduce a Player progress view to per-track targets.

    ``tracks[trackId][mode]`` carries ``pb`` (the Player's published best on
    the site, or None), ``rank`` there, and ``others``: the other Players the
    site lists on that track, fastest first, so the dashboard can name the
    next rival ahead of a run and the one just behind it.
    """
    player = view.get("player") or {}
    player_id = player.get("playerId")
    if not isinstance(player_id, str) or not player_id:
        raise LiveTrialReferenceError("LiveTrial reference is unavailable.")
    tracks: dict[str, dict[str, dict]] = {}
    for row in view.get("perTrack") or []:
        track_id = row.get("trackId")
        mode = row.get("mode")
        if not isinstance(track_id, str) or mode not in (150, 200):
            continue
        pb = None
        rank = None
        others = []
        for entry in row.get("players") or []:
            time_ms = entry.get("timeMs")
            if not isinstance(time_ms, int) or isinstance(time_ms, bool) or time_ms <= 0:
                continue
            if entry.get("playerId") == player_id:
                pb, rank = time_ms, entry.get("rank")
            else:
                name = entry.get("displayName") or entry.get("playerId") or "?"
                others.append({"name": str(name)[:64], "timeMs": time_ms})
        others.sort(key=lambda item: item["timeMs"])
        tracks.setdefault(track_id, {})[str(mode)] = {
            "pb": pb,
            "rank": rank if isinstance(rank, int) and not isinstance(rank, bool) else None,
            "others": others[:MAX_OTHERS_PER_TRACK],
        }
    document = {
        "format": REFERENCE_FORMAT,
        "playerId": player_id,
        "displayName": str(player.get("displayName") or player_id)[:64],
        "fetchedAtMs": int(view.get("fetchedAtMs") or 0),
        "tracks": tracks,
        "focus": build_focus(view),
    }
    if isinstance(product_version, str) and product_version:
        document["productVersion"] = product_version[:32]
    if isinstance(update, dict) and isinstance(update.get("version"), str):
        document["update"] = {
            "version": update["version"][:32],
            "releasedOn": str(update.get("releasedOn") or "")[:10],
            "downloadUrl": str(update.get("downloadUrl") or "")[:200],
        }
    return document


def write_reference(runs_root: str | Path, document: dict) -> Path:
    """Atomically write the reference beside the runs; returns its path."""
    if not isinstance(document, dict) or document.get("format") != REFERENCE_FORMAT:
        raise LiveTrialReferenceError("LiveTrial reference is unavailable.")
    path = Path(runs_root) / REFERENCE_FILE_NAME
    temporary: Path | None = None
    try:
        payload = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(payload) > MAX_REFERENCE_BYTES:
            raise LiveTrialReferenceError("LiveTrial reference is unavailable.")
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        temporary = Path(temporary_name)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
        return path
    except LiveTrialReferenceError:
        raise
    except (OSError, TypeError, ValueError):
        raise LiveTrialReferenceError("LiveTrial reference is unavailable.") from None
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except OSError:
                pass


def write_reference_from_cache(
    data_root: str | Path,
    player_id: str,
    runs_root: str | Path,
    product_version: str | None = None,
    update: dict | None = None,
) -> Path | None:
    """Write the reference for a Player from the offline cache; None when
    there is no cache yet (a first start before any progress was loaded)."""
    cache = load_cached_progress(data_root, player_id)
    if cache is None:
        return None
    return write_reference(runs_root, build_reference(player_progress_view(cache), product_version, update))
