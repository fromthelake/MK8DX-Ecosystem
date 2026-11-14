"""LiveTrial's EasyOCR readers (consolelang.READERS) and the console-language probe's reader set.

One reader per language set, created under its own lock; after a language is *detected* the menu-text
verification reads only with that language's script and the Latin reader, and the other script readers
are released. Detection itself (candidates, thresholds) is unchanged. No real reader is built here."""

import importlib
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

DESKTOP = Path(__file__).resolve().parents[1]
ENGINE = DESKTOP / "vision-runtime" / "livetrial"
OVERLAY = DESKTOP / "engine-overlay" / "livetrial" / "livetrial"

CODES = ("en", "fr", "de", "es", "it", "nl", "pt", "ru", "ja", "zh-tw", "zh-cn", "ko")


@pytest.fixture()
def consolelang(monkeypatch):
    monkeypatch.syspath_prepend(str(ENGINE))
    module = importlib.import_module("livetrial.consolelang")
    yield module
    sys.modules.pop("livetrial.consolelang", None)


class FakeReader:
    def __init__(self, languages):
        self.languages = languages

    def readtext(self, image, **kwargs):
        return []


def _db():
    return {"consoleLanguages": {"languages": [{"code": code, "textLocales": [code]} for code in CODES]},
            "collections": {}}


def test_overlay_and_engine_copies_are_the_same() -> None:
    for name in ("consolelang.py", "engine.py", "ghostmenu.py"):
        overlay = (OVERLAY / name).read_bytes().replace(b"\r\n", b"\n")
        assert overlay == (ENGINE / "livetrial" / name).read_bytes().replace(b"\r\n", b"\n"), name


def test_one_reader_per_language_set_even_on_concurrent_first_use(consolelang) -> None:
    calls = []

    def build(languages, gpu):
        calls.append(tuple(languages))
        time.sleep(0.05)
        return FakeReader(languages)

    cache = consolelang.ReaderCache(build)
    got, start = [], threading.Barrier(8)

    def worker():
        start.wait()
        got.append(cache.get(["ja", "en"]))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert all(reader is got[0] for reader in got) and calls == [("ja", "en")]
    assert cache.get(("ja", "en")) is got[0]
    assert cache.get(["en", "nl"]) is not got[0]
    assert cache.created == [(("ja", "en"), False), (("en", "nl"), False)]


def test_a_reader_load_never_blocks_a_read_with_another_reader(consolelang) -> None:
    loading, release = threading.Event(), threading.Event()

    def build(languages, gpu):
        if languages[0] == "ch_tra":
            loading.set()
            assert release.wait(5)
        return FakeReader(languages)

    cache = consolelang.ReaderCache(build)
    track = cache.get(["ja", "en"])
    slow = threading.Thread(target=lambda: cache.get(["ch_tra", "en"]))
    slow.start()
    assert loading.wait(5)
    began = time.perf_counter()
    track.readtext(None)                 # the capture loop's track-name read
    cache.get(["ru", "en"])              # and another script's load
    assert time.perf_counter() - began < 1.0
    release.set()
    slow.join()


def test_the_ghost_panel_and_the_engine_share_the_probe_readers(consolelang, monkeypatch) -> None:
    pytest.importorskip("cv2")
    built = []
    monkeypatch.setattr(consolelang, "READERS", consolelang.ReaderCache(
        lambda languages, gpu: built.append(tuple(languages)) or FakeReader(languages)))
    ghostmenu = importlib.import_module("livetrial.ghostmenu")
    try:
        probe = consolelang.OcrProbe(_db())
        try:
            assert ghostmenu._script_reader("ja") is probe.reader_for("ja")
            assert ghostmenu._script_reader("latin") is probe.reader_for("de")
            assert built == [("ja", "en"), ("en", "nl", "de", "fr", "es", "it", "pt")]
        finally:
            probe.stop()
    finally:
        sys.modules.pop("livetrial.ghostmenu", None)


class FakeProbe:
    def __init__(self):
        self.submitted = []
        self.kept = []

    def submit(self, crops, candidates, ms, deliver):
        self.submitted.append(list(candidates))

    def keep_only(self, code, *also):
        self.kept.append((code, also))

    def keep_all(self):
        self.kept.append(None)


def _language(consolelang, choice="auto"):
    tdb = SimpleNamespace(db=_db(), languages=list(CODES))
    probe = FakeProbe()
    return consolelang.ConsoleLanguage(tdb, choice, probe), probe


def test_detecting_reads_every_open_candidate(consolelang) -> None:
    language, probe = _language(consolelang)
    language.tick(10_000, in_menu=True)
    language.submit_menu_text([(object(), "tracks")])
    assert probe.submitted == [list(CODES)]


@pytest.mark.parametrize("code, expected", [
    ("ja", ["en", "fr", "de", "es", "it", "nl", "pt", "ja"]),
    ("de", ["en", "fr", "de", "es", "it", "nl", "pt"]),
    ("zh-tw", ["en", "fr", "de", "es", "it", "nl", "pt", "zh-tw"]),
])
def test_a_detected_language_is_verified_with_its_script_and_latin_only(consolelang, code, expected) -> None:
    language, probe = _language(consolelang)
    language._decide(code, "detected")
    assert probe.kept == [(code, ("latin",))]
    assert language.verification_languages() == expected
    language.tick(20_000, in_menu=True)
    language.submit_menu_text([(object(), "tracks")])
    assert probe.submitted == [expected]


def test_a_chosen_language_keeps_only_its_own_reader_and_never_verifies(consolelang) -> None:
    language, probe = _language(consolelang, "ru")
    assert probe.kept == [("ru", ())]
    language.tick(20_000, in_menu=True)
    language.submit_menu_text([(object(), "tracks")])
    assert probe.submitted == []


def test_releasing_keeps_the_decided_and_latin_readers(consolelang) -> None:
    cache = consolelang.ReaderCache(lambda languages, gpu: FakeReader(languages))
    probe = consolelang.OcrProbe.__new__(consolelang.OcrProbe)
    probe._cache = cache
    for key in consolelang.OCR_READERS:
        probe.reader_for({"latin": "en"}.get(key, key))
    assert probe.resident() == sorted(consolelang.OCR_READERS)
    probe.keep_only("ja", "latin")
    assert probe.resident() == ["ja", "latin"]
    probe.keep_only("ru")
    assert probe.resident() == []


def test_a_job_from_before_the_decision_does_not_load_released_scripts(consolelang) -> None:
    db = _db()
    db["collections"] = {"tracks": [{"id": "track.x", "names": {code: "Mario Kart Stadium" for code in CODES}}]}
    cache = consolelang.ReaderCache(lambda languages, gpu: FakeReader(languages))
    probe = consolelang.OcrProbe(db, reader_factory=lambda languages, gpu: FakeReader(languages))
    probe._cache = cache
    done = threading.Event()
    try:
        probe.keep_only("en", "latin")   # decided while the job below was waiting
        probe.submit([(object(), "tracks")], list(CODES), 0, lambda *args: done.set())
        assert done.wait(5)
        deadline = time.time() + 5
        while probe.resident() != ["latin"] and time.time() < deadline:
            time.sleep(0.01)
        assert probe.resident() == ["latin"]
        assert cache.created == [(tuple(consolelang.OCR_READERS["latin"]), False)]   # no released script reloaded
    finally:
        probe.stop()


def test_a_reopened_language_keeps_every_reader_until_decided_again(consolelang) -> None:
    language, probe = _language(consolelang)
    language._decide("fr", "detected")
    for ms in (1000, 1200, 1400):   # three contradicting template frames over 0.4 s re-open it
        language.ms = ms
        language._narrow({"es"}, {"source": "test", "ms": ms, "languages": ["es"]})
    assert language.code == "es" and language.reopened == 1
    assert probe.kept == [("fr", ("latin",)), None, ("es", ("latin",))]
