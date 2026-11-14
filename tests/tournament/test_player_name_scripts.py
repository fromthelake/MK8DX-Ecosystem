"""Player names in every script: when the script readers read a name box, and which reading is passed on.

The readers are mocked: these tests pin the selection rules, not EasyOCR. The real readers are measured
with tooling/tournament/evaluate_player_name_scripts.py."""
import numpy as np
import pytest

from conftest import SKIP_REASON, recorded_assets

from mk8dx_tournament_extraction.engine import player_name_scripts as scripts
from mk8dx_tournament_extraction.engine.player_name_scripts import (
    ScriptMemory,
    choose_player_name,
    is_switch_name_char,
    may_need_script_readers,
    script_share,
)


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
    source = scripts.__file__.replace("player_name_scripts.py", "extract_text.py")
    with open(source, encoding="utf-8") as handle:
        assert '"MK8_PLAYER_NAME_EASYOCR_LANGS", "en,es,fr,de,nl,pl,it,pt"' in handle.read()


def test_script_share_and_switch_name_characters():
    assert script_share("Иван", "cyrillic") == 1.0
    assert script_share("Ivan_Иван", "cyrillic") == pytest.approx(4 / 9)
    assert script_share("Kenたろう", "japanese") == pytest.approx(3 / 6)
    assert script_share("山田", "japanese") == 1.0
    assert script_share("김민수", "japanese") == 0.0
    # the Mii table has no Hangul; a Switch profile name does
    assert not is_switch_name_char("김")
    assert is_switch_name_char("김", "korean")
    assert not is_switch_name_char("김", "cyrillic")
    assert is_switch_name_char("a")


@pytest.mark.parametrize("text, confidence, expected", [
    ("", 0, False),        # empty boxes keep their placeholder handling
    ("Erik", 86, False),   # no script reading could beat it by the margin
    ("Erik", 85, True),
    ("1235", 62, True),    # たろう as the Latin reader sees it
])
def test_script_readers_only_look_when_a_script_reading_could_still_win(text, confidence, expected):
    assert may_need_script_readers(text, confidence) is expected


def test_a_clearly_better_script_reading_replaces_the_latin_one():
    choice = choose_player_name("1235", 62, {"japanese": [("たろう", 100), ("たろう", 99)],
                                              "korean": [("*35", 85)]})
    assert (choice.text, choice.confidence, choice.script) == ("たろう", 100, "japanese")


def test_without_the_margin_the_latin_reading_stays():
    # "Menno" read by the Cyrillic reader as look-alike letters: same confidence, Latin stays
    assert choose_player_name("Menno", 100, {"cyrillic": [("Меппо", 100)]}).script == "latin"
    assert choose_player_name("Hatawa", 70, {"cyrillic": [("Наташа", 84)]}).script == "latin"
    assert choose_player_name("Hatawa", 70, {"cyrillic": [("Наташа", 85)]}).text == "Наташа"
    assert choose_player_name("x", 0, {"japanese": [("たろう", 49)]}).script == "latin"


def test_a_script_reader_reading_latin_text_never_replaces_the_latin_reading():
    # the script readers include English; their Latin output is not a script reading
    assert choose_player_name("Sandr", 20, {"cyrillic": [("Sander", 95)]}).text == "Sandr"
    # a mixed name counts when its own script is at least half of it
    assert choose_player_name("Kent:35", 30, {"japanese": [("Kenたろう", 90)]}).text == "Kenたろう"
    assert choose_player_name("Ivon_vBah", 49, {"cyrillic": [("Ivan_иван", 100)]}).script == "latin"


def test_characters_a_switch_name_cannot_hold_reject_a_reading():
    assert choose_player_name("x", 10, {"cyrillic": [("Ивกан", 99)]}).script == "latin"


def test_two_scripts_in_doubt_keep_the_latin_reading():
    assert choose_player_name("Z:lF", 12, {"korean": [("김민수", 90)], "cyrillic": [("цнш", 80)]}).script == "latin"
    assert choose_player_name("Z:lF", 12, {"korean": [("김민수", 99)], "japanese": [("召", 73)]}).text == "김민수"


def test_japanese_and_chinese_readings_compete_on_confidence():
    readings = {"japanese": [("金魚", 90)], "traditional_chinese": [("金", 100)], "simplified_chinese": [("金鱼", 70)]}
    assert choose_player_name("#f", 55, readings).text == "金"
    same = {"japanese": [("星雲", 100)], "traditional_chinese": [("星雲", 100)]}
    assert choose_player_name("#f", 55, same).script == "japanese"


def test_memory_is_keyed_by_the_latin_reading_and_doubts_a_contradicting_text():
    memory = ScriptMemory()
    taro = scripts.NameChoice("たろう", 100, "japanese")
    assert memory.settle("t = 55", taro) == taro
    assert memory.recall("t=55") == ("japanese", "たろう")
    # the same Latin reading now gives a neighbour's name: a doubt, the frame keeps its Latin reading
    assert memory.settle("t=55", scripts.NameChoice("たろ", 100, "japanese")) is None
    assert memory.is_ambiguous("t=55")
    assert memory.settle("t=55", taro) == taro
    assert memory.recall("t=55") == ("japanese", "たろう")


def test_a_reading_that_stayed_latin_settles_once_if_confident_twice_if_weak():
    memory = ScriptMemory()
    latin = scripts.NameChoice("Erik", 70, "latin")
    assert memory.settle("Erik", latin) is None
    assert memory.recall("Erik") is None
    assert memory.recall("Erik", confident=True) == "latin"
    memory.settle("Erik", latin)
    assert memory.recall("Erik") == "latin"


def test_a_confident_latin_reading_gives_way_only_to_a_confident_reading_in_its_own_letters():
    choose = scripts.confident_script_choice
    assert choose("Onbra", 100, {"cyrillic": [("Ольга", 99)]}).text == "Ольга"
    assert choose("Menno", 100, {"cyrillic": [("Меппо", 100)]}).script == "latin"  # look-alike letters only
    assert choose("Onbra", 100, {"cyrillic": [("Ольга", 89)]}).script == "latin"
    assert choose("194", 90, {"japanese": [("ユウキ", 95)]}).text == "ユウキ"


def _fake_readers(monkeypatch, extract_text, latin, script_texts, calls):
    def fake_variant(image, coord_list, *, preprocess, bundle_kind="", field_name="", languages=None):
        if languages is None or tuple(languages) == tuple(extract_text.PLAYER_NAME_EASYOCR_LANGS):
            return [text for text, _ in latin][:len(coord_list)], [conf for _, conf in latin][:len(coord_list)]
        code = tuple(languages)[0]
        calls.append((code, len(coord_list)))
        # per row (by its top edge), or one reading for every row
        found = script_texts.get(code, ("", 0))
        per_row = [found.get(y1, ("", 0)) if isinstance(found, dict) else found for (_, y1), _ in coord_list]
        return [text for text, _ in per_row], [confidence for _, confidence in per_row]

    monkeypatch.setattr(extract_text, "_run_easyocr_player_names_batched_variant", fake_variant)
    monkeypatch.setattr(extract_text, "_get_easyocr_reader", lambda languages: object())
    monkeypatch.setattr(extract_text, "_run_easyocr_player_name_for_context", lambda *a, **k: ("", 0))
    monkeypatch.setattr(extract_text, "PLAYER_NAME_BATCH_RAW_MODE", "off")


@pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)
def test_every_new_reading_is_read_once_and_only_a_clearly_better_one_passes(monkeypatch):
    from mk8dx_tournament_extraction.engine import extract_text

    scripts.SCRIPT_MEMORY.clear()
    calls = []
    _fake_readers(monkeypatch, extract_text, [("Erik", 99), ("1235", 62), ("Sander", 90)],
                  {"ja": {30: ("たろう", 100)}, "ko": {30: ("*35", 80), 60: ("산더", 70)}}, calls)
    image = np.zeros((90, 300, 3), dtype=np.uint8)
    coords = [((0, 0), (200, 30)), ((0, 30), (200, 60)), ((0, 60), (200, 90))]
    try:
        names, confidences = extract_text.extract_player_names_batched(
            image, coords, bundle_kind="2RaceScore", field_name="RacePlayerName")
    finally:
        scripts.SCRIPT_MEMORY.clear()
    assert names == ["Erik", "たろう", "Sander"]
    assert confidences[1] == 100
    # all three readings are new: every script reader, both preprocessings, one batch
    assert calls == [(code, 3) for code in ("ru", "ru", "ja", "ja", "ko", "ko", "ch_sim", "ch_sim", "ch_tra", "ch_tra")]


@pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)
def test_a_remembered_script_is_tried_first_and_a_settled_latin_reading_is_left_alone(monkeypatch):
    from mk8dx_tournament_extraction.engine import extract_text

    scripts.SCRIPT_MEMORY.clear()
    calls = []
    japanese = {"ja": {0: ("たろう", 100)}}
    _fake_readers(monkeypatch, extract_text, [("1235", 62), ("Erik", 70)], japanese, calls)
    image = np.zeros((60, 300, 3), dtype=np.uint8)
    coords = [((0, 0), (200, 30)), ((0, 30), (200, 60))]

    def read():
        calls.clear()
        return extract_text.extract_player_names_batched(
            image, coords, bundle_kind="2RaceScore", field_name="RacePlayerName")[0]

    try:
        assert read() == ["たろう", "Erik"] and len(calls) == 10  # both rows, every script
        # "1235": Japanese first; the weak "Erik" stayed Latin once, so every script reads it again
        assert read() == ["たろう", "Erik"]
        assert calls[:2] == [("ja", 1), ("ja", 1)] and len(calls) == 2 + 10
        # "Erik" stayed Latin twice: left alone; "1235" only reads Japanese
        assert read() == ["たろう", "Erik"] and calls == [("ja", 1), ("ja", 1)]
        japanese["ja"] = {0: ("たろ", 100)}  # the remembered reader contradicts itself: Latin for this frame
        assert read() == ["1235", "Erik"] and calls == [("ja", 1), ("ja", 1)]
        japanese["ja"] = {}  # no plausible reading at all: every other script reads the box again
        assert read() == ["1235", "Erik"] and len(calls) == 2 + 8
    finally:
        scripts.SCRIPT_MEMORY.clear()


@pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)
def test_a_confident_latin_reading_is_read_once(monkeypatch):
    from mk8dx_tournament_extraction.engine import extract_text

    scripts.SCRIPT_MEMORY.clear()
    calls = []
    _fake_readers(monkeypatch, extract_text, [("Menno", 100), ("Onbra", 100)],
                  {"ru": {0: ("Меппо", 100), 30: ("Ольга", 99)}}, calls)
    image = np.zeros((60, 300, 3), dtype=np.uint8)
    coords = [((0, 0), (200, 30)), ((0, 30), (200, 60))]
    try:
        names, _ = extract_text.extract_player_names_batched(
            image, coords, bundle_kind="2RaceScore", field_name="RacePlayerName")
        assert names == ["Menno", "Ольга"] and len(calls) == 10
        calls.clear()
        names, _ = extract_text.extract_player_names_batched(
            image, coords, bundle_kind="2RaceScore", field_name="RacePlayerName")
        # "Menno" settled after one look; "Onbra" resolved to Cyrillic: only that reader
        assert names == ["Menno", "Ольга"] and calls == [("ru", 1), ("ru", 1)]
    finally:
        scripts.SCRIPT_MEMORY.clear()
