# MK8DX Ecosystem guide for coding agents

Start in this repository root. This is the complete product source, not an installer state directory. MK8DX Ecosystem combines a Time Trials website, browser scanner, Android app, LiveTrial and Tournament tools. The project is pre-1.0 (release candidates of 0.1.0). The project's own code is under MPL 2.0; bundled third-party material does not inherit it. A checkout or source ZIP does not by itself establish rights to excluded assets or a working installation.

## First read, in this order

1. [README.md](README.md) explains the product, the installation packages and current platform limits. Read the [license scope](LICENSE_SCOPE.md) and [contribution guide](CONTRIBUTING.md) before sharing code or assets.
2. [Architecture overview](docs/architecture/COMPONENTS.md) explains the server, clients and the result path from recognition to the website. [Nederlandse versie](docs/architecture/COMPONENTS_NL.md).
3. [Developer guide](docs/DEVELOPMENT.md) explains this Git root, where to find code, local changes and build entry points. [Nederlandse versie](docs/DEVELOPMENT_NL.md).
4. For the requested change, read the affected component's README and source. Use [component-registry.json](component-registry.json) to find dependencies and reverse consumers, and [compatibility.json](compatibility.json) for coordinated API, migration and asset versions. Do not read or run every component's tests without an impact reason.

If the task concerns an operator workflow, read the [user guide](docs/install/MK8DX_User_Guide_EN.txt) or [Dutch guide](docs/install/MK8DX_Handleiding_NL.txt) before changing it. For native builds, start with [client builds](docs/CLIENT_BUILDS.md); for verification, use [testing](docs/TESTING.md). [Third-party materials](docs/THIRD_PARTY_MATERIALS.md) records unresolved rights relevant to distribution.

## Common commands

From the repository root (Node 24, Python 3.12+; [Developer guide](docs/DEVELOPMENT.md) has the full setup):

```sh
python tooling/assets/shared_asset_source.py verify                     # the asset collection is complete
npm ci --prefix backend/api && npm test --prefix backend/api            # API (typecheck/build: npm run typecheck|build)
npm ci --prefix apps/timetrials-web && npm test --prefix apps/timetrials-web   # website
python tooling/privacy_scan.py && python tooling/check_boundaries.py && python tooling/check_docs.py
```

Per component, the database tests, browser checks and what CI runs are in [Testing](docs/TESTING.md). A changed UI
text needs the i18n steps in [Developer guide](docs/DEVELOPMENT.md#change-ui-text-and-translations). In Git Bash on
Windows, prefix commands with an argument that starts with `/` with `MSYS_NO_PATHCONV=1`, or use PowerShell.

## Mental model and source map

- **Server:** `apps/timetrials-web/` serves the website and browser scanner; `backend/api/` owns authentication, result workflows, review and publication; `infrastructure/mysql/` owns the schema and versioned reference seeds. `compose*.yaml`, `infrastructure/docker/` and `tooling/install.py` assemble installations.
- **Central reader:** `packages/icon-matcher/` decides icons, digits, times and frame geometry in Python (reference), TypeScript (browser scanner) and Java (Android), kept equal by the parity vectors in `vectors/`. Change all three together; see its README.
- **Shared inputs:** `packages/domain/` and `packages/time-trial-rules/` define contracts and rules; `packages/assets/collection/` holds the internal assets/models selected by server and clients; `packages/design-tokens/` supplies shared presentation values. The one object over 100 MiB is stored in two parts that the tools join. Verify the collection before changing asset consumers.
- **Clients:** `apps/timetrials-scanner-web/`, `apps/timetrials-android/`, `apps/timetrials-desktop/` and the Tournament apps/packages perform recognition and client work. The browser scanner ships with Web; the current LiveTrial and Tournament packages are Windows clients, not Docker services.

A typical result follows **recording or image → recognition → human review → local queue → authenticated API delivery → this installation's MySQL database → authorized acceptance/publication → website**. A recognized name is not proof of Player ownership. A pending item or provisional Tournament Live table is not an official public result. An isolated local end-to-end test proved LiveTrial and Tournament Processor/Connect delivery on Docker and XAMPP/Node; it did not prove a complete Tournament Live race, macOS/ARM support or a real external host.

## Preserve product behavior

- `tooling/install.py` is the one per-installation operator profile. It derives API, Compose, gateway and public client settings while keeping secrets private. Do not add a second configuration authority or put server secrets in client data. Repeat setup and updates must retain keys, project/volume, accounts and results.
- Fresh installs include reviewed Nintendo Ghost Staff and World Records reference sets, not inherited community accounts or ordinary submissions. Grant the first administrator only through the installer after the intended account verifies its email; the first random registrant is never admin.
- The API owns authentication, validation, acceptance and publication. Keep database migrations append-only. Change reference data through its explicit versioned seed path; startup must not refresh it opportunistically.
- The prebuilt Docker images are Linux/amd64. Do not claim complete macOS, ARM, physical Android or capture support without new tests. Do not silently replace user-visible branding or route behavior while changing internals.

## Work safely and verify the impact

- Check `git status --short` before editing. Keep installation profiles, secrets, databases, backups, recordings, client queues and personal agent notes outside Git. Do not depend on a private original source directory, its Git history, production credentials or production services.
- Inspect paths, mounts, Docker context and script side effects before mutating commands. Use isolated synthetic installations and disposable databases for tests. Preserve existing data and never run `docker compose down -v` against an installation with data to keep.
- Make a coherent change, then use the [testing guide](docs/TESTING.md) for the smallest complete impact. Include reverse consumers when shared contracts or assets change. Auth, SQL, installer and lifecycle changes need isolated persistence/failure checks; Web UI changes need affected real-browser checks. Skipped tests are not passes.
- Before a local commit, review the staged diff and run `python tooling/privacy_scan.py` on the distributable tree. Keep temporary and generated output out of Git. A full source archive is built only from a reviewed clean commit with `tooling/release/full_archive.py` to a new path outside this repository.
- Keep documentation aligned with behavior and report tested versus untested claims. Record user-visible changes in [CHANGELOG.md](CHANGELOG.md). Local branches and commits are fine; pushing, releasing or deploying needs the go-ahead of the person you work for (in this repository, its maintainer). Do not assert a repository-wide license for [excluded third-party material](docs/THIRD_PARTY_MATERIALS.md).
