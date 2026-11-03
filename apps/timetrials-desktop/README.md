# LiveTrial (Windows desktop client)

LiveTrial recognizes Time Trial runs from a capture card or from recorded videos. It saves each run locally
(times, laps, character and kart setup, ghost and clip), lets you correct a recognition, and sends results to
your community's website after you sign in once. Results that cannot be sent yet wait in a local queue.

The recognition engine is under `vision-runtime/livetrial/` (its own MIT license); its templates and OCR models
come from the repository's asset collection. Build the Windows package with the commands in
[Client builds](../../docs/CLIENT_BUILDS.md).

## Everyday use without flags

Double-clicking `LiveTrial.exe` starts `livetrial_desktop_app.py`: a
windowed program without a console that serves the dashboard on `127.0.0.1:8776`
and the run history on `8777`, and opens the dashboard as its own window
(`msedge.exe --app=...`, Chrome when Edge is missing, otherwise the default
browser; it uses the person's own browser profile). Everything is a button.

**Top bar.** Tabs My records, Rank, Build, **Live** and **Run history**; the
account menu (add by email code, email link or website approval, switch,
remove), the sync clock, notifications, Settings (language, automatic send) and
Quit. The Live tab carries a grey dot while capture is off and a pulsing red dot
with a red outline while it is on, visible from every tab. Below 1500 px the tabs
take their own row.

**Capture bar** (every tab): Start/Stop capture (device list, one still picture
from the chosen device first), Analyse a video (choose the file, which is copied
into `%LOCALAPPDATA%\MK8DX\LiveTrial\videos`, or paste its path), and after each
race a **Last race** line: track, class and time, then "on the website",
"saved, waiting to be sent" (Send now) or "only on this PC" (Send as <account>).

**Live = what happens now.** Starting a capture opens Live. While the engine
loads its recognition (about 20 s) Live says so; until the first frame a black
16:9 box says "First picture from the capture card...". Then Live embeds the
engine's own live view (`8777/?view=live&embedded=1`): a large picture, a
**Picture NN fps** readout (green from 20), and a summary line with the track
picture, cup, class and the **last trigger** (ahead in green, behind in red),
which lights up on every new trigger, plus "N triggers recognised". One click
opens every event, lap chip, clip and the manual-record button (remembered).
The embedded view has no Stop button of its own (the app's is used) and reports
its height, so the frame never scrolls by itself. **This session** below lists
each race as it comes in, newest first, as the website's Home quick row: track
and cup pictures, class colour, character/body/tire/glider icons, mushrooms and
coins (or rupees, bells, shines) per lap, time, state and Send now / Send as /
Correct.

**Run history = everything, always.** `8777/?view=history`: the engine's run
history (all sessions, "finished only" on by default and remembered), also while
capturing - the engine serves it then. A switch shows **Send status &
corrections** instead: every result on this PC with its state, kart icons,
Correct and Send as.

**Correct** saves a new revision; the earlier one is kept. It edits track, class,
total and lap times, coins and mushrooms per lap and the kart combination
(searchable icon grids; body and glider colours follow the character). It checks
while typing and names the problem: unreadable times, laps that do not add up to
the total (with "use the lap sum as total"), coins outside 0-10 per lap (the
balance at the end of the lap), mushrooms outside 0-3 or more than 3 in total, a
lap count that does not fit the track (7 on Baby Park). A time faster than the
World Record this PC last saw is a warning that needs "Yes, this time is right".
The server side repeats the lap-count and lap-sum rules.

**Runs without an account** (recorded while nobody was signed in) stay on the PC
until the person chooses **Send as <account>**: a new submission for that Player
(a revision may not change its Player); the local original is closed as
`local.moved-to-account`.

**One save per race.** The engine rewrites a finished run's report moments after
writing it; before creating an entry the product path looks for the same race
(source, capture time, track, class, total, lap times) and keeps the first.

**Quit** stops a running capture (or analysis) the way Stop does, waits for it to
end and then quits; finished races are already saved. Starting LiveTrial again
reopens the window; a newer version asks an older idle one to quit and takes
over (`hand_over`). A window left open across a restart reloads itself once (its
action secret is refused with 403). LiveTrial closes itself after 15 minutes
without an open window and nothing running.

**Updates and the minimum version.** Signed in, LiveTrial reads the download
catalog: a newer release is a notification with the download. The LiveTrial
entry may carry `minimumSupportedVersion`; LiveTrial keeps it in
`windows-support.json` and, when older, shows a red "no longer supported" banner
on every tab and pauses sending (`client.update_required`, every run stays
pending); capture, analysis and saved runs keep working. Understood from 3.24.2.

Captures and analyses run the same CLI commands as child processes, with their
output in `%LOCALAPPDATA%\MK8DX\LiveTrial\logs`. `MK8DX_LIVETRIAL_NO_WINDOW=1`
serves the dashboard without opening a window (automated checks).

From a checkout:

```powershell
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_desktop_app.py
```

The numbered console menu remains for troubleshooting: `LiveTrialCli.exe menu`
(or `livetrial_app.py` from a checkout). It shows the current Player, the connected origin, how many results are waiting,
and whether automatic send is enabled. It offers add/switch/remove account,
analyze, capture, save a run, send everything, automatic-send settings, and a
capture-requirements check as numbered menu choices. **Player progress and
rivals** loads the signed-in Player's canonical standing, published bests,
Mastery distribution, Global focus, Rival list and closest shared-track battle.
**Open local dashboard and run history** presents that same projection as a
responsive graphical dashboard with track imagery, 150cc/200cc Mastery,
Your Focus, Rivalen and deduplicated closest battles. Its second tab preserves
the established runs, tracks, cups and goals dashboard on port `8777`. The
progress response is cached per Player for offline viewing; the cache never
contains a bearer token. **Correct a recognized result** creates a reviewed
next revision for a captured/video result without overwriting the earlier
observation. It can
correct track, mode, total/laps, per-lap coins/mushrooms, complete loadout,
country and recognized Player text. It performs every action
through the same product functions as the command line below, prints plain
language instead of failure identifiers, and never prints a token or a local
evidence path.

Automatic send is **off by default**. Menu option `10` can turn it on. A
completed run is always saved locally first; when the setting is on, LiveTrial
then makes one immediate owner-bound send attempt for that new run. Offline,
expired-session, or server failures leave the run safely waiting for the later
`Send all waiting results` action. This does not upload private video or capture
paths and does not start a background retry loop.

The console hands the signed-in Player's published bests and rivals to the
engine as `runs/player-reference.json` (`livetrial_reference.py`, format
`livetrial.reference.v1`, reduced from the offline progress cache; no
token, only names, times and ranks the site already shows the Player).
It is rewritten on sign-in, on a progress refresh, on opening the local
dashboard and at capture start (with a best-effort refresh first). The
engine overlay serves it as `GET /api/reference`; the dashboard's run
card shows the gaps to the Player's site record, the next rival ahead and
the rival behind, and the Goals page counts site records as bests. The
reference also carries `focus` (the home page's Rivals/Global trio per
150/200/all, computed in `build_focus`), `productVersion` and, when the
download page lists a newer Windows release, `update`; the dashboard shows
the version beside its logo, an update bar, and a Focus tab.

Capture from the console lists the DirectShow video devices FFmpeg sees
(`livetrial_capture_devices.py`), takes one warmed-up still picture from
the chosen one and shows it before the engine starts, then passes the
device as `--dshow-name`; a name shared by two cards is passed as FFmpeg's
unique alternative name. The choice is remembered in `settings.json`
(`captureDevice`, schema v3). Before 3.13.0 the console started the engine
without a device and it stopped with a flag message.

Live capture needs FFmpeg, which is not bundled. Before capture
starts, the product looks for `ffmpeg.exe` first under
`%LOCALAPPDATA%\MK8DX\LiveTrial\tools\ffmpeg\bin\` and then on PATH
(`livetrial_capture_requirements.py`); when it is missing, capture explains how
to install it and returns to the menu, and the flag-driven
`livetrial_product_cli.py check-capture [--json]` reports the same (exit 3 when
missing). Analysing a recording never needs FFmpeg.

## Local profile and passwordless session

Initialize the installation-local fallback profile once:

```powershell
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py init-profile
```

Local capture works without an account. To make later results eligible for
central Player synchronization, sign in before capture:

```powershell
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py sign-in
```

The command opens the same-origin MK8DX device approval page. Email/magic-link
authentication occurs in the browser; LiveTrial never collects a password. The
resulting bearer/expiry/verified claimed Player are protected for the current
Windows user with DPAPI under `%LOCALAPPDATA%\MK8DX\LiveTrial`.
Use `sign-in --no-browser` only when the printed approval URL will be opened in
another trusted browser; approval remains mandatory.

```powershell
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py session-status
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py sign-out
```

Signing out revokes the remote session before local removal. Authentication is
not required for offline capture or analysis.

## Several accounts on one PC

One PC is often shared, so more than one account can be remembered at a time.
Each account gets its own DPAPI-protected session file under
`%LOCALAPPDATA%\MK8DX\LiveTrial\accounts`, named after a slot id derived from
its central Player (`slot.<first 32 hex characters of sha256(playerId)>`). The
index beside those files records only slot id, Player, when the account was
added, when it was last used, and which account is active — never a token.

```powershell
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py accounts
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py switch --slot slot.<id>
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py sign-out --slot slot.<id>
```

`sign-in` adds an account and selects it. Capture, analysis and `save-run`
record runs for the selected account and bind each saved entry to it in a
desktop-owned side index (`accounts\entry-owners.json`); the canonical entry and
state documents are the closed contract shared with Android and are unchanged.
Signing one account out removes only that account's session file and index row,
never another account's session and never a saved result. An expired account
keeps its row so the product can ask for a new sign-in.

## Optional YouTube integration

A Player can connect their own YouTube channel and upload one of LiveTrial's
local race clips with a button. It is optional: without it, LiveTrial
works exactly the same, and nothing is ever uploaded unless the Player presses
**Upload to YouTube** on a clip (Run history -> **Clips & YouTube**). The list holds
every run's clip and each ghost replay's clip (**Ghost replay · name**).

- The video goes from the PC straight to YouTube. LiveTrial and
  `example.invalid` never host or receive it; the result is a plain
  `https://youtu.be/<id>` link to paste as a result's evidence.
- Each LiveTrial account connects its own channel (`accounts\<slot>.youtube.dat`,
  DPAPI-protected like its session); switching account switches the channel.
- It needs the **YouTube Data API v3** and a Google **Desktop app** OAuth client
  with only the `https://www.googleapis.com/auth/youtube.upload` scope. Put its
  JSON at `%LOCALAPPDATA%\MK8DX\LiveTrial\integrations\youtube-oauth-client.json`
  or point `LIVETRIAL_YOUTUBE_OAUTH_CLIENT` at it. Forks use their own client.
- **Never commit the client file** (or any `*.youtube.dat`); `.gitignore`
  excludes them.
- An API project that has not passed YouTube's audit can only upload
  **Private** videos, which others cannot watch; LiveTrial offers only Private
  until then. In Google's *Testing* mode connections also expire after about
  seven days.

Details: [user guide](docs/YOUTUBE_USER_GUIDE.md) and
[own Google client setup](docs/YOUTUBE_DEVELOPER_SETUP.md). The public pages Google reviews are
https://example.invalid/livetrial, /privacy and /terms (`apps/timetrials-web/pages/`); the audit
material is in `docs/youtube/`.

## Capture and recorded analysis

Run recorded-video analysis and canonical save as one command:

```powershell
C:\path\to\LiveTrialCli.exe init-profile
C:\path\to\LiveTrialCli.exe analyze --video C:\path\to\your-video.mp4
```

Or mount the live capture/dashboard shell:

```powershell
C:\path\to\LiveTrialCli.exe check-capture
C:\path\to\LiveTrialCli.exe capture -- --dshow-name "your capture device" --port 8777
```

Arguments after `--` go to the existing source process without shell
interpretation. Each completed report run is saved idempotently. Canonical
entries live under `canonical-outbox`; source paths, observed identity, ghost,
events, coordinates, and other retained details live under the separate
`private-evidence` root.

When a valid protected session exists at command start, new canonical entries
use its separately verified `player.*` even if capture subsequently runs
offline. Signed-out entries use `producer_local_profile` and remain local; they
are never silently rebound to an account.

## Results and synchronization

List privacy-safe newest-first summaries:

```powershell
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py list-results
```

Synchronize one selected claimed-Player entry or explicitly prepare a failed
entry for another later attempt:

```powershell
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py sync `
  --entry-key <64-character-entry-key>

.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py retry `
  --entry-key <64-character-entry-key>
```

Or send everything that is waiting, grouped by owning account:

```powershell
.venv\Scripts\python.exe apps\timetrials-desktop\livetrial_product_cli.py sync-all
```

An entry is always delivered with the credential of the account that produced
it, taken from the owner index and falling back to the Player recorded inside
the entry itself; it is never delivered with whichever account happens to be
selected. When the owning account is unknown or has to sign in again, that entry
is reported and left pending with one bounded outcome —
`account.local_profile_entry`, `account.unknown_owner`,
`account.player_mismatch`, `account.reauthorization_required` or
`account.synchronization_unavailable`, or `client.update_required` when this
LiveTrial is below the site's minimum version — and no outbox state is changed.

Each canonical result keeps its producer kind. Website manual entry appears as
Web, Android manual/scan as Android, and LiveTrial capture/recorded video as
Windows in Community Activity. When a Player changes a recognition-derived
field, the next immutable revision records the exact corrected field groups;
this is transparent review provenance, not a trust or cheating label.

Synchronization posts canonical V1 only to the fixed same-origin API route. It
does not read or upload the private-evidence document, follows no redirect, and
performs no automatic retry after the optional one-shot send. Only the
product-generated opaque
`livetrial/<sha256>` evidence reference is allowed in the canonical document.
Preparing a failed entry for retry is an offline local state transition and
does not require a session or create a network request.

## Safety and packaging

No runtime module derives a path from its own position in a repository
checkout. Bundled read-only resources (`packages/domain`,
`packages/assets/schema9-asset-catalog-v1.json`, and the local-outbox Python
reference) are resolved through `livetrial_runtime_root.resource_root()`, which
prefers the PyInstaller extraction directory when frozen, then an explicit
`MK8DX_LIVETRIAL_RESOURCE_ROOT` pointing at a directory that carries the same
`packages/...` layout, and finally the repository checkout so development is
unchanged.

The repository includes the reviewed LiveTrial model and game-derived runtime
assets. It contains no personal recording, private evidence, credential or
bearer session. Third-party rights are recorded separately in
[Third-party materials](../../docs/THIRD_PARTY_MATERIALS.md); publication is
not authorized.

Run product changes through the explicit contract, integration, source
inventory, private golden-corpus, and sensitive-data gates. Never run unscoped
root pytest discovery across preserved source snapshots.

The progress shell is loopback-only on `127.0.0.1:8776`, reads credentials only
inside the Desktop process and never serves a bearer token. Friendly track
names and preview images come from the internal collection packaged at build
time.

The dashboard uses a neutral icon by default. An operator may set
`MK8DX_LIVETRIAL_PRODUCT_ICON` to their own `.png`/`.ico` locally.

When the account in use has an expired sign-in, the console asks at start-up
whether to sign in again and lists **S) Sign in again as <Player>** above the
menu; the dashboard's status line names how old the offline copy is and points
to that choice. Signing in again for the same Player reuses its account slot.

The combined live browser/API/desktop gate is part of:

```powershell
pwsh -NoProfile -File tooling\web\validate_live_product.ps1
```

It uses only synthetic desktop input and disposable local infrastructure.
