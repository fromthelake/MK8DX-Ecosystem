"""Removing an installation keeps every image another container on this computer still uses."""
import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from tooling import remove_images

API_A1 = "ghcr.io/fromthelake/mk8dx-api:v0.2.7-amd64-111111111111"
API_A2_OLD = "ghcr.io/fromthelake/mk8dx-api:v0.2.6-amd64"
MYSQL = "mysql:9.7.4"
MAILPIT = "axllent/mailpit:v1.33.1"


class FakeDocker:
    def __init__(self, images, containers):
        self.images = dict(images)          # tag -> image ID
        self.containers = containers        # list of docker-inspect-like dicts
        self.removed = []

    def __call__(self, *args):
        def done(stdout="", code=0, stderr=""):
            return subprocess.CompletedProcess(["docker", *args], code, stdout, stderr)
        if args[:2] == ("image", "inspect"):
            tag = args[-1]
            return done(self.images[tag] + "\n") if tag in self.images else done(code=1, stderr="No such image")
        if args[:2] == ("ps", "-a"):
            return done("\n".join(item["Id"] for item in self.containers))
        if args[0] == "inspect":
            return done(json.dumps([item for item in self.containers if item["Id"] in args[1:]]))
        if args[:2] == ("image", "rm"):
            self.removed.append(args[2])
            self.images.pop(args[2], None)
            return done(f"Untagged: {args[2]}")
        raise AssertionError(args)


def container(identifier, image_id, image_name, project):
    return {"Id": identifier, "Name": f"/{project}-x-1", "Image": image_id,
            "Config": {"Image": image_name, "Labels": {"com.docker.compose.project": project}}}


class RemoveImagesTest(unittest.TestCase):
    def test_removes_only_unused_images(self):
        fake = FakeDocker({API_A1: "sha256:a1", MYSQL: "sha256:my", MAILPIT: "sha256:mp"},
                          [container("c1", "sha256:my", MYSQL, "mk8dx-os-a2")])
        decisions = {row["image"]: row for row in remove_images.plan([API_A1, MYSQL, MAILPIT], fake)}
        self.assertEqual(decisions[API_A1]["action"], "remove")
        self.assertEqual(decisions[MAILPIT]["action"], "remove")
        self.assertEqual(decisions[MYSQL], {"image": MYSQL, "action": "keep", "usedBy": ["mk8dx-os-a2"]})

    def test_stopped_containers_and_other_programs_count(self):
        # `docker ps -a`: a stopped A2 or an unrelated program's container keeps the image too.
        fake = FakeDocker({MAILPIT: "sha256:mp"}, [container("c2", "sha256:mp", MAILPIT, "some-other-app")])
        self.assertEqual(remove_images.plan([MAILPIT], fake)[0]["action"], "keep")

    def test_a_tag_another_installation_was_created_from_stays(self):
        # 0.2.6: an A1 start re-pointed the A2 tag to other bytes. A2's container still names the tag; removing
        # the tag would leave A2 without the image its next start asks for.
        fake = FakeDocker({API_A2_OLD: "sha256:from-a1"},
                          [container("c3", "sha256:from-a2", API_A2_OLD, "mk8dx-os-59eddec6db")])
        self.assertEqual(remove_images.plan([API_A2_OLD], fake)[0]["usedBy"], ["mk8dx-os-59eddec6db"])

    def test_absent_images_are_reported_not_removed(self):
        fake = FakeDocker({}, [])
        self.assertEqual(remove_images.plan([API_A1], fake)[0]["action"], "absent")

    def test_main_removes_and_reports(self):
        fake = FakeDocker({API_A1: "sha256:a1", MYSQL: "sha256:my"},
                          [container("c1", "sha256:my", MYSQL, "mk8dx-os-a2")])
        with tempfile.TemporaryDirectory() as folder:
            manifest = Path(folder) / "PACKAGE_MANIFEST.json"
            manifest.write_text(json.dumps({"images": [API_A1, MYSQL]}), encoding="utf-8")
            out = io.StringIO()
            with redirect_stdout(out):
                code = remove_images.main(["--manifest", str(manifest)], run=fake)
        self.assertEqual(code, 0)
        self.assertEqual(fake.removed, [API_A1])
        self.assertIn("kept, still used by mk8dx-os-a2: mysql:9.7.4", out.getvalue())

    def test_dry_run_removes_nothing(self):
        fake = FakeDocker({API_A1: "sha256:a1"}, [])
        with tempfile.TemporaryDirectory() as folder:
            manifest = Path(folder) / "PACKAGE_MANIFEST.json"
            manifest.write_text(json.dumps({"images": [API_A1]}), encoding="utf-8")
            with redirect_stdout(io.StringIO()):
                remove_images.main(["--manifest", str(manifest), "--dry-run"], run=fake)
        self.assertEqual(fake.removed, [])


if __name__ == "__main__":
    unittest.main()
