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
| B2: `install/B2_WEBHOSTING_EN.md` / `B2_WEBHOSTING.md` | Chapter 4 gives the complete shared-hosting installation and update; chapter 8 includes separate database users, backups and the email confirmation fallback. Chapter 9 in all 15 languages now points operators to the B2 reference for large-download limits, temporary resumable links and optional Web Push with their own VAPID keys. | **Detailed configuration remains EN/NL.** The short translated pointer identifies when the reference is needed; the B2 and settings pages remain the source for exact values and apply steps. |
| Clients: `install/CLIENTS_EN.md` / `CLIENTS.md` | Chapter 6 in all 15 languages now explains later LiveTrial connection, video reprocessing for another server, assigning runs recorded without an account and how “Send now” retains each run's original account. The translated Player, LiveTrial and Tournament Director role guides also cover daily use. | **No remaining self-service gap for these two recovery cases.** The dedicated Clients page retains further detail. |
| Administration: `install/ADMINISTRATION_EN.md` / `BEHEER.md` | Chapters 7–8 cover menu actions, verified backups, automatic backup, restore, update, first administrator, site settings and dangerous-action email confirmation. | **No essential everyday gap.** The dedicated page gives more diagnostic detail, such as `backup-status` failure handling (§ “Automatic daily backup”) and checks of `/health/ready`, `/client-config.json` and mail (§ “Admin and problems”). Put a short diagnostic pointer in all-language chapter 9; keep the long operator reference EN/NL until demand warrants translation. |
| Settings: `install/SETTINGS_EN.md` / `INSTELLINGEN.md` | Chapter 7 explains the private profile, derived files, data folders, address and SMTP changes, and the difference between administrator and mail identities. Chapter 9 now points to the technical settings reference when optional B2 download-link or Web Push settings are needed. | **Detailed optional settings remain EN/NL.** The translated guide gives the route to the reference without duplicating values that operators must check against their host. |
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
2. Keep the chapter 6 LiveTrial recovery explanation and chapter 9 B2 optional-feature pointers aligned
   across all 15 reading guides when those workflows change. The detailed B2 instructions remain relevant
   only if the hosting provider limits large application responses or optional Web Push is enabled.
3. Keep EN/NL technical references linked from the full guide for operators who need their exact commands.
