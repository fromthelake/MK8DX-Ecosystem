"""Optional colour evidence within one catalog family.

This diagnostic second pass never changes the primary ranking or accepted ID.
Exact-ID acceptance needs separate validation on real examples of every
competing variant.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .matcher import BOX, IconMatcher, Kind, MatchResult


# Real dark Yoshi/Birdo crops lose their body pixels under the hue saturation
# filter. On real body crops, hue also reranks many correct RGB choices wrongly.
# Other character families retain the hue probe until they have real-crop
# controls; in particular, RGB alone misses blue Inkling cases.
CUTOUT_RGB_FAMILIES = frozenset({("characters", "character.yoshi"),
                                ("characters", "character.birdo")})


@dataclass(frozen=True)
class VariantColourCandidate:
    id: str
    coarse_score: float
    distance: float


@dataclass(frozen=True)
class VariantColourRefinement:
    family_id: str
    status: str
    metric: str
    observed_pixels: int
    primary_top1: str
    ordered: tuple[VariantColourCandidate, ...]


def _oklab(rgb: np.ndarray) -> np.ndarray:
    linear = np.where(rgb <= .04045, rgb / 12.92,
                      ((rgb + .055) / 1.055) ** 2.4)
    lms = linear @ np.array([[.4122214708, .2119034982, .0883024619],
                             [.5363325363, .6806995451, .2817188376],
                             [.0514459929, .1073969566, .6299787005]], np.float32)
    return np.cbrt(np.maximum(lms, 0)) @ np.array(
        [[.2104542553, 1.9779984951, .0259040371],
         [.7936177850, -2.4285922050, .7827717662],
         [-.0040720468, .4505937099, -.8086757660]], np.float32)


def _balanced_hsv(rgb: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    angle = np.deg2rad(hsv[:, :, 0])
    saturation = hsv[:, :, 1]
    return np.stack((saturation * np.cos(angle), saturation * np.sin(angle),
                     hsv[:, :, 2]), axis=2)


def rank_family_colour_space(crop_bgr: np.ndarray, kind: Kind,
                             matcher: IconMatcher, primary: MatchResult, *,
                             metric: str, min_pixels: int = 24) -> VariantColourRefinement:
    """Optional fast, alpha-limited family colour rank on an already prepared crop.

    The first pass fixes family and alignment. The caller may supply a
    label-free, frame-calibrated crop; this function never changes acceptance.
    ``oklab_hue`` combines lightness/chroma and hue; ``oklab`` omits hue.
    """
    if metric not in ("oklab", "oklab_hue"):
        raise ValueError("Unsupported colour metric")
    if primary.method != "rgb" or primary.status == "absent" or not primary.family_top:
        raise ValueError("Expected a present RGB match with family ranking")
    if not isinstance(min_pixels, int) or isinstance(min_pixels, bool) or min_pixels < 1:
        raise ValueError("min_pixels must be positive")
    family = primary.family_top[0]
    if len(family.variants) < 2:
        raise ValueError("Selected family needs at least two variants")
    group = matcher.references.groups[(kind, primary.profile)]
    selected = np.asarray([i for i, name in enumerate(group.families)
                           if name == family.family_id], dtype=np.intp)
    references = group.rgb[selected]
    ids = [group.ids[i] for i in selected]
    masks = np.stack([cv2.erode((group.mask[i] > .15).astype(np.uint8),
                                np.ones((3, 3), np.uint8)) > 0 for i in selected])
    common = np.all(masks, axis=0)
    if int(common.sum()) < min_pixels:
        return VariantColourRefinement(family.family_id, "insufficient_cutout",
                                       metric, int(common.sum()), primary.top[0].id, ())
    spread = (references.max(axis=0) - references.min(axis=0)).max(axis=2)
    area = common & (spread >= np.percentile(spread[common], 85))
    count = int(area.sum())
    if count < min_pixels:
        return VariantColourRefinement(family.family_id, "insufficient_colour",
                                       metric, count, primary.top[0].id, ())
    query = cv2.cvtColor(cv2.resize(crop_bgr, BOX[kind], interpolation=cv2.INTER_AREA),
                         cv2.COLOR_BGR2RGB)
    if primary.offset != (0, 0):
        dx, dy = primary.offset
        query = cv2.warpAffine(query, np.float32([[1, 0, dx], [0, 1, dy]]),
                               BOX[kind], flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REPLICATE)
    query = query.astype(np.float32) / 255
    lab_query = _oklab(query) * np.array([1.5, 2.5, 2.5], np.float32)
    lab_refs = np.stack([_oklab(ref) for ref in references]) * np.array(
        [1.5, 2.5, 2.5], np.float32)
    distances = np.abs(lab_refs[:, area] - lab_query[area][None]).mean(axis=(1, 2))
    if metric == "oklab_hue":
        hue_query = _balanced_hsv(query)
        hue_refs = np.stack([_balanced_hsv(ref) for ref in references])
        distances += np.abs(hue_refs[:, area] - hue_query[area][None]).mean(axis=(1, 2))
    order = np.argsort(distances, kind="stable")
    coarse = {candidate.id: candidate.score for candidate in family.variants}
    ranked = tuple(VariantColourCandidate(ids[int(i)], coarse[ids[int(i)]],
                                          float(distances[int(i)])) for i in order)
    return VariantColourRefinement(family.family_id, "measured", metric, count,
                                   primary.top[0].id, ranked)


def refine_family_variants(crop_bgr: np.ndarray, kind: Kind,
                           matcher: IconMatcher, primary: MatchResult, *,
                           family_id: str | None = None,
                           min_pixels: int = 24) -> VariantColourRefinement:
    """Rank all variants of the chosen family using reference-derived colour.

    The primary pass chooses the family. Bodies and tested dark character
    families use an eroded per-candidate alpha cutout RGB comparison inspired
    by the old extractor; other families retain the exploratory hue ranking.
    Both use the same BGR crop, profile and chosen alignment offset.
    """
    if primary.method != "rgb" or primary.status == "absent" or not primary.family_top:
        raise ValueError("Expected a present RGB match with family ranking")
    if not isinstance(min_pixels, int) or isinstance(min_pixels, bool) or min_pixels < 1:
        raise ValueError("min_pixels must be positive")
    chosen_family = family_id or primary.family_top[0].family_id
    family = next((entry for entry in primary.family_top if entry.family_id == chosen_family), None)
    if family is None or len(family.variants) < 2:
        raise ValueError("Selected family needs at least two ranked variants")
    group = matcher.references.groups[(kind, primary.profile)]
    index = {rid: position for position, rid in enumerate(group.ids)}
    variants = family.variants
    selected = np.asarray([index[variant.id] for variant in variants], dtype=np.intp)
    references = group.rgb[selected]
    query = cv2.cvtColor(cv2.resize(crop_bgr, BOX[kind], interpolation=cv2.INTER_AREA),
                         cv2.COLOR_BGR2RGB)
    dx, dy = primary.offset
    if dx or dy:
        query = cv2.warpAffine(query, np.float32([[1, 0, dx], [0, 1, dy]]),
                               BOX[kind], flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REPLICATE)
    if kind == "bodies" or (kind, chosen_family) in CUTOUT_RGB_FAMILIES:
        kernel = np.ones((3, 3), dtype=np.uint8)
        masks = np.stack([cv2.erode((group.mask[i] > .15).astype(np.uint8), kernel) > 0
                          for i in selected])
        counts = masks.sum((1, 2))
        observed = int(counts.min())
        if observed < min_pixels:
            return VariantColourRefinement(chosen_family, "insufficient_cutout",
                                           "cutout_rgb", observed, primary.top[0].id, ())
        distances = (np.abs(references - query.astype(np.float32)[None] / 255.0)
                     * masks[:, :, :, None]).sum((1, 2, 3)) / (counts * 3)
        order = np.argsort(distances, kind="stable")
        ranked = tuple(VariantColourCandidate(variants[int(i)].id,
                                              variants[int(i)].score,
                                              float(distances[int(i)])) for i in order)
        return VariantColourRefinement(chosen_family, "measured", "cutout_rgb",
                                       observed, primary.top[0].id, ranked)
    common_mask = np.all(group.mask[selected] > .15, axis=0)
    reference_hsv = np.stack([cv2.cvtColor((ref * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
                              for ref in references])
    query_hsv = cv2.cvtColor(query, cv2.COLOR_RGB2HSV)
    difference = (references.max(axis=0) - references.min(axis=0)).mean(axis=2)
    colour_pixels = (common_mask & (reference_hsv[:, :, :, 1].max(axis=0) > 120)
                     & (difference > .12) & (query_hsv[:, :, 1] > 55))
    count = int(colour_pixels.sum())
    if count < min_pixels:
        return VariantColourRefinement(chosen_family, "insufficient_colour",
                                       "hue", count, primary.top[0].id, ())
    hue_delta = np.abs(reference_hsv[:, :, :, 0].astype(np.float32)
                       - query_hsv[None, :, :, 0].astype(np.float32))
    circular_delta = np.minimum(hue_delta, 180 - hue_delta)
    distances = (circular_delta * colour_pixels[None]).sum((1, 2)) / count
    order = np.argsort(distances, kind="stable")
    ranked = tuple(VariantColourCandidate(variants[int(i)].id,
                                          variants[int(i)].score,
                                          float(distances[int(i)])) for i in order)
    return VariantColourRefinement(chosen_family, "measured", "hue", count,
                                   primary.top[0].id, ranked)
