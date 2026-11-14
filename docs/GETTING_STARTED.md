# Getting started on a local computer

Players and organisers do not need this page: start at [Get started](../README.md#get-started) in the README, the single entry point that names one guide per goal. This page is the developer route: it builds the server from source with Docker.

This guide creates a new Docker project on your computer. It was tested on Windows 11 with PowerShell and Docker Desktop in Linux-container mode; the Linux variants of the commands are at the end.

## Before you start

Install Docker Desktop with Linux containers, Docker Compose and Python 3.12 or newer. Clone the repository as described in the [developer guide](DEVELOPMENT.md). Open PowerShell, type `cd 'C:\path\to\repository'` with your actual checkout path, and verify that `compose.yaml` and `tooling/install.py` are in the current folder. Do not type the placeholder literally. The private installation directory must lie **outside** the repository (the installer refuses one inside it); this guide uses `%LOCALAPPDATA%\MK8DX\Dev`. If you save a private configuration manually on Windows, show file extensions and check that it was not saved as `.txt`.

Every command below runs from the **repository root** unless a different location is stated. If a command fails, stop at that step, inspect the error and the project-specific service state, and rerun only the failed step. Do not use `docker compose down -v`: that removes the database volume (to throw away a trial installation on purpose, follow [Remove an installation](OPERATIONS.md#remove-an-installation)).

## 1. Generate private configuration (PowerShell)

```powershell
$state = "$env:LOCALAPPDATA\MK8DX\Dev"
python tooling/install.py init --state-dir $state --mode local
```

Every later command uses `$state`; in a new PowerShell window set it again first. From a source checkout the installer names your images `mk8dx-source/api:local` and `mk8dx-source/web:local`, so a build never replaces the images of an installed release package. Expected: it prints a new private directory, a Web origin and a Mailpit inbox URL. Record the two URLs. The installer selects available loopback ports and writes unique keys and database passwords once. If the directory already exists, use that installation's files; do not rerun `init` against it or delete it to fix an ordinary startup problem.

## 2. Check the Compose model

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml config --quiet
```

Expected: no output and exit code 0. If it fails, check the current directory and the private `compose.env` path. Do not paste its contents into a public report.

## 3. Build images

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml build api web
```

Expected: two local images build from the repository. A dependency or network error can be retried after the underlying issue is fixed.

## 4. Start the database and local mailbox

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml up -d --wait mysql mailpit
```

Expected: the command returns once `mysql` reports healthy and Mailpit runs (`--wait` waits for the health check; every Docker Compose v2 release since 2022 has it). The migrations in step 5 need a healthy database, so do not continue while this command is still waiting or if it reports a failure. Use the same files with `docker compose ... ps` to inspect state. The database has no host port; Mailpit is bound to the loopback address.

## 5. Apply the empty-database migrations

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml run --rm --no-deps api sh /app/operator-command.sh dist/composition/migration-apply-main.js --migration-catalog /app/infrastructure/mysql/migration-catalog-v1.json --confirm-database mk8dx --fresh-empty-database
```

Expected: every migration in the catalog applies in order (one per entry of `infrastructure/mysql/migration-catalog-v1.json`; the last number matches `databaseMigration` in `compatibility.json`). This mode refuses a non-empty unrecognized database. If an interrupted migration reports partial DDL, inspect it and restore a verified backup or repair forward; do not wipe an existing install. Later upgrades use `--backup-verified` as described in [Operations](OPERATIONS.md).

## 6. Add the two reviewed reference sets

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml run --rm --no-deps api sh /app/operator-command.sh dist/composition/reference-seed-main.js --staff-seed /app/infrastructure/mysql/reference/nintendo-staff-v1.json --world-record-seed /app/infrastructure/mysql/reference/world-records-v1.json
```

Expected: `{"staff":"applied","worldRecords":"applied"}` (192 staff times and 192 World Records). A repeat reports `unchanged`. These are reference times only. No players, accounts, claims, submissions or Tournament results are imported. See [Third-party materials](THIRD_PARTY_MATERIALS.md) about these reference sets.

## 7. Start Web and API

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml up -d --wait api web
```

Expected: Web, API and MySQL become healthy. Open the Web origin printed at step 1 in a browser; Home and Tracks should load. For a readiness check, replace `<web-origin>` with that exact address and run `Invoke-RestMethod '<web-origin>/health/ready'` in PowerShell. If it fails, inspect only this project's `ps` and service logs, keeping any private values out of shared reports.

## 8. Sign in and become the first administrator

Use **Sign in** on the Web page. Enter an email address you control for this local test. Open the Mailpit URL from step 1 and follow the latest magic link. The local Mailpit instance does not send an external email. A verified UserAccount is enough for administrator setup; creating a Player is optional and is only needed if you want to post a Time Trial. After that verified login, run this from PowerShell in the repository root, replacing the example address with the exact one you used:

```powershell
'your-test-address@example.test' | docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml run -T --rm --no-deps api sh /app/operator-command.sh dist/administration/installer-administrator-main.js --email-stdin
```

Expected: first assignment is created. Refresh or sign in again: the account menu now has **Administration** (`/?admin=1`), which lists the administrator. Repeating for the same account is unchanged; a different account cannot take the first-admin slot. If the CLI refuses, confirm that the magic-link sign-in completed and that the command used this installation's private configuration. Keep the private email and links out of public issues.

The first public signup receives an ordinary account, never administrator rights. On an installation whose bootstrap was already used for a temporary administrator, use the separate, tightly limited [operator recovery step](OPERATIONS.md#recover-a-local-installation-with-a-temporary-administrator). Do not delete the previous grant or database to reopen bootstrap.

## First workflows

On **Tracks**, choose a track and use **Post a time** to enter a time in 150cc or 200cc. Check the values on the confirmation and press **Confirm and publish**: the time is published at once and appears on the leaderboard. An administrator can correct or withdraw it later. On **Tournaments**, an administrator can create a night, set attendance and Switch availability, generate groups, enter manual races or import supported Excel/CSV results, review the final step and decide publication and rating separately. The API integration test covers the full synthetic Tournament workflow; the local browser smoke check covers route loading and responsive layout, not a complete human entry session.

## Return later, back up, and upgrade

After closing PowerShell, reopen it, `cd` to the same repository root and set `$state` again. The private directory and Docker volume persist. Start the project with the same Compose files and `up -d`; use `stop` for a normal stop. [Operations](OPERATIONS.md) gives exact project-specific backup, restore and software-update commands. A database migration cannot be reversed simply by starting an older image.

## Linux (and macOS) variant

The same steps in a POSIX shell, from the repository root. These steps were run on a Linux Docker Engine on
2026-11-02 (Docker 28.5, Alpine Linux in a container), through the magic-link sign-in and the first-administrator
grant. On macOS with Docker Desktop
they are expected to work but have not been tried.

```sh
state="$HOME/.local/share/mk8dx/dev"
python3 tooling/install.py init --state-dir "$state" --mode local
compose() { docker compose --env-file "$state/compose.env" -f compose.yaml -f compose.local.yaml "$@"; }
compose config --quiet
compose build api web
compose up -d --wait mysql mailpit   # returns once MySQL is healthy
compose run --rm --no-deps api sh /app/operator-command.sh dist/composition/migration-apply-main.js --migration-catalog /app/infrastructure/mysql/migration-catalog-v1.json --confirm-database mk8dx --fresh-empty-database
compose run --rm --no-deps api sh /app/operator-command.sh dist/composition/reference-seed-main.js --staff-seed /app/infrastructure/mysql/reference/nintendo-staff-v1.json --world-record-seed /app/infrastructure/mysql/reference/world-records-v1.json
compose up -d --wait api web   # returns once the API and website are healthy
curl '<web-origin>/health/ready'
```

After signing in through Mailpit (step 8), grant the first administrator:

```sh
printf '%s\n' 'your-test-address@example.test' | compose run -T --rm --no-deps api sh /app/operator-command.sh dist/administration/installer-administrator-main.js --email-stdin
```

`compose` is a shell function for this terminal only; define it again in a new terminal after setting `$state`.
In Git Bash on Windows, prefix commands that pass `/app/...` arguments with `MSYS_NO_PATHCONV=1`. Problems:
[Troubleshooting](DEVELOPMENT.md#troubleshooting).

Production uses [Operations](OPERATIONS.md) and the separate production Compose profile. Real DNS, TLS, SMTP, backup storage and a human operator validation are external requirements. The prebuilt images ship inside the release packages (the host package and the A2 packages, listed in the release `manifest.json`). The x86-64 images are also public on GitHub Container Registry and can be pulled without signing in, for example `ghcr.io/fromthelake/mk8dx-api:v0.2.2-amd64` and `ghcr.io/fromthelake/mk8dx-web:v0.2.2-amd64` (tags follow `<release>-amd64`); the arm64 images exist only inside the arm64 A2 packages.
