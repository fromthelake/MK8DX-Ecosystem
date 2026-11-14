# Testing

[Nederlandse versie](TESTING_NL.md)

Test what your change can affect, not everything. Find the component that owns the change and its reverse
consumers in [component-registry.json](../component-registry.json), then run the checks below for each of
them. A shared contract, catalog, CSS token or the central reader needs its provider **and** its consumers.
Skipped or "todo" tests are not passes. Set up Node and the Python test dependencies first
([Developer guide](DEVELOPMENT.md#clone-and-verify)); on Linux and macOS use `python3` where this page says `python`.

## Every change

```sh
python tooling/privacy_scan.py
python tooling/check_boundaries.py
python tooling/check_docs.py
git diff --check
```

For Docker gateway changes, validate all four `infrastructure/docker/Caddyfile.*` files with the pinned Caddy
image (supply a test `MK8DX_DOMAIN` for LAN/production, and for `Caddyfile.offline-lan` a `MK8DX_LAN_IP` plus a
throwaway CA under `/run/mk8dx/ca`). After a change to the gateway image or its entrypoint, start a disposable
Compose project (own project name, ports and volumes) on the previous image, recreate it on the new one and check
with `docker top` that Caddy does not run as root, that `/data` and `/config` hold no file of another owner, that
keys are still 0600 and that HTTPS serves the same root and leaf. Inspect the response headers on `/` and `/scanner/`
through a running container. Both the Web and the scanner policies are enforced. The scanner's policy has three
non-overlapping parts: the page and everything else under `/scanner/` (`script-src 'self'`, no eval, no WASM
compilation, no inline styles), `/scanner/ort/*` and `/scanner/tess/*` (worker scripts that only compile WASM:
`'wasm-unsafe-eval'`), and `/scanner/assets/worker/*` (the Vite worker entries, which load OpenCV.js; its
Emscripten/embind code needs `'unsafe-eval'`). A worker loaded from a URL runs under its own response's policy,
so the page never allows eval; the scanner therefore creates no `blob:` workers. After a scanner or gateway CSP
change, run a real gallery scan through the gateway (or a server sending the same headers per path) and check
that the page reports no `securitypolicyviolation` and that `new Function` is refused on the page. The scanner UI
sets styles only through CSSOM (`element.style.x = ...`), never a `style` attribute;
`tooling/tests/test_installation_routes.py` guards the policies and that rule. Before changing the Web policy,
exercise the classic Tournament report export in a real browser at 320, 768 and 1440 CSS pixels in English and
Dutch; inspect console CSP violations. Do not treat static Caddy validation as browser acceptance.
The classic export's `about:blank` preview inherits the Web page's existing meta CSP. In the 2026-11-04
Chromium qualification, the report generated successfully but 70 inline-style assignments were blocked by that
meta policy; the new gateway Report-Only policy added no violations. Record these separately and resolve or
explicitly accept their visual effect before claiming the classic preview is violation-free or enforcing a new
gateway policy. External YouTube links open a new tab; check navigation without requiring YouTube to load in a
test environment.

## Per component

| Component | Commands (from the repository root) |
| --- | --- |
| API (`backend/api`) | `npm ci --prefix backend/api`, then `npm run typecheck`, `npm test` and `npm run build` with `--prefix backend/api` |
| Website (`apps/timetrials-web`) | the same four commands with `--prefix apps/timetrials-web` |
| Shared CSS | `node tooling/design-system/css-metrics.mjs --check` |
| Browser scanner (`apps/timetrials-scanner-web`) | `npm ci --ignore-scripts`, `npm run sync-assets`, `npm run typecheck`, `npm run build` in that folder |
| Public recognition test set | `node tooling/test-set/score_test_set.mjs` after the scanner's `npm ci` and `sync-assets` and `npx --prefix apps/timetrials-scanner-web playwright install chromium` ([test set](../packages/assets/test-set/README.md)) |
| Central reader (`packages/icon-matcher`) | see below |
| Database migrations and seeds | `python tooling/reference/generate_benchmark_manifest.py --check`, plus the API's [MySQL integration tests](#database-integration-tests) |
| Design tokens (Web and Android) | `node packages/design-tokens/generate.mjs --check` |
| Installer, privacy scan (`tooling/`) | `python -m unittest discover -s tooling/tests` |
| Intake tool | `MK8DX_INTAKE_TEST_ROOT=<temporary folder outside the repository> python tooling/test_intake.py -v` |
| LiveTrial (`apps/timetrials-desktop`) | see below |
| Android, Tournament | the build and test steps in [Client builds](CLIENT_BUILDS.md) |

Central reader, TypeScript and Python:

```sh
node --experimental-strip-types --no-warnings \
  --experimental-loader ./packages/icon-matcher/ts/ts_resolve_hook.mjs \
  --test "packages/icon-matcher/ts/*.test.mjs"
PYTHONPATH=packages/icon-matcher/python python -m pytest -q packages/icon-matcher/python/tests
```

In PowerShell:

```powershell
node --experimental-strip-types --no-warnings --experimental-loader ./packages/icon-matcher/ts/ts_resolve_hook.mjs --test "packages/icon-matcher/ts/*.test.mjs"
$env:PYTHONPATH = "packages/icon-matcher/python"
python -m pytest -q packages/icon-matcher/python/tests
Remove-Item Env:PYTHONPATH
```

The Python tests need the pinned packages in [requirements-dev.txt](../requirements-dev.txt). Tests that use
private evaluation images skip when those are not configured.

LiveTrial desktop tests (Windows; one test asserts Windows paths):

```powershell
$env:PYTHONPATH = "apps/timetrials-desktop"
python -m pytest -q -p no:cacheprovider apps/timetrials-desktop/tests
```

The Windows client boundary tests use invented score rows and a local outbox;
they need no private recording, account or server. They cover Tournament
extraction, Processor, Live export, Connect receipt readback, local outbox state,
and LiveTrial corrections. Verify runs them on Windows:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest -q -p no:cacheprovider tests/windows_clients
```

In a POSIX shell: `PYTHONPATH=apps/timetrials-desktop python -m pytest -q apps/timetrials-desktop/tests`. The
dashboard test runs with `node apps/timetrials-desktop/tests/history-startup.test.js` (also in CI). `engine-overlay/livetrial/tests/test_names.py` needs the full
LiveTrial engine snapshot and its Clean Assets database, which are not in this repository.

Tournament tests (`tests/tournament`) run on the Tools package's locked runtime
([requirements.lock.txt](../tooling/tournament/requirements.lock.txt)). They include a smoke of the recorded
analysis after the text reading: synthetic OCR rows and score frames, through name linking and the colour-variant
refinement, to the results CSV and the canonical JSON. No recording or private data is needed; node materializes
the public recorded assets (`tests/tournament/conftest.py`), or point `MK8DX_RECORDED_ASSETS` at a folder with
the `tournament` and `tournament-text` collection groups. Verify's `tournament-tests` job installs the lock the
way the package installer does (CPU PyTorch, without the Qt GUI), so a dependency bump that breaks this path
fails there:

```powershell
python -m pytest -q -p no:cacheprovider -rs tests/tournament
```

## Database integration tests

The API's database tests (`backend/api/test/*.integration.test.ts`) are opt-in and skip without the
settings below. Verify runs its current suite inventory against both disposable MySQL 8.4.11 and MariaDB 11.4.12 containers.
Each suite gets its own newly migrated schema; the reference-seed suite uses a synthetic configuration and an
initial reference seed before testing its update path.
Run them only against a **disposable** server, never against an installation's database. The CI entry point is
`bash tooling/run_database_integration_ci.sh mysql` or `mariadb` after `npm ci` and the API build on Linux.

| Variable | Value |
| --- | --- |
| `MK8DX_MYSQL_INTEGRATION` | `1` |
| `MK8DX_MYSQL_TEST_HOST`, `MK8DX_MYSQL_TEST_PORT` | the test server, for example `127.0.0.1` and `33406` |
| `MK8DX_MYSQL_TEST_USER`, `MK8DX_MYSQL_TEST_PASSWORD` | an account that may use the test schema (the disposable server's `root` is simplest) |
| `MK8DX_MYSQL_TEST_DATABASE` | the schema; its name must end in `_test` or `_contract` |

Rules that the suites enforce or rely on:

- The schema must already be **migrated**: apply the whole catalog with `migration-apply-main.js
  --fresh-empty-database` (below). Without it most suites fail with "table doesn't exist".
- `protected-value-rotation.integration.test.ts` refuses a schema whose name does not end in `_rotation_contract`.
- Several suites need a schema nobody else used: `tournament-operation` (fixed participant counts),
  `administrator-claim-review` (it uses the one-time first-administrator bootstrap) and
  `mysql-firebase-backout-repository` (row counts). The simplest reliable procedure is one fresh schema per suite.
- `reference-seed.integration.test.ts` also needs `MK8DX_REFERENCE_TEST_CONFIG` (a disposable synthetic
  configuration for a `_contract` schema) and skips without it.

The procedure below ran the then-current suites (all except `reference-seed`) green on MySQL 8.4.11 on 2026-11-02. It uses
a POSIX shell (Git Bash works on Windows); the password is a throw-away value for the disposable container.

```sh
docker run -d --name mk8dx-test-mysql -e MYSQL_ROOT_PASSWORD=throwaway-test-pw -p 127.0.0.1:33406:3306 mysql:8.4.11
until docker exec mk8dx-test-mysql mysqladmin ping -uroot -pthrowaway-test-pw --silent; do sleep 2; done
npm ci --prefix backend/api && npm run build --prefix backend/api
cd backend/api
export MK8DX_MYSQL_INTEGRATION=1 MK8DX_MYSQL_TEST_HOST=127.0.0.1 MK8DX_MYSQL_TEST_PORT=33406 \
  MK8DX_MYSQL_TEST_USER=root MK8DX_MYSQL_TEST_PASSWORD=throwaway-test-pw
env_file="$(mktemp)"; chmod 600 "$env_file"      # the migration CLI wants an owner-only file and an absolute path
n=0
for suite in test/*.integration.test.ts; do
  case "$suite" in *reference-seed*) continue ;; esac
  n=$((n + 1)); db="mk8dx_s${n}_test"
  case "$suite" in *protected-value-rotation*) db="mk8dx_s${n}_rotation_contract" ;; esac
  docker exec mk8dx-test-mysql mysql -uroot -p"$MK8DX_MYSQL_TEST_PASSWORD" -e "CREATE DATABASE $db"
  printf '{"MK8DX_HOSTED_MYSQL_HOST":"127.0.0.1","MK8DX_HOSTED_MYSQL_PORT":"33406","MK8DX_HOSTED_MYSQL_USER":"root","MK8DX_HOSTED_MYSQL_PASSWORD":"%s","MK8DX_HOSTED_MYSQL_DATABASE":"%s"}' \
    "$MK8DX_MYSQL_TEST_PASSWORD" "$db" > "$env_file"
  node dist/composition/migration-apply-main.js --private-environment-file "$env_file" \
    --migration-catalog ../../infrastructure/mysql/migration-catalog-v1.json --confirm-database "$db" --fresh-empty-database
  MK8DX_MYSQL_TEST_DATABASE="$db" npx vitest run --config vitest.config.ts "$suite"
done
rm -f "$env_file"; cd ../..
docker rm -f mk8dx-test-mysql
```

In Git Bash, give the migration CLI a Windows path: `--private-environment-file "$(cygpath -w "$env_file")"`.
On 2026-11-03, five suites also passed on a fresh disposable MariaDB 11.4.12 container with the host's
non-strict SQL mode: `mysql-identity-read-repository` (2), `mysql-tournament-write-repository` (4),
`mysql-time-trial-write-repository` (4), `mysql-claim-write-repository` (2), and
`mysql-player-activity-repository` (3). Each suite used a separately migrated empty schema. This is a
representative compatibility check, not coverage of every opt-in database suite. For a repeat, use the procedure
above with `mariadb:11.4`, a separate test port, and
`SET GLOBAL sql_mode='ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'` before migrating.
Never share database configuration or output that contains secrets.

## Browser checks

For a change to a page, check it in a real browser at 320, 375, 768 and 1440 pixels wide, in English and
Dutch: no horizontal scrolling, no clipped or unreachable content. With a running local installation, set
`MK8DX_TEST_ORIGIN` to its loopback address and run `node test/local-compose.browser.mjs` from `backend/api`
(Edge by default; `MK8DX_TEST_BROWSER_CHANNEL=chrome` selects Chrome).

## Changes that need more

Authentication, SQL, the installer, backup and restore need tests against a real, disposable database,
including failure cases. Physical devices, capture hardware and a real hosting account are separate checks:
say in your pull request when you could not run them.

Dependency updates (Dependabot or by hand):

- A dependency pull request that is several days behind `main` was tested against old code. Comment
  `@dependabot recreate` (or rebase your own branch) and review the fresh CI run, not the old one.
- Unit tests may mock a package, so green tests do not prove its new version still exports what the code imports.
  The API's `npm run check:links` (run by Verify after the build) links every compiled module against the
  installed packages without running them; a removed or renamed export fails there. For a major version, also read
  the release notes and test the behaviour the package provides against the real module.

## What CI runs

The Python dependency audit inventories every tracked `requirements*.txt` and `pyproject.toml` with
`python tooling/security/python_dependency_audit.py prepare <temporary-directory>`. Verify scans their exact
third-party pins with OSV-Scanner (without installing or resolving them) and rejects CVSS 7.0+ findings.
Temporary exceptions are specific to a package and advisory, carry a reason and an expiry date in
[`python_audit_allowlist.toml`](../tooling/security/python_audit_allowlist.toml); an expired exception fails
Verify. Ranged dependencies must have an exact companion pin in another manifest. This source-manifest
audit does not replace an audit of the installed transitive runtime.

The [Verify workflow](../.github/workflows/verify.yml) runs on every pull request and push to `main`: the privacy,
boundary and documentation checks; the API and Web checks (including the API module link check); the central reader's TypeScript and Python tests; the
CSS check, the intake rehearsal and the tooling tests; gitleaks over the history; `npm audit --omit=dev
--audit-level=high` for the API, Web and scanner; the asset collection, the browser scanner build and the public
test set; the Android unit tests and debug APK; the LiveTrial desktop tests (Windows) and a compile check of the
LiveTrial and Tournament sources; the Tournament package build and the Tournament tests on its locked runtime
(Windows); and the Docker image builds.
[CodeQL](../.github/workflows/codeql.yml) analyses JavaScript/TypeScript, Python and Java. The database
integration tests do not run in CI yet.
