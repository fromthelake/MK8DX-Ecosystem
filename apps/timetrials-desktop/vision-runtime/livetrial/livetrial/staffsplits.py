"""Harvest Nintendo staff-ghost lap splits from your own races.

The database holds a staff TIME for all 192 entries (96 courses x 150/200cc) but
no lap splits — `worldRecords` carries `splits.lapTimesMs` for every entry,
`nintendoStaffTimes` carries none. Yet every ghost race already reads the ghost's
lap times off the result card, lap-sum verified. Driving against a staff ghost
therefore recovers exactly the data that is missing, as a by-product.

Nothing here is inferred. A run only contributes when it is PROVEN to be a staff
ghost:

  1. the ghost total equals the database staff time for that course+cc EXACTLY
  2. the ghost name matches the Nintendo staff name for that entry
  3. the loadout matches the one the database stores for that entry
  4. the ghost's lap times are all present and sum to that total

Measured on a real 200cc Mario Kart Stadium run: the card OCR'd 81984 ms and the
database holds 81984 ms — the same millisecond by two unrelated paths (7-segment
decode vs the record table). So the tolerance is 0.

Contributions are keyed by (trackId, cc). A second run of the same entry must
AGREE; a disagreement is reported as a conflict rather than silently overwriting,
because two different split sets for one fixed ghost means one of them is wrong.

    python livetrial/tests/_staff_splits.py            # scan + report coverage
    python livetrial/tests/_staff_splits.py --write    # ...and write the file

Since 2026-09-28 (ADR-0210 rule 8) a second route feeds the same file: the
ghost menu. A staff ghost's Select-a-Ghost panel, seen expanded, shows its lap
times; watching its replay to the end shows its coins and mushrooms per lap and
the moment of each — which neither the database nor mkwrs has for staff. They
come from the session's `ghosts.json` (one record per ghost), under the same
proof plus one more (the panel's flag equals the staff country), and land in the
same shape as `worldRecords[].splits` so they can join the database as is.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

TRACKS = 96
CLASSES = ("150", "200")
TOTAL_ENTRIES = TRACKS * len(CLASSES)


def _fmt(ms: int) -> str:
    return f"{ms // 60000}:{ms % 60000 // 1000:02d}.{ms % 1000:03d}"


def staff_index(db: dict) -> dict:
    """(trackId, cc) -> the database's staff record."""
    it = db["collections"]["nintendoStaffTimes"]
    items = it["items"] if isinstance(it, dict) and "items" in it else it
    return {(x.get("trackId"), str(x.get("mode"))): x for x in items}


def _base(pid) -> str:
    """Compare parts by BASE, not by colour variant. The database stores the
    base part on a staff record (`body.sport_bike`) while the matcher reports
    the variant it actually saw (`body_variant.sport_bike.001_orange`). Those
    are the same kart in a different colour, and demanding an exact id rejected
    a genuine staff ghost — the same base-vs-variant distinction the identity
    self-audit makes when it counts only CROSS-BASE misranks."""
    t = str(pid or "")
    if ".0" in t:
        t = t.rsplit(".", 1)[0]
    for pre in ("character_variant.", "body_variant.", "tire_variant.",
                "glider_variant.", "character.", "body.", "tire.", "glider."):
        t = t.replace(pre, "")
    return t


def _loadout_of(ident: dict) -> dict:
    return {k: ((ident.get(f) or {}).get("id"))
            for k, f in (("characterId", "character"), ("bodyId", "kart"),
                         ("tireId", "wheel"), ("gliderId", "glider"))}


def _ghost_name_of(ident: dict) -> str | None:
    name = ident.get("name") or ident.get("nameRaw")
    return str(name) if name else None


def contribution(run: dict, staff: dict, source: str = "") -> dict | None:
    """A contribution record for this run, or None when the proof does not hold.

    Returns the reason for rejection under "_reject" when it fails, so a scan can
    explain itself rather than silently dropping runs.
    """
    ctx = run.get("context") or {}
    track = (ctx.get("trackName") or {}).get("trackId")
    cc = str(ctx.get("cc") or "")
    rec = staff.get((track, cc))
    if not track or not rec:
        return {"_reject": "no staff entry for this course+cc", "track": track, "cc": cc}
    g = ((run.get("results") or {}).get("ghost") or {})
    total, laps = g.get("totalMs"), g.get("lapTimesMs") or []
    if total is None:
        return {"_reject": "ghost total not read", "track": track, "cc": cc}
    if int(total) != int(rec["timeMs"]):
        return {"_reject": f"total {total} != staff {rec['timeMs']}", "track": track, "cc": cc}
    ident = (run.get("identity") or {}).get("ghost") or {}
    got_name = _ghost_name_of(ident)
    want_name = rec.get("playerName")
    if not got_name:
        return {"_reject": "ghost staff name not read", "track": track, "cc": cc}
    if want_name and got_name != want_name:
        return {"_reject": f"ghost name {got_name} != staff {want_name}",
                "track": track, "cc": cc}
    want = rec.get("loadout") or {}
    got = _loadout_of(ident)
    for k, v in got.items():
        if v and want.get(k) and _base(v) != _base(want[k]):
            return {"_reject": f"loadout {k} {_base(v)} != {_base(want[k])}",
                    "track": track, "cc": cc}
    if not laps or any(v is None for v in laps):
        return {"_reject": "ghost lap times incomplete", "track": track, "cc": cc}
    if sum(int(v) for v in laps) != int(total):
        return {"_reject": "ghost lap times do not sum to the total",
                "track": track, "cc": cc}
    return {
        "id": rec.get("id"),
        "trackId": track,
        "mode": int(cc),
        "timeMs": int(total),
        "playerName": rec.get("playerName"),
        "countryId": rec.get("countryId"),
        "loadout": want or got,
        "splits": {"status": "available", "lapCount": len(laps),
                   "lapTimesMs": [int(v) for v in laps]},
        "source": {"kind": "livetrial_extraction", "run": source,
                   "verifiedBy": ["total_matches_database_exactly",
                                  "name_matches_database",
                                  "loadout_matches_database",
                                  "lap_times_sum_to_total",
                                  "lap_times_present"]},
    }


REPLAY_SPLIT_FIELDS = ("coinCountsPerLap", "mushroomsPerLap", "events")


def _norm_name(name) -> str:
    return re.sub(r"[^0-9a-z]", "", str(name or "").lower())


def ghost_contribution(ghost: dict, staff: dict, source: str = "") -> dict | None:
    """A contribution from one detected ghost (ghosts.json, ADR-0210), or None
    when it is not a staff candidate at all; `_reject` explains a failed proof.

    The proof is the result-card proof plus the flag: the panel prints the
    ghost's country, and the (v5.1-corrected) database knows the staff one."""
    track, cc = ghost.get("trackId"), str(ghost.get("cc") or "")
    rec = staff.get((track, cc))
    if not track or not rec or ghost.get("totalMs") != rec.get("timeMs"):
        return None                                 # not a staff ghost: not our business
    why = {"track": track, "cc": cc}
    got_name = _norm_name(ghost.get("nameRaw") or ghost.get("name"))
    if not got_name or got_name != _norm_name(rec.get("playerName")):
        return {"_reject": f"ghost name {ghost.get('nameRaw') or ghost.get('name')!r} "
                           f"!= staff {rec.get('playerName')!r}", **why}
    if ghost.get("countryId") and rec.get("countryId") and ghost["countryId"] != rec["countryId"]:
        return {"_reject": f"flag {ghost['countryId']} != staff {rec['countryId']}", **why}
    want = rec.get("loadout") or {}
    for k in ("characterId", "bodyId", "tireId", "gliderId"):
        got = ghost.get(k)
        if got and want.get(k) and _base(got) != _base(want[k]):
            return {"_reject": f"loadout {k} {_base(got)} != {_base(want[k])}", **why}
    laps = ghost.get("lapTimesMs") or []
    if not ghost.get("lapSumOk") or not laps or sum(laps) != rec["timeMs"]:
        return {"_reject": "panel lap times not seen expanded with a closing lap sum", **why}
    splits = {"status": "available", "lapCount": len(laps), "lapTimesMs": [int(v) for v in laps]}
    verified = ["total_matches_database_exactly", "name_matches_database",
                "flag_matches_database_country", "loadout_matches_database",
                "lap_times_sum_to_total", "lap_times_present"]
    kind = "ghost_panel"
    replay = ghost.get("replay")
    if replay:      # GhostRecords only keeps a replay that finished and agrees with the laps
        splits.update({k: replay[k] for k in REPLAY_SPLIT_FIELDS})
        verified += ["replay_finished_on_the_total", "replay_lap_crossings_agree_with_panel"]
        kind = "ghost_replay"
    return {"id": rec.get("id"), "trackId": track, "mode": int(cc), "timeMs": rec["timeMs"],
            "playerName": rec.get("playerName"), "countryId": rec.get("countryId"),
            "loadout": want, "splits": splits,
            "source": {"kind": kind, "run": source, "verifiedBy": verified}}


def _merge(found: dict, conflicts: list, c: dict, src: str) -> None:
    """Keep one contribution per staff entry; a second route must AGREE on
    what both know, and may add what only it knows (the replay timeline)."""
    key = (c["trackId"], str(c["mode"]))
    prev = found.get(key)
    if prev is None:
        found[key] = c
        return
    if prev["splits"]["lapTimesMs"] != c["splits"]["lapTimesMs"]:
        # a staff ghost is fixed data: two different split sets for one
        # entry means one read is wrong, so surface it, never overwrite
        conflicts.append({"key": f"{key[0]} {key[1]}cc",
                          "a": prev["splits"]["lapTimesMs"],
                          "b": c["splits"]["lapTimesMs"],
                          "runs": [prev["source"]["run"], src]})
        return
    if "coinCountsPerLap" in c["splits"]:
        if "coinCountsPerLap" not in prev["splits"]:
            prev["splits"].update({k: c["splits"][k] for k in REPLAY_SPLIT_FIELDS})
            prev["source"]["verifiedBy"] = sorted(set(prev["source"]["verifiedBy"])
                                                  | set(c["source"]["verifiedBy"]))
            prev["source"].setdefault("also", []).append(src)
        elif (prev["splits"]["coinCountsPerLap"], prev["splits"]["mushroomsPerLap"]) != \
                (c["splits"]["coinCountsPerLap"], c["splits"]["mushroomsPerLap"]):
            conflicts.append({"key": f"{key[0]} {key[1]}cc",
                              "a": [prev["splits"]["coinCountsPerLap"], prev["splits"]["mushroomsPerLap"]],
                              "b": [c["splits"]["coinCountsPerLap"], c["splits"]["mushroomsPerLap"]],
                              "runs": [prev["source"]["run"], src]})


def scan(runs_dir: Path, db: dict) -> dict:
    """Walk every recorded session and collect what the proof allows."""
    staff = staff_index(db)
    found: dict = {}
    conflicts: list = []
    rejected: list = []
    for rp in sorted(Path(runs_dir).glob("*/report.json")):
        try:
            rep = json.loads(rp.read_text(encoding="utf-8"))
        except Exception:
            continue
        for run in rep.get("runs", []):
            if run.get("aborted"):
                continue
            src = f"{rp.parent.name}#run{run.get('run')}"
            c = contribution(run, staff, src)
            if not c:
                continue
            if "_reject" in c:
                rejected.append({**c, "run": src})
                continue
            _merge(found, conflicts, c, src)
    # the ghost menu (ADR-0210): panels seen expanded, replays watched to the end
    for gp in sorted(Path(runs_dir).glob("*/ghosts.json")):
        try:
            doc = json.loads(gp.read_text(encoding="utf-8"))
        except Exception:
            continue
        for ghost in doc.get("ghosts", []):
            src = f"{gp.parent.name}#{ghost.get('key')}"
            c = ghost_contribution(ghost, staff, src)
            if not c:
                continue
            if "_reject" in c:
                rejected.append({**c, "run": src})
                continue
            _merge(found, conflicts, c, src)
    return {"contributions": found, "conflicts": conflicts, "rejected": rejected}


def coverage(found: dict) -> dict:
    per = {cc: sum(1 for k in found if k[1] == cc) for cc in CLASSES}
    return {"have": len(found), "total": TOTAL_ENTRIES,
            "perClass": per, "pct": round(100.0 * len(found) / TOTAL_ENTRIES, 1)}


def document(found: dict) -> dict:
    """The contribution file, in the Clean Assets namespace shape."""
    return {
        "format": "livetrial.staffSplits.v1",
        "note": ("Nintendo staff-ghost splits recovered from recorded races and the "
                 "ghost menu. The database has staff TOTALS for all 192 entries but no "
                 "splits; lap times come off the ghost's result card or its expanded "
                 "Select-a-Ghost panel, lap-sum verified; coins, mushrooms and their "
                 "moments come from a replay watched to the end. Only ghosts proven "
                 "to be staff by name, total, loadout and lap sum (panel: also flag). "
                 "`splits` has the shape of worldRecords[].splits."),
        "entries": [found[k] for k in sorted(found)],
        "coverage": coverage(found),
    }
