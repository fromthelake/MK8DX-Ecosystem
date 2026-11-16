"""Readable copies of finished clips (engine livetrial/readable_clips.py): the file name, hard link or copy, the
index, the storage clean-up that removes an entry together with its clip, and the engine's Open folder action.

Everything runs on synthetic files in pytest's temporary folder; no recording or real installation is read."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import pytest

DESKTOP = Path(__file__).resolve().parents[1]
RUNTIME = DESKTOP / "vision-runtime" / "livetrial"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

from livetrial import readable_clips as rc  # noqa: E402
from livetrial import storage  # noqa: E402

STARTED = datetime(2026, 11, 16, 10, 25, 41)
SESSION = "live_20261116_102500"
NAMES = {
    "track.mario_kart_stadium": {"en-US": "Mario Kart Stadium", "en-GB": "Mario Kart Stadium",
                                 "nl-NL": "Mario Kart-Stadion", "pt-PT": "Estádio Mario Kart",
                                 "ja-JP": "マリオカートスタジアム", "ru-RU": "Стадион Mario Kart"},
    "track.gcn_yoshi_circuit": {"en-US": "GCN Yoshi Circuit", "en-GB": "GCN Yoshi Circuit",
                                "nl-NL": "GCN Yoshi's Circuit", "de-DE": "GCN Yoshis Piste"},
    "track.wii_warios_gold_mine": {"en-GB": "Wii Wario’s Gold Mine", "fr-FR": "Wii Mine d'or de Wario"},
}


# -- the name -------------------------------------------------------------------------------------------------

def test_the_name_has_the_agreed_shape() -> None:
    assert rc.readable_name(STARTED, "run", "Mario Kart Stadium", "150", 106784) == \
        "2026-11-16 10h25m  Mario Kart Stadium  150cc  1m46s784.mp4"


@pytest.mark.parametrize("ms, text", [(106784, "1m46s784"), (61005, "1m01s005"), (60000, "1m00s000"),
                                      (59999, "0m59s999"), (125040, "2m05s040")])
def test_the_time_always_has_two_digit_seconds_and_three_digit_milliseconds(ms, text) -> None:
    assert rc.time_label(ms) == text


@pytest.mark.parametrize("cc, label", [("50", "50cc"), ("100", "100cc"), ("150", "150cc"), (200, "200cc"),
                                       ("200cc", "200cc"), ("mirror", "Mirror"), ("Mirror", "Mirror"),
                                       (None, None), ("", None), ("unknown", None)])
def test_the_class(cc, label) -> None:
    assert rc.class_label(cc) == label


def test_apostrophes_go_accents_become_plain_letters_and_only_safe_characters_stay() -> None:
    assert rc.ascii_words("Yoshi's Circuit") == "Yoshis Circuit"
    assert rc.ascii_words("Wii Wario’s Gold Mine") == "Wii Warios Gold Mine"
    assert rc.ascii_words("Estádio Mario Kart") == "Estadio Mario Kart"
    assert rc.ascii_words("Straße  über: Ölmühle!") == "Strasse uber Olmuhle"
    assert rc.ascii_words("Mario Kart-Stadion") == "Mario Kart-Stadion"
    assert rc.ascii_words("  Tour / Paris  Promenade (R) ") == "Tour Paris Promenade R"
    name = rc.readable_name(STARTED, "run", "N64 Yoshi's Valley & co.", "mirror", 132001)
    assert name == "2026-11-16 10h25m  N64 Yoshis Valley co  Mirror  2m12s001.mp4"
    assert set(name[:-4]) <= set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -")


def test_the_track_follows_livetrial_s_language_and_a_non_latin_language_uses_english() -> None:
    names = NAMES["track.mario_kart_stadium"]
    assert rc.track_name(names, "nl") == "Mario Kart-Stadion"
    assert rc.track_name(names, "pt") == "Estadio Mario Kart"
    assert rc.track_name(names, "en") == "Mario Kart Stadium"
    for language in ("ja", "ru", "ko", "zh-CN", "zh-TW"):
        assert rc.track_name(names, language) == "Mario Kart Stadium"
    # a language whose name is missing falls back to English, never to nothing
    assert rc.track_name(names, "de") == "Mario Kart Stadium"
    assert rc.track_name(NAMES["track.gcn_yoshi_circuit"], "nl") == "GCN Yoshis Circuit"
    assert rc.track_name(None, "nl") is None


def test_unknown_fields_are_left_out_never_invented() -> None:
    assert rc.readable_name(STARTED, "run", None, None, None) == "2026-11-16 10h25m  Unknown track.mp4"
    assert rc.readable_name(STARTED, "run", "Mario Kart Stadium", "150", None) == \
        "2026-11-16 10h25m  Mario Kart Stadium  150cc.mp4"
    assert rc.readable_name(STARTED, "run", "", "", 0) == "2026-11-16 10h25m  Unknown track.mp4"


def test_manual_and_ghost_clips() -> None:
    assert rc.readable_name(STARTED, "manual") == "2026-11-16 10h25m  Manual.mp4"
    assert rc.readable_name(STARTED, "ghost", "GCN Yoshis Circuit", "200", 77123) == \
        "2026-11-16 10h25m  Ghost GCN Yoshis Circuit  200cc  1m17s123.mp4"
    assert rc.readable_name(STARTED, "ghost") == "2026-11-16 10h25m  Ghost Unknown track.mp4"


def test_a_taken_name_gets_a_number(tmp_path) -> None:
    name = "2026-11-16 10h25m  Manual.mp4"
    assert rc.unique_target(tmp_path, name).name == name
    (tmp_path / name).write_bytes(b"a")
    assert rc.unique_target(tmp_path, name).name == "2026-11-16 10h25m  Manual (2).mp4"
    (tmp_path / "2026-11-16 10h25m  Manual (2).mp4").write_bytes(b"b")
    assert rc.unique_target(tmp_path, name).name == "2026-11-16 10h25m  Manual (3).mp4"


# -- making the entry -----------------------------------------------------------------------------------------

def _clip(runs: Path, name: str = "clip_102541_run01.mp4", data: bytes = b"synthetic clip bytes") -> Path:
    path = runs / SESSION / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def _maker(tmp_path, language="en", log=None) -> rc.ReadableClips:
    return rc.ReadableClips(tmp_path / "runs", tmp_path / "LiveTrial-clips", language, names=NAMES.get,
                            log=log or (lambda _text: None))


def test_same_volume_is_a_hard_link(tmp_path) -> None:
    clip = _clip(tmp_path / "runs")
    made = _maker(tmp_path, "nl").make(clip, STARTED, "run", "track.mario_kart_stadium", "150", 106784)
    assert made.name == "2026-11-16 10h25m  Mario Kart-Stadion  150cc  1m46s784.mp4"
    assert made.read_bytes() == clip.read_bytes()
    assert os.stat(clip).st_nlink == 2 and os.path.samefile(clip, made)
    entry = rc.load_index(tmp_path / "runs")[f"{SESSION}/{clip.name}"]
    assert entry["method"] == "hardlink" and entry["name"] == made.name and Path(entry["path"]) == made
    # the internal clip keeps its name: nothing that depends on it changes
    assert clip.is_file() and clip.name == "clip_102541_run01.mp4"


def test_another_volume_is_a_copy(tmp_path, monkeypatch) -> None:
    def refuse(_source, _target):
        raise OSError(18, "Invalid cross-device link")

    monkeypatch.setattr(rc.os, "link", refuse)
    clip = _clip(tmp_path / "runs")
    made = _maker(tmp_path).make(clip, STARTED, "run", "track.gcn_yoshi_circuit", "200", 61005)
    assert made.name == "2026-11-16 10h25m  GCN Yoshi Circuit  200cc  1m01s005.mp4"
    assert made.read_bytes() == clip.read_bytes() and not os.path.samefile(clip, made)
    assert rc.load_index(tmp_path / "runs")[f"{SESSION}/{clip.name}"]["method"] == "copy"
    assert not list((tmp_path / "LiveTrial-clips").glob("*.part"))


def test_a_failure_is_logged_and_never_raised(tmp_path) -> None:
    clip = _clip(tmp_path / "runs")
    (tmp_path / "LiveTrial-clips").write_text("a file where the folder should be", encoding="utf-8")
    lines = []
    maker = _maker(tmp_path, log=lines.append)
    maker.submit(clip, STARTED, "run", "track.mario_kart_stadium", "150", 106784)
    maker.close(timeout=10)
    assert lines and lines[0].startswith("readable clip not made for clip_102541_run01.mp4")
    assert clip.read_bytes() == b"synthetic clip bytes" and rc.load_index(tmp_path / "runs") == {}


def test_the_background_worker_makes_the_entries_in_order(tmp_path) -> None:
    runs = tmp_path / "runs"
    maker = _maker(tmp_path)
    for n in (1, 2):
        maker.submit(_clip(runs, f"clip_10254{n}_run0{n}.mp4"), STARTED, "run", None, "150", None)
    maker.submit(_clip(runs, "clip_103000.mp4"), STARTED, "manual")
    maker.close(timeout=10)
    assert sorted(p.name for p in (tmp_path / "LiveTrial-clips").iterdir()) == [
        "2026-11-16 10h25m  Manual.mp4",
        "2026-11-16 10h25m  Unknown track  150cc (2).mp4",
        "2026-11-16 10h25m  Unknown track  150cc.mp4",
    ]
    index = rc.load_index(runs)
    assert index[f"{SESSION}/clip_102541_run01.mp4"]["name"] == "2026-11-16 10h25m  Unknown track  150cc.mp4"
    assert index[f"{SESSION}/clip_102542_run02.mp4"]["name"] == "2026-11-16 10h25m  Unknown track  150cc (2).mp4"


def test_an_unknown_placeholder_track_is_unknown(tmp_path) -> None:
    made = _maker(tmp_path).make(_clip(tmp_path / "runs"), STARTED, "run", "UNKNOWN", "150", 106784)
    assert made.name == "2026-11-16 10h25m  Unknown track  150cc  1m46s784.mp4"


def test_the_database_names_are_read_from_clean_assets(tmp_path) -> None:
    (tmp_path / "database.json").write_text(json.dumps({"collections": {"tracks": [
        {"id": "track.mario_kart_stadium", "names": NAMES["track.mario_kart_stadium"]}]}}), encoding="utf-8")
    names = rc.database_track_names(tmp_path)
    assert names("track.mario_kart_stadium")["nl-NL"] == "Mario Kart-Stadion"
    assert names("track.other") is None
    assert rc.database_track_names(tmp_path / "missing")("track.mario_kart_stadium") is None


# -- storage clean-up -----------------------------------------------------------------------------------------

def _library(tmp_path):
    """Two old synthetic clips, one of them pinned, each with its readable entry; a budget that fits neither."""
    runs = tmp_path / "runs"
    old = _clip(runs, "clip_090000_run01.mp4", b"x" * 4096)
    pinned = _clip(runs, "clip_091000_run02.mp4", b"y" * 4096)
    for path in (old, pinned):
        os.utime(path, (1_700_000_000, 1_700_000_000))
    (runs / SESSION / "report.json").write_text(json.dumps({"runs": [
        {"run": 1, "context": {"cc": "150"}}, {"run": 2, "context": {"cc": "150"}}]}), encoding="utf-8")
    storage.toggle_pin(runs, f"{SESSION}/{pinned.name}")
    maker = _maker(tmp_path)
    made_old = maker.make(old, STARTED, "run", "track.mario_kart_stadium", "150", 106784)
    made_pinned = maker.make(pinned, STARTED, "run", "track.mario_kart_stadium", "150", 105000)
    settings = storage.Settings(maxTotalGb=0.5, keepLatest=0, keepRecords=False, keepBest=False)
    return runs, old, pinned, made_old, made_pinned, settings


def test_cleanup_removes_the_readable_entry_and_keeps_a_pinned_one(tmp_path, monkeypatch) -> None:
    runs, old, pinned, made_old, made_pinned, settings = _library(tmp_path)
    monkeypatch.setattr(storage, "GB", 4096)       # a 0.5 "GB" budget = 2 KiB: neither clip fits
    result = storage.cleanup(runs, settings)
    assert result["removed"] == [f"{SESSION}/{old.name}"]
    assert not old.exists() and not made_old.exists()
    assert pinned.is_file() and made_pinned.is_file()
    assert set(rc.load_index(runs)) == {f"{SESSION}/{pinned.name}"}


def test_a_dry_run_removes_nothing(tmp_path, monkeypatch) -> None:
    runs, old, _pinned, made_old, _made_pinned, settings = _library(tmp_path)
    monkeypatch.setattr(storage, "GB", 4096)
    storage.cleanup(runs, settings, dry_run=True)
    assert old.is_file() and made_old.is_file() and len(rc.load_index(runs)) == 2


def test_a_file_the_person_replaced_is_left_alone(tmp_path) -> None:
    runs, old, _pinned, made_old, _made_pinned, _settings = _library(tmp_path)
    os.unlink(made_old)
    made_old.write_bytes(b"the person's own different file")
    assert rc.remove_for(runs, [f"{SESSION}/{old.name}"]) == []
    assert made_old.read_bytes() == b"the person's own different file"
    assert f"{SESSION}/{old.name}" not in rc.load_index(runs)


# -- the engine's run list and Open folder action -------------------------------------------------------------

def test_the_run_list_names_the_readable_copy_and_open_folder_shows_it(tmp_path, monkeypatch) -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location("_livetrial_serve_readable", RUNTIME / "serve.py")
    serve = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(serve)
    import test_engine_control as control

    engine = control.Engine(serve, tmp_path)
    try:
        clip = engine.runs / control.CLIP
        made = _maker(tmp_path).make(clip, STARTED, "run", "track.mario_kart_stadium", "150", 90000)
        runs = engine.store.snapshot()["runs"]
        assert runs[0]["clipFile"] == control.CLIP and runs[0]["readableClip"] == made.name
        shown = []
        monkeypatch.setattr(serve, "show_in_folder", shown.append)
        status, body, _ = engine.act("/api/readable-clip/open", {"file": control.CLIP})
        assert status == 200 and json.loads(body)["name"] == made.name and shown == [made]
        for refused in ({"file": "../outside/clip_120000.mp4"}, {"file": 3}, {}):
            status, _, _ = engine.act("/api/readable-clip/open", refused)
            assert status == 400
        made.unlink()
        status, _, _ = engine.act("/api/readable-clip/open", {"file": control.CLIP})
        assert status == 404 and shown == [made]
        # without the action proof nothing opens
        status, _, _ = engine.act("/api/readable-clip/open", {"file": control.CLIP}, token="")
        assert status == 403 and shown == [made]
    finally:
        engine.close()
