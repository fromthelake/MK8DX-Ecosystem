"""The analysis window's plan: which recordings go where and which processor command runs. No window opens."""

import datetime as dt
import sys
from pathlib import Path

import pytest

from tournament_processor import gui


def _touch(path: Path, size: int = 4) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    return path


def test_video_suffixes_match_the_processor():
    from tournament_processor import vision_cli

    assert gui.VIDEO_SUFFIXES == vision_cli.VIDEO_SUFFIXES


def test_files_and_a_folder_become_one_all_run(tmp_path):
    first = _touch(tmp_path / "Recordings" / "Qualifier group 1.mkv")
    second = _touch(tmp_path / "Recordings" / "Qualifier group 2.mp4")
    night = tmp_path / "2026-11-08 Club night"
    _touch(night / "Final A.mkv")
    _touch(night / "Final B.mov")
    _touch(night / "notes.txt")
    root = tmp_path / "Session"

    plan = gui.build_plan([first, second, night], "  club-night-1  ", root)

    assert plan.session_id == "club-night-1"
    assert plan.targets == ("Qualifier group 1.mkv", "Qualifier group 2.mp4", "2026-11-08 Club night")
    assert plan.staging == (
        (first, root / "Input_Videos" / first.name),
        (second, root / "Input_Videos" / second.name),
        (night / "Final A.mkv", root / "Input_Videos" / night.name / "Final A.mkv"),
        (night / "Final B.mov", root / "Input_Videos" / night.name / "Final B.mov"),
    )
    assert plan.output_dir == root / "Output_Results"
    assert plan.command("python") == [
        "python", "-u", "-m", "tournament_processor.vision_cli", "all",
        "--runtime-root", str(root), "--session-id", "club-night-1",
        "--videos", "Qualifier group 1.mkv", "Qualifier group 2.mp4", "2026-11-08 Club night",
    ]


def test_the_command_is_accepted_by_vision_cli(tmp_path):
    video = _touch(tmp_path / "Qualifier group 1.mkv")
    plan = gui.build_plan([video], "synthetic-session", tmp_path / "Session")
    from tournament_processor import vision_cli

    args = vision_cli._parser().parse_args(plan.command("python")[4:])
    assert args.command == "all"
    assert args.session_id == "synthetic-session"
    assert args.videos == ["Qualifier group 1.mkv"]
    assert args.runtime_root == tmp_path / "Session"


def test_recordings_already_in_the_session_are_not_staged(tmp_path):
    root = tmp_path / "Night_TournamentSession"
    inside = _touch(root / "Input_Videos" / "Group 1.mkv")
    folder = root / "Input_Videos" / "Finals"
    _touch(folder / "Final A.mkv")

    plan = gui.build_plan([inside, folder], "night", root)

    assert plan.staging == ()
    assert plan.targets == ("Group 1.mkv", "Finals")
    assert gui.default_runtime_root([inside]) == root


def test_staging_links_or_copies_and_reuses(tmp_path):
    video = _touch(tmp_path / "Group 1.mkv", size=10)
    plan = gui.build_plan([video], "night", tmp_path / "Session")
    seen = []
    gui.stage_recordings(plan, lambda key, values: seen.append(key))
    staged = tmp_path / "Session" / "Input_Videos" / "Group 1.mkv"
    assert staged.read_bytes() == video.read_bytes()
    assert {"log_linked", "log_copying"} & set(seen)
    seen.clear()
    gui.stage_recordings(plan, lambda key, values: seen.append(key))
    assert "log_reused" in seen


def test_staging_refuses_a_different_file_with_the_same_name(tmp_path):
    video = _touch(tmp_path / "Group 1.mkv", size=10)
    _touch(tmp_path / "Session" / "Input_Videos" / "Group 1.mkv", size=3)
    plan = gui.build_plan([video], "night", tmp_path / "Session")
    with pytest.raises(gui.PlanError) as error:
        gui.stage_recordings(plan)
    assert error.value.key == "err_exists_differs"


@pytest.mark.parametrize(("entries", "key"), [
    ([], "err_no_entries"),
    (["missing.mkv"], "err_not_found"),
    (["notes.txt"], "err_unsupported"),
    (["empty"], "err_empty_folder"),
    (["a/Group 1.mkv", "b/Group 1.mkv"], "err_duplicate"),
])
def test_plan_errors_name_what_to_fix(tmp_path, entries, key):
    _touch(tmp_path / "notes.txt")
    (tmp_path / "empty").mkdir()
    _touch(tmp_path / "a" / "Group 1.mkv")
    _touch(tmp_path / "b" / "Group 1.mkv")
    with pytest.raises(gui.PlanError) as error:
        gui.build_plan([tmp_path / entry for entry in entries], "night", tmp_path / "Session")
    assert error.value.key == key
    assert error.value.message(gui.Texts("en"))
    assert error.value.message(gui.Texts("nl"))


def test_results_folder_is_required(tmp_path):
    video = _touch(tmp_path / "Group 1.mkv")
    with pytest.raises(gui.PlanError) as error:
        gui.build_plan([video], "night", "  ")
    assert error.value.key == "err_results_required"


@pytest.mark.parametrize(("value", "key"), [
    ("", "err_session_required"),
    ("   ", "err_session_required"),
    ("x" * 129, "err_session_length"),
    ("night\x01one", "err_session_chars"),
])
def test_session_id_validation_rejects(value, key):
    with pytest.raises(gui.PlanError) as error:
        gui.validate_session_id(value)
    assert error.value.key == key


def test_session_id_validation_accepts_the_canonical_range():
    assert gui.validate_session_id(" a ") == "a"
    assert gui.validate_session_id("x" * 128) == "x" * 128
    assert gui.validate_session_id("Club night 2026-11-08") == "Club night 2026-11-08"


def test_defaults_follow_the_first_entry(tmp_path):
    night = tmp_path / "2026-11-08 Club night"
    night.mkdir()
    video = tmp_path / "Qualifier group 1.mkv"
    today = dt.date(2026, 11, 13)
    assert gui.default_session_id([night], today) == "2026-11-08-Club-night"
    assert gui.default_session_id([video], today) == "Qualifier-group-1-2026-11-13"
    assert gui.default_session_id([], today) == ""
    assert gui.default_runtime_root([night]) == tmp_path / "2026-11-08 Club night_TournamentSession"
    assert gui.default_runtime_root([video]) == tmp_path / "Qualifier group 1_TournamentSession"
    assert gui.default_runtime_root([]) is None


def test_language_and_texts():
    assert gui.detect_language({"MK8DX_TOURNAMENT_LANGUAGE": "nl"}) == "nl"
    assert gui.detect_language({"MK8DX_TOURNAMENT_LANGUAGE": "EN"}) == "en"
    english, dutch = gui.Texts("en"), gui.Texts("nl")
    assert english("start") == "Start analysis"
    assert dutch("start") == "Analyse starten"
    for key, (en_text, nl_text) in gui.TEXTS.items():
        assert en_text and nl_text, key


def test_child_environment_is_unbuffered_and_finds_this_source():
    env = gui.child_environment({"PATH": "x"})
    assert env["PYTHONUNBUFFERED"] == "1"
    assert env["PYTHONIOENCODING"] == "utf-8"
    assert str(Path(gui.__file__).resolve().parents[1]) in env["PYTHONPATH"]


def test_missing_configured_assets_stop_the_run(tmp_path):
    with pytest.raises(gui.PlanError) as error:
        gui.check_environment({"MK8DX_TOURNAMENT_ASSETS_ROOT": str(tmp_path / "absent")})
    assert error.value.key == "err_assets"
    assert gui.check_environment({"MK8DX_TOURNAMENT_ASSETS_ROOT": str(tmp_path)}) == [
        "MK8DX_TOURNAMENT_ASSETS_ROOT"]


def _drain(events, timeout=20.0):
    import queue
    import time

    seen = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            kind, payload = events.get(timeout=0.2)
        except queue.Empty:
            continue
        seen.append((kind, payload))
        if kind in {"finished", "error"}:
            return seen
    raise AssertionError(f"run did not finish: {seen}")


class _FakePlan(gui.RunPlan):
    script = ""

    def command(self, python=None):
        return [sys.executable, "-u", "-c", self.script]


def test_background_run_stages_streams_and_reports_the_exit_code(tmp_path):
    import queue

    video = _touch(tmp_path / "Group 1.mkv")
    plan = gui.build_plan([video], "night", tmp_path / "Session")
    fake = _FakePlan(plan.runtime_root, plan.session_id, plan.staging, plan.targets)
    object.__setattr__(fake, "script", "print('race 1 read'); print('race 2 read')")
    events = queue.Queue()
    gui.AnalysisRun(fake, events).start()
    seen = _drain(events)
    assert (tmp_path / "Session" / "Input_Videos" / "Group 1.mkv").is_file()
    assert [payload for kind, payload in seen if kind == "line"] == ["race 1 read", "race 2 read"]
    assert seen[-1] == ("finished", 0)


def test_stop_ends_the_child_and_reports_no_exit_code(tmp_path):
    import queue
    import time

    video = _touch(tmp_path / "Group 1.mkv")
    plan = gui.build_plan([video], "night", tmp_path / "Session")
    fake = _FakePlan(plan.runtime_root, plan.session_id, plan.staging, plan.targets)
    object.__setattr__(fake, "script", "import time; print('started', flush=True); time.sleep(60)")
    events = queue.Queue()
    run = gui.AnalysisRun(fake, events)
    run.start()
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline and (run.process is None or events.empty()):
        time.sleep(0.1)
    run.stop()
    seen = _drain(events)
    assert seen[-1] == ("finished", None)
    assert run.process.poll() is not None


def test_format_elapsed():
    assert gui.format_elapsed(5) == "0:05"
    assert gui.format_elapsed(3725) == "1:02:05"


def test_module_imports_without_tkinter():
    import subprocess

    source = str(Path(gui.__file__).resolve().parents[1])
    code = ("import sys; sys.path.insert(0, sys.argv[1]); sys.modules['tkinter'] = None; "
            "import tournament_processor.gui as g; "
            "print(g.build_plan.__name__, 'tkinter' in sys.modules and sys.modules['tkinter'] is not None)")
    completed = subprocess.run([sys.executable, "-c", code, source], capture_output=True, text=True, check=True)
    assert completed.stdout.split() == ["build_plan", "False"]


def test_help_does_not_open_a_window(capsys):
    with pytest.raises(SystemExit) as stop:
        gui.main(["--help"])
    assert stop.value.code == 0
    assert "vision_cli all" in capsys.readouterr().out
