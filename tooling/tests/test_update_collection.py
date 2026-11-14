"""Admitting a new public upstream model file into an existing collection group (synthetic repository)."""
import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling" / "assets"))
import shared_asset_source  # noqa: E402
import update_collection  # noqa: E402

OLD = b"existing detection model"
NEW = b"upstream english recognition model"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(shared_asset_source.json_bytes(value))


class AdmissionTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        base = Path(self.temporary.name)
        self.repo = base / "repo"
        self.collection = self.repo / "packages/assets/collection"
        self.source = base / "review-copy"
        (self.source / "model").mkdir(parents=True)
        (self.source / "model/english_g2.pth").write_bytes(NEW)
        objects = self.collection / "objects" / sha(OLD)[:2]
        objects.mkdir(parents=True)
        (objects / sha(OLD)).write_bytes(OLD)
        group = {"consumers": ["tournament-live"], "role": "ocr-detection-and-latin-recognition"}
        write_json(self.collection / "collection-manifest.v1.json", {
            "files": {"ocr-models/model/craft.pth": {**group, "format": "pth", "sha256": sha(OLD),
                                                     "sizeBytes": len(OLD), "sourceId": "ocr-models",
                                                     "sourceRelativePath": "model/craft.pth"}},
            "releaseVersion": "v1", "schemaVersion": "mk8dx.internal-asset-collection.v1",
            "sources": {"ocr-models": {**group, "fileCount": 1,
                                       "treeSha256": sha(f"{sha(OLD)}  model/craft.pth\n".encode())}}})
        for name in update_collection.VIEWS:
            write_json(self.repo / "packages/assets" / f"{name}-selection-v1.json",
                       {"collectionVersion": "v1", "files": {}})
        write_json(self.repo / "compatibility.json", {"assetCollectionVersion": "v1"})
        (self.repo / "packages/assets/licenses").mkdir(parents=True)
        (self.repo / "packages/assets/licenses/Apache-2.0.txt").write_text("Apache License 2.0\n")
        (self.repo / ".gitignore").write_text("node_modules/\n")
        self.entry = {"logical": "ocr-models/model/english_g2.pth", "sourceRelative": "model/english_g2.pth",
                      "sha256": sha(NEW), "sizeBytes": len(NEW), "upstreamMd5": hashlib.md5(NEW).hexdigest(),
                      "sourceUrl": "https://github.com/JaidedAI/EasyOCR/releases/download/v1.3/english_g2.zip",
                      "license": "Apache-2.0"}

    def tearDown(self):
        self.temporary.cleanup()

    def run_command(self, command, **overrides):
        manifest = (self.collection / "collection-manifest.v1.json").read_bytes()
        policy = {"schemaVersion": "mk8dx.collection-update-policy.v1", "baseManifestSha256": sha(manifest),
                  "baseVersion": "v1", "nextVersion": "v2", "sourceRoot": str(self.source),
                  "admissions": [{**self.entry, **overrides}]}
        policy_path = Path(self.temporary.name) / "policy.json"
        if command == "plan" or not policy_path.exists():
            policy_path.write_text(json.dumps(policy))
        plan_path = Path(self.temporary.name) / "plan.json"
        function = getattr(update_collection, command)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            function(policy_path, plan_path, self.collection, self.repo)
        return json.loads(output.getvalue())

    def test_admission_adds_the_file_with_its_provenance(self):
        self.assertEqual(self.run_command("plan"), {"planned": 1, "nextVersion": "v2"})
        self.assertEqual(self.run_command("validate"), {"validated": 1, "nextVersion": "v2"})
        self.assertEqual(self.run_command("apply"), {"applied": 1, "version": "v2"})
        manifest = json.loads((self.collection / "collection-manifest.v1.json").read_text())
        row = manifest["files"]["ocr-models/model/english_g2.pth"]
        self.assertEqual(row["provenance"], {"license": "Apache-2.0", "sourceUrl": self.entry["sourceUrl"],
                                             "upstreamMd5": self.entry["upstreamMd5"]})
        self.assertEqual((row["sha256"], row["sourceRelativePath"], row["role"]),
                         (sha(NEW), "model/english_g2.pth", "ocr-detection-and-latin-recognition"))
        group = manifest["sources"]["ocr-models"]
        tree = "".join(f"{digest}  {name}\n" for name, digest in
                       sorted([("model/craft.pth", sha(OLD)), ("model/english_g2.pth", sha(NEW))]))
        self.assertEqual((group["fileCount"], group["treeSha256"]), (2, sha(tree.encode())))
        self.assertEqual(json.loads((self.repo / "compatibility.json").read_text())["assetCollectionVersion"], "v2")
        self.assertEqual(shared_asset_source.SharedAssetSource(self.collection).verify()["status"], "verified")
        self.assertEqual((self.repo / ".gitignore").read_text(), "node_modules/\n")
        self.assertEqual(self.run_command("apply"), {"applied": 0, "version": "v2"})

    def test_a_large_admitted_object_is_stored_in_parts(self):
        previous = shared_asset_source.PART_BYTES, update_collection.PART_BYTES
        shared_asset_source.PART_BYTES = update_collection.PART_BYTES = 10
        try:
            self.run_command("plan")
            self.run_command("apply")
        finally:
            shared_asset_source.PART_BYTES, update_collection.PART_BYTES = previous
        folder = self.collection / "objects" / sha(NEW)[:2]
        self.assertEqual(len(list(folder.glob(f"{sha(NEW)}.part*"))), 4)
        self.assertIn(f"packages/assets/collection/objects/{sha(NEW)[:2]}/{sha(NEW)}\n",
                      (self.repo / ".gitignore").read_text())
        self.assertEqual(shared_asset_source.SharedAssetSource(self.collection).verify()["status"], "verified")

    def test_unreviewed_admissions_are_refused(self):
        cases = {"upstreamMd5": "0" * 32, "sourceUrl": "http://example.org/model.zip", "license": "MIT",
                 "sha256": "0" * 64, "logical": "ocr-models/model/craft.pth", "sizeBytes": 1}
        for field, value in cases.items():
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.run_command("plan", **{field: value})
        for logical in ("new-group/model/english_g2.pth", "ocr-models/model/english_g2.json"):
            with self.subTest(logical=logical), self.assertRaises(ValueError):
                self.run_command("plan", logical=logical)

    def test_a_source_changed_after_planning_is_refused(self):
        self.run_command("plan")
        (self.source / "model/english_g2.pth").write_bytes(b"changed after planning")
        with self.assertRaises(ValueError):
            self.run_command("apply")
        manifest = json.loads((self.collection / "collection-manifest.v1.json").read_text())
        self.assertNotIn("ocr-models/model/english_g2.pth", manifest["files"])
        self.assertEqual(manifest["releaseVersion"], "v1")


if __name__ == "__main__":
    unittest.main()
