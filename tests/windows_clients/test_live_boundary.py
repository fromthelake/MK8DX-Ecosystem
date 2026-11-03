from tournament_live.canonical_export import canonicalize_final_live_rows
from live_processor.baseline_consensus import choose_total_row, normalize_join_text

from rows import confirmed_rows


def test_final_live_rows_keep_score_and_live_source():
    result, = canonicalize_final_live_rows(confirmed_rows(), session_id="synthetic-session",
                                           producer_version="test-1", created_at_ms=1000)
    assert result["source"]["kind"] == "tournament_live_capture"
    assert result["source"]["streamId"].startswith("stream.")
    assert result["placements"][0]["scoring"]["totalAfterRace"] == 15


def test_scoreboard_consensus_matches_name_before_row_order():
    race_row = {"row_index": "1", "player_name": "Player Alpha",
                "previous_total_points": "10", "race_points": "15"}
    total_rows = [{"row_index": "1", "player_name": "Other", "total_points": "12"},
                  {"row_index": "2", "player_name": "Player Alpha", "total_points": "25"}]
    index, method, confidence = choose_total_row(
        race_row, total_rows, set(),
        {index: normalize_join_text(row["player_name"]) for index, row in enumerate(total_rows)})
    assert (index, method, confidence) == (1, "same_name", 1.0)
