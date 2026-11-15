# Operations: install, administer, back up and upgrade

With a prebuilt host package, use its launcher menu and the [user guide](install/MK8DX_User_Guide_EN.txt) (backup, update and recovery chapters). This page has the underlying commands for installations built from source.

This document describes a new, operator-owned Docker project. The installer creates a unique Compose project, keys and passwords in a new private directory. Keep that directory and all backups out of Git. The [beginner guide](GETTING_STARTED.md) gives the full first-install sequence and expected results. [Nederlandse versie](OPERATIONS_NL.md).

## Local operation

Run commands from the repository root in PowerShell, with `$state` set to your private installation directory (for example `$state = "$env:LOCALAPPDATA\MK8DX\Dev"`, outside the repository). The local Compose profile binds Web and Mailpit to loopback only; API and MySQL have no host ports. The installer prints the selected ports, which may differ on another machine. Run `docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml config --quiet` before starting. A new database receives every hash-pinned migration of the catalog and the two explicit 192-row Staff/World Records seeds. No community account or submission is shipped.

After signing in through the local Mailpit magic link, give the verified operator account first-administrator status with the exact `--email-stdin` command from step 8 of [Getting started](GETTING_STARTED.md#8-sign-in-and-become-the-first-administrator). The first-admin slot is single-use: the same account reruns unchanged; another account is refused. Refresh the browser or sign in again to see administrator capabilities.

## Recover a local installation with a temporary administrator

If the first-admin slot was used by a temporary test account, sign in with the intended operator email through the normal magic link first. A Player profile is not required. With the installation's existing `compose.env`, run from this repository root in PowerShell:

```powershell
'<YOUR_VERIFIED_EMAIL>' | docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml run -T --rm --no-deps api sh /app/operator-command.sh dist/administration/administrator-recovery-main.js --email-stdin --confirm-existing-bootstrap
```

Replace only `<YOUR_VERIFIED_EMAIL>` with the exact address just verified. This local operator CLI requires the private installation configuration and Docker access. It accepts one active bootstrap administrator, checks the exact verified target and uses the existing audited administrator-grant service. It adds a grant without removing the original administrator or changing accounts/results; a repeat for the same target is `unchanged`, while another recovery target is refused. Refresh or sign in again to receive the new capabilities. For a different installation directory, set `$state` to that installation's directory. Never use the first-admin installer command again for another account, remove its marker, or replace a volume. Ordinary authenticated administrator management remains the route for later changes.

Check readiness and state with the Web URL printed by the installer and this project-specific command:

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml ps
Invoke-RestMethod '<web-origin>/health/ready'
```

Replace `<web-origin>` with the printed address. A normal stop/start preserves the database volume:

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml stop
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml start
```

Never use `down -v` for a normal restart or update. Mailpit is a test mailbox, not a backup source. If a service fails, inspect only this project's `ps` and the affected service logs. Redact addresses, tokens and private paths before sharing diagnostics.

## Backup and restore into a new project

Before an upgrade, create a new private backup directory outside the repository. It includes compressed SQL, the configuration/key recovery material, and SHA-256 checks. Protect or encrypt the backup according to your machine's policy; losing the keys can make stored protected values unreadable.

```powershell
python tooling/lifecycle.py backup --state-dir $state --output ..\mk8dx-backup-20260930
python tooling/lifecycle.py restore-new --backup ..\mk8dx-backup-20260930 --state-dir ..\mk8dx-restore-20260930
```

Choose paths that do not already exist; the date is an example. `restore-new` checks hashes, refuses an existing target directory, selects another Compose project and free loopback ports, and restores only that new instance. Start the restored Web/API/Mailpit with the same Compose files and `--env-file ..\mk8dx-restore-20260930\compose.env`. Migration and seed reruns should report zero pending migrations and `unchanged`. Sign in again to verify account and administrator state. An interrupted restore must be investigated; choose a new target rather than treating partial state as complete.

The local route has no separate media volume. Optional app downloads and recognition media are not configured in this route. Add their backup/restore steps if later enabled.

## Automatic daily backup (A1, A2, B1, A3, B2)

Every route except A2 offline (which has its own sealed nightly backup in MK8DX beheer) gets one scheduled
command, `python tooling/install.py backup-run --state-dir <installation>`. It makes the route's normal backup
(the same dump options and private files as `lifecycle.py backup` / `install.py backup`, so the normal restore
commands take it), verifies it with the restore checks (SHA-256 of every file, the dump decompresses), and only
then renames it from a hidden `.partial-…` folder to `<project>-<UTC date>-<time>`. A failed or unverified run
removes only its own partial folder and keeps every older backup.

| | A1 / A3 (Windows) | A1 (Linux/macOS desktop) | B1 (VPS) | B2 (shared hosting) |
| --- | --- | --- | --- | --- |
| Scheduler | Task Scheduler, current user, catches up after a missed night | systemd user timer / launchd | the user's crontab | one marked line in the user's crontab |
| Default | on | on | on | asked at setup, default yes |
| Folder | `Documents\MK8DX-backups\automatic` | `~/mk8dx-backups/automatic` | `~/mk8dx-backups/automatic` | `~/mk8dx-backups/automatic` (outside `public_html`) |
| Size bound | 10 GiB | 10 GiB | 10 GiB | 1 GiB |

`setup` switches it on (B2 only when the setup question was answered yes; `--no-auto-backup` on `wizard`,
`init` or `setup` leaves it off); `upgrade` from a new package folder points the schedule at that folder. A3
starts its own MariaDB for the backup when MK8DX is not running and stops it again. A1/B1 need the MK8DX database
container running (on Windows the task waits up to 15 minutes for Docker Desktop); otherwise the run fails with a
clear message and the previous backup stays the newest.

Retention: the newest backup of each of the last 14 days, plus the newest of each of the 4 ISO weeks before
those, then the oldest are dropped until the total fits the size bound. The newest verified backup is never
deleted, even when it alone is larger. Backup folders are owner-only (0700/0600; on Windows the folder's access
list is this user, SYSTEM and Administrators). A run first checks for free space of about twice the last backup.

```sh
python3 tooling/install.py backup-status --state-dir <installation>    # on/off, last result, age in hours
python3 tooling/install.py backup-run --state-dir <installation>       # one run now
python3 tooling/install.py backup-latest --state-dir <installation> --print-path
python3 tooling/install.py backup-schedule --state-dir <installation> [--backup-root DIR] [--copy-to DIR]
        [--backup-time 03:15] [--keep-daily 14] [--keep-weekly 4] [--max-backup-mb 10240] [--encrypt-backups]
python3 tooling/install.py backup-unschedule --state-dir <installation>  # removes the task/timer/cron line
```

`install.py status` (menu 3, check) shows the same summary under `automaticBackup`; `stale: true` means no
successful backup in the last 36 hours. Exit codes of `backup-run`: 0 ok, 1 backup failed, 2 verification
failed, 3 backup ok but the copy failed, 4 another run busy, 5 not enough disk space or quota. A cron run prints
only failures, so a shared host mails you exactly those.

**Crontab (B1/B2).** The line ends in `# mk8dx-auto-backup:<id>` and carries the `PATH` of the shell that ran
`setup` (so the Node and `mariadb-dump` of an activated Node environment are found). Installing and removing
rewrite only that line; every other line stays in order. The notice and 64-hex hash that DirectAdmin-style hosts
print on `crontab -l` are not crontab lines and are not written back. Check with `crontab -l`.

**A copy off the host.** A backup on the same disk does not survive a lost disk, server or hosting account.
On Windows choose a second folder on another drive or a NAS (use a `\\server\share\folder` path; the task runs as
you, but mapped drive letters may be missing there): `backup-schedule --copy-to '\\nas\mk8dx'`. Each verified
backup is copied, verified again and kept with the same retention. For B1/B2 pull the newest verified backup from
your own PC (Windows has `scp` built in; use your host's SSH port):

```sh
latest=$(ssh -p 26 user@host 'cd ~/apps/mk8dx && python3 tooling/install.py backup-latest --state-dir ~/mk8dx-private --print-path')
scp -P 26 -r "user@host:$latest" ./mk8dx-offsite/
# or, with rsync on both sides: rsync -a -e 'ssh -p 26' "user@host:$latest" ./mk8dx-offsite/
```

**Encryption (optional).** `--encrypt-backups` seals each backup (AES-256-GCM with a scrypt key from a recovery
code, as A2 offline). The code is printed once: write it down and keep it away from the host. The host keeps it
DPAPI-protected (Windows) or with `systemd-creds`/owner-only permissions (Linux) for the nightly run. Open a
sealed backup for restore with `install.py backup-open --state-dir <new installation> --backup-input <sealed>
--recovery-phrase-file <file with the code> --backup-output <new folder>`, then use the normal restore command on
that folder. On shared hosting the code can only be kept next to the backups, so sealing protects copies taken
off the host, not the host itself; there the protection is owner-only permissions outside `public_html`. Without
the code a sealed backup cannot be restored by anyone, including you.

**A new recovery code.** When the code may have been seen by someone else, run
`python3 tooling/install.py backup-new-code --state-dir <installation>` (on Windows `python`). It prints a new code
once, stores it the same protected way and the next backups are sealed with it. Backups made before are not
re-encrypted: they still open only with the old code, so keep that one with them until you delete them. The same
command works for an A2 home and club installation (its code is the one MK8DX beheer shows; there **Make a new
recovery code** in MK8DX beheer does the same). An installation without encrypted backups has no code to replace.

**Restore drill.** `tooling/tests/test_backup_restore_drill.py` (opt-in, `MK8DX_BACKUP_DRILL=1`) makes data in a
disposable MariaDB 11.4 and MySQL 9.7 (B2 code path) and in a real A1 Compose project, runs the scheduled backup,
wipes the data, restores with the normal restore command and compares every row.

## Database accounts

The website's API connects with a database account that may only read and write rows (`SELECT`, `INSERT`,
`UPDATE`, `DELETE` on the MK8DX database). Even SQL that reached the database through some future bug can then not
drop, alter or empty tables, create users or hand out rights; the real-database suites run with exactly such an
account and check that `DROP`, `ALTER`, `TRUNCATE`, `CREATE` and `GRANT` are refused. Database updates, the
reference data, backups and restores use separate accounts:

| Route | Website (runtime) | Updates and reference data (migration) | Backup |
| --- | --- | --- | --- |
| A1, A2, A2 offline, B1 (Docker) | `mk8dx_runtime`, created by `setup`/`upgrade` | `mk8dx_app` (the MySQL image's own user), only in the `migrate` service | MySQL's root login inside the database container (it already holds it; nothing leaves the container) |
| A3 (XAMPP + Node) | `mk8dx_runtime` on its own MariaDB | `mk8dx_app` | `mk8dx_backup` (`SELECT`, `SHOW VIEW`, `TRIGGER`, `LOCK TABLES`, `EVENT`) |
| B2 (shared hosting) | the second user you create in the panel ([B2 guide](install/B2_WEBHOSTING_EN.md#separate-database-accounts)) | the first user (all privileges on the database) | the first user |

Where the logins live: Docker routes give the API container only `api.env` and `operator.json` (runtime login); the
migration login is in `compose.env` (for the MySQL image) and in `migration.json`, which only the `migrate` service
mounts (`docker compose ... run --rm --no-deps migrate sh /app/operator-command.sh ...`; `up` never starts it). A3
and B2 keep `operator.json` (runtime) and `migration.json` (migration) in the private installation folder. Passwords
are generated (A1–A3) or typed hidden (B2), stored in `secrets.json` like the other keys (`MK8DX_MIGRATION_MYSQL_PASSWORD`,
A3 also `MK8DX_NATIVE_BACKUP_MYSQL_PASSWORD`) and never printed.
`status` shows `"databaseAccounts": "separate"`.

**Existing installations.** The update separates the accounts by itself and keeps access: Docker `upgrade` (and
A2 offline's package update) makes and checks the backup, creates `mk8dx_runtime`, keeps `mk8dx_app` unchanged as
the migration login, applies the migrations with it and starts the new API with the runtime login. If the API does
not become healthy with it, the previous files come back byte for byte and the API starts with the previous login
again; nothing in the database is removed. A3 does the same at the next start (or `maintenance`) of its own
MariaDB. B2 cannot create users itself: until you add the second user with `database-accounts`, everything keeps
working and `setup`, `upgrade` and `check` print a warning. `python tooling/install.py database-accounts --state-dir
<folder>` creates or repairs the runtime account on a Docker route by hand (MySQL running), for example after
following [Getting started](GETTING_STARTED.md) step by step. A restore into a new project (`lifecycle.py
restore-new`) recreates the runtime account, because accounts are not part of a database dump.

Check what an account may do without printing a password: `node api/dist/composition/database-account-check-main.js
--private-environment-file <folder>/operator.json` (A3/B2; in Docker: `docker compose ... run --rm --no-deps api sh
/app/operator-command.sh dist/composition/database-account-check-main.js`) prints `canChangeSchema` and any extra
privileges.

## When e-mail fails: confirm a dangerous action from the server

Dangerous administrator actions, and the list of every account with its e-mail address, need a fresh e-mail link
for the session that asks (step-up; the confirmation lasts `MK8DX_HOSTED_STEP_UP_WINDOW_SECONDS`, 60 to 3600,
default 600). That needs working e-mail. When the mail server is down or the address no longer receives mail, the
operator of the server can hand out the link instead:

1. The administrator presses **Confirm with a new email link** → **Send the link** on the website or in the app, as
   usual. The request is stored for that one session even when the e-mail cannot be sent. One mail attempt is
   bounded (`MK8DX_HOSTED_SMTP_TIMEOUT_MS`, 1000 to 60000, default 5000); when it fails the page answers within that
   time that the link was created but not mailed, names this command, and keeps waiting for the confirmation
   (`503 step_up_mail_unavailable`).
2. Within 10 minutes, on the server, from the package or repository folder:
   `python tooling/install.py step-up-link --state-dir <installation>` (B1/B2: `python3`). It names the
   installation's administrator; add `--admin-email <sign-in address>` for another account, such as a Director.
3. The command prints one line of JSON with `stepUpLink`, `clientKind` (`web` or `native`), `requestedAt` and
   `linkExpiresAt`. Check that `requestedAt` is the moment the button was pressed, open the link in any browser and
   press **Confirm this action**. The waiting action continues as with the e-mailed link; the e-mailed link, if it
   still arrives, no longer works.

The command has no HTTP route: it needs the private installation folder and access to this server (Docker routes
run it inside the `api` container with the private operator settings). It never opens the window by itself, only
replaces the link of the one pending request, and is recorded in the step-up audit as `step_up_operator_link`. It
refuses when nothing is pending, and when sessions on more than one device are waiting: then sign out the other
devices (**Sign out on all devices** in the account menu), press **Send the link** again and rerun it. Treat the printed link
like a password: it works once, for 10 minutes; never paste it into an issue or a chat. The underlying commands are
`node api/dist/security/step-up-operator-main.js --private-environment-file <folder>/operator.json --email-stdin`
(A3/B2) and `docker compose ... run -T --rm --no-deps api sh /app/operator-command.sh
dist/security/step-up-operator-main.js --email-stdin` (Docker), both with the address on standard input. A2 offline
sends no e-mail and asks for no step-up. Repair the mail settings afterwards with `install.py change-smtp`.

## Software upgrade

Back up first. Build the new public source into local images, inspect the resolved Compose model, apply only pending catalog migrations with `--backup-verified`, then recreate services without removing volumes:

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml build api web
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml run --rm --no-deps migrate sh /app/operator-command.sh dist/composition/migration-apply-main.js --migration-catalog /app/infrastructure/mysql/migration-catalog-v1.json --confirm-database mk8dx --backup-verified
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml up -d --no-build
```

0.2.3 moves `compose.yaml` from MySQL 8.4 to MySQL 9.7 LTS. MySQL upgrades the data files once, at the first start on the new image, and that cannot be undone except by restoring a backup. So make and verify the backup while the old database container still runs, before the `up -d` above recreates it on 9.7.

Check readiness, sign-in and critical workflows after the recreation. A new Staff or World Records seed is a separate conscious operator action using the seed CLI from step 6 of [Getting started](GETTING_STARTED.md#6-add-the-two-reviewed-reference-sets). The seed refuses to overwrite intentional local reference edits without review. Startup never refreshes from an external feed. Returning to an older image after a schema change is not a database rollback; use a compatible backup or a tested forward fix.

Upgrades are tested by recreating a local installation on the new version with its existing volume. The prebuilt images come with the host package; a release also pushes the amd64 Web and API images to GHCR (`ghcr.io/fromthelake/mk8dx-{web,api}:<tag>-amd64`).

The migration catalog is hash-pinned and applied migrations are never rewritten. The public history starts at 0.1.0-rc.8, in which the historical data repairs 0048, 0049 and 0057 carry neutral texts (no personal data). Every installation made from this repository (or its releases) upgrades normally. A database that already applied the original texts of those migrations before the public history existed (the maintainer's own installation) keeps upgrading from the maintainer's tree, not from these packages: the migration check refuses the changed hashes on purpose.

## Remove an installation

First remove the nightly backup schedule: `python tooling/install.py backup-unschedule --state-dir $state`.

To throw away a trial installation built from source, run from the repository root with `$state` set to that
installation's directory. `down -v` **deletes the database volume**, the accounts and everything in it; make a
backup first if you may want anything back. Use the Compose files the installation runs with
(`compose.local.yaml` for the local route, `compose.production.yaml` for the production profile).

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml down -v
Remove-Item -Recurse -Force $state
docker image rm mk8dx-source/api:local mk8dx-source/web:local
```

In a POSIX shell: the same `docker compose ... down -v` with `"$state/compose.env"`, then `rm -rf "$state"`. Remove
the state directory only after `down -v`, which needs its `compose.env`. The images are shared by every source
installation on this computer; keep them if another one still runs. The `mysql` and
`axllent/mailpit` images can be removed with `docker image rm` too when nothing else uses them. A host-package
installation is removed from its package folder: see [Host a community server](guides/HOSTING.md#remove-an-installation).

## Production source-build profile

The production Compose/Caddy configuration was checked locally for syntax. Real DNS, certificates, SMTP, backup storage and target-host restore were not validated. Use your own domain and SMTP service with implicit TLS; keep the SMTP password in a private file outside Git. The installation directory must lie outside the repository (the installer refuses a path inside it). From the repository root, on the Linux host:

```sh
state=/var/lib/mk8dx/production
python3 tooling/install.py init --state-dir "$state" --mode production --domain your-domain.example --smtp-host smtp.your-domain.example --smtp-user your-user --smtp-password-file <private-file> --smtp-from sender@your-domain.example
docker compose --env-file "$state/compose.env" -f compose.yaml -f compose.production.yaml config --quiet
```

Replace all placeholders with your actual settings and confirm the resolved service ports, contexts and mounts on your host. The profile publishes 80/443 through Caddy for HTTPS; API and MySQL remain internal, and there is no public Mailpit. Follow the same empty-DB migration/seed/start sequence with the production Compose files. Use a real operator-owned inbox for first-admin assignment. Do not treat the local syntax check as a production deployment approval.
