# Tournament Processor

Tournament Processor reads recorded videos of a tournament night and turns every race into a
`TournamentRaceResultV1` document, plus the Excel and CSV files organizers already use. Drop an `.mp4` or `.mkv`
on `TournamentProcessor.cmd`; a session folder appears next to the video. The organizer checks the result and
imports it into the website's Tournament workflow, or sends it through the optional Tournament Manager
connection.

The recognition shared with Tournament Live lives in `packages/tournament-extraction/`. The Windows package is
built with `tooling/tournament/build_windows_package.py`; see [Client builds](../../docs/CLIENT_BUILDS.md).

## Windows package for non-developers

Operators do not need a checkout. `tooling/tournament/build_windows_package.py`
builds a small portable package (the four product/shared wheels, a locked third-party
requirements file and a double-clickable `Install-MK8DX-TournamentTools.cmd`).
The installer prepares a package-local Python 3.12 runtime (system Python 3.12
via venv, otherwise the SHA-256-verified python.org embeddable runtime), installs
hardware-selected CPU/CUDA wheels from PyTorch (used by OCR; the first OpenCV scan is CPU-only, see
[which steps use the graphics card](../../docs/product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card))
followed by the locked closure
from PyPI, and writes `TournamentProcessor.cmd`: drag a
recorded video onto it and the results land next to the video in
`<name>_TournamentSession\Output_Results\` (Excel, CSV and
`*_TournamentRaceResultsV1.json`). Private recognition assets stay outside the
package and are referenced through `TournamentTools.config.cmd`. The user guide
is `docs/product/USING_MK8DX_TOURNAMENT_TOOLS.md`.

## Analysis window (afterwards, without Tournament Live)

`TournamentAnalysis.cmd` (or `python -m tournament_processor.gui`, console script
`mk8dx-tournament-analysis`) opens **MK8DX Tournament Analysis** for nights that
ran without Tournament Live. The Qt window (`tournament_processor/qt/`, needs the
`gui` extra: PySide6 6.12.0) is a port of the MK8DX Live Video Processor post-analysis GUI:
banner, numbered steps, live ANSI-coloured log, Rainbow Road progress bar and
start-light status. Without PySide6, or with `--classic-gui`, the Tkinter window
in `gui_classic.py` opens instead (as Tournament Live's `run_gui` does).

1. **① Choose recordings**: **Add videos...** (`.mp4 .mkv .mov .avi .ts`) or
   **Add folder...** (one folder = one tournament's recordings).
2. **② Choose videos**: tick the entries to analyse.
3. **③ Run the analysis**: check the **Session id** (default: the first name plus
   today's date unless the name has a date; 1-128 characters, required for
   publication) and the **Results folder** (default `<first name>_TournamentSession`
   beside it). **START ANALYSIS** links (or, across drives, copies) the recordings
   into `<results folder>\Input_Videos\` - a folder's videos into a sub-folder of
   its own name - and runs `python -m tournament_processor.vision_cli all
   --runtime-root <results folder> --session-id <id> --videos <names>` as a child
   process with `MK8_FORCE_COLOR=1`. Its output streams into the log; a `Comp NN%`
   status shows in the status line; **Cancel** ends the process tree.
4. **🏁 Results**: **Open Latest Excel**, **Open Results Folder** (`Output_Results\`:
   Excel, CSV, `*_TournamentRaceResultsV1.json`) and **Open Frames**.

The window does no recognition of its own; results are those of the command line.
Texts are English or Dutch (`MK8DX_TOURNAMENT_LANGUAGE`, otherwise the Windows
language). The banner paints the original window's artwork (`qt/assets/bg.jpg`, listed
in `docs/THIRD_PARTY_MATERIALS.md` and `packages/assets/native-binaries-v1.json`);
`MK8DX_ANALYSIS_BACKGROUND` may name another image, and without any image the banner
is drawn in code. Only the original's `gui/` presentation modules were ported; its
engine bridge (`core_bridge.py`, its `main.py` flags) was replaced by the central
`vision_cli all` route, and `test_processor_analysis_qt.py` fails if a window module
imports the original projects or recognition code. Planning, staging, log/progress parsing and front-end choice are
covered by `tests/windows_clients/test_processor_analysis_gui.py` and
`test_processor_analysis_qt.py` (the Qt part runs headless and is skipped without
PySide6).

## Optional Tournament Manager connection

Processor remains fully local-first and batch-capable. After
`TournamentConnect.cmd target` explicitly selects an owned Tournament/group,
`--send-to-manager` uploads only unseen stable revisions as pending evidence.
Failed uploads retain both the source file and local retry context; manual file
import remains the fallback.
