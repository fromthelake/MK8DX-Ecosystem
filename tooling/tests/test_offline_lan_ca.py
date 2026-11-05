"""Certificate and exposure checks for the optional offline LAN foundation."""

import hashlib
import ipaddress
import plistlib
import sys
import tempfile
import unittest
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from tooling import offline_lan_ca


class OfflineLanCaTest(unittest.TestCase):
    def test_private_address_gate(self):
        self.assertEqual(str(offline_lan_ca.private_lan_ip("192.168.12.34")), "192.168.12.34")
        for value in ("127.0.0.1", "169.254.1.2", "8.8.8.8", "0.0.0.0", "224.0.0.1", "::1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                offline_lan_ca.private_lan_ip(value)

    def test_unique_ca_constrained_intermediate_and_only_setup_files(self):
        roots = []
        with tempfile.TemporaryDirectory() as temporary:
            for index in range(2):
                state = Path(temporary) / f"state-{index}"
                state.mkdir()
                metadata = offline_lan_ca.provision(
                    state, "192.168.12.34", protect=lambda value: b"synthetic-test-protector")
                ca = state / "offline-ca"
                root = x509.load_pem_x509_certificate((ca / "serving/root.pem").read_bytes())
                intermediate = x509.load_pem_x509_certificate(
                    (ca / "serving/intermediate.pem").read_bytes())
                roots.append(metadata["root"]["certificateSha256"])
                root.public_key().verify(intermediate.signature, intermediate.tbs_certificate_bytes,
                                         ec.ECDSA(intermediate.signature_hash_algorithm))
                root_limits = root.extensions.get_extension_for_class(x509.NameConstraints).value
                self.assertEqual(root_limits.permitted_subtrees,
                                 [x509.IPAddress(network) for network in offline_lan_ca.PRIVATE_NETWORKS])
                limits = intermediate.extensions.get_extension_for_class(x509.NameConstraints).value
                self.assertEqual(limits.permitted_subtrees,
                                 [x509.IPAddress(ipaddress.ip_network("192.168.12.34/32"))])
                self.assertEqual(intermediate.extensions.get_extension_for_class(
                    x509.BasicConstraints).value.path_length, 0)
                self.assertLessEqual((intermediate.not_valid_after_utc -
                                      intermediate.not_valid_before_utc).days, 7)
                self.assertEqual({path.name for path in (ca / "setup").iterdir()},
                                 {"index.html", "root.crt", "root.mobileconfig"})
                self.assertEqual(x509.load_der_x509_certificate(
                    (ca / "setup/root.crt").read_bytes()), root)
                mobile = plistlib.loads((ca / "setup/root.mobileconfig").read_bytes())
                self.assertEqual(mobile["PayloadContent"][0]["PayloadContent"],
                                 root.public_bytes(serialization.Encoding.DER))
                self.assertEqual((ca / "root.key.dpapi").read_bytes(), b"synthetic-test-protector")
                self.assertFalse(any(path.name.startswith("root.key") for path in
                                     (ca / "serving").iterdir()))
                page = (ca / "setup/index.html").read_text(encoding="utf-8")
                self.assertIn(metadata["root"]["certificateSha256"], page)
                self.assertIn(metadata["root"]["spkiSha256"], page)
                self.assertNotIn("token", page.lower())
                with self.assertRaises(FileExistsError):
                    offline_lan_ca.provision(state, "192.168.12.34",
                                             protect=lambda value: b"another")
            self.assertNotEqual(roots[0], roots[1])

    @unittest.skipUnless(sys.platform == "win32", "Windows DPAPI only")
    def test_windows_dpapi_machine_round_trip(self):
        original = hashlib.sha256(b"disposable fixture").digest()
        protected = offline_lan_ca.protect_root(original)
        self.assertNotEqual(protected, original)
        self.assertEqual(offline_lan_ca.unprotect_root(protected), original)


if __name__ == "__main__":
    unittest.main()
