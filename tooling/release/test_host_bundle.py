"""Check that a release ZIP will start the images it actually contains."""

import hashlib
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from tooling.release import host_bundle, non_docker_bundle, release_manifest, verify_package_guides


class PackagedGuidesTest(unittest.TestCase):
    """Every package that ships the EN/NL guides ships every translated one as well."""

    def locales(self):
        folder = host_bundle.ROOT / "docs/install/translations"
        return sorted(p.name for p in folder.iterdir() if (p / "MK8DX_User_Guide.txt").is_file()) \
            if folder.is_dir() else []

    def test_host_packages_carry_every_language(self):
        paths = set(host_bundle.guide_paths())
        for name in ("docs/install/A2_HOME_GUIDE_EN.md", "docs/install/MK8DX_User_Guide_EN.docx",
                     "docs/install/MK8DX_Handleiding_NL.txt", "docs/install/guide/en.html",
                     "docs/install/guide/nl.html", "docs/install/guide/guide.js"):
            self.assertIn(name, paths)
        for page in (host_bundle.ROOT / "docs/install/guide").glob("*.html"):
            self.assertIn(f"docs/install/guide/{page.name}", paths)
        for locale in self.locales():
            with self.subTest(locale=locale):
                for name in ("A2_HOME_GUIDE.md", "MK8DX_User_Guide.txt", f"MK8DX_User_Guide_{locale}.docx"):
                    self.assertIn(f"docs/install/translations/{locale}/{name}", paths)
                self.assertIn(f"docs/install/guide/{locale}.html", paths)
        self.assertFalse([name for name in paths if name.endswith(".json")])

    def test_non_docker_packages_carry_every_user_guide(self):
        for name in non_docker_bundle.DOCS:
            self.assertTrue((non_docker_bundle.ROOT / name).is_file(), name)
        for locale in self.locales():
            with self.subTest(locale=locale):
                self.assertIn(f"docs/install/translations/{locale}/MK8DX_User_Guide_{locale}.docx",
                              non_docker_bundle.DOCS)
                self.assertIn(f"docs/install/translations/{locale}/MK8DX_User_Guide.txt", non_docker_bundle.DOCS)

    def test_release_attaches_every_user_guide_under_its_own_name(self):
        workflow = (host_bundle.ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn('cp "$folder/MK8DX_User_Guide.txt" "MK8DX_User_Guide_${locale}.txt"', workflow)
        self.assertIn('cp "$folder/MK8DX_User_Guide_${locale}.docx" .', workflow)


class HostBundleArchiveLayoutTest(unittest.TestCase):
    def test_a2_zip_extracts_as_one_folder_with_manifest_and_launcher(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            tar = folder / "images.tar"
            tar.write_bytes(b"test image")
            output = folder / "mk8dx-a2-windows-amd64-v0.2.9.zip"
            host_bundle.write_archive(output, {"revision": "v0.2.9"},
                                      {"Start-MK8DX-LAN.cmd": b"start"}, {}, None, tar, "amd64", True)
            with zipfile.ZipFile(output) as archive:
                root = output.stem + "/"
                self.assertEqual(set(archive.namelist()), {
                    root + "PACKAGE_MANIFEST.json", root + "Start-MK8DX-LAN.cmd",
                    root + "images/docker-images-amd64.tar",
                })
                archive.extractall(folder / "unpacked")
            self.assertTrue((folder / "unpacked" / output.stem / "Start-MK8DX-LAN.cmd").is_file())
            self.assertEqual("v0.2.9", release_manifest.package_details(output)["revision"])

    def test_actual_guide_bytes_and_start_page_match_the_release_source(self):
        paths = host_bundle.guide_paths()
        source = host_bundle.ROOT
        files = {name: (source / name).read_bytes() for name in paths}
        files["START-HERE.html"] = host_bundle.A2_GUIDE_START.read_bytes()
        receipt = {"revision": "v0.2.11", "sourceCommit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=source, text=True).strip(),
            "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                      for name, data in files.items()}}
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            tar = folder / "images.tar"
            tar.write_bytes(b"test image")
            output = folder / "mk8dx-a2-windows-amd64-v0.2.11.zip"
            host_bundle.write_archive(output, receipt, files, {}, None, tar, "amd64", True)
            self.assertEqual(len(paths), verify_package_guides.verify(output))

            corrupted = dict(files)
            corrupted["docs/install/A2_HOME_GUIDE_EN.md"] += b"\nold step\n"
            receipt["files"]["docs/install/A2_HOME_GUIDE_EN.md"] = {
                "bytes": len(corrupted["docs/install/A2_HOME_GUIDE_EN.md"]),
                "sha256": hashlib.sha256(corrupted["docs/install/A2_HOME_GUIDE_EN.md"]).hexdigest(),
            }
            bad = folder / "bad" / output.name
            bad.parent.mkdir()
            host_bundle.write_archive(bad, receipt, corrupted, {}, None, tar, "amd64", True)
            with self.assertRaisesRegex(ValueError, "guide differs from source"):
                verify_package_guides.verify(bad)

            host_output = folder / "mk8dx-host-local-v0.2.11-amd64.zip"
            host_files = {name: (source / name).read_bytes() for name in paths}
            host_receipt = {"revision": "v0.2.11", "sourceCommit": receipt["sourceCommit"],
                            "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                                      for name, data in host_files.items()}}
            host_bundle.write_archive(host_output, host_receipt, host_files, {}, None, tar, "amd64", False)
            self.assertEqual(len(paths), verify_package_guides.verify(host_output))
            wrong_version = folder / "mk8dx-host-local-v0.2.12-amd64.zip"
            shutil.copyfile(host_output, wrong_version)
            with self.assertRaisesRegex(ValueError, "revision differ"):
                verify_package_guides.verify(wrong_version)


class HostBundleImageReferencesTest(unittest.TestCase):
    def test_release_images_match_every_packaged_launcher(self):
        images = host_bundle.image_tags("v0.1.0")
        self.assertEqual(len(images), 4)
        for name in host_bundle.PACKAGE_IMAGE_FILES:
            with self.subTest(name=name):
                payload = host_bundle.package_bytes(name, images).decode("utf-8")
                for image in images[:2]:
                    self.assertIn(image, payload)
                for old in host_bundle.IMAGES[:2]:
                    self.assertNotIn(old, payload)

    def test_local_package_keeps_current_tags(self):
        images = host_bundle.image_tags(None)
        self.assertEqual(images, host_bundle.IMAGES)
        for name in host_bundle.PACKAGE_IMAGE_FILES:
            payload = host_bundle.package_bytes(name, images).decode("utf-8")
            for image in images[:2]:
                self.assertIn(image, payload)


class ContentTagTest(unittest.TestCase):
    """Two packages never load different bytes under one tag (A1 and A2 of 0.2.6 did)."""

    IDS = {"ghcr.io/fromthelake/mk8dx-api:v0.2.7-amd64": "sha256:" + "a" * 12 + "1" * 52,
           "ghcr.io/fromthelake/mk8dx-web:v0.2.7-amd64": "sha256:" + "b" * 12 + "2" * 52,
           **{tag: "sha256:" + "e" * 12 + "3" * 52 for tag in host_bundle.base_image_pins()}}

    def test_the_tag_names_the_image_content(self):
        images = host_bundle.image_tags("v0.2.7")
        tagged = host_bundle.content_tags(images, id_of=self.IDS.__getitem__)
        self.assertEqual(tagged[:2], ("ghcr.io/fromthelake/mk8dx-api:v0.2.7-amd64-aaaaaaaaaaaa",
                                      "ghcr.io/fromthelake/mk8dx-web:v0.2.7-amd64-bbbbbbbbbbbb"))
        # MySQL and Mailpit too: their plain tags belong to whatever else runs on the computer.
        self.assertEqual(tagged[2:], tuple(f"{tag}-eeeeeeeeeeee" for tag in images[2:]))

    def test_different_builds_get_different_tags_and_equal_builds_the_same(self):
        images = host_bundle.image_tags("v0.2.7")
        other = {tag: "sha256:" + "c" * 64 for tag in self.IDS}
        self.assertNotEqual(host_bundle.content_tags(images, id_of=self.IDS.__getitem__)[:2],
                            host_bundle.content_tags(images, id_of=other.__getitem__)[:2])
        self.assertEqual(host_bundle.content_tags(images, id_of=self.IDS.__getitem__),
                         host_bundle.content_tags(images, id_of=dict(self.IDS).__getitem__))

    def test_every_packaged_launcher_names_the_content_tags(self):
        tagged = host_bundle.content_tags(host_bundle.image_tags("v0.2.7"), id_of=self.IDS.__getitem__)
        for name in host_bundle.PACKAGE_IMAGE_FILES:
            with self.subTest(name=name):
                payload = host_bundle.package_bytes(name, tagged).decode("utf-8")
                for image in tagged[:2]:
                    self.assertIn(image, payload)
        local = host_bundle.content_tags(host_bundle.IMAGES, id_of=lambda tag: "sha256:" + "d" * 64)
        payload = host_bundle.package_bytes("compose.yaml", local).decode("utf-8")
        self.assertIn("mk8dx/api:local-v010-node26-amd64-dddddddddddd", payload)
        for tag, digest in host_bundle.base_image_pins().items():
            name = host_bundle.BASE_IMAGE_FILES["mysql" if tag.startswith("mysql") else "mailpit"]
            with self.subTest(base=tag):
                packaged = host_bundle.package_bytes(name, local).decode("utf-8")
                self.assertIn(f"image: {tag}-dddddddddddd\n", packaged)
                self.assertNotIn(digest, packaged)

    def test_an_unreadable_image_id_is_refused(self):
        with self.assertRaises(SystemExit):
            host_bundle.content_tags(host_bundle.IMAGES, id_of=lambda tag: "")

    def test_the_removal_tool_is_packaged(self):
        self.assertIn("tooling/remove_images.py", host_bundle.FILES)
        self.assertTrue((host_bundle.ROOT / "tooling/remove_images.py").is_file())

    def test_release_builds_each_architecture_once_for_all_packages(self):
        workflow = (host_bundle.ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        # The API and Web images are built in one job per architecture; the A1/B1 host package and every A2
        # package load that build instead of building their own.
        self.assertEqual(workflow.count("-f backend/api/Dockerfile"), 1)
        self.assertEqual(workflow.count("-f apps/timetrials-web/Dockerfile"), 1)
        self.assertIn("docker load --input", workflow)


class HostBundleBaseImagePinsTest(unittest.TestCase):
    """#34: MySQL and Mailpit are digest-pinned in Compose; a package starts its tar-loaded copies by tag."""

    def test_compose_pins_every_third_party_image_by_index_digest(self):
        pins = host_bundle.base_image_pins()
        # The repositories are fixed; the tags move with Dependabot, which updates tag and digest together.
        self.assertEqual(sorted(host_bundle.repository(tag) for tag in pins), ["axllent/mailpit", "mysql"])
        self.assertEqual(host_bundle.IMAGES[2:], tuple(pins))
        for tag, digest in pins.items():
            self.assertRegex(digest, r"^sha256:[0-9a-f]{64}$")
            name = host_bundle.BASE_IMAGE_FILES["mysql" if tag.startswith("mysql:") else "mailpit"]
            self.assertIn(f"    image: {tag}@{digest}\n", (host_bundle.ROOT / name).read_text(encoding="utf-8"))

    def test_packaged_compose_files_name_the_tag_without_the_digest(self):
        for version in (None, "v0.2.9"):
            images = host_bundle.image_tags(version)
            for name in set(host_bundle.BASE_IMAGE_FILES.values()):
                with self.subTest(version=version, name=name):
                    source = (host_bundle.ROOT / name).read_text(encoding="utf-8")
                    payload = host_bundle.package_bytes(name, images).decode("utf-8")
                    self.assertNotIn("@sha256:", payload)
                    for tag, digest in host_bundle.base_image_pins().items():
                        if f"{tag}@{digest}" in source:
                            self.assertIn(f"    image: {tag}\n", payload)
                    self.assertEqual(payload.count("\n"), source.count("\n"))

    def test_a_local_image_with_another_digest_is_refused(self):
        pins = host_bundle.base_image_pins()
        good = {tag: [f"{host_bundle.repository(tag)}@{digest}"] for tag, digest in pins.items()}
        host_bundle.check_base_image_digests(good.get)
        mysql = next(tag for tag in pins if host_bundle.repository(tag) == "mysql")
        stale = dict(good, **{mysql: ["mysql@sha256:" + "0" * 64]})
        with self.assertRaises(SystemExit):
            host_bundle.check_base_image_digests(stale.get)
        with self.assertRaises(SystemExit):
            host_bundle.check_base_image_digests(lambda tag: [])

    def test_pull_fetches_by_digest_and_tags(self):
        with mock.patch.object(host_bundle.subprocess, "run") as run:
            host_bundle.pull_base_images("arm64")
        commands = [call.args[0] for call in run.call_args_list]
        for tag, digest in host_bundle.base_image_pins().items():
            pinned = f"{host_bundle.repository(tag)}@{digest}"
            self.assertIn(["docker", "pull", "--platform", "linux/arm64", pinned], commands)
            self.assertIn(["docker", "tag", pinned, tag], commands)

    def test_pull_arm64_needs_no_platform(self):
        # The release workflow's arm64 A2 jobs call --pull-base-images --arch arm64 without --platform.
        with mock.patch.object(host_bundle, "pull_base_images") as pull,                 mock.patch.object(host_bundle.sys, "argv", ["host_bundle.py", "--pull-base-images", "--arch", "arm64"]):
            host_bundle.main()
        pull.assert_called_once_with("arm64")

    def test_invalid_tag_cannot_be_used_as_image_name(self):
        for version in ("main", "v0.1.0;docker", "v0.1.0/evil", "v0.1.0-rc.1+dirty"):
            with self.subTest(version=version), self.assertRaises(SystemExit):
                host_bundle.image_tags(version)


class HostBundlePlatformTest(unittest.TestCase):
    WHEELS = (
        "cffi-2.1.1-cp312-cp312-win_amd64.whl",
        "cffi-2.1.1-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
        "cffi-2.1.1-cp312-cp312-manylinux2014_aarch64.manylinux_2_17_aarch64.whl",
        "cffi-2.1.1-cp312-cp312-macosx_11_0_arm64.whl",
        "cryptography-50.0.2-cp311-abi3-macosx_10_9_universal2.whl",
        "cffi-2.1.1-cp311-cp311-manylinux2014_x86_64.whl",
        "pycparser-3.12-py3-none-any.whl",
    )

    def fits(self, platform, arch):
        return sorted(w for w in self.WHEELS if host_bundle.wheel_fits(w, platform, arch))

    def test_each_host_gets_only_its_own_cp312_wheels(self):
        self.assertEqual(self.fits("windows", "amd64"),
                         ["cffi-2.1.1-cp312-cp312-win_amd64.whl", "pycparser-3.12-py3-none-any.whl"])
        self.assertEqual(self.fits("linux", "amd64"),
                         ["cffi-2.1.1-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
                          "pycparser-3.12-py3-none-any.whl"])
        self.assertEqual(self.fits("linux", "arm64"),
                         ["cffi-2.1.1-cp312-cp312-manylinux2014_aarch64.manylinux_2_17_aarch64.whl",
                          "pycparser-3.12-py3-none-any.whl"])
        self.assertEqual(self.fits("macos", "arm64"),
                         ["cffi-2.1.1-cp312-cp312-macosx_11_0_arm64.whl",
                          "cryptography-50.0.2-cp311-abi3-macosx_10_9_universal2.whl",
                          "pycparser-3.12-py3-none-any.whl"])

    def test_a_newer_stable_abi_wheel_next_to_a_covering_one_is_left_out(self):
        # Release CI 2026-11-11: pip fetched cryptography cp315-abi3.abi3t beside cp311-abi3 for Python 3.15.
        names = ["cryptography-50.0.2-cp311-abi3-win_amd64.whl", "cryptography-50.0.2-cp315-abi3.abi3t-win_amd64.whl",
                 "pycparser-3.12-py3-none-any.whl"] + [f"cffi-2.1.1-{v}-{v}-win_amd64.whl" for v in host_bundle.PYTHON_VERSIONS]
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            for name in names:
                (folder / name).write_bytes(name.encode())
            with mock.patch.object(host_bundle, "offline_pins",
                                   return_value={"cryptography": "50.0.2", "cffi": "2.1.1", "pycparser": "3.12"}):
                chosen = host_bundle.offline_wheels(folder, "windows", "amd64")
        self.assertIn("cryptography-50.0.2-cp311-abi3-win_amd64.whl", chosen)
        self.assertNotIn("cryptography-50.0.2-cp315-abi3.abi3t-win_amd64.whl", chosen)
        self.assertEqual(len(chosen), 6)

    def test_versioned_images_follow_the_architecture(self):
        self.assertEqual(host_bundle.image_tags("v0.2.0", "arm64")[:2],
                         ("ghcr.io/fromthelake/mk8dx-api:v0.2.0-arm64", "ghcr.io/fromthelake/mk8dx-web:v0.2.0-arm64"))

    def test_every_package_carries_the_platform_layer_and_backup_scheduler(self):
        # scheduled_backup.schedule imports these on every route; a B1 package without them could not
        # switch on its nightly backup ("cannot import name 'auto_backup' from 'tooling'").
        import ast
        source = (Path(host_bundle.ROOT) / "tooling" / "scheduled_backup.py").read_text(encoding="utf-8")
        schedule = next(node for node in ast.walk(ast.parse(source))
                        if isinstance(node, ast.FunctionDef) and node.name == "schedule")
        needed = {f"tooling/{alias.name}.py" for node in ast.walk(schedule)
                  if isinstance(node, ast.ImportFrom) and node.module == "tooling" for alias in node.names}
        self.assertEqual(needed, {"tooling/auto_backup.py", "tooling/host_platform.py"})
        for name in needed:
            self.assertIn(name, host_bundle.FILES)
            self.assertNotIn(name, host_bundle.OFFLINE_FILES)  # listed once: the ZIP must not hold it twice
        # The web-hosting / XAMPP packages (B2, A3) schedule the same backup.
        import inspect
        staged = inspect.getsource(non_docker_bundle)
        for name in needed:
            self.assertIn(f'"{name}"', staged)
        self.assertIn('"tooling/windows_startup.py"', staged)


if __name__ == "__main__":
    unittest.main()
