# Remediation plan for the open-source release

> **Current status (2026-11-03):** the [re-audit](re-audit-2026-11-03.md) re-checked every finding with evidence
> (verdict: Conditional Go). Where the status column below differs, the re-audit is the newer source.

This plan turns the findings in [open-source-readiness.md](open-source-readiness.md) into work items. Finding IDs (B1, H2, …) refer to that report.

The plan follows four principles:

- Existing behaviour stays unless the owner explicitly approves a change.
- Each item has an acceptance criterion that a reviewer can observe.
- Items that can cause functional regressions are flagged and get an explicit regression check.
- Large refactors for style alone are out of scope. Code is split only where tests are being added anyway.

## Phases at a glance

| Phase | Goal | Gate |
| --- | --- | --- |
| **P0: Release blockers** | Remove what makes publication unsafe or unlawful, and make CI trustworthy. | All P0 acceptance criteria met, then one fully green `Verify` run on GitHub. This is the move from **No-Go** to **Conditional Go**. |
| **P1: Quick wins** | Small, low-risk changes that remove contributor friction. Each takes about one day or less. | Before or shortly after the public announcement. |
| **P2: Structural work** | Test coverage, release reproducibility, governance. | Tracked as public issues after release. |

## Status (first remediation pass, 2026-11-02)

The findings and steps below are unchanged; this table records what was done. *Upstream* means the file comes
from the maintainer's own tree through `tooling/intake.py` and must be changed there (an edit here would create
an intake conflict). Commit references are on `main`.

| Item | Status | Notes |
| --- | --- | --- |
| P0-1 a | **Done** | `packages/assets/test-set/test-set-files-v1.json` lists the 12 images with SHA-256 and size; `privacy_scan.py` admits exactly those bytes in that folder and nothing else (unlisted, changed or missing file fails; the list cannot admit paths outside the folder). Unit test in `tooling/tests`. The private-marker lines were not touched. |
| P0-1 b | **Needs upstream change** | `packages/icon-matcher/python/tests/test_card_quad.py` (lines 24 and 28) compares floats exactly; compare with a relative tolerance of `1e-9` as the TypeScript port and the Java test (`CardQuadParityTest.java:27`) already do. Still fails on Linux (reproduced in `python:3.12-bookworm`). |
| P0-1 c | **Done** | `verify.yml` builds the output path with `Join-Path`. The package build with that exact argument was run on Windows from a clean clone. |
| P0-1 d | **Partly done; JS test needs upstream change** | The Python LiveTrial suite runs in CI (new `livetrial-tests` job on `windows-2022`, `PYTHONPATH=apps/timetrials-desktop`; one test asserts Windows paths, so not on Linux) and is documented in TESTING.md. `apps/timetrials-desktop/tests/history-startup.test.js` (upstream) fails because its VM context lacks `navigateFrame`, which `reloadHistory` now calls and `pollApp` swallows as an error: add `navigateFrame: (_id, url) => { src = url; },` after `renderCaptureBar: () => {},` (line 33); then add `node apps/timetrials-desktop/tests/history-startup.test.js` to the job. Verified with a patched copy. `engine-overlay/livetrial/tests/test_names.py` needs the full engine snapshot and Clean Assets database and cannot run from this tree. |
| P0-1 e | **Open (maintainer)** | Needs a push and an observed green run. Expected red until P0-1 b, P0-2 (npm audit gate) and the upstream fixes arrive. |
| P0-2 | **Deferred (maintainer)** | Done in the maintainer's tree; arrives through intake. Until then the new `npm-audit` job fails for `backend/api`. |
| P0-3 | **Done** | The owner is the author of the Seating & Standings Manager and contributes the three `classic-report-*` files under MPL-2.0; recorded with an SPDX-style statement in `docs/THIRD_PARTY_MATERIALS.md` (the stale `erik-classic-*` row is gone). The files themselves are upstream and unchanged. A REUSE entry follows with P2-7. |
| P0-4 a, c, d, e | **Deferred (maintainer)** | Handled by the maintainer elsewhere; migration 0048, the test fixtures and the private markers in `tooling/privacy_scan.py` were not touched. |
| P0-4 b, f | **Open (maintainer)** | Depend on the decision for a. |
| P0-5 a | **Open (maintainer)** | History and remote choice. |
| P0-5 b | **Done** | `compatibility.json` has `productVersion: 0.1.0-rc.8` instead of `ecosystemRelease`; nothing read the old field (`git grep`). Version policy in `docs/RELEASE_PACKAGES.md`. |
| P1-1 | **`.editorconfig` done; normalization deferred** | `.editorconfig` matches the existing indentation and leaves `end_of_line` and trailing whitespace alone. `.gitattributes` is `* -text`: checkouts are byte-identical to the commit even with `core.autocrlf=true` (the Git for Windows default, under which all 82 migration files failed their catalog SHA-256 in a fresh clone; with the file, 0). No tracked file changes (`git status` clean in a fresh clone; `git ls-files --eol` unchanged). Full normalization (`text=auto eol=lf`) is deferred: 169 of the 193 CRLF/mixed files are upstream, and with a `text` attribute Git would store different bytes than the intake tool writes, so a CRLF file from upstream would become an intake conflict on the next checkout. Normalize upstream first, then switch the attribute here. |
| P1-2 | **Partly done; `gradlew` needs upstream change** | `tooling/start-mk8dx.sh` is 100755. `apps/timetrials-android/gradlew` is upstream: `git update-index --chmod=+x` there. Docs and CI keep `bash ./gradlew`. |
| P1-3 | **Done, except the scanner description (upstream)** | Migration counts, Operations' README references, the THIRD_PARTY file name, the collection version in `packages/assets/README.md`, the `repository/` wording and English links to Dutch-only pages are fixed. `tooling/check_docs.py` (in CI) checks relative links, heading anchors and stated migration counts. `apps/timetrials-scanner-web/package.json:5` still says "feasibility build" (upstream). |
| P1-4 | **Done** | Troubleshooting table in `docs/DEVELOPMENT.md` (Dutch summary in DEVELOPMENT_NL.md). |
| P1-5 | **Done, except `engines` (upstream)** | `requirements-dev.txt` (CI installs it), `.nvmrc`, `.python-version`. `backend/api/package.json` and `apps/timetrials-web/package.json` (upstream) still have `"engines": {"node": ">=20"}`; set `">=24"`. |
| P1-6 | **Done** | `docs/TESTING.md` documents the variables, pre-migration, the `_rotation_contract` and fresh-schema rules and a one-schema-per-suite procedure; all 34 suites (all but `reference-seed`) passed with it on MySQL 8.4.11. |
| P1-7 | **Not started** | Out of this pass's scope; the egg-info files are upstream. |
| P1-8 | **Done** | Dependabot, gitleaks (v8.28.0 by digest, reviewed allowlist `.gitleaks.toml`; 0 findings over all refs locally, real-looking secrets still reported), `npm audit --omit=dev --audit-level=high` per npm project, CodeQL (Java in build mode none; Kotlin not analysed). CodeQL results need a public repository or GHAS. |
| P1-9 | **Done** | `.github/CODEOWNERS`, `SUPPORT.md`, `.github/ISSUE_TEMPLATE/config.yml` (no blank issues, private vulnerability link), AI-assisted contributions in CONTRIBUTING and the PR checklist. |
| P1-10 | **Done** | `tooling/README.md`. |
| P1-11 | **Done** | `timeout-minutes` and `concurrency` on every workflow; `release.yml` builds nothing unless the tagged commit has a successful Verify run. |
| P1-12 | **Done** | ML Kit terms, the MKWRS World Records source and daily refresh, and the ONNX model's provenance (unknown) in THIRD_PARTY. |
| Linux host route | **Fixed and demonstrated** | Found while demonstrating the Linux host route for the user guides: on a Linux Docker Engine, migrations, seeds and the first-administrator step failed (`Permission denied` on `/run/mk8dx/operator.json`). Fixed in `tooling/install.py`/`lifecycle.py`; then the source route and a host package built from this tree ran end to end on Linux (see `docs/guides/HOSTING.md`). |
| P2-1 to P2-11 | **Not started** | Tracked for after publication. |

## P0: Release blockers (before publication)

### P0-1. Make CI green and keep it honest (B1)

| Step | Change | Acceptance criterion |
| --- | --- | --- |
| a | Admit the public test set through a reviewed allowlist. For example, `packages/assets/test-set/manifest.json` with SHA-256 and size per file, read by `tooling/privacy_scan.py` in the same way as `native-binaries-v1.json`. Any unlisted or changed file must still fail. | `python tooling/privacy_scan.py` exits 0 on a clean clone. Adding an unlisted PNG anywhere makes it exit 1. |
| b | Compare floats in the Python parity tests (`packages/icon-matcher/python/tests/test_card_quad.py:24` and any sibling test with exact float equality) with the same relative tolerance the TypeScript port uses (`1e-9`, `ts/card_quad_parity.mjs:8`). Check the Java parity tests for the same pattern. | The Python tests pass on `ubuntu-24.04` and `windows-2022` with the CI pins. Changing a recorded vector value by 1e-6 still fails. |
| c | Replace the TAB in `.github/workflows/verify.yml:110` with `(Join-Path $env:RUNNER_TEMP 'tournament-package')`. | The `tournament-package` job succeeds on GitHub. |
| d | Fix or remove `apps/timetrials-desktop/tests/history-startup.test.js`, and add the two LiveTrial test commands, with the correct `PYTHONPATH`, to CI and TESTING.md. | Both LiveTrial suites pass locally and in CI. |
| e | Push the branch privately and observe a complete run before going public. | A `Verify` run is fully green: source, scanner, android, windows-clients, tournament-package and docker-images. The run URL is recorded in the release notes. |

**Regression risk.** Low. Step b loosens a comparison. Keep the tolerance tight (`1e-9` relative) so that real divergence between the Python, TypeScript and Java readers is still detected.

### P0-2. Patch the authentication dependency (B2)

| Step | Change | Acceptance criterion |
| --- | --- | --- |
| a | Upgrade `better-auth` (backend/api) to at least 1.7.7. Upgrade `fastify` and `nodemailer` to their patched versions, and refresh the transitive `zod`. Keep exact pins. | `npm audit --omit=dev --audit-level=high` in `backend/api` reports 0 high and 0 critical. |
| b | Rerun the API unit tests, the 34 MySQL integration suites (procedure in P1-6), and a real-browser magic-link sign-in plus the Android device-authorization approval against a local installation. | All pass. The magic link signs in, a reused or expired link is refused, device approval works, and the rate limits in `embedded-passwordless-auth.ts:323-324` still apply. |
| c | Record the fix in CHANGELOG.md under *Security*. | A changelog entry exists. |

**Regression risk: high.** Authentication changes affect every client: Web, Android, LiveTrial and Tournament Connect. Treat this as a coordinated release and test all four sign-in paths before tagging. Do not change auth configuration in the same change.

### P0-3. Resolve the license of the vendored classic export (B3)

**Owner decision required.**

| Option | Change | Acceptance criterion |
| --- | --- | --- |
| A (preferred) | Get a written license or permission from the author of the Seating & Standings Manager. Add it next to the files (`apps/timetrials-web/styles/CLASSIC_REPORT_LICENSE` or a REUSE entry) and update `docs/THIRD_PARTY_MATERIALS.md:29`, which also has the stale file name. | A license file or permission statement covers `classic-report-export.js`, `classic-report-export-css.txt` and `classic-report-catalog.json`. The THIRD_PARTY row no longer says "being confirmed". |
| B (fallback) | Exclude the three files from the public tree and packages, and keep them only in the maintainer's private installation. | The public tree and the full-source archive do not contain them. The classic export is disabled with a clear message. The modern export and the WordPress formatter keep working (Web tests plus a browser check of the Step 10 report). |

**Regression risk.** Option B removes a working feature. That is only acceptable with explicit owner approval.

### P0-4. Remove personal data from what will become public history (B4)

**Owner decision required.**

| Step | Change | Acceptance criterion |
| --- | --- | --- |
| a | Decide for migration `0048` (`infrastructure/mysql/migrations/0048_*`; its file name contains the name too, so a neutralized version also needs a new file name with a catalog alias): record the person's consent, **or** publish a neutralized text. The neutralized text has the same statements and a placeholder identity. It affects zero rows on any fresh database, just as the current text does. | Either a consent record exists (kept privately), or the public file contains no personal name or handle. |
| b | If the text is neutralized: extend `migration-catalog-v1.json` handling with an explicit, reviewed alternative hash for that entry, for example an `acceptedPublicSha256` field, so that installations that already applied the original keep validating. Do **not** silently change `upSha256`. | A fresh installation migrates to 0082. An existing database that applied the original 0048 passes the migration check and `upgrade`. Tests cover both. |
| c | Move private markers (a person's name, a private domain) out of `tooling/privacy_scan.py:18-19` into the private intake policy, which already supports blocked patterns (`docs/MAINTAINER_INTAKE.md`). Keep only generic patterns in the public scanner. | `git grep` finds no private person or domain names in the public tree. The intake rehearsal (`tooling/test_intake.py`) still passes. |
| d | Confirm that the first names in test fixtures (for example `backend/api/test/score-workbook-import.test.ts` and the Android tournament tests) are synthetic, or replace them with clearly synthetic names in a mechanical, test-only change. | A short statement in the pull request, or fixtures renamed with all tests passing. |
| e | Review the legacy-community code paths (Firebase import, legacy rating replay, rating seeds tied to the former community domain) for embedded personal data. Code that only *processes* such data may stay. Embedded data must go. | `git grep` for the former community domain shows code and comments only, no player rows. |
| f | Publish from a history that never contained the original bytes. See P0-5. | The published history passes the grep checks above at every commit. |

**Regression risk: high** for step b, because migration integrity checks protect production databases. Test `upgrade` against a backup of a database that applied the original 0048 before releasing. Steps c–e have low risk.

### P0-5. Choose the public history and remote (H5, part of B4)

| Step | Change | Acceptance criterion |
| --- | --- | --- |
| a | Publish a single reviewed root commit, the same approach as the existing local `public-main-candidate`, or a new repository. Do this *after* P0-1 to P0-4. Re-tag the next release candidate on that history. | The public `main` starts from the reviewed root. Gitleaks over all published refs finds no real secret. The old private releases (`v0.1.0-rc.1` to `rc.7`) are deliberately either kept private or reissued. |
| b | Remove references to private commits from `compatibility.json:10` (`ecosystemRelease`). Record a public version instead. | `compatibility.json` contains no private identifiers. |

**Regression risk.** Medium. Existing clones of the private remote diverge. Tools that read `ecosystemRelease`, if any, need checking (`git grep ecosystemRelease`).

## P1: Quick wins (each about one day or less)

| ID | Change | Acceptance criterion | Regression risk |
| --- | --- | --- | --- |
| P1-1 (H6) | Add `.gitattributes`: `* text=auto eol=lf`; `*.cmd *.bat *.ps1 eol=crlf`; **`-text` for hash-pinned or binary paths**: `packages/assets/collection/**`, `infrastructure/mysql/migrations/**`, `infrastructure/mysql/reference/**`, `packages/icon-matcher/vectors/**`, `packages/assets/test-set/**`, `*.docx`, `*.png`, `*.woff2`, `*.ttf`, `*.onnx`. Add `.editorconfig`. Normalize in one dedicated commit. | `git ls-files --eol` shows no `i/mixed` and no `i/crlf` outside the intended CRLF types. `shared_asset_source.py verify`, `privacy_scan.py` and the migration catalog check still pass. | **Medium.** Normalizing a hash-pinned file would break its checksum. That is why the `-text` exclusions must land in the same commit, and the hash checks must be rerun. Windows `.cmd` launchers must stay runnable (double-click test). |
| P1-2 (H6) | `git update-index --chmod=+x apps/timetrials-android/gradlew tooling/start-mk8dx.sh` | `./gradlew --version` works on Linux in a fresh clone. | None. |
| P1-3 (M6) | Fix doc drift: "73 migrations" in the user guide and B1_VPS.md; the "README" references in OPERATIONS.md:11,62; the file name in THIRD_PARTY_MATERIALS.md:29; the `r8b` collection version in packages/assets/README.md; the "extracted repository/" wording in CLIENT_BUILDS.md:5; the scanner package description; links from English pages to Dutch-only `install/CLIENTS.md`. | A reviewer can follow every cross-reference. A small CI check compares the migration count in the docs with the catalog. | None. |
| P1-4 (M7) | Developer troubleshooting section in DEVELOPMENT.md: `MSYS_NO_PATHCONV=1` for Git Bash; `git config core.longpaths true` on Windows; that the website must be opened once after the magic link before the first-administrator CLI; the `PYTHONPATH` for LiveTrial tests; Docker port conflicts. | A newcomer can resolve each of the pitfalls met in this audit from the docs alone. | None. |
| P1-5 (M7) | Add `requirements-dev.txt` (pinned test dependencies for the central reader, LiveTrial and tooling tests), `.nvmrc` (24.12.0) and `.python-version` (3.12). Set `engines.node` to `>=24` in `backend/api/package.json`. | `pip install -r requirements-dev.txt` followed by the documented pytest commands passes. CI installs from the same file. | Low: `engines` only produces a warning by default. |
| P1-6 (H2) | Document the MySQL integration contract in TESTING.md: the `MK8DX_MYSQL_TEST_*` variables, pre-migrating with `migration-apply-main.js --fresh-empty-database`, the `_rotation_contract` schema, and a fresh schema for `tournament-operation`. | Following TESTING.md alone, all 34 suites pass on a disposable MySQL 8.4. | None. |
| P1-7 (M4) | Untrack the 22 `*.egg-info` files and add `*.egg-info/` to `.gitignore`. Delete `apps/timetrials-android/scan-runtime/engine-overlay/` after `git grep` and an Android build confirm it is unused. | A Tournament package build leaves `git status` clean. The Android APK builds and its unit tests pass. | Low. Verify `build_windows_package.py` does not read the tracked egg-info (it regenerates it). |
| P1-8 (M1, M2) | Add Dependabot (npm ×5, gradle, pip, github-actions), gitleaks with an allowlist for the known false positives, `npm audit --omit=dev --audit-level=high` per npm project, and CodeQL. | The workflows run on pull requests. Dependabot opens its first pull requests. Gitleaks reports 0. | None to runtime. |
| P1-9 (L3, L6) | Add CODEOWNERS, SUPPORT.md, `.github/ISSUE_TEMPLATE/config.yml` (security link, no blank issues), and an "AI-assisted contributions" paragraph in CONTRIBUTING (disclose AI use; the human author is responsible; the same checks apply). | GitHub's Community Standards page shows the items as complete. | None. |
| P1-10 (M9) | `tooling/README.md`: a table of scripts with audience (contributor, operator, maintainer-only) and private-data requirements. | Every top-level script in `tooling/` appears in the table. | None. |
| P1-11 (L5) | Add `timeout-minutes` and `concurrency` to the workflows. Make `release.yml` require that the tagged commit passed `Verify`, using a `workflow_run` or a required check. | A tag on a red commit does not create a draft release. | None. |
| P1-12 (M8) | Add Google ML Kit (proprietary terms) and the World Records data source and terms to `docs/THIRD_PARTY_MATERIALS.md`. State the ONNX model's provenance, or that it is unknown. | The table lists them. | None. |

## P2: Structural work (after publication, tracked as issues)

| ID | Change | Acceptance criterion | Regression risk |
| --- | --- | --- | --- |
| P2-1 (H1) | **Targeted tests for the Windows clients.** Start with pure, high-value logic: Tournament score and row parsing and consensus (`packages/tournament-extraction`), the Connect payload against `TournamentRaceResultV1`, the local outbox state machine, and the LiveTrial result-correction validation. Use synthetic fixtures and `packages/assets/test-set`. Run them on `windows-2022` in CI. | At least one test module per component listed in H1, running in CI. A deliberate break in each covered function fails CI. | None: tests only. Any refactor needed for testability should be minimal and behaviour-preserving, with a before/after replay on the public test set. |
| P2-2 (H2) | **CI database matrix.** A job with `mysql:8.4` and `mariadb:11.4` services and a script that creates and migrates one schema per suite. | All 34 suites run in CI on both engines, and the reference-seed suite is enabled with a synthetic config. | Low. MariaDB may expose real incompatibilities. Treat those as bugs and fix them, not as reasons to skip. |
| P2-3 (H3) | **Publish ADRs.** Add `docs/decisions/` with the 43 cited ADRs, sanitized, plus an index. Where an ADR cannot be published, replace the reference with a public rationale. Add a CI check that every `ADR-NNNN` reference resolves to a file. | `git grep -o 'ADR-[0-9]\{4\}'` references only existing files. | None. |
| P2-4 (H4) | **Reproducible server releases.** Build the host and non-Docker bundles in `release.yml` with the existing `tooling/release/host_bundle.py` and `non_docker_bundle.py`. Push images to GHCR. Derive the image tags used by `compose.yaml` and `tooling/start-mk8dx.sh` from the release version instead of hard-coding them. Add build-provenance attestations and an SBOM per artifact. Optionally sign the checksums (Sigstore). | A tag produces every package in the README table, except the maintainer-signed APK, from CI alone. `gh attestation verify` succeeds for each artifact. The host package from CI installs with `Start-MK8DX.cmd` and with `sh tooling/start-mk8dx.sh` on Ubuntu 24.04. | **Medium.** Changing image tags affects upgrades of existing installations. Keep the installer able to recognize the old tags, and test `upgrade` from the current release package. |
| P2-5 (H5) | **Governance of upstream and contributions.** Document in CONTRIBUTING how a merged public pull request reaches the maintainer's private tree, and the conflict policy (the intake tool already preserves public-only changes). Make intake commits smaller, with messages that describe the user-visible change. Optionally adopt Conventional Commits for new commits. | A test pull request merged publicly survives the next intake unchanged, demonstrated with the intake rehearsal or a dry run. | Low. |
| P2-6 (M5) | **Version policy.** One product SemVer (next: `0.1.0-rc.8` or `0.2.0`) plus a component version table in `compatibility.json` (Android, LiveTrial, Tournament Tools, scanner, API contract, migration level, asset collection). Add `license` metadata (`MPL-2.0`) to every package manifest. | The release notes show the product version and component versions. `npm pkg get license` returns `MPL-2.0`. | None. |
| P2-7 (M8, L2) | **REUSE compliance.** Add `REUSE.toml` that maps the MPL-2.0 code paths, the MIT vision runtime, Apache-2.0 models and Gradle wrapper, OFL fonts, and the Nintendo-derived collection (marked as not licensed by this project). Add `reuse lint` to CI. | `reuse lint` passes. | None. |
| P2-8 (M3) | **Docker gateway hardening.** Add a Content-Security-Policy to the production and LAN Caddyfiles. Pin base images by digest. Consider a non-root Caddy user. | Security headers are present. The scanner (WASM, workers), the classic report frame and the YouTube links still work in a browser check at 320/768/1440 in EN and NL. | **Medium.** A too-strict CSP breaks the scanner or the report export. Roll it out as `Content-Security-Policy-Report-Only` first. |
| P2-9 (M1) | **Unify central-reader runtime pins.** Use the same OpenCV and numpy versions for LiveTrial, Tournament and CI, or prove parity across the versions in CI. Lock LiveTrial's transitive dependencies (including torch CPU and CUDA variants) with hashes, as the Tournament lock file already does. | The parity tests run against each consumer's pinned versions in CI. LiveTrial builds from a hash-locked file. | **Medium.** Changing OpenCV in LiveTrial can shift recognition. Validate on the public test set and the maintainer's private corpus before release. |
| P2-10 (M7) | **One entry point for checks.** `python tooling/verify.py [--component api|web|scanner|reader|android|livetrial|tournament|db]`, which runs exactly the documented commands. Optionally add a devcontainer for the Linux and macOS source route. | A newcomer runs one command per component. CI calls the same script. | None. |
| P2-11 (L8) | Reduce the scanner's PWA precache to the shell. Runtime-cache the models with versioned URLs. | First install downloads less than 20 MB before the scanner opens. Offline scanning still works after the first scan. | **Medium.** Offline behaviour changes. Test on a phone with airplane mode after the first use. |

## Changes that can cause functional regressions

| Item | What could break | Required check |
| --- | --- | --- |
| P0-2 auth upgrade | Sign-in, device approval, sessions for Web, Android, LiveTrial and Tournament Connect | Unit tests, MySQL integration, and a real-browser and device sign-in on each client |
| P0-3 option B | Classic WordPress export disappears | Owner approval; Step 10 export check |
| P0-4b migration catalog | Upgrades of existing databases refused | `upgrade` against a backup that applied the original 0048; fresh install |
| P0-5 history rewrite | Existing clones and tags diverge | Communicate; reissue the release candidate on the new history |
| P1-1 EOL normalization | Hash-pinned files, `.cmd` launchers | Asset verify, privacy scan, migration catalog check, double-click launchers |
| P1-7 file removals | Package builds | Tournament package build, Android build |
| P2-4 image tags | Upgrades of installed host packages | `upgrade` from the current package with a verified backup |
| P2-8 CSP | Scanner and report frame | Browser checks in Report-Only mode first |
| P2-9 OpenCV pins | Recognition accuracy | Public test set, private corpus, parity vectors |
| P2-11 precache | Offline scanning | Phone test in airplane mode |

Everything else in this plan touches documentation, CI or tests only, and preserves existing functionality.

## Suggested order and effort

1. P0-1 (half a day) and P0-2 (one to two days, mostly testing), run in parallel.
2. P0-3 and P0-4 (owner decisions; implementation one to two days once decided).
3. P1-1 and P1-2 together with the P0 work, so the green CI run already includes them.
4. P0-5 (half a day), then publish as a release candidate with a green run → **Conditional Go**.
5. The remaining P1 items in the first week after publication; P2 as public issues, in the order P2-1, P2-2, P2-4, P2-3, then the rest.
