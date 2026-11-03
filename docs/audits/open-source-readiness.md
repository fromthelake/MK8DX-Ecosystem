# Open-source release readiness audit

> **Historical report (2026-11-02).** It describes the tree and history before the fixes and before the
> public history was made (one new root commit, without the older commits it mentions). The
> [re-audit](re-audit-2026-11-03.md) re-checked every finding; read it for the current status.

| | |
| --- | --- |
| Repository | `MK8DX_OpenSource/repository`, branch `main` |
| Audited commit | `fdafb01` (tree `22ca5ee8`, identical to the local branch `public-main-candidate`) |
| Audit date | 2026-11-02 |
| Scope | This repository only. Maintainer-private folders next to it were not read or used. |
| Audit host | Windows 11, Git Bash and PowerShell 7, Node 24.12.0, Python 3.12.10, Docker Desktop 29.7.2 (Linux engine), JDK 17, Android SDK 36. WSL has only the `docker-desktop` distribution (no Ubuntu), so Linux was exercised in Docker containers. No macOS machine was available. |
| Companion | [Remediation plan](remediation-plan.md) |

## 1. Verdict

**No-Go for a public release of `fdafb01` as it stands. It becomes a Conditional Go once the four blockers below are resolved.** None of the blockers requires a redesign, and most can be fixed within days.

The engineering base is better than most hobby projects at this stage. The repository has a clear README and audience split, a security policy, a code of conduct, issue and pull-request templates, a changelog, a coherent architecture map with an enforced import-boundary check, pinned GitHub Actions, about 2,900 automated tests across TypeScript, Python, Kotlin and Java, and a privacy gate. On a fresh clone, the documented developer route worked from start to finish on Windows: source images built, migrations ran, a magic-link sign-in worked in a real browser, and the first-administrator grant succeeded.

What blocks a release is a short list of concrete defects:

1. **CI is red on `HEAD`, and the current workflow has never run on GitHub.** `privacy_scan` fails, a Python parity test fails on Linux, and the Windows package job's output path contains a literal TAB character.
2. **The production authentication dependency has a published critical advisory**, and the affected plugin (magic link) is in use.
3. **About 423 KB of third-party code is vendored without a confirmed license.** This is the classic WordPress export copied from another project.
4. **The source contains personal data about identifiable community members.** That includes a hash-pinned, append-only SQL migration named after one player.

Section 4 lists the High findings: no tests for the roughly 51,000 lines of Tournament Python, no database tests in CI, ADRs that are referenced 376 times but absent, server release artifacts built by hand, an unclear upstream and contribution flow, and line-ending and lint hygiene.

## 2. How this audit was done

Inspection came first, followed by the repository's own documented commands on a **fresh `git clone` in a temporary folder outside the repository**. The audited working tree was not modified: its ignored-file inventory and `git status` were identical before and after the audit. The only files written into the repository are this report and the remediation plan. All Docker containers, volumes and source images created for the audit were removed afterwards.

A step counts as **demonstrated** only if it was run and observed to succeed. Everything else is marked as reviewed (read only) or inferred.

### 2.1 Demonstrated results

| Check (documented command) | Platform | Result |
| --- | --- | --- |
| `python tooling/assets/shared_asset_source.py verify` | Windows | Pass: 7,025 objects verified; the split ONNX model was joined automatically. |
| `python tooling/privacy_scan.py` | Windows and Linux | **Fail (exit 1)**: 12 "unreviewed binary" findings, all in `packages/assets/test-set/`. |
| `python tooling/check_boundaries.py` | Windows and Linux | Pass: 15 components, 0 violations. |
| API `npm ci`, `typecheck`, `test`, `build` | Windows and Linux | Pass: 162 test files and 1,134 tests passed; 35 files and 97 tests skipped (opt-in MySQL). |
| Web `npm ci`, `typecheck`, `test`, `build` | Windows and Linux | Pass: 118 files and 1,014 tests passed, 9 todo. |
| Browser scanner `npm ci --ignore-scripts`, `sync-assets`, `typecheck`, `build` | Windows and Linux | Pass. The PWA precaches 609 entries (about 257 MB). |
| Public recognition test set `node tooling/test-set/score_test_set.mjs` | Windows | Pass: 12/12 frames match their labels. |
| Central reader, TypeScript (`node --test …`) | Windows and Linux | Pass: 53/53. |
| Central reader, Python (`pytest packages/icon-matcher/python/tests`) | Windows | Pass: 120 passed, 9 skipped. |
| Same, CI dependency pins | Linux (python:3.12-bookworm) | **Fail**: `test_card_quad.py::test_reproduces_recorded_vectors`. |
| CSS gate, design-token check, benchmark-manifest check, intake rehearsal (10 tests), `tooling/tests` (3 tests) | Windows and Linux | Pass. |
| `compileall` of the LiveTrial and Tournament sources (the CI job) | Linux | Pass. |
| Android `:app:testDebugUnitTest :scan-runtime:testDebugUnitTest :app:assembleDebug` | Windows, JDK 17 | Pass: 679 unit tests, 8 skipped, 0 failed; debug APK built. |
| Tournament package `build_windows_package.py --no-zip` | Windows | Pass: four wheels plus installer. **The build modified two tracked files** (`*.egg-info/SOURCES.txt`). |
| LiveTrial package `build_windows_package.py` (fresh venv, official embeddable Python) | Windows | Pass: 15,573 files, about 1.0 GB. |
| LiveTrial tests in `apps/timetrials-desktop/tests` | Windows | Python: 5 passed, but only with an undocumented `PYTHONPATH`. JS: **`history-startup.test.js` fails** at line 45. |
| Getting Started steps 1–7: installer `init`, `compose config`, `build api web`, MySQL and Mailpit, `--fresh-empty-database` migrations (82 catalog entries), reference seeds, `up api web` | Windows + Docker | Pass: `{"status":"ready"}`; Home 200; `/scanner/` 200; seeds `applied`. |
| Getting Started step 8: Mailpit magic link in a real browser (Playwright Chromium), then the first-administrator CLI | Windows + Docker | Pass: `created`; repeat gives `unchanged`. See finding M7 for a pitfall. |
| `backend/api/test/local-compose.browser.mjs` | Windows + Docker | Pass: 4 routes × widths 320/375/768/1440 × EN/NL, 0 page errors. |
| API MySQL integration suites (`MK8DX_MYSQL_INTEGRATION=1`) against a disposable MySQL 8.4.11 | Windows + Docker | Pass, after a setup procedure that had to be inferred (H2): 34 suites; `reference-seed` skipped (needs its own config). |
| `tooling/install.py init` and `status` on Linux | Linux container | Pass; private files written with mode 0600. |
| A small change (add a KB branch to `formatBytes`), then the affected test file, `typecheck`, the boundary check and `git diff --check` | Windows clone | Pass, then reverted. The edit exposed the mixed-EOL problem in H6. |
| Secret scan of all refs (gitleaks 8.28, redacted) | Docker | 176 `generic-api-key` hits, all false positives on manual triage (`iconKey`, storage-key constants, synthetic test tokens). No real credential found. |
| `npm audit` (API, Web, scanner) | Windows | See B2 and M1. |

### 2.2 Not demonstrated, and why

| Item | Reason |
| --- | --- |
| Any macOS step | No macOS machine was available. The macOS sections of the user guide (`docs/install/MK8DX_User_Guide_EN.txt`, "Use macOS") were reviewed as documentation only. |
| Linux Docker *host package* launcher `tooling/start-mk8dx.sh` on a real Ubuntu host | It needs the release image bundle (`images/docker-images-amd64.tar`, `start-mk8dx.sh:10-13`), which a source checkout does not have and CI does not build (H4). No Ubuntu VM or WSL distribution was available. The server containers themselves ran on Docker Desktop's Linux engine. |
| MariaDB 11.4 compatibility (the documented shared-hosting engine) | Only MySQL 8.4.11 was tested. No MariaDB test exists in the repository or in CI. |
| XAMPP/Node route (A3), shared hosting (B2), LAN (A2), production TLS (B1) | These need XAMPP/Apache configuration, a public DNS name, real SMTP or a hosting account. Out of proportion for this audit. |
| Android APK on a device or emulator; LiveTrial with a capture card; Tournament Live capture; installing and running the Tournament package | They need hardware or long interactive sessions. Only the builds were demonstrated. |
| GitHub-side behaviour: workflow runs, the release workflow, private vulnerability reporting, branch protection, opening a pull request | Pushing was not permitted. The remote repository is private and its last Actions runs (2026-10-02) used an older workflow file (`Verify source candidate`). |
| Coverage percentages | No coverage tooling is configured. Counts of tests are reported instead of percentages. |

Some Docker base layers and Gradle caches were already warm on the audit host, so the measured times (`docker compose build` 66 s, Android 98 s) understate a newcomer's first run.

## 3. Release blockers

### B1. CI fails on `HEAD`, and the current workflow has never run

*Evidence*

- `python tooling/privacy_scan.py` exits 1 on `main`. The scanner admits binaries only when they appear in the collection manifest or `native-binaries-v1.json` (`tooling/privacy_scan.py:160-162`). The 12 images added to `packages/assets/test-set/` in `65144bf` are in neither. Because `.github/workflows/verify.yml:24-26` runs this check first, the whole `source` job fails.
- `packages/icon-matcher/python/tests/test_card_quad.py:24` compares floats for exact equality. On Linux with the CI pins (numpy 2.2.1, opencv-python-headless 4.10.0.84), it gets `6.5626985089374665` against the recorded `6.562698508937467`, a last-digit (ULP) difference from the platform's math library. The test passes on Windows. The TypeScript port of the same vectors already uses a relative tolerance of `1e-9` (`packages/icon-matcher/ts/card_quad_parity.mjs:8`).
- `.github/workflows/verify.yml:110` contains a literal TAB byte: `"$env:RUNNER_TEMP<TAB>ournament-package"`. A `\t` was probably converted into a TAB character. Windows rejects TAB in paths (reproduced: `OSError 22`), so the `tournament-package` job cannot succeed.
- `apps/timetrials-desktop/tests/history-startup.test.js:45` fails against the current `dashboard/app.js`. It is not part of CI, which is why it went stale.
- `gh run list` on the private remote shows its last runs on 2026-10-02 with a different workflow. The local `main` is a descendant of `origin/main` and about 29 commits ahead, so the current `Verify` workflow has never executed. `docs/TESTING.md:64-65` states that CI runs all these checks on every pull request.

*Why it blocks.* Every external pull request would start red. A contributor cannot tell their own breakage from existing breakage. The OpenSSF Best Practices "working automated test suite" criterion is not met in practice.

*Recommendation.*

- Admit the reviewed test set explicitly: a small reviewed list with SHA-256 values, the same mechanism as `native-binaries-v1.json`.
- Compare floats in the Python parity tests with the same tolerance the TypeScript port uses.
- Build the PowerShell path with `Join-Path`.
- Fix or delete the stale dashboard test.
- Do not publish until one complete green run of `Verify` has been observed on GitHub.

### B2. Known critical vulnerability in the production authentication library

*Evidence.* `backend/api/package.json:33` pins `better-auth` to `1.7.0`. `npm audit --omit=dev` reports:

- **GHSA-965c-763c-88jm (critical)**, "OAuth state can be used as a Magic Link to sign in as another user", affecting versions earlier than 1.7.7.
- **GHSA-r4xp-prcw-77qf (high)**, OAuth Proxy.

The API uses the `magicLink` plugin (`backend/api/src/authentication/embedded-passwordless-auth.ts:6`, `:349`). The production tree also has moderate advisories for `fastify` 5.12.3 (header validation bypass; HTTP/2 DoS) and `nodemailer` 10.0.12 (address-parser recipient injection), and a high advisory for the transitive `zod`. In total: 1 critical, 3 high, 13 moderate and 1 low. Whether the critical advisory is exploitable in this exact configuration was not verified.

*Why it blocks.* The project's own security policy promises fixes only on the latest release. Publishing with a known critical advisory in the sign-in path invites the exact reports listed under SECURITY.md's scope.

*Recommendation.* Upgrade `better-auth` to at least 1.7.7, plus `fastify`, `nodemailer` and the `zod` path. Rerun the unit suites, the 34 MySQL integration suites and a browser magic-link and device-authorization check. Add automated dependency monitoring (M1).

### B3. Vendored third-party code without a confirmed license

*Evidence*

- `apps/timetrials-web/styles/classic-report-export.js` (282 KB), `classic-report-export-css.txt` (81 KB) and `classic-report-catalog.json` (60 KB) are copies of another project's code, the "Seating & Standings Manager" (`apps/timetrials-web/CLASSIC_EXPORT_PROVENANCE.md`).
- `docs/THIRD_PARTY_MATERIALS.md:29` says: "its terms are being confirmed".
- `apps/timetrials-web/src/tournament-report-classic.ts` runs this code at runtime.

*Why it blocks.* This is not part of the owner's decision about game-derived assets. It is ordinary copyrighted source code by another author. Without a license or written permission, publishing it on GitHub and in the full-source package is a copyright problem in its own right, and a likely takedown trigger for the whole repository.

*Recommendation.* Get a license or written permission and record it next to the files, for example `LICENSE` or `NOTICE` plus an SPDX entry. Until then, the owner must decide whether to exclude these three files and the classic export from the public tree and packages. Excluding them removes a working feature, so it needs explicit approval.

### B4. Personal data about identifiable community members

*Evidence*

- Migration `0048` (`infrastructure/mysql/migrations/0048_*.up.sql` and `.down.sql`; the file name itself contains the name) names one specific player by handle and first name. They also describe that person's legacy race count and identity history. The migration is hash-pinned in `infrastructure/mysql/migration-catalog-v1.json`, and migrations are append-only by policy (AGENTS.md), so it cannot simply be edited.
- More migrations and source carry one community's history:
  - Firebase import and backout: 0012–0014;
  - legacy race history and placement ratings: 0025, 0026, 0046, 0057;
  - rating-seed identities tied to the former community domain: `backend/api/src/rating/*`, `backend/api/src/tournament-history/corrected-history-sql.ts`.
- `tooling/privacy_scan.py:18-19` embeds a private person's surname and a private domain, split into string halves so the scanner does not flag itself.
- Test fixtures use realistic first names, for example `backend/api/test/score-workbook-import.test.ts` and several Android tournament tests. The audit could not tell whether these are synthetic.

*Why it blocks.* The maintainer is in the EU. Publishing an identifiable person's handle, real first name and participation history in a permanent public Git history needs a lawful basis (realistically, consent) or removal. The project's own CODE_OF_CONDUCT.md forbids exactly this ("do not post other people's names … without their permission").

*Recommendation.* Owner decision required (see the plan, item P0-4). The safe options:

- **(a)** Get consent and record it.
- **(b)** Publish a neutralized version of 0048. On a fresh installation it affects zero rows, because its `WHERE` clauses target a row that does not exist there. The catalog would then need an explicit, reviewed "public text" hash entry, so existing private installations keep their original checksum.

In both cases, remove the name from `privacy_scan.py` by moving private markers into the private intake policy, which already exists for this purpose (`docs/MAINTAINER_INTAKE.md`). Confirm that the fixture names are synthetic. Publish from a history that never contained the original bytes (H5).

## 4. High findings

### H1. Windows client code has almost no automated tests, and CI only compiles it

| Component | Python/JS source lines (excluding tests) | Test files in the repository |
| --- | --- | --- |
| `apps/tournament-live` | 26,260 | 0 |
| `packages/tournament-extraction` | 23,478 | 0 |
| `packages/tournament-connected` | 1,212 | 0 |
| `apps/tournament-processor` | 365 | 0 |
| `packages/local-outbox` | 1,022 | 0 |
| `apps/timetrials-desktop` (LiveTrial) | 44,372 | 2 suites (one fails, see B1) |

CI runs only `python -m compileall` on these sources (`verify.yml:95`). Tournament Directors and LiveTrial users depend on this code, and `docs/TESTING.md:30` points to "the build and test steps in Client builds", but `docs/CLIENT_BUILDS.md` contains no test steps.

*Recommendation.* Start small and targeted. Add pytest suites around pure functions: score parsing, consensus, the export format, the outbox state machine and Connect's delivery payload against `TournamentRaceResultV1`. Use synthetic fixtures and the public test set. Run them in CI on `windows-2022`, and run the existing LiveTrial tests with the correct `PYTHONPATH`.

### H2. Database integration tests are not in CI, and their setup is undocumented

The 34 MySQL suites cover authentication, bindings, claims, SQL repositories, rating, the Tournament workflow and key rotation. They are skipped in CI. `docs/TESTING.md:44-49` mentions "private connection settings" but does not give the actual contract. The audit had to infer it:

- variables `MK8DX_MYSQL_TEST_HOST`, `_PORT`, `_USER`, `_PASSWORD` and `_DATABASE`;
- a schema that has already been migrated with `migration-apply-main.js --fresh-empty-database` (without this, 34 suites fail with "table doesn't exist");
- a schema named `*_rotation_contract` for `protected-value-rotation.integration.test.ts`;
- a fresh schema for `tournament-operation.integration.test.ts`, which fails on a shared schema with 10 participants instead of 8.

With that setup, all 34 suites passed on MySQL 8.4.11. The documented shared-hosting engine is MariaDB 11.4, which is not tested anywhere.

*Recommendation.* Add a CI job with `mysql:8.4` and `mariadb:11.4` services and a script that creates and migrates one schema per suite. Document the exact variables in TESTING.md.

### H3. Architecture Decision Records are referenced but absent

The code and the changelog reference **43 distinct ADR numbers in 376 files**. Examples: `backend/api/src/tournaments/tournament-operation-service.ts:1-6` (ADR-0160, -0147, -0155), migration 0048 (ADR-0178, ADR-0006) and `CHANGELOG.md` (ADR-0219 to ADR-0222). The repository has no `docs/decisions/` directory. External contributors cannot see why identity, claims, ratings or publication behave as they do. Those are exactly the areas where a well-meant change can cause damage.

*Recommendation.* Publish the ADRs that are cited, sanitized and as `docs/decisions/NNNN-title.md`. Where an ADR cannot be published, replace the reference with a one-paragraph rationale in the code or in a public ADR. Add a check that every `ADR-NNNN` reference resolves.

### H4. Server release artifacts are built by hand and cannot be verified against source

- `release.yml:3-5` says the host, XAMPP and shared-hosting packages and the signed APK are attached by hand from the maintainer's own image builds.
- The images are not published to a registry (`docs/GETTING_STARTED.md:92`).
- `tooling/start-mk8dx.sh:10-11` and the `compose.yaml` defaults hard-code date-stamped tags (`mk8dx/api:local-20261001-r13-amd64`, `mk8dx/web:local-20261002-r14-amd64`) that no workflow produces.
- There is no SBOM, signature or build-provenance attestation. The only integrity material is `SHA256SUMS.txt`, published in the same release.

For community hosts, the primary self-hosting audience, the most important artifact is therefore the least reproducible one.

*Recommendation.* Build the host and non-Docker bundles in `release.yml` (`tooling/release/host_bundle.py` and `non_docker_bundle.py` already exist). Push multi-tag images to GHCR and reference them by digest. Derive image tags from the release version. Add `actions/attest-build-provenance` and an SBOM (for example `anchore/sbom-action`). Make the release depend on a green `Verify` run.

### H5. The source of truth and contribution flow are unclear, and so is the history to publish

- `CONTRIBUTING.md:28-34` says pull requests are reviewed and merged in this repository.
- `docs/MAINTAINER_INTAKE.md:5-8` says the repository "is fed from the maintainer's own development tree" through `tooling/intake.py`.
- Recent history consists of bulk intake commits, for example `112c714` (134 files, +19,049 lines) and `e0d6e18` (+7,096). Their messages refer to private commits (`Intake v21 from master a1119ec3`), and `compatibility.json:10` records a private commit (`master-a1119ec3-…`).
- Contributors cannot review or bisect these changes, and the document does not say how a merged external pull request reaches the private tree.
- `main` still contains removed internal documents (for example `docs/release/SHOWTIME_RESTORE_STATUS.md`) and Git-LFS-era commits (`.gitattributes` was deleted later).
- The private GitHub remote already holds releases `v0.1.0-rc.1` to `rc.7`.
- A squashed `public-main-candidate` branch with the identical tree exists locally.

*Recommendation.* Decide and document one model. Either the public repository is upstream, or intake stays but CONTRIBUTING explains the round trip and conflict policy, and intake commits become smaller with descriptive messages. Publish from a reviewed single-root history (after B4). Remove private commit references from `compatibility.json`.

### H6. No line-ending, formatting or lint configuration; missing executable bits

- There is no `.gitattributes`, `.editorconfig`, ESLint/Prettier, Ruff/flake8 or ktlint/detekt configuration.
- The tracked text files include 128 CRLF files and **49 files with mixed line endings**. Examples: `apps/timetrials-web/src/app-downloads-view.ts`, `apps/timetrials-desktop/livetrial_product_runtime.py`, `apps/timetrials-web/Dockerfile`, and `.github/workflows/verify.yml`, which is CRLF.
- Demonstrated: a one-line edit saved with normalized line endings produced a **1,033-line diff**.
- `apps/timetrials-android/gradlew` and `tooling/start-mk8dx.sh` are stored with mode `100644`, so `./gradlew` fails on Linux and macOS. CI works around this with `bash ./gradlew` (`verify.yml:83`).
- Release launchers (`Start-MK8DX*.cmd`) are stored with LF.

*Recommendation.* Add `.gitattributes`:

- `* text=auto eol=lf`;
- `*.cmd`/`*.bat`/`*.ps1` with `eol=crlf`;
- **`-text` for every hash-pinned path**: `packages/assets/collection/**`, `infrastructure/mysql/migrations/**`, `infrastructure/mysql/reference/**`, `packages/icon-matcher/vectors/**`, `*.docx` and binary assets.

Add `.editorconfig`, then normalize in one dedicated commit. Set `git update-index --chmod=+x` on both scripts. Introduce formatters gradually: check only changed files at first.

## 5. Medium findings

| ID | Finding | Evidence | Recommendation |
| --- | --- | --- | --- |
| M1 | Dependency hygiene | No Dependabot or Renovate. `npm audit` is not in CI. Development tools are vulnerable in all three npm projects (vite 8.3.x, high; vitest ≤4.1.11). Python dependencies are not hash-locked. LiveTrial pins only top-level packages and leaves `torch` unpinned (`apps/timetrials-desktop/vision-runtime/requirements.txt`). Central-reader consumers use different OpenCV and numpy versions (LiveTrial 4.13.0.92 and 2.4.5; CI and Tournament 4.10.0.84 and 2.2.1) while parity tests compare exact floats. API `engines` is `>=20` while the docs require Node 24. | Dependabot for npm, Gradle, pip and Actions. An `npm audit --omit=dev --audit-level=high` gate. One OpenCV/numpy pin for every central-reader consumer. `engines: ">=24"`. |
| M2 | Security scanning is thin | `privacy_scan.py` has 4 secret regexes and some project-specific markers. No CodeQL or SAST, no gitleaks in CI, no OpenSSF Scorecard. | Add gitleaks (with an allowlist for the known false positives), CodeQL for JS/TS, Python and Java/Kotlin, and the Scorecard action. |
| M3 | Docker production gateway hardening | `infrastructure/docker/Caddyfile.production:33-36` sets HSTS, nosniff, Referrer-Policy and X-Frame-Options but **no Content-Security-Policy**. The Caddy image runs as root. Images are pinned by tag, not digest. | Add a CSP and test it against the classic export's hidden frame and the scanner's WASM. Pin images by digest. |
| M4 | Generated or duplicate files are tracked | 22 `*.egg-info` files are tracked and stale; the Tournament build rewrites two of them. Content-hashed i18n bundles in `apps/timetrials-web/styles/i18n-*-<hash>.json`. `apps/timetrials-android/scan-runtime/engine-overlay/` holds 5 files byte-identical to `engine-src/` that the build does not use (`scan-runtime/build.gradle.kts:34`). | Untrack the egg-info directories and ignore them. Document or generate the hashed bundles. Delete the unused overlay after confirming nothing reads it. |
| M5 | Versioning is not one coherent SemVer story | Last tag `v0.1.0-rc.7` (2026-10-02), while `main` has a long *Unreleased* feature list. Independent versions: Android 2.93.0 (build 159), LiveTrial 3.37.0, Tournament Tools 2.2.44, scanner `0.4.1-web.3`, packages 1.0.0, API and Web 0.1.0. No `license` field in any `package.json` or `pyproject.toml`. Commit messages do not follow Conventional Commits. | Document a version policy: product SemVer plus a component version table in `compatibility.json`, and cut the next RC from `main`. Add license metadata. Optionally adopt Conventional Commits for new commits. |
| M6 | Documentation drift | The user guide (lines 276 and 282) and `docs/install/B1_VPS.md:97` say "73 migrations"; the catalog has 82. `docs/OPERATIONS.md:11,62` points to commands "in the README" that are now in GETTING_STARTED. `docs/THIRD_PARTY_MATERIALS.md:29` names the removed `erik-classic-*` files. `packages/assets/README.md` says collection `r8b` while `compatibility.json` says `r9d`. `docs/CLIENT_BUILDS.md:5` says "extracted `repository/` directory". The scanner `package.json` still says "feasibility build". English pages link to Dutch-only `docs/install/CLIENTS.md`, and nine route pages in `docs/install/` exist only in Dutch. | Fix the texts. Generate numbers such as the migration count from the catalog. Add a docs-drift check to CI. |
| M7 | Onboarding ergonomics and troubleshooting | About 15 separate commands with no single "verify my change" entry point. No `.nvmrc`, `.python-version` or devcontainer. Test dependencies are listed only in prose (`docs/TESTING.md:41`). LiveTrial tests need `PYTHONPATH`. In Git Bash, `/app/...` arguments need `MSYS_NO_PATHCONV=1`. Deep Android build paths hit Windows long-path limits. The first-administrator CLI's message is deliberately generic (`installer-administrator-main.ts:90`): a magic link completed without the website loading leaves no UserAccount, and the CLI only says "refused". The scanner's Playwright `npm test` is undocumented. | Add `tooling/verify.py --component <name>` or a Makefile equivalent, a `requirements-dev.txt`, version files, and a developer troubleshooting section that covers the cases above. |
| M8 | Rights and provenance risks beyond the owner's asset decision | Scanner ONNX model: "training provenance is still being documented" (`docs/THIRD_PARTY_MATERIALS.md:24`). Android depends on proprietary Google ML Kit, which is not in the third-party table. `infrastructure/mysql/reference/world-records-v1.json` holds public leaderboard player names whose source terms are not stated. No per-file license metadata, although the repository mixes MPL code, MIT code and unlicensed game material. | Document the model's provenance. Add ML Kit and the leaderboard source to the table. Adopt REUSE (`REUSE.toml`) so per-path licensing is machine-readable. |
| M9 | Maintainer-only tooling is mixed into the public tree without an index | `tooling/` (about 60 scripts) has no README. It includes the intake tool, Firebase and legacy-rating importers (`backend/api/package.json` scripts `migration:firebase-*` and `rating:legacy-*`), and replay and template scorers that need private corpora. | Add a `tooling/README.md` that says who needs what. Mark maintainer-only scripts. |

## 6. Low findings

| ID | Finding | Evidence | Recommendation |
| --- | --- | --- | --- |
| L1 | Large blobs | 95.0 MB (`…1ab4350c….part1`) and 79.3 MB objects exceed GitHub's 50 MB warning size; the pack is about 280 MB. | Acceptable. Mention clone size in DEVELOPMENT.md and suggest `--filter=blob:none` for code-only work. |
| L2 | No SPDX headers | Two files carry `SPDX-License-Identifier`. MPL Exhibit A notices are root-level only (`LICENSE_SCOPE.md`). | Covered by REUSE (M8). |
| L3 | Community-standards extras | No `CODEOWNERS`, `SUPPORT.md`, issue-template `config.yml` or DCO/sign-off policy. Commits use a placeholder author email. | Add CODEOWNERS and SUPPORT. Decide on a DCO. |
| L4 | `innerHTML` templating in the LiveTrial dashboard | `apps/timetrials-desktop/dashboard/app.js:349-550`: some interpolations use `escapeHtml`, and consistency was not verified. | Review that every server-provided string is escaped. |
| L5 | Workflow robustness | No `timeout-minutes`, `concurrency` or `fail-fast` policy. `release.yml` does not depend on `Verify`. | Add them. |
| L6 | AI-agent guidance | `AGENTS.md` (6.4 KB), `CLAUDE.md` and `GEMINI.md` are concise and well scoped, but they instruct agents to run `privacy_scan.py`, which currently fails (B1). There is no policy on disclosing AI-assisted pull requests and no bot or automation policy. | Fix B1. Add a short "AI-assisted contributions" section to CONTRIBUTING. |
| L7 | Migration number gap | The catalog skips `0037`. | Note it in `infrastructure/mysql/README.md`. |
| L8 | Large PWA precache | The scanner build precaches about 257 MB (609 entries). | Consider precaching only the shell and runtime-caching models. |

## 7. Compared with industry conventions

| Standard | Current state | Gap |
| --- | --- | --- |
| GitHub Community Standards | README, LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, SECURITY, issue and PR templates present. | CODEOWNERS, SUPPORT and template `config.yml` missing (L3). |
| OpenSSF Best Practices (passing) | Met: FLOSS license, documentation, vulnerability reporting process, public bug tracker (once public), build and test suite, release notes. | Not met: working CI (B1), known vulnerabilities fixed (B2), static analysis (M2), warning and lint flags (H6). |
| OpenSSF Scorecard (anticipated) | Pinned actions and least-privilege `permissions:` are good. | No branch protection evidence, no SAST, no dependency-update tool, no signed releases. |
| Semantic Versioning | `0.1.0-rc.N` tags exist. | Component versions are uncoordinated; `main` is far ahead of the last tag (M5). |
| Conventional Commits | Not used. | Optional; useful for changelog generation. |
| SPDX / REUSE | One root license plus a scope document. | No per-file or per-path machine-readable licensing; no manifest license fields (M8, L2). |
| CI and automated testing | Broad unit tests for API, Web, Android and the central reader. | Red pipeline; no database or Windows-client tests (B1, H1, H2). |
| ADRs | Heavily referenced. | Absent from the repository (H3). |
| Reproducible environments | Pinned Node/Python/JDK in CI; pinned base images; lock files for npm. | No devcontainer or version files; Python not hash-locked; server images built by hand (M1, M7, H4). |
| Secure development | Fail-closed installer, secrets kept outside Git, non-root API image, CSRF, auth rate limits. | Critical auth advisory (B2); no CSP on the Docker gateway (M3). |

## 8. Developer onboarding challenge

| Goal | Status | Evidence |
| --- | --- | --- |
| Understand the purpose within five minutes | **Met (reviewed)** | README.md lines 1-29 explain the product, audience and self-hosting in plain language; the documentation table routes by intent. |
| Set up the environment from repository documentation only | **Demonstrated on Windows, with caveats.** Linux demonstrated for source builds and tests in containers. macOS documentation only. | DEVELOPMENT.md and TESTING.md were enough. Pitfalls: Python test dependencies only in prose, the `PYTHONPATH` for LiveTrial tests, `MSYS_NO_PATHCONV` in Git Bash, `gradlew` without its executable bit on Linux and macOS (M7, H6). |
| Build and run the software | **Demonstrated**: server from source with Docker (Getting Started steps 1–8), scanner, Android APK, Tournament and LiveTrial packages built. Not run on hardware. | Section 2.1. |
| Run and interpret automated tests | **Partly demonstrated.** Most suites pass with clear output. `privacy_scan` and one Linux parity test fail on a clean checkout, which would confuse a newcomer. Running the database tests needed reverse engineering. | B1, H2. |
| Identify the relevant module for a feature | **Met (demonstrated)** | `docs/architecture/COMPONENTS.md` source table, `component-registry.json`, `check_boundaries.py`. Finding `formatBytes` took two lookups. |
| Make a small change without breaking unrelated functionality | **Demonstrated, with friction.** Targeted test, typecheck and boundary check pass. The mixed line endings turned a one-line change into a 1,033-line diff. | H6. |
| Submit a compliant pull request | **Not demonstrated** (pushing not permitted). The template and checklist are clear, but its first checkbox (`privacy_scan` passes) cannot currently be ticked, and CI would be red. | B1, `.github/PULL_REQUEST_TEMPLATE.md`. |

## 9. Risks and technical debt

- **Legal and takedown risk (owner decision acknowledged).** Nintendo-derived assets are intentionally included. A takedown notice can disable the repository and every GitHub fork at once. The owner has decided to keep code and assets together. The existing rights-holder contact (`docs/THIRD_PARTY_MATERIALS.md` "Rights holders") and the exact-replacement design of the collection are reasonable mitigations. B3 and B4 add avoidable risk on top of that decision.
- **Bus factor.** One maintainer, and a private upstream (H5).
- **Very large modules.** For example `apps/timetrials-web/src/tournament-operation-view.ts` (7,896 lines), `backend/api/src/tournaments/tournament-operation-service.ts` (3,982), `apps/timetrials-android/.../AndroidTournamentScreen.kt` (3,841) and `apps/tournament-live/src/live_processor/qt_app.py` (3,788). The code that was sampled is readable and well commented, so splitting these is not recommended for style alone. Split them only where tests are added (H1).
- **Three central-reader implementations kept equal by exact parity vectors.** This is powerful, but it is sensitive to platform floating-point behaviour and library versions (B1, M1).
- **Hash-pinned, append-only migrations.** These provide strong integrity, but any content problem in an applied migration (B4) needs a deliberate catalog mechanism rather than an edit.
- **About 200 `MK8DX_*` environment variables.** The installer derives them, which is good, but there is no reference document for developers.

## 10. Summary of findings

| Severity | Count | IDs |
| --- | --- | --- |
| Blocker | 4 | B1 CI red, B2 critical auth advisory, B3 unlicensed vendored code, B4 personal data |
| High | 6 | H1 client tests, H2 database tests in CI, H3 ADRs, H4 release reproducibility, H5 upstream/history, H6 EOL/lint/exec bits |
| Medium | 9 | M1–M9 |
| Low | 8 | L1–L8 |
