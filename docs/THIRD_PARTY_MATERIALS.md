# Third-party materials

The root [LICENSE](../LICENSE) contains the unmodified Mozilla Public License 2.0. [LICENSE_SCOPE.md](../LICENSE_SCOPE.md)
attaches it to the project's **own** code and documentation only. Nothing in this repository licenses the
material below, and the repository as a whole is not one unrestricted work.

## Project statement

MK8DX Ecosystem is an independent, non-commercial hobby project to practise programming and to add to the
enjoyment of Mario Kart 8 Deluxe. It is not affiliated with, endorsed, sponsored or approved by Nintendo.
Nintendo owns its trademarks, game content and other intellectual property; the project claims no rights in
that material. Please support Nintendo by buying its consoles, games and merchandise.

The source is shared as is. MPL 2.0 lets anyone use and adapt the project's own code and keeps changes to
covered files under MPL when they are distributed. "Non-commercial" describes the project, not a restriction
on how others use the code.

## Material in this repository that the MPL does not cover

| Material | Where | Terms |
| --- | --- | --- |
| Nintendo / Mario Kart game images and game-derived material: track, cup, character, kart and flag images, recognition templates and crops | `packages/assets/collection/` (the manifest lists every file with its source, role, consumers and SHA-256); `apps/timetrials-web/styles/mk8dx_ns*.png`; Android `res/drawable/mk8dx_*.png` | © Nintendo. Included because recognition and display do not work without them. No redistribution permission from Nintendo exists. |
| Mario Kart 8 Deluxe artwork used as the Tournament Analysis window background (banner and window icon) | `apps/tournament-processor/src/tournament_processor/qt/assets/bg.jpg` (size and SHA-256 in `packages/assets/native-binaries-v1.json`); installed with the processor wheel | © Nintendo. Taken over from the maintainer's earlier analysis window and included at the maintainer's decision; the rights are not cleared by this project. The window draws its own banner when the file is absent, and `MK8DX_ANALYSIS_BACKGROUND` can point it at another image. |
| Nintendo Ghost Staff reference rows | `infrastructure/mysql/reference/nintendo-staff-*.json` | Times, names and combinations of Nintendo's staff ghosts, limited to the fields the product needs. |
| World Records reference rows and the daily World Records import | `infrastructure/mysql/reference/world-records-v1.json` (an offline snapshot); `backend/api/src/world-records/` | Source: [MKWRS](https://mkwrs.com/mk8dx/), a community-maintained Mario Kart World Records site; every row keeps its `sourceUrl`. A running server refreshes the rows from the same two public pages (`wrs.php`, `wrs_200.php`) at most once a day. The rows hold public leaderboard facts (player name as published, nation, times, combination, date). MKWRS publishes no license or terms for its data, and this project has no agreement with MKWRS. |
| Scanner detection model (ONNX) | asset collection (`inference_model.onnx`, stored in two parts) | The detector used by the browser scanner and Android. Its training data, training procedure and license are **not documented in this repository: provenance unknown**. Treat it as not licensed by this project. |
| EasyOCR detection and recognition models (`.pth`) | asset collection | From the EasyOCR project, Apache License 2.0 (text in `packages/assets/licenses/`). |
| Tesseract language data (`.traineddata`) | asset collection | From the tesseract-ocr project, Apache License 2.0 (text in `packages/assets/licenses/`). |
| IBM Plex Sans/Mono and Saira Condensed fonts | `apps/timetrials-web/styles/ds-font-*.woff2`, Android `res/font/` | SIL Open Font License 1.1; the license texts are in `apps/timetrials-web/licenses/` and `apps/timetrials-android/app/src/main/assets/licenses/`. |
| Nickname character reference | `tournament-text/data/mii_allowed_chars.json` in the collection | Cites a public community symbol reference; attribution is kept in the file. |
| LiveTrial vision engine | `apps/timetrials-desktop/vision-runtime/` | Its own MIT license, credited to the LiveTrial contributors; see its `LICENSE` and `ASSET_NOTICE.md`. |
| Android Gradle wrapper | `apps/timetrials-android/gradle/` | Apache License 2.0. |
| Google ML Kit text recognition (`com.google.mlkit:text-recognition`, `-japanese`, `-chinese`, `-korean`) | dependency of `apps/timetrials-android/scan-runtime` (downloaded by Gradle, not stored here; bundled in the APK) | Proprietary Google software under the [ML Kit Terms](https://developers.google.com/ml-kit/terms) and the Google APIs Terms of Service. It is not open source; whoever builds or distributes the APK accepts those terms. |
| npm and Python dependencies | lock files and requirement files | Their own licenses. |

The project mark (the Time Trials app icons under `apps/timetrials-web/styles/` and the scanner icons in the
collection) is the maintainer's own design.

## Classic WordPress export: contributed by its author

`apps/timetrials-web/styles/classic-report-export.js`, `classic-report-export-css.txt` and
`classic-report-catalog.json` are code from the Seating & Standings Manager (provenance and hashes in
`apps/timetrials-web/CLASSIC_EXPORT_PROVENANCE.md`). The Seating & Standings Manager was written by this
project's author and copyright holder (FromTheLake), who contributes these three files to MK8DX Ecosystem under
this project's license, the Mozilla Public License 2.0, like the rest of the project's own code. Game names in
the catalog remain Nintendo's (see the table above).

```
SPDX-FileCopyrightText: FromTheLake
SPDX-License-Identifier: MPL-2.0
Files: apps/timetrials-web/styles/classic-report-export.js
       apps/timetrials-web/styles/classic-report-export-css.txt
       apps/timetrials-web/styles/classic-report-catalog.json
```

## If you distribute packages

Release packages contain the asset collection or a selection of it, so they contain Nintendo material. Keep
`LICENSE`, `LICENSE_SCOPE.md`, this file and `SOURCE_FOR_BINARIES.txt` with every package; for the Android APK,
distribute them next to it. Do not present the game material as covered by the MPL.

## Rights holders

If you hold rights in material included here and want it changed or removed, open an issue or use the private
contact described in [SECURITY.md](../SECURITY.md). The asset collection is designed so that a file can be
replaced or removed exactly.
