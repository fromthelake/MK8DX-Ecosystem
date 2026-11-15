"""A3 (XAMPP + Node.js) and B2 (shared hosting): the setup questions, their refusals and readable output."""
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from tooling import install

# native_install imports `install` as a top-level module, as the launchers run it from tooling/.
sys.path.insert(0, str(Path(install.__file__).resolve().parent))
import native_install  # noqa: E402


class NativeWizardTest(unittest.TestCase):
    def test_a3_asks_only_the_administrator_email_and_asks_again_after_a_typo(self):
        out = io.StringIO()
        with mock.patch("builtins.input", side_effect=["not an email", "me@example.test"]), \
                mock.patch.object(native_install, "create") as create, \
                mock.patch("tooling.scheduled_backup.record_choice") as nightly, redirect_stdout(out):
            native_install.wizard(Path("state"), "A3")
        nightly.assert_called_once_with(Path("state"), True)  # A3: on by default, no question
        args = create.call_args.args
        self.assertEqual(args[1:5], ("A3", "http://127.0.0.1:18090", "me@example.test", "127.0.0.1"))
        self.assertIn("try again", out.getvalue())
        self.assertIn("its own MariaDB", out.getvalue())

    def test_b2_explains_the_mail_rule_and_hides_passwords(self):
        answers = ["mk8dx.example.org", "localhost", "", "acct_mk8dx", "acct_user", "acct_site",
                   "mail.example.org", "", "login@example.org", "noreply@example.org", "admin@example.org", "n"]
        out = io.StringIO()
        with mock.patch("builtins.input", side_effect=answers), \
                mock.patch.object(native_install.getpass, "getpass",
                                  side_effect=["db-secret", "site-secret", "smtp-secret"]) as hidden, \
                mock.patch.object(native_install, "create") as create, \
                mock.patch("tooling.scheduled_backup.record_choice") as nightly, redirect_stdout(out):
            native_install.wizard(Path("state"), "B2")
        # B2: a clear, explained choice (many hosts already back up the account); here the person says no.
        nightly.assert_called_once_with(Path("state"), False)
        self.assertIn("JetBackup", out.getvalue())
        args = create.call_args.args
        self.assertEqual(args[2], "https://mk8dx.example.org")
        self.assertEqual(args[5], 3306)
        self.assertEqual(args[10], 465)
        self.assertEqual(hidden.call_count, 3)
        # The second, limited database user becomes the website's own account.
        self.assertEqual((create.call_args.kwargs["runtime_user"], create.call_args.kwargs["runtime_password"]),
                         ("acct_site", "site-secret"))
        self.assertNotIn("site-secret", out.getvalue())
        self.assertIn("port 465", out.getvalue())


class NativeCreateRefusalTest(unittest.TestCase):
    def create(self, folder, **changes):
        values = dict(route="B2", origin="https://mk8dx.example.org", admin_email="a@example.org", db_host="localhost",
                      db_port=3306, db_name="acct_mk8dx", db_user="acct_user", db_password="x",
                      smtp_host="mail.example.org", smtp_port=465, smtp_user="u", smtp_password="p",
                      smtp_from="n@example.org")
        values.update(changes)
        with mock.patch.object(native_install, "package_paths"):
            native_install.create(folder, **values)

    def test_unsafe_choices_are_refused_before_anything_is_written(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            cases = {"STARTTLS port": dict(smtp_port=587), "root user": dict(db_user="root"),
                     "public folder": dict(), "A3 elsewhere": dict(route="A3", origin="http://127.0.0.1:18090",
                                                                   db_host="db.example.org")}
            for name, change in cases.items():
                folder = base / ("htdocs" if name == "public folder" else name.replace(" ", "-")) / "state"
                with self.subTest(name), self.assertRaises(ValueError):
                    self.create(folder, **change)
                self.assertFalse(folder.exists())


class NativeOutputTest(unittest.TestCase):
    def test_the_migration_report_becomes_one_line(self):
        report = {"database": "mk8dx", "alreadyApplied": 3, "applied": ["0084", "0085", "0086"]}
        finished = subprocess.CompletedProcess([], 0, stdout=json.dumps(report), stderr="")
        out = io.StringIO()
        with mock.patch.object(native_install.subprocess, "run", return_value=finished), redirect_stdout(out):
            native_install.node_command(Path("state"), "x.js", summarize_migrations=True)
        self.assertEqual(out.getvalue().strip(), "Database mk8dx: 3 new migrations (0084-0086), 3 already applied")

    def test_stop_on_a_non_docker_installation_says_how_to_stop_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state"
            state.mkdir()
            (state / install.PROFILE).write_text(json.dumps({"route": "A3"}), encoding="utf-8")
            with mock.patch.object(sys, "argv", ["install.py", "stop", "--state-dir", str(state)]), \
                    self.assertRaises(SystemExit) as stopped:
                install.main()
        self.assertIn("Ctrl+C", str(stopped.exception))


@unittest.skipUnless(sys.platform == "win32", "configure_xampp.ps1 is the Windows A3 helper")
class XamppHelperTest(unittest.TestCase):
    """configure_xampp.ps1 adds one Include line and the fragment; -Remove takes back exactly that."""

    def run_helper(self, root: Path, package: Path, local: Path, *extra: str) -> str:
        # Windows PowerShell 5.1 as a person starts it: a PowerShell 7 PSModulePath would hide Get-FileHash.
        environment = {k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"}
        environment["LOCALAPPDATA"] = str(local)
        done = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                               str(package / "tooling/configure_xampp.ps1"), "-XamppRoot", str(root), *extra],
                              capture_output=True, text=True, stdin=subprocess.DEVNULL, env=environment, timeout=120)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        return done.stdout

    def test_remove_restores_the_original_httpd_conf_bytes(self):
        repository = Path(install.__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root, package, local = base / "xampp", base / "package", base / "local"
            (root / "apache/conf/extra").mkdir(parents=True)
            (root / "apache/bin").mkdir(parents=True)
            # A stand-in for httpd.exe: cmd.exe with no input ends at once with exit code 0 ("syntax OK").
            (root / "apache/bin/httpd.exe").write_bytes(Path(r"C:\Windows\System32\cmd.exe").read_bytes())
            original = b'ServerRoot "C:/xampp/apache"\r\nListen 80\r\n# caf\xe9 site\r\nInclude conf/extra/other.conf\r\n'
            conf = root / "apache/conf/httpd.conf"
            conf.write_bytes(original)
            (package / "tooling").mkdir(parents=True)
            (package / "apache").mkdir()
            (package / "tooling/configure_xampp.ps1").write_bytes(
                (repository / "tooling/configure_xampp.ps1").read_bytes())
            fragment = repository / "infrastructure/native/apache-mk8dx-local.conf"
            (package / "apache/apache-mk8dx-local.conf").write_bytes(fragment.read_bytes())

            self.run_helper(root, package, local)
            self.assertTrue(conf.read_bytes().endswith(b"\r\nInclude conf/extra/mk8dx-local.conf\r\n"))
            self.assertTrue((root / "apache/conf/extra/mk8dx-local.conf").is_file())

            removed = self.run_helper(root, package, local, "-Remove")
            self.assertIn("MK8DX Apache site removed", removed)
            self.assertEqual(conf.read_bytes(), original)  # every other byte, including the é, unchanged
            self.assertFalse((root / "apache/conf/extra/mk8dx-local.conf").exists())
            self.assertIn("nothing changed", self.run_helper(root, package, local, "-Remove"))


if __name__ == "__main__":
    unittest.main()
