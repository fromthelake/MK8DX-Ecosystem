from mk8dx_icon_matcher import name_match as nm

VOCAB = [("body.gla#en-GB", "GLA"), ("body.gla#ja-JP", "GLA"), ("body.gla#nl-NL", "GLA"),
         ("body.std#en-GB", "Standard Kart"), ("body.std#ja-JP", "スタンダードカート"), ("body.std#nl-NL", "Standaardkart")]


def test_match_margin_ignores_same_spelling():
    # "GLA" in three locales is no rival of itself: the margin is against "Standard Kart".
    found = nm.match_name("GLA", VOCAB)
    assert found.key == "body.gla#en-GB" and found.fuzzy == 1.0 and found.strong()
    # A differently spelled name of the same part is a rival: Standaardkart is one edit away.
    close = nm.match_name("Standard Kart", VOCAB)
    assert close.key == "body.std#en-GB" and close.margin < nm.MARGIN_MIN and not close.strong()


def test_same_name_locales_span_scripts():
    locales = nm.same_name_locales(VOCAB, "body.gla#en-GB")
    assert locales == ["en-GB", "ja-JP", "nl-NL"]
    assert sorted({nm.script_for_locale(loc) for loc in locales}) == ["ja", "latin"]
    assert nm.same_name_locales(VOCAB, "body.std#nl-NL") == ["nl-NL"]
    assert nm.same_name_locales(VOCAB, None) == [] and nm.script_for_locale(None) is None


def test_vote_preference_only_breaks_ties():
    vocabs = {"bodies": VOCAB}
    rows = [("bodies", "GLA")]
    locales = nm.vocab_locales(VOCAB)
    assert nm.locale_vote(rows, vocabs, locales)["locale"] == "en-GB"
    assert nm.locale_vote(rows, vocabs, locales, ["nl-NL"])["locale"] == "nl-NL"
    assert nm.locale_vote([("bodies", "Standaardkart")], vocabs, locales, ["ja-JP"])["locale"] == "nl-NL"


TRACKS = [("track.gcn_dry_dry_desert#en-GB", "GCN Dry Dry Desert"),
          ("track.gcn_dry_dry_desert#nl-NL", "GCN Droge Droge Woestijn"),
          ("track.mks#en-GB", "Mario Kart Stadium"), ("track.mks#nl-NL", "Mario Kart-stadion"),
          ("track.mc#en-GB", "Mario Circuit"), ("track.mc#nl-NL", "Mario-circuit")]


def test_title_words_in_any_order_and_clipped_strips():
    assert nm.match_title("GCN Desert Dry Dry", TRACKS).key == "track.gcn_dry_dry_desert#en-GB"
    assert nm.match_title("GCN Desert Dry Dry", TRACKS).rule == "tokens"
    clipped = nm.match_title("GCN Dry Dry", TRACKS)
    assert clipped.key == "track.gcn_dry_dry_desert#en-GB" and clipped.rule == "prefix"
    # words that start two tracks decide nothing by prefix
    two = TRACKS + [("track.mkh#en-GB", "Mario Kart Highway")]
    assert nm.match_title("Mario Kart", two).rule != "prefix"
    assert nm.match_title("Mario Kart", TRACKS).rule == "prefix"


def test_title_margin_is_against_another_track_not_another_language():
    # Mario Kart Stadium and Mario Kart-stadion are the same track: no rival
    found = nm.match_title("Mario Kart Stadiun", TRACKS)
    assert found.key == "track.mks#en-GB" and found.rule == "fuzzy"


def test_non_titles_are_refused():
    for text in ("150cc", "Time Trials", "OK", "", None, "xx"):
        assert nm.match_title(text, TRACKS).key is None


def test_titles_reproduce_recorded_vectors():
    import json
    import os
    from pathlib import Path
    import pytest
    path = Path(os.environ.get("MK8DX_NAME_MATCH_VECTORS", "private-qa/name-match-vectors-v1/vectors.json"))
    if not path.is_file():
        pytest.skip("private name vectors not available")
    doc = json.loads(path.read_text(encoding="utf-8"))
    tracks = [tuple(row) for row in doc["vocabs"]["tracks"]]
    subsets = {"all": tracks, "en-nl": [r for r in tracks if r[0].endswith(("#en-GB", "#en-US", "#nl-NL"))]}
    for t in doc.get("titles", []):
        m = nm.match_title(t["query"], subsets[t["subset"]])
        assert (m.key, m.name, m.rule, m.fuzzy, m.margin) == (t["key"], t["name"], t["rule"], t["fuzzy"], t["margin"])
