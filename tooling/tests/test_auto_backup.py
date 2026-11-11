"""Automatic backups: one-time recovery code, temporary secret cleanup, retention."""

import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling import auto_backup


class AutoBackupTest(unittest.TestCase):
    def test_recovery_code_shape(self):
        code = auto_backup.new_recovery_code()
        self.assertRegex(code, r"^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$")
        self.assertNotEqual(code, auto_backup.new_recovery_code())

    def test_code_is_created_once_and_task_registered(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            fake = types.SimpleNamespace(protect_root=lambda b: b"P" + b, unprotect_root=lambda b: b[1:],
                                         _restrict=lambda *a, **k: None)
            with patch.dict(sys.modules, {"tooling.offline_lan_ca": fake}), \
                    patch.object(auto_backup, "register_daily_task", return_value=True) as task:
                first = auto_backup.enable(state, "python.exe")
                second = auto_backup.enable(state, "python.exe")
                self.assertRegex(first["recoveryCode"], r"^[A-Z2-9-]{24}$")
                self.assertIsNone(second["recoveryCode"])
                self.assertEqual(task.call_count, 2)
                self.assertEqual(auto_backup.read_recovery_code(state), first["recoveryCode"])

    def _registered(self, call):
        with tempfile.TemporaryDirectory() as temporary:
            calls = []
            with patch.object(auto_backup.sys, "platform", "win32"), \
                    patch.object(auto_backup.subprocess, "run",
                                 side_effect=lambda args, **k: calls.append(args) or types.SimpleNamespace(returncode=0)):
                result = call(Path(temporary))
            return result, calls

    def test_tasks_run_for_the_current_user_and_catch_up(self):
        for call, name, needle in (
                (lambda s: auto_backup.register_ca_renewal(s, "py.exe"), "MK8DX certificate renewal", "maintain-ca"),
                (lambda s: auto_backup.register_daily_task(s, "py.exe"), "MK8DX backup", "auto_backup.py")):
            result, calls = self._registered(call)
            self.assertTrue(result)
            self.assertEqual(len(calls), 1)
            script = calls[0][-1]
            self.assertEqual(calls[0][:4], ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command"])
            self.assertIn(f"-TaskName '{name}'", script)
            self.assertIn(needle, script)
            # Missed nights (computer off, nobody signed in, on battery) still run afterwards.
            for setting in ("-StartWhenAvailable", "-AllowStartIfOnBatteries", "-DontStopIfGoingOnBatteries",
                            "-LogonType Interactive", "-RunLevel Limited", "-Daily"):
                self.assertIn(setting, script)
            self.assertNotIn("-Password", script)  # current user: no stored password, no elevation

    def test_task_time_is_validated(self):
        with self.assertRaises(ValueError):
            auto_backup.register_daily_task(Path("."), "py.exe", when="3am; Remove-Item x")

    def test_quotes_survive_paths_with_apostrophes(self):
        self.assertEqual(auto_backup._quote("C:\\Users\\O'Neil"), "'C:\\Users\\O''Neil'")

    def test_backup_waits_for_docker_and_gives_up_cleanly(self):
        with patch.object(auto_backup, "wait_for_docker", return_value=False):
            with tempfile.TemporaryDirectory() as temporary:
                with self.assertRaisesRegex(RuntimeError, "Docker is not running"):
                    auto_backup.run(Path(temporary), Path(temporary) / "backups")
        answers = iter([1, 1, 0])
        with patch.object(auto_backup.subprocess, "run",
                          side_effect=lambda *a, **k: types.SimpleNamespace(returncode=next(answers))), \
                patch.object(auto_backup.time, "sleep"):
            self.assertTrue(auto_backup.wait_for_docker(timeout_s=60, poll_s=0))

    def test_run_removes_temporary_secret_and_keeps_seven(self):
        with tempfile.TemporaryDirectory() as temporary:
            state, root = Path(temporary) / "state", Path(temporary) / "backups"
            state.mkdir()
            root.mkdir()
            for day in range(1, 10):
                (root / f"2026110{day}-030000").mkdir()
            seen = {}

            def fake_backup(state_dir, output, secret_file):
                seen["secret"] = Path(secret_file).read_text(encoding="utf-8")
                output.mkdir()

            fake_ca = types.SimpleNamespace(unprotect_root=lambda b: b"CODE-CODE-CODE-CODE-CODE",
                                            _restrict=lambda *a, **k: None)
            (state / auto_backup.PHRASE_FILE).write_bytes(b"x")
            with patch.dict(sys.modules, {"tooling.offline_lan_ca": fake_ca,
                                          "lifecycle": types.SimpleNamespace(backup=fake_backup)}):
                with patch.object(auto_backup, "wait_for_docker", return_value=True):
                    written = auto_backup.run(state, root)
            self.assertEqual(seen["secret"], "CODE-CODE-CODE-CODE-CODE")
            self.assertFalse(any(p.name.endswith(".tmp") for p in state.iterdir()))
            remaining = sorted(p.name for p in root.iterdir())
            self.assertEqual(len(remaining), auto_backup.KEEP)
            self.assertIn(written.name, remaining)
            self.assertTrue(all(re.match(r"\d{8}-\d{6}", name) for name in remaining))


if __name__ == "__main__":
    unittest.main()


class DockerAutostartTest(unittest.TestCase):
    def test_own_sign_in_task_starts_docker_desktop_only_when_needed(self):
        with tempfile.TemporaryDirectory() as temporary:
            exe = Path(temporary) / "Programs" / "DockerDesktop" / "Docker Desktop.exe"
            exe.parent.mkdir(parents=True)
            exe.write_bytes(b"")
            calls = []
            with patch.object(auto_backup.sys, "platform", "win32"), \
                    patch.dict("os.environ", {"LOCALAPPDATA": temporary, "ProgramFiles": str(Path(temporary) / "none")}), \
                    patch.object(auto_backup.subprocess, "run",
                                 side_effect=lambda args, **k: calls.append(args) or types.SimpleNamespace(returncode=0)):
                self.assertEqual(auto_backup.ensure_docker_autostart(), "enabled")
            script = calls[0][-1]
            self.assertIn("-TaskName 'MK8DX start'", script)
            self.assertIn("-AtLogOn -User $who", script)
            self.assertIn("Get-Process -Name ''Docker Desktop''", script)
            self.assertIn(str(exe).replace("'", "''"), script)

    def test_missing_docker_desktop_is_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(auto_backup.sys, "platform", "win32"), \
                    patch.dict("os.environ", {"LOCALAPPDATA": temporary, "ProgramFiles": temporary}):
                self.assertEqual(auto_backup.ensure_docker_autostart(), "docker-desktop-not-found")
