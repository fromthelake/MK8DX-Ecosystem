"""Offline QA at the real Live streaming and confirmed-event boundaries.

No approved expected output is inferred from a candidate CSV. All writable state
is placed in a fresh explicit external directory; no installed user session is
loaded and network connections are refused in this process.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]


def sha256(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def _distribution(name):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def write_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def network_guard(event, args):
    if event in {"socket.connect", "socket.connect_ex", "socket.getaddrinfo", "socket.sendto"}:
        raise RuntimeError("replay_validation.offline_network_refused")


def configure(args):
    output = args.output.resolve()
    protected = [ROOT, args.baseline_root.resolve(), args.assets_root.resolve(), args.reference_root.resolve()]
    if any(output == p or output.is_relative_to(p) for p in protected):
        raise ValueError("Use a new external runtime, outside source/original/asset roots")
    if any(p.is_relative_to(output) for p in protected):
        raise ValueError("Output must not be an ancestor of a protected root")
    output.mkdir(parents=True, exist_ok=False)
    for name in ("local-app-data", "tmp", "cache"):
        (output / name).mkdir()
    for name in list(os.environ):
        if name.startswith("MK8DX_TOURNAMENT_") or name.upper().endswith("_PROXY"):
            os.environ.pop(name, None)
    os.environ.update({
        "LOCALAPPDATA": str(output / "local-app-data"),
        "APPDATA": str(output / "local-app-data"),
        "TEMP": str(output / "tmp"), "TMP": str(output / "tmp"),
        "MPLCONFIGDIR": str(output / "cache" / "matplotlib"),
        "CUDA_CACHE_PATH": str(output / "cache" / "cuda"),
        "MK8DX_TOURNAMENT_LIVE_ROOT": str(output),
        "MK8DX_TOURNAMENT_RUNTIME_ROOT": str(output),
        "MK8DX_BASELINE_ROOT": str(args.baseline_root.resolve()),
        "MK8DX_TOURNAMENT_ASSETS_ROOT": str(args.assets_root.resolve()),
        "MK8DX_TOURNAMENT_REFERENCE_ROOT": str(args.reference_root.resolve()),
        "MK8DX_TOURNAMENT_ENGINE_DATA_ROOT": str(args.reference_root.resolve()),
        "MK8DX_LIVE_RUN_ID": output.name,
        "MK8DX_CLEAN_REPLAY_RUN_ID": output.name,
        "PYTHONDONTWRITEBYTECODE": "1",
    })
    if args.clean_assets:
        # The shared field reader (MK8DX_FIELD_READER, default shared) reads this
        # catalog; without it the export silently keeps the previous route.
        os.environ["MK8_CLEAN_ASSETS_ROOT"] = str(args.clean_assets.resolve(strict=True))
    sys.dont_write_bytecode = True
    if not args.installed:
        sys.path[:0] = [str(ROOT / "apps/tournament-live/src"), str(ROOT / "packages/tournament-extraction/python/src")]
    os.chdir(output)
    sys.addaudithook(network_guard)
    write_json(output / "runtime-provenance.json", {
        "pythonExecutable": sys.executable, "pythonVersion": sys.version,
        "runtimeMode": ("installed package code, no repository source override" if args.installed else
                        "installed dependencies with explicit maintained repository Live/extraction source override"),
        "historicalRunBuildIdentity": "not_inferred_from_current_install_directory",
        "distributions": {name: _distribution(name) for name in (
            "mk8dx-tournament-live", "mk8dx-tournament-extraction", "mk8dx-icon-matcher", "opencv-python", "torch", "easyocr")},
        "fieldReader": {"route": os.environ.get("MK8DX_FIELD_READER") or "default",
                        "cleanAssetsRoot": os.environ.get("MK8_CLEAN_ASSETS_ROOT")},
        "maintainedSourceSha256": {} if args.installed else {
            str(path.relative_to(ROOT)): sha256(path) for folder in (
                ROOT / "apps/tournament-live/src", ROOT / "packages/tournament-extraction/python/src")
            for path in sorted(folder.rglob("*.py"))},
    })
    return output


def compare_csv(actual, candidate, video_map=None):
    """Strict provisional comparison: no guessed aliases or race realignment."""
    video_map = video_map or {}
    def read(path, mapping):
        with Path(path).open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        if mapping:
            rows = [r for r in rows if r["Video"] in mapping]
        values = {}
        for row in rows:
            row = dict(row)
            row["Video"] = mapping.get(row["Video"], row["Video"])
            key = (row["Video"], row["Race"], row["Position"])
            if key in values:
                raise ValueError("Duplicate video/race/position comparison key")
            values[key] = row
        return values
    current, reference = read(actual, video_map), read(candidate, {})
    if video_map:
        reference = {key: row for key, row in reference.items() if key[0] in set(video_map.values())}
    fields = ("Track", "Player", "Character", "Race Points", "Total Before Race", "Total After Race", "Counts Toward Totals")
    counts, differences = Counter(), []
    for key in sorted(current.keys() & reference.keys()):
        for field in fields:
            if current[key].get(field) != reference[key].get(field):
                counts[field] += 1
                if len(differences) < 30:
                    differences.append({"key": list(key), "field": field, "actual": current[key].get(field), "candidate": reference[key].get(field)})
    return {"candidateStatus": "provisional_not_human_approved", "comparison": "strict same video/race/position; no race or alias realignment",
            "actual": {"path": str(actual), "sha256": sha256(actual), "rows": len(current)},
            "candidate": {"path": str(candidate), "sha256": sha256(candidate), "rows": len(reference)},
            "videoMap": video_map, "matchedRowKeys": len(current.keys() & reference.keys()),
            "actualOnlyKeys": len(current.keys() - reference.keys()), "candidateOnlyKeys": len(reference.keys() - current.keys()),
            "fieldDifferences": dict(counts), "firstDifferencesPrivate": differences,
            "equal": current == reference}


def event_payloads(path):
    """Retained actual Live events, not synthetic races made from batch CSVs."""
    events = []
    for index, line in enumerate(Path(path).read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("event_type") != "SCOREBOARD_UPDATED":
            continue
        data = event["data"]
        events.append({"stream_label": event["stream_label"], "race_sequence": int(event["race_sequence"]),
                       "rows": data["rows"], "tournament_rows": data.get("tournament_rows") or data["rows"],
                       "source_line": index})
    if not events:
        raise ValueError("No real SCOREBOARD_UPDATED events in source")
    return events


def apply_events(manager, events, *, export_every=True):
    for event in events:
        payload = {key: event[key] for key in ("stream_label", "race_sequence", "rows", "tournament_rows")}
        if export_every:
            manager.apply_scoreboard_update(**payload)
        else:
            manager.session.scoreboard.apply_consensus_rows(
                stream_id=payload["stream_label"], race_sequence=payload["race_sequence"],
                rows=payload["rows"], tournament_rows=payload["tournament_rows"], tracker=manager.tracker)
    manager._finalize_session_rows()
    return manager.session.scoreboard


def stable_rows(rows):
    return sorted([dict(row) for row in rows], key=lambda row: (
        str(row.get("Video", "")), int(row.get("Race") or 0),
        int(row.get("Position") or row.get("Position Before Race") or 0), str(row.get("Player", ""))))


def scenarios(events):
    chronological = sorted(events, key=lambda e: (e["race_sequence"], e["stream_label"]))
    partial = [{**e, "rows": e["rows"][:5], "tournament_rows": e["tournament_rows"][:5]} for e in chronological]
    return {"chronological": chronological, "duplicates": [e for e in chronological for _ in range(2)],
            "out_of_order": list(reversed(chronological)), "partial_then_retry": partial + chronological}


def replay_events(args, output):
    from live_processor.live_workbook import LiveWorkbookManager

    events = event_payloads(args.events)
    results = {}
    baseline_rows = None
    for name, ordered in scenarios(events).items():
        manager = LiveWorkbookManager(output.name + "_" + name)
        # Real accumulator/finalizer. Only the chronological path writes all five
        # export formats; permutation checks avoid quadratic repeated workbook I/O.
        scoreboard = apply_events(manager, ordered, export_every=False)
        first = stable_rows(scoreboard.tournament_rows)
        manager._finalize_session_rows()
        repeated = stable_rows(scoreboard.tournament_rows)
        if baseline_rows is None:
            baseline_rows = first
            exported = manager.export_final(reason="offline_event_replay_flush")
            # Final character refinement is a separate product step; do not compare
            # its output to pre-refinement event rows as if they were the same seam.
            results["exports"] = exported["files"]
        results[name] = {"events": len(ordered), "accepted": scoreboard.update_count,
                         "rows": len(first), "sameAsChronological": first == baseline_rows,
                         "repeatedFinalizationStable": first == repeated}
        write_json(output / (name + "-rows.json"), first)
    write_json(output / "event-replay.json", {
        "schema": "mk8dx.live-event-replay.v1", "runId": output.name,
        "source": {"path": str(args.events.resolve()), "sha256": sha256(args.events)},
        "boundary": "real Live Scoreboard.apply_consensus_rows / LiveWorkbookManager finalization and export",
        "recognition": "not_reexecuted", "physicalCapture": "not_executed", "scoreCorrectness": "unreviewed",
        "scenarios": results,
    })
    return 0 if all(result.get("sameAsChronological", True) and result.get("repeatedFinalizationStable", True)
                    for result in results.values()) else 2


def run_stream(args, output):
    import cv2
    from live_processor.gui_virtual_pipeline import (GuiVirtualCaptureController, VirtualSourceConfig,
        preflight_video_source, write_gui_preflight_report)
    from live_processor.paths import get_project_paths

    get_project_paths().ensure_output_dirs()

    if not 1 <= len(args.video) <= 3 or len(set(p.resolve() for p in args.video)) != len(args.video):
        raise ValueError("Choose 1-3 distinct videos from one stage")
    if not 0 <= args.start_seconds or not 0 < args.duration_seconds <= 14400 or not 0 < args.speed <= 4:
        raise ValueError("Invalid bounded source interval or playback speed")
    started = time.monotonic()
    sources, identities = [], []
    for index, video in enumerate(args.video, 1):
        cap = cv2.VideoCapture(str(video.resolve()))
        if not cap.isOpened():
            raise ValueError(f"Cannot read video: {video}")
        fps, count = cap.get(cv2.CAP_PROP_FPS), int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        start = int(args.start_seconds * fps)
        end = min(count, int((args.start_seconds + args.duration_seconds) * fps))
        if fps <= 0 or end <= start:
            raise ValueError("Source has no frames in selected interval")
        sources.append(VirtualSourceConfig(f"source_{index}", video.name, f"{args.stage}_{index}",
                                          video.resolve(), start_frame=start, end_frame=end))
        identities.append({"path": str(video.resolve()), "sizeBytes": video.stat().st_size,
                           "mtimeNs": video.stat().st_mtime_ns, "sha256": sha256(video) if args.hash_sources else None,
                           "hashStatus": "computed" if args.hash_sources else "not_computed",
                           "fps": fps, "totalFrames": count, "startFrame": start, "endFrame": end,
                           "frameConvention": "OpenCV seek start zero-based; Live current_frame_index is post-read one-based"})
    write_json(output / "inputs.json", identities)
    prepared, preflight = {}, []
    for index, source in enumerate(sources, 1):
        result = preflight_video_source(source, len(sources), index)
        preflight.append(result)
        if not result.ready:
            raise RuntimeError(result.error)
        context = dict(result.context)
        context["usable_start_frame"] = max(context["usable_start_frame"], source.start_frame)
        context["readable_end_frame"] = min(context["readable_end_frame"], source.end_frame)
        prepared[source.source_id] = context
    write_gui_preflight_report(output.name, preflight)
    controller = GuiVirtualCaptureController(sources, playback_speed=args.speed, run_id=output.name,
        prepared_contexts=prepared, use_live_signal_pipeline=False, force_buffer_only=True,
        record_virtual_feeds=False, consensus_worker_count=2)
    controller.start_all()
    deadline = time.monotonic() + args.max_wall_seconds
    timed_out = False
    while controller.pipeline_state not in {"exported", "completed_no_export", "failed"}:
        write_json(output / "heartbeat.json", {"runId": output.name, "elapsedSeconds": time.monotonic()-started,
            "pipelineState": controller.pipeline_state, "sources": [s.summary() for s in controller.sources]})
        if (output / "stop.json").exists() or time.monotonic() >= deadline:
            timed_out = True
            break
        time.sleep(2)
    controller.stop_all()
    # The actual product drain/flush, including in-flight selection/OCR. No hard
    # process kill: a stalled drain remains visible in the heartbeat/private log.
    controller.wait()
    events_path = output / "Live_Output/diagnostics/gui_virtual_capture_events.jsonl"
    events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    sources_complete = all(source.state == "ended" and not source.error_state
        and source.frames_decoded >= prepared[source.source_id]["readable_end_frame"] - source.start_frame
        for source in controller.sources)
    final = {"schema": "mk8dx.live-stream-replay.v1", "runId": output.name, "stage": args.stage,
        "status": "stopped_incomplete" if timed_out else "completed_unreviewed" if controller.pipeline_state == "exported" and sources_complete else "incomplete_source_or_export",
        "pipelineState": controller.pipeline_state, "elapsedSeconds": round(time.monotonic()-started, 3),
        "physicalCapture": "not_executed", "scoreCorrectness": "unreviewed", "apiDelivery": "not_executed_network_denied",
        "boundary": "real GuiVirtualCaptureController default incremental exact pipeline, forced buffer-only",
        "sourceInterval": "full_available_recordings" if all(i["startFrame"] == 0 and i["endFrame"] == i["totalFrames"] for i in identities) else "bounded_sample_not_full_recordings", "speed": args.speed,
        "inputs": identities, "sources": [s.summary() for s in controller.sources],
        "allSourcesReachedReadableEnd": sources_complete,
        "eventCounts": dict(Counter(e.get("event_type") for e in events)),
        "exports": {name: {"path": path, "sha256": sha256(path)} for name, path in controller.export_paths.items()},
        "sourceVersion": {"controllerSha256": sha256(ROOT / "apps/tournament-live/src/live_processor/gui_virtual_pipeline.py"),
                          "harnessSha256": sha256(__file__)}}
    write_json(output / "stream-replay.json", final)
    print(json.dumps({key: final[key] for key in ("status", "pipelineState", "elapsedSeconds", "eventCounts")}))
    return 0 if final["status"] == "completed_unreviewed" else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baseline-root", type=Path, required=True)
    parser.add_argument("--assets-root", type=Path, required=True)
    parser.add_argument("--reference-root", type=Path, required=True)
    parser.add_argument("--clean-assets", type=Path,
                        help="Clean Assets catalog for the shared field reader (the package's private-assets/clean-assets)")
    parser.add_argument("--installed", action="store_true",
                        help="run the Live/extraction code installed in this interpreter (a package runtime), not repository source")
    sub = parser.add_subparsers(dest="command", required=True)
    stream = sub.add_parser("stream")
    stream.add_argument("--video", type=Path, action="append", required=True)
    stream.add_argument("--stage", choices=["qualification", "final"], required=True)
    stream.add_argument("--start-seconds", type=float, default=0)
    stream.add_argument("--duration-seconds", type=float, default=90)
    stream.add_argument("--speed", type=float, default=1)
    stream.add_argument("--max-wall-seconds", type=float, default=900)
    stream.add_argument("--hash-sources", action="store_true")
    event = sub.add_parser("events")
    event.add_argument("--events", type=Path, required=True)
    comparison = sub.add_parser("compare")
    comparison.add_argument("--actual-csv", type=Path, required=True)
    comparison.add_argument("--candidate-csv", type=Path, required=True)
    comparison.add_argument("--video-map", action="append", default=[], metavar="ACTUAL=CANDIDATE")
    args = parser.parse_args()
    output = configure(args)
    try:
        if args.command == "compare":
            mapping = dict(pair.split("=", 1) for pair in args.video_map)
            result = compare_csv(args.actual_csv.resolve(), args.candidate_csv.resolve(), mapping)
            write_json(output / "candidate-comparison.json", result)
            return 0 if result["equal"] else 2
        return run_stream(args, output) if args.command == "stream" else replay_events(args, output)
    except Exception as error:
        write_json(output / "failure.json", {"error": f"{type(error).__name__}: {error}", "scoreCorrectness": "unreviewed"})
        raise


if __name__ == "__main__":
    raise SystemExit(main())
