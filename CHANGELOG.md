# Changelog

All notable changes to MK8DX Ecosystem are recorded here. The first stable public package is
`0.1.0`; earlier `0.1.0-rc.N` tags are release candidates. Dates are in ISO format.

## Unreleased

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
