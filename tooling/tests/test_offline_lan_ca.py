"""Certificate and exposure checks for the optional offline LAN foundation."""

import hashlib
import ipaddress
import plistlib
import re
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
                                 [x509.IPAddress(network) for network in offline_lan_ca.PRIVATE_NETWORKS]
                                 + [x509.DNSName("invalid")])
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
                self.assertIn('name="viewport"', page)
                self.assertIn("Vertrouwde basiscertificeringsinstanties", page)  # Dutch next to English
                self.assertIn(metadata["root"]["certificateSha256"][:4].upper(), page)  # short code to compare
                self.assertIn("Trusted Root Certification Authorities", page)
                self.assertIn("Linux is not yet tested end to end", page)
                self.assertNotIn("token", page.lower())
                with self.assertRaises(FileExistsError):
                    offline_lan_ca.provision(state, "192.168.12.34",
                                             protect=lambda value: b"another")
            self.assertNotEqual(roots[0], roots[1])

    def test_the_certificate_download_has_a_descriptive_file_name(self):
        """Phones collected root.crt, root (1).crt, ...; the page links a name with the check code and the root date,
        and the gateway serves exactly that shape with the root's bytes and a matching Content-Disposition."""
        caddy = (Path(__file__).resolve().parents[2] / "infrastructure/docker/Caddyfile.offline-lan").read_text(
            encoding="utf-8")
        pattern = re.search(r"@setup_named_crt path_regexp (\S+)\n", caddy).group(1)
        block = caddy[caddy.index("handle @setup_named_crt {"):]
        block = block[:block.index("\n  }\n")]
        self.assertIn('header Content-Disposition "attachment; filename=\\"{http.request.orig_uri.path.file}\\""',
                      block)
        self.assertIn("rewrite * /root.crt", block)
        self.assertLess(caddy.index("handle @setup_named_crt {"), caddy.index("\nhttps://"), "plain-HTTP site only")
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state"
            state.mkdir()
            metadata = offline_lan_ca.provision(state, "192.168.12.34", protect=lambda value: b"synthetic")
            root = x509.load_pem_x509_certificate((state / "offline-ca/serving/root.pem").read_bytes())
            name = offline_lan_ca.certificate_file_name(root)
            self.assertEqual(name, f"MK8DX-{metadata['root']['certificateSha256'][:8].upper()}-"
                                   f"{root.not_valid_before_utc:%Y-%m-%d}.crt")
            self.assertRegex(f"/setup/{name}", pattern)
            for wrong in ("/setup/root.crt", "/setup/MK8DX-8ab95020-2026-11-16.crt", "/setup/MK8DX-8AB95020-x.crt",
                          "/setup/MK8DX-8AB95020-2026-11-16.crt/../index.html"):
                self.assertNotRegex(wrong, pattern)
            page = (state / "offline-ca/setup/index.html").read_text(encoding="utf-8")
            self.assertIn(f'href="/setup/{name}"', page)
            self.assertNotIn('href="/setup/root.crt"', page)
            self.assertIn(f"The file is called {name}.", page)
            self.assertIn("Choose Keep", page)  # Chrome's "cannot be downloaded securely" prompt
            self.assertIn("Installeren vanuit opslag", page)  # the vivo route checked on a real phone
            self.assertIn('<ol class="steps"', page)

    @unittest.skipUnless(sys.platform == "win32", "Windows DPAPI only")
    def test_windows_dpapi_machine_round_trip(self):
        original = hashlib.sha256(b"disposable fixture").digest()
        protected = offline_lan_ca.protect_root(original)
        self.assertNotEqual(protected, original)
        self.assertEqual(offline_lan_ca.unprotect_root(protected), original)


if __name__ == "__main__":
    unittest.main()
