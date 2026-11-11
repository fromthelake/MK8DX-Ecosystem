"""Recovery and renewal invariants for the offline LAN CA."""

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from tooling import offline_lan_ca as ca
from tooling import offline_lan_ca_lifecycle as lifecycle


class CaLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.key = AESGCM.generate_key(bit_length=256)

    def protect(self, data: bytes) -> bytes:
        nonce = os.urandom(12)
        return nonce + AESGCM(self.key).encrypt(nonce, data, None)

    def unprotect(self, data: bytes) -> bytes:
        return AESGCM(self.key).decrypt(data[:12], data[12:], None)

    def test_owner_encrypted_recovery_keeps_ca_and_can_change_ip(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original, restored = root / "original", root / "restored"
            original.mkdir()
            restored.mkdir()
            first = ca.provision(original, "192.168.12.34", protect=self.protect)
            export = root / "offline-ca-recovery.json"
            result = lifecycle.export_recovery(original, export, "disposable-owner-recovery-phrase",
                                               unprotect=self.unprotect)
            self.assertEqual(result["rootCertificateSha256"],
                             first["root"]["certificateSha256"])
            self.assertNotIn(b"PRIVATE KEY", export.read_bytes())
            with self.assertRaisesRegex(ValueError, "Recovery passphrase"):
                lifecycle.restore_recovery(export, restored, "10.2.3.4",
                                           "incorrect-recovery-phrase", protect=self.protect)
            self.assertFalse((restored / "offline-ca").exists())
            second = lifecycle.restore_recovery(export, restored, "10.2.3.4",
                                                "disposable-owner-recovery-phrase",
                                                protect=self.protect)
            self.assertEqual(first["root"], second["root"])
            self.assertEqual(second["origin"], "https://10.2.3.4")
            self.assertNotEqual((original / "offline-ca/serving/intermediate.pem").read_bytes(),
                                (restored / "offline-ca/serving/intermediate.pem").read_bytes())
            self.assertIn("10.2.3.4", (restored / "offline-ca/setup/index.html").read_text(encoding="utf-8"))
            self.assertEqual(x509.load_pem_x509_certificate(
                (original / "offline-ca/serving/root.pem").read_bytes()),
                x509.load_pem_x509_certificate(
                    (restored / "offline-ca/serving/root.pem").read_bytes()))
            with self.assertRaises(FileExistsError):
                lifecycle.restore_recovery(export, restored, "10.2.3.4",
                                           "disposable-owner-recovery-phrase", protect=self.protect)
            self.assertEqual(len(list((restored / "offline-ca/setup").iterdir())), 3)

    def test_rotation_keeps_root_and_replaces_signer(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state"
            state.mkdir()
            before = ca.provision(state, "172.20.1.2", protect=self.protect)
            signer = state / "offline-ca/serving/intermediate.pem"
            old = x509.load_pem_x509_certificate(signer.read_bytes())
            root_blob = (state / "offline-ca/root.key.dpapi").read_bytes()
            result = lifecycle.rotate_intermediate(state, unprotect=self.unprotect)
            new = x509.load_pem_x509_certificate(signer.read_bytes())
            self.assertNotEqual(old.serial_number, new.serial_number)
            self.assertEqual(result["rootCertificateSha256"],
                             before["root"]["certificateSha256"])
            self.assertEqual((state / "offline-ca/root.key.dpapi").read_bytes(), root_blob)
            self.assertEqual(result["intermediateExpiresAt"], new.not_valid_after_utc.isoformat())
            metadata = json.loads((state / "offline-ca/metadata.json").read_text())
            self.assertEqual(metadata["intermediateExpiresAt"],
                             result["intermediateExpiresAt"])

    def test_rotation_restores_old_signer_when_a_replace_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state"
            state.mkdir()
            ca.provision(state, "172.20.1.2", protect=self.protect)
            paths = [state / "offline-ca/serving/intermediate.pem",
                     state / "offline-ca/serving/intermediate.key",
                     state / "offline-ca/metadata.json"]
            before = [path.read_bytes() for path in paths]
            native_replace = os.replace
            calls = 0

            def fail_second_replace(source, destination):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("injected replacement failure")
                return native_replace(source, destination)

            with patch.object(lifecycle.os, "replace", side_effect=fail_second_replace):
                with self.assertRaisesRegex(OSError, "injected replacement failure"):
                    lifecycle.rotate_intermediate(state, unprotect=self.unprotect)
            self.assertEqual([path.read_bytes() for path in paths], before)
            lifecycle.validate_signer(state, unprotect=self.unprotect)

    def test_expired_signer_can_be_checked_only_for_rotation(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state"
            state.mkdir()
            ca.provision(state, "172.20.1.2", protect=self.protect)
            future = datetime.now(timezone.utc) + timedelta(days=8)
            with patch.object(lifecycle, "datetime") as clock:
                clock.now.return_value = future
                with self.assertRaisesRegex(ValueError, "outside its validity"):
                    lifecycle.validate_signer(state, unprotect=self.unprotect)
                self.assertIn("rotationDueAt", lifecycle.validate_signer(
                    state, unprotect=self.unprotect, allow_expired=True))

    def test_mismatched_signer_refuses_recovery_export_and_start_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            first, second = base / "first", base / "second"
            first.mkdir()
            second.mkdir()
            ca.provision(first, "192.168.1.2", protect=self.protect)
            ca.provision(second, "192.168.1.3", protect=self.protect)
            signer = first / "offline-ca/serving/intermediate.key"
            signer.write_bytes((second / "offline-ca/serving/intermediate.key").read_bytes())
            with self.assertRaisesRegex(ValueError, "signer key or issuer mismatch"):
                lifecycle.validate_signer(first, unprotect=self.unprotect)
            with self.assertRaisesRegex(ValueError, "signer key or issuer mismatch"):
                lifecycle.export_recovery(first, base / "backup.json",
                                          "disposable-owner-recovery-phrase",
                                          unprotect=self.unprotect)
            self.assertFalse((base / "backup.json").exists())


if __name__ == "__main__":
    unittest.main()
