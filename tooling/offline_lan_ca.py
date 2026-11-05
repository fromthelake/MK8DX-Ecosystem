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
                   path_length: int) -> x509.CertificateBuilder:
    return (builder.add_extension(x509.BasicConstraints(ca=True, path_length=path_length), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False,
                           key_encipherment=False, data_encipherment=False, key_agreement=False,
                           key_cert_sign=True, crl_sign=True, encipher_only=False,
                           decipher_only=False), critical=True)
            .add_extension(x509.NameConstraints(permitted_subtrees=[x509.IPAddress(network)
                                                                     for network in networks],
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
    return _dpapi(data, decrypt=False)


def unprotect_root(data: bytes) -> bytes:
    return _dpapi(data, decrypt=True)


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
        return  # Linux unit tests only; the production CLI rejects non-Windows hosts.
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


def _setup_files(directory: Path, cert: x509.Certificate, address: ipaddress.IPv4Address) -> None:
    der = cert.public_bytes(serialization.Encoding.DER)
    fp = _fingerprints(cert)
    origin = f"https://{address}"
    page = ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>MK8DX offline LAN setup</title><h1>Offline LAN setup</h1>"
            "<p>Compare these fingerprints with the host's localhost administration screen "
            "before installing trust. This HTTP page cannot prove its own identity.</p>"
            f"<p>HTTPS origin: <code>{html.escape(origin)}</code></p>"
            f"<p>Root certificate SHA-256: <code>{fp['certificateSha256']}</code></p>"
            f"<p>Root public key SHA-256 (SPKI): <code>{fp['spkiSha256']}</code></p>"
            "<p><a href=\"/setup/root.crt\">Android/Windows certificate (.crt)</a>"
            " · <a href=\"/setup/root.mobileconfig\">iPhone/iPad profile (.mobileconfig)</a></p>"
            "<p>Android: install the certificate only after comparing the host screen. "
            "iPhone/iPad: install the profile, then enable full trust in Settings. "
            "Windows: import into the intended account's trusted roots after comparison. "
            "Remove trust when leaving this installation.</p></html>\n")
    _write_new(directory / "index.html", page.encode("utf-8"))
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
    if root.extensions.get_extension_for_class(x509.NameConstraints).value.permitted_subtrees != expected:
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
                          root_key, root_key, PRIVATE_NETWORKS, 1).sign(root_key, hashes.SHA256())
    return _provision_material(state_dir, address, root_key, root, protect)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--lan-ip", required=True)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("offline LAN provisioning currently requires a Windows host")
    metadata = provision(args.state_dir, args.lan_ip)
    print(json.dumps({"origin": metadata["origin"],
                      "rootCertificateSha256": metadata["root"]["certificateSha256"],
                      "rootSpkiSha256": metadata["root"]["spkiSha256"]}))


if __name__ == "__main__":
    main()
