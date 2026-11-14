# Tournament Directors: running a night

*This is the US English edition, adapted from the [UK English guide](../../TOURNAMENT_DIRECTORS.md); the UK English version is authoritative. Corrections are welcome through the "Translation correction" issue form.*

[All guides](../../../../README.md#get-started) · [Tournament Tools reference](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

A Tournament Director runs a tournament night on the community website: participants, consoles, groups,
scores, finals and the published report. The Windows **Tournament Tools** can read the race results from
recordings or live capture, so you do not have to type every place by hand. They are optional: scores can also
be entered by hand or imported from Excel/CSV.

**Without a website:** the Windows Tournament Tools in [section 3](#3-the-windows-tournament-tools) (Processor,
Analysis and Live) work on their own. They write Excel, CSV and JSON files on your PC; Connect is optional.

Recognition never makes a result official. You review every race before it counts, and you decide publication.

## 1. Get Director rights on your community's website

1. Sign in on the website (see [Players](PLAYERS.md)).
2. On the **Tournaments** page choose **Request to host**. An administrator approves or declines the request.
   Administrators, and Directors once approved, do not see that button: they see **Create new tournament** on
   the same page (in the **Race direction** bar) and start the night from there.
3. To send recognized races from the Windows tools to the website, an administrator also grants your signed-in
   Player access under **Administration → Tournaments → Directors**. This gives Tournament access,
   not general administration.

## 2. Run the night on the website

Open the tournament from **Tournaments** (administrators also reach it under **Administration → Tournaments**).
The night is a sequence of steps; the page shows where you are:

| Step | What you do |
| --- | --- |
| 0 | Choose the Director |
| 1 | Start the tournament |
| 2 | Select the participants, mark who is present and which Switches they bring (the **NS1**/**NS2** checkboxes next to each name) |
| 3-4 | Create and export the qualifier layout (groups and seating) |
| 5 | Enter the qualifier scores: by hand, from an Excel/CSV file, or from **Incoming results** |
| 6 | Export the qualifier results |
| 7-8 | Check and export the final groups |
| 9 | Enter the final-group scores; an import works per group and refuses a group while a name is still unmatched |
| 10 | Finalize and share: final table, report and the WordPress export |

Step 2 only continues when there are enough Switches: every Switch seats two Players, so the night needs at least
half the Present participants, rounded up, in checked Switches (9 Present Players need 5). The readiness box under
the list shows how many are missing; check the Switches people bring, or move participants to Waiting list or Absent.

For races that came from the Tournament Tools: open **Incoming results** for the group, match each recognized
name to the right Player, check the track and the finishing places, and choose **Confirm**. A provisional live
table is not an official result. You can also import a result file directly with **Offline fallback: import a
saved Live / Processor result file** inside a group, or **Administration → Tournaments → Import canonical race results**.

Publication and the community rating are separate decisions in the final step.

## 3. The Windows Tournament Tools

### Requirements

- Windows on x86-64 (tested on Windows 11) and several GB of free space. The ZIP is about 160 MB and about 1 GB extracted; the
  installer needs internet once, to download Python 3.12 and public packages (more with GPU/CUDA); the detection and
  Latin-script OCR models are included, and the first English OCR run downloads one more model (english_g2.pth,
  about 15 MB) once. After that, processing works offline. An NVIDIA
  card speeds up the OCR step only; the first scan of a recording always runs on the CPU (see
  [which steps use the graphics card](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card)).
- For live capture: a capture card with a working Windows (DirectShow) driver. For recordings: nothing extra.
- Optional, for sending results: the website address and Tournament operator access (step 1).

### Install

1. From the project's [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) page (release
   packages are attached to each release), download `tournament-tools-….zip` and `SHA256SUMS.txt`. With a clone,
   you can build it yourself instead ([Build the tools yourself](#build-the-tools-yourself)). In PowerShell:
   `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`, and compare the whole value.
2. Extract the complete ZIP to a writable folder (not `Program Files`). Keep `runtime-assets\` next to the
   launchers.
3. Double-click `Install-MK8DX-TournamentTools.cmd` and wait for `SUCCESS`. It selects NVIDIA CUDA or CPU PyTorch
   for this computer by itself. If it fails, read `install.log` in the package folder.

The installer writes these launchers:

| Launcher | Use |
| --- | --- |
| `TournamentProcessor.cmd` | Drag an `.mp4` or `.mkv` recording onto it. It writes a session folder next to the video (`<name>_TournamentSession\Output_Results\`) with Excel, CSV and `<name>_TournamentRaceResultsV1.json`. |
| `TournamentAnalysis.cmd` | A window for the same recorded-video analysis with several videos or a folder per tournament ([below](#analyze-recordings-afterward)). |
| `TournamentLive.cmd` | Live capture during the night, or replay a video: **Add video file** (or add a capture device), **Start all**, check **Confirmed standings**, then **Open exports**. To deliver the run, see [Tournament Live to the website](#tournament-live-to-the-website). |
| `TournamentConnect.cmd` | Optional connection to the website (below). |
| `TournamentLiveCli.cmd` | Diagnostics: device discovery, replay and result commands. Not a replacement for the live window. |

`TournamentTools.config.cmd` holds local paths and language preferences. Keep it, the `TournamentLive\` session
folder and your output folders when you install a newer package.

### Analyze recordings afterward

Use Tournament Live when you capture the night as it happens. When the night ran without it and you only have
recordings, analyze them afterward with the **Tournament Analysis** window:

1. Double-click `TournamentAnalysis.cmd` in the package folder.
2. **① Choose recordings**: **Add videos...** picks one or more recordings (`.mp4`, `.mkv`, `.mov`, `.avi`,
   `.ts`); **Add folder...** adds a folder that holds one tournament's recordings.
3. **② Choose videos**: everything you added is checked; uncheck what should not be analyzed (**All**, **None**,
   **Clear**).
4. **③ Run the analysis**: check the **Session id** (filled in from the first name and the date; it is stored
   with every race) and the **Results folder** (by default `<first name>_TournamentSession` next to the first
   recording), then choose **START ANALYSIS**. The window runs the same processing as `TournamentProcessor.cmd`;
   the activity log shows its colored output, the start light turns amber and **Cancel** ends it. Recordings
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

Use `http://127.0.0.1:<port>` (or `http://localhost:<port>`) only when the website runs on the same Windows
computer, as A1 and A3 do: plain HTTP is accepted for these addresses on this PC and for nothing else; every other
address needs its trusted HTTPS address. Without a terminal (for example from a script) `sign-in` does not ask:
set the address first with `TournamentConnect.cmd server <address>`. Uploads waiting for one server stay with that
server. A delivered race lands in **Incoming results**; it is never published automatically.

### Tournament Live to the website

1. In Tournament Live choose **Connect to Tournament Manager** (later **Change Tournament**), finish the browser
   sign-in and pick the night in **Choose Tournament**. That choice is only a suggestion; you can make it before
   or after the run.
2. Run the feeds (**Add video file** or a capture card, then **Start all**). Tournament Live may add a capture
   card it remembers by itself, as an extra source on Group 1. With a video on Group 1 as well, **Start all**
   stops with *Assign every feed to exactly one different group*: select the extra source and choose **Remove
   selected**, or give it its own group, and start again.
3. On the website, open the night, go to Step 5 (Step 9 for the final groups) and find the run under **Available Tournament Live recordings**.
   Choose its group in **Link to group**, then **Link reviewed recording**. The races wait as pending evidence
   until you accept them.

### Connect later

A night processed without a connection is complete on your PC: `Output_Results\` holds the Excel workbook, the CSV
and `*_TournamentRaceResultsV1.json`. Tournament Live without a connection writes its Excel workbook too: when you
stop the feeds, when the analysis finishes, or when you close the window while feeds still run (it stops them
first). The files stay in `Live_Output\exports` (**Open exports**) after you close it. If Live is killed before
the feeds stop, that final workbook is missing; the recordings remain and Tournament Analysis or the Processor
makes the same workbook from them. Nothing is sent by itself afterward; bring it to the website in one of
these ways:

- In the group on the website: **Offline fallback: import a saved Live / Processor result file** with the JSON,
  or the group's Excel import. Every recognized name must be matched to a Player first; an import refuses a group
  while a name is unmatched.
- An administrator: **Administration → Tournaments → Import canonical race results**. Imported races stay private
  until they are published.
- With TournamentConnect: `.\TournamentConnect.cmd sign-in`, then
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`. It asks for the night, the group and the
  first race number; the races arrive in **Incoming results**. If the website cannot be reached, the file stays
  where it is; send it again later.
- In Tournament Live: choosing the night with **Connect to Tournament Manager** after a session has finished offers
  that finished session to the night. Uploads that failed while Live was connected are kept and sent again,
  automatically or with **Retry upload**, only for the same signed-in account. A session run with **Work offline**
  is not kept for upload; use one of the routes above for its file.

Signing in adds two things: the list of nights you may deliver to, and the live feed during the night (`target`),
which sends each race to the chosen group as Tournament Live recognizes it. Either way a race counts only after
you confirm it in **Incoming results**.

### Check what was read

OCR can misread a name, a place or a cumulative score. Compare every race with the screen or recording before
you confirm it. One known limitation: Tournament Live can export a correct race result with a misread
cumulative total, and the website review cannot edit the observed name or total (see
[Tournament Live on a local laptop](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md)).

The tools read the game in its 15 console languages. Tournament Live passed a physical 1× acceptance run with the
v0.2.2 package: three source PCs played recorded qualification videos into their own capture cards
([issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)). A video replay without a capture card
does not test the capture path.

## Build the tools yourself

`python tooling/tournament/build_windows_package.py --output <new folder> --version local` from a clone builds
the same package; see [Client builds](../../../CLIENT_BUILDS.md).
