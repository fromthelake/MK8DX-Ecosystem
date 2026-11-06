# Recognition pipeline: shared rules and local products

[Nederlandse versie](RECOGNITION_PIPELINE_NL.md) ·
[Central reader source](../../packages/icon-matcher/README.md) ·
[Developer guide](../DEVELOPMENT.md)

The central reader is source code in `packages/icon-matcher/`, not a network
service. Each scanner packages the implementation for its own language and
runs recognition locally. The API accepts and validates proposed results; it
does not identify an icon or Player from a submitted name.

```text
Capture → ROI search → match → frame/sequence decision → result → review/submit
  app       shared rules and app pixel work                 app UI and API
```

**One rule** means a Python reference, a TypeScript implementation and a Java
implementation checked against the same versioned parity vectors. It does not
mean that Java executes Python, or that every app currently performs identical
pixel processing. The field-semantics version on current `main` is **0.4.2**
in all three languages. The published `v0.1.0` tag contains **0.4.1**; source
on `main` is not automatically a new release.

## Stages and current boundaries

| Stage | Shared owner | Local work that remains |
| --- | --- | --- |
| Capture | Each app | Camera, phone image, HDMI/video decoding, frame timing and source metadata. |
| ROI search | `card_roi`, `card_quad`, `frame_geometry`, `detections`, `lap_grid`, `panel_registration` in the central reader; pinned frame definitions in the recognition pack | Detector inference, OpenCV masks/Hough/homography/warp and other pixel operations in the Web and Android adapters; fixed HDMI placement and video handling in LiveTrial; scoreboard capture in Tournament. |
| Field matching | Central icon scorer/reader, seven-segment digits, name matching and Ghost Select picker | OCR engines and their image preparation differ by product. Each app supplies a frame, source profile and optional documented candidate scope. Tournament currently uses the shared icon reader for exported **character** rows, not every kart part. |
| Frame decision | Central result proposal, time rules, open-set Mii and field acceptance where integrated | Each adapter must pass real observations and preserve `?`/uncertain results; a narrowed roster or known track does not itself make a match certain. |
| Sequence decision | Central `sequence_decision` and parity vectors for the supported field-vote rules | Web and Android wrap this for their scan sessions. LiveTrial video and Tournament multi-frame acceptance still contain product-specific sequencing. |
| Result | Central `scan_result` for Time Trial fields | App review, local outbox, sync and Tournament race acceptance remain product workflows. `TimeTrialSubmissionV1` and `TournamentRaceResultV1` are separate domain contracts. |

This table is the **implemented** boundary on current source. The target of
[issue #99](https://github.com/fromthelake/MK8DX-Ecosystem/issues/99) is to
unify the remaining searcher, matcher, decision and result behavior where the
same frame should produce the same decision. Do not treat a shared class name
or a passing build as proof of image-level parity.

## Where the code is embedded

| Product | Implementation and build path | Local inputs |
| --- | --- | --- |
| Web scanner | `apps/timetrials-scanner-web/src/engine/` imports `packages/icon-matcher/ts/`; Vite bundles it into the scanner. `tools/stage_shared_fields.mjs` stages a pinned `public/shared-icon/` pack. | Browser image/worker, OpenCV.js, OCR, assets from that installation's release. |
| Android | `scan-runtime/build.gradle.kts` compiles `packages/icon-matcher/java/` and `java-result/` into the scan runtime; the app also compiles the plain-Java result code when built without the scanner. | On-device camera/gallery, Android OpenCV/ONNX and staged `assets/shared_icon/`. |
| LiveTrial | `tooling/livetrial/prepare_engine.py` copies the Python reader into the prepared engine; the Windows package builder stages the recognition pack. Engine changes enter through `engine-overlay/`. | Local HDMI/video, OCR and package-local references. |
| Tournament tools | `tooling/tournament/build_windows_package.py` pins the `mk8dx-icon-matcher` Python wheel with the other runtime packages. | Local capture/recording, OCR and package-local references; central icon use is narrower than Time Trial. |

The recognition pack holds versioned frame definitions, anchors and references.
Its pack ID and manifest belong to the **built artifact**, so a source version
alone does not prove which references a user runs. Private evaluation frames,
labels and model-development data do not belong in Git or diagnostic reports.

LiveTrial's normal local dashboard derives names, icons, flags and track images
from its packaged `MK8DX Clean Assets/database.json` and serves image paths
under its local `/assets/` root. It does not fetch those pictures from the Web
server. The old `/grid` and `/deltagrid` pages are calibration tools: their
`/api/grid/ref` and `/api/deltagrid/ref` routes select separate, local QA
reference photos. The release builder excludes all three calibration photo sets;
they are not the canonical recognition references or a runtime dependency.

## Changing a decision safely

1. Identify the first differing stage on the same input frame and source
   profile. Compare a candidate against a baseline from the **same source
   commit**; record the pack ID and package version.
2. Change the Python reference and tests, then port the same rule to TypeScript
   and Java. Update shared vectors and the field-semantics version if the same
   input can get a different decision. App-specific OpenCV/OCR changes need
   their own measured adapters and cannot silently alter the common rule.
3. Run the central tests in [Testing](../TESTING.md), then the directly affected
   Web, Android, LiveTrial and Tournament consumers. Compare labelled corpora
   only for validation, including accepted IDs, uncertainty marks, times,
   threshold margins and the first differing stage.
4. Inspect each built package's central version **and** recognition-pack ID.
   Check a real scan/replay on the affected input classes; never infer runtime
   parity from matching source declarations alone.

The independent reference label is never an input to recognition. A result
proposed from pixels still needs user review, identity authorization and the
appropriate API acceptance/publication workflow.
