"""Opt-in, source-only camera evidence for an aligned Ghost Select frame.

Geometry belongs to the caller. No partner frame, staff record, human label or
product prediction participates in inference. Direct-capture callers keep
their existing route until a separate product gate qualifies a change.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .matcher import IconMatcher, Kind, Profile
from .refinement import refine_family_variants


def _crop(frame: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    if (not isinstance(frame, np.ndarray) or frame.dtype != np.uint8 or frame.ndim != 3
            or frame.shape[2] != 3 or not isinstance(box, tuple) or len(box) != 4
            or any(not isinstance(value, int) or isinstance(value, bool) for value in box)):
        raise ValueError("Expected uint8 BGR frame and integer box")
    x, y, width, height = box
    if width < 1 or height < 1 or x < 0 or y < 0 or x + width > frame.shape[1] or y + height > frame.shape[0]:
        raise ValueError("Box must fit the source frame")
    return frame[y:y+height, x:x+width]


@dataclass(frozen=True)
class FlagColourCalibration:
    flag_id: str
    flag_score: float
    flag_margin: float
    slopes: tuple[float, float, float]
    offsets: tuple[float, float, float]
    residuals: tuple[float, float, float]
    stable_pixels: int

    def apply(self, crop_bgr: np.ndarray) -> np.ndarray:
        if not isinstance(crop_bgr, np.ndarray) or crop_bgr.dtype != np.uint8 or crop_bgr.ndim != 3 or crop_bgr.shape[2] != 3:
            raise ValueError("Expected uint8 BGR crop")
        return np.clip((crop_bgr.astype(np.float32) - self.offsets) / self.slopes, 0, 255).astype(np.uint8)


def flag_colour_calibration(frame_bgr: np.ndarray, flag_slot: tuple[int, int, int, int],
                            matcher: IconMatcher) -> FlagColourCalibration | None:
    """Fit the observed flag's three channels to its own ranked game asset.

    The flag's spatial candidate must first pass the existing score/margin
    gate. A poorly conditioned or high-residual photometric fit is rejected.
    """
    _crop(frame_bgr, flag_slot)
    flag = matcher.match_flag_window(frame_bgr, flag_slot)
    if flag.accepted_id is None:
        return None
    group = matcher.references.groups[("flags", "result")]
    index = group.ids.index(flag.accepted_id)
    reference = np.clip(group.rgb[index, :, :, ::-1] * 255, 0, 255).astype(np.uint8)
    reference = cv2.resize(reference,
                           (round(reference.shape[1] * flag.scale), round(reference.shape[0] * flag.scale)),
                           interpolation=cv2.INTER_AREA)
    x, y, _, _ = flag_slot
    x += flag.offset_px[0]
    y += flag.offset_px[1]
    observed = frame_bgr[y:y+reference.shape[0], x:x+reference.shape[1]]
    if observed.shape != reference.shape:
        return None
    gradient = np.max(np.abs(cv2.Sobel(reference, cv2.CV_32F, 1, 0, ksize=3))
                      + np.abs(cv2.Sobel(reference, cv2.CV_32F, 0, 1, ksize=3)), axis=2)
    stable = gradient < 60
    stable[:2] = stable[-2:] = False
    stable[:, :2] = stable[:, -2:] = False
    if stable.sum() < 150:
        return None
    source = reference[stable].astype(np.float32)
    measured = observed[stable].astype(np.float32)
    slopes, offsets, residuals = [], [], []
    for channel in range(3):
        target, camera = source[:, channel], measured[:, channel]
        if target.var() < 250:
            return None
        slope = float(np.cov(target, camera, bias=True)[0, 1] / target.var())
        offset = float(camera.mean() - slope * target.mean())
        error = np.abs(camera - (slope * target + offset))
        keep = error <= np.percentile(error, 80)
        if keep.sum() < 100 or target[keep].var() < 250:
            return None
        slope = float(np.cov(target[keep], camera[keep], bias=True)[0, 1] / target[keep].var())
        offset = float(camera[keep].mean() - slope * target[keep].mean())
        residual = float(np.sqrt(np.mean((camera[keep] - (slope * target[keep] + offset)) ** 2)))
        if not (.30 <= slope <= 1.7 and -80 <= offset <= 80 and residual <= 35):
            return None
        slopes.append(slope)
        offsets.append(offset)
        residuals.append(residual)
    return FlagColourCalibration(flag.proposed_id, round(flag.score, 5),
                                 round(flag.margin, 5), tuple(slopes), tuple(offsets),
                                 tuple(residuals), int(stable.sum()))


def digit_neutral_clahe_crop(frame_bgr: np.ndarray, digits_box: tuple[int, int, int, int],
                             field_box: tuple[int, int, int, int]) -> tuple[np.ndarray, tuple[float, float, float]]:
    """Fallback white balance from visible bright digits plus local contrast."""
    digits = _crop(frame_bgr, digits_box)
    original = _crop(frame_bgr, field_box)
    brightness = digits.max(axis=2)
    bright = digits[brightness >= np.percentile(brightness, 85)]
    levels = np.median(bright, axis=0)
    gains = np.clip(levels.mean() / np.maximum(levels, 1), .75, 1.35)
    neutral = np.clip(original.astype(np.float32) * gains, 0, 255).astype(np.uint8)
    lab = cv2.cvtColor(neutral, cv2.COLOR_BGR2LAB)
    light, a, b = cv2.split(lab)
    contrast = cv2.cvtColor(cv2.merge((cv2.createCLAHE(clipLimit=1.5, tileGridSize=(4, 4)).apply(light), a, b)),
                            cv2.COLOR_LAB2BGR)
    return contrast, tuple(float(value) for value in gains)


def rank_family_then_variant(matcher: IconMatcher, crop_bgr: np.ndarray, kind: Kind,
                             profile: Profile = "result") -> dict:
    """NCC chooses a shape family; masked RGB orders only its variants.

    This diagnostic keeps family and variant evidence separate. Its current
    real-camera qualification covers Ghost Select characters only.
    """
    if kind == "flags":
        raise ValueError("Flags use spatial flag matching, not variant refinement")
    shape = matcher.match(crop_bgr, kind, profile=profile, method="ncc")
    group = matcher.references.groups[(kind, profile)]
    colour = matcher.match(crop_bgr, kind, profile=profile, method="rgb",
                           top_k=len(group.ids))
    family = shape.family_top[0]
    variants = [item for item in colour.top if item.family_id == family.family_id]
    if not variants:
        raise ValueError("Selected family has no colour variants")
    family_margin = family.score - shape.family_top[1].score if len(shape.family_top) > 1 else family.score
    variant_margin = variants[0].score - variants[1].score if len(variants) > 1 else variants[0].score
    accepted = (family.score >= .35 and family_margin >= .02 and variants[0].score >= .8
                and (len(variants) == 1 or variant_margin >= .02))
    refinement = None
    if len(variants) > 1 and any(item.family_id == family.family_id for item in colour.family_top):
        fine = refine_family_variants(crop_bgr, kind, matcher, colour, family_id=family.family_id)
        refinement = {"status": fine.status, "metric": fine.metric,
                      "top3": [item.id for item in fine.ordered[:3]],
                      "distances": [round(item.distance, 5) for item in fine.ordered[:3]]}
    return {"top1": variants[0].id, "accepted": variants[0].id if accepted else None,
            "familyId": family.family_id, "familyScore": round(family.score, 5),
            "familyMargin": round(family_margin, 5), "variantScore": round(variants[0].score, 5),
            "variantMargin": round(variant_margin, 5),
            "variantTop3": [item.id for item in variants[:3]],
            "familyTop3": [item.family_id for item in shape.family_top[:3]],
            "rawTop3": [{"id": item.id, "familyId": item.family_id, "score": round(item.score, 5)}
                        for item in colour.top[:3]],
            "variantCandidates": [{"id": item.id, "familyId": item.family_id,
                                   "score": round(item.score, 5)} for item in variants[:3]],
            "familyCandidates": [{"familyId": item.family_id, "score": round(item.score, 5)}
                                 for item in shape.family_top[:3]],
            "refinement": refinement}
