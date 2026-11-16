"""The desktop side of readable clip copies: the setting (on by default, Documents\\MK8DX\\LiveTrial-clips), the
older settings files it migrates, and the arguments a capture hands the engine."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

import livetrial_desktop_app as desktop
import livetrial_settings as settings


def test_on_by_default_in_the_documents_folder(tmp_path) -> None:
    current = settings.read_settings(tmp_path)
    assert current["readableClips"] is True and current["readableClipsFolder"] is None
    folder = settings.readable_clips_folder(current)
    assert folder == settings.documents_folder() / "MK8DX" / "LiveTrial-clips"
    assert folder.is_absolute()


def test_a_v4_settings_file_keeps_its_choices_and_gets_the_default(tmp_path) -> None:
    (tmp_path / "settings.json").write_text(json.dumps({
        "schemaVersion": "mk8dx.livetrial-settings.v4", "autoSyncCompletedRuns": True, "language": "nl",
        "captureDevice": "USB Video", "consoleLanguage": "de"}), encoding="utf-8")
    current = settings.read_settings(tmp_path)
    assert current["schemaVersion"] == settings.SETTINGS_SCHEMA_VERSION
    assert (current["autoSyncCompletedRuns"], current["language"], current["captureDevice"],
            current["consoleLanguage"]) == (True, "nl", "USB Video", "de")
    assert current["readableClips"] is True


def test_turning_off_and_choosing_a_folder(tmp_path) -> None:
    chosen = str(tmp_path / "My clips")
    settings.write_readable_clips(tmp_path, False)
    settings.write_readable_clips(tmp_path, folder=f'  "{chosen}" ')
    current = settings.read_settings(tmp_path)
    assert current["readableClips"] is False and current["readableClipsFolder"] == chosen
    settings.write_readable_clips(tmp_path, folder="")
    assert settings.read_settings(tmp_path)["readableClipsFolder"] is None
    for refused in ("relative\\folder", "C:\\bad|name", "x" * 300):
        with pytest.raises(settings.LiveTrialSettingsError):
            settings.write_readable_clips(tmp_path, folder=refused)
    with pytest.raises(settings.LiveTrialSettingsError):
        settings.write_readable_clips(tmp_path, "yes")


def test_a_capture_names_the_folder_and_the_language(tmp_path) -> None:
    app = SimpleNamespace(_data_root=tmp_path)
    settings.write_language(tmp_path, "nl")
    arguments = desktop.LiveTrialDesktopApp._readable_clips_arguments(app)
    assert arguments == ["--readable-clips-dir", str(settings.default_readable_clips_folder()),
                         "--readable-clips-language", "nl"]
    settings.write_readable_clips(tmp_path, False)
    assert desktop.LiveTrialDesktopApp._readable_clips_arguments(app) == []


def test_the_settings_dialog_reads_and_changes_it(tmp_path) -> None:
    app = SimpleNamespace(_data_root=tmp_path, _job=None, _api_origin="https://example.invalid")
    app.settings = lambda: desktop.LiveTrialDesktopApp.settings(app)
    shown = desktop.LiveTrialDesktopApp.change_settings(app, {"readableClips": False,
                                                               "readableClipsFolder": str(tmp_path / "Clips")})
    assert shown["readableClips"] is False and shown["readableClipsFolder"] == str(tmp_path / "Clips")
    assert shown["readableClipsFolderChosen"] is True
    with pytest.raises(desktop.LiveTrialDesktopError):
        desktop.LiveTrialDesktopApp.change_settings(app, {"readableClipsFolder": "not absolute"})
    with pytest.raises(desktop.LiveTrialDesktopError):
        desktop.LiveTrialDesktopApp.change_settings(app, {"readableClips": "on"})
    assert Path(desktop.LiveTrialDesktopApp.change_settings(app, {"readableClipsFolder": ""})
                ["readableClipsFolder"]) == settings.default_readable_clips_folder()
