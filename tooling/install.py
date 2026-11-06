"""Create a new private installation directory. Never changes an existing one."""
import argparse
import base64
import json
import os
import secrets
import socket
import subprocess
import getpass
import ipaddress
import re
import stat
import sys
from pathlib import Path
from urllib.parse import urlsplit

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

PROFILE = "operator-profile.json"
SECRET = "secrets.json"
PUBLIC = "public-client.json"


def safe_state_dir(value, *, existing):
    """Do not follow junctions or links into a different installation/source tree."""
    path = Path(os.path.abspath(value))
    for part in (*reversed(path.parents), path):
        if part.exists() and (part.is_symlink() or
                              getattr(part.lstat(), "st_file_attributes", 0) &
                              getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)):
            raise ValueError("Installation path contains a link or junction")
    if path.is_relative_to(ROOT):
        raise ValueError("Private installation must be outside the software package")
    if existing and not path.is_dir():
        raise ValueError("Installation directory is missing")
    for name in (PROFILE, SECRET, PUBLIC, "api.env", "operator.json", "compose.env"):
        item = path / name
        if item.exists() and (item.is_symlink() or
                              getattr(item.lstat(), "st_file_attributes", 0) &
                              getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)):
            raise ValueError("Installation file is a link or junction")
    return path


SECRET_KEYS = ("MK8DX_HOSTED_MYSQL_PASSWORD", "MK8DX_HOSTED_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64",
               "MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_BASE64", "MK8DX_HOSTED_TIME_TRIAL_LOOKUP_HMAC_KEY_BASE64",
               "MK8DX_HOSTED_TOURNAMENT_ENCRYPTION_KEY_BASE64", "MK8DX_HOSTED_TOURNAMENT_LOOKUP_HMAC_KEY_BASE64",
               "MK8DX_HOSTED_WEB_CSRF_KEYS_JSON", "MK8DX_HOSTED_AUTH_SECRETS_JSON")


def key():
    return base64.b64encode(secrets.token_bytes(32)).decode("ascii")


def free_port(start):
    for port in range(start, start + 100):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("No loopback port available")


def container_readable(state):
    """Allow the API's uid 10001 to read operator.json inside a private state directory."""
    if os.name != "posix":
        return
    state = Path(state)
    if stat.S_IMODE(state.stat().st_mode) & 0o077 == 0 and (state / "operator.json").is_file():
        os.chmod(state / "operator.json", 0o644)


def write_new(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(content)


def dotenv(values):
    for name, value in values.items():
        if "\n" in value or "'" in value:
            raise ValueError("Unsafe environment value")
        yield f"{name}='{value}'\n"


def read_dotenv(path):
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        name, equal, value = line.partition("=")
        if not equal or len(value) < 2 or value[0] != "'" or value[-1] != "'":
            raise ValueError("Unexpected generated environment format")
        values[name] = value[1:-1]
    return values


def valid_origin(value):
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError:
        raise ValueError("Website port is invalid") from None
    if (parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or
            parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment or
            value.endswith("/") or not value.isascii()):
        raise ValueError("Use one absolute origin such as https://www.example.org (no path or final slash)")
    if parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost"):
        raise ValueError("Remote and LAN addresses require trusted HTTPS")
    if parsed.scheme == "http" and port is None:
        raise ValueError("Local URL needs its selected port")
    return value


def write_json(path, payload):
    write_new(path, json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def public_client(origin):
    return {"schemaVersion": "mk8dx.public-client.v1", "websiteOrigin": origin}


def replace_group(paths, new):
    old = [p.read_bytes() for p in paths]
    temp = []
    try:
        for p, content in zip(paths, new):
            staging = p.with_name(p.name + ".next")
            write_new(staging, content.decode("utf-8"))
            temp.append(staging)
        for p, staging in zip(paths, temp):
            os.replace(staging, p)
    except Exception:
        for p, content in zip(paths, old):
            p.write_bytes(content)
        raise
    finally:
        for staging in temp:
            staging.unlink(missing_ok=True)


def adopt(state):
    """Record existing installation values without rewriting its runtime or volumes."""
    state = safe_state_dir(state, existing=True)
    if any((state / name).exists() for name in (PROFILE, SECRET, PUBLIC)):
        raise ValueError("Already adopted; existing profile and secrets stay in place")
    api = read_dotenv(state / "api.env")
    compose = read_dotenv(state / "compose.env")
    operator = json.loads((state / "operator.json").read_text(encoding="utf-8"))
    if operator.get("MK8DX_HOSTED_AUTH_BASE_URL") != api.get("MK8DX_HOSTED_AUTH_BASE_URL"):
        raise ValueError("Existing operator and API origins differ")
    origin = valid_origin(api["MK8DX_HOSTED_AUTH_BASE_URL"])
    profile = {"schemaVersion": "mk8dx.operator.v1", "route": "A1" if api.get("MK8DX_LOCAL_DEMO") == "true" else "B1",
               "origin": origin, "project": compose["MK8DX_PROJECT_NAME"],
               "httpPort": int(compose["MK8DX_HTTP_PORT"]), "bindAddress": compose["MK8DX_BIND_ADDRESS"],
               "adminEmail": None,
               "smtp": {"host": api["MK8DX_HOSTED_SMTP_HOST"], "port": int(api["MK8DX_HOSTED_SMTP_PORT"]),
                        "secure": api["MK8DX_HOSTED_SMTP_SECURE"] == "true",
                        "username": api["MK8DX_HOSTED_SMTP_USERNAME"],
                        "fromAddress": api["MK8DX_HOSTED_SMTP_FROM_ADDRESS"]}}
    secrets_data = {key: api[key] for key in SECRET_KEYS}
    secrets_data["MK8DX_DATABASE_ROOT_PASSWORD"] = compose["MK8DX_DATABASE_ROOT_PASSWORD"]
    secrets_data["MK8DX_HOSTED_SMTP_PASSWORD"] = (api.get("MK8DX_HOSTED_SMTP_PASSWORD") or
        base64.b64decode(api.get("MK8DX_HOSTED_SMTP_PASSWORD_BASE64", "")).decode("utf-8"))
    write_json(state / PROFILE, profile)
    write_json(state / SECRET, secrets_data)
    write_json(state / PUBLIC, public_client(origin))
    print("Existing installation adopted without changing runtime files, keys, accounts or volumes")


def status(state):
    state = safe_state_dir(state, existing=True)
    profile = json.loads((state / PROFILE).read_text(encoding="utf-8"))
    secret_values = json.loads((state / SECRET).read_text(encoding="utf-8"))
    compose = read_dotenv(state / "compose.env")
    if profile["project"] != compose["MK8DX_PROJECT_NAME"]:
        raise ValueError("Profile and Compose project differ; refusing ambiguous installation")
    if profile["bindAddress"] != compose["MK8DX_BIND_ADDRESS"]:
        raise ValueError("Profile and gateway bind address differ")
    if profile["route"] == "A2_OFFLINE":
        from tooling.offline_lan_ca_lifecycle import validate_signer
        signer = validate_signer(state)
        expected_ip = compose.get("MK8DX_LAN_IP")
        if (expected_ip != profile["bindAddress"] or
                profile["origin"] != f"https://{expected_ip}" or
                signer["rootCertificateSha256"] != profile.get("rootCertificateSha256")):
            raise ValueError("Offline CA, selected IP and installation profile disagree")
    api = read_dotenv(state / "api.env")
    operator = json.loads((state / "operator.json").read_text(encoding="utf-8"))
    public = json.loads((state / PUBLIC).read_text(encoding="utf-8"))
    if (profile["origin"] != api["MK8DX_HOSTED_AUTH_BASE_URL"] or
            profile["origin"] != public["websiteOrigin"] or
            (profile["route"] != "A1" and urlsplit(profile["origin"]).hostname != compose.get("MK8DX_DOMAIN"))):
        raise ValueError("Profile, API, public client and gateway origins disagree")
    smtp = profile["smtp"]
    if (smtp["host"] != api["MK8DX_HOSTED_SMTP_HOST"] or
            str(smtp["port"]) != api["MK8DX_HOSTED_SMTP_PORT"] or
            str(smtp["secure"]).lower() != api["MK8DX_HOSTED_SMTP_SECURE"] or
            smtp["username"] != api["MK8DX_HOSTED_SMTP_USERNAME"] or
            smtp["fromAddress"] != api["MK8DX_HOSTED_SMTP_FROM_ADDRESS"]):
        raise ValueError("Profile and API mail settings disagree")
    saved_password = secret_values.get("MK8DX_HOSTED_SMTP_PASSWORD")
    encoded_password = api.get("MK8DX_HOSTED_SMTP_PASSWORD_BASE64")
    runtime_password = (base64.b64decode(encoded_password, validate=True).decode("utf-8")
                        if encoded_password is not None else api.get("MK8DX_HOSTED_SMTP_PASSWORD"))
    if (runtime_password != saved_password or operator.get("MK8DX_HOSTED_SMTP_PASSWORD") != saved_password or
            any(api.get(name) != secret_values.get(name) for name in SECRET_KEYS) or
            compose.get("MK8DX_DATABASE_ROOT_PASSWORD") != secret_values.get("MK8DX_DATABASE_ROOT_PASSWORD") or
            compose.get("MK8DX_DATABASE_PASSWORD") != api.get("MK8DX_HOSTED_MYSQL_PASSWORD") or
            any(api.get(name) != value for name, value in operator.items()
                if name.startswith("MK8DX_HOSTED_") and name != "MK8DX_HOSTED_SMTP_PASSWORD")):
        raise ValueError("Private secrets or generated runtime disagree; do not reset keys")
    displayed = {"route": profile["route"], "origin": profile["origin"],
                 "stateDir": str(state), "project": profile["project"],
                 "adminEmailConfigured": bool(profile.get("adminEmail")),
                 "smtpHost": profile["smtp"]["host"]}
    if profile["route"] == "A1":
        mail_port = int(compose["MK8DX_MAILPIT_PORT"])
        if not 1 <= mail_port <= 65535:
            raise ValueError("Local mail port is invalid")
        displayed["localMailInbox"] = f"http://127.0.0.1:{mail_port}"
    print(json.dumps(displayed, indent=2))


def change_origin(state, origin):
    """Atomic-enough bounded change: stage all three outputs, then replace with rollback copies."""
    state = safe_state_dir(state, existing=True)
    origin = valid_origin(origin)
    profile = json.loads((state / PROFILE).read_text(encoding="utf-8"))
    if profile["route"] == "A2_OFFLINE":
        raise ValueError("Offline LAN origin changes require CA signer and setup-QR rotation")
    if profile["origin"] == origin:
        print("unchanged")
        return
    if profile["route"] == "A1" and urlsplit(origin).hostname not in ("localhost", "127.0.0.1"):
        raise ValueError("A1 is loopback only; use a separate A2 or B1 installation")
    paths = [state / name for name in (PROFILE, "api.env", "operator.json", PUBLIC, "compose.env")]
    old = [p.read_bytes() for p in paths]
    api = read_dotenv(paths[1])
    operator = json.loads(old[2])
    profile["origin"] = origin
    for target in (api, operator):
        target["MK8DX_HOSTED_AUTH_BASE_URL"] = origin
        target["MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON"] = json.dumps([origin])
    compose_values = read_dotenv(paths[4])
    if profile["route"] == "A1":
        compose_values["MK8DX_HTTP_PORT"] = str(urlsplit(origin).port)
        profile["httpPort"] = urlsplit(origin).port
    else:
        if urlsplit(origin).port is not None:
            raise ValueError("LAN and public gateway currently use standard HTTPS port 443")
        compose_values["MK8DX_DOMAIN"] = urlsplit(origin).hostname
    new = [json.dumps(profile, indent=2).encode() + b"\n",
           "".join(dotenv(api)).encode(), json.dumps(operator, indent=2).encode() + b"\n",
           json.dumps(public_client(origin), indent=2).encode() + b"\n",
           "".join(dotenv(compose_values)).encode()]
    replace_group(paths, new)
    print("Origin saved. Restart API/Web through the installation command and reconnect clients.")


def change_smtp(state):
    state = safe_state_dir(state, existing=True)
    paths = [state / name for name in (PROFILE, SECRET, "api.env", "operator.json")]
    profile = json.loads(paths[0].read_text(encoding="utf-8"))
    if profile["route"] == "A1":
        raise ValueError("A1 uses local Mailpit; choose A2/B1 with a separate profile for real users")
    secrets_data = json.loads(paths[1].read_text(encoding="utf-8"))
    api = read_dotenv(paths[2])
    operator = json.loads(paths[3].read_text(encoding="utf-8"))
    smtp = profile["smtp"]
    print("Press Enter to keep each existing public value. Password stays hidden and is never printed.")
    host = input(f"SMTP host [{smtp['host']}]: ").strip() or smtp["host"]
    port = int(input(f"SMTP implicit-TLS port [{smtp['port']}]: ").strip() or smtp["port"])
    username = input(f"SMTP login [{smtp['username']}]: ").strip() or smtp["username"]
    from_address = input(f"Authorized sender [{smtp['fromAddress']}]: ").strip() or smtp["fromAddress"]
    entered_password = getpass.getpass("New SMTP password (Enter keeps current): ")
    password = entered_password or secrets_data["MK8DX_HOSTED_SMTP_PASSWORD"]
    if port != 465 or not host or " " in host or not username or " " in username or "@" not in from_address or not password:
        raise ValueError("SMTP needs host, port 465 implicit TLS, login, authorized sender and password")
    smtp.update({"host": host, "port": port, "secure": True, "username": username, "fromAddress": from_address})
    updates = {"MK8DX_HOSTED_SMTP_HOST": host, "MK8DX_HOSTED_SMTP_PORT": str(port),
               "MK8DX_HOSTED_SMTP_SECURE": "true", "MK8DX_HOSTED_SMTP_USERNAME": username,
               "MK8DX_HOSTED_SMTP_FROM_ADDRESS": from_address}
    api.update(updates)
    api.pop("MK8DX_HOSTED_SMTP_PASSWORD", None)
    api["MK8DX_HOSTED_SMTP_PASSWORD_BASE64"] = base64.b64encode(password.encode("utf-8")).decode("ascii")
    operator.update(updates)
    operator.pop("MK8DX_HOSTED_SMTP_PASSWORD_BASE64", None)
    operator["MK8DX_HOSTED_SMTP_PASSWORD"] = password
    secrets_data["MK8DX_HOSTED_SMTP_PASSWORD"] = password
    replace_group(paths, [json.dumps(profile, indent=2).encode() + b"\n",
                          json.dumps(secrets_data, indent=2).encode() + b"\n",
                          "".join(dotenv(api)).encode(), json.dumps(operator, indent=2).encode() + b"\n"])
    print("SMTP configuration saved privately. Run apply to recreate API/Web without resetting data.")


def change_admin_email(state, email):
    if not email or "@" not in email or " " in email or "\n" in email:
        raise ValueError("Enter one valid-looking admin email")
    path = safe_state_dir(state, existing=True) / PROFILE
    profile = json.loads(path.read_text(encoding="utf-8"))
    profile["adminEmail"] = email
    replace_group([path], [json.dumps(profile, indent=2).encode() + b"\n"])
    print("Target email saved. First sign in and verify it, then run the separate admin action.")


def lan_address(value):
    address = ipaddress.IPv4Address(value)
    if not address.is_private or address.is_loopback or address.is_unspecified:
        raise ValueError("Use the host's actual private IPv4 address")
    return str(address)


def change_lan_address(state, value):
    state = safe_state_dir(state, existing=True)
    address = lan_address(value)
    paths = [state / PROFILE, state / "compose.env"]
    profile = json.loads(paths[0].read_text(encoding="utf-8"))
    if profile["route"] != "A2":
        raise ValueError("This action applies only to A2")
    compose_values = read_dotenv(paths[1])
    profile["bindAddress"] = address
    compose_values["MK8DX_BIND_ADDRESS"] = address
    replace_group(paths, [json.dumps(profile, indent=2).encode() + b"\n", "".join(dotenv(compose_values)).encode()])
    print("LAN bind address saved; run apply to restart the gateway on that interface. Update client name mappings too.")


ROOT = Path(__file__).resolve().parent.parent


def compose_command(state):
    state = safe_state_dir(state, existing=True)
    container_readable(state)
    profile = json.loads((state / PROFILE).read_text(encoding="utf-8"))
    values = read_dotenv(state / "compose.env")
    if values["MK8DX_PROJECT_NAME"] != profile["project"] or values["MK8DX_STATE_DIR"] != state.as_posix():
        raise ValueError("Saved profile and Compose path/project disagree")
    route = profile["route"]
    suffix = {"A1": "compose.local.yaml", "A2": "compose.lan.yaml",
              "A2_OFFLINE": "compose.offline-lan.yaml", "B1": "compose.production.yaml"}[route]
    return ["docker", "compose", "--env-file", str(state / "compose.env"), "-f", str(ROOT / "compose.yaml"),
            "-f", str(ROOT / suffix), "-f", str(ROOT / "compose.images.yaml")]


def run_compose(state, *parts):
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "MK8DX_"))}
    command = compose_command(state)
    route = json.loads((safe_state_dir(state, existing=True) / PROFILE).read_text(encoding="utf-8"))["route"]
    arguments = list(parts)
    if route == "A2_OFFLINE" and arguments and arguments[0] in ("up", "run"):
        arguments[1:1] = ["--pull", "never"]
    subprocess.run(command + arguments, cwd=ROOT, env=clean_env, check=True)


def operate(state, action, backup_output=None, user_account_id=None):
    route = json.loads((safe_state_dir(state, existing=True) / PROFILE).read_text(encoding="utf-8"))["route"]
    if route == "A2_OFFLINE" and action in ("setup", "start", "apply", "upgrade", "admin"):
        raise ValueError("Offline LAN startup waits for the local invitation runtime; this profile is a foundation only")
    if action == "host-unlock":
        if route != "A2_OFFLINE":
            raise ValueError("Host unlock applies only to the offline LAN route")
        if user_account_id is not None and not re.fullmatch(
                r"user_account\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                user_account_id):
            raise ValueError("Use one canonical UserAccount ID")
        run_compose(state, "run", "-T", "--rm", "--no-deps", "host-admin", "node",
                    "dist/administration/offline-host-unlock-main.js",
                    *(["--bootstrap"] if user_account_id is None else ["--user-account-id", user_account_id]))
        return
    if action == "check":
        status(state)
        run_compose(state, "config", "--quiet")
        run_compose(state, "ps")
    elif action == "stop":
        run_compose(state, "stop")
    elif action == "apply":
        status(state)
        run_compose(state, "config", "--quiet")
        run_compose(state, "up", "-d", "--no-build", "--force-recreate", "api", "web")
    elif action == "upgrade":
        if backup_output is None:
            raise ValueError("Upgrade requires --backup-output in a new private directory")
        from lifecycle import backup, verify_backup
        backup(state, backup_output)
        verify_backup(backup_output)
        run_compose(state, "up", "-d", "--wait", "--no-build", "mysql")
        run_compose(state, "run", "--rm", "--no-deps", "api", "sh", "/app/operator-command.sh",
                    "dist/composition/migration-apply-main.js", "--migration-catalog",
                    "/app/infrastructure/mysql/migration-catalog-v1.json", "--confirm-database", "mk8dx", "--backup-verified")
        run_compose(state, "run", "--rm", "--no-deps", "api", "sh", "/app/operator-command.sh",
                    "dist/composition/reference-seed-main.js", "--staff-seed",
                    "/app/infrastructure/mysql/reference/nintendo-staff-v1.json", "--world-record-seed",
                    "/app/infrastructure/mysql/reference/world-records-v1.json")
        run_compose(state, "up", "-d", "--no-build", "--force-recreate", "api", "web")
        status(state)
    elif action in ("setup", "start"):
        run_compose(state, "config", "--quiet")
        if action == "setup":
            run_compose(state, "up", "-d", "--wait", "--no-build", "mysql", *("mailpit",) if json.loads((state / PROFILE).read_text())["route"] == "A1" else ())
            run_compose(state, "run", "--rm", "--no-deps", "api", "sh", "/app/operator-command.sh",
                        "dist/composition/migration-apply-main.js", "--migration-catalog",
                        "/app/infrastructure/mysql/migration-catalog-v1.json", "--confirm-database", "mk8dx", "--fresh-empty-database")
            run_compose(state, "run", "--rm", "--no-deps", "api", "sh", "/app/operator-command.sh",
                        "dist/composition/reference-seed-main.js", "--staff-seed",
                        "/app/infrastructure/mysql/reference/nintendo-staff-v1.json", "--world-record-seed",
                        "/app/infrastructure/mysql/reference/world-records-v1.json")
        run_compose(state, "up", "-d", "--no-build", *("mysql", "mailpit", "api", "web") if json.loads((state / PROFILE).read_text())["route"] == "A1" else ("mysql", "api", "web"))
        status(state)
    elif action == "admin":
        profile = json.loads((state / PROFILE).read_text(encoding="utf-8"))
        address = profile.get("adminEmail")
        if not address:
            raise ValueError("No admin email recorded; use --admin-email when initializing or configure it first")
        clean_env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "MK8DX_"))}
        subprocess.run(compose_command(state) + ["run", "-T", "--rm", "--no-deps", "api", "sh",
                       "/app/operator-command.sh", "dist/administration/installer-administrator-main.js",
                       "--email-stdin"], input=address + "\n", text=True, cwd=ROOT, env=clean_env, check=True)
    else:
        raise ValueError("Unknown installation action")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["init", "wizard", "adopt", "status", "change-origin", "change-lan-address", "change-smtp", "set-admin-email", "setup", "start", "stop", "serve", "maintenance", "check", "check-database", "apply", "admin", "host-unlock", "upgrade", "backup", "verify-backup", "restore-new", "restore-local", "restore-wizard", "passenger-config"])
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--mode", choices=["local", "lan", "offline-lan", "production", "xampp", "shared"], default="local")
    parser.add_argument("--domain", help="Production DNS name; HTTPS must reach this host")
    parser.add_argument("--smtp-host")
    parser.add_argument("--smtp-port", type=int, default=465)
    parser.add_argument("--smtp-user")
    parser.add_argument("--smtp-password-file", type=Path)
    parser.add_argument("--smtp-from")
    parser.add_argument("--origin", help="New exact external origin for change-origin")
    parser.add_argument("--admin-email", help="Email you will verify before the one-time administrator step")
    parser.add_argument("--user-account-id", help="Existing offline administrator for host-unlock; omit during first bootstrap")
    parser.add_argument("--backup-output", type=Path, help="New private backup directory for upgrade")
    parser.add_argument("--lan-bind-address", help="Private IPv4 interface of the Windows LAN host")
    parser.add_argument("--db-host")
    parser.add_argument("--db-port", type=int, default=3306)
    parser.add_argument("--db-name")
    parser.add_argument("--db-user")
    parser.add_argument("--db-password-file", type=Path)
    parser.add_argument("--backup-input", type=Path)
    args = parser.parse_args()
    if args.action == "restore-local":
        from native_install import restore_local
        if not args.backup_input: raise SystemExit("Restore needs --backup-input")
        restore_local(args.backup_input, args.state_dir)
        return
    if args.action == "restore-wizard":
        from native_install import restore_wizard
        if not args.backup_input: raise SystemExit("Restore needs --backup-input")
        restore_wizard(args.backup_input, args.state_dir)
        return
    if args.action == "restore-new":
        from native_install import restore_new
        if not (args.backup_input and args.db_host and args.db_name and args.db_user and args.db_password_file):
            raise SystemExit("Restore needs --backup-input and new database host/name/user/password-file")
        restore_new(args.backup_input, args.state_dir, args.db_host, args.db_port, args.db_name,
                    args.db_user, args.db_password_file.read_text(encoding="utf-8").strip(), args.origin)
        return
    native_route = None
    if args.action == "wizard":
        print("A1: one computer with Docker; A2: private network; A3: XAMPP and Node.js; B1: Docker VPS; B2: shared Node.js hosting (documented for mijn.host)")
        selected = input("Choose A1, A2, A3, B1 or B2: ").strip().upper()
        if selected in ("A3", "B2"):
            from native_install import wizard as native_wizard
            native_wizard(args.state_dir, selected)
            return
        if selected not in ("A1", "A2", "B1"):
            raise SystemExit("Choose exactly A1, A2, A3, B1 or B2")
        args.mode = {"A1": "local", "A2": "lan", "B1": "production"}[selected]
        native_route = selected
    if args.action == "init" and args.mode in ("xampp", "shared"):
        from native_install import create as native_create
        route = "A3" if args.mode == "xampp" else "B2"
        db_host = args.db_host or ("127.0.0.1" if route == "A3" else None)
        db_port = 18306 if route == "A3" and args.db_port == 3306 else args.db_port
        if not (db_host and args.db_name and args.db_user and args.db_password_file and args.admin_email):
            raise SystemExit("Native init needs database host/name/user/password-file and admin email; use wizard for guided input")
        native_create(args.state_dir, route,
                      "http://127.0.0.1:18090" if route == "A3" else f"https://{args.domain}",
                      args.admin_email, db_host, db_port, args.db_name, args.db_user,
                      args.db_password_file.read_text(encoding="utf-8").strip(),
                      args.smtp_host, args.smtp_port, args.smtp_user,
                      (args.smtp_password_file.read_text(encoding="utf-8").strip() if args.smtp_password_file else None),
                      args.smtp_from)
        return
    if args.action in ("status", "check", "check-database", "setup", "start", "serve", "maintenance", "admin", "upgrade", "backup", "verify-backup", "passenger-config", "change-origin", "change-smtp", "set-admin-email"):
        candidate = safe_state_dir(args.state_dir, existing=True) / PROFILE
        if candidate.is_file() and json.loads(candidate.read_text(encoding="utf-8")).get("route") in ("A3", "B2"):
            from native_install import operate as native_operate, change_origin as native_origin, change_smtp as native_smtp
            if args.action == "change-origin": native_origin(args.state_dir, args.origin)
            elif args.action == "change-smtp": native_smtp(args.state_dir)
            elif args.action == "set-admin-email": change_admin_email(args.state_dir, args.admin_email)
            else: native_operate(args.state_dir, args.action, args.backup_output)
            return
    if args.action == "change-smtp":
        change_smtp(args.state_dir)
        return
    if args.action == "set-admin-email":
        change_admin_email(args.state_dir, args.admin_email)
        return
    if args.action == "change-lan-address":
        if not args.lan_bind_address:
            raise SystemExit("--lan-bind-address is required")
        change_lan_address(args.state_dir, args.lan_bind_address)
        return
    if args.action in ("setup", "start", "stop", "check", "apply", "admin", "host-unlock", "upgrade"):
        operate(args.state_dir, args.action, args.backup_output, args.user_account_id)
        return
    if args.action == "wizard":
        route = native_route
        args.mode = {"A1": "local", "A2": "lan", "B1": "production"}[route]
        if route != "A1":
            if route == "A2":
                args.domain = input("Private website name [mk8dx.home.arpa]: ").strip() or "mk8dx.home.arpa"
                args.lan_bind_address = input("This Windows host's private IPv4 address (for example 192.168.0.50): ").strip()
            else:
                args.domain = input("Public website host name (without https://): ").strip()
            args.smtp_host = input("SMTP server name supplied by your mail provider: ").strip()
            args.smtp_port = int(input("SMTP implicit-TLS port [465]: ").strip() or "465")
            args.smtp_user = input("SMTP login (not your MK8DX admin account): ").strip()
            args.smtp_from = input("Authorized sender email address: ").strip()
            args.smtp_password = getpass.getpass("SMTP password (hidden): ")
        else:
            args.smtp_password = ""
        args.admin_email = input("Your own future MK8DX administrator email: ").strip()
        if "@" not in args.admin_email or " " in args.admin_email:
            raise SystemExit("Enter one valid-looking email address")
    if args.action == "adopt":
        adopt(args.state_dir)
        return
    if args.action == "status":
        status(args.state_dir)
        return
    if args.action == "change-origin":
        if not args.origin:
            raise SystemExit("--origin is required")
        change_origin(args.state_dir, args.origin)
        return
    target = safe_state_dir(args.state_dir, existing=False)
    if target.exists():
        raise SystemExit("Installation directory exists; reuse it, never regenerate keys")
    offline = args.mode == "offline-lan"
    if offline:
        from tooling.offline_lan_ca import private_lan_ip
        if sys.platform != "win32":
            raise SystemExit("Offline LAN CA provisioning currently requires a Windows host")
        if not args.lan_bind_address:
            raise SystemExit("Offline LAN needs --lan-bind-address")
        args.domain = str(private_lan_ip(args.lan_bind_address))
    if args.mode not in ("local", "offline-lan") and not all((args.domain, args.smtp_host, args.smtp_user,
                                        (getattr(args, "smtp_password", None) or args.smtp_password_file), args.smtp_from)):
        raise SystemExit("LAN/production requires address and operator SMTP settings")
    if args.mode not in ("local", "offline-lan") and args.smtp_port != 465:
        raise SystemExit("LAN/production currently requires SMTP port 465 with implicit TLS")
    if args.mode != "local" and (not args.domain.isascii() or
                                      any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-" for c in args.domain) or
                                      "." not in args.domain):
        raise SystemExit("Invalid website host name or LAN IP")
    if args.mode in ("lan", "offline-lan"):
        if not args.lan_bind_address:
            raise SystemExit("LAN needs --lan-bind-address")
        lan_address(args.lan_bind_address)
    target.mkdir(mode=0o700, parents=True)
    os.chmod(target, 0o700)
    ca_metadata = None
    if offline:
        from tooling.offline_lan_ca import provision
        ca_metadata = provision(target, args.domain)
    local = args.mode == "local"
    lan = args.mode in ("lan", "offline-lan")
    http_port = free_port(18080) if local else (443 if lan else 80)
    mailpit_port = free_port(18025) if local else None
    origin = f"http://127.0.0.1:{http_port}" if local else f"https://{args.domain}"
    valid_origin(origin)
    db_password = secrets.token_urlsafe(36)
    runtime = {
        "MK8DX_HOSTED_MYSQL_HOST": "mysql",
        "MK8DX_HOSTED_MYSQL_PORT": "3306",
        "MK8DX_HOSTED_MYSQL_USER": "mk8dx_app",
        "MK8DX_HOSTED_MYSQL_PASSWORD": db_password,
        "MK8DX_HOSTED_MYSQL_DATABASE": "mk8dx",
        "MK8DX_HOSTED_MYSQL_CONNECTION_LIMIT": "8",
        "MK8DX_HOSTED_SCHEMA9_CATALOG_PATH": "/app/packages/assets/schema9-asset-catalog-v1.json",
        "MK8DX_HOSTED_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64": key(),
        "MK8DX_HOSTED_AUTHENTICATION_LOOKUP_KEY_VERSION": "auth-v1",
        "MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_BASE64": key(),
        "MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_VERSION": "tt-enc-v1",
        "MK8DX_HOSTED_TIME_TRIAL_LOOKUP_HMAC_KEY_BASE64": key(),
        "MK8DX_HOSTED_TIME_TRIAL_LOOKUP_KEY_VERSION": "tt-lookup-v1",
        "MK8DX_HOSTED_TIME_TRIAL_DECRYPTION_KEYS_JSON": "{}",
        "MK8DX_HOSTED_TOURNAMENT_ENCRYPTION_KEY_BASE64": key(),
        "MK8DX_HOSTED_TOURNAMENT_ENCRYPTION_KEY_VERSION": "tournament-enc-v1",
        "MK8DX_HOSTED_TOURNAMENT_LOOKUP_HMAC_KEY_BASE64": key(),
        "MK8DX_HOSTED_TOURNAMENT_LOOKUP_KEY_VERSION": "tournament-lookup-v1",
        "MK8DX_HOSTED_TOURNAMENT_DECRYPTION_KEYS_JSON": "{}",
        "MK8DX_HOSTED_WEB_CSRF_ACTIVE_KEY_VERSION": "csrf-v1",
        "MK8DX_HOSTED_WEB_CSRF_KEYS_JSON": json.dumps({"csrf-v1": key()}, separators=(",", ":")),
        "MK8DX_HOSTED_AUTH_BASE_URL": origin,
        "MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON": json.dumps([origin]),
        "MK8DX_HOSTED_AUTH_SECRETS_JSON": json.dumps([{"version": 1, "value": key()}], separators=(",", ":")),
        "MK8DX_HOSTED_AUTH_CLIENT_IP_HEADERS_JSON": json.dumps(["x-real-ip"]),
        "MK8DX_HOSTED_AUTH_TRUSTED_PROXIES_JSON": json.dumps(["127.0.0.1"]),
        "MK8DX_HOSTED_SMTP_HOST": "mailpit" if local else ("" if offline else args.smtp_host),
        "MK8DX_HOSTED_SMTP_PORT": "1025" if local else str(args.smtp_port),
        "MK8DX_HOSTED_SMTP_SECURE": "false" if local or offline else "true",
        "MK8DX_HOSTED_SMTP_USERNAME": "" if local or offline else args.smtp_user,
        "MK8DX_HOSTED_SMTP_PASSWORD": "" if local or offline else (getattr(args, "smtp_password", None) or args.smtp_password_file.read_text(encoding="utf-8").strip()),
        "MK8DX_HOSTED_SMTP_FROM_ADDRESS": "demo@mk8dx.example" if local else ("" if offline else args.smtp_from),
        "MK8DX_HOSTED_WEB_PRODUCER_VERSION": "timetrials-web-v1",
    }
    if local:
        runtime["MK8DX_LOCAL_DEMO"] = "true"
    if offline:
        runtime["MK8DX_OFFLINE_LAN"] = "true"
    smtp_password = runtime.pop("MK8DX_HOSTED_SMTP_PASSWORD")
    runtime["MK8DX_HOSTED_SMTP_PASSWORD_BASE64"] = base64.b64encode(smtp_password.encode("utf-8")).decode("ascii")
    write_new(target / "api.env", "".join(dotenv(runtime)))
    write_new(target / "operator.json", json.dumps({k: v for k, v in runtime.items()
                                                    if k.startswith("MK8DX_HOSTED_") and k != "MK8DX_HOSTED_SMTP_PASSWORD_BASE64"} |
                                                    {"MK8DX_HOSTED_SMTP_PASSWORD": smtp_password}, indent=2) + "\n")
    container_readable(target)
    compose = {
        "MK8DX_PROJECT_NAME": "mk8dx-os-" + secrets.token_hex(5),
        "MK8DX_STATE_DIR": target.as_posix(),
        "MK8DX_DATABASE": "mk8dx",
        "MK8DX_DATABASE_USER": "mk8dx_app",
        "MK8DX_DATABASE_PASSWORD": db_password,
        "MK8DX_DATABASE_ROOT_PASSWORD": secrets.token_urlsafe(36),
        "MK8DX_BIND_ADDRESS": "127.0.0.1" if local else (lan_address(args.lan_bind_address) if lan else "0.0.0.0"),
        "MK8DX_HTTP_PORT": str(http_port),
    }
    if local:
        compose["MK8DX_MAILPIT_PORT"] = str(mailpit_port)
    else:
        compose["MK8DX_DOMAIN"] = args.domain
        if offline:
            compose["MK8DX_LAN_IP"] = args.domain
            compose["MK8DX_OFFLINE_HOST_PORT"] = str(free_port(19090))
            compose["MK8DX_OFFLINE_ROOT_CERT_SHA256"] = ca_metadata["root"]["certificateSha256"]
            compose["MK8DX_OFFLINE_ROOT_SPKI_SHA256"] = ca_metadata["root"]["spkiSha256"]
    if not (ROOT / "images").is_dir():
        # A source checkout builds its own images: give them their own names so a build never replaces the release
        # images an installed host package runs (compose.yaml defaults to the release tags).
        compose["MK8DX_API_IMAGE"] = "mk8dx-source/api:local"
        compose["MK8DX_WEB_IMAGE"] = "mk8dx-source/web:local"
    write_new(target / "compose.env", "".join(dotenv(compose)))
    write_json(target / PROFILE, {"schemaVersion": "mk8dx.operator.v1", "route": "A1" if local else ("A2_OFFLINE" if offline else ("A2" if lan else "B1")),
                                  "origin": origin, "project": compose["MK8DX_PROJECT_NAME"],
                                  "httpPort": http_port, "bindAddress": compose["MK8DX_BIND_ADDRESS"],
                                  "adminEmail": None if offline else args.admin_email,
                                  **({"rootCertificateSha256": ca_metadata["root"]["certificateSha256"]} if ca_metadata else {}),
                                  "smtp": {"host": runtime["MK8DX_HOSTED_SMTP_HOST"],
                                           "port": int(runtime["MK8DX_HOSTED_SMTP_PORT"]),
                                           "secure": runtime["MK8DX_HOSTED_SMTP_SECURE"] == "true",
                                           "username": runtime["MK8DX_HOSTED_SMTP_USERNAME"],
                                           "fromAddress": runtime["MK8DX_HOSTED_SMTP_FROM_ADDRESS"]}})
    write_json(target / SECRET, {**{k: runtime[k] for k in SECRET_KEYS},
                                 "MK8DX_HOSTED_SMTP_PASSWORD": smtp_password,
                                 "MK8DX_DATABASE_ROOT_PASSWORD": compose["MK8DX_DATABASE_ROOT_PASSWORD"]})
    write_json(target / PUBLIC, public_client(origin))
    print(f"Private installation: {target}")
    print(f"Web origin: {origin}")
    if local:
        print(f"Local mail inbox: http://127.0.0.1:{mailpit_port}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(f"Installation step stopped: {error}") from None
