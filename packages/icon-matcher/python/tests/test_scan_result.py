import json
from pathlib import Path

from mk8dx_icon_matcher import scan_result as sr

VECTORS = Path(__file__).resolve().parents[2] / "vectors" / "scan-result-v1.json"


def _consensus(**overrides):
    base = {"locked": True, "layout": "endscreen",
            "fields": {"player_total": "1:23.456", "player_lap_1": "0:27.000", "player_lap_2": "0:28.000",
                       "player_lap_3": "0:28.456"},
            "identity": {"player": {"character": {"id": "character.mario", "score": 0.91, "ok": True},
                                    "wheel": {"index": 3, "score": 0.5, "ok": False,
                                              "alternatives": [{"id": None, "index": 4, "name": "Slim"}] * 3},
                                    "card_name": " Lake "}}}
    base.update(overrides)
    return base


def test_reference_reproduces_committed_vectors():
    doc = json.loads(VECTORS.read_text(encoding="utf-8"))
    for case in doc["cases"]:
        assert sr.compose_scan_result(case["consensus"], case["lapCount"]) == case["result"]


def test_closing_laps_accepted_parts_and_name():
    result = sr.compose_scan_result(_consensus())
    assert result["status"] == "ok" and result["lapsComplete"] and result["lapSumMatches"] is True
    assert result["captureLayout"] == "time_trial_result" and result["observedPlayerName"] == "Lake"
    assert result["confidence"] == {"character": 0.91} and result["doubt"] == []
    assert len(result["parts"]["tire"]["alternatives"]) == 2 and not result["parts"]["tire"]["accepted"]


def test_open_lap_sum_is_doubt_and_lap_count_mismatch_is_incomplete():
    fields = dict(_consensus()["fields"], player_total="1:23.457")
    result = sr.compose_scan_result(_consensus(fields=fields))
    assert result["lapSumMatches"] is False and result["doubt"] == ["laps"]
    seven = sr.compose_scan_result(_consensus(), lap_count=7)
    assert not seven["lapsComplete"] and seven["lapSumMatches"] is None


def test_ghost_panel_and_unreadable_lap():
    fields = {"ghost_total": "1:23.456", "ghost_lap_1": "0:27.000", "ghost_lap_3": "0:28.456"}
    result = sr.compose_scan_result({"locked": True, "fields": fields, "identity": {}})
    assert result["owner"] == "ghost" and result["captureLayout"] == "ghost_details"
    assert [lap["time"] for lap in result["laps"]] == ["0:27.000", None, "0:28.456"] and not result["lapsComplete"]
    assert sr.compose_scan_result({"locked": False, "fields": fields})["status"] == "not_locked"
