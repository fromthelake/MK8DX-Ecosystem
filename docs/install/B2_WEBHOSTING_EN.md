# B2 — shared web hosting with Node.js and MariaDB

Nederlands: [B2_WEBHOSTING.md](B2_WEBHOSTING.md)

This route is for shared web hosting with Node.js/Passenger, MariaDB, a mailbox and SSH; the guide uses mijn.host Starter as a worked example. It has its own upload package `mk8dx-mijnhost-node-<version>.zip`; despite that name it works with any shared Node.js hosting with SSH. mijn.host is the tested example, and SSH port 26 in `ssh -p 26`/`scp -P 26` is that provider's port: elsewhere, use your own host's SSH port. The ordinary Dutch and English step-by-step plan is in `MK8DX_Handleiding_NL.docx`/`.txt` and `MK8DX_User_Guide_EN.docx`/`.txt`. This file is technical reference, not an extra installation requirement.

The package contains the same built API, Web, scanner, internal runtime assets, all migrations from the catalogue, two reference seeds, central installer and administration tooling as the other routes. The existing `passenger-hosted-main.js` is the startup file. `operator-profile.json` and `secrets.json` live in a private folder outside the app and `public_html`; `passenger-config` derives `mk8dx-hosted.env.json` in the private Application root. The API serves the website, `/scanner/`, `/assets/` and `/client-config.json` through closed route inventories. `/.well-known/assetlinks.json` stays an exact JSON path. Unknown routes do not fall back to HTML.

Node 24 and Python 3.9+ are needed for the current package route. Production dependencies are installed with `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in `api` inside the Node environment activated by DirectAdmin. The database check requires a measured MariaDB 11.4+ or MySQL 8.4+, an empty database of your own and a restricted user. The usual mailbox route uses implicit TLS on SMTP 465. A real Starter account may have other versions or limits.

The route needs no Docker, VPS root, PHP application, extra PM2 service or mobile build on the host. It can be verified locally with a Linux/Node/MariaDB fixture. An installation in your own DirectAdmin account, real DNS/TLS/SMTP, exact provider quotas and upload limits remain external acceptance. The user edits no `.env` or source code.

Administration goes through the same `tooling/install.py` entry point: `wizard`, `check-database`, `setup`, `check`, `passenger-config`, `admin`, `backup`, `verify-backup`, `restore-wizard` and `upgrade`. Backups contain a DB dump plus the profile, keys and private runtime config. `upgrade` first requires and verifies a new backup. A restore goes to a new empty database on the same engine/version series and a separate private installation folder; a later real domain switch is not a local test action. An existing admin is never replaced automatically on a repeat or restore.

## Separate database accounts

Give the website a database user of its own that can only read and write rows. Then even SQL that reached the
database through some future bug cannot drop, alter or empty tables, or hand out rights. MK8DX uses two users:

- **the first user**, with all privileges on the MK8DX database (the user DirectAdmin creates with the database):
  only for database updates (`setup`, `upgrade`), the reference data, backups and restores;
- **a second user for the website** with only `SELECT`, `INSERT`, `UPDATE` and `DELETE` on the same database. Only
  this login goes into `operator.json` and the Passenger configuration (`mk8dx-hosted.env.json`).

Create the second user in the panel, next to the first:

- **DirectAdmin**: Account Manager → MySQL Management → open the MK8DX database → create (add) a user for it, then
  open that user's privileges (Modify Privileges) and leave only SELECT, INSERT, UPDATE and DELETE ticked.
- **cPanel**: Databases → MySQL Databases → Add New User, then Add User To Database (the MK8DX database) and tick
  only SELECT, INSERT, UPDATE and DELETE.

The wizard asks for both users (Enter at the second question keeps one user). Without a second user everything
keeps working, but `setup`, `upgrade` and `check` print a clear warning. For an existing installation: create the
second user, then run `python3 tooling/install.py database-accounts --state-dir "$HOME/mk8dx-private"`. It asks for
the user and its hidden password, signs in with it, refuses a user that can still change tables (it names the extra
privileges), and only then switches; the first user stays stored in the private `migration.json` for updates and
backups, so you never lose access. Run `passenger-config` and restart the app in DirectAdmin afterwards. Undo with
`database-accounts --undo` (then `passenger-config` and a restart again). Non-interactive: `--runtime-db-user` and
`--runtime-db-password-file`, also for `init --mode shared`. `status` shows `"databaseAccounts": "separate"`.
Passwords are stored like the other secrets (owner-only files outside `public_html`) and never printed.

## Confirming dangerous actions by e-mail

Changing rights, linking accounts to Players directly, the installation settings, recalculating ratings, removing or reopening a night and the list of all accounts ask the signed-in session for a fresh single-use link to its own address (10 minutes; `MK8DX_HOSTED_STEP_UP_WINDOW_SECONDS` in `operator.json`, 60–3600, default 600). That needs the mailbox SMTP to keep working (`python3 tooling/install.py change-smtp --state-dir "$HOME/mk8dx-private"`). When mail fails, press **Send the link** anyway and, within 10 minutes, run over SSH `python3 tooling/install.py step-up-link --state-dir "$HOME/mk8dx-private"` (add `--admin-email <address>` for another account) in the activated Node environment. It prints a new single-use link for that one waiting request; open it and press **Confirm this action**. It runs only on the host, has no web route and is recorded ([details](../OPERATIONS.md#when-e-mail-fails-confirm-a-dangerous-action-from-the-server)).

## Automatic daily backup

`setup` asks once whether MK8DX should make its own checked backup every night (Enter = yes). It costs about
3 MB a day compressed; 14 daily and 4 weekly backups are kept in `~/mk8dx-backups/automatic`, outside
`public_html`, at most 1 GB in total, owner-only. It is one marked line in your own crontab (DirectAdmin →
Advanced Features → Cronjobs shows it too); other cron jobs are left alone.

**Does your host already make daily account backups** (for example DirectAdmin's own backups or JetBackup)? Then
you may say no. Ask your provider, or look in the panel for "Backups"/"JetBackup": how many days are kept, does it
include the databases and the folders outside `public_html`, and can you restore one yourself? An own backup still
helps: you restore yesterday yourself in minutes, including the site's keys (without them stored results cannot
be read), independent of the support desk, and after someone damaged the site on purpose. Turn it off later with
`python3 tooling/install.py backup-unschedule --state-dir "$HOME/mk8dx-private"`, on again with `backup-schedule`.
`python3 tooling/install.py status` shows the age and result of the last run under `automaticBackup`; the host
mails you the output of a failed run. Pull a copy to your own PC regularly; the commands are in
[Operations](../OPERATIONS.md#automatic-daily-backup-a1-a2-b1-a3-b2). An update (`upgrade`) keeps it and points it
at the new application folder.

## App downloads on hosts that limit application responses

The website's **Get the app** page serves the files listed in `downloads.json` in the folder named by `MK8DX_HOSTED_APP_DOWNLOAD_ROOT` (outside `public_html`), only to signed-in accounts. By default the API streams each file itself. Shared LiteSpeed/Passenger hosting may refuse such a large application response (a 500 MB APK) and show its own short error page instead. For those hosts, switch on short-lived static links: the signed-in request is answered with a redirect to a link that the web server serves itself, with resumable downloads. Add these keys to `operator.json` in the private installation folder, run `python3 tooling/install.py passenger-config` and restart the app in DirectAdmin:

| Key | Value |
| --- | --- |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT` | the absolute document root, e.g. `/home/<user>/domains/<domain>/public_html` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY` | an absolute folder inside it for the links, e.g. `…/public_html/dl` (created when missing; never a symlink) |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_URL_PATH` | optional: the public path of that folder; default derived from it, e.g. `/dl` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_TTL_SECONDS` | optional: link lifetime, 60–86400 seconds; default `600` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_MAX_LINKS` | optional: most live link folders at once, 1–20000; default `2000` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_PROBE` | optional: `false` skips the startup self-check described below |

A download creates `<folder>/<expiry>-<64 hex>/<file name>` as a symbolic link (a hard link where symlinks are refused) to the stored file, next to a small `.htaccess` that the API writes first. One signed-in account gets the same link for the same download for a while, so repeated clicks do not create folders; a link stays usable for between half and the whole lifetime. Beyond `…_MAX_LINKS` live folders, a new download is answered with "try again in a few minutes" (503 with Retry-After), and one account may start 60 downloads an hour (429 beyond that).

**How expiry is enforced.** The `.htaccess` in each link folder refuses every request (403) once the web server's clock passes that folder's expiry, so an expired link stops working at the web server even while the Node app is idle or stopped by Passenger. A download that already started finishes; resuming it after the expiry is refused, and a new click on **Get the app** gives a fresh link. Apache 2.4 was tested locally (whole file, HTTP Range, refusal after expiry with the API idle, no listing); LiteSpeed applies the same `.htaccess` rewrite rules but was not tested here. The web server and the Node app must use the same time zone (the normal case on one host). Independently, the API removes expired folders at startup and about once a minute while it runs (a bounded sweep, logged as `app_download_links_swept`); it only ever removes folders with exactly that name pattern and never the stored file.

**Startup self-check.** After starting, the API asks the web server through the public address for an already expired and a valid probe link and logs `app_download_link_expiry_probe` with `enforced`, `not_enforced`, `clock_mismatch`, `rules_rejected` or `unreachable`. Anything but `enforced` means the honest maximum lifetime of a link is the lifetime plus about one minute while the app runs, and **until the app's next start** when Passenger has stopped it; then fix the host (allow `.htaccess` rewrite rules for the folder, align the time zone) or turn the mode off.

The web server must serve existing files in that folder itself (follow symlinks owned by the same user). The API writes an empty `index.html` into the link folder so that it never lists its contents; `Options -Indexes` for the document root is still recommended. An incomplete or unsafe setting (including a download folder inside the link folder) stops the start with its reason. Without these keys nothing changes.

## Browser notifications (Web Push)

Browser notifications stay off until `MK8DX_HOSTED_WEB_PUSH_SUBJECT`, `MK8DX_HOSTED_WEB_PUSH_PUBLIC_KEY` and `MK8DX_HOSTED_WEB_PUSH_PRIVATE_KEY` (the operator's own VAPID key pair) are set together in `operator.json`. The server then delivers only to the push services of the supported browsers: `fcm.googleapis.com` (Chrome, Edge on Android, Opera, Samsung Internet), `updates.push.services.mozilla.com` (Firefox), `web.push.apple.com` (Safari) and `*.notify.windows.com` (Edge on Windows). The optional `MK8DX_HOSTED_WEB_PUSH_EXTRA_PROVIDER_HOSTS` adds other push services you trust, as comma-separated host names (`push.example.org`; `*.push.example.org` for its subdomains); IP addresses, ports and paths are refused. Every delivery goes to port 443, checks the TLS certificate for that name, connects only to public addresses that the server resolved and checked itself, and never follows a redirect. A browser that offers another push service is told that it is not accepted by this installation.

Limits: at most 10 active browsers per account (a new one replaces that account's least recently registered one); 30 register or remove actions per account per hour (then `429` with `Retry-After`); 10 seconds and 16 KiB of response per delivery request; 4 browsers served at the same time; retries after 1, 5, 30 and 120 minutes, given up after 5 attempts. A browser whose deliveries fail permanently three times in a row without any success is unsubscribed, and unsubscribed browsers are deleted after 30 days. Where your host allows it, an outgoing firewall that blocks private networks for the app is a useful second line of defence.

Sources for current panel names and provider capabilities (in Dutch): [Node.js app in DirectAdmin](https://mijn.host/kb/web-apps/node-js-applicatie-draaien-op-je-hostingpakket), [Starter overview](https://mijn.host/webhosting), [SSH](https://mijn.host/kb/webhosting/verbinden-met-ssh), [Let's Encrypt](https://mijn.host/kb/webhosting/lets-encrypt-ssl-certificaat-aanvragen).
