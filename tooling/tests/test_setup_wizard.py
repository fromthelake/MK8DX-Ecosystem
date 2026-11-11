"""Setup wizard: loopback-only access, per-launch secret, escaped manual, one-UAC network step."""

import http.client
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling import install, setup_wizard

ROOT = Path(__file__).resolve().parents[2]


class WizardServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.wizard = setup_wizard.Wizard(Path(self.tmp.name) / "state", qa_candidate=True)
        self.server = setup_wizard.ThreadingHTTPServer(("127.0.0.1", 0), None)
        self.host = f"127.0.0.1:{self.server.server_port}"
        self.token = "test-token-123"
        self.server.RequestHandlerClass = setup_wizard.make_handler(self.wizard, self.token, self.host)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def request(self, method, path, headers=None, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.read(), response.getheader("Content-Security-Policy")
        finally:
            connection.close()

    def test_page_carries_secret_and_strict_csp(self):
        status, body, csp = self.request("GET", "/", {"Host": self.host})
        self.assertEqual(status, 200)
        self.assertIn(self.token.encode(), body)
        self.assertIn("script-src 'self'", csp)

    def test_api_requires_exact_host_and_secret(self):
        self.assertEqual(self.request("GET", "/api/status", {"Host": self.host})[0], 403)
        self.assertEqual(self.request("GET", "/api/status", {"Host": "evil.example", "X-MK8DX-Wizard": self.token})[0], 403)
        status, body, _ = self.request("GET", "/api/status", {"Host": self.host, "X-MK8DX-Wizard": self.token})
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)["installed"])

    def test_post_requires_same_origin(self):
        headers = {"Host": self.host, "X-MK8DX-Wizard": self.token, "Content-Type": "application/json"}
        self.assertEqual(self.request("POST", "/api/install", headers, b'{"ip":"192.168.0.2"}')[0], 403)
        with patch.object(self.wizard, "start_install") as start:
            status, _, _ = self.request("POST", "/api/install", {**headers, "Origin": f"http://{self.host}"},
                                        b'{"ip":"192.168.0.2"}')
            self.assertEqual(status, 200)
            start.assert_called_once_with("192.168.0.2")

    def test_install_refused_without_candidate_and_bad_ip(self):
        plain = setup_wizard.Wizard(Path(self.tmp.name) / "other", qa_candidate=False)
        with self.assertRaisesRegex(ValueError, "not the A2 offline candidate"):
            plain.start_install("192.168.0.2")
        with self.assertRaises(ValueError):
            self.wizard.start_install("not-an-ip")

    def _backup_folder(self):
        folder = Path(self.tmp.name) / "usb"
        for name, schema, created in (("20261101-030000", "mk8dx.install-backup.v3", "2026-11-01T02:00:00+00:00"),
                                      ("20261110-030000", "mk8dx.install-backup.v3", "2026-11-10T02:00:00+00:00"),
                                      ("20260901-030000", "mk8dx.install-backup.v2", "2026-09-01T02:00:00+00:00")):
            (folder / name).mkdir(parents=True)
            (folder / name / "manifest.json").write_text(json.dumps(
                {"schemaVersion": schema, "route": "A2_OFFLINE", "createdUtc": created}), encoding="utf-8")
        (folder / "notes").mkdir()
        return folder

    def test_restore_lists_sealed_backups_newest_first(self):
        folder = self._backup_folder()
        found = self.wizard.backups(str(folder))
        # Only sealed A2 backups are offered; the old plaintext format is not.
        self.assertEqual([b["name"] for b in found["backups"]], ["20261110-030000", "20261101-030000"])
        headers = {"Host": self.host, "X-MK8DX-Wizard": self.token}
        from urllib.parse import quote
        status, body, _ = self.request("GET", "/api/backups?folder=" + quote(str(folder)), headers)
        self.assertEqual((status, len(json.loads(body)["backups"])), (200, 2))

    def test_restore_is_refused_on_an_installed_computer_and_for_bad_input(self):
        folder = self._backup_folder()
        code = "ABCD-EFGH-JKLM-NPQR-STUV"
        with self.assertRaisesRegex(ValueError, "listed backups"):
            self.wizard.start_restore(str(folder), "../20261110-030000", code, "192.168.0.2")
        with self.assertRaisesRegex(ValueError, "whole recovery code"):
            self.wizard.start_restore(str(folder), "20261110-030000", "ABCD", "192.168.0.2")
        with self.assertRaises(ValueError):
            self.wizard.start_restore(str(folder), "20261110-030000", code, "not-an-ip")
        self.wizard.state.mkdir()
        with self.assertRaisesRegex(ValueError, "already installed"):
            self.wizard.start_restore(str(folder), "20261110-030000", code, "192.168.0.2")

    def test_restore_job_restores_stores_code_and_starts(self):
        folder = self._backup_folder()
        calls = []
        with patch("tooling.lifecycle.restore_new", side_effect=lambda *a: calls.append(("restore", *a))
                   or a[1].mkdir()), \
                patch("tooling.auto_backup.store_recovery_code", side_effect=lambda s, c: calls.append(("code", c))), \
                patch.object(install, "prepare_offline_network", return_value="private"), \
                patch.object(self.wizard, "run_cli", side_effect=lambda *a: calls.append(("cli", *a))):
            self.wizard.start_restore(str(folder), "20261110-030000", "abcd efgh-JKLM-NPQR-STUV", "192.168.0.9")
            for _ in range(100):
                if self.wizard.job.done or self.wizard.job.error:
                    break
                threading.Event().wait(0.05)
        self.assertTrue(self.wizard.job.done, self.wizard.job.error)
        restore = calls[0]
        self.assertEqual((restore[1], restore[2], restore[4]), (folder / "20261110-030000", self.wizard.state, "192.168.0.9"))
        self.assertIn(("code", "ABCD-EFGH-JKLM-NPQR-STUV"), calls)
        self.assertIn(("cli", "start", "--qa-offline-candidate"), calls)
        self.assertNotIn(("cli", "setup", "--qa-offline-candidate"), calls)

    def test_wrong_code_sets_the_half_restore_aside(self):
        folder = self._backup_folder()

        def wrong(*args):
            args[1].mkdir()
            raise RuntimeError("The recovery code does not open this backup")
        with patch("tooling.lifecycle.restore_new", side_effect=wrong), \
                patch.object(setup_wizard, "compose", return_value=""):
            self.wizard.start_restore(str(folder), "20261110-030000", "ABCD-EFGH-JKLM-NPQR-STUV", "192.168.0.9")
            for _ in range(100):
                if self.wizard.job.error:
                    break
                threading.Event().wait(0.05)
        self.assertEqual(self.wizard.job.error, "wrong-recovery-code")
        self.assertFalse(self.wizard.state.exists())
        self.assertFalse(self.wizard.job.restored)

    def _installed(self, ip):
        self.wizard.state.mkdir()
        (self.wizard.state / install.PROFILE).write_text(json.dumps({"route": "A2_OFFLINE", "bindAddress": ip,
                                                                     "origin": f"https://{ip}"}))
        (self.wizard.state / "compose.env").write_text("MK8DX_OFFLINE_HOST_PORT='19090'\n")

    def test_status_offers_the_move_when_the_address_is_gone(self):
        self._installed("192.168.50.30")
        with patch.object(self.wizard, "addresses", return_value=[{"ip": "192.168.1.50"}]):
            status = self.wizard.status()
        self.assertEqual((status["addressActive"], status["boundAddress"]), (False, "192.168.50.30"))
        with patch.object(self.wizard, "addresses", return_value=[{"ip": "192.168.50.30"}]):
            self.assertTrue(self.wizard.status()["addressActive"])

    def test_move_runs_the_installer_address_change(self):
        with self.assertRaisesRegex(ValueError, "not installed"):
            self.wizard.start_move("192.168.1.50")
        self._installed("192.168.50.30")
        with self.assertRaises(ValueError):
            self.wizard.start_move("not-an-ip")
        calls = []
        with patch.object(self.wizard, "run_cli", side_effect=lambda *a: calls.append(a)):
            self.wizard.start_move("192.168.1.50")
            for _ in range(100):
                if self.wizard.job.done or self.wizard.job.error:
                    break
                threading.Event().wait(0.05)
        self.assertTrue(self.wizard.job.done, self.wizard.job.error)
        self.assertEqual(calls, [("change-lan-address", "--lan-bind-address", "192.168.1.50", "--qa-offline-candidate")])

    def test_sign_out_calls_the_host_page_and_explains_own_account(self):
        host = type("Host", (), {})()
        calls = []
        host.call = lambda method, path, body=None: (calls.append((method, path, body))
                                                     or (200, {"sessions": 2, "invitations": 1}))
        self.wizard.host = host
        self.assertEqual(self.wizard.sign_out("offline_account.1"), {"sessions": 2, "invitations": 1})
        self.assertEqual(calls, [("POST", "/api/accounts/sign-out", {"accountKey": "offline_account.1"})])
        host.call = lambda method, path, body=None: (403, {})
        with self.assertRaisesRegex(ValueError, "own-account"):
            self.wizard.sign_out("offline_account.self")
        host.call = lambda method, path, body=None: (404, {})
        with self.assertRaisesRegex(RuntimeError, "could not be signed out"):
            self.wizard.sign_out("offline_account.gone")

    def test_revoke_card_calls_the_host_page(self):
        host = type("Host", (), {})()
        calls = []
        host.call = lambda method, path, body=None: (calls.append((method, path, body)) or (200, {"revoked": True}))
        self.wizard.host = host
        self.assertEqual(self.wizard.revoke_card("invitation.1"), {"revoked": True})
        self.assertEqual(calls, [("POST", "/api/invitations/revoke", {"invitationId": "invitation.1"})])
        host.call = lambda method, path, body=None: (404, {})
        with self.assertRaisesRegex(RuntimeError, "could not be revoked"):
            self.wizard.revoke_card("invitation.2")

    def test_manual_is_escaped_and_both_languages_exist(self):
        for lang in ("nl", "en"):
            page = setup_wizard.manual_html(lang).decode()
            self.assertIn("<h1>", page)
            self.assertNotIn("<script", page)
        with patch.object(setup_wizard.Path, "read_text", return_value="# <img src=x onerror=alert(1)>\n- **a** `b`"):
            page = setup_wizard.manual_html("en").decode()
        self.assertIn("&lt;img", page)
        self.assertIn("<strong>a</strong>", page)


def state_with_profile(folder: Path) -> Path:
    (folder / install.PROFILE).write_text(json.dumps({"route": "A2_OFFLINE", "bindAddress": "192.168.50.20",
                                                      "project": "p", "origin": "https://192.168.50.20"}))
    return folder


def ps(stdout="", code=0):
    return subprocess.CompletedProcess([], code, stdout, "")


@unittest.skipUnless(sys.platform == "win32", "Windows network step")
class PrepareNetworkTest(unittest.TestCase):
    def test_public_network_becomes_private_and_rule_added_in_one_elevation(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = state_with_profile(Path(temporary))
            with patch.object(install, "_powershell", side_effect=[ps("Public|False"), ps()]) as run:
                self.assertEqual(install.prepare_offline_network(state), "created")
                script = run.call_args_list[1].args[0]
                self.assertTrue(run.call_args_list[1].kwargs["elevated"])
                self.assertIn("Set-NetConnectionProfile", script)
                self.assertIn("MK8DX-A2-offline-192.168.50.20", script)
                self.assertEqual(run.call_count, 2)

    def test_existing_private_rule_needs_no_prompt_and_domain_is_never_changed(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = state_with_profile(Path(temporary))
            with patch.object(install, "_powershell", side_effect=[ps("Private|True")]) as run:
                self.assertEqual(install.prepare_offline_network(state), "present")
                self.assertEqual(run.call_count, 1)
            with patch.object(install, "_powershell", side_effect=[ps("DomainAuthenticated|False")]):
                with self.assertRaisesRegex(ValueError, "administrator"):
                    install.prepare_offline_network(state)


if __name__ == "__main__":
    unittest.main()
