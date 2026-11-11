"""A3 (XAMPP + Node.js) and B2 (shared hosting): the setup questions, their refusals and readable output."""
import io
import json
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
                mock.patch.object(native_install, "create") as create, redirect_stdout(out):
            native_install.wizard(Path("state"), "A3")
        args = create.call_args.args
        self.assertEqual(args[1:5], ("A3", "http://127.0.0.1:18090", "me@example.test", "127.0.0.1"))
        self.assertIn("try again", out.getvalue())
        self.assertIn("its own MariaDB", out.getvalue())

    def test_b2_explains_the_mail_rule_and_hides_passwords(self):
        answers = ["mk8dx.example.org", "localhost", "", "acct_mk8dx", "acct_user",
                   "mail.example.org", "", "login@example.org", "noreply@example.org", "admin@example.org"]
        out = io.StringIO()
        with mock.patch("builtins.input", side_effect=answers), \
                mock.patch.object(native_install.getpass, "getpass", side_effect=["db-secret", "smtp-secret"]) as hidden, \
                mock.patch.object(native_install, "create") as create, redirect_stdout(out):
            native_install.wizard(Path("state"), "B2")
        args = create.call_args.args
        self.assertEqual(args[2], "https://mk8dx.example.org")
        self.assertEqual(args[5], 3306)
        self.assertEqual(args[10], 465)
        self.assertEqual(hidden.call_count, 2)
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


if __name__ == "__main__":
    unittest.main()
