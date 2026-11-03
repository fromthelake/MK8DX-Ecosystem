from __future__ import annotations

"""Consensus helpers used by the installed Tournament Live application.

The implementation is migrated from the original pass-7 validation runner so
the packaged application uses the proven OCR path without importing developer
scripts that are absent from the wheel.
"""

import json
import re
from collections import defaultdict
from dataclasses import replace
from pathlib import Path
from typing import Any

import cv2  # type: ignore
from mk8dx_tournament_extraction import TRACK_PLACEHOLDER

from .baseline_export_metadata import (
    TrackMetadata,
    character_roster_name,
    extract_track_metadata,
)
from .baseline_vision import TARGET_HEIGHT, TARGET_WIDTH, crop_and_upscale_image, to_working_canvas
from .live_frame_bundles import (
    LiveFrameBundleWriter,
    group_live_bundle_images,
    load_live_bundle_race_groups,
    sanitize_video_label,
)
from .paths import DIAGNOSTICS_ROOT, LIVE_ROOT, assert_write_allowed
from .run_context import current_run_id
from .track_assignment import assign_track_entries_to_completed_races


def normalize_live_frame(frame: Any, crop: tuple[int, int, int, int] | None = None) -> Any:
    """Normalize persisted/source frames without importing the GUI pipeline.

    ``crop`` is the video's median active-picture crop (``source_crop`` on the
    selected row). A raw frame is cut and scaled with it exactly like the
    selected crop and the original's bundle frames, also when the recording is
    already 1280x720 but has black borders around a shrunken picture.
    """
    height, width = frame.shape[:2]
    if crop is not None:
        left, top, crop_width, crop_height = crop
        full_frame = (left, top, crop_width, crop_height) == (0, 0, width, height)
        if not full_frame and left + crop_width <= width and top + crop_height <= height:
            return crop_and_upscale_image(frame, left, top, crop_width, crop_height)
    if width == TARGET_WIDTH and height == TARGET_HEIGHT:
        return frame.copy()
    return to_working_canvas(frame)


def source_crop(item: dict[str, Any]) -> tuple[int, int, int, int] | None:
    values = item.get("source_crop")
    if not isinstance(values, (list, tuple)) or len(values) != 4:
        return None
    parsed = [parse_optional_int(value) for value in values]
    if any(value is None or value < 0 for value in parsed) or parsed[2] <= 0 or parsed[3] <= 0:
        return None
    return parsed[0], parsed[1], parsed[2], parsed[3]

def write_live_frame_bundles_from_selected(selected: list[dict[str, Any]], pairs: list[dict[str, dict[str, Any]]]) -> None:
    writer = LiveFrameBundleWriter()
    selected_for_bundle = best_track_entries(selected) + [
        entry
        for pair in pairs
        for entry in (pair["race"], pair["total"])
    ]
    for item in selected_for_bundle:
        kind = classify_entry(item)
        if kind == "unknown":
            continue
        video_path = Path(str(item.get("video_path") or ""))
        video_label = sanitize_video_label(video_path if str(video_path) else item.get("stream_id", "unknown"))
        stream_id = str(item.get("stream_id") or item.get("group_label") or video_label)
        race_sequence = int(item.get("race_sequence") or 0)
        frame_index = int(item.get("frame_index") or item.get(f"selected_{kind}_frame") or 0)
        timestamp = float(item.get("timestamp") or 0.0)
        layout_id = str(item.get("layout_id") or item.get("score_layout_id") or "lan2_split_2p")
        frame = load_selected_frame_image(item)
        if frame is None:
            continue
        if kind == "track_name":
            writer.write_anchor(
                frame=frame,
                video_label=video_label,
                stream_id=stream_id,
                race_number=race_sequence,
                frame_content="0TrackName",
                frame_index=frame_index,
                timestamp=timestamp,
                frame_hash=str(item.get("frame_hash", "")),
                source_rule="fresh_selected_result_frame_track_name",
            )
        elif kind == "race_score":
            writer.write_anchor(
                frame=frame,
                video_label=video_label,
                stream_id=stream_id,
                race_number=race_sequence,
                frame_content="2RaceScore",
                frame_index=frame_index,
                timestamp=timestamp,
                layout_id=layout_id,
                frame_hash=str(item.get("frame_hash", "")),
                source_rule="fresh_selected_result_frame_race_score_anchor",
            )
            # The frames saved from the rolling buffer at selection time come first, as on a capture card. A
            # replay used to re-read them from the file by the buffer's frame numbers, but OpenCV's seek in these
            # recordings lands one frame later and the buffer numbers run one ahead of the decode index: the window
            # moved 2 frames into the points roll-up (01-11 50cc cup: every race point read 1 low, every total 1 high).
            for context_frame, context_image in (
                load_context_frames_from_dir(item)
                or load_race_score_context_frames(video_path, item, frame_index)
            ):
                writer.write_race_context(
                    frame=context_image,
                    video_label=video_label,
                    stream_id=stream_id,
                    race_number=race_sequence,
                    frame_index=context_frame,
                    layout_id=layout_id,
                    source_rule="fresh_selected_result_frame_race_score_context_from_source_video",
                )
        elif kind == "total_score":
            writer.write_anchor(
                frame=frame,
                video_label=video_label,
                stream_id=stream_id,
                race_number=race_sequence,
                frame_content="3TotalScore",
                frame_index=frame_index,
                timestamp=timestamp,
                layout_id=layout_id,
                frame_hash=str(item.get("frame_hash", "")),
                source_rule="fresh_selected_result_frame_total_score_anchor",
            )
            for context_frame, context_image in (
                load_context_frames_from_dir(item)
                or load_video_context_frames(video_path, frame_index, crop=source_crop(item))
            ):
                writer.write_total_consensus(
                    frame=context_image,
                    video_label=video_label,
                    stream_id=stream_id,
                    race_number=race_sequence,
                    frame_index=context_frame,
                    layout_id=layout_id,
                    source_rule="fresh_selected_result_frame_total_score_consensus_from_source_video",
                )
    manifest_path = writer.write_manifest()
    grouped = group_live_bundle_images()
    write_json(
        "live_bundle_ocr_compatibility_report.json",
        {
            "run_id": current_run_id(),
            "bundle_root": str(LIVE_ROOT / "Live_Output" / "Frames"),
            "baseline_output_frames_avoided": True,
            "manifest_path": str(manifest_path),
            "grouped_race_count": len(grouped),
            "groups": [
                {
                    "video_label": key[0],
                    "race_number": key[1],
                    "images": [{"kind": kind, "path": path} for kind, path in images],
                    "has_race_score": any(kind == "2RaceScore" for kind, _path in images),
                    "has_total_score": any(kind == "3TotalScore" for kind, _path in images),
                    "has_track_name": any(kind == "0TrackName" for kind, _path in images),
                }
                for key, images in grouped
            ],
            "rich_groups": [group.to_report() for group in load_live_bundle_race_groups()],
        },
    )


def best_track_entries(selected: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for item in selected:
        if classify_entry(item) == "track_name":
            grouped[(str(item.get("stream_id", "unknown")), int(item.get("race_sequence") or 0))].append(item)
    return [
        sorted(items, key=lambda item: float(item.get("confidence") or 0.0), reverse=True)[0]
        for items in grouped.values()
        if items
    ]


def load_selected_frame_image(item: dict[str, Any]) -> Any | None:
    path_text = str(item.get("ocr_ready_crop_path") or item.get("crop_path") or "")
    if not path_text:
        return None
    image = cv2.imread(path_text, cv2.IMREAD_COLOR)
    if image is None:
        return None
    return normalize_live_frame(image)


def load_video_context_frames(
    video_path: Path, anchor_frame: int, radius: int = 2, crop: tuple[int, int, int, int] | None = None,
) -> list[tuple[int, Any]]:
    if not video_path.exists():
        return []
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return []
    frames: list[tuple[int, Any]] = []
    try:
        for frame_number in range(max(0, int(anchor_frame) - radius), int(anchor_frame) + radius + 1):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            frames.append((int(frame_number), normalize_live_frame(frame, crop)))
    finally:
        cap.release()
    return frames


def load_context_frames_from_dir(item: dict[str, Any]) -> list[tuple[int, Any]]:
    """Context frames persisted at selection time from the live rolling buffer.

    Live capture feeds have no video file to re-read, so the selection saves the
    consensus context window to disk (``context_frames_dir`` on the selected
    row) and this loader replays it — the same frames the file loaders would
    have re-read from the source video."""
    directory = str(item.get("context_frames_dir") or "")
    if not directory:
        return []
    path = Path(directory)
    if not path.exists():
        return []
    frames: list[tuple[int, Any]] = []
    for file in sorted(
        path.glob("F*.jpg"),
        key=lambda p: int(p.stem[1:]) if p.stem[1:].isdigit() else 0,
    ):
        image = cv2.imread(str(file))
        if image is None:
            continue
        index = int(file.stem[1:]) if file.stem[1:].isdigit() else len(frames)
        frames.append((index, normalize_live_frame(image, source_crop(item))))
    return frames


def load_race_score_context_frames(video_path: Path, item: dict[str, Any], anchor_frame: int) -> list[tuple[int, Any]]:
    crop = source_crop(item)
    start = parse_optional_int(item.get("points_context_start_frame"))
    end = parse_optional_int(item.get("points_context_end_frame"))
    if start is not None and end is not None and end >= start:
        return load_video_context_frame_range(video_path, start, end, crop=crop)
    points_anchor = parse_optional_int(item.get("actual_points_anchor_frame")) or parse_optional_int(item.get("selected_points_anchor_frame"))
    if points_anchor is not None and points_anchor > 0:
        return load_video_context_frame_range(video_path, int(points_anchor) - 3, int(points_anchor) + 3, crop=crop)
    start = parse_optional_int(item.get("race_context_start_frame"))
    end = parse_optional_int(item.get("race_context_end_frame"))
    if start is not None and end is not None and end >= start:
        return load_video_context_frame_range(video_path, start, end, crop=crop)
    return load_video_context_frames(video_path, anchor_frame, radius=2, crop=crop)


def load_video_context_frame_range(
    video_path: Path, start_frame: int, end_frame: int, crop: tuple[int, int, int, int] | None = None,
) -> list[tuple[int, Any]]:
    if not video_path.exists():
        return []
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return []
    frames: list[tuple[int, Any]] = []
    try:
        for frame_number in range(max(0, int(start_frame)), int(end_frame) + 1):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            frames.append((int(frame_number), normalize_live_frame(frame, crop)))
    finally:
        cap.release()
    return frames


def parse_optional_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(float(str(value)))
    except Exception:
        return None


def load_selected_frames() -> list[dict[str, Any]]:
    path = DIAGNOSTICS_ROOT / "selected_result_frames.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    raise ValueError("selected_result_frames.json must contain a list")


def pair_selected_frames(selected: list[dict[str, Any]]) -> list[dict[str, dict[str, Any]]]:
    grouped: dict[tuple[str, int], dict[str, list[dict[str, Any]]]] = defaultdict(lambda: {"race": [], "total": []})
    for item in selected:
        stream = str(item.get("stream_id", "unknown"))
        race_sequence = int(item.get("race_sequence") or 0)
        kind = classify_entry(item)
        if kind == "race_score":
            grouped[(stream, race_sequence)]["race"].append(item)
        elif kind == "total_score":
            grouped[(stream, race_sequence)]["total"].append(item)
    pairs = []
    for key in sorted(grouped):
        races = sorted(grouped[key]["race"], key=lambda item: float(item.get("confidence") or 0.0), reverse=True)
        totals = sorted(grouped[key]["total"], key=lambda item: float(item.get("confidence") or 0.0), reverse=True)
        if races and totals:
            pairs.append({"race": races[0], "total": totals[0]})
    return pairs


def classify_entry(entry: dict[str, Any]) -> str:
    fields = " ".join(str(entry.get(key, "")) for key in ["candidate_type", "screen_type", "crop_path", "ocr_ready_crop_path"])
    if "race_score" in fields or entry.get("selected_race_score_frame"):
        return "race_score"
    if "total_score" in fields or entry.get("selected_total_score_frame"):
        return "total_score"
    if "track_name" in fields or entry.get("selected_track_name_frame"):
        return "track_name"
    return "unknown"


def build_track_metadata(selected: list[dict[str, Any]]) -> dict[tuple[str, int], TrackMetadata]:
    metadata: dict[tuple[str, int], TrackMetadata] = {}
    assigned = assign_track_entries_to_completed_races(selected, classify=classify_entry)
    for key, item in assigned.items():
        extracted = extract_track_metadata(item)
        metadata[key] = replace(extracted, race_sequence=key[1])
    return metadata


def to_expected_tournament_rows(
    scoreboard_rows: list[dict[str, str]],
    race_entry: dict[str, Any],
    total_entry: dict[str, Any],
    track_metadata: dict[tuple[str, int], TrackMetadata],
) -> list[dict[str, str]]:
    video_name = expected_video_name(str(race_entry.get("video_path") or total_entry.get("video_path") or ""))
    race_number = str(race_entry.get("race_sequence") or total_entry.get("race_sequence") or "")
    stream_id = str(race_entry.get("stream_id") or total_entry.get("stream_id") or "unknown")
    track = track_metadata.get((stream_id, int(race_entry.get("race_sequence") or total_entry.get("race_sequence") or 0)))
    rows = []
    sorted_for_position_after = sorted(
        scoreboard_rows,
        key=lambda row: parse_int(row.get("NewTotalRacePoint") or row.get("Total") or "0"),
        reverse=True,
    )
    position_after = rank_players_by_total(sorted_for_position_after)
    for row in scoreboard_rows:
        total_after = row.get("NewTotalRacePoint") or row.get("Total") or ""
        race_points = row.get("RacePoints", "")
        total_before = row.get("CorrectedOldTotalScore") or row.get("OldTotalScore") or ""
        if not total_before and total_after and race_points:
            total_before = str(max(0, parse_int(total_after) - parse_int(race_points)))
        character = row.get("Character", "")
        rows.append(
            {
                "Video": video_name,
                "Race": race_number,
                # The original's placeholder for a race without a readable track card.
                "Track": (track.track_name if track else "") or TRACK_PLACEHOLDER,
                "Cup": track.cup_name if track else "",
                "Position": row.get("Position", ""),
                "Player": row.get("Player", ""),
                "Character": character,
                "Character Roster": character_roster_name(character),
                "Race Points": race_points,
                "Total Before Race": total_before,
                "Total After Race": total_after,
                "Position After Race": position_after.get(row.get("Player", ""), row.get("Position", "")),
                "Needs Review": "False",
                "Review Reason": "",
                "Counts Toward Totals": "True",
                "Scoring Note": "",
            }
        )
    return rows


def expected_video_name(video_path: str) -> str:
    path = Path(video_path)
    try:
        date = path.parents[1].name
        stage = path.parent.name
    except Exception:
        date = ""
        stage = ""
    stem = path.stem.replace(" ", "_")
    return "__".join(part for part in [date, stage, stem] if part)


def parse_int(value: str) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return 0


def rank_players_by_total(rows: list[dict[str, str]]) -> dict[str, str]:
    positions: dict[str, str] = {}
    previous_total: int | None = None
    previous_rank = 0
    for index, row in enumerate(rows, start=1):
        total = parse_int(row.get("NewTotalRacePoint") or row.get("Total") or "0")
        if previous_total is None or total != previous_total:
            previous_rank = index
            previous_total = total
        positions[row.get("Player", "")] = str(previous_rank)
    return positions


def write_json(name: str, payload: object) -> None:
    (DIAGNOSTICS_ROOT / name).write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
