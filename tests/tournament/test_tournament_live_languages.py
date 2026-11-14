"""Tournament Live's window texts in the 15 product languages (roadmap LANGUAGES_15, part B).

Every text the Qt window writes itself goes through `_tr` (the `_DUTCH_UI` table and the status patterns) or
`_say("<English>", "<Dutch>", values...)`: Dutch for nl, the catalog for the 13 catalog languages, English
otherwise. These tests keep the code free of EN/NL-only ternaries, every `_say` text in the message source the
catalogs are built from, and English and Dutch exactly as they were."""
from __future__ import annotations

import ast
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from live_processor import product_languages

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "apps" / "tournament-live" / "src" / "live_processor"
MESSAGES = ROOT / "apps" / "tournament-live" / "i18n" / "messages.source.json"


def _extractor():
    spec = importlib.util.spec_from_file_location("extract_desktop_messages", ROOT / "tooling" / "i18n" / "extract_desktop_messages.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _language_comparisons(path: Path) -> list[int]:
    """Lines comparing a language with "nl" outside `_tr` (which itself is the Dutch source table's reader)."""
    found = []

    def visit(node: ast.AST, inside_tr: bool) -> None:
        if isinstance(node, ast.FunctionDef):
            inside_tr = inside_tr or node.name == "_tr"
        if isinstance(node, ast.Compare) and not inside_tr:
            sides = [node.left, *node.comparators]
            names = [side.attr if isinstance(side, ast.Attribute) else getattr(side, "id", None) for side in sides]
            if "language" in names and any(isinstance(side, ast.Constant) and side.value == "nl" for side in sides):
                found.append(node.lineno)
        for child in ast.iter_child_nodes(node):
            visit(child, inside_tr)

    visit(ast.parse(path.read_text(encoding="utf-8")), False)
    return found


@pytest.mark.parametrize("name", ["qt_app.py", "gui_app.py"])
def test_no_english_dutch_only_ternaries_remain(name):
    assert _language_comparisons(SOURCE / name) == []


def test_every_say_text_is_in_the_message_source():
    source = {entry["key"]: entry for entry in json.loads(MESSAGES.read_text(encoding="utf-8"))["messages"]}
    extractor = _extractor()
    calls = [call for name in ("qt_app.py", "gui_app.py") for call in extractor.say_calls(SOURCE / name)]
    assert len(calls) > 80
    missing = [english for english, _dutch, _line in calls if english not in source]
    assert missing == [], "run python tooling/i18n/extract_desktop_messages.py"
    # Dutch comes with every text, so the catalogs have it as context.
    assert [english for english, dutch, _line in calls if dutch != english and not source[english].get("nl")] == []


def _catalog(tmp_path: Path, code: str, messages: dict[str, str]) -> Path:
    (tmp_path / f"{code}.json").write_text(json.dumps({"messages": messages}, ensure_ascii=False), encoding="utf-8")
    return tmp_path


def test_say_keeps_english_and_dutch_and_reads_the_catalog(tmp_path):
    root = _catalog(tmp_path, "de", {"Signed in as {0}": "Angemeldet als {0}",
                                     "{0} results uploaded; {1} retained locally.": "{0} hochgeladen; {1} lokal.",
                                     "Choose Tournament": "Turnier wählen"})
    say = product_languages.say
    assert say("en", "Signed in as {0}", "Aangemeld als {0}", "Ann", root=root) == "Signed in as Ann"
    assert say("en-US", "Signed in as {0}", "Aangemeld als {0}", "Ann", root=root) == "Signed in as Ann"
    assert say("nl", "Signed in as {0}", "Aangemeld als {0}", "Ann", root=root) == "Aangemeld als Ann"
    assert say("de", "Signed in as {0}", "Aangemeld als {0}", "Ann", root=root) == "Angemeldet als Ann"
    assert say("de", "{0} results uploaded; {1} retained locally.", "x", 3, 1, root=root) == "3 hochgeladen; 1 lokal."
    assert say("de", "Choose Tournament", "Toernooi kiezen", root=root) == "Turnier wählen"
    # A text the catalog lacks, and a language without a catalog, stay English.
    assert say("de", "Start new run", "Nieuwe run starten", root=root) == "Start new run"
    assert say("fr", "Signed in as {0}", "Aangemeld als {0}", "Ann", root=root) == "Signed in as Ann"
    # A value that itself looks like a placeholder is inserted literally.
    assert say("en", "No current group: {0}", "Geen actuele groep: {0}", "{1}", "x") == "No current group: {1}"


def test_translate_template_returns_the_unfilled_template(tmp_path):
    root = _catalog(tmp_path, "it", {"Step {0} / 5": "Passaggio {0} / 5"})
    assert product_languages.translate_template("it", "Step {0} / 5", root) == "Passaggio {0} / 5"
    assert product_languages.translate_template("it", "Step", root) == "Step"
    assert product_languages.translate_template("nl", "Step {0} / 5", root) == "Step {0} / 5"


def test_analysis_progress_is_unchanged_in_english_and_dutch():
    gui_app = pytest.importorskip("live_processor.gui_app")
    progress = gui_app.format_analysis_progress
    assert progress(0, 0) == "OCR & standings: waiting for the first race"
    assert progress(0, 0, language="nl") == "OCR & stand: wacht op de eerste race"
    assert progress(4, 4, source_finished=True, is_capture=True) == (
        "Feed stopped · OCR & standings up to date: 4/4 races confirmed")
    assert progress(4, 4, source_finished=True, language="nl") == "Video ingelezen · OCR & stand bij: 4/4 races bevestigd"
    assert progress(5, 2, 1) == "OCR & standings: 2/5 confirmed · 1 active · 2 waiting"
    assert progress(5, 2, 1, source_finished=True, language="nl") == (
        "Video ingelezen · OCR & stand loopt achter: 2/5 bevestigd · 1 bezig · 2 wachtend")


class _Label:
    def __init__(self) -> None:
        self.text = ""

    def setText(self, text: str) -> None:  # noqa: N802 - the Qt name
        self.text = text

    def setFormat(self, text: str) -> None:  # noqa: N802
        self.text = text

    def setStyleSheet(self, _style: str) -> None:  # noqa: N802
        pass

    def setValue(self, _value: int) -> None:  # noqa: N802
        pass

    def show(self) -> None:
        pass


def _stop_progress(qt_app, language: str, state: str, stage: int) -> tuple[str, str]:
    window = SimpleNamespace(
        language=language, _stop_progress_state=state, _stop_progress_stage=stage,
        _stop_progress_confirmed=2, _stop_progress_found=5, connection_context=None,
        stop_progress_text=_Label(), stop_progress_bar=_Label(), stop_progress_panel=_Label(),
    )
    window._say = lambda *args: qt_app.Mk8dxQtGui._say(window, *args)
    qt_app.Mk8dxQtGui._render_stop_progress(window)
    return window.stop_progress_text.text, window.stop_progress_bar.text


def test_qt_stop_progress_in_english_dutch_and_a_catalog_language(monkeypatch, tmp_path):
    pytest.importorskip("PySide6")
    qt_app = pytest.importorskip("live_processor.qt_app")
    assert _stop_progress(qt_app, "en", "active", 2) == (
        "FINISHING STOP — step 2 of 5: Completing final analysis\n"
        "Confirmed 2 of 5 detected races. Do not close; START remains blocked.",
        "Step 2 / 5",
    )
    assert _stop_progress(qt_app, "nl", "waiting", 3) == (
        "STOP AFRONDEN — stap 3 van 5: Lokale resultaten veilig opslaan\n"
        "Resultaten staan lokaal veilig in de wachtrij; de opnames worden nu afgerond.",
        "Stap 3 / 5",
    )
    assert _stop_progress(qt_app, "nl", "pending_delivery", 5) == (
        "STOP LOKAAL VOLTOOID — nieuwe START is veilig\n"
        "Ecosystem delivery wacht nog. Tournament Manager Stap 5/9 blijft onvolledig; "
        "gebruik Upload opnieuw proberen, Excel-import of handmatige invoer.",
        "Lokaal voltooid",
    )
    monkeypatch.setattr(product_languages, "CATALOG_ROOT", _catalog(tmp_path, "de", {
        "FINISHING STOP — step {0} of 5: {1}": "STOP WIRD ABGESCHLOSSEN — Schritt {0} von 5: {1}",
        "Completing final analysis": "Abschließende Analyse",
        "Step {0} / 5": "Schritt {0} / 5",
    }))
    text, bar = _stop_progress(qt_app, "de", "active", 2)
    assert text.startswith("STOP WIRD ABGESCHLOSSEN — Schritt 2 von 5: Abschließende Analyse\n")
    assert bar == "Schritt 2 / 5"
