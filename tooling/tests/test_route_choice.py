"""The console setup question offers only the routes the downloaded package can install."""
import json
import tempfile
import unittest
from pathlib import Path

from tooling import install


def folder(*files, images=None):
    temporary = tempfile.TemporaryDirectory()
    root = Path(temporary.name)
    for name in files:
        (root / name).write_text("x", encoding="utf-8")
    if images is not None:
        (root / "images").mkdir()
        (root / "images" / "images.json").write_text(json.dumps(images), encoding="utf-8")
    return temporary, root


class RouteChoiceTest(unittest.TestCase):
    def test_a_package_without_docker_offers_only_a3_and_b2(self):
        temporary, root = folder("PACKAGE_MANIFEST.json", "Start-MK8DX-No-Docker.cmd")
        with temporary:
            self.assertEqual(install.package_routes(root), ["A3", "B2"])

    def test_the_docker_host_package_offers_its_three_routes(self):
        temporary, root = folder("PACKAGE_MANIFEST.json", "compose.yaml", images={"revision": "v0.2.0"})
        with temporary:
            self.assertEqual(install.package_routes(root), ["A1", "A2", "B1"])

    def test_the_a2_package_puts_its_own_route_first(self):
        temporary, root = folder("PACKAGE_MANIFEST.json", "compose.yaml", images={"qaOfflineCandidate": True})
        with temporary:
            self.assertEqual(install.package_routes(root)[0], "A2O")

    def test_a_source_checkout_offers_every_route_with_plain_words(self):
        temporary, root = folder("compose.yaml", "Start-MK8DX-No-Docker.cmd")
        with temporary:
            routes = install.package_routes(root)
        self.assertEqual(sorted(routes), sorted(install.ROUTE_CHOICES))
        for text in install.ROUTE_CHOICES.values():
            self.assertNotIn("QA", text)


if __name__ == "__main__":
    unittest.main()
