"""Clip retention: what to keep on disk, what to drop, and what to warn about.

Auto-recording produces one clip per run at CRF 18, so a session is measured in
gigabytes and an unattended capture box fills its disk. Deleting "oldest first"
is not good enough: the clips people actually care about are the ones behind a
personal best or a new record, and those are exactly the ones that age out
first once a track is being practised.

So retention is PROTECT-then-trim:

  1. pinned by the user                     — never touched
  2. the latest NEW RECORD per track+cc     — the run that beat the ghost
  3. the fastest run (PB) per track+cc      — the reference lap
  4. the newest `keepLatest` clips          — recent context while practising
  5. everything else, oldest first, until the total fits `maxTotalGb`

The protected set is never deleted to satisfy the budget. If protection alone
exceeds the budget that is a CONFLICT the user has to resolve, so it is
reported as a warning instead of being silently resolved by throwing away a
record — a policy that quietly deletes what it promised to keep is worse than
one that says it cannot comply.

Pure functions over a scanned inventory (`scan` -> `plan` -> `apply`), so the
policy is testable without touching a disk: see tests/test_storage.py.
"""

from __future__ import annotations

import json
import re
import shutil
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"
SETTINGS_PATH = CONFIG_DIR / "storage.json"
GB = 1024 ** 3
_CLIP_RE = re.compile(r"^clip_(\d{6})(?:_run(\d+))?\.(mp4|mkv)$")
TRACK_COUNT = 96      # MK8DX courses incl. the Booster Course Pass


@dataclass
class Settings:
    recordVideo: bool = True        # False = keep only the end-screen stills
    maxTotalGb: float = 50.0        # budget for ALL clips together
    recordHeight: int = 1080        # cap clip height: 720 (minimum) / 1080 / 1440 / 2160
                                    # (0 = record at the capture card's own resolution)
    keepLatest: int = 20            # newest clips always kept
    keepRecords: bool = True        # latest new-record clip per track+cc
    keepBest: bool = True           # fastest run's clip per track+cc
    minFreeGb: float = 5.0          # warn (and optionally stop) below this
    autoCleanup: bool = True        # trim automatically after each clip
    pauseRecordingWhenLow: bool = True   # stop recording rather than fill the disk
    # Console language. The result card prints names in the SWITCH's language,
    # and the database carries 14 locales — naming yours cuts the character-name
    # vocabulary from 668 strings (232 of which collide with a DIFFERENT
    # character) to ~109 with English as the fallback. "" = try them all.
    switchLanguage: str = ""             # e.g. "nl-NL", "de-DE", "" = auto

    def locales(self) -> list[str]:
        """Console language first, English as the fallback — a preference, not a
        filter, so a wrong or unset value can never make a name unreadable."""
        pref = [self.switchLanguage] if self.switchLanguage else []
        return pref + [l for l in ("en-US", "en-GB") if l not in pref]

    @staticmethod
    def load(path: Path = SETTINGS_PATH) -> "Settings":
        s = Settings()
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            for k, v in raw.items():
                if hasattr(s, k) and v is not None:
                    setattr(s, k, type(getattr(s, k))(v))
        except Exception:
            pass
        return s

    def save(self, path: Path = SETTINGS_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=1), encoding="utf-8")

    def sane(self) -> "Settings":
        self.maxTotalGb = max(0.5, float(self.maxTotalGb))
        self.keepLatest = max(0, int(self.keepLatest))
        self.minFreeGb = max(0.0, float(self.minFreeGb))
        # 720p is the supported floor: the analysis canvas is 1280x720, so a
        # smaller clip cannot be re-analysed. 0 means "whatever the card gives".
        h = int(self.recordHeight or 0)
        self.recordHeight = 0 if h == 0 else max(MIN_HEIGHT, h)
        return self


@dataclass
class Clip:
    path: Path
    bytes: int
    mtime: float
    session: str
    run: int | None = None
    track: str | None = None
    cc: str | None = None
    timeMs: int | None = None
    newRecord: bool = False
    pinned: bool = False
    seconds: float = 0.0
    reasons: list = field(default_factory=list)

    @property
    def rel(self) -> str:
        return f"{self.session}/{self.path.name}"


def mp4_duration(path: Path) -> float:
    """Seconds from the mp4 header (moov/mvhd), stdlib only — no ffprobe.

    Turns the budget from an abstract byte count into something a user can
    reason about ("how many runs / how many hours still fit"), which matters
    most at the big end: 700 GB is meaningless as a percentage bar, but
    "≈1000 runs, 41 h" is not. Reads a few KB per file, not the whole clip."""
    try:
        with open(path, "rb") as f:
            end = path.stat().st_size
            pos = 0
            while pos < end:                      # top level: find moov
                f.seek(pos)
                head = f.read(8)
                if len(head) < 8:
                    return 0.0
                size = int.from_bytes(head[:4], "big")
                typ = head[4:8]
                if size == 1:                     # 64-bit extended size
                    size = int.from_bytes(f.read(8), "big")
                if size < 8:
                    return 0.0
                if typ == b"moov":
                    inner, stop = pos + 8, pos + size
                    while inner < stop:           # inside moov: find mvhd
                        f.seek(inner)
                        h2 = f.read(8)
                        if len(h2) < 8:
                            return 0.0
                        s2 = int.from_bytes(h2[:4], "big")
                        if s2 < 8:
                            return 0.0
                        if h2[4:8] == b"mvhd":
                            ver = f.read(1)[0]
                            f.read(3)             # flags
                            if ver == 1:
                                f.read(16)        # created/modified (64-bit)
                                ts = int.from_bytes(f.read(4), "big")
                                dur = int.from_bytes(f.read(8), "big")
                            else:
                                f.read(8)         # created/modified (32-bit)
                                ts = int.from_bytes(f.read(4), "big")
                                dur = int.from_bytes(f.read(4), "big")
                            return dur / ts if ts else 0.0
                        inner += s2
                    return 0.0
                pos += size
    except Exception:
        return 0.0
    return 0.0


# Recording resolutions. 720p is the supported MINIMUM — the analysis canvas is
# 1280x720, so anything lower loses detail the reader needs; anything higher is
# only for the clip's own sake. Bitrate at a constant CRF scales with pixel
# count, anchored on a measured 1080p clip (4.60 MB/s) and checked against a
# 720p re-encode at the same settings (measured 1.82 MB/s vs 2.04 modelled, so
# the model is ~12% conservative — it over-estimates rather than surprises).
RESOLUTIONS = {"720p": (1280, 720), "1080p": (1920, 1080),
               "1440p": (2560, 1440), "2160p": (3840, 2160)}
MIN_HEIGHT = 720
BYTES_PER_SEC_1080P = 4.60 * 1e6
# Everything a clip carries beyond the race itself: the pre-roll ring, the 3 s
# countdown, the result-screen read and the 2.5 s tail. MEASURED at 22-28 s
# across five complete runs (the ring is cleared at every clip start, so runs
# seldom get the full 15 s pre-roll — modelling it as 15+25 ran 12% long).
OVERHEAD_S = 25.0
# A human vs the staff ghost: measured 1.01-1.09 (median 1.04) on PB-quality
# runs. Kept at 1.10 because practice runs are slower than the keeper, and an
# under-provisioned disk is worse than a slightly large one.
HUMAN_FACTOR = 1.10
# The estimate is deliberately conservative — but the margin is stated here
# rather than buried in a wrong constant, so the numbers mean what they say.
SAFETY = 1.15
MIN_PRACTICE_CLIPS = 15  # headroom on top of one keeper per course


def bytes_per_second(height: int, anchor_1080: float = BYTES_PER_SEC_1080P) -> float:
    w = int(round(height * 16 / 9))
    return anchor_1080 * (w * height) / (1920 * 1080)


def requirements(db_path: Path | None = None, *, cc: int = 150,
                 anchor_1080: float | None = None, keep_latest: int = 20) -> dict:
    """How much disk a full collection actually needs, per resolution.

    Per-track clip length comes from the game's own NINTENDO STAFF GHOST times
    (all 96 courses are in the database) + 10% for a human player, plus the
    pre-roll and the result-screen read that every clip carries. That beats a
    flat "clips are ~2 minutes" guess, because course length varies 2:1 across
    the roster (77 s to 170 s at 150cc)."""
    db_path = db_path or (Path(__file__).resolve().parents[2] / "MK8DX Clean Assets" / "database.json")
    try:
        db = json.loads(Path(db_path).read_text(encoding="utf-8"))
        times = [r["timeMs"] / 1000.0 for r in db["collections"]["nintendoStaffTimes"]
                 if int(r.get("mode") or 0) == cc]
    except Exception:
        times = []
    if not times:
        return {}
    per_track = [t * HUMAN_FACTOR + OVERHEAD_S for t in times]
    collection_s = sum(per_track)
    avg_s = collection_s / len(per_track)
    anchor = anchor_1080 or BYTES_PER_SEC_1080P
    out = {"courses": len(times), "cc": cc, "avgClipSeconds": round(avg_s, 1),
           "collectionSeconds": round(collection_s), "resolutions": {}}
    for name, (w, h) in RESOLUTIONS.items():
        bps = bytes_per_second(h, anchor)
        out["resolutions"][name] = {
            "width": w, "height": h,
            "bytesPerSecond": round(bps),
            "gbPerHour": round(bps * 3600 / GB, 1),
            "gbPerClip": round(avg_s * bps / GB, 2),
            "minimumGb": round((collection_s + MIN_PRACTICE_CLIPS * avg_s) * bps / GB * SAFETY, 1),
            "recommendedGb": round((collection_s + keep_latest * avg_s) * bps / GB * SAFETY * 1.25, 1),
            "supported": h >= MIN_HEIGHT,
        }
    return out


def ms_to_clock(ms) -> str:
    if not ms:
        return ""
    s = ms / 1000.0
    return f"{int(s // 60)}:{s % 60:06.3f}"


def pins_path(runs_dir: Path) -> Path:
    return runs_dir / "pinned.json"


def load_pins(runs_dir: Path) -> set:
    try:
        return set(json.loads(pins_path(runs_dir).read_text(encoding="utf-8")))
    except Exception:
        return set()


def toggle_pin(runs_dir: Path, rel: str) -> bool:
    pins = load_pins(runs_dir)
    pins.symmetric_difference_update({rel})
    runs_dir.mkdir(parents=True, exist_ok=True)
    pins_path(runs_dir).write_text(json.dumps(sorted(pins)), encoding="utf-8")
    return rel in pins


def scan(runs_dir: Path) -> list[Clip]:
    """Every clip on disk, joined to the run it belongs to (track / time /
    new-record), which is what makes a meaningful retention decision possible."""
    runs_dir = Path(runs_dir)
    pins = load_pins(runs_dir)
    by_run: dict = {}
    for rp in runs_dir.glob("*/report.json"):
        try:
            rep = json.loads(rp.read_text(encoding="utf-8"))
        except Exception:
            continue
        for run in rep.get("runs", []):
            ctx = run.get("context") or {}
            tn = ctx.get("trackName") or {}
            player = ((run.get("results") or {}).get("player") or {})
            by_run[(rp.parent.name, run.get("run"))] = {
                "track": tn.get("trackId"), "cc": ctx.get("cc") or "150",
                "timeMs": player.get("totalMs"),
                "newRecord": any(e.get("type") == "banner_new_record"
                                 for e in (run.get("events") or [])),
            }
    out: list[Clip] = []
    for p in sorted(runs_dir.glob("*/clip_*")):
        m = _CLIP_RE.match(p.name)
        if not m:
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        run_no = int(m.group(2)) if m.group(2) else None
        info = by_run.get((p.parent.name, run_no), {})
        out.append(Clip(path=p, bytes=st.st_size, mtime=st.st_mtime,
                        seconds=mp4_duration(p),
                        session=p.parent.name, run=run_no,
                        track=info.get("track"), cc=info.get("cc"),
                        timeMs=info.get("timeMs"),
                        newRecord=bool(info.get("newRecord")),
                        pinned=f"{p.parent.name}/{p.name}" in pins))
    return out


def count_stills(runs_dir: Path) -> dict:
    """End-screen stills: one per run, ~200 KB, and NEVER trimmed. They are the
    permanent record — times, both loadouts, the banner — so they outlive the
    clip they came from and are reported separately from the clip budget."""
    n = b = 0
    for p in Path(runs_dir).glob("*/run_*_endscreen.jpg"):
        try:
            b += p.stat().st_size
            n += 1
        except OSError:
            pass
    return {"count": n, "bytes": b}


def plan(clips: list[Clip], settings: Settings, *, free_bytes: int | None = None,
         stills: dict | None = None) -> dict:
    """Decide keep/delete without touching anything. Returns a full report so
    the dashboard can explain every decision instead of just doing it."""
    settings = settings.sane()
    stills = stills or {"count": 0, "bytes": 0}
    clips = sorted(clips, key=lambda c: c.mtime, reverse=True)   # newest first
    budget = int(settings.maxTotalGb * GB)

    for c in clips:
        c.reasons = []
    if settings.keepRecords:
        seen: set = set()
        for c in clips:                      # newest first -> LATEST record wins
            if not c.newRecord:
                continue
            if c.track is None:
                # A new record whose track was never identified (a clip that
                # starts mid-race, or a session without the menu screens) is
                # still a record. There is no track to keep "the latest per"
                # by, so protect it on its own rather than let the one clip the
                # user most wants fall through to the oldest-first trim.
                c.reasons.append("record")
            elif (c.track, c.cc) not in seen:
                seen.add((c.track, c.cc))
                c.reasons.append("record")
    if settings.keepBest:
        best: dict = {}
        for c in clips:
            if c.track and c.timeMs:
                k = (c.track, c.cc)
                if k not in best or c.timeMs < best[k].timeMs:
                    best[k] = c
        for c in best.values():
            c.reasons.append("best")
    for c in clips[:settings.keepLatest]:
        c.reasons.append("latest")
    for c in clips:
        if c.pinned:
            c.reasons.insert(0, "pinned")

    protected = [c for c in clips if c.reasons]
    optional = [c for c in clips if not c.reasons]
    prot_bytes = sum(c.bytes for c in protected)

    # trim the unprotected, oldest first, until the whole set fits the budget
    keep, delete = list(protected), []
    total = prot_bytes
    for c in sorted(optional, key=lambda c: c.mtime, reverse=True):
        if total + c.bytes <= budget:
            keep.append(c)
            total += c.bytes
        else:
            delete.append(c)

    warnings = []
    if prot_bytes > budget:
        warnings.append({
            "level": "warn", "code": "protected_over_budget",
            "bytes": prot_bytes,
            "text": f"Protected clips already use {prot_bytes / GB:.1f} GB, over the "
                    f"{settings.maxTotalGb:.1f} GB budget. Nothing protected is deleted — "
                    f"raise the budget, unpin, or reduce 'keep latest'."})
    latest_bytes = sum(c.bytes for c in clips[:settings.keepLatest])
    if settings.keepLatest and latest_bytes > budget:
        warnings.append({
            "level": "warn", "code": "keep_latest_over_budget",
            "bytes": latest_bytes,
            "text": f"The newest {settings.keepLatest} clips are {latest_bytes / GB:.1f} GB, "
                    f"more than the {settings.maxTotalGb:.1f} GB budget."})
    if free_bytes is not None:
        # A budget the disk cannot physically honour is a setting, not a state:
        # say so up front rather than let it look fine until the disk fills.
        # (Room for the budget = what is free now PLUS what clips already hold.)
        headroom = free_bytes + sum(c.bytes for c in clips) - int(settings.minFreeGb * GB)
        if budget > headroom:
            warnings.append({
                "level": "warn", "code": "budget_exceeds_disk", "bytes": headroom,
                "text": f"The {settings.maxTotalGb:.0f} GB budget does not fit this disk: "
                        f"only {max(0, headroom) / GB:.0f} GB is available for clips once the "
                        f"{settings.minFreeGb:.0f} GB free-space floor is kept. Clips will stop "
                        f"at the floor, not at the budget."})
        need = int(settings.minFreeGb * GB)
        if free_bytes < need:
            warnings.append({
                "level": "alert", "code": "low_disk", "bytes": free_bytes,
                "text": f"Only {free_bytes / GB:.1f} GB free, below the "
                        f"{settings.minFreeGb:.1f} GB floor."
                        + (" Recording is paused." if settings.pauseRecordingWhenLow else "")})
        elif free_bytes < need * 2:
            warnings.append({
                "level": "info", "code": "disk_getting_low", "bytes": free_bytes,
                "text": f"{free_bytes / GB:.1f} GB free — approaching the "
                        f"{settings.minFreeGb:.1f} GB floor."})

    # CAPACITY, measured from this library rather than assumed. A percentage
    # bar is useless at the big end — 4.6 GB of a 700 GB budget reads as 0.7%
    # and tells you nothing — but "≈980 more runs, ≈41 h" is actionable.
    all_bytes = sum(c.bytes for c in clips)
    all_secs = sum(c.seconds for c in clips)
    # size a "typical run clip" off COMPLETE runs (a run with a time): aborted
    # fragments are small and would flatter the estimate
    full = [c for c in clips if c.timeMs and c.seconds > 30]
    per_clip = (sum(c.bytes for c in full) / len(full)) if full else \
               (all_bytes / len(clips) if clips else 0)
    per_sec = (all_bytes / all_secs) if all_secs > 0 else 0
    room = max(0, budget - total)
    capacity = {
        "bytesPerClip": int(per_clip), "bytesPerSecond": round(per_sec, 1),
        "secondsStored": round(all_secs),
        "gbPerHour": round(per_sec * 3600 / GB, 2) if per_sec else 0,
        "remainingBytes": room,
        "remainingClips": int(room / per_clip) if per_clip else None,
        "remainingSeconds": int(room / per_sec) if per_sec else None,
        "usedPct": round(100 * total / budget, 1) if budget else 0,
    }
    # What the budget WOULD need to be, in this library's own clip sizes, to
    # hold the thing people actually ask for: one keeper per course. MK8DX has
    # 96 courses, so the answer is a measurement, not a guess — and it belongs
    # next to the setting rather than in a manual.
    if per_clip:
        capacity["recommend"] = {
            "courses": TRACK_COUNT,
            "minBytes": int(TRACK_COUNT * per_clip),                       # one PB each
            "recommendedBytes": int((TRACK_COUNT + settings.keepLatest) * per_clip),
        }

    return {
        "settings": asdict(settings),
        "capacity": capacity,
        "stills": stills,
        "totals": {"clips": len(clips), "bytes": all_bytes,
                   "protectedBytes": prot_bytes, "keepBytes": total,
                   "freeableBytes": sum(c.bytes for c in delete),
                   "seconds": round(all_secs),
                   "sessions": len({c.session for c in clips})},
        "keep": [{"file": c.rel, "bytes": c.bytes, "reasons": c.reasons,
                  "track": c.track, "cc": c.cc, "timeMs": c.timeMs,
                  "mtime": c.mtime, "pinned": c.pinned} for c in keep],
        "delete": [{"file": c.rel, "bytes": c.bytes, "track": c.track,
                    "cc": c.cc, "mtime": c.mtime} for c in delete],
        "warnings": warnings,
    }


def apply(runs_dir: Path, decided: dict, *, dry_run: bool = False) -> dict:
    """Delete what the plan marked deletable. Only ever removes files that the
    plan listed, and only clip files — never a report, crop or session dir."""
    freed, removed, errors = 0, [], []
    for item in decided.get("delete", []):
        p = Path(runs_dir) / item["file"]
        if not p.is_file() or not _CLIP_RE.match(p.name):
            continue
        if dry_run:
            freed += item["bytes"]
            removed.append(item["file"])
            continue
        try:
            p.unlink()
            freed += item["bytes"]
            removed.append(item["file"])
        except OSError as e:
            errors.append(f"{item['file']}: {e}")
    return {"freedBytes": freed, "removed": removed, "errors": errors,
            "dryRun": bool(dry_run)}


def disk_free(path: Path) -> tuple[int, int]:
    try:
        u = shutil.disk_usage(str(path))
        return int(u.free), int(u.total)
    except Exception:
        return 0, 0


def status(runs_dir: Path, settings: Settings | None = None) -> dict:
    """Everything the dashboard needs in one call: inventory, plan, disk, and
    whether recording should be held off."""
    runs_dir = Path(runs_dir)
    settings = settings or Settings.load()
    free, total = disk_free(runs_dir if runs_dir.exists() else runs_dir.parent)
    p = plan(scan(runs_dir), settings, free_bytes=free or None,
             stills=count_stills(runs_dir))
    p["disk"] = {"freeBytes": free, "totalBytes": total}
    p["requirements"] = requirements(keep_latest=settings.keepLatest)
    p["blockRecording"] = bool(settings.pauseRecordingWhenLow and free
                               and free < settings.minFreeGb * GB)
    p["checkedAt"] = time.time()
    return p


def cleanup(runs_dir: Path, settings: Settings | None = None, *, dry_run: bool = False) -> dict:
    st = status(runs_dir, settings)
    res = apply(runs_dir, st, dry_run=dry_run)
    res["planned"] = len(st["delete"])
    res["warnings"] = st["warnings"]
    return res
