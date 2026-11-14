# Day-to-day administration, updates and restoring

Nederlands: [BEHEER.md](BEHEER.md)

Always use **the same private data folder**. On Windows A1 that is `%LOCALAPPDATA%\MK8DX\Server` by default, on A2 the separate `LAN` folder from the guide, on B1 `/var/lib/mk8dx/instance`. A folder with only software can be replaced; the data folder and the Docker volume cannot. Menu **3 status** shows route/address/project without secrets. `docker compose down -v` is not a stop command: `-v` deletes the database volume.

## Stopping, starting and checking

**Windows:** open Docker Desktop, go to the extracted host folder in File Explorer and double-click `Start-MK8DX.cmd` (A1) or `Start-MK8DX-LAN.cmd` (A2). Choose **2** to start, **3** for status, **4** to stop. **You see:** the same `project` identity, no new setup wizard. **If it differs:** check Docker Desktop and the correct data folder; do not make a new folder to get around a port or mail error.

**Ubuntu VPS:** connect as in [B1](B1_VPS_EN.md), run `cd /opt/mk8dx/host` and `sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance`; choose from the same menu. **You see:** the existing project. When the server restarts, containers with `restart: unless-stopped` start after Docker; still check the website, mail and storage. A laptop in sleep mode or a switched-off VPS is temporarily unreachable.

## The start window: display and options

Every start window opens like the start of a race: a coloured MK8DX logo, a 3-2-1-GO countdown with beeps, the
checks as laps with a race clock and a finish with the lap times. That applies to `Start-MK8DX.cmd`,
`Start-MK8DX-LAN.cmd` (also behind the desktop shortcut **MK8DX beheer**), `Start-MK8DX-No-Docker.cmd`,
`Manage-MK8DX-No-Docker.cmd` and `tooling/start-mk8dx.sh`. Only the display differs; steps, menu and messages
are the same. In a terminal with modern colours (Windows Terminal, the Windows 10/11 console, a Linux/macOS
terminal with UTF-8 and 256 colours) the rich display is on by default, with sound. When the output goes to a file,
you get plain text.

| What you want | Windows | Linux and macOS |
| --- | --- | --- |
| Skip the countdown (it is on by default) | `Start-MK8DX.cmd -SkipCountdown` (all four `.cmd` files), or `MK8DX_SKIP_COUNTDOWN=1` | `sh tooling/start-mk8dx.sh --skip-countdown [installatiemap]`, or `MK8DX_SKIP_COUNTDOWN=1` |
| Plain text | `-Plain`, `MK8DX_PLAIN=1` or `NO_COLOR=1` | `--plain`, `MK8DX_PLAIN=1` or `NO_COLOR=1` |
| Without sound (on by default) | `MK8DX_SOUND=0` | `MK8DX_SOUND=0` |
| Force the rich or classic display | `MK8DX_RICH=1` / `MK8DX_RICH=0` | `MK8DX_RICH=1` / `MK8DX_RICH=0` |
| Look without starting anything | `powershell -NoProfile -File tooling\mk8dx-ui.ps1 -Demo` | `sh tooling/mk8dx-ui.sh --demo` |

To keep a choice: on Windows `setx MK8DX_SKIP_COUNTDOWN 1` (applies to windows you open afterwards), on Linux/macOS
`export MK8DX_SKIP_COUNTDOWN=1` in `~/.profile`. For the **MK8DX beheer** shortcut you can also put
` -SkipCountdown` after the target in its properties. On Linux and macOS the sound is the terminal bell; the terminal decides whether you
hear it.

## Private backup: make, verify, copy away

**Where:** in the same menu, choose **6**. The helper uses the saved profile and makes a new backup folder with a MySQL dump, runtime config, secrets and a manifest with SHA-256. Windows writes under `Documents\MK8DX-backups\<timestamp>`, Ubuntu under `~/mk8dx-backups/<timestamp>`. **You see:** `Backup complete`. Verify a backup on Windows in PowerShell:

```powershell
python tooling/lifecycle.py verify --backup "$env:USERPROFILE\Documents\MK8DX-backups\<ECHTE_MAPNAAM>"
```

Replace `<ECHTE_MAPNAAM>` with the folder name that was actually created; use the complete folder, not just the `.gz` file. On Ubuntu the equivalent is `python3 tooling/lifecycle.py verify --backup '/root/mk8dx-backups/<ECHTE_MAPNAAM>'`. **You see:** `Backup verified` with route A1/A2/B1. **If it differs:** keep the failed copy private, make a new backup and investigate the error before you update. Also keep a copy on another, protected medium; a backup on the same broken VPS is no recovery plan. The backup contains accounts, database, admin status and all keys; never share it in an issue, email or public cloud link. The Caddy certificate volume stays in place during normal updates on the same host; a separately restored B1 project requests a new certificate at the eventual DNS cutover.

## Restoring without wiping the current installation

**Goal:** check a backup in a **new** data folder and with a **new** Docker project. The helper refuses an existing target folder. On Windows, in PowerShell from the host package:

```powershell
python tooling/lifecycle.py restore-new --backup "$env:USERPROFILE\Documents\MK8DX-backups\<ECHTE_MAPNAAM>" --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Herstelproef')
python tooling/install.py status --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Herstelproef')
```

**You see:** verified files, an imported database and a **different** project. A1 gets free new loopback ports; B1/A2 keeps the intended HTTPS address, but in this trial starts only MySQL, not the public gateway. That way no unexpected second live site or certificate request appears. The original containers, accounts and volumes stay in place. **If it differs:** do not start by wiping or `down -v`; check the checksum, free disk space and whether the new target folder really did not exist yet. On Ubuntu replace `python` with `python3`, and the backup and target paths with `/root/mk8dx-backups/<ECHTE_MAPNAAM>` and `/var/lib/mk8dx/herstelproef`. Actually replacing a public site then needs a planned DNS/port/certificate cutover; only carry it out after the owner has checked the restored data.

## Installing a new software version

**Where:** on the host. **Do:** check the SHA-256 of the **new** host package, extract it next to the old software folder and keep the existing data folder/volumes intact. Start the new package with the same `-StateDir` (Windows) or the same single path argument (Ubuntu). Choose **7 update**. The helper first makes a new backup and verifies it, then runs only the canonical migrations that are still missing and idempotent reference seeds, and replaces the API/Web containers with the included version images. **You see:** the same project name, the same accounts and admin, and then a healthy website. **If it differs:** keep the backup that was made, record the error without secrets, and restore to a separate target if needed. Do not blindly roll back to an older image after the schema has changed. A changed SMTP provider or domain is handled through the [settings guide](SETTINGS_EN.md), not by changing an `.env` line in each package.

**Updating to 0.2.3:** this version moves the Docker database from MySQL 8.4 to MySQL 9.7 LTS. MySQL converts the data files once, at the first start on the new version; only a backup can undo that. So in the new package folder choose **7** first and not **2**: **2** starts the new version without a backup and without the database updates; menu **3** (check) is harmless. With the A2 package, **Update** in the browser makes the backup first by itself.

## Admin and problems

Under Administration → **Installation settings** the **Community name** is at the top (for example "Club Noord"), which the apps show instead of the web address (empty = no name). Below it are three choices for the whole site, each change recorded with the administrator's name: who creates Players, who counts for the rating, and **Times from other communities**. That last one is off by default: a Player who belongs to several communities then cannot carry a time set elsewhere. With *With approval*, every carried time stays out of the public overviews until an administrator makes it public; such times appear under Administration → Time Trials as not public, with a **Publish** button. If you switch *With approval* off while carried times are still waiting, the page asks whether you publish them all (or, with *Off*: refuse them) or leave them waiting. With *Allowed*, a carried time follows the normal publication rules. A carried time always shows where it came from (ADR-0225).

The admin action (menu **5**) only works after signing in through the verified magic link for your own saved target address. The ordinary first registration never grants a role. If the admin address was wrong before the first grant, safely correct the target identity with `python tooling/install.py set-admin-email --state-dir '<jouw gegevensmap>' --admin-email 'eigenadres@example.org'` (with your data folder and your own address), sign in with exactly that address and then choose menu 5. A bootstrap that has already been used is not reopened; the existing limited administrator recovery from [Operations](../OPERATIONS.md) requires an explicitly verified target account and an owner decision.

A home page without a sign-in mail is usually an SMTP problem; A1 has only Mailpit on the host, A2/B1 real mail. `/.well-known/assetlinks.json` must deliver `application/json` with `[]` (or later a correct association document of your own), not HTML. `/client-config.json` must show only the public server address. `/health/ready` checks the API/database, but does not prove inbox delivery or a physical client connection. When something fails, look first at the safe menu status and the applicable route guide. Never share private env/config/log lines with tokens or passwords.
