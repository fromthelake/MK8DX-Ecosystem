# Tooling

Scripts for checks, installation, packaging and asset maintenance. Run them from the repository root.
**Audience**: *contributor* (anyone changing the code), *operator* (someone running an installation),
*maintainer* (needs inputs that are not in this repository, or produces releases). **Private inputs** says what a
script needs beyond a clone; a contributor never needs those.

## Checks every contributor runs

| Script | Audience | What it does | Private inputs |
| --- | --- | --- | --- |
| `privacy_scan.py` | contributor | Fail-closed scan for private markers, credential-shaped values, forbidden artifacts and unreviewed binaries. | none |
| `check_boundaries.py` | contributor | Validates `component-registry.json`, the component graph, the migration level in `compatibility.json` and forbidden imports. | none |
| `check_docs.py` | contributor | Relative links and heading anchors in the documentation; stated migration counts against the catalog. | none |
| `tests/` | contributor | Unit tests for the installer and the privacy scan: `python -m unittest discover -s tooling/tests`. | none |
| `test_intake.py` | contributor | Synthetic rehearsal of the intake tool: `MK8DX_INTAKE_TEST_ROOT=<temp dir> python tooling/test_intake.py -v`. | none |
| `design-system/css-metrics.mjs` | contributor | CSS architecture metrics; `--check` compares with the committed baseline. | none |
| `design-system/sync-time-trial-rules.mjs` | contributor | Delivers `packages/time-trial-rules` to the website. | none |
| `reference/generate_benchmark_manifest.py` | contributor | Builds the website's reference projection from the two seeds; `--check` verifies it. | none |
| `test-set/score_test_set.mjs` | contributor | Reads the public test set (`packages/assets/test-set`) with the browser scanner and compares with the labels. | none (needs the scanner's `npm ci`, `sync-assets` and Playwright Chromium) |
| `assets/shared_asset_source.py` | contributor | `verify` checks the internal asset collection; `resolve` gives an object's path. | none |
| `assets/materialize_collection.mjs` | contributor | Creates a consumer view (web, scanner, Android, LiveTrial, Tournament, recognition pack) from the collection. Used by the builds. | none |

## Languages

| Script | Audience | What it does | Private inputs |
| --- | --- | --- | --- |
| `i18n/extract_web_messages.mjs` | contributor | Refreshes `apps/timetrials-web/i18n/messages.source.json` from the Web source (`npm ci --prefix tooling/i18n` first); `--check` only compares, as CI does. | none |
| `i18n/build_web_catalogs.mjs` | contributor | Builds the hashed Web language catalogs from the translations and the game names (`--clean-assets <schema9 database.json>`; `--fill-missing` adds English stand-ins for new texts; see DEVELOPMENT). | none (the schema9 group of the asset collection) |
| `i18n/extract_android_messages.py`, `i18n/extract_desktop_messages.py` | contributor | The same extraction for the Android app and the LiveTrial dashboard. | none |
| `i18n/crawl_web_leftovers.mjs` | maintainer | Finds English text the extractor cannot see by visiting a running Web app. | a running installation |

## Installation and operation

| Script | Audience | What it does | Private inputs |
| --- | --- | --- | --- |
| `start-mk8dx.sh` | operator | Linux/macOS launcher of the Docker host package: wizard plus menu (setup, start, status, stop, administrator, backup, update). | the host package's image bundle |
| `start-mk8dx.ps1` | operator | The same for Windows; started by `Start-MK8DX.cmd` and `Start-MK8DX-LAN.cmd`. | the host package's image bundle |
| `mk8dx-ui.ps1` | operator | Presentation of the Windows launchers (race intro, laps, spinner, finish), also for `Start-MK8DX-No-Docker.cmd` and `Manage-MK8DX-No-Docker.cmd` through `-Show`; `-Demo` previews it. Options: [launcher look and options](../docs/guides/HOSTING.md#the-launcher-window-look-and-options). | none |
| `mk8dx-ui.sh` | operator | The same for `start-mk8dx.sh` on Linux and macOS (POSIX sh); `sh tooling/mk8dx-ui.sh --demo` previews it. | none |
| `install.py` | operator | The installer behind both launchers and the non-Docker routes: `init`, `wizard`, `setup`, `start`, `check`, `admin`, `upgrade`, `change-origin`, `change-smtp`, `backup`, `restore-new` and more (`--help`). | your installation directory |
| `native_install.py` | operator | Non-Docker backend of `install.py` (A3 XAMPP/Node, B2 shared hosting). | your installation directory |
| `lifecycle.py` | operator | Backup, `verify` and `restore-new` of a Docker installation into a new isolated project; an A2 offline backup is sealed with the recovery code (`mk8dx.install-backup.v3`) and `restore-new --lan-ip` moves it to another address. | your installation directory and backups |
| `setup_wizard.py` | operator | A2 offline: the browser-based setup and "MK8DX beheer" on this computer only (install, restore, people and sign-in cards, address move); `start-mk8dx.ps1` opens it for an A2 offline package. Manual: `docs/install/A2_HOME_GUIDE_EN.md`. | your installation directory |
| `auto_backup.py` | operator | A2 offline: the nightly sealed backup task, the stored recovery code and starting Docker Desktop with Windows, as chosen in the setup wizard. | your installation directory and backups |
| `configure_xampp.ps1` | operator | Adds the MK8DX site to an existing XAMPP Apache (A3). | an XAMPP installation |
| `docker/operator-command.sh` | operator | Runs an API command inside the API image with the installation's private settings (copied into the image). | your installation directory |
| `prepare_preview_index.py` | contributor | Enables a separately staged scanner in a local-only website preview. | none |

## Packaging (maintainers)

| Script | Audience | What it does | Private inputs |
| --- | --- | --- | --- |
| `release/full_archive.py` | maintainer | Complete source archive with the hydrated collection, from a clean commit. | none (clean Git tree) |
| `release/host_bundle.py` | maintainer | Docker host package: the API/web/MySQL/Mailpit images (`--list-images` prints the exact tags) and the launchers; recipe in `docs/guides/HOSTING.md`. `--offline-candidate --wheels-dir <folder>` adds the A2 offline files, the setup wizard, `images/images.json` and the pinned Windows wheels for an A2 offline QA candidate. | locally built images |
| `release/non_docker_bundle.py` | maintainer | A3 (XAMPP/Node) and B2 (shared hosting) packages. | MariaDB and Mailpit Windows binaries |
| `release/build_reading_guides.py` | maintainer | Renders the two user guides from their `.txt` to Word. | `python-docx` |
| `livetrial/build_windows_package.py` | maintainer, contributor | LiveTrial Windows package ([Client builds](../docs/CLIENT_BUILDS.md)). | the Python embeddable ZIP from python.org |
| `livetrial/prepare_engine.py` | maintainer, contributor | Prepares the LiveTrial engine tree from the collection. | none |
| `tournament/build_windows_package.py` | maintainer, contributor | Tournament Tools Windows package. | none |
| `tournament/prepare_runtime.py` | maintainer, contributor | Prepares a Tournament runtime from the collection. | none |
| `tournament/requirements.lock.txt` | maintainer | Locked, hashed dependency list the Tournament installer uses. | none |

## Asset and recognition maintenance (maintainers)

These change the asset collection, catalogs or recognition templates. They read the maintainer's Clean Assets
working folder, private recordings or review crops, which are not in this repository.

| Script | What it does | Private inputs |
| --- | --- | --- |
| `assets/update_collection.py` | Reviewed exact replacement of collection objects (policy and plan live outside the tree). | replacement policy and inputs |
| `assets/schema9_asset_catalog.py`, `assets/export_schema9_catalog_snapshot.py`, `assets/verify_schema9_release.py` | Build and verify the stable-ID game catalog. | a Clean Assets release |
| `assets/export_android_*.py`, `assets/export_android_product_catalogs.mjs`, `assets/export_web_track_catalog.py`, `assets/export_scanner_tire_names.py` | Export catalogs for Android, the website and the scanners. | a Clean Assets release |
| `assets/generate_dutch_presentation_catalog.mjs`, `assets/generate_loadout_variants.mjs`, `assets/stage_loadout_variant_assets.mjs` | Presentation catalogs and loadout colour variants. | the Icon Matcher references |
| `assets/generate_public_icons.py` | Neutral console icons; leaves the owner Time Trials app icon untouched. | `Pillow` |
| `assets/derive_android_launcher_mark.py` | Checks or regenerates the round Android mark from the owner Web icon. | `Pillow` |
| `assets/validate_offline_asset_consumers.py` | Read-only checks of a built APK or Tournament asset tree. | a built package |
| `assets/shared_asset_source.mjs` | Build-time counterpart of `shared_asset_source.py`. | none |
| `tournament/build_*_templates.py`, `tournament/build_track_names.py`, `tournament/badge_cutouts.py`, `tournament/lan_cutouts.py`, `tournament/cup_final_cells.py` | Build Tournament recognition templates and tables in 15 game languages. | Clean Assets, captured frames |
| `tournament/score_*.py`, `tournament/replay_validation*.py` | Score templates and replay recorded tournaments against reviewed results. | private recordings and labels |
| `review/family_colour_space_probe.py` | Compares colour metrics on paired icon crops. | private review crops |
| `web/generate_api_staff_references.mjs` | The API's copy of the Nintendo staff times. | none |

## Maintainer-only workflow

| Script | What it does | Private inputs |
| --- | --- | --- |
| `intake.py` | Brings changes from the maintainer's development tree into this repository through a reviewed three-way intake ([Maintainer intake](../docs/MAINTAINER_INTAKE.md)). | the maintainer's tree and intake configuration |

The API's `package.json` also has maintainer-only commands for a one-time import of a former community's data
(`migration:firebase-*`, `rating:*`); a new installation never needs them.
