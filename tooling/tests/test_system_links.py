"""Private A2 paths refuse links, except the ones the operating system owns (macOS /var -> /private/var).

Found 2026-11-12 on GitHub's Intel Mac runner: every temporary folder there lives behind /var, so the CA tools
refused all of them. A link an ordinary user made is still refused, and Windows keeps no exception."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import install  # noqa: E402
import lifecycle  # noqa: E402


def fake(link: bool, uid: int):
    return SimpleNamespace(is_symlink=lambda: link, lstat=lambda: SimpleNamespace(st_uid=uid))


class SystemLinkTest(unittest.TestCase):
    def test_only_root_owned_links_outside_windows_count_as_system_links(self):
        for module in (install, lifecycle):
            with self.subTest(module.__name__), mock.patch.object(module.os, "name", "posix"):
                self.assertTrue(module.system_link(fake(True, 0)))
                self.assertFalse(module.system_link(fake(True, 501)))
                self.assertFalse(module.system_link(fake(False, 0)))
            with self.subTest(module.__name__ + " on Windows"), mock.patch.object(module.os, "name", "nt"):
                self.assertFalse(module.system_link(fake(True, 0)))

    @unittest.skipIf(os.name == "nt", "creating a symlink needs extra rights on Windows")
    def test_a_link_the_user_made_is_still_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            real = Path(folder).resolve() / "real"
            real.mkdir()
            link = Path(folder).resolve() / "link"
            link.symlink_to(real, target_is_directory=True)
            with self.assertRaises(ValueError):
                install.safe_state_dir(link / "state", existing=False)
            with self.assertRaises(RuntimeError):
                lifecycle.safe_path(link / "state")

    @unittest.skipIf(os.name == "nt", "Windows has no system links in its temporary folder")
    def test_the_temporary_folder_is_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(install.safe_state_dir(Path(folder) / "state", existing=False).name, "state")


if __name__ == "__main__":
    unittest.main()
