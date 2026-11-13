"""The launchers people double-click: they must parse, stay ASCII where Windows reads them as ANSI, and use CRLF."""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CMD_FILES = ("Start-MK8DX.cmd", "Start-MK8DX-LAN.cmd", "Start-MK8DX-No-Docker.cmd", "Manage-MK8DX-No-Docker.cmd")


class LauncherTest(unittest.TestCase):
    def test_cmd_files_are_ascii_with_crlf(self):
        for name in CMD_FILES:
            data = (ROOT / name).read_bytes()
            with self.subTest(name):
                data.decode("ascii")
                self.assertNotIn(b"\n", data.replace(b"\r\n", b""), "bare LF line ending")

    def test_powershell_launcher_is_ascii_and_parses(self):
        for name in ("start-mk8dx.ps1", "mk8dx-ui.ps1"):
            script = ROOT / "tooling" / name
            script.read_bytes().decode("ascii")  # Windows PowerShell 5.1 reads a BOM-less file as ANSI
            shell = shutil.which("pwsh") or shutil.which("powershell")
            if shell is None:
                self.skipTest("no PowerShell on this host")
            check = ("$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile("
                     f"'{script}',[ref]$t,[ref]$e);$e.Count")
            result = subprocess.run([shell, "-NoProfile", "-Command", check], capture_output=True, text=True,
                                    timeout=120)
            with self.subTest(name):
                self.assertEqual(result.stdout.strip().splitlines()[-1], "0", result.stdout + result.stderr)

    def test_launcher_ui_is_plain_when_redirected(self):
        # Captured output (a log, a CI job) gets no animation, no colour codes and the same words the guides quote.
        shell = shutil.which("pwsh") or shutil.which("powershell")
        if shell is None:
            self.skipTest("no PowerShell on this host")
        result = subprocess.run([shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                                 str(ROOT / "tooling" / "mk8dx-ui.ps1"), "-Demo"],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        for words in ("T I M E   T R I A L S", "[LAP 1/4] Checking Python", "The spinner returned 42.",
                      "OK  Done.", "!!  That step did not finish.", "FINISH"):
            self.assertIn(words, result.stdout)
        self.assertNotIn("\x1b", result.stdout)
        self.assertNotIn("\r", result.stdout.replace("\r\n", "\n"))

    def test_shell_launcher_parses(self):
        shell = shutil.which("sh")
        if shell is None:
            self.skipTest("no sh on this host")
        for name in ("start-mk8dx.sh", "mk8dx-ui.sh"):
            script = ROOT / "tooling" / name
            script.read_bytes().decode("ascii")
            result = subprocess.run([shell, "-n", str(script)], capture_output=True, text=True)
            with self.subTest(name):
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_shell_ui_is_plain_when_redirected(self):
        # The Linux/macOS counterpart of the PowerShell demo test: same words, no escape codes, no carriage returns.
        shell = shutil.which("sh")
        if shell is None:
            self.skipTest("no sh on this host")
        result = subprocess.run([shell, str(ROOT / "tooling" / "mk8dx-ui.sh"), "--demo"],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        for words in ("T I M E   T R I A L S", "[LAP 1/4] Checking Python", "OK  Done.",
                      "!!  That step did not finish.", "FINISH"):
            self.assertIn(words, result.stdout)
        self.assertNotIn("\x1b", result.stdout)
        self.assertNotIn("\r", result.stdout)


if __name__ == "__main__":
    unittest.main()
