"""In-race clock reading (M:SS.mmm) at the timer anchor — LIVE display aid.

The running clock digits are rendered in a slightly ITALIC 7-segment font
(user observation; measured shear -0.138 px/px on the clock template's '0'
glyphs — ~4.6px lean over the 33px digit height). Segment boxes from
`detection.sevenSegment` (canonical 13x19 cell, scaled 65x95) are mapped
into each glyph cell with that shear compensation.

Geometry source: `hud_template.timer_clock_zero` (anchor 1035,39 236x48) —
the template IS a rendered "0:00.000", so glyph columns and the shear were
measured from it directly. Display-only: nothing downstream depends on it.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

ANCHOR_X, ANCHOR_Y, ANCHOR_W, ANCHOR_H = 1035, 39, 236, 48
GLYPH_X = (9, 46, 74, 112, 139, 167)   # M, S1, S2, ms1, ms2, ms3 (sheared-box left edges)
GLYPH_Y0, GLYPH_Y1 = 6, 39             # glyph rows in the template
SHEAR = -0.138                          # px x-shift per px y (italic lean)
PIXEL_THRESH = 0.55                     # how bright a pixel counts as lit...
AREA_FRAC = 0.40                        # ...and how much of the bar must be
GLYPH_W = 20.4                          # unsheared glyph width (25.0 - |shear|*33)

# detection.sevenSegment boxes in the scaled 65x95 cell
SEGS = {
    "top_middle": (28, 8, 17, 9), "left_middle": (9, 17, 16, 23),
    "middle_middle": (32, 21, 9, 18), "right_middle": (51, 17, 15, 23),
    "left_bottom": (9, 57, 16, 23), "middle_bottom": (32, 59, 9, 18),
    "right_bottom": (51, 57, 16, 23), "middle_bottom_edge": (28, 82, 17, 9),
    "center": (24, 44, 25, 9),
}
SEG_NAMES = list(SEGS)
# MK8's 7-seg style: classic 7 segments + two central verticals for '1'
DIGITS = {
    "0": {"top_middle", "left_middle", "right_middle", "left_bottom", "right_bottom", "middle_bottom_edge"},
    "1": {"right_middle", "right_bottom"},  # classic right-side '1' (verified on real frames; NOT the central verticals)
    "2": {"top_middle", "right_middle", "center", "left_bottom", "middle_bottom_edge"},
    "3": {"top_middle", "right_middle", "center", "right_bottom", "middle_bottom_edge"},
    "4": {"left_middle", "right_middle", "center", "right_bottom"},
    "5": {"top_middle", "left_middle", "center", "right_bottom", "middle_bottom_edge"},
    "6": {"top_middle", "left_middle", "center", "left_bottom", "right_bottom", "middle_bottom_edge"},
    "7": {"top_middle", "right_middle", "right_bottom"},
    "8": {"top_middle", "left_middle", "right_middle", "center", "left_bottom", "right_bottom", "middle_bottom_edge"},
    "9": {"top_middle", "left_middle", "right_middle", "center", "right_bottom", "middle_bottom_edge"},
}
_H = GLYPH_Y1 - GLYPH_Y0
_SX, _SY = GLYPH_W / 65.0, _H / 95.0


_CFG_PATH = Path(__file__).resolve().parents[1] / "config" / "clock_grid.json"
_CFG: dict = {}


def grid() -> dict:
    """Calibrated clock geometry (config/clock_grid.json, edited at /deltagrid).

    Same model as the delta: columns are {x, tilt} with x measured at the BOTTOM
    row so a cell is a parallelogram, seven segments as ONE bar turned 90 degrees
    for the verticals, and a shared per-segment nudge. The constants below remain
    the fallback and were measured off `041_timer_clock_zero`.
    """
    if not _CFG:
        try:
            _CFG.update(json.loads(_CFG_PATH.read_text(encoding="utf-8")))
        except Exception:
            from . import hudtimes as _h
            _CFG.update({"roi": [ANCHOR_X, ANCHOR_Y, ANCHOR_W, ANCHOR_H],
                         "glyphRows": [GLYPH_Y0, GLYPH_Y1], "glyphW": GLYPH_W,
                         "columns": [{"x": v, "tilt": SHEAR} for v in GLYPH_X],
                         "segLong": 10.0, "segShort": 7.0,
                         "pixelThresh": 0.55, "areaFrac": 0.40,
                         "segOffsets": {k: [0, 0] for k in _h.SEG7}})
    return _CFG


def reload_grid() -> dict:
    _CFG.clear()
    return grid()


def _digit_at(gray, col, dx: float, dy: float):
    """Decode one glyph. A segment is judged by lit AREA, not by the mean of its
    box — a mean is satisfied by a faint wash that is visibly not a segment."""
    from . import hudtimes as _h
    g = grid()
    gy0, gy1 = g["glyphRows"]
    sx, sy = g["glyphW"] / 65.0, (gy1 - gy0) / 95.0
    offs = g.get("segOffsets") or {}
    sl, ss = g.get("segLong", 10.0), g.get("segShort", 7.0)
    pth, afr = g.get("pixelThresh", 0.55), g.get("areaFrac", 0.40)
    if isinstance(col, (int, float)):
        col = {"x": float(col), "tilt": SHEAR}
    x0, tilt = col["x"], col.get("tilt", SHEAR)
    on = set()
    lo, hi = np.percentile(gray, 10), np.percentile(gray, 90)
    span = max(20.0, hi - lo)
    for name, (bcx, bcy, orient) in _h.SEG7.items():
        odx, ody = offs.get(name, (0, 0))
        cy = gy0 + bcy * sy + dy + ody
        cx = x0 + bcx * sx + tilt * (cy - gy1) + dx + odx
        w = max(2, int((sl if orient == "h" else ss) * sx))
        h = max(2, int((ss if orient == "h" else sl) * sy))
        y1, x1 = int(cy - h / 2), int(cx - w / 2)
        if y1 < 0 or x1 < 0 or y1 + h > gray.shape[0] or x1 + w > gray.shape[1]:
            return None, 9
        patch = (gray[y1:y1 + h, x1:x1 + w] - lo) / span
        if patch.size and float((patch > pth).mean()) >= afr:
            on.add(name)
    best, bestd, second = None, 10, 10
    for d, pat in DIGITS.items():
        dist = len(on ^ pat)
        if dist < bestd:
            best, bestd, second = d, dist, bestd
        elif dist < second:
            second = dist
    if bestd > 1 or second - bestd < 1:
        return None, bestd
    return best, bestd


def read_clock(bgr_720: np.ndarray) -> str | None:
    """Read the running clock from a normalized 1280x720 frame; None if the
    decode is not fully confident (all 6 digits + sane seconds)."""
    g = grid()
    rx, ry, rw, rh = g.get("roi", [ANCHOR_X, ANCHOR_Y, ANCHOR_W, ANCHOR_H])
    crop = bgr_720[int(ry):int(ry + rh), int(rx):int(rx + rw)]
    if crop.shape[0] < rh or crop.shape[1] < rw:
        return None
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
    best = None
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            digits, dist = [], 0
            for col in g["columns"]:
                d, dd = _digit_at(gray, col, dx, dy)
                if d is None:
                    digits = None
                    break
                digits.append(d)
                dist += dd
            if digits is not None and (best is None or dist < best[1]):
                best = (digits, dist)
    if best is None:
        return None
    d = best[0]
    if int(d[1]) > 5:  # seconds tens can never exceed 5
        return None
    return f"{d[0]}:{d[1]}{d[2]}.{d[3]}{d[4]}{d[5]}"
