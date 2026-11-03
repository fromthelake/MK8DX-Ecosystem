"""The central Select-a-Ghost panel registration decision (CENTRAL_RECOGNITION section 8.6,
phase 5): whether the panel's constant parts, found near their place on the clean reference, give
one homography that may straighten the canonical panel.

One specification in Python (this reference), TypeScript (``ts/sharedPanelRegistration.ts``) and
Java (``PanelRegistration.java``), taken from the Web scanner's ``ghostPanelRegistration`` (a port of
the APK engine overlay, ADR-0203). The products keep the pixel work and hand it in:

- ``match(index, window)``: the anchor's gradient patch matched in that window of the canonical's
  gradient image (TM_CCOEFF_NORMED); returns ``(score, x, y, left, right, up, down)``: the peak and
  its four neighbours in the result map (None at the map's border);
- ``homography(found, reference)``: ``(h, inliers)`` from OpenCV ``findHomography`` (RANSAC, 2 px),
  ``h`` the 9 numbers row by row or None.

The rule: every anchor is searched 30 px sideways and 12 px up/down around its reference box (less
than half a 7-lap row, so a row never finds its neighbour's ':'); a peak below 0.45 is no anchor;
the peak is refined to sub-pixel by a parabola through its neighbours. At least 8 anchors, at least
8 inliers and 70 % of the anchors must agree, and the homography may move no anchor more than 40 px.
"""

from __future__ import annotations

import math

SEARCH_X = 30
SEARCH_Y = 12
MIN_SCORE = 0.45
MIN_ANCHORS = 8
MIN_INLIER_SHARE = 0.7
MAX_SHIFT = 40.0
RANSAC_THRESHOLD = 2.0


def anchor_window(box: list, image_w: int, image_h: int) -> list | None:
    """``[left, top, right, bottom]`` searched for an anchor whose reference box is ``box``, or None
    when the window cannot hold the patch with a pixel to spare on each side."""
    left, top, right, bottom = box
    wl, wt = max(0, left - SEARCH_X), max(0, top - SEARCH_Y)
    wr, wb = min(image_w, right + SEARCH_X), min(image_h, bottom + SEARCH_Y)
    if wr - wl < (right - left) + 2 or wb - wt < (bottom - top) + 2:
        return None
    return [wl, wt, wr, wb]


def sub_pixel_peak(before, peak: float, after) -> float:
    """The parabola vertex offset through a peak and its two neighbours (0 at the border)."""
    if before is None or after is None:
        return 0.0
    den = before - 2.0 * peak + after
    return 0.0 if den == 0 else 0.5 * (before - after) / den


def register_panel(variant: str, boxes: list, image_w: int, image_h: int, match, homography) -> dict:
    """``{"h": [9] | None, "info": {...}}``; ``boxes``: the reference boxes of the variant's anchors."""
    info = {"variant": variant, "anchors": len(boxes), "applied": False}
    found: list = []
    reference: list = []
    for index, box in enumerate(boxes):
        window = anchor_window(box, image_w, image_h)
        if window is None:
            continue
        score, x, y, left, right, up, down = match(index, window)
        if score < MIN_SCORE:
            continue
        px = x + sub_pixel_peak(left, score, right)
        py = y + sub_pixel_peak(up, score, down)
        found.append([window[0] + px + (box[2] - box[0]) / 2, window[1] + py + (box[3] - box[1]) / 2])
        reference.append([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2])
    n = len(found)
    info["found"] = n
    if n < MIN_ANCHORS:
        info["reason"] = "too_few_anchors"
        return {"h": None, "info": info}
    h, inliers = homography(found, reference)
    info["inliers"] = inliers
    if h is None or inliers < MIN_ANCHORS or inliers < MIN_INLIER_SHARE * n:
        info["reason"] = "anchors_disagree"
        return {"h": None, "info": info}
    shift = 0.0
    sum_sq = 0.0
    for (x, y), (rx, ry) in zip(found, reference):
        w = h[6] * x + h[7] * y + h[8]
        qx = (h[0] * x + h[1] * y + h[2]) / w
        qy = (h[3] * x + h[4] * y + h[5]) / w
        shift = max(shift, math.hypot(qx - x, qy - y))
        sum_sq += (qx - rx) * (qx - rx) + (qy - ry) * (qy - ry)
    info["max_shift_px"] = shift
    info["rms_px"] = math.sqrt(sum_sq / n)
    if shift > MAX_SHIFT:
        info["reason"] = "implausible_shift"
        return {"h": None, "info": info}
    info["applied"] = True
    return {"h": list(h), "info": info}
