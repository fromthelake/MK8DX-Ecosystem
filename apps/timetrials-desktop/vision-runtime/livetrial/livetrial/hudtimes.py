"""In-race HUD times: the lap/total clock, and the ghost delta.

Two things the game shows briefly during a race that were previously ignored:

**The clock** (`hud_template.timer_clock_zero`, anchor 1035,39 236x48) normally
runs, but at every NON-final lap crossing it freezes on that lap's time for
~3 s in YELLOW, and at the final crossing it shows the total race time in
white. Measured on a real run, those frozen values equal the result card to the
millisecond (lap 1 0:58.571, lap 2 0:46.220, total 2:29.958).

**The delta** (`hud_template.timer_delta_*`, anchor 523,306 234x48) appears at
the same moments in a GHOST race only, showing the signed gap to the ghost —
`+0:13.772` behind, `-` ahead. It pulses green<->white or red<->white for ~3 s
and never appears on the final lap (the result screen carries that comparison).

Why this is read digit-by-digit and not by template correlation: the delta
templates are mostly transparent (thin italic glyphs), so masked correlation
scores 0.87 on EMPTY SCENERY and 0.93 on a real delta — it cannot discriminate
at all. The glyphs themselves are unambiguous.

Geometry is measured from the templates, the same way `clock.py` derived the
clock's. The delta's internal spacing is NOT the clock's shifted: the clock
puts its colon at x=36 and dot at 101, the delta at 69 and 129, so the columns
had to be taken from `044_timer_delta_behind_red.png` (which renders
"+0:05.025") rather than reused with an offset.

Verified against the two deltas in `clip_105252_run02.mp4`, whose true values
are known from both result cards: 6/6 digits exact.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from . import clock as C

# --- delta ------------------------------------------------------------------
DELTA_X, DELTA_Y, DELTA_W, DELTA_H = 523, 306, 234, 48
# digit ink-run starts measured off template 044, minus the 3 px the live
# render sits left of the template (constant across every verified frame)
DELTA_GLYPH_X = (40, 76, 102, 136, 160, 188)
DELTA_DY = 3                      # ...and 3 px lower (swept against both
                                  # known values; the left vertical segments
                                  # fall outside the cell at dy=2, which read
                                  # 6 as 5 and 8 as 3/9)
SIGN_X, SIGN_W = 16, 26           # the '+'/'-' cell, left of the first digit
# The line is LEFT-aligned and '-' is narrower than '+', so an ahead delta puts
# every digit ~3 px left of a behind one. Measured: '+0:16.428' decodes at dx 0,
# '-0:00.355' at dx -3 (the latter verified against the result cards, which give
# player 28.605 - ghost 28.960 = -355 ms). Searching only +/-1 around one of
# them made the other unreadable entirely.
DELTA_DX_BY_SIGN = {"+": 0, "-": -3}

# --- clock ------------------------------------------------------------------
# A running clock changes every frame; a reported time is frozen for ~3 s. That
# is the primary signal — colour then separates the two kinds of reported time.
# Measured over the glyph strokes: running/total sit at B/R 0.996-1.036 (neutral
# white), a frozen lap time at 0.559-0.941 (yellow, the blue channel collapses).
# The final TOTAL is white like the running clock, so it is identified by being
# frozen after the last lap rather than by colour.
LAP_YELLOW_BR = 0.97


def _crop(frame, x, y, w, h):
    if frame.shape[0] < y + h or frame.shape[1] < x + w:
        return None
    return frame[y:y + h, x:x + w]


def _blue_red_ratio(crop, is_rgb: bool = False) -> float | None:
    """Mean blue/red over the glyph strokes; ~1.0 white, well under 1 for yellow.

    `is_rgb` matters: the ENGINE feeds RGB (runner.py converts before
    Analyzer.feed), while a frame read straight from cv2 is BGR. Reading the
    channels the wrong way round inverts this ratio — yellow then scores ABOVE
    1.0 and the lap-freeze test never fires, which is exactly what happened when
    this was first wired in.
    """
    if crop is None or crop.size == 0:
        return None
    g = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY if is_rgb else cv2.COLOR_BGR2GRAY)
    m = g >= np.percentile(g, 88)
    if m.sum() < 20:
        return None
    px = crop[m].reshape(-1, 3).astype(np.float32).mean(0)
    b, r = (px[2], px[0]) if is_rgb else (px[0], px[2])
    return float(b / max(r, 1.0))


def clock_is_lap_time(frame, is_rgb: bool = False) -> bool:
    """Is the clock currently showing a frozen LAP time (yellow) rather than
    running (white)? The tint pulses, so a caller watching a window should take
    the minimum ratio across it, not a single frame."""
    br = _blue_red_ratio(_crop(frame, C.ANCHOR_X, C.ANCHOR_Y, C.ANCHOR_W, C.ANCHOR_H),
                         is_rgb)
    return br is not None and br < LAP_YELLOW_BR


def _to_bgr(frame, is_rgb: bool):
    """Contiguous BGR view. Only called inside a freeze window (~3 s a lap), so
    the copy is negligible against the per-frame budget."""
    return np.ascontiguousarray(frame[:, :, ::-1]) if is_rgb else frame


def read_clock_time(frame, is_rgb: bool = False) -> str | None:
    """M:SS.mmm at the clock anchor — running, frozen lap, or final total."""
    return C.read_clock(_to_bgr(frame, is_rgb))


# A 7-segment glyph has SEVEN segments. `detection.sevenSegment` ships nine
# boxes, but `middle_middle` and `middle_bottom` appear in no digit pattern —
# drawing them made the calibrator look like an 8-segment display. Only the
# seven the patterns actually use are modelled here.
#
# Each entry is the segment's CENTRE in the canonical 65x95 cell plus its
# orientation. Size is shared: a horizontal bar is segLong x segShort and a
# vertical is the same bar turned 90 degrees (segShort x segLong), which is what
# a real 7-segment display is — one bar shape in two orientations.
SEG7 = {
    "top_middle":         (36.5, 12.5, "h"),
    "left_middle":        (17.0, 28.5, "v"),
    "right_middle":       (58.5, 28.5, "v"),
    "center":             (36.5, 48.5, "h"),
    "left_bottom":        (17.0, 68.5, "v"),
    "right_bottom":       (59.0, 68.5, "v"),
    "middle_bottom_edge": (36.5, 86.5, "h"),
}

# The clock and the delta draw '1' on the RIGHT (right_middle + right_bottom),
# but the lap and coin counters draw it CENTRED — user observation, visible on
# the reference frames. These two verticals give those fields somewhere to read
# it. No other digit lights them, in any field, so adding them to the model
# cannot change how anything else decodes: a grid opts in by naming them in its
# own `digits` override, and the seven above stay exactly as they were.
SEG_CENTRE = {
    "middle_middle":      (36.5, 28.5, "v"),
    "middle_bottom":      (36.5, 68.5, "v"),
}
SEG_ALL = {**SEG7, **SEG_CENTRE}

_CFG_PATH = Path(__file__).resolve().parents[1] / "config" / "delta_grid.json"
_CFG: dict = {}


def grid() -> dict:
    """Calibrated delta geometry (config/delta_grid.json, edited at /deltagrid).

    Each column is `{x, tilt}`: `x` is the cell's left edge at the BOTTOM row,
    `tilt` is px of x per px of y. A cell is therefore a PARALLELOGRAM —
    horizontal top and bottom, parallel tilted sides — which is what an italic
    7-segment glyph is. One global shear could not express a per-digit lean, and
    the failures were all corner-segment confusions, exactly what a wrong lean
    produces.

    `segOffsets` nudges each of the nine segment sample boxes, shared across all
    columns. Positive and negative keep separate columns: '-' is narrower than
    '+', so every digit after it sits further left.

    Falls back to the values measured off template 044 when the file is absent.
    """
    if not _CFG:
        try:
            _CFG.update(json.loads(_CFG_PATH.read_text(encoding="utf-8")))
        except Exception:
            _CFG.update({
                "roi": [DELTA_X, DELTA_Y, DELTA_W, DELTA_H],
                "glyphRows": [C.GLYPH_Y0 + DELTA_DY, C.GLYPH_Y1 + DELTA_DY],
                "glyphW": C.GLYPH_W, "signBox": [SIGN_X, SIGN_W],
                "columns": {
                    "+": [{"x": v, "tilt": C.SHEAR} for v in DELTA_GLYPH_X],
                    "-": [{"x": v + DELTA_DX_BY_SIGN["-"], "tilt": C.SHEAR}
                          for v in DELTA_GLYPH_X]},
                "segLong": 20.0, "segShort": 10.0,
                "segOffsets": {k: [0, 0] for k in SEG7},
            })
    return _CFG


def reload_grid() -> dict:
    """Re-read the config — the calibrator saves while the server is running."""
    _CFG.clear()
    return grid()


def _delta_digit(gray, col: dict, dx: float, dy: float):
    """Decode one glyph with the DELTA's own geometry — see decode_glyph."""
    return decode_glyph(gray, grid(), col, dx, dy)


def decode_glyph(gray, g: dict, col: dict, dx: float, dy: float,
                 segs: dict | None = None, digits: dict | None = None,
                 norm: tuple | None = None):
    """Decode one 7-segment glyph against a calibrated grid.

    Returns (digit, mismatch, confidence). Takes the lean per column and the
    shared per-segment offsets, so the sample boxes follow the cell instead of
    assuming an upright grid.

    `segs`/`digits` default to the seven-segment model the clock and the delta
    use. The lap and coin counters pass their own, because they draw '1' in the
    CENTRE while the clock draws it on the right — a per-field model, carried by
    the grid, rather than a second copy of this function.
    """
    segs = segs or SEG7
    digits = digits or C.DIGITS
    gy0, gy1 = g["glyphRows"]
    sx, sy = g["glyphW"] / 65.0, (gy1 - gy0) / 95.0
    offs = g.get("segOffsets") or {}
    sl, ss = g.get("segLong", 20.0), g.get("segShort", 10.0)
    pth = float(g.get("pixelThresh", 0.55))   # how bright a pixel must be
    afrac = float(g.get("areaFrac", 0.55))    # ...and how much of the bar must be
    x0, tilt = col["x"], col.get("tilt", C.SHEAR)
    on, conf = set(), 0.0
    # `norm` is the crop's (lo, span). Computing it here costs two percentile
    # passes over the whole crop PER GLYPH — with two columns and a 3x3 nudge
    # that was 18 passes a frame, and the single biggest cost in the reader.
    if norm is None:
        lo, hi = np.percentile(gray, 10), np.percentile(gray, 90)
        span = max(20.0, hi - lo)
    else:
        lo, span = norm
    for name, (bcx, bcy, orient) in segs.items():
        odx, ody = offs.get(name, (0, 0))
        cy = gy0 + bcy * sy + dy + ody
        # x is measured at the BOTTOM row, so the box slides by `tilt` for every
        # row above it — the sample follows the glyph's lean
        cx = x0 + bcx * sx + tilt * (cy - gy1) + dx + odx
        # one bar shape, turned 90 degrees for the verticals
        w = max(2, int((sl if orient == "h" else ss) * sx))
        h = max(2, int((ss if orient == "h" else sl) * sy))
        y1, x1 = int(cy - h / 2), int(cx - w / 2)
        if y1 < 0 or x1 < 0 or y1 + h > gray.shape[0] or x1 + w > gray.shape[1]:
            return None, 9, 0.0
        # AREA fraction, not the mean. A mean over a small box lights up on a
        # faint grey smudge that is visibly not a segment — which is how a 9 was
        # read as an 8. A real segment is a bright BAR: most of its area clears
        # the threshold. Requiring a fraction of lit pixels ignores a stray
        # bright pixel and a soft wash alike.
        patch = (gray[y1:y1 + h, x1:x1 + w] - lo) / span
        if patch.size == 0:
            return None, 9, 0.0
        frac = float((patch > pth).mean())
        conf += abs(frac - afrac)
        if frac >= afrac:
            on.add(name)
    best, bestd, second = None, 10, 10
    # compare only over the segments this field's model USES: the two centred
    # verticals mean nothing to the clock, and counting them there would let a
    # stray lit pixel push a good read over the reject distance
    used = set().union(*digits.values()) if digits else set()
    on &= used
    for d, pat in digits.items():
        dist = len(on ^ set(pat))
        if dist < bestd:
            best, bestd, second = d, dist, bestd
        elif dist < second:
            second = dist
    if bestd > 1 or second - bestd < 1:
        return None, bestd, 0.0
    return best, bestd, conf


def _read_sign(gray) -> str | None:
    """'+' (behind) has a vertical stroke through the cell centre; '-' (ahead)
    does not. Compare ink in a narrow vertical band against the horizontal bar
    that both share, so brightness and the colour pulse cancel out."""
    g = grid()
    sx0, sw = g.get("signBox", [SIGN_X, SIGN_W])
    x0, x1 = int(sx0), int(sx0 + sw)
    gy0, gy1 = g["glyphRows"]
    if x1 > gray.shape[1]:
        return None
    cell = gray[gy0:gy1, x0:x1]
    if cell.size == 0:
        return None
    lo, hi = np.percentile(cell, 10), np.percentile(cell, 90)
    if hi - lo < 18:                       # nothing rendered here
        return None
    norm = (cell.astype(np.float32) - lo) / max(hi - lo, 1.0)
    h, w = norm.shape
    # A '+' has a vertical STEM reaching above and below the shared bar; a '-'
    # is only the bar. So compare ink well clear of the bar against the bar
    # itself. The previous test sampled a vertical band through the middle,
    # which overlaps the bar and is therefore high for BOTH glyphs — it read
    # every sign as '-' once the box was placed accurately, which broke all ten
    # positives while the four negatives passed.
    # VERTICAL EXTENT of the ink in the centre columns. A '-' is only the bar,
    # so its ink occupies a thin band; a '+' adds a stem through the whole cell.
    # Comparing band means (the previous attempt) is fooled by anything bright
    # under the bar — on capture-card footage `below` read 0.624 for a plain '-'
    # and every sign inverted, while the digits decoded perfectly.
    cx0, cx1 = int(w * 0.30), int(w * 0.70)
    col = norm[:, cx0:cx1].max(axis=1)
    lit = col > 0.55
    if lit.sum() < 2:
        return None
    rows = np.where(lit)[0]
    extent = (rows[-1] - rows[0] + 1) / float(h)
    return "+" if extent > float(g.get("stemExtent", 0.45)) else "-"


def read_delta(frame, is_rgb: bool = False) -> dict | None:
    """Signed gap to the ghost, or None when the delta is not legible.

    Returns {"ms": int (positive = BEHIND), "sign": "+"/"-", "text": "+0:13.772"}.
    """
    # the ROI is CALIBRATED, not constant — cropping at the module defaults
    # while using calibrated columns samples the wrong window entirely
    rx, ry, rw, rh = grid().get("roi", [DELTA_X, DELTA_Y, DELTA_W, DELTA_H])
    crop = _crop(_to_bgr(frame, is_rgb), int(rx), int(ry), int(rw), int(rh))
    if crop is None:
        return None
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
    best = None
    # Read the sign first: it selects the column set, because the digits move
    # with the sign's width. Fall back to trying both when the sign is not
    # legible (mid-pulse), calibrated alignment first — several (dx, dy) can
    # reach dist 0 on one frame and the search keeps the first minimum, so an
    # uncalibrated offset tried first silently wins those ties.
    g = grid()
    sign = _read_sign(gray)
    # the sign selects the column set; when it is illegible mid-pulse, try both
    for sg in ((sign,) if sign else ("+", "-")):
        cols = g["columns"].get(sg) or g["columns"]["+"]
        for dy in (0, 1, -1, 2):
            for dx in (0, -1, 1):
                digits, dist, conf = [], 0, 0.0
                for col in cols:
                    d, dd, cc = _delta_digit(gray, col, dx, dy)
                    if d is None:
                        digits = None
                        break
                    digits.append(d)
                    dist += dd
                    conf += cc
                if digits is not None and (best is None or dist < best[1]):
                    best = (digits, dist, sg)
    if best is None:
        return None
    d = best[0]
    if int(d[1]) > 5:                       # seconds tens cannot exceed 5
        return None
    sign = sign or best[2]
    ms = (int(d[0]) * 60000 + int(d[1] + d[2]) * 1000 + int(d[3] + d[4] + d[5]))
    return {"ms": ms if sign == "+" else -ms, "sign": sign, "dist": best[1],
            "text": f"{sign}{d[0]}:{d[1]}{d[2]}.{d[3]}{d[4]}{d[5]}"}


def vote(readings: list, max_dist: int = 0) -> dict | None:
    """Pick the consensus across a window. The delta pulses through a washed-out
    phase where a frame can decode wrongly, so the value most frames agree on
    wins — the same lesson as the name strip, where 'longest wins' let a
    corrupted read beat a clean one."""
    # Only PERFECT segment matches vote. A fixed window necessarily spans
    # frames where the delta is absent, fading in, or washed out mid-pulse, and
    # those still produce a syntactically valid time — letting them vote turned
    # a correct +0:16.428 into +0:15.423. Requiring dist == 0 uses the decode
    # itself as the presence test, which template correlation cannot do here.
    # max_dist 0 when the caller has no independent presence test and needs the
    # decode itself to serve as one; 1 when the window is already known to hold
    # a delta (e.g. triggered by the frozen yellow lap time), where insisting on
    # a perfect match throws away correct reads.
    vals = [r for r in readings if r and r.get("dist", 9) <= max_dist]
    if not vals:
        return None
    tally: dict = {}
    for r in vals:
        tally[r["text"]] = tally.get(r["text"], 0) + 1
    top = max(tally.values())
    winner = sorted([t for t, c in tally.items() if c == top])[0]
    out = next(r for r in vals if r["text"] == winner)
    return dict(out, frames=top, of=len(vals))
