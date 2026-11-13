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
            # The gateway's non-root Caddy (uid 10002, #34) serves the public client config.
            self.assertEqual(mode("public-client.json"), 0o644)
            for name in ("api.env", "compose.env", "secrets.json", "operator-profile.json"):
                self.assertEqual(mode(name), 0o600, name)
            os.chmod(state, 0o755)
            os.chmod(state / "operator.json", 0o600)
            os.chmod(state / "public-client.json", 0o600)
            install.compose_command(state)
            self.assertEqual(mode("operator.json"), 0o600, "never widened outside a private directory")
            self.assertEqual(mode("public-client.json"), 0o600, "never widened outside a private directory")

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


class NonRootGatewayTest(unittest.TestCase):
    """#34: Caddy drops root in the image itself, so older and newer images run with the same Compose files."""

    def test_the_image_starts_caddy_through_the_dropping_entrypoint(self):
        dockerfile = (ROOT / "apps/timetrials-web/Dockerfile").read_text(encoding="utf-8")
        final = dockerfile[dockerfile.rindex("\nFROM caddy:"):]
        self.assertIn("apk add --no-cache su-exec", final)
        self.assertIn("adduser -S -D -H -u 10002 -G caddy", final)
        self.assertIn('ENTRYPOINT ["/usr/local/bin/mk8dx-gateway-entrypoint"]', final)
        self.assertIn('CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]', final)
        # Root stays the image user only so the entrypoint can migrate old volumes and the installer's
        # `run --entrypoint sh web` maintenance keeps working; the entrypoint ends in su-exec.
        self.assertNotIn("\nUSER ", final)

    def test_the_entrypoint_keeps_modes_and_never_follows_links(self):
        script = (ROOT / "infrastructure/docker/gateway-entrypoint.sh").read_bytes()
        self.assertNotIn(b"\r", script)
        text = script.decode("utf-8")
        self.assertTrue(text.startswith("#!/bin/sh\n"))
        self.assertNotIn("chmod", text, "file modes (0600 keys) are never changed")
        self.assertIn('-exec chown -h "$uid:$gid" {} +', text)
        self.assertNotIn("chown -R", text)
        self.assertIn('exec su-exec "$run_as" "$@"', text)
        self.assertIn("/run/mk8dx", text, "the A2 CA signer and setup page are checked for readability")

    def test_compose_files_do_not_pin_a_gateway_user(self):
        # A `user:` would break a rollback to a root image with the newer Compose files, and the
        # entrypoint could no longer hand an existing root-owned volume to Caddy.
        for path in sorted(ROOT.glob("compose*.yaml")):
            with self.subTest(path.name):
                self.assertNotIn("\n    user:", path.read_text(encoding="utf-8"))

    def test_the_lan_gateway_never_installs_its_root_in_the_container(self):
        text = (ROOT / "infrastructure/docker/Caddyfile.lan").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("{\n"))
        self.assertIn("\n  skip_install_trust\n}\n", text[:text.index("https://")])


class ClientAddressForwardingTest(unittest.TestCase):
    """Per-client sign-in limits need the gateway's client address and a trusted gateway peer."""

    def test_new_installation_trusts_only_the_compose_gateway(self):
        with tempfile.TemporaryDirectory(prefix="mk8dx client address ") as temp:
            state = Path(temp) / "private state"
            subprocess.run([sys.executable, str(ROOT / "tooling/install.py"), "init", "--state-dir", str(state),
                            "--mode", "local"], check=True, capture_output=True)
            runtime = install.read_dotenv(state / "api.env")
            operator = json.loads((state / "operator.json").read_text(encoding="utf-8"))
            for values in (runtime, operator):
                self.assertEqual(json.loads(values["MK8DX_HOSTED_AUTH_TRUSTED_PROXIES_JSON"]), ["web"])
                self.assertEqual(json.loads(values["MK8DX_HOSTED_AUTH_CLIENT_IP_HEADERS_JSON"]), ["x-real-ip"])
            install.status(state)

    def test_compose_sets_the_gateway_trust_for_existing_installations_too(self):
        # compose.yaml `environment` overrides the api.env of an older installation
        # (which still says 127.0.0.1), so recreating the API is the whole upgrade.
        compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
        api = compose[compose.index("\n  api:"):compose.index("\n  web:")]
        self.assertIn("""MK8DX_HOSTED_AUTH_TRUSTED_PROXIES_JSON: '["web"]'""", api)
        self.assertIn("""MK8DX_HOSTED_AUTH_CLIENT_IP_HEADERS_JSON: '["x-real-ip"]'""", api)
        self.assertNotIn("\n  gateway:", compose)
        self.assertIn("\n  web:", compose, "the trusted name is the Compose gateway service")

    def test_every_gateway_overwrites_the_forwarded_client_address(self):
        for path in sorted((ROOT / "infrastructure/docker").glob("Caddyfile.*")):
            text = path.read_text(encoding="utf-8")
            with self.subTest(path.name):
                self.assertEqual(text.count("reverse_proxy "), 1)
                block = text[text.index("reverse_proxy api:8080 {"):]
                block = block[:block.index("\n    }\n")]
                self.assertIn("header_up X-Real-IP {remote_host}", block)
                self.assertNotIn("trusted_proxies", text, "client-supplied forwarding headers stay untrusted")


class ScannerContentSecurityPolicyTest(unittest.TestCase):
    """The scanner policy is enforced; only its worker entries may evaluate strings (#34)."""

    @staticmethod
    def policies(text):
        found = {}
        for line in text.splitlines():
            parts = line.strip().split(" ", 3)
            if len(parts) == 4 and parts[0] == "header" and parts[1].startswith("@scanner"):
                found[parts[1]] = (parts[2], parts[3].strip('"'))
        return found

    def test_every_gateway_enforces_the_same_split_scanner_policy(self):
        seen = set()
        for path in sorted((ROOT / "infrastructure/docker").glob("Caddyfile.*")):
            text = path.read_text(encoding="utf-8")
            with self.subTest(path.name):
                self.assertNotIn("Report-Only", text)
                found = self.policies(text)
                self.assertEqual(set(found), {"@scanner_csp", "@scanner_wasm_csp", "@scanner_worker_csp"})
                self.assertTrue(all(field == "Content-Security-Policy" for field, _ in found.values()))
                page, wasm, worker = (found[name][1] for name in ("@scanner_csp", "@scanner_wasm_csp", "@scanner_worker_csp"))
                for policy in (page, wasm, worker):
                    self.assertNotIn("unsafe-inline", policy)
                    self.assertNotIn("blob:", policy.split("worker-src", 1)[1].split(";", 1)[0])
                    self.assertIn("frame-ancestors 'none'", policy)
                self.assertNotIn("unsafe-eval", page, "the scanner page never evaluates strings or compiles WASM")
                self.assertNotIn("unsafe-eval", wasm.replace("'wasm-unsafe-eval'", ""))
                self.assertIn("script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval';", worker)
                # The three matchers must not overlap, or one response would carry two policies.
                self.assertIn("@scanner_worker_csp path /scanner/assets/worker/*\n", text)
                self.assertIn("@scanner_wasm_csp path /scanner/ort/* /scanner/tess/*\n", text)
                self.assertIn("    path /scanner/*\n    not path /scanner/assets/worker/* /scanner/ort/* /scanner/tess/*\n", text)
                seen.add((page, wasm, worker))
        self.assertEqual(len(seen), 1, "every gateway sends the same scanner policies")

    def test_the_scanner_build_puts_its_workers_where_the_gateway_expects_them(self):
        config = (ROOT / "apps/timetrials-scanner-web/vite.config.ts").read_text(encoding="utf-8")
        self.assertIn("entryFileNames: 'assets/worker/[name]-[hash].js'", config)

    def test_the_scanner_sets_no_style_attributes_and_creates_no_blob_workers(self):
        scanner = ROOT / "apps/timetrials-scanner-web"
        sources = [*sorted((scanner / "src").rglob("*.ts")), *sorted(scanner.glob("*.html")), *sorted((scanner / "audit").glob("*.html"))]
        self.assertTrue(sources)
        for path in sources:
            text = path.read_text(encoding="utf-8")
            with self.subTest(path.name):
                self.assertNotRegex(text, r"""style=|setAttribute\(\s*['"]style|<style|\.cssText\b""")
                self.assertNotIn("new Worker(URL.createObjectURL", text)


if __name__ == "__main__":
    unittest.main()
