"""Task-scoped MySQL/config backup and recovery into a new isolated project."""
import argparse
import gzip
import hashlib
import json
import os
import secrets
import shutil
import socket
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


ROOT = Path(__file__).resolve().parent.parent
FILES = ("api.env", "operator.json", "compose.env")
V2_FILES = FILES + ("operator-profile.json", "secrets.json", "public-client.json")
OFFLINE_CA_BACKUP = "offline-ca-recovery.json"


def safe_path(value):
    path = Path(os.path.abspath(value))
    for part in (*reversed(path.parents), path):
        if part.exists() and (part.is_symlink() or
                              getattr(part.lstat(), "st_file_attributes", 0) &
                              getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)):
            raise RuntimeError("Private path contains a link or junction")
    if path.is_relative_to(ROOT):
        raise RuntimeError("Private data must be outside the software package")
    return path


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def compose(state):
    profile_path = state / "operator-profile.json"
    if profile_path.exists():
        route = json.loads(profile_path.read_text(encoding="utf-8"))["route"]
        suffix = {"A1": "compose.local.yaml", "A2": "compose.lan.yaml",
                  "A2_OFFLINE": "compose.offline-lan.yaml", "B1": "compose.production.yaml"}.get(route)
        if suffix is None:
            raise RuntimeError("Unknown installation route")
    elif "MK8DX_LOCAL_DEMO='true'" in (state / "api.env").read_text(encoding="utf-8").splitlines():
        suffix = "compose.local.yaml"
    else:
        raise RuntimeError("Production backup needs an adopted operator profile")
    return ["docker", "compose", "--env-file", str(state / "compose.env"),
            "-f", str(ROOT / "compose.yaml"), "-f", str(ROOT / suffix), "-f", str(ROOT / "compose.images.yaml")]


def checked(command, **kwargs):
    return subprocess.run(command, check=True, cwd=ROOT, **kwargs)


def free_port(start):
    for port in range(start, start + 100):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                pass
    raise RuntimeError("No loopback port available")


def write_private(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(content)


def recovery_phrase(path):
    if path is None:
        raise RuntimeError("Offline LAN backup and restore require --recovery-phrase-file")
    path = safe_path(path)
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("Recovery phrase file must be an unlinked private file outside Git")
    phrase = path.read_text(encoding="utf-8").rstrip("\r\n")
    if "\n" in phrase or "\r" in phrase or len(phrase) < 16:
        raise RuntimeError("Recovery phrase file must contain one phrase of at least 16 characters")
    return phrase


def backup(state, output, recovery_phrase_file=None):
    state, output = safe_path(state), safe_path(output)
    command = compose(state)
    route = json.loads((state / "operator-profile.json").read_text(encoding="utf-8"))["route"] if \
        (state / "operator-profile.json").exists() else "A1"
    phrase = recovery_phrase(recovery_phrase_file) if route == "A2_OFFLINE" else None
    if route == "A2_OFFLINE":
        from tooling.offline_lan_ca_lifecycle import validate_signer
        from tooling.install import read_dotenv
        signer = validate_signer(state)
        profile = json.loads((state / "operator-profile.json").read_text(encoding="utf-8"))
        ca_metadata = json.loads((state / "offline-ca/metadata.json").read_text(encoding="utf-8"))
        compose_values = read_dotenv(state / "compose.env")
        api_values = read_dotenv(state / "api.env")
        selected_ip = profile.get("bindAddress")
        if (signer["rootCertificateSha256"] != profile.get("rootCertificateSha256") or
                ca_metadata.get("lanIp") != selected_ip or
                profile.get("origin") != f"https://{selected_ip}" or
                compose_values.get("MK8DX_LAN_IP") != selected_ip or
                compose_values.get("MK8DX_BIND_ADDRESS") != selected_ip or
                api_values.get("MK8DX_HOSTED_AUTH_BASE_URL") != profile.get("origin")):
            raise RuntimeError("Offline CA, selected IP and installation profile disagree")
    if output.exists():
        raise RuntimeError("Backup destination already exists")
    output.mkdir(mode=0o700, parents=True)
    os.chmod(output, 0o700)
    names = V2_FILES if (state / "operator-profile.json").exists() else FILES
    if route == "A2_OFFLINE":
        return _sealed_backup(state, output, names, phrase, command)
    for name in names:
        source = state / name
        if not source.is_file() or source.is_symlink() or (getattr(source.lstat(), "st_file_attributes", 0) &
                                                          getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)):
            raise RuntimeError("Installation file is missing or linked")
        shutil.copyfile(state / name, output / name)
        os.chmod(output / name, 0o600)
    if route == "A2_OFFLINE":
        from tooling.offline_lan_ca_lifecycle import export_recovery
        export_recovery(state, output / OFFLINE_CA_BACKUP, phrase)
    dump_command = command + ["exec", "-T", "mysql", "sh", "-c",
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -u root --single-transaction --routines --triggers --events --no-tablespaces mk8dx']
    with open(output / "database.sql.gz", "xb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
            process = subprocess.Popen(dump_command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert process.stdout is not None
            for block in iter(lambda: process.stdout.read(1024 * 1024), b""):
                compressed.write(block)
            error = process.stderr.read() if process.stderr else b""
            if process.wait() != 0:
                raise RuntimeError("Database dump failed: " + error.decode(errors="replace")[:500])
    os.chmod(output / "database.sql.gz", 0o600)
    backup_files = (*names, "database.sql.gz", *((OFFLINE_CA_BACKUP,) if route == "A2_OFFLINE" else ()))
    manifest = {"schemaVersion": "mk8dx.install-backup.v2" if names == V2_FILES else "mk8dx.local-backup.v1",
                "createdUtc": datetime.now(timezone.utc).isoformat(),
                "route": route,
                "files": {name: digest(output / name) for name in backup_files}}
    write_private(output / "manifest.json", json.dumps(manifest, indent=2) + "\n")
    print("Backup complete; keep this directory private and offline when possible")


SEALED_BACKUP = "backup.sealed"
SEALED_SCHEMA = "mk8dx.install-backup.v3"
SEALED_ASSOCIATED_DATA = b"mk8dx-install-backup-v3"


def _installation_file(state, name):
    source = state / name
    if not source.is_file() or source.is_symlink() or (getattr(source.lstat(), "st_file_attributes", 0) &
                                                      getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)):
        raise RuntimeError("Installation file is missing or linked")
    return source.read_bytes()


def _sealed_backup(state, output, names, phrase, command):
    """An A2 backup sealed with the owner's recovery code (AES-256-GCM, scrypt): the installation
    secrets and the database dump never reach the backup folder in plain text. Only the sealed
    archive, the CA recovery envelope (sealed with the same code) and a manifest are written."""
    import io
    import zipfile
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from tooling.offline_lan_ca_lifecycle import KDF_N, KDF_P, KDF_R, _derive, export_recovery
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in names:
            bundle.writestr(name, _installation_file(state, name))
        dump = io.BytesIO()
        dump_command = command + ["exec", "-T", "mysql", "sh", "-c",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -u root --single-transaction --routines --triggers '
            '--events --no-tablespaces mk8dx']
        with gzip.GzipFile(fileobj=dump, mode="wb", mtime=0) as compressed:
            process = subprocess.Popen(dump_command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert process.stdout is not None
            for block in iter(lambda: process.stdout.read(1024 * 1024), b""):
                compressed.write(block)
            error = process.stderr.read() if process.stderr else b""
            if process.wait() != 0:
                raise RuntimeError("Database dump failed: " + error.decode(errors="replace")[:500])
        bundle.writestr("database.sql.gz", dump.getvalue())
    salt, nonce = os.urandom(16), os.urandom(12)
    sealed = AESGCM(_derive(phrase, salt)).encrypt(nonce, archive.getvalue(), SEALED_ASSOCIATED_DATA)
    with open(output / SEALED_BACKUP, "xb") as stream:
        stream.write(sealed)
    os.chmod(output / SEALED_BACKUP, 0o600)
    export_recovery(state, output / OFFLINE_CA_BACKUP, phrase)
    profile = json.loads((state / "operator-profile.json").read_text(encoding="utf-8"))
    import base64
    manifest = {"schemaVersion": SEALED_SCHEMA, "createdUtc": datetime.now(timezone.utc).isoformat(),
                "route": "A2_OFFLINE", "rootCertificateSha256": profile.get("rootCertificateSha256"),
                "sealed": {"names": [*names, "database.sql.gz"],
                           "kdf": {"name": "scrypt", "n": KDF_N, "r": KDF_R, "p": KDF_P,
                                   "salt": base64.b64encode(salt).decode()},
                           "cipher": {"name": "AES-256-GCM", "nonce": base64.b64encode(nonce).decode()}},
                "files": {name: digest(output / name) for name in (SEALED_BACKUP, OFFLINE_CA_BACKUP)}}
    write_private(output / "manifest.json", json.dumps(manifest, indent=2) + "\n")
    print("Backup complete and sealed with the recovery code")


def _open_sealed_backup(backup_dir, phrase, into):
    """Decrypt a v3 backup into `into` as a v2 layout (files + v2 manifest) for the restore path."""
    import base64
    import io
    import zipfile
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from tooling.offline_lan_ca_lifecycle import KDF_N, KDF_P, KDF_R, _derive
    manifest = json.loads((backup_dir / "manifest.json").read_text(encoding="utf-8"))
    sealed = manifest["sealed"]
    if {k: sealed["kdf"].get(k) for k in ("name", "n", "r", "p")} != {"name": "scrypt", "n": KDF_N, "r": KDF_R, "p": KDF_P} \
            or sealed["cipher"].get("name") != "AES-256-GCM":
        raise RuntimeError("Sealed backup uses an unknown protection")
    salt = base64.b64decode(sealed["kdf"]["salt"], validate=True)
    nonce = base64.b64decode(sealed["cipher"]["nonce"], validate=True)
    try:
        archive = AESGCM(_derive(phrase, salt)).decrypt(nonce, (backup_dir / SEALED_BACKUP).read_bytes(),
                                                         SEALED_ASSOCIATED_DATA)
    except InvalidTag:
        raise RuntimeError("The recovery code does not open this backup") from None
    expected = set(sealed["names"])
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        if set(bundle.namelist()) != expected or set(V2_FILES) | {"database.sql.gz"} != expected:
            raise RuntimeError("Sealed backup contents are invalid")
        for name in sorted(expected):
            fd = os.open(into / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(bundle.read(name))
    shutil.copyfile(backup_dir / OFFLINE_CA_BACKUP, into / OFFLINE_CA_BACKUP)
    names = (*V2_FILES, "database.sql.gz", OFFLINE_CA_BACKUP)
    write_private(into / "manifest.json", json.dumps({
        "schemaVersion": "mk8dx.install-backup.v2", "createdUtc": manifest.get("createdUtc"), "route": "A2_OFFLINE",
        "files": {name: digest(into / name) for name in names}}, indent=2) + "\n")


def set_value(text, name, value):
    lines = text.splitlines(keepends=True)
    matching = [index for index, line in enumerate(lines) if line.startswith(name + "=")]
    if len(matching) != 1 or "'" in value or "\n" in value:
        raise RuntimeError("Backup setting is invalid")
    lines[matching[0]] = f"{name}='{value}'\n"
    return "".join(lines)


def verify_backup(backup_dir):
    backup_dir = safe_path(backup_dir)
    manifest = json.loads((backup_dir / "manifest.json").read_text(encoding="utf-8"))
    version = manifest.get("schemaVersion")
    if version == SEALED_SCHEMA:
        # Contents stay sealed until restore; check what can be checked without the code.
        if manifest.get("route") != "A2_OFFLINE" or set(manifest.get("files", {})) != {SEALED_BACKUP, OFFLINE_CA_BACKUP}:
            raise RuntimeError("Backup manifest is invalid")
        for name, expected in manifest["files"].items():
            path = backup_dir / name
            if path.is_symlink() or not path.is_file() or digest(path) != expected:
                raise RuntimeError("Backup checksum mismatch")
        envelope = json.loads((backup_dir / OFFLINE_CA_BACKUP).read_text(encoding="utf-8"))
        if envelope.get("schema") != "mk8dx.offline-lan-ca-recovery.v1" or \
                envelope.get("rootCertificateSha256") != manifest.get("rootCertificateSha256"):
            raise RuntimeError("Offline CA recovery envelope and manifest disagree")
        return manifest
    names = V2_FILES if version == "mk8dx.install-backup.v2" else FILES
    route = manifest.get("route", "A1")
    expected = set((*names, "database.sql.gz", *((OFFLINE_CA_BACKUP,) if route == "A2_OFFLINE" else ())))
    if version not in ("mk8dx.install-backup.v2", "mk8dx.local-backup.v1") or \
            (route == "A2_OFFLINE" and version != "mk8dx.install-backup.v2") or \
            set(manifest.get("files", {})) != expected:
        raise RuntimeError("Backup manifest is invalid")
    for name, expected in manifest["files"].items():
        path = backup_dir / name
        if path.is_symlink() or not path.is_file() or digest(path) != expected:
            raise RuntimeError("Backup checksum mismatch")
    if version == "mk8dx.install-backup.v2":
        profile = json.loads((backup_dir / "operator-profile.json").read_text(encoding="utf-8"))
        if profile.get("route") != route:
            raise RuntimeError("Backup route and installation profile disagree")
    if route == "A2_OFFLINE":
        envelope = json.loads((backup_dir / OFFLINE_CA_BACKUP).read_text(encoding="utf-8"))
        if envelope.get("schema") != "mk8dx.offline-lan-ca-recovery.v1" or \
                envelope.get("rootCertificateSha256") != profile.get("rootCertificateSha256"):
            raise RuntimeError("Offline CA recovery envelope and profile disagree")
    return manifest


def restore_new(backup_dir, target, recovery_phrase_file=None, lan_ip=None):
    """Restore into a new isolated project. `lan_ip` moves an A2 offline backup to this computer's
    address: the same root CA (phones keep trusting it), a new signer and setup page for the new IP."""
    backup_dir, target = safe_path(backup_dir), safe_path(target)
    manifest = verify_backup(backup_dir)
    if manifest["schemaVersion"] == SEALED_SCHEMA:
        import tempfile
        phrase = recovery_phrase(recovery_phrase_file)
        if target.exists():
            raise RuntimeError("Restore target already exists")
        with tempfile.TemporaryDirectory(prefix="mk8dx-restore-") as opened:
            opened = Path(opened)
            os.chmod(opened, 0o700)
            _open_sealed_backup(backup_dir, phrase, opened)
            return restore_new(opened, target, recovery_phrase_file, lan_ip)
    version = manifest["schemaVersion"]
    route = manifest.get("route", "A1")
    phrase = recovery_phrase(recovery_phrase_file) if route == "A2_OFFLINE" else None
    runtime = json.loads((backup_dir / "operator.json").read_text(encoding="utf-8"))
    profile = (json.loads((backup_dir / "operator-profile.json").read_text(encoding="utf-8"))
               if version == "mk8dx.install-backup.v2" else None)
    if route == "A2_OFFLINE":
        from tooling.offline_lan_ca import private_lan_ip
        from tooling.install import read_dotenv
        selected_ip = str(private_lan_ip(profile["bindAddress"]))
        saved_compose = read_dotenv(backup_dir / "compose.env")
        saved_api = read_dotenv(backup_dir / "api.env")
        if (runtime.get("MK8DX_HOSTED_AUTH_BASE_URL") != f"https://{selected_ip}" or
                profile.get("origin") != f"https://{selected_ip}" or
                saved_compose.get("MK8DX_LAN_IP") != selected_ip or
                saved_compose.get("MK8DX_BIND_ADDRESS") != selected_ip or
                saved_api.get("MK8DX_HOSTED_AUTH_BASE_URL") != profile.get("origin")):
            raise RuntimeError("Offline backup origin and selected IP disagree")
        if lan_ip is not None and str(private_lan_ip(lan_ip)) != selected_ip:
            selected_ip = str(private_lan_ip(lan_ip))
            moved = f"https://{selected_ip}"
            runtime["MK8DX_HOSTED_AUTH_BASE_URL"] = moved
            runtime["MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON"] = json.dumps([moved])
            profile["origin"], profile["bindAddress"] = moved, selected_ip
    elif lan_ip is not None:
        raise RuntimeError("Only an A2 offline backup can move to another LAN address")
    if target.exists():
        raise RuntimeError("Restore target already exists")
    target.mkdir(mode=0o700, parents=True)
    os.chmod(target, 0o700)
    if route == "A2_OFFLINE":
        from tooling.offline_lan_ca_lifecycle import restore_recovery, validate_signer
        restored = restore_recovery(backup_dir / OFFLINE_CA_BACKUP, target, selected_ip, phrase)
        if restored["root"]["certificateSha256"] != profile["rootCertificateSha256"] or \
                validate_signer(target)["rootCertificateSha256"] != profile["rootCertificateSha256"]:
            raise RuntimeError("Restored offline CA and installation profile disagree")
    if route == "A1":
        http_port, mail_port = free_port(18080), free_port(18025)
        if http_port == mail_port:
            mail_port = free_port(http_port + 1)
        origin = f"http://127.0.0.1:{http_port}"
        runtime["MK8DX_HOSTED_AUTH_BASE_URL"] = origin
        runtime["MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON"] = json.dumps([origin])
    else:
        origin = runtime["MK8DX_HOSTED_AUTH_BASE_URL"]
    write_private(target / "operator.json", json.dumps({k: v for k, v in runtime.items()
                                                        if k.startswith("MK8DX_HOSTED_")}, indent=2) + "\n")
    if os.name == "posix":
        # Readable by the API image's operator user inside the private 0700 directory (see install.py).
        os.chmod(target / "operator.json", 0o644)
    api = (backup_dir / "api.env").read_text(encoding="utf-8")
    if route == "A1" or (route == "A2_OFFLINE" and lan_ip is not None):
        api = set_value(api, "MK8DX_HOSTED_AUTH_BASE_URL", origin)
        api = set_value(api, "MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON", json.dumps([origin]))
    write_private(target / "api.env", api)
    environment = (backup_dir / "compose.env").read_text(encoding="utf-8")
    new_project = "mk8dx-os-" + secrets.token_hex(5)
    replacements = {"MK8DX_PROJECT_NAME": new_project, "MK8DX_STATE_DIR": target.as_posix()}
    if route == "A1":
        replacements.update({"MK8DX_HTTP_PORT": str(http_port), "MK8DX_MAILPIT_PORT": str(mail_port)})
    if route == "A2_OFFLINE" and lan_ip is not None:
        replacements.update({"MK8DX_DOMAIN": selected_ip, "MK8DX_LAN_IP": selected_ip,
                             "MK8DX_BIND_ADDRESS": selected_ip})
    for name, value in replacements.items():
        environment = set_value(environment, name, value)
    write_private(target / "compose.env", environment)
    if version == "mk8dx.install-backup.v2":
        profile["project"] = new_project
        profile["origin"] = origin
        if route == "A1":
            profile["httpPort"] = http_port
        write_private(target / "operator-profile.json", json.dumps(profile, indent=2) + "\n")
        shutil.copyfile(backup_dir / "secrets.json", target / "secrets.json")
        os.chmod(target / "secrets.json", 0o600)
        client = json.loads((backup_dir / "public-client.json").read_text(encoding="utf-8"))
        client["websiteOrigin"] = origin
        write_private(target / "public-client.json", json.dumps(client, indent=2) + "\n")
    command = compose(target)
    checked(command + ["up", *(("--pull", "never") if route == "A2_OFFLINE" else ()),
                       "-d", "mysql"], stdout=subprocess.DEVNULL)
    for _ in range(30):
        ping = subprocess.run(command + ["exec", "-T", "mysql", "sh", "-c",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqladmin ping -h 127.0.0.1 -u root --silent'],
            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if ping.returncode == 0:
            break
        import time
        time.sleep(1)
    else:
        raise RuntimeError("Restored database did not become ready")
    with gzip.open(backup_dir / "database.sql.gz", "rb") as sql:
        process = subprocess.Popen(command + ["exec", "-T", "mysql", "sh", "-c",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h 127.0.0.1 -u root mk8dx'],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        assert process.stdin is not None
        for block in iter(lambda: sql.read(1024 * 1024), b""):
            process.stdin.write(block)
        process.stdin.close()
        error = process.stderr.read() if process.stderr else b""
        if process.wait() != 0:
            raise RuntimeError("Database restore failed: " + error.decode(errors="replace")[:500])
    print(f"Database and private configuration restored to a new isolated project. Web origin: {origin}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    b = actions.add_parser("backup")
    b.add_argument("--state-dir", type=Path, required=True)
    b.add_argument("--output", type=Path, required=True)
    b.add_argument("--recovery-phrase-file", type=Path)
    r = actions.add_parser("restore-new")
    r.add_argument("--backup", type=Path, required=True)
    r.add_argument("--state-dir", type=Path, required=True)
    r.add_argument("--recovery-phrase-file", type=Path)
    r.add_argument("--lan-ip", help="A2 offline: this computer's private IPv4 address, when it differs")
    v = actions.add_parser("verify")
    v.add_argument("--backup", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.action == "backup":
            backup(args.state_dir, args.output, args.recovery_phrase_file)
        elif args.action == "verify":
            manifest = verify_backup(args.backup)
            print(f"Backup verified: {manifest['schemaVersion']}, route {manifest.get('route', 'A1')}")
        else:
            restore_new(args.backup, args.state_dir, args.recovery_phrase_file, args.lan_ip)
    except (OSError, subprocess.CalledProcessError, RuntimeError, ValueError) as error:
        raise SystemExit(f"Lifecycle operation refused or failed: {error}") from None


if __name__ == "__main__":
    main()
