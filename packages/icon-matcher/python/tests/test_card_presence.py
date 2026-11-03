"""card_presence on a synthetic screen (no private frames)."""

import base64
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mk8dx_icon_matcher.card_presence import CardAnchors, card_presence  # noqa: E402


def circle(k: int) -> np.ndarray:
    yy, xx = np.mgrid[:33, :33]
    out = np.zeros((33, 33, 3), np.uint8)
    out[:] = (92, 92, 98)
    out[(xx - 16) ** 2 + (yy - 16) ** 2 <= 14 ** 2] = (48, 50, 56)
    for bar in range(k):
        out[9:24, 12 + 4 * bar:14 + 4 * bar] = (245, 245, 245)
    return out


def anchors(threshold=0.5) -> CardAnchors:
    encode = lambda a: base64.b64encode(a.tobytes()).decode("ascii")
    return CardAnchors({"schema": "mk8dx.card-anchors.v1", "x": 1018, "size": 33, "search": 3,
                        "threshold": threshold, "pitch": {"3": 44, "7": 32},
                        "slots": {"3": {"top": 208, "bottom": 441}, "7": {"top": 122, "bottom": 424}},
                        "offsets": [0, -30],
                        "templates": {"ghost": [encode(circle(k)) for k in (1, 2, 3)]}}, "s" * 64)


def screen(circles=(), y=208, pitch=44, dy=0) -> np.ndarray:
    yy, xx = np.mgrid[:720, :1280]
    rgb = np.stack([(xx * 7 + yy * 13) % 60 + 120, (xx * 11 + yy * 5) % 50 + 110,
                    (xx * 3 + yy * 17) % 40 + 130], axis=2).astype(np.uint8)
    for k in circles:
        top = y + dy + (k - 1) * pitch
        rgb[top:top + 33, 1018:1051] = circle(k)
    return rgb


def test_three_circles_at_a_slot_are_a_card():
    got = card_presence(screen((1, 2, 3), dy=2), anchors(), "ghost", 3)
    assert got["present"] and got["slot"] == "top" and got["y"] == 208 and got["circleY"] == 210
    assert min(got["best"]["scores"]) > 0.95


def test_one_circle_is_not_enough_and_an_empty_screen_has_no_card():
    assert not card_presence(screen((1,)), anchors(), "ghost", 3)["present"]
    assert not card_presence(screen(()), anchors(), "ghost", 3)["present"]


def test_the_other_owners_slot_is_skipped_and_layouts_differ():
    assert not card_presence(screen((1, 2, 3)), anchors(), "ghost", 3, exclude_slot="top")["present"]
    seven = card_presence(screen((1, 2, 3), y=424 - 30, pitch=32), anchors(), "ghost", 7)
    assert seven["present"] and seven["slot"] == "bottom" and seven["best"]["offset"] == -30


def test_loads_the_file_and_records_its_hash(tmp_path):
    path = tmp_path / "a.json"
    document = {"schema": "mk8dx.card-anchors.v1", "x": 1018, "size": 33, "search": 3, "threshold": .5,
                "pitch": {"3": 44}, "slots": {"3": {"top": 208}}, "offsets": [0],
                "templates": {"ghost": [base64.b64encode(circle(1).tobytes()).decode()]}}
    path.write_text(json.dumps(document))
    import hashlib
    assert CardAnchors.load(path).sha256 == hashlib.sha256(path.read_bytes()).hexdigest()
