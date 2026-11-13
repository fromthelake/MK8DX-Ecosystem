# Central reader (`packages/icon-matcher`)

The central reader turns what a scanner sees into result fields: which character, kart body, tyres, glider
and flag are on a result card, which digits form the total and lap times, and where on the screen the card,
the lap rows and the Select-a-Ghost panel are. It exists three times, kept equal by shared test vectors:

| Implementation | Directory | Used by |
| --- | --- | --- |
| Python (the reference) | `python/mk8dx_icon_matcher/` | tests, vector generation; LiveTrial and Tournament in the ecosystem |
| TypeScript | `ts/` | the browser scanner (`apps/timetrials-scanner-web`) |
| Java | `java/`, `java-result/` | the Android scan runtime |

The reader declares one **field-semantics version** (`FIELD_SEMANTICS_VERSION`, source candidate `0.4.2`). The Python,
TypeScript and Java declarations must be equal; `python/tests/test_version.py` checks this.

Ghost Select picker version 2 can use an independently accepted top icon to
complete a shorter printed name contained as whole words in a longer catalog
name (for example `Normal`/`Normal Blue`), provided panel colour is reliable.
It leaves the OCR variant order and acceptance thresholds unchanged. See
[`OPENCV5_REQUALIFICATION_2026-11-05.md`](../../docs/qa/OPENCV5_REQUALIFICATION_2026-11-05.md)
for the same-source qualification.

> The browser scanner, Android and LiveTrial use this reader for their integrated
> fields. Tournament uses it for exported character rows and selected geometry,
> digit and name rules. Pixel processing and some sequence rules remain local;
> the exact boundary and package paths are in the
> [recognition pipeline](../../docs/architecture/RECOGNITION_PIPELINE.md).

## What it decides

| Stage | Python | TypeScript | Java |
| --- | --- | --- | --- |
| Card region from the detector output | `card_roi` | `sharedCardRoi.ts` | `CardRoi.java` |
| Card corners (deskew) | `card_quad` | `sharedCardQuad.ts` | `CardQuad.java` |
| Frame geometry and card registration | `frame_geometry` | `sharedFrameGeometry.ts` | `FrameGeometry.java` |
| Select-a-Ghost panel registration | `panel_registration` | `sharedPanelRegistration.ts` | `PanelRegistration.java` |
| Detector post-processing | `detections` | `sharedDetections.ts` | `Detections.java` |
| Lap-row grid (digit slots) | `lap_grid` | `sharedLapGrid.ts` | `LapGrid.java` |
| Seven-segment digits | `segment_digits` | `sharedSegmentDigits.ts` | `SegmentDigits.java` |
| Time decision (lap sum, repair) | `time_decision` | `sharedTimeDecision.ts` | `TimeDecision.java` |
| Names, console language, track titles | `name_match` | `sharedNameMatch.ts` | `NameMatch.java` |
| Select-a-Ghost picker | `ghost_panel` | `sharedGhostPanel.ts` | `GhostPanel.java` |
| Icon matching (character, kart parts, flag) | `matcher`, `field_reader` | `sharedIconScorer.ts`, `sharedIconCvReader.ts` | `IconScorer.java` |
| Open-set "Mii" suggestion | `open_set` | `sharedOpenSet.ts` | `OpenSet.java` |
| Decision over several frames | `sequence_decision` | `sharedSequenceDecision.ts` | `SequenceDecision.java` |
| The final scan result | `scan_result` | `sharedScanResult.ts` | `ScanResult.java` |

Icon matching compares a normalized crop with the reference images of the game catalog (masked colour
shortlist, then shape and colour refinement within a character family). When no catalog character fits
well, the open-set step suggests a Mii instead of the closest look-alike.

## Inputs it needs

- **Reference images**: the schema-9 game catalog from the internal asset collection
  (`packages/assets/collection/`). These are Nintendo game images; see
  [Third-party materials](../../docs/THIRD_PARTY_MATERIALS.md).
- **Frame definitions** (`python/mk8dx_icon_matcher/references/scoreboard-frames-v1.json`) and panel photometry.
- Optional private evaluation sets (labelled screenshots and video frames). They are not part of this
  repository; tests that need them look for them through environment variables such as
  `MK8DX_FRAME_DEFINITIONS` and skip when they are absent.

## Run the tests

From the repository root:

```sh
# TypeScript: unit tests and parity with the Python reference on the shared vectors
node --experimental-strip-types --no-warnings \
  --experimental-loader ./packages/icon-matcher/ts/ts_resolve_hook.mjs \
  --test "packages/icon-matcher/ts/*.test.mjs"

# Python (3.12, with numpy, opencv-python, jsonschema and pytest)
PYTHONPATH=packages/icon-matcher/python python -m pytest -q packages/icon-matcher/python/tests
```

Each `ts/*_parity.mjs` script compares one TypeScript stage with the Python records in `vectors/`, for
example `node --experimental-strip-types ts/scan_result_parity.mjs` from this directory;
`ts/vectorParity.test.mjs` runs them all as part of the command above and fails when a vector file has no
TypeScript replay. Python replays the same files in `python/tests` and the Java implementation in the
Android unit tests, so CI checks every committed vector in all three runtimes.

Frame-geometry and lap-grid tests also need `frame-definitions-v1.json` from the public recognition pack.
CI materializes it; locally:

```sh
node tooling/assets/materialize_collection.mjs recognition-pack "$PWD/.cache/recognition-pack"
export MK8DX_FRAME_DEFINITIONS="$PWD/.cache/recognition-pack/frame-definitions-v1.json"
```

## Generated public vectors

`tools/generate_vectors.py` writes two vectors from the Python reference, without private inputs
(issue #99):

| Vector | What it pins | Replayed by |
| --- | --- | --- |
| `vectors/context-v1.json` | `combine_character` / `combine_part` over a synthetic catalog and synthetic text clues, one case per branch and on every threshold edge | `python/tests/test_generated_vectors.py`, `ts/contextVectors.test.mjs` |
| `vectors/icon-score-v1.json` | masked RGB rank (`center_shortlist`, `center_then_shortlist`) on box-sized uint8 queries built from the public recognition pack's own references | `python/tests/test_generated_vectors.py`, `ts/iconScoreVectors.test.mjs`, Android `IconScoreParityTest` |

```sh
node tooling/assets/materialize_collection.mjs recognition-pack "$PWD/.pack"     # absolute path
PYTHONPATH=packages/icon-matcher/python python packages/icon-matcher/tools/generate_vectors.py --pack .pack
python packages/icon-matcher/tools/generate_vectors.py --pack .pack --check          # committed bytes still current
MK8DX_RECOGNITION_PACK="$PWD/.pack" ...                                               # lets the icon-score replays run
```

The output is deterministic (no random numbers, sorted keys, LF). `--check` is byte-exact under the pinned
`requirements-dev.txt` (numpy 2.5.4, OpenCV 5.0); another numpy can change float32 sums in the last bit, which the
replays tolerate (scores within 1e-6, decisions identical). Cases within 1e-5 of the 0.80 score or 0.02 margin gate
carry `"boundary": true` and are reported rather than failed. Known rule differences between the runtimes are listed in
the replay tests themselves. `python/tests/test_reference_bank_matches_pack.py` checks that the PNG-built Python
reference bank equals the pack's tensors.

`tools/generate_rule_vectors.py` (same options) writes the remaining rule vectors, also without private inputs:

| Vector | What it pins | Replayed by |
| --- | --- | --- |
| `vectors/refinement-v1.json` | shape rank, distinctive flag rank, NL/LU band ratio, NL/LU/PY tricolour, flag exposure, character family colour and neutral chroma on box-sized queries built from the pack's references; each case carries the upstream inputs (visual read, shape rank, shortlist) Python computed, so one refinement is replayed at a time | `python/tests/test_rule_vectors.py`, `ts/refinementVectors.test.mjs`, Android `RefinementParityTest` |

refinement needs the pack's tensor pack (`MK8DX_RECOGNITION_PACK`) and skips without it.

## Changing the reader

1. Change the Python reference first and add or update its tests.
2. Make the same change in TypeScript and Java.
3. Regenerate the affected vectors in `vectors/` from the Python reference and run the parity checks of all
   three implementations.
4. Raise `FIELD_SEMANTICS_VERSION` in all three places when a decision can change for the same input.
5. Run the browser scanner's build and tests (`apps/timetrials-scanner-web`), the reader's main consumer here.

Keep reference packs, evaluation images, labels and reports outside Git.

## Example

```python
from pathlib import Path
import cv2
from mk8dx_icon_matcher import IconMatcher, ReferenceBank

bank = ReferenceBank(Path("path/to/clean-assets"))      # a schema-9 asset directory
crop = cv2.imread("character_crop.png")                  # a BGR crop of a result-card icon
result = IconMatcher(bank).match(crop, "characters", profile="result")
print(result.status, result.id, result.top, result.margin)
```
