"""#197: a host package refuses `start`/`apply` while the installation still runs another database or API image."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling import install

CONFIG = {"services": {"mysql": {"image": "mysql:9.7.4"},
                       "api": {"image": "ghcr.io/fromthelake/mk8dx-api:v0.2.3-amd64"},
                       "web": {"image": "ghcr.io/fromthelake/mk8dx-web:v0.2.3-amd64"},
                       "mailpit": {"image": "axllent/mailpit:v1.33.1"}}}


IMAGE_IDS = {"mysql:9.7.4": "sha256:m97", "mysql:8.4.13": "sha256:m84",
             "ghcr.io/fromthelake/mk8dx-api:v0.2.3-amd64": "sha256:a023",
             "ghcr.io/fromthelake/mk8dx-api:v0.2.2-amd64": "sha256:a022"}


def compose(ps_output):
    """A fake `subprocess.run` answering Compose `config`/`ps` and `docker image|container inspect`.

    A container row carries its image name as "ID" here, so the container's image ID is that name's ID;
    a name absent from IMAGE_IDS is an image that is not loaded."""
    def run(command, **kwargs):
        if "config" in command:
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(CONFIG))
        if "ps" in command:
            return subprocess.CompletedProcess(command, 0, stdout=ps_output)
        if command[1:3] in (["image", "inspect"], ["container", "inspect"]):
            found = IMAGE_IDS.get(command[-1])
            return subprocess.CompletedProcess(command, 0 if found else 1, stdout=found or "")
        raise AssertionError(f"unexpected command {command}")
    return run


def rows(**images):
    return [{"Service": service, "ID": image, "Image": image} for service, image in images.items()]


class ImagesBehindPackageTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        root = Path(self.root.name)
        (root / "PACKAGE_MANIFEST.json").write_text("{}", encoding="utf-8")
        for target in (patch.object(install, "ROOT", root),
                       patch.object(install, "compose_command", return_value=["docker", "compose"])):
            target.start()
            self.addCleanup(target.stop)

    def behind(self, output):
        with patch.object(install.subprocess, "run", side_effect=compose(output)):
            return install.images_behind_package("state")

    def test_an_older_database_and_api_are_reported(self):
        old = rows(mysql="mysql:8.4.13", api="ghcr.io/fromthelake/mk8dx-api:v0.2.2-amd64",
                   web="ghcr.io/fromthelake/mk8dx-web:v0.2.2-amd64")
        self.assertEqual(self.behind(json.dumps(old)), ["api", "mysql"])

    def test_one_object_per_line_is_read_too(self):
        old = rows(mysql="mysql:8.4.13", api=CONFIG["services"]["api"]["image"])
        self.assertEqual(self.behind("\n".join(json.dumps(row) for row in old)), ["mysql"])

    def test_the_same_version_and_a_changed_gateway_or_mailpit_pass(self):
        same = rows(mysql="mysql:9.7.4", api=CONFIG["services"]["api"]["image"],
                    web="ghcr.io/fromthelake/mk8dx-web:v0.2.2-amd64", mailpit="axllent/mailpit:v1.30.0")
        self.assertEqual(self.behind(json.dumps(same)), [])

    def test_an_image_that_is_not_loaded_is_not_judged(self):
        self.assertEqual(self.behind(json.dumps(rows(mysql="mysql:unknown"))), [])

    def test_no_containers_yet_passes(self):
        self.assertEqual(self.behind(""), [])
        self.assertEqual(self.behind("[]"), [])

    def test_a_source_checkout_is_not_checked(self):
        (Path(self.root.name) / "PACKAGE_MANIFEST.json").unlink()
        with patch.object(install.subprocess, "run", side_effect=AssertionError("no docker call expected")):
            self.assertEqual(install.images_behind_package("state"), [])


class OperateRefusesTest(unittest.TestCase):
    def operate(self, action, route, behind):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / install.PROFILE).write_text(json.dumps({"route": route}), encoding="utf-8")
            with patch.object(install, "safe_state_dir", side_effect=lambda s, **_: Path(s)), \
                 patch.object(install, "images_behind_package", return_value=behind) as checked, \
                 patch.object(install, "run_compose") as run_compose, patch.object(install, "status"):
                install.operate(state, action)
                return checked, run_compose

    def test_start_and_apply_refuse_with_the_update_advice(self):
        for action in ("start", "apply"):
            with self.subTest(action=action), self.assertRaisesRegex(ValueError, r"Choose 7 \(update\) first"):
                self.operate(action, "A1", ["mysql"])

    def test_start_continues_when_nothing_is_behind(self):
        _, run_compose = self.operate("start", "B1", [])
        self.assertTrue(run_compose.called)

    def test_other_actions_and_a2_offline_are_not_checked(self):
        checked, _ = self.operate("stop", "A1", ["mysql"])
        self.assertFalse(checked.called)
        checked, _ = self.operate("check", "A1", ["mysql"])
        self.assertFalse(checked.called)


if __name__ == "__main__":
    unittest.main()
