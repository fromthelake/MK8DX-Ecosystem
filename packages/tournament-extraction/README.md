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

This installs torch 2.15.0 / torchvision 0.29.2 from PyTorch's `cu132` index
on NVIDIA hardware whose driver supports CUDA 13.2, or the CPU index otherwise.
`--mode cpu` explicitly selects CPU; omit `--install` to inspect the selection
without installing. Run this inside the intended virtual environment, before
EasyOCR's dependency resolver can choose a different torch build. The Windows
Tools installer calls the same selector before its locked dependency closure and
checks the installed backend.

### CUDA and other graphics cards

Only OCR (EasyOCR on PyTorch) can use a graphics card. The first scan of a
recording reads every frame with OpenCV, and the `opencv-python` wheels from PyPI
have no CUDA, so it runs on the CPU on every platform (log: `Extract backend:
cpu`). The engine would use an OpenCV built with CUDA (`cv2.cuda`), but the
project neither builds nor tests one.

The selector (`setup_torch.py`, modes `auto`, `cuda`, `cpu`, `rocm-experimental`,
`mps-experimental`) decides per platform. No CUDA Toolkit is needed: the CUDA
PyTorch wheels bring their own CUDA libraries and only need the NVIDIA driver.

- **Windows with an NVIDIA card:** install a current NVIDIA driver; `nvidia-smi`
  must show `CUDA Version: 13.2` or higher. `auto` then installs the `cu132` build.
  With an older driver `auto` installs CPU, and `--mode cuda` stops with a driver
  message. AMD and Intel cards stay on CPU.
- **Linux with an NVIDIA card:** install NVIDIA's proprietary driver (Ubuntu:
  `sudo ubuntu-drivers install`, then reboot) so that `nvidia-smi` works and shows
  CUDA 13.2 or higher; the same `cu132` rule applies. Under WSL 2 the Windows
  driver provides the GPU: do not install a Linux driver inside WSL, just check
  `nvidia-smi` there. With an AMD card, `--mode rocm-experimental` installs
  PyTorch for ROCm (Linux only, experimental; validate the output yourself).
- **macOS:** CUDA does not exist on a Mac, so `auto` installs CPU PyTorch.
  `--mode mps-experimental` installs the standard macOS wheel; OCR then uses the
  Apple GPU through PyTorch MPS only when `MK8_EASYOCR_GPU_MODE=gpu` is set at run
  time. This is experimental and not validated for EasyOCR here: compare the
  output with a CPU run before relying on it.

Check the result in the same environment:

```sh
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

`2.15.0+cu132 True` means OCR will run on the NVIDIA card; the analysis log then
shows `OCR backend: cuda`. `MK8_EASYOCR_GPU_MODE=cpu` forces CPU OCR with a CUDA
build installed. Recorded-video analysis from source is verified on Windows; the
selector supports Linux and macOS, but no end-to-end run there has been recorded.

#### CUDA is not detected

Run each step in the virtual environment you use for the engine. Stop at the
first step that shows the problem.

1. **Is the driver there?** Run `nvidia-smi`.
   - A table with your card: go to step 2.
   - Command not found: install NVIDIA's driver and reboot (see your platform
     below), then repeat this step.
2. **Is the driver new enough?** Look at `CUDA Version:` in the top right of
   that table.
   - `13.2` or higher: go to step 3.
   - Lower: update the driver, reboot, and repeat step 1.
3. **What would the selector choose?** Run
   `python packages/tournament-extraction/python/src/mk8dx_tournament_extraction/setup_torch.py`
   (without `--install`; it only prints).
   - `Selected torch mode: cuda`: go to step 4.
   - `cpu`: the `Reason:` line says why. Fix that, then repeat this step.
4. **Which torch is installed?** Run
   `python -c "import torch; print(torch.__version__, torch.cuda.is_available())"`.
   - `+cu132 True`: torch uses the card. Go to step 5.
   - `+cpu False`: the CPU wheel is installed (often because EasyOCR's resolver
     ran before the selector). Run `setup_torch.py --install`, then repeat
     this step.
   - `+cu132 False`: the wheel cannot reach the card. Reboot after a driver
     change and start again at step 1.
5. **Is CPU forced?** Run `echo $MK8_EASYOCR_GPU_MODE` (PowerShell:
   `$env:MK8_EASYOCR_GPU_MODE`).
   - Empty or `gpu`: fine. The analysis log should now show `OCR backend: cuda`.
   - `cpu`: unset it and run the analysis again.

Per platform, when step 1 fails:

- **Windows:** in Device Manager, check under **Display adapters** that the card
  is enabled. Reboot after installing the driver.
- **Linux:**
  1. Run `lsmod | grep nvidia`. Empty means the driver's kernel module is not
     loaded.
  2. Run `mokutil --sb-state`. With `SecureBoot enabled`, the driver's key must
     be enrolled: reinstall the driver, reboot, and choose **Enroll MOK** in the
     blue screen that appears at boot.
  3. Under WSL 2, do not install a Linux NVIDIA driver inside WSL. Update the
     Windows driver instead, run `wsl --update` in Windows, and repeat step 1
     inside WSL.
- **macOS:** there is no CUDA, so this list does not apply. For the
  experimental MPS path, check
  `python -c "import torch; print(torch.backends.mps.is_available())"` and set
  `MK8_EASYOCR_GPU_MODE=gpu`.

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
