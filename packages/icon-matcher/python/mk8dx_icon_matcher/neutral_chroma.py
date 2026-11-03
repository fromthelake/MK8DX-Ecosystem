"""Opt-in colour evidence when a neutral reference narrowly wins RGB matching.

This is the Web M1 saturation cue applied after the shared reader's bounded
alignment. It proposes an alternative within the existing visual top three;
the caller keeps the original rank and acceptance until a separate gate passes.
The arithmetic follows ``ts/sharedNeutralChroma.ts`` exactly (byte rounding,
HSV formula and clamped alignment), so every language reports the same values.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from .matcher import BOX, IconMatcher, MatchResult


def _js_round(value: float) -> int:
    return math.floor(value + .5)


def _as_byte(value: float) -> int:
    return max(0, min(255, _js_round(float(value) * 255)))


def _hsv(rgb) -> tuple[int, int]:
    r, g, b = (_as_byte(v) for v in rgb)
    high, low = max(r, g, b), min(r, g, b)
    delta = high - low
    saturation = 0 if high == 0 else _js_round(delta * 255 / high)
    if delta == 0:
        return 0, saturation
    if high == r:
        degrees = 60 * (g - b) / delta
    elif high == g:
        degrees = 120 + 60 * (b - r) / delta
    else:
        degrees = 240 + 60 * (r - g) / delta
    if degrees < 0:
        degrees += 360
    return _js_round(degrees / 2) % 180, saturation


def rank_neutral_reference(crop_bgr: np.ndarray, matcher: IconMatcher,
                           visual: MatchResult) -> dict:
    """Return a label-free alternative for a saturated query versus a pale icon."""
    if visual.profile != "result" or visual.method != "rgb" or not visual.top:
        raise ValueError("Neutral reference review requires a visible RGB result")
    group = matcher.references.groups[("characters", "result")]
    index = {rid: i for i, rid in enumerate(group.ids)}
    if visual.top[0].id not in index:
        raise ValueError("Visual winner is not a result character")
    first = visual.top[0]
    height, width = group.rgb.shape[1:3]

    def reference_saturation(rid: str) -> float:
        position = index[rid]
        rgb, mask = group.rgb[position], group.mask[position]
        values = [_hsv(rgb[y, x])[1] for y in range(height) for x in range(width) if mask[y, x]]
        return sum(values) / len(values) / 255 if values else 0.0

    first_sat = reference_saturation(first.id)
    result = {"schema": "mk8dx.neutral-chroma-review.v1",
              "status": "not_applicable", "rawTop1Id": first.id,
              "proposalId": first.id, "rawScore": first.score,
              "proposalScore": first.score, "referenceSaturation": first_sat,
              "querySaturation": None, "offset": list(visual.offset),
              "considered": []}
    if first_sat > .06:
        return result
    query = cv2.cvtColor(cv2.resize(crop_bgr, BOX["characters"], interpolation=cv2.INTER_AREA),
                         cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    dx, dy = visual.offset
    mask = group.mask[index[first.id]]
    total = count = 0
    for y in range(height):
        for x in range(width):
            if not mask[y, x]:
                continue
            hue, sat = _hsv(query[max(0, min(height - 1, y - dy)), max(0, min(width - 1, x - dx))])
            if 18 <= hue <= 36:
                continue
            total += sat
            count += 1
    if not count:
        result["status"] = "insufficient_pixels"
        return result
    query_sat = total / count / 255
    result["querySaturation"] = query_sat
    if query_sat < .12:
        result["status"] = "insufficient_colour"
        return result
    result["status"] = "measured"
    for candidate in visual.top[1:3]:
        if candidate.id not in index:
            continue
        ref_sat = reference_saturation(candidate.id)
        gap = first.score - candidate.score
        result["considered"].append({"id": candidate.id, "score": candidate.score,
                                     "referenceSaturation": ref_sat, "scoreGap": gap})
        if ref_sat > .06 and gap <= .02:
            result.update(status="alternative", proposalId=candidate.id,
                          proposalScore=candidate.score)
            break
    return result
