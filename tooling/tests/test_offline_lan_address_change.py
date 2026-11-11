"""A2 offline moves to a new LAN address with the same root CA (ADR-0223 IP change)."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling import install
from tooling import offline_lan_ca
from tooling import offline_lan_ca_lifecycle


def _installation(state: Path, ip: str) -> str:
    state.mkdir()
    ca = offline_lan_ca.provision(state, ip)
    origin = f"https://{ip}"
    (state / install.PROFILE).write_text(json.dumps({
        "route": "A2_OFFLINE", "origin": origin, "bindAddress": ip, "project": "mk8dx-qa",
        "rootCertificateSha256": ca["root"]["certificateSha256"]}), encoding="utf-8")
    (state / "operator.json").write_text(json.dumps({"MK8DX_HOSTED_AUTH_BASE_URL": origin,
                                                     "MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON": json.dumps([origin])}))
    (state / "api.env").write_text(f"MK8DX_HOSTED_AUTH_BASE_URL='{origin}'\n"
                                   f"MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON='[\"{origin}\"]'\n"
                                   "MK8DX_OFFLINE_LAN='true'\n")
    (state / install.PUBLIC).write_text(json.dumps({"schemaVersion": "mk8dx.public-client.v1",
                                                    "websiteOrigin": origin,
                                                    "authenticationMode": "offline-invitation"}))
    (state / "compose.env").write_text(f"MK8DX_PROJECT_NAME='mk8dx-qa'\nMK8DX_DOMAIN='{ip}'\nMK8DX_LAN_IP='{ip}'\n"
                                       f"MK8DX_BIND_ADDRESS='{ip}'\nMK8DX_OFFLINE_HOST_PORT='19090'\n")
    return ca["root"]["certificateSha256"]


@unittest.skipUnless(sys.platform == "win32", "A2 root protection uses Windows DPAPI")
class OfflineAddressChangeTest(unittest.TestCase):
    def test_move_keeps_root_and_rewrites_every_origin(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state"
            root_hash = _installation(state, "192.168.50.30")
            old_signer = (state / "offline-ca/serving/intermediate.pem").read_bytes()
            with patch.object(install, "safe_state_dir", side_effect=lambda s, existing=False: Path(s)):
                self.assertTrue(install.move_offline_address(state, "192.168.1.50"))
                self.assertFalse(install.move_offline_address(state, "192.168.1.50"))
            new = "https://192.168.1.50"
            profile = json.loads((state / install.PROFILE).read_text(encoding="utf-8"))
            self.assertEqual((profile["origin"], profile["bindAddress"], profile["rootCertificateSha256"]),
                             (new, "192.168.1.50", root_hash))
            api = install.read_dotenv(state / "api.env")
            self.assertEqual((api["MK8DX_HOSTED_AUTH_BASE_URL"], api["MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON"],
                              api["MK8DX_OFFLINE_LAN"]), (new, json.dumps([new]), "true"))
            self.assertEqual(json.loads((state / "operator.json").read_text())["MK8DX_HOSTED_AUTH_BASE_URL"], new)
            public = json.loads((state / install.PUBLIC).read_text())
            self.assertEqual((public["websiteOrigin"], public["authenticationMode"]), (new, "offline-invitation"))
            compose = install.read_dotenv(state / "compose.env")
            self.assertEqual({compose[k] for k in ("MK8DX_DOMAIN", "MK8DX_LAN_IP", "MK8DX_BIND_ADDRESS")},
                             {"192.168.1.50"})
            self.assertEqual(compose["MK8DX_OFFLINE_HOST_PORT"], "19090")
            signer = offline_lan_ca_lifecycle.validate_signer(state)
            self.assertEqual(signer["rootCertificateSha256"], root_hash)
            self.assertNotEqual((state / "offline-ca/serving/intermediate.pem").read_bytes(), old_signer)
            self.assertIn(new, (state / "offline-ca/setup/index.html").read_text(encoding="utf-8"))
            self.assertEqual(sorted(p.name for p in (state / "offline-ca").iterdir()),
                             ["metadata.json", "root.key.dpapi", "serving", "setup"])

    def test_failed_signer_write_leaves_the_old_address_intact(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state"
            _installation(state, "192.168.50.30")
            before = {p.relative_to(state): p.read_bytes() for p in state.rglob("*") if p.is_file()}
            real = offline_lan_ca_lifecycle.validate_signer
            calls = []

            def failing(*args, **kwargs):
                calls.append(1)
                if len(calls) == 1:
                    raise ValueError("synthetic validation failure")
                return real(*args, **kwargs)
            with patch.object(install, "safe_state_dir", side_effect=lambda s, existing=False: Path(s)), \
                    patch.object(offline_lan_ca_lifecycle, "validate_signer", side_effect=failing):
                with self.assertRaisesRegex(ValueError, "synthetic"):
                    install.move_offline_address(state, "192.168.1.50")
            after = {p.relative_to(state): p.read_bytes() for p in state.rglob("*") if p.is_file()}
            self.assertEqual(after, before)
            self.assertEqual(offline_lan_ca_lifecycle.validate_signer(state)["rootCertificateSha256"],
                             json.loads((state / install.PROFILE).read_text())["rootCertificateSha256"])

    def test_public_address_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state"
            _installation(state, "192.168.50.30")
            with patch.object(install, "safe_state_dir", side_effect=lambda s, existing=False: Path(s)):
                with self.assertRaises(ValueError):
                    install.move_offline_address(state, "8.8.8.8")


if __name__ == "__main__":
    unittest.main()
