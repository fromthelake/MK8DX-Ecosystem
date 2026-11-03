from pathlib import Path
import sys

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mk8dx_icon_matcher.matcher import IconMatcher, ReferenceBank, _Group
from mk8dx_icon_matcher.optical_ghost import (digit_neutral_clahe_crop,
                                              flag_colour_calibration,
                                              rank_family_then_variant)


def group(ids, families, images):
    rgb = np.stack([image[:, :, ::-1].astype(np.float32) / 255 for image in images])
    mask = np.ones(rgb.shape[:3], np.float32)
    return _Group(tuple(ids), tuple(families), rgb, mask, mask.sum((1, 2)))


def test_flag_anchored_fit_recovers_camera_colour_without_changing_source():
    refs = ReferenceBank.__new__(ReferenceBank)
    flag = np.zeros((38, 55, 3), np.uint8)
    flag[:, :19] = (15, 40, 210)
    flag[:, 19:37] = (205, 45, 20)
    flag[:, 37:] = (25, 210, 40)
    other = np.roll(flag, 14, axis=1)
    refs.groups = {("flags", "result"): group(("country.first", "country.second"),
                                                ("country.first", "country.second"),
                                                (flag, other))}
    matcher = IconMatcher(refs)
    frame = np.zeros((90, 110, 3), np.uint8)
    frame[23:61, 25:80] = np.clip(flag.astype(np.float32) * .7 + 15, 0, 255).astype(np.uint8)
    original = frame.copy()
    fit = flag_colour_calibration(frame, (27, 24, 55, 38), matcher)
    assert fit is not None and fit.flag_id == "country.first"
    assert fit.stable_pixels >= 150
    sample = np.array([[[80, 120, 180]]], np.uint8)
    observed = np.clip(sample.astype(np.float32) * .7 + 15, 0, 255).astype(np.uint8)
    assert np.max(np.abs(fit.apply(observed).astype(int) - sample.astype(int))) <= 3
    assert np.array_equal(frame, original)


def test_family_first_orders_variants_and_fallback_preserves_frame():
    refs = ReferenceBank.__new__(ReferenceBank)
    first = np.zeros((48, 48, 3), np.uint8)
    first[:, :24] = (20, 30, 205)
    first[:, 24:] = (205, 30, 20)
    second = first.copy()
    second[:, 24:] = (25, 210, 25)
    different = np.full((48, 48, 3), (170, 175, 180), np.uint8)
    refs.groups = {("characters", "ghost_select"): group(
        ("character_variant.test.red", "character_variant.test.green", "character.other"),
        ("character.test", "character.test", "character.other"),
        (first, second, different))}
    matcher = IconMatcher(refs)
    result = rank_family_then_variant(matcher, second, "characters", "ghost_select")
    assert result["familyId"] == "character.test"
    assert result["top1"] == result["accepted"] == "character_variant.test.green"
    assert result["variantTop3"] == ["character_variant.test.green", "character_variant.test.red"]
    assert [item["id"] for item in result["variantCandidates"]] == result["variantTop3"]
    assert [item["familyId"] for item in result["familyCandidates"]] == result["familyTop3"]
    assert result["variantCandidates"][0]["score"] == result["variantScore"]
    assert result["familyCandidates"][0]["score"] == result["familyScore"]
    assert len(result["rawTop3"]) == 3
    with pytest.raises(ValueError, match="Flags use spatial"):
        rank_family_then_variant(matcher, second, "flags")

    frame = np.full((90, 110, 3), (40, 50, 60), np.uint8)
    frame[20:53, 20:60] = (180, 190, 200)
    before = frame.copy()
    corrected, gains = digit_neutral_clahe_crop(frame, (20, 20, 40, 33), (10, 12, 48, 48))
    assert corrected.shape == (48, 48, 3) and len(gains) == 3
    assert np.array_equal(frame, before)
