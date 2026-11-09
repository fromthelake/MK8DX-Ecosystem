"""Focused offline installer isolation checks; no containers are started."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling import install


ROOT = Path(__file__).resolve().parents[2]


class OfflineLanInstallTest(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "win32", "Windows DPAPI host")
    def test_optional_mode_creates_consistent_private_ca_and_compose_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "offline installation"
            result = subprocess.run([sys.executable, str(ROOT / "tooling/install.py"), "init",
                                     "--state-dir", str(state), "--mode", "offline-lan",
                                     "--lan-bind-address", "192.168.50.20"],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            profile = json.loads((state / "operator-profile.json").read_text())
            self.assertEqual(profile["route"], "A2_OFFLINE")
            self.assertIsNone(profile["adminEmail"])
            self.assertEqual(profile["origin"], "https://192.168.50.20")
            self.assertEqual(json.loads((state / "public-client.json").read_text()),
                             {"schemaVersion": "mk8dx.public-client.v1",
                              "websiteOrigin": "https://192.168.50.20",
                              "authenticationMode": "offline-invitation"})
            self.assertEqual(profile["rootCertificateSha256"],
                             json.loads((state / "offline-ca/metadata.json").read_text())
                             ["root"]["certificateSha256"])
            runtime = install.read_dotenv(state / "api.env")
            compose = install.read_dotenv(state / "compose.env")
            self.assertEqual(runtime["MK8DX_OFFLINE_LAN"], "true")
            self.assertEqual(runtime["MK8DX_HOSTED_SMTP_HOST"], "")
            self.assertEqual(compose["MK8DX_LAN_IP"], "192.168.50.20")
            self.assertGreater(int(compose["MK8DX_OFFLINE_HOST_PORT"]), 0)
            self.assertEqual(compose["MK8DX_OFFLINE_ROOT_CERT_SHA256"],
                             profile["rootCertificateSha256"])
            self.assertEqual(len(compose["MK8DX_OFFLINE_ROOT_SPKI_SHA256"]), 64)
            self.assertIn("compose.offline-lan.yaml", " ".join(install.compose_command(state)))
            config = subprocess.run(install.compose_command(state) + ["config", "--quiet"],
                                    cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(config.returncode, 0, config.stderr)
            install.status(state)
            with patch("subprocess.run") as run:
                install.run_compose(state, "up", "-d", "--no-build", "web")
                self.assertIn(["up", "--pull", "never", "-d", "--no-build", "web"],
                              [run.call_args.args[0][-6:]])
            with self.assertRaisesRegex(ValueError, "require CA signer"):
                install.change_origin(state, "https://192.168.50.21")
            with self.assertRaisesRegex(ValueError, "applies only to A2"):
                install.change_lan_address(state, "192.168.50.21")
            with self.assertRaisesRegex(ValueError, "waits for the local invitation runtime"):
                install.operate(state, "start")
            with patch.object(install, "run_compose") as run_host:
                install.operate(state, "host-unlock")
                self.assertIn("--bootstrap", run_host.call_args.args)
                install.operate(state, "host-unlock", user_account_id=
                                "user_account.12345678-1234-1234-1234-123456789abc")
                self.assertIn("--user-account-id", run_host.call_args.args)
            with self.assertRaisesRegex(ValueError, "canonical UserAccount"):
                install.operate(state, "host-unlock", user_account_id="user_account.other")
            self.assertEqual(profile, json.loads((state / "operator-profile.json").read_text()))

    def test_invalid_offline_ip_fails_before_creating_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "invalid"
            result = subprocess.run([sys.executable, str(ROOT / "tooling/install.py"), "init",
                                     "--state-dir", str(state), "--mode", "offline-lan",
                                     "--lan-bind-address", "8.8.8.8"],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(state.exists())


if __name__ == "__main__":
    unittest.main()
