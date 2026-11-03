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

## Software upgrade

Back up first. Build the new public source into local images, inspect the resolved Compose model, apply only pending catalog migrations with `--backup-verified`, then recreate services without removing volumes:

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml build api web
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml run --rm --no-deps api sh /app/operator-command.sh dist/composition/migration-apply-main.js --migration-catalog /app/infrastructure/mysql/migration-catalog-v1.json --confirm-database mk8dx --backup-verified
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml up -d --no-build
```

Check readiness, sign-in and critical workflows after the recreation. A new Staff or World Records seed is a separate conscious operator action using the seed CLI from step 6 of [Getting started](GETTING_STARTED.md#6-add-the-two-reviewed-reference-sets). The seed refuses to overwrite intentional local reference edits without review. Startup never refreshes from an external feed. Returning to an older image after a schema change is not a database rollback; use a compatible backup or a tested forward fix.

Upgrades are tested by recreating a local installation on the new version with its existing volume. The prebuilt images come with the host package; no container registry tag is published.

The migration catalog is hash-pinned and applied migrations are never rewritten. The public history starts at 0.1.0-rc.8, in which the historical data repairs 0048, 0049 and 0057 carry neutral texts (no personal data). Every installation made from this repository (or its releases) upgrades normally. A database that already applied the original texts of those migrations before the public history existed (the maintainer's own installation) keeps upgrading from the maintainer's tree, not from these packages: the migration check refuses the changed hashes on purpose.

## Remove an installation

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
installation on this computer; keep them if another one still runs. `mysql:8.4.11` and
`axllent/mailpit:v1.31.3` can be removed with `docker image rm` too when nothing else uses them. A host-package
installation is removed from its package folder: see [Host a community server](guides/HOSTING.md#remove-an-installation).

## Production source-build profile

The production Compose/Caddy configuration was checked locally for syntax. Real DNS, certificates, SMTP, backup storage and target-host restore were not validated. Use your own domain and SMTP service with implicit TLS; keep the SMTP password in a private file outside Git. The installation directory must lie outside the repository (the installer refuses a path inside it). From the repository root, on the Linux host:

```sh
state=/var/lib/mk8dx/production
python3 tooling/install.py init --state-dir "$state" --mode production --domain your-domain.example --smtp-host smtp.your-domain.example --smtp-user your-user --smtp-password-file <private-file> --smtp-from sender@your-domain.example
docker compose --env-file "$state/compose.env" -f compose.yaml -f compose.production.yaml config --quiet
```

Replace all placeholders with your actual settings and confirm the resolved service ports, contexts and mounts on your host. The profile publishes 80/443 through Caddy for HTTPS; API and MySQL remain internal, and there is no public Mailpit. Follow the same empty-DB migration/seed/start sequence with the production Compose files. Use a real operator-owned inbox for first-admin assignment. Do not treat the local syntax check as a production deployment approval.
