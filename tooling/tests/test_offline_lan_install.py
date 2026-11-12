"""Focused offline installer isolation checks; no containers are started."""

import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from tooling import install
from tooling import offline_lan_ca_lifecycle


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
            # Fail-closed without the explicit QA candidate option (ADR-0223).
            for action in install.OFFLINE_GATED:
                with self.assertRaisesRegex(ValueError, "fail-closed"):
                    install.operate(state, action)
            with patch.object(install, "run_compose") as run_up, \
                    patch.object(install, "ensure_offline_firewall", return_value="present") as firewall:
                install.operate(state, "start", qa_offline_candidate=True)
                self.assertEqual(run_up.call_args_list[-1].args[1:],
                                 ("up", "-d", "--wait", "--no-build", "mysql", "api", "web", "host-admin"))
                firewall.assert_called_once()
                install.operate(state, "apply", qa_offline_candidate=True)
                self.assertEqual(run_up.call_args_list[-1].args[1:],
                                 ("up", "-d", "--no-build", "--force-recreate", "api", "web", "host-admin"))
                install.operate(state, "admin", qa_offline_candidate=True)
                self.assertIn("--bootstrap", run_up.call_args.args)
            addresses = install.offline_addresses(state)
            self.assertEqual(addresses["phoneSetup"], "http://192.168.50.20/setup")
            self.assertTrue(addresses["hostPage"].startswith("http://127.0.0.1:"))
            with patch.object(install, "run_compose") as run_host:
                install.operate(state, "host-unlock")
                self.assertIn("--bootstrap", run_host.call_args.args)
                install.operate(state, "host-unlock", user_account_id=
                                "user_account.12345678-1234-1234-1234-123456789abc")
                self.assertIn("--user-account-id", run_host.call_args.args)
            with self.assertRaisesRegex(ValueError, "canonical UserAccount"):
                install.operate(state, "host-unlock", user_account_id="user_account.other")
            with patch.object(install, "run_compose") as run_gateway:
                install.operate(state, "maintain-ca")
                run_gateway.assert_not_called()
            metadata_path = state / "offline-ca/metadata.json"
            metadata = json.loads(metadata_path.read_text())
            metadata["rotationDueAt"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
            metadata_path.write_text(json.dumps(metadata))
            signer_path = state / "offline-ca/serving/intermediate.pem"
            old_signer = signer_path.read_bytes()
            with patch.object(install, "run_compose") as run_gateway, \
                    patch.object(install, "leaf_storage") as leaf_storage, \
                    patch.object(install, "verify_rotated_leaf") as verify_leaf:
                install.operate(state, "maintain-ca")
                self.assertEqual([call.args[1:] for call in run_gateway.call_args_list],
                                 [("stop", "web"),
                                  ("up", "-d", "--wait", "--no-build", "--force-recreate", "web")])
                self.assertEqual([call.args[1] for call in leaf_storage.call_args_list],
                                 [install._LEAF_QUARANTINE, install._LEAF_CLEANUP])
                verify_leaf.assert_called_once()
            self.assertNotEqual(signer_path.read_bytes(), old_signer)
            metadata = json.loads(metadata_path.read_text())
            metadata["rotationDueAt"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
            metadata_path.write_text(json.dumps(metadata))
            new_signer = signer_path.read_bytes()
            with patch.object(offline_lan_ca_lifecycle, "rotate_intermediate", side_effect=ValueError("signer refused")), \
                    patch.object(install, "run_compose") as run_gateway, \
                    patch.object(install, "leaf_storage") as leaf_storage:
                with self.assertRaisesRegex(ValueError, "signer refused"):
                    install.operate(state, "maintain-ca")
                self.assertEqual([call.args[1:] for call in run_gateway.call_args_list],
                                 [("stop", "web"), ("stop", "web"),
                                  ("up", "-d", "--wait", "--no-build", "--force-recreate", "web")])
                self.assertEqual([call.args[1] for call in leaf_storage.call_args_list],
                                 [install._LEAF_RESTORE])
            self.assertEqual(signer_path.read_bytes(), new_signer)
            with patch.object(install, "run_compose") as run_gateway, \
                    patch.object(install, "leaf_storage") as leaf_storage, \
                    patch.object(install, "verify_rotated_leaf", side_effect=RuntimeError("wrong served chain")):
                with self.assertRaisesRegex(RuntimeError, "wrong served chain"):
                    install.operate(state, "maintain-ca", force_ca_rotation=True)
                self.assertEqual([call.args[1] for call in leaf_storage.call_args_list],
                                 [install._LEAF_QUARANTINE, install._LEAF_RESTORE])
                self.assertEqual([call.args[1:] for call in run_gateway.call_args_list],
                                 [("stop", "web"),
                                  ("up", "-d", "--wait", "--no-build", "--force-recreate", "web"),
                                  ("stop", "web"),
                                  ("up", "-d", "--wait", "--no-build", "--force-recreate", "web")])
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
