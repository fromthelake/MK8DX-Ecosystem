"""LiveTrial CLI — live capture-card mode with dashboard.

Reads an ffmpeg capture device, processes the newest frame
(drop-when-behind), serves the live dashboard, and persists every completed
run. Windows keeps the historical DirectShow-by-name shorthand; Linux/macOS can
use the generic ffmpeg input flags.

Usage:
    ..\\.venv\\Scripts\\python.exe livetrial\\watch.py --dshow-name "UGREEN 35287"
        [--dshow-size 1920x1080] [--dshow-fps 30] [--port 8777]
        [--db PATH] [--runs-dir livetrial/runs] [--no-easyocr]

    python livetrial/watch.py --capture-format v4l2 --capture-input /dev/video0
    python livetrial/watch.py --capture-format avfoundation --capture-input "0"

    ..\\.venv\\Scripts\\python.exe livetrial\\watch.py --list-devices
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

# Cap the native math pools BEFORE cv2/numpy/torch import them: OpenMP/MKL
# otherwise size their thread pools to the core count (~24), which oversubscribes
# the CPU when the analysis loop, the media thread, and libx264 all run at once.
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collections import deque

from livetrial import hudtimes
from livetrial.clock import read_clock
from livetrial.ghostmenu import GHOST_CLIP_PANEL_HOLD_FRAMES, GhostClipPlanner, same_ghost
from livetrial.report import write_ghost_replays, write_ghosts, write_reports
from livetrial.runner import RunProcessor
from serve import RunStore, start_background


# Of a pause, how much to keep at each end of the clip. Long enough that you
# see the race stop and see it start again; short enough that a two-minute
# menu does not end up in a shareable clip.
PAUSE_KEEP_MS = 2500
LIVE_TICKER_ITEMS = 120
LIVE_HISTORY_ITEMS = 1000
RUN_LOG_BEFORE_ARM_MS = 20000
RUN_LOG_AFTER_END_MS = 20000


def clipped_ghosts(runs_dir: Path) -> list[dict]:
    """Ghosts that already have a replay clip on disk, from every session's
    ghosts.json: a ghost gets one clip, not one per viewing (owner 2026-09-29).
    A clip the storage budget removed frees its ghost for a new one."""
    found = []
    for doc_path in Path(runs_dir).glob("*/ghosts.json"):
        try:
            ghosts = json.loads(doc_path.read_text(encoding="utf-8")).get("ghosts") or []
        except (OSError, ValueError, AttributeError):
            continue
        for g in ghosts:
            name = g.get("clip") if isinstance(g, dict) else None
            if isinstance(name, str) and (doc_path.parent / name).is_file():
                found.append(g)
    return found


def discard_clip(path: "Path | None") -> None:
    """Remove a ghost clip that was not kept, with its timeline and panel still."""
    if path is None:
        return
    for p in (path, path.with_suffix(".mp4"), path.with_suffix(".mkv"),
              path.with_name(path.stem + ".timeline.json"), path.with_name(path.stem + ".panel.jpg")):
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


def _ms_clock(ms: int) -> str:
    return f"{ms // 60000}:{ms % 60000 // 1000:02d}.{ms % 1000:03d}"


def _describe(e: dict) -> str:
    """English prose for one event — the log line, and the fallback the client
    parses when an item carries no `kind` (older payloads). New rendering
    should key off _row()'s kind/data instead: three different events used to
    start with "Lap N", the client matched them all with /^Lap (\\d+)/, and the
    times and gaps we had already decoded were thrown away before display."""
    t = e["type"]
    if t == "go":
        return "GO! — run started"
    if t == "lap":
        return f"Lap {e['lap']}"
    if t == "coin":
        return f"Coins {e['from']} → {e['to']}"
    if t == "mushrooms":
        return f"Mushroom used ({e['to']} left)"
    if t == "mushroom_use_1to0_ring_exit":
        return "Last mushroom used (ring exit)"
    if t.startswith("mushroom_use"):
        return None  # the count event right after it tells the story
    if t == "lapTime":
        return f"Lap {e.get('lap', '?')} — {e.get('text', '?')}"
    if t == "delta":
        side = "AHEAD of" if e.get("side") == "ahead" else "BEHIND"
        gap = f"{e['text']} " if e.get("text") else ""
        return f"Lap {e.get('lap', '?')} — {gap}{side} the ghost"
    if t == "pause":
        return "Paused"
    if t == "resume":
        return f"Resumed after {e.get('heldMs', 0) / 1000:.0f}s"
    if t == "finish":
        return "FINISH — result screen"
    if t == "banner_won":
        return "Ghost BEATEN"
    if t == "banner_lost":
        return "Lost vs ghost"
    if t == "banner_new_record":
        return "NEW RECORD"
    return t


def _row(e: dict, mate: dict | None = None) -> tuple[str, dict] | None:
    """(kind, data) for one event — what the client switches on. `mate` is the
    delta belonging to a lapTime, merged into ONE row: "lap N took X and put
    you Y ahead" is one fact, and splitting it produced two rows that looked
    identical to the "you are now on lap N" row above them."""
    t = e["type"]
    if t == "lap":
        return "lapNow", {"lap": e.get("lap")}
    if t == "lapTime":
        d = {"lap": e.get("lap"), "time": e.get("text")}
        if mate:
            d.update(deltaMs=mate.get("ms"), delta=mate.get("text"),
                     side=mate.get("side"))
        return "lapReport", d
    if t == "delta":       # a gap with no lap time of its own
        return "lapDelta", {"lap": e.get("lap"), "delta": e.get("text"),
                            "deltaMs": e.get("ms"), "side": e.get("side")}
    if t == "pause":
        return "pause", {}
    if t == "resume":
        return "resume", {"heldMs": e.get("heldMs")}
    return None            # everything else keeps the prose path


class Narrator:
    """Turns pipeline state changes into a human-readable live ticker."""

    def __init__(self):
        self.items = deque(maxlen=LIVE_TICKER_ITEMS)
        self._history = deque(maxlen=LIVE_HISTORY_ITEMS)
        self._state = "MENU"
        self._ctx = {}
        self._announced = {}   # survives cup-screen context resets: a value
        self._ev_seen = {}     # re-detected after a reset is NOT news
        self._reading_for = None  # run we've already announced "reading result" for
        self._race = None         # last read of the in-race clock, for stamping
        self._race_ms = -1        # ...as ms, so a backwards read can be rejected
        self._lap_sum = 0         # cumulative HUD lap time, exact race clock
        self._lap_run = None      # which run that sum belongs to

    def note(self, ms: int, msg: str, kind: str | None = None,
             data: dict | None = None, race: str | None = None):
        """`t` is session wall-time. `race` is the game's own clock, which is
        what a driver recognises: the ticker used to stamp rows with elapsed
        SESSION time, so a lap read at 12:40 into the session showed "12:40"
        for a race 28 seconds old. Pauses widen that gap without bound."""
        it = {"t": ms, "msg": msg}
        if kind:
            it["kind"] = kind
            it["data"] = data or {}
        if race:
            it["race"] = race
        else:
            # Outside a race there IS no race clock, and elapsed SESSION time
            # is meaningless to a driver — "128:33" next to "1:19" reads as two
            # numbers on one scale when they are two different clocks. The time
            # of day cannot be confused with a lap time.
            it["wall"] = datetime.now().strftime("%H:%M")
        self.items.appendleft(it)
        self._history.append(it)

    def attach_run_log(self, run: dict) -> None:
        """Persist the browser-style live feed around this run for debugging."""
        start = int(run.get("armedAtMs") or 0) - RUN_LOG_BEFORE_ARM_MS
        end = int(run.get("endMs") or run.get("goAtMs") or 0) + RUN_LOG_AFTER_END_MS
        entries = [dict(x) for x in self._history if start <= int(x.get("t") or 0) <= end]
        entries.sort(key=lambda x: int(x.get("t") or 0))
        if entries:
            run["liveLog"] = entries

    def step(self, proc: RunProcessor, ms: int, clock: str | None = None):
        # A race clock only ever goes FORWARD. Rejecting a backwards read is
        # what keeps the frozen lap time out of the stamps: during a report the
        # clock stops on that lap's time, the tint PULSES, and on the white
        # phase the freeze test says "not a lap time" — so a coin picked up at
        # 0:57 was stamped 0:29, the lap-2 time. The engine survives this
        # because it medians a whole segment afterwards; the ticker stamps live
        # and has no second chance.
        if clock and proc.state == "RACING":
            from livetrial.results import time_to_ms
            v = time_to_ms(clock)
            rel = ms - int((proc.an.run or {}).get("goAtMs") or ms)
            # A decoded clock must be plausible for THIS run. A single digit
            # misread can turn 0:49 into 8:49; monotonicity alone accepted that
            # and every following ticker row looked hours ahead of a two-minute
            # race. Pauses only make wall time larger than race time, so a clock
            # that is several seconds ahead of elapsed wall time is not evidence.
            if v is not None and v >= self._race_ms and v <= rel + 3000:
                self._race, self._race_ms = clock, v
        st = proc.state
        if st != self._state:
            if st == "ARMED":
                cur = proc.an.run or {}
                if cur.get("kind") == "replay":
                    g = cur.get("replayOf") or {}
                    self.note(ms, f"Replay of {g.get('name') or 'a ghost'} {g.get('total') or ''}"
                                  f" — loop {cur.get('replayLoop', 1)}".replace("  ", " "))
                else:
                    self.note(ms, "Countdown — race starting")
            self._state = st
        # the ghost menu: which ghost the panel shows (collapsed or expanded)
        glog = getattr(proc, "ghost_log", None) or []
        for e in glog[getattr(self, "_ghost_seen", 0):]:
            if e.get("type") == "ghost_panel":
                self.note(ms, f"Ghost panel: {e.get('name') or '?'} {e.get('total') or ''}"
                              f" ({e.get('state')})")
            elif e.get("type") == "start_replay_prompt":
                self.note(ms, f"Start Replay? — {e.get('ghost') or 'ghost'}")
        self._ghost_seen = len(glog)
        ctx = proc.an.ctx
        tn = ctx.get("trackName") or {}
        now = {"cc": ctx.get("cc"), "mode": ctx.get("mode"),
               "track": tn.get("trackId") or tn.get("raw")}
        # a track is only NEWS at confirm-level confidence: transient reads
        # during screen fades can fuzzy-match the wrong track for a second
        # before the quality race corrects them — don't announce those
        track_sure = float(tn.get("ratio") or 0.0) >= 0.90
        for key, label in (("track", "Track"), ("cc", "CC class"), ("mode", "Mode")):
            if key == "track" and not track_sure:
                continue
            # Only surface CC on the solo/ghost SETUP screen -- i.e. once the mode
            # (solo/ghost) row is detected. The cup/track picker, the vehicle-
            # select (kart/tire/glider) screen and menu transitions all have no
            # mode, so gating on it keeps a stray "CC class detected" (incl. a
            # transient badge mis-read as the other class) off those screens; the
            # solo/ghost screen reads cc+mode together, so it still shows there.
            if key == "cc" and not now.get("mode"):
                continue
            if now[key] and now[key] != self._announced.get(key):
                self.note(ms, f"{label} detected: {now[key]}")
                self._announced[key] = now[key]
        if self._ctx.get("track") and not any(now.values()):
            self.note(ms, "Cup screen — context reset")
        self._ctx = now
        # The finish event closes its run in the SAME frame it's appended, so the
        # per-frame event scan below never gets to narrate it. Emit the result-
        # screen "keep the results screen up, reading" guidance here instead —
        # keyed on the pending (result-reading) phase, which stays active for the
        # whole read — once per run. The client renders this as the WAIT line.
        pend = getattr(proc, "pending", None)
        if pend is not None:
            rn = (pend.get("run") or {}).get("run")
            if rn is not None and self._reading_for != rn:
                self._reading_for = rn
                self.note(ms, "FINISH — result screen")
        elif self._reading_for is not None:
            self._reading_for = None
        run = proc.an.run
        if run is None:
            # between runs there is no race clock — carrying the last one over
            # stamped the next run's "GO!" with the previous run's finish time
            self._race, self._race_ms = None, -1
        if run is not None:
            if self._lap_run != run["run"]:
                self._lap_run, self._lap_sum = run["run"], 0
                self._race, self._race_ms = None, -1
            seen = self._ev_seen.get(run["run"], 0)
            fresh = run["events"][seen:]
            skip = set()
            for i, e in enumerate(fresh):
                if i in skip:
                    continue
                # The engine appends a lapTime and its delta in the SAME frame,
                # so the partner is in this batch or nowhere (a solo run has no
                # delta at all — that is the game, not a miss).
                mate = None
                if e["type"] == "lapTime":
                    for j in range(i + 1, len(fresh)):
                        if fresh[j]["type"] == "delta" and fresh[j].get("lap") == e.get("lap"):
                            mate, _ = fresh[j], skip.add(j)
                            break
                msg = _describe(e)
                if not msg:
                    continue
                if mate:
                    msg += f" ({_describe(mate)})"
                # A lap report's race clock is not a sample — it is the sum of
                # the lap times the HUD showed, which is what the result card
                # will say. Everything else gets the last clock read.
                stamp = self._race
                if e["type"] == "lapTime" and e.get("text"):
                    from livetrial.results import time_to_ms
                    v = time_to_ms(e["text"])
                    if v:
                        self._lap_sum += v
                        stamp = _ms_clock(self._lap_sum)
                kind = _row(e, mate)
                self.note(ms, msg, kind[0] if kind else None,
                          kind[1] if kind else None, stamp)
            self._ev_seen[run["run"]] = len(run["events"])

    def run_closed(self, run: dict, ms: int):
        if run.get("kind") == "replay":
            # the ghost's run, never the player's: no "aborted", no times
            how = {"replay_loop": "played to the end" if run.get("replayCompleted") else "restarted",
                   "replay_quit": "quit", "replay_to_race": "race against the ghost chosen"}
            g = run.get("replayOf") or {}
            self.note(ms, f"Replay of {g.get('name') or 'the ghost'} (loop {run.get('replayLoop', 1)}) — "
                          f"{how.get(run.get('abortReason'), run.get('abortReason') or 'ended')}")
            return
        if run.get("aborted"):
            if run.get("abortReason") == "result_skipped":
                self.note(ms, f"Run {run['run']} finished — result screen skipped, no times read")
            else:
                self.note(ms, f"Run {run['run']} ABORTED ({run.get('abortReason', '?')})")
        else:
            p = (run.get("results") or {}).get("player") or {}
            total = p.get("totalMs")
            tt = f" — total {total // 60000}:{(total % 60000) / 1000:06.3f}" if total else ""
            self.note(ms, f"Run {run['run']} finished{tt}")

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = REPO_ROOT / "MK8DX Clean Assets"


def list_devices(fmt: str = "dshow") -> None:
    # Device listing is capture-backend-specific. ffmpeg supports a common
    # -list_devices switch for dshow and avfoundation; v4l2 users normally use
    # `v4l2-ctl --list-devices` because ffmpeg expects a concrete /dev/videoN.
    if fmt == "v4l2":
        print("Linux/v4l2: list devices with `v4l2-ctl --list-devices` or `ls /dev/video*`.")
        return
    probe = "dummy" if fmt == "dshow" else ""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-list_devices", "true", "-f", fmt, "-i", probe],
        capture_output=True, text=True)
    print(proc.stderr)


def _capture_input(fmt: str, name: str) -> str:
    if fmt == "dshow":
        return f"video={name}"
    return name


def ffmpeg_stream(fmt: str, name: str, size: str, fps: int, holder: dict | None = None,
                  dshow_vcodec: str | None = None):
    """Yield BGR frames from an ffmpeg capture input; small queue drops
    frames when processing falls behind (live rule: newest frame wins).
    `holder` always receives the newest raw frame so the preview stream stays
    smooth even when the analysis pipeline stalls (menu OCR, result reads)."""
    w, h = (int(v) for v in size.lower().split("x"))
    # -rtbufsize is meaningful for DirectShow. It is a LATENCY vs drop trade:
    # the default (~3 MB) overflows on a CPU spike (menu OCR, result read,
    # encoder) -> "buffer too full, frame dropped" -> capture can die; but a
    # huge buffer lets a backlog build and then delivers OLD frames at 30 fps.
    # 32 MB absorbs a brief stall without letting latency balloon.
    # `warning`, not `error`: dshow reports "real-time buffer too full, frame
    # dropped" at warning level, and those are frames the analyzer never gets a
    # chance to see. At `error` they were invisible — a corpus regression
    # running in the background halved the delivered rate (60 -> 29.5 fps) and
    # nothing in the app could tell. stderr MUST be drained now that it can
    # actually produce output, or ffmpeg blocks writing to a full pipe.
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-f", fmt]
    if fmt == "dshow":
        cmd += ["-rtbufsize", "32M"]
        if dshow_vcodec:
            cmd += ["-vcodec", dshow_vcodec]
    cmd += ["-thread_queue_size", "256", "-video_size", size,
            "-framerate", str(fps), "-i", _capture_input(fmt, name),
            "-pix_fmt", "bgr24", "-f", "rawvideo", "-"]
    stop = threading.Event()
    nbytes = w * h * 3

    def spawn():
        """Start ffmpeg + a reader thread; return (proc, queue, reader-stop)."""
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        q: queue.Queue = queue.Queue(maxsize=2)
        rstop = threading.Event()

        def reader():
            while not rstop.is_set():
                buf = proc.stdout.read(nbytes)
                if len(buf) < nbytes:
                    break
                frame = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)
                if holder is not None:
                    holder["raw"] = frame
                try:
                    q.put_nowait((frame, int(time.time() * 1000)))
                except queue.Full:
                    try:
                        q.get_nowait()  # drop oldest
                        q.put_nowait((frame, int(time.time() * 1000)))
                        # THE drop that costs accuracy: a frame the analyzer
                        # never saw. The recorder's queue and the media thread's
                        # rate only shorten the CLIP; this one loses evidence —
                        # a coin, a lap crossing, a frame of a freeze window.
                        # Counted because "are we keeping up" was, until now,
                        # answerable only by inference.
                        if holder is not None:
                            holder["dropped"] = holder.get("dropped", 0) + 1
                    except queue.Empty:
                        pass
            rstop.set()

        def errdrain():
            """Drain ffmpeg's stderr and count the frames IT dropped.

            Two jobs, and the first is not optional: an undrained stderr pipe
            fills and blocks the process writing to it. The second is the point
            — these are frames lost before our queue ever sees them, which is
            the only kind of loss that was previously unmeasurable.
            """
            for raw_line in iter(proc.stderr.readline, b""):
                line = raw_line.decode("utf-8", "replace")
                if "too full" in line or "frame dropped" in line:
                    if holder is not None:
                        holder["capDropped"] = holder.get("capDropped", 0) + 1
                elif line.strip():
                    holder is not None and holder.setdefault("ffmpegLog", []).append(
                        line.strip()[:160])
                    if holder is not None and len(holder["ffmpegLog"]) > 20:
                        holder["ffmpegLog"] = holder["ffmpegLog"][-20:]

        threading.Thread(target=reader, daemon=True).start()
        threading.Thread(target=errdrain, daemon=True).start()
        return proc, q, rstop

    # Auto-reconnect: a live capture card can glitch mid-session (USB hiccup,
    # HDMI resolution change, the Switch sleeping) -> ffmpeg exits with a dshow
    # "I/O error". Rather than kill the whole watch, respawn ffmpeg and keep
    # going; a truly-gone device (unplugged) fails repeatedly and we give up.
    fails = 0
    proc = None
    try:
        while not stop.is_set():
            proc, q, rstop = spawn()
            got_any = False
            while not stop.is_set():
                try:
                    frame, frame_at_ms = q.get(timeout=2.0)
                    if holder is not None:
                        holder["qa_frame_at_ms"] = frame_at_ms
                    yield frame
                    got_any = True
                except queue.Empty:
                    if proc.poll() is not None:
                        break  # ffmpeg died -> leave inner loop and reconnect
            rstop.set()
            try:
                proc.terminate()
            except Exception:
                pass
            if stop.is_set():
                break
            # errdrain() has already consumed stderr, so reading it here returns
            # nothing — which is why every reconnect logged "()" and told us
            # nothing about WHY the capture died. Use what the drain kept.
            err = " | ".join((holder or {}).get("ffmpegLog") or [])[-300:]
            fails = 0 if got_any else fails + 1  # reset once a session delivered frames
            if fails > 15:
                raise RuntimeError(f"ffmpeg capture keeps dying, giving up: {err}")
            print(f"capture dropped, reconnecting in 1s... ({err[:120]})", flush=True)
            time.sleep(1.0)
    finally:
        stop.set()
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


def video_stream(path: str, speed: float = 1.0, holder: dict | None = None):
    """Play a recorded video through the live pipeline in real time (demo /
    test mode): frames are paced to the file's native fps so the dashboard
    behaves exactly as with a capture card."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise SystemExit(f"cannot open video: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    t0 = time.monotonic()
    fno = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        wait = t0 + fno / fps / speed - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        if holder is not None:
            holder["raw"] = frame
            # SOURCE time, not wall time: at --speed != 1 the wall clock runs
            # faster than the footage, so every event timestamp would be
            # compressed while the result screen still reports real race times.
            # Splits are binned against those real times, so a mushroom used on
            # lap 3 landed in lap 1. Feeding the source timebase keeps the run's
            # timeline and the card in the same units at any speed (and it is
            # identical to wall time at speed 1.0).
            holder["src_ms"] = int(fno / fps * 1000)
        yield frame
        fno += 1


class Recorder:
    """Clip recorder -> H.264 via ffmpeg, at the capture card's FULL resolution
    (the analysis pipeline downscales to 720p separately; clips are the
    shareable artifact and stay crisp). All encoder input goes through ONE
    dedicated writer thread draining a bounded queue, so the blocking
    stdin.write never runs on the media thread — a slow/back-pressured encoder
    can no longer freeze the live preview (notably at race-start when the
    pre-roll is flushed). On queue overflow we drop the newest frame; clips
    tolerate drops, the preview must never stall.

    Crash-safety: ffmpeg writes an MKV (Matroska), which is written
    incrementally and stays playable even if the process is killed mid-clip
    (an interrupted MP4 is corrupt — its moov atom is only written on clean
    close, which is what left a truncated clip unreadable). On a clean stop the
    MKV is losslessly remuxed to MP4 (-c copy, sub-second, +faststart for
    in-browser seeking) so the dashboard <video> keeps working; the MKV is then
    removed. A crashed run's orphan MKV is recovered on the next startup."""

    def __init__(self):
        self.proc = None
        self.path: Path | None = None      # final .mp4 (what callers/dashboard see)
        self._raw: Path | None = None      # live-written .mkv (crash-safe)
        self.size: tuple | None = None
        self.lock = threading.Lock()
        self._q: queue.Queue | None = None
        self._writer: threading.Thread | None = None
        self.written = 0        # frames handed to the encoder...
        self.dropped = 0        # ...and frames the queue refused
        # Where the pipeline clock sits in the clip (ADR-0213): [video frame,
        # session ms] about once a second and at every jump (a pause cut, a
        # drop). The pre-roll and a cut pause make a clip's time irregular, so
        # a clip's timestamps are only right through these anchors.
        self.frame_index = 0
        self.timeline: list = []

    @staticmethod
    def _remux(raw: "Path | None", dst: Path) -> Path:
        """Losslessly remux the crash-safe MKV to the final MP4. Returns the
        MP4 on success (MKV deleted); on failure keeps and returns the still
        playable MKV so a clip is never lost to a remux hiccup."""
        if raw is None or not raw.exists():
            return dst if dst.exists() else raw
        # Write under a temporary name and rename when complete: the
        # dashboard lists clip_*.mp4 from disk, and a 500 MB remux takes
        # seconds, so a card drawn in that window pointed a <video> at a
        # half-written file that never played (owner report 2026-09-07).
        part = dst.with_name(dst.name + ".part")
        try:
            subprocess.run(
                ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw),
                 "-c", "copy", "-movflags", "+faststart", "-f", "mp4", str(part)],
                check=True, timeout=60)
            os.replace(part, dst)
            raw.unlink(missing_ok=True)
            return dst
        except Exception:
            try:
                part.unlink(missing_ok=True)
            except OSError:
                pass
            return raw

    @classmethod
    def recover_orphans(cls, runs_dir: Path) -> int:
        """Remux any leftover clip_*.mkv (a run whose watch was killed before the
        clean-stop remux) to its .mp4 sibling, so a crashed session's clip still
        reaches the dashboard. Runs once at startup."""
        n = 0
        for mkv in runs_dir.glob("*/clip_*.mkv"):
            mp4 = mkv.with_suffix(".mp4")
            if not mp4.exists() and cls._remux(mkv, mp4) == mp4:
                n += 1
        return n

    @property
    def active(self) -> bool:
        return self.proc is not None

    def start(self, path: Path, size: tuple, preroll: list | None = None) -> None:
        """Start a clip at `size`=(w,h). `preroll` = recent frames as JPEG bytes
        (~15fps) flushed first so the clip includes the moments BEFORE the
        trigger (track choice, cc badge). Preroll + live frames all flow through
        the one writer thread, preroll first, so ordering is preserved."""
        with self.lock:
            if self.proc:
                return
            path.parent.mkdir(parents=True, exist_ok=True)
            # write an MKV (crash-safe: playable even if killed mid-clip); the
            # caller-supplied .mp4 is produced by a lossless remux on stop().
            self.path, self.size = path, size
            self._raw = path.with_suffix(".mkv")
            w, h = size
            self.proc = subprocess.Popen(
                ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", "30",
                 # CRF 18 (near-transparent): CRF 23 smeared the fine icon detail
                 # enough that solo-card identity re-analysis flipped (Toad ->
                 # Wiggler). Times survive heavy compression; icon-NCC does not.
                 "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                 "-threads", "2",  # cap encoder CPU: it must never starve the pipeline
                 "-pix_fmt", "yuv420p", str(self._raw)],
                stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
            self.written = self.dropped = 0      # per clip, not per session
            # the writer puts every pre-roll JPEG in twice (15 -> 30 fps)
            self.frame_index = 2 * len(preroll or [])
            self.timeline = []
            self._q = queue.Queue(maxsize=120)  # ~4s at 30fps
            proc, q = self.proc, self._q

            def writer():
                if preroll:
                    for jpg in preroll:
                        f = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
                        if f is None:
                            continue
                        if f.shape[1] != w or f.shape[0] != h:
                            f = cv2.resize(f, (w, h), interpolation=cv2.INTER_AREA)
                        b = f.tobytes()
                        try:  # sampled ~15fps -> write twice for 30fps timing
                            proc.stdin.write(b); proc.stdin.write(b)
                        except OSError:
                            return
                while True:
                    item = q.get()
                    if item is None:  # stop sentinel: drain done
                        break
                    try:
                        proc.stdin.write(item)
                    except OSError:
                        break

            self._writer = threading.Thread(target=writer, daemon=True)
            self._writer.start()

    def write_jpegs(self, jpegs) -> None:
        """Enqueue JPEG-buffered frames (the pause tail). Same decode/resize as
        the pre-roll path, and it goes through the same queue, so ordering with
        the live frames is preserved."""
        if self._q is None or not self.size:
            return
        w, h = self.size
        for jpg in jpegs:
            f = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
            if f is None:
                continue
            if f.shape[1] != w or f.shape[0] != h:
                f = cv2.resize(f, (w, h), interpolation=cv2.INTER_AREA)
            try:
                self._q.put_nowait(f.tobytes())
                self.frame_index += 1
            except queue.Full:
                return

    def write(self, frame: np.ndarray, at_ms: int | None = None) -> None:
        """Enqueue one frame at the clip's size. Copies to independent bytes
        here (the source buffer is reused by the capture reader) — cheap; the
        blocking encoder write happens on the writer thread. Anything that does
        not match the clip size is scaled: the recording resolution can be
        CAPPED below the capture card's (storage.Settings.recordHeight), and a
        4K card would otherwise write ~62 GB/hour."""
        q = self._q
        if q is None:
            return
        if self.size and (frame.shape[1], frame.shape[0]) != self.size:
            frame = cv2.resize(frame, self.size, interpolation=cv2.INTER_AREA)
        try:
            q.put_nowait(frame.tobytes())
            self.written += 1
            if at_ms is not None:
                last = self.timeline[-1] if self.timeline else None
                expected = None if last is None else last[1] + (self.frame_index - last[0]) * 1000 / 30
                if last is None or self.frame_index - last[0] >= 30 or abs(at_ms - expected) > 150:
                    self.timeline.append([self.frame_index, int(at_ms)])
            self.frame_index += 1
        except queue.Full:
            # Dropping here does not just lose a frame, it SHORTENS the clip:
            # ffmpeg is told -r 30 and counts what it receives, so a drop moves
            # every later frame earlier. Counted so the cost is visible instead
            # of showing up later as a clip whose timing drifts against the
            # game clock.
            self.dropped += 1

    def stop(self) -> Path | None:
        with self.lock:
            if not self.proc:
                return None
            path, raw, proc, q, writer = self.path, self._raw, self.proc, self._q, self._writer
            self.proc = self._q = self._writer = self._raw = None
            timeline = {"schemaVersion": "mk8dx.livetrial-clip-timeline.v1", "fps": 30,
                        "frames": self.frame_index, "anchors": list(self.timeline)}
        # Beside the clip: clip_HHMMSS_runNN.timeline.json. Losing it only loses
        # clickable moments in an upload description, never the clip.
        try:
            target = path.with_name(path.stem + ".timeline.json")
            part = target.with_name(target.name + ".part")
            part.write_text(json.dumps(timeline, separators=(",", ":")), encoding="utf-8")
            os.replace(part, target)
        except Exception:
            pass
        try:
            q.put_nowait(None)  # sentinel: writer finishes the queue then returns
        except Exception:
            pass
        if writer:
            writer.join(timeout=10)
        try:
            proc.stdin.close()
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        return self._remux(raw, path)  # MKV -> MP4 (lossless), MKV removed


_CROP_BOX: dict = {}  # frame-shape -> (y1,y2,x1,x2) crop, or None for "no crop"


def crop_active(bgr: np.ndarray) -> np.ndarray:
    """Crop the non-black active area (letterbox/pillarbox). The capture
    geometry is stable, so the crop box is computed ONCE per input shape and
    cached — this avoids running two full-frame np.where reductions on every
    frame in both the analysis and media threads (they used to each re-detect).
    Returns a VIEW; callers that keep the frame past the next capture must copy."""
    key = bgr.shape[:2]
    box = _CROP_BOX.get(key, "?")
    if box == "?":
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        m = gray > 16
        ys, xs = np.where(m.any(axis=1))[0], np.where(m.any(axis=0))[0]
        # only trust (and cache) a detection that covers a real image — a black
        # transition frame would otherwise cache a bogus box for the session
        if len(ys) > bgr.shape[0] * 0.5 and len(xs) > bgr.shape[1] * 0.5:
            y1, y2, x1, x2 = int(ys[0]), int(ys[-1] + 1), int(xs[0]), int(xs[-1] + 1)
            box = (y1, y2, x1, x2) if (y2 - y1 < bgr.shape[0] - 8 or x2 - x1 < bgr.shape[1] - 8) else None
            _CROP_BOX[key] = box
        else:
            box = None  # not confident this frame; retry next time (leave uncached)
    if box:
        return bgr[box[0]:box[1], box[2]:box[3]]
    return bgr


def normalize(bgr: np.ndarray) -> np.ndarray:
    """Analysis canvas: cropped active area resized to 1280x720 (all anchors
    assume that canvas). The clip recorder uses crop_active() directly to keep
    the capture card's full resolution."""
    if bgr.shape[:2] == (720, 1280):
        return bgr
    c = crop_active(bgr)
    if c.shape[:2] == (720, 1280):
        return c
    return cv2.resize(c, (1280, 720))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dshow-name")
    ap.add_argument("--dshow-size", default="1920x1080")
    ap.add_argument("--dshow-fps", type=int, default=30)
    ap.add_argument("--dshow-vcodec", choices=("mjpeg", "rawvideo"),
                    help="DirectShow input codec; choose mjpeg if the card's default mode has no HDMI image")
    ap.add_argument("--capture-format", default="dshow",
                    help="ffmpeg input format for live capture: dshow, v4l2, avfoundation, ...")
    ap.add_argument("--capture-input",
                    help="ffmpeg input name/path/index, e.g. /dev/video0 or 0; dshow uses --dshow-name by default")
    ap.add_argument("--capture-size",
                    help="capture resolution; defaults to --dshow-size")
    ap.add_argument("--capture-fps", type=int,
                    help="capture frame rate; defaults to --dshow-fps")
    ap.add_argument("--play-video", help="demo mode: play a recorded video through the live pipeline in real time")
    ap.add_argument("--speed", type=float, default=1.0, help="playback speed for --play-video (e.g. 2.0)")
    ap.add_argument("--list-devices", action="store_true")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--runs-dir", default=str(Path(__file__).resolve().parent / "runs"))
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--lan", action="store_true", help="dashboard also reachable on the local network")
    ap.add_argument("--no-easyocr", action="store_true")
    ap.add_argument("--console-language", default="auto",
                    help="the Switch's system language (en, fr, de, es, it, nl, pt, ru, ja, zh-tw, zh-cn, ko), "
                         "or auto: detect it at the start of the session")
    ap.add_argument("--paired-qa-root", help="private output root for opt-in paired phone/card QA")
    ap.add_argument("--paired-qa-serial", help="authorized ADB phone serial for paired QA")
    ap.add_argument("--paired-qa-adb", default="adb", help="ADB executable for paired QA")
    ap.add_argument("--paired-qa-webcam", help="DirectShow webcam name for paired QA instead of a phone")
    ap.add_argument("--paired-qa-webcam-size", default="1280x720")
    ap.add_argument("--paired-qa-webcam-fps", type=int, default=15)
    ap.add_argument("--paired-qa-webcam-vcodec", choices=("mjpeg", "rawvideo"),
                    help="DirectShow webcam input codec; the C925e supports mjpeg at 1280x720/15")
    args = ap.parse_args()

    if args.list_devices:
        list_devices(args.capture_format)
        return
    capture_name = args.capture_input or args.dshow_name
    capture_size = args.capture_size or args.dshow_size
    capture_fps = args.capture_fps or args.dshow_fps
    if not capture_name and not args.play_video:
        sys.exit("--dshow-name or --capture-input is required (or --play-video / --list-devices)")
    if (bool(args.paired_qa_root) != bool(args.paired_qa_serial or args.paired_qa_webcam)
            or bool(args.paired_qa_serial) and bool(args.paired_qa_webcam)
            or args.play_video and args.paired_qa_root):
        sys.exit("paired QA needs a private root and exactly one phone or webcam, with live capture")
    if args.paired_qa_root:
        qa_root = Path(args.paired_qa_root).resolve()
        runs_root = Path(args.runs_dir).resolve()
        if qa_root == runs_root or runs_root in qa_root.parents:
            sys.exit("paired QA evidence must be outside the LiveTrial runs directory")
    source_name = args.play_video and Path(args.play_video).name or capture_name

    session = datetime.now().strftime("live_%Y%m%d_%H%M%S")
    out = Path(args.runs_dir) / session
    paired_qa = None
    if args.paired_qa_root:
        if args.paired_qa_webcam:
            from livetrial.webcamqa import WebcamQaCapture
            paired_qa = WebcamQaCapture(Path(args.paired_qa_root), session,
                                        args.paired_qa_webcam,
                                        size=args.paired_qa_webcam_size,
                                        fps=args.paired_qa_webcam_fps,
                                        vcodec=args.paired_qa_webcam_vcodec)
        else:
            from livetrial.pairedqa import PairedQaCapture
            paired_qa = PairedQaCapture(Path(args.paired_qa_root), session,
                                        args.paired_qa_serial, adb=args.paired_qa_adb)
    out.mkdir(parents=True, exist_ok=True)

    # recover any clip left as an unremuxed .mkv by a previously crashed watch
    recovered = Recorder.recover_orphans(Path(args.runs_dir))
    if recovered:
        print(f"recovered {recovered} orphan clip(s) from a prior crash")

    store = RunStore(Path(args.runs_dir))
    store.live = True
    start_background(store, args.port, lan=args.lan)

    t0 = time.monotonic()
    narrator = Narrator()
    # newest raw frame (media thread) + the source timestamp when replaying a file
    holder: dict = {}

    live_source = Path(f"live:{source_name}").name  # matches RunStore.snapshot()'s disk-derived source

    def now_ms():
        """Pipeline clock: wall time live, source time for recorded playback
        (so --speed != 1 can't compress the run timeline, see video_stream)."""
        src = holder.get("src_ms")
        return int((time.monotonic() - t0) * 1000) if src is None else src

    def persist(run):
        # rewrite the session report so completed runs survive a restart
        ms = now_ms()
        # stamp each run once with a stable wall-clock at close: the report
        # mtime is shared by every run in a session (the whole file is
        # rewritten each time), so sorting/displaying by it collapsed all of a
        # session's runs to one time. closedAt (epoch, for correct ordering) +
        # closedAtStr (yyyy-mm-dd HH:MM, human) are per-run and immutable.
        if run and not run.get("closedAt"):
            now = datetime.now()
            run["closedAt"] = now.timestamp()
            run["closedAtStr"] = now.strftime("%Y-%m-%d %H:%M")
        if run:
            narrator.run_closed(run, ms)
            narrator.attach_run_log(run)
        write_reports(out, f"live:{source_name}", 0.0, ms, proc.runs, ghost_log=proc.ghost_log)
        if run:
            # Surface the finished run as a history tile immediately, without
            # waiting for /api/runs to re-scan the just-written report from disk
            # (that re-read can lag seconds under live GIL load, so the tile used
            # to appear "only when the feed stops"). Stamp the same derived
            # fields snapshot() attaches to disk runs — source / sessionDir / key
            # — so the in-memory copy and the disk copy dedup to ONE tile by key
            # (equal capturedAt -> the fuller disk copy, added first, wins the
            # tie once its re-read lands; until then the live copy bridges).
            run["source"] = live_source
            run["sessionDir"] = out.name
            run["key"] = f"{live_source}|{run['run']}|{run.get('goAtMs')}"
            store.push_live_run(run)

    ghost_photo_count = 0
    lap_photo_count = 0
    replay_photo_count = 0
    event_raw = None  # frame currently being analysed, never the media thread's latest

    def enqueue_photo(case, scenario, ms, observed):
        if paired_qa is None or event_raw is None:
            return
        try:
            paired_qa.submit(case, scenario, ms, event_raw, observed,
                             capture_at_ms=holder.get("qa_frame_at_ms"))
        except Exception as exc:
            # QA device/storage errors cannot interrupt the ordinary reader.
            print(f"paired QA enqueue failed: {type(exc).__name__}")

    def paired_card(run, ms, player):
        enqueue_photo(f"result_run_{run['run']:02d}", "result", ms,
                      {"run": run["run"], "lapCount": run.get("lapCount"),
                       "totalMs": player.get("totalMs"),
                       "lapTimesMs": player.get("lapTimesMs"),
                       "lapSumOk": player.get("lapSumOk")})

    def paired_panel(panel, ms):
        nonlocal ghost_photo_count
        if paired_qa is not None:
            state = panel.get("state")
            if state not in ("collapsed", "expanded"):
                return
            ghost_photo_count += 1
            enqueue_photo(f"ghost_{ghost_photo_count:03d}_{state}", f"ghost_{state}",
                          ms, {"panelState": state, "totalMs": panel.get("totalMs"),
                               "lapSumOk": panel.get("lapSumOk"),
                               "trackId": panel.get("trackId"), "cc": panel.get("cc"),
                               "captureRecognition": panel})

    def paired_timing(scenario, event, ms):
        nonlocal lap_photo_count, replay_photo_count
        if paired_qa is None:
            return
        if scenario == "lap_report":
            lap_photo_count += 1
            case = f"lap_report_{lap_photo_count:03d}"
        elif scenario == "replay_finish":
            replay_photo_count += 1
            case = f"replay_finish_{replay_photo_count:03d}"
        else:
            return
        enqueue_photo(case, scenario, ms, event)

    proc = RunProcessor(Path(args.db), out, use_easyocr=not args.no_easyocr,
                        console_language=args.console_language,
                        on_run=persist, on_card=paired_card if paired_qa else None,
                        on_panel=paired_panel if paired_qa else None,
                        on_timing=paired_timing if paired_qa else None)
    if paired_qa is not None:
        paired_qa.start()  # no ordinary capture starts if the QA phone is absent
    # cap the OCR (torch) thread pool: on CPU, easyocr defaults to one intra-op
    # thread PER CORE (~24), which floods the scheduler during a menu OCR read
    # and stalls the per-frame analysis loop. 4 is plenty — OCR only runs in
    # menus / on the result screen, never during racing, so this costs no
    # accuracy but keeps the live feed smooth.
    try:
        import torch
        torch.set_num_threads(4)
    except Exception:
        pass
    # cap OpenCV's internal pool too: the main loop + media thread both hammer
    # cvtColor/resize/imencode at once, so an uncapped pool oversubscribes cores
    # and steals the headroom libx264 needs. (OMP/MKL caps are set at import.)
    cv2.setNumThreads(2)
    try:
        st0 = store.storage_status(max_age=0.0)
        print(f"clips on disk: {st0['totals']['clips']} "
              f"({st0['totals']['bytes'] / (1024 ** 3):.1f} GB), "
              f"{st0['disk']['freeBytes'] / (1024 ** 3):.0f} GB free")
        for w in st0.get("warnings", []):
            print(f"  [{w['level']}] {w['text']}")
        if store.settings.autoCleanup:
            r0 = store.cleanup()
            if r0.get("freedBytes"):
                print(f"  retention: removed {len(r0['removed'])} clip(s), "
                      f"{r0['freedBytes'] / (1024 ** 3):.1f} GB freed")
    except Exception as e:
        print(f"  (storage check skipped: {e})")
    print(f"capturing '{source_name}' — dashboard: http://127.0.0.1:{args.port}/")
    frames = 0
    clock_txt, clock_ms = None, 0
    race_txt = None      # clock excluding the frozen lap-report frames
    stream = (video_stream(args.play_video, args.speed, holder) if args.play_video
              else ffmpeg_stream(args.capture_format, capture_name, capture_size,
                                 capture_fps, holder, args.dshow_vcodec))

    # media thread: preview + clip recording straight off the newest captured
    # frame at a fixed 30fps clock — the MJPEG stream stays smooth and clips
    # keep wall-clock timing even while the pipeline is busy (menu OCR,
    # result-screen reads used to freeze the feed for hundreds of ms)
    stop_preview = threading.Event()
    rec = Recorder()
    store.record["dir"] = out.name

    # rolling pre-roll: last ~15s as JPEG (~15fps) so an auto-clip can start
    # BEFORE its trigger — the track pick and cc badge end up in the clip.
    # Entries are (pipeline ms, jpeg) so a ghost clip can start at its panel.
    preroll: deque = deque(maxlen=225)
    # what the media thread needs to know about a pause, published by the
    # analysis loop: the engine owns the detection, this is only a mirror
    pause_state: dict = {"since": None}
    media_rate: dict = {"fps": None}   # what the media thread really achieves

    def media_loop():
        last, full, tick = None, None, 0
        loop_t0, loop_n = time.monotonic(), 0
        # the tail kept from a long pause, JPEG so the ring costs ~4 MB and not
        # the ~90 MB the same 1.5 s of raw 1080p frames would
        pause_tail: deque = deque(maxlen=15)
        tail_clip = None
        while not stop_preview.is_set():
            t_next = time.monotonic() + 1 / 30
            raw = holder.get("raw")
            if raw is not None:
                if raw is not last:
                    full = crop_active(raw)  # capture's full-res active area
                    last = raw
                if full is not None:
                    # A pause is legal and the run continues, but the pause MENU
                    # sitting there for two minutes is not worth recording. Keep
                    # the head (you see it stop) and the tail (you see it start
                    # again) and drop the boring middle. The tail cannot be known
                    # in advance, so it is buffered and flushed on resume —
                    # and only into the clip it was buffered for, because a
                    # RESTART from that same menu ends the run and cuts the clip,
                    # and those frames belong to neither side of the cut.
                    since = pause_state.get("since")
                    holding = (rec.active and since is not None
                               and now_ms() - since > PAUSE_KEEP_MS)
                    if holding:
                        if tail_clip != rec.path:
                            pause_tail.clear()
                            tail_clip = rec.path
                        if tick % 3 == 0:   # ~10fps is plenty for a still menu
                            ok, jpg = cv2.imencode(".jpg", full,
                                                   [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                            if ok:
                                pause_tail.append(jpg.tobytes())
                        tick += 1
                        dt = t_next - time.monotonic()
                        if dt > 0:
                            time.sleep(dt)
                        continue
                    if pause_tail:
                        if rec.active and tail_clip == rec.path:
                            rec.write_jpegs(pause_tail)
                        pause_tail.clear()
                        tail_clip = None
                    rec.write(full, now_ms())  # full-res clip; drops fill dropped frames
                    tick += 1
                    # preview at the full 30fps media clock for a smooth live view;
                    # the 640x360 resize + small JPEG encode is cheap (~1-2ms), so it
                    # runs every frame (was gated to ~15fps only to save encode).
                    small = cv2.resize(full, (640, 360))
                    ok, jpg = cv2.imencode(".jpg", small, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
                    if ok:
                        store.set_preview(jpg.tobytes())
                    if tick % 2 == 0:  # ~15fps: pre-roll ring (15s @ maxlen 225)
                        # full-frame JPEG ONLY seeds the pre-roll ring, which is
                        # unused while recording -> skip that encode during a race
                        # (it was produced and discarded every ~66ms).
                        if not rec.active:
                            ok, jpg = cv2.imencode(".jpg", full, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                            if ok:
                                preroll.append((now_ms(), jpg.tobytes()))
            loop_n += 1
            el = time.monotonic() - loop_t0
            if el >= 5.0:
                # The loop writes ONE frame per iteration and tells ffmpeg 30
                # fps. If it cannot hold 30 iterations a second the clip is
                # short by the difference, with no drop reported anywhere.
                media_rate["fps"] = round(loop_n / el, 2)
                loop_t0, loop_n = time.monotonic(), 0
            dt = t_next - time.monotonic()
            if dt > 0:
                time.sleep(dt)

    threading.Thread(target=media_loop, daemon=True).start()
    rec_hold_until = 0
    low_disk_warned = False
    storage_at = 0
    rec_run = None      # run number the currently-recording clip belongs to

    def clip_size(frame):
        """Record at the capture card's full resolution (crop_active), not the
        720p analysis canvas, capped by the recordHeight setting."""
        rraw = holder.get("raw")
        rc = crop_active(rraw) if rraw is not None else frame
        rsize = (rc.shape[1], rc.shape[0])  # (w, h)
        cap = int(getattr(store.settings, "recordHeight", 0) or 0)
        if cap and rsize[1] > cap:      # never upscale, only cap
            rsize = (int(round(cap * rsize[0] / rsize[1])) // 2 * 2, cap)
        return rsize

    # Ghost replays become clips on their own rules (ghostmenu.GhostClipPlanner):
    # from the chosen ghost's panel to the end of its replay, once per ghost.
    ghost_clips = GhostClipPlanner(clipped_ghosts(Path(args.runs_dir)))
    # The newest read of the ghost panel as a full-resolution JPEG, taken when the
    # engine reads a ghost (or its details open): the ghost clip's picture, and its
    # opening when the panel was up longer than the pre-roll ring reaches back.
    panel_shot: dict = {"id": None, "ghost": None, "jpg": None}

    def note_panel_shot():
        gp = proc.an.ctx.get("ghostPanel")
        if gp is None or id(gp) == panel_shot["id"]:
            return
        panel_shot["id"] = id(gp)
        raw_now = holder.get("raw")
        if raw_now is None:
            return
        ok, jpg = cv2.imencode(".jpg", crop_active(raw_now), [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        if ok:
            panel_shot["ghost"], panel_shot["jpg"] = dict(gp), jpg.tobytes()

    def stop_clip(ms):
        done = rec.stop()
        store.record.update(active=False, file=None)
        # A finished clip is the natural moment to enforce the retention
        # budget: the inventory just changed and nothing is being written.
        if store.settings.autoCleanup:
            try:
                res = store.cleanup()
                if res.get("freedBytes"):
                    narrator.note(ms, f"Storage: {len(res['removed'])} old clip(s) removed, "
                                      f"{res['freedBytes'] / (1024 ** 3):.1f} GB freed")
                for w in res.get("warnings", []):
                    if w["level"] in ("warn", "alert"):
                        narrator.note(ms, "⚠ " + w["text"])
            except Exception:
                pass
        if done is None:
            return None
        store.record["clips"] = (store.record.get("clips") or [])[-11:] + [done.name]
        narrator.note(ms, f"Clip saved: {done.name}")
        # only auto run-clips carry the "_runNN" tag; announce those as a
        # fully-recorded run. Manual ad-hoc clips get "Clip saved" only, and an
        # ABORTED run (returned to menus, no result) does NOT get the "saved —
        # start next/retry" line — it had no times to save.
        if "_run" in done.name and proc.runs and not proc.runs[-1].get("aborted"):
            narrator.note(ms, f"Run {proc.runs[-1]['run']} recorded")
            narrator.attach_run_log(proc.runs[-1])
            write_reports(out, f"live:{source_name}", 0.0, now_ms(), proc.runs,
                          ghost_log=proc.ghost_log)
        return done

    def ghost_clip_step(ms, frame, manual, action=None):
        """Carry out the planner's decision: start, keep or discard a ghost clip."""
        if action is None:
            action = ghost_clips.step(
                ms, proc.an.replay_pending, proc.an.run, recording=rec.active,
                enabled=bool(getattr(store.settings, "recordVideo", True)) and not manual
                and not store.record.get("blocked"))
        if action is None:
            return
        kind, ghost = action[0], action[1]
        label = " ".join(v for v in (ghost.get("name"), ghost.get("total")) if v)
        if kind == "start":
            frames = [(t, jpg) for t, jpg in preroll if t >= action[2]]
            opening = [jpg for _, jpg in frames]
            since = (proc.an.replay_pending or {}).get("panelSinceMs")
            shot = panel_shot["jpg"] if same_ghost(panel_shot["ghost"], ghost) else None
            if shot and (not frames or (isinstance(since, int) and frames[0][0] > since + 500)):
                # the panel came up before the ring's oldest frame: open on its snapshot
                opening = [shot] * GHOST_CLIP_PANEL_HOLD_FRAMES + opening
            path = out / f"clip_{datetime.now():%H%M%S}.mp4"
            rec.start(path, clip_size(frame), preroll=opening)
            preroll.clear()
            store.record.update(active=True, file=rec.path.name, sinceMs=ms)
            # The card's picture: the chosen ghost's panel snapshot, or the ring
            # frame about 1.5 s after the panel came up (never after the prompt).
            still = shot
            if still is None and frames:
                want_at = min((since or frames[0][0]) + 1500, (proc.an.replay_pending or {}).get("ms", ms) - 300)
                _, still = min(frames, key=lambda item: abs(item[0] - want_at))
            if still is not None:
                try:
                    (out / (path.stem + ".panel.jpg")).write_bytes(still)
                except OSError:
                    pass
            narrator.note(ms, f"Recording the replay of {label or 'this ghost'}")
        elif kind == "keep":
            done = stop_clip(ms)
            if done is not None:
                proc.ghost_records.note_clip(ghost, done.name, (action[2] or {}).get("goAtMs"),
                                             ms, int(time.time() * 1000))
                narrator.note(ms, f"Ghost clip saved: {label}")
        elif kind == "discard":
            path = rec.path
            done = rec.stop()
            store.record.update(active=False, file=None)
            discard_clip(done or path)
            if action[2] != "cancelled":
                narrator.note(ms, f"Replay of {label or 'the ghost'} not watched to the finish: no ghost clip")

    ghosts_written = 0
    replays_written = 0
    try:
        for raw in stream:
            ms = now_ms()
            if getattr(store, "stop_requested", False):
                # The dashboard's Stop button: end the session the way
                # Ctrl+C does, through the same finally below.
                narrator.note(ms, "Stopped from the dashboard")
                print("capture stopped from the dashboard")
                break
            frame = normalize(raw)
            event_raw = raw
            proc.feed(frame, ms)
            frames += 1
            # Detected ghosts (ADR-0210) are written as soon as one appears or
            # grows, so the desktop app shows the row while the ghost menu is
            # still up — not only when a race closes.
            # a replay watched to the line: its ghost entry in the run history
            if proc.an.ghost_replays_version != replays_written:
                replays_written = proc.an.ghost_replays_version
                try:
                    write_ghost_replays(out, proc.an.ghost_replays)
                except OSError:
                    pass
            if proc.ghost_records.version != ghosts_written:
                ghosts_written = proc.ghost_records.version
                try:
                    write_ghosts(out, proc.ghost_records.document(f"live:{source_name}"))
                except OSError:
                    pass
            # mirror the engine's pause state for the media thread (clip) —
            # one detector, read in two places, never two detectors
            pause_state["since"] = getattr(proc.an, "pause_started_at", None)
            narrator.step(proc, ms, race_txt)
            # live race clock (italic 7-seg at the timer anchor) — display aid
            if proc.state == "RACING" and frames % 5 == 0:
                got = read_clock(frame)
                if got:
                    clock_txt, clock_ms = got, ms
                    # The clock FREEZES for ~3 s on each lap report — that is
                    # the whole trigger hudtimes reads. Sampling it then made
                    # the next ticker rows carry a LAP time as their race
                    # stamp ("now on lap 3" at 0:25.929, mid-race). Ask the
                    # reader itself rather than re-deriving the test here;
                    # `frame` is BGR at this point, the engine sees it as RGB.
                    if not hudtimes.clock_is_lap_time(frame, is_rgb=False):
                        race_txt = got
            if proc.state != "RACING" or ms - clock_ms > 3000:
                clock_txt = None
            # clip recording — fully automatic, no buttons needed: every run
            # becomes a clip from ~15s pre-roll (track pick + cc registration)
            # through the read result screen, +2.5s tail. The manual REC
            # button only adds ad-hoc recording outside runs.
            manual = bool(store.record.get("manual"))
            note_panel_shot()
            ghost_clip_step(ms, frame, manual)
            # recordVideo off = stills only. The end-screen JPEG is still written
            # for every run (runner._close_pending), so the evidence survives;
            # only the bulky clip is skipped. An explicit REC press still works.
            # A ghost replay is somebody else's run: never an automatic clip (it
            # would be tagged with the NEXT run's number and pass for the
            # player's). The manual REC button still records anything.
            replaying = (proc.an.run or {}).get("kind") == "replay"
            want = manual or (getattr(store.settings, "recordVideo", True) and not replaying
                              and (proc.state in ("ARMED", "RACING") or proc.pending is not None))
            # which run the footage now belongs to (None outside a run)
            cur_run = (len(proc.runs) + 1
                       if proc.state in ("ARMED", "RACING") else rec_run)
            if want:
                rec_hold_until = ms + 2500
                # A NEW run started while the previous clip was still rolling —
                # a restart (RACING -> ARMED with no gap at all) or a retry
                # inside the 2.5 s tail. Without this the second run was
                # recorded INTO the first run's file, still tagged with the
                # first run's number, and had no clip of its own. Cut here so
                # every run keeps its own clip.
                if rec.active and not manual and rec_run is not None \
                        and cur_run is not None and cur_run != rec_run:
                    stop_clip(ms)
                # Disk floor: refuse to START a clip when the storage policy
                # says the disk is too low. Recording is the only thing here
                # that can fill a disk, and a half-written clip on a full disk
                # takes the session down with it — better to lose the clip and
                # keep analysing. (An already-running clip finishes normally.)
                if not rec.active and store.record.get("blocked"):
                    if not low_disk_warned:
                        low_disk_warned = True
                        narrator.note(ms, "⚠ Recording paused — disk below the free-space floor")
                elif not rec.active:
                    tag = "" if manual else f"_run{len(proc.runs) + 1:02d}"
                    rec.start(out / f"clip_{datetime.now():%H%M%S}{tag}.mp4",
                              clip_size(frame), preroll=None if manual else [jpg for _, jpg in preroll])
                    preroll.clear()
                    rec_run = None if manual else cur_run
                    store.record.update(active=True, file=rec.path.name, sinceMs=ms)
            elif rec.active and ms > rec_hold_until and ghost_clips.active is None:
                stop_clip(ms)
                rec_run = None
            if ms - storage_at > 15000:
                storage_at = ms
                try:
                    store.storage_status(max_age=0.0)
                except Exception:
                    pass
            ctx = proc.an.ctx
            tn = ctx.get("trackName") or {}
            store.set_live_state({
                "state": proc.state, "frames": frames, "elapsedMs": ms,
                "runs": len(proc.runs),
                "clock": clock_txt,
                "reading": proc.pending is not None,
                "ctx": {"cc": ctx.get("cc"), "mode": ctx.get("mode"),
                        "track": tn.get("trackId") or tn.get("raw")},
                "current": ({k: proc.an.run.get(k) for k in ("run", "lapCount", "coins", "lap", "mushrooms",
                                                             "kind", "replayLoop")}
                            if proc.an.run else None),
                # the ghost the panel shows (or the replay on screen is of)
                "ghostPanel": ((proc.an.run or {}).get("replayOf") or ctx.get("ghostPanel")),
                # Opt-in QA needs the current visual state; ghostPanel above
                # intentionally retains the most complete record for history.
                "ghostPanelDisplay": (proc.an.panel_display if paired_qa else None),
                "ticker": list(narrator.items),
                # chosen, or detected once at the session start (consolelang.py)
                "consoleLanguage": proc.an.language.state(),
                "capture": {"mediaFps": media_rate["fps"],
                            "recWritten": rec.written, "recDropped": rec.dropped,
                            # frames the ANALYZER never saw — the only count
                            # here that can make a run wrong
                            "analysisSeen": frames,
                            "analysisDropped": holder.get("dropped", 0),
                            # dropped by ffmpeg BEFORE our queue — invisible
                            # until stderr was drained and counted
                            "captureDropped": holder.get("capDropped", 0)},
            })
    except KeyboardInterrupt:
        pass
    finally:
        stop_preview.set()
        # a ghost clip still open: kept if its replay already reached the line
        try:
            ghost_clip_step(now_ms(), None, False, ghost_clips.finish())
        except Exception:
            pass
        rec.stop()
        proc.finalize(now_ms())
        if paired_qa is not None:
            paired_qa.close()
        persist(None)
        try:   # a replay still open at the end has just been closed into its record
            write_ghosts(out, proc.ghost_records.document(f"live:{source_name}"))
            if proc.an.ghost_replays:
                write_ghost_replays(out, proc.an.ghost_replays)
        except OSError:
            pass
        print(f"session saved: {out}")
    if args.play_video:
        # demo playback finished: keep the dashboard up so results stay visible
        store.live = False
        print("video ended — dashboard blijft bereikbaar (Ctrl+C om te stoppen)")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
