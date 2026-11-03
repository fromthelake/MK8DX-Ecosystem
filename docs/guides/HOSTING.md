# Host a community server

[All guides](../../README.md#guides) · [Operations](../OPERATIONS.md) · [User guide (complete)](../install/MK8DX_User_Guide_EN.txt)

This guide is for the person who runs the MK8DX website for a community: the website, the browser scanner,
the API and the database. Players, Tournament Directors and LiveTrial users then connect to your address.

Every installation starts empty: no accounts or results are inherited. It ships only the game catalog and the
Nintendo Ghost Staff and World Records reference sets.

## Choose a route

| Route | What you get | Runs on | Instructions |
| --- | --- | --- | --- |
| **B1** public website with Docker | Your own HTTPS domain, real email | **Linux** x86-64 server (Ubuntu 24.04 LTS documented) | [below](#linux-server-with-docker-main-route), and the VPS chapter of the user guide |
| **A1** trial on one computer with Docker | Website on `127.0.0.1`, local test inbox (Mailpit) | **Linux** x86-64 or Windows 11 | [below](#linux-server-with-docker-main-route) (Linux), user guide chapter 1 (Windows) |
| **A2** your own network | Second Windows PC on a trusted network, local certificate | Windows 11 host | user guide chapter 3 |
| **A3** one computer without Docker | XAMPP Apache, Node.js and a bundled MariaDB | Windows 11 | user guide chapter 2 |
| **B2** shared web hosting | Node.js (Passenger) and MariaDB/MySQL, no Docker or root | A hosting plan with SSH | user guide chapter 4 |
| From source | Build the images yourself from a clone | Linux, Windows (macOS untested) | [Getting started](../GETTING_STARTED.md) |

The user guide is [docs/install/MK8DX_User_Guide_EN.txt](../install/MK8DX_User_Guide_EN.txt) (also as Word,
and in Dutch). Its chapters walk through every route click by click, including backups, restores and updates.

## Get the package

Release packages are attached to the project's
[GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases). Download the package for your route
and `SHA256SUMS.txt` from the same release (see [Release packages](../RELEASE_PACKAGES.md)):

| Route | Package |
| --- | --- |
| A1, A2, B1 | `mk8dx-host-local-…-amd64.zip` (website, API and database images plus the launchers) |
| A3 | `mk8dx-xampp-node-windows-….zip` |
| B2 | `mk8dx-mijnhost-node-….zip` |

Check the checksum before you extract anything: `sha256sum <file>` on Linux, `shasum -a 256 <file>` on macOS,
`Get-FileHash '<file>' -Algorithm SHA256` in PowerShell. Compare the whole value with the line in
`SHA256SUMS.txt`. GitHub's **Source code (zip)** is not an installation package.

Working from a clone of the repository instead? Build the host package yourself
([below](#build-the-host-package-from-a-clone)); the A3 and B2 packages are covered under
[The other routes](#the-other-routes).

### Package revision and image tags

The revision in a package's file name (for example `v0.1.0`) names that release package. Official release
packages contain versioned `ghcr.io/fromthelake/mk8dx-{api,web}:<tag>-amd64` images. Their packaged launchers
and `compose.yaml` refer to the same tags. A manual clone build without `--version` still uses the current local
image tags. On its first
start a package always loads its own images, also over older images with the same tags, and notes that in
`images/loaded.txt`; later starts load them again only when one is missing. Because an update is extracted into
a new folder, it always runs the images of the new package. The folder
you extract into does not carry either one: this guide uses `/opt/mk8dx/host`.

## Build the host package from a clone

On Linux x86-64 with Git, Docker Engine and Python 3.12 or newer, from the root of a fresh clone. The package
needs four images: the API and Web images built from this source with the tags the launchers expect, and the
MySQL and Mailpit images that `compose.yaml` and `compose.local.yaml` name. `tooling/release/host_bundle.py
--list-images` prints exactly those four tags, so the commands read them from the script:

```sh
git clone https://github.com/fromthelake/MK8DX-Ecosystem.git
cd MK8DX-Ecosystem
python3 tooling/assets/shared_asset_source.py verify
set -- $(python3 tooling/release/host_bundle.py --list-images)   # API, Web, MySQL, Mailpit
docker build --platform linux/amd64 -f backend/api/Dockerfile -t "$1" .
docker build --platform linux/amd64 -f apps/timetrials-web/Dockerfile -t "$2" .
docker pull --platform linux/amd64 "$3"
docker pull --platform linux/amd64 "$4"
mkdir -p "$HOME/mk8dx-packages"
python3 tooling/release/host_bundle.py --output "$HOME/mk8dx-packages/mk8dx-host-local-r0-local-amd64.zip" --revision r0-local
```

  - `--output` must be a **new absolute `.zip` path outside the repository**; the script refuses anything else and
    writes a `.manifest.json` with the archive's SHA-256 next to it. `--revision` is your own label for the package.
    For a versioned release build, pass the same `--version vX.Y.Z` (or `vX.Y.Z-rc.N`) to `--list-images` and to
    the packaging invocation; this selects matching GHCR image names in the archive, launchers and Compose file.
- The script runs `tooling/privacy_scan.py` first and stops on a finding, so build from a clean clone.
- The image builds replace any images with the same tags on this machine, including those of an installed host
  package. Build on a machine that does not run one, or accept that it will run your build from then on.
- A package you built yourself has no `SHA256SUMS.txt`; compare the copy on the server with `archiveSha256` in
  the manifest instead. Then continue with [Install](#install) below.

## Linux server with Docker (main route)

The host package contains prebuilt Linux/amd64 images and the launcher `tooling/start-mk8dx.sh`. It runs on any
x86-64 Linux with Docker Engine; the user guide documents Ubuntu 24.04 LTS.

### Requirements

- Linux on x86-64 (`uname -m` prints `x86_64`). There are no ARM images yet.
- Docker Engine with the Compose plugin (`docker compose version` works), Python 3.12 or newer (`python3`) and
  `unzip`. For Ubuntu, the user guide's VPS chapter has the exact commands for Docker's official apt repository.
- An account that may use Docker (root, or a member of the `docker` group, which is equivalent to root).
- For **B1** in addition: a domain name whose DNS A record points to the server, incoming TCP 80 and 443 open,
  and an outgoing mail account with SMTP on an implicit-TLS port (465). STARTTLS-only on 587 does not fit the
  wizard. As margins (not measured minimums): 2 CPU cores, 8 GB RAM, 40 GB disk.
- For **A1** nothing else: it is reachable only from the same computer and uses a local test inbox.

### Install

```sh
mkdir -p /opt/mk8dx/host /var/lib/mk8dx
unzip -q mk8dx-host-local-<revision>-amd64.zip -d /opt/mk8dx/host
cd /opt/mk8dx/host
ls Start-MK8DX.cmd compose.yaml tooling/start-mk8dx.sh images/docker-images-amd64.tar
sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance
```

Use a home-directory path instead (for example `"$HOME/MK8DX/host"` and `"$HOME/mk8dx-data"`) if you do not work
as root. The second path is your **private installation directory**: it holds the keys, passwords and settings.
It must not exist yet and must lie outside the package folder; the installer refuses anything else and creates
it with mode 0700. Keep it when you install a newer package.

On the first run the launcher loads the images from `images/docker-images-amd64.tar` and starts the wizard:

1. `Choose A1, A2, A3, B1 or B2:` type **B1** for a public website or **A1** for a local trial. (A2 is the
   Windows home-network route; A3 and B2 belong to the other packages.)
2. For B1: your host name without `https://`, the SMTP server, port (Enter for 465), login, the authorized
   sender address and the SMTP password (hidden while you type).
3. `Your own future MK8DX administrator email:` the address you will sign in with.
4. The menu: choose **1** for first setup. It starts the database, applies every migration of the catalog,
   adds the two reference sets and starts the website and API. The first run takes a few minutes.

Each later run of `sh tooling/start-mk8dx.sh <installation directory>` shows the same menu once:

| Choice | Does |
| --- | --- |
| 1 | first setup, or resume an interrupted one |
| 2 | start |
| 3 | status (prints the website address and, for A1, the local mail inbox) and the container state |
| 4 | stop (keeps all data) |
| 5 | make the saved administrator address the first administrator (after its first sign-in) |
| 6 | backup to `$HOME/mk8dx-backups/<UTC time>` |
| 7 | update: verified backup first, then pending migrations, then the new images |

### Become the administrator

1. Open the website address (B1: `https://<your host name>`, A1: the `origin` shown by choice 3, for example
   `http://127.0.0.1:18080`). For B1, `https://<your host name>/health/ready` should answer `{"status":"ready"}`
   without a certificate warning.
2. Choose **Sign in**, enter the administrator address from the wizard and follow the link in the email
   (B1: your real inbox; A1: the local inbox address shown by choice 3). The link opens the three-step setup
   **Are you already on this website?** directly; let the page finish loading. The administrator does not need a
   Player, so you may answer it now or leave it for later.
3. Run the launcher again and choose **5**. Expect `created` (a repeat says `unchanged`). Refresh the website:
   the account menu now has **Administration**.

The first person to sign up never becomes an administrator automatically, and the first-administrator step
works only once per installation. See [Operations](../OPERATIONS.md) for the bounded recovery procedure.

### Daily operation

- **Backups**: choice 6, then check the folder with
  `python3 tooling/lifecycle.py verify --backup "$HOME/mk8dx-backups/<folder>"` (expect `Backup verified`).
  Copy the whole folder to protected storage off the server. It contains the database, accounts and keys.
- **Updates**: check the new host package and extract it into a new, empty folder next to the old one (for
  example `/opt/mk8dx/host-new`), then run its launcher with the **same** installation directory and choose 7.
  Keep the old folder until the update has been checked.
- **Change mail or address**: `python3 tooling/install.py change-smtp|change-origin ...`, then `apply` and
  `check`, from the package folder; the user guide's settings chapter has the exact commands.
- **Restore**: `python3 tooling/lifecycle.py restore-new --backup <folder> --state-dir <new directory>` creates a
  separate new installation from a verified backup; see the user guide's backup chapter.
- Never run `docker compose down -v` on an installation you want to keep: `-v` deletes the database volume.
  It belongs only in [Remove an installation](#remove-an-installation).

### Remove an installation

To throw away a trial installation (or one you have migrated away from), work from its package folder with the
same installation directory. This **deletes the database, the accounts and the keys** of that installation;
make a backup first (choice 6) if there is anything you may want back.

1. Run the launcher and choose **3**: note the `route` (A1, A2 or B1). Then run it again and choose **4** to stop.
2. Remove the containers, the network and the volumes (the database, and for A2/B1 the certificates). Use the
   Compose file that matches the route: `compose.local.yaml` for A1, `compose.lan.yaml` for A2,
   `compose.production.yaml` for B1.

   ```sh
   cd /opt/mk8dx/host
   state=/var/lib/mk8dx/instance
   docker compose --env-file "$state/compose.env" -f compose.yaml -f compose.local.yaml -f compose.images.yaml down -v
   ```

3. Remove the installation directory: `rm -rf "$state"` (the directory holds keys and passwords; delete it only
   after step 2, which needs its `compose.env`).
4. Remove the images if no other installation on this machine uses them. `PACKAGE_MANIFEST.json` in the package
   folder lists them:

   ```sh
   docker image rm $(python3 -c 'import json; print(" ".join(json.load(open("PACKAGE_MANIFEST.json"))["images"]))')
   ```

   Docker refuses to remove an image that a container still uses; `mysql` and `axllent/mailpit` may also belong
   to other projects.
5. Delete the package folder (`/opt/mk8dx/host`) and any backups you no longer need.

**On Windows** (A1 or A2 with Docker Desktop) the steps are the same in PowerShell. The installation directory
is `%LOCALAPPDATA%\MK8DX\Server` unless you chose another one; open PowerShell in the extracted package folder:

```powershell
$state = Join-Path $env:LOCALAPPDATA 'MK8DX\Server'
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml -f compose.images.yaml down -v
Remove-Item -LiteralPath $state -Recurse -Force
docker image rm (Get-Content PACKAGE_MANIFEST.json -Raw | ConvertFrom-Json).images
```

Use `compose.lan.yaml` instead of `compose.local.yaml` for A2. Then delete the package folder and any backups
in `Documents\MK8DX-backups` that you no longer need.

An installation built from source is removed the same way from the repository root; see
[Operations](../OPERATIONS.md#remove-an-installation).

### What has been tested on Linux

- Demonstrated on 2026-11-02 on a Linux Docker Engine 28.5 host (Alpine Linux in a privileged Docker-in-Docker
  container, not Ubuntu), with a host package built from this repository by `tooling/release/host_bundle.py`:
  the launcher loaded the image bundle; the wizard (A1) and choice 1 set up the database, migrations and
  reference sets; choice 3 reported ready; the website and `/scanner/` answered; a magic-link sign-in in a real
  browser followed by choice 5 gave `created`, then `unchanged`; choice 6 made a backup that
  `lifecycle.py verify` accepted; choice 7 updated with a verified backup; and `lifecycle.py restore-new` started
  a second, restored installation. The [source route](../GETTING_STARTED.md#linux-and-macos-variant) ran on the
  same host through sign-in and the first administrator.
- Not demonstrated: B1 with a real domain, certificate and mail provider, and Ubuntu itself. Container success
  does not prove DNS, TLS or mail delivery: sign in with your own address to check them.

## The other routes

- **Windows (A1, A2, A3)**: double-click `Start-MK8DX.cmd`, `Start-MK8DX-LAN.cmd` or `Start-MK8DX-No-Docker.cmd`
  in the extracted package; the same wizard and menu appear. Follow chapters 1-3 of the user guide.
- **Shared hosting (B2)**: chapter 4 of the user guide (upload over SSH, `python3 tooling/install.py wizard`,
  `setup`, `passenger-config`, then start the Node.js app in your hosting panel). Any hosting plan with Node.js
  (Passenger), MariaDB/MySQL and SSH fits; the chapter uses mijn.host Starter as its worked example.
- **Building the A3 and B2 packages from a clone**: `tooling/release/non_docker_bundle.py` makes both ZIPs, on
  Windows (it calls `npm.cmd`). First build the API and website (`npm ci` and `npm run build` with
  `--prefix backend/api` and `--prefix apps/timetrials-web`) and the browser scanner as in
  [Client builds](../CLIENT_BUILDS.md#browser-scanner-and-web-image). Then run
  `python tooling/release/non_docker_bundle.py --output-dir <existing folder outside the repository>
  --mailpit-archive <Mailpit Windows amd64 ZIP> --mariadb-archive <mariadb-11.4.13-winx64.zip> --revision <r>`.
  The MariaDB ZIP must be the official 11.4.13 download (the script checks its SHA-256); the Mailpit ZIP must
  contain `mailpit.exe` and `LICENSE`.
- **macOS**: an Intel Mac can try the A1 host package with Docker Desktop for Mac and the same shell launcher;
  Apple Silicon needs amd64 emulation. This is untested; see the user guide's macOS chapter.
- **From source**: [Getting started](../GETTING_STARTED.md) builds the images from a clone (Windows and Linux).

## After installation

- Tell your players the exact website address. They sign in with an email link; nothing else is needed for the
  website. See [Players](PLAYERS.md).
- The Android app, LiveTrial and the Tournament tools ask for that address once. Android needs a trusted HTTPS
  address (B1 or B2); a local A1 address works only for Windows clients on the same computer.
- The website's **Get the app** page lists app downloads only when the server operator has configured a
  download folder; the installer does not set one up. Point players to the GitHub release instead.
- Tournament Directors: an administrator approves their **Request to host** or adds them under
  Administration → Tournaments → Tournament operators. See [Tournament Directors](TOURNAMENT_DIRECTORS.md).
- Security problems: [SECURITY.md](../../SECURITY.md). Keep the installation directory, backups and sign-in links
  out of issues.
