"""Restore drill on real disposable databases: make data, run the automatic backup, wipe, restore, compare.

Skipped unless MK8DX_BACKUP_DRILL=1 (it needs Docker and throwaway database containers). Nothing here
reads or prints a root password: administrative SQL runs inside the container with the password the
container already has in its own environment.

  MK8DX_BACKUP_DRILL=1
  MK8DX_DRILL_MARIADB_CONTAINER=<throwaway mariadb:11.4 container>     B2 route on MariaDB
  MK8DX_DRILL_MYSQL_CONTAINER=<throwaway mysql container>               B2 route on MySQL
  MK8DX_DRILL_MYSQL_SCHEMA=<the one schema you may use there>           (default mk8dx_backup_drill)
  MK8DX_DRILL_A1=1                                                      A1: a real Compose project (MySQL
                                                                        image of compose.yaml), the real
                                                                        install.py/lifecycle.py commands

The B2 drill runs the real dump and client programs of the engine (inside its container, through a small
`mariadb-dump`/`mariadb` stand-in on PATH) and the real native backup, verification, retention and
restore code. Only the API's engine probe (node) is replaced by the same query against the container.
"""
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling"))

from tooling import database_accounts as accounts  # noqa: E402
from tooling import scheduled_backup as sb  # noqa: E402

DRILL = os.environ.get("MK8DX_BACKUP_DRILL") == "1"

SHIM = r'''
import os, subprocess, sys
container, tool = sys.argv[1], sys.argv[2]
rest, skip = [], False
for arg in sys.argv[3:]:
    if skip:
        skip = False
        continue
    if arg in ("--host", "--port"):
        skip = True
        continue
    if arg.startswith(("--host=", "--port=")):
        continue
    rest.append(arg)
sys.exit(subprocess.run(["docker", "exec", "-i", "-e", "MYSQL_PWD", container, tool, "--host", "127.0.0.1",
                         "--port", "3306", *rest]).returncode)
'''

DATA = """
CREATE TABLE player (id INT PRIMARY KEY, display_name VARCHAR(80) CHARACTER SET utf8mb4 NOT NULL,
  created_at DATETIME(3) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE time_trial (id INT PRIMARY KEY AUTO_INCREMENT, player_id INT NOT NULL, track VARCHAR(40) NOT NULL,
  millis INT NOT NULL, note TEXT, FOREIGN KEY (player_id) REFERENCES player(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE audit_log (id INT PRIMARY KEY AUTO_INCREMENT, time_trial_id INT NOT NULL) ENGINE=InnoDB;
CREATE VIEW best_time AS SELECT player_id, track, MIN(millis) AS millis FROM time_trial GROUP BY player_id, track;
"""
# MK8DX's own schema has no triggers; this one checks that a dump keeps them. A limited user may create one
# on MariaDB, while MySQL with binary logging (the default) refuses it without SUPER, so only there.
TRIGGER = ("CREATE TRIGGER time_trial_audit AFTER INSERT ON time_trial FOR EACH ROW "
           "INSERT INTO audit_log (time_trial_id) VALUES (NEW.id);\n")


def rows_sql(trigger: bool = True) -> str:
    names = ["Mario", "Luïgi", "ピーチ", "Daisy \U0001F338", "Конг", "O'Toad"]
    statements = []
    for player in range(1, 121):
        name = (names[player % len(names)] + f" {player}").replace("'", "''")
        statements.append(f"INSERT INTO player VALUES ({player}, '{name}', '2026-11-{1 + player % 28:02d} "
                          f"0{player % 10}:00:00.{player:03d}');")
    for index in range(1500):
        statements.append(f"INSERT INTO time_trial (player_id, track, millis, note) VALUES ({1 + index % 120}, "
                          f"'track-{index % 48}', {90000 + (index * 7919) % 30000}, "
                          f"{'NULL' if index % 5 else repr('regel ' + str(index))});")
        if not trigger:
            statements.append(f"INSERT INTO audit_log (time_trial_id) VALUES ({index + 1});")
    return "\n".join(statements) + "\n"


def container_sql(container: str, statement: str, *, database: str = "", mariadb: bool, as_user=None) -> str:
    """SQL inside the container: as root with the password from the container's own environment, or as the
    limited application user (who owns the data, the trigger and the view, as on a hosting account)."""
    client, variable = ("mariadb", "MARIADB_ROOT_PASSWORD") if mariadb else ("mysql", "MYSQL_ROOT_PASSWORD")
    environment = dict(os.environ)
    if as_user is None:
        login = f'MYSQL_PWD="${variable}" exec {client} -uroot'
    else:
        environment["MK8DX_DRILL_USER_PASSWORD"] = as_user[1]
        login = f'MYSQL_PWD="$MK8DX_DRILL_USER_PASSWORD" exec {client} -h 127.0.0.1 -u{as_user[0]}'
    result = subprocess.run(["docker", "exec", "-i", "-e", "MK8DX_DRILL_USER_PASSWORD", container, "sh", "-c",
                             f'{login} -N -B --default-character-set=utf8mb4 {database}'],
                            input=statement.encode("utf-8"), capture_output=True, check=False, env=environment)
    if result.returncode != 0:
        raise AssertionError(result.stderr.decode("utf-8", "replace")[:500])
    return result.stdout.decode("utf-8")


def fingerprint(container: str, database: str, *, mariadb: bool) -> dict:
    """Row counts and a SHA-256 over every row in key order, per table, plus the trigger and view."""
    found = {}
    for table in ("player", "time_trial", "audit_log", "best_time"):
        order = "player_id, track" if table == "best_time" else "id"
        content = container_sql(container, f"SELECT * FROM {table} ORDER BY {order};", database=database,
                                mariadb=mariadb)
        found[table] = (content.count("\n"), hashlib.sha256(content.encode("utf-8")).hexdigest())
    found["triggers"] = container_sql(container, "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE "
                                      f"TRIGGER_SCHEMA = '{database}';", mariadb=mariadb).split()
    return found


@unittest.skipUnless(DRILL, "set MK8DX_BACKUP_DRILL=1 with throwaway database containers")
class NativeRouteDrill(unittest.TestCase):
    """B2 (and A3's code path) on a real MariaDB and a real MySQL."""

    def drill(self, container: str, database: str, *, mariadb: bool):
        tools = ("mariadb-dump", "mariadb") if mariadb else ("mysqldump", "mysql")
        with tempfile.TemporaryDirectory(prefix="mk8dx-drill-") as temporary:
            base = Path(temporary)
            shims = base / "shims"
            shims.mkdir()
            (shims / "shim.py").write_text(SHIM, encoding="utf-8")
            for name, tool in zip(("mariadb-dump", "mariadb"), tools):
                if os.name == "nt":
                    (shims / f"{name}.cmd").write_text(
                        f'@"{sys.executable}" "%~dp0shim.py" {container} {tool} %*\r\n', encoding="ascii")
                else:
                    target = shims / name
                    target.write_text(f'#!/bin/sh\nexec "{sys.executable}" "$(dirname "$0")/shim.py" {container} '
                                      f'{tool} "$@"\n', encoding="ascii")
                    target.chmod(0o755)
            # Three accounts, as A3 creates them and a hosting panel can: the owner (all privileges: migrations,
            # restore), the website's runtime account (rows only) and a backup account (read and export only).
            user, password = "s8_drill", secrets.token_urlsafe(18)
            site, site_password = "h2_drill_site", secrets.token_urlsafe(18)
            dumper, dumper_password = "h2_drill_backup", secrets.token_urlsafe(18)
            container_sql(container, f"DROP DATABASE IF EXISTS {database}; CREATE DATABASE {database} CHARACTER SET "
                          f"utf8mb4 COLLATE utf8mb4_unicode_ci; DROP USER IF EXISTS '{user}'@'%'; CREATE USER "
                          f"'{user}'@'%' IDENTIFIED BY '{password}'; GRANT ALL PRIVILEGES ON {database}.* TO "
                          f"'{user}'@'%';" +
                          accounts.account_sql(site, "%", site_password, accounts.RUNTIME_PRIVILEGES, database) +
                          accounts.account_sql(dumper, "%", dumper_password, accounts.BACKUP_PRIVILEGES, database),
                          mariadb=mariadb)
            try:
                container_sql(container, DATA + (TRIGGER if mariadb else "") + rows_sql(mariadb), database=database,
                              mariadb=mariadb,
                              as_user=(user, password))
                before = fingerprint(container, database, mariadb=mariadb)
                self.assertEqual(before["player"][0], 120)
                self.assertEqual(before["time_trial"][0], 1500)
                self.assertEqual(before["audit_log"][0], 1500)
                self.assertEqual(before["triggers"], ["time_trial_audit"] if mariadb else [])

                # The website's account can change rows but no table, user or grant.
                container_sql(container, "UPDATE player SET display_name = display_name WHERE id = 1;",
                              database=database, mariadb=mariadb, as_user=(site, site_password))
                for statement in ("DROP TABLE time_trial;", "ALTER TABLE player ADD COLUMN x INT;",
                                  "TRUNCATE TABLE audit_log;", f"GRANT ALL PRIVILEGES ON {database}.* TO CURRENT_USER();",
                                  f"DROP DATABASE {database};"):
                    with self.assertRaisesRegex(AssertionError, "denied", msg=statement):
                        container_sql(container, statement, database=database, mariadb=mariadb,
                                      as_user=(site, site_password))
                self.assertEqual(fingerprint(container, database, mariadb=mariadb), before)

                state = base / "private"
                self.write_b2_state(state, database, user, password, site=(site, site_password),
                                    backup=(dumper, dumper_password))
                backups = base / "mk8dx-backups"
                settings = {**sb.default_settings("B2"), "backupRoot": str(backups)}
                sb.save_settings(state, settings)

                def observe(target_state):
                    version = container_sql(container, "SELECT VERSION();", mariadb=mariadb).strip()
                    target = json.loads((Path(target_state) / "operator.json").read_text(encoding="utf-8"))
                    tables = container_sql(container, "SELECT COUNT(*) FROM information_schema.TABLES WHERE "
                                           f"TABLE_SCHEMA = '{target['MK8DX_HOSTED_MYSQL_DATABASE']}';",
                                           mariadb=mariadb).strip()
                    return {"engine": "MariaDB" if "MariaDB" in version else "MySQL", "version": version,
                            "tableCount": int(tables)}

                import native_install
                path = str(shims) + os.pathsep + os.environ.get("PATH", "")
                now = datetime(2026, 11, 15, 3, 15, tzinfo=timezone.utc)
                with patch.dict(os.environ, {"PATH": path}), \
                        patch.object(native_install, "observe_database", side_effect=observe), \
                        patch.object(native_install, "package_paths", return_value=ROOT), \
                        patch.object(native_install, "operate") as check, \
                        patch.object(sb, "owner_only"):
                    code, status = sb.run(state, quiet=True, now=now)
                    self.assertEqual(code, sb.EXIT_OK, status)
                    first = Path(status["latestBackup"])
                    # A database that is down: a clear failure, the older backup stays.
                    subprocess.run(["docker", "pause", container], check=True, capture_output=True)
                    try:
                        with patch.object(native_install, "observe_database",
                                          side_effect=RuntimeError("database unreachable")):
                            code, failed = sb.run(state, quiet=True, now=now + timedelta(days=1))
                    finally:
                        subprocess.run(["docker", "unpause", container], check=True, capture_output=True)
                    self.assertEqual(code, sb.EXIT_FAILED, failed)
                    self.assertEqual([p for p, _ in sb.listed(backups, "mk8dx-native-drill00000")], [first])
                    self.assertEqual(sb.latest(state), first)

                    # Wipe: an attacker drops everything; recreate the schema empty.
                    container_sql(container, f"DROP DATABASE {database}; CREATE DATABASE {database} CHARACTER SET "
                                  "utf8mb4 COLLATE utf8mb4_unicode_ci;", mariadb=mariadb)
                    self.assertEqual(observe(state)["tableCount"], 0)
                    restored = base / "private-restored"
                    with patch("builtins.print"):
                        native_install.restore_new(first, restored, "127.0.0.1", 3306, database, user, password,
                                                   "https://drill.example.test")
                    check.assert_called_once()
                after = fingerprint(container, database, mariadb=mariadb)
                self.assertEqual(after, before)
                # The restored installation keeps the old keys (accounts and encrypted results stay readable).
                old_secret = json.loads((state / "secrets.json").read_text(encoding="utf-8"))
                new_secret = json.loads((restored / "secrets.json").read_text(encoding="utf-8"))
                self.assertEqual(old_secret["MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_BASE64"],
                                 new_secret["MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_BASE64"])
            finally:
                container_sql(container, f"DROP DATABASE IF EXISTS {database}; DROP USER IF EXISTS '{user}'@'%'; "
                              f"DROP USER IF EXISTS '{site}'@'%'; DROP USER IF EXISTS '{dumper}'@'%';",
                              mariadb=mariadb)

    @staticmethod
    def write_b2_state(state: Path, database: str, user: str, password: str, *, site, backup) -> None:
        from install import SECRET_KEYS, public_client
        origin = "https://drill.example.test"
        state.mkdir(mode=0o700)
        keys = {name: secrets.token_urlsafe(32) for name in SECRET_KEYS if name != "MK8DX_HOSTED_MYSQL_PASSWORD"}
        runtime = {"MK8DX_HOSTED_MYSQL_HOST": "127.0.0.1", "MK8DX_HOSTED_MYSQL_PORT": "3306",
                   "MK8DX_HOSTED_MYSQL_USER": site[0], "MK8DX_HOSTED_MYSQL_PASSWORD": site[1],
                   "MK8DX_HOSTED_MYSQL_DATABASE": database, "MK8DX_HOSTED_AUTH_BASE_URL": origin,
                   "MK8DX_HOSTED_SMTP_PASSWORD": "synthetic", **keys}
        files = {"operator-profile.json": {"schemaVersion": "mk8dx.operator.v1", "route": "B2", "origin": origin,
                                           "project": "mk8dx-native-drill00000", "adminEmail": "a@example.test",
                                           "database": {"host": "127.0.0.1", "port": 3306, "name": database,
                                                        "user": site[0], "migrationUser": user,
                                                        "backupUser": backup[0]},
                                           "smtp": {"host": "mail.example.test", "port": 465, "secure": True,
                                                    "username": "u", "fromAddress": "a@example.test"}},
                 "secrets.json": {**keys, "MK8DX_HOSTED_MYSQL_PASSWORD": site[1],
                                  accounts.MIGRATION_PASSWORD: password, accounts.BACKUP_PASSWORD: backup[1],
                                  "MK8DX_HOSTED_SMTP_PASSWORD": "synthetic"},
                 "operator.json": runtime, "public-client.json": public_client(origin),
                 accounts.MIGRATION_FILE: accounts.migration_settings(runtime, user, password)}
        for name, value in files.items():
            (state / name).write_text(json.dumps(value, indent=2), encoding="utf-8")
            os.chmod(state / name, 0o600)

    @unittest.skipUnless(os.environ.get("MK8DX_DRILL_MARIADB_CONTAINER"), "no MariaDB drill container")
    def test_b2_on_mariadb(self):
        self.drill(os.environ["MK8DX_DRILL_MARIADB_CONTAINER"], "mk8dx_backup_drill", mariadb=True)

    @unittest.skipUnless(os.environ.get("MK8DX_DRILL_MYSQL_CONTAINER"), "no MySQL drill container")
    def test_b2_on_mysql(self):
        self.drill(os.environ["MK8DX_DRILL_MYSQL_CONTAINER"],
                   os.environ.get("MK8DX_DRILL_MYSQL_SCHEMA", "mk8dx_backup_drill"), mariadb=False)


@unittest.skipUnless(DRILL and os.environ.get("MK8DX_DRILL_A1") == "1", "set MK8DX_DRILL_A1=1 for the Compose drill")
class DockerRouteDrill(unittest.TestCase):
    """A1 end to end with the real commands: init, its own MySQL, backup-run, wipe, lifecycle restore-new."""

    def cli(self, *arguments, check=True):
        result = subprocess.run([sys.executable, *arguments], cwd=ROOT, capture_output=True, text=True,
                                encoding="utf-8", check=False)
        if check and result.returncode != 0:
            raise AssertionError((arguments[:2], result.stdout[-800:], result.stderr[-800:]))
        return result

    def test_a1_backup_run_then_restore_new(self):
        import lifecycle
        with tempfile.TemporaryDirectory(prefix="mk8dx-a1-drill-") as temporary:
            base = Path(temporary)
            state, restored, backups = base / "state", base / "restored", base / "backups"
            projects = []
            try:
                self.cli("tooling/install.py", "init", "--mode", "local", "--state-dir", str(state),
                         "--admin-email", "drill@example.test")
                settings = sb.load_settings(state)
                self.assertTrue(settings["enabled"])  # on by default for A1
                sb.save_settings(state, {**settings, "backupRoot": str(backups)})
                compose = lifecycle.compose(state)
                projects.append(compose)
                subprocess.run(compose + ["up", "-d", "--wait", "mysql"], cwd=ROOT, check=True, capture_output=True)
                sql = lambda statement, c=compose: subprocess.run(
                    c + ["exec", "-T", "mysql", "sh", "-c", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot '
                         "-N -B --default-character-set=utf8mb4 mk8dx"], cwd=ROOT, input=statement.encode("utf-8"),
                    capture_output=True, check=True).stdout.decode("utf-8")
                sql(DATA + TRIGGER + rows_sql())

                def snapshot(c):
                    return {table: hashlib.sha256(sql(f"SELECT * FROM {table} ORDER BY "
                                                      f"{'player_id, track' if table == 'best_time' else 'id'};",
                                                      c).encode("utf-8")).hexdigest() + ":" +
                            sql(f"SELECT COUNT(*) FROM {table};", c).strip()
                            for table in ("player", "time_trial", "audit_log", "best_time")}
                before = snapshot(compose)
                self.assertTrue(before["time_trial"].endswith(":1500"))

                self.cli("tooling/install.py", "backup-run", "--state-dir", str(state))
                status = json.loads(self.cli("tooling/install.py", "backup-status", "--state-dir", str(state)).stdout)
                self.assertEqual(status["lastResult"], "ok")
                latest = self.cli("tooling/install.py", "backup-latest", "--state-dir", str(state),
                                  "--print-path").stdout.strip()
                self.assertEqual(latest, status["latestBackup"])

                sql("DROP TABLE audit_log; DROP VIEW best_time; DROP TABLE time_trial; DROP TABLE player;")
                self.assertEqual(sql("SHOW TABLES;").strip(), "")
                self.cli("tooling/lifecycle.py", "restore-new", "--backup", latest, "--state-dir", str(restored))
                projects.append(lifecycle.compose(restored))
                self.assertEqual(snapshot(projects[-1]), before)
            finally:
                for command in projects:
                    subprocess.run(command + ["down", "-v"], cwd=ROOT, capture_output=True, check=False)


if __name__ == "__main__":
    unittest.main()
