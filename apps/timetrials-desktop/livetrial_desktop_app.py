"""LiveTrial as one visual app (ADR-0208 steps 2-4).

Double-clicking LiveTrial starts this module instead of the numbered console:
it starts the local dashboard and the engine's run history, opens the dashboard
as its own window, and does everything the console did through buttons:
capture from the capture card, analyse a video, send, settings, correcting a
recognized result, accounts. The console menu stays available for
troubleshooting as ``LiveTrialCli menu``.

The composition deliberately reuses ``LiveTrialConsole``'s product functions
(progress, accounts, reference file, run-history server), so the two surfaces
can never drift apart in what they do; only the way a person asks differs.

Captures and analyses run as a child process of the flag-driven CLI, exactly
the command the console ran. Only one job runs at a time. While a capture runs
the engine serves the live picture and the run history on port 8777 itself,
so the standalone run-history server is stopped for that time and started
again afterwards.
"""

from __future__ import annotations

import functools
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from typing import Callable, Mapping

import livetrial_app as console_module
from livetrial_capture_devices import (
    SNAPSHOT_FILE_NAME,
    engine_device_argument,
    list_video_devices,
    take_snapshot,
)
from livetrial_capture_requirements import capture_requirements, find_ffmpeg, missing_ffmpeg_lines
from livetrial_corrections import create_corrected_revision, format_time, latest_records, parse_time
import livetrial_dashboard as dashboard
import livetrial_ecosystem as ecosystem
import livetrial_product_cli as cli
from livetrial_asset_catalog import Schema9LiveTrialAssetCatalog
import livetrial_ghosts as ghosts
from livetrial_product import CATALOG_SOURCE_SHA256, race_fingerprint
from livetrial_runtime_root import asset_catalog_path
from livetrial_settings import (CONSOLE_LANGUAGE_AUTO, CONSOLE_LANGUAGES, read_server_origin, read_settings,
                                write_auto_sync, write_capture_device, write_console_language, write_language)
from livetrial_updates import CURRENT_WINDOWS_VERSION
from livetrial_clips import endscreen_path, mk8dx_video_metadata
from livetrial_youtube_publisher import LiveTrialYouTubePublisher

VIDEO_SUFFIXES = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".ts"}
IDLE_QUIT_SECONDS = 15 * 60
# Closes a run recorded without an account once it was given to one (send_as).
MOVED_TO_ACCOUNT = "local.moved-to-account"
STOP_WAIT_SECONDS = 45
REUSE_WINDOW_ENV = "MK8DX_LIVETRIAL_REUSE_WINDOW"


class LiveTrialDesktopError(RuntimeError):
    """A plain-language refusal shown in the dashboard."""


def _fail(message: str) -> None:
    raise LiveTrialDesktopError(message) from None


def _app_window_browser(environment: Mapping[str, str]) -> str | None:
    """A Chromium-family browser that can open the dashboard as its own window."""
    candidates: list[str] = []
    if os.name == "nt":
        for root in (environment.get("ProgramFiles(x86)"), environment.get("ProgramFiles"), environment.get("LOCALAPPDATA")):
            if not root:
                continue
            candidates += [
                str(Path(root) / "Microsoft" / "Edge" / "Application" / "msedge.exe"),
                str(Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe"),
            ]
    else:
        for name in ("microsoft-edge", "google-chrome", "chromium", "chromium-browser"):
            found = shutil.which(name)
            if found:
                candidates.append(found)
    return next((path for path in candidates if Path(path).is_file()), None)


def open_app_window(url: str, environment: Mapping[str, str] = os.environ) -> bool:
    """Open ``url`` as an app window when a suitable browser exists, else in the default browser."""
    if environment.get("MK8DX_LIVETRIAL_NO_WINDOW") == "1":
        # Automated checks and headless runs: serve the dashboard, open nothing.
        return False
    browser = _app_window_browser(environment)
    if browser is not None:
        try:
            subprocess.Popen([browser, f"--app={url}"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except OSError:
            pass
    try:
        return bool(webbrowser.open(url))
    except Exception:
        return False


def running_instance(port: int = dashboard.DEFAULT_PORT) -> bool:
    """True when a LiveTrial dashboard already answers on this PC."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/config", timeout=1.5) as response:
            return json.loads(response.read(4096)).get("product") == "livetrial"
    except Exception:
        return False


def _version(value: object) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in str(value).split("."))
    except ValueError:
        return ()


def hand_over(port: int = dashboard.DEFAULT_PORT, own_version: str = CURRENT_WINDOWS_VERSION,
              wait_seconds: float = 20.0) -> bool:
    """Ask an older, idle LiveTrial on this PC to quit so this version can start.

    Owner 2026-09-27: starting a new version only reopened the old one's window.
    The request goes through the running app's own page (its per-launch secret,
    same-origin headers), exactly as its Quit button would; a capture or analysis
    in progress, or a version as new as this one, is never interrupted.
    """
    origin = f"http://127.0.0.1:{port}"
    try:
        with urllib.request.urlopen(origin + "/", timeout=2) as response:
            page = response.read(512 * 1024).decode("utf-8", "replace")
        found = re.search(r'<meta name="livetrial-action" content="([^"]+)">', page)
        if found is None:
            return False

        def act(name: str) -> dict:
            request = urllib.request.Request(
                f"{origin}/api/action/{name}", data=b"{}", method="POST",
                headers={"Content-Type": "application/json", "Origin": origin,
                         "Sec-Fetch-Site": "same-origin", dashboard.ACTION_HEADER: found.group(1)})
            with urllib.request.urlopen(request, timeout=5) as answer:
                return json.loads(answer.read(64 * 1024))["result"]

        status = act("app.status")
        if status.get("busy") or not _version(status.get("version")) < _version(own_version):
            return False
        act("app.quit")
    except Exception:
        return False
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        if not running_instance(port):
            return True
        time.sleep(0.25)
    return False


class _Job:
    def __init__(self, kind: str, label: str) -> None:
        self.kind = kind
        self.label = label
        self.state = "starting"
        self.message = ""
        self.started_ms = int(time.time() * 1000)
        self.saved_before = 0
        self.saved = 0
        self.process: subprocess.Popen | None = None
        self.stop_requested = False

    def public(self) -> dict:
        return {"kind": self.kind, "label": self.label, "state": self.state, "message": self.message,
                "startedAtMs": self.started_ms, "saved": self.saved}


class LiveTrialDesktopApp:
    def __init__(
        self,
        environment: Mapping[str, str] = os.environ,
        api_origin: str = cli.DEFAULT_API_ORIGIN,
        list_devices: Callable[[str], list] = list_video_devices,
        snapshot: Callable[[str, str, str], bool] = take_snapshot,
        process_factory: Callable[..., subprocess.Popen] = subprocess.Popen,
        clock: Callable[[], float] = time.monotonic,
        stop_capture: Callable[[], None] | None = None,
        poll_seconds: float = 1.0,
        youtube: Callable[..., LiveTrialYouTubePublisher] = LiveTrialYouTubePublisher,
    ) -> None:
        self._environment = dict(environment)
        if api_origin == cli.DEFAULT_API_ORIGIN:
            from livetrial_settings import read_server_origin
            api_origin = read_server_origin(cli.product_base_root(environment)) or api_origin
        self._console = console_module.LiveTrialConsole(
            self._environment, ask=lambda _label: "", say=self._log, api_origin=api_origin,
            open_browser=lambda _url: False, list_devices=list_devices, snapshot=snapshot,
        )
        self._list_devices = list_devices
        self._snapshot = snapshot
        self._process_factory = process_factory
        self._clock = clock
        self._poll_seconds = poll_seconds
        self._stop_capture = stop_capture or self._ask_engine_to_stop
        self._data_root = cli.product_data_root(self._environment)
        self._logs = self._data_root / "logs"
        self._uploads = self._data_root / "videos"
        self._lock = threading.Lock()
        self._ghost_lock = threading.Lock()
        self._api_origin = api_origin
        # The HTTPS client the ghost completion uses (ADR-0210 rule 10); tests put a fake here.
        self._https_factory: Callable[[str], object] = cli.LiveTrialHttpsExecutor
        self._website_cache: tuple[str, float, list] | None = None   # (playerId, clock, results)
        self._job: _Job | None = None
        self._last_job: _Job | None = None
        self._devices: list = []
        self._heartbeat = clock()
        self.quit_requested = threading.Event()
        self.restart_requested = threading.Event()
        # ADR-0213: optional, per active Player; LiveTrial works the same without it.
        self.youtube = youtube(
            self._data_root,
            lambda: self._console._directory().root,
            self._active_youtube_account,
            self._environment,
            log=self._log,
            # The description links the track's leaderboard on the website this build talks to.
            metadata=functools.partial(mk8dx_video_metadata, website_origin=api_origin),
            website_origin=api_origin,
        )

    # -- plumbing -------------------------------------------------------------

    def _log(self, message: str) -> None:
        try:
            self._logs.mkdir(parents=True, exist_ok=True)
            with open(self._logs / "livetrial.log", "a", encoding="utf-8") as handle:
                handle.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {message}\n")
        except OSError:
            pass

    def _cli_command(self, arguments: list[str]) -> list[str]:
        """The flag-driven CLI, frozen or from source, the same one the console ran."""
        if getattr(sys, "frozen", False):
            name = "LiveTrialCli.exe" if os.name == "nt" else "LiveTrialCli"
            return [str(Path(sys.executable).with_name(name)), *arguments]
        return [sys.executable, str(Path(__file__).with_name("livetrial_product_cli.py")), *arguments]

    def _saved_count(self) -> int:
        try:
            return len(self._console._outbox().list())
        except Exception:
            return 0

    def _ask_engine_to_stop(self) -> None:
        request = urllib.request.Request("http://127.0.0.1:8777/api/stop", data=b"{}", method="POST",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=5) as response:
            response.read()

    # -- status, heartbeat, quit ------------------------------------------------

    def status(self) -> dict:
        self._heartbeat = self._clock()
        with self._lock:
            job = self._job or self._last_job
            requirements = capture_requirements(self._environment, self._data_root)
            settings = read_settings(self._data_root)
            capturing = self._job is not None and self._job.kind == "capture"
            result = {
                "version": CURRENT_WINDOWS_VERSION,
                "job": job.public() if job is not None else None,
                "busy": self._job is not None,
                "ffmpegAvailable": bool(requirements["ffmpegAvailable"]),
                "engineAvailable": self._engine_root() is not None,
                "captureDevice": settings.get("captureDevice"),
            }
        # The page may only talk to its own server, so the server tells it when the
        # engine's live picture on 8777 answers and the Live tab can show it.
        result["liveReady"] = capturing and self._live_ready()
        result["historyReady"] = self._history_ready()
        return result

    LIVE_URL = "http://127.0.0.1:8777/api/live"

    def _history_ready(self) -> bool:
        # History and the capture engine take turns serving this port. The browser
        # must not navigate its iframe until either server actually answers.
        try:
            with urllib.request.urlopen(self.LIVE_URL, timeout=0.5) as response:
                return response.status == 200 and "live" in json.loads(response.read(256 * 1024))
        except Exception:
            return False

    def _live_ready(self) -> bool:
        # The run-history server answers /api/live too (live: false) while it is being replaced
        # by the engine; only the capturing engine counts (owner 2026-09-28: Live stayed empty
        # until F5).
        try:
            with urllib.request.urlopen(self.LIVE_URL, timeout=0.5) as response:
                return response.status == 200 and json.loads(response.read(256 * 1024)).get("live") is True
        except Exception:
            return False

    def idle_too_long(self) -> bool:
        return self._job is None and self._clock() - self._heartbeat > IDLE_QUIT_SECONDS

    def quit(self) -> dict:
        """Quit; a running capture or analysis is stopped cleanly first (owner 2026-09-27:
        "when I quit this is done all for me"). Finished races are already saved."""
        with self._lock:
            job = self._job
        if job is None:
            self.quit_requested.set()
            return {"quitting": True}
        if job.state != "stopping":
            self.stop()
        threading.Thread(target=self._quit_after, args=(job,), daemon=True).start()
        return {"quitting": True, "stopping": job.kind}

    def restart_for_server_change(self) -> dict:
        """Relaunch only after an idle, persisted community switch."""
        with self._lock:
            if self._job is not None:
                _fail("Stop the current capture or analysis before changing servers.")
            if read_server_origin(cli.product_base_root(self._environment)) == self._api_origin:
                _fail("Choose a different community website address first.")
            self.restart_requested.set()
        # Give the localhost action response time to reach the page before the
        # main thread shuts down the server. The page waits for the new launch.
        timer = threading.Timer(0.75, self.quit_requested.set)
        timer.daemon = True
        timer.start()
        return {"restarting": True}

    def _quit_after(self, job: "_Job") -> None:
        deadline = self._clock() + STOP_WAIT_SECONDS + 10
        while self._clock() < deadline:
            with self._lock:
                if self._job is not job:
                    break
            time.sleep(min(0.5, self._poll_seconds))
        self.quit_requested.set()

    # -- capture device ---------------------------------------------------------------

    def _engine_root(self) -> str | None:
        try:
            root = self._console._runtime_root or str(console_module.bundled_vision_runtime_root(self._environment) or "")
        except Exception:
            root = ""
        return root or None

    def _ffmpeg(self) -> str:
        ffmpeg = find_ffmpeg(self._environment, self._data_root)
        if ffmpeg is None:
            _fail(" ".join(missing_ffmpeg_lines(self._data_root)))
        return ffmpeg

    def devices(self) -> dict:
        ffmpeg = self._ffmpeg()
        devices = list(self._list_devices(ffmpeg))
        self._devices = devices
        remembered = read_settings(self._data_root).get("captureDevice")
        return {"devices": [
            {"index": index, "name": device.name,
             "remembered": remembered is not None and engine_device_argument(device, devices) == remembered}
            for index, device in enumerate(devices)
        ]}

    def _device(self, index: object):
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(self._devices):
            _fail("Choose one of the listed devices.")
        device = self._devices[index]
        return device, engine_device_argument(device, self._devices)

    def preview(self, index: object) -> dict:
        """One still picture from the device, so a person can see it is the Switch."""
        with self._lock:
            if self._job is not None:
                _fail("The capture card is in use by the running job.")
        device, argument = self._device(index)
        output = self._data_root / SNAPSHOT_FILE_NAME
        if not self._snapshot(self._ffmpeg(), argument, str(output)):
            _fail(f"No picture came from {device.name}. It may be in use by another program (OBS, a browser), "
                  "or it is not the capture card.")
        return {"previewUrl": f"/api/capture-preview?t={int(time.time() * 1000)}", "name": device.name}

    # -- jobs -----------------------------------------------------------------------

    def _refuse_when_busy(self) -> None:
        with self._lock:
            if self._job is not None:
                _fail("Something is already running. Stop it first.")

    def _start_job(self, kind: str, label: str, arguments: list[str]) -> dict:
        with self._lock:
            if self._job is not None:
                _fail("Something is already running. Stop it first.")
            job = _Job(kind, label)
            job.saved_before = self._saved_count()
            self._job = job
        thread = threading.Thread(target=self._run_job, args=(job, arguments), name=f"livetrial-{kind}", daemon=True)
        thread.start()
        return job.public()

    def _run_job(self, job: _Job, arguments: list[str]) -> None:
        log = None
        try:
            self._console._ensure_profile()
            if job.kind == "capture":
                # Fresh targets for the run cards, then free port 8777 for the engine's live view.
                self._console._write_reference(refresh=True)
                self._stop_history_server()
            self._logs.mkdir(parents=True, exist_ok=True)
            log = open(self._logs / f"{job.kind}-{time.strftime('%Y%m%d-%H%M%S')}.log", "ab")
            environment = dict(os.environ)
            environment.update(self._environment)
            job.process = self._process_factory(
                self._cli_command(arguments), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                env=environment, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            job.state = "running"
            while job.process.poll() is None:
                job.saved = max(0, self._saved_count() - job.saved_before)
                time.sleep(self._poll_seconds)
            code = job.process.returncode
            job.saved = max(0, self._saved_count() - job.saved_before)
            if code in {0, 130} or job.stop_requested:
                job.state = "done"
                job.message = f"{job.saved} run(s) saved."
            elif code == cli.EXIT_CAPTURE_REQUIREMENTS_MISSING:
                job.state = "failed"
                job.message = " ".join(missing_ffmpeg_lines(self._data_root))
            else:
                job.state = "failed"
                job.message = ("The capture could not start or stopped unexpectedly." if job.kind == "capture"
                               else "The video could not be analysed.") + f" {job.saved} run(s) were saved."
        except Exception:
            job.state = "failed"
            job.message = "It could not be started. Nothing was changed."
        finally:
            if log is not None:
                log.close()
            with self._lock:
                self._last_job = job
                self._job = None
            if job.kind == "capture":
                self._start_history_server()

    def start_capture(self, index: object) -> dict:
        self._refuse_when_busy()
        if self._engine_root() is None:
            _fail("The recognition engine is not part of this installation.")
        self._ffmpeg()
        device, argument = self._device(index)
        try:
            write_capture_device(self._data_root, argument)
        except Exception:
            pass
        return self._start_job("capture", device.name, ["capture", "--", "--dshow-name", argument,
                                                        *self._console_language_arguments()])

    def stop(self) -> dict:
        with self._lock:
            job = self._job
        if job is None:
            _fail("Nothing is running.")
        job.stop_requested = True
        job.state = "stopping"
        if job.kind == "capture":
            try:
                self._stop_capture()
            except Exception:
                pass
        threading.Thread(target=self._force_stop, args=(job,), daemon=True).start()
        return job.public()

    def _force_stop(self, job: _Job) -> None:
        deadline = self._clock() + (STOP_WAIT_SECONDS if job.kind == "capture" else 2)
        while job.process is not None and job.process.poll() is None and self._clock() < deadline:
            time.sleep(min(0.5, self._poll_seconds))
        if job.process is not None and job.process.poll() is None:
            job.process.terminate()

    def analyze(self, body: dict) -> dict:
        self._refuse_when_busy()
        if self._engine_root() is None:
            _fail("The recognition engine is not part of this installation.")
        path = None
        upload = body.get("uploadId")
        if isinstance(upload, str) and upload:
            candidate = (self._uploads / Path(upload).name)
            if candidate.parent != self._uploads or not candidate.is_file():
                _fail("That upload is not on this PC any more.")
            path = candidate
        typed = body.get("path")
        if path is None and isinstance(typed, str) and typed.strip():
            candidate = Path(typed.strip().strip('"'))
            if not candidate.is_file():
                _fail("That file was not found. Check the path, or choose the file instead.")
            path = candidate
        if path is None:
            _fail("Choose a video, or paste its path.")
        if path.suffix.lower() not in VIDEO_SUFFIXES:
            _fail("That does not look like a video file (mp4, mkv, mov, avi, webm).")
        # An uploaded copy carries a time/random prefix; show the name the person chose.
        label = re.sub(r"^\d{8}-\d{6}-[0-9a-f]{6}-", "", path.name)
        return self._start_job("analyze", label, ["analyze", "--video", str(path), "--",
                                                  *self._console_language_arguments()])

    def _console_language_arguments(self) -> list[str]:
        """The engine is told the Switch's language, or to detect it (the default)."""
        return ["--console-language", read_settings(self._data_root).get("consoleLanguage", CONSOLE_LANGUAGE_AUTO)]

    # -- run-history server ---------------------------------------------------------

    def _stop_history_server(self) -> None:
        process = self._console._dashboard_process
        self._console._dashboard_process = None
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except Exception:
                process.kill()

    def _start_history_server(self) -> None:
        try:
            if self._engine_root() is None:
                return
            interpreter = console_module.bundled_vision_python(self._environment)
            script = os.path.join(self._engine_root(), "livetrial", "serve.py")
            if interpreter is None or not os.path.isfile(script):
                return
            runs = self._data_root / "runs"
            runs.mkdir(parents=True, exist_ok=True)
            environment = dict(os.environ)
            environment.update(self._environment)
            self._console._dashboard_process = subprocess.Popen(
                [interpreter, "-B", script, "--runs-dir", str(runs), "--port", "8777"],
                cwd=self._engine_root(), env=environment, stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception:
            self._console._dashboard_process = None

    # -- settings -------------------------------------------------------------

    def settings(self) -> dict:
        settings = read_settings(self._data_root)
        return {"language": settings.get("language", "en"), "autoSend": bool(settings.get("autoSyncCompletedRuns")),
                "consoleLanguage": settings.get("consoleLanguage", CONSOLE_LANGUAGE_AUTO),
                "consoleLanguages": [{"code": code, "label": label} for code, label in CONSOLE_LANGUAGES],
                "version": CURRENT_WINDOWS_VERSION, "dataFolder": str(self._data_root), "serverOrigin": self._api_origin}

    def change_settings(self, body: dict) -> dict:
        new_origin = body.get("serverOrigin")
        if new_origin is not None:
            from livetrial_settings import write_server_origin
            if self._job is not None:
                _fail("Stop the current capture or analysis before changing servers.")
            write_server_origin(cli.product_base_root(self._environment), new_origin)
            # The active process keeps its existing account/outbox. Restart loads
            # the new server-specific directory; nothing is sent on switching.
            return {**self.settings(), "restartRequired": True}
        language = body.get("language")
        if language is not None:
            if language not in {"en", "nl"}:
                _fail("Choose English or Nederlands.")
            write_language(self._data_root, language)
        console_language = body.get("consoleLanguage")
        if console_language is not None:
            if console_language != CONSOLE_LANGUAGE_AUTO and console_language not in {c for c, _ in CONSOLE_LANGUAGES}:
                _fail("Choose Automatic or one of the Switch's languages.")
            write_console_language(self._data_root, console_language)
        auto = body.get("autoSend")
        if auto is not None:
            if not isinstance(auto, bool):
                _fail("Automatic send is on or off.")
            write_auto_sync(self._data_root, auto)
        return self.settings()

    # -- results on this PC --------------------------------------------------------

    def results(self, catalog: dict) -> dict:
        self._ghost_maintenance()
        records = latest_records(self._console._outbox().list())
        owners = self._console._owners()
        directory = self._console._directory()
        ghost_links = {d.get("entryKey"): {"ghostId": gid, "auto": bool(d.get("auto")), "byName": d.get("byName")}
                       for gid, d in ghosts.GhostDecisions(self._data_root).load()["decisions"].items()
                       if d.get("decision") == "mine"}
        rows = []
        seen: set = set()
        for record in records:
            if len(rows) >= 100:
                break
            value = record["canonicalSubmission"]
            if not value["source"]["kind"].startswith("livetrial_"):
                continue
            if record["state"].get("failureCode") in (MOVED_TO_ACCOUNT, ghosts.GHOST_UNDONE):
                continue
            # 3.24.0 and earlier saved a race twice when the engine rewrote its
            # report; those copies are shown once.
            fingerprint = race_fingerprint(value)
            if fingerprint is not None and fingerprint in seen:
                continue
            seen.add(fingerprint)
            owner = owners.owner_of(record["entry"]["entryKey"])
            account = directory.get(owner["slotId"]) if owner else None
            reference = value.get("playerReference") or {}
            if account is None and reference.get("namespace") == "player":
                account = directory.find_by_player(reference.get("value"))
            track = catalog.get(value["trackId"], {}) if isinstance(catalog, dict) else {}
            rows.append({
                "entryKey": record["entry"]["entryKey"],
                "trackId": value["trackId"],
                "trackName": track.get("name") or value["trackId"],
                "mode": value["mode"],
                "totalTime": format_time(value["totalTimeMs"]),
                "laps": [{"time": format_time(lap["timeMs"]), "coins": lap.get("coinsCollected"),
                          "mushrooms": lap.get("mushroomsUsed")} for lap in value.get("laps", [])],
                "loadout": value.get("loadout") or None,
                "state": record["state"]["state"],
                "implausibleTime": record["state"].get("failureCode") == "http.implausible-time",
                "revision": value["revision"],
                "source": value["source"]["kind"],
                "fromGhost": value["source"].get("captureLayout") == "ghost_details",
                "ghostLink": ghost_links.get(record["entry"]["entryKey"]),
                "player": cli.account_label(account) if account else None,
                "noAccount": reference.get("namespace") != "player",
                "createdAtMs": value["timestamps"]["createdAtMs"],
                "correctable": record["state"]["state"] in {"pending", "synced", "failed"},
            })
        tracks = sorted(({"id": key, "name": item.get("name") or key, "lapCount": item.get("lapCount")}
                         for key, item in (catalog or {}).items()), key=lambda item: item["name"])
        return {"results": rows, "tracks": tracks, "worldRecords": self._world_records()}

    def _world_records(self) -> dict:
        """The World Records this PC last saw ("track|mode" -> time and holder), for Correct."""
        try:
            path = self._data_root / ecosystem.CACHE_NAME
            if not path.is_file() or path.is_symlink() or path.stat().st_size > ecosystem.MAX_CACHE_BYTES:
                return {}
            records = json.loads(path.read_text(encoding="utf-8")).get("bootstrap", {}).get("worldRecords") or []
            table = {}
            for row in records:
                if isinstance(row, dict) and row.get("mode") in (150, 200) and isinstance(row.get("trackId"), str)                         and isinstance(row.get("totalTimeMs"), int) and not isinstance(row.get("totalTimeMs"), bool):
                    holder = row.get("playerName") or ((row.get("holders") or [{}])[0] or {}).get("playerName")
                    table[f"{row['trackId']}|{row['mode']}"] = {"timeMs": row["totalTimeMs"],
                                                                  "holder": holder if isinstance(holder, str) else None}
            return table
        except Exception:
            return {}

    def correct(self, body: dict, catalog: dict | None = None) -> dict:
        """The console's correction, as one form: a new revision, the earlier one kept."""
        entry_key = body.get("entryKey")
        outbox = self._console._outbox()
        records = latest_records(outbox.list())
        selected = next((record for record in records if record["entry"]["entryKey"] == entry_key), None)
        if selected is None or not selected["canonicalSubmission"]["source"]["kind"].startswith("livetrial_"):
            _fail("That result is not on this PC any more.")
        prior = selected["canonicalSubmission"]
        changes: dict = {}
        if body.get("trackId") not in (None, prior["trackId"]):
            changes["trackId"] = body["trackId"]
        if body.get("mode") not in (None, prior["mode"]):
            if body["mode"] not in (150, 200):
                _fail("Engine class must be 150 or 200.")
            changes["mode"] = body["mode"]
        try:
            if body.get("totalTime"):
                total = parse_time(body["totalTime"])
                if total != prior["totalTimeMs"]:
                    changes["totalTimeMs"] = total
            laps_in = body.get("laps")
            if isinstance(laps_in, list):
                old_laps = prior.get("laps", [])
                if len(laps_in) not in {0, 3, 7}:
                    _fail("A run has 3 or 7 laps.")
                laps = []
                for index, lap in enumerate(laps_in):
                    entry = {"lapNumber": index + 1, "timeMs": parse_time(lap["time"])}
                    for key, upper in (("coins", 10), ("mushrooms", 3)):
                        value = lap.get(key)
                        if value not in (None, ""):
                            number = int(value)
                            if not 0 <= number <= upper:
                                _fail(f"{key.capitalize()} per lap are between 0 and {upper}.")
                            entry["coinsCollected" if key == "coins" else "mushroomsUsed"] = number
                    laps.append(entry)
                if sum(lap.get("mushroomsUsed", 0) for lap in laps) > 3:
                    _fail("A run has at most 3 mushrooms in total.")
                if laps != old_laps:
                    changes["laps"] = laps
        except LiveTrialDesktopError:
            raise
        except Exception:
            _fail("Use times such as 1:42.123.")
        loadout_in = body.get("loadout")
        if loadout_in is not None:
            keys = ("characterId", "characterVariantId", "bodyId", "bodyVariantId", "tireId", "gliderId", "gliderVariantId")
            if (not isinstance(loadout_in, dict) or any(key not in keys for key in loadout_in)
                    or any(not isinstance(value, str) or not value or len(value) > 128 for value in loadout_in.values())):
                _fail("That kart combination is not valid.")
            if loadout_in != (prior.get("loadout") or {}):
                changes["loadout"] = dict(loadout_in)
        if not changes:
            _fail("Nothing was changed.")
        # The page checks these while you type; this is the same rule once more before saving.
        track_id = changes.get("trackId", prior["trackId"])
        final_laps = changes.get("laps", prior.get("laps", []))
        final_total = changes.get("totalTimeMs", prior["totalTimeMs"])
        lap_count = ((catalog or {}).get(track_id) or {}).get("lapCount")
        if final_laps and lap_count in (3, 7) and len(final_laps) != lap_count:
            _fail(f"That track has {lap_count} laps; this run has {len(final_laps)}.")
        if final_laps and sum(lap["timeMs"] for lap in final_laps) != final_total:
            _fail(f"The lap times add up to {format_time(sum(lap['timeMs'] for lap in final_laps))}, "
                  f"but the total time is {format_time(final_total)}.")
        try:
            record, fields = create_corrected_revision(outbox, selected, changes, self._console._now_ms())
        except Exception:
            _fail("The correction was not valid. Nothing was changed.")
        owners = self._console._owners()
        owner = owners.owner_of(selected["entry"]["entryKey"])
        if owner is not None:
            owners.record(record["entry"]["entryKey"], owner["slotId"], record["canonicalSubmission"]["playerReference"],
                          self._console._now_ms())
        return {"corrected": list(fields), "entryKey": record["entry"]["entryKey"]}

    def send_as(self, body: dict) -> dict:
        """Give runs recorded without an account to one account the person chose.

        A revision may not change its Player, so each run becomes a new
        submission for that Player (same race, same evidence) and the local-only
        original is closed with MOVED_TO_ACCOUNT so it stops waiting. Nothing is
        ever assigned without this explicit request.
        """
        directory = self._console._directory()
        slot_id = body.get("slotId")
        account = directory.get(slot_id) if isinstance(slot_id, str) else directory.active()
        if account is None or not account.get("playerId"):
            _fail("Add or choose an account first.")
        wanted = body.get("entryKeys")
        if wanted is not None and (not isinstance(wanted, list) or not all(isinstance(key, str) for key in wanted)):
            _fail("Those results are not on this PC any more.")
        outbox = self._console._outbox()
        owners = self._console._owners()
        moved = []
        for record in outbox.list("pending"):
            prior = record["canonicalSubmission"]
            entry_key = record["entry"]["entryKey"]
            if (wanted is not None and entry_key not in wanted) or prior["playerReference"]["namespace"] == "player":
                continue
            if not prior["source"]["kind"].startswith("livetrial_"):
                continue
            now_ms = self._console._now_ms()
            submission = json.loads(json.dumps(prior))
            digest = hashlib.sha256(f"{prior['submissionId']}|{account['playerId']}".encode("utf-8")).hexdigest()
            submission["submissionId"] = f"user_submission.time.LIVETRIAL{digest}"
            submission["revision"] = 1
            submission["playerReference"] = {"namespace": "player", "value": account["playerId"]}
            try:
                evidence = outbox.read_private_evidence(entry_key)["privateEvidence"]
                created = outbox.create(submission, now_ms, evidence)
                owners.record(created["entry"]["entryKey"], account["slotId"], submission["playerReference"], now_ms)
                outbox.mark_failed(entry_key, record["state"]["stateRevision"], now_ms, MOVED_TO_ACCOUNT)
            except Exception:
                _fail("That result could not be moved. Nothing was changed.")
            moved.append(created["entry"]["entryKey"])
        if not moved:
            _fail("There is no result without an account left to send.")
        try:
            sent = self._console._account_actions().send_waiting()["sent"]
        except Exception:
            sent = 0
        return {"moved": len(moved), "account": cli.account_label(account), "sent": sent}

    # -- detected ghosts (ADR-0210) ------------------------------------------------------

    def _ghost_inputs(self) -> tuple[list, dict, dict | None, list, dict]:
        """Ghosts of the current (or just finished) capture, and what the
        decision rules need: decisions, the active account, its local results,
        its published bests (player-reference.json) and the world records."""
        job = self._job or self._last_job
        since = (job.started_ms - 60_000) if job is not None and job.kind == "capture" else None
        if since is None:
            return [], {"decisions": {}, "confirmedNames": {}, "ownNames": {}}, None, [], {}
        items = ghosts.read_session_ghosts(self._data_root / "runs", since)
        decisions = ghosts.GhostDecisions(self._data_root).load()
        account = self._console._directory().active()
        results = [record["canonicalSubmission"] for record in latest_records(self._console._outbox().list())]
        return items, decisions, account, results, self._world_records()

    def _player_reference(self, player_id: str | None) -> dict | None:
        try:
            path = self._data_root / "runs" / "player-reference.json"
            document = json.loads(path.read_text(encoding="utf-8"))
            return document if isinstance(document, dict) and document.get("playerId") == player_id else None
        except Exception:
            return None

    def _asset_catalog(self) -> Schema9LiveTrialAssetCatalog:
        return Schema9LiveTrialAssetCatalog(
            json.loads(Path(asset_catalog_path(self._environment)).read_text(encoding="utf-8")),
            CATALOG_SOURCE_SHA256)

    def _ghost_maintenance(self) -> None:
        """Link ghosts that carry a name an account declared as its own, and
        give a claimed ghost's result the laps/replay the engine saw later.
        Runs whenever the app lists results or ghosts; one at a time."""
        if not self._ghost_lock.acquire(blocking=False):
            return
        try:
            items, _decisions, _active, results, world_records = self._ghost_inputs()
            if not items:
                return
            # Only the ACTIVE account's names link (owner 2026-09-28: names are per account
            # and "not kept when accounts are swapped"): a BEnZor ghost seen while Evan is
            # signed in stays an ordinary row, it is never linked to an absent Ben.
            active = self._console._directory().active()
            accounts = ({active["slotId"]: active}
                        if active and active.get("slotId") and active.get("playerId") else {})
            references = {}
            for account in accounts.values():
                reference = self._player_reference(account["playerId"])
                if reference is not None:
                    references[account["playerId"]] = reference
            outbox, owners = self._console._outbox(), self._console._owners()
            store = ghosts.GhostDecisions(self._data_root)
            catalog = self._asset_catalog()
            now = self._console._now_ms()
            linked = ghosts.auto_link(
                items, accounts=accounts, outbox=outbox, owners=owners, decisions=store, catalog=catalog,
                now_ms=now, producer_version=CURRENT_WINDOWS_VERSION, references=references,
                local_results=results, world_records=world_records,
                capture_running=self._job is not None and self._job.kind == "capture",
                wall_ms=int(time.time() * 1000))
            latest = {r["entry"]["entryKey"]: r for r in latest_records(outbox.list())}
            enriched = ghosts.enrich_claimed(items, outbox=outbox, owners=owners, decisions=store,
                                             catalog=catalog, now_ms=now, producer_version=CURRENT_WINDOWS_VERSION,
                                             latest_by_entry=latest)
            completed = []
            if active is not None and active.get("playerId"):
                bearer = self._bearer(active)
                if bearer is not None:
                    executor = self._https_factory(self._api_origin)
                    completed = ghosts.complete_by_name(
                        items, account=active, executor=executor, bearer=bearer, decisions=store,
                        catalog=catalog, producer_version=CURRENT_WINDOWS_VERSION, now_ms=now,
                        capture_running=self._job is not None and self._job.kind == "capture",
                        wall_ms=int(time.time() * 1000),
                        published=lambda: self._website_results(active["playerId"], executor, bearer))
                    if completed:
                        self._website_cache = None
                    # ADR-0212: proven staff and World Record ghosts go to the website by themselves.
                    ghosts.send_reference_readings(
                        items, world_records=world_records, executor=executor, bearer=bearer,
                        ledger=ghosts.ReferenceReadingLedger(self._data_root), now_ms=now,
                        capture_running=self._job is not None and self._job.kind == "capture",
                        wall_ms=int(time.time() * 1000))
            if (linked or enriched) and read_settings(self._data_root).get("autoSyncCompletedRuns"):
                try:
                    self._console._account_actions().send_waiting()
                except Exception:
                    pass
        except Exception:
            pass                                       # never let this break the list the Player sees
        finally:
            self._ghost_lock.release()

    def _bearer(self, account: dict) -> str | None:
        """The account's own signed-in session, or None (signed out, expired, another Player)."""
        try:
            session = self._console._directory().store(account["slotId"]).load(self._console._now_ms())
        except Exception:
            return None
        if not isinstance(session, dict) or session.get("playerId") != account.get("playerId"):
            return None
        token = session.get("bearerToken")
        return token if isinstance(token, str) and token else None

    WEBSITE_RESULTS_TTL_SECONDS = 60.0

    def _website_results(self, player_id: str, executor, bearer: str) -> list:
        """The account's published results, read at most once a minute."""
        cached = self._website_cache
        if cached is not None and cached[0] == player_id and self._clock() - cached[1] < self.WEBSITE_RESULTS_TTL_SECONDS:
            return cached[2]
        results = ghosts.website_results(executor, player_id, bearer)
        self._website_cache = (player_id, self._clock(), results)
        return results

    def _published_for_rows(self, account: dict | None, items: list, decisions: dict) -> list | None:
        """The website results the rows compare against: read (at most once a minute) only
        while some ghost of another than Nintendo is still undecided; None when unavailable."""
        player_id = (account or {}).get("playerId")
        if not player_id:
            return None
        undecided = any(not i["ghost"].get("staffGhost") and i["id"] not in (decisions.get("decisions") or {})
                        for i in items)
        cached = self._website_cache
        if not undecided:
            return cached[2] if cached is not None and cached[0] == player_id else None
        bearer = self._bearer(account)
        if bearer is None:
            return None
        try:
            return self._website_results(player_id, self._https_factory(self._api_origin), bearer)
        except Exception:
            return None

    def ghost_complete(self, body: dict) -> dict:
        """Add what this ghost knows to the active account's matching result on the website."""
        item = self._ghost_item(body)
        account = self._console._directory().active()
        if account is None or not account.get("playerId"):
            _fail("Add or choose an account first.")
        bearer = self._bearer(account)
        if bearer is None:
            _fail("Sign in with this account first.")
        try:
            decision = ghosts.complete_on_website(
                item, account, executor=self._https_factory(self._api_origin), bearer=bearer,
                decisions=ghosts.GhostDecisions(self._data_root), catalog=self._asset_catalog(),
                producer_version=CURRENT_WINDOWS_VERSION, now_ms=self._console._now_ms())
        except ghosts.LiveTrialGhostError as error:
            _fail(str(error))
        except Exception:
            _fail("The website could not add these details right now. Try again later.")
        self._website_cache = None
        return {"outcome": decision["outcome"], "fields": decision["fields"]}

    def ghost_names(self, body: dict) -> dict:
        """The active account's own ghost names (Settings); with `names`, replace them."""
        account = self._console._directory().active()
        if account is None:
            _fail("Add or choose an account first.")
        store = ghosts.GhostDecisions(self._data_root)
        if "names" in body:
            try:
                names = ghosts.set_own_names(store, account["slotId"], body["names"])
            except ghosts.LiveTrialGhostError as error:
                _fail(str(error))
        else:
            names = ghosts.own_names(store.load(), account["slotId"])
        return {"names": names, "account": cli.account_label(account)}

    def ghost_undo(self, body: dict) -> dict:
        gid = body.get("id")
        if not isinstance(gid, str):
            _fail("That ghost is not on this PC any more.")
        outbox = self._console._outbox()
        latest = {r["entry"]["entryKey"]: r for r in latest_records(outbox.list())}
        try:
            ghosts.undo_auto_link(gid, outbox=outbox, decisions=ghosts.GhostDecisions(self._data_root),
                                  latest_by_entry=latest, now_ms=self._console._now_ms())
        except ghosts.LiveTrialGhostError as error:
            _fail(str(error))
        return {"undone": gid}

    def ghosts(self, catalog: dict | None = None) -> dict:
        self._ghost_maintenance()
        items, decisions, account, results, world_records = self._ghost_inputs()
        player_id = (account or {}).get("playerId")
        rows = ghosts.ghost_rows(items, decisions, player_id=player_id, slot_id=(account or {}).get("slotId"),
                                 reference=self._player_reference(player_id), local_results=results,
                                 world_records=world_records,
                                 published=self._published_for_rows(account, items, decisions))
        # "Already on the website" opens that result on the website (owner 2026-09-29)
        for row in rows:
            if row.get("already") == "website":
                record = (catalog or {}).get(row.get("trackId")) or {}
                row["websiteUrl"] = ghosts.website_result_url(
                    self._api_origin, row.get("trackId"), row.get("mode"), record.get("index"),
                    row.get("websiteResultId"))
        return {"ghosts": rows, "account": cli.account_label(account) if account else None}

    def _ghost_item(self, body: dict) -> dict:
        wanted = body.get("id")
        items = self._ghost_inputs()[0]
        item = next((i for i in items if i["id"] == wanted), None) if isinstance(wanted, str) else None
        if item is None:
            _fail("That ghost is not in this session any more.")
        return item

    def ghost_claim(self, body: dict) -> dict:
        """Mine: a normal local result for the chosen account, then the usual send path."""
        item = self._ghost_item(body)
        directory = self._console._directory()
        slot_id = body.get("slotId")
        account = directory.get(slot_id) if isinstance(slot_id, str) else directory.active()
        if account is None or not account.get("playerId"):
            _fail("Add or choose an account first.")
        _items, _decisions, _active, results, world_records = self._ghost_inputs()
        try:
            asset_catalog = Schema9LiveTrialAssetCatalog(
                json.loads(Path(asset_catalog_path(self._environment)).read_text(encoding="utf-8")),
                CATALOG_SOURCE_SHA256)
            created = ghosts.claim(
                item, account, outbox=self._console._outbox(), owners=self._console._owners(),
                decisions=ghosts.GhostDecisions(self._data_root), catalog=asset_catalog,
                now_ms=self._console._now_ms(), producer_version=CURRENT_WINDOWS_VERSION,
                reference=self._player_reference(account["playerId"]), local_results=results,
                world_records=world_records, confirm_world_record=body.get("confirmWorldRecord") is True)
        except ghosts.LiveTrialGhostError as error:
            _fail(str(error))
        except Exception:
            _fail("That ghost could not be saved. Nothing was changed.")
        sent = 0
        if read_settings(self._data_root).get("autoSyncCompletedRuns"):
            try:
                sent = self._console._account_actions().send_waiting()["sent"]
            except Exception:
                sent = 0
        return {"entryKey": created["entryKey"], "account": cli.account_label(account), "sent": sent}

    def ghost_dismiss(self, body: dict) -> dict:
        item = self._ghost_item(body)
        ghosts.GhostDecisions(self._data_root).decide(
            item["id"], {"decision": "not_mine", "atMs": self._console._now_ms()})
        return {"dismissed": item["id"]}

    def ghost_export(self, body: dict) -> dict:
        """The JSON the Player may share: one ghost, or all of this session's."""
        items = self._ghost_inputs()[0]
        wanted = body.get("ids")
        if isinstance(wanted, list):
            items = [i for i in items if i["id"] in wanted]
        if not items:
            _fail("There is no ghost to export.")
        return ghosts.export_document(items)

    # -- YouTube (optional, ADR-0213) ------------------------------------------------

    def _active_youtube_account(self) -> dict | None:
        directory = self._console._directory()
        row = directory.active()
        if row is None:
            return None
        account = {"slotId": row["slotId"], "label": cli.account_label(row), "playerId": row.get("playerId")}
        # The profile link uses the username, the website's own short profile address.
        try:
            session = directory.load(row["slotId"], self._console._now_ms())
        except Exception:
            session = None
        if isinstance(session, dict) and isinstance(session.get("username"), str):
            account["username"] = session["username"]
        return account

    # -- the dashboard ----------------------------------------------------------------

    def actions(self, catalog: dict) -> dict:
        table = dict(self._console._account_actions().dashboard_actions())
        table.update({
            "app.status": lambda _body: self.status(),
            "app.quit": lambda _body: self.quit(),
            "app.restart": lambda _body: self.restart_for_server_change(),
            "capture.devices": lambda _body: self.devices(),
            "capture.preview": lambda body: self.preview(body.get("index")),
            "capture.start": lambda body: self.start_capture(body.get("index")),
            "job.stop": lambda _body: self.stop(),
            "analyze.start": lambda body: self.analyze(body),
            "settings.get": lambda _body: self.settings(),
            "settings.set": lambda body: self.change_settings(body),
            "results.list": lambda _body: self.results(catalog),
            "results.correct": lambda body: self.correct(body, catalog),
            "results.send_as": lambda body: self.send_as(body),
            "ghosts.list": lambda _body: self.ghosts(catalog),
            "ghosts.claim": lambda body: self.ghost_claim(body),
            "ghosts.dismiss": lambda body: self.ghost_dismiss(body),
            "ghosts.export": lambda body: self.ghost_export(body),
            "ghosts.names": lambda body: self.ghost_names(body),
            "ghosts.undo": lambda body: self.ghost_undo(body),
            "ghosts.complete": lambda body: self.ghost_complete(body),
            "youtube.status": lambda _body: self.youtube.status(),
            "youtube.connect": lambda _body: self.youtube.connect(),
            "youtube.cancel": lambda _body: self.youtube.cancel_connect(),
            "youtube.disconnect": lambda body: self.youtube.disconnect(body.get("forgetHistory") is True),
            "clips.list": lambda _body: self.youtube.clips(catalog),
            "clips.draft": lambda body: self.youtube.draft(body.get("clipId"), catalog),
            "clips.upload": lambda body: self.youtube.upload(body.get("clipId"), body.get("privacyStatus", "private"), catalog,
                                                             body.get("title"), body.get("description")),
            "clips.forget": lambda body: self.youtube.forget(body.get("clipId"), catalog),
        })
        return table

    def start(self) -> dashboard.ProgressDashboard:
        root = self._engine_root()
        catalog, assets_root = dashboard.load_track_catalog(root) if root else ({}, None)
        self._write_reference_safe()
        self._start_history_server()
        return dashboard.start_progress_dashboard(
            dashboard.dashboard_root(self._environment),
            lambda refresh: self._console._dashboard_progress(refresh, catalog),
            catalog, assets_root, dashboard.DEFAULT_HISTORY_URL,
            language=read_settings(self._data_root)["language"],
            language_provider=lambda: read_settings(self._data_root)["language"],
            rank_provider=lambda query, player_ids: self._console._dashboard_rank_data(query, player_ids, catalog),
            actions=self.actions(catalog),
            uploads_root=self._uploads,
            preview_file=self._data_root / SNAPSHOT_FILE_NAME,
            clip_still=lambda clip_id: endscreen_path(self._data_root / "runs", clip_id),
        )

    def _write_reference_safe(self) -> None:
        try:
            self._console._write_reference()
        except Exception:
            pass

    def shutdown(self) -> None:
        with self._lock:
            job = self._job
        if job is not None and job.process is not None and job.process.poll() is None:
            job.process.terminate()
        self._stop_history_server()


def _quiet_streams(data_root: Path) -> None:
    """A windowed build has no console; keep print() and tracebacks in the log."""
    if sys.stdout is None or sys.stderr is None:
        logs = data_root / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        stream = open(logs / "livetrial-console.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or stream
        sys.stderr = sys.stderr or stream


def _launch_restarted_app(environment: Mapping[str, str], spawn: Callable[..., object] = subprocess.Popen) -> None:
    child_environment = dict(environment)
    child_environment[REUSE_WINDOW_ENV] = "1"
    if getattr(sys, "frozen", False):
        # PyInstaller 6.9+ otherwise treats sys.executable as a worker that
        # shares its parent's temporary runtime, which is wrong for a restart.
        child_environment["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
        command = [sys.executable]
        workdir = Path(sys.executable).parent
    else:
        command = [sys.executable, str(Path(__file__).resolve())]
        workdir = Path(__file__).resolve().parent
    spawn(command, cwd=str(workdir), env=child_environment, stdin=subprocess.DEVNULL,
          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def main(environment: Mapping[str, str] = os.environ) -> int:
    data_root = cli.product_data_root(environment)
    _quiet_streams(data_root)
    url = f"http://127.0.0.1:{dashboard.DEFAULT_PORT}/"
    if running_instance() and not hand_over():
        # Started again: bring the dashboard back instead of a second copy.
        open_app_window(url, environment)
        return 0
    app = LiveTrialDesktopApp(environment)
    server = app.start()
    if environment.get(REUSE_WINDOW_ENV) != "1":
        open_app_window(server.url, environment)
    try:
        while not app.quit_requested.wait(5.0):
            if app.idle_too_long():
                break
    except KeyboardInterrupt:
        pass
    finally:
        app.shutdown()
        server.stop()
    if app.restart_requested.is_set():
        _launch_restarted_app(environment)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
