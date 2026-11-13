"""MK8DX Tournament Analysis: a small window around the recorded-video processor.

For a tournament night that ran without Tournament Live: choose the recordings afterwards (video files, or a
folder per tournament), give the session an id and start. The window runs the existing
``python -m tournament_processor.vision_cli all`` in a child process and shows its output; it does not
recognise anything itself, so its results are exactly those of the command line and of
``TournamentProcessor.cmd``.

This module is the entry point and the shared, display-free part: the plan (which files go where, which command
runs), staging, texts and the front-end choice. ``main`` opens the Qt window (``tournament_processor.qt``, a port
of the MK8DX Live Video Processor post-analysis GUI) and falls back to the classic Tkinter window (``gui_classic``) with
``--classic-gui`` or when PySide6 is missing, as Tournament Live's run_gui does.

Texts are English and Dutch, like the Tournament Tools launchers: ``MK8DX_TOURNAMENT_LANGUAGE`` (en, nl or auto)
chooses, and auto follows the Windows display language.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import locale
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence

# The same list as vision_cli.VIDEO_SUFFIXES (a test keeps them equal); repeated here so this module imports
# without the recognition stack.
VIDEO_SUFFIXES = (".mp4", ".mkv", ".mov", ".avi", ".ts")
INPUT_FOLDER = "Input_Videos"
OUTPUT_FOLDER = "Output_Results"
SESSION_SUFFIX = "_TournamentSession"
# TournamentRaceResultV1 source.sessionId: a string of 1 to 128 characters.
SESSION_ID_MAX_LENGTH = 128
_DATE_IN_NAME = re.compile(r"(19|20)\d{2}-?[01]\d-?[0-3]\d")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

# --------------------------------------------------------------------------- #
# Language                                                                     #
# --------------------------------------------------------------------------- #

TEXTS: dict[str, tuple[str, str]] = {
    "title": ("MK8DX Tournament Analysis", "MK8DX Tournament Analysis"),
    "intro": (
        "Analyse the recordings of a tournament night afterwards: races, positions, characters and points, "
        "written to Excel, CSV and a website import file for you to check.",
        "Analyseer de opnames van een toernooiavond achteraf: races, posities, characters en punten, "
        "als Excel, CSV en een importbestand voor de website, om zelf te controleren.",
    ),
    "intro_live": (
        "During a live night use Tournament Live instead; this window is for nights without it.",
        "Gebruik tijdens een live avond Tournament Live; dit venster is voor avonden zonder.",
    ),
    "step_recordings": ("1  Recordings", "1  Opnames"),
    "recordings_hint": (
        "Add video files, or a folder: one folder holds one tournament's recordings.",
        "Voeg videobestanden toe, of een map: één map bevat de opnames van één toernooi.",
    ),
    "col_name": ("Name", "Naam"),
    "col_kind": ("Type", "Soort"),
    "col_location": ("Location", "Locatie"),
    "kind_video": ("Video", "Video"),
    "kind_folder": ("Folder", "Map"),
    "kind_folder_count": ("Folder, {count} videos", "Map, {count} video's"),
    "add_videos": ("Add videos...", "Video's toevoegen..."),
    "add_folder": ("Add folder...", "Map toevoegen..."),
    "remove": ("Remove", "Verwijderen"),
    "clear": ("Clear", "Leegmaken"),
    "step_session": ("2  Session", "2  Sessie"),
    "session_id": ("Session id", "Sessie-id"),
    "session_hint": (
        "Stored with every race so the website can tell imports apart.",
        "Wordt bij elke race opgeslagen, zodat de website imports uit elkaar houdt.",
    ),
    "results_folder": ("Results folder", "Uitslagenmap"),
    "browse": ("Browse...", "Bladeren..."),
    "step_run": ("3  Run", "3  Starten"),
    "start": ("Start analysis", "Analyse starten"),
    "stop": ("Stop", "Stoppen"),
    "open_results": ("Open results folder", "Uitslagenmap openen"),
    "log": ("Progress", "Voortgang"),
    "status_ready": ("Ready. Add recordings to begin.", "Klaar. Voeg opnames toe om te beginnen."),
    "status_ready_count": ("Ready: {count} item(s) to analyse.", "Klaar: {count} item(s) om te analyseren."),
    "status_staging": ("Preparing recordings {done}/{total} ...", "Opnames klaarzetten {done}/{total} ..."),
    "status_running": ("Analysing ... {elapsed} elapsed", "Bezig met analyseren ... {elapsed} verstreken"),
    "status_done": ("Done in {elapsed}. Check the results before you import them.",
                    "Klaar in {elapsed}. Controleer de uitslagen voordat je ze importeert."),
    "status_failed": ("Stopped with an error (exit code {code}). See the progress log.",
                      "Gestopt met een fout (code {code}). Zie het voortgangslog."),
    "status_stopped": ("Stopped. Partial output stays in the results folder.",
                       "Gestopt. Wat al klaar was blijft in de uitslagenmap."),
    "pick_videos": ("Choose tournament recordings", "Kies toernooiopnames"),
    "pick_folder": ("Choose a folder with one tournament's recordings", "Kies een map met de opnames van één toernooi"),
    "pick_results": ("Choose the results folder", "Kies de uitslagenmap"),
    "video_files": ("Video files", "Videobestanden"),
    "all_files": ("All files", "Alle bestanden"),
    "error_title": ("Cannot start", "Kan niet starten"),
    "err_no_entries": ("Add at least one video or folder first.", "Voeg eerst minstens één video of map toe."),
    "err_not_found": ("Not found: {path}", "Niet gevonden: {path}"),
    "err_unsupported": ("Not a supported video ({suffixes}): {path}", "Geen ondersteunde video ({suffixes}): {path}"),
    "err_empty_folder": ("This folder holds no videos ({suffixes}): {path}",
                         "Deze map bevat geen video's ({suffixes}): {path}"),
    "err_duplicate": ("Two recordings would get the same name {name}. Rename one of them or put them in separate "
                      "folders.", "Twee opnames krijgen dezelfde naam {name}. Geef er één een andere naam of zet ze "
                      "in aparte mappen."),
    "err_session_required": ("Enter a session id.", "Vul een sessie-id in."),
    "err_session_length": ("The session id is longer than {max} characters.",
                           "De sessie-id is langer dan {max} tekens."),
    "err_session_chars": ("The session id contains control characters.", "De sessie-id bevat stuurtekens."),
    "err_results_required": ("Choose a results folder.", "Kies een uitslagenmap."),
    "err_runtime": ("The Tournament Processor is not installed in this Python ({python}). Start the window with "
                    "TournamentAnalysis.cmd from the Tournament Tools package, or install the package.",
                    "De Tournament Processor is niet geïnstalleerd in deze Python ({python}). Start het venster met "
                    "TournamentAnalysis.cmd uit het Tournament Tools-pakket, of installeer het pakket."),
    "err_assets": ("The recognition assets are missing: {name} points to {path}. Extract the complete package "
                   "again.", "De herkenningsbestanden ontbreken: {name} verwijst naar {path}. Pak het volledige "
                   "pakket opnieuw uit."),
    "err_stage": ("Could not prepare {path}: {error}", "Kon {path} niet klaarzetten: {error}"),
    "err_exists_differs": ("{path} already exists with different content. Choose another results folder.",
                           "{path} bestaat al met andere inhoud. Kies een andere uitslagenmap."),
    "log_intro": ("Results are written to <results folder>\\Output_Results: Excel, CSV and "
                  "*_TournamentRaceResultsV1.json for the website.",
                  "De uitslagen komen in <uitslagenmap>\\Output_Results: Excel, CSV en "
                  "*_TournamentRaceResultsV1.json voor de website."),
    "log_assets_default": ("Recognition assets: not configured here; the processor uses its own defaults.",
                           "Herkenningsbestanden: hier niet ingesteld; de processor gebruikt zijn standaard."),
    "log_linked": ("Linked {name}", "Gekoppeld: {name}"),
    "log_copying": ("Copying {name} (different drive; this can take a while) ...",
                    "{name} wordt gekopieerd (andere schijf; dit kan even duren) ..."),
    "log_reused": ("Already prepared: {name}", "Al klaargezet: {name}"),
    "log_command": ("Running: {command}", "Opdracht: {command}"),
    "log_results": ("Results: {path}", "Uitslagen: {path}"),
    "log_stopping": ("Stopping the analysis ...", "De analyse wordt gestopt ..."),
    "confirm_close_title": ("Analysis running", "Analyse loopt"),
    "confirm_close": ("An analysis is still running. Stop it and close the window?",
                      "Er loopt nog een analyse. Stoppen en het venster sluiten?"),
    # Qt window (tournament_processor.qt), the layout of the MK8DX Live Video Processor post-analysis window.
    "fallback_classic": ("{reason}; opening the classic window. Install the Qt window with: pip install PySide6",
                         "{reason}; het klassieke venster wordt geopend. Installeer het Qt-venster met: "
                         "pip install PySide6"),
    "banner_title": ("MK8DX TOURNAMENT ANALYSIS", "MK8DX TOURNAMENT ANALYSIS"),
    "banner_subtitle": ("LAN TOURNAMENT · ANALYSIS AFTERWARDS", "LAN-TOERNOOI · ANALYSE ACHTERAF"),
    "card_choose_recordings": ("Choose recordings", "Opnames kiezen"),
    "card_choose_videos": ("Choose videos", "Video's kiezen"),
    "card_choose_videos_hint": ("Tick the recordings to include in the next run.",
                                "Vink de opnames aan die in de volgende run meedoen."),
    "selected_summary": ("{selected} of {total} selected", "{selected} van {total} gekozen"),
    "all": ("All", "Alles"),
    "none": ("None", "Geen"),
    "card_run": ("Run the analysis", "De analyse starten"),
    "card_run_hint": ("Finds every race in the ticked recordings: positions, characters and points.",
                      "Vindt elke race in de aangevinkte opnames: posities, characters en punten."),
    "start_big": ("▶  START ANALYSIS", "▶  ANALYSE STARTEN"),
    "cancel": ("Cancel", "Annuleren"),
    "card_results": ("Results", "Uitslagen"),
    "card_results_hint": ("Open the exported workbook, the results folder or the extracted frames.",
                          "Open de geëxporteerde werkmap, de uitslagenmap of de opgeslagen frames."),
    "open_excel": ("📊  Open Latest Excel", "📊  Laatste Excel openen"),
    "open_results_folder": ("📁  Open Results Folder", "📁  Uitslagenmap openen"),
    "open_frames": ("🖼  Open Frames", "🖼  Frames openen"),
    "activity_log": ("Activity log", "Activiteitenlog"),
    "log_placeholder": ("Output from the running analysis appears here, in colour.",
                        "De uitvoer van de lopende analyse verschijnt hier, in kleur."),
    "status_on_line": ("On the line — ready", "Aan de start — klaar"),
    "run_label": ("Analysing {count} recording(s)", "{count} opname(s) analyseren"),
    "finished": ("Finished", "Klaar"),
    "cancelled": ("Cancelled", "Geannuleerd"),
    "failed": ("Failed (exit {code})", "Mislukt (code {code})"),
    "badge_finished": ("🏁 Finished", "🏁 Klaar"),
    "badge_failed": ("Failed", "Mislukt"),
    "log_started": ("=== ▶ {label} ===", "=== ▶ {label} ==="),
    "log_completed": ("=== 🏁 Completed successfully ===", "=== 🏁 Geslaagd ==="),
    "log_cancelled": ("=== ■ Cancelled ===", "=== ■ Geannuleerd ==="),
    "log_failed": ("=== ✖ Failed with exit code {code} ===", "=== ✖ Mislukt met code {code} ==="),
    "log_cancelling": ("[GUI] Cancelling… terminating the running process.",
                       "[GUI] Annuleren… het lopende proces wordt beëindigd."),
    "log_process_error": ("[GUI] Process error: {error}", "[GUI] Procesfout: {error}"),
    "nothing_selected_title": ("Nothing selected", "Niets gekozen"),
    "nothing_selected": ("Tick at least one recording to analyse.", "Vink minstens één opname aan."),
    "not_found_title": ("Not found", "Niet gevonden"),
    "results_missing": ("The results folder does not exist yet. Run the analysis first.",
                        "De uitslagenmap bestaat nog niet. Start eerst de analyse."),
    "frames_missing": ("The frames folder does not exist yet. Run the analysis first.",
                       "De framesmap bestaat nog niet. Start eerst de analyse."),
    "no_workbook_title": ("No results", "Geen uitslagen"),
    "no_workbook": ("No workbook yet. Run the analysis first.", "Nog geen werkmap. Start eerst de analyse."),
    "open_error": ("Unable to open {path}:\n{error}", "Kan {path} niet openen:\n{error}"),
    "quit_title": ("Quit", "Afsluiten"),
    "no_display": ("No display is available for the window. Use the command line instead: "
                   "python -m tournament_processor.vision_cli all --help",
                   "Er is geen scherm beschikbaar voor het venster. Gebruik de opdrachtregel: "
                   "python -m tournament_processor.vision_cli all --help"),
}


def _windows_language() -> str:
    try:
        import ctypes

        buffer = ctypes.create_unicode_buffer(85)
        if ctypes.windll.kernel32.GetUserDefaultLocaleName(buffer, len(buffer)):
            return buffer.value
    except (AttributeError, OSError, ImportError):
        pass
    return ""


def detect_language(environ: Mapping[str, str] | None = None) -> str:
    """``en`` or ``nl``: the configured MK8DX_TOURNAMENT_LANGUAGE, else the system language."""
    environ = os.environ if environ is None else environ
    configured = str(environ.get("MK8DX_TOURNAMENT_LANGUAGE", "auto")).strip().lower()
    if configured in {"en", "nl"}:
        return configured
    candidates = [_windows_language()] if sys.platform == "win32" else []
    candidates += [environ.get("LANG", ""), (locale.getlocale()[0] or "")]
    for value in candidates:
        lowered = (value or "").lower()
        if lowered.startswith("nl") or lowered.startswith("dutch"):
            return "nl"
    return "en"


class Texts:
    def __init__(self, language: str) -> None:
        self.language = "nl" if language == "nl" else "en"

    def __call__(self, key: str, **values: object) -> str:
        english, dutch = TEXTS[key]
        return (dutch if self.language == "nl" else english).format(**values)


# --------------------------------------------------------------------------- #
# Planning (no display needed)                                                 #
# --------------------------------------------------------------------------- #


class PlanError(ValueError):
    """A problem the operator can fix; ``key``/``values`` select the message."""

    def __init__(self, key: str, **values: object) -> None:
        super().__init__(key)
        self.key = key
        self.values = values

    def message(self, texts: Texts) -> str:
        return texts(self.key, **self.values)


@dataclass(frozen=True)
class RunPlan:
    """Everything one Start needs: the session folder, what to place in it and the processor command."""

    runtime_root: Path
    session_id: str
    staging: tuple[tuple[Path, Path], ...]
    targets: tuple[str, ...]

    @property
    def output_dir(self) -> Path:
        return self.runtime_root / OUTPUT_FOLDER

    def command(self, python: str | None = None) -> list[str]:
        return [
            python or sys.executable, "-u", "-m", "tournament_processor.vision_cli", "all",
            "--runtime-root", str(self.runtime_root),
            "--session-id", self.session_id,
            "--videos", *self.targets,
        ]


def is_video(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_SUFFIXES


def entry_is_folder(path: Path) -> bool:
    """A listed entry is a folder when it is one on disk; an absent path counts as a video by its suffix."""
    return path.is_dir() or (not path.exists() and not is_video(path))


def folder_videos(folder: Path) -> list[Path]:
    """The recordings directly inside a folder, the way vision_cli reads a folder target."""
    try:
        return sorted(path for path in folder.iterdir() if path.is_file() and is_video(path))
    except OSError:
        return []


def _clean_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", name).strip("-.")


def default_session_id(entries: Sequence[Path], today: _dt.date | None = None) -> str:
    """The first entry's name, plus today's date unless the name already carries one."""
    if not entries:
        return ""
    first = entries[0]
    name = first.name if entry_is_folder(first) else first.stem
    cleaned = _clean_name(name)[:80] or "tournament"
    if _DATE_IN_NAME.search(cleaned):
        return cleaned
    return f"{cleaned}-{(today or _dt.date.today()).isoformat()}"


def default_runtime_root(entries: Sequence[Path]) -> Path | None:
    """``<name>_TournamentSession`` beside the first entry, the same place TournamentProcessor.cmd uses.

    An entry that already sits in a session's Input_Videos keeps that session folder.
    """
    if not entries:
        return None
    first = entries[0]
    for parent in (first, *first.parents):
        if parent.name.lower() == INPUT_FOLDER.lower():
            return parent.parent
    name = first.name if entry_is_folder(first) else first.stem
    return first.parent / f"{name}{SESSION_SUFFIX}"


def validate_session_id(value: str) -> str:
    """The id to publish, or PlanError. The canonical result allows 1 to 128 characters."""
    session_id = (value or "").strip()
    if not session_id:
        raise PlanError("err_session_required")
    if len(session_id) > SESSION_ID_MAX_LENGTH:
        raise PlanError("err_session_length", max=SESSION_ID_MAX_LENGTH)
    if _CONTROL.search(session_id):
        raise PlanError("err_session_chars")
    return session_id


def _inside(path: Path, root: Path) -> Path | None:
    try:
        return path.resolve().relative_to(root.resolve())
    except (ValueError, OSError):
        return None


def build_plan(entries: Sequence[Path], session_id: str, runtime_root: Path | str | None) -> RunPlan:
    """Turn the window's state into a RunPlan, or raise PlanError naming what to fix.

    vision_cli finds recordings under ``<runtime root>/Input_Videos``. A video from elsewhere is linked (or,
    across drives, copied) there under its own name; a folder's videos go to ``Input_Videos/<folder name>/``
    so that each tournament keeps its own sub-folder and race identity. Recordings already inside the session's
    Input_Videos are used where they are.
    """
    session = validate_session_id(session_id)
    if not entries:
        raise PlanError("err_no_entries")
    if runtime_root is None or not str(runtime_root).strip():
        raise PlanError("err_results_required")
    root = Path(runtime_root)
    input_root = root / INPUT_FOLDER
    suffixes = " ".join(VIDEO_SUFFIXES)
    staging: list[tuple[Path, Path]] = []
    targets: list[str] = []
    destinations: dict[str, Path] = {}

    def claim(relative: str, source: Path) -> None:
        key = relative.lower()
        if key in destinations and destinations[key].resolve() != source.resolve():
            raise PlanError("err_duplicate", name=relative)
        destinations[key] = source

    for entry in entries:
        entry = Path(entry)
        if not entry.exists():
            raise PlanError("err_not_found", path=entry)
        inside = _inside(entry, input_root)
        if entry.is_dir():
            videos = folder_videos(entry)
            if not videos:
                raise PlanError("err_empty_folder", suffixes=suffixes, path=entry)
            if inside is not None:
                prefix = inside.as_posix().strip(".")
                for video in videos:
                    claim(f"{prefix}/{video.name}" if prefix else video.name, video)
                # The Input_Videos folder itself is listed per recording; a sub-folder is one target.
                targets.extend([video.name for video in videos] if not prefix else [prefix])
                continue
            for video in videos:
                relative = f"{entry.name}/{video.name}"
                claim(relative, video)
                staging.append((video, input_root / entry.name / video.name))
            targets.append(entry.name)
        else:
            if not is_video(entry):
                raise PlanError("err_unsupported", suffixes=suffixes, path=entry)
            if inside is not None:
                claim(inside.as_posix(), entry)
                targets.append(inside.as_posix())
                continue
            claim(entry.name, entry)
            staging.append((entry, input_root / entry.name))
            targets.append(entry.name)
    unique_targets = tuple(dict.fromkeys(targets))
    return RunPlan(runtime_root=root, session_id=session, staging=tuple(staging), targets=unique_targets)


def stage_recordings(plan: RunPlan, report: Callable[[str, dict], None] = lambda key, values: None,
                     should_stop: Callable[[], bool] = lambda: False) -> None:
    """Place the plan's recordings in Input_Videos: a hard link when possible, otherwise a copy."""
    total = len(plan.staging)
    for index, (source, destination) in enumerate(plan.staging, start=1):
        if should_stop():
            return
        report("status_staging", {"done": index, "total": total})
        name = destination.relative_to(plan.runtime_root / INPUT_FOLDER).as_posix()
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                if destination.stat().st_size != source.stat().st_size:
                    raise PlanError("err_exists_differs", path=destination)
                report("log_reused", {"name": name})
                continue
            try:
                os.link(source, destination)
                report("log_linked", {"name": name})
            except OSError:
                report("log_copying", {"name": name})
                shutil.copy2(source, destination)
        except PlanError:
            raise
        except OSError as error:
            raise PlanError("err_stage", path=source, error=error) from error


def check_environment(environ: Mapping[str, str] | None = None) -> list[str]:
    """Raise PlanError when the processor or its configured assets are missing; return the configured names."""
    import importlib.util

    environ = os.environ if environ is None else environ
    if importlib.util.find_spec("mk8dx_tournament_extraction") is None:
        raise PlanError("err_runtime", python=sys.executable)
    configured = []
    for name in ("MK8DX_TOURNAMENT_ASSETS_ROOT", "MK8DX_TOURNAMENT_REFERENCE_ROOT"):
        value = environ.get(name)
        if value:
            configured.append(name)
            if not Path(value).is_dir():
                raise PlanError("err_assets", name=name, path=value)
    return configured


def child_environment(environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """The processor's environment: this one, unbuffered UTF-8 output, and this source tree importable."""
    env = dict(os.environ if environ is None else environ)
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    source_root = str(Path(__file__).resolve().parents[1])
    existing = env.get("PYTHONPATH", "")
    if source_root not in existing.split(os.pathsep):
        env["PYTHONPATH"] = source_root + (os.pathsep + existing if existing else "")
    return env


def format_elapsed(seconds: float) -> str:
    seconds = int(max(0, seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def open_folder(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


# --------------------------------------------------------------------------- #
# Background run                                                               #
# --------------------------------------------------------------------------- #


class AnalysisRun:
    """Stages the recordings and runs vision_cli in a child process; messages go to ``events``."""

    def __init__(self, plan: RunPlan, events: "queue.Queue[tuple[str, object]]") -> None:
        self.plan = plan
        self.events = events
        self.process: subprocess.Popen[str] | None = None
        self._stop = threading.Event()
        self.thread = threading.Thread(target=self._work, name="tournament-analysis", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self._stop.set()
        process = self.process
        if process is None or process.poll() is not None:
            return
        if sys.platform == "win32":
            # The pipeline may start helper processes; end the whole tree.
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        else:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()

    def _emit(self, kind: str, payload: object) -> None:
        self.events.put((kind, payload))

    def _work(self) -> None:
        try:
            stage_recordings(self.plan, lambda key, values: self._emit("text", (key, values)), self._stop.is_set)
            if self._stop.is_set():
                self._emit("finished", None)
                return
            command = self.plan.command()
            self._emit("text", ("log_command", {"command": subprocess.list2cmdline(command)}))
            self._emit("running", time.monotonic())
            flags = 0
            if sys.platform == "win32":
                flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            self.process = subprocess.Popen(
                command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                text=True, encoding="utf-8", errors="replace", env=child_environment(),
                cwd=str(self.plan.runtime_root), creationflags=flags,
            )
            assert self.process.stdout is not None
            for line in self.process.stdout:
                self._emit("line", line.rstrip("\r\n"))
            code = self.process.wait()
            self._emit("finished", None if self._stop.is_set() else code)
        except PlanError as error:
            self._emit("error", error)
        except OSError as error:
            self._emit("error", PlanError("err_stage", path=self.plan.runtime_root, error=error))


def _arguments(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="mk8dx-tournament-analysis",
        description="Window for analysing recorded MK8DX tournament videos afterwards (runs vision_cli all).",
    )
    parser.add_argument("paths", nargs="*", type=Path, help="Videos or folders to list at the start")
    parser.add_argument("--results-folder", type=Path, help="Session folder; default <first name>_TournamentSession")
    parser.add_argument("--session-id", help="Session id; default from the first name and today's date")
    parser.add_argument("--language", choices=("en", "nl"), help="Override MK8DX_TOURNAMENT_LANGUAGE")
    parser.add_argument("--classic-gui", action="store_true",
                        help="Use the classic Tkinter window instead of the Qt (PySide6) window")
    return parser.parse_args(argv)


PACKAGED_BACKGROUND = Path(__file__).resolve().parent / "qt" / "assets" / "bg.jpg"


def analysis_background(environ: Mapping[str, str] | None = None,
                        packaged: Path | None = PACKAGED_BACKGROUND) -> Path | None:
    """The banner image: MK8DX_ANALYSIS_BACKGROUND when it names an existing file, else the packaged artwork.

    None (the banner is then drawn in code) when neither exists.
    """
    environ = os.environ if environ is None else environ
    value = str(environ.get("MK8DX_ANALYSIS_BACKGROUND", "") or "").strip().strip('"')
    if value:
        path = Path(value).expanduser()
        if path.is_file():
            return path
    return packaged if packaged is not None and packaged.is_file() else None


def choose_frontend(classic_requested: bool, qt_loader: Callable[[], object]) -> tuple[str, object | None, str]:
    """``("qt", module, "")`` when the Qt window can load; otherwise ``("classic", None, reason)``.

    Mirrors Tournament Live's run_gui: Qt first, Tkinter when asked for or when PySide6 is missing.
    """
    if classic_requested:
        return "classic", None, "requested"
    try:
        return "qt", qt_loader(), ""
    except ImportError as error:
        return "classic", None, f"PySide6 not available ({error})"


def _load_qt():
    from .qt import app

    return app


def main(argv: Sequence[str] | None = None) -> int:
    args = _arguments(argv)
    texts = Texts(args.language or detect_language())
    frontend, qt_app, reason = choose_frontend(args.classic_gui, _load_qt)
    if frontend == "qt":
        return qt_app.run(texts, args.paths, args.results_folder, args.session_id)
    if reason != "requested":
        print(texts("fallback_classic", reason=reason), file=sys.stderr, flush=True)
    from .gui_classic import run as classic_run

    return classic_run(texts, args.paths, args.results_folder, args.session_id)


if __name__ == "__main__":
    raise SystemExit(main())
