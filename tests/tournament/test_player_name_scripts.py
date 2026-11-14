"""Player names in every script: which script readers run, in which order, and which reading is kept.

The readers are mocked: these tests pin the selection rules, not EasyOCR. The real readers are measured
with tooling/tournament/evaluate_player_name_scripts.py."""
import json

import numpy as np
import pytest

from conftest import SKIP_REASON, recorded_assets

from mk8dx_tournament_extraction.engine import player_name_scripts as scripts
from mk8dx_tournament_extraction.engine.player_name_scripts import (
    PlayerRoster,
    choose_player_name,
    load_roster,
    needs_script_readers,
    scripts_for_names,
    shows_reader_script,
)


def exact(left: str, right: str) -> float:
    """A stand-in similarity: 1 for the same name, 0.9 for one letter more or less, else 0."""
    left, right = left.casefold(), right.casefold()
    if left == right:
        return 1.0
    if abs(len(left) - len(right)) == 1 and (left in right or right in left):
        return 0.9
    return 0.0


ROSTER = PlayerRoster.from_names(["Erik", "Sander", ("たろう", "Taro"), "김민수", "Иван", "王小明"])


def test_fallback_order_and_reader_languages():
    assert scripts.SCRIPT_ORDER == (
        "cyrillic", "japanese", "korean", "simplified_chinese", "traditional_chinese")
    assert scripts.SCRIPT_READERS == {
        "cyrillic": ("ru", "en"),
        "japanese": ("ja", "en"),
        "korean": ("ko", "en"),
        "simplified_chinese": ("ch_sim", "en"),
        "traditional_chinese": ("ch_tra", "en"),
    }


def test_latin_reader_reads_every_latin_game_language():
    source = (scripts.__file__.replace("player_name_scripts.py", "extract_text.py"))
    with open(source, encoding="utf-8") as handle:
        text = handle.read()
    assert '"MK8_PLAYER_NAME_EASYOCR_LANGS", "en,es,fr,de,nl,pl,it,pt"' in text


@pytest.mark.parametrize("names, expected", [
    (["Erik", "Sander", "Zoë"], ()),
    (["Erik", "Иван"], ("cyrillic",)),
    (["たろう"], ("japanese",)),
    (["김민수"], ("korean",)),
    (["王小明"], ("japanese", "simplified_chinese", "traditional_chinese")),
    (["Иван", "김민수", "タロウ", "陳大文"], scripts.SCRIPT_ORDER),
])
def test_only_the_scripts_the_roster_uses_are_tried(names, expected):
    assert scripts_for_names(names) == expected


def test_a_reading_must_show_its_readers_script():
    assert shows_reader_script("Иван", "cyrillic")
    assert not shows_reader_script("Ivan", "cyrillic")
    assert shows_reader_script("Kenたろう", "japanese")
    assert shows_reader_script("山田", "japanese")
    assert not shows_reader_script("김민수", "japanese")
    assert shows_reader_script("김민수", "korean")
    assert shows_reader_script("王小明", "traditional_chinese")


def test_no_roster_or_a_latin_roster_never_runs_script_readers():
    assert not needs_script_readers("???", None, exact)
    assert not needs_script_readers("???", PlayerRoster.from_names(["Erik", "Sander"]), exact)


def test_a_latin_reading_that_matches_the_roster_is_kept():
    assert not needs_script_readers("Erik", ROSTER, exact)
    choice = choose_player_name("Erik", 30, {"cyrillic": [("Иван", 99)]}, ROSTER, exact)
    assert (choice.text, choice.confidence, choice.script) == ("Erik", 30, "latin")


def test_a_script_reading_that_matches_the_roster_replaces_an_unmatched_latin_reading():
    assert needs_script_readers("t=55", ROSTER, exact)
    choice = choose_player_name("t=55", 20, {
        "cyrillic": [("т=55", 40)],
        "japanese": [("たろう", 81), ("た ろう", 60)],
        "simplified_chinese": [("大", 30)],
    }, ROSTER, exact)
    assert (choice.text, choice.confidence, choice.script) == ("たろう", 81, "japanese")
    assert choice.match.name == "たろう"


def test_the_best_matching_reading_wins_then_confidence_then_fallback_order():
    # same Player, the closer reading wins over the more confident one
    choice = choose_player_name("x", 10, {"korean": [("김민", 99), ("김민수", 50)]}, ROSTER, exact)
    assert choice.text == "김민수"
    # same Player, same score: Japanese before Chinese
    choice = choose_player_name("x", 10, {
        "japanese": [("王小明", 70)], "simplified_chinese": [("王小明", 70)]}, ROSTER, exact)
    assert choice.script == "japanese"


def test_readings_naming_different_players_keep_the_latin_reading():
    choice = choose_player_name("x", 10, {
        "japanese": [("たろう", 90)], "korean": [("김민수", 90)]}, ROSTER, exact)
    assert (choice.text, choice.script) == ("x", "latin")


def test_a_script_reader_reading_latin_text_never_replaces_the_latin_reading():
    # the script readers include English; their Latin output is not a script reading
    choice = choose_player_name("Sandr", 20, {"cyrillic": [("Sander", 95)]}, ROSTER, exact)
    assert (choice.text, choice.script) == ("Sandr", "latin")


def test_no_matching_reading_keeps_the_raw_latin_text_for_the_director():
    choice = choose_player_name("??", 5, {"japanese": [("ぬ", 40)], "cyrillic": [("Ж", 10)]}, ROSTER, exact)
    assert (choice.text, choice.confidence, choice.script) == ("??", 5, "latin")


def test_aliases_count_as_roster_names():
    roster = PlayerRoster.from_names([("Taro", "たろう")])
    assert roster.scripts == ("japanese",)
    choice = choose_player_name("x", 0, {"japanese": [("たろう", 70)]}, roster, exact)
    assert choice.match.name == "たろう"


def test_roster_files(tmp_path):
    text = tmp_path / "players.txt"
    text.write_text("# TN14\nErik\n\nたろう | Taro\n  Иван  \n", encoding="utf-8")
    assert load_roster(text).players == (("Erik",), ("たろう", "Taro"), ("Иван",))
    groups = tmp_path / "groups.json"
    groups.write_text(json.dumps({"1": ["Erik", "Mar."], "2": [{"displayName": "김민수", "aliases": ["Minsu"]}]},
                                 ensure_ascii=False), encoding="utf-8")
    assert load_roster(groups).players == (("Erik",), ("Mar.",), ("김민수", "Minsu"))
    table = tmp_path / "players.csv"
    table.write_text("王小明;Xiaoming\nErik;\n", encoding="utf-8")
    assert load_roster(table).players == (("王小明", "Xiaoming"), ("Erik",))


def test_the_roster_comes_from_the_environment(tmp_path, monkeypatch):
    scripts.clear_roster_override()
    monkeypatch.delenv(scripts.ROSTER_ENV, raising=False)
    assert scripts.active_roster() is None
    file = tmp_path / "players.txt"
    file.write_text("Иван\n", encoding="utf-8")
    monkeypatch.setenv(scripts.ROSTER_ENV, str(file))
    assert scripts.active_roster().scripts == ("cyrillic",)
    monkeypatch.setenv(scripts.ROSTER_ENV, str(tmp_path / "missing.txt"))
    assert scripts.active_roster() is None


@pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)
def test_the_name_reader_asks_only_unmatched_rows_and_only_the_rosters_scripts(monkeypatch):
    from mk8dx_tournament_extraction.engine import extract_text

    calls = []
    script_texts = {("ja", "en"): ["たろう"], ("ko", "en"): ["김민"]}

    def fake_variant(image, coord_list, *, preprocess, bundle_kind="", field_name="", languages=None):
        if languages is None or tuple(languages) == tuple(extract_text.PLAYER_NAME_EASYOCR_LANGS):
            latin = ["Erik", "t=55", "Sander"]
            return latin[:len(coord_list)], [90, 20, 88][:len(coord_list)]
        calls.append((tuple(languages), preprocess, len(coord_list)))
        texts = script_texts[tuple(languages)]
        return texts, [80] * len(texts)

    monkeypatch.setattr(extract_text, "_run_easyocr_player_names_batched_variant", fake_variant)
    monkeypatch.setattr(extract_text, "_get_easyocr_reader", lambda languages: object())
    monkeypatch.setattr(extract_text, "PLAYER_NAME_BATCH_RAW_MODE", "off")
    monkeypatch.setattr(extract_text, "_run_easyocr_player_name_for_context", lambda *a, **k: ("", 0))
    scripts.set_roster(PlayerRoster.from_names(["Erik", "Sander", "たろう", "김민수"]))
    try:
        image = np.zeros((90, 300, 3), dtype=np.uint8)
        coords = [((0, 0), (200, 30)), ((0, 30), (200, 60)), ((0, 60), (200, 90))]
        names, confidences = extract_text.extract_player_names_batched(
            image, coords, bundle_kind="2RaceScore", field_name="RacePlayerName")
    finally:
        scripts.clear_roster_override()
    assert names == ["Erik", "たろう", "Sander"]
    assert confidences[1] == 80
    # one unmatched row, Japanese then Korean (the roster's scripts), both preprocessings; no Cyrillic/Chinese
    assert calls == [(("ja", "en"), "inv_otsu3", 1), (("ja", "en"), "raw", 1),
                     (("ko", "en"), "inv_otsu3", 1), (("ko", "en"), "raw", 1)]


@pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)
def test_without_a_roster_the_name_reader_is_unchanged(monkeypatch):
    from mk8dx_tournament_extraction.engine import extract_text

    seen = []

    def fake_variant(image, coord_list, *, preprocess, bundle_kind="", field_name="", languages=None):
        seen.append(languages)
        return ["t=55"] * len(coord_list), [20] * len(coord_list)

    monkeypatch.setattr(extract_text, "_run_easyocr_player_names_batched_variant", fake_variant)
    monkeypatch.setattr(extract_text, "_get_easyocr_reader", lambda languages: object())
    monkeypatch.setattr(extract_text, "_run_easyocr_player_name_for_context", lambda *a, **k: ("", 0))
    monkeypatch.delenv(scripts.ROSTER_ENV, raising=False)
    scripts.clear_roster_override()
    image = np.zeros((30, 300, 3), dtype=np.uint8)
    names, _ = extract_text.extract_player_names_batched(
        image, [((0, 0), (200, 30))], bundle_kind="2RaceScore", field_name="RacePlayerName")
    assert names == ["t=55"]
    assert all(languages is None for languages in seen)


@pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)
def test_the_real_similarity_keeps_a_one_letter_latin_misread_matched():
    # The roster threshold is Tournament Live's name-only relink threshold on weighted_similarity.
    roster = PlayerRoster.from_names(["Christiaan", "Иван"])
    assert not needs_script_readers("Christiaam", roster)
    assert needs_script_readers("Xyz", roster)


def test_spacing_is_not_compared():
    roster = PlayerRoster.from_names(["김민수", "Marc met C"])
    assert roster.best_match("김 민수", exact).name == "김민수"
    assert roster.best_match("Marcmet C", exact).name == "Marc met C"


@pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)
def test_a_resolved_reading_tries_its_remembered_script_first_and_reconsiders_on_new_evidence(monkeypatch):
    from mk8dx_tournament_extraction.engine import extract_text

    calls = []
    japanese = {"text": "たろう"}

    def fake_variant(image, coord_list, *, preprocess, bundle_kind="", field_name="", languages=None):
        if languages is None or tuple(languages) == tuple(extract_text.PLAYER_NAME_EASYOCR_LANGS):
            return ["t=55"] * len(coord_list), [90] * len(coord_list)
        calls.append(tuple(languages)[0])
        text = {"ja": japanese["text"], "ko": "김민"}[tuple(languages)[0]]
        return [text] * len(coord_list), [80] * len(coord_list)

    monkeypatch.setattr(extract_text, "_run_easyocr_player_names_batched_variant", fake_variant)
    monkeypatch.setattr(extract_text, "_get_easyocr_reader", lambda languages: object())
    monkeypatch.setattr(extract_text, "PLAYER_NAME_BATCH_RAW_MODE", "off")
    scripts.set_roster(PlayerRoster.from_names(["たろう", "たろ", "김민수"]))
    image = np.zeros((30, 300, 3), dtype=np.uint8)
    coords = [((0, 0), (200, 30))]

    def read():
        calls.clear()
        return extract_text.extract_player_names_batched(
            image, coords, bundle_kind="2RaceScore", field_name="RacePlayerName")[0]

    try:
        assert read() == ["たろう"] and calls == ["ja", "ja", "ko", "ko"]  # first frame: every roster script
        assert read() == ["たろう"] and calls == ["ja", "ja"]  # same Latin reading: the remembered script only
        japanese["text"] = "たろ"  # the remembered reader now names another Player: read everything again
        assert read() == ["たろ"] and calls == ["ja", "ja", "ko", "ko"]
    finally:
        scripts.clear_roster_override()
        scripts.SCRIPT_MEMORY.clear()


def test_script_memory_belongs_to_one_roster():
    memory = scripts.ScriptMemory()
    first, second = PlayerRoster.from_names(["たろう"]), PlayerRoster.from_names(["たろう"])
    memory.remember(first, "t = 55", 0, "japanese")
    assert memory.recall(first, "t=55") == (0, "japanese")
    assert memory.recall(second, "t=55") is None
    assert memory.recall(first, "t=55") is None
