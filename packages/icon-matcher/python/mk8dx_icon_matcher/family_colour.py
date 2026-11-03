"""OKLab colour order within the first visual character family.

Python counterpart of ``ts/sharedFamilyColour.ts`` (rankCharacterFamilyColour),
computed in double precision like JavaScript. It only proposes an order; the
decision is ``result_proposal.compose_result_proposal``.
"""

from __future__ import annotations

import math

import numpy as np

from .matcher import MatchResult, _Group


def _oklab(rgb: np.ndarray) -> np.ndarray:
    v = rgb.astype(np.float64)
    lin = np.where(v <= .04045, v / 12.92, ((v + .055) / 1.055) ** 2.4)
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    l_ = np.cbrt(np.maximum(0, .4122214708 * r + .5363325363 * g + .0514459929 * b))
    m_ = np.cbrt(np.maximum(0, .2119034982 * r + .6806995451 * g + .1073969566 * b))
    s_ = np.cbrt(np.maximum(0, .0883024619 * r + .2817188376 * g + .6299787005 * b))
    return np.stack([1.5 * (.2104542553 * l_ + .7936177850 * m_ - .0040720468 * s_),
                     2.5 * (1.9779984951 * l_ - 2.4285922050 * m_ + .4505937099 * s_),
                     2.5 * (.0259040371 * l_ + .7827717662 * m_ - .8086757660 * s_)], -1)


def rank_character_family_colour(query: np.ndarray, group: _Group, primary: MatchResult,
                                 min_pixels: int = 24) -> dict | None:
    height, width = group.rgb.shape[1:3]
    if query.shape != (height, width, 3) or not primary.top or min_pixels < 1:
        raise ValueError("Incompatible character colour tensors")
    family_id = primary.top[0].family_id
    members = [i for i, f in enumerate(group.families) if f == family_id]
    if len(members) < 2:
        return None

    def result(status, observed, top=()):
        return {"schema": "mk8dx.family-colour-rank.v1", "method": "oklab", "familyId": family_id,
                "status": status, "observedPixels": observed, "top": list(top)}

    masks = group.mask[members] != 0
    # 3x3 erosion that ignores the outside border, as the TypeScript loop does.
    padded = np.pad(masks, ((0, 0), (1, 1), (1, 1)), constant_values=True)
    eroded = np.ones_like(masks)
    for dy in range(3):
        for dx in range(3):
            eroded &= padded[:, dy:dy + height, dx:dx + width]
    common_mask = eroded.all(0)
    refs = group.rgb[members].astype(np.float64)
    spread_map = (refs.max(0) - refs.min(0)).max(-1)
    common = [y * width + x for y in range(height) for x in range(width) if common_mask[y, x]]
    spreads = [float(spread_map[p // width, p % width]) for p in common]
    if len(common) < min_pixels:
        return result("insufficient_cutout", len(common))
    ordered = sorted(spreads)
    position = (len(ordered) - 1) * .85
    lower = math.floor(position)
    cutoff = ordered[lower] + (ordered[math.ceil(position)] - ordered[lower]) * (position - lower)
    area = [p for p, s in zip(common, spreads) if s >= cutoff]
    if len(area) < min_pixels:
        return result("insufficient_colour", len(area))
    dx, dy = primary.offset
    ys = np.array([p // width for p in area])
    xs = np.array([p % width for p in area])
    sy = np.clip(ys - dy, 0, height - 1)
    sx = np.clip(xs - dx, 0, width - 1)
    observed = _oklab(query[sy, sx])
    distances = []
    for member in members:
        reference = _oklab(group.rgb[member][ys, xs])
        total = float(np.abs(reference - observed).sum())
        distances.append({"id": group.ids[member], "distance": total / (len(area) * 3)})
    distances.sort(key=lambda item: item["distance"])
    return result("measured", len(area), distances)
