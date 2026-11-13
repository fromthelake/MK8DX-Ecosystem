"""MK8DX Tournament Analysis: a small window around the recorded-video processor.

For a tournament night that ran without Tournament Live: choose the recordings afterwards (video files, or a
folder per tournament), give the session an id and start. The window runs the existing
``python -m tournament_processor.vision_cli all`` in a child process and shows its output; it does not
recognise anything itself, so its results are exactly those of the command line and of
``TournamentProcessor.cmd``.

The planning part (which files go where, which command runs) is plain Python and needs no display, so it is
tested without opening a window. Tkinter is imported only when the window opens.

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


# --------------------------------------------------------------------------- #
# Window                                                                       #
# --------------------------------------------------------------------------- #

# packages/design-tokens/tokens.json, dark theme.
COLORS = {
    "app": "#080C1C",       # navy.975 surface.app
    "raised": "#0E152B",    # navy.950 surface.raised
    "field": "#131B35",     # navy.925
    "line": "#34406A",      # navy.800
    "text": "#EEF1FA",      # slate.50
    "muted": "#A1AAC7",     # slate.200
    "accent": "#FF5A36",    # flare.400
    "accent_ink": "#1C0700",
    "accent_down": "#C8391A",
    "volt": "#C6F432",
    "volt_ink": "#141A00",
    "danger": "#FF7465",    # coral.dark
    "focus": "#8FB4FF",
}
LOG_LINE_LIMIT = 5000


class AnalysisWindow:
    def __init__(self, root, texts: Texts, entries: Sequence[Path] = (), runtime_root: Path | None = None,
                 session_id: str | None = None) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.ttk = ttk
        self.root = root
        self.t = texts
        try:
            self.scale = max(1.0, float(root.winfo_fpixels("1i")) / 96.0)
        except Exception:  # noqa: BLE001 - a missing DPI reading keeps 1:1 pixels
            self.scale = 1.0
        self.entries: list[Path] = []
        self.run: AnalysisRun | None = None
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.started_at: float | None = None
        self.last_output: Path | None = None
        self.session_var = tk.StringVar(value=session_id or "")
        self.root_var = tk.StringVar(value=str(runtime_root) if runtime_root else "")
        self.status_var = tk.StringVar()
        self.session_edited = session_id is not None
        self.root_edited = runtime_root is not None
        self._build()
        self.add_entries(entries)
        self._log(self.t("log_intro"))
        if not os.environ.get("MK8DX_TOURNAMENT_ASSETS_ROOT"):
            self._log(self.t("log_assets_default"))
        self._refresh()
        self.root.after(100, self._poll)
        self.root.protocol("WM_DELETE_WINDOW", self._close)

    # -- layout ------------------------------------------------------------ #

    def px(self, value: int) -> int:
        """Pixels at this display's scale (the window is DPI aware on Windows)."""
        return int(round(value * self.scale))

    def _style(self) -> None:
        ttk = self.ttk
        style = ttk.Style(self.root)
        style.theme_use("clam")
        base = ("Segoe UI", 10) if sys.platform == "win32" else ("TkDefaultFont", 10)
        self.fonts = {
            "base": base, "small": (base[0], 9), "title": (base[0], 18, "bold"),
            "section": (base[0], 11, "bold"), "button": (base[0], 10, "bold"),
            "mono": ("Consolas", 9) if sys.platform == "win32" else ("TkFixedFont", 9),
        }
        c = COLORS
        style.configure(".", background=c["raised"], foreground=c["text"], fieldbackground=c["field"],
                        bordercolor=c["line"], lightcolor=c["raised"], darkcolor=c["raised"], font=base,
                        focuscolor=c["focus"], troughcolor=c["field"], selectbackground=c["line"],
                        selectforeground=c["text"], insertcolor=c["text"])
        style.configure("App.TFrame", background=c["app"])
        style.configure("Raised.TFrame", background=c["raised"])
        style.configure("TLabel", background=c["raised"], foreground=c["text"])
        style.configure("Muted.TLabel", background=c["raised"], foreground=c["muted"], font=self.fonts["small"])
        style.configure("Section.TLabel", background=c["raised"], foreground=c["text"], font=self.fonts["section"])
        style.configure("Status.TLabel", background=c["app"], foreground=c["muted"])
        style.configure("TEntry", fieldbackground=c["field"], foreground=c["text"], bordercolor=c["line"],
                        lightcolor=c["line"], darkcolor=c["line"], padding=5)
        style.map("TEntry", bordercolor=[("focus", c["focus"])], lightcolor=[("focus", c["focus"])])
        style.configure("TButton", background=c["field"], foreground=c["text"], bordercolor=c["line"],
                        lightcolor=c["field"], darkcolor=c["field"], padding=(12, 6), font=self.fonts["button"])
        style.map("TButton", background=[("disabled", c["raised"]), ("pressed", c["line"]), ("active", c["line"])],
                  foreground=[("disabled", c["line"])])
        style.configure("Accent.TButton", background=c["accent"], foreground=c["accent_ink"],
                        lightcolor=c["accent"], darkcolor=c["accent"], bordercolor=c["accent"], padding=(16, 7))
        style.map("Accent.TButton",
                  background=[("disabled", c["field"]), ("pressed", c["accent_down"]), ("active", "#FF7352")],
                  foreground=[("disabled", c["line"])])
        style.configure("Volt.TButton", background=c["volt"], foreground=c["volt_ink"], lightcolor=c["volt"],
                        darkcolor=c["volt"], bordercolor=c["volt"])
        style.map("Volt.TButton", background=[("disabled", c["field"]), ("active", "#D8FF4A")],
                  foreground=[("disabled", c["line"])], bordercolor=[("disabled", c["line"])],
                  lightcolor=[("disabled", c["field"])], darkcolor=[("disabled", c["field"])])
        style.map("Accent.TButton", bordercolor=[("disabled", c["line"])], lightcolor=[("disabled", c["field"])],
                  darkcolor=[("disabled", c["field"])])
        style.configure("Treeview", background=c["field"], fieldbackground=c["field"], foreground=c["text"],
                        bordercolor=c["line"], rowheight=self.px(26))
        style.map("Treeview", background=[("selected", c["line"])])
        style.configure("Treeview.Heading", background=c["raised"], foreground=c["muted"], bordercolor=c["line"],
                        lightcolor=c["raised"], darkcolor=c["raised"], font=self.fonts["small"], padding=(6, 4))
        style.configure("Horizontal.TProgressbar", background=c["accent"], troughcolor=c["field"],
                        bordercolor=c["line"], lightcolor=c["accent"], darkcolor=c["accent"])
        style.configure("Vertical.TScrollbar", background=c["line"], troughcolor=c["field"],
                        bordercolor=c["field"], lightcolor=c["line"], darkcolor=c["line"], arrowcolor=c["muted"])
        style.map("Vertical.TScrollbar", background=[("active", c["muted"])])

    def _card(self, parent, row: int, title: str):
        ttk = self.ttk
        card = ttk.Frame(parent, style="Raised.TFrame", padding=(16, 12))
        card.grid(row=row, column=0, sticky="nsew", pady=(0, 10))
        card.columnconfigure(0, weight=1)
        ttk.Label(card, text=title, style="Section.TLabel").grid(row=0, column=0, sticky="w")
        return card

    def _build(self) -> None:
        tk, ttk = self.tk, self.ttk
        self._style()
        c = COLORS
        self.root.title(self.t("title"))
        self.root.geometry(f"{self.px(1000)}x{self.px(860)}")
        self.root.configure(background=c["app"])
        self.root.minsize(self.px(860), self.px(700))
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        header = tk.Frame(self.root, background=c["app"], padx=20, pady=14)
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        tk.Label(header, text=self.t("title"), background=c["app"], foreground=c["text"],
                 font=self.fonts["title"], anchor="w").grid(row=0, column=0, sticky="w")
        tk.Label(header, text=self.t("intro"), background=c["app"], foreground=c["muted"], anchor="w",
                 justify="left", wraplength=self.px(900), font=self.fonts["base"]).grid(row=1, column=0, sticky="w",
                                                                                 pady=(4, 0))
        tk.Label(header, text=self.t("intro_live"), background=c["app"], foreground=c["volt"], anchor="w",
                 justify="left", wraplength=self.px(900), font=self.fonts["base"]).grid(row=2, column=0, sticky="w")
        tk.Frame(header, background=c["accent"], height=3).grid(row=3, column=0, sticky="ew", pady=(10, 0))

        body = ttk.Frame(self.root, style="App.TFrame", padding=(20, 0, 20, 8))
        body.grid(row=1, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(0, weight=1)
        body.rowconfigure(3, weight=2)

        # 1 Recordings
        card = self._card(body, 0, self.t("step_recordings"))
        card.rowconfigure(2, weight=1)
        ttk.Label(card, text=self.t("recordings_hint"), style="Muted.TLabel").grid(row=1, column=0, sticky="w",
                                                                                   pady=(2, 6))
        table = ttk.Frame(card, style="Raised.TFrame")
        table.grid(row=2, column=0, sticky="nsew")
        table.columnconfigure(0, weight=1)
        table.rowconfigure(0, weight=1)
        self.tree = ttk.Treeview(table, columns=("kind", "location"), height=5, selectmode="extended")
        self.tree.heading("#0", text=self.t("col_name"), anchor="w")
        self.tree.heading("kind", text=self.t("col_kind"), anchor="w")
        self.tree.heading("location", text=self.t("col_location"), anchor="w")
        self.tree.column("#0", width=self.px(280), minwidth=self.px(160))
        self.tree.column("kind", width=self.px(150), minwidth=self.px(100), stretch=False)
        self.tree.column("location", width=self.px(320), minwidth=self.px(160))
        self.tree.grid(row=0, column=0, sticky="nsew")
        tree_scroll = ttk.Scrollbar(table, orient="vertical", command=self.tree.yview)
        tree_scroll.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=tree_scroll.set)
        self.tree.bind("<Delete>", lambda _event: self._remove())
        self.tree.bind("<<TreeviewSelect>>", lambda _event: self._refresh())
        buttons = ttk.Frame(card, style="Raised.TFrame")
        buttons.grid(row=3, column=0, sticky="w", pady=(8, 0))
        self.add_videos_button = ttk.Button(buttons, text=self.t("add_videos"), command=self._pick_videos)
        self.add_folder_button = ttk.Button(buttons, text=self.t("add_folder"), command=self._pick_folder)
        self.remove_button = ttk.Button(buttons, text=self.t("remove"), command=self._remove)
        self.clear_button = ttk.Button(buttons, text=self.t("clear"), command=self._clear)
        for column, button in enumerate((self.add_videos_button, self.add_folder_button, self.remove_button,
                                         self.clear_button)):
            button.grid(row=0, column=column, padx=(0, 8))

        # 2 Session
        card = self._card(body, 1, self.t("step_session"))
        form = ttk.Frame(card, style="Raised.TFrame")
        form.grid(row=1, column=0, sticky="ew", pady=(6, 0))
        form.columnconfigure(1, weight=1)
        ttk.Label(form, text=self.t("session_id")).grid(row=0, column=0, sticky="w", padx=(0, 12))
        self.session_entry = ttk.Entry(form, textvariable=self.session_var)
        self.session_entry.grid(row=0, column=1, sticky="ew")
        self.session_entry.bind("<Key>", lambda _event: setattr(self, "session_edited", True))
        ttk.Label(form, text=self.t("session_hint"), style="Muted.TLabel").grid(row=1, column=1, sticky="w",
                                                                                pady=(2, 6))
        ttk.Label(form, text=self.t("results_folder")).grid(row=2, column=0, sticky="w", padx=(0, 12))
        self.root_entry = ttk.Entry(form, textvariable=self.root_var)
        self.root_entry.grid(row=2, column=1, sticky="ew")
        self.root_entry.bind("<Key>", lambda _event: setattr(self, "root_edited", True))
        self.browse_button = ttk.Button(form, text=self.t("browse"), command=self._pick_results)
        self.browse_button.grid(row=2, column=2, padx=(8, 0))

        # 3 Run
        card = self._card(body, 2, self.t("step_run"))
        actions = ttk.Frame(card, style="Raised.TFrame")
        actions.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        actions.columnconfigure(3, weight=1)
        self.start_button = ttk.Button(actions, text=self.t("start"), style="Accent.TButton", command=self._start)
        self.stop_button = ttk.Button(actions, text=self.t("stop"), command=self._stop)
        self.open_button = ttk.Button(actions, text=self.t("open_results"), style="Volt.TButton",
                                      command=self._open_results)
        self.start_button.grid(row=0, column=0, padx=(0, 8))
        self.stop_button.grid(row=0, column=1, padx=(0, 8))
        self.open_button.grid(row=0, column=2, padx=(0, 16))
        self.progress = ttk.Progressbar(actions, mode="determinate", length=self.px(200))
        self.progress.grid(row=0, column=3, sticky="ew")

        # Log
        log_card = self._card(body, 3, self.t("log"))
        log_card.rowconfigure(1, weight=1)
        log_frame = ttk.Frame(log_card, style="Raised.TFrame")
        log_frame.grid(row=1, column=0, sticky="nsew", pady=(6, 0))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log = tk.Text(log_frame, height=9, wrap="word", background=c["app"], foreground=c["text"],
                           insertbackground=c["text"], relief="flat", borderwidth=0, highlightthickness=1,
                           highlightbackground=c["line"], highlightcolor=c["focus"], font=self.fonts["mono"],
                           padx=8, pady=6, state="disabled")
        self.log.grid(row=0, column=0, sticky="nsew")
        self.log.tag_configure("error", foreground=c["danger"])
        self.log.tag_configure("note", foreground=c["muted"])
        log_scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        log_scroll.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=log_scroll.set)

        status = tk.Frame(self.root, background=c["app"], padx=20)
        status.grid(row=2, column=0, sticky="ew", pady=(0, 12))
        ttk.Label(status, textvariable=self.status_var, style="Status.TLabel").grid(row=0, column=0, sticky="w")

    # -- state ------------------------------------------------------------- #

    @property
    def running(self) -> bool:
        return self.run is not None

    def add_entries(self, paths: Sequence[Path | str]) -> None:
        known = {str(path).lower() for path in self.entries}
        for raw in paths:
            path = Path(raw)
            if str(path).lower() in known:
                continue
            known.add(str(path).lower())
            self.entries.append(path)
            if entry_is_folder(path):
                count = len(folder_videos(path)) if path.is_dir() else 0
                kind = self.t("kind_folder_count", count=count) if count else self.t("kind_folder")
            else:
                kind = self.t("kind_video")
            self.tree.insert("", "end", iid=str(len(self.entries) - 1) + ":" + str(path), text=path.name,
                             values=(kind, str(path.parent)))
        self._defaults()
        self._ready_status()
        self._refresh()

    def _defaults(self) -> None:
        if not self.session_edited:
            self.session_var.set(default_session_id(self.entries))
        if not self.root_edited:
            default = default_runtime_root(self.entries)
            self.root_var.set(str(default) if default else "")

    def _refresh(self) -> None:
        running = self.running
        idle = "disabled" if running else "normal"
        for widget in (self.add_videos_button, self.add_folder_button, self.clear_button, self.browse_button,
                       self.session_entry, self.root_entry):
            widget.configure(state=idle)
        self.remove_button.configure(state="normal" if not running and self.tree.selection() else idle)
        self.start_button.configure(state="disabled" if running or not self.entries else "normal")
        self.stop_button.configure(state="normal" if running else "disabled")
        self.open_button.configure(state="normal" if self.last_output else "disabled")

    def _ready_status(self) -> None:
        if self.entries:
            self.status_var.set(self.t("status_ready_count", count=len(self.entries)))
        else:
            self.status_var.set(self.t("status_ready"))

    def _log(self, text: str, tag: str | None = None) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n", (tag,) if tag else ())
        lines = int(self.log.index("end-1c").split(".")[0])
        if lines > LOG_LINE_LIMIT:
            self.log.delete("1.0", f"{lines - LOG_LINE_LIMIT}.0")
        self.log.see("end")
        self.log.configure(state="disabled")

    # -- actions ----------------------------------------------------------- #

    def _pick_videos(self) -> None:
        from tkinter import filedialog

        patterns = " ".join(f"*{suffix}" for suffix in VIDEO_SUFFIXES)
        chosen = filedialog.askopenfilenames(parent=self.root, title=self.t("pick_videos"),
                                             filetypes=[(self.t("video_files"), patterns),
                                                        (self.t("all_files"), "*.*")])
        self.add_entries([Path(item) for item in chosen])

    def _pick_folder(self) -> None:
        from tkinter import filedialog

        chosen = filedialog.askdirectory(parent=self.root, title=self.t("pick_folder"), mustexist=True)
        if chosen:
            self.add_entries([Path(chosen)])

    def _pick_results(self) -> None:
        from tkinter import filedialog

        chosen = filedialog.askdirectory(parent=self.root, title=self.t("pick_results"))
        if chosen:
            self.root_var.set(str(Path(chosen)))
            self.root_edited = True

    def _remove(self) -> None:
        if self.running:
            return
        selected = set(self.tree.selection())
        keep = [path for index, path in enumerate(self.entries) if f"{index}:{path}" not in selected]
        self._reset_entries(keep)

    def _clear(self) -> None:
        if not self.running:
            self._reset_entries([])

    def _reset_entries(self, paths: list[Path]) -> None:
        self.entries = []
        self.tree.delete(*self.tree.get_children())
        self.add_entries(paths)

    def _error(self, message: str) -> None:
        from tkinter import messagebox

        self._log(message, "error")
        messagebox.showerror(self.t("error_title"), message, parent=self.root)

    def _start(self) -> None:
        if self.running:
            return
        try:
            check_environment()
            plan = build_plan(self.entries, self.session_var.get(), self.root_var.get())
        except PlanError as error:
            self._error(error.message(self.t))
            return
        self.session_var.set(plan.session_id)
        self.last_output = None
        self.started_at = None
        self.run = AnalysisRun(plan, self.events)
        self.progress.configure(mode="indeterminate")
        self.progress.start(12)
        self.run.start()
        self._refresh()

    def _stop(self) -> None:
        if self.run is not None:
            self._log(self.t("log_stopping"), "note")
            self.run.stop()

    def _open_results(self) -> None:
        if self.last_output:
            open_folder(self.last_output)

    def _close(self) -> None:
        if self.running:
            from tkinter import messagebox

            if not messagebox.askyesno(self.t("confirm_close_title"), self.t("confirm_close"), parent=self.root):
                return
            self.run.stop()
        self.root.destroy()

    def _poll(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()
                self._handle(kind, payload)
        except queue.Empty:
            pass
        if self.running and self.started_at is not None:
            self.status_var.set(self.t("status_running", elapsed=format_elapsed(time.monotonic() - self.started_at)))
        self.root.after(250, self._poll)

    def _handle(self, kind: str, payload) -> None:
        if kind == "text":
            key, values = payload
            if key == "status_staging":
                self.status_var.set(self.t(key, **values))
            else:
                self._log(self.t(key, **values), "note")
        elif kind == "running":
            self.started_at = payload
        elif kind == "line":
            self._log(payload, "error" if payload.startswith(("Traceback", "Error", "--session-id")) else None)
        elif kind == "error":
            self._finish()
            self._error(payload.message(self.t))
            self.status_var.set(payload.message(self.t))
        elif kind == "finished":
            elapsed = format_elapsed(time.monotonic() - self.started_at) if self.started_at else "0:00"
            plan = self.run.plan if self.run else None
            self._finish()
            if payload is None:
                self.status_var.set(self.t("status_stopped"))
                self.last_output = plan.output_dir if plan and plan.output_dir.is_dir() else None
            elif payload == 0 and plan is not None:
                self.last_output = plan.output_dir
                self._log(self.t("log_results", path=plan.output_dir))
                self.status_var.set(self.t("status_done", elapsed=elapsed))
            else:
                self.status_var.set(self.t("status_failed", code=payload))
                self._log(self.t("status_failed", code=payload), "error")
            self._refresh()

    def _finish(self) -> None:
        self.progress.stop()
        self.progress.configure(mode="determinate", value=0)
        self.run = None
        self._refresh()


def _dpi_aware() -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass


def _arguments(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="mk8dx-tournament-analysis",
        description="Window for analysing recorded MK8DX tournament videos afterwards (runs vision_cli all).",
    )
    parser.add_argument("paths", nargs="*", type=Path, help="Videos or folders to list at the start")
    parser.add_argument("--results-folder", type=Path, help="Session folder; default <first name>_TournamentSession")
    parser.add_argument("--session-id", help="Session id; default from the first name and today's date")
    parser.add_argument("--language", choices=("en", "nl"), help="Override MK8DX_TOURNAMENT_LANGUAGE")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _arguments(argv)
    texts = Texts(args.language or detect_language())
    try:
        import tkinter as tk
    except ImportError:
        print(texts("no_display"), file=sys.stderr)
        return 1
    _dpi_aware()
    try:
        root = tk.Tk()
    except tk.TclError:
        print(texts("no_display"), file=sys.stderr)
        return 1
    AnalysisWindow(root, texts, args.paths, args.results_folder, args.session_id)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
