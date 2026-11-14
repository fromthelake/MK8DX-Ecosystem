"""LiveTrial reads every icon with the central reader (issue #99, phase 5): the engine's own icon
matcher and its crop search are gone, and without the central reader a field stays unknown."""

import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

DESKTOP = Path(__file__).resolve().parents[1]
ENGINE = DESKTOP / "vision-runtime" / "livetrial"
OVERLAY = DESKTOP / "engine-overlay" / "livetrial" / "livetrial"


@pytest.fixture()
def engine(monkeypatch):
    monkeypatch.syspath_prepend(str(ENGINE))
    yield lambda name: importlib.import_module(f"livetrial.{name}")
    for name in ("livetrial.identity_matcher", "livetrial.ghostmenu"):
        sys.modules.pop(name, None)


def test_overlay_and_engine_copies_are_the_same() -> None:
    assert (OVERLAY / "identity_matcher.py").read_bytes() == (ENGINE / "livetrial" / "identity_matcher.py").read_bytes()
    # ghostmenu.py: the same text (the engine copy keeps its CRLF line ends)
    overlay = (OVERLAY / "ghostmenu.py").read_bytes().replace(b"\r\n", b"\n")
    assert overlay == (ENGINE / "livetrial" / "ghostmenu.py").read_bytes().replace(b"\r\n", b"\n")


def test_the_engine_has_no_icon_matcher_of_its_own(engine) -> None:
    matcher = engine("identity_matcher")
    for gone in ("identify_crop", "identify_crop_search", "register_card", "parts_subset_for_character"):
        assert not hasattr(matcher, gone), gone


def test_slot_boxes_come_from_the_deploy_database(engine, monkeypatch, tmp_path) -> None:
    groups = ("characters", "bodies", "tires", "gliders", "flags")
    detection = {"boxSizes": {g: [40, 30] for g in groups},
                 "anchor": {"offsets": {"3lap": {g: [10 * i, 5] for i, g in enumerate(groups)},
                                        "7lap": {g: [10 * i, 6] for i, g in enumerate(groups)}}}}
    (tmp_path / "database.json").write_text(json.dumps({"schemaVersion": 9, "detection": detection}), encoding="utf-8")
    monkeypatch.setenv("MK8_CLEAN_ASSETS_ROOT", str(tmp_path))
    matcher = engine("identity_matcher")
    matcher._STATE.clear()
    boxes = matcher.deploy_slot_boxes("3laps", 682.0, 227.0)
    assert boxes["kart"] == (10.0, 5.0, 40.0, 30.0)
    assert matcher._ensure_loaded()["db"]["schemaVersion"] == 9
    matcher._STATE.clear()


def test_select_a_ghost_reads_nothing_without_the_central_reader(engine) -> None:
    pytest.importorskip("cv2")
    import numpy as np
    ghostmenu = engine("ghostmenu")
    reader = SimpleNamespace(shared_candidate=None)
    image = np.zeros((720, 1280, 3), dtype=np.uint8)
    assert ghostmenu.GhostPanelReader._icon(reader, image, (10, 10, 40, 40), "characters") is None
