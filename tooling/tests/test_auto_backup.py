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

    @unittest.skipUnless(sys.platform == "win32", "Windows task scheduler")
    def test_tasks_run_for_the_current_user_without_elevation(self):
        with tempfile.TemporaryDirectory() as temporary:
            calls = []
            with patch.object(auto_backup.subprocess, "run",
                              side_effect=lambda args, **k: calls.append(args) or types.SimpleNamespace(returncode=0)):
                self.assertTrue(auto_backup.register_ca_renewal(Path(temporary), "py.exe"))
                self.assertTrue(auto_backup.register_daily_task(Path(temporary), "py.exe"))
            for args in calls:
                self.assertEqual(args[:2], ["schtasks", "/Create"])
                self.assertNotIn("/RU", args)  # current user: no stored password, no elevation
                self.assertNotIn("/RL", args)
            self.assertIn("maintain-ca", calls[0][-1])
            self.assertIn("auto_backup.py", calls[1][-1])

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
                written = auto_backup.run(state, root)
            self.assertEqual(seen["secret"], "CODE-CODE-CODE-CODE-CODE")
            self.assertFalse(any(p.name.endswith(".tmp") for p in state.iterdir()))
            remaining = sorted(p.name for p in root.iterdir())
            self.assertEqual(len(remaining), auto_backup.KEEP)
            self.assertIn(written.name, remaining)
            self.assertTrue(all(re.match(r"\d{8}-\d{6}", name) for name in remaining))


if __name__ == "__main__":
    unittest.main()


class _FakeRunKey:
    def __init__(self, values):
        self.values = values

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_winreg(values):
    def query(key, name):
        if name not in key.values:
            raise FileNotFoundError(name)
        return key.values[name], 1

    def set_value(key, name, _reserved, _type, value):
        key.values[name] = value

    return types.SimpleNamespace(HKEY_CURRENT_USER=0, KEY_READ=1, KEY_SET_VALUE=2, REG_SZ=1,
                                 OpenKey=lambda *a: _FakeRunKey(values), QueryValueEx=query, SetValueEx=set_value)


class DockerAutostartTest(unittest.TestCase):
    def test_an_existing_sign_in_entry_is_enough_wherever_docker_lives(self):
        values = {"Docker Desktop": r"D:\elsewhere\Docker Desktop.exe"}
        with patch.object(sys, "platform", "win32"), patch.dict(sys.modules, {"winreg": _fake_winreg(values)}):
            self.assertEqual(auto_backup.ensure_docker_autostart(), "present")

    def test_a_per_user_docker_desktop_is_found(self):
        with tempfile.TemporaryDirectory() as temporary:
            exe = Path(temporary) / "Programs" / "DockerDesktop" / "Docker Desktop.exe"
            exe.parent.mkdir(parents=True)
            exe.write_bytes(b"")
            values = {}
            with patch.object(sys, "platform", "win32"), patch.dict(sys.modules, {"winreg": _fake_winreg(values)}), \
                    patch.dict("os.environ", {"LOCALAPPDATA": temporary, "ProgramFiles": str(Path(temporary) / "none")}):
                self.assertEqual(auto_backup.ensure_docker_autostart(), "enabled")
            self.assertEqual(values["Docker Desktop"], f'"{exe}"')
