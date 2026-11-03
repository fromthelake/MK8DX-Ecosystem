# Tournament Live

Tournament Live captures the races of a tournament night from capture cards while the night is running. It
records first, recognizes the result screens (placings, player names, characters and scores) and shows a
provisional live table. Results reach the website only through the organizer's review in the Tournament
workflow; a live table is never an official result.

Capture-card discovery, reconnects, rolling buffers, the operator dashboard and the OBS overlay belong to this
application. The recognition shared with Tournament Processor lives in `packages/tournament-extraction/`. The
Windows package is built with `tooling/tournament/build_windows_package.py`; see
[Client builds](../../docs/CLIENT_BUILDS.md).

## Recording-first capture

MKV recording is optional and off by default. Start while it is off is always
blocked by the prominent EN/NL warning with Cancel as the default and Escape
action. When it is enabled, the FFmpeg process that owns the capture card also
writes the primary full-rate MKV. Dashboard and OCR receive a separately
bounded packet stream and may shed their own work under load without using a
dropping Python recorder queue.

Each Start creates a unique run. A normal uninterrupted feed writes one working
part and publishes it atomically as one final MKV; a writer restart retains a
new part and Stop losslessly remuxes compatible parts into one final video per
feed. There are no scheduled five-minute segments. Pause affects analysis only
and recording continues until Stop.

Stop closes capture, drains all already-offered analysis, persists local
canonical/Excel/CSV results, completes the connected delivery barrier, and
only then validates and assembles recordings. Connected delivery is either
acknowledged and visible or retained in a durable outbox with its original
context. A failed connection permits local completion and offers Retry without
blocking recording finalization or the next run. Final MKVs are fully probed/demuxed, decoded at the
head and tail, duration/stream checked and SHA-256 recorded before the UI says
they are safely saved. Audio is recorded when an explicit per-feed DirectShow
audio device is selected.

After an interrupted run, the startup recovery prompt verifies retained working
parts and assembles valid recordings. It marks recovered runs with evidence gaps;
it does not manufacture missing analysis or scores. Every run must pass validation
before the recovery banner turns green. Invalid files remain retained and the UI
names the failed runs in red. A permanently stuck analysis job can still block
normal Stop finalization after capture parts have closed; restart recovery is a
separate path, not an automatic analysis timeout.

## Windows package for non-developers

The same portable package built by `tooling/tournament/build_windows_package.py`
installs this product and writes `TournamentLive.cmd` (Qt GUI) and
`TournamentLiveCli.cmd` (dry-run, capture-devices, replay, results CLI). The
installer adds the python.org Tcl/Tk add-on to the embedded runtime because the
GUI module still imports tkinter-based helpers. Writable state is rooted at the
package's `TournamentLive\` folder through `MK8DX_TOURNAMENT_LIVE_ROOT` in
`TournamentTools.config.cmd`; private assets remain external (`ASSET_NOTICE.md`).
See `docs/product/USING_MK8DX_TOURNAMENT_TOOLS.md`.
## Optional Tournament Manager connection

Live remains fully local-first. The Qt connection bar starts browser/device
authorization and can optionally remember an active Tournament as an advisory
suggestion. It clearly distinguishes signed-in/unassigned from offline, and a
suggestion can be added after analysis. Every Start–Stop run is uploaded as an
independent evidence record; filename/group inference is advice and the
Tournament director chooses the record and group mappings. Only that link
creates pending races, after which explicit reconciliation and acceptance stay
authoritative. A ledger suppresses duplicate updates and an offline outbox
retains retry context. No password is collected and loss of connectivity never
loses local JSON/CSV/Excel. `TournamentConnect.cmd` remains the CLI route.

## Physical operator follow-up

The September acceptance corrects dark-opening geometry, capture buffer/tail
lifecycle, long-session Qt log stalls, scoring-segment export and post-reset
character continuity. Complete evidence and limitations are in the end-to-end
gate. Keep MKV recording explicitly ON and select/test each matching audio
device; an audio stream can contain silence. A permanently blocked analysis
worker still requires restart, while independent FFmpeg recording and actual
Qt recovery have been demonstrated. Use the fixed all-feeds `?view=grid` overlay.

Confirmed results upload during capture, but Manager offers the record after
completion. Link and review/Accept remain separate from upload. The operator
guide documents browser refresh, manual saves and captured opening balances.

The Qt source chooser, preview titles and feed tabs support remembered local
capture-card names. Select a source and choose **Name capture card**, for example
`CC Group 1`. Names bind to the unique DirectShow video ID, never enumeration
order or a USB port. An unknown ID falls back to its technical device name;
verify picture/audio and label it explicitly. Rename updates only widgets and
local preferences, preserving recording paths, source IDs and existing results.
Technical video/audio IDs remain in the source row's tooltip.

Both **Add capture device** and its **Capture-card audio** chooser show the
remembered name before selection, followed by the original device name. Naming
a card records its explicitly selected audio endpoint too; for example the
audio chooser shows `CC Group 1 · audio`. Only an exact audio ID match gets
that label. Shared audio endpoints or newly enumerated IDs retain technical
labels until explicitly reviewed. Selecting a known card also selects its saved
audio endpoint when that exact ID is present and uniquely associated. Otherwise
the audio chooser asks for an explicit choice. The selected audio stays visible
in the source row; always check the actual picture and sound.

The connection bar names the signed-in account's server-verified Player when
available. This optional, read-only identity uses the existing native bootstrap;
failure does not block local processing. A display-only cache is bound to the
exact session and API origin, so it is not reused for another account.
The visible upload line distinguishes queued/local work, retry in progress and
an empty queue. An empty queue is not website acceptance. Failed final uploads
still require **Retry upload** after reconnection; automatic queue retry is a
separate open improvement, not a behavior this UI claims.
