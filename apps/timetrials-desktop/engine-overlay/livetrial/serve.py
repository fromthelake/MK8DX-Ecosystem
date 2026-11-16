"""LiveTrial dashboard server — stdlib only, read-only over run outputs.

Serves the dashboard and aggregates every `report.json` under --runs-dir into
one run list (newest first). In live mode (`watch.py`) the same server is fed
by the capture loop and the page auto-refreshes.

Usage:
    ..\\.venv\\Scripts\\python.exe livetrial\\serve.py [--runs-dir livetrial/runs] [--port 8777]

Reading is a GET. Changing something (recording, stop, retention settings,
clean-up, pins, categories, archive, calibration grids) is a POST that only
this computer's own page can make: the request must come from a loopback
address with a loopback Host and Origin, carry a JSON body within its size
bound, and carry the per-launch action proof in the X-LiveTrial-Action header.
The proof is placed only in pages served to this computer (or handed to the
desktop app through MK8DX_LIVETRIAL_ENGINE_ACTION), so with --lan a phone or
tablet can watch, but not control.
"""

from __future__ import annotations

import argparse
import hmac
import ipaddress
import json
import math
import os
import re
import secrets
import socket
import sys
import tempfile
import threading
import time
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from livetrial import engine, readable_clips, storage  # noqa: E402
from livetrial.ghostmenu import ghost_matches, replay_hud_lap_times  # noqa: E402
from livetrial.safe_paths import UnsafePathError, resolve_within  # noqa: E402

_FLAG_ICON = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>"
              "<text y='.9em' font-size='90'>\U0001F3C1</text></svg>").encode("utf-8")


def _product_icon() -> tuple[bytes, str]:
    import os
    override = os.environ.get("MK8DX_LIVETRIAL_PRODUCT_ICON")
    if override:
        try:
            icon = Path(override)
            if icon.suffix.lower() in {".png", ".ico"} and icon.is_file() and icon.stat().st_size <= 8 * 1024 * 1024:
                return icon.read_bytes(), "image/png" if icon.suffix.lower() == ".png" else "image/x-icon"
        except OSError:
            pass
    return _FLAG_ICON, "image/svg+xml"

DASH = HERE / "dashboard"
DEFAULT_ASSETS = HERE.parent / "MK8DX Clean Assets"


def _calibration_image(root: Path, filename: str, suffix: str) -> Path | None:
    """Serve only a named local calibration image, never a caller-chosen path."""
    if (not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", filename)
            or not filename.lower().endswith(suffix)):
        return None
    if not root.is_dir():
        return None
    base = root.resolve()
    for entry in root.iterdir():
        if entry.name == filename:
            target = entry.resolve()
            return target if target.parent == base and target.is_file() else None
    return None


def _internal_session_dir(name: str) -> bool:
    """Internal replay/corpus outputs must not pollute user-facing history."""
    return name == "latest" or name.startswith("_")


# Every 7-segment digit field the calibrator can place, GET and POST through
# the same two handlers. They were four copies of the same twelve lines, which
# is how the delta grid and the clock grid drifted apart in the first place.
DIGIT_GRIDS = {
    "/api/clockgrid": "clock_grid.json",
    "/api/deltagrid": "delta_grid.json",
    "/api/lapgrid": "lap_grid.json",
    "/api/coinsgrid": "coins_grid.json",
}
# Every calibration file a POST may replace, by route.
CALIBRATION_FILES = {**DIGIT_GRIDS, "/api/grid": "card_grid.json"}

# -- control boundary ----------------------------------------------------------
ACTION_HEADER = "X-LiveTrial-Action"
# The desktop app makes one proof per launch and hands it to the engine it starts.
ACTION_VARIABLE = "MK8DX_LIVETRIAL_ENGINE_ACTION"
_ACTION_SHAPE = re.compile(r"[A-Za-z0-9_-]{32,128}")
LOOPBACK_NAMES = frozenset({"127.0.0.1", "localhost", "::1"})
MAX_ACTION_BYTES = 16 * 1024            # record/stop/settings/pin/category/archive
MAX_CALIBRATION_BYTES = 256 * 1024      # one grid file (the largest today is ~5 KB)
BODY_READ_SECONDS = 10.0                # a body that trickles in longer is dropped
DRAIN_BYTES = 4 * MAX_CALIBRATION_BYTES  # a refused body read and discarded at most ...
DRAIN_SECONDS = 2.0                     # ... for at most this long, so the client gets the answer
WRITE_WAIT_SECONDS = 2.0                # one change at a time; a crowd gets 429
MAX_CONNECTIONS = 64                    # concurrent connections the engine serves
MAX_MARKED_KEYS = 20000                 # categories.json / archived.json entries
MAX_KEY_LENGTH = 512
# a clip as the storage inventory names it: "<session folder>/clip_HHMMSS[_runNN].mp4"
_RUN_FILE = re.compile(r"[^/\\\x00-\x1f.][^/\\\x00-\x1f]{0,127}/clip_\d{6}(?:_run\d+)?\.(?:mp4|mkv)")
_SWITCH_LANGUAGE = re.compile(r"(?:[a-z]{2}(?:-[A-Z]{2})?)?")
SETTING_LIMITS = {"maxTotalGb": (0.5, 100000.0), "minFreeGb": (0.0, 100000.0),
                  "keepLatest": (0, 100000), "recordHeight": (0, 4320)}
# Routes that used to change something on a plain GET; they now answer 405.
_FORMER_GET_ACTIONS = frozenset({"/api/pin", "/api/category", "/api/archive"})


def action_token(environment=None) -> str:
    """This launch's action proof: the desktop app's, else a fresh random one."""
    offered = (os.environ if environment is None else environment).get(ACTION_VARIABLE, "")
    return offered if isinstance(offered, str) and _ACTION_SHAPE.fullmatch(offered) else secrets.token_urlsafe(32)


def _host_name(header: str) -> str | None:
    """The name part of a Host header, lower-case, without brackets or port."""
    value = (header or "").strip().lower()
    if value.startswith("["):
        end = value.find("]")
        if end < 0:
            return None
        name, rest = value[1:end], value[end + 1:]
    else:
        name, colon, port = value.partition(":")
        rest = colon + port
    if not name or (rest and not re.fullmatch(r":\d{1,5}", rest)):
        return None
    return name


def _is_ip_literal(name: str) -> bool:
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        return False


def _is_loopback_address(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    mapped = getattr(ip, "ipv4_mapped", None)
    return (mapped or ip).is_loopback


class ActionRefused(ValueError):
    """A well-formed request whose content is not acceptable (answered 400/409)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _write_atomic(target: Path, text: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(f".{target.name}.{secrets.token_hex(4)}.partial")
    try:
        partial.write_text(text, encoding="utf-8")
        os.replace(partial, target)
    finally:
        try:
            partial.unlink()
        except OSError:
            pass


def show_in_folder(target: Path) -> None:
    """Open the file manager at `target` (Explorer selects the file), without waiting for it."""
    import subprocess
    if sys.platform == "win32":
        subprocess.Popen(["explorer.exe", f"/select,{target}"])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(target)])
    else:
        subprocess.Popen(["xdg-open", str(target.parent)])


def build_meta(root: Path) -> dict:
    """Compact catalog for the dashboard: names, icon paths and stats per
    part id, flags, track previews, item icons (incl. course currencies).
    Everything derives from database.json — the single asset baseline."""
    db = json.loads((root / "database.json").read_text(encoding="utf-8"))
    name = lambda rec: (rec.get("names") or {}).get("en-US") or next(iter((rec.get("names") or {"": "?"}).values()))
    parts: dict = {}
    chars = {}
    for c in db["collections"]["characters"]:
        chars[c["id"]] = c
        parts[c["id"]] = {"name": name(c), "icon": (c["assets"].get("menu") or {}).get("path"),
                          "stats": c.get("stats")}
    for v in db["relationships"]["characterVariants"]:
        base = parts.get(v["characterId"]) or {}
        parts[v["id"]] = {"name": name(v), "icon": (v["assets"].get("menu") or {}).get("path"),
                          "stats": base.get("stats")}
    for coll, vrel, vkey in (("vehicleBodies", "bodyVariants", "bodyId"),
                             ("vehicleGliders", "gliderVariants", "gliderId")):
        for b in db["collections"][coll]:
            parts[b["id"]] = {"name": name(b), "icon": (b["assets"].get("default") or {}).get("path"),
                              "stats": b.get("stats")}
        for bv in db["relationships"].get(vrel, []):
            base = parts.get(bv[vkey]) or {}
            slug = str(bv.get("variantSlug", "")).replace("_", " ")
            parts[bv["id"]] = {"name": f"{base.get('name', '?')} ({slug})",
                               "icon": (bv.get("asset") or {}).get("path"),
                               "stats": base.get("stats")}
    for t in db["collections"]["vehicleTires"]:
        parts[t["id"]] = {"name": name(t), "icon": (t["assets"].get("default") or {}).get("path"),
                          "stats": t.get("stats")}
    flags = {c["id"]: {"name": name(c), "icon": c["assets"]["mk8Flag"]["path"]}
             for c in db["collections"]["countries"] if (c.get("assets") or {}).get("mk8Flag")}
    # cup per track (icon + localized name) — lets the dashboard show the cup emblem
    cup_of: dict = {}
    for cup in db["collections"]["cups"]:
        info = {"name": name(cup), "nameNl": (cup.get("names") or {}).get("nl-NL"),
                "icon": ((cup.get("assets") or {}).get("icon") or {}).get("path")}
        for tid in cup.get("trackIds", []):
            cup_of[tid] = info
    tracks = {t["id"]: {"name": name(t), "nameNl": (t.get("names") or {}).get("nl-NL"),
                        "icon": (t.get("assets") or {}).get("preview", {}).get("path"),
                        "cup": cup_of.get(t["id"])}
              for t in db["collections"]["tracks"]}
    icons = {i["id"]: (i.get("assets") or {}).get("defaultIcon", {}).get("path")
             for i in db["collections"]["items"]}
    currency = {v["id"]: v["asset"]["path"] for v in db["relationships"]["itemIconVariants"]
                if v.get("variantRole") == "course_currency_replacement"}
    items = {
        "coin": icons.get("item.coin"),
        "mushroom": icons.get("item.mushroom"),
        "tripleMushrooms": icons.get("item.triple_mushrooms"),
        # Course-specific coin replacements (gameplay knowledge; the DB provides
        # the icons). The physical filenames/ids are historical and do NOT match
        # the real icon (001_shine.png is the Animal Crossing Bell, 003_bell.png is
        # the Yoshi coin) -- the DB metadata is now corrected but the ids are kept
        # as stable keys. MK8DX replaces coins on 3 RACE courses (Hyrule=Rupee,
        # Animal Crossing=Bell, Yoshi's Island=Yoshi coin); Urchin Underpass
        # (Splatoon cash) is a BATTLE course and is ignored.
        "coinByTrack": {
            "track.hyrule_circuit": currency.get("item_icon.002_rupee"),   # Rupee
            "track.animal_crossing": currency.get("item_icon.001_shine"),  # Bell (star-coin; DB id kept)
            "track.yoshis_island": currency.get("item_icon.003_bell"),     # Yoshi coin (DB id kept)
        },
    }
    # world records + Nintendo staff times per track+mode (splits included
    # when mkwrs exposes them) — powers the competitive comparison views
    records: dict = {}
    for rec in db["collections"]["worldRecords"]:
        slot = records.setdefault(rec["trackId"], {}).setdefault(str(rec["mode"]), {})
        slot["wr"] = {"timeMs": rec["timeMs"], "player": rec.get("playerName"),
                      "lapTimesMs": (rec.get("splits") or {}).get("lapTimesMs"),
                      "coinsPerLap": (rec.get("splits") or {}).get("coinCountsPerLap"),
                      "countryId": rec.get("countryId"),
                      # the holder's combo and their video: both already in the
                      # database, and exactly what a competitive player wants
                      "loadout": rec.get("loadout"), "videoUrl": rec.get("videoUrl"),
                      "dateMs": rec.get("dateMs")}
    for rec in db["collections"]["nintendoStaffTimes"]:
        mode = rec.get("mode")
        if mode is None:
            continue
        slot = records.setdefault(rec["trackId"], {}).setdefault(str(mode), {})
        slot["staff"] = {"timeMs": rec["timeMs"], "player": rec.get("playerName"),
                         "loadout": rec.get("loadout")}
    return {"parts": parts, "flags": flags, "tracks": tracks, "items": items,
            "records": records}


class RunStore:
    """Aggregates run reports; live mode pushes runs in-memory as well."""

    def __init__(self, runs_dir: Path, assets_root: Path | None = None,
                 config_dir: Path | None = None, settings_path: Path | None = None):
        self.runs_dir = runs_dir
        self.assets_root = Path(assets_root) if assets_root else DEFAULT_ASSETS
        # where the calibration grids live (the engine's config folder)
        self.config_dir = Path(config_dir) if config_dir else DASH.parent / "config"
        self.settings_path = Path(settings_path) if settings_path else storage.SETTINGS_PATH
        self._meta: dict | None = None
        self.live = False
        # Set by POST /api/stop from the dashboard's Stop button; the
        # capture loop (watch.py) checks it every frame and ends the
        # session exactly as Ctrl+C in the console would.
        self.stop_requested = False
        self._lock = threading.Lock()
        self._live_runs: list[dict] = []
        self._live_state: dict = {}
        self._preview: bytes = b""
        self._preview_seq = 0
        # What the live picture really delivers (last 3 s): frames produced, preview
        # requests served, distinct frames among them, and the fps the page reports
        # it actually showed. Read from /api/live as liveState-independent "viewer".
        self._produced_at: list[float] = []
        self._served: list[tuple[float, int]] = []
        self._shown_fps: tuple[float, float] | None = None
        self._preview_cv = threading.Condition(self._lock)
        self._rep_cache: dict = {}  # report path -> (rep_mtime, subs_mtime, rep, subs)
        # recording control/state, shared with the capture loop (watch.py):
        # manual = user REC button, auto = one clip per run; the loop fills
        # active/file/sinceMs/clips/dir. `blocked` is set by the storage policy
        # when the disk is below its floor — the loop refuses to start a clip.
        self.record: dict = {"manual": False, "auto": True, "active": False,
                             "file": None, "sinceMs": 0, "clips": [], "dir": None,
                             "blocked": False}
        self.settings = storage.Settings.load(self.settings_path)
        self._storage: dict = {}
        self._storage_at = 0.0

    # -- storage / retention --------------------------------------------------
    def storage_status(self, max_age: float = 8.0) -> dict:
        """Cached: scanning the clip inventory walks the runs dir, and the
        dashboard polls. 8 s is fresh enough for a size read-out."""
        import time as _t
        with self._lock:
            fresh = self._storage and (_t.time() - self._storage_at) < max_age
            if fresh:
                return self._storage
        st = storage.status(self.runs_dir, self.settings)
        with self._lock:
            self._storage, self._storage_at = st, _t.time()
            self.record["blocked"] = bool(st.get("blockRecording"))
        return st

    @staticmethod
    def _setting_value(key: str, current, value):
        """One retention setting, checked; ActionRefused when it is not acceptable."""
        if isinstance(current, bool):
            if value in (True, 1, "1", "true", "True"):
                return True
            if value in (False, 0, "0", "false", "False"):
                return False
            raise ActionRefused(f"{key} must be on or off")
        if isinstance(current, (int, float)):
            if isinstance(value, bool) or not isinstance(value, (int, float, str)) \
                    or (isinstance(value, str) and len(value) > 32):
                raise ActionRefused(f"{key} must be a number")
            try:
                number = float(value)
            except ValueError:
                raise ActionRefused(f"{key} must be a number") from None
            low, high = SETTING_LIMITS.get(key, (0, 100000))
            if not math.isfinite(number) or not low <= number <= high:
                raise ActionRefused(f"{key} is out of range")
            return int(number) if isinstance(current, int) else number
        if isinstance(current, str):
            if not isinstance(value, str) or not _SWITCH_LANGUAGE.fullmatch(value):
                raise ActionRefused(f"{key} is not a language code")
            return value
        raise ActionRefused(f"{key} cannot be changed")

    def update_settings(self, changes: dict) -> dict:
        """Apply all of `changes` or none of them (unknown keys are refused)."""
        if not isinstance(changes, dict) or not changes or len(changes) > 32:
            raise ActionRefused("settings expected")
        checked = {}
        for k, v in changes.items():
            if not isinstance(k, str) or k.startswith("_") or not hasattr(self.settings, k) \
                    or callable(getattr(self.settings, k)):
                raise ActionRefused("unknown setting")
            checked[k] = self._setting_value(k, getattr(self.settings, k), v)
        for k, v in checked.items():
            setattr(self.settings, k, v)
        self.settings.sane().save(self.settings_path)
        with self._lock:
            self._storage, self._storage_at = {}, 0.0   # force a re-plan
        return asdict(self.settings)

    def cleanup(self, dry_run: bool = False) -> dict:
        res = storage.cleanup(self.runs_dir, self.settings, dry_run=dry_run)
        with self._lock:
            self._storage, self._storage_at = {}, 0.0
        return res

    def set_preview(self, jpeg: bytes) -> None:
        with self._preview_cv:
            self._preview = jpeg
            self._preview_seq += 1
            now = time.monotonic()
            self._produced_at.append(now)
            if len(self._produced_at) > 400:
                del self._produced_at[:200]
            self._preview_cv.notify_all()

    def preview(self) -> bytes:
        with self._lock:
            return self._preview

    def serve_preview(self, shown_fps: float | None) -> bytes:
        """The preview for one request, counted for the viewer statistics."""
        with self._lock:
            now = time.monotonic()
            self._served.append((now, self._preview_seq))
            if len(self._served) > 600:
                del self._served[:300]
            if shown_fps is not None:
                self._shown_fps = (now, shown_fps)
            return self._preview

    def viewer_stats(self) -> dict:
        with self._lock:
            now = time.monotonic()
            window = 3.0
            served = [seq for t, seq in self._served if now - t <= window]
            produced = [t for t in self._produced_at if now - t <= window]
            shown = self._shown_fps if self._shown_fps and now - self._shown_fps[0] <= window else None
        return {
            "producedPerSecond": round(len(produced) / window, 1),
            "servedPerSecond": round(len(served) / window, 1),
            "distinctServedPerSecond": round(len(set(served)) / window, 1),
            "shownFps": shown[1] if shown else None,
        }

    def meta(self) -> dict:
        if self._meta is None:
            self._meta = build_meta(self.assets_root)
        return self._meta

    def reference(self) -> dict:
        """player-reference.json beside the runs, or {} when absent/invalid."""
        path = self.runs_dir / "player-reference.json"
        try:
            if not path.is_file() or path.is_symlink() or path.stat().st_size > 512 * 1024:
                return {}
            document = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(document, dict) or document.get("format") != "livetrial.reference.v1" \
                    or not isinstance(document.get("tracks"), dict):
                return {}
            return document
        except (OSError, ValueError):
            return {}

    def wait_preview(self, last_seq: int, timeout: float = 2.0):
        """Block until a frame newer than last_seq arrives; None on timeout."""
        with self._preview_cv:
            if self._preview_seq <= last_seq:
                self._preview_cv.wait(timeout)
            if self._preview_seq <= last_seq:
                return None
            return self._preview_seq, self._preview

    def push_live_run(self, run: dict) -> None:
        with self._lock:
            self._live_runs.append(run)

    def set_live_state(self, state: dict) -> None:
        with self._lock:
            self._live_state = state

    def live_snapshot(self) -> dict:
        """Just the small, fast-changing live bits (ticker/phase/chips/record).
        The dashboard polls this ~4-5x/s so text tracks the preview image; it
        must stay a couple KB (no runs history). Same objects snapshot() builds."""
        with self._lock:
            state = dict(self._live_state)
        return {"live": self.live, "liveState": state,
                "record": dict(self.record) if self.live else None,
                "viewer": self.viewer_stats() if self.live else None}

    # Shortcut vs no-shortcut is THE split in MK8DX time trials: an SC run and
    # an NSC run on the same course are different events, and comparing one to
    # the other (or to a record of the other kind) is meaningless. Stored per
    # run beside the reports so it survives re-analysis, defaulting to NSC.
    def categories(self) -> dict:
        try:
            return json.loads((self.runs_dir / "categories.json").read_text(encoding="utf-8"))
        except Exception:
            return {}

    def set_category(self, key: str, value: str) -> str:
        cats = self.categories()
        if not isinstance(cats, dict):
            cats = {}
        if value in ("sc", "nsc"):
            if key not in cats and len(cats) >= MAX_MARKED_KEYS:
                raise ActionRefused("too many categorised runs", 409)
            cats[key] = value
        else:
            cats.pop(key, None)
        _write_atomic(self.runs_dir / "categories.json", json.dumps(cats, indent=0))
        return cats.get(key, "nsc")

    # -- exports --------------------------------------------------------------
    CSV_COLS = ("date", "track", "cc", "category", "laps", "timeMs", "time",
                "lap1", "lap2", "lap3", "lap4", "lap5", "lap6", "lap7",
                "ghostMs", "coins", "character", "kart", "wheel", "glider", "flag",
                "newRecord", "verified", "clip", "endscreen", "source", "run")

    def _rows(self):
        import datetime
        for r in self.snapshot()["runs"]:
            p = ((r.get("results") or {}).get("player") or {})
            if r.get("aborted") or p.get("totalMs") is None:
                continue
            ident = (r.get("identity") or {}).get("player") or {}
            laps = list(p.get("lapTimesMs") or [])[:7] + [None] * 7
            ev = r.get("events") or []
            yield {
                "date": datetime.datetime.fromtimestamp(r.get("capturedAt") or 0).isoformat(timespec="seconds"),
                "track": ((r.get("context") or {}).get("trackName") or {}).get("trackId"),
                "cc": (r.get("context") or {}).get("cc"), "category": r.get("category", "nsc"),
                "laps": r.get("lapCount"), "timeMs": p.get("totalMs"),
                "time": storage.ms_to_clock(p["totalMs"]),
                **{f"lap{i+1}": laps[i] for i in range(7)},
                "ghostMs": (((r.get("results") or {}).get("ghost") or {}).get("totalMs")),
                "coins": sum(1 for e in ev if e.get("type") == "coin" and e.get("to", 0) > e.get("from", 0)),
                **{k: (ident.get(k) or {}).get("id") for k in ("character", "kart", "wheel", "glider", "flag")},
                "newRecord": any(e.get("type") == "banner_new_record" for e in ev),
                "verified": bool(p.get("lapSumOk")),
                "clip": r.get("clipFile"), "endscreen": r.get("endscreenFile"),
                "source": r.get("source"), "run": r.get("run"),
            }

    def csv(self) -> str:
        """Every finished run as a spreadsheet row — serious players keep sheets,
        and a bespoke JSON namespace is not a substitute."""
        import csv as _csv
        import io
        buf = io.StringIO()
        w = _csv.DictWriter(buf, fieldnames=list(self.CSV_COLS), extrasaction="ignore",
                            lineterminator=chr(10))
        w.writeheader()
        for row in self._rows():
            w.writerow(row)
        return buf.getvalue()

    def export_runs(self) -> dict:
        """Portable export another player can import for head-to-head."""
        rows = list(self._rows())
        best: dict = {}
        for r in rows:
            k = f"{r['track']}|{r['cc']}|{r['category']}"
            if r["track"] and (k not in best or r["timeMs"] < best[k]["timeMs"]):
                best[k] = {"track": r["track"], "cc": r["cc"], "category": r["category"],
                           "timeMs": r["timeMs"], "date": r["date"],
                           "character": r["character"], "kart": r["kart"],
                           "wheel": r["wheel"], "glider": r["glider"]}
        return {"format": "livetrial.rivals.v1", "runs": len(rows), "best": list(best.values())}

    def package(self, key: str, out_dir: Path | None = None) -> dict:
        """One zip per run: clip + end-screen still + the submission JSON +
        what was verified. Leaderboards ask for proof, and a folder of loose
        files is not proof — this is the thing you attach. The download route
        builds it in a temporary folder, so a GET leaves the runs folder as it was."""
        import zipfile
        run = next((r for r in self.snapshot()["runs"] if r.get("key") == key), None)
        if not run:
            return {"ok": False, "error": "run not found"}
        stem = f"{(((run.get('context') or {}).get('trackName') or {}).get('trackId') or 'run')}".split(".")[-1]
        stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem)[:64] or "run"
        p = ((run.get("results") or {}).get("player") or {})
        name = f"livetrial_{stem}_{storage.ms_to_clock(p.get('totalMs')).replace(':', 'm').replace('.', 's')}.zip"
        out = (Path(out_dir) if out_dir is not None else self.runs_dir) / name
        try:
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
                base = self.runs_dir.resolve()
                for f in (run.get("clipFile"), run.get("endscreenFile")):
                    if not isinstance(f, str) or not f:
                        continue
                    source = (self.runs_dir / f).resolve()
                    if base in source.parents and source.is_file():
                        z.write(source, source.name)
                z.writestr("run.json", json.dumps(run, indent=1, default=str))
                if run.get("submission"):
                    z.writestr("submission.json", json.dumps(run["submission"], indent=1))
                lines_ = [
                    "LiveTrial run package",
                    f"track      : {stem}",
                    f"cc / cat   : {(run.get('context') or {}).get('cc')} / {run.get('category', 'nsc')}",
                    f"time       : {storage.ms_to_clock(p.get('totalMs'))}",
                    f"laps       : {[storage.ms_to_clock(v) for v in (p.get('lapTimesMs') or [])]}",
                    f"lap-sum ok : {bool(p.get('lapSumOk'))}",
                    "",
                    "Times are accepted ONLY when the lap times sum exactly to the total,",
                    "read by 7-segment decode off the result screen.",
                    f"clip       : {run.get('clipFile') or 'not kept'}",
                    f"end screen : {run.get('endscreenFile') or 'none'}",
                    "",
                    "NOT verified by this tool: that the recording is unedited, the category",
                    "(shortcut vs no-shortcut, which is user-tagged), and anything off-screen.",
                ]
                z.writestr("VERIFICATION.txt", "\n".join(lines_) + "\n")
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}
        return {"ok": True, "path": str(out), "bytes": out.stat().st_size}

    def _archived(self) -> set:
        try:
            return set(json.loads((self.runs_dir / "archived.json").read_text(encoding="utf-8")))
        except Exception:
            return set()

    def toggle_archive(self, key: str) -> bool:
        arch = self._archived()
        if key in arch:
            arch.discard(key)
        else:
            if len(arch) >= MAX_MARKED_KEYS:
                raise ActionRefused("too many archived runs", 409)
            arch.add(key)
        _write_atomic(self.runs_dir / "archived.json", json.dumps(sorted(arch)))
        return key in arch

    def ghost_runs(self) -> list:
        """Ghost replays watched to the line (ghost_replays.json), shaped like a
        run for the page's lap table and chart but kept apart from `runs`, so no
        PB, recap, goal or track statistic ever counts a ghost's time as the
        player's (ADR-0210 rule 11). Names, parts and the clip come from the
        session's ghosts.json record of that ghost."""
        out = []
        claimed = self._claimed_ghosts()
        for gp in sorted(self.runs_dir.glob("*/ghost_replays.json")):
            if _internal_session_dir(gp.parent.name):
                continue
            ghosts_path = gp.parent / "ghosts.json"
            try:
                mt = gp.stat().st_mtime
                gmt = ghosts_path.stat().st_mtime if ghosts_path.exists() else 0.0
            except OSError:
                continue
            key = "ghost-replays:" + str(gp)
            cached = self._rep_cache.get(key)
            if cached and cached[0] == mt and cached[1] == gmt:
                replays, ghosts = cached[2], cached[3]
            else:
                try:
                    replays = json.loads(gp.read_text(encoding="utf-8")).get("replays") or []
                except Exception:
                    continue
                try:
                    ghosts = json.loads(ghosts_path.read_text(encoding="utf-8")).get("ghosts") or []
                except Exception:
                    ghosts = []
                self._rep_cache[key] = (mt, gmt, replays, ghosts)
            session = gp.parent.name
            for rep in replays:
                if not isinstance(rep, dict):
                    continue
                seen = rep.get("replayOf") or {}
                rec = next((g for g in ghosts if isinstance(g, dict) and ghost_matches(g, seen)), {})
                run = dict(rep)
                run.update(source=session, sessionDir=session, aborted=False, finished=True,
                           capturedAt=rep.get("closedAt") or mt,
                           key=f"ghost|{session}|{rep.get('goAtMs')}")
                result = rep.get("ghostResult") or {}
                # a replay stored before the engine took laps from the HUD gets them here
                laps = result.get("lapTimesMs") or replay_hud_lap_times(rep, result.get("totalMs"))
                run["results"] = {"player": {"totalMs": result.get("totalMs"), "lapTimesMs": laps}}
                if any("race" not in e for e in run.get("events") or []):
                    engine._stamp_race_time(run)
                run["ghostReplay"] = {
                    "name": rec.get("name") or seen.get("name"),
                    "staffGhost": bool(rec.get("staffGhost") or seen.get("staffGhost")),
                    "worldRecord": bool(rec.get("worldRecord") or seen.get("worldRecord")),
                    "characterId": rec.get("characterId") or (seen.get("character") or {}).get("id"),
                    "countryId": rec.get("countryId") or (seen.get("flag") or {}).get("id"),
                    "parts": [rec[k] for k in ("bodyId", "tireId", "gliderId") if rec.get(k)],
                    # marked Mine in the desktop app: the player's own time, counted
                    # where the page asks for a best (never as an attempt that day)
                    "mine": f"{session}#{rec.get('key') or rep.get('ghostKey')}" in claimed["ids"]
                            or any(ghost_matches(c, rec or seen) for c in claimed["ghosts"]),
                }
                clip = rec.get("clip")
                if isinstance(clip, str) and re.fullmatch(r"clip_\d{6}\.mp4", clip) \
                        and (gp.parent / clip).is_file():
                    run["clipFile"] = f"{session}/{clip}"
                    panel = gp.parent / (clip[:-4] + ".panel.jpg")
                    if panel.is_file():
                        run["endscreenFile"] = f"{session}/{panel.name}"
                out.append(run)
        return out

    def _claimed_ghosts(self) -> dict:
        """The ghosts the Player marked Mine in the desktop app (its
        ghost-decisions.json beside the runs folder, `<session>#<key>` ->
        {"decision": "mine", ...}); an undone or "not mine" choice is not one."""
        path = self.runs_dir.parent / "ghost-decisions.json"
        try:
            mt = path.stat().st_mtime
        except OSError:
            return {"ids": set(), "ghosts": []}
        cached = self._rep_cache.get("ghost-decisions")
        if cached and cached[0] == mt:
            return cached[1]
        try:
            decisions = json.loads(path.read_text(encoding="utf-8")).get("decisions") or {}
        except Exception:
            decisions = {}
        ids = {gid for gid, d in decisions.items()
               if isinstance(gid, str) and isinstance(d, dict) and d.get("decision") == "mine"}
        ghosts = []
        for session in {gid.split("#", 1)[0] for gid in ids if "#" in gid}:
            if _internal_session_dir(session) or "/" in session or "\\" in session:
                continue
            try:
                records = json.loads((self.runs_dir / session / "ghosts.json").read_text(encoding="utf-8")).get("ghosts") or []
            except Exception:
                continue
            ghosts += [g for g in records if isinstance(g, dict) and f"{session}#{g.get('key')}" in ids]
        result = {"ids": ids, "ghosts": ghosts}
        self._rep_cache["ghost-decisions"] = (mt, result)
        return result

    def snapshot(self) -> dict:
        runs = []
        for rp in sorted(self.runs_dir.glob("*/report.json")):
            if _internal_session_dir(rp.parent.name):
                continue
            # mtime-keyed cache: polling every 1.5s must not re-read and
            # re-parse every historical report from disk (GIL contention was
            # starving the live capture loop)
            try:
                rep_mt = rp.stat().st_mtime
            except OSError:
                continue
            sp = rp.parent / "submissions.json"
            try:
                subs_mt = sp.stat().st_mtime
            except OSError:
                subs_mt = 0.0
            key = str(rp)
            cached = self._rep_cache.get(key)
            if cached and cached[0] == rep_mt and cached[1] == subs_mt:
                rep, subs = cached[2], cached[3]
            else:
                try:
                    rep = json.loads(rp.read_text(encoding="utf-8"))
                except Exception:
                    continue
                subs = {}
                try:
                    for s in json.loads(sp.read_text(encoding="utf-8")):
                        subs[(s.get("source") or {}).get("runIndex")] = s
                except Exception:
                    pass
                self._rep_cache[key] = (rep_mt, subs_mt, rep, subs)
            captured = rep_mt
            for run in rep.get("runs", []):
                run = dict(run)
                run["source"] = Path(rep.get("video", "")).name or rp.parent.name
                run["sessionDir"] = rp.parent.name
                # prefer the run's own stable wall-clock (set at close) over the
                # report mtime, which is shared by every run in a session and so
                # sorted/displayed them all at the same (last-rewrite) time
                run["capturedAt"] = run.get("closedAt") or captured
                run["key"] = f"{run['source']}|{run['run']}|{run.get('goAtMs')}"
                if run["run"] in subs:
                    run["submission"] = subs[run["run"]]
                runs.append(run)
        with self._lock:
            runs.extend(self._live_runs)
            state = dict(self._live_state)
        # the same source analyzed more than once -> keep the newest analysis
        dedup: dict = {}
        for run in runs:
            key = (run.get("source"), run.get("run"), run.get("goAtMs"))
            if key not in dedup or (run.get("capturedAt") or 0) > (dedup[key].get("capturedAt") or 0):
                dedup[key] = run
        # attach per-run clips from disk (clip_HHMMSS_runNN.mp4 in the run's
        # session dir) — survives watch restarts, unlike the in-memory list
        clips: dict = {}
        for p in self.runs_dir.glob("*/clip_*_run*.mp4"):
            if _internal_session_dir(p.parent.name):
                continue
            m = re.search(r"_run(\d+)\.mp4$", p.name)
            if m:
                clips.setdefault((p.parent.name, int(m.group(1))), []).append(p.name)
        # end-screen stills, from disk so they survive a watch restart and
        # outlive the clip they came from
        stills: dict = {}
        for sp2 in self.runs_dir.glob("*/run_*_endscreen.jpg"):
            if _internal_session_dir(sp2.parent.name):
                continue
            m = re.search(r"run_(\d+)_endscreen\.jpg$", sp2.name)
            if m:
                stills[(sp2.parent.name, int(m.group(1)))] = sp2.name
        arch = self._archived()
        cats = self.categories()
        out_runs = []
        for run in dedup.values():
            run["archived"] = run.get("key") in arch
            run["category"] = cats.get(run.get("key"), "nsc")
            # Runs written before the engine stamped race time still have only
            # wall-ms events. Re-derive here with the ENGINE's own function so
            # an old report and a new one reach the dashboard identically —
            # a second copy of this rule in the client is how the ticker broke.
            if any("race" not in e for e in run.get("events") or []):
                engine._stamp_race_time(run)
            ck = (run.get("sessionDir"), run.get("run"))
            if ck in clips:
                run["clipFile"] = f"{ck[0]}/{sorted(clips[ck])[-1]}"
            if ck in stills:
                run["endscreenFile"] = f"{ck[0]}/{stills[ck]}"
            out_runs.append(run)
        try:
            ghost_runs = self.ghost_runs()
        except Exception:
            ghost_runs = []
        # the readable copy's file name (readable_clips.py), shown with an Open folder button
        readable = readable_clips.load_index(self.runs_dir)
        for run in (*out_runs, *ghost_runs):
            entry = readable.get(run.get("clipFile"))
            if entry and isinstance(entry.get("name"), str):
                run["readableClip"] = entry["name"]
        return {"runs": out_runs, "ghostRuns": ghost_runs, "live": self.live, "liveState": state,
                "record": dict(self.record) if self.live else None,
                "lanUrl": getattr(self, "lan_url", None)}


def make_handler(store: RunStore, token: str | None = None):
    action_secret = token if isinstance(token, str) and _ACTION_SHAPE.fullmatch(token) else action_token()
    write_lock = threading.Lock()        # one state/config change at a time
    package_lock = threading.Lock()      # one run package being zipped at a time
    post_routes = frozenset({*CALIBRATION_FILES, "/api/stop", "/api/record", "/api/settings",
                             "/api/storage/cleanup", "/api/pin", "/api/category", "/api/archive",
                             "/api/readable-clip/open"})

    class Handler(BaseHTTPRequestHandler):
        # keep-alive: the dashboard polls /api/preview.jpg ~12x/s and /api/runs
        # every 1.5s. HTTP/1.0 (the default) opens a fresh TCP connection + a new
        # server thread per request; 1.1 reuses one connection. All responses
        # send Content-Length (see _send / the range branch), so framing is safe.
        protocol_version = "HTTP/1.1"
        # An idle keep-alive connection or a stalled peer gives its thread back.
        timeout = 60
        ACTION_TOKEN = action_secret

        def log_message(self, *a):  # quiet
            pass

        def _security_headers(self):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            # the desktop app shows these pages in its own loopback window
            self.send_header("Content-Security-Policy",
                             "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*")

        def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._security_headers()
            for name, value in (extra or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, document, extra: dict | None = None):
            self._send(code, json.dumps(document).encode("utf-8"), "application/json", extra)

        # -- who may read, who may change ----------------------------------
        def _host_allowed(self) -> bool:
            name = _host_name(self.headers.get("Host", ""))
            if name in LOOPBACK_NAMES:
                return True
            # Opt-in LAN viewing (--lan): a phone opens the computer's address.
            # An IP literal cannot be DNS-rebound; any other name is refused.
            return bool(getattr(self.server, "lan", False)) and name is not None and _is_ip_literal(name)

        def _local_page(self) -> bool:
            """This computer, by its loopback address and a loopback Host."""
            return (_is_loopback_address(self.client_address[0])
                    and _host_name(self.headers.get("Host", "")) in LOOPBACK_NAMES)

        def _read_allowed(self) -> bool:
            return self._host_allowed() and self.headers.get("Sec-Fetch-Site", "none") != "cross-site"

        def _action_allowed(self) -> bool:
            if not self._local_page():
                return False
            port = self.server.server_address[1]
            if self.headers.get("Origin", "") not in {f"http://127.0.0.1:{port}", f"http://localhost:{port}",
                                                       f"http://[::1]:{port}"}:
                return False
            if self.headers.get("Sec-Fetch-Site", "same-origin") != "same-origin":
                return False
            offered = self.headers.get(ACTION_HEADER, "")
            return bool(offered) and hmac.compare_digest(offered.encode("utf-8"), action_secret.encode("ascii"))

        def _page(self, name: str):
            """A dashboard page; only the page served to this computer carries the proof."""
            payload = (DASH / name).read_bytes()
            if self._local_page():
                payload = payload.replace(
                    b"</head>", b'<meta name="livetrial-action" content="' + action_secret.encode("ascii")
                    + b'">\n</head>', 1)
            self._send(200, payload, "text/html; charset=utf-8")

        def _refuse_unread_body(self, length: int):
            """Answer 413 to a body that is never read, so the client still gets it.

            Closing a socket with unread data makes Windows (and Linux) send a
            reset, which can arrive before the client has read the answer: the
            client then sees a connection abort instead of 413. So the answer goes
            out with Connection: close, the sending side is half-closed, and the
            declared body is read and discarded within DRAIN_BYTES and
            DRAIN_SECONDS before the socket closes. Nothing read is kept."""
            self.close_connection = True
            self._json(413, {"ok": False, "error": "request too large"}, {"Connection": "close"})
            try:
                self.wfile.flush()
                self.connection.shutdown(socket.SHUT_WR)
            except OSError:
                return
            remaining = min(length, DRAIN_BYTES)
            deadline = time.monotonic() + DRAIN_SECONDS
            try:
                while remaining > 0:
                    left = deadline - time.monotonic()
                    if left <= 0:
                        break
                    self.connection.settimeout(left)
                    chunk = self.rfile.read1(min(remaining, 64 * 1024))
                    if not chunk:
                        break
                    remaining -= len(chunk)
            except OSError:
                pass

        def _read_body(self, limit: int):
            """The request body within `limit` bytes and BODY_READ_SECONDS, or None
            (and the connection closes) when it is missing, too large or too slow."""
            if self.headers.get("Transfer-Encoding"):
                self.close_connection = True
                self._json(411, {"ok": False, "error": "length required"})
                return None
            try:
                length = int(self.headers.get("Content-Length", "0") or "0")
            except ValueError:
                length = -1
            if length < 0:
                self.close_connection = True
                self._json(400, {"ok": False, "error": "bad request"})
                return None
            if length > limit:
                self._refuse_unread_body(length)
                return None
            if not length:
                return b""
            try:
                self.connection.settimeout(BODY_READ_SECONDS)
                body = self.rfile.read(length)
            except OSError:
                self.close_connection = True
                return None
            finally:
                try:
                    self.connection.settimeout(self.timeout)
                except OSError:
                    pass
            if len(body) != length:
                self.close_connection = True
                return None
            return body

        def do_OPTIONS(self):  # noqa: N802
            # No CORS: a preflight is never approved, so no other site can make a change.
            self._send(405, b"", "text/plain", {"Allow": "GET, POST"})

        def do_POST(self):  # noqa: N802
            path = self.path.split("?")[0]
            raw = self._read_body(MAX_CALIBRATION_BYTES if path in CALIBRATION_FILES else MAX_ACTION_BYTES)
            if raw is None:
                return
            if path not in post_routes:
                self._send(404, b"not found", "text/plain")
                return
            if not self._action_allowed():
                self._json(403, {"ok": False, "error": "not allowed"})
                return
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                self._json(415, {"ok": False, "error": "JSON expected"})
                return
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except (UnicodeDecodeError, ValueError):
                body = None
            if not isinstance(body, dict):
                self._json(400, {"ok": False, "error": "a JSON object expected"})
                return
            if not write_lock.acquire(timeout=WRITE_WAIT_SECONDS):
                self._json(429, {"ok": False, "error": "busy"}, {"Retry-After": "1"})
                return
            try:
                code, document = self._act(path, body, raw)
            except ActionRefused as refused:
                code, document = refused.status, {"ok": False, "error": str(refused)}
            except Exception:  # noqa: BLE001
                code, document = 500, {"ok": False, "error": "that did not work; nothing was changed"}
            finally:
                write_lock.release()
            self._json(code, document)

        def _act(self, path: str, body: dict, raw: bytes):
            if path in CALIBRATION_FILES:
                # the calibrator's own text is kept as it was sent (it is valid JSON)
                _write_atomic(store.config_dir / CALIBRATION_FILES[path], raw.decode("utf-8"))
                return 200, {"ok": True}
            if path == "/api/stop":
                # Only meaningful while a capture is running; answering
                # first lets the page show its farewell before the
                # server disappears with the capture process.
                store.stop_requested = True
                return 200, {"ok": True, "live": bool(store.live)}
            if path == "/api/record":
                mode, on = body.get("mode"), body.get("on")
                if mode not in ("manual", "auto") or not isinstance(on, bool):
                    raise ActionRefused("mode (manual/auto) and on (true/false) expected")
                store.record[mode] = on
                return 200, dict(store.record)
            if path == "/api/settings":
                return 200, store.update_settings(body)
            if path == "/api/storage/cleanup":
                dry = body.get("dryRun", False)
                if not isinstance(dry, bool):
                    raise ActionRefused("dryRun must be true or false")
                return 200, store.cleanup(dry_run=dry)
            if path == "/api/pin":
                rel = body.get("file")
                if not isinstance(rel, str) or not _RUN_FILE.fullmatch(rel) or ".." in rel:
                    raise ActionRefused("a clip of a session expected")
                pinned = storage.toggle_pin(store.runs_dir, rel)
                store.storage_status(max_age=0.0)
                return 200, {"file": rel, "pinned": pinned}
            if path == "/api/readable-clip/open":
                # Opens Explorer on THIS computer at the clip's readable copy; the page only names the
                # internal clip, the path itself comes from the index the engine wrote.
                rel = body.get("file")
                if not isinstance(rel, str) or not _RUN_FILE.fullmatch(rel) or ".." in rel:
                    raise ActionRefused("a clip of a session expected")
                entry = readable_clips.readable_entry(store.runs_dir, rel)
                if entry is None:
                    raise ActionRefused("this clip has no readable copy", 404)
                show_in_folder(Path(entry["path"]))
                return 200, {"ok": True, "name": entry["name"]}
            key = body.get("key")
            if not isinstance(key, str) or not key or len(key) > MAX_KEY_LENGTH:
                raise ActionRefused("key required")
            if path == "/api/category":
                value = body.get("value", "")
                if not isinstance(value, str):
                    raise ActionRefused("value must be sc, nsc or empty")
                return 200, {"key": key, "category": store.set_category(key, value)}
            return 200, {"archived": store.toggle_archive(key)}   # /api/archive

        def do_GET(self):  # noqa: N802
            if not self._read_allowed():
                self._send(421 if not self._host_allowed() else 403, b"not allowed", "text/plain")
                return
            path = self.path.split("?")[0]
            if path in ("/", "/index.html"):
                self._page("index.html")
            elif path in ("/app-icon", "/favicon.ico"):
                # The product's icon (MK8DX_LIVETRIAL_PRODUCT_ICON, set by the desktop
                # app), so run history carries the same favicon as the dashboard.
                self._send(200, *_product_icon())
            elif path in ("/overlay", "/overlay.html"):
                # OBS browser source: transparent, polls /api/live
                self._send(200, (DASH / "overlay.html").read_bytes(), "text/html; charset=utf-8")
            elif path in ("/grid", "/grid.html"):
                # card-grid calibration tool (see tests/_grid_propose.py)
                self._page("grid.html")
            elif path == "/api/grid":
                gp = store.config_dir / "card_grid.json"
                if not gp.is_file():
                    self._send(404, b'{"error":"run tests/_grid_propose.py first"}',
                               "application/json")
                else:
                    self._send(200, gp.read_bytes(), "application/json")
            elif path == "/api/grid/ref":
                from urllib.parse import parse_qs, urlparse
                mode = (parse_qs(urlparse(self.path).query).get("mode") or ["3lap"])[0]
                rp = (_calibration_image(DASH.parent / "config" / "grid_refs", f"{mode}.jpg", ".jpg")
                      if mode in ("3lap", "7lap") else None)
                if rp is not None:
                    self._send(200, rp.read_bytes(), "image/jpeg")
                else:
                    self._send(404, b"no reference frame", "text/plain")
            elif path == "/api/grid/artwork":
                self._send(200, json.dumps(_grid_artwork()).encode(), "application/json")
            elif path == "/api/grid/assets":
                from urllib.parse import parse_qs, urlparse
                mode = (parse_qs(urlparse(self.path).query).get("mode") or ["3lap"])[0]
                if mode in ("3lap", "7lap"):
                    self._send(200, json.dumps(_grid_assets(mode)).encode(), "application/json")
                else:
                    self._send(404, b"unknown grid mode", "text/plain")
            elif path in ("/deltagrid", "/deltagrid.html"):
                self._page("deltagrid.html")
            elif path == "/api/staffsplits":
                self._send(200, json.dumps(_staff_splits()).encode(), "application/json")
            elif path in DIGIT_GRIDS:
                gp = store.config_dir / DIGIT_GRIDS[path]
                self._send(200 if gp.is_file() else 404,
                           gp.read_bytes() if gp.is_file() else b'{"error":"missing"}',
                           "application/json")
            elif path == "/api/deltagrid/refs":
                # one manifest per harvester, merged: the calibrator filters by
                # `target`, so lap and coin references drop straight into the
                # page that already places the clock and the delta
                man: list = []
                for d in ("delta_refs", "lapcoin_refs"):
                    mp = DASH.parent / "config" / d / "manifest.json"
                    if mp.is_file():
                        try:
                            man += json.loads(mp.read_text(encoding="utf-8"))
                        except Exception:  # noqa: BLE001
                            pass
                self._send(200, json.dumps(man).encode(), "application/json")
            elif path == "/api/deltagrid/ref":
                from urllib.parse import parse_qs, urlparse
                f = (parse_qs(urlparse(self.path).query).get("f") or [""])[0]
                cfg = DASH.parent / "config"
                rp = (_calibration_image(cfg / "lapcoin_refs", f, ".png")
                      or _calibration_image(cfg / "delta_refs", f, ".png"))
                if rp is not None:
                    self._send(200, rp.read_bytes(), "image/png")
                else:
                    self._send(404, b"no such reference", "text/plain")
            elif path == "/api/deltagrid/segments":
                self._send(200, json.dumps(_delta_segments()).encode(), "application/json")
            elif path == "/api/export/package":
                from urllib.parse import parse_qs, urlparse
                q = parse_qs(urlparse(self.path).query)
                key = (q.get("key") or [""])[0]
                if not key or len(key) > MAX_KEY_LENGTH:
                    self._json(400, {"ok": False, "error": "key required"})
                    return
                if not package_lock.acquire(blocking=False):
                    self._json(429, {"ok": False, "error": "busy"}, {"Retry-After": "2"})
                    return
                try:
                    # Built in a temporary folder and removed after sending: a GET
                    # leaves the runs folder exactly as it was.
                    with tempfile.TemporaryDirectory(prefix="livetrial-package-") as scratch:
                        out = store.package(key, Path(scratch))
                        if not out.get("ok"):
                            self._json(400, {"ok": False, "error": out.get("error") or "no package"})
                            return
                        target = Path(out["path"])
                        self.send_response(200)
                        self.send_header("Content-Type", "application/zip")
                        self.send_header("Content-Disposition", f'attachment; filename="{target.name}"')
                        self.send_header("Content-Length", str(target.stat().st_size))
                        self.send_header("Cache-Control", "no-store")
                        self._security_headers()
                        self.end_headers()
                        with open(target, "rb") as handle:
                            while True:
                                chunk = handle.read(1 << 20)
                                if not chunk:
                                    break
                                self.wfile.write(chunk)
                finally:
                    package_lock.release()
            elif path == "/api/runs":
                self._send(200, json.dumps(store.snapshot()).encode("utf-8"), "application/json")
            elif path == "/api/live":
                # tiny, fast-polled companion to /api/runs (a couple KB): only
                # the live ticker/phase/chips/record so text tracks the preview.
                self._send(200, json.dumps(store.live_snapshot()).encode("utf-8"), "application/json")
            elif path == "/api/meta":
                self._send(200, json.dumps(store.meta()).encode("utf-8"), "application/json")
            elif path == "/api/reference":
                # The signed-in Player's published bests and rivals, written
                # beside the runs by the LiveTrial console (player-reference.json).
                # Read on every call: it is small and the console rewrites it on
                # sign-in, progress refresh and capture start.
                self._send(200, json.dumps(store.reference()).encode("utf-8"), "application/json")
            elif path.startswith("/assets/") or path.startswith("/runs/") or path.startswith("/static/"):
                if path.startswith("/assets/"):
                    root, rel = store.assets_root, path[len("/assets/"):]
                elif path.startswith("/static/"):
                    root, rel = DASH, path[len("/static/"):]
                else:
                    root, rel = store.runs_dir, path[len("/runs/"):]
                try:
                    target = resolve_within(root, rel.replace("%20", " "))
                except UnsafePathError:
                    target = None
                if target is not None and target.is_file() \
                        and target.suffix.lower() in (".png", ".jpg", ".jpeg", ".mp4"):
                    ctypes = {".png": "image/png", ".mp4": "video/mp4"}
                    ctype = ctypes.get(target.suffix.lower(), "image/jpeg")
                    size = target.stat().st_size
                    start, end, code = 0, size - 1, 200
                    rng = self.headers.get("Range", "")
                    if rng.startswith("bytes="):  # video seeking needs 206 partials
                        try:
                            s, e = rng[6:].split("-", 1)
                            start = int(s) if s else 0
                            end = min(int(e), size - 1) if e else size - 1
                            code = 206
                        except ValueError:
                            start, end = 0, size - 1
                        if code == 206 and not 0 <= start <= end:
                            self._send(416, b"", "text/plain", {"Content-Range": f"bytes */{size}"})
                            return
                    self.send_response(code)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Accept-Ranges", "bytes")
                    if code == 206:
                        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                    self.send_header("Content-Length", str(end - start + 1))
                    self.send_header("Cache-Control", "max-age=3600")
                    self._security_headers()
                    self.end_headers()
                    with open(target, "rb") as f:  # stream chunks: mp4s are large
                        f.seek(start)
                        remaining = end - start + 1
                        while remaining > 0:
                            chunk = f.read(min(1 << 20, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                else:
                    self._send(404, b"not found", "text/plain")
            elif path in ("/api/record", "/api/settings") or path in _FORMER_GET_ACTIONS:
                # Read-only: what is set now. A change is a POST with the action proof;
                # an old-style change by query string is refused, not applied.
                if "?" in self.path or path in _FORMER_GET_ACTIONS:
                    self._json(405, {"ok": False, "error": "use POST"}, {"Allow": "POST"})
                else:
                    self._json(200, dict(store.record) if path == "/api/record" else asdict(store.settings))
            elif path == "/api/storage":
                self._send(200, json.dumps(store.storage_status()).encode(), "application/json")
            elif path == "/api/storage/cleanup":
                # GET only previews (dry=1) what a clean-up would remove; it deletes nothing.
                from urllib.parse import parse_qs, urlparse
                q = parse_qs(urlparse(self.path).query)
                if (q.get("dry") or ["0"])[0] != "1":
                    self._json(405, {"ok": False, "error": "use POST"}, {"Allow": "POST"})
                else:
                    self._json(200, store.cleanup(dry_run=True))
            elif path == "/api/export.csv":
                self._send(200, store.csv().encode("utf-8"), "text/csv; charset=utf-8")
            elif path == "/api/export.json":
                # portable head-to-head export: what another player can import
                self._send(200, json.dumps(store.export_runs()).encode(), "application/json")
            elif path == "/api/preview.jpg":
                from urllib.parse import parse_qs
                try:
                    shown = float(parse_qs(self.path.split("?", 1)[1]).get("shown", [""])[0]) if "?" in self.path else None
                except (ValueError, IndexError):
                    shown = None
                jpg = store.serve_preview(shown if shown is not None and 0 <= shown <= 240 else None)
                if jpg:
                    self._send(200, jpg, "image/jpeg")
                else:
                    self._send(404, b"no preview", "text/plain")
            elif path == "/api/stream.mjpg":
                # live MJPEG stream: pushes every preview frame (~15fps).
                # A socket send-timeout is ESSENTIAL: when a browser hides the
                # tab, refreshes, or navigates away it stops reading, but on
                # Windows the dead/stalled connection isn't reported until a
                # write actually fails — which can hang forever behind TCP
                # buffering. Each stuck stream keeps its own `while True` thread
                # alive, so they pile up (100+ threads seen) and starve the
                # analysis loop of the GIL → the feed slows "more and more".
                # The timeout makes a stalled write raise within 5 s so the
                # thread exits and the connection is reaped.
                self.connection.settimeout(5.0)
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.send_header("Cache-Control", "no-store")
                self._security_headers()
                self.send_header("Connection", "close")  # streamed, no Content-Length -> don't keep-alive under HTTP/1.1
                self.close_connection = True
                self.end_headers()
                seq = 0
                try:
                    while True:
                        got = store.wait_preview(seq, timeout=2.0)
                        if got is None:
                            if not store.live:
                                break
                            continue
                        seq, jpg = got
                        self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n"
                                         b"Content-Length: " + str(len(jpg)).encode() + b"\r\n\r\n")
                        self.wfile.write(jpg)
                        self.wfile.write(b"\r\n")
                except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, TimeoutError, OSError):
                    pass
            else:
                self._send(404, b"not found", "text/plain")

    return Handler


def _lan_ip() -> str | None:
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


class QuietServer(ThreadingHTTPServer):
    """Client disconnects (browser closing an MJPEG/preview request) are
    normal — don't spam tracebacks to stderr for them. At most
    MAX_CONNECTIONS connections are served at once; one more is closed."""

    lan = False                     # True only with --lan (read-only network viewing)
    daemon_threads = True

    def __init__(self, *args, **kwargs):
        self._slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()

    def handle_error(self, request, client_address):
        import sys as _sys
        if _sys.exc_info()[0] in (ConnectionAbortedError, ConnectionResetError,
                                  BrokenPipeError, TimeoutError):
            return
        super().handle_error(request, client_address)


def _bind(store: RunStore, port: int, lan: bool = False) -> ThreadingHTTPServer:
    host = "0.0.0.0" if lan else "127.0.0.1"
    try:
        httpd = QuietServer((host, port), make_handler(store))
    except OSError as e:
        raise SystemExit(
            f"Port {port} is already in use (another serve.py/watch.py?). "
            f"Close it or pass --port <other>.") from e
    # On the network the pages can be watched; changes stay with this computer.
    httpd.lan = bool(lan)
    print(f"LiveTrial dashboard: http://127.0.0.1:{port}/")
    if lan:
        ip = _lan_ip()
        if ip:
            store.lan_url = f"http://{ip}:{port}/"
            print(f"  LAN (phone/tablet): {store.lan_url}")
    return httpd


def serve(store: RunStore, port: int, lan: bool = False):
    _bind(store, port, lan).serve_forever()


def start_background(store: RunStore, port: int, lan: bool = False) -> threading.Thread:
    httpd = _bind(store, port, lan)  # bind in caller thread -> port errors are loud
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs-dir", default=str(HERE / "runs"))
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--lan", action="store_true",
                    help="also viewable on the local network (phone/tablet); control stays on this computer")
    args = ap.parse_args()
    serve(RunStore(Path(args.runs_dir)), args.port, lan=args.lan)


def _staff_splits() -> dict:
    """Nintendo staff-ghost splits recovered so far, plus coverage toward 192.
    The database has staff TOTALS for every entry but no splits; these come off
    the ghost's own result card and only from runs PROVEN to be staff ghosts."""
    try:
        from livetrial import identity_matcher as _cam
        from livetrial import staffsplits as _ss
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}
    try:
        res = _ss.scan(Path(__file__).resolve().parent / "runs", _cam._load_db())
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}
    doc = _ss.document(res["contributions"])
    doc["conflicts"] = res["conflicts"]
    return doc


def _delta_segments() -> dict:
    """The canonical 7-segment cell and digit patterns the decoder uses, so the
    calibrator draws exactly the boxes that are sampled rather than a likeness."""
    try:
        from livetrial import clock as _c
    except Exception:
        return {"segs": {}, "digits": {}}
    from livetrial import hudtimes as _h
    # The seven the digit patterns use, as (centre_x, centre_y, orientation) in
    # the canonical cell — not the nine boxes the database ships — PLUS the two
    # centred verticals, because the lap and coin counters draw '1' in the
    # middle while the clock draws it on the right. A field opts in through its
    # own grid `digits` override; no digit anywhere lights them otherwise, so
    # sending them changes nothing for the clock or the delta.
    return {"segs": {k: list(v) for k, v in _h.SEG_ALL.items()},
            "digits": {d: sorted(p) for d, p in _c.DIGITS.items()}}


# --- card-grid calibration helpers -------------------------------------------
# The calibration tool draws three things over a reference frame: the grid being
# edited, the COCO artwork boxes (to show the art sits INSIDE the uniform slot,
# which is a different object), and the real RGBA cut-outs of the loadout that
# frame shows (to prove the slot is aligned, not merely plausible).
_GRID_ART_CACHE: dict = {}


def _grid_artwork() -> dict:
    if _GRID_ART_CACHE:
        return _GRID_ART_CACHE
    import json as _j
    cfg = Path(__file__).resolve().parent / "config" / "card_grid.json"
    coco = Path(os.environ.get("MK8DX_COCO_REFERENCE", ""))
    try:
        want = {m: c["reference"] for m, c in
                _j.loads(cfg.read_text(encoding="utf-8"))["cards"].items()}
    except Exception:
        return {}
    out: dict = {m: [] for m in want}
    for split in ("train", "valid", "test"):
        f = coco / split / "_annotations.coco.json"
        if not f.is_file():
            continue
        try:
            j = _j.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        ids = {im["id"]: im["file_name"] for im in j["images"]}
        for a in j["annotations"]:
            fn = ids.get(a["image_id"])
            for m, ref in want.items():
                if fn == ref:
                    out[m].append([round(float(v)) for v in a["bbox"]])
    _GRID_ART_CACHE.update(out)
    return out


def _grid_assets(mode: str) -> dict:
    """Icon paths for the loadout the reference frame actually shows.

    These come from the SAME place the matcher's references come from —
    `identity_matcher._reference_sources`, i.e. `assets.score` for characters
    and `assets.default` for vehicle parts — not from `build_meta`, which
    serves `assets.menu` because the dashboard wants the portrait art. The
    overlay exists to prove a slot is aligned with what the MATCHER sees, so
    showing it any other artwork would make it a decoration that can agree
    while the matcher disagrees.
    """
    import cv2
    try:
        from livetrial.identity import IdentityReader
        from livetrial import identity_matcher as cam
    except Exception:
        return {}
    if mode not in ("3lap", "7lap"):
        return {}
    ref = Path(__file__).resolve().parent / "config" / "grid_refs" / f"{mode}.jpg"
    if not ref.is_file():
        return {}
    img = cv2.imread(str(ref))
    if img is None:
        return {}
    try:
        ids = IdentityReader().read(img, 7 if mode == "7lap" else 3)
    except Exception:
        return {}
    # id -> path, exactly as the matcher resolves it
    root = cam.assets_root()
    paths = {}
    try:
        for _group, rid, path, _name in cam._reference_sources(cam._load_db()):
            try:
                paths[rid] = str(Path(path).resolve().relative_to(Path(root).resolve()))
            except Exception:
                paths[rid] = str(path)
    except Exception:
        return {}
    # Which owner is on TOP is a property of the frame, not a constant: the
    # 3-lap reference has the ghost on top and the 7-lap reference has the
    # player on top. Assuming either one silently swaps the overlay and makes a
    # correct grid look wrong.
    import cv2 as _cv
    rgb = _cv.cvtColor(img, _cv.COLOR_BGR2RGB)
    rdr = IdentityReader()
    ys = {}
    for _o in ("player", "ghost"):
        _, _yv = rdr._probe._best_y(rgb, _o)
        if _yv is not None:
            ys[_o] = rdr._card_box(_yv, 7 if mode == "7lap" else 3)[1]
    top_owner = min(ys, key=ys.get) if ys else "ghost"

    out: dict = {"_topOwner": top_owner}
    for owner, rec in (ids or {}).items():
        if not rec:
            continue
        tag = "top" if owner == top_owner else "bottom"
        for field in ("character", "kart", "wheel", "glider", "flag"):
            pid = (rec.get(field) or {}).get("id")
            if pid and pid in paths:
                out[f"{tag}:{field}"] = paths[pid].replace("\\", "/")
    return out


if __name__ == "__main__":
    main()
