import json
import os
from pathlib import Path

import pytest

from mk8dx_icon_matcher import frame_geometry as fg

DEFS = Path(os.environ.get("MK8DX_FRAME_DEFINITIONS",
                           "private-qa/frame-definitions-v1/frame-definitions-v1.json"))
VECTORS = Path(os.environ.get("MK8DX_FRAME_GEOMETRY_VECTORS",
                              "private-qa/frame-definitions-v1/geometry-vectors.json"))
pytestmark = pytest.mark.skipif(not DEFS.is_file(), reason="private frame definitions not available")


def _defs():
    return json.loads(DEFS.read_text(encoding="utf-8"))


def test_reference_reproduces_recorded_vectors():
    if not VECTORS.is_file():
        pytest.skip("private geometry vectors not available")
    defs = _defs()
    for case in json.loads(VECTORS.read_text(encoding="utf-8"))["cases"]:
        assert fg.panel_box(defs, case["raceKey"], case["owner"], case["anchor"]) == case["panel"]


def test_static_end_screen_slots_and_strips():
    defs = _defs()
    panel = fg.panel_box(defs, "race3", "player", None)
    assert panel["source"] == "static_canonical" and panel["w"] > 600
    kart = fg.slot_box(defs, "player", "kart_icon", "3laps", panel, None)
    rel = fg.slot_rel(defs, "player", "kart_icon", "3laps")
    assert kart == [fg._round(panel["x"] + rel[0] * panel["w"]), fg._round(panel["y"] + rel[1] * panel["h"]),
                    fg._round(rel[2] * panel["w"]), fg._round(rel[3] * panel["h"])]
    right = fg.text_right(defs, panel, False)
    strip = fg.text_strip(defs, kart, right)
    assert strip[0] == kart[0] + kart[2] + 6 and strip[1] == kart[1] - 2 and strip[3] == kart[3] + 4
    window = fg.search_window(defs, "flag_icon", kart, 1280, 720)
    assert window[0] == max(0, kart[0] - 5)


def test_registered_slot_is_centred_on_the_deploy_box():
    defs = _defs()
    panel = fg.panel_box(defs, "race7", "ghost", None)
    box = fg.deploy_box(defs, "glider_icon", "7laps", panel["w"], panel["h"])
    slot = fg.slot_box(defs, "ghost", "glider_icon", "7laps", panel, [2.0, -1.0, 1.0, 1.0])
    assert slot == [fg._round(panel["x"] + 2.0 + box[0]), fg._round(panel["y"] - 1.0 + box[1]),
                    fg._round(box[2]), fg._round(box[3])]
    assert fg.deploy_box(defs, "glider_icon", "ghost_detail", 100, 100) is None
