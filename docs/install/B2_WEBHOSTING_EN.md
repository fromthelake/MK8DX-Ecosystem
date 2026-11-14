# B2 — shared web hosting with Node.js and MariaDB

Nederlands: [B2_WEBHOSTING.md](B2_WEBHOSTING.md)

This route is for shared web hosting with Node.js/Passenger, MariaDB, a mailbox and SSH; the guide uses mijn.host Starter as a worked example. It has its own upload package `mk8dx-mijnhost-node-<version>.zip`; despite that name it works with any shared Node.js hosting with SSH. mijn.host is the tested example, and SSH port 26 in `ssh -p 26`/`scp -P 26` is that provider's port: elsewhere, use your own host's SSH port. The ordinary Dutch and English step-by-step plan is in `MK8DX_Handleiding_NL.docx`/`.txt` and `MK8DX_User_Guide_EN.docx`/`.txt`. This file is technical reference, not an extra installation requirement.

The package contains the same built API, Web, scanner, internal runtime assets, all migrations from the catalogue, two reference seeds, central installer and administration tooling as the other routes. The existing `passenger-hosted-main.js` is the startup file. `operator-profile.json` and `secrets.json` live in a private folder outside the app and `public_html`; `passenger-config` derives `mk8dx-hosted.env.json` in the private Application root. The API serves the website, `/scanner/`, `/assets/` and `/client-config.json` through closed route inventories. `/.well-known/assetlinks.json` stays an exact JSON path. Unknown routes do not fall back to HTML.

Node 24 and Python 3.9+ are needed for the current package route. Production dependencies are installed with `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in `api` inside the Node environment activated by DirectAdmin. The database check requires a measured MariaDB 11.4+ or MySQL 8.4+, an empty database of your own and a restricted user. The usual mailbox route uses implicit TLS on SMTP 465. A real Starter account may have other versions or limits.

The route needs no Docker, VPS root, PHP application, extra PM2 service or mobile build on the host. It can be verified locally with a Linux/Node/MariaDB fixture. An installation in your own DirectAdmin account, real DNS/TLS/SMTP, exact provider quotas and upload limits remain external acceptance. The user edits no `.env` or source code.

Administration goes through the same `tooling/install.py` entry point: `wizard`, `check-database`, `setup`, `check`, `passenger-config`, `admin`, `backup`, `verify-backup`, `restore-wizard` and `upgrade`. Backups contain a DB dump plus the profile, keys and private runtime config. `upgrade` first requires and verifies a new backup. A restore goes to a new empty database on the same engine/version series and a separate private installation folder; a later real domain switch is not a local test action. An existing admin is never replaced automatically on a repeat or restore.

## App downloads on hosts that limit application responses

The website's **Get the app** page serves the files listed in `downloads.json` in the folder named by `MK8DX_HOSTED_APP_DOWNLOAD_ROOT` (outside `public_html`), only to signed-in accounts. By default the API streams each file itself. Shared LiteSpeed/Passenger hosting may refuse such a large application response (a 500 MB APK) and show its own short error page instead. For those hosts, switch on short-lived static links: the signed-in request is answered with a redirect to a link that the web server serves itself, with resumable downloads. Add these keys to `operator.json` in the private installation folder, run `python3 tooling/install.py passenger-config` and restart the app in DirectAdmin:

| Key | Value |
| --- | --- |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT` | the absolute document root, e.g. `/home/<user>/domains/<domain>/public_html` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY` | an absolute folder inside it for the links, e.g. `…/public_html/dl` (created when missing; never a symlink) |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_URL_PATH` | optional: the public path of that folder; default derived from it, e.g. `/dl` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_TTL_SECONDS` | optional: link lifetime, 60–86400 seconds; default `600` |

Each download creates `<folder>/<64 random hex>/<file name>` as a symbolic link (a hard link where symlinks are refused) to the stored file. Folders with exactly that name are removed after the lifetime, at every download and at startup; nothing else in the folder is touched. Directory listing must be off for the document root (`Options -Indexes` in `.htaccess`), and the web server must serve existing files in that folder itself (follow symlinks owned by the same user). An incomplete or unsafe setting stops the start with its reason. Without these keys nothing changes.

Sources for current panel names and provider capabilities (in Dutch): [Node.js app in DirectAdmin](https://mijn.host/kb/web-apps/node-js-applicatie-draaien-op-je-hostingpakket), [Starter overview](https://mijn.host/webhosting), [SSH](https://mijn.host/kb/webhosting/verbinden-met-ssh), [Let's Encrypt](https://mijn.host/kb/webhosting/lets-encrypt-ssl-certificaat-aanvragen).
