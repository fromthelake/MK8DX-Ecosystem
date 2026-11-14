"""LiveTrial points EasyOCR at the package's ocr-models folder only when every model the engine can load is there."""
import json
from pathlib import Path

import livetrial_capture_requirements as requirements

ROOT = Path(__file__).resolve().parents[2]


def _models(root: Path, names) -> None:
    folder = root / "ocr-models" / "model"
    folder.mkdir(parents=True, exist_ok=True)
    for name in names:
        (folder / name).write_bytes(b"x")


def test_the_complete_bundle_is_used(tmp_path):
    _models(tmp_path, requirements.BUNDLED_OCR_MODELS)
    environment = requirements.engine_environment({"PATH": "C:/bin"}, tmp_path / "data", tmp_path)
    assert environment["EASYOCR_MODULE_PATH"] == str(tmp_path / "ocr-models")


def test_an_incomplete_bundle_is_not_used(tmp_path):
    _models(tmp_path, [name for name in requirements.BUNDLED_OCR_MODELS if name != "japanese_g2.pth"])
    assert requirements.bundled_ocr_models(tmp_path) is None
    assert requirements.engine_environment({"PATH": "C:/bin"}, tmp_path / "data", tmp_path) is None


def test_the_collection_ships_every_model_livetrial_checks_for():
    manifest = json.loads((ROOT / "packages/assets/collection/collection-manifest.v1.json").read_text(encoding="utf-8"))
    shipped = {name.removeprefix("ocr-models/") for name in manifest["files"] if name.startswith("ocr-models/")}
    pins = json.loads((ROOT / "packages/assets/downloaded-models-v1.json").read_text(encoding="utf-8"))
    shipped |= set(pins["groups"]["ocr-models"]["files"])  # fetched and staged by tooling/livetrial/prepare_engine.py
    assert {f"model/{name}" for name in requirements.BUNDLED_OCR_MODELS} == shipped
    assert '"stage", "--group", "ocr-models"' in (ROOT / "tooling/livetrial/prepare_engine.py").read_text(encoding="utf-8")
