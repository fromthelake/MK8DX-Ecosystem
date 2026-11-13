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
import ssl
import stat
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

PROFILE = "operator-profile.json"
SECRET = "secrets.json"
PUBLIC = "public-client.json"


def system_link(part: Path) -> bool:
    """A link the operating system owns, such as macOS's /var -> /private/var: only root can change it, so it
    cannot redirect private data to a place an ordinary user chose. Windows has no such exception."""
    return os.name != "nt" and part.is_symlink() and part.lstat().st_uid == 0


def safe_state_dir(value, *, existing):
    """Do not follow junctions or links into a different installation/source tree."""
    path = Path(os.path.abspath(value))
    for part in (*reversed(path.parents), path):
        if part.exists() and (part.is_symlink() or
                              getattr(part.lstat(), "st_file_attributes", 0) &
                              getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)) and not system_link(part):
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
    """Allow the containers' own users to read their bind-mounted files inside a private state directory:
    operator.json for the API's uid 10001, and public-client.json (public content, served to every browser) for
    the gateway's Caddy, which runs as uid 10002 (#34). Every other file there stays 0600."""
    if os.name != "posix":
        return
    state = Path(state)
    if stat.S_IMODE(state.stat().st_mode) & 0o077 != 0:
        return
    for name in ("operator.json", PUBLIC):
        if (state / name).is_file():
            os.chmod(state / name, 0o644)


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


def public_client(origin, offline=False):
    return {"schemaVersion": "mk8dx.public-client.v1", "websiteOrigin": origin,
            **({"authenticationMode": "offline-invitation"} if offline else {})}


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


def status(state, *, allow_expired_signer=False):
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
        signer = validate_signer(state, allow_expired=allow_expired_signer)
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


def move_offline_address(state, value):
    """A2 offline on a new LAN address (ADR-0223): same root CA, new signer, setup page and origin.

    Call with the gateway stopped. Devices keep trusting the root; they open the new address and
    sign in again, and paired apps pair again (their saved origin is the old address)."""
    state = safe_state_dir(state, existing=True)
    address = lan_address(value)
    names = (PROFILE, "api.env", "operator.json", PUBLIC, "compose.env")
    paths = [state / name for name in names]
    profile = json.loads(paths[0].read_text(encoding="utf-8"))
    if profile["route"] != "A2_OFFLINE":
        raise ValueError("This action applies only to A2 offline")
    if profile["bindAddress"] == address:
        return False
    origin = f"https://{address}"
    api = read_dotenv(paths[1])
    operator = json.loads(paths[2].read_text(encoding="utf-8"))
    public = json.loads(paths[3].read_text(encoding="utf-8"))
    compose_values = read_dotenv(paths[4])
    profile["origin"], profile["bindAddress"] = origin, address
    for target in (api, operator):
        target["MK8DX_HOSTED_AUTH_BASE_URL"] = origin
        target["MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON"] = json.dumps([origin])
    public["websiteOrigin"] = origin
    for name in ("MK8DX_DOMAIN", "MK8DX_LAN_IP", "MK8DX_BIND_ADDRESS"):
        compose_values[name] = address
    from tooling.offline_lan_ca_lifecycle import move_signer
    old_ip = json.loads((state / "offline-ca" / "metadata.json").read_text(encoding="utf-8"))["lanIp"]
    move_signer(state, address)
    try:
        replace_group(paths, [json.dumps(profile, indent=2).encode() + b"\n", "".join(dotenv(api)).encode(),
                              json.dumps(operator, indent=2).encode() + b"\n",
                              json.dumps(public, indent=2).encode() + b"\n", "".join(dotenv(compose_values)).encode()])
    except Exception:
        move_signer(state, old_ip)  # keep the signer and the configuration on one address
        raise
    return True


def move_offline_installation(state, value, qa_offline_candidate=False):
    """Stop the gateway, move to the new address, allow it on the network and start again."""
    if not qa_offline_candidate:
        raise ValueError("A2 offline is not yet qualified for general use; a QA host passes --qa-offline-candidate")
    state = safe_state_dir(state, existing=True)
    run_compose(state, "stop", "web")
    try:
        changed = move_offline_address(state, value)
    except Exception:
        run_compose(state, "up", "-d", "--no-build", "web")
        raise
    print(f"Network: {prepare_offline_network(state)}")
    services = tuple(s for s in route_services("A2_OFFLINE") if s != "mysql")
    run_compose(state, "up", "-d", "--wait", "--no-build", "--force-recreate", *services)
    status(state)
    addresses = offline_addresses(state)
    print(("Moved to the new address. " if changed else "Address unchanged. ") +
          f"Phones and other PCs open {addresses['phoneSetup']} and sign in again; paired apps pair again.")
    print(f"Website: {addresses['website']}")


ROOT = Path(__file__).resolve().parent.parent

# The console setup question, in plain words. A package offers only the routes it can install.
ROUTE_CHOICES = {
    "A1": "Try MK8DX on this computer only (Docker; sign-in mail stays on this computer)",
    "A2": "Home or club network with your own mail server (advanced; for most homes and clubs use the "
          "mk8dx-a2 package, which needs no mail server)",
    "A2O": "Home or club network without internet (the mk8dx-a2 package opens this setup in your browser)",
    "B1": "Public website on your own server (a VPS with Docker, your own domain and a mail provider)",
    "A3": "This Windows computer without Docker (XAMPP and Node.js)",
    "B2": "Public website on shared hosting with Node.js and MariaDB",
}


def package_routes(root=ROOT):
    """The routes this folder can install: a Docker host package, a package without Docker, or a source
    checkout (everything)."""
    docker = (root / "compose.yaml").is_file()
    native = (root / "Start-MK8DX-No-Docker.cmd").is_file()
    packaged = (root / "PACKAGE_MANIFEST.json").is_file()
    if packaged and native and not docker:
        return ["A3", "B2"]
    if packaged and docker:
        try:
            lan = json.loads((root / "images" / "images.json").read_text(encoding="utf-8")).get("qaOfflineCandidate") is True
        except (OSError, ValueError):
            lan = False
        return (["A2O"] if lan else []) + ["A1", "A2", "B1"]
    return ["A1", "A2", "A2O", "B1", "A3", "B2"]


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


# Caddy keeps managed leaf certificates in persistent storage. Replacing the
# intermediate and restarting Web alone leaves the old leaf chain in service.
# These commands touch only this installation's exact IP leaf directory while
# Web is stopped; the rest of Caddy's persistent storage stays intact.
_LEAF_QUARANTINE = r'''set -eu
ip="$1"; token="$2"
base=/data/caddy/certificates/mk8dx_offline
source="$base/$ip"
backup="/data/caddy/offline-ca-leaf-quarantine/$token"
test ! -e "$backup"
test ! -L "$backup"
if test -d "$source"; then
  test ! -L "$source"
  for extension in crt key json; do
    test -f "$source/$ip.$extension"
    test ! -L "$source/$ip.$extension"
  done
  test "$(find "$source" -mindepth 1 -maxdepth 1 | wc -l)" -eq 3
  mkdir -p /data/caddy/offline-ca-leaf-quarantine
  mv "$source" "$backup"
fi'''

_LEAF_RESTORE = r'''set -eu
ip="$1"; token="$2"
source="/data/caddy/certificates/mk8dx_offline/$ip"
backup="/data/caddy/offline-ca-leaf-quarantine/$token"
if test -d "$backup"; then
  test ! -L "$backup"
  if test -d "$source"; then
    test ! -L "$source"
    for extension in crt key json; do
      test -f "$source/$ip.$extension"
      test ! -L "$source/$ip.$extension"
    done
    test "$(find "$source" -mindepth 1 -maxdepth 1 | wc -l)" -eq 3
    rm "$source/$ip.crt" "$source/$ip.key" "$source/$ip.json"
    rmdir "$source"
  fi
  mv "$backup" "$source"
fi'''

_LEAF_CLEANUP = r'''set -eu
ip="$1"; token="$2"
backup="/data/caddy/offline-ca-leaf-quarantine/$token"
if test -d "$backup"; then
  test ! -L "$backup"
  for extension in crt key json; do
    test -f "$backup/$ip.$extension"
    test ! -L "$backup/$ip.$extension"
  done
  test "$(find "$backup" -mindepth 1 -maxdepth 1 | wc -l)" -eq 3
  rm "$backup/$ip.crt" "$backup/$ip.key" "$backup/$ip.json"
  rmdir "$backup"
fi'''


def leaf_storage(state, script, ip, token):
    from tooling.offline_lan_ca import private_lan_ip
    if str(private_lan_ip(ip)) != ip or not re.fullmatch(r"[0-9a-f]{16}", token):
        raise ValueError("Invalid offline leaf maintenance target")
    run_compose(state, "run", "-T", "--rm", "--no-deps", "--entrypoint", "sh", "web",
                "-ec", script, "sh", ip, token)


def verify_rotated_leaf(state, ip):
    """Check the exact HTTPS leaf and stored chain against the new signer."""
    from cryptography import x509
    from cryptography.hazmat.primitives.asymmetric import ec

    state = safe_state_dir(state, existing=True)
    root_path = state / "offline-ca/serving/root.pem"
    signer = x509.load_pem_x509_certificate(
        (state / "offline-ca/serving/intermediate.pem").read_bytes())
    context = ssl.create_default_context(cafile=str(root_path))
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                         urllib.request.HTTPSHandler(context=context))
    response = opener.open(f"https://{ip}/health/ready", timeout=15)
    with response:
        if response.status != 200:
            raise RuntimeError("Offline gateway readiness did not return 200")
    with socket.create_connection((ip, 443), timeout=15) as connection:
        with context.wrap_socket(connection, server_hostname=ip) as tls:
            served = x509.load_der_x509_certificate(tls.getpeercert(binary_form=True))
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "MK8DX_"))}
    stored = subprocess.check_output(compose_command(state) + ["exec", "-T", "web", "cat",
        f"/data/caddy/certificates/mk8dx_offline/{ip}/{ip}.crt"], cwd=ROOT, env=clean_env)
    chains = [x509.load_pem_x509_certificate(item) for item in
              re.findall(rb"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", stored, re.S)]
    if len(chains) != 2 or chains[0] != served or chains[1] != signer:
        raise RuntimeError("Offline gateway still serves an old or unexpected certificate chain")
    signer.public_key().verify(served.signature, served.tbs_certificate_bytes,
                               ec.ECDSA(served.signature_hash_algorithm))


OFFLINE_GATED = ("setup", "start", "apply", "upgrade", "admin", "update-package")
PACKAGE_RECORD = "package.json"


def package_images():
    """The images (and revision) this package ships, or None for a source checkout."""
    packaged = ROOT / "images" / "images.json"
    if not packaged.is_file():
        return None
    tags = json.loads(packaged.read_text(encoding="utf-8"))
    return {"api": tags["api"], "web": tags["web"], "revision": tags.get("revision")}


def revision_number(revision):
    """A comparable key for a package revision, or None when it cannot be ordered.

    QA builds are numbered rN; GitHub releases carry their tag, vX.Y.Z or vX.Y.Z-rc.N (a release
    candidate sorts before its release). Only keys of the same kind are compared with each other.
    """
    match = re.fullmatch(r"r(\d+)", revision or "")
    if match:
        return ("qa", int(match.group(1)))
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?", revision or "")
    if match:
        major, minor, patch, rc = match.groups()
        return ("release", int(major), int(minor), int(patch), int(rc) if rc is not None else float("inf"))
    return None


def installed_package(state):
    """What an installation runs now: its compose images, and the package revision when one was recorded."""
    state = Path(state)
    values = read_dotenv(state / "compose.env")
    record = state / PACKAGE_RECORD
    revision = json.loads(record.read_text(encoding="utf-8")).get("revision") if record.is_file() else None
    return {"api": values.get("MK8DX_API_IMAGE"), "web": values.get("MK8DX_WEB_IMAGE"), "revision": revision}


def update_offer(state):
    """Whether this package is a different (newer) build than the installation runs. A known older
    revision is refused: its migration catalog cannot describe the newer database."""
    shipped = package_images()
    if shipped is None:
        return {"available": False}
    running = installed_package(state)
    new, old = revision_number(shipped["revision"]), revision_number(running["revision"])
    comparable = new is not None and old is not None and new[0] == old[0]
    older = comparable and new < old
    # A newer package is an update even with the same images: its launcher, wizard and guide are new, and the
    # scheduled tasks and the shortcut must move to its folder (owner 11-11, r20 -> r21 offered nothing).
    newer = comparable and new > old
    differs = (running["api"], running["web"]) != (shipped["api"], shipped["web"]) or newer
    return {"available": differs and not older, "olderPackage": differs and older,
            "from": running["revision"], "to": shipped["revision"]}


def record_package(state):
    """Remember which package revision this installation runs (shown and compared at the next update)."""
    shipped = package_images()
    if shipped is None:
        return
    path = Path(state) / PACKAGE_RECORD
    content = json.dumps({"schemaVersion": "mk8dx.installed-package.v1", **shipped}, indent=2) + "\n"
    if path.is_file():
        replace_group([path], [content.encode("utf-8")])
    else:
        write_new(path, content)


def use_package_images(state):
    """Point the installation at this package's images; returns the previous compose values for a rollback."""
    shipped = package_images()
    if shipped is None:
        raise ValueError("Only a host package can update an installation")
    for image in (shipped["api"], shipped["web"]):
        if subprocess.run(["docker", "image", "inspect", image], capture_output=True, check=False).returncode != 0:
            raise RuntimeError(f"This package's image {image} is not loaded; start the package with its start file")
    path = Path(state) / "compose.env"
    before = path.read_bytes()
    values = read_dotenv(path)
    values["MK8DX_API_IMAGE"], values["MK8DX_WEB_IMAGE"] = shipped["api"], shipped["web"]
    replace_group([path], ["".join(dotenv(values)).encode("utf-8")])
    return before


def route_services(route):
    """Long-running Compose services of a route (offline LAN adds the loopback host page)."""
    return {"A1": ("mysql", "mailpit", "api", "web"),
            "A2_OFFLINE": ("mysql", "api", "web", "host-admin")}.get(route, ("mysql", "api", "web"))


def _powershell(script, *, elevated=False, timeout=180):
    if elevated:
        encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        script = ("$p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru "
                  f"-ArgumentList '-NoProfile','-EncodedCommand','{encoded}'; exit $p.ExitCode")
    return subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                          capture_output=True, text=True, timeout=timeout, check=False)


def offline_rule_name(ip):
    """One rule per host address, so reinstalling or updating never asks again."""
    return "MK8DX-A2-offline-" + ip


def _rule_probe(ip):
    # Any enabled MK8DX A2 rule (also an older per-project name) for this exact address counts.
    return (f"$i = (Get-NetIPAddress -IPAddress '{ip}' -ErrorAction Stop).InterfaceIndex;"
            "$c = (Get-NetConnectionProfile -InterfaceIndex $i -ErrorAction Stop).NetworkCategory;"
            "$r = [bool](Get-NetFirewallRule -Name 'MK8DX-A2-offline-*' -ErrorAction SilentlyContinue | "
            f"Where-Object {{ $_.Enabled -eq 'True' -and (($_ | Get-NetFirewallAddressFilter).LocalAddress -contains '{ip}') }});"
            "Write-Output \"$c|$r\"")


def offline_network_state(state):
    """(category, rule_exists) for the installation's LAN address; no elevation."""
    profile = json.loads((Path(state) / PROFILE).read_text(encoding="utf-8"))
    ip = profile["bindAddress"]
    probe = _powershell(_rule_probe(ip), timeout=60)
    category, _, exists = probe.stdout.strip().partition("|")
    if probe.returncode != 0 or not category:
        raise ValueError(f"The address {ip} is not active on this computer; reconnect it or use change-lan-address")
    return category, exists == "True"


def prepare_offline_network(state):
    """One UAC confirmation: mark this home network Private (if Public) and allow 80/443 for it.

    Used by the setup wizard, where the person explicitly chose 'make this home network
    private and allow MK8DX'. A Domain network is never changed. Linux/macOS: see host_platform.lan_firewall."""
    if sys.platform != "win32":
        from tooling import host_platform
        return host_platform.lan_firewall(json.loads((Path(state) / PROFILE).read_text(encoding="utf-8"))["bindAddress"])
    category, exists = offline_network_state(state)
    if category == "Private" and exists:
        return "present"
    if category not in ("Private", "Public"):
        raise ValueError(f"The network is '{category}'; ask its administrator to allow TCP 80/443")
    profile = json.loads((Path(state) / PROFILE).read_text(encoding="utf-8"))
    ip = profile["bindAddress"]
    rule = offline_rule_name(ip)
    script = ""
    if category == "Public":
        script += (f"$i = (Get-NetIPAddress -IPAddress '{ip}' -ErrorAction Stop).InterfaceIndex;"
                   "Set-NetConnectionProfile -InterfaceIndex $i -NetworkCategory Private -ErrorAction Stop;")
    if not exists:
        script += (f"New-NetFirewallRule -Name '{rule}' -DisplayName 'MK8DX A2 offline (HTTP/HTTPS {ip})' "
                   f"-Direction Inbound -Action Allow -Protocol TCP -LocalPort 80,443 -LocalAddress '{ip}' "
                   "-Profile Private | Out-Null")
    result = _powershell("$ErrorActionPreference='Stop';" + script, elevated=True)
    if result.returncode != 0:
        raise ValueError("Windows did not allow the change (the permission prompt was declined or failed)")
    return "created"


def ensure_offline_firewall(state):
    """Open TCP 80/443 on the selected LAN address for the Windows Private profile only (ADR-0223).

    Refuses when that network is not marked Private; creating the rule asks one UAC
    confirmation. An existing rule of this installation is left as it is."""
    if sys.platform != "win32":
        from tooling import host_platform
        return host_platform.lan_firewall(json.loads((Path(state) / PROFILE).read_text(encoding="utf-8"))["bindAddress"])
    profile = json.loads((Path(state) / PROFILE).read_text(encoding="utf-8"))
    ip = profile["bindAddress"]
    rule = offline_rule_name(ip)
    probe = _powershell(_rule_probe(ip), timeout=60)
    category, _, exists = probe.stdout.strip().partition("|")
    if probe.returncode != 0 or not category:
        raise ValueError(f"The address {ip} is not active on this computer; reconnect it or use change-lan-address")
    if category != "Private":
        raise ValueError(f"The network of {ip} is '{category}', not Private. In Windows Settings > Network & internet, "
                         "open this network and choose 'Private network', then run this step again")
    if exists == "True":
        return "present"
    created = _powershell(
        f"New-NetFirewallRule -Name '{rule}' -DisplayName 'MK8DX A2 offline (HTTP/HTTPS {ip})' -Direction Inbound "
        f"-Action Allow -Protocol TCP -LocalPort 80,443 -LocalAddress '{ip}' -Profile Private | Out-Null", elevated=True)
    if created.returncode != 0:
        raise ValueError("The firewall rule was not created (the Windows permission prompt was declined or failed). "
                         "Phones and other PCs cannot reach this host until this step succeeds")
    return "created"


def offline_addresses(state):
    profile = json.loads((Path(state) / PROFILE).read_text(encoding="utf-8"))
    host_port = read_dotenv(Path(state) / "compose.env")["MK8DX_OFFLINE_HOST_PORT"]
    return {"hostPage": f"http://127.0.0.1:{host_port}/", "phoneSetup": f"http://{profile['bindAddress']}/setup",
            "website": profile["origin"]}


def operate(state, action, backup_output=None, user_account_id=None, force_ca_rotation=False,
            qa_offline_candidate=False):
    route = json.loads((safe_state_dir(state, existing=True) / PROFILE).read_text(encoding="utf-8"))["route"]
    if route == "A2_OFFLINE" and action in OFFLINE_GATED and not qa_offline_candidate:
        raise ValueError("A2 offline is not yet qualified for general use (fail-closed until its acceptance passes). "
                         "Only a disposable QA host may continue with --qa-offline-candidate")
    services = route_services(route)
    recreated = tuple(s for s in services if s not in ("mysql", "mailpit"))
    if action == "maintain-ca":
        if route != "A2_OFFLINE":
            raise ValueError("CA maintenance applies only to offline LAN")
        status(state, allow_expired_signer=True)
        from tooling.offline_lan_ca_lifecycle import validate_signer, rotate_intermediate
        signer = validate_signer(state, allow_expired=True)
        due = datetime.fromisoformat(signer["rotationDueAt"])
        if due.tzinfo is None:
            raise ValueError("Offline CA rotation date lacks a timezone")
        if not force_ca_rotation and datetime.now(timezone.utc) < due:
            print("Offline CA signer is not due for rotation")
            return
        run_compose(state, "stop", "web")
        ip = json.loads((Path(state) / PROFILE).read_text(encoding="utf-8"))["bindAddress"]
        token = secrets.token_hex(8)
        try:
            rotate_intermediate(state)
            leaf_storage(state, _LEAF_QUARANTINE, ip, token)
            run_compose(state, "up", "-d", "--wait", "--no-build", "--force-recreate", "web")
            verify_rotated_leaf(state, ip)
        except Exception:
            # Restore the previous managed leaf, if one was moved, and bring
            # HTTPS back before surfacing the rotation error.
            run_compose(state, "stop", "web")
            try:
                leaf_storage(state, _LEAF_RESTORE, ip, token)
            finally:
                run_compose(state, "up", "-d", "--wait", "--no-build", "--force-recreate", "web")
            raise
        leaf_storage(state, _LEAF_CLEANUP, ip, token)
        status(state)
        print("Offline CA signer and served leaf rotated; HTTPS verified")
        return
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
        run_compose(state, "up", "-d", "--no-build", "--force-recreate", *recreated)
    elif action == "upgrade":
        if backup_output is None:
            raise ValueError("Upgrade requires --backup-output in a new private directory")
        from lifecycle import backup, verify_backup
        if route == "A2_OFFLINE":
            # The encrypted offline backup uses the recovery code the setup wizard stored.
            from tooling.auto_backup import backup_with_stored_code
            backup_with_stored_code(Path(state), Path(backup_output))
        else:
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
        run_compose(state, "up", "-d", "--no-build", "--force-recreate", *recreated)
        status(state)
    elif action == "update-package":
        # A2 offline: this (newer) package takes over an installation. The caller made and verified the
        # encrypted backup first (the setup wizard, phase "backup"); nothing has changed before this point.
        if route != "A2_OFFLINE":
            raise ValueError("Package update applies to A2 offline; other routes use upgrade")
        if backup_output is None or not Path(backup_output).is_dir():
            raise ValueError("Package update requires --backup-output naming the verified backup made just before")
        from lifecycle import verify_backup
        verify_backup(backup_output)
        offer = update_offer(state)
        if offer.get("olderPackage"):
            raise ValueError(f"This package ({offer['to']}) is older than the installation ({offer['from']})")
        before = use_package_images(state)
        try:
            run_compose(state, "config", "--quiet")
            run_compose(state, "up", "-d", "--wait", "--no-build", "mysql")
        except Exception:
            # Nothing ran on the new images yet: go back to the old ones exactly.
            replace_group([Path(state) / "compose.env"], [before])
            raise
        print("Applying database updates of the new version")
        run_compose(state, "run", "--rm", "--no-deps", "api", "sh", "/app/operator-command.sh",
                    "dist/composition/migration-apply-main.js", "--migration-catalog",
                    "/app/infrastructure/mysql/migration-catalog-v1.json", "--confirm-database", "mk8dx", "--backup-verified")
        run_compose(state, "run", "--rm", "--no-deps", "api", "sh", "/app/operator-command.sh",
                    "dist/composition/reference-seed-main.js", "--staff-seed",
                    "/app/infrastructure/mysql/reference/nintendo-staff-v1.json", "--world-record-seed",
                    "/app/infrastructure/mysql/reference/world-records-v1.json")
        print("Starting the new version")
        run_compose(state, "up", "-d", "--wait", "--no-build", "--force-recreate", *recreated)
        status(state)
        record_package(state)
        print(f"Updated to package {offer.get('to') or 'of this folder'}")
    elif action in ("setup", "start"):
        run_compose(state, "config", "--quiet")
        if action == "setup":
            run_compose(state, "up", "-d", "--wait", "--no-build", "mysql", *("mailpit",) if route == "A1" else ())
            run_compose(state, "run", "--rm", "--no-deps", "api", "sh", "/app/operator-command.sh",
                        "dist/composition/migration-apply-main.js", "--migration-catalog",
                        "/app/infrastructure/mysql/migration-catalog-v1.json", "--confirm-database", "mk8dx", "--fresh-empty-database")
            run_compose(state, "run", "--rm", "--no-deps", "api", "sh", "/app/operator-command.sh",
                        "dist/composition/reference-seed-main.js", "--staff-seed",
                        "/app/infrastructure/mysql/reference/nintendo-staff-v1.json", "--world-record-seed",
                        "/app/infrastructure/mysql/reference/world-records-v1.json")
        if route == "A2_OFFLINE":
            run_compose(state, "up", "-d", "--wait", "--no-build", *services)
            status(state)
            firewall = ensure_offline_firewall(state)
            addresses = offline_addresses(state)
            print(f"LAN firewall rule (Private profile, 80/443): {firewall}")
            print(f"Host page (only on this computer): {addresses['hostPage']}")
            print(f"Phones and other PCs first open: {addresses['phoneSetup']}")
            print(f"Website after trusting the certificate: {addresses['website']}")
            return
        run_compose(state, "up", "-d", "--no-build", *services)
        status(state)
    elif action == "admin" and route == "A2_OFFLINE":
        # No email in A2 offline: the administrator is created on the loopback host page,
        # which the one-time host unlock opens for this computer only.
        run_compose(state, "run", "-T", "--rm", "--no-deps", "host-admin", "node",
                    "dist/administration/offline-host-unlock-main.js",
                    *(["--bootstrap"] if user_account_id is None else ["--user-account-id", user_account_id]))
        print(f"Open on this computer: {offline_addresses(state)['hostPage']}")
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
    parser.add_argument("action", choices=["init", "wizard", "adopt", "status", "change-origin", "change-lan-address", "change-smtp", "set-admin-email", "setup", "start", "stop", "serve", "maintenance", "maintain-ca", "check", "check-database", "apply", "admin", "host-unlock", "upgrade", "update-package", "backup", "verify-backup", "restore-new", "restore-local", "restore-wizard", "passenger-config"])
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
    parser.add_argument("--qa-offline-candidate", action="store_true",
                        help="Allow A2 offline setup/start on a disposable QA host before its acceptance (ADR-0223)")
    parser.add_argument("--force-ca-rotation", action="store_true",
                        help="Rotate the offline signer now, before its scheduled due date")
    parser.add_argument("--backup-output", type=Path, help="New private backup directory for upgrade")
    parser.add_argument("--lan-bind-address", help="Private IPv4 interface of the Windows LAN host")
    parser.add_argument("--db-host")
    parser.add_argument("--db-port", type=int, default=3306)
    parser.add_argument("--db-name")
    parser.add_argument("--db-user")
    parser.add_argument("--db-password-file", type=Path)
    parser.add_argument("--backup-input", type=Path)
    args = parser.parse_args()
    if args.force_ca_rotation and args.action != "maintain-ca":
        raise ValueError("--force-ca-rotation applies only to maintain-ca")
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
        offered = package_routes()
        print("Where will MK8DX run?")
        for code in offered:
            print(f"  {code:<4} {ROUTE_CHOICES[code]}")
        selected = ""
        while selected not in offered:
            try:
                selected = input(f"Type {', '.join(offered[:-1])} or {offered[-1]} and press Enter: ").strip().upper().replace(" ", "")
            except EOFError:
                raise SystemExit("Setup cancelled before a choice was made; nothing was created.") from None
            if selected not in offered:
                print(f"'{selected}' is not one of the choices above.")
        if selected in ("A3", "B2"):
            from native_install import wizard as native_wizard
            native_wizard(args.state_dir, selected)
            return
        if selected not in ("A1", "A2", "A2O", "B1"):
            raise SystemExit("Choose exactly A1, A2, A2O, A3, B1 or B2")
        args.mode = {"A1": "local", "A2": "lan", "A2O": "offline-lan", "B1": "production"}[selected]
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
    if args.action in ("status", "check", "check-database", "setup", "start", "serve", "maintenance", "admin", "upgrade", "backup", "verify-backup", "passenger-config", "change-origin", "change-smtp", "set-admin-email", "stop"):
        candidate = safe_state_dir(args.state_dir, existing=True) / PROFILE
        if candidate.is_file() and json.loads(candidate.read_text(encoding="utf-8")).get("route") in ("A3", "B2"):
            from native_install import operate as native_operate, change_origin as native_origin, change_smtp as native_smtp
            if args.action == "stop":
                raise SystemExit("This installation runs without Docker. A3: press Ctrl+C in the MK8DX window "
                                 "(Start-MK8DX-No-Docker.cmd) and stop Apache in XAMPP. B2: stop the Node.js app in "
                                 "your hosting panel.")
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
        route = json.loads((safe_state_dir(args.state_dir, existing=True) / PROFILE).read_text(encoding="utf-8"))["route"]
        if route == "A2_OFFLINE":
            move_offline_installation(args.state_dir, args.lan_bind_address, args.qa_offline_candidate)
            return
        change_lan_address(args.state_dir, args.lan_bind_address)
        return
    if args.action in ("setup", "start", "stop", "check", "apply", "admin", "host-unlock", "upgrade", "update-package",
                       "maintain-ca"):
        operate(args.state_dir, args.action, args.backup_output, args.user_account_id,
                args.force_ca_rotation, args.qa_offline_candidate)
        return
    if args.action == "wizard":
        route = native_route
        args.mode = {"A1": "local", "A2": "lan", "A2O": "offline-lan", "B1": "production"}[route]
        if route == "A2O":
            from tooling.offline_lan_ca import private_lan_ip
            print("A2 offline needs this Windows computer to keep one private IPv4 address on your home network.")
            print("Tip: reserve it in your router (DHCP reservation); a new address later means a new phone setup QR.")
            args.lan_bind_address = input("This computer's private IPv4 address (see ipconfig, e.g. 192.168.0.50): ").strip()
            private_lan_ip(args.lan_bind_address)
        elif route != "A1":
            if route == "A2":
                args.domain = input("Private website name [mk8dx.home.arpa]: ").strip() or "mk8dx.home.arpa"
                args.lan_bind_address = input("This Windows host's private IPv4 address (for example 192.168.0.50): ").strip()
            else:
                args.domain = input("Public website host name (without https://): ").strip()
            print("Sign-in mail: MK8DX sends it through your mail provider over TLS on port 465 (implicit TLS). "
                  "A provider that only offers STARTTLS on port 587 does not work yet. The password is not shown while you type.")
            args.smtp_host = input("SMTP server name supplied by your mail provider: ").strip()
            args.smtp_port = int(input("SMTP implicit-TLS port [465]: ").strip() or "465")
            args.smtp_user = input("SMTP login (not your MK8DX admin account): ").strip()
            args.smtp_from = input("Authorized sender email address: ").strip()
            args.smtp_password = getpass.getpass("SMTP password (hidden): ")
        else:
            args.smtp_password = ""
        if route != "A2O":  # A2 offline has no email: the administrator is created on the host page
            args.admin_email = ""
            while "@" not in args.admin_email or " " in args.admin_email or args.admin_email.startswith("@"):
                if args.admin_email:
                    print("That does not look like one email address; try again.")
                args.admin_email = input("Your own future MK8DX administrator email: ").strip()
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
        if not (sys.platform == "win32" or sys.platform.startswith("linux") or sys.platform == "darwin"):
            raise SystemExit("Offline LAN CA provisioning needs Windows, Linux or macOS")
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
        # The Compose gateway service; compose.yaml sets the same value for the API container.
        "MK8DX_HOSTED_AUTH_TRUSTED_PROXIES_JSON": json.dumps(["web"]),
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
    packaged = ROOT / "images" / "images.json"
    if packaged.is_file():
        # A host package names the exact images it ships (for example an A2 offline candidate).
        tags = json.loads(packaged.read_text(encoding="utf-8"))
        compose["MK8DX_API_IMAGE"], compose["MK8DX_WEB_IMAGE"] = tags["api"], tags["web"]
    elif not (ROOT / "images").is_dir():
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
    write_json(target / PUBLIC, public_client(origin, offline))
    print(f"Private installation: {target}")
    print(f"Web origin: {origin}")
    if local:
        print(f"Local mail inbox: http://127.0.0.1:{mailpit_port}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(f"Installation step stopped: {error}") from None
    except (EOFError, KeyboardInterrupt):
        raise SystemExit("Setup cancelled. Start the same file again to continue.") from None
