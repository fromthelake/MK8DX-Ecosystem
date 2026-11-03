import json
from pathlib import Path

from mk8dx_icon_matcher import panel_registration as pr

VECTORS = Path(__file__).resolve().parents[2] / "vectors" / "panel-registration-v1.json"
BOXES = [[100 + 40 * i, 200 + (i % 3) * 30, 112 + 40 * i, 210 + (i % 3) * 30] for i in range(10)]
IDENTITY = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]


def _match(score=0.8):
    return lambda index, window: (score, pr.SEARCH_X, pr.SEARCH_Y, None, None, None, None)


def test_reproduces_recorded_vectors():
    # The TypeScript (panel_registration_parity.mjs) and Java (PanelRegistrationParityTest) ports replay them too.
    for case in json.loads(VECTORS.read_text(encoding="utf-8"))["cases"]:
        seen = []

        def homography(found, reference, case=case, seen=seen):
            seen.append(found)
            return case["homography"], case["inliers"]

        got = pr.register_panel(case["variant"], case["boxes"], case["imageW"], case["imageH"],
                                lambda i, w, case=case: tuple(case["matches"][i]), homography)
        assert got == case["result"] and (seen[0] if seen else None) == case["found"]


def test_anchors_in_place_register_with_the_identity():
    got = pr.register_panel("race3", BOXES, 1280, 720, _match(), lambda f, r: (IDENTITY, len(f)))
    assert got["info"]["applied"] and got["info"]["found"] == 10 and got["info"]["max_shift_px"] == 0.0


def test_refusals():
    assert pr.register_panel("race3", BOXES[:7], 1280, 720, _match(), None)["info"]["reason"] == "too_few_anchors"
    assert pr.register_panel("race3", BOXES, 1280, 720, _match(0.3), None)["info"]["reason"] == "too_few_anchors"
    assert pr.register_panel("race3", BOXES, 1280, 720, _match(), lambda f, r: (IDENTITY, 6))["info"]["reason"] == "anchors_disagree"
    far = [1.0, 0.0, 50.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    assert pr.register_panel("race3", BOXES, 1280, 720, _match(), lambda f, r: (far, 10))["info"]["reason"] == "implausible_shift"


def test_sub_pixel_peak():
    assert pr.sub_pixel_peak(0.5, 1.0, 0.5) == 0.0
    assert pr.sub_pixel_peak(None, 1.0, 0.5) == 0.0
    assert -0.5 < pr.sub_pixel_peak(0.9, 1.0, 0.5) < 0  # a stronger left neighbour pulls the peak left
