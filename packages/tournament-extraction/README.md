# Tournament Extraction Core

This package owns behavior genuinely shared by recorded-video and live-capture
Tournament products. Its first production boundary accepts only confirmed,
post-OCR Tournament workbook rows and emits one ordered
`TournamentRaceResultV1` document per race.

The boundary fails closed on inconsistent race metadata, non-contiguous
placements, invalid counted/excluded total arithmetic, or an excluded race
without a scoring note. It derives competition ranks, resolves schema-9 track
and character IDs from a packaged privacy-safe catalog subset, and creates
stable opaque result IDs.

Observed player names remain evidence. They become per-race unresolved
observations unless the proven extractor supplies an explicit local identity
label; names are never silently merged into central Players.

The package does not own recorded file discovery or live capture-card,
reconnect, rolling-buffer, dashboard, OBS, or session behavior.

The `engine` subpackage is the extracted proven OCR/frame-selection
implementation. It accepts product-owned paths through:

- `MK8DX_TOURNAMENT_RUNTIME_ROOT` for generated output/config;
- `MK8DX_TOURNAMENT_ASSETS_ROOT` for private recognition assets;
- `MK8DX_TOURNAMENT_REFERENCE_ROOT` for private/local reference data.
- `MK8DX_TOURNAMENT_ENGINE_DATA_ROOT` for separately staged engine metadata
  that is not approved for public packaging.

No game image, checkpoint, private footage, or private expected result is
bundled. Install the `vision` extra only for recorded/live recognition runtime.
First run the stdlib-only source-backed selector with Python 3.12:

```powershell
python packages/tournament-extraction/python/src/mk8dx_tournament_extraction/setup_torch.py --install
python -m pip install -e 'packages/tournament-extraction/python[vision]'
```

This installs torch 2.10.0 / torchvision 0.25.0 from the source's `cu128` index
on NVIDIA hardware, or the CPU index otherwise. `--mode cpu` explicitly selects
CPU; omit `--install` to inspect the selection without installing. Run this
inside the intended virtual environment, before EasyOCR's dependency resolver
can choose a different torch build. The Windows Tools installer calls the same
selector before its locked dependency closure and checks the installed backend.

Fresh runtime roots read the packaged, unchanged source example configuration:
JPG frames, two initial-scan workers, four score-analysis workers, two overlap
consumers, seven consensus frames and debug exports off. A runtime-local
`config/app_config.json` takes precedence, then a local `app_config.example.json`,
then the packaged example. Environment overrides still win. No config is written
into an operator's runtime automatically; an existing sparse config retains the
source parser's computed defaults for omitted fields.

The original engine code is under MPL 2.0; `SOURCE_LICENSE.md` attaches the
notice to this package. Game-derived assets and other third-party materials
are outside that code license; see the repository root `LICENSE_SCOPE.md` and
`docs/THIRD_PARTY_MATERIALS.md`.

`orchestration.run_recorded_pipeline` drives the engine's existing completion
callbacks for the recorded product. It ports the source's spawn/queue workers,
race revisions, per-video finalization and one-consumer video path. File
discovery and canonical publication stay in Tournament Processor. The live
capture shell retains its own lifecycle; this change does not switch it to a
recorded-video scheduler. Source and target hashes are recorded alongside the
engine in `engine-provenance-v1.json`.

The process/revision/failure gates need no private media:

```powershell
.venv\Scripts\python.exe -m pytest tests/tournament/test_video_orchestration.py `
  tests/tournament/test_recorded_video_cli.py tests/tournament/test_recorded_overlap_comparison.py
```

`tooling/tournament/compare_recorded_overlap.py` compares private result CSVs,
standings and complete canonical JSON, and checks actual worker completions
against extraction completion in the JSONL trace. Its report contains hashes,
counts and mismatching field names, never participant rows. TN12 is the wall-clock
reference; a small golden fixture alone is not a performance gate.

TN12's six recordings are pinned in `tooling/tournament/golden-corpus-v1.json`
in filename order. Use its session, producer version and timestamp when making
canonical output. For a source CSV reference, call the existing
`recorded_export.write_recorded_results` with the same context and its default
per-video media IDs, as the video CLI does. The CSV-import CLI's explicit/input-
stem media identity is a different provenance context and must not be mixed
into that comparison.

Run its focused product and contract gate from the repository root:

```powershell
.venv\Scripts\python.exe -m pytest tests\tournament `
  tests\contracts\test_tournament_race_result_contract.py
```
