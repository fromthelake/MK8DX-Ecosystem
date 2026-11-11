"""Offline LAN CA recovery and intermediate maintenance primitives.

Only the host installer may call rotation, while the Caddy gateway is stopped.
Recovery requires an owner-held passphrase and a new empty installation state.
No API or public setup route exposes these functions.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import stat
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from cryptography import x509
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from tooling import offline_lan_ca as ca


BACKUP_SCHEMA = "mk8dx.offline-lan-ca-recovery.v1"
KDF_N, KDF_R, KDF_P = 32768, 8, 1
MAX_BACKUP_BYTES = 50_000


def _regular(path: Path) -> bytes:
    path = ca.safe_private_path(path)
    if not path.is_file() or path.is_symlink() or (getattr(path.lstat(), "st_file_attributes", 0) &
                                                  getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)):
        raise ValueError("Expected an unlinked private CA file")
    return path.read_bytes()


def _material(state_dir: Path, unprotect: Callable[[bytes], bytes]):
    root_dir = ca.safe_private_path(state_dir) / "offline-ca"
    metadata = json.loads(_regular(root_dir / "metadata.json"))
    if metadata.get("schema") != ca.SCHEMA:
        raise ValueError("Unknown offline CA state")
    root = x509.load_pem_x509_certificate(_regular(root_dir / "serving/root.pem"))
    root_key = serialization.load_pem_private_key(
        unprotect(_regular(root_dir / "root.key.dpapi")), password=None)
    if not isinstance(root_key, ca.ec.EllipticCurvePrivateKey):
        raise ValueError("Unexpected root key type")
    ca._verify_root(root_key, root, datetime.now(timezone.utc))
    if ca._fingerprints(root) != metadata.get("root"):
        raise ValueError("Root fingerprint differs from installation state")
    return root_key, root, metadata


def _derive(passphrase: str, salt: bytes) -> bytes:
    if len(passphrase) < 16:
        raise ValueError("Use an owner-held recovery phrase of at least 16 characters")
    return Scrypt(salt=salt, length=32, n=KDF_N, r=KDF_R, p=KDF_P).derive(
        passphrase.encode("utf-8"))


def validate_signer(state_dir: Path,
                    *, unprotect: Callable[[bytes], bytes] = ca.unprotect_root,
                    allow_expired: bool = False) -> dict:
    root_key, root, metadata = _material(state_dir, unprotect)
    serving = ca.safe_private_path(state_dir) / "offline-ca/serving"
    cert = x509.load_pem_x509_certificate(_regular(serving / "intermediate.pem"))
    key = serialization.load_pem_private_key(_regular(serving / "intermediate.key"), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey) or \
            key.public_key().public_numbers() != cert.public_key().public_numbers() or \
            cert.issuer != root.subject:
        raise ValueError("Offline signer key or issuer mismatch")
    root.public_key().verify(cert.signature, cert.tbs_certificate_bytes,
                             ec.ECDSA(cert.signature_hash_algorithm))
    now = datetime.now(timezone.utc)
    if cert.not_valid_before_utc > now or (not allow_expired and cert.not_valid_after_utc <= now):
        raise ValueError("Offline signer is outside its validity period")
    expected = [x509.IPAddress(ca.ipaddress.ip_network(f"{metadata['lanIp']}/32"))]
    if cert.extensions.get_extension_for_class(x509.NameConstraints).value.permitted_subtrees != expected or \
            cert.extensions.get_extension_for_class(x509.BasicConstraints).value.path_length != 0 or \
            cert.not_valid_after_utc.isoformat() != metadata["intermediateExpiresAt"]:
        raise ValueError("Offline signer constraints or state mismatch")
    return {"rootCertificateSha256": metadata["root"]["certificateSha256"],
            "intermediateExpiresAt": metadata["intermediateExpiresAt"],
            "rotationDueAt": metadata["rotationDueAt"]}


def export_recovery(state_dir: Path, output: Path, passphrase: str,
                    *, unprotect: Callable[[bytes], bytes] = ca.unprotect_root) -> dict:
    output = ca.safe_private_path(output)
    if output.exists():
        raise FileExistsError("Recovery export already exists")
    if not output.parent.is_dir():
        raise ValueError("Recovery export must be outside Git in an existing private directory")
    validate_signer(state_dir, unprotect=unprotect)
    root_key, root, metadata = _material(state_dir, unprotect)
    salt, nonce = os.urandom(16), os.urandom(12)
    associated = f"{BACKUP_SCHEMA}|{metadata['root']['certificateSha256']}".encode()
    ciphertext = AESGCM(_derive(passphrase, salt)).encrypt(nonce, ca._private_pem(root_key),
                                                          associated)
    document = {"schema": BACKUP_SCHEMA, "createdUtc": datetime.now(timezone.utc).isoformat(),
                "rootCertificateSha256": metadata["root"]["certificateSha256"],
                "rootCertificatePem": base64.b64encode(root.public_bytes(
                    serialization.Encoding.PEM)).decode(),
                "kdf": {"name": "scrypt", "n": KDF_N, "r": KDF_R, "p": KDF_P,
                        "salt": base64.b64encode(salt).decode()},
                "cipher": {"name": "AES-256-GCM", "nonce": base64.b64encode(nonce).decode(),
                           "ciphertext": base64.b64encode(ciphertext).decode()}}
    ca._write_new(output, (json.dumps(document, indent=2) + "\n").encode())
    return {"rootCertificateSha256": metadata["root"]["certificateSha256"],
            "backupSha256": hashlib.sha256(output.read_bytes()).hexdigest()}


def restore_recovery(backup: Path, target_state: Path, ip: str, passphrase: str,
                     *, protect: Callable[[bytes], bytes] = ca.protect_root) -> dict:
    raw = _regular(backup)
    if len(raw) > MAX_BACKUP_BYTES:
        raise ValueError("Recovery file is too large")
    document = json.loads(raw)
    if document.get("schema") != BACKUP_SCHEMA or document.get("kdf", {}).get("name") != "scrypt" or \
            {name: document["kdf"].get(name) for name in ("n", "r", "p")} != \
            {"n": KDF_N, "r": KDF_R, "p": KDF_P} or \
            document.get("cipher", {}).get("name") != "AES-256-GCM":
        raise ValueError("Unsupported recovery envelope")
    try:
        salt = base64.b64decode(document["kdf"]["salt"], validate=True)
        nonce = base64.b64decode(document["cipher"]["nonce"], validate=True)
        ciphertext = base64.b64decode(document["cipher"]["ciphertext"], validate=True)
        root_pem = base64.b64decode(document["rootCertificatePem"], validate=True)
        if len(salt) != 16 or len(nonce) != 12:
            raise ValueError("Recovery envelope has invalid salt or nonce")
        root = x509.load_pem_x509_certificate(root_pem)
        if root.fingerprint(hashes.SHA256()).hex() != document["rootCertificateSha256"]:
            raise ValueError("Recovery root fingerprint mismatch")
        associated = f"{BACKUP_SCHEMA}|{document['rootCertificateSha256']}".encode()
        key_pem = AESGCM(_derive(passphrase, salt)).decrypt(nonce, ciphertext, associated)
        root_key = serialization.load_pem_private_key(key_pem, password=None)
    except (KeyError, TypeError, InvalidTag) as error:
        raise ValueError("Recovery passphrase or envelope is invalid") from error
    if not isinstance(root_key, ca.ec.EllipticCurvePrivateKey):
        raise ValueError("Unexpected recovery root key")
    return ca._provision_material(ca.safe_private_path(target_state),
                                  ca.private_lan_ip(ip), root_key, root, protect)


def rotate_intermediate(state_dir: Path,
                        *, unprotect: Callable[[bytes], bytes] = ca.unprotect_root) -> dict:
    """Rotate the signer while Caddy is stopped; caller reloads Caddy afterward."""
    root_key, root, metadata = _material(state_dir, unprotect)
    address = ca.private_lan_ip(metadata["lanIp"])
    now = datetime.now(timezone.utc)
    signer_key, signer_cert = ca._issue_intermediate(root_key, root, address, now)
    serving = ca.safe_private_path(state_dir) / "offline-ca/serving"
    paths = (("intermediate.pem", signer_cert.public_bytes(serialization.Encoding.PEM)),
             ("intermediate.key", ca._private_pem(signer_key)))
    previous = {name: _regular(serving / name) for name, _ in paths}
    metadata_path = ca.safe_private_path(state_dir) / "offline-ca/metadata.json"
    previous_metadata = _regular(metadata_path)
    metadata["intermediateExpiresAt"] = signer_cert.not_valid_after_utc.isoformat()
    metadata["rotationDueAt"] = (now + timedelta(days=5)).isoformat()
    prepared = []
    replaced = False
    try:
        for name, content in paths:
            temporary = serving / f".{name}.{uuid.uuid4().hex}.new"
            ca._write_new(temporary, content)
            prepared.append((temporary, serving / name))
        temporary = metadata_path.with_name(f".metadata.{uuid.uuid4().hex}.new")
        ca._write_new(temporary, (json.dumps(metadata, indent=2) + "\n").encode())
        prepared.append((temporary, metadata_path))
        for source, destination in prepared:
            os.replace(source, destination)
            replaced = True
        return validate_signer(state_dir, unprotect=unprotect)
    except Exception:
        # The gateway is stopped by the caller. Restore the old pair if a
        # replacement or post-write validation fails before it is restarted.
        if replaced:
            for name, content in (*previous.items(), ("metadata.json", previous_metadata)):
                destination = metadata_path if name == "metadata.json" else serving / name
                rollback = destination.with_name(f".{name}.{uuid.uuid4().hex}.rollback")
                ca._write_new(rollback, content)
                os.replace(rollback, destination)
        raise
    finally:
        for source, _ in prepared:
            source.unlink(missing_ok=True)


def move_signer(state_dir: Path, ip: str,
                *, unprotect: Callable[[bytes], bytes] = ca.unprotect_root) -> dict:
    """Move the installation to a new LAN address while Caddy is stopped (ADR-0223 IP change).

    The root stays, so every device that trusts it keeps trusting the installation; a new signer
    constrained to the new IP and a new setup page replace the old ones. Caller restarts Caddy."""
    root_key, root, metadata = _material(state_dir, unprotect)
    address = ca.private_lan_ip(ip)
    if str(address) == metadata["lanIp"]:
        return validate_signer(state_dir, unprotect=unprotect)
    base = ca.safe_private_path(state_dir) / "offline-ca"
    now = datetime.now(timezone.utc)
    signer_key, signer_cert = ca._issue_intermediate(root_key, root, address, now)
    token = uuid.uuid4().hex
    staged_setup, old_setup = base / f".setup.{token}.new", base / f".setup.{token}.old"
    staged_setup.mkdir(mode=0o700)
    ca._restrict(staged_setup, directory=True)
    serving, metadata_path = base / "serving", base / "metadata.json"
    previous = {serving / "intermediate.pem": _regular(serving / "intermediate.pem"),
                serving / "intermediate.key": _regular(serving / "intermediate.key"),
                metadata_path: _regular(metadata_path)}
    moved = dict(metadata, lanIp=str(address), origin=f"https://{address}",
                 intermediateExpiresAt=signer_cert.not_valid_after_utc.isoformat(),
                 rotationDueAt=(now + timedelta(days=5)).isoformat())
    replacements = {serving / "intermediate.pem": signer_cert.public_bytes(serialization.Encoding.PEM),
                    serving / "intermediate.key": ca._private_pem(signer_key),
                    metadata_path: (json.dumps(moved, indent=2) + "\n").encode()}
    prepared, swapped_setup, replaced = [], False, False
    try:
        ca._setup_files(staged_setup, root, address)
        for destination, content in replacements.items():
            temporary = destination.with_name(f".{destination.name}.{token}.new")
            ca._write_new(temporary, content)
            prepared.append((temporary, destination))
        os.replace(base / "setup", old_setup)
        os.replace(staged_setup, base / "setup")
        swapped_setup = True
        for source, destination in prepared:
            os.replace(source, destination)
            replaced = True
        result = validate_signer(state_dir, unprotect=unprotect)
    except Exception:
        if replaced:
            for destination, content in previous.items():
                rollback = destination.with_name(f".{destination.name}.{token}.rollback")
                ca._write_new(rollback, content)
                os.replace(rollback, destination)
        if swapped_setup:
            os.replace(base / "setup", staged_setup)
            os.replace(old_setup, base / "setup")
        raise
    finally:
        for source, _ in prepared:
            source.unlink(missing_ok=True)
        for leftover in (staged_setup, old_setup):
            if leftover.exists():
                for item in leftover.iterdir():
                    item.unlink()
                leftover.rmdir()
    return result
