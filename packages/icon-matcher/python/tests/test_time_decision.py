import json
from pathlib import Path

from mk8dx_icon_matcher import time_decision as td

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "vectors" / "time-decision-v1.json").read_text(encoding="utf-8"))


def test_reference_reproduces_the_fixture():
    for case in VECTORS["closures"]:
        assert td.lap_sum_closure(case["texts"]) == case["repair"], case["texts"]
    for case in VECTORS["completes"]:
        assert td.lap_sum_complete(case["owners"]) == case["complete"]
    for case in VECTORS["guards"]:
        assert (td.repair_guard(case["lapSumOk"], case["repairs"], case["minConfidence"]) is not None) == case["guard"]


def test_fill_and_flip_close_the_sum():
    clean = ["1:30.000", "0:30.000", "0:30.000", "0:30.000"]
    assert td.lap_sum_complete([{"total": clean[0], "laps": clean[1:]}])
    filled = td.lap_sum_closure(["1:30.000", "0:3?.000", "0:30.000", "0:30.000"])
    assert filled["kind"] == "fill" and filled["to"] == "0:30.000"
    assert td.lap_sum_closure(clean) is None
    assert td.repair_guard(True, 1, 0.5)["threshold"] == 0.65 and td.repair_guard(True, 1, 0.7) is None


def test_weak_repaired_refinement_cannot_displace_closed_seed():
    assert td.prefer_closed_seed(True, True, 1, 0.609)
    assert not td.prefer_closed_seed(True, True, 1, 0.65)
    assert not td.prefer_closed_seed(True, True, 0, 0.609)
    assert td.prefer_closed_seed(True, False, 0, 1)
    assert not td.prefer_closed_seed(False, True, 1, 0.609)
