"""Optional result-flag exposure proposal on the selected crop.

This is the Python counterpart of ``ts/sharedFlagExposure.ts``. It keeps the
ordinary field decision separate and never grants automatic acceptance.
"""

from __future__ import annotations

import cv2
import numpy as np

from .matcher import IconMatcher, _Group


def _upper_quartile(rgb: np.ndarray) -> float:
    values = np.sort(np.max(rgb, axis=2).ravel())
    return float(values[round(.75 * (len(values) - 1))])


def _band(rgb: np.ndarray, y0: int, y1: int, channel: int) -> float:
    values = np.sort(rgb[y0:y1, 12:43, channel].ravel())
    return float(values[len(values) // 2])


def _blue_green(rgb: np.ndarray) -> float:
    green = _band(rgb, 25, 30, 1) / max(.1, _band(rgb, 16, 22, 1))
    blue = _band(rgb, 25, 30, 2) / max(.1, _band(rgb, 16, 22, 2))
    return blue / max(.1, green)


def _corrected_top(query: np.ndarray, group: _Group) -> list[dict]:
    scores = IconMatcher._score(query, group, "rgb")
    center = np.argsort(-scores, kind="stable")
    families = {group.families[int(index)] for index in center[:8]}
    selected = np.asarray([index for index, family in enumerate(group.families)
                           if family in families], dtype=np.intp)
    subset = _Group(tuple(group.ids[int(index)] for index in selected),
                    tuple(group.families[int(index)] for index in selected),
                    group.rgb[selected], group.mask[selected], group.count[selected])
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            if dx == 0 and dy == 0:
                continue
            shifted = cv2.warpAffine(query, np.float32([[1, 0, dx], [0, 1, dy]]),
                                     (55, 38), flags=cv2.INTER_LINEAR,
                                     borderMode=cv2.BORDER_REPLICATE)
            scores[selected] = np.maximum(scores[selected], IconMatcher._score(shifted, subset, "rgb"))
    order = np.argsort(-scores, kind="stable")[:3]
    return [{"id": group.ids[int(index)], "score": float(scores[index])} for index in order]


def flag_exposure_proposal(crop_bgr: np.ndarray, group: _Group, shape: dict) -> dict:
    """Return a named, review-only exposure rank; labels are never inputs."""
    if (crop_bgr.ndim != 3 or crop_bgr.shape[2] != 3 or crop_bgr.dtype != np.uint8
            or len(group.ids) != 110 or group.rgb.shape != (110, 38, 55, 3)
            or group.mask.shape != (110, 38, 55)):
        raise ValueError("Expected one result flag crop and 110 references")

    def unavailable(reason: str, gain: float | None = None,
                    reference_id: str | None = None) -> dict:
        return {"schema": "mk8dx.flag-exposure-proposal.v1", "status": "unavailable",
                "reason": reason, "gain": gain, "referenceId": reference_id, "top": []}

    top = shape.get("top", [])
    if shape.get("mode") != "full_rgb_ncc" or not top:
        return unavailable("no_pattern_rank")
    reference_id = top[0]["id"]
    if reference_id not in group.ids:
        return unavailable("unknown_pattern_reference")
    index = group.ids.index(reference_id)
    query = cv2.cvtColor(cv2.resize(crop_bgr, (55, 38), interpolation=cv2.INTER_AREA),
                         cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    observed = _upper_quartile(query)
    expected = _upper_quartile(group.rgb[index])
    if not (observed > .1 and expected > .1):
        return unavailable("insufficient_brightness")
    gain = min(1.8, expected / observed)
    if gain < 1.25:
        return unavailable("exposure_within_normal_range", gain, reference_id)
    rank = _corrected_top(np.minimum(1, query * np.float32(gain)), group)
    result = {"schema": "mk8dx.flag-exposure-proposal.v1", "status": "measured",
              "reason": "pattern_reference_exposure", "gain": gain,
              "referenceId": reference_id, "top": rank}
    if (reference_id == "country.lu" and rank[0]["id"] == "country.lu"
            and any(item["id"] == "country.nl" for item in rank)):
        nl = group.rgb[group.ids.index("country.nl")]
        lu = group.rgb[group.ids.index("country.lu")]
        observed_band, nl_band, lu_band = _blue_green(query), _blue_green(nl), _blue_green(lu)
        preferred = ("country.nl" if abs(observed_band - nl_band) < abs(observed_band - lu_band)
                     else "country.lu")
        result["tricolorBand"] = {"observed": observed_band, "nlReference": nl_band,
                                   "luReference": lu_band, "preferredId": preferred}
        if preferred == "country.nl":
            rank.sort(key=lambda item: item["id"] != "country.nl")
    return result
