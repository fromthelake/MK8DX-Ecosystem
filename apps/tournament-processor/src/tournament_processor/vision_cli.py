from __future__ import annotations

import argparse
import csv
import os
import time
from pathlib import Path
from typing import Sequence

from .recorded_export import write_recorded_results


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mk8dx-tournament-video",
        description="Extract, OCR, and publish recorded MK8DX Tournament videos.",
    )
    parser.add_argument("command", choices=("extract", "ocr", "all"))
    parser.add_argument("--runtime-root", type=Path, default=Path.cwd())
    parser.add_argument("--assets-root", type=Path)
    parser.add_argument("--reference-root", type=Path)
    parser.add_argument("--engine-data-root", type=Path)
    parser.add_argument("--clean-assets", type=Path,
                        help="Clean Assets for the shared character reader (default MK8_CLEAN_ASSETS_ROOT)")
    parser.add_argument(
        "--video",
        help=("One input target: a video filename, a path relative to Input_Videos, "
              "or a folder holding one tournament's recordings"),
    )
    parser.add_argument(
        "--subfolders",
        action="store_true",
        help="Also read videos from folders inside Input_Videos, one per tournament",
    )
    parser.add_argument(
        "--videos",
        nargs="+",
        help=("Several input targets at once; each may be a video or a folder. "
              "Relative entries resolve under Input_Videos"),
    )
    parser.add_argument("--session-id", help="Required for ocr/all canonical publication")
    parser.add_argument("--producer-version", default="tournament-processor-0.2.0")
    parser.add_argument("--created-at-ms", type=int, help="Deterministic UTC epoch milliseconds for regression")
    parser.add_argument("--diagnostics", type=Path, help="Write all-run overlap/process timing events to this JSONL file")
    return parser


VIDEO_SUFFIXES = (".mp4", ".mkv", ".mov", ".avi", ".ts")


def _resolve_targets(runtime_root: Path, targets: Sequence[str]) -> tuple[list[str], list[str]]:
    """Name the recordings behind a list of targets, for both phases.

    A target is a recording or a folder of them, the way the source engine's
    own `--videos` has always accepted it: a collection is one folder per
    tournament, so a tournament is one target rather than six.

    Extraction selects by the path relative to Input_Videos; OCR selects by the
    race class, which `build_video_identity` derives from that same path. One
    walk produces both, so the two phases cannot drift apart.
    """
    from mk8dx_tournament_extraction.engine.extract_common import build_video_identity

    root = runtime_root / "Input_Videos"
    recordings: list[Path] = []
    for target in targets:
        candidate = Path(target)
        if not candidate.is_absolute():
            candidate = root / target
        if candidate.is_dir():
            found = sorted(
                path for path in candidate.iterdir()
                if path.is_file() and path.suffix.lower() in VIDEO_SUFFIXES
            )
            if not found:
                raise SystemExit(f"No recordings in {candidate}")
            recordings.extend(found)
        elif candidate.is_file():
            recordings.append(candidate)
        else:
            # A bare filename stays legal: the engine matches it by basename,
            # and the OCR class is its stem.
            recordings.append(candidate)

    selected: list[str] = []
    classes: list[str] = []
    for path in recordings:
        try:
            relative = path.resolve().relative_to(root.resolve())
        except (ValueError, OSError):
            selected.append(path.name)
            classes.append(path.stem)
            continue
        selected.append(str(relative).replace("\\", "/"))
        classes.append(build_video_identity(path, root, True))
    return selected, classes


def _configure_paths(args: argparse.Namespace) -> Path:
    runtime_root = args.runtime_root.resolve()
    os.environ["MK8DX_TOURNAMENT_RUNTIME_ROOT"] = str(runtime_root)
    if args.assets_root:
        os.environ["MK8DX_TOURNAMENT_ASSETS_ROOT"] = str(args.assets_root.resolve())
    if args.reference_root:
        os.environ["MK8DX_TOURNAMENT_REFERENCE_ROOT"] = str(args.reference_root.resolve())
    if args.engine_data_root:
        os.environ["MK8DX_TOURNAMENT_ENGINE_DATA_ROOT"] = str(args.engine_data_root.resolve())
    return runtime_root


def _recording_labels(runtime_root: Path, selected_videos, include_subfolders: bool) -> list[str]:
    """Use the engine's discovery/selection rules before choosing a run mode."""
    from mk8dx_tournament_extraction.engine.extract_common import (
        build_video_identity, load_videos_from_folder, relative_video_path,
    )

    input_root = runtime_root / "Input_Videos"
    if not input_root.is_dir():
        raise SystemExit(f"No recordings in {input_root}")
    selected = {name.replace("\\", "/").lower() for name in selected_videos or ()}
    paths = [Path(path) for path in load_videos_from_folder(input_root, include_subfolders=include_subfolders)]
    if selected:
        paths = [path for path in paths if path.name.lower() in selected
                 or relative_video_path(path, input_root).lower() in selected]
    labels = [build_video_identity(path, input_root, include_subfolders) for path in paths]
    if not labels:
        raise SystemExit("No supported recordings matched the selection")
    if len(labels) != len(set(labels)):
        raise SystemExit("Selected recordings have colliding frame identities; use distinct recording names")
    return labels


def _save_cup_finals(runtime_root: Path, selected_videos, include_subfolders: bool) -> None:
    """Keep each recording's cup end screen (065) next to its last race, as Tournament Live does."""
    from mk8dx_tournament_extraction.cup_final import save_cup_final
    from mk8dx_tournament_extraction.engine.extract_common import (
        EXPORT_IMAGE_SUFFIX, build_video_identity, load_videos_from_folder, relative_video_path, video_frames_dir,
    )

    input_root = runtime_root / "Input_Videos"
    if not input_root.is_dir():
        return
    selected = {name.replace("\\", "/").lower() for name in selected_videos or ()}
    for path in (Path(item) for item in load_videos_from_folder(input_root, include_subfolders=include_subfolders)):
        if selected and path.name.lower() not in selected and relative_video_path(path, input_root).lower() not in selected:
            continue
        label = build_video_identity(path, input_root, include_subfolders)
        saved = save_cup_final(path, video_frames_dir(label), EXPORT_IMAGE_SUFFIX)
        print(f"Cup end screen for {label}: {saved if saved else 'not found'}")


def _apply_shared_characters(payload: dict[str, object], runtime_root: Path, args: argparse.Namespace) -> None:
    """The character decision Tournament Live makes (shared reader, lobby Mii rule) on the written results."""
    from mk8dx_tournament_extraction.recorded_characters import apply_recorded_shared_characters

    csv_path = Path(str(payload.get("output_csv_path") or "")) if payload.get("output_csv_path") else (
        Path(str(payload["output_excel_path"])).with_suffix(".csv") if payload.get("output_excel_path") else None)
    if csv_path is None or not csv_path.is_file():
        return
    summary = apply_recorded_shared_characters(csv_path, runtime_root / "Output_Results" / "Frames", args.clean_assets)
    print(f"Shared characters: {summary}")
    from mk8dx_tournament_extraction.recorded_characters import apply_recorded_race_classes

    classes = apply_recorded_race_classes(csv_path, runtime_root / "Output_Results" / "Frames", args.clean_assets)
    print(f"Race classes: {classes}")


def _publish_ocr_payload(payload: dict[str, object], args: argparse.Namespace) -> Path:
    if not args.session_id:
        raise SystemExit("--session-id is required for ocr/all canonical publication")
    if payload.get("output_csv_path"):
        csv_path = Path(str(payload["output_csv_path"]))
    else:
        workbook_path = Path(str(payload["output_excel_path"]))
        csv_path = workbook_path.with_suffix(".csv")
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    output_path = csv_path.with_name(csv_path.name.replace("_Tournament_Results.csv", "_TournamentRaceResultsV1.json"))
    write_recorded_results(
        rows,
        output_path,
        session_id=args.session_id,
        producer_version=args.producer_version,
        created_at_ms=args.created_at_ms if args.created_at_ms is not None else time.time_ns() // 1_000_000,
    )
    return output_path


def run(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command in {"ocr", "all"} and not args.session_id:
        raise SystemExit("--session-id is required for ocr/all canonical publication")
    runtime_root = _configure_paths(args)
    # Import only after product-owned runtime/artifact paths are composed;
    # engine modules intentionally resolve these values during import.
    from mk8dx_tournament_extraction.engine.extract_frames import extract_frames
    from mk8dx_tournament_extraction.engine.extract_text import process_images_in_folder

    targets = list(args.videos) if args.videos else ([args.video] if args.video else [])
    if targets:
        selected_videos, selected_classes = _resolve_targets(runtime_root, targets)
    else:
        selected_videos, selected_classes = None, None

    # A recorded collection is normally one folder per tournament, so the flat
    # Input_Videos root holds nothing and a run reports "No videos found" while
    # every recording sits one level down. The engine has always supported the
    # nested layout; only this entry point could not ask for it. A target that
    # resolved to a nested path says so by itself, so asking for --subfolders on
    # top of it would only be a way to get an empty run.
    nested = any("/" in name for name in selected_videos or ())
    if args.command == "all":
        from mk8dx_tournament_extraction.orchestration import run_recorded_pipeline

        include_subfolders = args.subfolders or nested
        labels = _recording_labels(runtime_root, selected_videos, include_subfolders)
        payload = run_recorded_pipeline(
            selected_videos=selected_videos, selected_race_classes=selected_classes,
            include_subfolders=include_subfolders, video_labels=labels,
            diagnostics_path=args.diagnostics,
        )
        _save_cup_finals(runtime_root, selected_videos, include_subfolders)
    elif args.command == "extract":
        extract_frames(
            return_frame_cache=False,
            selected_videos=selected_videos,
            include_subfolders=args.subfolders or nested,
        )
        _save_cup_finals(runtime_root, selected_videos, args.subfolders or nested)
    elif args.command == "ocr":
        payload = process_images_in_folder(
            str(runtime_root / "Output_Results" / "Frames"),
            selected_race_classes=selected_classes,
        )
    if args.command in {"ocr", "all"}:
        _apply_shared_characters(payload, runtime_root, args)
        output_path = _publish_ocr_payload(payload, args)
        print(f"Canonical results: {output_path}")
    return 0


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
