"""The Qt analysis window: log/progress parsing and front-end choice without Qt, the window itself headless."""

import os
import sys
from pathlib import Path

import pytest

from tournament_processor import gui
from tournament_processor.log_format import AnsiState, LineBuffer, Style, parse_percent, strip_ansi, xterm256


def test_ansi_runs_keep_colour_across_lines():
    state = AnsiState()
    runs = state.runs("\x1b[1;96m[VIDEO 1]\x1b[0m Race 1   \x1b[93mwarning")
    assert [text for text, _ in runs] == ["[VIDEO 1]", " Race 1   ", "warning"]
    assert runs[0][1] == Style(fg="#6ff0ff", bold=True)
    assert runs[1][1] == Style()
    assert runs[2][1].fg == "#ffe066"
    # No reset at the end: the next line continues in yellow, as in a terminal.
    assert state.runs("still")[0][1].fg == "#ffe066"
    state.reset()
    assert state.runs("plain") == [("plain", Style())]


def test_ansi_256_and_truecolour_and_dim():
    state = AnsiState()
    assert state.runs("\x1b[38;5;196mred")[0][1].fg == xterm256(196) == "#ff0000"
    assert state.runs("\x1b[38;2;1;2;3mrgb")[0][1].fg == "#010203"
    assert xterm256(232) == "#080808"
    assert xterm256(9) == "#ff6b6b"
    dim = state.runs("\x1b[0;2mdim")[0][1]
    assert dim.dim and dim.color() == "#6b6f77"
    assert state.runs("\x1b[22;39mback")[0][1] == Style()
    assert state.runs("\x1b[mreset")[0][1] == Style()


def test_progress_percent_from_status_lines():
    assert parse_percent("Comp  35% | Done 3/9 | CPU 40%") == 35
    assert parse_percent("\x1b[96mComp\x1b[0m  100%") == 100
    assert parse_percent("Perc  16%") == 16
    assert parse_percent("CPU 40% RAM 12%") is None
    assert parse_percent("Comp 250%") == 100
    assert strip_ansi("\x1b[1mA\x1b[0m") == "A"


def test_line_buffer_splits_like_the_runner():
    buffer = LineBuffer()
    assert buffer.feed("one\r\ntw") == ["one"]
    assert buffer.feed("o\nthree") == ["two"]
    assert buffer.flush() == ["three"]
    assert buffer.flush() == []


def test_frontend_choice_prefers_qt_and_falls_back():
    marker = object()
    assert gui.choose_frontend(False, lambda: marker) == ("qt", marker, "")
    assert gui.choose_frontend(True, lambda: marker) == ("classic", None, "requested")

    def missing():
        raise ImportError("No module named 'PySide6'")

    frontend, module, reason = gui.choose_frontend(False, missing)
    assert (frontend, module) == ("classic", None)
    assert "PySide6" in reason


def test_classic_flag_parses():
    args = gui._arguments(["--classic-gui", "a.mkv"])
    assert args.classic_gui and args.paths == [Path("a.mkv")]


def test_background_override_then_packaged_image_then_drawn(tmp_path):
    image = tmp_path / "banner.jpg"
    image.write_bytes(b"x")
    packaged = tmp_path / "bg.jpg"
    packaged.write_bytes(b"y")
    absent = tmp_path / "absent.jpg"
    assert gui.analysis_background({}, packaged) == packaged
    assert gui.analysis_background({"MK8DX_ANALYSIS_BACKGROUND": str(absent)}, packaged) == packaged
    assert gui.analysis_background({"MK8DX_ANALYSIS_BACKGROUND": str(tmp_path)}, packaged) == packaged
    assert gui.analysis_background({"MK8DX_ANALYSIS_BACKGROUND": f'"{image}"'}, packaged) == image
    assert gui.analysis_background({}, absent) is None
    assert gui.analysis_background({}, None) is None


def test_the_packaged_banner_image_ships_with_the_source():
    assert gui.PACKAGED_BACKGROUND.is_file()
    assert gui.analysis_background({}) == gui.PACKAGED_BACKGROUND


# --------------------------------------------------------------------------- #
# Boundary: the window is presentation only                                    #
# --------------------------------------------------------------------------- #

PROCESSOR_SOURCE = Path(gui.__file__).resolve().parent
WINDOW_MODULES = sorted([*(PROCESSOR_SOURCE / "qt").glob("*.py"), PROCESSOR_SOURCE / "gui.py",
                         PROCESSOR_SOURCE / "gui_classic.py", PROCESSOR_SOURCE / "log_format.py"])
FORBIDDEN_ROOTS = ("live_processor", "baseline_extractor", "mk8_local_play", "mk8dx_video_result_extractor",
                   "mk8dx_tournament_extraction")


def _imported_modules(path: Path) -> set[str]:
    import ast

    names: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                names.add("." * node.level + (node.module or ""))
            else:
                names.add(node.module or "")
    return names


@pytest.mark.parametrize("path", WINDOW_MODULES, ids=lambda path: path.name)
def test_window_modules_import_no_engine_and_no_original_project(path):
    """Recognition stays in packages/tournament-extraction, reached only through the vision_cli child process."""
    for name in _imported_modules(path):
        assert name.split(".")[0] not in FORBIDDEN_ROOTS, f"{path.name} imports {name}"
        # Inside this package the window may only use its own presentation modules and the shared gui helpers.
        if name.startswith("..") or (name.startswith(".") and path.parent.name != "qt"):
            assert name.lstrip(".") in {"gui", "log_format", "gui_classic", "qt", "", "qt.app"}, \
                f"{path.name} imports {name}"


def test_window_runs_only_the_central_vision_cli_route(tmp_path):
    video = tmp_path / "Group 1.mkv"
    video.write_bytes(b"x")
    command = gui.build_plan([video], "night", tmp_path / "Session").command("python")
    assert command[1:5] == ["-u", "-m", "tournament_processor.vision_cli", "all"]
    # The Qt runner starts exactly the plan's command; it builds no command line of its own.
    runner = (PROCESSOR_SOURCE / "qt" / "process_runner.py").read_text(encoding="utf-8")
    assert "self._plan.command()" in runner
    assert '"-m"' not in runner and "main.py\"" not in runner


def test_qt_texts_exist_in_both_languages():
    for key in ("banner_title", "start_big", "card_results", "log_cancelling", "badge_failed"):
        english, dutch = gui.TEXTS[key]
        assert english and dutch


# --------------------------------------------------------------------------- #
# Headless Qt (skipped without PySide6)                                        #
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def qt_app():
    pytest.importorskip("PySide6")
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    from tournament_processor.qt import app

    return app.application()


def _wait(qt_app, condition, timeout=20.0):
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline and not condition():
        qt_app.processEvents()
        time.sleep(0.02)
    qt_app.processEvents()
    return condition()


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    return path


def test_qt_window_lists_entries_and_fills_defaults(qt_app, tmp_path, monkeypatch):
    monkeypatch.delenv("MK8DX_ANALYSIS_BACKGROUND", raising=False)
    from tournament_processor.qt.app import create_window

    night = tmp_path / "2026-11-08 Club night"
    _touch(night / "Final A.mkv")
    video = _touch(tmp_path / "Qualifier group 1.mkv")
    window = create_window(gui.Texts("nl"), [night, video])
    assert window.windowTitle() == "MK8DX Tournament Analysis"
    assert window._video_list.count() == 2
    assert window._summary_label.text() == "2 van 2 gekozen"
    assert window._session_edit.text() == "2026-11-08-Club-night"
    assert window._root_edit.text() == str(tmp_path / "2026-11-08 Club night_TournamentSession")
    window._set_all_checked(False)
    assert window.selected_entries() == []
    window._set_all_checked(True)
    assert window.selected_entries() == [night, video]
    window.close()


def test_qt_run_streams_coloured_output_and_finishes(qt_app, tmp_path, monkeypatch):
    from tournament_processor.qt.app import create_window

    video = _touch(tmp_path / "Group 1.mkv")
    window = create_window(gui.Texts("en"), [video], runtime_root=tmp_path / "Session", session_id="night")
    monkeypatch.setattr("tournament_processor.qt.main_window.check_environment", lambda: [])
    script = "print('\\x1b[92mRace 1 read\\x1b[0m'); print('Comp  50%', flush=True)"
    monkeypatch.setattr(gui.RunPlan, "command", lambda self, python=None: [sys.executable, "-u", "-c", script])
    window._run()
    assert window._runner.is_running()
    assert not window._start_btn.isEnabled() and window._cancel_btn.isEnabled()
    assert _wait(qt_app, lambda: not window._runner.is_running())
    log = window._log.toPlainText()
    assert "Race 1 read" in log and "\x1b" not in log
    assert window._status_text.text() == "Finished"
    assert window._progress.format() == "🏁 Finished"
    assert (tmp_path / "Session" / "Input_Videos" / "Group 1.mkv").is_file()
    assert window._start_btn.isEnabled()
    window.close()


def test_qt_cancel_ends_the_child(qt_app, tmp_path, monkeypatch):
    from tournament_processor.qt.app import create_window

    video = _touch(tmp_path / "Group 1.mkv")
    window = create_window(gui.Texts("en"), [video], runtime_root=tmp_path / "Session", session_id="night")
    monkeypatch.setattr("tournament_processor.qt.main_window.check_environment", lambda: [])
    script = "import time; print('working', flush=True); time.sleep(60)"
    monkeypatch.setattr(gui.RunPlan, "command", lambda self, python=None: [sys.executable, "-u", "-c", script])
    window._run()
    assert _wait(qt_app, lambda: "working" in window._log.toPlainText())
    window._runner.cancel()
    assert _wait(qt_app, lambda: not window._runner.is_running())
    assert window._status_text.text() == "Cancelled"
    window.close()


def test_qt_plan_errors_show_without_starting(qt_app, tmp_path, monkeypatch):
    from PySide6.QtWidgets import QMessageBox

    from tournament_processor.qt.app import create_window

    shown = []
    monkeypatch.setattr(QMessageBox, "critical", lambda *args: shown.append(args[2]))
    monkeypatch.setattr("tournament_processor.qt.main_window.check_environment", lambda: [])
    window = create_window(gui.Texts("en"), [tmp_path / "missing.mkv"], runtime_root=tmp_path / "S",
                           session_id="night")
    window._run()
    assert shown and "Not found" in shown[0]
    assert not window._runner.is_running()
    window.close()
