"""One EasyOCR reader per language set and device in a Tournament process (ocr_readers).

The recorded engine's track, name and digit readers, Tournament Live's row and track readers and the Live
warm-up all take their reader from the same cache, so a language set two of them use is loaded once. No
real reader is built here: a counting factory stands in for EasyOCR."""
from __future__ import annotations

import threading
import time

import pytest

from mk8dx_tournament_extraction import ocr_readers


class FakeReader:
    def __init__(self, languages, gpu):
        self.languages = list(languages)
        self.gpu = gpu
        self.reads = 0

    def readtext(self, image, **kwargs):
        self.reads += 1
        return []


@pytest.fixture()
def factory(monkeypatch):
    ocr_readers.clear()
    calls: list[tuple] = []

    def build(languages, gpu):
        calls.append((tuple(languages), gpu))
        time.sleep(0.05)   # a load takes time: concurrent callers must still get one reader
        return FakeReader(languages, gpu)

    monkeypatch.setattr(ocr_readers, "_easyocr_factory", build)
    yield calls
    ocr_readers.clear()


def test_one_reader_per_language_set_and_device(factory) -> None:
    first = ocr_readers.shared_reader(["en", "nl"], gpu=False)
    assert ocr_readers.shared_reader(("en", "nl"), gpu=False) is first
    other = ocr_readers.shared_reader(["en"], gpu=False)
    assert other is not first
    # EasyOCR keeps the caller's order of languages: another order is another reader
    assert ocr_readers.shared_reader(["nl", "en"], gpu=False) is not first
    assert factory == [(("en", "nl"), False), (("en",), False), (("nl", "en"), False)]
    assert ocr_readers.created() == [(("en", "nl"), "cpu"), (("en",), "cpu"), (("nl", "en"), "cpu")]


def test_a_gpu_request_without_a_gpu_is_the_cpu_reader(factory, monkeypatch) -> None:
    monkeypatch.setattr(ocr_readers, "device", lambda gpu: "cpu")
    assert ocr_readers.shared_reader(["en"], gpu=True) is ocr_readers.shared_reader(["en"], gpu=False)
    assert ocr_readers.run_lock(["en"], gpu=True) is ocr_readers.run_lock(["en"], gpu=False)
    monkeypatch.setattr(ocr_readers, "device", lambda gpu: "cuda" if gpu else "cpu")
    assert ocr_readers.shared_reader(["en"], gpu=True) is not ocr_readers.shared_reader(["en"], gpu=False)


def test_concurrent_first_use_creates_one_reader(factory) -> None:
    results: list[object] = []
    start = threading.Barrier(8)

    def worker() -> None:
        start.wait()
        results.append(ocr_readers.shared_reader(["en", "es", "fr"], gpu=False))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(results) == 8 and all(reader is results[0] for reader in results)
    assert factory == [(("en", "es", "fr"), False)]


def test_a_slow_load_does_not_block_another_reader(monkeypatch) -> None:
    ocr_readers.clear()
    loading = threading.Event()
    release = threading.Event()

    def build(languages, gpu):
        if languages == ["ja", "en"]:
            loading.set()
            assert release.wait(5)
        return FakeReader(languages, gpu)

    monkeypatch.setattr(ocr_readers, "_easyocr_factory", build)
    slow = threading.Thread(target=lambda: ocr_readers.shared_reader(["ja", "en"], gpu=False))
    slow.start()
    assert loading.wait(5)
    began = time.perf_counter()
    ocr_readers.shared_reader(["en"], gpu=False)   # must not wait for the Japanese reader
    assert time.perf_counter() - began < 1.0
    release.set()
    slow.join()
    ocr_readers.clear()


def test_engine_and_live_readers_are_the_same_instances(factory, monkeypatch) -> None:
    from mk8dx_tournament_extraction.engine import extract_text, ocr_scoreboard_consensus

    if extract_text.easyocr is None:
        pytest.skip("EasyOCR is not installed")
    monkeypatch.setattr(extract_text, "_EASYOCR_READERS", {})
    monkeypatch.setattr(extract_text, "_EASYOCR_READER_RUN_LOCKS", {})
    monkeypatch.setattr(extract_text, "easyocr_gpu_enabled", lambda: False)
    monkeypatch.setattr(ocr_scoreboard_consensus, "easyocr_gpu_enabled", lambda: False)
    monkeypatch.setattr(ocr_scoreboard_consensus, "_DIGIT_EASYOCR_READER", None)

    from live_processor import baseline_export_metadata, baseline_row_ocr

    monkeypatch.setattr(baseline_export_metadata, "_EASYOCR_READERS", {})
    monkeypatch.setattr(baseline_export_metadata, "_easyocr_gpu_enabled", lambda: False)
    monkeypatch.setattr(baseline_export_metadata, "write_ocr_runtime_report", lambda *a, **k: {})
    monkeypatch.setattr(baseline_row_ocr, "write_ocr_runtime_report", lambda *a, **k: {})
    import torch  # type: ignore
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)

    track = extract_text._get_easyocr_reader(["en", "nl"])
    assert baseline_export_metadata._get_easyocr_reader(("en", "nl")) is track
    digits = ocr_scoreboard_consensus._get_digit_easyocr_reader()
    rows = []
    for _ in range(3):   # Live builds up to three row extractors (provisional, consensus, live signal)
        extractor = object.__new__(baseline_row_ocr.BaselineRowOcrExtractor)
        extractor.languages = ["en"]
        extractor.reader = None
        extractor.reader_error = None
        extractor.run_lock = threading.Lock()
        rows.append(extractor._get_reader())
        assert extractor.run_lock is ocr_readers.run_lock(["en"], gpu=False)
    assert all(reader is digits for reader in rows)
    assert extract_text._get_easyocr_reader_run_lock(["en", "nl"]) is ocr_readers.run_lock(["en", "nl"], gpu=False)
    assert sorted(factory) == [(("en",), False), (("en", "nl"), False)]


def test_the_live_warm_up_keeps_its_readers(factory, monkeypatch) -> None:
    from live_processor import ocr_runtime

    monkeypatch.setattr(ocr_runtime, "write_ocr_runtime_report", lambda *a, **k: {})
    monkeypatch.setattr(ocr_runtime, "announce_easyocr_models", lambda sets: "")
    monkeypatch.setattr(ocr_runtime, "_asset_warmup_loaders", lambda: [])
    result = ocr_runtime.warm_up_ocr_engine([["en"], ["en", "nl"]])
    assert result["warmed_readers"] == [["en"], ["en", "nl"]]
    created = list(factory)
    reader = ocr_readers.shared_reader(["en"], gpu=result["gpu"])
    assert reader.reads == 1           # the warm-up's dummy read, on the reader the pipeline now uses
    assert factory == created          # nothing new was loaded
