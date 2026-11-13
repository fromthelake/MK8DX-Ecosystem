# Tournament Tools: local installation

For the complete prebuilt-client route, open `MK8DX_Handleiding_NL.txt` or `MK8DX_User_Guide_EN.txt` from the same release as this package. In a source checkout, see the [Tournament Directors guide](../guides/TOURNAMENT_DIRECTORS.md). `TournamentConnect.cmd sign-in` asks for your community address on first use: local loopback HTTP for a one-computer test, or trusted HTTPS for a remote site. `TournamentConnect.cmd server` shows or changes it. Accounts and waiting uploads are kept per community.

The Windows package contains the four application wheels, distinct live and
recorded recognition assets, the schema-9 display collection and a pinned
public dependency list. Keep `runtime-assets/` beside the installer and the
launchers. The optional site connection uses an operator-configured server;
local extraction needs no account.

1. Extract the complete Tournament Tools archive to a writable folder.
2. Run `Install-MK8DX-TournamentTools.cmd`. It obtains Python 3.12 and public
   packages if needed, then writes five launchers. The reviewed EasyOCR weights
   are already in `runtime-assets/ocr-models`; review `install.log` if setup fails.
   PyTorch 2.15 uses CUDA 13.2. If `nvidia-smi` reports an older CUDA version,
   automatic setup selects CPU. Forcing CUDA then stops with a driver message;
   update the NVIDIA driver and select `auto` to enable CUDA again.
3. For a recorded video, drop an `.mp4` or `.mkv` onto
   `TournamentProcessor.cmd`. Results appear beside the recording in
   `<name>_TournamentSession/Output_Results/` as Excel, CSV and canonical JSON.
   For several recordings, or a folder per tournament, double-click
   `TournamentAnalysis.cmd` instead: add the videos or folders, tick the ones to
   analyse, check the session id and results folder, then **START ANALYSIS**. It
   runs the same processing with a live coloured log and progress bar, can be
   cancelled, and opens the workbook or results folder when done.
   `MK8DX_ANALYSIS_BACKGROUND` in `TournamentTools.config.cmd` can name another
   image for its banner.
   This is for analysis afterwards, when Tournament Live was not used on the night;
   see [Analyse recordings afterwards](../guides/TOURNAMENT_DIRECTORS.md#analyse-recordings-afterwards).
4. For live capture, connect the capture card and run `TournamentLive.cmd`.
   Confirm races in the operator UI before exporting them. `TournamentLiveCli.cmd`
   exposes device discovery, replay and result commands.
5. Import the canonical JSON through Tournament Manager's review flow. Import
   does not automatically accept or publish races. The optional
   `TournamentConnect.cmd` uses browser sign-in to a server chosen by the
   operator and retains local output if delivery is unavailable.

## Which steps use the graphics card

Analysing a recording has two steps. Only the second one uses an NVIDIA graphics card.

1. **The first scan always runs on the processor (CPU).** It reads every frame of the recording with OpenCV to
   find the track, race and score screens. The package installs the public `opencv-python` build from PyPI (pinned
   in `requirements.lock.txt`), and that build has no CUDA support. An OpenCV with CUDA has to be compiled for a
   specific CUDA version and card, which a download-and-run package cannot do, so the package does not ship one.
   The log shows `Extract backend: cpu`. The scan is not the slow part: on a laptop it reads about 1,500 frames
   per second, so a 22-minute recording takes about 30 seconds.
2. **Reading the names, points and times (OCR) uses the graphics card when CUDA is available.** Only the screens
   the scan selected are read. EasyOCR runs on PyTorch, and the installer picks the CUDA build of PyTorch when
   `nvidia-smi` reports a recent enough driver (see step 2 above); the log then shows `OCR backend: cuda`. Without
   a suitable NVIDIA card or driver, OCR runs on the processor (`OCR backend: cpu`) and takes longer.
   `MK8_EASYOCR_GPU_MODE=cpu` in `TournamentTools.config.cmd` forces the processor.

Measured on a laptop with an RTX 5080: three recordings of 18 to 22 minutes (12 races) took about 110 seconds in
the Tournament Analysis window. The graphics card was busy only while the text was being read.

### Using an NVIDIA graphics card

You do not install CUDA yourself. The CUDA build of PyTorch that the installer downloads carries its own CUDA
libraries; it only needs a recent NVIDIA driver.

1. Install or update the NVIDIA driver (from nvidia.com or the NVIDIA app). Open PowerShell and run `nvidia-smi`:
   the top right must show `CUDA Version: 13.2` or higher.
2. Run `Install-MK8DX-TournamentTools.cmd`. It detects the card and installs the CUDA build; `install.log`
   then says `PyTorch backend: cuda`. With an older driver it installs the CPU build and says why.
3. Updated the driver later? Run the installer again: it checks the card again and switches to the CUDA build.

To choose yourself, set `MK8DX_TORCH_MODE` before running the installer (`auto`, `cuda` or `cpu`; the
installer remembers the last choice). AMD and Intel graphics cards are used as CPU on Windows.
[Tournament extraction](../../packages/tournament-extraction/README.md#cuda-and-other-graphics-cards) has the
details for developers, including Linux and macOS.

### The NVIDIA card is not used: what to check

The analysis log says `OCR backend: cpu` although the computer has an NVIDIA card? Check these in order, in
PowerShell in the Tournament Tools folder:

1. **Does Windows see the driver?** Run `nvidia-smi`. "Not recognized" means the NVIDIA driver is missing:
   install it and restart the computer. Also check in Device Manager that the card is not disabled.
2. **Is the driver new enough?** The top right of `nvidia-smi` must say `CUDA Version: 13.2` or higher. Update
   the driver if it is lower.
3. **What did the installer choose, and why?** Open `install.log` and look for `PyTorch backend:` and the line
   after it. The last line, `install complete; runtime {...}`, names the installed build: `"torch": "...+cu132"`
   with `"effectiveBackend": "cuda"` is right; `+cpu` means the CPU build was installed.
4. **What would it choose now?** Run `runtime\Scripts\python.exe tools\select_torch.py`. It installs nothing
   and shows the cards it found, whether `nvidia-smi` works, the mode it would select and the reason.
5. **Can PyTorch use the card?** Run
   `runtime\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"`.
   - `...+cpu False`: the CPU build is installed. After fixing 1 and 2, run the installer again. If it keeps
     choosing CPU because an earlier run was told to, run `set MK8DX_TORCH_MODE=auto` in a Command Prompt and
     start `Install-MK8DX-TournamentTools.cmd` from that same window.
   - `...+cu132 False`: the CUDA build is there but cannot reach the card. Restart after a driver installation
     or update, and check 1 and 2 again.
   - `...+cu132 True`: PyTorch uses the card.
6. **Is CPU forced in the settings?** In `TournamentTools.config.cmd`, the line
   `set "MK8_EASYOCR_GPU_MODE=cpu"` must stay commented out (`rem`).

Still on CPU? Keep `install.log` and the output of steps 4 and 5 when you ask for help. The results are
correct either way; the CPU is only slower.

`TournamentTools.config.cmd` holds local paths and language preferences. Keep
that file and the `TournamentLive/` session folder during updates. The live
launcher uses `runtime-assets/live`; the recorded launcher uses
`runtime-assets/recorded`; both use `runtime-assets/clean-assets` for display.
Back up session/output folders before replacing the package. No original MK8DX
source or private asset folder is needed. Publication and third-party rights
remain covered by [Third-party materials](../THIRD_PARTY_MATERIALS.md).
