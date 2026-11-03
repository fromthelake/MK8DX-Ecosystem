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
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
FILES = ("api.env", "operator.json", "compose.env")
V2_FILES = FILES + ("operator-profile.json", "secrets.json", "public-client.json")


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
        suffix = {"A1": "compose.local.yaml", "A2": "compose.lan.yaml", "B1": "compose.production.yaml"}.get(route)
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


def backup(state, output):
    state, output = safe_path(state), safe_path(output)
    command = compose(state)
    if output.exists():
        raise RuntimeError("Backup destination already exists")
    output.mkdir(mode=0o700, parents=True)
    os.chmod(output, 0o700)
    names = V2_FILES if (state / "operator-profile.json").exists() else FILES
    for name in names:
        source = state / name
        if not source.is_file() or source.is_symlink() or (getattr(source.lstat(), "st_file_attributes", 0) &
                                                          getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)):
            raise RuntimeError("Installation file is missing or linked")
        shutil.copyfile(state / name, output / name)
        os.chmod(output / name, 0o600)
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
    manifest = {"schemaVersion": "mk8dx.install-backup.v2" if names == V2_FILES else "mk8dx.local-backup.v1",
                "createdUtc": datetime.now(timezone.utc).isoformat(),
                "route": json.loads((state / "operator-profile.json").read_text())["route"] if names == V2_FILES else "A1",
                "files": {name: digest(output / name) for name in (*names, "database.sql.gz")}}
    write_private(output / "manifest.json", json.dumps(manifest, indent=2) + "\n")
    print("Backup complete; keep this directory private and offline when possible")


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
    names = V2_FILES if version == "mk8dx.install-backup.v2" else FILES
    if version not in ("mk8dx.install-backup.v2", "mk8dx.local-backup.v1") or set(manifest.get("files", {})) != set((*names, "database.sql.gz")):
        raise RuntimeError("Backup manifest is invalid")
    for name, expected in manifest["files"].items():
        path = backup_dir / name
        if path.is_symlink() or not path.is_file() or digest(path) != expected:
            raise RuntimeError("Backup checksum mismatch")
    return manifest


def restore_new(backup_dir, target):
    backup_dir, target = safe_path(backup_dir), safe_path(target)
    manifest = verify_backup(backup_dir)
    version = manifest["schemaVersion"]
    if target.exists():
        raise RuntimeError("Restore target already exists")
    target.mkdir(mode=0o700, parents=True)
    os.chmod(target, 0o700)
    runtime = json.loads((backup_dir / "operator.json").read_text(encoding="utf-8"))
    route = manifest.get("route", "A1")
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
    if route == "A1":
        api = set_value(api, "MK8DX_HOSTED_AUTH_BASE_URL", origin)
        api = set_value(api, "MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON", json.dumps([origin]))
    write_private(target / "api.env", api)
    environment = (backup_dir / "compose.env").read_text(encoding="utf-8")
    new_project = "mk8dx-os-" + secrets.token_hex(5)
    replacements = {"MK8DX_PROJECT_NAME": new_project, "MK8DX_STATE_DIR": target.as_posix()}
    if route == "A1":
        replacements.update({"MK8DX_HTTP_PORT": str(http_port), "MK8DX_MAILPIT_PORT": str(mail_port)})
    for name, value in replacements.items():
        environment = set_value(environment, name, value)
    write_private(target / "compose.env", environment)
    if version == "mk8dx.install-backup.v2":
        profile = json.loads((backup_dir / "operator-profile.json").read_text(encoding="utf-8"))
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
    checked(command + ["up", "-d", "mysql"], stdout=subprocess.DEVNULL)
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
    r = actions.add_parser("restore-new")
    r.add_argument("--backup", type=Path, required=True)
    r.add_argument("--state-dir", type=Path, required=True)
    v = actions.add_parser("verify")
    v.add_argument("--backup", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.action == "backup":
            backup(args.state_dir, args.output)
        elif args.action == "verify":
            manifest = verify_backup(args.backup)
            print(f"Backup verified: {manifest['schemaVersion']}, route {manifest.get('route', 'A1')}")
        else:
            restore_new(args.backup, args.state_dir)
    except (OSError, subprocess.CalledProcessError, RuntimeError, ValueError) as error:
        raise SystemExit(f"Lifecycle operation refused or failed: {error}") from None


if __name__ == "__main__":
    main()
