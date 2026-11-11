"""A2 backup and restore keep the CA without exposing its private key."""

import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tooling import lifecycle
from tooling import offline_lan_ca
from tooling import offline_lan_ca_lifecycle


class FakeProcess:
    def __init__(self, command, **_kwargs):
        self.command = command
        self.stdout = io.BytesIO(b"CREATE TABLE qa_example (id INT);\n")
        self.stderr = io.BytesIO()
        self.stdin = io.BytesIO()

    def wait(self):
        return 0


@unittest.skipUnless(sys.platform == "win32", "A2 root protection uses Windows DPAPI")
class OfflineLanBackupTest(unittest.TestCase):
    def test_backup_restore_keeps_ca_and_requires_owner_phrase(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            state, backup, restored = base / "state", base / "backup", base / "restored"
            state.mkdir()
            ca = offline_lan_ca.provision(state, "192.168.50.20")
            root_hash = ca["root"]["certificateSha256"]
            origin = "https://192.168.50.20"
            (state / "operator-profile.json").write_text(json.dumps({
                "route": "A2_OFFLINE", "origin": origin, "bindAddress": "192.168.50.20",
                "project": "mk8dx-qa", "rootCertificateSha256": root_hash}))
            (state / "operator.json").write_text(json.dumps({"MK8DX_HOSTED_AUTH_BASE_URL": origin}))
            (state / "api.env").write_text(f"MK8DX_HOSTED_AUTH_BASE_URL='{origin}'\n"
                                           f"MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON='[\"{origin}\"]'\n")
            (state / "compose.env").write_text(
                "MK8DX_PROJECT_NAME='mk8dx-qa'\n"
                f"MK8DX_STATE_DIR='{state.as_posix()}'\n"
                "MK8DX_DOMAIN='192.168.50.20'\n"
                "MK8DX_LAN_IP='192.168.50.20'\n"
                "MK8DX_BIND_ADDRESS='192.168.50.20'\n")
            (state / "secrets.json").write_text('{"synthetic":true}')
            (state / "public-client.json").write_text(json.dumps({"websiteOrigin": origin}))
            phrase = base / "owner-phrase.txt"
            phrase.write_text("synthetic-owner-recovery-phrase", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "recovery-phrase-file"):
                lifecycle.backup(state, backup)
            self.assertFalse(backup.exists())

            real_run = subprocess.run
            real_popen = subprocess.Popen
            commands = []

            def fake_run(command, **kwargs):
                if command[0] == "docker":
                    commands.append(command)
                    return SimpleNamespace(returncode=0)
                return real_run(command, **kwargs)

            def fake_popen(command, **kwargs):
                if command[0] == "docker":
                    return FakeProcess(command, **kwargs)
                return real_popen(command, **kwargs)

            with patch.object(lifecycle.subprocess, "Popen", fake_popen), \
                    patch.object(lifecycle.subprocess, "run", fake_run):
                lifecycle.backup(state, backup, phrase)
                manifest = lifecycle.verify_backup(backup)
                self.assertEqual(manifest["route"], "A2_OFFLINE")
                # Sealed with the recovery code: no installation file or dump lies in the folder.
                self.assertEqual(manifest["schemaVersion"], lifecycle.SEALED_SCHEMA)
                self.assertEqual(sorted(p.name for p in backup.iterdir()),
                                 sorted([lifecycle.SEALED_BACKUP, lifecycle.OFFLINE_CA_BACKUP, "manifest.json"]))
                for item in backup.iterdir():
                    content = item.read_bytes()
                    self.assertNotIn(b"synthetic", content)
                    self.assertNotIn(b"MK8DX_HOSTED_AUTH_BASE_URL", content)
                envelope = (backup / lifecycle.OFFLINE_CA_BACKUP).read_bytes()
                self.assertNotIn(b"PRIVATE KEY", envelope)
                self.assertNotIn(b"DPAPI", envelope)
                wrong_phrase = base / "wrong-phrase.txt"
                wrong_phrase.write_text("synthetic-wrong-recovery-phrase", encoding="utf-8")
                before = len(commands)
                with self.assertRaisesRegex(RuntimeError, "recovery code does not open"):
                    lifecycle.restore_new(backup, base / "wrong-restored", wrong_phrase)
                self.assertEqual(len(commands), before)
                self.assertFalse((base / "wrong-restored/offline-ca").exists())
                lifecycle.restore_new(backup, restored, phrase)
                # A new computer on another address: same root, signer and setup page for the new IP.
                moved = base / "moved"
                lifecycle.restore_new(backup, moved, phrase, "192.168.0.77")
                with self.assertRaisesRegex(Exception, "private"):
                    lifecycle.restore_new(backup, base / "public", phrase, "8.8.8.8")

            new_origin = "https://192.168.0.77"
            moved_profile = json.loads((moved / "operator-profile.json").read_text())
            self.assertEqual((moved_profile["origin"], moved_profile["bindAddress"],
                              moved_profile["rootCertificateSha256"]), (new_origin, "192.168.0.77", root_hash))
            self.assertEqual(json.loads((moved / "operator.json").read_text()),
                             {"MK8DX_HOSTED_AUTH_BASE_URL": new_origin,
                              "MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON": json.dumps([new_origin])})
            moved_api = (moved / "api.env").read_text()
            self.assertIn(f"MK8DX_HOSTED_AUTH_BASE_URL='{new_origin}'", moved_api)
            self.assertIn(f"MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON='[\"{new_origin}\"]'", moved_api)
            moved_compose = (moved / "compose.env").read_text()
            for name in ("MK8DX_DOMAIN", "MK8DX_LAN_IP", "MK8DX_BIND_ADDRESS"):
                self.assertIn(f"{name}='192.168.0.77'", moved_compose)
            self.assertEqual(json.loads((moved / "public-client.json").read_text())["websiteOrigin"], new_origin)
            self.assertEqual(json.loads((moved / "offline-ca/metadata.json").read_text())["lanIp"], "192.168.0.77")
            self.assertEqual(offline_lan_ca_lifecycle.validate_signer(moved)["rootCertificateSha256"], root_hash)
            self.assertIn(new_origin, (moved / "offline-ca/setup/index.html").read_text(encoding="utf-8"))

            self.assertEqual(json.loads((restored / "operator-profile.json").read_text())
                             ["rootCertificateSha256"], root_hash)
            self.assertEqual(offline_lan_ca_lifecycle.validate_signer(restored)
                             ["rootCertificateSha256"], root_hash)
            self.assertNotEqual((state / "offline-ca/serving/intermediate.pem").read_bytes(),
                                (restored / "offline-ca/serving/intermediate.pem").read_bytes())
            self.assertTrue(any(command[-4:] == ["--pull", "never", "-d", "mysql"]
                                for command in commands))
            self.assertFalse((backup / "offline-ca/root.key.dpapi").exists())


if __name__ == "__main__":
    unittest.main()
