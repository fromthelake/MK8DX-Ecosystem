"""The setting that turns name reading in the non-Latin scripts off (MK8DX_NAME_SCRIPTS, default on).

Off: the five script readers are never constructed or run for player names; the Latin reading goes on as
before. The readers are mocked."""
import numpy as np
import pytest

from conftest import SKIP_REASON, recorded_assets

from mk8dx_tournament_extraction.engine import player_name_scripts as scripts


@pytest.mark.parametrize("value, expected", [
    ("on", True), ("ON", True), (" On ", True), ('"on"', True), ("1", True), ("true", True), ("yes", True),
    ("off", False), ("OFF", False), ("0", False), ("false", False), ("no", False),
    ("", None), (None, None), ("maybe", None),
])
def test_setting_values(value, expected):
    assert scripts.parse_setting(value) is expected


def test_default_is_on_and_only_off_turns_it_off():
    assert scripts.enabled({}) is True
    assert scripts.enabled({"MK8DX_NAME_SCRIPTS": "on"}) is True
    assert scripts.enabled({"MK8DX_NAME_SCRIPTS": "unclear"}) is True  # correct results first
    assert scripts.enabled({"MK8DX_NAME_SCRIPTS": "off"}) is False


def test_a_saved_window_choice_wins_over_the_environment():
    assert scripts.saved_or_environment("off", {"MK8DX_NAME_SCRIPTS": "on"}) is False
    assert scripts.saved_or_environment("on", {"MK8DX_NAME_SCRIPTS": "off"}) is True
    assert scripts.saved_or_environment("", {"MK8DX_NAME_SCRIPTS": "off"}) is False
    assert scripts.saved_or_environment(None, {}) is True
    environ: dict[str, str] = {}
    scripts.apply(False, environ)
    assert environ == {"MK8DX_NAME_SCRIPTS": "off"}
    scripts.apply(True, environ)
    assert environ == {"MK8DX_NAME_SCRIPTS": "on"}


SCRIPT_LANGUAGES = {tuple(languages) for languages in scripts.SCRIPT_READERS.values()}


def _read_names(monkeypatch, setting):
    from mk8dx_tournament_extraction.engine import extract_text

    monkeypatch.setenv("MK8DX_NAME_SCRIPTS", setting)
    constructed: list[tuple[str, ...]] = []
    script_runs: list[tuple[str, ...]] = []

    def fake_variant(image, coord_list, *, preprocess, bundle_kind="", field_name="", languages=None):
        if languages is None or tuple(languages) == tuple(extract_text.PLAYER_NAME_EASYOCR_LANGS):
            latin = [("Erik", 99), ("1235", 62)][:len(coord_list)]
            return [text for text, _ in latin], [confidence for _, confidence in latin]
        script_runs.append(tuple(languages))
        # the second box (top edge 30) holds kana; the first is Latin
        per_row = [("たろう", 100) if y1 == 30 else ("", 0) for (_, y1), _ in coord_list]
        return [text for text, _ in per_row], [confidence for _, confidence in per_row]

    def fake_reader(languages):
        constructed.append(tuple(languages))
        return object()

    monkeypatch.setattr(extract_text, "_run_easyocr_player_names_batched_variant", fake_variant)
    monkeypatch.setattr(extract_text, "_get_easyocr_reader", fake_reader)
    monkeypatch.setattr(extract_text, "_run_easyocr_player_name_for_context", lambda *a, **k: ("", 0))
    monkeypatch.setattr(extract_text, "PLAYER_NAME_BATCH_RAW_MODE", "off")
    scripts.SCRIPT_MEMORY.clear()
    try:
        names, _ = extract_text.extract_player_names_batched(
            np.zeros((60, 300, 3), dtype=np.uint8), [((0, 0), (200, 30)), ((0, 30), (200, 60))],
            bundle_kind="2RaceScore", field_name="RacePlayerName")
    finally:
        scripts.SCRIPT_MEMORY.clear()
    return names, constructed, script_runs


@pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)
def test_off_never_constructs_or_runs_a_script_reader(monkeypatch):
    names, constructed, script_runs = _read_names(monkeypatch, "off")
    assert names == ["Erik", "1235"]  # the Latin reading, exactly as before
    assert not SCRIPT_LANGUAGES & set(constructed)
    assert script_runs == []


@pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)
def test_on_reads_with_every_script_reader_as_before(monkeypatch):
    names, constructed, script_runs = _read_names(monkeypatch, "on")
    assert names == ["Erik", "たろう"]
    assert SCRIPT_LANGUAGES <= set(constructed)
    assert set(script_runs) == SCRIPT_LANGUAGES


def test_the_warm_up_never_loads_a_script_reader():
    from live_processor import ocr_runtime

    assert not SCRIPT_LANGUAGES & {tuple(languages) for languages in ocr_runtime._warmup_language_sets()}
