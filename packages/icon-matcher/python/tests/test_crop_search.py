"""The Python reference of the Web/Android icon crop search (crop_search.py, issue #99 phase 3).

Synthetic references and canvases only; vectors/crop-search-v1.json is replayed in
test_crop_search_vectors.py.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from mk8dx_icon_matcher import crop_search as cs


def _icon(kind: str, colour, size=(48, 48)):
    w, h = size
    bgr = np.full((h, w, 3), 30, np.uint8)
    mask = np.zeros((h, w), np.uint8)
    if kind == "disc":
        cv2.circle(mask, (w // 2, h // 2), min(w, h) // 2 - 4, 255, -1)
    elif kind == "square":
        cv2.rectangle(mask, (8, 8), (w - 9, h - 9), 255, -1)
    else:
        cv2.fillPoly(mask, [np.array([[w // 2, 5], [w - 6, h - 6], [5, h - 6]])], 255)
    bgr[mask > 0] = colour
    # a little texture so positions are unambiguous
    bgr[(np.indices((h, w)).sum(axis=0) % 7 == 0) & (mask > 0)] = (250, 250, 250)
    return bgr, mask


def _group(name="characters", size=(48, 48)):
    specs = [("disc", (40, 40, 220), 0.7), ("square", (40, 200, 40), 0.6), ("triangle", (210, 60, 30), 0.65),
             ("disc", (128, 128, 128), 0.0), ("square", (20, 160, 230), 0.5)]
    refs, masks = zip(*(_icon(kind, colour, size) for kind, colour, _ in specs))
    ids = [f"character.synthetic_{i}" for i in range(len(specs))]
    return cs.CropGroup(name, size[0], size[1], ids, [sat for *_, sat in specs], list(refs), list(masks))


def _canvas(icon, x, y, size=(160, 120), background=(90, 120, 150)):
    canvas = np.zeros((size[1], size[0], 3), np.uint8)
    canvas[:] = background
    h, w = icon.shape[:2]
    canvas[y:y + h, x:x + w] = icon
    return canvas


def test_rounding_is_half_up_like_math_round():
    assert [cs.js_round(v) for v in (2.5, 3.5, -2.5, -0.5, 0.49)] == [3, 4, -2, 0, 0]
    assert cs.round4(0.12345) == 0.1235 and cs.round4(-0.00005) == 0.0


def test_scale_u8_is_opencv_convert_to():
    values = np.array([3, 5, 7, 255], np.uint8)
    assert cs.scale_u8(values, 1.5).tolist() == [4, 8, 10, 255]  # 4.5 and 7.5 round to even, 382 saturates


def test_hsv_to_bgr_matches_the_scalar_formula():
    rng = np.random.default_rng(3)
    hsv = np.stack([rng.integers(0, 180, 500), rng.integers(0, 256, 500), rng.integers(0, 256, 500)], -1)
    hsv = hsv.astype(np.uint8).reshape(20, 25, 3)
    got = cs.hsv_to_bgr(hsv)
    f = np.float32
    for (h, s, v), bgr in zip(hsv.reshape(-1, 3), got.reshape(-1, 3)):
        hh, ss, vv = f(h) * f(6.0 / 180.0), f(s) * f(1 / 255.0), f(v) * f(1 / 255.0)
        if ss == 0:
            want = [vv] * 3
        else:
            hh = np.fmod(hh, f(6))
            sector = int(np.floor(hh))
            hh = f(hh - f(sector))
            tab = [vv, vv * (f(1) - ss), vv * (f(1) - ss * hh), vv * (f(1) - ss * (f(1) - hh))]
            want = [tab[i] for i in cs._SECTORS[sector]]
        assert bgr.tolist() == [int(np.clip(np.rint(f(c) * f(255)), 0, 255)) for c in want]
    assert cs.hsv_to_bgr(np.array([[[0, 255, 255], [60, 255, 255], [0, 0, 77]]], np.uint8)).tolist() == \
        [[[0, 0, 255], [0, 255, 0], [77, 77, 77]]]


def test_pick_position_filters_and_keeps_the_first_strict_maximum():
    candidates = [["a", 30.0, 3.0, 1, 1], ["b", 20.0, 0.0, 9, 9], ["c", 30.0, 3.0, 2, 2], ["d", 60.0, 3.0, 4, 5]]
    assert cs.pick_position(candidates) == (4, 5)                    # b has under 24 mask values
    assert cs.pick_position(candidates, {"a", "c"}) == (1, 1)        # a and c tie: the first wins
    assert cs.pick_position(candidates, set()) is None


def _look(**overrides):
    look = {"box": [20, 30, 40, 30], "search": 6, "subset": None, "centerScore": 0.7,
            "candidates": [["a", 90.0, 9.0, 9, 2]], "shiftedScore": 0.7}
    look.update(overrides)
    return look


def test_decide_search_branches():
    got = cs.decide_search(_look(), 200, 120)
    assert (got["dx"], got["dy"], got["score"], got["shifted"]) == (3, -4, 0.7, True)  # equal score keeps the shift
    assert cs.decide_search(_look(shiftedScore=0.6999), 200, 120)["shifted"] is False
    assert cs.decide_search(_look(candidates=[["a", 90.0, 9.0, 6, 6]]), 200, 120)["shifted"] is False  # no shift
    assert cs.decide_search(_look(box=[20, 30, 7.4, 30]), 200, 120)["window"] is None  # under 8 px
    assert cs.decide_search(_look(box=[300, 30, 40, 30]), 200, 120) == \
        {"dx": 0, "dy": 0, "score": 0.7, "shifted": False, "window": None}  # clipped to 1 px: no window
    clipped = cs.decide_search(_look(box=[2, 1, 40, 30], candidates=[["a", 90.0, 9.0, 0, 0]]), 200, 120)
    assert clipped["window"] == [0, 0, 48, 37] and (clipped["dx"], clipped["dy"]) == (-2, -1)


def test_crop_box_rounds_half_up():
    assert cs.crop_box([10, 20, 45, 45], 0.98, 1, -2) == [12, 19, 44, 44]   # 10.5 -> 11 and 20.5 -> 21
    assert cs.crop_box([10, 20, 5, 5], 1.0, 0, 0) == [9, 19, 8, 8]          # at least 8 px


def test_decide_field_keeps_the_first_strictly_best_scale():
    case = {"width": 200, "height": 120, "slot": [20, 30, 40, 30],
            "looks": [{**_look(centerScore=0.8, candidates=[]), "scale": s} for s in (0.98, 1.0, 1.02)]}
    case["looks"][2]["centerScore"] = 0.81
    got = cs.decide_field(case)
    assert got["scale"] == 1.02 and got["score"] == 0.81
    case["looks"][2]["centerScore"] = 0.8
    assert cs.decide_field(case)["scale"] == 0.98


def test_identify_crop_ranks_the_planted_reference_first():
    group = _group()
    got = cs.identify_crop(group.ref_bgr8[2], group, None, cs.CENTER_ONLY)
    assert got["id"] == "character.synthetic_2" and got["top3"][0][0] == got["id"] and got["margin"] > 0.05
    assert cs.identify_crop(group.ref_bgr8[2], group, {"character.synthetic_4"}, cs.CENTER_ONLY)["id"] == \
        "character.synthetic_4"


def test_search_finds_a_shifted_icon_and_the_trace_replays_the_decision():
    group = _group()
    canvas = _canvas(group.ref_bgr8[1], 63, 37)
    trace: dict = {}
    got = cs.identify_crop_search(canvas, 60, 40, 48, 48, group, None, 10, trace=trace)
    assert (got["id"], got["dx"], got["dy"]) == ("character.synthetic_1", 3, -3)
    replay = cs.decide_search(trace, canvas.shape[1], canvas.shape[0])
    assert (replay["dx"], replay["dy"], replay["score"]) == (got["dx"], got["dy"], got["score"])


def test_character_sweep_on_a_player_card_and_its_trace():
    group = _group()
    icon = cv2.resize(group.ref_bgr8[0], (50, 50), interpolation=cv2.INTER_AREA)
    canvas = _canvas(icon, 61, 39)
    trace: dict = {}
    got = cs.search_character(canvas, [60, 40, 48, 48], group, True, trace=trace)
    assert got["id"] == "character.synthetic_0" and got["scale"] in cs.CHARACTER_SCALES
    assert trace["roiOffset"] == [0, 0] and len(trace["looks"]) == 7
    decided = cs.decide_field({**trace, "slot": [60, 40, 48, 48]})
    assert (decided["scale"], decided["dx"], decided["dy"], decided["score"]) == \
        (got["scale"], got["dx"], got["dy"], got["score"])


def test_ghost_card_boost_only_for_dull_regions():
    group = _group()
    dull = _canvas(group.ref_bgr8[4], 60, 40, background=(120, 125, 130))
    boosted = cs.boost_saturation(dull, [60, 40, 48, 48])
    assert boosted is not None and boosted[0].shape == (84, 84, 3) and boosted[1:] == (42, 22)
    grey = np.full((120, 160, 3), 128, np.uint8)
    assert cs.boost_saturation(grey, [60, 40, 48, 48]) is None             # mean saturation 0
    trace: dict = {}
    cs.search_character(dull, [60, 40, 48, 48], group, False, trace=trace)
    assert trace["roiOffset"] == [42, 22] and trace["width"] == 84


def test_part_search_uses_six_pixels_at_scale_one():
    group = _group("bodies", (80, 50))
    trace: dict = {}
    got = cs.search_part(_canvas(group.ref_bgr8[1], 52, 44), [50, 40, 80, 50], group, None, trace=trace)
    assert (got["dx"], got["dy"], got["scale"]) == (2, 4, 1.0) and trace["looks"][0]["search"] == 6
    # the grey disc: the position pass finds the shift, but the shifted crop scores lower than the nominal one
    trace = {}
    got = cs.search_part(_canvas(group.ref_bgr8[3], 52, 44), [50, 40, 80, 50], group, None, trace=trace)
    assert (got["dx"], got["dy"]) == (0, 0) and trace["looks"][0]["shiftedScore"] < trace["looks"][0]["centerScore"]
