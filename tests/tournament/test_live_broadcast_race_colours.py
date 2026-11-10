"""The overlay's Race Result shows a colour only once it is settled (TN13 on A2, 2026-11-10)."""
from live_processor.broadcast_state import build_race_results


def _row(position, player, character, method=None):
    row = {"Position": str(position), "Player": player, "Character": character, "RacePoints": "9"}
    if method is not None:
        row["CharacterMatchMethod"] = method
    return row


def test_a_fast_per_race_read_shows_the_neutral_family():
    [row] = build_race_results([_row(1, "Frank", "Orange Yoshi")])
    assert row.character == "Yoshi"


def test_the_family_refinement_settles_the_colour():
    [row] = build_race_results([_row(1, "Frank", "Orange Yoshi",
                                     "shared_field_0.2.0+variant_family_aligned_color_refine")])
    assert row.character == "Orange Yoshi"


def test_the_shared_field_reader_settles_the_colour_without_refinement():
    rows = build_race_results([_row(4, "Frank", "Orange Yoshi", "shared_field_0.4.1"),
                               _row(8, "Justin", "Black Yoshi", "shared_field_0.4.1"),
                               _row(10, "grayson", "Yoshi", "shared_field_0.4.1")])
    assert [(r.driver, r.character) for r in rows] == [
        ("Frank", "Orange Yoshi"), ("Justin", "Black Yoshi"), ("grayson", "Yoshi")]
    assert rows[0].character_icon != rows[2].character_icon


def test_a_distinct_character_is_never_reduced():
    [row] = build_race_results([_row(1, "Christiaan", "Donkey Kong")])
    assert row.character == "Donkey Kong"
