"""Build-time model downloads are verified against their pins and fail closed (synthetic archive, no network)."""
import hashlib
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling" / "assets"))
import downloaded_models as models  # noqa: E402

PAYLOAD = b"tiny fake recognition model"
URL = "https://github.com/JaidedAI/EasyOCR/releases/download/v1.3/fake_g2.zip"


def archive_bytes(member="fake_g2.pth", payload=PAYLOAD):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr(member, payload)
    return buffer.getvalue()


class Response(io.BytesIO):
    def __init__(self, data, final=URL):
        super().__init__(data)
        self.final = final

    def geturl(self):
        return self.final

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class DownloadedModelsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        base = Path(self.temporary.name)
        self.cache, self.output = base / "cache", base / "out"
        (base / "assets/licenses").mkdir(parents=True)
        (base / "assets/licenses/Apache-2.0.txt").write_text("Apache License 2.0\n")
        self.pins = base / "assets/downloaded-models-v1.json"
        self.served = archive_bytes()
        self.calls = []
        self.original = models.urlopen
        models.urlopen = self.fake_urlopen
        self.write_pins()

    def tearDown(self):
        models.urlopen = self.original
        self.temporary.cleanup()

    def fake_urlopen(self, url, timeout):
        self.calls.append(url)
        return Response(self.served)

    def write_pins(self, **changes):
        archive = archive_bytes()
        row = {"license": "Apache-2.0", "sha256": hashlib.sha256(PAYLOAD).hexdigest(), "sizeBytes": len(PAYLOAD),
               "upstreamMd5": hashlib.md5(PAYLOAD).hexdigest(),
               "source": {"member": "fake_g2.pth", "sha256": hashlib.sha256(archive).hexdigest(),
                          "sizeBytes": len(archive), "url": URL}}
        row.update(changes)
        self.pins.write_text(json.dumps({"schemaVersion": models.SCHEMA,
                                         "groups": {"ocr-models": {"files": {"model/fake_g2.pth": row}}}}))

    def stage(self):
        return models.stage("ocr-models", self.output, self.cache, self.pins)

    def test_a_verified_model_is_staged_and_then_served_from_the_cache(self):
        self.assertEqual(self.stage()["files"], 1)
        self.assertEqual((self.output / "model/fake_g2.pth").read_bytes(), PAYLOAD)
        (self.output / "model/fake_g2.pth").unlink()
        self.stage()
        self.assertEqual(len(self.calls), 1)

    def test_a_tampered_archive_is_refused_and_nothing_is_staged(self):
        self.served = archive_bytes(payload=b"something else entirely")
        with self.assertRaises(models.ModelError):
            self.stage()
        self.assertFalse((self.output / "model/fake_g2.pth").exists())
        self.assertEqual(list((self.cache / "archives").iterdir()), [])

    def test_a_pinned_archive_with_the_wrong_model_inside_is_refused(self):
        self.write_pins(upstreamMd5="0" * 32)
        with self.assertRaises(models.ModelError):
            self.stage()
        self.assertFalse((self.output / "model/fake_g2.pth").exists())

    def test_a_damaged_cache_is_refetched(self):
        self.stage()
        for path in (self.cache / "files").iterdir():
            path.write_bytes(b"damaged")
        for path in (self.cache / "archives").iterdir():
            path.write_bytes(b"damaged")
        (self.output / "model/fake_g2.pth").unlink()
        self.stage()
        self.assertEqual(len(self.calls), 2)
        self.assertEqual((self.output / "model/fake_g2.pth").read_bytes(), PAYLOAD)

    def test_an_existing_different_staged_file_is_refused(self):
        (self.output / "model").mkdir(parents=True)
        (self.output / "model/fake_g2.pth").write_bytes(b"not the model")
        with self.assertRaises(models.ModelError):
            self.stage()

    def test_incomplete_pins_and_plain_http_are_refused(self):
        for changes in ({"license": "MIT"}, {"sha256": "x"},
                        {"source": {"member": "fake_g2.pth", "sha256": "0" * 64, "sizeBytes": 1,
                                    "url": "http://example.org/fake.zip"}}):
            with self.subTest(changes=changes):
                self.write_pins(**changes)
                with self.assertRaises(models.ModelError):
                    self.stage()
        with self.assertRaises(models.ModelError):
            models.download("http://example.org/fake.zip", self.cache / "x")

    def test_a_redirect_away_from_https_is_refused(self):
        models.urlopen = lambda url, timeout: Response(self.served, final="http://example.org/fake.zip")
        with self.assertRaises(models.ModelError):
            self.stage()

    def test_admit_pins_every_hash_after_checking_the_upstream_md5(self):
        pins = self.pins.with_name("new-pins.json")
        with self.assertRaises(models.ModelError):
            models.admit("ocr-models", "model/fake_g2.pth", URL, "fake_g2.pth", "0" * 32, "Apache-2.0",
                         self.cache, pins)
        result = models.admit("ocr-models", "model/fake_g2.pth", URL, "fake_g2.pth",
                              hashlib.md5(PAYLOAD).hexdigest(), "Apache-2.0", self.cache, pins)
        self.assertEqual(result["sha256"], hashlib.sha256(PAYLOAD).hexdigest())
        self.assertEqual(json.loads(pins.read_text()), json.loads(self.pins.read_text()))

    def test_the_repository_pins_are_complete(self):
        pins = models.load_pins()
        files = pins["groups"]["ocr-models"]["files"]
        self.assertEqual(set(files), {f"model/{name}.pth" for name in (
            "english_g2", "cyrillic_g2", "japanese_g2", "korean_g2", "zh_sim_g2", "chinese")})
        for row in files.values():
            self.assertTrue(row["source"]["url"].startswith("https://github.com/JaidedAI/EasyOCR/releases/download/"))


if __name__ == "__main__":
    unittest.main()
