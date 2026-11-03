"""The clips LiveTrial kept on this PC, and what is known about each (ADR-0213).

The engine keeps one clip per race in the session folder it writes its report
to: ``<data root>/runs/<session>/clip_HHMMSS_runNN.mp4`` (the run history on
port 8777 lists the same files). This module only reads them:

* ``list_clips`` - the newest clips with the facts the run's ``report.json``
  really recorded (track, engine class, the recognized time, each lap's time,
  coins and mushrooms, and the race's moments); a fact the engine did not
  recognize is left out, never guessed. Each moment also gets its position
  in the video (seconds from the clip's 0:00), so a description can link to
  it: from the timeline the engine writes beside a clip
  (``clip_HHMMSS_runNN.timeline.json``), or, for a clip recorded before that,
  from the clip's own length, its pre-roll and the moment the engine saved it
  (see ``legacy_clip_clock``);
* ``mk8dx_video_metadata`` - the MK8DX profile's title and description for a
  clip. Other LiveTrial profiles can supply their own function; the uploader
  takes any ``VideoMetadata``;
* ``ClipUploadRecords`` - which clip became which YouTube video, so a clip is
  shown as uploaded and is not uploaded twice by accident.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
import time

from livetrial_youtube import VideoMetadata


# A run's clip is clip_HHMMSS_runNN.mp4; a ghost replay's clip is clip_HHMMSS.mp4,
# named by that session's ghosts.json (the engine's ad-hoc clip shape, so the
# storage budget counts and trims it like any clip).
CLIP_NAME = re.compile(r"^clip_(\d{6})(?:_run(\d{2,3}))?\.mp4$")
GHOSTS_DOCUMENT = "ghosts.json"
MAX_GHOSTS_BYTES = 4 * 1024 * 1024
SESSION_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$")
UPLOAD_RECORDS_NAME = "youtube-uploads.json"
UPLOAD_RECORDS_SCHEMA_VERSION = "mk8dx.livetrial-youtube-uploads.v1"
MAX_REPORT_BYTES = 16 * 1024 * 1024
MAX_RECORDS_BYTES = 4 * 1024 * 1024
MAX_RECORDS = 20_000
DEFAULT_CLIP_LIMIT = 60
MAX_TIMELINE_BYTES = 2 * 1024 * 1024
MAX_STILL_BYTES = 8 * 1024 * 1024
TIMELINE_SCHEMA_VERSION = "mk8dx.livetrial-clip-timeline.v1"
MAX_MOMENTS = 80
PREROLL_SECONDS = 15.0          # the engine's pre-roll ring: 225 JPEGs at ~15 fps
MAX_MP4_HEADER_BYTES = 64 * 1024 * 1024


class LiveTrialClipError(RuntimeError):
    """A plain-language clip failure without private paths."""


def _fail(message: str) -> None:
    raise LiveTrialClipError(message) from None


def clip_id_for(session: str, name: str) -> str:
    return f"{session}/{name}"


def resolve_clip(runs_root: str | Path, clip_id: object) -> Path:
    """The clip file for an id from the page; anything else is refused."""
    if not isinstance(clip_id, str) or clip_id.count("/") != 1:
        _fail("That clip is not on this PC.")
    session, name = clip_id.split("/")
    if SESSION_NAME.fullmatch(session) is None or session.startswith(("_", ".")) or session == "latest" \
            or CLIP_NAME.fullmatch(name) is None:
        _fail("That clip is not on this PC.")
    root = Path(runs_root)
    path = root / session / name
    try:
        if path.is_symlink() or not path.is_file() or path.resolve().parent.parent != root.resolve():
            _fail("That clip is not on this PC any more.")
    except OSError:
        _fail("That clip is not on this PC any more.")
    return path


def endscreen_path(runs_root: str | Path, clip_id: object) -> Path | None:
    """The end-screen still the engine keeps beside a run (``run_NN_endscreen.jpg``), if any."""
    try:
        clip = resolve_clip(runs_root, clip_id)
    except LiveTrialClipError:
        return None
    run_group = CLIP_NAME.fullmatch(clip.name).group(2)
    # a run's end screen, or for a ghost replay the ghost's panel
    still = (clip.parent / f"run_{int(run_group):02d}_endscreen.jpg" if run_group
             else clip.with_name(clip.stem + ".panel.jpg"))
    try:
        if still.is_file() and not still.is_symlink() and 0 < still.stat().st_size <= MAX_STILL_BYTES:
            return still
    except OSError:
        return None
    return None


def format_race_time(time_ms: int) -> str:
    minutes, rest = divmod(int(time_ms), 60_000)
    seconds, millis = divmod(rest, 1000)
    return f"{minutes}:{seconds:02d}.{millis:03d}"


def _report_runs(session_dir: Path) -> dict[int, dict]:
    report = session_dir / "report.json"
    try:
        if not report.is_file() or report.is_symlink() or report.stat().st_size > MAX_REPORT_BYTES:
            return {}
        document = json.loads(report.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return {}
    runs = document.get("runs") if isinstance(document, dict) else None
    return {run["run"]: run for run in runs or [] if isinstance(run, dict) and isinstance(run.get("run"), int)}


def load_timeline(clip: Path) -> list[tuple[int, int]] | None:
    """The clip's anchors ``(video frame, session ms)``, or ``None`` when the
    engine that recorded it did not write one (clips before ADR-0213)."""
    path = clip.with_name(clip.stem + ".timeline.json")
    try:
        if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_TIMELINE_BYTES:
            return None
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return None
    if not isinstance(document, dict) or document.get("schemaVersion") != TIMELINE_SCHEMA_VERSION \
            or document.get("fps") != 30 or not isinstance(document.get("anchors"), list):
        return None
    anchors = []
    for row in document["anchors"]:
        if (isinstance(row, list) and len(row) == 2 and all(isinstance(v, int) and not isinstance(v, bool) for v in row)
                and (not anchors or (row[0] > anchors[-1][0] and row[1] >= anchors[-1][1]))):
            anchors.append((row[0], row[1]))
    return anchors or None


def timeline_position(anchors: list[tuple[int, int]] | None, session_ms: int) -> float | None:
    """Where a session moment is in the clip, in seconds from its 0:00; ``None``
    when it is outside what the clip shows or falls in a cut pause."""
    if not anchors or session_ms < anchors[0][1]:
        return None
    for (frame, at), (next_frame, next_at) in zip(anchors, anchors[1:]):
        if at <= session_ms < next_at:
            span_frames = next_frame - frame
            # a jump in time between two anchors is a cut: nothing in between is on video
            if next_at - at > span_frames * 1000 / 30 + 1000:
                return None if session_ms > at + span_frames * 1000 / 30 else (frame + (session_ms - at) * 30 / 1000) / 30
            return (frame + (session_ms - at) / (next_at - at) * span_frames) / 30
    frame, at = anchors[-1]
    if session_ms - at > 2000:   # after the last anchor: at most the ~1 s to the clip's end
        return None
    return (frame + (session_ms - at) * 30 / 1000) / 30


def video_second(anchors: list[tuple[int, int]] | None, session_ms: int) -> int | None:
    position = timeline_position(anchors, session_ms)
    return None if position is None else int(position)


def mp4_duration_seconds(path: Path) -> float | None:
    """The movie length from the MP4's ``mvhd`` box (no ffprobe needed)."""
    try:
        with open(path, "rb") as handle:
            size_total = path.stat().st_size
            offset = 0
            while offset + 8 <= size_total:
                handle.seek(offset)
                header = handle.read(16)
                size = int.from_bytes(header[0:4], "big")
                kind = header[4:8]
                body = offset + 8
                if size == 1:
                    size = int.from_bytes(header[8:16], "big")
                    body = offset + 16
                elif size == 0:
                    size = size_total - offset
                if size < 8:
                    return None
                if kind == b"moov":
                    if size > MAX_MP4_HEADER_BYTES:
                        return None
                    handle.seek(body)
                    moov = handle.read(size - (body - offset))
                    at = moov.find(b"mvhd")
                    if at < 4:
                        return None
                    box = moov[at + 4:]
                    if box[0] == 1:
                        scale = int.from_bytes(box[20:24], "big")
                        duration = int.from_bytes(box[24:32], "big")
                    else:
                        scale = int.from_bytes(box[12:16], "big")
                        duration = int.from_bytes(box[16:20], "big")
                    return duration / scale if scale else None
                offset += size
    except (OSError, IndexError):
        return None
    return None


def _clip_saved_ms(runs: dict[int, dict], clip_name: str) -> dict[str, int]:
    """The engine's live log says when each clip of the session was saved."""
    saved: dict[str, int] = {}
    for run in runs.values():
        for row in run.get("liveLog") or []:
            message = row.get("msg") if isinstance(row, dict) else None
            at = row.get("t") if isinstance(row, dict) else None
            if isinstance(message, str) and message.startswith("Clip saved: ") and isinstance(at, int):
                saved.setdefault(message.removeprefix("Clip saved: ").strip(), at)
    return saved


def legacy_clip_clock(run: dict, runs: dict[int, dict], clip: Path):
    """Seconds into a clip recorded before the timeline, or ``None``.

    Such a clip is its pre-roll followed by the live frames from the moment the
    run was armed until the engine saved it. The pre-roll is 15 s when the ring
    had that long to fill since the previous clip, else that gap. The live part
    was written at whatever rate the recorder managed while claiming 30 fps, so
    its speed is measured: (length - pre-roll) / (saved - armed). Older builds
    managed ~93 % (7 Sept 2026: checked on the race clock, still exact), so a
    certain full pre-roll accepts 0.85-1.02; after a quick restart the pre-roll
    is itself an estimate, and only 0.94-1.02 is trusted. Outside that nothing
    is placed.
    """
    armed = run.get("armedAtMs")
    saved = _clip_saved_ms(runs, clip.name)
    stop = saved.get(clip.name)
    length = mp4_duration_seconds(clip)
    if not isinstance(armed, int) or isinstance(armed, bool) or stop is None or length is None or stop <= armed:
        return None
    previous = [at for name, at in saved.items() if name != clip.name and at <= armed]
    gap_seconds = (armed - (max(previous) if previous else 0)) / 1000
    preroll = min(PREROLL_SECONDS, gap_seconds)
    speed = (length - preroll) / ((stop - armed) / 1000)
    lowest = 0.85 if gap_seconds >= PREROLL_SECONDS + 1 else 0.94
    if preroll < 0 or not lowest <= speed <= 1.02:
        return None

    def position(session_ms: int) -> float | None:
        second = preroll + (session_ms - armed) / 1000 * speed
        return second if 0 <= second <= length else None

    return position


def _events(run: dict) -> list[dict]:
    events = run.get("events") if isinstance(run.get("events"), list) else []
    return sorted((event for event in events if isinstance(event, dict) and isinstance(event.get("t"), int)
                   and not isinstance(event.get("t"), bool) and isinstance(event.get("type"), str)),
                  key=lambda event: event["t"])


_MUSHROOM_USE = re.compile(r"^mushroom_use_(\d)to(\d)")


def _mushroom_uses(events: list[dict]) -> list[tuple[int, int]]:
    """(time, mushrooms left) for each mushroom used.

    The engine logs every use as ``mushroom_use_3to2`` / ``_2to1`` /
    ``_1to0_ring_exit``. The last one has no ``mushrooms`` count change beside
    it (the item ring disappears), so counting only those missed the third
    mushroom (owner 2026-09-29). Older reports without use events fall back to
    the count changes.
    """
    uses = []
    for event in events:
        found = _MUSHROOM_USE.match(event["type"])
        if found and int(found.group(1)) - int(found.group(2)) == 1:
            uses.append((event["t"], int(found.group(2))))
    if uses:
        return uses
    return [(event["t"], event["to"]) for event in events if event["type"] == "mushrooms"
            and isinstance(event.get("from"), int) and isinstance(event.get("to"), int) and event["from"] > event["to"]]


def _lap_breakdown(run: dict, lap_times: list[int] | None) -> list[dict]:
    """Each lap's time (recognized), coins gained and mushrooms used, from the events."""
    lap_count = run.get("lapCount") if run.get("lapCount") in (3, 7) else None
    events = _events(run)
    starts = {1: 0}
    for event in events:
        if event["type"] == "lap" and isinstance(event.get("lap"), int) and 1 < event["lap"] <= 7:
            starts.setdefault(event["lap"], event["t"])
    texts = {event["lap"]: event.get("text") for event in events
             if event["type"] == "lapTime" and isinstance(event.get("lap"), int) and isinstance(event.get("text"), str)}
    count = len(lap_times) if lap_times else max(starts) if starts else 0
    if lap_count:
        count = min(max(count, 1), lap_count)
    laps = []
    for number in range(1, count + 1):
        begin = starts.get(number)
        end = starts.get(number + 1)
        if run.get("finished") is not True and end is None:
            break   # an unfinished run's last lap was not seen to the end: say nothing about it
        row: dict = {"lap": number}
        if lap_times and number <= len(lap_times):
            row["time"] = format_race_time(lap_times[number - 1])
        elif re.fullmatch(r"\d:\d{2}\.\d{3}", texts.get(number) or ""):
            row["time"] = texts[number]
        if begin is not None and (end is not None or number == count):
            window = [event for event in events if begin <= event["t"] and (end is None or event["t"] < end)]
            row["coins"] = sum(max(0, event["to"] - event["from"]) for event in window if event["type"] == "coin"
                               and isinstance(event.get("from"), int) and isinstance(event.get("to"), int))
            row["mushrooms"] = sum(1 for at, _left in _mushroom_uses(events)
                                   if begin <= at and (end is None or at < end))
        laps.append(row)
    return laps


def _moment_label(event: dict) -> str | None:
    kind = event["type"]
    if kind == "go":
        return "Start"
    if kind == "coin" and isinstance(event.get("to"), int):
        gained = event["to"] - event["from"] if isinstance(event.get("from"), int) else 1
        if gained < 1:
            return f"Coins {event['from']} → {event['to']}"
        return f"Coin +{gained} ({event['to']})" if gained > 1 else f"Coin ({event['to']})"
    if kind == "lap" and isinstance(event.get("lap"), int):
        return f"Lap {event['lap']}"
    if kind == "pause":
        return "Paused"
    if kind == "resume":
        return "Resumed"
    if kind == "finish":
        return "Finish"
    return None


def clip_facts(run: dict | None, catalog: dict | None, clock=None) -> dict:
    """Only what the engine recognized for this run; unknown facts stay absent."""
    facts: dict = {}
    if not isinstance(run, dict):
        return facts
    context = run.get("context") if isinstance(run.get("context"), dict) else {}
    track = context.get("trackName") if isinstance(context.get("trackName"), dict) else {}
    track_id = track.get("trackId")
    if isinstance(track_id, str) and track_id.startswith("track."):
        facts["trackId"] = track_id
        record = (catalog or {}).get(track_id) if isinstance(catalog, dict) else None
        name = record.get("name") if isinstance(record, dict) else None
        if isinstance(name, str) and name and name != track_id:
            facts["trackName"] = name
        cup = record.get("cupName") if isinstance(record, dict) else None
        if isinstance(cup, str) and cup:
            facts["cupName"] = cup
        index = record.get("index") if isinstance(record, dict) else None
        if isinstance(index, int) and not isinstance(index, bool):
            facts["trackIndex"] = index
    cc = context.get("cc")
    if str(cc) in {"150", "200"}:
        facts["engineClass"] = int(cc)
    results = run.get("results") if isinstance(run.get("results"), dict) else {}
    player = results.get("player") if isinstance(results.get("player"), dict) else {}
    total = player.get("totalMs")
    if run.get("finished") is True and results.get("accepted") is True and isinstance(total, int) \
            and not isinstance(total, bool) and 0 < total < 60 * 60_000:
        facts["timeMs"] = total
        facts["time"] = format_race_time(total)
    closed = run.get("closedAt")
    if isinstance(closed, (int, float)) and not isinstance(closed, bool) and closed > 0:
        facts["recordedAtMs"] = int(closed * 1000)
    facts["finished"] = run.get("finished") is True
    # A complete clip: a finished run with a recognized total time. The list shows these first.
    facts["complete"] = facts["finished"] and "timeMs" in facts
    lap_times = player.get("lapTimesMs") if "timeMs" in facts else None
    if not (isinstance(lap_times, list) and all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in lap_times)):
        lap_times = None
    laps = _lap_breakdown(run, lap_times)
    if any(len(row) > 1 for row in laps):
        facts["laps"] = laps
    go_at = run.get("goAtMs")
    if clock is not None and isinstance(go_at, int) and not isinstance(go_at, bool):
        # Laps and the finish come from the race clock (exact); the other events
        # from when the engine saw them.
        race_marks: list[tuple[int, str]] = []
        if lap_times:
            elapsed = 0
            for number, lap_ms in enumerate(lap_times, start=1):
                if number > 1:
                    race_marks.append((elapsed, f"Lap {number}"))
                elapsed += lap_ms
            race_marks.append((facts["timeMs"], "Finish"))
        moments = []
        for event in _events(run):
            if lap_times and event["type"] in {"lap", "finish"}:
                continue
            label = _moment_label(event)
            if label:
                moments.append((go_at + event["t"], label))
        moments += [(go_at + at, f"Mushroom used ({left} left)" if left else "Last mushroom used")
                    for at, left in _mushroom_uses(_events(run))]
        moments += [(go_at + race_ms, label) for race_ms, label in race_marks]
        placed = []
        for session_ms, label in sorted(moments, key=lambda item: item[0]):
            second = clock(session_ms)
            if second is not None:
                placed.append({"second": int(second), "label": label})
        if placed:
            facts["moments"] = placed[:MAX_MOMENTS]
        # each lap's line links to where it starts
        starts = {1: go_at}
        if lap_times:
            elapsed = 0
            for number, lap_ms in enumerate(lap_times, start=1):
                starts[number] = go_at + elapsed
                elapsed += lap_ms
        else:
            for event in _events(run):
                if event["type"] == "lap" and isinstance(event.get("lap"), int):
                    starts.setdefault(event["lap"], go_at + event["t"])
        for row in facts.get("laps", []):
            second = clock(starts[row["lap"]]) if row["lap"] in starts else None
            if second is not None:
                row["second"] = int(second)
        if "timeMs" in facts:
            second = clock(go_at + facts["timeMs"])
            if second is not None:
                facts["finishSecond"] = int(second)
    return facts


def _session_ghost_clips(session_dir: Path) -> dict[str, dict]:
    """clip file name -> the ghost whose replay it is, from the session's ghosts.json."""
    path = session_dir / GHOSTS_DOCUMENT
    try:
        if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_GHOSTS_BYTES:
            return {}
        ghosts = json.loads(path.read_text(encoding="utf-8")).get("ghosts")
    except (OSError, ValueError, AttributeError):
        return {}
    found = {}
    for ghost in ghosts if isinstance(ghosts, list) else []:
        name = ghost.get("clip") if isinstance(ghost, dict) else None
        if isinstance(name, str) and CLIP_NAME.fullmatch(name) and CLIP_NAME.fullmatch(name).group(2) is None:
            found[name] = ghost
    return found


def _time_ms(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 < value < 60 * 60_000 else None


def ghost_clip_facts(ghost: dict, catalog: dict | None, clock=None) -> dict:
    """What the ghost's panel and its replay showed (ADR-0210), for its clip."""
    facts: dict = {"kind": "ghost", "finished": True, "complete": True}
    name = ghost.get("name")
    if isinstance(name, str) and name.strip():
        facts["ghostName"] = name.strip()[:40]
    for flag in ("staffGhost", "worldRecord"):
        if ghost.get(flag) is True:
            facts[flag] = True
    track_id = ghost.get("trackId")
    if isinstance(track_id, str) and track_id.startswith("track."):
        facts["trackId"] = track_id
        record = (catalog or {}).get(track_id) if isinstance(catalog, dict) else None
        if isinstance(record, dict):
            if isinstance(record.get("name"), str) and record["name"] and record["name"] != track_id:
                facts["trackName"] = record["name"]
            if isinstance(record.get("cupName"), str) and record["cupName"]:
                facts["cupName"] = record["cupName"]
            if isinstance(record.get("index"), int) and not isinstance(record.get("index"), bool):
                facts["trackIndex"] = record["index"]
    if str(ghost.get("cc")) in {"150", "200"}:
        facts["engineClass"] = int(ghost["cc"])
    total = _time_ms(ghost.get("totalMs"))
    if total:
        facts["timeMs"], facts["time"] = total, format_race_time(total)
    seen = ghost.get("lastSeenAtMs")
    if isinstance(seen, int) and not isinstance(seen, bool) and seen > 0:
        facts["recordedAtMs"] = seen
    lap_times = ghost.get("lapTimesMs") if ghost.get("lapSumOk") is True else None
    if not (isinstance(lap_times, list) and lap_times and all(_time_ms(v) for v in lap_times)):
        lap_times = None
    replay = ghost.get("replay") if isinstance(ghost.get("replay"), dict) else {}
    coins = replay.get("coinCountsPerLap") if isinstance(replay.get("coinCountsPerLap"), list) else None
    mushrooms = replay.get("mushroomsPerLap") if isinstance(replay.get("mushroomsPerLap"), list) else None
    count = len(lap_times) if lap_times else max(len(coins or []), len(mushrooms or []))
    laps = []
    for index in range(count):
        row: dict = {"lap": index + 1}
        if lap_times:
            row["time"] = format_race_time(lap_times[index])
        if coins and index < len(coins) and isinstance(coins[index], int):
            row["coins"] = coins[index]
        if mushrooms and index < len(mushrooms) and isinstance(mushrooms[index], int):
            row["mushrooms"] = mushrooms[index]
        laps.append(row)
    if any(len(row) > 1 for row in laps):
        facts["laps"] = laps
    go_at = ghost.get("clipGoAtMs")
    if clock is not None and isinstance(go_at, int) and not isinstance(go_at, bool) and lap_times:
        elapsed = 0
        for row, lap_ms in zip(facts.get("laps", []), lap_times):
            second = clock(go_at + elapsed)
            if second is not None:
                row["second"] = int(second)
            elapsed += lap_ms
        if total:
            second = clock(go_at + total)
            if second is not None:
                facts["finishSecond"] = int(second)
    return facts


def list_clips(runs_root: str | Path, catalog: dict | None = None, limit: int = DEFAULT_CLIP_LIMIT) -> list[dict]:
    """The newest clips first, each with its id, size and recognized facts:
    every run's clip, and the clip of each ghost replay watched to the line."""
    root = Path(runs_root)
    found: list[tuple[float, Path]] = []
    ghost_clips: dict[Path, dict[str, dict]] = {}
    try:
        for path in root.glob("*/clip_*.mp4"):
            session = path.parent.name
            if session == "latest" or session.startswith(("_", ".")) or SESSION_NAME.fullmatch(session) is None:
                continue
            match = CLIP_NAME.fullmatch(path.name)
            if match is None or path.is_symlink():
                continue
            if match.group(2) is None:
                # a plain clip is listed only as a ghost replay's clip (not a manual REC clip)
                if path.parent not in ghost_clips:
                    ghost_clips[path.parent] = _session_ghost_clips(path.parent)
                if path.name not in ghost_clips[path.parent]:
                    continue
            try:
                found.append((path.stat().st_mtime, path))
            except OSError:
                continue
    except OSError:
        return []
    found.sort(key=lambda item: item[0], reverse=True)
    reports: dict[Path, dict[int, dict]] = {}
    clips = []
    for modified, path in found[:max(0, limit)]:
        run_group = CLIP_NAME.fullmatch(path.name).group(2)
        if run_group is None:
            anchors = load_timeline(path)
            clock = (lambda session_ms, anchors=anchors: timeline_position(anchors, session_ms)) if anchors else None
            try:
                size = path.stat().st_size
            except OSError:
                continue
            clips.append({
                "clipId": clip_id_for(path.parent.name, path.name),
                "hasStill": endscreen_path(root, clip_id_for(path.parent.name, path.name)) is not None,
                "session": path.parent.name,
                "bytes": size,
                "modifiedAtMs": int(modified * 1000),
                **ghost_clip_facts(ghost_clips[path.parent][path.name], catalog, clock),
            })
            continue
        run_number = int(run_group)
        if path.parent not in reports:
            reports[path.parent] = _report_runs(path.parent)
        runs = reports[path.parent]
        run = runs.get(run_number)
        anchors = load_timeline(path)
        if anchors:
            clock = lambda session_ms, anchors=anchors: timeline_position(anchors, session_ms)  # noqa: E731
        else:
            clock = legacy_clip_clock(run, runs, path) if isinstance(run, dict) else None
        facts = clip_facts(run, catalog, clock)
        try:
            size = path.stat().st_size
        except OSError:
            continue
        clips.append({
            "clipId": clip_id_for(path.parent.name, path.name),
            "hasStill": endscreen_path(root, clip_id_for(path.parent.name, path.name)) is not None,
            "session": path.parent.name,
            "run": run_number,
            "bytes": size,
            "modifiedAtMs": int(modified * 1000),
            **facts,
        })
    return clips


# YouTube turns every m:ss in a description into a jump to that moment of the
# video, so a race time written with ':' (Total Time 1:31.919, a lap 0:31.374)
# became a link to the wrong place. In the description race times use U+2236
# RATIO, which looks the same and is not a timestamp; only the Moments are links.
RACE_TIME_COLON = "\u2236"


def race_text(value: str) -> str:
    return value.replace(":", RACE_TIME_COLON)


def video_timestamp(second: int) -> str:
    """``m:ss`` (or ``h:mm:ss``): what YouTube turns into a link to that moment."""
    hours, rest = divmod(max(0, int(second)), 3600)
    minutes, seconds = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


def mk8dx_video_metadata(clip: dict, website_origin: str | None = None) -> VideoMetadata:
    """The MK8DX profile, from known facts only.

    Title ``MK8DX | <track> | <class> | Total Time <time>``. The description has
    the race, a line per lap (time, coins, mushrooms), the race's moments as
    ``m:ss`` links into the video when the clip's timeline is known, the
    uploading Player with their profile, and the track's leaderboard on the
    website.
    """
    track = clip.get("trackName")
    engine = f"{clip['engineClass']}cc" if clip.get("engineClass") in (150, 200) else None
    race_time = clip.get("time")
    total = f"Total Time {race_time}" if race_time else None
    parts = [part for part in (track, engine, total) if part]
    if track:
        title = " | ".join(["MK8DX", *parts])
    else:
        stamp = clip.get("recordedAtMs") or clip.get("modifiedAtMs")
        when = time.strftime("%Y-%m-%d %H:%M", time.localtime(stamp / 1000)) if isinstance(stamp, int) else ""
        title = " | ".join(part for part in ("MK8DX", "Time Trial clip", engine, total, when) if part)
    lines = ["Mario Kart 8 Deluxe Time Trial"]
    if track:
        lines.append(f"Track: {track}")
    if engine:
        lines.append(f"Engine Class: {engine}")
    if race_time:
        lines.append(f"Total Time: {race_text(race_time)}")
    elif clip.get("finished") is False:
        lines.append("Run not finished")
    laps = clip.get("laps") or []
    if laps:
        lines += ["", "Laps"]
        for row in laps:
            details = [race_text(row["time"]) if row.get("time") else "time not read"]
            if "coins" in row:
                details.append(f"coins +{row['coins']}")
            if "mushrooms" in row:
                details.append(f"mushrooms {row['mushrooms']}")
            at = f"{video_timestamp(row['second'])} " if isinstance(row.get("second"), int) else ""
            lines.append(f"{at}Lap {row['lap']}: " + " · ".join(details))
        if race_time and isinstance(clip.get("finishSecond"), int):
            lines.append(f"{video_timestamp(clip['finishSecond'])} Finish: {race_text(race_time)}")
    moments = clip.get("moments") or []
    if moments:
        # every time here is a position in this video, counted from its 0:00
        lines += ["", "Details"]
        lines += [f"{video_timestamp(moment['second'])} {race_text(moment['label'])}" for moment in moments]
    links = []
    player_name = clip.get("playerName")
    player_id = clip.get("playerId")
    if isinstance(player_name, str) and player_name.strip() and isinstance(player_id, str) \
            and re.fullmatch(r"player\.[a-z0-9]+(?:[._-][a-z0-9]+)*", player_id):
        links.append(f"Player: {player_name.strip()}")
        if website_origin:
            # YouTube shows a link as its text and cuts a long one off: use the website's short
            # forms (ADR-0199), `?player=<username>` and `?lb=<schema-9 track index>`.
            username = clip.get("playerUsername")
            who = username if isinstance(username, str) and re.fullmatch(r"[A-Za-z0-9._-]{1,64}", username) else player_id
            links.append(f"Profile: {website_origin.rstrip('/')}/?player={who}")
    if website_origin and clip.get("trackId") and engine:
        where = f"lb={clip['trackIndex']}" if isinstance(clip.get("trackIndex"), int) else f"leaderboard={clip['trackId']}"
        links.append(f"Leaderboard: {website_origin.rstrip('/')}/?{where}&mode={clip['engineClass']}")
    if links:
        lines += ["", *links]
    lines += ["", "Captured with LiveTrial."]
    tags = tuple(tag for tag in ("Mario Kart 8 Deluxe", "MK8DX", "Time Trial", track, engine) if tag)
    return VideoMetadata(title=title, description="\n".join(lines), tags=tags)


class ClipUploadRecords:
    """``youtube-uploads.json``: clip id -> the YouTube video it became.

    Written atomically like LiveTrial's other small documents. A record never
    holds a token, only the public video id, its link and who uploaded it.
    """

    def __init__(self, data_root: str | Path) -> None:
        self._path = Path(data_root) / UPLOAD_RECORDS_NAME

    def load(self) -> dict[str, dict]:
        try:
            if not self._path.is_file() or self._path.is_symlink() or self._path.stat().st_size > MAX_RECORDS_BYTES:
                return {}
            document = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            return {}
        uploads = document.get("uploads") if isinstance(document, dict) \
            and document.get("schemaVersion") == UPLOAD_RECORDS_SCHEMA_VERSION else None
        if not isinstance(uploads, dict):
            return {}
        return {key: value for key, value in uploads.items()
                if isinstance(key, str) and isinstance(value, dict) and isinstance(value.get("videoId"), str)}

    def get(self, clip_id: str) -> dict | None:
        return self.load().get(clip_id)

    def count_for(self, slot_id: str) -> int:
        return sum(1 for row in self.load().values() if row.get("slotId") == slot_id)

    def forget_player(self, slot_id: str) -> list[str]:
        """Forget every upload record of one LiveTrial Player on this PC (the clip ids forgotten).
        YouTube is not touched."""
        uploads = self.load()
        kept = {clip_id: row for clip_id, row in uploads.items() if row.get("slotId") != slot_id}
        if len(kept) != len(uploads):
            self._write(kept)
        return [clip_id for clip_id in uploads if clip_id not in kept]

    def forget(self, clip_id: str) -> bool:
        """Remove one clip's record on this PC. The video on YouTube is not touched."""
        uploads = self.load()
        if clip_id not in uploads:
            return False
        del uploads[clip_id]
        self._write(uploads)
        return True

    def record(self, clip_id: str, video_id: str, url: str, privacy_status: str, slot_id: str | None,
               uploaded_at_ms: int, title: str) -> dict:
        uploads = self.load()
        row = {"videoId": video_id, "url": url, "privacyStatus": privacy_status, "slotId": slot_id,
               "uploadedAtMs": uploaded_at_ms, "title": title}
        uploads[clip_id] = row
        if len(uploads) > MAX_RECORDS:
            _fail("Too many uploads are recorded on this PC.")
        self._write(uploads)
        return dict(row)

    def _write(self, uploads: dict) -> None:
        payload = json.dumps({"schemaVersion": UPLOAD_RECORDS_SCHEMA_VERSION, "uploads": uploads},
                             ensure_ascii=False, sort_keys=True, indent=1).encode("utf-8")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{self._path.name}.", suffix=".tmp",
                                                      dir=self._path.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self._path)
        finally:
            try:
                temporary.unlink()
            except OSError:
                pass
