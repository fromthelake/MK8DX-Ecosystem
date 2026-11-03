"""Result-flag refinements: distinctive rank and the NL/LU/PY tricolour check.

Python counterparts of ``ts/sharedFlagDistinctive.ts`` and
``ts/sharedFlagTricolor.ts``. Both work on the same normalised crop as the
ordinary read (INTER_AREA to the reference size, RGB in 0..1) and only add
evidence; the decision is ``result_proposal.compose_result_proposal``.
"""

from __future__ import annotations

import cv2
import numpy as np

from .matcher import _Group

NL, LU, PY = "country.nl", "country.lu", "country.py"


def normalized_query(crop_bgr: np.ndarray, group: _Group) -> np.ndarray:
    """(H, W, 3) RGB float32 in 0..1, exactly as the TypeScript reader."""
    height, width = group.rgb.shape[1:3]
    small = cv2.resize(crop_bgr, (width, height), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(small, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0


def distinctive_flag_rank(query: np.ndarray, group: _Group, ids: list[str]) -> list[dict]:
    """Second rank of three shortlisted flags on the channels that differ most."""
    if len(ids) != 3 or len(set(ids)) != 3 or query.shape != group.rgb.shape[1:]:
        raise ValueError("Expected normalized RGB and three distinct flag references")
    try:
        refs = np.stack([group.rgb[group.ids.index(i)] for i in ids]).reshape(3, -1).astype(np.float64)
    except ValueError as error:
        raise ValueError("Unknown shortlisted flag") from error
    q = query.reshape(-1).astype(np.float64)
    weight = refs.max(0) - refs.min(0) + 0.01
    distances = (np.abs(refs - q) * weight).sum(1) / weight.sum()
    ranked = [{"id": i, "distance": float(d)} for i, d in zip(ids, distances)]
    return sorted(ranked, key=lambda item: (item["distance"], ids.index(item["id"])))


def _median(values: np.ndarray) -> float:
    return float(np.median(values))


# NL and LU share the red band (assets 194,57,55 and 200,59,45); only the blue
# differs (4,89,164 against 55,148,213). The green of the blue band relative to
# the red band's red is therefore a self-calibrating tone: assets 0.46 / 0.74,
# measured 2026-10-23 NL 0.27-0.58 on 300+ photo and HDMI crops, LU 0.73-0.77.
BAND_RATIO_NL_MAX = 0.62
BAND_RATIO_LU_MIN = 0.68
BAND_RATIO_MIN_PIXELS = 15


def _hue_sat_val(query: np.ndarray):
    """OpenCV-style HSV on RGB 0..1: hue in degrees, saturation and value in 0..1."""
    rgb = query.astype(np.float64)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    top, low = rgb.max(2), rgb.min(2)
    delta = top - low
    sat = np.where(top > 0, delta / np.where(top > 0, top, 1), 0.0)
    hue = np.zeros_like(top)
    chroma = delta > 0
    safe = np.where(chroma, delta, 1)
    is_r = chroma & (top == r)
    is_g = chroma & (top == g) & ~is_r
    is_b = chroma & ~is_r & ~is_g
    hue = np.where(is_r, np.mod(60 * (g - b) / safe, 360), hue)
    hue = np.where(is_g, 60 * (b - r) / safe + 120, hue)
    hue = np.where(is_b, 60 * (r - g) / safe + 240, hue)
    return hue, sat, top, chroma


def flag_band_ratio(query: np.ndarray) -> dict:
    """NL/LU decision from the blue band's green over the red band's red."""
    if query.ndim != 3 or query.shape[2] != 3:
        raise ValueError("Expected normalized RGB")
    hue, sat, val, chroma = _hue_sat_val(query)
    red = chroma & ((hue <= 16) | (hue >= 340)) & (sat >= 0.35) & (val >= 0.24)
    blue = chroma & (hue >= 190) & (hue <= 250) & (sat >= 0.35) & (val >= 0.16)
    base = {"schema": "mk8dx.flag-band-ratio.v1", "redPixels": int(red.sum()), "bluePixels": int(blue.sum()),
            "nlMax": BAND_RATIO_NL_MAX, "luMin": BAND_RATIO_LU_MIN}
    if base["redPixels"] < BAND_RATIO_MIN_PIXELS or base["bluePixels"] < BAND_RATIO_MIN_PIXELS:
        return {**base, "status": "unavailable", "reason": "bands_not_found", "ratio": None, "decisionId": None}
    rgb = query.astype(np.float64)
    ratio = _median(rgb[..., 1][blue]) / max(_median(rgb[..., 0][red]), 0.05)
    decision = NL if ratio <= BAND_RATIO_NL_MAX else LU if ratio >= BAND_RATIO_LU_MIN else None
    return {**base, "status": "measured", "reason": "nl_tone" if decision == NL else "lu_tone" if decision else "between",
            "ratio": ratio, "decisionId": decision}


def flag_tricolor_evidence(query: np.ndarray, group: _Group, raw_top_ids: list[str],
                           distinctive_top_id: str, shape_rank: dict | None = None) -> dict:
    """Evidence for an uncertain NL first choice against LU and PY."""
    def unavailable(reason: str) -> dict:
        return {"schema": "mk8dx.flag-tricolor-evidence.v1", "status": "unavailable", "reason": reason,
                "acceptedId": None, "stripeContrast": None, "stripeBoundary": None, "pairAdvantages": []}

    height, width = group.rgb.shape[1:3]
    if (width != 55 or height != 38 or query.shape != (38, 55, 3) or len(group.ids) != 110
            or len(raw_top_ids) < 3 or len(set(raw_top_ids)) != len(raw_top_ids)):
        raise ValueError("Expected one result-profile crop and 110 flag references")
    if raw_top_ids[0] != NL:
        return unavailable("different_first_flag")
    if distinctive_top_id != NL:
        return unavailable("distinctive_disagreement")
    index = {rid: i for i, rid in enumerate(group.ids)}
    if not all(rid in index for rid in (NL, LU, PY, *raw_top_ids)):
        raise ValueError("Missing result flag reference")

    def ref(rid):
        return group.rgb[index[rid]].astype(np.float64)

    def sample(rgb, y0, y1, channel):
        return _median(np.asarray(rgb[y0:y1, 12:43, channel], np.float64))

    def stripe(rgb):
        return 1 - sample(rgb, 25, 30, 1) / max(.1, sample(rgb, 16, 22, 1))

    nl_stripe, lu_stripe = stripe(ref(NL)), stripe(ref(LU))
    if not lu_stripe < nl_stripe:
        return unavailable("incompatible_reference_stripes")
    boundary = (nl_stripe + lu_stripe) / 2
    contrast = stripe(query)

    def white(rgb):
        return [sample(rgb, 16, 22, c) for c in range(3)]

    query_white, nl = white(query), ref(NL)
    nl_white = white(nl)
    pairs = []
    seen = []
    for rid in [*raw_top_ids[1:], PY]:
        if rid in seen:
            continue
        seen.append(rid)
        if rid in (LU, NL):
            continue
        other = ref(rid)
        other_white = white(other)
        different = np.zeros((height, width), np.uint8)
        different[4:34, 8:47] = (np.abs(nl[4:34, 8:47] - other[4:34, 8:47]).max(2) > .055)
        advantage = separation = 0.0
        pixels = 0
        for y in range(5, 33):
            for x in range(9, 46):
                if not different[y - 1:y + 2, x - 1:x + 2].all():
                    continue
                for c in range(3):
                    q = min(1.2, float(query[y, x, c]) / max(.1, query_white[c]))
                    a = min(1.2, float(nl[y, x, c]) / max(.1, nl_white[c]))
                    b = min(1.2, float(other[y, x, c]) / max(.1, other_white[c]))
                    advantage += abs(q - b) - abs(q - a)
                    separation += abs(a - b)
                pixels += 1
        if pixels < 20:
            return unavailable("insufficient_distinctive_pixels")
        pairs.append({"id": rid, "advantage": advantage / (pixels * 3),
                      "referenceSeparation": separation / (pixels * 3)})
    supported = (contrast > boundary and len(pairs) > 0
                 and all(p["advantage"] > .2 * p["referenceSeparation"] for p in pairs))
    top = (shape_rank or {}).get("top") or []
    lu_pattern = (not supported and contrast <= lu_stripe + (nl_stripe - lu_stripe) / 4
                  and (shape_rank or {}).get("mode") == "full_rgb_ncc" and top
                  and top[0].get("id") == LU and np.isfinite(top[0].get("score", np.nan))
                  and top[0]["score"] > 0)
    result = {"schema": "mk8dx.flag-tricolor-evidence.v1", "status": "measured",
              "reason": ("reference_stripes_and_pairwise_agree" if supported
                         else "lu_pattern_and_stripe_agree" if lu_pattern else "insufficient_separation"),
              "acceptedId": NL if supported else None, "stripeContrast": contrast,
              "stripeBoundary": boundary, "pairAdvantages": pairs}
    if lu_pattern:
        result.update(proposalId=LU, proposalShapeScore=top[0]["score"])
    return result
