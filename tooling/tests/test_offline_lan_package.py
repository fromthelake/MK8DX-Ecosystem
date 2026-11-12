"""A2 offline installer firewall step and package wheel selection; no containers or elevation."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling import install

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling" / "release"))
import host_bundle  # noqa: E402


def state_with_profile(folder: Path) -> Path:
    (folder / install.PROFILE).write_text(json.dumps({"route": "A2_OFFLINE", "bindAddress": "192.168.50.20",
                                                      "project": "mk8dx-os-test", "origin": "https://192.168.50.20"}))
    return folder


def ps(stdout="", code=0):
    return subprocess.CompletedProcess([], code, stdout, "")


@unittest.skipUnless(sys.platform == "win32", "Windows firewall step")
class OfflineFirewallTest(unittest.TestCase):
    def test_public_network_is_refused_before_any_rule(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = state_with_profile(Path(temporary))
            with patch.object(install, "_powershell", side_effect=[ps("Public|False")]) as run:
                with self.assertRaisesRegex(ValueError, "not Private"):
                    install.ensure_offline_firewall(state)
                self.assertEqual(run.call_count, 1)

    def test_existing_rule_is_kept_and_missing_rule_is_created_elevated(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = state_with_profile(Path(temporary))
            with patch.object(install, "_powershell", side_effect=[ps("Private|True")]):
                self.assertEqual(install.ensure_offline_firewall(state), "present")
            with patch.object(install, "_powershell", side_effect=[ps("Private|False"), ps()]) as run:
                self.assertEqual(install.ensure_offline_firewall(state), "created")
                rule = run.call_args_list[1]
                self.assertTrue(rule.kwargs["elevated"])
                self.assertIn("-Profile Private", rule.args[0])
                self.assertIn("-LocalPort 80,443", rule.args[0])
                self.assertIn("-LocalAddress '192.168.50.20'", rule.args[0])

    def test_declined_permission_and_missing_address_are_explained(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = state_with_profile(Path(temporary))
            with patch.object(install, "_powershell", side_effect=[ps("Private|False"), ps(code=1)]):
                with self.assertRaisesRegex(ValueError, "permission prompt was declined"):
                    install.ensure_offline_firewall(state)
            with patch.object(install, "_powershell", side_effect=[ps(code=1)]):
                with self.assertRaisesRegex(ValueError, "not active on this computer"):
                    install.ensure_offline_firewall(state)


CFFI = [f"cffi-2.1.1-cp{v}-cp{v}-win_amd64.whl" for v in (312, 313, 314, 315)]


class OfflineWheelSelectionTest(unittest.TestCase):
    def wheels(self, folder: Path, names):
        for name in names:
            (folder / name).write_bytes(name.encode())

    def test_exact_pinned_windows_wheels_are_selected(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            self.wheels(folder, ["cryptography-50.0.2-cp311-abi3-win_amd64.whl", *CFFI,
                                 "pycparser-3.12-py3-none-any.whl"])
            selected = host_bundle.offline_wheels(folder)
            self.assertEqual(len(selected), 6)
            self.assertTrue(all(len(digest) == 64 for digest in selected.values()))

    def test_missing_wrong_platform_or_extra_wheels_fail(self):
        for names in ([*CFFI, "pycparser-3.12-py3-none-any.whl"],
                      ["cryptography-50.0.2-cp311-abi3-manylinux_2_28_x86_64.whl", *CFFI,
                       "pycparser-3.12-py3-none-any.whl"],
                      ["cryptography-50.0.2-cp311-abi3-win_amd64.whl", *CFFI,
                       "pycparser-3.12-py3-none-any.whl", "requests-2.0-py3-none-any.whl"],
                      # one supported Python version without its cffi wheel (the groep3 3.15 cold-run failure)
                      ["cryptography-50.0.2-cp311-abi3-win_amd64.whl", *CFFI[:3],
                       "pycparser-3.12-py3-none-any.whl"],
                      # an unsupported Python version's wheel is not silently packaged
                      ["cryptography-50.0.2-cp311-abi3-win_amd64.whl", *CFFI,
                       "cffi-2.1.1-cp311-cp311-win_amd64.whl", "pycparser-3.12-py3-none-any.whl"]):
            with tempfile.TemporaryDirectory() as temporary:
                self.wheels(Path(temporary), names)
                with self.assertRaises(SystemExit):
                    host_bundle.offline_wheels(Path(temporary))


if __name__ == "__main__":
    unittest.main()
