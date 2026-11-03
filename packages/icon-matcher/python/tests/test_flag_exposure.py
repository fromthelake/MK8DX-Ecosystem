from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mk8dx_icon_matcher.flag_exposure import _band, flag_exposure_proposal
from mk8dx_icon_matcher.field_reader import FieldContext, read_field
from mk8dx_icon_matcher.matcher import IconMatcher, _Group


def test_dark_result_flag_is_only_a_review_proposal():
    ids = ("country.nl", "country.lu") + tuple(f"country.control_{i}" for i in range(108))
    rgb = np.zeros((110, 38, 55, 3), np.float32)
    rgb[0, 4:14, 8:47] = (1, 0, 0)
    rgb[0, 14:24, 8:47] = 1
    rgb[0, 24:34, 8:47] = (0, .12, .55)
    rgb[1] = rgb[0]
    rgb[1, 24:34, 8:47] = (0, .42, .85)
    mask = np.ones((110, 38, 55), np.float32)
    group = _Group(ids, ids, rgb, mask, mask.sum((1, 2)))
    crop = np.rint(rgb[1, :, :, ::-1] * .7 * 255).astype(np.uint8)
    shape = {"mode": "full_rgb_ncc", "top": [{"id": "country.lu", "score": .9}]}

    result = flag_exposure_proposal(crop, group, shape)

    assert result["schema"] == "mk8dx.flag-exposure-proposal.v1"
    assert result["status"] == "measured"
    assert result["gain"] > 1.25
    assert result["top"][0]["id"] == "country.lu"
    assert result["tricolorBand"]["preferredId"] == "country.lu"
    assert "acceptedId" not in result


def test_normal_exposure_does_not_change_rank():
    ids = tuple(f"country.control_{i}" for i in range(110))
    rgb = np.full((110, 38, 55, 3), .7, np.float32)
    mask = np.ones((110, 38, 55), np.float32)
    group = _Group(ids, ids, rgb, mask, mask.sum((1, 2)))
    crop = np.full((38, 55, 3), 178, np.uint8)
    result = flag_exposure_proposal(crop, group,
                                    {"mode": "full_rgb_ncc", "top": [{"id": ids[0]}]})
    assert result["status"] == "unavailable"
    assert result["reason"] == "exposure_within_normal_range"
    assert result["top"] == []


def test_even_sized_band_uses_same_upper_median_as_typescript():
    rgb = np.zeros((38, 55, 3), np.float32)
    values = rgb[16:22, 12:43, 1]
    values.flat[93:] = 1
    assert _band(rgb, 16, 22, 1) == 1


def test_field_opt_in_keeps_decision_and_exposes_same_crop():
    ids = ("country.nl", "country.lu") + tuple(f"country.control_{i}" for i in range(108))
    rgb = np.zeros((110, 38, 55, 3), np.float32)
    rgb[0, 4:14, 8:47] = (1, 0, 0)
    rgb[0, 14:24, 8:47] = 1
    rgb[0, 24:34, 8:47] = (0, .12, .55)
    rgb[1] = rgb[0]
    rgb[1, 24:34, 8:47] = (0, .42, .85)
    mask = np.ones((110, 38, 55), np.float32)
    group = _Group(ids, ids, rgb, mask, mask.sum((1, 2)))
    bank = SimpleNamespace(groups={("flags", "result"): group},
                           catalog_sha256="a" * 64, country_names={},
                           display_names={}, variant_slugs={})
    matcher = IconMatcher(bank)
    crop = np.rint(rgb[1, :, :, ::-1] * .7 * 255).astype(np.uint8)
    context = FieldContext("direct_game", "result_card", "player")
    old = read_field(crop, "flags", "result", context, matcher)
    shadow = read_field(crop, "flags", "result", context, matcher,
                        flag_exposure_review=True)
    shape = shadow.pop("shapeRank")
    exposure = shadow.pop("flagExposureReview")
    assert shadow == old
    assert shape["cropPixelSha256"] == exposure["cropPixelSha256"] == old["cropPixelSha256"]
    assert exposure["schema"] == "mk8dx.flag-exposure-proposal.v1"
    assert "acceptedId" not in exposure
