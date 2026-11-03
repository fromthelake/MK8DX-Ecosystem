"""Where inside its fixed slot does the flag sit? One central answer for every product.

The result card's flag slot is a few pixels larger than the flag itself: a grey
card border surrounds it. Read with that border the flag scores lower (a US
flag 0.80 instead of 0.87). Each product used to find the flag's own position
in its legacy reader and only some passed it on. Here the shared references
choose it: a crop of the slot minus a height-relative inset slides through the
slot's padded window, and the position whose best flag scores highest wins. A
small distance penalty keeps horizontal tricolours from shifting half a band.

TypeScript (``ts/sharedFlagWindow.ts``) and Java (``FlagWindow``) implement the
same search; each scores a position with its centre-only tensor match.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

from .matcher import IconMatcher

SCHEMA = "mk8dx.flag-window.v1"
WINDOW_PAD = 5          # pixels around the fixed slot the product cuts out
INSET_RATIO = 0.055     # the grey border, relative to the slot height
POSITION_PENALTY = 0.01  # per pixel from each size's centred crop
STEP = 2


def flag_inset(height: int) -> int:
    return max(2, int(round(INSET_RATIO * height)))


def search_flag_window(window_width: int, window_height: int, slot_xywh, score_at: Callable[[int, int, int, int], float]) -> dict:
    """The search itself, independent of pixels: ``score_at(left, top, width, height)``
    returns the best flag score of that crop. Two crop sizes compete: the full
    slot (right when a product's slot already sits tight on the flag) and the
    slot minus the border inset (right when the slot carries the grey border).
    Per size: the centred crop, a 2-px grid over the window, then the 1-px
    neighbours of that size's best; a strict improvement after the distance
    penalty replaces the overall best, the full slot first."""
    x, y, width, height = (int(v) for v in slot_xywh)
    if x < 0 or y < 0 or x + width > window_width or y + height > window_height:
        raise ValueError("Flag slot must fit its window")
    inset = flag_inset(height)
    sizes = ((width, height, x, y), (width - 2 * inset, height - 2 * inset, x + inset, y + inset))
    cache: dict[tuple[int, int, int, int], float] = {}

    def score(left: int, top: int, cw: int, ch: int) -> float:
        key = (left, top, cw, ch)
        if key not in cache:
            cache[key] = float(score_at(left, top, cw, ch))
        return cache[key]

    best = None  # (value, left, top, cw, ch)
    for cw, ch, cx, cy in sizes:
        def penalised(left: int, top: int) -> float:
            return score(left, top, cw, ch) - POSITION_PENALTY * (abs(left - cx) + abs(top - cy))

        size_best = (penalised(cx, cy), cx, cy)
        for top in range(0, window_height - ch + 1, STEP):
            for left in range(0, window_width - cw + 1, STEP):
                value = penalised(left, top)
                if value > size_best[0]:
                    size_best = (value, left, top)
        _, gx, gy = size_best
        for top in range(gy - 1, gy + 2):
            for left in range(gx - 1, gx + 2):
                if 0 <= left <= window_width - cw and 0 <= top <= window_height - ch:
                    value = penalised(left, top)
                    if value > size_best[0]:
                        size_best = (value, left, top)
        if best is None or size_best[0] > best[0]:
            best = (size_best[0], size_best[1], size_best[2], cw, ch)
    _, bx, by, bw, bh = best
    full = (bx, by, bw, bh) == (x, y, width, height)
    return {"schema": SCHEMA, "cropXywh": [bx, by, bw, bh],
            "basis": "fixed_slot" if full else "window_search",
            "score": score(bx, by, bw, bh), "slotScore": score(x, y, width, height), "evaluated": len(cache)}


def find_flag_crop(window_bgr: np.ndarray, slot_xywh: tuple[int, int, int, int],
                   matcher: IconMatcher) -> dict:
    """``search_flag_window`` on BGR pixels; positions in window coordinates."""
    if window_bgr.ndim != 3 or window_bgr.shape[2] != 3:
        raise ValueError("Expected a BGR window")
    window = np.ascontiguousarray(window_bgr)

    def score_at(left: int, top: int, width: int, height: int) -> float:
        return matcher.match(window[top:top + height, left:left + width], "flags", search_radius=0).score

    return search_flag_window(window.shape[1], window.shape[0], slot_xywh, score_at)
