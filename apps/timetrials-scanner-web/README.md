# Browser Time Trial scanner

The scanner reads a Mario Kart 8 Deluxe Time Trial result from a camera image or an uploaded photo, in the
browser. A detector (ONNX model) finds the result card, the [central reader](../../packages/icon-matcher/README.md)
decides times, character, kart parts and flag, and the result goes to the website's review form on the same
origin. The website serves the scanner at `/scanner/`.
The scanner uses the pinned OpenCV.js 5.0.0 WASM build; the Android scan runtime
uses OpenCV 5.0.0.1. Both were qualified against their 4.x baselines on the
same source and recognition inputs before this update.

## Build

From this folder:

```sh
npm ci --ignore-scripts
npm run sync-assets
npm run typecheck
MK8_BASE_PATH=/scanner/ npm run build
```

`sync-assets` builds the ignored `public/assets/` folder from the repository's asset collection
(`packages/assets/collection/`): the model, recognition templates and OCR language data, each checked against
its SHA-256 in the collection manifest. The Web image build (`apps/timetrials-web/Dockerfile`) runs the same
steps, so a normal installation needs no separate scanner build.

## Tests

`npm test` runs the Playwright tests. The recognition tests compare the scanner with reference decisions on
a set of labelled frames that is not part of this repository; point `MK8DX_SCANNER_TESTKIT` at such a set
(`manifest.json`, `frames/`, `reference/`). Without it, run only the UI tests, for example
`npx playwright test tests/ui.spec.ts`. The model and recognition templates are game-derived
material; see [Third-party materials](../../docs/THIRD_PARTY_MATERIALS.md).
