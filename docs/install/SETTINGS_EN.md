# Settings guide — one input per meaning

Nederlands: [INSTELLINGEN.md](INSTELLINGEN.md)

The **authoritative installation input** is kept per installation in `operator-profile.json` and `secrets.json` inside one **private data folder**. The wizard fills them. `api.env`, `operator.json`, `compose.env` and `public-client.json` are derived files for existing consumers; do not edit them separately. The public `https://<website>/client-config.json` contains only `schemaVersion` and `websiteOrigin`, no server secret or admin address.

| Item and actual field name | Who/where | Example form | Where it ends up and how you check |
| --- | --- | --- | --- |
| Route `route` | You in the wizard: A1/A2/A3/B1/B2 | `B2` | Private profile; `install.py status` shows the route. Another route is a separate installation unless an explicit migration is carried out later. |
| Main address `origin` | A1 automatic; A2 package (route `A2_OFFLINE`) `https://<IP-adres van de host>`; older A2 variant with its own mail server a private name; A3 local Apache address; B1/B2 you give the DNS host | `https://www.example.org` | API `MK8DX_HOSTED_AUTH_BASE_URL`, trusted origins, public client config and links. A2 and B1 also use Caddy `MK8DX_DOMAIN` (the host name or IP address from that address). |
| Project `project`, DB volume | Generated at random once | `mk8dx-os-…` | A1/A2/B1 use a Docker project and database volume. A3/B2 keep the same project identity in their profile and use their own MariaDB outside Docker. |
| Web port `httpPort`, bind address `bindAddress` | A1 a free loopback port; A2 the chosen LAN IP/443; B1 80/443 by default; A3 fixed Apache loopback port 18090; B2 HTTPS at the provider | `127.0.0.1:18090` | Only the Docker routes use `compose.env`. A3 uses a narrow Apache forwarding rule and its own Node/MariaDB processes; B2 uses Passenger. |
| First admin `adminEmail` | You, once, in the wizard; **not** the SMTP login | `eigenadres@example.org` | Private profile; menu 5 passes it via stdin to the administration CLI **after** a real magic-link sign-in. A first sign-up alone grants no role. |
| SMTP `smtp.host`, `.port`, `.secure`, `.username`, `.fromAddress` | A1 Mailpit automatically; A2/B1 from your own mail provider | `mail.example.org`, `465`, `true`, `mailbox@example.org`, `noreply@example.org` | API runtime. Port 465 uses implicit TLS. `username`, sender and admin are functionally different addresses. |
| SMTP password `MK8DX_HOSTED_SMTP_PASSWORD` | You type it hidden in the wizard; with CLI init `--smtp-password-file` is possible | never in an example or screenshot | Private `secrets.json` and runtime `operator.json`; `api.env` keeps it as base64 for safe Compose parsing. Base64 is **not encryption**. No public client or image contains it. |
| Database secrets/cryptographic keys | MK8DX generates them once; the B2 database password comes from DirectAdmin | no manual value in source code | `secrets.json` plus derived runtime files; they stay the same on repeats and updates. A3 uses a separate bundled MariaDB 11.4.13 because XAMPP MariaDB 10.4.32 is too old. |
| Database accounts: runtime login `MK8DX_HOSTED_MYSQL_USER`, migration login in `migration.json` | A1–A3: MK8DX creates `mk8dx_runtime` (website) and keeps `mk8dx_app` for updates (A3 also `mk8dx_backup`); B2: you create a second, limited user in the panel | `mk8dx_runtime` | The website's login may only read and write rows; database updates, reference data and backups use the other login. Passwords in `secrets.json` (`MK8DX_HOSTED_MYSQL_PASSWORD`, `MK8DX_MIGRATION_MYSQL_PASSWORD`, A3 also `MK8DX_NATIVE_BACKUP_MYSQL_PASSWORD`), never printed. `status` shows `"databaseAccounts": "separate"`; B2: `install.py database-accounts` ([details](../OPERATIONS.md#database-accounts)). |
| Optional server settings: `MK8DX_HOSTED_STEP_UP_WINDOW_SECONDS`, `MK8DX_HOSTED_SMTP_TIMEOUT_MS` (one mail attempt, 1000–60000 ms, default 5000), `MK8DX_HOSTED_BUDGET_*`, `MK8DX_HOSTED_WEB_PUSH_EXTRA_PROVIDER_HOSTS`, `MK8DX_HOSTED_APP_DOWNLOAD_LINK_*` | Only when you need a different value; nothing is required | `MK8DX_HOSTED_STEP_UP_WINDOW_SECONDS=600` | Docker routes: a line in `api.env`, then `install.py apply`; A3/B2: a key in `operator.json` (B2 then `passenger-config` and a restart). An unknown `MK8DX_HOSTED_BUDGET_*` name or an invalid value stops the start with its reason. The administration page's **Request limits** section shows the values in use and what was refused lately. Defaults and ranges: [budgets](../architecture/MUTATING_ROUTES.md#installation-budgets), [step-up](../architecture/MUTATING_ROUTES.md#fresh-confirmation-step-up), [push and download links](B2_WEBHOSTING_EN.md#browser-notifications-web-push). |
| Internal database host `MK8DX_HOSTED_MYSQL_HOST` | Automatically `mysql` in Docker; A3 `127.0.0.1:18306`; B2 as given by DirectAdmin | `localhost:3306` | Server use only. Do **not** use it as a website address or DNS record. B2 requires a measured MariaDB ≥11.4 or MySQL ≥8.4 before migrations. |
| DNS, VPS SSH, provider password | External provider action, never in the MK8DX profile | A record `www → VPS-IPv4` | DNS portal, WinSCP/SSH. See [B1](B1_VPS_EN.md). The provider determines the actual user name, port and host key. |
| Android/LiveTrial server | You choose the **public URL** on each device; no server secret | `https://www.example.org` | Android first screen/Settings; LiveTrial Settings. Sessions and waiting results are stored separately per server. |
| Android App Links certificate fingerprint | The APK signer, separately | no fixed example fingerprint | Only for a tested link between the real certificate and your domain. By default `assetlinks.json` is `[]` and JSON; the release APK claims no arbitrary domain. The private signing key stays outside a shared installation. |

## Exact folders and precedence

**Windows A1:** `%LOCALAPPDATA%\MK8DX\Server` by default; **Windows A2:** `%LOCALAPPDATA%\MK8DX\LAN`; **Windows A3:** `%LOCALAPPDATA%\MK8DX\NoDocker`; **Ubuntu B1:** `/var/lib/mk8dx/instance`; **B2:** `$HOME/mk8dx-private`. Another folder is a separate installation. The A3 and B2 package folder is outside that private data folder. For B2, `mk8dx-hosted.env.json` is also in the private Passenger Application root outside `public_html`; the installer derives that file from `operator.json`.

The precedence is: (1) the wizard/explicit `change-origin` action writes the private profile; (2) the installer derives the runtime files from it; (3) Compose reads only the saved `compose.env`, without `COMPOSE_*`/`MK8DX_*` shell overrides from the calling user. Separate edits to runtime files are reported as a conflict by `status` or are outside the contract. Do not keep private values in Git, `public_html`, screenshots, emails or support logs. On Linux new files/folders get mode 0600/0700; on Windows the folder is under your own user profile. Local files are not encrypted automatically; protect the user account and the backup media.

## Changing one address

**Where:** PowerShell in the extracted package folder, or SSH in `/opt/mk8dx/host`. **Do:** first make [a backup](ADMINISTRATION_EN.md), then run for example:

```powershell
python tooling/install.py change-origin --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Server') --origin 'http://127.0.0.1:18090'
python tooling/install.py apply --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Server')
python tooling/install.py check --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Server')
```

For B1 replace the example origin and state dir with your exact `https://…` and `/var/lib/mk8dx/instance`, using `python3`. `change-origin` validates first and replaces only the relevant derived files; `apply` restarts the API/Web with the same project and database volume. **You see:** `status` and `/client-config.json` show the same new address, and new sign-in links use it. **If it differs:** do not blindly start a second installation. DNS and TLS must already fit the new address; existing browsers/Android/LiveTrial must connect to the correct address again.

## Changing mail provider or mail password

**Where:** first in your mail provider's portal, then in PowerShell in the extracted host folder (A2) or SSH in `/opt/mk8dx/host` (B1). **Do:** write down the real SMTP host, port **465 with implicit TLS**, SMTP login, allowed sender address and the new mailbox password. First make a private backup with menu **6**. On Windows open PowerShell from the host folder and for A2 run:

```powershell
python tooling/install.py change-smtp --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\LAN')
python tooling/install.py apply --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\LAN')
python tooling/install.py check --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\LAN')
```

On the VPS, in the SSH window, use `python3 tooling/install.py change-smtp --state-dir /var/lib/mk8dx/instance`, then the same command with `apply` and with `check`. The input asks, by technical field name, for `smtp.host`, `smtp.port`, `smtp.username`, `smtp.fromAddress` and the hidden `MK8DX_HOSTED_SMTP_PASSWORD`; Enter keeps the existing value, also for the password. **You see:** the status with the new SMTP host, without the password. Then request a **new** sign-in mail with your own account and check that it arrives in the real inbox. **If it differs:** check the provider values and the allowed sender; correct the values with the same `change-smtp` action. A successful `check` only proves that the services are running, not that mail is delivered. The action keeps the project, accounts, admin and volume.

## What stays separate and why?

- **Mailbox versus admin:** SMTP is the transport; the admin address is a verified MK8DX user. The SMTP secret stays on the host, never in an APK.
- **Provider host versus public domain:** a VPS IP is for SSH/DNS; the domain is for visitors. `mysql` can only be reached inside Docker.
- **Clients:** each device keeps its own sign-in. Switching servers asks for confirmation; earlier results do not go to the new community automatically.
- **Signing and App Links:** a certificate fingerprint belongs to the specific signed APK. Even the generic release APK cannot prove a real association in advance for an arbitrary domain.
- **Backup location:** choose another storage medium outside the server; the app cannot guess the external destination. The backup contains real secrets and accounts and must stay private.
