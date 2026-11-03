from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mk8dx_icon_matcher.field_reader import FieldContext, read_field
from mk8dx_icon_matcher.matcher import IconMatcher, _Group
from mk8dx_icon_matcher.shape_rank import rank_icon_shape


def group(ids, rgb, mask):
    rgb = np.asarray(rgb, dtype=np.float32)
    mask = np.asarray(mask, dtype=np.float32)
    return _Group(tuple(ids), tuple(ids), rgb, mask, mask.sum((1, 2)))


def test_tire_mask_ignores_background_and_darkening():
    first = np.array([[[.1] * 3, [.8] * 3], [[.2] * 3, [0.] * 3]], np.float32)
    second = np.array([[[.8] * 3, [.1] * 3], [[.7] * 3, [0.] * 3]], np.float32)
    refs = group(("first", "second"), (first, second),
                 np.array([[[1, 1], [1, 0]]] * 2))
    query = np.clip((.25 + .5 * first) * 255, 0, 255).astype(np.uint8)[:, :, ::-1]
    query[1, 1] = 255
    ranked = rank_icon_shape(query, refs, "masked_gray_ncc")
    assert ranked["mode"] == "masked_gray_ncc"
    assert [item["id"] for item in ranked["top"]] == ["first", "second"]
    assert ranked["top"][0]["score"] > .999


def test_flag_keeps_rgb_pattern_and_field_decision_unchanged():
    first = np.zeros((38, 55, 3), np.float32)
    first[:, :27] = (1., 0., 0.)
    first[:, 27:] = (0., 0., 1.)
    second = first[:, ::-1].copy()
    refs = group(("red_left", "blue_left"), (first, second),
                 np.ones((2, 38, 55), np.float32))
    bank = SimpleNamespace(groups={("flags", "result"): refs},
                           catalog_sha256="a" * 64, country_names={},
                           display_names={}, variant_slugs={})
    matcher = IconMatcher(bank)
    crop = np.clip((first[:, :, ::-1] * .7 + .1) * 255, 0, 255).astype(np.uint8)
    context = FieldContext("direct_game", "result_card", "ghost")
    old = read_field(crop, "flags", "result", context, matcher)
    shadow = read_field(crop, "flags", "result", context, matcher,
                        shape_review=True)
    shape = shadow.pop("shapeRank")
    assert shadow == old
    assert shape["cropPixelSha256"] == old["cropPixelSha256"]
    assert shape["top"][0]["id"] == "red_left"
    assert shape["top"][0]["score"] > .99
