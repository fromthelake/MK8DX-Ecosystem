# Changelog

All notable changes to MK8DX Ecosystem are recorded here. The first stable public package is
`0.1.0`; earlier `0.1.0-rc.N` tags are release candidates. Dates are in ISO format.

## Unreleased

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
