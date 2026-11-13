"""The Tournament Tools package writes its launchers, including the analysis window's."""

import importlib.util
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
    assert len(say_lines) == 2  # header comment and the EN/NL :say line
    assert any(line.startswith('call :say " TournamentAnalysis.cmd') and "achteraf" in line for line in say_lines)
    assert "TournamentAnalysis.cmd" in builder.README_FIRST
    builder.INSTALLER_CMD.encode("ascii")


def test_package_installs_the_qt_window_and_offers_the_background_setting(tmp_path):
    _, helper = _setup_helper(tmp_path)
    assert any(item.startswith("mk8dx-tournament-processor[gui]==") for item in helper.DISTRIBUTIONS)
    assert 'rem set "MK8DX_ANALYSIS_BACKGROUND=' in helper.CONFIG_CMD
