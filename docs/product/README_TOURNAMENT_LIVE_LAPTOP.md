# Tournament Live on a local laptop

Extract the full package, run `Install-MK8DX-TournamentTools.cmd`, then start
`TournamentLive.cmd`. Use the capture-device selector to choose a local video
source. Start a new session, review recognized racers and scores, then confirm
each race before exporting canonical results. Keep recordings, workbooks and
`TournamentLive/` outside source control. Optional Tournament Manager delivery
requires an operator-configured server and browser sign-in. See
[Tournament Tools](USING_MK8DX_TOURNAMENT_TOOLS.md) for asset paths and updates.

## Known score review limitation

Tournament Live can recognize and deliver a race while misreading an OCR name
or cumulative score. On one reviewed 12-player recording, the race points were
correct but one displayed total was exported one point too high. The source
component also dropped its internal score-mismatch warning before canonical
export. The current Tournament Manager review can link an observed name to a
Player, but cannot edit the observed name or cumulative score. Check these
fields against the recording before accepting an official result. This is a
known component limitation and a focused improvement item; it does not prevent
local installation, race delivery, or review of the correctly recognized race
points. No automatic OCR-accuracy claim follows from a successful upload.
