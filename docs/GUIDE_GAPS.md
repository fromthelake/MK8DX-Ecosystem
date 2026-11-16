# Guide coverage gaps after the 15-language reading guide

This is a content audit, not another installation guide. The comparison source is
`install/MK8DX_User_Guide_EN.txt` (chapters 1–11), whose Dutch and 13 other language
versions follow the same route structure. The seven guides below currently have only
English and Dutch versions. The new route chooser (`START_HERE_EN.md` / `START_HIER.md`)
is being translated separately. A3 already has a full chapter 2 in the reading guide.

| EN/NL-only family | Covered in the 15-language reading guide | Remaining gap for a reader using another language |
| --- | --- | --- |
| A1: `install/A1_ONE_COMPUTER_EN.md` / `A1_EEN_COMPUTER.md` | Chapter 1 has the complete Windows Docker trial, Mailpit sign-in, first administrator and checksum; chapters 7–8 cover operation, backup and update. | **No essential installation gap.** The shorter A1 page is a convenient route extract. Keep it as an EN/NL quick reference; route other languages to chapter 1. |
| B1: `install/B1_VPS_EN.md` / `B1_VPS.md` | Chapter 5 walks through SSH host-key verification, Docker, DNS, TLS, mail, setup and administrator sign-in; chapter 8 covers backup and recovery. | **No essential installation gap.** The B1 page groups the same actions by stage. Route other languages to chapter 5. |
| B2: `install/B2_WEBHOSTING_EN.md` / `B2_WEBHOSTING.md` | Chapter 4 gives the complete shared-hosting installation and update; chapter 8 includes separate database users, backups and the email confirmation fallback. | **Conditional operator gap:** the B2 reference's “App downloads on hosts that limit application responses” explains a workaround when LiteSpeed/Passenger rejects large downloads. Its “Browser notifications (Web Push)” explains optional VAPID configuration and supported push providers. Neither procedure is in chapters 4 or 7–8. Add short troubleshooting/configuration entries to all-language chapter 9 or a translated operator appendix; keep the detailed configuration in the B2 reference. |
| Clients: `install/CLIENTS_EN.md` / `CLIENTS.md` | Chapter 6 explains APK, LiveTrial, scanner, Tournament Tools, offline import and later LiveTrial connection. The translated Player, LiveTrial and Tournament Director role guides also cover daily use. | **Small workflow gap:** `CLIENTS_EN.md` § “Connect later” says a run recorded under another LiveTrial server must be reprocessed from video, and “Send now” preserves the original account for each queued run. Chapter 6 only states that runs stay with the old server and tells how to assign a run recorded without an account. Add these two sentences to chapter 6 translations if that recovery path must be self-service. |
| Administration: `install/ADMINISTRATION_EN.md` / `BEHEER.md` | Chapters 7–8 cover menu actions, verified backups, automatic backup, restore, update, first administrator, site settings and dangerous-action email confirmation. | **No essential everyday gap.** The dedicated page gives more diagnostic detail, such as `backup-status` failure handling (§ “Automatic daily backup”) and checks of `/health/ready`, `/client-config.json` and mail (§ “Admin and problems”). Put a short diagnostic pointer in all-language chapter 9; keep the long operator reference EN/NL until demand warrants translation. |
| Settings: `install/SETTINGS_EN.md` / `INSTELLINGEN.md` | Chapter 7 explains the private profile, derived files, data folders, address and SMTP changes, and the difference between administrator and mail identities. | **Conditional operator gap:** `SETTINGS_EN.md` opening table maps optional request limits, SMTP timeout, Web Push and download-link settings to their exact storage and apply steps. Ordinary users do not need these; translate a compact optional-settings pointer alongside the B2 troubleshooting entry, with the reference as the technical source. |
| Hosting: `guides/HOSTING.md` / `guides/translations/nl/HOSTING.md` | Chapters 1–5 and 10–11 choose and install each supported route; chapters 7–8 cover operation. | **Developer-only gap:** `HOSTING.md` § “Build the host package from a clone” explains a self-built package and image tags. Chapter 9 points to that section and `docs/DEVELOPMENT.md`; no translated end-user setup step is missing. The launcher display options (§ “The launcher window: look and options”) are optional presentation controls. |

## Reachability of role guides

`README.md` § “Get started” links Players, LiveTrial, Tournament Directors and Hosting by task. The
release's general reading guide has the first-use instructions for those roles. That is adequate for a
reader arriving through GitHub or the release page, but it is less convenient once somebody is inside a
community website or an offline A2 package. A future product pass should place contextual help links near
the relevant player, Director and LiveTrial actions, using an offline-local copy for A2. Do not make those
links depend on GitHub for an offline installation. This is a discoverability improvement, not a blocker
for the present documentation release.

## Priority

1. Preserve the existing full translated installation chapters; do not translate seven mostly overlapping
   guides merely to reach language parity.
2. Add the two LiveTrial recovery sentences and a compact B2 downloads/notifications pointer when the
   reading-guide translations are next edited. The B2 instructions are relevant only if those optional
   features are enabled or the hosting provider limits large application responses.
3. Keep EN/NL technical references linked from the full guide for operators who need their exact commands.
