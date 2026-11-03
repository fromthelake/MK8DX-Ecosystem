"""The central scan result (CENTRAL_RECOGNITION section 8.6, phase 4).

One specification in Python (this reference), TypeScript (``ts/sharedScanResult.ts``) and Java
(``ScanResult.java``): what a locked Time Trial scan says, built from the sequence decision's
output (the Web scanner's ``ScanResult``, Android's compact result), so the Web scanner and the
APK give the same result for the same frames. The products keep their own presentation and their
own mapping of catalog IDs to the submission contract (``packages/domain``); everything they
derive (which time counts, which part is accepted, what the player must check, whether the lap
sum closes, which screen was read) comes from here.

Rules:

- The owner is the yellow player card when a player total was read, else the only rider of a
  Select-a-Ghost panel (``ghost``).
- A time counts when it is ``m:ss.mmm`` with seconds below 60 and lies in 1..599999 ms; an
  unreadable lap stays in its place as ``None`` (laps are numbered 1..n up to the last one read).
- Laps are complete when every lap 1..n was read and n is 3 or 7 (and equals the expected lap
  count when the caller knows it). The lap sum is checked only on complete laps.
- A part is accepted only when the sequence decision accepted it (``ok``); its score is rounded
  to 4 decimals. An accepted part below 0.75 is doubt; an unaccepted part offers its alternatives
  (at most 2).
- Doubt is also raised on the laps when complete laps do not add up to the total.
- The printed rider name counts when it has 1..64 code points after trimming.
"""

from __future__ import annotations

import math
import re

SCHEMA = "mk8dx.scan-result.v1"
DOUBT_BELOW = 0.75
MAX_ALTERNATIVES = 2
MAX_NAME_CODE_POINTS = 64
MAX_TIME_MS = 599_999

_TIME = re.compile(r"^([0-9]):([0-5][0-9])\.([0-9]{3})$")
# The sequence decision's slot names, mapped to the contract's part names.
PARTS = (("character", "character"), ("body", "kart"), ("tire", "wheel"), ("glider", "glider"),
         ("country", "flag"))
_CAPTURE_LAYOUT = {"endscreen": "time_trial_result", "ghost_detail": "ghost_details"}


def time_ms(value) -> int | None:
    """Milliseconds of a readable ``m:ss.mmm`` time; None for anything else."""
    if not isinstance(value, str):
        return None
    m = _TIME.match(value)
    if not m or m.end() != len(value):
        return None
    ms = int(m.group(1)) * 60_000 + int(m.group(2)) * 1000 + int(m.group(3))
    return ms if 1 <= ms <= MAX_TIME_MS else None


def _round4(score) -> float | None:
    if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score):
        return None
    # half up, as JavaScript's Math.round and Java's Math.floor(x + 0.5)
    return math.floor(float(score) * 10000 + 0.5) / 10000


def _int(value) -> int | None:
    """An integer index (an integral JSON number); None for anything else."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return None


def _part(slot) -> dict:
    if not isinstance(slot, dict):
        return {"present": False, "accepted": False, "id": None, "index": None, "score": None,
                "doubt": False, "alternatives": []}
    accepted = slot.get("ok") is True
    score = _round4(slot.get("score"))
    ident = slot.get("id") if isinstance(slot.get("id"), str) and slot.get("id") else None
    alternatives = []
    raw_alternatives = slot.get("alternatives")
    if not accepted and isinstance(raw_alternatives, list):
        for alt in raw_alternatives[:MAX_ALTERNATIVES]:
            if isinstance(alt, dict):
                alternatives.append({"id": alt.get("id") if isinstance(alt.get("id"), str) else None,
                                     "index": _int(alt.get("index")),
                                     "name": alt.get("name") if isinstance(alt.get("name"), str) else None})
    return {"present": True, "accepted": accepted, "id": ident, "index": _int(slot.get("index")), "score": score,
            "doubt": accepted and score is not None and score < DOUBT_BELOW, "alternatives": alternatives}


def _name(value) -> str | None:
    if not isinstance(value, str):
        return None
    name = value.strip(" \t\r\n")
    # code points (Python str length); the TS and Java ports count code points too
    return name if 1 <= len(name) <= MAX_NAME_CODE_POINTS else None


def _accept_path(consensus: dict) -> str | None:
    path = consensus["acceptPath"] if "acceptPath" in consensus else consensus.get("accept_path")
    return path if isinstance(path, str) else None


def compose_scan_result(consensus: dict, lap_count: int | None = None) -> dict:
    """The scan result of a sequence decision. ``lap_count``: the track's lap count when known."""
    fields = consensus.get("fields") if isinstance(consensus.get("fields"), dict) else {}
    owner = "player" if "player_total" in fields else "ghost"
    raw_layout = consensus.get("layout")
    if raw_layout in ("endscreen", "ghost_detail"):
        layout = raw_layout
    else:
        layout = "endscreen" if owner == "player" else "ghost_detail"
    out = {"schema": SCHEMA, "status": "ok", "owner": owner, "layout": layout,
           "captureLayout": _CAPTURE_LAYOUT[layout], "acceptPath": _accept_path(consensus),
           "totalTime": None, "totalMs": None, "laps": [], "lapsComplete": False, "lapSumMatches": None,
           "parts": {}, "confidence": {}, "doubt": [], "observedPlayerName": None}
    if consensus.get("locked") is not True:
        out["status"] = "not_locked"
        return out
    total = fields.get(f"{owner}_total")
    total_ms = time_ms(total)
    if total_ms is None:
        out["status"] = "no_total"
        return out
    out["totalTime"], out["totalMs"] = total, total_ms
    last = 0
    for lap in range(1, 8):
        if f"{owner}_lap_{lap}" in fields:
            last = lap
    laps = []
    for lap in range(1, last + 1):
        value = fields.get(f"{owner}_lap_{lap}")
        ms = time_ms(value)
        laps.append({"time": value if ms is not None else None, "ms": ms})
    out["laps"] = laps
    complete = last in (3, 7) and all(lap["ms"] is not None for lap in laps) and \
        (lap_count is None or last == lap_count)
    out["lapsComplete"] = complete
    if complete:
        out["lapSumMatches"] = sum(lap["ms"] for lap in laps) == total_ms
        if not out["lapSumMatches"]:
            out["doubt"].append("laps")
    raw_identity = consensus.get("identity")
    identity = raw_identity.get(owner) if isinstance(raw_identity, dict) else None
    identity = identity if isinstance(identity, dict) else {}
    for name, slot in PARTS:
        part = _part(identity.get(slot))
        out["parts"][name] = part
        if part["accepted"] and part["score"] is not None:
            out["confidence"][name] = part["score"]
        if part["doubt"]:
            out["doubt"].append(name)
    out["observedPlayerName"] = _name(identity.get("card_name"))
    return out
