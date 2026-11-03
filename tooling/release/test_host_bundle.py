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


if __name__ == "__main__":
    unittest.main()
