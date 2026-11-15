# Changelog

All notable changes to MK8DX Ecosystem are recorded here. The first stable public package is
`0.1.0`; earlier `0.1.0-rc.N` tags are release candidates. Dates are in ISO format.

## Unreleased

### Added

- **Live capture delegations in the Android app**: a Director's Step 5/9 view in the app now has the web's panel:
  the night's delegations with their state, **Delegate live capture** for an account whose Tournament Live
  connected to the night (2 hours to 7 days, 12 hours by default), **Revoke**, the *Waiting for the Director*
  wording and a per-run delegation shortcut on a waiting feed, and **Withdraw this live feed** (tap twice) on a
  public one. The native delegation routes now have strict response schemas, like the administrator routes.
- **Administrator view of request limits**: a new **Request limits** section on the administration page (loaded when
  opened) shows which request budgets and quotas refused requests in about the last hour and day, per scope, how many
  were affected, the most refused accounts (only accounts are named; targets, recipients and addresses are counted),
  every `MK8DX_HOSTED_BUDGET_*` value with its default, and how much of each installation budget is used in its current
  window. Refusals are counted in memory (a refused request costs no database write) and flushed every 30 seconds
  into the existing limiter table; no database migration.

### Changed

- **The web delegation panel refreshes by itself**: while the Step 5/9 view is visible it re-reads the night's
  capture delegations about every 30 seconds (paused while the tab is hidden), so a delegation issued, revoked or
  expired elsewhere shows without a reload.
- **A failed step-up e-mail answers quickly and points to the break-glass**: one mail attempt is bounded (new optional
  setting `MK8DX_HOSTED_SMTP_TIMEOUT_MS`, default 5 seconds) instead of waiting minutes on a mail server that is down.
  When **Send the link** cannot mail, the link is still created and the page says so within that time, names
  `install.py step-up-link` and keeps waiting for the confirmation (`503 step_up_mail_unavailable` instead of 500).
  The Android app's confirmation window does the same: it shows the web's message (in every language) instead of
  "The link could not be sent" and keeps waiting until the created link expires.

- **Request budgets are checked by a test instead of a CodeQL heuristic**: a new API test composes the real hosted
  runtime and fails when any mutating route, or a step-up protected read, has no durable request budget and no
  reasoned allowlist entry (see Mutating routes, "Checked by a test"). CodeQL's `js/missing-rate-limiting` rule,
  which could not see the database-backed limiter and raised only false alerts, is the one rule now excluded; all
  other CodeQL queries still run.
- **One central safe-path check in Python**: Tournament Live, the LiveTrial desktop app and the LiveTrial engine
  now resolve every page-supplied file name through one small helper per product (`safe_paths`), which follows
  links and refuses anything outside its folder. The same names are accepted and refused as before; code scanning
  now recognises the check, so it no longer reports these places as possible path injection.
- **Live dashboard, launchers and the Tournament package in all 15 languages**: the spectator scoreboard's own
  texts follow `?lang=` (for OBS), the viewer's saved choice under the gear or the browser language, separately from
  `?trackLang`; launcher window titles, the error messages of install, restore and backup steps, the setup wizard's
  console lines and the Tournament Tools installer and launchers use the launcher languages. The translated
  Tournament Directors guides now describe the live scoreboard too.

### Fixed

- **Tournament Live names the real sign-out label**: its offline and unconfirmed sign-out messages (and the
  Tournament Connect command line) now point to **Sign out on all devices** in the website's account menu instead
  of a "Sign out everywhere" button on an account page, in every language.
- **A withdrawn live feed says it stays private**: an evidence record's `live` object now carries `withdrawnAtMs`
  (when the Director took the feed off the public view, `null` otherwise; the website and the app read the object
  strictly). On the website and in the app a withdrawn run says it stays off the public view until the Director
  confirms the live routing again, even when its account holds a capture delegation, instead of "the next race opens
  the public view", and offers no delegation shortcut.
- **Step 5/9 texts match the live-capture rule**: the Step 5 intro, the recordings intro (website, app) and Tournament
  Live's connection help no longer say race 1 opens the public view by itself; a strong roster match opens it only for
  a feed from the Director, an administrator or a delegated account. The app's recording cards (*Live now*, *Repair live
  group links*, *start/stop unknown* and the other states) are translated in every language.

## 0.2.5 — 2026-11-16

A security release; updating is recommended for every community. Permission checks are stronger on every route,
every change counts against request limits and quotas, Tournament Connect and Tournament Live stay on the chosen
community website, LiveTrial's engine is controlled only from its own computer, spreadsheet exports keep names as
text and app download links expire. Dangerous administrator actions ask for a fresh email confirmation. The website
uses its own database account that can only read and write rows, and every route makes an automatic, verified daily
backup. The update applies database migrations 0092 and 0095; MySQL stays 9.7 LTS. Android app 2.99.6 (175).

### Security

- **Separate database accounts on every route**: the website's API now connects with an account that may only
  read and write rows (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), so SQL that reached the database through some
  future fault cannot drop, alter or empty tables or hand out rights. Database updates and reference data use the
  separate migration account; backups use the migration account (B2), a read-and-export-only account (A3) or the
  database container's own root login (Docker routes). New Docker installations and A3 create the accounts
  themselves; an existing Docker installation is switched by its next `upgrade` (A2 offline: package update), A3 at
  the next start of its database, keeping the previous login as the migration login and returning to it when the
  website does not start with the new one. B2 asks for a second, limited database user (DirectAdmin/cPanel) and
  warns while only one is configured; `install.py database-accounts` adds it to an existing installation (`--undo`
  reverses it). Docker Compose has a new `migrate` service, the only one that receives the migration login. No
  migration. See Operations, "Database accounts".
- **Dangerous administrator actions need a fresh email confirmation**: changing administrator, Director or report
  rights, linking accounts to Players directly, approving a request to host, installation settings, bulk rating and
  carried-time actions, removing, reopening, restoring or retracting a night, and a Director deleting or removing a
  Tournament now ask the browser or app session to confirm a new single-use link sent to the account's own address.
  The confirmation lasts 10 minutes for that session only (`MK8DX_HOSTED_STEP_UP_WINDOW_SECONDS`), sending is rate
  limited and every step is audited. Website and Android show **Confirm with a new email link** and continue the
  action after confirmation. The administrators' list of every account with its email address is loaded only when
  its section is opened and asks for the same confirmation. Ordinary use, other reads and running a night are
  unchanged; an offline LAN installation
  without email does not ask. Migration 0095. See [Mutating routes](docs/architecture/MUTATING_ROUTES.md#fresh-confirmation-step-up).
- **A Time Trial revision stays with the Player who owns the result**: the server now checks, inside the locked
  write, that a new revision of an existing result comes from an account that currently holds the verified claim
  on the stored owner, names that same Player and keeps the result's source class (website, Android, LiveTrial)
  and carried state. Results without a central Player owner (older imports) are not revised through the
  submission route. A refused revision is answered with 403 and changes nothing; an offline client re-sending its
  own revision still gets the same 409 as before. Administrator corrections keep using the separate, logged
  correction action, which never changes the owner. No migration or setting.
- **Tournament review is checked per Tournament on every route**, the phone's operator routes included: reading or
  rejecting incoming results and evidence records requires an active administrator grant, or being that night's
  Director with an active Tournament operator grant; the review writes re-check this in their own transaction. A
  revoked operator grant also ends review of the Director's own nights.
- **Only trusted feeds open a Tournament Live view by themselves**: only a feed from an administrator, the night's
  Director, or an account the Director delegated live capture to may open the public live view automatically; a roster
  match alone is not enough. Other feeds wait for the Director's confirmation and reserve no group. Directors can
  delegate (time-limited, revocable) and withdraw a public feed; every change is audited with its authority. Migration
  0092.
- **Limits on uploaded Tournament evidence**: per-account and installation upload rates, quotas on unlinked records
  and bytes, bounded lists with paging, and a retention job for stale evidence that was never linked. Refusals answer
  429 with `Retry-After`, 409 or 413 and store nothing; linked evidence is never removed. See `backend/api/README.md`.
- Session routes (remembered app sign-in, account switching) verify the sign-in before anything is stored, have a
  bounded per-address budget before sign-in, combine the account and the device in their budgets after sign-in, and
  limit how many accounts one remembered device can switch between.
- The shared rate limiter now counts concurrent requests exactly, cleans up on its own schedule in bounded steps, and
  logs cleanup and refusal counts without account details.
- Aliases: per-Player limits, a per-account write budget, the browser's same-origin proof on every write, and
  optional paging of public alias lists.
- App downloads with short-lived static links: the web server itself now refuses a link after its lifetime, links
  are reused per account, the number of live links is capped, cleanup runs on its own timer, and a startup
  self-check logs whether the host enforces the lifetime. New optional settings
  `MK8DX_HOSTED_APP_DOWNLOAD_LINK_MAX_LINKS` and `MK8DX_HOSTED_APP_DOWNLOAD_LINK_PROBE`.
- Client check-in keeps at most 100 rows per account and records at most 120 check-ins per hour (more are
  acknowledged, not stored). Check-ins are now stored on a strict MySQL/MariaDB database (they were refused there).
- New: [mutating route inventory](docs/architecture/MUTATING_ROUTES.md) with the protection of every API route that
  changes data.
- Browser notifications are delivered only to the browsers' own push services (plus push services the operator
  adds with `MK8DX_HOSTED_WEB_PUSH_EXTRA_PROVIDER_HOSTS`), on port 443, to public addresses the server checked
  itself, with strict TLS and without following redirects. A subscription to another destination is refused.
- Each browser notification request has a hard time limit and a bounded response size, and deliveries run
  several at a time, so one slow push service no longer holds up everyone else's notifications.
- An account keeps at most 10 active notification browsers (a new one replaces the oldest), registering and
  removing them is limited to 30 per hour per account, and stale or long-removed subscriptions are cleaned up.
- **Tournament Connect and Tournament Live keep the sign-in on the chosen community website**: every request goes
  to the one address chosen for the community, redirects are no longer followed (so the sign-in and the device
  code are never sent to another host, port or scheme and a request is never repeated), and answers are bounded
  in size and must be JSON. Plain HTTP stays allowed only for a website on this PC (`http://127.0.0.1:<port>`,
  `http://localhost:<port>`); HTTPS keeps the normal certificate checks.
- **The browser sign-in link is checked before a browser opens**: it must be the chosen website's own `/device`
  page with exactly the shown code, otherwise nothing is opened. The chosen website's address is shown with the
  code.
- **Signing out ends the session on the website**: `TournamentConnect.cmd sign-out` and Tournament Live's new
  **Sign out** end this PC's session on the website and report success only when the website confirms it; other
  devices stay signed in. `sign-out --this-pc-only` and **Work offline** only forget the sign-in on this PC and
  say so; **Sign out everywhere** on the website ends the other sessions.
- **LiveTrial engine control is limited to this computer**: the engine's dashboard on port 8777 now changes recording,
  Stop capture, storage settings, clean-up, pins, categories, archive and calibration grids only from its own local
  page or the desktop app, with a per-launch action proof and bounded requests; opening a page only reads. With
  `--lan`, other devices can watch; control stays on this computer.
- **Spreadsheet exports keep names as text**: a Player, group or OCR name that starts like a formula stays text when
  a CSV or XLSX export is opened in a spreadsheet program (Web, Android, API score workbook, Tournament Processor,
  Live and Analysis, including their debug exports). Workbooks use string cells; CSV cells get one leading
  apostrophe where needed, which every import of these files removes again. Names are unchanged in the database.
  The rule is in `packages/domain/policies/spreadsheet-text-v1.json`. The Android score workbook also no longer
  writes a name such as `007` or `Infinity` as a number.
- **Fair budgets keep a community responsive**: every signed-in change counts against the account's own durable
  budget (administrators higher, never unlimited) and a shared per-minute budget for the whole installation.
  Expensive and fan-out paths (sign-in and sign-up mail, app sign-in codes, Player claims and their messages, Time
  Trial submissions, notifications, app downloads, aliases, Web Push subscriptions and engagements) also have an
  installation-wide budget, and actions that notify somebody else have a budget per target (per Player, per claim,
  per e-mail recipient). Claims have hard quotas on waiting requests per account and per Player and on notes per
  claim. Refusals answer 429 with `Retry-After` (quotas 409) and store nothing; offline queues retry. Defaults suit a
  community of a few hundred Players including launch day and a busy Tournament night, and each can be changed with
  an `MK8DX_HOSTED_BUDGET_*` setting; see `docs/architecture/MUTATING_ROUTES.md`. No migration.

### Added

- **A server-side fallback for the fresh e-mail confirmation**: when an installation cannot send e-mail, the
  operator runs `install.py step-up-link --state-dir <installation>` on the server after the administrator pressed
  **Send the link**; it prints a new single-use link for that one waiting request, which is confirmed on the normal
  link page. Server access only (no web route), refused when more than one session is waiting, and audited. See
  Operations, "When e-mail fails".
- **Automatic, verified, restorable daily backup on every route**, so a community can return to yesterday's state: A1,
  A2 (online LAN), B1, A3 and B2 (`install.py backup-run`): Windows Task Scheduler, systemd/launchd or one marked line
  in the user's crontab (other cron lines, and the notices DirectAdmin prints, are left alone). On by default for A1,
  A3 and B1; B2 setup asks, with an explanation for hosts that already back up the account. 14 daily + 4 weekly
  backups, bounded by size (10 GiB, B2 1 GiB), owner-only, the newest verified one always kept. `backup-status` (also
  under `automaticBackup` in `status`), `backup-latest --print-path` for an off-host copy, `--copy-to` for a second
  drive or NAS, optional sealing with a recovery code (`--encrypt-backups`, `backup-open`), `backup-unschedule`. An
  update keeps the schedule. A2 offline keeps its own nightly backup. A failed or unverified night never removes an
  older backup.
- **Directors manage live capture on the website**: Step 5 (and 9) lists the night's capture delegations with
  their expiry and status, delegates live capture to an account whose Tournament Live connected to the night
  (12 hours by default, at most 7 days), revokes a delegation and withdraws a public live feed. A waiting feed says it
  waits for the Director; a roster match alone never opens it. Tournament Live says the same after registering a
  live run. The delegation list now carries the delegate's name. See the Tournament Directors guide.

### Fixed

- B2 backups on MySQL 8.4 or newer with a limited hosting user no longer fail; export and restore errors now say why.
- The host package and the non-Docker package now carry `tooling/scheduled_backup.py` (and the non-Docker package
  `tooling/lifecycle.py`), which the installer imports for the automatic backup.
- Administration → Aliases: the "where you saw it" field turns plain words into the source identifier the server
  expects (for example `source.tn13-workbook`) and shows what will be saved, instead of failing with a technical error.
- LiveTrial: the engine copy that the package ships now has the same dashboard language handling and field-reader
  module as the engine working copy (every app language other than Dutch shows the dashboard in English instead of
  Dutch), and a CI test fails when the two copies differ again.

## 0.2.4 — 2026-11-15

Speaks every language of the game: the user, A2, LiveTrial and Tournament Directors guides, the A2 setup wizard and
join pages, the launcher windows and the Tournament Live and Analysis windows are now in all 15 languages (machine
translations except EN/NL). Tournament reads player names in every script a Switch profile can use, and Tournament
Connect and Live work with A1 and A3 over plain loopback HTTP. The Tournament Live dashboard gains an Overall-only
mode and track names in your language. Tournament Tools and LiveTrial include every OCR model, so recognition works
offline from the start, and use less memory. On Android the buttons read **Change Player** and **Change community**.
App downloads work on shared hosting that limits application responses. The #99 recognition work continues
(phases 3–5: one crop search and card geometry for Web, Android and LiveTrial, behaviour unchanged). In a newer A1/B1
package folder, 2 (start) now refuses until 7 (update) has run (#197). The database is unchanged since 0.2.3 (MySQL
9.7 LTS, no new migration). Android app 2.99.4 (173).

### Added

- **Tournament reads player names in every script a Switch profile name can use**: the Latin name reader also
  covers Italian and Portuguese, and a name box whose Latin reading leaves room is also read by Cyrillic,
  Japanese, Korean, simplified and traditional Chinese readers (loaded on first use). A clearly more confident
  reading in its own script is passed on; otherwise the Latin reading, exactly as before. Same in Tournament Live
  and the Processor/Analysis; the cross-race linking and the Director's workflow are unchanged.
  `tooling/tournament/evaluate_player_name_scripts.py` measures it per script.
- **Setting to turn off name reading in non-Latin scripts**, to save memory: `MK8DX_NAME_SCRIPTS=on|off` in
  `TournamentTools.config.cmd` (default on), the **Read player names in non-Latin scripts** checkbox under
  **Recognition** in Tournament Live (saved with its other settings) and in the Tournament Analysis window, and
  `vision_cli --name-scripts on|off`. Off never loads or runs the five script readers for player names; the Latin
  reading goes on exactly as before. On TN13 group 1 the results were identical and the graphics memory peak fell
  from 1.1 GB to 0.25 GB (2 readers loaded instead of 7). LiveTrial's console-language detection is unchanged.
- **Tournament Live scoreboard: Overall only and track names in your language.** A small gear on the spectator
  dashboard (hidden in OBS) chooses *Automatic* (default: latest race result and overall standings alternate) or
  *Overall only* (the confirmed overall standings stay on screen, with the race they include and a race still
  awaiting confirmation), and the language of track and cup names: English + Dutch as before, or one of the 15
  game languages from the Clean Assets names by canonical track/cup ID, with English as fallback. The browser keeps
  the choice; OBS sources use `?scoreboard=overall` and `?trackLang=ja`. Display only: scoring, confirmation and
  the console language recognition reads are unchanged, and the dashboard's own texts stay English.
  `track-names-v1.json` now also carries the canonical IDs and the cup names.
- **A2 setup and join pages in all 15 languages of the game** (machine translations except EN/NL): the setup
  wizard and MK8DX beheer, the host's "Prepare this device" page (`/setup`) and the invitation page a phone opens
  from a sign-in card. They follow the browser's language like the website and the guide (exact, then regional:
  es-MX → es-419, zh-Hant/TW/HK → zh-TW, then the base language, else English) and have a language menu; the
  invitation page also follows the language chosen on the website. The A2 guides now quote the labels as the
  wizard shows them in that language. A package update writes the `/setup` page of an existing installation
  again, so it gets the 15-language page too.
- **Launcher windows, Tournament Live and Tournament Analysis in all 15 languages of the game** (machine
  translations except EN/NL): the start and manage windows (`Start-MK8DX*.cmd`, `Manage-MK8DX-No-Docker.cmd`,
  `tooling/start-mk8dx.ps1`/`.sh`) with their menu, steps and messages, and the questions of the guided setup in
  `tooling/install.py`; the Tournament Live window's remaining English/Dutch-only texts; the Tournament Analysis
  window. The launchers follow `MK8DX_LANGUAGE` or the system language (exact, regional, base, else English) and
  keep the race-style look and `-Plain`/`--plain`/`NO_COLOR`; Chinese, Japanese, Korean and Russian also show
  correctly when the output is redirected. The translated guides quote the launcher lines as the window shows them.
- **User guides in all 15 languages of the game** (machine translations except EN/NL, marked as such;
  corrections welcome via the Translation correction form): the A2 guide, the user guide (TXT and DOCX) and the
  players guide in `docs/install/translations/<locale>/` and `docs/guides/translations/<locale>/`, the
  illustrated A2 guide as `docs/install/guide/<locale>.html` with a language menu on every page, and
  `README_EN_US.md`. The setup wizard's Manual link opens the guide in the browser's language; the release
  attaches `MK8DX_User_Guide_<locale>.txt`/`.docx`, and every package that carried the EN/NL guides carries all
  of them.
- **Connect later** in the LiveTrial and Tournament Directors guides (EN/NL): what is sent when you sign in or
  send later, what stays on the PC, and that Tournament Live's Excel stays in `Live_Output\exports` after closing.
  English versions of the Dutch-only install docs and Dutch versions of the player, LiveTrial, Tournament and
  hosting guides.
- **LiveTrial and Tournament Directors guides in all 15 languages** (`docs/guides/translations/<locale>/`, machine
  translations except EN/NL). The English guides list every language under their title, and each README's Get
  started rows link the reader's own LiveTrial, Tournament Directors and Players guide.
- **Change a user guide** in the developer guide (EN/NL), the pull request checklist and CONTRIBUTING: which files
  hold the EN/NL guides and the 13 translations, update them in the same pull request or open a `translation`
  issue, and the builders to run. `tooling/build_readme_links.py` (with `--check`) keeps the README language
  switcher and own-language guide links in step.

### Changed

- **LiveTrial verifies a detected console language with its own script only.** After automatic detection the
  10-second menu-text check reads with the decided language's reader and the Latin one instead of all six script
  readers, and the other script readers are released; a language change still re-opens detection through the
  templates and nameplates. Detection itself is unchanged. Every LiveTrial reader (capture loop, console-language
  probe, Select-a-Ghost panel, name strips) now comes from one cache, one reader per language set, and a reader
  loads under its own lock, so the track-name read no longer waits for the probe loading another script.
- **One EasyOCR reader per language set in each Tournament process** (`mk8dx_tournament_extraction.ocr_readers`):
  the recorded engine's track, name and digit readers and Tournament Live's row extractors, track reader and
  warm-up share it; the warm-up now keeps the readers it loads instead of discarding them.

### Fixed

- **App downloads on shared hosting that limits application responses**: LiteSpeed/Passenger hosts answered a large
  APK streamed through the API with their own small error page. An opt-in setting
  (`MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT` + `MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY`, optional
  `…_URL_PATH` and `…_TTL_SECONDS`, default 10 minutes) makes the signed-in file route redirect to a short-lived,
  unguessable link inside the document root that the web server serves itself, resumable. Expired link folders are
  removed at every download and at startup; an unsafe setting stops the start. Without it the route streams as
  before, now typed `application/vnd.android.package-archive` for an APK.
- **Android roster import remembers spellings in every script**: the phone's roster-import fold kept only
  `a-z0-9`, so a Cyrillic, Japanese, Korean or Chinese spelling from the file folded to "" and was never kept as
  the Director's alias. It now keeps letters and digits of every script, as the website's workbook key does
  (accents and spacing still folded, kana keep their voicing marks); keys of names it could already read are unchanged.
- **Step 5/9 and historical imports keep non-Latin names apart**: the workbook name key kept only `a-z0-9`, so
  every Cyrillic, Japanese, Korean or Chinese player name became the same empty key and the rows overwrote each
  other. The key now keeps letters and digits of every script (accents and spacing still folded, NFKC, so kana
  keep their voicing marks); keys of names it could already read are unchanged.
- **Tournament Tools and LiveTrial ship every EasyOCR model, so OCR works offline from the start.** The packages
  had only the detection and Latin-script models (`ocr-models` collection group). The English-only reader
  (`english_g2.pth`) therefore downloaded its model on the first run and failed offline. So did the track and
  console-language readers on a Russian, Japanese, Korean or Chinese console. The builds now also stage
  `english_g2.pth`, `cyrillic_g2.pth`, `japanese_g2.pth`, `korean_g2.pth`, `zh_sim_g2.pth` and `chinese.pth`
  (traditional Chinese): about 297 MiB, Apache-2.0. They are not stored in Git. `packages/assets/downloaded-models-v1.json`
  pins each file's size, SHA-256, upstream MD5 (easyocr 1.7.2 `config.py`) and license, plus the official EasyOCR
  release archive and its hash. `tooling/assets/downloaded_models.py` downloads each archive once into a cache
  (`MK8DX_MODEL_CACHE`; CI caches it, keyed on the pins), verifies it and fails closed. `admit` records a new model.
  The Tournament Directors guide (EN/NL and translations), the client install pages, the Tournament Tools reference,
  all 15 user guides and the package README now say all OCR models are included and processing works offline after
  the install.
- **A1 and B1: Start from a newer package folder is refused until the update has run** (#197). Choosing 2 (start)
  in a new package's folder would run the new version on the existing installation without the checked backup and
  the database updates that 7 (update) makes first; since 0.2.3 that also upgrades MySQL 8.4 to 9.7 for good. Start
  and apply now compare the database and API images of the installation's containers with this package's images
  and stop with "Choose 7 (update) first" when they differ. A2 is unchanged: its setup offers Update itself. The A1,
  administration and hosting guides and all 15 user guides say so: in the new package folder choose 7 (update)
  first; with a 0.2.3 package, 2 would skip the backup.
- **Android: Change Player and Change community** instead of a bare **Switch** (#201). In es, es-419, it, ko,
  pt and ru the account and community buttons showed the console's name untranslated. Android app 2.99.4 (173).
- **Tournament Tools README-FIRST and installer list `TournamentConnect.cmd`** and no longer say the first OCR run
  downloads models (#183); the tooling tests run quietly (#185); `segmentScores` returns 0.0 for an empty patch in
  Python, TypeScript and Java instead of failing or reading a false 1.0 (#186).
- **Tournament Connect and Tournament Live work with A1 and A3.** Both refused `http://127.0.0.1:<port>` and
  `http://localhost:<port>` with "Tournament Manager connection requires HTTPS" unless
  `MK8DX_TOURNAMENT_ALLOW_INSECURE_LOOPBACK=1` was set. Plain HTTP is now accepted for exactly these loopback
  addresses (with a port), which never leave the PC; every other address still needs HTTPS. The old variable is
  ignored.
- **`TournamentConnect.cmd sign-in` asks for the website address** when none is set, validates it like
  `server <address>` and stores it; without a terminal it stops and names `TournamentConnect.cmd server <address>`.
  It used to try the placeholder `https://example.invalid` and fail with a DNS error.
- **Tournament Live's OCR warm-up says what happens to the recognition models**: "Loading recognition models (no
  download needed)" when they are on disk (the normal case, now that the package ships them all), otherwise that
  EasyOCR downloads the named model once. It knows the model file of every reader set, including the Cyrillic,
  Japanese, Korean and Chinese ones.
- **Guides** (EN, NL and the 13 translated user guides): Tournament Live to the website (choose the tournament,
  then Step 5 → Available Tournament Live recordings → Link to group), a remembered capture card that blocks
  Start all, XAMPP Apache also wanting ports 80/443 (A3), the Docker "address pools fully subnetted" error (A1),
  Create new tournament for administrators and the NS1/NS2 Switch ticks in Step 2 (Tournament Directors).

### Recognition

- **A Python reference for the Web/Android icon crop search** (#99, phase 3). `crop_search.py` in the central reader
  reproduces how the browser scanner and Android cut the character, kart and glider crops (nominal score, masked
  position pass, shift, ghost-card saturation boost, seven character scales, crop box). On the 12 public test-set
  frames it equals the browser scanner on all 154 searches of 50 fields. The new vector
  `crop-search-v1.json` (26 synthetic cases, 50 real crops, numbers only) is replayed in Python, TypeScript and
  Java. The scanners' behaviour does not change: they still run their own search until phase 4.
- **One shared crop-search rule in the Web scanner and Android** (#99, phase 4). The browser scanner
  (`cleanAssets.ts`, `kartConfig.ts`) and the APK engine (`CleanAssetsMatcher`, `KartConfigMatcher`, the shared
  field reader's crop box) now call `sharedCropSearch.ts` and `CropSearch.java` for every decision of the icon crop
  search: the search window, window gain, position vote, shift acceptance, ghost-card boost region and factor,
  character scales, scale choice and crop box. Only the pixel work stays in the products. The searcher's constants
  live in those shared modules, and `crop-search-v1.json` now carries them with 64 helper cases that Python,
  TypeScript and Java replay. Android drops a second position pass that always repeated the first. Behaviour does
  not change: on the 12 public test-set frames the browser scanner gives the same 154 searches and 63 fields, and
  the Android engine on an emulator gives the same result and kart configuration for all 12 frames. Android's
  float32 score arithmetic stays and was measured: at most 5e-8 from the double reference, with no decision changed.
- **LiveTrial reads icons only with the central reader, and the card geometry before the crop is shared** (#99,
  phase 5). The LiveTrial engine's own icon matcher and crop search (`identify_crop`, `identify_crop_search`,
  `register_card` in `identity_matcher.py`) are removed. They were only the Select-a-Ghost fallback when the central
  reader was not loaded, which never happens in a build. Without the central reader the panel's fields now stay
  unknown, the rule the result cards already followed. The engine no longer loads every reference image at start.
  The new `canonical_warp` module (Python,
  `sharedCanonicalWarp.ts`, `CanonicalWarp.java`) holds the geometry between the card quad and the 1280x720
  canonical card: bounding rectangle, warp corners, target box, alignment and anti-alias reduction. The Web scanner
  and Android call it. The vector `canonical-warp-v1.json` (11 synthetic cards, 12 real cards from the public test
  set, numbers only) replays identically in all three and equals the Web scanner double for double. Behaviour does
  not change: the Web scanner's 64 recorded warp calls on the 12 frames are identical before and after, and
  12/12 frames match their labels. The Android engine on an emulator gives the same result, kart configuration,
  stage 17/18 geometry and stage images (by hash) on 12/12 frames.

## 0.2.3 — 2026-11-14

Runs the web gateway without root, pins the database and mail images by digest, and makes the repository easier to
start with: a "How it fits together" diagram and **Get started** near the top of every README, one entry point in
the docs, and real screenshots in the A2 guide on GitHub. The Docker routes move to **MySQL 9.7 LTS** (an existing
database is upgraded on the first start; the update makes a verified backup first), and kart and glider colours follow
the character in every scanner. Android app 2.99.2 (171).

### Security

- **The gateway's Caddy no longer runs as root** (#34). The Web image's new entrypoint gives Caddy's storage
  (`caddy_data`, `caddy_config`) to the user `caddy` (uid 10002) and then starts Caddy as that user. Existing
  installations move over at their next start: the LAN certificate authority, the certificates and their 0600
  modes stay as they are. On Linux, where the A2 certificate signer and setup page are the operator's own 0600
  files, Caddy runs as the operator's uid instead. Caddy keeps running as root, with a log line, only when nothing
  but root could read a mounted file. The Compose files are unchanged, so older and newer images keep working
  with either. The installer now makes `public-client.json` (public content) readable inside the private
  installation folder, like `operator.json`. The LAN gateway no longer tries to install its root certificate in
  the container (`skip_install_trust`).
- **MySQL, Mailpit and the CI MariaDB images are pinned by digest** (#34) as `name:tag@sha256:...`, and Dependabot
  updates the Compose pins. Release builds fetch these images by digest, and `host_bundle.py` refuses a local copy
  with another digest. The packaged Compose files still name the tag, because images loaded from the package's tar
  keep only their tag.
- better-auth 1.7.20 (patch). Mailpit 1.33.1, pinned by digest.

### Changed

- **Database: MySQL 9.7 LTS** for the Docker routes (A1, A2, production profile), up from 8.4 LTS. An existing
  8.4 database is upgraded in place on the first start of the new package; tested on a migrated and seeded schema
  (114 tables identical before and after, the app account still signs in, migrations see all 91 as applied). The
  upgrade cannot be undone, so the package update keeps its verified backup first; that backup is a logical dump and
  restores into 9.7. Backups no longer carry GTID state (`--set-gtid-purged=OFF`). CI runs the database suites on
  MySQL 9.7, MySQL 8.4 (still the minimum for an external database) and MariaDB 11.4. Dependabot stays on the 9.7
  line; 26.x/27.x are short-lived Innovation releases.
- **Kart and glider colour follow the character** (field semantics 0.4.3, #99). Python, TypeScript and Java now
  share one rule for bodies and gliders, so a scanned result never pairs a character with a kart or glider colour
  that character cannot have. With an accepted character the catalog colour is the part; when the icon clearly
  shows another colour (outside the visual top three), the catalog colour is proposed with a `?` and the field
  needs review (`character_colour_conflict_review`). Without an accepted character the colour comes from the icon
  only: it is accepted when the printed name reads the same part family (`name_supported_icon_colour`, owner
  option 2 in #173), otherwise only the family is accepted and the icon's colour is the proposal. An unconfirmed or
  suggested character never supplies or vetoes a colour. Single-colour parts, and characters without a catalog link for that part, are
  decided by the icon as before; tyres are unchanged. Android's context rules now run on the shared Java code (`ContextRules`) instead of an
  app-local copy, and pass their evidence to the result proposal as Web and Python do.
- A tyre row number counts only as ASCII digits `0`-`9` in every runtime; full-width digits are turned into ASCII
  where OCR text is normalized, before the context rules (#99). Other digit scripts are no row number.
- `context-v1` parity vectors cover these cases and the OCR digit normalization; the Python, TypeScript and Java
  replays (new Android `ContextParityTest`) have no known exceptions any more.
- Android app 2.99.2 (171): the shared context rules above; nothing else changed in the app.
- **README, all twelve languages:** a new "How it fits together" section with a diagram of how the apps, the
  community server and the shared recognition relate, followed directly by **Get started**. The product sections
  follow, then the project status, the documentation table and the story. The tribute to Volkert has the owner's new
  text.
- **One entry point:** `docs/GETTING_STARTED.md` is now the developer route from source and sends players and
  organisers to the README's Get started; `SUPPORT.md` presents the release's `.txt`/`.docx` guides as the
  offline, printable copy. The amd64 Docker images are also public on GHCR, and `docs/GETTING_STARTED.md` now says
  so. The arm64 images ship inside the arm64 A2 packages.
- **A2 guides on GitHub** show the real screenshots instead of `(Image: …)` placeholders; missing screenshots are
  hidden. `tooling/build_guide_html.py --check` now also checks the Markdown.
- The B2 guides say that the `mk8dx-mijnhost-node` package works on any shared Node.js host with SSH; mijn.host is
  the tested example and port 26 is its SSH port.
- Developer docs: how to activate `.venv` in each shell, and PowerShell forms of the central-reader test commands.
  The 0.2.2 user guides' file names and the APK size are corrected.
- CI runs the Tournament tests on the Tools package's locked runtime, with a smoke of the recorded analysis
  after the text reading on synthetic rows, so a dependency update that breaks that path (as pandas 3 did, #169)
  fails before a release.
- CI replays new recognition parity vectors in Python, TypeScript and Java: refinement, frame geometry, lap grid,
  seven-segment digits and name matching (#99). No runtime disagrees.
- Dependabot leaves OpenCV alone: OpenCV is pinned to the same build in Python,
  Web and Android and is upgraded together, never in one runtime (#99). Gradle wrapper 9.9.1.
- Install and standalone guides match 0.2.3: every update section says to choose 7 (checked backup and database
  updates) before 2 for the MySQL 9.7 move, the Intel Mac and arm64 A2 packages are named, the launcher address
  labels and Python 3.12 to 3.15 are correct, and LiveTrial and the Tournament Tools are described as working
  without a community website.
- Scanner build: vite 8.3.8 (Dependabot minor-patch group, #194).

## 0.2.2 — 2026-11-13

Fixes recorded-video analysis in the Tournament Tools, which stopped with an error in 0.2.0 and 0.2.1, and adds the
Tournament Analysis window, an enforced scanner security policy and the README in all twelve game languages.

### Fixed

- **Recorded tournament analysis works again** (#169). In 0.2.0 and 0.2.1, `TournamentProcessor.cmd` and the analysis
  window stopped with `TypeError: Invalid value ... for dtype 'str'` as soon as a race had a character with colour
  variants, so no results were written. Tournament Live did not stop, but silently skipped its end-of-event
  colour-variant and Mii correction. pandas 3 makes a column filled with empty text strictly text-only; the
  colour-variant refinement now creates its columns as mixed columns, as before. A 45-minute recording gave 144 of
  144 rows identical to the historical result.
- A complete player name read from the score screen is no longer shortened to a lobby reading that lost its last
  character (#137).

### Added

- **Tournament Analysis**, a window for analysing recorded tournament videos afterwards when Tournament Live was not
  used on the night. The Qt (PySide6) window follows the layout of the MK8DX Live Video Processor post-analysis window: a banner,
  numbered steps (choose recordings, tick videos, run, results), a live coloured activity log, a Rainbow Road
  progress bar, a start-light status and a working **Cancel**. **START ANALYSIS** runs the existing
  recorded-video processing (`vision_cli all`); **Open Latest Excel**, **Open Results Folder** and **Open Frames**
  follow. English and Dutch. The banner shows that window's Mario Kart 8 Deluxe artwork (listed in
  [Third-party materials](docs/THIRD_PARTY_MATERIALS.md)); `MK8DX_ANALYSIS_BACKGROUND` in `TournamentTools.config.cmd`
  can point it at another image. Only presentation was ported: the window runs the central recognition through
  `vision_cli`, and a test keeps it from importing any engine code. Without PySide6, or with
  `--classic-gui`, a simpler Tkinter window opens. The Windows Tournament Tools package writes a new
  `TournamentAnalysis.cmd` and installs the processor's new `gui` extra; `TournamentProcessor.cmd` drag-and-drop is
  unchanged. Developers run `python -m tournament_processor.gui`. See
  [Tournament Directors](docs/guides/TOURNAMENT_DIRECTORS.md#analyse-recordings-afterwards).

### Security

- The Docker gateways (A1, A2, B1) now **enforce** the Web Content Security Policy instead of only reporting it. It
  is the policy the Web page and the Node static route already enforced, so pages behave the same; the header adds
  `frame-ancestors 'none'`. Checked in Chromium on a running A2 installation: 23 routes in English and Dutch at
  320, 768 and 1440 CSS pixels, no violations. The scanner's policy stays Report-Only until its own browser pass.
- The Docker gateways now also **enforce** the scanner's Content Security Policy (#34). The scanner page itself may
  not evaluate strings, compile WASM, use inline styles or start `blob:` workers. Only the scanner's worker scripts
  under `/scanner/assets/worker/` get `'unsafe-eval'` (OpenCV.js builds functions at run time), and the ONNX Runtime
  and Tesseract workers get `'wasm-unsafe-eval'`. The scanner's result screen now sets its colours and widths
  without `style` attributes and looks the same; the audit and parity pages load their styles from files and their
  two probe workers from files instead of `blob:` URLs.

### Changed

- The README is available in all twelve written languages of the game. English and Dutch are reviewed by people;
  the others are machine translations and ask for corrections. New issue forms for bugs, wrong recognition results
  and translation corrections.
- CI replays every committed recognition parity vector in Python, TypeScript and Java, including new context and
  icon-score vectors, with the public recognition pack (#99).
- Every launcher looks like the start of a race: a colour MK8DX logo, a 3-2-1-GO countdown with beeps, the checks
  as laps with a car on the track and a race clock, a spinner while it waits for Docker, and a finish line with the
  lap times. This covers `Start-MK8DX.cmd`, `Start-MK8DX-LAN.cmd` (and the **MK8DX beheer** icon),
  `Start-MK8DX-No-Docker.cmd`, `Manage-MK8DX-No-Docker.cmd` and, new, `tooling/start-mk8dx.sh` on Linux and macOS.
  Only the presentation changed; the steps, the menu and the messages the guides quote are the same. The rich look
  and the sound are on by default in a modern terminal; `-SkipCountdown` / `--skip-countdown` or
  `MK8DX_SKIP_COUNTDOWN=1` leaves out the countdown, `MK8DX_SOUND=0` the beeps, and redirected output, `-Plain` /
  `--plain`, `MK8DX_PLAIN=1` or `NO_COLOR` give plain text. `tooling/mk8dx-ui.ps1 -Demo` and
  `sh tooling/mk8dx-ui.sh --demo` preview it. [Hosting](docs/guides/HOSTING.md#the-launcher-window-look-and-options)
  lists every option.

## 0.2.1 — 2026-11-13

The Android app gets a new layout around a community chip and a **You** screen, keeps an offline copy of your
times per community and can carry your best times to another community in one step; administrators can name
their community. Android app 2.99.0 (169) carries all app changes below.

### Added

- **A community name**: an administrator can name the installation ("Club Noord") at the top of Administration →
  Installation settings; the apps show it instead of the web address. `GET /v1/installation-settings` answers
  `communityName` (text, or `null` when not set); trimmed, at most 60 characters, audited like the other
  settings (migration 0091).
- **The same carried time twice** (ADR-0225 amendment, migration 0090): a carried time whose community and
  original id were already accepted here is refused with `409 carried_duplicate`. A carried time with the same
  track, class and time as an active run of the same Player no longer creates a second run: it fills only that
  run's empty fields (kart parts, lap times, coins, mushrooms) in a new audited revision, never replacing a value,
  and answers `200 mk8dx.carried-fill.v1` with the filled fields (`409 carried_nothing_to_fill` when there is
  nothing to add). Publication and rankings stay the same; the run's history says "Empty fields filled from a
  time carried from …". With carried times off it is refused like any carried time.
- **Reads for the app's offline copy**: `GET /v1/account/time-trials` gives each revision's `occurredAtMs` and
  pages through a long list with `?limit=…&offset=…` (answering `nextOffset` while more remain); the new
  `GET /v1/account/rivals/best-times` gives each chosen rival's best published run per track and class with laps
  and kart setup. Private Players never appear.
- **Android: an offline copy per community**: the app keeps your own runs and your rivals' best
  times for each community and shows them without a connection, with "Offline — last updated …". A failed
  refresh keeps the old copy; removing a community removes its copy.
- **Android: Carry my best times**: with more than one community, My times offers one button that
  carries your personal best per track and class to another community, skipping tracks where it already has a
  better time of yours. A copy that is already there, or that filled an equal run, counts as done.
- **Android: the community's own name**: the community chip, the community tiles, the carry choices
  and the You card show the name an administrator set, and the web address when there is none.
- **Android: a sign-in hint at home or at the club**: the sign-in screen explains that a home or
  club installation signs in with the personal sign-in card, not with email.

### Changed

- **Android navigation**: the header is the logo (Home), the community chip, the bell and your name;
  the download arrow and the gear are gone. The chip opens **Communities** as tiles (the active one green) with
  **Switch**, **Remove from this phone** and **Add a community**. Your name opens **You**: Switch Player, an
  orange banner while times wait to be sent, and the tabs **My times**, **Records** and **Rivals**, with a
  Settings row. My times is one list: career numbers, the personal best per track and class, older runs on tap
  and a **⋯** menu with Details, Edit, Withdraw and Carry to another community. The separate Times on this phone
  screen is gone.
- **Android Settings** are grouped into Player, App, Community and About and save each change by
  themselves; the language is a select field; Get the app and Saved on this phone are under Community; the test
  scan is under About.
- **Android: carried times waiting for sign-in** are one line per community with **Show** and
  **Remove all**, and no longer count as runs waiting to be sent.
- Translations: the offline copy, navigation, Settings and community name texts are in all app and web
  languages (machine translation, not yet reviewed).
- The players guide, the A2 guides, the client and administration guides and the complete user guides follow
  the new app screens and describe the installation settings.

### Fixed

- Android: a connection failure on the profile, in Accounts and Players and in player interactions says "No
  connection to …" instead of the platform's error text, and the profile's own results no longer disappear when
  the public profile or the record book cannot be loaded.
- Android: the class, best time and date of a My times row stay readable at large text sizes.

## 0.2.0 — 2026-11-12

The first stable package with **A2, at home or at the club**: one computer on your own network, no internet
needed after setup, sign-in cards for everyone. It contains everything from 0.2.0-rc.1 to rc.7 below, plus the
following.

### Added

- **Several communities in one Android app** (ADR-0225; app 2.96.0): Settings → Community server lists every
  community the phone was set up for. One tap switches; each community keeps its own account, its own unsent
  times and, for A2, its own pinned trust. "Add a community" opens the first-start screen; "Remove from this
  phone" waits until nothing is left to send.
- **Carry a time to another community** from the app: a sent result offers "Carry to another community". The app
  asks that community first and explains a refusal; otherwise the copy waits until you are signed in there. A
  refused or still-waiting copy can be removed.
- **The app's first start explains itself**: *Choose your community* says what each choice means, names the
  **Prepare a device** card the player actually gets, and has a **Language / Taal** field with all 15 languages
  by their own names. The chosen language stays after the community is set (before, a Dutch first start was
  followed by an English app). The scan and check screens use the app's design and keep their place when the
  phone turns or switches between light and dark.
- **Times from other communities** (ADR-0225, migrations 0087, 0088 and 0089): a new installation setting under
  Administration → Installation settings decides whether a time carried from another community is refused
  (off, the default), waits for an administrator (with approval) or follows the normal publication rules
  (allowed). Every change is audited. A carried submission names where it came from in the new optional
  `carriedFrom` of `TimeTrialSubmissionV1`; the server refuses it with `403 carried_times_disabled` while the
  setting is off and with `400 carried_from_self` when it names this installation itself. The public settings
  answer includes `carriedTimes`, so apps can explain a refusal before sending.
- A carried run shows "Carried from … · originally …" on its detail and in Administration → Time Trials.
- **Publish a run that waits for review**: Administration → Time Trials offers **Publish** (with one short
  confirmation) on a run withheld for review, carried or not. It publishes the run unchanged through the
  ordinary publication path (leaderboards, records, activity, overtaken notifications) and records who
  approved it (`POST /v1/administrator/time-trials/{id}/actions/publish` with the expected revision).
- **Carried times still waiting when approval is switched off**: the installation settings always show how many
  carried times wait for review, with a link to them. Changing the setting from *With approval* to *Allowed* asks
  "Publish all N" or "Leave them waiting"; changing it to *Off* asks "Refuse all N" (each run is retired and can
  be brought back) or "Leave them waiting". Nothing happens without that answer, and each run gets its own
  audit entry (`POST /v1/administrator/time-trials/actions/resolve-carried-waiting`, refused with 409 when the
  number waiting changed meanwhile).

### Changed

- Translations: the first-start, pairing and A2 sign-in, card and PIN texts are now translated into all
  languages (machine translation, not yet reviewed); every catalog is complete.
- README and README_NL describe what the app asks at first start; the players guide and the A2 guides follow
  the new screens (a home or club installation works in the app from 2.95.0).

### Fixed

- The LiveTrial live page has Dutch and English only and fell back to Dutch for every other app language, so an
  English (US) dashboard showed "Opname stoppen"; every language other than Dutch now gets English there.

## 0.2.0-rc.7 — 2026-11-12

### Added

- A2 package for Intel Macs (`mk8dx-a2-macos-amd64-…`). Its security library `cryptography` is no longer
  published for Intel Macs, so the release builds it from source on an Intel Mac runner, with OpenSSL linked in
  statically, and runs the A2 certificate and backup tests with it. Built and tested in CI; not yet tried on a
  real Mac.

### Fixed

- On macOS the A2 tools refused every folder behind `/var` (where temporary folders live), because `/var` is
  a link. Links the operating system owns (root) are now accepted on macOS and Linux; a link a user made is
  still refused, and Windows is unchanged.

## 0.2.0-rc.6 — 2026-11-12

### Fixed

- Removing or reopening a rated tournament on a new installation (A2, any fresh self-hosted site) answered
  an error and left TrueSkill counting the night: the rating replay refused because there is no imported
  history. It now starts from nothing there; an installation that once had history still refuses an empty one.
- Entering several races at once checks every race first. One refused race (an unknown track) no longer
  leaves the earlier races half-saved, which made every retry of that group fail.
- Removing, reopening or restoring a tournament without a reason answers 400 with a message instead of 500.

## 0.2.0-rc.5 — 2026-11-12

The `v0.2.0-rc.1` and `v0.2.0-rc.2` tags produced no release, and `v0.2.0-rc.3` stayed a draft because its A1
menu hid each step's own output: the A2 package build refused a second,
redundant `cryptography` wheel for Python 3.15 (rc.1), asked for the arm64 image list as a Windows package and
found no Intel Mac wheel (rc.2). The builder and workflow are fixed and the Intel Mac package is dropped.


### A2: MK8DX at home or at the club, without internet

- New per-platform packages `mk8dx-a2-<platform>-<arch>-….zip` (Windows amd64, Linux amd64/arm64,
  macOS arm64; no Intel Mac package because `cryptography` 50 ships no wheel for it) with the Docker images, pinned Python wheels for Python 3.12–3.15 and a guided
  setup in the browser: start `Start-MK8DX-LAN.cmd` (Windows) or `tooling/start-mk8dx.sh`, click
  Next. It sets up a private certificate authority for HTTPS on the local network (new roots only
  allow names under `.invalid`), an administrator, people and printable sign-in cards, nightly
  verified backups with a paper recovery code, and certificate renewal.
- MK8DX beheer (the same page, later) adds people, makes cards ("Copy link", "Sign in on this
  computer"), prepares the host computer itself, moves the installation to a new network address,
  and restores a backup on a new computer.
- Updating: unpack a newer package in a new folder and start it. The update is its own short route:
  a verified backup first, then the new images, database migrations, and the scheduled tasks and
  shortcut moved to the new folder; the start window ends with `OK  MK8DX update completed` or
  `MK8DX update FAILED: <reason>`. Release tags (`v0.2.0-rc.2`, `v0.2.0`) and QA builds are ordered;
  an older package is refused.
- Account switching on shared devices (website and Android app); administrators may appear in the
  switch list behind a mandatory PIN (5th wrong PIN or 14 days unused forgets them on that device).
  Migration `0086_account_switch_pin_failures`.
- Other routes: the setup question offers only what the package can install, in plain words. A1/B1 start
  the first setup by themselves and keep a menu open that reports each step and checks every backup.
  A3 gets `Manage-MK8DX-No-Docker.cmd` (check, administrator, checked backup) and a launcher that checks
  Python and Node.js; A3/B2 print one line for the database update and a clear message when stopped.
- Guides: `docs/install/A2_HOME_GUIDE_EN.md` and `A2_THUIS_HANDLEIDING_NL.md` (also as illustrated
  HTML in `docs/install/guide/`), including a fixed address for the host (DHCP reservation) and how to
  avoid an address conflict.
- Tested end to end on a clean Windows 11 computer and the maintainer's laptop: installation, update,
  people and cards, phone and PC sign-in, account switching, a full tournament night with rating, and
  live capture from another computer. Linux was tested in WSL 2 (Ubuntu 24.04); macOS is built and
  unit-tested only.

### Security

- Administrator grant and revoke actions share a durable per-account limit of
  20 attempts per hour. Excess requests return 429 with `Retry-After`.
- Docker installations (A1, A2, A2 offline, B1) rate-limit sign-in per client
  again instead of in one shared bucket for everybody. Caddy now sends the
  connecting address as `X-Real-IP` (replacing any client-supplied value),
  and the API honours that header only when
  the TCP peer is a trusted proxy. A trusted proxy may now also be a host name:
  Docker routes trust exactly the Compose gateway service `web`, resolved on the
  project network (other containers and LAN clients are never trusted).
  `compose.yaml` sets this for the API container, so existing installations
  only need the new package and an API/Web recreate (`install.py apply`); new
  installations also write `["web"]` to `api.env`.
- Offline invitation redemption no longer depends on the per-address limit
  alone (on Windows Docker Desktop every LAN device arrives from the gateway's
  address). Each presented card is limited to 5 attempts per 15 minutes, keyed
  on a keyed hash of the token (the token is never stored); all redemption
  attempts together are capped at 120 per minute; the per-address limit is
  raised from 5 to 60 per minute so a LAN night sharing one address is not
  blocked. Unknown and malformed tokens count against the same limits. Email
  sign-in limits are unchanged.

### Offline LAN

- ADR-0224 phase 1: a signed-in Player account in an offline-invitation
  installation can add another device from the account menu. It shows a
  one-use, 15-minute QR card (with the link, its expiry and "New card") for
  that account only; a new card retires the previous one. The route
  (`POST /v1/session/device-invitations`) is rate-limited, refused for
  administrators (they keep the host-computer flow) and absent in email-link
  installations. Real-device and browser checks are still open.
- ADR-0224 phase 2 (both installation modes): a shared device remembers the
  Player accounts that signed in on it, and "Switch account" (account menu,
  Settings, and the signed-out sign-in panel) continues as one of them with one
  tap. An account can turn on an optional 4-digit PIN in Settings; the server
  checks it and limits attempts (5 per account per 15 minutes, 20 per device
  per hour). Administrators are remembered only with a PIN (see A2 above).
  The browser holds labels only, under one HttpOnly SameSite=Strict device
  cookie. "Sign out" removes the account from this device's list; "Sign out on
  all devices" removes it from every device. Migration
  `0085_account_switching`. Design: `docs/product/ACCOUNT_SWITCHING_DESIGN.md`.
  Browser and real-device checks are still open.
- The account menu offers "Sign out on all devices" after a confirmation. It
  ends every session of the account, apps included, then signs this browser
  out as before. "Sign out" itself still affects only this device.
- Offline A2 client configuration now advertises personal host invitations;
  the website explains that sign-in path and distinguishes it from the setup
  certificate QR. Online installations keep their email-link form.
- The QA setup page and host screen now distinguish the one-time administrator
  code from the CA fingerprint and give clearer certificate import guidance.
- NL/EN QA instructions explain which addresses work on the host and on a
  phone, how an invitation activates a local account, and why a phone may show
  the light theme.

### Camera

- Web and Android scanner zoom controls now include 2.5× between 2× and 3×.
  Web retains its digital crop fallback; Android skips steps above the camera's
  supported zoom range. Capture waits until a zoom adjustment has settled.
  Physical camera acceptance remains open.

### LiveTrial

- A newly linked player with no published times now sees an empty progress view
  instead of an unavailable-progress message. Zero standing, player count and
  total time are valid until the first published run.

### Recognition

- Android and the browser scanner move from OpenCV 4.10 to OpenCV 5.0; the
  Python clients already pin OpenCV 5.0. The Android geometry/Hough adapter
  and the browser WASM loader follow the new APIs.
- Shared Ghost Select picker 2 (field semantics 0.4.2) lets a reliable icon
  resolve a shorter OCR name within a longer catalog name, such as
  `Normal`/`Normal Blue`. The earlier two HDMI misreads are corrected without
  changing thresholds; see the [qualification report](docs/qa/OPENCV5_REQUALIFICATION_2026-11-05.md).
- Three-lap ghost time fields are aligned before the shifted column read;
  when several lap-sum repairs fit the pixels, only a uniquely improving
  field fit is selected. The seven-lap order and recognition thresholds stay
  unchanged. Same-source 4.10/5.0 qualification is recorded in the report.

## 0.1.0 — 2026-11-04

### Release packages and support

- A1 (Docker on one computer) and A3 (XAMPP/Node.js on Windows) passed fresh installation and upgrade tests with retained results and are supported. A2, B1 and B2 are documented but have not been tested end to end.
- The release workflow builds the Windows clients, full source and three server packages from a verified commit. The host ZIP includes versioned Web/API images; the release has checked SHA-256 values, provenance attestations and an SPDX asset inventory. The server packages also contain checked internal manifests. The Android APK is signed locally with the owner's retained key, outside CI.
- The owner-signed Android app is version 2.94.0 (build 160). It updates a prior owner-signed build in place. Earlier public APKs were debug signed and require one uninstall before installing this release; save any results not yet sent first.

### Security and dependencies

- Docker gateways add separate Web and scanner Content Security Policy headers in Report-Only mode. The scanner policy allows its local WASM and blob workers; Node and Caddy base images are pinned by digest.
- All 19 Dependabot version PRs in the 3 November 2026 register were handled through their specific checks, including Node 26, scanner PWA 2, Android AGP 9/SDK 37/ONNX 1.31, OpenCV 5, pandas 3, filelock 4, torch 2.15, Qt 6.12 and npm/Actions updates. SymPy 1.14 still requires mpmath below 1.4, so mpmath remains pinned to 1.3.0 with a documented exception.
- Mailpit 1.32.0 replaces the vulnerable 1.31.3 bundle; Verify audits Python and npm dependencies and tests both MySQL and MariaDB.

### Fixes

- The original Time Trials artwork appears in the Android launcher and splash and the Windows LiveTrial client, matching Web and scanner.
- The owner-signed Android release APK builds under Gradle 9: generated product and scanner assets are staged before the release lint model reads them.
- The classic Tournament report export script parses again after a public-only help-text apostrophe was corrected.
- The A3 package serves the browser scanner's included binary masks from their restricted path.

## 0.1.0-rc.9 — 2026-11-03

- Coordinated Pillow 13 security fix in the Windows clients, with targeted recognition and package checks.
- Updated the rc.9 release dependency installation and refreshed the Web/API test runners and selected dependency groups.

## 0.1.0-rc.8 — 2026-11-03

### Added

- **Tournament ranking badge in eleven bands** (ranks 1–132): after Kampioen/Champion, Talent, Wild,
  Avontuur/Adventure and Feest/Party come Paddenstoel/Mushroom, Inktvis/Squid, Schild/Shield, Wolk/Cloud,
  Toerist/Tourist and Munt/Coin, each with its own colour; final groups stay at five.
- **Tournament recognition ignores Album screens in every console language**: the Album list, picture view and
  video playback bars of 11 more game locales are ignore templates (white-theme Album lists used to slip through).
- **Sign-up asks two questions**: are your Time Trial times already here, and did you take part in a tournament
  listed here? Any yes shows the Players it may be with their published times and nights; two records can be
  requested together (ADR-0219).
- **"Director" everywhere and Request to host**: a signed-in player asks to host Tournament nights; administrators
  approve or decline (ADR-0220, migration 0080).
- **Installation settings**: who may create Players and who counts for the rating; per night "only verified
  players" and the seeding source (community rating, the Director's own nights, by hand, random) (ADR-0221, 0081).
- **Open sign-up**: closing time, maximum, first come or a seeded draw, waiting list with notifications, the
  consoles question and a personal status line on every night page, Web and Android (ADR-0222, 0082).
- **The Android Tournament board** follows the app language.
- **The game's 15 languages** in the website, the Android app, LiveTrial's dashboard and Tournament Live (the 12
  console languages, with English, French and Spanish split by region). English and Dutch are reviewed; the other
  13 are machine translations marked `reviewed: false` - corrections are welcome.
- **Tournament races carry their class** (50cc, 100cc, 150cc, 200cc or Mirror): read from the track-intro badge,
  exported (`Class` column, `mode`/`mirror` in `TournamentRaceResultV1`), stored (migration 0078) and shown on the
  Tournament pages; My Stats reports it too.
- **Tournament recognition in every game language**: the race counter and results banners of 12 locales, the
  class-badge track screens, the cup end screen saved by both tools, and a Nintendo Switch 2 Album/picture/video
  screen ignored like a Switch 1 gallery.
- **Players picked with context** (Web and Android): a typed name shows the existing Players with their nights,
  Directors and claim state, nothing links by name alone, display names may repeat after a confirmation (the
  username gets a suffix), and aliases belong to a Director (migration 0079).
- **CI** also builds the browser scanner and the Android APK and compiles the LiveTrial and Tournament sources.
- **Claims with Director review** (request, question and answer, release and revoke; migrations 0076-0077).
- **Native clients at the current level**: Android, LiveTrial and the Tournament tools build from this repository
  with the central reader and the asset collection (Clean Assets v5.9 and the central recognition pack
  0.4.1-20261101); see [Client builds](docs/CLIENT_BUILDS.md).
- **Central reader** (`packages/icon-matcher/`): one recognition core for characters, karts, flags,
  times, lap grids and frame geometry, implemented in Python, TypeScript and Java with shared parity
  vectors. The browser scanner, the Android app, LiveTrial and the Tournament tools all use it.
- Open-set "Mii" suggestion: when no catalog character fits a result card or Tournament score row well,
  the reader suggests a Mii instead of a look-alike character.
- Browser scanner: lap-circle and sparse-lap recovery, optical card-edge and photo candidates,
  remembered console language for the locale vote, and catalog IDs for tyres and flags in the hand-off
  to the website.
- Tournament reports: the classic WordPress export (the original Seating & Standings Manager layout)
  next to the modern export, and a WordPress export formatter.
- API: score-workbook import improvements for Tournament step 9.
- Repository: `SECURITY.md`, `CODE_OF_CONDUCT.md`, this changelog, a pull-request template and a
  feature-request template.
- **Public recognition test set** (`packages/assets/test-set`): twelve labelled screens in seven console languages
  and the scorer `tooling/test-set/score_test_set.mjs`, which reads them with the browser scanner and runs in CI.

- **Build the host package from a clone and remove an installation**: [Host a community server](docs/guides/HOSTING.md)
  gives the image builds and `host_bundle.py` call (`--list-images` prints the tags it packages) and a removal
  procedure; [Developer guide](docs/DEVELOPMENT.md) explains where UI text and translations live.

- **Translation helper**: `build_web_catalogs.mjs` lists each web text a translation file lacks, and
  `--fill-missing` adds the English as a stand-in, so a changed English text no longer fails the catalog test
  without a hint; `extract_web_messages.mjs --check` runs in CI.
- Release drafts carry the user guides and the Android notices ZIP; [Release packages](docs/RELEASE_PACKAGES.md)
  has a publishing checklist that refreshes `SHA256SUMS.txt` after the server packages are attached.

### Changed

- The night report's address is `?night-report=`, with capability `tournament.analytics.night_report`
  (migration 0074) and API schema `mk8dx.tournament-night-report.v1`.
- No compatibility fallbacks for retired clients and links: the night report's first link alias and `?settings=1&onboarding=1` are no
  longer recognised, the roster-player-lookup routes are gone, and a Tournament's seeding is only `seedingSource`
  (the `seedOrder` field is refused; Android 2.92.0 and newer). Data stored on phones and PCs is still read.
- The classic WordPress export's files are `styles/classic-report-*`.
- Reference data for new installations: World Records as of 2026-10-31; three Nintendo Ghost Staff flags and two
  tyres follow the game catalog.
- No Git LFS any more: the scanner model (over GitHub's 100 MiB file limit) is stored in two parts that the
  asset tools join and check on first use, so a plain clone or GitHub's source zip is complete.
- Documentation rewritten for a public audience: one status statement, release-independent installation
  pointers, and internal process documents removed.
- The intake tool treats a new source file that is byte-identical to the existing public file as already
  present instead of as a conflict.
- Documentation: a guide per user group (community hosts, Tournament Directors, players, LiveTrial users;
  `docs/guides/`) routed from the README, a developer setup for Windows, Linux and macOS (macOS untested) with a
  troubleshooting table, the MySQL integration test procedure in `docs/TESTING.md`, `tooling/README.md`, and
  `tooling/check_docs.py` (links and stated migration counts) in CI.
- `compatibility.json` names the public product version (`productVersion`, the release candidate that
  *Unreleased* becomes: `0.1.0-rc.8`) instead of a maintainer-internal commit (`ecosystemRelease`).
- Tests and sample data use synthetic player names; historical data migrations 0048, 0049 and 0057 are published
  without the names of community members (0048 under the neutral name `0048_split_tournament_identity`).
- Source files use LF line endings; `.gitattributes` keeps every byte exact (`-text`) so hash-pinned files verify.

### Security

- `backend/api`: better-auth 1.7.0 → 1.7.15 (advisories GHSA-965c-763c-88jm and GHSA-r4xp-prcw-77qf; the affected
  OAuth flows are not enabled here), fastify 5.12.8, nodemailer 10.3.1, zod 4.6.6 and fast-uri via overrides.
  Migration 0083 makes `mk8dx_auth_account.issuer` optional, which better-auth 1.7.3+ requires.
  `npm audit --omit=dev`: no high or critical advisories; eight moderate ones remain through exceljs 4.4.0 (latest).

### Fixed

- **Updating a host installation kept the old images** when the new package used the same image tags. The
  launchers now load a package's images on its first start (noted in `images/loaded.txt`), and again only when an
  image is missing. The launchers also report a stopped Docker engine instead of
  failing later at image loading.
- Documentation from a newcomer test: removing a Windows installation, FFmpeg for LiveTrial live capture,
  which APK to download, the release file names in the user guides, `--wait` when starting the API and website,
  common commands for coding agents, and `messages.source.json` without line numbers (no unrelated changes in
  pull requests).
- Tournament Live: after switching from one of the translated languages back to English or another language, the
  window's buttons and labels stayed in the previous language; they now follow the switch.
- Getting started waits for a healthy MySQL (`up -d --wait`) before the migrations; `.venv` is ignored by Git and
  by the privacy scan, which failed with the documented in-repository virtual environment.
- Linux installations: migrations, seeds and the first-administrator step failed with "Permission denied" on
  `/run/mk8dx/operator.json`, because the API container's user cannot read the 0600 file on a Linux Docker
  Engine. The file is now readable inside the private 0700 installation directory (Windows unchanged).
- The production example in Operations used an installation directory inside the repository, which the
  installer refuses; the user guides no longer state a fixed number of migrations.
- CI: the privacy scan admits the public test set through a reviewed SHA-256/size list
  (`packages/assets/test-set/test-set-files-v1.json`); the Tournament package job's output path no longer
  contains a TAB character; the LiveTrial desktop tests and the tooling tests run in CI. New gates: gitleaks over
  the history, `npm audit --omit=dev --audit-level=high`, CodeQL and Dependabot; a release is only built from a
  commit that passed Verify.
- World Records: the daily import no longer rejects the whole snapshot when a record was set the same day
  ("<1" days old) or lists coins and mushrooms in another grouping than one per lap (stored as unknown,
  migration 0075).
- A Web test that expected summer time for a Tournament start in Amsterdam failed after the change to
  winter time.
- A scanner built from this repository stopped on a screen with Korean, Chinese or Russian names: the asset
  collection now carries those OCR languages too, and `npm run sync-assets` stages them with the shared field reader.
- The night report editor keeps the written block in place after Apply.
- Tournament group and tier names show in the reader's language everywhere (a stored "Kampioen" appeared on
  English cards); the tier names have translations in all 15 languages.
- Choose a Cup on a phone puts the 150cc/200cc choice beside the title; the track page drops the figure block
  above the board and keeps previous / all tracks / next on one row; an installed web app is named
  "MK8DX Time Trials".

## 0.1.0-rc.7 — 2026-10-02

- Web: the evidence column shows a TV-with-play-button mark that links to a run's YouTube video, also for
  World Records on a phone and in the record's details.

## 0.1.0-rc.6 — 2026-10-02

- LiveTrial: the History page waits for its server after a restart.

## 0.1.0-rc.5 — 2026-10-02

- Documentation: the local Linux and macOS scope is described explicitly.

## 0.1.0-rc.4 — 2026-10-02

- Installer: shows the local addresses after setup. LiveTrial restarts after switching to another community.

## 0.1.0-rc.2 and rc.3 — 2026-10-01/02

- Portable CI verification and updated installation guides; LiveTrial restart behaviour clarified.

## 0.1.0-rc.1 — 2026-10-01

First release candidate: website, API and MySQL schema (73 migrations), browser scanner, Android app,
LiveTrial desktop client, Tournament Processor, Live and Connect, the installer with Docker, XAMPP/Node.js
and shared-hosting routes, and one versioned internal asset collection. Fresh installations start with the
Nintendo Ghost Staff and World Records reference sets and no community accounts or results.
