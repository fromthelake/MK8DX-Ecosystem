import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from tooling.release import release_manifest

COMMIT = "a" * 40


class ReleaseManifestTest(unittest.TestCase):
    def test_lists_every_asset_with_hash_and_package_details(self):
        with tempfile.TemporaryDirectory() as temporary:
            dist = Path(temporary)
            (dist / "mk8dx-android-debug-v0.2.0-rc.1.apk").write_bytes(b"apk")
            with zipfile.ZipFile(dist / "mk8dx-a2-linux-arm64-v0.2.0-rc.1.zip", "w") as archive:
                archive.writestr("PACKAGE_MANIFEST.json", json.dumps({
                    "platform": "linux", "arch": "arm64", "revision": "v0.2.0-rc.1", "qaOfflineCandidate": True,
                    "images": ["ghcr.io/fromthelake/mk8dx-api:v0.2.0-rc.1-arm64"], "files": {}}))
            (dist / "SHA256SUMS.txt").write_text("old")
            manifest = release_manifest.build(dist, "v0.2.0-rc.1", COMMIT)
        self.assertEqual(manifest["tag"], "v0.2.0-rc.1")
        self.assertIn("productVersion", manifest["compatibility"])
        names = [asset["name"] for asset in manifest["assets"]]
        self.assertEqual(names, ["mk8dx-a2-linux-arm64-v0.2.0-rc.1.zip", "mk8dx-android-debug-v0.2.0-rc.1.apk"])
        apk = manifest["assets"][1]
        self.assertEqual(apk["sha256"], hashlib.sha256(b"apk").hexdigest())
        package = manifest["assets"][0]
        self.assertEqual((package["platform"], package["arch"], package["qaOfflineCandidate"]), ("linux", "arm64", True))
        self.assertNotIn("files", package)

    def test_refuses_a_branch_name_or_short_commit(self):
        with tempfile.TemporaryDirectory() as temporary:
            for tag, commit in (("main", COMMIT), ("v0.2.0", "abc123")):
                with self.subTest(tag=tag), self.assertRaises(SystemExit):
                    release_manifest.build(Path(temporary), tag, commit)


if __name__ == "__main__":
    unittest.main()
