"""The public test set is admitted only through its reviewed SHA-256/size list (synthetic tree)."""
import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from tooling import privacy_scan

PNG = b"\x89PNG\r\n\x1a\n" + bytes(range(256))


class PublicTestSetAdmissionTest(unittest.TestCase):
    def scan(self, root):
        previous = privacy_scan.ROOT
        privacy_scan.ROOT = root
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as errors:
                try:
                    privacy_scan.main()
                    return 0, ""
                except SystemExit as exit_:
                    return exit_.code, errors.getvalue()
        finally:
            privacy_scan.ROOT = previous

    def tree(self, temp, listed=True):
        root = Path(temp)
        folder = root / "packages/assets/test-set"
        folder.mkdir(parents=True)
        (folder / "frame.png").write_bytes(PNG)
        files = {}
        if listed:
            files["packages/assets/test-set/frame.png"] = {"sha256": hashlib.sha256(PNG).hexdigest(), "sizeBytes": len(PNG)}
        (folder / "test-set-files-v1.json").write_text(json.dumps(
            {"schemaVersion": "mk8dx.public-test-set-files.v1", "files": files}), encoding="utf-8")
        return root, folder

    def test_listed_frame_passes(self):
        with tempfile.TemporaryDirectory() as temp:
            root, _ = self.tree(temp)
            self.assertEqual(self.scan(root), (0, ""))

    def test_unlisted_frame_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root, _ = self.tree(temp, listed=False)
            code, errors = self.scan(root)
            self.assertEqual(code, 1)
            self.assertIn("unreviewed binary: packages/assets/test-set/frame.png", errors)

    def test_changed_extra_and_missing_frames_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            root, folder = self.tree(temp)
            (folder / "frame.png").write_bytes(PNG + b"x")
            (folder / "other.png").write_bytes(PNG)
            (root / "elsewhere.png").write_bytes(PNG)
            code, errors = self.scan(root)
            self.assertEqual(code, 1)
            self.assertIn("changed public test set file: packages/assets/test-set/frame.png", errors)
            self.assertIn("unreviewed binary: packages/assets/test-set/other.png", errors)
            self.assertIn("unreviewed binary: elsewhere.png", errors)
            (folder / "frame.png").unlink()
            code, errors = self.scan(root)
            self.assertIn("missing public test set file: packages/assets/test-set/frame.png", errors)

    def test_list_cannot_admit_files_outside_the_test_set(self):
        with tempfile.TemporaryDirectory() as temp:
            root, folder = self.tree(temp, listed=False)
            (root / "outside.png").write_bytes(PNG)
            (folder / "test-set-files-v1.json").write_text(json.dumps({
                "schemaVersion": "mk8dx.public-test-set-files.v1",
                "files": {"outside.png": {"sha256": hashlib.sha256(PNG).hexdigest(), "sizeBytes": len(PNG)}}}),
                encoding="utf-8")
            code, errors = self.scan(root)
            self.assertEqual(code, 1)
            self.assertIn("invalid public test set entry: outside.png", errors)
            self.assertIn("unreviewed binary: outside.png", errors)

    def test_local_virtual_environments_are_not_scanned(self):
        # docs/DEVELOPMENT.md creates .venv in the repository root; its binaries are not distributed source.
        with tempfile.TemporaryDirectory() as temp:
            root, _ = self.tree(temp)
            for name in (".venv", "venv"):
                (root / name / "Scripts").mkdir(parents=True)
                (root / name / "Scripts" / "python.exe").write_bytes(PNG)
            self.assertEqual(self.scan(root), (0, ""))


if __name__ == "__main__":
    unittest.main()
