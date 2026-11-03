import json
from pathlib import Path

from mk8dx_icon_matcher import frame_geometry as fg

VECTORS = Path(__file__).resolve().parents[2] / "vectors" / "card-registration-v1.json"
DEFS = {"registration": {"half": 0.5, "scoreMin": 0.35}}
PANEL = {"x": 100.0, "y": 50.0, "w": 600.0, "h": 240.0, "source": "static_canonical"}
WINDOW = [74, 16, 726, 340]


def test_reproduces_recorded_vectors():
    # The TypeScript (card_registration_parity.mjs) and Java (CardRegistrationParityTest) ports replay them too.
    doc = json.loads(VECTORS.read_text(encoding="utf-8"))
    defs = {"registration": doc["registration"]}
    for case in doc["cases"]:
        calls = []

        def fine(*args, case=case, calls=calls):
            calls.append(list(args))
            return tuple(case["fine"])

        got = fg.register_card(defs, case["panel"], case["window"],
                               lambda tw, th, case=case: tuple(case["coarse"][f"{tw}x{th}"]), fine)
        assert got == case["result"] and calls == case["fineCalls"]


def test_unscaled_template_wins_a_tie_and_refines():
    # Equal raw scores everywhere: the scale penalty picks 1.0 x 1.0; the refinement moves the card.
    got = fg.register_card(DEFS, PANEL, WINDOW, lambda tw, th: (0.6, 13, 17), lambda *a: (0.58, 4, 6))
    assert got[2:4] == [1.0, 1.0] and got[5] == 0
    assert got[0] == WINDOW[0] + (26 - 5 + 4) - PANEL["x"] and got[1] == WINDOW[1] + (34 - 5 + 6) - PANEL["y"]
    assert got[4] == 0.58


def test_weak_refinement_keeps_the_coarse_place():
    got = fg.register_card(DEFS, PANEL, WINDOW, lambda tw, th: (0.6, 13, 17), lambda *a: (0.5, 4, 6))
    assert got[:2] == [WINDOW[0] + 26 - PANEL["x"], WINDOW[1] + 34 - PANEL["y"]] and got[4] == 0.6


def test_refusals():
    assert fg.register_card(DEFS, PANEL, WINDOW, lambda tw, th: (0.3, 0, 0), None) == [0, 0, 1, 1, 0.3, 1]
    assert fg.register_card(DEFS, PANEL, [0, 0, 20, 400], None, None) == [0, 0, 1, 1, 0, 1]
