# Tournament Directors: running a night

[All guides](../../README.md#get-started) · [Tournament Tools reference](../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

A Tournament Director runs a tournament night on the community website: participants, consoles, groups,
scores, finals and the published report. The Windows **Tournament Tools** can read the race results from
recordings or live capture, so you do not have to type every place by hand. They are optional: scores can also
be entered by hand or imported from Excel/CSV.

Recognition never makes a result official. You review every race before it counts, and you decide publication.

## 1. Get Director rights on your community's website

1. Sign in on the website (see [Players](PLAYERS.md)).
2. On the **Tournaments** page choose **Request to host**. An administrator approves or declines the request.
3. To send recognized races from the Windows tools to the website, an administrator also grants your signed-in
   Player access under **Administration → Tournaments → Tournament operators**. This gives Tournament access,
   not general administration.

## 2. Run the night on the website

Open the tournament from **Tournaments** (administrators also reach it under **Administration → Tournaments**).
The night is a sequence of steps; the page shows where you are:

| Step | What you do |
| --- | --- |
| 0 | Choose the Director |
| 1 | Start the tournament |
| 2 | Select the participants, mark who is present and which Switches are available |
| 3-4 | Create and export the qualifier layout (groups and seating) |
| 5 | Enter the qualifier scores: by hand, from an Excel/CSV file, or from **Incoming results** |
| 6 | Export the qualifier results |
| 7-8 | Check and export the final groups |
| 9 | Enter the final-group scores; an import works per group and refuses a group while a name is still unmatched |
| 10 | Finalize and share: final table, report and the WordPress export |

For races that came from the Tournament Tools: open **Incoming results** for the group, match each recognized
name to the right Player, check the track and the finishing places, and choose **Confirm**. A provisional live
table is not an official result. You can also import a result file directly with **Import races from a
Processor / Live file** inside a group, or **Administration → Tournaments → Import canonical race results**.

Publication and the community rating are separate decisions in the final step.

## 3. The Windows Tournament Tools

### Requirements

- Windows on x86-64 (tested on Windows 11) and several GB of free space. The ZIP is about 160 MB and about 1 GB extracted; the
  installer may download Python 3.12, public packages and OCR models on first use, more with GPU/CUDA. An NVIDIA
  card speeds up the OCR step only; the first scan of a recording always runs on the CPU (see
  [which steps use the graphics card](../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card)).
- For live capture: a capture card with a working Windows (DirectShow) driver. For recordings: nothing extra.
- Optional, for sending results: the website address and Tournament operator access (step 1).

### Install

1. From the project's [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) page (release
   packages are attached to each release), download `tournament-tools-….zip` and `SHA256SUMS.txt`. With a clone,
   you can build it yourself instead ([Build the tools yourself](#build-the-tools-yourself)). In PowerShell:
   `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`, and compare the whole value.
2. Extract the complete ZIP to a writable folder (not `Program Files`). Keep `runtime-assets\` next to the
   launchers.
3. Double-click `Install-MK8DX-TournamentTools.cmd` and wait for `SUCCESS`. Start with the normal CPU setup. If it
   fails, read `install.log` in the package folder.

The installer writes these launchers:

| Launcher | Use |
| --- | --- |
| `TournamentProcessor.cmd` | Drag an `.mp4` or `.mkv` recording onto it. It writes a session folder next to the video (`<name>_TournamentSession\Output_Results\`) with Excel, CSV and `<name>_TournamentRaceResultsV1.json`. |
| `TournamentAnalysis.cmd` | A window for the same recorded-video analysis with several videos or a folder per tournament ([below](#analyse-recordings-afterwards)). |
| `TournamentLive.cmd` | Live capture during the night, or replay a video: **Add video file** (or add a capture device), **Start all**, check **Confirmed standings**, then **Open exports**. |
| `TournamentConnect.cmd` | Optional connection to the website (below). |
| `TournamentLiveCli.cmd` | Diagnostics: device discovery, replay and result commands. Not a replacement for the live window. |

`TournamentTools.config.cmd` holds local paths and language preferences. Keep it, the `TournamentLive\` session
folder and your output folders when you install a newer package.

### Analyse recordings afterwards

Use Tournament Live when you capture the night as it happens. When the night ran without it and you only have
recordings, analyse them afterwards with the **Tournament Analysis** window:

1. Double-click `TournamentAnalysis.cmd` in the package folder.
2. **① Choose recordings**: **Add videos...** picks one or more recordings (`.mp4`, `.mkv`, `.mov`, `.avi`,
   `.ts`); **Add folder...** adds a folder that holds one tournament's recordings.
3. **② Choose videos**: everything you added is ticked; untick what should not be analysed (**All**, **None**,
   **Clear**).
4. **③ Run the analysis**: check the **Session id** (filled in from the first name and the date; it is stored
   with every race) and the **Results folder** (by default `<first name>_TournamentSession` next to the first
   recording), then choose **START ANALYSIS**. The window runs the same processing as `TournamentProcessor.cmd`;
   the activity log shows its coloured output, the start light turns amber and **Cancel** ends it. Recordings
   are linked into the results folder's `Input_Videos\`, or copied when they are on another drive.
5. **🏁 Results**: when it says **Finished**, **Open Latest Excel** or **Open Results Folder**: `Output_Results\`
   holds the Excel workbook, the CSV and `*_TournamentRaceResultsV1.json`. Check the races, then import the JSON
   on the website as described above.

The texts follow the Windows language (English or Dutch); `MK8DX_TOURNAMENT_LANGUAGE` in
`TournamentTools.config.cmd` overrides it. To show another image in the banner, set `MK8DX_ANALYSIS_BACKGROUND`
in `TournamentTools.config.cmd` to that file. From a clone, `python -m tournament_processor.gui` opens the same window when the
Tournament Processor and its recognition assets are installed; it needs PySide6 (the processor's `gui` extra) and
otherwise, or with `--classic-gui`, opens a simpler Tkinter window.

### Connect to the website (optional)

In PowerShell, in the package folder:

```powershell
.\TournamentConnect.cmd sign-in                           # asks for the website address once, then browser sign-in
.\TournamentConnect.cmd server                            # shows the address
.\TournamentConnect.cmd server https://www.example.org    # changes it (asks for confirmation)
.\TournamentConnect.cmd tournaments                       # lists the nights you may deliver to
.\TournamentConnect.cmd target                            # night and group for Tournament Live's live feed (clear-target)
.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json   # asks which night, then uploads
.\TournamentConnect.cmd sign-out
```

Use `http://127.0.0.1:<port>` only when the website runs on the same Windows computer; otherwise its trusted HTTPS
address. Uploads waiting for one server stay with that server. A delivered race lands in **Incoming results**;
it is never published automatically.

### Check what was read

OCR can misread a name, a place or a cumulative score. Compare every race with the screen or recording before
you confirm it. One known limitation: Tournament Live can export a correct race result with a misread
cumulative total, and the website review cannot edit the observed name or total (see
[Tournament Live on a local laptop](../product/README_TOURNAMENT_LIVE_LAPTOP.md)).

The tools read the game in its 15 console languages. Physical capture with Tournament Live has not had a
complete acceptance test; video replays do not test a capture card.

## Build the tools yourself

`python tooling/tournament/build_windows_package.py --output <new folder> --version local` from a clone builds
the same package; see [Client builds](../CLIENT_BUILDS.md).
