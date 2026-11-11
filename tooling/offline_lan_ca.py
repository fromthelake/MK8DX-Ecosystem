"""Prepare a disposable-safe, per-installation IP CA for the offline LAN route.

The Windows host retains the encrypted root key. Caddy receives only the public
root and one short-lived, IP-constrained intermediate. This module does not
enable the route, install trust on clients or export any private key to a backup.
"""

from __future__ import annotations

import argparse
import csv
import ctypes
import hashlib
import html
import ipaddress
import json
import os
import plistlib
import re
import stat
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID


ROOT_DAYS = 3600
INTERMEDIATE_DAYS = 7
SCHEMA = "mk8dx.offline-lan-ca.v1"
PRIVATE_NETWORKS = tuple(ipaddress.ip_network(value) for value in
                         ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
# Host names: a new root permits only names under the reserved ".invalid" (RFC 6761), which no real website
# can have, so even a stolen root key cannot vouch for a website name. IP constraints alone left host names
# unconstrained (RFC 5280 constrains only the name types listed). Roots made before 11-11 lack it and stay valid.
ROOT_NAME_SUBTREES = (x509.DNSName("invalid"),)
REPO_ROOT = Path(__file__).resolve().parents[1]


def safe_private_path(value: Path) -> Path:
    path = Path(os.path.abspath(value))
    for part in (*reversed(path.parents), path):
        if part.exists() and (part.is_symlink() or
                              getattr(part.lstat(), "st_file_attributes", 0) &
                              getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)):
            raise ValueError("Private CA path contains a link or junction")
    if path.is_relative_to(REPO_ROOT):
        raise ValueError("Private CA state must remain outside Git")
    return path


def private_lan_ip(value: str) -> ipaddress.IPv4Address:
    address = ipaddress.ip_address(value)
    if not isinstance(address, ipaddress.IPv4Address) or not any(
            address in network for network in PRIVATE_NETWORKS):
        raise ValueError("Choose a private, non-loopback IPv4 address on this host")
    return address


def _name(label: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, label)])


def _builder(subject: x509.Name, issuer: x509.Name, key: ec.EllipticCurvePrivateKey,
             now: datetime, days: int) -> x509.CertificateBuilder:
    return (x509.CertificateBuilder().subject_name(subject).issuer_name(issuer)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(now + timedelta(days=days)))


def _ca_extensions(builder: x509.CertificateBuilder, key: ec.EllipticCurvePrivateKey,
                   issuer_key: ec.EllipticCurvePrivateKey,
                   networks: tuple[ipaddress.IPv4Network, ...],
                   path_length: int, names: tuple[x509.GeneralName, ...] = ()) -> x509.CertificateBuilder:
    return (builder.add_extension(x509.BasicConstraints(ca=True, path_length=path_length), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False,
                           key_encipherment=False, data_encipherment=False, key_agreement=False,
                           key_cert_sign=True, crl_sign=True, encipher_only=False,
                           decipher_only=False), critical=True)
            .add_extension(x509.NameConstraints(permitted_subtrees=[x509.IPAddress(network)
                                                                     for network in networks] + list(names),
                           excluded_subtrees=None), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(
                           issuer_key.public_key()), critical=False))


def _private_pem(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


def _dpapi(data: bytes, *, decrypt: bool) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("Offline LAN root protection requires the Windows host")
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = (("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte)))

    source = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    incoming = Blob(len(data), source)
    outgoing = Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.LocalFree.argtypes = (ctypes.c_void_p,)
    kernel32.LocalFree.restype = ctypes.c_void_p
    func = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    func.argtypes = (ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                     ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob))
    func.restype = wintypes.BOOL
    flags = 0x1 if decrypt else 0x4 | 0x1  # UI forbidden; machine scope when protecting.
    if not func(ctypes.byref(incoming), None, None, None, None, flags, ctypes.byref(outgoing)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        if decrypt:
            ctypes.memset(outgoing.data, 0, outgoing.size)
        kernel32.LocalFree(ctypes.cast(outgoing.data, ctypes.c_void_p))


def protect_root(data: bytes) -> bytes:
    """Windows: DPAPI. Linux/macOS: tooling.host_platform (systemd-creds, Keychain or 0600 file)."""
    if sys.platform == "win32":
        return _dpapi(data, decrypt=False)
    from tooling import host_platform
    return host_platform.protect(data)


def unprotect_root(data: bytes) -> bytes:
    if sys.platform == "win32":
        return _dpapi(data, decrypt=True)
    from tooling import host_platform
    return host_platform.unprotect(data)


def _current_sid() -> str:
    result = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], check=True,
                            capture_output=True, text=True)
    rows = list(csv.reader(result.stdout.splitlines()))
    sid = rows[0][1] if rows and len(rows[0]) == 2 else ""
    if not re.fullmatch(r"S-1-[0-9-]+", sid):
        raise RuntimeError("Could not resolve the current Windows account SID")
    return sid


def _restrict(path: Path, *, directory: bool) -> None:
    os.chmod(path, 0o700 if directory else 0o600)
    if sys.platform != "win32":
        return  # Linux/macOS: the owner-only mode bits above are the protection (ADR-0223 amendment).
    sid = _current_sid()
    suffix = ":(OI)(CI)F" if directory else ":F"
    principals = (sid, "S-1-5-18", "S-1-5-32-544")  # operator, SYSTEM, Administrators
    command = ["icacls", str(path), "/inheritance:r", "/grant:r"]
    command.extend(f"*{principal}{suffix}" for principal in principals)
    subprocess.run(command, check=True, capture_output=True, text=True)


def _write_new(path: Path, content: bytes) -> None:
    with path.open("xb") as stream:
        stream.write(content)
    _restrict(path, directory=False)


def _fingerprints(cert: x509.Certificate) -> dict[str, str]:
    public_key = cert.public_key().public_bytes(serialization.Encoding.DER,
                                                serialization.PublicFormat.SubjectPublicKeyInfo)
    return {"certificateSha256": cert.fingerprint(hashes.SHA256()).hex(),
            "spkiSha256": hashlib.sha256(public_key).hexdigest()}


_SETUP_STYLE = (
    "*{box-sizing:border-box}html,body{margin:0;background:#090d1c;color:#eef1fb;"
    "font:18px/1.55 system-ui,'Segoe UI',sans-serif}main{max-width:640px;margin:0 auto;padding:22px 16px 40px}"
    "h1{font-size:28px;line-height:1.2;margin:4px 0 10px}h2{font-size:20px;margin:0 0 8px}"
    ".brand{font-weight:900;font-style:italic;font-size:22px;color:#f7c948}.lead{color:#a9b1cf}"
    "section,details{background:#111833;border:1px solid #26305a;border-radius:14px;padding:16px;margin:14px 0}"
    "summary{font-weight:700;cursor:pointer;font-size:18px}ol{padding-left:22px;margin:8px 0}li{margin:6px 0}"
    ".button{display:block;text-align:center;background:#f7c948;color:#1b1400;font-weight:800;"
    "text-decoration:none;border-radius:12px;padding:14px 16px;margin:12px 0}"
    ".code{font:600 24px/1.3 Consolas,monospace;letter-spacing:1px;color:#f7c948;overflow-wrap:anywhere}"
    "code,.mono{font-family:Consolas,monospace;overflow-wrap:anywhere;font-size:14px;color:#c9cfe8}"
    ".muted{color:#a9b1cf;font-size:15px}[hidden]{display:none!important}")

_SETUP_TEXT = {
    "en": {
        "title": "Prepare this device", "lead": "Do this once per phone, tablet or PC. Afterwards, scan your "
        "personal sign-in card.", "check": "First check this code. It must match the code on the "
        "'Prepare a device' card or in MK8DX beheer on the host computer:",
        "full": "Full fingerprints", "other": "Another kind of device?", "done": "Done? Scan your personal "
        "sign-in card, or open", "remove": "Leaving this installation? Remove the certificate again in the same settings.",
        "android": ["Tap the button to download the certificate.",
                    "Open Settings and search for “certificate” (often: Security → More security settings → "
                    "Encryption & credentials → Install a certificate → CA certificate).",
                    "Choose the downloaded MK8DX file and confirm with your PIN."],
        "ios": ["Tap the button to download the profile and allow it.",
                "Open Settings → Profile downloaded → Install.",
                "Then Settings → General → About → Certificate Trust Settings → turn on MK8DX."],
        "windows": ["Download the certificate and open it.",
                    "Choose Install Certificate → Current User → Place all certificates in the following store → "
                    "Trusted Root Certification Authorities. Do not choose Intermediate Certification Authorities.",
                    "Restart the browser."],
        "mac": ["Download the certificate and open it; Keychain Access opens.",
                "Open the MK8DX certificate → Trust → Always Trust. (macOS is not yet tested end to end.)"],
        "linux": ["Add the same certificate to your distribution's or browser's trusted root store.",
                  "The exact steps differ by distribution; Linux is not yet tested end to end for this route."],
        "dl_crt": "Download certificate", "dl_ios": "Download profile",
        "names": {"android": "Android", "ios": "iPhone / iPad", "windows": "Windows", "mac": "Mac", "linux": "Linux"},
    },
    "nl": {
        "title": "Dit apparaat voorbereiden", "lead": "Doe dit één keer per telefoon, tablet of pc. Scan daarna je "
        "persoonlijke inlogkaart.", "check": "Controleer eerst deze code. Hij moet gelijk zijn aan de code op "
        "de kaart 'Apparaat voorbereiden' of in MK8DX beheer op de hostcomputer:",
        "full": "Volledige vingerafdrukken", "other": "Ander soort apparaat?", "done": "Klaar? Scan je persoonlijke "
        "inlogkaart, of open", "remove": "Stop je met deze installatie? Verwijder het certificaat weer via dezelfde instellingen.",
        "android": ["Tik op de knop om het certificaat te downloaden.",
                    "Open Instellingen en zoek op “certificaat” (vaak: Beveiliging → Meer beveiligingsinstellingen → "
                    "Versleuteling en inloggegevens → Certificaat installeren → CA-certificaat).",
                    "Kies het gedownloade MK8DX-bestand en bevestig met je pincode."],
        "ios": ["Tik op de knop om het profiel te downloaden en sta het toe.",
                "Open Instellingen → Profiel gedownload → Installeer.",
                "Daarna Instellingen → Algemeen → Info → Certificaatvertrouwen → zet MK8DX aan."],
        "windows": ["Download het certificaat en open het.",
                    "Kies Certificaat installeren → Huidige gebruiker → Alle certificaten in het onderstaande archief "
                    "plaatsen → Vertrouwde basiscertificeringsinstanties. Kies niet Tussenliggende certificeringsinstanties.",
                    "Herstart de browser."],
        "mac": ["Download het certificaat en open het; Sleutelhangertoegang opent.",
                "Open het MK8DX-certificaat → Vertrouw → Altijd vertrouwen. (macOS is nog niet volledig getest.)"],
        "linux": ["Voeg hetzelfde certificaat toe aan de vertrouwde basiscertificaten van je distributie of browser.",
                  "De stappen verschillen per distributie; Linux is nog niet volledig getest voor deze route."],
        "dl_crt": "Certificaat downloaden", "dl_ios": "Profiel downloaden",
        "names": {"android": "Android", "ios": "iPhone / iPad", "windows": "Windows", "mac": "Mac", "linux": "Linux"},
    },
}


def setup_page(origin: str, fp: dict) -> str:
    """Mobile-first /setup page: the visitor's own platform first, in the device language.

    Static and self-contained (served over plain HTTP before trust exists); readable without
    JavaScript, which only selects the language and opens the matching platform."""
    short = " ".join(fp["certificateSha256"][i:i + 4].upper() for i in range(0, 16, 4))
    parts = ["<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
             "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
             "<title>MK8DX</title><style>", _SETUP_STYLE, "</style></head><body><main>"]
    for lang, text in _SETUP_TEXT.items():
        parts.append(f"<div class=\"lang\" lang=\"{lang}\" data-lang=\"{lang}\">")
        parts.append(f"<div class=\"brand\">MK8DX</div><h1>{html.escape(text['title'])}</h1>"
                     f"<p class=\"lead\">{html.escape(text['lead'])}</p>")
        parts.append(f"<section><p>{html.escape(text['check'])}</p><p class=\"code\">{short}</p>"
                     f"<details><summary>{html.escape(text['full'])}</summary>"
                     f"<p class=\"mono\">Root certificate SHA-256: {fp['certificateSha256']}</p>"
                     f"<p class=\"mono\">Root public key SHA-256 (SPKI): {fp['spkiSha256']}</p></details></section>")
        for platform in ("android", "ios", "windows", "mac", "linux"):
            link = "/setup/root.mobileconfig" if platform == "ios" else "/setup/root.crt"
            label = text["dl_ios"] if platform == "ios" else text["dl_crt"]
            steps = "".join(f"<li>{html.escape(step)}</li>" for step in text[platform])
            parts.append(f"<details class=\"platform\" data-platform=\"{platform}\"><summary>"
                         f"{html.escape(text['names'][platform])}</summary>"
                         f"<a class=\"button\" href=\"{link}\">{html.escape(label)}</a><ol>{steps}</ol></details>")
        parts.append(f"<p class=\"other muted\" hidden>{html.escape(text['other'])}</p>")
        parts.append(f"<section><p>{html.escape(text['done'])} <code>{html.escape(origin)}</code></p>"
                     f"<p class=\"muted\">{html.escape(text['remove'])}</p></section></div>")
    parts.append(
        "<script>(function(){var nl=(navigator.language||'').toLowerCase().indexOf('nl')===0;"
        "var ua=navigator.userAgent||'';var p=/android/i.test(ua)?'android':/iphone|ipad|ipod/i.test(ua)||"
        "(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1)?'ios':/windows/i.test(ua)?'windows':"
        "/Macintosh/.test(ua)?'mac':/linux/i.test(ua)?'linux':null;"
        "document.querySelectorAll('.lang').forEach(function(b){var mine=b.dataset.lang===(nl?'nl':'en');"
        "b.hidden=!mine;if(!mine)return;document.documentElement.lang=b.dataset.lang;"
        "var first=b.querySelector('details.platform[data-platform=\"'+p+'\"]');"
        "if(first){first.open=true;b.insertBefore(first,b.querySelector('details.platform'));"
        "var o=b.querySelector('.other');o.hidden=false;first.after(o);}});})();</script>")
    parts.append("</main></body></html>\n")
    return "".join(parts)


def _setup_files(directory: Path, cert: x509.Certificate, address: ipaddress.IPv4Address) -> None:
    der = cert.public_bytes(serialization.Encoding.DER)
    fp = _fingerprints(cert)
    origin = f"https://{address}"
    _write_new(directory / "index.html", setup_page(origin, fp).encode("utf-8"))
    _write_new(directory / "root.crt", der)
    payload_id = f"nl.mariokart8.offline-lan.{uuid.uuid4()}"
    profile = {"PayloadContent": [{"PayloadCertificateFileName": "MK8DX Offline LAN Root.crt",
                                    "PayloadContent": der,
                                    "PayloadDescription": "MK8DX offline LAN root",
                                    "PayloadDisplayName": "MK8DX offline LAN root",
                                    "PayloadIdentifier": payload_id + ".root",
                                    "PayloadType": "com.apple.security.root",
                                    "PayloadUUID": str(uuid.uuid4()).upper(),
                                    "PayloadVersion": 1}],
               "PayloadDisplayName": "MK8DX offline LAN certificate",
               "PayloadIdentifier": payload_id,
               "PayloadOrganization": "MK8DX",
               "PayloadRemovalDisallowed": False,
               "PayloadType": "Configuration",
               "PayloadUUID": str(uuid.uuid4()).upper(),
               "PayloadVersion": 1}
    _write_new(directory / "root.mobileconfig", plistlib.dumps(profile))


def _issue_intermediate(root_key: ec.EllipticCurvePrivateKey, root: x509.Certificate,
                        address: ipaddress.IPv4Address,
                        now: datetime) -> tuple[ec.EllipticCurvePrivateKey, x509.Certificate]:
    key = ec.generate_private_key(ec.SECP256R1())
    cert = _ca_extensions(_builder(_name("MK8DX offline LAN intermediate"), root.subject,
                                   key, now, INTERMEDIATE_DAYS), key, root_key,
                          (ipaddress.ip_network(f"{address}/32"),), 0).sign(root_key, hashes.SHA256())
    return key, cert


def _verify_root(root_key: ec.EllipticCurvePrivateKey, root: x509.Certificate,
                 now: datetime) -> None:
    if root_key.public_key().public_numbers() != root.public_key().public_numbers():
        raise ValueError("Root key and certificate disagree")
    if root.not_valid_before_utc > now or root.not_valid_after_utc <= now + timedelta(days=8):
        raise ValueError("Root certificate is not usable for a new intermediate")
    root.public_key().verify(root.signature, root.tbs_certificate_bytes,
                             ec.ECDSA(root.signature_hash_algorithm))
    if root.extensions.get_extension_for_class(x509.BasicConstraints).value.path_length != 1:
        raise ValueError("Root path constraint is invalid")
    expected = [x509.IPAddress(network) for network in PRIVATE_NETWORKS]
    permitted = root.extensions.get_extension_for_class(x509.NameConstraints).value.permitted_subtrees
    if permitted not in (expected, expected + list(ROOT_NAME_SUBTREES)):
        raise ValueError("Root IP constraints are invalid")


def _provision_material(state_dir: Path, address: ipaddress.IPv4Address,
                        root_key: ec.EllipticCurvePrivateKey, root: x509.Certificate,
                        protect: Callable[[bytes], bytes]) -> dict:
    state_dir = safe_private_path(state_dir)
    if not state_dir.is_dir():
        raise ValueError("Use an existing, private installation state directory")
    now = datetime.now(timezone.utc)
    _verify_root(root_key, root, now)
    target = state_dir / "offline-ca"
    if target.exists():
        raise FileExistsError("Offline CA already exists; never regenerate it during an update")
    target.mkdir(mode=0o700)
    _restrict(target, directory=True)
    serving, setup = target / "serving", target / "setup"
    serving.mkdir(mode=0o700)
    setup.mkdir(mode=0o700)
    _restrict(serving, directory=True)
    _restrict(setup, directory=True)
    intermediate_key, intermediate = _issue_intermediate(root_key, root, address, now)
    _write_new(target / "root.key.dpapi", protect(_private_pem(root_key)))
    _write_new(serving / "root.pem", root.public_bytes(serialization.Encoding.PEM))
    _write_new(serving / "intermediate.pem", intermediate.public_bytes(serialization.Encoding.PEM))
    _write_new(serving / "intermediate.key", _private_pem(intermediate_key))
    _setup_files(setup, root, address)
    metadata = {"schema": SCHEMA, "lanIp": str(address), "origin": f"https://{address}",
                "root": _fingerprints(root),
                "intermediateExpiresAt": intermediate.not_valid_after_utc.isoformat(),
                "rotationDueAt": (now + timedelta(days=5)).isoformat()}
    _write_new(target / "metadata.json", (json.dumps(metadata, indent=2) + "\n").encode())
    return metadata


def provision(state_dir: Path, ip: str, *, protect: Callable[[bytes], bytes] = protect_root) -> dict:
    address = private_lan_ip(ip)
    now = datetime.now(timezone.utc)
    root_key = ec.generate_private_key(ec.SECP256R1())
    root_name = _name("MK8DX offline LAN root")
    root = _ca_extensions(_builder(root_name, root_name, root_key, now, ROOT_DAYS),
                          root_key, root_key, PRIVATE_NETWORKS, 1, ROOT_NAME_SUBTREES).sign(root_key, hashes.SHA256())
    return _provision_material(state_dir, address, root_key, root, protect)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--lan-ip", required=True)
    args = parser.parse_args()
    if not (sys.platform == "win32" or sys.platform.startswith("linux") or sys.platform == "darwin"):
        parser.error("offline LAN provisioning needs Windows, Linux or macOS")
    metadata = provision(args.state_dir, args.lan_ip)
    print(json.dumps({"origin": metadata["origin"],
                      "rootCertificateSha256": metadata["root"]["certificateSha256"],
                      "rootSpkiSha256": metadata["root"]["spkiSha256"]}))


if __name__ == "__main__":
    main()
