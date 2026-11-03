from mk8dx_icon_matcher import open_set


def test_only_an_unaccepted_scoreboard_read_without_a_clear_winner_suggests_a_mii():
    low = [("character.pauline", "character.pauline", 0.78), ("character.diddy_kong", "character.diddy_kong", 0.77)]
    suggestion = open_set.mii_suggestion("scoreboard", low, None)
    assert suggestion["id"] == "character.mii_medium" and suggestion["label"] == "Mii"
    assert suggestion["evidence"] == "open_set_mii" and abs(suggestion["familyMargin"] - 0.01) < 1e-9
    assert open_set.mii_suggestion("scoreboard", low, "character.pauline") is None   # accepted stays
    assert open_set.mii_suggestion("scoreboard", [("character.luigi", "character.luigi", 0.84)], None) is None
    assert open_set.mii_suggestion("ghost_select", low, None) is None                 # closed set: generic Mii icon
    assert open_set.mii_suggestion("scoreboard", [], None) is None


def test_family_margin_skips_variants_of_the_first_family():
    top = [{"id": "character_variant.yoshi.018_black", "familyId": "character.yoshi", "score": 0.8},
           {"id": "character.yoshi", "familyId": "character.yoshi", "score": 0.79},
           {"id": "character.birdo", "familyId": "character.birdo", "score": 0.7}]
    assert abs(open_set.family_margin(top) - 0.1) < 1e-9
