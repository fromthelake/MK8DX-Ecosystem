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
hardware-selected CPU/CUDA wheels from PyTorch followed by the locked closure
from PyPI, and writes `TournamentProcessor.cmd`: drag a
recorded video onto it and the results land next to the video in
`<name>_TournamentSession\Output_Results\` (Excel, CSV and
`*_TournamentRaceResultsV1.json`). Private recognition assets stay outside the
package and are referenced through `TournamentTools.config.cmd`. The user guide
is `docs/product/USING_MK8DX_TOURNAMENT_TOOLS.md`.
## Optional Tournament Manager connection

Processor remains fully local-first and batch-capable. After
`TournamentConnect.cmd target` explicitly selects an owned Tournament/group,
`--send-to-manager` uploads only unseen stable revisions as pending evidence.
Failed uploads retain both the source file and local retry context; manual file
import remains the fallback.
