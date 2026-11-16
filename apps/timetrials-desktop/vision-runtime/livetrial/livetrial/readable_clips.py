"""Readable copies of finished clips, in one folder a person can browse.

Inside the runs folder a clip keeps its internal name (live_YYYYMMDD_HHMMSS/clip_HHMMSS_runNN.mp4): the
dashboard, the timeline pairing, the YouTube uploader and the storage clean-up all depend on it. Next to that,
every finished clip also gets an entry in one folder (by default Documents\\MK8DX\\LiveTrial-clips) named

    2026-11-16 10h25m  Mario Kart Stadium  150cc  1m46s784.mp4

date and time the clip started (local time), the track in LiveTrial's language, the class and the time, two
spaces between fields. Only letters, digits, spaces and '-' are used: apostrophes and other punctuation are
dropped, accents become plain letters. A language without Latin letters names the track in English so the
names stay ASCII. A field that is not known is left out ("Unknown track" for the track), never guessed.

The entry is a hard link when the folder is on the same volume (no extra disk space), otherwise a copy. It is
made on a background thread: a slow copy never holds up the analysis, and a failure is logged, never fatal.
The index `readable-clips.json` in the runs folder maps each internal clip to its entry, so the storage
clean-up removes the entry together with the clip (a pinned clip and its entry stay).
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import threading
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Callable

INDEX_NAME = "readable-clips.json"
SCHEMA = "mk8dx.livetrial-readable-clips.v1"
UNKNOWN_TRACK = "Unknown track"

# LiveTrial's language -> the Clean Assets locale of the track names. Languages written in another script
# (ru, ja, ko, zh-CN, zh-TW) are absent on purpose: their filenames use the English name.
TRACK_LOCALES = {
    "en": "en-GB", "en-US": "en-US", "nl": "nl-NL", "fr": "fr-FR", "fr-CA": "fr-CA", "de": "de-DE",
    "es": "es-ES", "es-419": "es-419", "it": "it-IT", "pt": "pt-PT",
}
ENGLISH_LOCALES = ("en-GB", "en-US")
# letters NFKD does not split into a base letter and an accent
_SPECIAL = {"ß": "ss", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L",
            "đ": "d", "Đ": "D", "ð": "d", "Ð": "D", "þ": "th", "Þ": "Th", "ı": "i"}
_APOSTROPHES = "'‘’ʼ`´"
_INDEX_LOCK = threading.Lock()


def ascii_words(text: object) -> str:
    """Only ASCII letters, digits, single spaces and '-': accents become plain letters, apostrophes vanish
    (Yoshi's -> Yoshis), any other character becomes a space."""
    if not isinstance(text, str):
        return ""
    value = "".join(_SPECIAL.get(ch, ch) for ch in text)
    value = "".join(ch for ch in unicodedata.normalize("NFKD", value) if not unicodedata.combining(ch))
    value = re.sub(f"[{_APOSTROPHES}]", "", value)
    value = re.sub(r"[^A-Za-z0-9 -]", " ", value)
    return re.sub(r"\s+", " ", value).strip(" ")


def class_label(cc: object) -> str | None:
    """50cc / 100cc / 150cc / 200cc / Mirror, or None when the class is not known."""
    value = str(cc or "").strip().lower().removesuffix("cc")
    if value in {"50", "100", "150", "200"}:
        return f"{value}cc"
    if value == "mirror":
        return "Mirror"
    return None


def time_label(ms: object) -> str | None:
    """1m46s784: minutes, two-digit seconds and three-digit milliseconds; None when there is no time."""
    if isinstance(ms, bool) or not isinstance(ms, (int, float)) or ms <= 0:
        return None
    ms = int(round(ms))
    return f"{ms // 60000}m{ms % 60000 // 1000:02d}s{ms % 1000:03d}"


def track_name(names: dict | None, language: str | None) -> str | None:
    """The track's name in LiveTrial's language (English for a non-Latin language), ASCII only."""
    if not isinstance(names, dict):
        return None
    wanted = TRACK_LOCALES.get(language or "", None)
    for locale in ((wanted,) if wanted else ()) + ENGLISH_LOCALES:
        value = ascii_words(names.get(locale))
        if value:
            return value
    return None


def readable_name(started: datetime, kind: str = "run", track: str | None = None, cc: object = None,
                  total_ms: object = None) -> str:
    """"2026-11-16 10h25m  Mario Kart Stadium  150cc  1m46s784.mp4" for a run, "<when>  Ghost <track> ..." for a
    ghost replay and "<when>  Manual" for a clip recorded with the record button."""
    when = f"{started:%Y-%m-%d %H}h{started:%M}m"
    if kind == "manual":
        fields = [when, "Manual"]
    else:
        place = ascii_words(track) or UNKNOWN_TRACK
        fields = [when, f"Ghost {place}" if kind == "ghost" else place, class_label(cc), time_label(total_ms)]
    return "  ".join(field for field in fields if field) + ".mp4"


def unique_target(folder: Path, name: str) -> Path:
    """`name` in `folder`, or "name (2).mp4", "name (3).mp4"... when that is taken."""
    target = folder / name
    stem, suffix = target.stem, target.suffix
    n = 2
    while target.exists():
        target = folder / f"{stem} ({n}){suffix}"
        n += 1
    return target


def place(source: Path, target: Path) -> str:
    """Hard link `target` to `source` (same volume), else copy it; "hardlink" or "copy"."""
    try:
        os.link(source, target)
        return "hardlink"
    except OSError:
        pass
    part = target.with_name(target.name + ".part")
    try:
        shutil.copyfile(source, part)
        os.replace(part, target)
    finally:
        try:
            part.unlink(missing_ok=True)
        except OSError:
            pass
    return "copy"


# -- the index in the runs folder -----------------------------------------------------------------------------

def index_path(runs_dir: Path) -> Path:
    return Path(runs_dir) / INDEX_NAME


def load_index(runs_dir: Path) -> dict:
    """{"<session>/<clip>": {"path", "name", "method", "bytes", "createdAt"}}; empty when absent or unreadable."""
    try:
        document = json.loads(index_path(runs_dir).read_text(encoding="utf-8"))
        clips = document.get("clips") if isinstance(document, dict) else None
        return {k: v for k, v in clips.items() if isinstance(k, str) and isinstance(v, dict)} \
            if isinstance(clips, dict) else {}
    except (OSError, ValueError, UnicodeError):
        return {}


def _save_index(runs_dir: Path, clips: dict) -> None:
    target = index_path(runs_dir)
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(f".{target.name}.{os.getpid()}.{threading.get_ident()}.part")
    part.write_text(json.dumps({"schemaVersion": SCHEMA, "clips": clips}, indent=1, ensure_ascii=False),
                    encoding="utf-8")
    os.replace(part, target)


def _remember(runs_dir: Path, rel: str, entry: dict) -> None:
    with _INDEX_LOCK:
        clips = load_index(runs_dir)
        clips[rel] = entry
        _save_index(runs_dir, clips)


def readable_entry(runs_dir: Path, rel: str) -> dict | None:
    """The index entry of one internal clip while its readable file is still there."""
    entry = load_index(runs_dir).get(rel)
    if entry and isinstance(entry.get("path"), str) and Path(entry["path"]).is_file():
        return entry
    return None


def remove_for(runs_dir: Path, rels: list) -> list:
    """Remove the readable entries of internal clips the clean-up removed. Only the exact file recorded for the
    clip is removed, and only while it still has the recorded size (a file the person replaced is left alone)."""
    removed = []
    with _INDEX_LOCK:
        clips = load_index(runs_dir)
        changed = False
        for rel in rels:
            entry = clips.pop(rel, None)
            if entry is None:
                continue
            changed = True
            path = entry.get("path")
            if not isinstance(path, str) or not path.lower().endswith(".mp4"):
                continue
            target = Path(path)
            try:
                if target.is_file() and not target.is_symlink() and target.stat().st_size == entry.get("bytes"):
                    target.unlink()
                    removed.append(str(target))
            except OSError as error:
                print(f"readable clip not removed: {target.name}: {type(error).__name__}")
        if changed:
            try:
                _save_index(runs_dir, clips)
            except OSError as error:
                print(f"readable clip index not saved: {type(error).__name__}")
    return removed


def database_track_names(assets_root: Path) -> Callable[[str], dict | None]:
    """trackId -> {locale: name} from the Clean Assets database, read once on first use."""
    cache: dict = {}

    def names(track_id: str) -> dict | None:
        if "tracks" not in cache:
            try:
                db = json.loads((Path(assets_root) / "database.json").read_text(encoding="utf-8"))
                cache["tracks"] = {t["id"]: t.get("names") or {} for t in db["collections"]["tracks"]}
            except Exception:  # noqa: BLE001 - a missing database only costs the track name
                cache["tracks"] = {}
        return cache["tracks"].get(track_id)

    return names


class ReadableClips:
    """Makes the readable entries on one background thread, in the order the clips finished."""

    def __init__(self, runs_dir: Path, folder: Path, language: str | None = None,
                 names: Callable[[str], dict | None] | None = None, log: Callable[[str], None] = print):
        self.runs_dir = Path(runs_dir)
        self.folder = Path(folder)
        self.language = language
        self.names = names or (lambda _track_id: None)
        self.log = log
        self._queue: queue.Queue = queue.Queue()
        self._thread: threading.Thread | None = None

    def submit(self, clip: Path, started: datetime | None, kind: str = "run", track_id: str | None = None,
               cc: object = None, total_ms: object = None) -> None:
        """Queue one finished clip; returns at once."""
        self._queue.put((Path(clip), started, kind, track_id, cc, total_ms))
        if self._thread is None:
            self._thread = threading.Thread(target=self._work, name="readable-clips", daemon=True)
            self._thread.start()

    def close(self, timeout: float = 60.0) -> None:
        """Wait (bounded) until the queued entries are made, at the end of a session."""
        deadline = time.monotonic() + timeout
        while self._queue.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.05)

    def _work(self) -> None:
        while True:
            item = self._queue.get()
            try:
                self.make(*item)
            except Exception as error:  # noqa: BLE001 - never fatal: the internal clip is untouched
                self.log(f"readable clip not made for {item[0].name}: {type(error).__name__}: {error}")
            finally:
                self._queue.task_done()

    def make(self, clip: Path, started: datetime | None, kind: str = "run", track_id: str | None = None,
             cc: object = None, total_ms: object = None) -> Path | None:
        """Make the entry now (the worker's step; also what tests call)."""
        clip = Path(clip)
        if clip.suffix.lower() != ".mp4" or not clip.is_file():
            return None
        if started is None:
            started = datetime.fromtimestamp(clip.stat().st_mtime)
        track = None
        if track_id and str(track_id).upper() != "UNKNOWN":
            track = track_name(self.names(track_id), self.language)
        name = readable_name(started, kind, track, cc, total_ms)
        self.folder.mkdir(parents=True, exist_ok=True)
        target = unique_target(self.folder, name)
        method = place(clip, target)
        rel = f"{clip.parent.name}/{clip.name}"
        _remember(self.runs_dir, rel, {"path": str(target), "name": target.name, "method": method,
                                       "bytes": target.stat().st_size, "createdAt": time.time()})
        self.log(f"readable clip: {target.name} ({method})")
        return target
