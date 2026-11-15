"""Separate database accounts for the running website, for database updates and for backups.

Every route gives the API a *runtime* account that may only read and write rows (SELECT, INSERT, UPDATE,
DELETE on the MK8DX database). Even SQL that reached the database through some future bug can then not
drop, alter, truncate or re-grant anything. Database updates (migrations) and the reference data run with
the separate *migration* account, which owns the schema. Backups use the migration account, or on A3 a
*backup* account that can only read and export.

* Docker routes (A1, A2, A2 offline, B1): the MySQL image creates `mk8dx_app` (now the migration account);
  install.py creates `mk8dx_runtime` with the database's root login inside the database container. The API
  container gets only the runtime login (api.env, operator.json); migrations run in the `migrate` service,
  which alone mounts migration.json.
* A3: native_install.py creates all three accounts on its own MariaDB.
* B2: the hosting panel creates the accounts; native_install.py stores both logins and warns when only one
  account was given.

Logins are stored like the other installation secrets (secrets.json, owner-only files) and never printed.
"""
from __future__ import annotations

import json
import os
import secrets
import subprocess
from pathlib import Path

RUNTIME_USER = "mk8dx_runtime"
MIGRATION_USER = "mk8dx_app"  # the account every earlier installation already had: it keeps working
BACKUP_USER = "mk8dx_backup"
MIGRATION_FILE = "migration.json"
MIGRATION_PASSWORD = "MK8DX_MIGRATION_MYSQL_PASSWORD"
BACKUP_PASSWORD = "MK8DX_NATIVE_BACKUP_MYSQL_PASSWORD"
RUNTIME_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE"
# What mysqldump/mariadb-dump need with --single-transaction --routines --triggers --events --no-tablespaces.
BACKUP_PRIVILEGES = "SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT"
MYSQL_KEYS = ("MK8DX_HOSTED_MYSQL_HOST", "MK8DX_HOSTED_MYSQL_PORT", "MK8DX_HOSTED_MYSQL_USER",
              "MK8DX_HOSTED_MYSQL_PASSWORD", "MK8DX_HOSTED_MYSQL_DATABASE")
_SAFE = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")


def new_password() -> str:
    return secrets.token_urlsafe(36)


def plain(value: str, what: str) -> str:
    if not value or not set(value) <= _SAFE or len(value) > 128:
        raise ValueError(f"Generated database {what} has unexpected characters")
    return value


def account_sql(user: str, host: str, password: str, privileges: str, database: str) -> str:
    """Create or repair one account with exactly `privileges` on `database` (idempotent; MySQL and MariaDB).
    Only generated names and passwords reach this function, so they never need quoting."""
    if host not in ("%", "127.0.0.1", "localhost"):
        raise ValueError("Unexpected database account host")
    user, password, database = plain(user, "user"), plain(password, "password"), plain(database, "database")
    account = f"'{user}'@'{host}'"
    return (f"CREATE USER IF NOT EXISTS {account} IDENTIFIED BY '{password}';\n"
            f"ALTER USER {account} IDENTIFIED BY '{password}';\n"
            f"REVOKE ALL PRIVILEGES, GRANT OPTION FROM {account};\n"
            f"GRANT {privileges} ON `{database}`.* TO {account};\n")


def migration_settings(runtime: dict, user: str, password: str) -> dict:
    """migration.json: only the database connection, with the migration login."""
    settings = {name: runtime[name] for name in MYSQL_KEYS}
    settings.update({"MK8DX_HOSTED_MYSQL_USER": user, "MK8DX_HOSTED_MYSQL_PASSWORD": password})
    return settings


def migration_file_matches(state: Path, runtime: dict, user: str, password: str) -> bool:
    path = state / MIGRATION_FILE
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return saved == migration_settings(runtime, user, password)


def redact(text: str, *values: str) -> str:
    for value in values:
        if value:
            text = text.replace(value, "***")
    return " ".join(text.split())[-300:]


def docker_root_sql(command: list[str], root: Path, sql: str, *hidden: str) -> None:
    """Run administrative SQL inside this installation's MySQL container with the root login the container
    already holds; the SQL (with generated passwords) goes over stdin, never on a command line."""
    environment = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "MK8DX_"))}
    result = subprocess.run(command + ["exec", "-T", "mysql", "sh", "-c",
                                       'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h 127.0.0.1 -u root'],
                            cwd=root, input=sql.encode("utf-8"), stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, env=environment, check=False)
    if result.returncode != 0:
        raise RuntimeError("Database account setup failed: " +
                           redact(result.stderr.decode("utf-8", "replace"), *hidden))


def docker_runtime_sql(runtime_password: str) -> str:
    return account_sql(RUNTIME_USER, "%", runtime_password, RUNTIME_PRIVILEGES, "mk8dx")


def set_dotenv_value(text: str, name: str, value: str) -> str:
    """Replace exactly one NAME='value' line of a generated .env file, keeping every other line."""
    lines = text.splitlines(keepends=True)
    matching = [index for index, line in enumerate(lines) if line.startswith(name + "=")]
    if len(matching) != 1 or "'" in value or "\n" in value:
        raise ValueError("Generated environment file has an unexpected database setting")
    lines[matching[0]] = f"{name}='{value}'\n"
    return "".join(lines)
