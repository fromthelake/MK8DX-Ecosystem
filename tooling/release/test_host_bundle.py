"""Check that a release ZIP will start the images it actually contains."""

import unittest

from tooling.release import host_bundle


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
            self.assertEqual(host_bundle.package_bytes(name, images),
                             (host_bundle.ROOT / name).read_bytes())

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

    def test_versioned_images_follow_the_architecture(self):
        self.assertEqual(host_bundle.image_tags("v0.2.0", "arm64")[:2],
                         ("ghcr.io/fromthelake/mk8dx-api:v0.2.0-arm64", "ghcr.io/fromthelake/mk8dx-web:v0.2.0-arm64"))

    def test_offline_package_carries_the_platform_layer(self):
        self.assertIn("tooling/host_platform.py", host_bundle.OFFLINE_FILES)


if __name__ == "__main__":
    unittest.main()
