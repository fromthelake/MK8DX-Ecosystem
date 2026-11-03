import json
from pathlib import Path

from mk8dx_icon_matcher import sequence_decision as sd

VECTORS = Path(__file__).resolve().parents[2] / "vectors" / "sequence-decision-v1.json"


def test_reference_reproduces_committed_vectors():
    doc = json.loads(VECTORS.read_text(encoding="utf-8"))
    for scan in doc["scans"]:
        decision = sd.SequenceDecision()
        for step in scan["steps"]:
            just = decision.update_times(step["fields"], step["lapSumOk"], step["lapSumRepairs"],
                                         step["expectedFields"])
            decision.add_identity(step["identity"])
            assert {"justLocked": just, "locked": decision.locked, "acceptPath": decision.accept_path,
                    "lockedFields": decision.locked_fields,
                    "identitySettled": decision.identity_settled()} == step["after"]
        assert json.dumps(decision.result()) == json.dumps(scan["result"])


def test_ladder_rungs():
    truth = {"player_total": "1:23.456", "player_lap_1": "0:27.000", "player_lap_2": "0:28.000",
             "player_lap_3": "0:28.456"}
    direct = sd.SequenceDecision()
    assert direct.update_times(truth, True, 0, 4) and direct.accept_path == "direct_lap_som"
    repaired = sd.SequenceDecision()
    assert not repaired.update_times(truth, True, 1, 4)
    assert repaired.update_times(truth, True, 1, 4) and repaired.accept_path == "bevestigd_na_reparatie"
    voted = sd.SequenceDecision()
    assert not voted.update_times(truth, False, 0, 4) and not voted.update_times(truth, False, 0, 4)
    assert voted.update_times(truth, False, 0, 4) and voted.accept_path == "veld_stemming"


def test_impossible_second_is_repaired_when_laps_close():
    # a lap of 0:09.000 whose tens digit was misread as 8
    fields = {"player_total": "1:23.456", "player_lap_1": "0:27.000", "player_lap_2": "0:89.000",
              "player_lap_3": "0:47.456"}
    decision = sd.SequenceDecision()
    assert decision.update_times(fields, True, 0, 4)
    assert decision.locked_fields["player_lap_2"] == "0:09.000"


def test_identity_contested_slot_keeps_alternatives():
    decision = sd.SequenceDecision()
    alt = [{"id": "character.luigi", "index": 1, "name": "Luigi"}]
    decision.add_identity({"player": {"character": {"id": "character.mario", "score": 0.6, "ok": False,
                                                    "alternatives": alt}, "card_name": " Lake "}})
    decision.add_identity({"player": {"character": {"id": "character.mario", "score": 0.9, "ok": True}}})
    snap = decision.identity_snapshot()["player"]
    assert snap["character"]["ok"] is True and snap["card_name"] == "Lake"
    assert decision.identity_settled() is True  # every vote agrees and the winner was accepted
