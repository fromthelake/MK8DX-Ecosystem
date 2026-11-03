# LiveTrial: record Time Trials on Windows

[All guides](../../README.md#guides) · [LiveTrial component README](../../apps/timetrials-desktop/README.md)

LiveTrial is a Windows program that watches your Time Trials through a capture card, or reads recorded videos,
recognizes each run (total and lap times, character and kart setup, ghost) and saves it on your PC with a clip.
After you sign in once, it can send the results to your community's website. Results that cannot be sent yet
wait on the PC.

## Requirements

- Windows on x86-64 (tested on Windows 11). About 1 GB for the program plus room for your recordings.
- For live capture: a capture card that Windows lists as a video device, with its driver, and **FFmpeg** (free,
  not included because of its licence; see step 4 below). For video files: no capture card and no FFmpeg.
- To send results: the address of your community's website and an account there (see [Players](PLAYERS.md)).
  On the same computer as a local trial installation, `http://127.0.0.1:<port>` works; otherwise use the trusted
  HTTPS address.

## Install

1. From the project's [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) page (release
   packages are attached to each release), download `desktop-client-….zip` and `SHA256SUMS.txt`. With a clone,
   you can build the same package yourself instead: [Client builds](../CLIENT_BUILDS.md#livetrial-windows). Check it in PowerShell:
   `Get-FileHash '.\desktop-client-<version>.zip' -Algorithm SHA256` and compare the whole value.
2. Extract the **whole** ZIP to a folder you own, for example under Documents. Keep its folder structure; the
   package carries its own Python runtime, recognition engine and game assets.
3. Double-click `LiveTrial.exe`. The dashboard opens as its own window (Edge, else Chrome, else your default
   browser). Analysing videos works right away.
4. For live capture, install FFmpeg once. The easiest way: open PowerShell and run `winget install Gyan.FFmpeg`,
   then quit and restart LiveTrial so it sees the new PATH. Without winget, download a Windows build (for example
   the gyan.dev release zip, linked from [ffmpeg.org/download.html](https://ffmpeg.org/download.html)), unzip it
   and copy `bin\ffmpeg.exe` to `%LOCALAPPDATA%\MK8DX\LiveTrial\tools\ffmpeg\bin\`. If FFmpeg is missing,
   **Start capture** says so and shows these steps.

## Connect to your community

1. Open **Settings**. Enter your community's address under **Community website address** (for example
   `https://www.example.org`) and choose **Save server**. LiveTrial restarts itself; leave it open.
2. After the restart, check that Settings shows your exact address, then sign in from the account menu (email
   code, email link or approval on the website).
3. If the automatic restart fails, choose **Quit LiveTrial** in the app, wait until it has closed, and start
   `LiveTrial.exe` again. Closing only the window is not enough: LiveTrial may keep running in the background.

Accounts and waiting runs are kept separately per server: switching servers never sends old runs to the new
community. Never enter the local mail inbox address or a server's internal address in LiveTrial.

## Use it

- **Start capture**: choose the capture card. LiveTrial shows one still picture from it first, so you can check
  it is the right device. The **Live** tab then shows the picture and every recognized run.
- **Analyse a video**: choose an `.mp4`/`.mkv` file (it is copied into
  `%LOCALAPPDATA%\MK8DX\LiveTrial\videos`) and LiveTrial processes it like a capture.
- After each race the **Last race** line says where the run is: on the website, saved and waiting to be sent
  (**Send now**), or only on this PC (**Send as <account>**).
- **Run history** lists every run with its clip. You can correct a recognition; a correction saves a new
  version and keeps the earlier one.
- Automatic sending is off by default; turn it on in Settings. A run is always saved locally first.

Set **Language of your Switch** in Settings when the console language differs from the dashboard language.

## Problems

- Wrong website, or sign-in opens the wrong site: quit LiveTrial with **Quit LiveTrial**, start it again and check
  the address in Settings. Another Windows account on the same PC may still have LiveTrial running.
- No capture device listed: check the USB connection and driver, wait a few seconds and try again.
- Recognition errors: correct the run in Run history before sending. Recognition is never a substitute for
  checking your own result.

LiveTrial is Windows only; there is no macOS or Linux build. To build it yourself, see
[Client builds](../CLIENT_BUILDS.md).
