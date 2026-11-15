"""A new recovery code on request: MK8DX beheer (A2) and `install.py backup-new-code` (every route).

The new code replaces the stored one in one atomic step, in the platform's own protection (Windows DPAPI,
systemd-creds or an owner-only file on Linux, the Keychain on macOS); backups made before keep their old
code and are not re-encrypted."""

import contextlib
import io
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling import auto_backup, host_platform
from tooling import scheduled_backup as sb

CODE = r"^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$"


def answer(code=0, stdout=b""):
    return types.SimpleNamespace(returncode=code, stdout=stdout, stderr=b"")


def fake_ca():
    """offline_lan_ca's protect_root/unprotect_root/_restrict, without cryptography or DPAPI."""
    return types.SimpleNamespace(protect_root=lambda data: b"P" + data, unprotect_root=lambda blob: blob[1:],
                                 _restrict=lambda *a, **k: None)


class ReplaceSecretFileTest(unittest.TestCase):
    def test_new_secret_replaces_the_old_in_one_step_owner_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "secret"
            target.write_bytes(host_platform.FILE_MARKER + b"old")
            with patch.object(host_platform.shutil, "which", return_value=None):
                host_platform.replace_secret_file(
                    target, b"new", protect_with=lambda data: host_platform.protect(data, platform="linux"))
            self.assertEqual(host_platform.unprotect(target.read_bytes()), b"new")
            self.assertEqual(sorted(p.name for p in Path(temporary).iterdir()), ["secret"])
            if os.name == "posix":
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_a_failed_protection_keeps_the_old_secret(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "secret"
            target.write_bytes(b"old-blob")

            def refuse(data):
                raise RuntimeError("Keychain refused")
            with self.assertRaises(RuntimeError):
                host_platform.replace_secret_file(target, b"new", protect_with=refuse)
            self.assertEqual(target.read_bytes(), b"old-blob")
            self.assertEqual(sorted(p.name for p in Path(temporary).iterdir()), ["secret"])

    def test_macos_removes_the_old_keychain_item_after_the_switch(self):
        stored, calls = {}, []

        def run(command, input_bytes=None, timeout=60):
            calls.append(command)
            account = command[command.index("-a") + 1]
            if command[1] == "add-generic-password":
                stored[account] = command[command.index("-w") + 1]
                return answer()
            if command[1] == "delete-generic-password":
                stored.pop(account, None)
                return answer()
            return answer(stdout=stored[account].encode() + b"\n")
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(host_platform, "_run", side_effect=run), \
                patch.object(host_platform.sys, "platform", "darwin"):
            target = Path(temporary) / "secret"
            old = host_platform.protect(b"old", platform="darwin")
            target.write_bytes(old)
            host_platform.replace_secret_file(target, b"new",
                                              protect_with=lambda data: host_platform.protect(data, platform="darwin"))
            self.assertEqual(host_platform.unprotect(target.read_bytes()), b"new")
        old_account = old[len(host_platform.KEYCHAIN_MARKER):].decode()
        self.assertNotIn(old_account, stored)  # the old code is gone from the Keychain too
        self.assertEqual(len(stored), 1)
        self.assertIn(["security", "delete-generic-password", "-s", host_platform.KEYCHAIN_SERVICE, "-a", old_account],
                      calls)

    def test_forget_refuses_a_tampered_reference_and_ignores_file_secrets(self):
        with patch.object(host_platform, "_run") as run:
            host_platform.forget(host_platform.FILE_MARKER + b"x")
            host_platform.forget(host_platform.SYSTEMD_MARKER + b"x")
            run.assert_not_called()
            with self.assertRaises(RuntimeError):
                host_platform.forget(host_platform.KEYCHAIN_MARKER + b"secret-x; rm -rf ~")


class A2RotationTest(unittest.TestCase):
    def test_new_code_replaces_the_stored_one_and_is_returned_once(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(sys.modules, {"tooling.offline_lan_ca": fake_ca()}):
            state = Path(temporary)
            with self.assertRaisesRegex(ValueError, "no recovery code yet"):
                auto_backup.rotate_recovery_code(state)
            auto_backup.store_recovery_code(state, "AAAA-BBBB-CCCC-DDDD-EEEE")
            new = auto_backup.rotate_recovery_code(state)
            self.assertRegex(new, CODE)
            self.assertNotEqual(new, "AAAA-BBBB-CCCC-DDDD-EEEE")
            self.assertEqual(auto_backup.read_recovery_code(state), new)
            self.assertNotEqual(auto_backup.rotate_recovery_code(state), new)  # every request is a new code

    @unittest.skipUnless(sys.platform == "win32", "Windows DPAPI")
    def test_windows_keeps_the_new_code_in_dpapi(self):
        try:
            from tooling import offline_lan_ca
        except ImportError:
            self.skipTest("offline_lan_ca needs cryptography (the package's python-offline has it)")
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            auto_backup.store_recovery_code(state, "AAAA-BBBB-CCCC-DDDD-EEEE")
            new = auto_backup.rotate_recovery_code(state)
            blob = (state / auto_backup.PHRASE_FILE).read_bytes()
            self.assertNotIn(new.encode(), blob)
            self.assertEqual(offline_lan_ca.unprotect_root(blob).decode(), new)

    @unittest.skipUnless(sys.platform.startswith("linux"), "Linux protection")
    def test_linux_keeps_the_new_code_in_the_platform_protection(self):
        try:
            import tooling.offline_lan_ca  # noqa: F401
        except ImportError:
            self.skipTest("offline_lan_ca needs cryptography")
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            auto_backup.store_recovery_code(state, "AAAA-BBBB-CCCC-DDDD-EEEE")
            new = auto_backup.rotate_recovery_code(state)
            path = state / auto_backup.PHRASE_FILE
            self.assertIn(host_platform.protection_kind(path.read_bytes()), ("file-permissions", "systemd-creds"))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(auto_backup.read_recovery_code(state), new)

    def test_command_line_shows_the_code_once_with_the_old_backup_warning(self):
        printed = io.StringIO()
        with patch.object(auto_backup, "rotate_recovery_code", return_value="AAAA-BBBB-CCCC-DDDD-EEEE"), \
                contextlib.redirect_stdout(printed):
            self.assertEqual(auto_backup.main(["new-code", "--state-dir", "."]), 0)
        self.assertIn("AAAA-BBBB-CCCC-DDDD-EEEE", printed.getvalue())
        self.assertIn("old code", printed.getvalue())


def installation(folder: Path, route: str) -> Path:
    folder.mkdir(parents=True)
    (folder / "operator-profile.json").write_text(json.dumps({"route": route, "project": "mk8dx-os-0123456789"}),
                                                  encoding="utf-8")
    return folder


class ScheduledRotationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.modules = patch.dict(sys.modules, {"tooling.offline_lan_ca": fake_ca()})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.which = patch.object(host_platform.shutil, "which", return_value=None)  # no systemd-creds here
        self.which.start()
        self.addCleanup(self.which.stop)

    def test_encrypted_backups_get_a_new_code_and_unencrypted_ones_are_refused(self):
        state = installation(Path(self.temporary.name) / "b1", "B1")
        with self.assertRaisesRegex(sb.BackupError, "not encrypted"):
            sb.rotate_recovery_code(state)
        old = sb.create_recovery_code(state)
        new = sb.rotate_recovery_code(state)
        self.assertRegex(new, CODE)
        self.assertNotEqual(new, old)
        self.assertEqual(sb.read_recovery_code(state), new)
        self.assertEqual(sorted(p.name for p in state.iterdir()), [sb.CODE_FILE, "operator-profile.json"])

    def test_install_command_picks_the_store_of_the_route(self):
        b1 = installation(Path(self.temporary.name) / "b1", "B1")
        sb.create_recovery_code(b1)
        a2 = installation(Path(self.temporary.name) / "a2", "A2_OFFLINE")
        auto_backup.store_recovery_code(a2, "AAAA-BBBB-CCCC-DDDD-EEEE")
        for state, read in ((b1, sb.read_recovery_code), (a2, auto_backup.read_recovery_code)):
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed):
                self.assertEqual(sb.command("backup-new-code", types.SimpleNamespace(state_dir=state)), sb.EXIT_OK)
            self.assertIn(read(state), printed.getvalue())
            self.assertIn("old code", printed.getvalue())
        empty = installation(Path(self.temporary.name) / "a2-new", "A2_OFFLINE")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(sb.command("backup-new-code", types.SimpleNamespace(state_dir=empty)), sb.EXIT_FAILED)

    def test_old_backups_keep_the_old_code_new_backups_use_the_new_one(self):
        try:
            import cryptography  # noqa: F401
            from tooling import offline_lan_ca_lifecycle  # noqa: F401
        except ImportError:
            self.skipTest("sealing needs cryptography")
        state = installation(Path(self.temporary.name) / "b1", "B1")
        old = sb.create_recovery_code(state)
        plain = Path(self.temporary.name) / "plain"
        plain.mkdir()
        (plain / "database.sql").write_text("CREATE TABLE t (id INT);\n", encoding="utf-8")
        before = Path(self.temporary.name) / "before"
        sb.seal(plain, before, sb.read_recovery_code(state), "B1", "p")
        new = sb.rotate_recovery_code(state)
        after = Path(self.temporary.name) / "after"
        sb.seal(plain, after, sb.read_recovery_code(state), "B1", "p")
        self.assertTrue(sb._unseal(before, old))
        self.assertTrue(sb._unseal(after, new))
        for folder, wrong in ((before, new), (after, old)):
            with self.assertRaisesRegex(sb.BackupError, "does not open"):
                sb._unseal(folder, wrong)


if __name__ == "__main__":
    unittest.main()
