"""Separate database accounts on every route: the website's runtime login reads and writes rows only.

Docker is replaced by fakes here (the SQL an installer sends to the database container is recorded, not run);
the real-database proof is backend/api/test/database-runtime-account.integration.test.ts with every suite of
tooling/run_database_integration_ci.sh running as a restricted runtime account, and the backup drill in
test_backup_restore_drill.py.
"""
import contextlib
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling import database_accounts as accounts
from tooling import install

sys.path.insert(0, str(Path(install.__file__).resolve().parent))
import lifecycle  # noqa: E402
import native_install  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def quiet(call, *args, **kwargs):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        result = call(*args, **kwargs)
    return result, output.getvalue()


def docker_state(folder: Path, mode="local") -> Path:
    state = folder / "state"
    subprocess.run([sys.executable, str(ROOT / "tooling/install.py"), "init", "--state-dir", str(state),
                    "--mode", mode, "--no-auto-backup"], check=True, capture_output=True)
    return state


def make_legacy(state: Path) -> None:
    """The layout every Docker installation had before this release: the API used the image's mk8dx_app."""
    compose = install.read_dotenv(state / "compose.env")
    shared = compose["MK8DX_DATABASE_PASSWORD"]
    api = (state / "api.env").read_text(encoding="utf-8")
    api = accounts.set_dotenv_value(api, "MK8DX_HOSTED_MYSQL_USER", "mk8dx_app")
    api = accounts.set_dotenv_value(api, "MK8DX_HOSTED_MYSQL_PASSWORD", shared)
    (state / "api.env").write_text(api, encoding="utf-8", newline="\n")
    for name, change in (("operator.json", lambda v: v.update({"MK8DX_HOSTED_MYSQL_USER": "mk8dx_app",
                                                                 "MK8DX_HOSTED_MYSQL_PASSWORD": shared})),
                         (install.SECRET, lambda v: (v.update({"MK8DX_HOSTED_MYSQL_PASSWORD": shared}),
                                                     v.pop(accounts.MIGRATION_PASSWORD))),
                         (install.PROFILE, lambda v: v.pop("databaseAccounts"))):
        value = json.loads((state / name).read_text(encoding="utf-8"))
        change(value)
        (state / name).write_text(json.dumps(value, indent=2), encoding="utf-8")
    (state / accounts.MIGRATION_FILE).unlink()


class AccountSqlTest(unittest.TestCase):
    def test_runtime_account_gets_exactly_row_access(self):
        sql = accounts.docker_runtime_sql("generated_Password-1")
        self.assertIn("CREATE USER IF NOT EXISTS 'mk8dx_runtime'@'%'", sql)
        self.assertIn("REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'mk8dx_runtime'@'%';", sql)
        self.assertIn("GRANT SELECT, INSERT, UPDATE, DELETE ON `mk8dx`.* TO 'mk8dx_runtime'@'%';", sql)
        for word in ("DROP", "ALTER", "CREATE,", "ALL PRIVILEGES ON", "WITH GRANT OPTION"):
            self.assertNotIn(word, sql.split("REVOKE")[1].split(";", 1)[1])

    def test_only_generated_values_are_accepted(self):
        for user, host, password in (("a'b", "%", "x"), ("u", "evil.example", "x"), ("u", "%", "p' OR '1"),
                                     ("u", "%", "")):
            with self.subTest(user=user, host=host), self.assertRaises(ValueError):
                accounts.account_sql(user, host, password, accounts.RUNTIME_PRIVILEGES, "mk8dx")

    def test_errors_never_show_a_password(self):
        self.assertEqual(accounts.redact("ERROR 1396 at line 1 IDENTIFIED BY 'sekrit-1'", "sekrit-1"),
                         "ERROR 1396 at line 1 IDENTIFIED BY '***'")


class DockerRoutesTest(unittest.TestCase):
    def test_new_installation_gives_the_api_only_the_runtime_login(self):
        for mode in ("local", "production"):
            with self.subTest(mode), tempfile.TemporaryDirectory(prefix="mk8dx accounts ") as temporary:
                extra = [] if mode == "local" else ["--domain", "example.invalid", "--smtp-host", "mail.example.invalid",
                                                    "--smtp-user", "u@example.invalid", "--smtp-from", "n@example.invalid",
                                                    "--smtp-password-file", str(Path(temporary) / "p.txt"),
                                                    "--admin-email", "o@example.invalid"]
                (Path(temporary) / "p.txt").write_text("synthetic", encoding="utf-8")
                state = Path(temporary) / "state"
                subprocess.run([sys.executable, str(ROOT / "tooling/install.py"), "init", "--state-dir", str(state),
                                "--mode", mode, "--no-auto-backup", *extra], check=True, capture_output=True)
                api = install.read_dotenv(state / "api.env")
                compose = install.read_dotenv(state / "compose.env")
                migration = json.loads((state / accounts.MIGRATION_FILE).read_text(encoding="utf-8"))
                secret = json.loads((state / install.SECRET).read_text(encoding="utf-8"))
                self.assertEqual(api["MK8DX_HOSTED_MYSQL_USER"], "mk8dx_runtime")
                self.assertEqual(compose["MK8DX_DATABASE_USER"], "mk8dx_app")
                self.assertEqual(migration["MK8DX_HOSTED_MYSQL_USER"], "mk8dx_app")
                self.assertEqual(migration["MK8DX_HOSTED_MYSQL_PASSWORD"], compose["MK8DX_DATABASE_PASSWORD"])
                self.assertEqual(secret[accounts.MIGRATION_PASSWORD], compose["MK8DX_DATABASE_PASSWORD"])
                self.assertEqual(sorted(migration), sorted(accounts.MYSQL_KEYS))
                # The migration login is in no file the API container receives.
                for name in ("api.env", "operator.json"):
                    self.assertNotIn(compose["MK8DX_DATABASE_PASSWORD"], (state / name).read_text(encoding="utf-8"))
                shown = json.loads(quiet(install.status, state)[1])
                self.assertEqual(shown["databaseAccounts"], "separate")
                self.assertNotIn(compose["MK8DX_DATABASE_PASSWORD"], json.dumps(shown))

    def test_compose_mounts_the_migration_login_only_into_the_migrate_service(self):
        text = (ROOT / "compose.yaml").read_text(encoding="utf-8")
        services = text.split("\nservices:\n", 1)[1].split("\nvolumes:\n", 1)[0]
        names = list(re.finditer(r"^  ([a-z-]+):$", services, re.M))
        blocks = {match.group(1): services[match.end():(names[index + 1].start() if index + 1 < len(names) else None)]
                  for index, match in enumerate(names)}
        self.assertIn("migration.json:/run/mk8dx/operator.json:ro", blocks["migrate"])
        self.assertIn('profiles: ["maintenance"]', blocks["migrate"])
        for service in ("api", "web", "mysql"):
            self.assertNotIn("migration.json:", blocks[service], service)
        self.assertIn("image: &api-image ${MK8DX_API_IMAGE:-mk8dx/api:local-v010-node26-amd64}", blocks["api"])
        self.assertIn("image: *api-image", blocks["migrate"])
        self.assertNotIn("migration.json", (ROOT / "compose.offline-lan.yaml").read_text(encoding="utf-8"))

    def test_update_separates_an_existing_installation_and_keeps_the_old_login(self):
        with tempfile.TemporaryDirectory(prefix="mk8dx legacy ") as temporary:
            state = docker_state(Path(temporary))
            make_legacy(state)
            self.assertEqual(json.loads(quiet(install.status, state)[1])["databaseAccounts"],
                             "single (the next update separates them)")
            before = {name: (state / name).read_bytes() for name in install.ACCOUNT_FILES}
            old_password = install.read_dotenv(state / "compose.env")["MK8DX_DATABASE_PASSWORD"]
            compose_before = (state / "compose.env").read_bytes()
            sent = []
            with mock.patch.object(accounts, "docker_root_sql", side_effect=lambda c, r, sql, *h: sent.append((sql, h))):
                previous, printed = quiet(install.separate_database_accounts, state)
            self.assertEqual(previous, [before[name] for name in install.ACCOUNT_FILES])
            api = install.read_dotenv(state / "api.env")
            self.assertEqual(api["MK8DX_HOSTED_MYSQL_USER"], "mk8dx_runtime")
            self.assertNotEqual(api["MK8DX_HOSTED_MYSQL_PASSWORD"], old_password)
            self.assertEqual(len(sent), 1)
            self.assertIn(f"IDENTIFIED BY '{api['MK8DX_HOSTED_MYSQL_PASSWORD']}'", sent[0][0])
            self.assertIn("GRANT SELECT, INSERT, UPDATE, DELETE ON `mk8dx`.*", sent[0][0])
            self.assertEqual(sent[0][1], (api["MK8DX_HOSTED_MYSQL_PASSWORD"],))  # hidden in any error text
            self.assertNotIn(api["MK8DX_HOSTED_MYSQL_PASSWORD"], printed)
            self.assertNotIn(old_password, printed)
            # The old login is untouched in Compose (the MySQL image's user) and is now the migration login.
            self.assertEqual((state / "compose.env").read_bytes(), compose_before)
            migration = json.loads((state / accounts.MIGRATION_FILE).read_text(encoding="utf-8"))
            self.assertEqual((migration["MK8DX_HOSTED_MYSQL_USER"], migration["MK8DX_HOSTED_MYSQL_PASSWORD"]),
                             ("mk8dx_app", old_password))
            self.assertEqual(json.loads(quiet(install.status, state)[1])["databaseAccounts"], "separate")
            # Running it again only repairs the account (same password), it does not move anything.
            with mock.patch.object(accounts, "docker_root_sql", side_effect=lambda c, r, sql, *h: sent.append((sql, h))):
                self.assertIsNone(quiet(install.separate_database_accounts, state)[0])
            self.assertIn(f"IDENTIFIED BY '{api['MK8DX_HOSTED_MYSQL_PASSWORD']}'", sent[1][0])
            # Rollback restores the previous files byte for byte; the installation is consistent again.
            install.restore_single_account(state, previous)
            self.assertEqual({name: (state / name).read_bytes() for name in install.ACCOUNT_FILES}, before)
            self.assertFalse((state / accounts.MIGRATION_FILE).exists())
            quiet(install.status, state)

    def test_a_failed_account_creation_changes_nothing(self):
        with tempfile.TemporaryDirectory(prefix="mk8dx legacy ") as temporary:
            state = docker_state(Path(temporary))
            make_legacy(state)
            before = {path.name: path.read_bytes() for path in state.iterdir() if path.is_file()}
            with mock.patch.object(accounts, "docker_root_sql", side_effect=RuntimeError("database refused")), \
                    self.assertRaises(RuntimeError):
                install.separate_database_accounts(state)
            self.assertEqual({path.name: path.read_bytes() for path in state.iterdir() if path.is_file()}, before)

    def test_upgrade_migrates_with_the_migration_login_and_rolls_back_an_unhealthy_start(self):
        with tempfile.TemporaryDirectory(prefix="mk8dx upgrade ") as temporary:
            state = docker_state(Path(temporary))
            make_legacy(state)
            before = {name: (state / name).read_bytes() for name in install.ACCOUNT_FILES}
            calls = []

            def compose(_state, *arguments):
                calls.append(arguments)
                if arguments[0] == "up" and "--wait" in arguments and "--force-recreate" in arguments:
                    raise subprocess.CalledProcessError(1, "docker compose up")

            fake_lifecycle = mock.Mock()
            with mock.patch.dict(sys.modules, {"lifecycle": fake_lifecycle}), \
                    mock.patch.object(install, "run_compose", side_effect=compose), \
                    mock.patch.object(install, "images_behind_package", return_value=[]), \
                    mock.patch.object(accounts, "docker_root_sql"), \
                    self.assertRaisesRegex(RuntimeError, "previous account again"):
                quiet(install.operate, state, "upgrade", Path(temporary) / "backup")
            migrations = [call for call in calls if call[0] == "run"]
            self.assertEqual(len(migrations), 2)
            self.assertTrue(all(call[3] == "migrate" for call in migrations), migrations)
            self.assertIn("dist/composition/migration-apply-main.js", migrations[0])
            started = [call for call in calls if call[0] == "up" and "--force-recreate" in call]
            self.assertEqual(len(started), 2)
            self.assertIn("--wait", started[0])
            self.assertNotIn("--wait", started[1])
            # The API runs with its previous (still valid) login again.
            self.assertEqual({name: (state / name).read_bytes() for name in install.ACCOUNT_FILES}, before)
            self.assertFalse((state / accounts.MIGRATION_FILE).exists())

    def test_restore_recreates_the_runtime_account_and_migration_settings(self):
        with tempfile.TemporaryDirectory(prefix="mk8dx restore ") as temporary:
            state = docker_state(Path(temporary))
            (state / accounts.MIGRATION_FILE).unlink()  # no backup carries it
            password = install.read_dotenv(state / "api.env")["MK8DX_HOSTED_MYSQL_PASSWORD"]
            with mock.patch.object(accounts, "docker_root_sql") as root:
                lifecycle.restore_runtime_account(state, ["docker", "compose"])
            self.assertIn(f"IDENTIFIED BY '{password}'", root.call_args.args[2])
            quiet(install.status, state)
            make_legacy(state)
            with mock.patch.object(accounts, "docker_root_sql") as root:
                lifecycle.restore_runtime_account(state, ["docker", "compose"])
            root.assert_not_called()
            self.assertFalse((state / accounts.MIGRATION_FILE).exists())


def native_create(folder: Path, route="B2", **changes) -> Path:
    state = folder / "state"
    values = dict(route=route, origin="https://mk8dx.example.org" if route == "B2" else "http://127.0.0.1:18090",
                  admin_email="a@example.org", db_host="localhost" if route == "B2" else "127.0.0.1",
                  db_port=3306 if route == "B2" else 18306, db_name="acct_mk8dx" if route == "B2" else "mk8dx",
                  db_user="acct_owner" if route == "B2" else "mk8dx_app", db_password="owner-Secret1",
                  smtp_host="mail.example.org", smtp_port=465, smtp_user="u", smtp_password="p",
                  smtp_from="n@example.org")
    values.update(changes)
    with mock.patch.object(native_install, "package_paths"):
        quiet(native_install.create, state, **values)
    return state


class NativeRoutesTest(unittest.TestCase):
    def test_b2_with_two_users_runs_the_website_with_the_limited_one(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = native_create(Path(temporary), runtime_user="acct_site", runtime_password="site-Secret1")
            _, profile, runtime = native_install.loaded(state)
            self.assertEqual((runtime["MK8DX_HOSTED_MYSQL_USER"], runtime["MK8DX_HOSTED_MYSQL_PASSWORD"]),
                             ("acct_site", "site-Secret1"))
            self.assertEqual(native_install.migration_environment(state, profile), state / accounts.MIGRATION_FILE)
            migration = json.loads((state / accounts.MIGRATION_FILE).read_text(encoding="utf-8"))
            self.assertEqual(migration["MK8DX_HOSTED_MYSQL_USER"], "acct_owner")
            self.assertNotIn("owner-Secret1", (state / "operator.json").read_text(encoding="utf-8"))

    def test_b2_with_one_user_keeps_working_and_warns(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = folder = Path(temporary) / "state"
            with mock.patch.object(native_install, "package_paths"):
                _, printed = quiet(native_install.create, folder, "B2", "https://mk8dx.example.org", "a@example.org",
                                   "localhost", 3306, "acct_mk8dx", "acct_owner", "owner-Secret1", "mail.example.org",
                                   465, "u", "p", "n@example.org")
            self.assertIn("same database account", printed)
            self.assertNotIn("owner-Secret1", printed)
            _, profile, _ = native_install.loaded(state)
            self.assertEqual(native_install.migration_environment(state, profile), state / "operator.json")
            _, printed = quiet(native_install.report_accounts, state, profile)
            self.assertIn("same database account", printed)

    def test_b2_second_user_is_checked_then_switched_and_can_be_undone(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = native_create(Path(temporary))
            before = {path.name: path.read_bytes() for path in state.iterdir()}
            too_strong = {"dataAccess": True, "canChangeSchema": True, "extraPrivileges": ["ALL PRIVILEGES"]}
            with mock.patch.object(native_install, "check_runtime_account", return_value=too_strong), \
                    self.assertRaisesRegex(ValueError, "still change the database structure"):
                native_install.database_accounts(state, "acct_site", "site-Secret1")
            self.assertEqual({path.name: path.read_bytes() for path in state.iterdir()}, before)
            seen = []
            fine = {"dataAccess": True, "canChangeSchema": False, "extraPrivileges": []}

            def check(_state, settings=None):
                seen.append(json.loads(Path(settings).read_text(encoding="utf-8"))["MK8DX_HOSTED_MYSQL_USER"])
                return fine
            with mock.patch.object(native_install, "check_runtime_account", side_effect=check):
                _, printed = quiet(native_install.database_accounts, state, "acct_site", "site-Secret1")
            self.assertEqual(seen, ["acct_site"])
            self.assertFalse((state / "database-account-check.json").exists())
            self.assertIn("passenger-config", printed)
            self.assertNotIn("site-Secret1", printed)
            _, profile, runtime = native_install.loaded(state)
            self.assertEqual(runtime["MK8DX_HOSTED_MYSQL_USER"], "acct_site")
            self.assertEqual(native_install.database_logins(profile, json.loads(
                (state / install.SECRET).read_text(encoding="utf-8")))["migration"], ("acct_owner", "owner-Secret1"))
            quiet(native_install.database_accounts, state, undo=True)
            self.assertEqual({path.name: json.loads(path.read_bytes()) for path in state.iterdir()},
                             {name: json.loads(value) for name, value in before.items()})

    def test_a3_creates_three_accounts_and_upgrades_an_old_installation(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = native_create(Path(temporary), route="A3")
            _, profile, runtime = native_install.loaded(state)
            secret = json.loads((state / install.SECRET).read_text(encoding="utf-8"))
            logins = native_install.database_logins(profile, secret)
            self.assertEqual([logins[name][0] for name in ("runtime", "migration", "backup")],
                             ["mk8dx_runtime", "mk8dx_app", "mk8dx_backup"])
            self.assertEqual(len({password for _, password in logins.values()}), 3)
            sent = []
            with mock.patch.object(native_install, "_local_root_sql",
                                   side_effect=lambda client, sql, root, *hidden: sent.append((sql, root))):
                native_install.provision_local_accounts(state, Path("mariadb.exe"))
            sql, root = sent[0]
            self.assertIsNone(root)  # the first start: root has no password yet
            self.assertIn("GRANT ALL PRIVILEGES ON `mk8dx`.* TO 'mk8dx_app'@'127.0.0.1'", sql)
            self.assertIn("GRANT SELECT, INSERT, UPDATE, DELETE ON `mk8dx`.* TO 'mk8dx_runtime'@'127.0.0.1'", sql)
            self.assertIn(f"GRANT {accounts.BACKUP_PRIVILEGES} ON `mk8dx`.* TO 'mk8dx_backup'@'127.0.0.1'", sql)
            self.assertIn("ALTER USER 'root'@'localhost'", sql)

            # An A3 installation from before the split: one mk8dx_app login, already provisioned.
            legacy = native_create(Path(temporary) / "legacy", route="A3")
            for name, change in (("operator.json", lambda v: v.update({"MK8DX_HOSTED_MYSQL_USER": "mk8dx_app",
                                                                         "MK8DX_HOSTED_MYSQL_PASSWORD": "old-Secret1"})),
                                 (install.SECRET, lambda v: [v.update({"MK8DX_HOSTED_MYSQL_PASSWORD": "old-Secret1"}),
                                                             v.pop(accounts.MIGRATION_PASSWORD),
                                                             v.pop(accounts.BACKUP_PASSWORD)]),
                                 (install.PROFILE, lambda v: v["database"].update(
                                     {"user": "mk8dx_app", "migrationUser": None, "backupUser": None}))):
                value = json.loads((legacy / name).read_text(encoding="utf-8"))
                change(value)
                if name == install.PROFILE:
                    value["database"] = {k: v for k, v in value["database"].items() if v is not None}
                (legacy / name).write_text(json.dumps(value), encoding="utf-8")
            (legacy / accounts.MIGRATION_FILE).unlink()
            (legacy / "db-provisioned.json").write_text("{}", encoding="utf-8")
            native_install.loaded(legacy)
            sent.clear()
            with mock.patch.object(native_install, "_local_root_sql",
                                   side_effect=lambda client, sql, root, *hidden: sent.append((sql, root, hidden))):
                _, printed = quiet(native_install.provision_local_accounts, legacy, Path("mariadb.exe"))
            sql, root, hidden = sent[0]
            self.assertIsNotNone(root)
            self.assertNotIn("mk8dx_app", sql)  # the old login is never changed
            _, profile, runtime = native_install.loaded(legacy)
            self.assertEqual(runtime["MK8DX_HOSTED_MYSQL_USER"], "mk8dx_runtime")
            self.assertEqual(set(hidden), {runtime["MK8DX_HOSTED_MYSQL_PASSWORD"], json.loads(
                (legacy / install.SECRET).read_text(encoding="utf-8"))[accounts.BACKUP_PASSWORD]})
            migration = json.loads((legacy / accounts.MIGRATION_FILE).read_text(encoding="utf-8"))
            self.assertEqual((migration["MK8DX_HOSTED_MYSQL_USER"], migration["MK8DX_HOSTED_MYSQL_PASSWORD"]),
                             ("mk8dx_app", "old-Secret1"))
            self.assertNotIn("Secret", printed)

    def test_setup_migrates_with_the_migration_login_and_backup_never_uses_the_website_login(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = native_create(Path(temporary), runtime_user="acct_site", runtime_password="site-Secret1")
            used = []
            with mock.patch.object(native_install, "package_paths"), \
                    mock.patch.object(native_install, "node_command",
                                      side_effect=lambda s, script, *a, settings=None, **k: used.append(
                                          (script, Path(settings).name if settings else "operator.json"))), \
                    mock.patch.object(native_install, "report_accounts"), \
                    mock.patch("tooling.scheduled_backup.after_setup"):
                native_install.operate(state, "setup")
            self.assertEqual([name for _, name in used], [accounts.MIGRATION_FILE] * 3)
            launched = {}

            class Dump:
                def __init__(self, command, env, **_):
                    launched.update(user=command[command.index("--user") + 1], password=env["MYSQL_PWD"])
                    self.stdout, self.stderr, self.returncode = io.BytesIO(b"-- dump\n"), io.BytesIO(b""), 0

                def wait(self):
                    return 0
            with mock.patch.object(native_install.shutil, "which", return_value="mariadb-dump"), \
                    mock.patch.object(native_install, "dump_options", return_value=[]), \
                    mock.patch.object(native_install.subprocess, "Popen", Dump), \
                    mock.patch.object(native_install, "observe_database",
                                      return_value={"engine": "MariaDB", "version": "11.4.12"}):
                quiet(native_install.backup, state, Path(temporary) / "backup")
            self.assertEqual(launched, {"user": "acct_owner", "password": "owner-Secret1"})


if __name__ == "__main__":
    unittest.main()
