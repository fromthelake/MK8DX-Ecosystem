"""The Tournament Tools package writes its launchers, including the analysis window's."""

import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / "tooling" / "tournament" / "build_windows_package.py"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _setup_helper(tmp_path: Path):
    builder = _load(BUILDER, "_mk8dx_tournament_package_builder")
    helper_source = re.sub(r"@@[A-Z_]+@@", "0.0.0", builder.SETUP_HELPER_PY)
    helper_path = tmp_path / "mk8dx_tools_setup.py"
    helper_path.write_text(helper_source, encoding="utf-8")
    return builder, _load(helper_path, "_mk8dx_tools_setup_under_test")


def test_launchers_include_the_analysis_window(tmp_path):
    _, helper = _setup_helper(tmp_path)
    package = tmp_path / "package"
    package.mkdir()

    assert helper.write_launchers(package) is True

    analysis = (package / "TournamentAnalysis.cmd").read_bytes()
    assert b"\r\n" in analysis and b"\n" not in analysis.replace(b"\r\n", b"")
    text = analysis.decode("utf-8")
    assert '"%PYTHON%" -m tournament_processor.gui %*' in text
    assert "TournamentTools.config.cmd" in text
    assert "runtime-assets\\recorded\\assets" in text
    assert "runtime-assets\\clean-assets" in text
    for name in ("TournamentProcessor.cmd", "TournamentLive.cmd", "TournamentLiveCli.cmd",
                 "TournamentConnect.cmd", "TournamentTools.config.cmd"):
        assert (package / name).is_file(), name


def test_drag_and_drop_launcher_is_unchanged(tmp_path):
    _, helper = _setup_helper(tmp_path)
    package = tmp_path / "package"
    package.mkdir()
    helper.write_launchers(package)
    processor = (package / "TournamentProcessor.cmd").read_text(encoding="utf-8")
    assert 'tools\\mk8dx_tools_setup.py" process-video --package-root "%PKG_ROOT%." "%~1"' in processor
    assert "tournament_processor.gui" not in processor


def test_settings_file_is_kept(tmp_path):
    _, helper = _setup_helper(tmp_path)
    package = tmp_path / "package"
    package.mkdir()
    (package / "TournamentTools.config.cmd").write_bytes(b"rem mine\r\n")
    assert helper.write_launchers(package) is False
    assert (package / "TournamentTools.config.cmd").read_bytes() == b"rem mine\r\n"


def test_installer_and_readme_name_the_analysis_launcher(tmp_path):
    builder, _ = _setup_helper(tmp_path)
    say_lines = [line for line in builder.INSTALLER_CMD.splitlines() if "TournamentAnalysis.cmd" in line]
    assert len(say_lines) == 2  # header comment and the :say line
    assert any(line.startswith('call :say " TournamentAnalysis.cmd') and "afterwards" in line for line in say_lines)
    assert "TournamentAnalysis.cmd" in builder.README_FIRST
    builder.INSTALLER_CMD.encode("ascii")


def test_installer_and_readme_name_every_launcher(tmp_path):
    builder, _ = _setup_helper(tmp_path)
    for name in ("TournamentProcessor.cmd", "TournamentAnalysis.cmd", "TournamentLive.cmd",
                 "TournamentLiveCli.cmd", "TournamentConnect.cmd"):
        assert any(line.startswith(f'call :say " {name}') for line in builder.INSTALLER_CMD.splitlines()), name
        assert f"     {name}" in builder.README_FIRST, name
    assert "ocr-models" in builder.README_FIRST
    # Every OCR model ships in the package, so README-FIRST promises offline processing.
    assert "All OCR models are included" in builder.README_FIRST
    assert "english_g2.pth" not in builder.README_FIRST


def test_package_stages_every_ocr_model_a_reader_can_request():
    import json

    from live_processor import ocr_runtime
    from mk8dx_tournament_extraction import track_names
    from mk8dx_tournament_extraction.engine import player_name_scripts

    builder_source = BUILDER.read_text(encoding="utf-8")
    assert '("ocr-models", "ocr-models")' in builder_source
    assert '"stage", "--group", "ocr-models"' in builder_source
    # The package stages the collection's ocr-models group plus the build-time downloaded models.
    manifest = json.loads((ROOT / "packages/assets/collection/collection-manifest.v1.json").read_text(encoding="utf-8"))
    collected = {name.removeprefix("ocr-models/model/") for name in manifest["files"] if name.startswith("ocr-models/")}
    pins = json.loads((ROOT / "packages/assets/downloaded-models-v1.json").read_text(encoding="utf-8"))
    downloaded = {name.removeprefix("model/") for name in pins["groups"]["ocr-models"]["files"]}
    assert not collected & downloaded
    staged = collected | downloaded
    # The row/score reader, the default track reader, every game locale's track reader and
    # LiveTrial's console-language readers (consolelang.OCR_READERS, read without importing the engine).
    import ast

    consolelang = ROOT / "apps/timetrials-desktop/engine-overlay/livetrial/livetrial/consolelang.py"
    readers = next(ast.literal_eval(node.value) for node in ast.parse(consolelang.read_text(encoding="utf-8")).body
                   if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "OCR_READERS")
    sets = [["en"], ["en", "nl"], *(list(langs) for langs in track_names.OCR_LANGUAGES.values()),
            *readers.values(), ["en", "es", "fr", "de", "nl", "pl", "it", "pt"],
            *(list(langs) for langs in player_name_scripts.SCRIPT_READERS.values())]
    needed = {ocr_runtime.easyocr_recognition_model_file(langs) for langs in sets}
    assert None not in needed
    assert needed | {"craft_mlt_25k.pth"} <= staged
    assert needed == {"english_g2.pth", "latin_g2.pth", "cyrillic_g2.pth", "japanese_g2.pth",
                      "korean_g2.pth", "zh_sim_g2.pth", "chinese.pth"}


def test_package_installs_the_qt_window_and_offers_the_background_setting(tmp_path):
    _, helper = _setup_helper(tmp_path)
    assert any(item.startswith("mk8dx-tournament-processor[gui]==") for item in helper.DISTRIBUTIONS)
    assert 'rem set "MK8DX_ANALYSIS_BACKGROUND=' in helper.CONFIG_CMD


def test_package_settings_name_reading_in_every_script_and_the_engine_reads_it(tmp_path):
    import re

    from mk8dx_tournament_extraction.engine import player_name_scripts

    _, helper = _setup_helper(tmp_path)
    values = re.findall(r'^set "MK8DX_NAME_SCRIPTS=([^"]*)"$', helper.CONFIG_CMD, re.M)
    assert values == ["on"]  # default on: correct results first
    assert player_name_scripts.enabled({"MK8DX_NAME_SCRIPTS": values[0]}) is True
    assert player_name_scripts.enabled({"MK8DX_NAME_SCRIPTS": "off"}) is False

def test_package_texts_are_launcher_texts_in_every_language(tmp_path):
    """The installer, the launchers and the setup helper speak the launcher windows' 15 languages."""
    import json
    import shutil

    builder, helper = _setup_helper(tmp_path)
    source = {entry["key"] for entry in json.loads(
        (ROOT / "tooling/i18n/launcher/messages.source.json").read_text(encoding="utf-8"))["messages"]}
    package = tmp_path / "package"
    package.mkdir()
    helper.write_launchers(package)
    cmd_texts = re.findall(r'call :(?:say|title) "([^"]*)"', builder.INSTALLER_CMD)
    for name in helper.LAUNCHERS:
        text = (package / name).read_text(encoding="utf-8")
        assert re.findall(r"^title .*", text, re.M) == ["title %~1"], name  # every title goes through :title
        # Plain English echo lines are gone; only the command examples of the command-line window stay.
        assert re.search(r"^\s*echo [A-Za-z]", text, re.M) is None or name == "TournamentLiveCli.cmd", name
        cmd_texts += re.findall(r'call :(?:say|title) "([^"]*)"', text)
    assert "MK8DX Tournament Live" in cmd_texts and "Tournament Live exited with code {0}." in cmd_texts
    assert set(cmd_texts) - {""} <= source
    assert "INSTALL_LANG" not in builder.INSTALLER_CMD and ":say_nl" not in builder.INSTALLER_CMD
    german = json.loads((ROOT / "tooling/launcher_i18n/de.json").read_text(encoding="utf-8"))["messages"]
    assert all(german.get(text) for text in set(cmd_texts) - {""})
    # Without the launcher text tools the helper speaks English; with them (as packaged) the chosen language.
    assert helper._text("Not found: {0}", "x.mp4") == "Not found: x.mp4"
    tools = tmp_path / "tools"
    tools.mkdir()
    for name in builder.LAUNCHER_TEXT_FILES:
        shutil.copy2(ROOT / "tooling" / name, tools / name)
    shutil.copytree(ROOT / "tooling/launcher_i18n", tools / "launcher_i18n")
    shutil.copy2(tmp_path / "mk8dx_tools_setup.py", tools / "mk8dx_tools_setup.py")
    packaged = _load(tools / "mk8dx_tools_setup.py", "_mk8dx_tools_setup_packaged")
    sys.modules.pop("launcher_text", None)
    import os
    previous = os.environ.get("MK8DX_LAUNCHER_LANGUAGE")
    os.environ["MK8DX_LAUNCHER_LANGUAGE"] = "de"
    try:
        assert packaged._text("Not found: {0}", "x.mp4") == german["Not found: {0}"].replace("{0}", "x.mp4")
    finally:
        if previous is None:
            os.environ.pop("MK8DX_LAUNCHER_LANGUAGE", None)
        else:
            os.environ["MK8DX_LAUNCHER_LANGUAGE"] = previous
        sys.modules.pop("launcher_text", None)


def test_package_cmd_lines_are_translated_without_powershell(tmp_path):
    """A launcher without its runtime says so in the chosen language, through tools\\mk8dx-text.cmd."""
    import os
    import shutil
    import subprocess

    if os.name != "nt":
        import pytest
        pytest.skip("cmd.exe is Windows only")
    builder, helper = _setup_helper(tmp_path)
    package = tmp_path / "package"
    (package / "tools").mkdir(parents=True)
    helper.write_launchers(package)
    for name in builder.LAUNCHER_TEXT_FILES:
        shutil.copy2(ROOT / "tooling" / name, package / "tools" / name)
    shutil.copytree(ROOT / "tooling/launcher_i18n", package / "tools" / "launcher_i18n")
    for text in (package / "TournamentLive.cmd").read_text(encoding="utf-8").splitlines():
        assert text.lower().startswith("rem ") or "powershell" not in text.lower()
    german = json.loads((ROOT / "tooling/launcher_i18n/de.json").read_text(encoding="utf-8"))["messages"]
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    environment = {key: value for key, value in os.environ.items()
                   if key not in ("MK8DX_LANGUAGE", "MK8DX_LAUNCHER_LANGUAGE")}
    for language, expected in (("de", german["The package runtime is missing. Run {0} first."]),
                               ("en", "The package runtime is missing. Run {0} first.")):
        result = subprocess.run(["cmd.exe", "/d", "/c", str(package / "TournamentLive.cmd")], input=b"",
                                capture_output=True, timeout=60, creationflags=subprocess.CREATE_NEW_CONSOLE,
                                startupinfo=startup, env={**environment, "MK8DX_TOURNAMENT_LANGUAGE": language})
        assert result.returncode == 1
        assert expected.replace("{0}", "Install-MK8DX-TournamentTools.cmd") in result.stdout.decode("utf-8"), language
