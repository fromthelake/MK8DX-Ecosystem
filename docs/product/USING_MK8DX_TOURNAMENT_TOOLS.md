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
   `TournamentAnalysis.cmd` instead: add the videos or folders, check the session
   id and results folder, then **Start analysis**. It runs the same processing,
   shows its progress, can be stopped, and opens the results folder when done.
   This is for analysis afterwards, when Tournament Live was not used on the night;
   see [Analyse recordings afterwards](../guides/TOURNAMENT_DIRECTORS.md#analyse-recordings-afterwards).
4. For live capture, connect the capture card and run `TournamentLive.cmd`.
   Confirm races in the operator UI before exporting them. `TournamentLiveCli.cmd`
   exposes device discovery, replay and result commands.
5. Import the canonical JSON through Tournament Manager's review flow. Import
   does not automatically accept or publish races. The optional
   `TournamentConnect.cmd` uses browser sign-in to a server chosen by the
   operator and retains local output if delivery is unavailable.

`TournamentTools.config.cmd` holds local paths and language preferences. Keep
that file and the `TournamentLive/` session folder during updates. The live
launcher uses `runtime-assets/live`; the recorded launcher uses
`runtime-assets/recorded`; both use `runtime-assets/clean-assets` for display.
Back up session/output folders before replacing the package. No original MK8DX
source or private asset folder is needed. Publication and third-party rights
remain covered by [Third-party materials](../THIRD_PARTY_MATERIALS.md).
