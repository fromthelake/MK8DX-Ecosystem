"""Focused operator and device-configuration regression checks with synthetic data."""
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "apps/timetrials-desktop"))
sys.path.insert(0, str(ROOT / "packages/tournament-connected/python/src"))
from tooling import install
from livetrial_settings import read_server_origin, server_data_root, write_server_origin
from mk8dx_tournament_connected import server as tournament_server


class OperatorProfileTest(unittest.TestCase):
    def test_private_path_and_tls_port_fail_before_state_creation(self):
        with self.assertRaises(ValueError):
            install.safe_state_dir(ROOT / "accidental-private-install", existing=False)
        with tempfile.TemporaryDirectory(prefix="mk8dx guarded setup ") as temp:
            state = Path(temp) / "new state"
            password = Path(temp) / "smtp.txt"
            password.write_text("synthetic", encoding="utf-8")
            result = subprocess.run([sys.executable, str(ROOT / "tooling/install.py"), "init", "--state-dir", str(state),
                                     "--mode", "production", "--domain", "example.invalid", "--smtp-host", "mail.example.invalid",
                                     "--smtp-port", "587", "--smtp-user", "operator", "--smtp-from", "noreply@example.invalid",
                                     "--smtp-password-file", str(password), "--admin-email", "owner@example.invalid"],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(state.exists())

    @unittest.skipUnless(os.name == "posix", "Linux/macOS file permissions")
    def test_operator_file_is_readable_by_the_container_user_inside_a_private_directory(self):
        # The API image runs operator commands as uid 10001 and reads operator.json through a bind mount.
        with tempfile.TemporaryDirectory(prefix="mk8dx posix modes ") as temp:
            state = Path(temp) / "private state"
            subprocess.run([sys.executable, str(ROOT / "tooling/install.py"), "init", "--state-dir", str(state),
                            "--mode", "local"], check=True, capture_output=True)
            mode = lambda name: stat.S_IMODE((state / name).stat().st_mode)
            self.assertEqual(stat.S_IMODE(state.stat().st_mode), 0o700)
            self.assertEqual(mode("operator.json"), 0o644)
            for name in ("api.env", "compose.env", "secrets.json", "operator-profile.json"):
                self.assertEqual(mode(name), 0o600, name)
            os.chmod(state / "operator.json", 0o600)
            install.compose_command(state)
            self.assertEqual(mode("operator.json"), 0o644)
            os.chmod(state, 0o755)
            os.chmod(state / "operator.json", 0o600)
            install.compose_command(state)
            self.assertEqual(mode("operator.json"), 0o600, "never widened outside a private directory")

    def test_one_origin_special_secret_repeat_and_rejection(self):
        with tempfile.TemporaryDirectory(prefix="mk8dx install path with spaces ") as temp:
            state = Path(temp) / "private state"
            password = Path(temp) / "smtp.txt"
            password.write_text("synthetic'$#é", encoding="utf-8")
            subprocess.run([sys.executable, str(ROOT / "tooling/install.py"), "init", "--state-dir", str(state),
                            "--mode", "production", "--domain", "example.invalid", "--smtp-host", "mail.example.invalid",
                            "--smtp-user", "mailbox@example.invalid", "--smtp-from", "noreply@example.invalid",
                            "--smtp-password-file", str(password), "--admin-email", "owner@example.invalid"],
                           check=True, capture_output=True)
            before = json.loads((state / "secrets.json").read_text())
            public = json.loads((state / "public-client.json").read_text())
            self.assertEqual(public, {"schemaVersion": "mk8dx.public-client.v1", "websiteOrigin": "https://example.invalid"})
            self.assertNotIn("synthetic", (state / "api.env").read_text())
            self.assertNotIn("owner@example.invalid", (state / "public-client.json").read_text())
            install.status(state)
            install.change_origin(state, "https://new.example.invalid")
            install.status(state)
            self.assertEqual(json.loads((state / "secrets.json").read_text()), before)
            self.assertEqual(install.read_dotenv(state / "compose.env")["MK8DX_DOMAIN"], "new.example.invalid")
            current = (state / "operator-profile.json").read_bytes()
            with self.assertRaises(ValueError):
                install.change_origin(state, "http://evil.example.invalid")
            self.assertEqual((state / "operator-profile.json").read_bytes(), current)
            with patch("builtins.input", side_effect=["", "", "", ""]), patch("getpass.getpass", return_value="new'$#pass"):
                install.change_smtp(state)
            install.status(state)
            self.assertEqual(json.loads((state / "secrets.json").read_text())["MK8DX_HOSTED_SMTP_PASSWORD"], "new'$#pass")
            self.assertEqual(json.loads((state / "operator-profile.json").read_text())["project"],
                             install.read_dotenv(state / "compose.env")["MK8DX_PROJECT_NAME"])
            runtime = install.read_dotenv(state / "api.env")
            runtime["MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_BASE64"] = install.key()
            (state / "api.env").write_text("".join(install.dotenv(runtime)), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "secrets or generated runtime disagree"):
                install.status(state)

    def test_device_server_data_is_separate_and_remembered(self):
        with tempfile.TemporaryDirectory(prefix="mk8dx clients ") as temp:
            root = Path(temp) / "live"
            write_server_origin(root, "https://one.example.org")
            one = read_server_origin(root)
            write_server_origin(root, "https://two.example.org")
            two = read_server_origin(root)
            self.assertNotEqual(server_data_root(root, one), server_data_root(root, two))
            with patch.dict(os.environ, {"LOCALAPPDATA": temp}):
                tournament_server.save_origin("https://one.example.org")
                first = tournament_server.server_data_dir()
                tournament_server.save_origin("https://two.example.org")
                self.assertNotEqual(first, tournament_server.server_data_dir())
                self.assertEqual(tournament_server.selected_origin(), "https://two.example.org")


if __name__ == "__main__":
    unittest.main()
