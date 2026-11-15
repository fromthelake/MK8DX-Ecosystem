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

from install import PROFILE, SECRET, PUBLIC, SECRET_KEYS, key, public_client, safe_state_dir, valid_origin, write_json, replace_group, t
from tooling import database_accounts as accounts

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = "operator.json"  # the running website's settings (B2: copied into mk8dx-hosted.env.json)


def single_account_warning():
    return t("Warning: the website uses the same database account as the database updates. It keeps working, but "
             "a fault that lets someone run SQL could then also delete tables. Create a second database user with "
             "only SELECT, INSERT, UPDATE and DELETE on this database in your hosting panel and run: "
             "install.py database-accounts --state-dir <folder> (guide: B2 webhosting, separate database accounts).")


def database_logins(profile, secret):
    """The installation's database logins: runtime (the website), migration (updates, restore) and backup.
    An installation from before the split has one login for everything."""
    db = profile["database"]
    runtime = (db["user"], secret["MK8DX_HOSTED_MYSQL_PASSWORD"])
    migration = ((db["migrationUser"], secret[accounts.MIGRATION_PASSWORD]) if db.get("migrationUser") else runtime)
    backup = ((db["backupUser"], secret[accounts.BACKUP_PASSWORD]) if db.get("backupUser") else migration)
    return {"runtime": runtime, "migration": migration, "backup": backup}


def separate(profile):
    return bool(profile["database"].get("migrationUser"))


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
           db_password, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from,
           runtime_user=None, runtime_password=None):
    """`db_user` owns the database (migrations, restore); `runtime_user` is the website's own account that may
    only read and write rows. A3 creates both (and a backup account) on its own MariaDB. B2 takes them from the
    hosting panel; without a runtime user the website shares `db_user` and the installer warns."""
    package_paths()
    if route == "A3":
        runtime_user, runtime_password = accounts.RUNTIME_USER, accounts.new_password()
    if runtime_user is not None:
        if (not runtime_user or not runtime_password or runtime_user.lower() == "root" or
                runtime_user == db_user):
            raise ValueError("The website's database user must be a second, limited user (not root, not the same user)")
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
    website_user, website_password = (runtime_user, runtime_password) if runtime_user else (db_user, db_password)
    runtime = {
        "MK8DX_HOSTED_MYSQL_HOST": db_host, "MK8DX_HOSTED_MYSQL_PORT": str(db_port),
        "MK8DX_HOSTED_MYSQL_USER": website_user, "MK8DX_HOSTED_MYSQL_PASSWORD": website_password,
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
               "database": {"host": db_host, "port": db_port, "name": db_name, "user": website_user,
                            **({"migrationUser": db_user} if runtime_user else {}),
                            **({"backupUser": accounts.BACKUP_USER} if route == "A3" else {})},
               "smtp": {"host": smtp_host, "port": smtp_port, "secure": route == "B2",
                        "username": smtp_user, "fromAddress": smtp_from}}
    write_json(state / PROFILE, profile)
    write_json(state / SECRET, {**{name: runtime[name] for name in SECRET_KEYS},
                                "MK8DX_HOSTED_MYSQL_PASSWORD": website_password,
                                **({accounts.MIGRATION_PASSWORD: db_password} if runtime_user else {}),
                                "MK8DX_HOSTED_SMTP_PASSWORD": smtp_password,
                                **({"MK8DX_NATIVE_DATABASE_ROOT_PASSWORD": secrets.token_urlsafe(36),
                                    accounts.BACKUP_PASSWORD: accounts.new_password()}
                                   if route == "A3" else {})})
    write_json(state / RUNTIME, {k: v for k, v in runtime.items()
                                 if k.startswith("MK8DX_HOSTED_") or k == "MK8DX_LOCAL_DEMO"})
    names = [PROFILE, SECRET, RUNTIME, PUBLIC]
    if runtime_user:
        write_json(state / accounts.MIGRATION_FILE, accounts.migration_settings(runtime, db_user, db_password))
        names.append(accounts.MIGRATION_FILE)
    write_json(state / PUBLIC, public_client(origin))
    for name in names: os.chmod(state / name, 0o600)
    print(t("Private installation: {0}", state))
    print(t("Website: {0}", origin))
    print(t("Database: {0} on {1}", db_name, f"{db_host}:{db_port}"))
    if route == "A3": print(t("Local test mailbox: {0}", "http://127.0.0.1:18227"))
    if not runtime_user: print(single_account_warning())


def wizard(state, route, auto_backup=True):
    runtime_user = runtime_password = None
    if route == "A3":
        origin = "http://127.0.0.1:18090"
        host, port = "127.0.0.1", 18306
        db_name, db_user, db_password = "mk8dx", accounts.MIGRATION_USER, accounts.new_password()
        print(t("MK8DX will create its own MariaDB 11.4 database inside the private installation folder."))
    else:
        print(t("Create an empty database in DirectAdmin (or cPanel) first, with two database users: one with all "
                "privileges on it (for updates and backups) and one with only SELECT, INSERT, UPDATE and DELETE "
                "(for the website). No existing database is erased."))
        origin = "https://" + input(t("Website host name, without https://: ")).strip()
        host = input(t("Database host from DirectAdmin: ")).strip()
        port = int(input(t("Database port [3306]: ")).strip() or "3306")
        db_name = input(t("Full database name (including provider prefix if shown): ")).strip()
        db_user = input(t("Database user with all privileges on this database (full name): ")).strip()
        db_password = getpass.getpass(t("Database user's password (hidden): "))
        runtime_user = input(t("Second database user for the website, with only SELECT, INSERT, UPDATE and DELETE "
                               "(full name; Enter uses the first user, not recommended): ")).strip() or None
        if runtime_user:
            runtime_password = getpass.getpass(t("Second database user's password (hidden): "))
    if route == "A3":
        smtp_host, smtp_port, smtp_user, smtp_password, smtp_from = "", 0, "", "", ""
    else:
        print(t("Sign-in mail: MK8DX sends it through your mail provider over TLS on port 465 (implicit TLS). "
                "A provider that only offers STARTTLS on port 587 does not work yet. The password is not shown while you type."))
        smtp_host = input(t("Mailbox SMTP server name: ")).strip()
        smtp_port = int(input(t("SMTP implicit-TLS port [465]: ")).strip() or "465")
        smtp_user = input(t("Mailbox SMTP login: ")).strip()
        smtp_password = getpass.getpass(t("Mailbox SMTP password (hidden): "))
        smtp_from = input(t("Authorized sender address: ")).strip()
    admin_email = ""
    while "@" not in admin_email or " " in admin_email or admin_email.startswith("@"):
        if admin_email:
            print(t("That does not look like one email address; try again."))
        admin_email = input(t("Your own future MK8DX administrator email: ")).strip()
    from tooling import scheduled_backup
    # A3: on by default (owner decision). B2: a clear choice, because many hosts back up the account already.
    nightly = auto_backup and (route != "B2" or scheduled_backup.ask_choice())
    create(state, route, origin, admin_email, host, port, db_name, db_user,
           db_password, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from,
           runtime_user=runtime_user, runtime_password=runtime_password)
    # `setup` (B2) or the first start (A3) switches the nightly backup on unless the answer was no.
    scheduled_backup.record_choice(state, nightly)


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
    if separate(profile):
        user, password = database_logins(profile, secret)["migration"]
        if user == db["user"] or not accounts.migration_file_matches(state, runtime, user, password):
            raise ValueError("Saved database accounts and migration settings disagree")
    elif (state / accounts.MIGRATION_FILE).exists():
        raise ValueError("Saved database accounts and migration settings disagree")
    return state, profile, runtime


def migration_environment(state, profile):
    """The settings file for database updates, reference data and restores: the migration login."""
    return state / (accounts.MIGRATION_FILE if separate(profile) else RUNTIME)


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


def node_command(state, script, *arguments, input_text=None, summarize_migrations=False, settings=None):
    command = ["node", str(ROOT / "api/dist" / script), "--private-environment-file",
               str(settings or state / RUNTIME), *map(str, arguments)]
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
    database = start_local_database(state, profile, runtime)
    # Starting the database may have given the website its own runtime-only account: read the settings again.
    state, profile, runtime = loaded(state)
    environment = {k: v for k, v in os.environ.items() if not k.startswith("MK8DX_")}
    environment.update(runtime)
    environment["MK8DX_LOCAL_DEMO"] = "true"
    environment["PORT"] = "18190"
    environment["MK8DX_HOSTED_API_HOST"] = "127.0.0.1"
    mail = None
    server = None
    try:
        mail = subprocess.Popen([str(tool), "--smtp", "127.0.0.1:18225", "--listen",
                                 "127.0.0.1:18227", "--database", str(state / "mailpit.db")], cwd=state)
        observed = observe_database(state)
        if observed["tableCount"] == 0:
            operate(state, "setup")
        else:
            operate(state, "check")
        server = subprocess.Popen(["node", str(ROOT / "api/dist/composition/passwordless-hosted-main.js")],
                                  cwd=ROOT / "api", env=environment)
        print(t("MK8DX is starting. Leave this window open. Open {0}", "http://127.0.0.1:18090"))
        print(t("Press Ctrl+C here to stop this MK8DX Node process and its local test mailbox."))
        while server.poll() is None and mail.poll() is None and database.poll() is None:
            try: server.wait(timeout=0.5)
            except subprocess.TimeoutExpired: pass
        if server.poll() is not None: raise RuntimeError("MK8DX Node process stopped; inspect the error above")
        if mail.poll() is not None: raise RuntimeError("Local mail capture stopped; inspect the error above")
        raise RuntimeError("Local MariaDB stopped; inspect the error above")
    except KeyboardInterrupt:
        print(t("Stopping this MK8DX installation"))
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
    try:
        provision_local_accounts(state, executable / "mariadb.exe")
    except BaseException:
        stop_local_database(state, database)
        raise
    return database


def _local_root_sql(client, sql, root_password, *hidden):
    environment = os.environ.copy()
    environment.pop("MYSQL_PWD", None)
    if root_password is not None:
        environment["MYSQL_PWD"] = root_password
    result = subprocess.run([str(client), "--host=127.0.0.1", "--port=18306", "--user=root"], input=sql, text=True,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=environment, check=False)
    if result.returncode != 0:
        raise RuntimeError("Local database accounts could not be set up: " +
                           accounts.redact(result.stderr, root_password or "", *hidden))


def provision_local_accounts(state, client):
    """A3's own MariaDB: the database, the migration account (all privileges on it), the website's runtime
    account (rows only) and the backup account (read and export only). An A3 installation from before the
    split keeps `mk8dx_app` as its migration account and gets the other two now."""
    marker = state / "db-provisioned.json"
    secret = json.loads((state / SECRET).read_text(encoding="utf-8"))
    profile = json.loads((state / PROFILE).read_text(encoding="utf-8"))
    root_password = accounts.plain(secret["MK8DX_NATIVE_DATABASE_ROOT_PASSWORD"], "password")
    name = profile["database"]["name"]
    logins = database_logins(profile, secret)
    if not marker.exists():
        sql = (f"CREATE DATABASE {accounts.plain(name, 'database')} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n" +
               accounts.account_sql(logins["migration"][0], "127.0.0.1", logins["migration"][1],
                                    "ALL PRIVILEGES", name))
        if separate(profile):
            sql += accounts.account_sql(logins["runtime"][0], "127.0.0.1", logins["runtime"][1],
                                        accounts.RUNTIME_PRIVILEGES, name)
        if profile["database"].get("backupUser"):
            sql += accounts.account_sql(logins["backup"][0], "127.0.0.1", logins["backup"][1],
                                        accounts.BACKUP_PRIVILEGES, name)
        sql += f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{root_password}';\nFLUSH PRIVILEGES;\n"
        _local_root_sql(client, sql, None, *(password for _, password in logins.values()))
        write_json(marker, {"schemaVersion": "mk8dx.native-database.v1", "database": "mk8dx",
                            "port": 18306, "engine": "MariaDB", "version": "11.4.13",
                            "accounts": "separate-v1" if separate(profile) else "single"})
        return
    if separate(profile):
        return
    runtime_password, backup_password = accounts.new_password(), accounts.new_password()
    _local_root_sql(client, accounts.account_sql(accounts.RUNTIME_USER, "127.0.0.1", runtime_password,
                                                 accounts.RUNTIME_PRIVILEGES, name) +
                    accounts.account_sql(accounts.BACKUP_USER, "127.0.0.1", backup_password,
                                         accounts.BACKUP_PRIVILEGES, name),
                    root_password, runtime_password, backup_password)
    switch_to_runtime_account(state, accounts.RUNTIME_USER, runtime_password,
                              backup=(accounts.BACKUP_USER, backup_password))
    print(t("The website now uses its own database account, which can only read and write data; database "
            "updates keep the existing account."))


def switch_to_runtime_account(state, user, password, backup=None):
    """Move the website to `user`; the login it used so far becomes the migration login (it keeps working,
    so access is never lost). Profile, secrets and settings change together or not at all."""
    profile = json.loads((state / PROFILE).read_text(encoding="utf-8"))
    secret = json.loads((state / SECRET).read_text(encoding="utf-8"))
    runtime = json.loads((state / RUNTIME).read_text(encoding="utf-8"))
    old_user, old_password = profile["database"]["user"], secret["MK8DX_HOSTED_MYSQL_PASSWORD"]
    if separate(profile) or runtime.get("MK8DX_HOSTED_MYSQL_USER") != old_user or user == old_user:
        raise ValueError("Saved database accounts disagree; nothing was changed")
    profile["database"].update({"user": user, "migrationUser": old_user,
                                **({"backupUser": backup[0]} if backup else {})})
    secret.update({"MK8DX_HOSTED_MYSQL_PASSWORD": password, accounts.MIGRATION_PASSWORD: old_password,
                   **({accounts.BACKUP_PASSWORD: backup[1]} if backup else {})})
    runtime.update({"MK8DX_HOSTED_MYSQL_USER": user, "MK8DX_HOSTED_MYSQL_PASSWORD": password})
    migration = state / accounts.MIGRATION_FILE
    migration.unlink(missing_ok=True)  # a leftover of an interrupted earlier attempt; loaded() refused it
    write_json(migration, accounts.migration_settings(runtime, old_user, old_password))
    os.chmod(migration, 0o600)
    try:
        replace_group([state / PROFILE, state / SECRET, state / RUNTIME],
                      [json.dumps(value, indent=2).encode() + b"\n" for value in (profile, secret, runtime)])
    except Exception:
        migration.unlink(missing_ok=True)
        raise


def use_single_account(state):
    """Undo of switch_to_runtime_account (B2): the website uses the migration login again."""
    profile = json.loads((state / PROFILE).read_text(encoding="utf-8"))
    secret = json.loads((state / SECRET).read_text(encoding="utf-8"))
    runtime = json.loads((state / RUNTIME).read_text(encoding="utf-8"))
    user, password = database_logins(profile, secret)["migration"]
    profile["database"]["user"] = user
    for name in ("migrationUser", "backupUser"):
        profile["database"].pop(name, None)
    secret["MK8DX_HOSTED_MYSQL_PASSWORD"] = password
    for name in (accounts.MIGRATION_PASSWORD, accounts.BACKUP_PASSWORD):
        secret.pop(name, None)
    runtime.update({"MK8DX_HOSTED_MYSQL_USER": user, "MK8DX_HOSTED_MYSQL_PASSWORD": password})
    replace_group([state / PROFILE, state / SECRET, state / RUNTIME],
                  [json.dumps(value, indent=2).encode() + b"\n" for value in (profile, secret, runtime)])
    (state / accounts.MIGRATION_FILE).unlink(missing_ok=True)


def check_runtime_account(state, settings=None):
    """What the website's database account may do (the API's own SHOW GRANTS check; nothing secret)."""
    return json.loads(subprocess.check_output(
        ["node", str(ROOT / "api/dist/composition/database-account-check-main.js"),
         "--private-environment-file", str(settings or state / RUNTIME)], cwd=ROOT / "api", text=True))


def report_accounts(state, profile):
    """B2: say clearly when the website's account could change or remove tables."""
    if profile["route"] != "B2":
        return
    if not separate(profile):
        print(single_account_warning())
        return
    try:
        report = check_runtime_account(state)
    except (OSError, ValueError, subprocess.CalledProcessError):
        print(t("The website's database account could not be checked; see the message above."))
        return
    if report.get("canChangeSchema"):
        print(t("Warning: the website's database account can still change the database structure ({0}). Give it "
                "only SELECT, INSERT, UPDATE and DELETE in your hosting panel.",
                ", ".join(report.get("extraPrivileges", []))))


def database_accounts(state, user=None, password=None, undo=False):
    """`install.py database-accounts`: give a B2 website its own limited database user (or undo that)."""
    state, profile, runtime = loaded(state)
    if profile["route"] != "B2":
        print(t("This installation creates and manages its own database accounts."))
        return
    if undo:
        if not separate(profile):
            print(t("The website already uses the single database account."))
            return
        use_single_account(state)
        print(t("The website uses the first database account again. Refresh the Passenger configuration "
                "(passenger-config) and restart the app in your hosting panel."))
        return
    if separate(profile):
        print(t("The website already has its own database account. To change it, run this with --undo first."))
        report_accounts(state, profile)
        return
    if user is None:
        print(t("Create a second database user in your hosting panel with only SELECT, INSERT, UPDATE and DELETE "
                "on database {0}.", profile["database"]["name"]))
        user = input(t("Second database user for the website (full name): ")).strip()
        password = getpass.getpass(t("Second database user's password (hidden): "))
    if not user or not password or user.lower() == "root" or user == profile["database"]["user"]:
        raise ValueError("The website's database user must be a second, limited user (not root, not the same user)")
    probe = state / "database-account-check.json"
    probe.unlink(missing_ok=True)
    write_json(probe, accounts.migration_settings(runtime, user, password))
    os.chmod(probe, 0o600)
    try:
        report = check_runtime_account(state, probe)
    except subprocess.CalledProcessError:
        raise ValueError("MK8DX could not sign in with that database user; check its name, password and database") from None
    finally:
        probe.unlink(missing_ok=True)
    if not report.get("dataAccess"):
        raise ValueError("That database user cannot read and write the MK8DX tables; give it SELECT, INSERT, "
                         "UPDATE and DELETE on this database")
    if report.get("canChangeSchema"):
        raise ValueError("That database user can still change the database structure (" +
                         ", ".join(report.get("extraPrivileges", [])) + "); give it only SELECT, INSERT, UPDATE and DELETE")
    switch_to_runtime_account(state, user, password)
    print(t("Saved. The previous database user stays for database updates and backups. Now refresh the Passenger "
            "configuration (passenger-config) and restart the app in your hosting panel. Undo: database-accounts --undo"))


def observe_database(state):
    """The engine, version and table count of the installation's database (the API's own check)."""
    return json.loads(subprocess.check_output(
        ["node", str(ROOT / "api/dist/composition/external-database-check-main.js"),
         "--private-environment-file", str(state / "operator.json")], cwd=ROOT / "api", text=True))


def dump_options(dump):
    """Options only MySQL's own mysqldump knows: without them a limited hosting user cannot export
    (GTID servers need FLUSH privileges, MySQL 9 adds masking policies from the mysql schema). MariaDB's
    mariadb-dump has neither option and needs neither."""
    try:
        listed = subprocess.run([dump, "--help"], capture_output=True, text=True, timeout=60, check=False).stdout
    except (OSError, subprocess.SubprocessError):
        listed = ""
    return [option for flag, option in (("--set-gtid-purged", "--set-gtid-purged=OFF"),
                                        ("--masking-policies", "--skip-masking-policies")) if flag in listed]


def _tail(stream):
    text = stream.read().decode("utf-8", "replace") if stream is not None else ""
    return " ".join(text.split())[-300:]


def backup(state, output):
    state, profile, runtime = loaded(state)
    output = safe_state_dir(output, existing=False)
    if output.exists(): raise ValueError("Choose a new backup folder")
    local_dump = state / "db-runtime/mariadb-11.4.13-winx64/bin/mariadb-dump.exe"
    dump = str(local_dump) if profile["route"] == "A3" and local_dump.is_file() else \
        (shutil.which("mariadb-dump") or shutil.which("mysqldump"))
    if not dump: raise ValueError("Install the MariaDB command-line client; mariadb-dump is required")
    output.mkdir(parents=True, mode=0o700)
    # The backup login (A3: read and export only; B2: the migration login), never the website's own account.
    user, password = database_logins(profile, json.loads((state / SECRET).read_text(encoding="utf-8")))["backup"]
    env = os.environ.copy()
    env["MYSQL_PWD"] = password
    command = [dump, "--host", runtime["MK8DX_HOSTED_MYSQL_HOST"], "--port", runtime["MK8DX_HOSTED_MYSQL_PORT"],
               "--user", user, "--single-transaction", "--routines",
               "--triggers", "--events", "--no-tablespaces", *dump_options(dump), runtime["MK8DX_HOSTED_MYSQL_DATABASE"]]
    try:
        with (output / "database.sql.gz").open("xb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
                assert process.stdout is not None
                shutil.copyfileobj(process.stdout, compressed, length=1024 * 1024)
                process.stdout.close()
                assert process.stderr is not None
                detail = _tail(process.stderr)
                process.stderr.close()
                process.wait()
                if process.returncode != 0:
                    raise RuntimeError(f"Database export failed with exit code {process.returncode}: {detail}")
        for name in (PROFILE, SECRET, "operator.json", PUBLIC):
            shutil.copyfile(state / name, output / name)
            os.chmod(output / name, 0o600)
        manifest = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in output.iterdir() if p.is_file()}
        observed = observe_database(state)
        write_json(output / "BACKUP_MANIFEST.json", {"schemaVersion": "mk8dx.native-backup.v1",
                                                     "files": manifest, "database": profile["database"]["name"],
                                                     "engine": observed["engine"], "version": observed["version"]})
        os.chmod(output / "BACKUP_MANIFEST.json", 0o600)
        print(t("Private backup complete: {0}", output))
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
    print(t("Backup verified"))


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
    # The restore runs with the one new login, which must own the new database; `database-accounts` gives the
    # website its own limited user again afterwards.
    for name in (accounts.MIGRATION_PASSWORD, accounts.BACKUP_PASSWORD):
        secret.pop(name, None)
    if not db_host or not db_name or not db_user or not db_password or not 1 <= db_port <= 65535:
        raise ValueError("Complete target database settings are required")
    state.mkdir(parents=True, mode=0o700)
    for name, value in ((PROFILE, profile), (SECRET, secret), ("operator.json", runtime),
                        (PUBLIC, public_client(new_origin))):
        write_json(state / name, value)
        os.chmod(state / name, 0o600)
    observed = observe_database(state)
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
        detail = _tail(process.stderr); process.stderr.close()
        process.wait()
        if process.returncode != 0: raise RuntimeError(f"Database restore failed with exit code {process.returncode}: {detail}")
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
    observed = observe_database(state)
    if observed["tableCount"] != 0 or observed["engine"] != receipt.get("engine") or \
            observed["version"].split(".")[:2] != receipt.get("version", "").split(".")[:2]:
        raise ValueError("Target database must be empty and on the same tested engine/version series")
    client = state / "db-runtime/mariadb-11.4.13-winx64/bin/mariadb.exe"
    if not client.is_file(): raise ValueError("The target's MariaDB client is missing")
    # The import creates tables: the target's migration login, never its runtime-only one.
    import_user, import_password = database_logins(target_profile, target_secret)["migration"]
    with gzip.open(backup_dir / "database.sql.gz", "rb") as sql:
        environment = os.environ.copy()
        environment["MYSQL_PWD"] = import_password
        process = subprocess.Popen(
            [str(client), "--host=127.0.0.1", "--port=18306", f"--user={import_user}", "--database=mk8dx"],
            stdin=subprocess.PIPE, stderr=subprocess.PIPE, env=environment)
        assert process.stdin is not None
        shutil.copyfileobj(sql, process.stdin, length=1024 * 1024)
        process.stdin.close()
        assert process.stderr is not None
        detail = _tail(process.stderr); process.stderr.close()
        process.wait()
        if process.returncode != 0: raise RuntimeError(f"Database restore failed with exit code {process.returncode}: {detail}")
    source_profile["database"] = target_profile["database"]
    source_secret["MK8DX_HOSTED_MYSQL_PASSWORD"] = target_secret["MK8DX_HOSTED_MYSQL_PASSWORD"]
    source_secret["MK8DX_NATIVE_DATABASE_ROOT_PASSWORD"] = target_secret["MK8DX_NATIVE_DATABASE_ROOT_PASSWORD"]
    for name in (accounts.MIGRATION_PASSWORD, accounts.BACKUP_PASSWORD):
        source_secret.pop(name, None)
        if name in target_secret:
            source_secret[name] = target_secret[name]
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


def operate(state, action, backup_output=None, email=None):
    package_paths()
    state, profile, runtime = loaded(state)
    if action in ("start", "serve", "maintenance", "setup", "upgrade", "check", "passenger-config"):
        runtime = sync_package_paths(state, runtime)
    if action == "status":
        displayed = {"route": profile["route"], "origin": profile["origin"],
                     "database": profile["database"]["name"], "stateDir": str(state),
                     "adminEmailConfigured": bool(profile["adminEmail"]),
                     # "separate": the website's own database account can only read and write rows.
                     "databaseAccounts": "separate" if separate(profile) else "single"}
        if profile["route"] == "A3":
            displayed["localMailInbox"] = "http://127.0.0.1:18227"
        from tooling import scheduled_backup
        displayed["automaticBackup"] = scheduled_backup.summary(state)
        print(json.dumps(displayed, indent=2))
    elif action == "check-database":
        node_command(state, "composition/external-database-check-main.js")
    elif action in ("setup", "upgrade"):
        if action == "upgrade":
            if backup_output is None: raise ValueError("Upgrade requires --backup-output in a new private folder")
            backup(state, backup_output)
            verify_backup(backup_output)
        # Database updates and reference data run with the migration login (migration.json).
        settings = migration_environment(state, profile)
        node_command(state, "composition/external-database-check-main.js", settings=settings)
        node_command(state, "composition/migration-apply-main.js", "--migration-catalog",
                     ROOT / "mysql/migration-catalog-v1.json", "--confirm-database",
                     profile["database"]["name"], "--fresh-empty-database" if action == "setup" else "--backup-verified",
                     summarize_migrations=True, settings=settings)
        node_command(state, "composition/reference-seed-main.js", "--staff-seed",
                     ROOT / "mysql/reference/nintendo-staff-v1.json", "--world-record-seed",
                     ROOT / "mysql/reference/world-records-v1.json", settings=settings)
        report_accounts(state, profile)
        from tooling import scheduled_backup
        if action == "setup":
            scheduled_backup.after_setup(state)
        else:
            scheduled_backup.after_upgrade(state)
    elif action == "check":
        node_command(state, "composition/hosted-preflight-main.js", "--migration-catalog",
                     ROOT / "mysql/migration-catalog-v1.json")
        report_accounts(state, profile)
    elif action == "admin":
        node_command(state, "administration/installer-administrator-main.js", "--email-stdin",
                     input_text=profile["adminEmail"] + "\n")
    elif action == "step-up-link":
        # Break-glass when e-mail fails; runs on this server only (see install.step_up_address).
        from install import step_up_address
        node_command(state, "security/step-up-operator-main.js", "--email-stdin",
                     input_text=step_up_address(profile, email) + "\n")
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
