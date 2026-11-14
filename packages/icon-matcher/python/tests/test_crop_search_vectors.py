"""Replay vectors/crop-search-v1.json (tools/generate_crop_search_vectors.py; issue #99 phase 3)
through the Python reference's decision. TypeScript (ts/crop_search_parity.mjs) and Java
(CropSearchParityTest) replay the same file.

Real-crop cases also record what the Web scanner decided on the same canonical card: the
reference's pixel search must have reached the same scale, shift and rounded score.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from mk8dx_icon_matcher import crop_search as cs

PACKAGE = Path(__file__).resolve().parents[2]
VECTORS = PACKAGE / "vectors" / "crop-search-v1.json"


def _doc() -> dict:
    return json.loads(VECTORS.read_text(encoding="utf-8"))


def test_every_case_replays_its_decision():
    doc = _doc()
    assert doc["schema"] == "mk8dx.crop-search-vectors.v1"
    differences = [case["name"] for case in doc["cases"] if cs.decide_field(case) != case["expected"]]
    assert differences == []
    assert sum(case["source"] == "synthetic" for case in doc["cases"]) >= 20


def test_real_crops_equal_the_web_scanner():
    real = [case for case in _doc()["cases"] if case["source"] == "public-test-set"]
    assert real, "no real-crop cases"
    for case in real:
        for key in ("scale", "dx", "dy", "score"):
            assert case["expected"][key] == case["python"][key] == case["web"][key], (case["name"], key)
        assert case["python"]["id"] == case["web"]["id"], case["name"]
        if case["web"]["cropBox"] is not None:
            assert case["expected"]["cropBox"] == case["web"]["cropBox"], case["name"]
        # every look (scale) of the Web search, not only the winner
        assert [{k: look[k] for k in ("dx", "dy", "score")} for look in case["expected"]["looks"]] == case["webLooks"]


def test_synthetic_part_is_current():
    spec = importlib.util.spec_from_file_location("generate_crop_search_vectors",
                                                  PACKAGE / "tools" / "generate_crop_search_vectors.py")
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    committed = [case for case in _doc()["cases"] if case["source"] == "synthetic"]
    assert json.loads(json.dumps(gen.synthetic_cases())) == committed
    assert json.loads(json.dumps(gen.helper_cases())) == _doc()["helperCases"]
    assert gen.constants() == _doc()["constants"]


def test_constants_are_the_vectors():
    want = _doc()["constants"]
    assert want == {"characterScales": list(cs.CHARACTER_SCALES), "searchPx": cs.SEARCH_PX,
                    "boostMargin": cs.BOOST_MARGIN, "boostSatMin": cs.BOOST_SAT_MIN,
                    "boostSatMax": cs.BOOST_SAT_MAX, "boostSatTarget": cs.BOOST_SAT_TARGET,
                    "boostMaxFactor": cs.BOOST_MAX_FACTOR, "windowGainMin": cs.WINDOW_GAIN_MIN,
                    "windowGainMax": cs.WINDOW_GAIN_MAX, "minWindowMean": cs.MIN_WINDOW_MEAN,
                    "minTemplatePx": cs.MIN_TEMPLATE_PX, "minCropPx": cs.MIN_CROP_PX,
                    "minTemplateSum": cs.MIN_TEMPLATE_SUM}


def test_helper_cases_replay():
    """The step functions the Web scanner and Android call (phase 4), one case per branch."""
    fns = {"searchPx": cs.search_px, "searchWindow": cs.search_window, "windowGain": cs.window_gain,
           "votes": lambda rid, total, subset: cs.votes(rid, total, None if subset is None else set(subset)),
           "pickedShift": cs.picked_shift, "acceptShift": cs.accept_shift, "boostRegion": cs.boost_region,
           "boostFactor": cs.boost_factor, "lookBox": cs.look_box, "betterLook": cs.better_look,
           "cropBox": cs.crop_box}
    cases = _doc()["helperCases"]
    assert {case["fn"] for case in cases} == set(fns)
    assert [case for case in cases if fns[case["fn"]](*case["args"]) != case["expected"]] == []
