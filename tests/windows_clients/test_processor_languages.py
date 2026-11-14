"""The Tournament Analysis window in the 15 game languages: catalogs, language choice and texts. No window opens."""

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from tournament_processor import gui, languages

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "apps" / "tournament-processor" / "i18n" / "messages.source.json"
CATALOGS = ROOT / "apps" / "tournament-processor" / "src" / "tournament_processor" / "i18n"
CATALOG_LANGUAGES = ("en-US", "fr", "fr-CA", "de", "es", "es-419", "it", "pt", "ru", "ja", "ko", "zh-CN", "zh-TW")
PLACEHOLDER = re.compile(r"\{[A-Za-z0-9_]*\}")


def _source() -> dict:
    return json.loads(SOURCE.read_text(encoding="utf-8"))


def test_the_source_is_up_to_date():
    result = subprocess.run([sys.executable, str(ROOT / "tooling" / "i18n" / "extract_processor_messages.py"), "--check"],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_source_holds_every_english_and_dutch_text():
    source = _source()
    assert source["schemaVersion"] == "mk8dx.tournament-processor-message-source.v1"
    entries = {entry["key"]: entry["nl"] for entry in source["messages"]}
    assert [entry["key"] for entry in source["messages"]] == sorted(entries)
    assert entries == {english: dutch for english, dutch in gui.TEXTS.values()}


def test_the_languages_are_those_of_tournament_live():
    from live_processor import product_languages

    assert languages.LANGUAGES == tuple((code, name) for code, name, _ in product_languages.LANGUAGES)
    assert sorted(code for code, _ in languages.LANGUAGES) == sorted(("en", "nl") + CATALOG_LANGUAGES)


def test_every_catalog_has_every_text_with_the_same_placeholders():
    keys = [entry["key"] for entry in _source()["messages"]]
    assert sorted(path.name for path in CATALOGS.iterdir()) == sorted(f"{code}.json" for code in CATALOG_LANGUAGES)
    for language in CATALOG_LANGUAGES:
        catalog = json.loads((CATALOGS / f"{language}.json").read_text(encoding="utf-8"))
        assert catalog["schemaVersion"] == "mk8dx.web-message-catalog.v1"
        assert catalog["language"] == language
        assert "gameNames" not in catalog
        messages = catalog["messages"]
        assert sorted(set(messages) - set(keys)) == [], language
        if language == "en-US":  # English (US) is the English source text
            continue
        assert [key for key in keys if key not in messages] == [], language
        for english, translated in messages.items():
            assert translated.strip(), (language, english)
            assert sorted(PLACEHOLDER.findall(translated)) == sorted(PLACEHOLDER.findall(english)), (language, english)


@pytest.mark.parametrize(("preferred", "expected"), [
    (["de-DE", "en"], "de"), (["es-MX"], "es-419"), (["es-419"], "es-419"), (["es-ES"], "es"), (["es"], "es"),
    (["zh-Hant-HK"], "zh-TW"), (["zh-HK"], "zh-TW"), (["zh-TW"], "zh-TW"), (["zh"], "zh-CN"), (["zh-Hans-SG"], "zh-CN"),
    (["fr-CA"], "fr-CA"), (["fr-BE"], "fr"), (["en-US"], "en-US"), (["en-AU"], "en"), (["pt-BR"], "pt"),
    (["nl-BE"], "nl"), (["xx-YY", "ja-JP"], "ja"), (["*"], "en"), ([], "en"), (["sv", "ko_KR"], "ko"),
    (["nl_NL.UTF-8"], "nl"), (["Dutch_Netherlands"], "nl"), (["it-CH"], "it"),
])
def test_the_system_language_maps_exact_then_regional_then_base(preferred, expected):
    assert languages.choose_language(environ={}, saved=lambda: None, preferred=preferred) == expected


def test_explicit_environment_and_saved_choices_come_first():
    no_saved = lambda: None  # noqa: E731
    assert languages.choose_language("ja", {"MK8DX_LANGUAGE": "de"}, no_saved, ["ru"]) == "ja"
    assert languages.choose_language(None, {"MK8DX_LANGUAGE": "zh-tw"}, no_saved, ["ru"]) == "zh-TW"
    assert languages.choose_language(None, {"MK8DX_LANGUAGE": "klingon", "MK8DX_TOURNAMENT_LANGUAGE": "nl"},
                                     no_saved, ["ru"]) == "nl"
    assert languages.choose_language(None, {"MK8DX_TOURNAMENT_LANGUAGE": "auto"}, lambda: "es-419", ["ru"]) == "es-419"
    assert languages.choose_language(None, {"MK8DX_TOURNAMENT_LANGUAGE": "auto"}, no_saved, ["ru-RU"]) == "ru"
    assert gui.detect_language({"MK8DX_LANGUAGE": "KO"}) == "ko"


def test_translated_texts_fill_named_placeholders():
    german, japanese = gui.Texts("de"), gui.Texts("ja")
    assert german.language == "de" and gui.Texts("unknown").language == "en"
    for key in ("start", "step_recordings", "card_run", "results_missing", "status_ready"):
        for texts in (german, japanese, gui.Texts("zh-TW"), gui.Texts("es-419"), gui.Texts("fr-CA")):
            assert texts(key) != gui.Texts("en")(key), (texts.language, key)
    assert german("selected_summary", selected=2, total=5) == "2 von 5 ausgewählt"
    assert "3" in japanese("kind_folder_count", count=3)
    assert gui.Texts("en-US")("start") == "Start analysis"


def test_english_and_dutch_stay_the_source_texts():
    english, dutch = gui.Texts("en"), gui.Texts("nl")
    for key, (en_text, nl_text) in gui.TEXTS.items():
        values = {name: "X" for name in re.findall(r"\{(\w+)\}", en_text)}
        assert english(key, **values) == en_text.format(**values)
        assert dutch(key, **values) == nl_text.format(**values)


def test_the_language_argument_takes_the_15_codes():
    assert gui._arguments(["--language", "zh-cn"]).language == "zh-CN"
    with pytest.raises(SystemExit):
        gui._arguments(["--language", "xx"])
