"""Automatic daily backups for A1, A2 (online), B1, A3 and B2: crontab line, retention, failure paths, sealing."""

import errno
import gzip
import hashlib
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from tooling import scheduled_backup as sb

DIRECTADMIN_LISTING = (
    "Backup of exampleuser's previous crontab saved to /home/exampleuser/.cron_backups/crontab.1731600000\n"
    "5c1c1a3b2f0d4e6a8b9c7d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a\n"
    "MAILTO=\"\"\n"
    "*/5 * * * * /usr/local/bin/php /home/exampleuser/domains/example.org/public_html/cron.php\n"
    "# a comment the owner wrote\n"
    "0 4 * * 1 /home/exampleuser/weekly.sh\n")


class FakeCrontab:
    """`crontab -l` / `crontab -` with DirectAdmin's extra lines on every listing."""

    def __init__(self, table=None, noisy=True):
        self.table = table
        self.noisy = noisy
        self.calls = []

    def __call__(self, command, input=None, **kwargs):
        self.calls.append(command)
        if command == ["crontab", "-l"]:
            if self.table is None:
                return types.SimpleNamespace(returncode=1, stdout="", stderr="no crontab for exampleuser\n")
            noise = ("Backup of exampleuser's previous crontab saved to /home/exampleuser/.cron_backups/x\n"
                     + "a" * 64 + "\n") if self.noisy else ""
            return types.SimpleNamespace(returncode=0, stdout=noise + self.table, stderr="")
        if command == ["crontab", "-"]:
            self.table = input
            return types.SimpleNamespace(returncode=0, stdout="", stderr="")
        raise AssertionError(command)


class CrontabTest(unittest.TestCase):
    def setUp(self):
        self.state = Path("/home/exampleuser/mk8dx-private")
        self.marker = sb.CRON_MARKER + sb.cron_id(self.state)
        self.line = "15 3 * * * cd /app && python3 tooling/install.py backup-run --quiet " + self.marker

    def test_directadmin_notice_and_hash_are_not_crontab_lines(self):
        lines = sb.crontab_lines(DIRECTADMIN_LISTING)
        self.assertEqual(lines, DIRECTADMIN_LISTING.splitlines()[2:])

    def test_install_keeps_every_other_line_and_adds_exactly_one(self):
        fake = FakeCrontab(DIRECTADMIN_LISTING.split("\n", 2)[2])
        original = sb.crontab_lines(fake.table)
        sb.set_cron(self.state, self.line, runner=fake)
        sb.set_cron(self.state, self.line, runner=fake)  # again: no duplicate, nothing rewritten
        lines = sb.crontab_lines(fake.table)
        self.assertEqual(lines[:-1], original)
        self.assertEqual(sum(line.endswith(self.marker) for line in lines), 1)
        self.assertEqual(fake.calls.count(["crontab", "-"]), 1)
        self.assertNotIn("Backup of", fake.table)
        self.assertNotIn("a" * 64, fake.table)

    def test_a_changed_line_replaces_the_old_one(self):
        fake = FakeCrontab("0 1 * * * other\n" + "1 2 * * * old " + self.marker + "\n")
        sb.set_cron(self.state, self.line, runner=fake)
        self.assertEqual(sb.crontab_lines(fake.table), ["0 1 * * * other", self.line])

    def test_remove_takes_only_the_marked_line(self):
        other_install = "15 3 * * * backup-run " + sb.CRON_MARKER + "0123456789ab"
        fake = FakeCrontab("0 1 * * * other\n" + self.line + "\n" + other_install + "\n")
        sb.set_cron(self.state, None, runner=fake)
        self.assertEqual(sb.crontab_lines(fake.table), ["0 1 * * * other", other_install])

    def test_empty_crontab_and_refusal(self):
        fake = FakeCrontab(None)
        sb.set_cron(self.state, self.line, runner=fake)
        self.assertEqual(sb.crontab_lines(fake.table), [self.line])
        broken = lambda command, input=None, **k: types.SimpleNamespace(returncode=1, stdout="", stderr="denied")
        with self.assertRaises(sb.BackupError):
            sb.set_cron(self.state, self.line, runner=broken)

    def test_cron_line_quotes_paths_and_refuses_percent(self):
        line = sb.cron_line(Path("/home/u/my data"), "03:15", "/usr/bin/python3", "/home/u/nodevenv/bin:/usr/bin")
        self.assertTrue(line.startswith("15 3 * * * cd "))
        self.assertIn("backup-run", line)
        self.assertIn("--quiet", line)
        self.assertTrue(line.endswith(sb.CRON_MARKER + sb.cron_id(Path("/home/u/my data"))))
        with self.assertRaises(sb.BackupError):
            sb.cron_line(Path("/home/u/50%"), "03:15", "/usr/bin/python3", "/usr/bin")

    def test_cron_line_leaves_out_wsl_windows_path_entries(self):
        # WSL appends the whole Windows PATH under /mnt/<drive>/: with it the line passed cron's
        # 1000-character limit and `crontab` refused the table ("command too long").
        windows = ":".join(f"/mnt/c/Program Files/Tool {n}/bin" for n in range(60))
        path_env = f"/usr/local/bin:/usr/bin:/bin:/usr/bin:relative/bin:{windows}:/mnt/data/bin:/mnt/d"
        self.assertEqual(sb.cron_path(path_env), "/usr/local/bin:/usr/bin:/bin:/mnt/data/bin")
        line = sb.cron_line(Path("/var/lib/mk8dx/instance"), "03:15", "/usr/bin/python3", path_env)
        self.assertIn("PATH=/usr/local/bin:/usr/bin:/bin:/mnt/data/bin ", line)
        self.assertLess(len(line), sb.CRON_LINE_MAX)
        with self.assertRaisesRegex(sb.BackupError, "more than cron accepts"):
            sb.cron_line(Path("/var/lib/mk8dx/instance"), "03:15", "/usr/bin/python3",
                         ":".join(f"/opt/tool-{n:03d}/bin" for n in range(80)))

    def test_scheduler_per_route(self):
        self.assertEqual(sb.choose_scheduler("A1", platform="win32"), "windows-task")
        self.assertEqual(sb.choose_scheduler("A3", platform="win32"), "windows-task")
        self.assertEqual(sb.choose_scheduler("B2", platform="linux"), "crontab")
        self.assertEqual(sb.choose_scheduler("B1", platform="linux"), "crontab")
        self.assertEqual(sb.choose_scheduler("A1", platform="darwin"), "launchd")


class RetentionTest(unittest.TestCase):
    def entries(self, count, size=1, hours=24):
        start = datetime(2026, 11, 15, 3, 15, tzinfo=timezone.utc)
        return [(f"b{i}", start - timedelta(hours=hours * i), size) for i in range(count)]

    def test_daily_then_weekly(self):
        kept = sb.select_keep(self.entries(60), 14, 4, 10 ** 9)
        self.assertEqual(len(kept), 18)
        self.assertTrue({f"b{i}" for i in range(14)} <= kept)
        older = sorted(int(name[1:]) for name in kept if int(name[1:]) >= 14)
        self.assertEqual(len(older), 4)
        self.assertTrue(all(b - a >= 5 for a, b in zip(older, older[1:])))  # one per ISO week

    def test_several_per_day_keep_the_newest_of_each_day(self):
        kept = sb.select_keep(self.entries(10, hours=6), 2, 0, 10 ** 9)
        self.assertIn("b0", kept)
        self.assertEqual(len(kept), 2)

    def test_size_bound_drops_oldest_but_never_the_newest(self):
        kept = sb.select_keep(self.entries(10, size=100), 14, 4, 350)
        self.assertEqual(kept, {"b0", "b1", "b2"})
        self.assertEqual(sb.select_keep(self.entries(3, size=1000), 14, 4, 10), {"b0"})
        self.assertEqual(sb.select_keep([], 14, 4, 10), set())


def write_installation(state: Path, route="A1"):
    state.mkdir(parents=True)
    (state / "operator-profile.json").write_text(json.dumps({"route": route, "project": "mk8dx-os-0123456789"}),
                                                 encoding="utf-8")


def fake_lifecycle_backup(state, output):
    """The v1 layout lifecycle.verify_backup checks: files, a gzip dump and their SHA-256 manifest."""
    output.mkdir(mode=0o700)
    for name in ("api.env", "operator.json", "compose.env"):
        (output / name).write_text(name + "\n", encoding="utf-8")
    with gzip.open(output / "database.sql.gz", "wb") as dump:
        dump.write(b"CREATE TABLE t (id INT);\n")
    files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in output.iterdir()}
    (output / "manifest.json").write_text(json.dumps({"schemaVersion": "mk8dx.local-backup.v1", "files": files}),
                                          encoding="utf-8")


class RunTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        base = Path(self.temporary.name)
        self.state = base / "state"
        self.root = base / "backups"
        write_installation(self.state)
        settings = {**sb.default_settings("A1"), "backupRoot": str(self.root)}
        sb.save_settings(self.state, settings)
        self.now = datetime(2026, 11, 15, 3, 15, tzinfo=timezone.utc)

    def tearDown(self):
        self.temporary.cleanup()

    def run_once(self, maker=fake_lifecycle_backup, now=None):
        with patch.object(sb, "make_backup", side_effect=lambda state, route, output: maker(state, output)), \
                patch.object(sb, "owner_only"):
            return sb.run(self.state, quiet=True, now=now or self.now)

    def finished(self):
        return [path.name for path, _ in sb.listed(self.root, "mk8dx-os-0123456789")]

    def test_success_verifies_records_and_keeps_owner_only(self):
        code, status = self.run_once()
        self.assertEqual(code, sb.EXIT_OK)
        self.assertEqual(self.finished(), ["mk8dx-os-0123456789-20261115-031500"])
        self.assertEqual(status["lastResult"], "ok")
        self.assertEqual(status["kept"], 1)
        self.assertEqual(len(status["latestBackupSha256"]), 64)
        recorded = json.loads((self.state / sb.STATUS).read_text(encoding="utf-8"))
        self.assertEqual(recorded["lastSuccessUtc"], self.now.isoformat())
        if os.name == "posix":
            self.assertEqual(os.stat(self.root / self.finished()[0] / "api.env").st_mode & 0o777, 0o600)
        self.assertFalse(any(p.name.startswith(".partial") for p in self.root.iterdir()))
        summary = sb.summary(self.state, now=self.now + timedelta(hours=5))
        self.assertEqual((summary["lastResult"], summary["lastSuccessAgeHours"], summary["stale"]), ("ok", 5.0, False))

    def test_failures_keep_older_backups_and_report(self):
        self.assertEqual(self.run_once()[0], sb.EXIT_OK)
        later = self.now + timedelta(days=1)

        def database_down(state, output):
            raise sb.BackupError(sb.EXIT_FAILED, "The MK8DX database is not running (start MK8DX)")

        def disk_full(state, output):
            output.mkdir()
            (output / "database.sql.gz").write_bytes(b"partial")
            raise OSError(errno.ENOSPC, "No space left on device")

        def corrupt(state, output):
            fake_lifecycle_backup(state, output)
            (output / "database.sql.gz").write_bytes(b"changed after the manifest")

        for maker, expected in ((database_down, sb.EXIT_FAILED), (disk_full, sb.EXIT_NO_SPACE),
                                (corrupt, sb.EXIT_VERIFY)):
            with self.subTest(maker.__name__):
                code, status = self.run_once(maker, later)
                self.assertEqual(code, expected)
                self.assertEqual(self.finished(), ["mk8dx-os-0123456789-20261115-031500"])
                self.assertFalse(any(p.name.startswith(".partial") for p in self.root.iterdir()))
                self.assertEqual(status["lastResult"], sb.RESULTS[expected])
                self.assertEqual(status["lastSuccessUtc"], self.now.isoformat())  # the older success stays known
                summary = sb.summary(self.state, now=later)
                self.assertEqual(summary["lastResult"], sb.RESULTS[expected])
                self.assertIn("lastMessage", summary)

    def test_too_little_free_space_and_busy(self):
        free = types.SimpleNamespace(total=1, used=1, free=1024)
        with patch.object(sb.shutil, "disk_usage", return_value=free):
            self.assertEqual(self.run_once()[0], sb.EXIT_NO_SPACE)
        self.assertEqual(self.finished(), [])
        (self.state / sb.LOCK).write_text("1\n", encoding="utf-8")
        self.assertEqual(self.run_once()[0], sb.EXIT_BUSY)
        (self.state / sb.LOCK).unlink()
        self.assertEqual(self.run_once()[0], sb.EXIT_OK)

    def test_retention_after_many_nights(self):
        for day in range(30):
            self.assertEqual(self.run_once(now=self.now + timedelta(days=day))[0], sb.EXIT_OK)
        names = self.finished()
        self.assertEqual(names[0], "mk8dx-os-0123456789-20261214-031500")  # the newest stays
        # 14 days, then the newest of each of the 4 ISO weeks before them (Nov 15-30 touches 4 weeks).
        self.assertEqual(len(names), 14 + 4)

    def test_copy_to_second_folder_and_copy_failure(self):
        copy = Path(self.temporary.name) / "nas"
        settings = sb.load_settings(self.state)
        settings["copyTo"] = str(copy)
        sb.save_settings(self.state, settings)
        code, status = self.run_once()
        self.assertEqual((code, status["copyResult"]), (sb.EXIT_OK, "ok"))
        self.assertEqual([p.name for p in copy.iterdir()], self.finished())
        with patch.object(sb, "_copy", side_effect=OSError("network path not found")):
            code, status = self.run_once(now=self.now + timedelta(days=1))
        self.assertEqual(code, sb.EXIT_COPY)
        self.assertEqual(len(self.finished()), 2)  # the local backup itself is fine

    def test_latest_prints_the_newest_that_verifies(self):
        self.run_once()
        self.run_once(now=self.now + timedelta(days=1))
        newest = self.root / self.finished()[0]
        self.assertEqual(sb.latest(self.state), newest)
        (newest / "api.env").write_text("tampered\n", encoding="utf-8")
        self.assertEqual(sb.latest(self.state).name, self.finished()[1])

    def test_sealed_backup_opens_only_with_its_code(self):
        settings = sb.load_settings(self.state)
        settings["encrypt"] = True
        sb.save_settings(self.state, settings)
        code_text = "ABCD-EFGH-JKLM-NPQR-STUV"
        with patch.object(sb, "read_recovery_code", return_value=code_text):
            code, status = self.run_once()
        self.assertEqual(code, sb.EXIT_OK, status)
        folder = self.root / self.finished()[0]
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ["backup.sealed", "manifest.json"])
        self.assertNotIn(b"CREATE TABLE", (folder / "backup.sealed").read_bytes())
        sb.verify_folder(folder, "A1")
        with self.assertRaises(sb.BackupError):
            sb.open_sealed(folder, "WRONG-CODE-WRONG-CODE-XXXX", Path(self.temporary.name) / "opened-wrong")
        with patch.object(sb, "owner_only"):
            opened = sb.open_sealed(folder, code_text, Path(self.temporary.name) / "opened")
        self.assertEqual(sorted(p.name for p in opened.iterdir()),
                         ["api.env", "compose.env", "database.sql.gz", "manifest.json", "operator.json"])

    def test_a2_offline_is_left_to_its_own_backup(self):
        state = Path(self.temporary.name) / "offline"
        write_installation(state, "A2_OFFLINE")
        self.assertEqual(sb.run(state, quiet=True)[0], sb.EXIT_NOT_APPLICABLE)

    def test_backup_folder_must_stay_private(self):
        for bad in (self.state / "inside", Path(self.temporary.name) / "domains" / "public_html" / "b",
                    sb.ROOT / "backups"):
            with self.subTest(str(bad)), self.assertRaises(sb.BackupError):
                sb.safe_root(bad, self.state)


class SchedulerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.state = Path(self.temporary.name) / "state"
        write_installation(self.state)

    def tearDown(self):
        self.temporary.cleanup()

    def test_windows_task_for_the_user_then_removed(self):
        calls = []
        result = types.SimpleNamespace(returncode=0, stdout="", stderr="")
        with patch.object(sb.sys, "platform", "win32"), \
                patch("tooling.auto_backup.sys.platform", "win32"), \
                patch("tooling.auto_backup.subprocess.run", side_effect=lambda a, **k: calls.append(a) or result), \
                patch.object(sb.subprocess, "run", side_effect=lambda a, **k: calls.append(a) or result), \
                patch.object(sb, "default_backup_root", return_value=Path(self.temporary.name) / "b"):
            enabled = sb.enable(self.state, python="C:/Python/python.exe")
            self.assertEqual(enabled["settings"]["scheduler"], "windows-task")
            script = calls[0][-1]
            self.assertIn("-TaskName 'MK8DX automatic backup mk8dx-os-0123456789'", script)
            for needle in ("backup-run", "--quiet", "-StartWhenAvailable", "-Daily", "-At '03:15'",
                           "-LogonType Interactive"):
                self.assertIn(needle, script)
            self.assertNotIn("-Password", script)
            sb.disable(self.state)
            self.assertIn("Unregister-ScheduledTask -TaskName 'MK8DX automatic backup mk8dx-os-0123456789'",
                          calls[-1][-1])
            self.assertFalse(sb.load_settings(self.state)["enabled"])
            self.assertFalse(sb.summary(self.state)["enabled"])

    def test_setup_respects_a_no_and_never_fails(self):
        sb.record_choice(self.state, False)
        with patch.object(sb, "enable") as enable:
            sb.after_setup(self.state)
            sb.after_upgrade(self.state)
        enable.assert_not_called()
        sb.record_choice(self.state, True)
        with patch.object(sb, "enable", side_effect=sb.BackupError(1, "no crontab")), patch("builtins.print"):
            sb.after_setup(self.state)  # prints, does not raise

    def test_update_repoints_an_enabled_schedule(self):
        settings = sb.settings_for(self.state)
        settings.update({"enabled": True, "scheduler": "crontab"})
        sb.save_settings(self.state, settings)
        with patch.object(sb, "enable", return_value={"settings": settings}) as enable, patch("builtins.print"):
            sb.after_upgrade(self.state)
        enable.assert_called_once()

    def test_update_finishes_a_schedule_that_was_wanted_but_never_made(self):
        # A3/B2 0.2.6 recorded "on" at the first start but could not create the job (scheduler stays null).
        sb.record_choice(self.state, True)
        self.assertIsNone(sb.load_settings(self.state).get("scheduler"))
        with patch.object(sb, "enable", return_value={"settings": sb.settings_for(self.state)}) as enable, \
                patch("builtins.print"):
            sb.after_upgrade(self.state)
        enable.assert_called_once()

    def test_b2_question_defaults_to_yes(self):
        for answer, expected in (("", True), ("j", True), ("n", False), ("nee", False), ("No", False)):
            with patch("builtins.input", return_value=answer), patch("builtins.print"):
                self.assertEqual(sb.ask_choice(), expected)


class InstallCommandTest(unittest.TestCase):
    """install.py: A1 init records "on" (owner decision), --no-auto-backup records "off", status shows it."""

    def cli(self, *arguments):
        import subprocess
        return subprocess.run([sys.executable, str(sb.ROOT / "tooling" / "install.py"), *arguments], cwd=sb.ROOT,
                              capture_output=True, text=True, encoding="utf-8", check=False)

    def test_init_records_the_default_and_the_opt_out(self):
        with tempfile.TemporaryDirectory() as temporary:
            for flag, expected in (([], True), (["--no-auto-backup"], False)):
                state = Path(temporary) / f"state{len(flag)}"
                result = self.cli("init", "--mode", "local", "--state-dir", str(state),
                                  "--admin-email", "a@example.test", *flag)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIs(sb.load_settings(state)["enabled"], expected)
                status = self.cli("backup-status", "--state-dir", str(state))
                self.assertEqual(status.returncode, 0, status.stderr)
                shown = json.loads(status.stdout)
                self.assertEqual((shown["enabled"], shown["lastResult"]), (False, "never"))  # not scheduled yet
            empty = self.cli("backup-latest", "--state-dir", str(Path(temporary) / "state0"), "--print-path")
            self.assertEqual(empty.returncode, sb.EXIT_FAILED)


if __name__ == "__main__":
    unittest.main()
