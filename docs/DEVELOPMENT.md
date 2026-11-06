# Develop MK8DX Ecosystem

[Nederlandse versie](DEVELOPMENT_NL.md) · [Architecture](architecture/COMPONENTS.md) · [Testing](TESTING.md) · [All guides](../README.md#guides)

This guide is for developers who read or change the source. To install and use MK8DX, use a prebuilt release
package and the [guides](../README.md#guides) instead.

## Requirements

| Tool | Version | Needed for |
| --- | --- | --- |
| Git | any recent | everything |
| Node.js | 24 (CI uses 24.12.0, see `.nvmrc`) | website, API, browser scanner, TypeScript reader, design tokens |
| Python | 3.12 (see `.python-version`) | tooling, privacy and boundary checks, Python reader, LiveTrial and Tournament sources |
| Docker with Linux containers and Compose | Docker Desktop or Docker Engine | the local server from source |
| JDK 17 or 21, Android SDK platform 36 | | only the Android app ([Client builds](CLIENT_BUILDS.md)) |

The clone is large (about 280 MB of Git objects, mostly the asset collection, including a 121 MB scanner model).

### Windows 11

Install Git for Windows, Node.js 24, Python 3.12 (tick **Add python.exe to PATH**) and Docker Desktop
(WSL 2, Linux containers) from their official installers, then:

```powershell
git config --global core.longpaths true
node --version      # v24.x
python --version    # 3.12.x
docker compose version
```

`core.longpaths` avoids path-length errors in deep Android and `node_modules` paths. Use PowerShell for the
commands in the docs. If `python` opens the Microsoft Store, turn off the `python.exe` app execution alias in
Windows settings. Git Bash works too; see [Troubleshooting](#troubleshooting) for its path conversion.

### Linux (Ubuntu 24.04 as the example)

```sh
sudo apt update
sudo apt install git python3 python3-venv curl unzip
```

Ubuntu 24.04's `python3` is 3.12. Install Node.js 24 from nodejs.org or with a version manager that reads
`.nvmrc` (`nvm install && nvm use`, or `fnm use`). Install Docker Engine with the Compose plugin from Docker's
official apt repository (<https://docs.docker.com/engine/install/ubuntu/>). Use `python3` where the docs say
`python`.

### macOS (untested)

No macOS machine was available to check these steps; please report what does not work. With Homebrew:

```sh
brew install git node@24 python@3.12
brew install --cask docker            # Docker Desktop for Mac; start it once
brew install --cask temurin@17        # only for Android builds
```

Follow the printed `node@24` instructions to put it on your `PATH`, and use `python3.12` (or `python3`, if it is
3.12) where the docs say `python`. `sha256sum` is `shasum -a 256` on macOS. The website, API, scanner and the
Python and TypeScript checks are plain Node/Python and are expected to work. The Docker base images used by the
Dockerfiles are multi-architecture, so a source build on Apple Silicon should produce native arm64 images, but
this has not been tried; the prebuilt release images are amd64 only. LiveTrial and the Tournament tools are
Windows programs: on macOS you can edit and compile-check their Python sources, not run them.

## Clone and verify

```sh
git clone https://github.com/fromthelake/MK8DX-Ecosystem.git
cd MK8DX-Ecosystem
python tooling/assets/shared_asset_source.py verify
```

`verify` checks every object of the internal asset collection against its manifest. The scanner model is
larger than GitHub's 100 MiB file limit and is stored as two parts (`<sha>.part1`, `.part2`); `verify` and the
build tools join them into the object on first use. No Git LFS is needed, and GitHub's automatic
**Source code (zip)** is complete as well. `.gitattributes` keeps every file byte-identical to the commit
whatever your `core.autocrlf` setting is; that matters because migrations, the collection and the test set are
checked by hash.

Then install the pinned Python test dependencies in a virtual environment:

```sh
python -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

On Windows the interpreter is `.venv\Scripts\python.exe`. `.venv/` is ignored by Git. Node dependencies are per
component: `npm ci --prefix backend/api`, `npm ci --prefix apps/timetrials-web`, and
`npm ci --ignore-scripts --prefix apps/timetrials-scanner-web`.

An installation keeps its accounts, database, keys, backups and client queues in a state directory
**outside** the repository; `tooling/install.py` refuses a state directory inside it.

## Find the code that owns a change

The [architecture overview](architecture/COMPONENTS.md) maps every responsibility to a directory; read that
component's README next. The [component registry](../component-registry.json) lists dependencies and reverse
consumers, and [compatibility.json](../compatibility.json) the coordinated API, migration and asset versions.
`python tooling/check_boundaries.py` enforces the import rules between components.
[tooling/README.md](../tooling/README.md) says which scripts are for contributors, operators or maintainers.
Comments that cite `ADR-NNNN`, `docs/design-system/` or `apps/tournament-manager` point to maintainer history
outside this repository; the code and tests are the reference
([why](architecture/COMPONENTS.md#references-in-code-comments)).

Some boundaries to keep in mind:

- The **API** owns authentication, validation, acceptance and publication. Clients only propose results.
- **Database migrations** are append-only and hash-pinned in `infrastructure/mysql/migration-catalog-v1.json`.
  Reference data changes through a new versioned seed, never at startup.
- The **central reader** (`packages/icon-matcher/`) has a Python, a TypeScript and a Java implementation.
  A change to one needs the same change in the others and regenerated parity vectors;
  [the pipeline map](architecture/RECOGNITION_PIPELINE.md) shows the actual app
  adapters and package boundaries. Its README explains the reader itself.
- Shared contracts in `packages/domain/` (JSON Schema) and rules in `packages/time-trial-rules/` have consumers
  in the API, website and clients. Check all of them.

## Make a change

1. Create a branch: `git switch -c fix/short-description`.
2. Change the source in the component that owns the behaviour. Keep the file's existing line endings
   (`.editorconfig` sets the indentation; many older files are CRLF).
3. Run the checks for the affected components from [Testing](TESTING.md), including reverse consumers of a
   shared contract or asset.
4. Run the repository checks:

   ```sh
   python tooling/privacy_scan.py
   python tooling/check_boundaries.py
   python tooling/check_docs.py
   git diff --check
   ```

5. Stage only the intended paths and review `git diff --cached`. A diff of hundreds of lines for a one-line
   change means the line endings changed. Commit, push your branch to your fork and open a pull request with the
   template. [Contributing](../CONTRIBUTING.md) explains the review, the AI-assistance policy and what CI runs.

Never commit installation directories, `secrets.json`, `.env` files, databases, backups, recordings, logs or
personal data. Add a `.gitignore` entry if a tool creates local files.

## Change UI text and translations

English is the source text and the key everywhere; English (UK) and Dutch are written in the code and reviewed.
The other 13 game languages come from translation catalogs.

**Website (`apps/timetrials-web`)**

- New or changed text goes inline in the source as `localized("English", "Nederlands")`
  (`src/product-language.ts`). For Dutch it returns the second argument; for a catalog language it looks the
  English up in that language's catalog and falls back to English.
- `src/dutch-ui-copy.ts` translates English that is already on the page without passing through `localized`
  (shared labels, attributes such as `title` and `aria-label`): an exact table and phrase rules for Dutch, the
  catalog for the other languages. Prefer `localized` for new text; add an entry here only for text you cannot
  reach that way. Game names (tracks, characters, parts) come from the asset catalog, not from either file.
- `i18n/messages.source.json` lists every English text with its Dutch and the files that use it. It is
  **generated** by an extractor (`tooling/i18n/extract_web_messages.mjs`); do not edit it by hand. CI runs the
  extractor with `--check` and fails when the committed file does not match the code.
- `i18n/translations/<language>.json` (ten files) is where translators work: English text → translation, with a
  `reviewed` flag. Placeholders such as `{0}` must stay the same. **Every English text needs an entry in each of
  the ten files**, so a new or changed English text needs ten new entries. These files are shared by all products, so they
  also hold the Android, LiveTrial and Tournament Live texts.
- A catalog builder (`tooling/i18n/build_web_catalogs.mjs`) turns the translations plus the game names into
  the content-hashed `styles/i18n-<language>-<hash>.json` files the page loads, and writes
  `src/i18n-catalog-index.generated.ts`. Do not edit those either. `test/product-catalog-coverage.test.ts`
  checks that every catalog covers every source text with known placeholders.

**Android, LiveTrial and Tournament Live** follow the same rule. Android code passes both texts to
`androidText(language, "English", "Nederlands")`; LiveTrial (`apps/timetrials-desktop`) and Tournament Live
(`apps/tournament-live`) keep English → Dutch tables in their source. Each has a generated
`i18n/messages.source.json` beside it, and the built catalogs live in
`apps/timetrials-android/app/src/main/assets/i18n/`, `apps/timetrials-desktop/dashboard/i18n/` and
`apps/tournament-live/src/live_processor/i18n/`.

To rebuild the Web catalogs after changing a text or a translation:

```sh
npm ci --prefix tooling/i18n
node tooling/i18n/extract_web_messages.mjs                       # refreshes i18n/messages.source.json
node tooling/assets/materialize_collection.mjs schema9 <new absolute folder>   # the game names (Clean Assets)
node tooling/i18n/build_web_catalogs.mjs --clean-assets <that folder>/database.json --fill-missing
```

`--fill-missing` adds each new English text to the ten translation files with the English as a stand-in, so
those languages show it in English until someone translates it. Translate the stand-ins if you can (a machine
translation is fine; the files stay `reviewed: false`), or leave them for a translator. Without the flag the builder
lists every missing text as a problem. It prints `"problemCount": 0` when every catalog covers every text; then
`npm test --prefix apps/timetrials-web` passes too. In a pull request, commit the changed source text together with
`messages.source.json`, the translation files and the regenerated catalogs. The Android and desktop extractors
(`extract_android_messages.py`, `extract_desktop_messages.py`) work the same way for their catalogs.

## Run it locally

- Website, API and database with Docker from source: [Getting started](GETTING_STARTED.md) (Windows and Linux;
  the same commands are expected to work on macOS).
- The same with the bundled asset collection and the browser scanner: [Local preview](LOCAL_PREVIEW.md).
- Android, LiveTrial and Tournament packages: [Client builds](CLIENT_BUILDS.md).

The prebuilt Docker images are Linux/amd64. The native client packages target Windows; a macOS or Linux client
build has not been made yet.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Git Bash: `docker ... run api sh /app/operator-command.sh` fails with `can't open 'C:/Program Files/Git/app/...'` | Git Bash rewrites arguments that start with `/`. Prefix the command with `MSYS_NO_PATHCONV=1`, or use PowerShell. |
| Windows: `Filename too long` during clone, checkout or an Android build | `git config --global core.longpaths true`; keep the clone in a short path such as `C:\src\MK8DX-Ecosystem`. |
| LiveTrial tests: `ModuleNotFoundError: No module named 'livetrial_desktop_app'` | Set `PYTHONPATH=apps/timetrials-desktop` (see [Testing](TESTING.md)). One of these tests asserts Windows paths and fails on Linux and macOS; CI runs them on Windows. |
| The first-administrator command answers `refused` after you followed the magic link | Open the website once in the same browser after the link (the account is completed when the page loads), then run the command again with the exact same email address and the same installation's `compose.env`. |
| Linux: `cp: cannot open '/run/mk8dx/operator.json': Permission denied` during migrations | An installation directory made by an older installer has `operator.json` at mode 0600, which the API container's user cannot read on a Linux Docker Engine. Any `tooling/install.py` command on that installation fixes it, or run `chmod 644 "$state/operator.json"` (the directory stays 0700). |
| `docker compose up`: `port is already allocated` | Another program took the installation's port after `init` chose it. Stop that program, or move the installation with `python tooling/install.py change-origin --state-dir "$state" --origin http://127.0.0.1:<free port>` and start again. |
| The first Docker build is slow | It downloads Node, MySQL, Caddy and npm packages and copies the asset collection; later builds use the cache. |
| `privacy_scan.py` reports `unreviewed binary` | You added an image or another binary. Binaries are admitted only through reviewed manifests (the collection, `packages/assets/native-binaries-v1.json`, `packages/assets/test-set/test-set-files-v1.json`); explain in the pull request why it is needed. |

## Release packages

The complete source archive is built from a clean, reviewed commit with
`python tooling/release/full_archive.py --output <new path outside the repository>`. It contains the tracked
source and the hydrated asset collection, without Git history or installation data. The host and client packages
have their own build recipes. See [Release packages](RELEASE_PACKAGES.md).

## Coding agents

[AGENTS.md](../AGENTS.md) is the shared instruction file for coding agents; `CLAUDE.md` and `GEMINI.md` import it.
Check that your agent actually loaded it. Pull requests prepared with AI assistance follow
[Contributing](../CONTRIBUTING.md#ai-assisted-contributions).
