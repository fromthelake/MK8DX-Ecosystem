"""Linux and macOS host steps of A2 offline: secrets, addresses, firewall advice, jobs, shortcuts."""

import json
import plistlib
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling import host_platform


def answer(code=0, stdout=b""):
    return types.SimpleNamespace(returncode=code, stdout=stdout, stderr=b"")


class SecretTest(unittest.TestCase):
    def test_linux_without_systemd_creds_keeps_a_marked_file(self):
        with patch.object(host_platform.shutil, "which", return_value=None):
            blob = host_platform.protect(b"root-key", platform="linux")
        self.assertTrue(blob.startswith(host_platform.FILE_MARKER))
        self.assertEqual(host_platform.unprotect(blob), b"root-key")
        self.assertEqual(host_platform.protection_kind(blob), "file-permissions")

    def test_linux_with_systemd_creds_encrypts_per_user(self):
        calls = []

        def run(command, input_bytes=None, timeout=60):
            calls.append(command)
            if "encrypt" in command:
                return answer(stdout=b"SEALED:" + input_bytes)
            return answer(stdout=input_bytes[len(b"SEALED:"):])
        with patch.object(host_platform.shutil, "which", return_value="/usr/bin/systemd-creds"), \
                patch.object(host_platform, "_run", side_effect=run):
            blob = host_platform.protect(b"root-key", platform="linux")
            self.assertTrue(blob.startswith(host_platform.SYSTEMD_MARKER))
            self.assertEqual(blob[len(host_platform.SYSTEMD_MARKER):], b"SEALED:root-key")  # what systemd-creds returned
            self.assertEqual(host_platform.unprotect(blob), b"root-key")
        self.assertTrue(all("--user" in command for command in calls))

    def test_macos_keeps_the_secret_in_the_keychain_and_only_a_reference_in_the_file(self):
        stored = {}

        def run(command, input_bytes=None, timeout=60):
            if command[1] == "add-generic-password":
                stored[command[command.index("-a") + 1]] = command[command.index("-w") + 1]
                return answer()
            return answer(stdout=stored[command[command.index("-a") + 1]].encode() + b"\n")
        with patch.object(host_platform, "_run", side_effect=run):
            blob = host_platform.protect(b"root-key", platform="darwin")
            self.assertTrue(blob.startswith(host_platform.KEYCHAIN_MARKER))
            self.assertNotIn(b"root-key", blob)
            self.assertEqual(host_platform.unprotect(blob), b"root-key")
        self.assertEqual(host_platform.protection_kind(blob), "keychain")

    def test_a_tampered_keychain_reference_is_refused(self):
        with self.assertRaises(RuntimeError):
            host_platform.unprotect(host_platform.KEYCHAIN_MARKER + b"secret-x; rm -rf /")


class NetworkTest(unittest.TestCase):
    def test_linux_addresses_skip_loopback_docker_and_public(self):
        listing = json.dumps([
            {"ifname": "lo", "addr_info": [{"family": "inet", "local": "127.0.0.1"}]},
            {"ifname": "eth0", "addr_info": [{"family": "inet", "local": "192.168.1.20"}]},
            {"ifname": "docker0", "addr_info": [{"family": "inet", "local": "172.17.0.1"}]},
            {"ifname": "wlan0", "addr_info": [{"family": "inet", "local": "8.8.8.8"}]},
        ]).encode()
        with patch.object(host_platform, "_run", return_value=answer(stdout=listing)):
            self.assertEqual(host_platform.local_addresses(platform="linux"),
                             [{"ip": "192.168.1.20", "alias": "eth0", "category": ""}])

    def test_macos_addresses_from_ifconfig(self):
        text = (b"lo0: flags=8049<UP>\n\tinet 127.0.0.1 netmask 0xff000000\n"
                b"en0: flags=8863<UP>\n\tinet 10.0.0.8 netmask 0xffffff00 broadcast 10.0.0.255\n"
                b"bridge100: flags=8863<UP>\n\tinet 192.168.64.1 netmask 0xffffff00\n")
        with patch.object(host_platform, "_run", return_value=answer(stdout=text)):
            self.assertEqual(host_platform.local_addresses(platform="darwin"),
                             [{"ip": "10.0.0.8", "alias": "en0", "category": ""}])

    def test_linux_firewall_gives_the_exact_command_instead_of_asking_for_root(self):
        with patch.object(host_platform.shutil, "which", side_effect=lambda tool: "/usr/sbin/ufw" if tool == "ufw" else None), \
                patch.object(host_platform, "_run", return_value=answer()):
            advice = host_platform.lan_firewall("192.168.1.20", platform="linux")
        self.assertEqual(advice, "manual: sudo ufw allow from 192.168.1.0/24 to 192.168.1.20 port 80,443 proto tcp")
        with patch.object(host_platform.shutil, "which", return_value=None):
            self.assertTrue(host_platform.lan_firewall("192.168.1.20", platform="linux").startswith("not-needed"))
        self.assertTrue(host_platform.lan_firewall("192.168.1.20", platform="darwin").startswith("not-needed"))


class ScheduleTest(unittest.TestCase):
    def test_linux_daily_job_is_a_persistent_user_timer(self):
        with tempfile.TemporaryDirectory() as home:
            calls = []
            with patch.dict("os.environ", {"HOME": home}), \
                    patch.object(host_platform, "_run", side_effect=lambda command, **k: calls.append(command) or answer()):
                self.assertTrue(host_platform.schedule("MK8DX backup", ["/venv/bin/python", "/pkg/tooling/auto_backup.py",
                                                                        "run", "--state-dir", "/home/o'neil/lan"],
                                                       daily="03:00", platform="linux"))
            units = Path(home) / ".config" / "systemd" / "user"
            timer = (units / "mk8dx-mk8dx-backup.timer").read_text()
            service = (units / "mk8dx-mk8dx-backup.service").read_text()
        self.assertIn("OnCalendar=*-*-* 03:00:00", timer)
        self.assertIn("Persistent=true", timer)  # a night missed while off runs at the next start
        self.assertIn('ExecStart="/venv/bin/python" "/pkg/tooling/auto_backup.py" "run" "--state-dir" "/home/o\'neil/lan"', service)
        self.assertIn(["systemctl", "--user", "enable", "mk8dx-mk8dx-backup.timer"], calls)
        self.assertFalse(any("sudo" in part for command in calls for part in command))

    def test_macos_daily_and_sign_in_jobs_are_launch_agents(self):
        with tempfile.TemporaryDirectory() as home:
            with patch.dict("os.environ", {"HOME": home}), \
                    patch.object(host_platform.os, "getuid", create=True, return_value=501), \
                    patch.object(host_platform, "_run", return_value=answer()):
                self.assertTrue(host_platform.schedule("MK8DX certificate renewal", ["/p", "maintain-ca"],
                                                       daily="03:30", platform="darwin"))
                with patch.object(host_platform.Path, "exists", return_value=True):
                    self.assertEqual(host_platform.docker_autostart(platform="darwin"), "enabled")
            agents = Path(home) / "Library" / "LaunchAgents"
            renewal = plistlib.loads((agents / "nl.mariokart8.mk8dx-mk8dx-certificate-renewal.plist").read_bytes())
            start = plistlib.loads((agents / "nl.mariokart8.mk8dx-mk8dx-start.plist").read_bytes())
        self.assertEqual(renewal["StartCalendarInterval"], {"Hour": 3, "Minute": 30})
        self.assertEqual(renewal["ProgramArguments"], ["/p", "maintain-ca"])
        self.assertTrue(start["RunAtLoad"])
        self.assertEqual(start["ProgramArguments"], ["/usr/bin/open", "-g", "-a", "Docker"])

    def test_bad_times_are_refused(self):
        with self.assertRaises(ValueError):
            host_platform.schedule("x", ["/bin/true"], daily="3am; reboot", platform="linux")

    def test_linux_docker_at_boot_is_advice_when_not_enabled(self):
        with patch.object(host_platform, "_run", return_value=answer(code=1)):
            self.assertEqual(host_platform.docker_autostart(platform="linux"),
                             "manual: sudo systemctl enable --now docker")
        with patch.object(host_platform, "_run", return_value=answer(code=0)):
            self.assertEqual(host_platform.docker_autostart(platform="linux"), "present")


class ShortcutTest(unittest.TestCase):
    def test_linux_and_macos_shortcuts_open_the_launcher(self):
        for platform, name in (("linux", "mk8dx-beheer.desktop"), ("darwin", "MK8DX beheer.command")):
            with tempfile.TemporaryDirectory() as home:
                (Path(home) / "Desktop").mkdir()
                with patch.dict("os.environ", {"HOME": home}):
                    self.assertTrue(host_platform.desktop_shortcut(Path("/pkg/tooling/start-mk8dx.sh"), platform=platform))
                self.assertIn("/pkg/tooling/start-mk8dx.sh", (Path(home) / "Desktop" / name).read_text())


if __name__ == "__main__":
    unittest.main()
