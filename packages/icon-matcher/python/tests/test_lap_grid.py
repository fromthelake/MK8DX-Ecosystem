import json
import os
from pathlib import Path

import pytest

from mk8dx_icon_matcher import lap_grid as lg

DEFS = Path(os.environ.get("MK8DX_FRAME_DEFINITIONS",
                           "private-qa/frame-definitions-v1/frame-definitions-v1.json"))
VECTORS = Path(os.environ.get("MK8DX_LAP_GRID_VECTORS",
                              "private-qa/frame-definitions-v1/lap-grid-vectors.json"))
pytestmark = pytest.mark.skipif(not DEFS.is_file(), reason="private frame definitions not available")


def _grids():
    return json.loads(DEFS.read_text(encoding="utf-8"))["timeGrids"]


def _build(grids, case):
    return lg.build_dynamic_grid(grids[case["timeGrid"]], case["raceKey"], case["ghostDetail"], case["width"],
                                 case["height"], case["detections"], case["lapRows"], case["nominal"])


def test_reference_reproduces_recorded_vectors():
    # The TypeScript (lap_grid_parity.mjs) and Java (LapGridParityTest) ports check the same records.
    if not VECTORS.is_file():
        pytest.skip("private lap grid vectors not available")
    grids = _grids()
    for case in json.loads(VECTORS.read_text(encoding="utf-8"))["cases"]:
        assert json.loads(json.dumps(_build(grids, case))) == case["result"]


def test_missing_time_grid_is_blocked():
    result = lg.build_dynamic_grid({}, "race3", False, 1280, 720, [], [])
    assert not result["available"] and result["status"] == "blocked_missing_relative_grid"
    assert result["fields"] == []


def test_vectors_cover_resolved_and_blocked_grids():
    if not VECTORS.is_file():
        pytest.skip("private lap grid vectors not available")
    statuses = {case["result"]["status"] for case in json.loads(VECTORS.read_text(encoding="utf-8"))["cases"]}
    assert "implemented" in statuses
    assert any(s.startswith("blocked") for s in statuses)
