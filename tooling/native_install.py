"""Non-Docker backend of install.py. One operator profile and one secret store per installation."""
import base64
import getpass
import json
import os
import secrets
import shutil
import hashlib
import gzip
import signal
import socket
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

from install import PROFILE, SECRET, PUBLIC, SECRET_KEYS, key, public_client, safe_state_dir, valid_origin, write_json, replace_group

ROOT = Path(__file__).resolve().parent.parent


def package_paths():
    if "public_html" in (part.lower() for part in ROOT.parts):
        raise ValueError("Keep the Node application root outside public_html")
    needed = ("api/dist/composition/passwordless-hosted-main.js", "api/package-lock.json",
              "web/index.html", "scanner/index.html", "assets", "mysql/migration-catalog-v1.json",
              "packages/assets/schema9-asset-catalog-v1.json")
    for name in needed:
        path = ROOT / name
        if not path.exists() or path.is_symlink():
            raise ValueError(f"Incomplete non-Docker package: {name}")
    return ROOT


def create(state, route, origin, admin_email, db_host, db_port, db_name, db_user,
           db_password, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from):
    package_paths()
    state = safe_state_dir(state, existing=False)
    if any(part.lower() in ("public_html", "htdocs") for part in state.parts):
        raise ValueError("Private installation data must stay outside public web folders")
    if state.exists():
        raise ValueError("Installation already exists; keys and data stay in place")
    valid_origin(origin)
    if route == "A3" and origin != "http://127.0.0.1:18090":
        raise ValueError("A3 uses the local Apache address http://127.0.0.1:18090")
    if route == "B2" and (urlsplit(origin).scheme != "https" or urlsplit(origin).port):
        raise ValueError("B2 needs a standard HTTPS domain origin")
    if not db_host or not db_host.isascii() or any(c.isspace() for c in db_host):
        raise ValueError("Invalid database host")
    if not 1 <= db_port <= 65535 or not db_name.replace("_", "").isalnum() or not db_user:
        raise ValueError("Invalid database connection")
    if db_user.lower() == "root" or not db_password:
        raise ValueError("Use a limited database user, not root")
    if route == "A3":
        if db_host not in ("127.0.0.1", "localhost"):
            raise ValueError("A3 database must stay on this computer")
        smtp_host, smtp_port, smtp_user, smtp_password, smtp_from = (
            "127.0.0.1", 18225, "", "", "demo@mk8dx.example")
    elif not (smtp_host and smtp_port == 465 and smtp_user and smtp_password and "@" in smtp_from):
        raise ValueError("B2 needs the mailbox SMTP login and implicit TLS on port 465")
    if not admin_email or "@" not in admin_email or any(c.isspace() for c in admin_email):
        raise ValueError("Enter the email address you will verify for the administrator")
    state.mkdir(parents=True, mode=0o700)
    os.chmod(state, 0o700)
    runtime = {
        "MK8DX_HOSTED_MYSQL_HOST": db_host, "MK8DX_HOSTED_MYSQL_PORT": str(db_port),
        "MK8DX_HOSTED_MYSQL_USER": db_user, "MK8DX_HOSTED_MYSQL_PASSWORD": db_password,
        "MK8DX_HOSTED_MYSQL_DATABASE": db_name, "MK8DX_HOSTED_MYSQL_CONNECTION_LIMIT": "8",
        "MK8DX_HOSTED_SCHEMA9_CATALOG_PATH": str(ROOT / "packages/assets/schema9-asset-catalog-v1.json"),
        "MK8DX_HOSTED_STATIC_WEB_ROOT": str(ROOT / "web"),
        "MK8DX_HOSTED_PUBLIC_BUNDLE_ROOT": str(ROOT),
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
        "MK8DX_HOSTED_SMTP_HOST": smtp_host, "MK8DX_HOSTED_SMTP_PORT": str(smtp_port),
        "MK8DX_HOSTED_SMTP_SECURE": "false" if route == "A3" else "true",
        "MK8DX_HOSTED_SMTP_USERNAME": smtp_user, "MK8DX_HOSTED_SMTP_PASSWORD": smtp_password,
        "MK8DX_HOSTED_SMTP_FROM_ADDRESS": smtp_from,
        "MK8DX_HOSTED_WEB_PRODUCER_VERSION": "timetrials-web-v1",
    }
    if route == "A3": runtime["MK8DX_LOCAL_DEMO"] = "true"
    profile = {"schemaVersion": "mk8dx.operator.v1", "route": route, "origin": origin,
               "project": "mk8dx-native-" + secrets.token_hex(5),
               "adminEmail": admin_email,
               "database": {"host": db_host, "port": db_port, "name": db_name, "user": db_user},
               "smtp": {"host": smtp_host, "port": smtp_port, "secure": route == "B2",
                        "username": smtp_user, "fromAddress": smtp_from}}
    write_json(state / PROFILE, profile)
    write_json(state / SECRET, {**{name: runtime[name] for name in SECRET_KEYS},
                                "MK8DX_HOSTED_MYSQL_PASSWORD": db_password,
                                "MK8DX_HOSTED_SMTP_PASSWORD": smtp_password,
                                **({"MK8DX_NATIVE_DATABASE_ROOT_PASSWORD": secrets.token_urlsafe(36)}
                                   if route == "A3" else {})})
    write_json(state / "operator.json", {k: v for k, v in runtime.items()
                                           if k.startswith("MK8DX_HOSTED_") or k == "MK8DX_LOCAL_DEMO"})
    write_json(state / PUBLIC, public_client(origin))
    for name in (PROFILE, SECRET, "operator.json", PUBLIC): os.chmod(state / name, 0o600)
    print(f"Private installation: {state}\nWebsite: {origin}\nDatabase: {db_name} on {db_host}:{db_port}")
    if route == "A3": print("Local test mailbox: http://127.0.0.1:18227")


def wizard(state, route):
    if route == "A3":
        origin = "http://127.0.0.1:18090"
        host, port = "127.0.0.1", 18306
        db_name, db_user, db_password = "mk8dx", "mk8dx_app", secrets.token_urlsafe(36)
        print("MK8DX will create its own MariaDB 11.4 database inside the private installation folder.")
    else:
        print("Create an empty database and its limited user in DirectAdmin first. No existing database is erased.")
        origin = "https://" + input("Website host name, without https://: ").strip()
        host = input("Database host from DirectAdmin: ").strip()
        port = int(input("Database port [3306]: ").strip() or "3306")
        db_name = input("Full database name (including provider prefix if shown): ").strip()
        db_user = input("Limited database user (full name): ").strip()
        db_password = getpass.getpass("Database user's password (hidden): ")
    if route == "A3":
        smtp_host, smtp_port, smtp_user, smtp_password, smtp_from = "", 0, "", "", ""
    else:
        print("Sign-in mail: MK8DX sends it through your mail provider over TLS on port 465 (implicit TLS). "
              "A provider that only offers STARTTLS on port 587 does not work yet. The password is not shown while you type.")
        smtp_host = input("Mailbox SMTP server name: ").strip()
        smtp_port = int(input("SMTP implicit-TLS port [465]: ").strip() or "465")
        smtp_user = input("Mailbox SMTP login: ").strip()
        smtp_password = getpass.getpass("Mailbox SMTP password (hidden): ")
        smtp_from = input("Authorized sender address: ").strip()
    admin_email = ""
    while "@" not in admin_email or " " in admin_email or admin_email.startswith("@"):
        if admin_email:
            print("That does not look like one email address; try again.")
        admin_email = input("Your own future MK8DX administrator email: ").strip()
    create(state, route, origin, admin_email, host, port, db_name, db_user,
           db_password, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from)


def loaded(state):
    state = safe_state_dir(state, existing=True)
    if any(part.lower() in ("public_html", "htdocs") for part in state.parts):
        raise ValueError("Private installation data is inside a public web folder")
    profile = json.loads((state / PROFILE).read_text(encoding="utf-8"))
    if profile.get("route") not in ("A3", "B2"): raise ValueError("This is not a non-Docker installation")
    secret = json.loads((state / SECRET).read_text(encoding="utf-8"))
    runtime = json.loads((state / "operator.json").read_text(encoding="utf-8"))
    public = json.loads((state / PUBLIC).read_text(encoding="utf-8"))
    db = profile["database"]
    for name, value in {"MK8DX_HOSTED_MYSQL_HOST": db["host"],
                        "MK8DX_HOSTED_MYSQL_PORT": str(db["port"]),
                        "MK8DX_HOSTED_MYSQL_DATABASE": db["name"],
                        "MK8DX_HOSTED_MYSQL_USER": db["user"],
                        "MK8DX_HOSTED_MYSQL_PASSWORD": secret["MK8DX_HOSTED_MYSQL_PASSWORD"],
                        "MK8DX_HOSTED_AUTH_BASE_URL": profile["origin"],
                        "MK8DX_HOSTED_SMTP_PASSWORD": secret["MK8DX_HOSTED_SMTP_PASSWORD"]}.items():
        if runtime.get(name) != value: raise ValueError("Saved profile and generated runtime disagree")
    if any(runtime.get(name) != secret.get(name) for name in SECRET_KEYS):
        raise ValueError("Saved secret keys and runtime disagree")
    if public != public_client(profile["origin"]): raise ValueError("Public client origin disagrees")
    return state, profile, runtime


def sync_package_paths(state, runtime):
    """Move derived paths to a checked new extracted package, never regenerate keys."""
    expected = {"MK8DX_HOSTED_SCHEMA9_CATALOG_PATH": str(ROOT / "packages/assets/schema9-asset-catalog-v1.json"),
                "MK8DX_HOSTED_STATIC_WEB_ROOT": str(ROOT / "web"),
                "MK8DX_HOSTED_PUBLIC_BUNDLE_ROOT": str(ROOT)}
    if all(runtime.get(name) == value for name, value in expected.items()): return runtime
    runtime.update(expected)
    replace_group([state / "operator.json"], [json.dumps(runtime, indent=2).encode() + b"\n"])
    print("Derived package paths refreshed; profile, database and keys retained")
    return runtime


def node_command(state, script, *arguments, input_text=None, summarize_migrations=False):
    command = ["node", str(ROOT / "api/dist" / script), "--private-environment-file",
               str(state / "operator.json"), *map(str, arguments)]
    if not summarize_migrations:
        subprocess.run(command, cwd=ROOT / "api", text=True, input=input_text, check=True)
        return
    # The migration tool prints every applied number; people only need the count.
    result = subprocess.run(command, cwd=ROOT / "api", text=True, input=input_text, capture_output=True)
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    try:
        report = json.loads(result.stdout)
        applied = report.get("applied") or []
        span = f" ({applied[0]}-{applied[-1]})" if applied else ""
        print(f"Database {report.get('database', '')}: {len(applied)} new migrations{span}, "
              f"{report.get('alreadyApplied', 0)} already applied")
    except (ValueError, AttributeError):
        print(result.stdout, end="")
    if result.returncode != 0:
        raise subprocess.CalledProcessError(result.returncode, command)


def change_origin(state, origin):
    state, profile, runtime = loaded(state)
    valid_origin(origin)
    if profile["route"] != "B2" or urlsplit(origin).scheme != "https" or urlsplit(origin).port:
        raise ValueError("Only B2 may change to another standard HTTPS origin")
    if profile["origin"] == origin: print("unchanged"); return
    profile["origin"] = origin
    runtime["MK8DX_HOSTED_AUTH_BASE_URL"] = origin
    runtime["MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON"] = json.dumps([origin])
    paths = [state / PROFILE, state / "operator.json", state / PUBLIC]
    replace_group(paths, [json.dumps(profile, indent=2).encode() + b"\n",
                          json.dumps(runtime, indent=2).encode() + b"\n",
                          json.dumps(public_client(origin), indent=2).encode() + b"\n"])
    print("Origin saved; refresh Passenger configuration and restart the app. Clients must reconnect.")


def change_smtp(state):
    state, profile, runtime = loaded(state)
    if profile["route"] != "B2": raise ValueError("A3 uses local Mailpit")
    smtp = profile["smtp"]
    host = input(f"SMTP host [{smtp['host']}]: ").strip() or smtp["host"]
    user = input(f"SMTP login [{smtp['username']}]: ").strip() or smtp["username"]
    sender = input(f"Authorized sender [{smtp['fromAddress']}]: ").strip() or smtp["fromAddress"]
    password = getpass.getpass("New SMTP password (Enter keeps current): ")
    secret = json.loads((state / SECRET).read_text(encoding="utf-8"))
    if not password: password = secret["MK8DX_HOSTED_SMTP_PASSWORD"]
    if not host or any(c.isspace() for c in host) or not user or not password or "@" not in sender:
        raise ValueError("SMTP needs a host, login, password and sender")
    smtp.update({"host": host, "username": user, "fromAddress": sender})
    runtime.update({"MK8DX_HOSTED_SMTP_HOST": host, "MK8DX_HOSTED_SMTP_USERNAME": user,
                    "MK8DX_HOSTED_SMTP_FROM_ADDRESS": sender, "MK8DX_HOSTED_SMTP_PASSWORD": password})
    secret["MK8DX_HOSTED_SMTP_PASSWORD"] = password
    replace_group([state / PROFILE, state / SECRET, state / "operator.json"],
                  [json.dumps(value, indent=2).encode() + b"\n" for value in (profile, secret, runtime)])
    print("SMTP saved; refresh Passenger configuration and restart the app")


def serve(state):
    state, profile, runtime = loaded(state)
    if profile["route"] != "A3": raise ValueError("B2 is started and restarted in DirectAdmin")
    tool = ROOT / "bin/mailpit.exe"
    if not tool.is_file(): raise ValueError("The Windows package is missing its local mail tool")
    environment = {k: v for k, v in os.environ.items() if not k.startswith("MK8DX_")}
    environment.update(runtime)
    environment["MK8DX_LOCAL_DEMO"] = "true"
    environment["PORT"] = "18190"
    environment["MK8DX_HOSTED_API_HOST"] = "127.0.0.1"
    database = start_local_database(state, profile, runtime)
    mail = None
    server = None
    try:
        mail = subprocess.Popen([str(tool), "--smtp", "127.0.0.1:18225", "--listen",
                                 "127.0.0.1:18227", "--database", str(state / "mailpit.db")], cwd=state)
        observed = json.loads(subprocess.check_output(
            ["node", str(ROOT / "api/dist/composition/external-database-check-main.js"),
             "--private-environment-file", str(state / "operator.json")], cwd=ROOT / "api", text=True))
        if observed["tableCount"] == 0:
            operate(state, "setup")
        else:
            operate(state, "check")
        server = subprocess.Popen(["node", str(ROOT / "api/dist/composition/passwordless-hosted-main.js")],
                                  cwd=ROOT / "api", env=environment)
        print("MK8DX is starting. Leave this window open. Open http://127.0.0.1:18090")
        print("Press Ctrl+C here to stop this MK8DX Node process and its local test mailbox.")
        while server.poll() is None and mail.poll() is None and database.poll() is None:
            try: server.wait(timeout=0.5)
            except subprocess.TimeoutExpired: pass
        if server.poll() is not None: raise RuntimeError("MK8DX Node process stopped; inspect the error above")
        if mail.poll() is not None: raise RuntimeError("Local mail capture stopped; inspect the error above")
        raise RuntimeError("Local MariaDB stopped; inspect the error above")
    except KeyboardInterrupt:
        print("Stopping this MK8DX installation")
    finally:
        for child in (server, mail):
            if child is not None and child.poll() is None:
                child.terminate()
                try: child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait(timeout=5)
        stop_local_database(state, database)


def stop_local_database(state, database):
    if database.poll() is None:
        secret = json.loads((state / SECRET).read_text(encoding="utf-8"))
        admin = state / "db-runtime/mariadb-11.4.13-winx64/bin/mariadb-admin.exe"
        db_env = os.environ.copy(); db_env["MYSQL_PWD"] = secret["MK8DX_NATIVE_DATABASE_ROOT_PASSWORD"]
        subprocess.run([str(admin), "--host=127.0.0.1", "--port=18306", "--user=root", "shutdown"],
                       env=db_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        try: database.wait(timeout=15)
        except subprocess.TimeoutExpired: database.terminate(); database.wait(timeout=5)


def maintenance(state, profile, runtime):
    if profile["route"] != "A3": raise ValueError("B2 database lifecycle belongs to DirectAdmin")
    database = start_local_database(state, profile, runtime)
    try:
        print("Only this MK8DX database is running. Run the update or restore in another PowerShell window.")
        print("Press Ctrl+C here when the operation is complete.")
        while database.poll() is None:
            try: database.wait(timeout=0.5)
            except subprocess.TimeoutExpired: pass
    except KeyboardInterrupt: pass
    finally: stop_local_database(state, database)


def start_local_database(state, profile, runtime):
    """Start only this A3 instance on loopback; never touch XAMPP's database service."""
    archive = ROOT / "bin/mariadb-11.4.13-winx64.zip"
    runtime_dir = state / "db-runtime"
    data_dir = state / "db-data"
    if not archive.is_file(): raise ValueError("The A3 package lacks MariaDB 11.4.13")
    if not runtime_dir.exists():
        runtime_dir.mkdir()
        with zipfile.ZipFile(archive) as source:
            for entry in source.infolist():
                relative = Path(entry.filename)
                if relative.is_absolute() or ".." in relative.parts:
                    raise ValueError("Unsafe MariaDB archive path")
                source.extract(entry, runtime_dir)
    executable = runtime_dir / "mariadb-11.4.13-winx64/bin"
    if not (executable / "mariadbd.exe").is_file(): raise ValueError("MariaDB binary missing")
    if not data_dir.exists():
        subprocess.run([str(executable / "mariadb-install-db.exe"), f"--datadir={data_dir}", "--port=18306", "--silent"],
                       cwd=runtime_dir, check=True)
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 18306)) == 0:
            raise ValueError("Port 18306 already belongs to a database; this installer will not use it")
    database = subprocess.Popen([str(executable / "mariadbd.exe"),
                                 f"--defaults-file={data_dir / 'my.ini'}", f"--datadir={data_dir}",
                                 "--bind-address=127.0.0.1", "--port=18306", "--console"], cwd=runtime_dir)
    for _ in range(60):
        if database.poll() is not None: raise RuntimeError("This installation's MariaDB did not start")
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", 18306)) == 0: break
        time.sleep(0.25)
    else:
        database.terminate(); raise RuntimeError("MariaDB did not become ready")
    marker = state / "db-provisioned.json"
    if not marker.exists():
        secret = json.loads((state / SECRET).read_text(encoding="utf-8"))
        root_password = secret["MK8DX_NATIVE_DATABASE_ROOT_PASSWORD"]
        app_password = secret["MK8DX_HOSTED_MYSQL_PASSWORD"]
        if not all(set(value) <= set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
                   for value in (root_password, app_password)):
            raise ValueError("Generated database password has unexpected characters")
        sql = ("CREATE DATABASE mk8dx CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; "
               f"CREATE USER 'mk8dx_app'@'127.0.0.1' IDENTIFIED BY '{app_password}'; "
               "GRANT ALL PRIVILEGES ON mk8dx.* TO 'mk8dx_app'@'127.0.0.1'; "
               f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{root_password}'; FLUSH PRIVILEGES;")
        subprocess.run([str(executable / "mariadb.exe"), "--host=127.0.0.1", "--port=18306", "--user=root"],
                       input=sql, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
        write_json(marker, {"schemaVersion": "mk8dx.native-database.v1", "database": "mk8dx",
                            "port": 18306, "engine": "MariaDB", "version": "11.4.13"})
    return database


def backup(state, output):
    state, profile, runtime = loaded(state)
    output = safe_state_dir(output, existing=False)
    if output.exists(): raise ValueError("Choose a new backup folder")
    local_dump = state / "db-runtime/mariadb-11.4.13-winx64/bin/mariadb-dump.exe"
    dump = str(local_dump) if profile["route"] == "A3" and local_dump.is_file() else \
        (shutil.which("mariadb-dump") or shutil.which("mysqldump"))
    if not dump: raise ValueError("Install the MariaDB command-line client; mariadb-dump is required")
    output.mkdir(parents=True, mode=0o700)
    env = os.environ.copy()
    env["MYSQL_PWD"] = runtime["MK8DX_HOSTED_MYSQL_PASSWORD"]
    command = [dump, "--host", runtime["MK8DX_HOSTED_MYSQL_HOST"], "--port", runtime["MK8DX_HOSTED_MYSQL_PORT"],
               "--user", runtime["MK8DX_HOSTED_MYSQL_USER"], "--single-transaction", "--routines",
               "--triggers", "--events", "--no-tablespaces", runtime["MK8DX_HOSTED_MYSQL_DATABASE"]]
    try:
        with (output / "database.sql.gz").open("xb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
                assert process.stdout is not None
                shutil.copyfileobj(process.stdout, compressed, length=1024 * 1024)
                process.stdout.close()
                assert process.stderr is not None
                process.stderr.read()
                process.stderr.close()
                process.wait()
                if process.returncode != 0:
                    raise RuntimeError(f"Database export failed with exit code {process.returncode}")
        for name in (PROFILE, SECRET, "operator.json", PUBLIC):
            shutil.copyfile(state / name, output / name)
            os.chmod(output / name, 0o600)
        manifest = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in output.iterdir() if p.is_file()}
        observed = json.loads(subprocess.check_output(
            ["node", str(ROOT / "api/dist/composition/external-database-check-main.js"),
             "--private-environment-file", str(state / "operator.json")],
            cwd=ROOT / "api", text=True))
        write_json(output / "BACKUP_MANIFEST.json", {"schemaVersion": "mk8dx.native-backup.v1",
                                                     "files": manifest, "database": profile["database"]["name"],
                                                     "engine": observed["engine"], "version": observed["version"]})
        os.chmod(output / "BACKUP_MANIFEST.json", 0o600)
        print(f"Private backup complete: {output}")
    except Exception:
        shutil.rmtree(output)
        raise


def verify_backup(output):
    output = safe_state_dir(output, existing=True)
    receipt = json.loads((output / "BACKUP_MANIFEST.json").read_text(encoding="utf-8"))
    for name, expected in receipt["files"].items():
        if hashlib.sha256((output / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Backup file differs: {name}")
    with gzip.open(output / "database.sql.gz", "rb") as stream:
        while stream.read(1024 * 1024): pass
    print("Backup verified")


def restore_new(backup_dir, state, db_host, db_port, db_name, db_user, db_password, origin=None):
    package_paths()
    verify_backup(backup_dir)
    backup_dir = safe_state_dir(backup_dir, existing=True)
    state = safe_state_dir(state, existing=False)
    if state.exists(): raise ValueError("Restore destination already exists")
    receipt = json.loads((backup_dir / "BACKUP_MANIFEST.json").read_text(encoding="utf-8"))
    profile = json.loads((backup_dir / PROFILE).read_text(encoding="utf-8"))
    secret = json.loads((backup_dir / SECRET).read_text(encoding="utf-8"))
    runtime = json.loads((backup_dir / "operator.json").read_text(encoding="utf-8"))
    if profile["route"] != "B2" or db_user.lower() == "root":
        raise ValueError("This restore uses a B2 backup and a limited new database user; use restore-local for A3")
    new_origin = origin or profile["origin"]
    valid_origin(new_origin)
    if profile["route"] == "B2" and urlsplit(new_origin).scheme != "https":
        raise ValueError("B2 restore needs an HTTPS address")
    profile["origin"] = new_origin
    profile["database"] = {"host": db_host, "port": db_port, "name": db_name, "user": db_user}
    runtime.update({"MK8DX_HOSTED_MYSQL_HOST": db_host, "MK8DX_HOSTED_MYSQL_PORT": str(db_port),
                    "MK8DX_HOSTED_MYSQL_DATABASE": db_name, "MK8DX_HOSTED_MYSQL_USER": db_user,
                    "MK8DX_HOSTED_MYSQL_PASSWORD": db_password,
                    "MK8DX_HOSTED_AUTH_BASE_URL": new_origin,
                    "MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON": json.dumps([new_origin]),
                    "MK8DX_HOSTED_SCHEMA9_CATALOG_PATH": str(ROOT / "packages/assets/schema9-asset-catalog-v1.json"),
                    "MK8DX_HOSTED_STATIC_WEB_ROOT": str(ROOT / "web"),
                    "MK8DX_HOSTED_PUBLIC_BUNDLE_ROOT": str(ROOT)})
    secret["MK8DX_HOSTED_MYSQL_PASSWORD"] = db_password
    if not db_host or not db_name or not db_user or not db_password or not 1 <= db_port <= 65535:
        raise ValueError("Complete target database settings are required")
    state.mkdir(parents=True, mode=0o700)
    for name, value in ((PROFILE, profile), (SECRET, secret), ("operator.json", runtime),
                        (PUBLIC, public_client(new_origin))):
        write_json(state / name, value)
        os.chmod(state / name, 0o600)
    observed = json.loads(subprocess.check_output(
        ["node", str(ROOT / "api/dist/composition/external-database-check-main.js"),
         "--private-environment-file", str(state / "operator.json")], cwd=ROOT / "api", text=True))
    if observed["tableCount"] != 0 or observed["engine"] != receipt.get("engine") or \
            observed["version"].split(".")[:2] != receipt.get("version", "").split(".")[:2]:
        raise ValueError("Target database must be empty and on the same tested engine/version series")
    client = shutil.which("mariadb") or shutil.which("mysql")
    if not client: raise ValueError("MariaDB command-line client is required to restore")
    env = os.environ.copy(); env["MYSQL_PWD"] = db_password
    with gzip.open(backup_dir / "database.sql.gz", "rb") as sql:
        process = subprocess.Popen([client, "--host", db_host, "--port", str(db_port), "--user", db_user,
                                    "--database", db_name], stdin=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        assert process.stdin is not None
        shutil.copyfileobj(sql, process.stdin, length=1024 * 1024)
        process.stdin.close()
        assert process.stderr is not None
        process.stderr.read(); process.stderr.close()
        process.wait()
        if process.returncode != 0: raise RuntimeError(f"Database restore failed with exit code {process.returncode}")
    operate(state, "check")
    print("Restored into a separate installation; start it, sign in, and check existing results. Bootstrap stays closed.")


def restore_local(backup_dir, state):
    """Restore an A3 backup into a newly created, empty A3 installation.

    The target's bundled database is started by `maintenance` in another window.
    Its newly provisioned root and application passwords remain tied to that
    local database. The source's account, encryption and admin state is retained.
    """
    package_paths()
    verify_backup(backup_dir)
    backup_dir = safe_state_dir(backup_dir, existing=True)
    state, target_profile, target_runtime = loaded(state)
    receipt = json.loads((backup_dir / "BACKUP_MANIFEST.json").read_text(encoding="utf-8"))
    source_profile = json.loads((backup_dir / PROFILE).read_text(encoding="utf-8"))
    source_secret = json.loads((backup_dir / SECRET).read_text(encoding="utf-8"))
    source_runtime = json.loads((backup_dir / "operator.json").read_text(encoding="utf-8"))
    target_secret = json.loads((state / SECRET).read_text(encoding="utf-8"))
    if source_profile["route"] != "A3" or target_profile["route"] != "A3":
        raise ValueError("Local restore requires an A3 backup and an A3 target")
    if source_profile["origin"] != target_profile["origin"]:
        raise ValueError("Local restore addresses disagree")
    observed = json.loads(subprocess.check_output(
        ["node", str(ROOT / "api/dist/composition/external-database-check-main.js"),
         "--private-environment-file", str(state / "operator.json")], cwd=ROOT / "api", text=True))
    if observed["tableCount"] != 0 or observed["engine"] != receipt.get("engine") or \
            observed["version"].split(".")[:2] != receipt.get("version", "").split(".")[:2]:
        raise ValueError("Target database must be empty and on the same tested engine/version series")
    client = state / "db-runtime/mariadb-11.4.13-winx64/bin/mariadb.exe"
    if not client.is_file(): raise ValueError("The target's MariaDB client is missing")
    with gzip.open(backup_dir / "database.sql.gz", "rb") as sql:
        environment = os.environ.copy()
        environment["MYSQL_PWD"] = target_secret["MK8DX_HOSTED_MYSQL_PASSWORD"]
        process = subprocess.Popen(
            [str(client), "--host=127.0.0.1", "--port=18306", "--user=mk8dx_app", "--database=mk8dx"],
            stdin=subprocess.PIPE, stderr=subprocess.PIPE, env=environment)
        assert process.stdin is not None
        shutil.copyfileobj(sql, process.stdin, length=1024 * 1024)
        process.stdin.close()
        assert process.stderr is not None
        process.stderr.read(); process.stderr.close()
        process.wait()
        if process.returncode != 0: raise RuntimeError(f"Database restore failed with exit code {process.returncode}")
    source_profile["database"] = target_profile["database"]
    source_secret["MK8DX_HOSTED_MYSQL_PASSWORD"] = target_secret["MK8DX_HOSTED_MYSQL_PASSWORD"]
    source_secret["MK8DX_NATIVE_DATABASE_ROOT_PASSWORD"] = target_secret["MK8DX_NATIVE_DATABASE_ROOT_PASSWORD"]
    source_runtime.update({name: target_runtime[name] for name in (
        "MK8DX_HOSTED_MYSQL_HOST", "MK8DX_HOSTED_MYSQL_PORT", "MK8DX_HOSTED_MYSQL_DATABASE",
        "MK8DX_HOSTED_MYSQL_USER", "MK8DX_HOSTED_MYSQL_PASSWORD",
        "MK8DX_HOSTED_SCHEMA9_CATALOG_PATH", "MK8DX_HOSTED_STATIC_WEB_ROOT",
        "MK8DX_HOSTED_PUBLIC_BUNDLE_ROOT")})
    replace_group([state / PROFILE, state / SECRET, state / "operator.json", state / PUBLIC],
                  [json.dumps(value, indent=2).encode() + b"\n" for value in
                   (source_profile, source_secret, source_runtime, public_client(source_profile["origin"]))])
    operate(state, "check")
    print("A3 backup restored. Stop maintenance, start the site, and verify existing accounts and results.")


def restore_wizard(backup_dir, state):
    verify_backup(backup_dir)
    source = json.loads((safe_state_dir(backup_dir, existing=True) / PROFILE).read_text(encoding="utf-8"))
    if source["route"] != "B2":
        raise ValueError("A3 restore uses a fresh local database installation; see the A3 guide")
    print("Use a new empty database and a new private installation folder. No existing database is cleared.")
    origin = "https://" + input("New HTTPS website host name: ").strip()
    host = input("New database host from DirectAdmin: ").strip()
    port = int(input("New database port [3306]: ").strip() or "3306")
    name = input("New full database name: ").strip()
    user = input("New limited database user: ").strip()
    password = getpass.getpass("New database password (hidden): ")
    restore_new(backup_dir, state, host, port, name, user, password, origin)


def operate(state, action, backup_output=None):
    package_paths()
    state, profile, runtime = loaded(state)
    if action in ("start", "serve", "maintenance", "setup", "upgrade", "check", "passenger-config"):
        runtime = sync_package_paths(state, runtime)
    if action == "status":
        displayed = {"route": profile["route"], "origin": profile["origin"],
                     "database": profile["database"]["name"], "stateDir": str(state),
                     "adminEmailConfigured": bool(profile["adminEmail"])}
        if profile["route"] == "A3":
            displayed["localMailInbox"] = "http://127.0.0.1:18227"
        print(json.dumps(displayed, indent=2))
    elif action == "check-database":
        node_command(state, "composition/external-database-check-main.js")
    elif action in ("setup", "upgrade"):
        if action == "upgrade":
            if backup_output is None: raise ValueError("Upgrade requires --backup-output in a new private folder")
            backup(state, backup_output)
            verify_backup(backup_output)
        node_command(state, "composition/external-database-check-main.js")
        node_command(state, "composition/migration-apply-main.js", "--migration-catalog",
                     ROOT / "mysql/migration-catalog-v1.json", "--confirm-database",
                     profile["database"]["name"], "--fresh-empty-database" if action == "setup" else "--backup-verified",
                     summarize_migrations=True)
        node_command(state, "composition/reference-seed-main.js", "--staff-seed",
                     ROOT / "mysql/reference/nintendo-staff-v1.json", "--world-record-seed",
                     ROOT / "mysql/reference/world-records-v1.json")
    elif action == "check":
        node_command(state, "composition/hosted-preflight-main.js", "--migration-catalog",
                     ROOT / "mysql/migration-catalog-v1.json")
    elif action == "admin":
        node_command(state, "administration/installer-administrator-main.js", "--email-stdin",
                     input_text=profile["adminEmail"] + "\n")
    elif action in ("start", "serve"):
        serve(state)
    elif action == "maintenance":
        maintenance(state, profile, runtime)
    elif action == "backup":
        if backup_output is None: raise ValueError("Choose --backup-output outside the package")
        backup(state, backup_output)
        verify_backup(backup_output)
    elif action == "verify-backup":
        if backup_output is None: raise ValueError("Choose --backup-output")
        verify_backup(backup_output)
    elif action == "passenger-config":
        if profile["route"] != "B2": raise ValueError("Passenger is only for B2")
        output = ROOT / "mk8dx-hosted.env.json"
        if output.exists():
            previous = json.loads(output.read_text(encoding="utf-8"))
            receipt = state / "passenger-config.sha256"
            if previous == runtime:
                print("Passenger configuration unchanged")
            elif not receipt.is_file() or hashlib.sha256(output.read_bytes()).hexdigest() != receipt.read_text(encoding="ascii").strip():
                raise ValueError("Passenger configuration was edited outside the installer")
            else:
                replace_group([output], [json.dumps(runtime, indent=2).encode() + b"\n"])
                receipt.write_text(hashlib.sha256(output.read_bytes()).hexdigest() + "\n", encoding="ascii")
                print("Passenger configuration refreshed; restart via DirectAdmin")
        else:
            write_json(output, runtime)
            os.chmod(output, 0o600)
            (state / "passenger-config.sha256").write_text(hashlib.sha256(output.read_bytes()).hexdigest() + "\n", encoding="ascii")
            print("Private Passenger configuration written outside public_html")
    else: raise ValueError("Unknown non-Docker action")
