"""In-race LAP and COIN counters, read as digits off a calibrated grid.

Both were matched as whole images before, and both paid the same price. The
lap counter is flag + digit + "/N", so ~85% of every comparison is pixels that
never change; a 7-segment "5" is a strict SUBSET of "6" (lit only in 5: 3 px,
only in 6: 61 px), so the "5" template matched a frame showing 6/7 BETTER than
the "6" template did — 0.914 against 0.850. That fired lap 6 1.3 s into lap 5
on Baby Park and swallowed the real crossing 8.5 s later. The coin counter hit
the same wall earlier and worked around it by reading only its last digit and
treating the orange "10" as a colour special case.

A segment reader has neither problem. A subset is simply a different digit —
you ask whether the bottom-left stroke is lit, and it either is or it is not.
And "10" is a 1 and a 0 in two columns, so the colour trick is unnecessary.

Geometry comes from config/{lap,coins}_grid.json, placed by hand at /deltagrid
against real frames, and verified there: 35/35 references decode to what the
result cards say, laps 1..7 across both counter families and coins 00..10
including the orange ten. The threshold is relative to each crop's own
10th/90th percentile, which is why orange ink on a dark panel behaves like
white ink on a light one.

These counters draw '1' CENTRED, unlike the clock, which draws it on the right
— so the grids carry a `digits` override naming the two central verticals. No
other digit lights them.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from . import clock as C
from . import hudtimes as H

_CFG_DIR = Path(__file__).resolve().parents[1] / "config"
_CACHE: dict = {}


def grid(field: str) -> dict | None:
    """Calibrated geometry for 'lap' or 'coins'; None when it was never placed.

    Re-read when the file changes so the calibrator can be used against a
    running server, the same way the clock and delta grids behave.
    """
    p = _CFG_DIR / f"{field}_grid.json"
    try:
        mt = p.stat().st_mtime
    except OSError:
        return None
    hit = _CACHE.get(field)
    if hit and hit[0] == mt:
        return hit[1]
    try:
        g = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
    digits = {d: set(pat) for d, pat in C.DIGITS.items()}
    for d, pat in (g.get("digits") or {}).items():
        digits[d] = set(pat)
    used = set().union(*digits.values())
    # only the segments this field's model uses: counting the centred pair
    # against a field that never lights them lets one stray pixel push a good
    # read past the reject distance
    g["_digits"] = digits
    g["_segs"] = {k: v for k, v in H.SEG_ALL.items() if k in used}
    _CACHE[field] = (mt, g)
    return g


def _read(frame, field: str, is_rgb: bool) -> str | None:
    """The digits of one field, or None when any column is not legible.

    The counters sit at a FIXED screen position for the whole session (user
    observation, and it holds across every clip we have), so this does no
    anchor sweep — only a +-1 nudge for capture wobble.

    Crops BEFORE converting colour. Converting the whole frame first copied
    1280x720x3 twice per frame (once per counter) and was most of the cost:
    the region that matters is 134x53.
    """
    g = grid(field)
    if not g:
        return None
    rx, ry, rw, rh = g["roi"]
    crop = frame[int(ry):int(ry + rh), int(rx):int(rx + rw)]
    if crop.shape[0] < rh or crop.shape[1] < rw:
        return None
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY if is_rgb
                        else cv2.COLOR_BGR2GRAY).astype(np.float32)
    lo, hi = np.percentile(gray, 10), np.percentile(gray, 90)
    norm = (lo, max(20.0, hi - lo))
    best = None
    for dy in (0, -1, 1):
        for dx in (0, -1, 1):
            out, tot = "", 0
            for col in g["columns"]:
                d, dist, _c = H.decode_glyph(gray, g, col, dx, dy,
                                             g["_segs"], g["_digits"], norm)
                if d is None:
                    out = None
                    break
                out += d
                tot += dist
            if out is not None and (best is None or tot < best[1]):
                best = (out, tot)
                # a clean read at this offset cannot be beaten, and this runs
                # on every frame of every race — do not sweep the other eight
                if tot == 0:
                    return out
    return best[0] if best else None


def read_lap(frame, is_rgb: bool = False) -> int | None:
    """Which lap the counter shows, or None while it is not legible.

    None is the normal state for a moment after every crossing: the new digit
    FLASHES in, absent on some frames and present on others (user observation,
    and it happens on 3-lap and 7-lap tracks alike). Callers should wait for a
    stable value rather than count frames — a frame counter cannot tell a
    flashing new digit from a settled one.
    """
    s = _read(frame, "lap", is_rgb)
    if s is None or not s.isdigit():
        return None
    v = int(s)
    return v if 1 <= v <= 7 else None


def read_coins(frame, is_rgb: bool = False) -> int | None:
    """Coins 0..10, or None when the counter is not legible."""
    s = _read(frame, "coins", is_rgb)
    if s is None or not s.isdigit():
        return None
    v = int(s)
    return v if 0 <= v <= 10 else None
