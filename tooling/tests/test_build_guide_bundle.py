"""The single-file guide (tooling/build_guide_bundle.mjs): every language, nothing outside the file."""

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUIDE = ROOT / "docs/install/guide"


@unittest.skipUnless(shutil.which("node"), "needs Node.js")
class GuideBundleTest(unittest.TestCase):
    def test_every_language_becomes_one_self_contained_page(self):
        codes = sorted(path.stem for path in GUIDE.glob("*.html"))
        self.assertEqual(len(codes), 15)
        with tempfile.TemporaryDirectory() as folder:
            subprocess.run(["node", str(ROOT / "tooling/build_guide_bundle.mjs"), "--output", folder,
                            "--html-only", "--version", "v0.2.11"],
                           check=True, capture_output=True, text=True, cwd=ROOT)
            built = sorted(path.name for path in Path(folder).iterdir())
            self.assertEqual(built, sorted(f"MK8DX_Guide_{code}.html" for code in codes))
            for code in ("en", "nl", "ja"):
                page = (Path(folder) / f"MK8DX_Guide_{code}.html").read_text(encoding="utf-8")
                with self.subTest(code=code):
                    # Styles and script inside; every reference is a data: URI, an anchor or an https link.
                    self.assertIn("<style>", page)
                    self.assertNotIn('href="guide.css"', page)
                    self.assertNotIn('src="guide.js"', page)
                    self.assertEqual(re.findall(r'(?:src|href)="(?!data:|https://|#)[^"]*"', page), [])
                    source = (GUIDE / f"{code}.html").read_text(encoding="utf-8")
                    self.assertEqual(page.count("data:image/png;base64,"),
                                     len(re.findall(r'(?:src|href)="img/', source)))
                    self.assertIn("releases/download/v0.2.11/MK8DX_Guide_de.html", page)
                    self.assertNotIn("releases/latest/download/MK8DX_Guide_de.html", page)


class ReleaseAttachesGuideBundlesTest(unittest.TestCase):
    def test_release_builds_and_attaches_the_bundles(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn("node tooling/build_guide_bundle.mjs --output", workflow)
        self.assertIn('--version "$PACKAGE_VERSION"', workflow)
        self.assertIn("fonts-noto-cjk", workflow)
        self.assertRegex(workflow, r"draft-release:\n    needs: \[[^\]]*\bguides\b")
        # The bundles are in the release folder before the manifest and SHA256SUMS.txt are written.
        tail = workflow[workflow.index("draft-release:"):]
        self.assertLess(tail.index("MK8DX_Guide_*.pdf"), tail.index("release_manifest.py"))


if __name__ == "__main__":
    unittest.main()
