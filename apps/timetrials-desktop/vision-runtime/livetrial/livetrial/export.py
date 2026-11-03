"""Submission JSON export — Clean Assets namespace style.

One self-contained document per finished run, following the format documented
in the MK8DX Clean Assets README (user_submission.time.*, clean IDs, splits
with per-lap arrays and race-elapsed event timelines). This is the string
that can be POSTed to a database or website later.
"""

from __future__ import annotations

import time


def _lap_of(t_ms: int, lap_bounds: list[tuple[int, int]]) -> int:
    for i, (a, b) in enumerate(lap_bounds, 1):
        if a <= t_ms < b:
            return i
    return len(lap_bounds)


def _lap_bounds(run: dict, player: dict, n: int) -> tuple[list, bool]:
    """Race-elapsed (start, end) per lap, and whether the RESULT CARD supplied
    them. The card's per-lap times are authoritative and complete; the in-race
    lap events are a detection that can be missed (a ghost driving through the
    lap counter, a dark section). When lap events were missed, every coin and
    mushroom collapsed into lap 1 and the per-lap arrays in the submission were
    silently wrong — so prefer the card and keep the events as the fallback."""
    laps = [v for v in (player.get("lapTimesMs") or []) if v is not None]
    if player.get("lapSumOk") and len(laps) == n:
        starts, t = [], 0
        for v in laps:
            starts.append((t, t + v))
            t += v
        return starts, True
    events = run.get("events") or []
    starts = [0] + [e["t"] for e in events if e["type"] == "lap"]
    end = player.get("totalMs") or (events[-1]["t"] if events else 0)
    return [(starts[i], starts[i + 1] if i + 1 < len(starts) else end + 1)
            for i in range(len(starts))], False


def _loadout(ident: dict | None) -> dict | None:
    if not ident:
        return None
    out = {}
    ch = (ident.get("character") or {}).get("id")
    if ch:
        if ch.startswith("character_variant."):
            out["characterId"] = "character." + ch.split(".")[1]
            out["characterVariantId"] = ch
        else:
            out["characterId"] = ch
    kart = (ident.get("kart") or {}).get("id")
    if kart:
        if kart.startswith("body_variant."):
            out["bodyId"] = "body." + kart.split(".")[1]
            out["bodyVariantId"] = kart
        else:
            out["bodyId"] = kart
    for kind, key in (("wheel", "tireId"), ("glider", "gliderId")):
        v = (ident.get(kind) or {}).get("id")
        if v:
            if kind == "glider" and v.startswith("glider_variant."):
                out["gliderId"] = "glider." + v.split(".")[1]
                out["gliderVariantId"] = v
            else:
                out[key] = v
    flag = (ident.get("flag") or {}).get("id")
    if flag:
        out["countryId"] = flag
    return out or None


def run_to_submission(run: dict, *, source: str = "", captured_at_ms: int | None = None) -> dict | None:
    """Build the submission document for a finished run; None if no times."""
    res = run.get("results") or {}
    player = res.get("player")
    if not player or player.get("totalMs") is None:
        return None
    n = run["lapCount"]
    events = run.get("events") or []
    bounds, bounds_from_card = _lap_bounds(run, player, n)

    coin_events, coins_per_lap = [], [0] * n
    for e in events:
        if e["type"] == "coin":
            lap = _lap_of(e["t"], bounds)
            delta = e["to"] - e["from"]
            coin_events.append({"timeMs": e["t"], "lap": lap, "delta": delta,
                                "coinCountAfter": e["to"], "source": "livetrial"})
            if delta > 0 and lap <= n:
                coins_per_lap[lap - 1] += delta
    mush_events, mush_per_lap, mi = [], [0] * n, 0
    for e in events:
        if e["type"].startswith("mushroom_use"):
            mi += 1
            lap = _lap_of(e["t"], bounds)
            mush_events.append({"timeMs": e["t"], "lap": lap, "mushroomIndex": mi,
                                "source": "livetrial"})
            if lap <= n:
                mush_per_lap[lap - 1] += 1

    types = {e["type"] for e in events}
    outcome = ("new_record" if "banner_new_record" in types else
               "won" if "banner_won" in types else
               "lost" if "banner_lost" in types else "finished")
    ctx = run.get("context") or {}
    tn = ctx.get("trackName") or {}
    ghost = res.get("ghost")
    ids = run.get("identity") or {}
    now = captured_at_ms if captured_at_ms is not None else int(time.time() * 1000)

    doc = {
        "id": f"user_submission.time.livetrial_{now}_{run['run']:02d}",
        "recordType": "time_trial_submission",
        "status": "pending_review",
        "mode": int(ctx["cc"]) if ctx.get("cc") else None,
        "trackId": tn.get("trackId"),
        "trackNameRaw": tn.get("raw"),
        "lapCount": n,
        "timeMs": player["totalMs"],
        "dateMs": now,
        "outcome": outcome,
        "loadout": _loadout(ids.get("player")),
        "splits": {
            "status": "available",
            "lapCount": n,
            "lapTimesMs": player["lapTimesMs"],
            "coinCountsPerLap": coins_per_lap,
            "mushroomsPerLap": mush_per_lap,
            "events": {
                "status": "available",
                "timeBase": "race_elapsed_ms",
                "coinEvents": coin_events,
                "mushroomEvents": mush_events,
            },
        },
        "ghost": ({
            "present": True,
            "playerName": (ids.get("ghost") or {}).get("name"),
            "timeMs": ghost.get("totalMs"),
            "lapTimesMs": ghost.get("lapTimesMs"),
            "loadout": _loadout(ids.get("ghost")),
        } if ghost else {"present": False}),
        "playerCardName": (ids.get("player") or {}).get("name"),
        "verification": {
            "lapSumOk": bool(player.get("lapSumOk")),
            "ghostLapSumOk": bool(ghost and ghost.get("lapSumOk")),
            # how the per-lap split arrays were binned, and whether the in-race
            # lap detections agree with the card (n-1 crossings are expected;
            # fewer means laps were missed and, on the fallback path, that the
            # per-lap arrays are approximate)
            "lapBounds": "result_card" if bounds_from_card else "lap_events",
            "lapEventsSeen": sum(1 for e in events if e["type"] == "lap"),
            "lapEventsExpected": max(0, n - 1),
            "finishGateMissed": bool(run.get("finishGateMissed")),
            "goEstimated": bool(run.get("goEstimated")),
            # set when the arm-time 3/7 decision was overruled later, by the
            # settled in-race counter or by the result-screen sidebar
            "lapCountCorrected": run.get("lapCountCorrected"),
            # loadout fields settled by a golden (a reference captured from this
            # capture card, matched near-exactly) rather than the generic icons
            "goldenFields": sorted(
                f"{who}.{k}" for who, i in (run.get("identity") or {}).items()
                for k in ("character", "kart", "wheel", "glider", "flag")
                if (i.get(k) or {}).get("source") == "golden"),
            "method": "livetrial 7seg lap-sum + template state machine",
        },
        "source": {"kind": "livetrial", "input": source, "runIndex": run["run"]},
    }
    return doc
