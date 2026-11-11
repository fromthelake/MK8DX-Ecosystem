"""A2 offline update to a newer package: when it is offered, and how the images are switched."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling import install

OLD = {"api": "mk8dx/api:old-amd64", "web": "mk8dx/web:old-amd64"}
NEW = {"api": "mk8dx/api:new-amd64", "web": "mk8dx/web:new-amd64"}


def installation(folder: Path, images=OLD, revision=None) -> Path:
    values = {"MK8DX_PROJECT_NAME": "mk8dx-os-test", "MK8DX_API_IMAGE": images["api"],
              "MK8DX_WEB_IMAGE": images["web"], "MK8DX_BIND_ADDRESS": "192.168.1.50"}
    (folder / "compose.env").write_text("".join(install.dotenv(values)), encoding="utf-8")
    if revision is not None:
        (folder / install.PACKAGE_RECORD).write_text(json.dumps({"revision": revision, **images}), encoding="utf-8")
    return folder


def shipped(revision, images=NEW):
    return patch.object(install, "package_images", return_value={**images, "revision": revision})


class UpdateOfferTest(unittest.TestCase):
    def test_a_different_build_is_offered_and_the_same_build_is_not(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = installation(Path(temporary), revision="r10")
            with shipped("r13"):
                self.assertEqual(install.update_offer(state),
                                 {"available": True, "olderPackage": False, "from": "r10", "to": "r13"})
            with shipped("r10", OLD):
                self.assertFalse(install.update_offer(state)["available"])

    def test_a_newer_package_with_the_same_images_is_still_an_update(self):
        # r20 -> r21 changed only the wizard and guide; the tasks must still move to the new folder.
        with tempfile.TemporaryDirectory() as temporary:
            state = installation(Path(temporary), images=NEW, revision="r20")
            with shipped("r21"):
                self.assertTrue(install.update_offer(state)["available"])
            with shipped("r20"):
                self.assertFalse(install.update_offer(state)["available"])

    def test_an_installation_without_a_record_is_offered_any_other_build(self):
        # Installed before the record existed (r10 on groep3): the revision is unknown, the images differ.
        with tempfile.TemporaryDirectory() as temporary:
            state = installation(Path(temporary))
            with shipped("r13"):
                offer = install.update_offer(state)
            self.assertTrue(offer["available"])
            self.assertIsNone(offer["from"])

    def test_an_older_package_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = installation(Path(temporary), revision="r13")
            with shipped("r12"):
                offer = install.update_offer(state)
            self.assertFalse(offer["available"])
            self.assertTrue(offer["olderPackage"])

    def test_a_source_checkout_offers_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = installation(Path(temporary), revision="r10")
            with patch.object(install, "package_images", return_value=None):
                self.assertEqual(install.update_offer(state), {"available": False})


class SwitchImagesTest(unittest.TestCase):
    def test_images_switch_and_the_previous_file_comes_back_for_a_rollback(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = installation(Path(temporary), revision="r10")
            before_bytes = (state / "compose.env").read_bytes()
            loaded = subprocess.CompletedProcess([], 0)
            with shipped("r13"), patch.object(install.subprocess, "run", return_value=loaded):
                before = install.use_package_images(state)
                install.record_package(state)
            values = install.read_dotenv(state / "compose.env")
            self.assertEqual((values["MK8DX_API_IMAGE"], values["MK8DX_WEB_IMAGE"]), (NEW["api"], NEW["web"]))
            self.assertEqual(values["MK8DX_BIND_ADDRESS"], "192.168.1.50")
            self.assertEqual(before, before_bytes)
            self.assertEqual(json.loads((state / install.PACKAGE_RECORD).read_text(encoding="utf-8"))["revision"], "r13")

    def test_a_missing_image_changes_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = installation(Path(temporary), revision="r10")
            before_bytes = (state / "compose.env").read_bytes()
            missing = subprocess.CompletedProcess([], 1)
            with shipped("r13"), patch.object(install.subprocess, "run", return_value=missing):
                with self.assertRaises(RuntimeError):
                    install.use_package_images(state)
            self.assertEqual((state / "compose.env").read_bytes(), before_bytes)


if __name__ == "__main__":
    unittest.main()
