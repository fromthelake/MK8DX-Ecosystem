from __future__ import annotations

import csv
import hashlib
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2  # type: ignore

from .baseline_assets import live_template_paths_in_baseline_order
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .results_banner import attach_results_banner
from .run_context import attach_run_id, current_run_id



from mk8dx_tournament_extraction.engine import extract_frames as baseline_extract_frames  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction.engine import extract_initial_scan as baseline_initial_scan  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction.engine import extract_score_screen_selection as baseline_selection  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction.engine.extract_common import frame_to_timecode  # type: ignore  # noqa: E402


@dataclass(frozen=True)
class ExactSelectionFrame:
    stream_id: str
    group_label: str
    race_sequence: int
    video_path: Path
    screen_type: str
    frame_index: int
    timestamp: float
    layout_id: str
    crop_path: Path
    frame_hash: str
    selection_reason: str
    source_candidate_frame: int
    confidence: float
    # Live capture feeds: consensus context frames extracted from the rolling
    # buffer at selection time (a live device has no file for the consensus
    # writer to re-read). Empty for file sources (they re-read the video).
    context_frames_dir: str = ""


@dataclass(frozen=True)
class ExactVideoSelection:
    stream_id: str
    group_label: str
    video_path: Path
    context: dict[str, Any]
    score_detections: list[dict[str, Any]]
    track_detections: list[dict[str, Any]]
    selection_results: list[dict[str, Any]]
    selected_frames: list[ExactSelectionFrame]


def load_initial_scan_templates() -> list[tuple[Any, Any]]:
    """Exact baseline template order, resolved from live-owned canonical assets."""
    templates: list[tuple[Any, Any]] = []
    for template_path in live_template_paths_in_baseline_order():
        template = cv2.imread(str(template_path), cv2.IMREAD_UNCHANGED)
        if template is None:
            raise FileNotFoundError(template_path)
        if len(template.shape) == 3 and template.shape[2] == 4:
            template_gray = cv2.cvtColor(template, cv2.COLOR_BGRA2GRAY)
            _, alpha_mask = cv2.threshold(template[:, :, 3], 0, 255, cv2.THRESH_BINARY)
            _, template_binary = cv2.threshold(template_gray, 180, 255, cv2.THRESH_BINARY)
        elif len(template.shape) == 3 and template.shape[2] == 3:
            template_gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
            _, template_binary = cv2.threshold(template_gray, 180, 255, cv2.THRESH_BINARY)
            alpha_mask = None
        elif len(template.shape) == 2:
            template_binary = template
            alpha_mask = None
        else:
            raise ValueError(f"Template image has an unexpected number of channels: {template_path}")
        templates.append((template_binary, alpha_mask))
    return templates


def select_result_frames_exact(
    *,
    video_path: Path,
    fixture_root: Path,
    stream_id: str,
    group_label: str,
    video_index: int,
    total_videos: int,
    templates: list[tuple[Any, Any]] | None = None,
) -> ExactVideoSelection:
    templates = templates or load_initial_scan_templates()
    context = baseline_extract_frames._prepare_video_context(
        str(video_path),
        str(fixture_root),
        False,
        video_index,
        total_videos,
        0.0,
        templates,
        video_label=stream_id,
        source_display_name=video_path.name,
    )
    if context is None:
        raise RuntimeError(f"Baseline _prepare_video_context returned None for {video_path}")

    initial_scan = scan_initial_detections_exact(context, templates)
    score_detections = initial_scan["score_detections"]
    track_detections = initial_scan["track_detections"]
    candidates = [
        {
            "race_number": index + 1,
            "frame_number": int(item["frame_number"]),
            "score_layout_id": item.get("score_layout_id"),
            "confidence": float(item.get("confidence", 0.0)),
        }
        for index, item in enumerate(score_detections)
    ]
    selection_results: list[dict[str, Any]] = []
    selected_frames: list[ExactSelectionFrame] = []
    expected_players: int | None = None
    for index, detection in enumerate(track_detections, start=1):
        frame_index = int(detection.get("save_frame_number") or detection.get("frame_number") or 0)
        if frame_index <= 0:
            continue
        crop_path, frame_hash = save_exact_track_name_frame(
            context=context,
            video_path=video_path,
            stream_id=stream_id,
            group_label=group_label,
            race_sequence=index,
            frame_index=frame_index,
            saved_image=detection.get("saved_image"),
        )
        selected_frames.append(
            ExactSelectionFrame(
                stream_id=stream_id,
                group_label=group_label,
                race_sequence=index,
                video_path=video_path,
                screen_type="track_name",
                frame_index=frame_index,
                timestamp=frame_index / float(context["fps"]),
                layout_id="track_name",
                crop_path=crop_path,
                frame_hash=frame_hash,
                selection_reason="exact_baseline_scan_detection_segment_track_detection",
                source_candidate_frame=int(detection.get("frame_number") or frame_index),
                confidence=float(detection.get("confidence", 0.0)),
            )
        )
    for candidate in candidates:
        result = analyze_candidate_exact(context, templates, candidate, expected_players=expected_players)
        total_visible_players = optional_int(result.get("total_score_visible_players"))
        if total_visible_players is not None:
            expected_players = max(int(expected_players or 0), int(total_visible_players))
        selection_results.append(result)
        for screen_type, key in [("race_score", "race_score_frame"), ("total_score", "total_score_frame")]:
            frame_index = selected_actual_frame_index(result, screen_type, key)
            if frame_index <= 0:
                continue
            crop_path, frame_hash = save_exact_selected_frame_crop(
                context=context,
                video_path=video_path,
                stream_id=stream_id,
                group_label=group_label,
                race_sequence=int(candidate["race_number"]),
                screen_type=screen_type,
                frame_index=frame_index,
                layout_id=str(result.get("score_layout_id") or candidate.get("score_layout_id") or ""),
            )
            selected_frames.append(
                ExactSelectionFrame(
                    stream_id=stream_id,
                    group_label=group_label,
                    race_sequence=int(candidate["race_number"]),
                    video_path=video_path,
                    screen_type=screen_type,
                    frame_index=frame_index,
                    timestamp=frame_index / float(context["fps"]),
                    layout_id=str(result.get("score_layout_id") or candidate.get("score_layout_id") or ""),
                    crop_path=crop_path,
                    frame_hash=frame_hash,
                    selection_reason="exact_baseline_analyze_score_window_task",
                    source_candidate_frame=int(candidate["frame_number"]),
                    confidence=float(candidate.get("confidence", 0.0)),
                )
            )

    return ExactVideoSelection(
        stream_id=stream_id,
        group_label=group_label,
        video_path=video_path,
        context=safe_context(context),
        score_detections=score_detections,
        track_detections=track_detections,
        selection_results=selection_results,
        selected_frames=selected_frames,
    )


def scan_score_detections_exact(context: dict[str, Any], templates: list[tuple[Any, Any]]) -> list[dict[str, Any]]:
    return scan_initial_detections_exact(context, templates)["score_detections"]


def scan_initial_detections_exact(context: dict[str, Any], templates: list[tuple[Any, Any]]) -> dict[str, list[dict[str, Any]]]:
    return scan_initial_detections_range_exact(
        context,
        templates,
        int(context["usable_start_frame"]),
        int(context["readable_end_frame"]),
    )


def scan_initial_detections_range_exact(
    context: dict[str, Any],
    templates: list[tuple[Any, Any]],
    scan_start: int,
    scan_end: int,
) -> dict[str, list[dict[str, Any]]]:
    if scan_end <= scan_start:
        return {"score_detections": [], "track_detections": [], "race_detections": []}
    task = {
        "segment_index": 0,
        "video_path": context["processing_video_path"],
        "video_label": context["video_label"],
        "video_source_path": context["source_display_name"],
        "fps": context["fps"],
        "scan_start": int(scan_start),
        "scan_end": int(scan_end),
        "emit_start": int(scan_start),
        "emit_end": int(scan_end),
        "templates": templates,
        "scale_x": context["median_scale_x"],
        "scale_y": context["median_scale_y"],
        "left": context["median_left"],
        "top": context["median_top"],
        "crop_width": context["median_crop_width"],
        "crop_height": context["median_crop_height"],
        "include_debug_rows": False,
        "window_steps": 1,
        "progress_report_seconds": 999999.0,
        "is_low_res_source": bool(context.get("is_low_res_source", False)),
    }
    result = baseline_initial_scan.scan_detection_segment(task)
    return {
        "score_detections": [dict(item) for item in result.get("score_detections", [])],
        "track_detections": [dict(item) for item in result.get("track_detections", [])],
        "race_detections": [dict(item) for item in result.get("race_detections", [])],
    }


def make_streaming_detection_scanner(
    context: dict[str, Any],
    templates: list[tuple[Any, Any]],
    scan_start: int = 0,
) -> Any:
    """Build a persistent StreamingSegmentScanner for the live path. Detection state
    + capture survive across `advance(scan_end)` calls, so there is no fixed scan
    chunk; equivalent by construction to one scan_detection_segment over the range."""
    task = {
        "segment_index": 0,
        "video_path": context["processing_video_path"],
        "video_label": context["video_label"],
        "video_source_path": context["source_display_name"],
        "fps": context["fps"],
        "scan_start": int(scan_start),
        "scan_end": int(scan_start),
        "emit_start": 0,
        "emit_end": 10 ** 18,
        "templates": templates,
        "scale_x": context["median_scale_x"],
        "scale_y": context["median_scale_y"],
        "left": context["median_left"],
        "top": context["median_top"],
        "crop_width": context["median_crop_width"],
        "crop_height": context["median_crop_height"],
        "include_debug_rows": False,
        "window_steps": 1,
        "progress_report_seconds": 999999.0,
        "is_low_res_source": bool(context.get("is_low_res_source", False)),
    }
    return baseline_initial_scan.StreamingSegmentScanner(task)


def analyze_candidate_exact(
    context: dict[str, Any],
    templates: list[tuple[Any, Any]],
    candidate: dict[str, Any],
    expected_players: int | None = None,
    capture: Any | None = None,
) -> dict[str, Any]:
    selection_task = {
        "video_path": context["processing_video_path"],
        "race_number": candidate["race_number"],
        "frame_number": candidate["frame_number"],
        "fps": context["fps"],
        "templates": templates,
        "scale_x": context["median_scale_x"],
        "scale_y": context["median_scale_y"],
        "left": context["median_left"],
        "top": context["median_top"],
        "crop_width": context["median_crop_width"],
        "crop_height": context["median_crop_height"],
        "source_height": int(context.get("source_height", 0) or 0),
        "ocr_consensus_frames": baseline_extract_frames.APP_CONFIG.ocr_consensus_frames,
        "score_layout_id": candidate.get("score_layout_id"),
    }
    result = baseline_selection.analyze_score_window_task(selection_task, frame_to_timecode, capture=capture)
    before_race_score_frame = int(result.get("actual_race_score_frame") or result.get("race_score_frame") or 0)
    total_score_image = result.get("total_score_image")
    visible_players = optional_int(result.get("total_score_visible_players"))
    if total_score_image is not None and (visible_players is None or visible_players <= 0):
        visible_players = baseline_selection.count_visible_position_rows(
            total_score_image,
            result.get("candidate", {}).get("score_layout_id"),
        )
        result["total_score_visible_players"] = visible_players
    effective_expected_players = expected_players
    expected_player_signals = [
        visible_players,
        optional_int(result.get("expected_total_players")),
        optional_int(result.get("cap_source_visible_rows")),
    ]
    for signal in expected_player_signals:
        if signal is not None and int(signal) > 0:
            effective_expected_players = max(int(effective_expected_players or 0), int(signal))
    refine_expected_players = effective_expected_players if int(candidate.get("race_number") or 0) >= 2 else None
    result["live_expected_players_before_refine"] = refine_expected_players
    result = baseline_selection.refine_race_score_result_for_expected_players(result, refine_expected_players, capture=capture)
    result, live_extended_refinement = refine_race_score_result_to_cap_source_row12(result, refine_expected_players, capture=capture)
    result = baseline_selection.expand_race_score_consensus_window(result, refine_expected_players, capture=capture)
    after_race_score_frame = int(result.get("actual_race_score_frame") or result.get("race_score_frame") or 0)
    result["live_12th_row_refinement"] = {
        "expected_players": refine_expected_players,
        "before_actual_race_score_frame": before_race_score_frame,
        "after_actual_race_score_frame": after_race_score_frame,
        "shifted": bool(before_race_score_frame and after_race_score_frame and before_race_score_frame != after_race_score_frame),
        "total_score_visible_players": visible_players,
        "cap_source_visible_rows": optional_int(result.get("cap_source_visible_rows")),
        "cap_source_frame": optional_int(result.get("cap_source_frame")),
        "extended_search": live_extended_refinement,
    }
    if after_race_score_frame > 0:
        result["race_context_start_frame"] = max(0, after_race_score_frame - baseline_selection.RACE_SCORE_EARLY_EXPANSION_FRAMES)
        result["race_context_end_frame"] = after_race_score_frame + baseline_selection.RACE_SCORE_LATE_EXPANSION_FRAMES
    actual_points_anchor_frame = optional_int(result.get("actual_points_anchor_frame"))
    selected_points_anchor_frame = optional_int(result.get("selected_points_anchor_frame"))
    points_anchor_frame = actual_points_anchor_frame or selected_points_anchor_frame
    if points_anchor_frame is not None and points_anchor_frame > 0:
        result["points_context_start_frame"] = max(0, int(points_anchor_frame) - 3)
        result["points_context_end_frame"] = int(points_anchor_frame) + 3
    # Diagnostic only: the race-ending banner (Race.msbt 9105-9107) near the
    # first score frame. It never moves the selection.
    attach_results_banner(result, context, before_race_score_frame, capture=capture)
    return {
        key: json_safe(value)
        for key, value in result.items()
        if key
        not in {
            "race_consensus_frames",
            "score_consensus_frames",
            "transition_consensus_frames",
            "total_consensus_frames",
        }
    }


def refine_race_score_result_to_cap_source_row12(
    result: dict[str, Any],
    expected_players: int | None,
    capture: Any | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Extend baseline 12th-row refinement to the selector's own cap-source frame.

    The baseline helper searches a short fixed window. The score-window selector also
    records ``cap_source_frame`` when position-guided evidence around the transition
    indicates the full player count. For live bundle generation we must not keep an
    anchor where row 12 is still hidden by the transition bar if the selector already
    found a later 12-player cap source.
    """
    details: dict[str, Any] = {
        "attempted": False,
        "shifted": False,
        "reason": "not_needed",
    }
    if int(expected_players or 0) != 12:
        details["reason"] = "expected_players_not_12"
        return result, details
    race_score_image = result.get("race_score_image")
    if race_score_image is None:
        details["reason"] = "missing_race_score_image"
        return result, details
    score_layout_id = result.get("candidate", {}).get("score_layout_id")
    position_metrics = baseline_selection._position_metrics_for_frame(
        race_score_image,
        score_layout_id=score_layout_id,
    )
    if baseline_selection._row_has_expected_template(
        position_metrics,
        12,
        baseline_selection.POSITION_PRESENT_COEFF_THRESHOLD,
    ):
        details["reason"] = "row12_already_present"
        return result, details

    candidate = result.get("candidate", {})
    fps = float(candidate.get("fps", 0) or 0)
    start_frame = int(result.get("race_score_frame", 0) or result.get("actual_race_score_frame", 0) or 0)
    cap_source_frame = optional_int(result.get("cap_source_frame"))
    selected_points_anchor_frame = optional_int(result.get("selected_points_anchor_frame"))
    baseline_end = start_frame + int(baseline_selection.fps_scaled_frames(10, fps))
    search_end = max(
        baseline_end,
        int(cap_source_frame or 0),
        int(selected_points_anchor_frame or 0),
    )
    if start_frame <= 0 or search_end <= start_frame:
        details.update(
            {
                "attempted": True,
                "reason": "no_forward_search_window",
                "start_frame": start_frame,
                "search_end_frame": search_end,
            }
        )
        return result, details

    video_path = candidate.get("video_path")
    owned_capture = capture is None
    local_cap = capture if capture is not None else cv2.VideoCapture(str(video_path))
    if local_cap is None or not local_cap.isOpened():
        details.update(
            {
                "attempted": True,
                "reason": "video_open_failed",
                "video_path": str(video_path),
                "start_frame": start_frame,
                "search_end_frame": search_end,
            }
        )
        return result, details

    details.update(
        {
            "attempted": True,
            "reason": "row12_not_found",
            "start_frame": start_frame,
            "baseline_search_end_frame": baseline_end,
            "search_end_frame": search_end,
            "cap_source_frame": cap_source_frame,
            "selected_points_anchor_frame": selected_points_anchor_frame,
        }
    )
    try:
        stats = result.get("stats")
        if not isinstance(stats, dict):
            stats = {}
            result["stats"] = stats
        for frame_number in range(start_frame + 1, search_end + 1):
            actual_frame, refined_image = baseline_selection.capture_export_frame(
                local_cap,
                int(frame_number),
                candidate.get("left"),
                candidate.get("top"),
                candidate.get("crop_width"),
                candidate.get("crop_height"),
                candidate.get("scale_x"),
                candidate.get("scale_y"),
                stats,
                label="live_row12_cap_source_probe",
            )
            if actual_frame is None or refined_image is None:
                continue
            refined_metrics = baseline_selection._position_metrics_for_frame(
                refined_image,
                score_layout_id=score_layout_id,
            )
            if not baseline_selection._row_has_expected_template(
                refined_metrics,
                12,
                baseline_selection.POSITION_PRESENT_COEFF_THRESHOLD,
            ):
                continue
            final_frame = int(frame_number) + int(
                baseline_selection.fps_scaled_frames(
                    baseline_selection.RACE_SCORE_EXTRA_DELAY_FRAMES_30FPS,
                    fps,
                )
            )
            final_actual_frame, final_image = baseline_selection.capture_export_frame(
                local_cap,
                int(final_frame),
                candidate.get("left"),
                candidate.get("top"),
                candidate.get("crop_width"),
                candidate.get("crop_height"),
                candidate.get("scale_x"),
                candidate.get("scale_y"),
                stats,
                label="live_row12_cap_source_final",
            )
            if final_actual_frame is None or final_image is None:
                final_frame = int(frame_number)
                final_actual_frame = int(actual_frame)
                final_image = refined_image
            result["race_score_frame"] = int(final_frame)
            result["actual_race_score_frame"] = int(final_actual_frame)
            result["race_score_image"] = final_image
            expanded_start_frame = max(
                0,
                int(final_actual_frame) - baseline_selection.RACE_SCORE_EARLY_EXPANSION_FRAMES,
            )
            expanded_end_frame = int(final_actual_frame) + baseline_selection.RACE_SCORE_LATE_EXPANSION_FRAMES
            result["race_consensus_frames"] = baseline_selection.collect_frame_range_from_capture(
                local_cap,
                expanded_start_frame,
                expanded_end_frame,
                candidate.get("left"),
                candidate.get("top"),
                candidate.get("crop_width"),
                candidate.get("crop_height"),
                stats=stats,
                label="live_row12_cap_source_expand",
            )
            details.update(
                {
                    "shifted": True,
                    "reason": "row12_found_before_cap_source",
                    "row12_found_frame": int(actual_frame),
                    "final_frame": int(final_frame),
                    "final_actual_frame": int(final_actual_frame),
                    "expanded_start_frame": int(expanded_start_frame),
                    "expanded_end_frame": int(expanded_end_frame),
                }
            )
            break
    finally:
        if owned_capture:
            local_cap.release()
    return result, details


def selected_actual_frame_index(result: dict[str, Any], screen_type: str, fallback_key: str) -> int:
    if screen_type == "race_score":
        value = result.get("actual_race_score_frame") or result.get(fallback_key)
    elif screen_type == "total_score":
        value = result.get("actual_total_score_frame") or result.get(fallback_key)
    else:
        value = result.get(fallback_key)
    return int(value or 0)


def save_exact_selected_frame_crop(
    *,
    context: dict[str, Any],
    video_path: Path,
    stream_id: str,
    group_label: str,
    race_sequence: int,
    screen_type: str,
    frame_index: int,
    layout_id: str,
    capture: Any | None = None,
    allow_file_fallback: bool = True,
) -> tuple[Path, str]:
    # allow_file_fallback=False is the live capture-card contract: a real device
    # has no file to re-read, so the frame must come from the injected buffered
    # capture or the save fails (the caller degrades gracefully, never crashes).
    if capture is None and not allow_file_fallback:
        raise RuntimeError(
            f"Buffer-only crop save for {stream_id} race {race_sequence} {screen_type} "
            f"frame {frame_index} was requested without a buffered capture"
        )
    owned_capture = capture is None
    cap = capture if capture is not None else cv2.VideoCapture(str(video_path))
    if cap is None or not cap.isOpened():
        raise RuntimeError(f"Could not open video for selected frame crop: {video_path}")
    try:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ok, frame = cap.read()
        if not ok and not owned_capture and allow_file_fallback:
            # Injected buffer didn't hold this frame; fall back to the file so a
            # near-edge selected frame can never fail the crop save.
            file_cap = cv2.VideoCapture(str(video_path))
            try:
                file_cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                ok, frame = file_cap.read()
            finally:
                file_cap.release()
        if not ok:
            raise RuntimeError(f"Could not read selected frame {frame_index} from {video_path}")
        upscaled = baseline_selection.crop_and_upscale_image(
            frame,
            int(context["median_left"]),
            int(context["median_top"]),
            int(context["median_crop_width"]),
            int(context["median_crop_height"]),
            baseline_selection.TARGET_WIDTH,
            baseline_selection.TARGET_HEIGHT,
        )
        enhanced = baseline_selection.enhance_export_frame(
            upscaled,
            float(context["median_scale_x"]),
            float(context["median_scale_y"]),
        )
        root = assert_write_allowed(DIAGNOSTICS_ROOT / "frame_debug" / "detection_crops" / "exact_baseline")
        root.mkdir(parents=True, exist_ok=True)
        safe_group = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in group_label)
        safe_layout = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in (layout_id or "unknown_layout"))
        filename = f"{safe_group}_race_{race_sequence:02d}_{screen_type}_{safe_layout}_{frame_index}_full_frame.jpg"
        path = assert_write_allowed(root / filename)
        cv2.imwrite(str(path), enhanced)
        return path, image_file_hash(path)
    finally:
        if owned_capture:
            cap.release()


def save_exact_track_name_frame(
    *,
    context: dict[str, Any],
    video_path: Path,
    stream_id: str,
    group_label: str,
    race_sequence: int,
    frame_index: int,
    saved_image: Any | None,
) -> tuple[Path, str]:
    if saved_image is not None:
        image = baseline_selection.enhance_export_frame(
            saved_image,
            float(context["median_scale_x"]),
            float(context["median_scale_y"]),
        )
        root = assert_write_allowed(DIAGNOSTICS_ROOT / "frame_debug" / "detection_crops" / "exact_baseline")
        root.mkdir(parents=True, exist_ok=True)
        safe_group = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in group_label)
        filename = f"{safe_group}_race_{race_sequence:02d}_track_name_track_name_{frame_index}_full_frame.jpg"
        path = assert_write_allowed(root / filename)
        cv2.imwrite(str(path), image)
        return path, image_file_hash(path)
    return save_exact_selected_frame_crop(
        context=context,
        video_path=video_path,
        stream_id=stream_id,
        group_label=group_label,
        race_sequence=race_sequence,
        screen_type="track_name",
        frame_index=frame_index,
        layout_id="track_name",
    )


def image_file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_context(context: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "fps",
        "frame_skip",
        "total_frames",
        "usable_start_frame",
        "readable_end_frame",
        "median_scale_x",
        "median_scale_y",
        "median_left",
        "median_top",
        "median_crop_width",
        "median_crop_height",
        "source_height",
        "is_low_res_source",
    ]
    return {key: json_safe(context.get(key)) for key in keys}


def json_safe(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    try:
        import numpy as np  # type: ignore

        if isinstance(value, np.generic):
            return value.item()
    except Exception:
        pass
    return str(value)


def optional_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(float(str(value)))
    except Exception:
        return None


def selected_frame_report_rows(selections: list[ExactVideoSelection]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for selection in selections:
        for frame in selection.selected_frames:
            rows.append(
                {
                    "run_id": current_run_id(),
                    "stream_id": frame.stream_id,
                    "group_label": frame.group_label,
                    "race_sequence": frame.race_sequence,
                    "video_path": str(frame.video_path),
                    "screen_type": frame.screen_type,
                    # The confirmed reading rebuilds its bundles from these rows; without the layout it falls back
                    # to lan2_split_2p and reads a one-player board (lan1_full_1p) with the wrong rows: 0 rows,
                    # retried forever (01-11 150cc cup, one player per console).
                    "layout_id": frame.layout_id,
                    "selected_race_score_frame": frame.frame_index if frame.screen_type == "race_score" else None,
                    "selected_total_score_frame": frame.frame_index if frame.screen_type == "total_score" else None,
                    "selected_track_name_frame": frame.frame_index if frame.screen_type == "track_name" else None,
                    "frame_index": frame.frame_index,
                    "timestamp": frame.timestamp,
                    "confidence": frame.confidence,
                    "frame_hash": frame.frame_hash,
                    "selection_reason": frame.selection_reason,
                    "source_candidate_frame": frame.source_candidate_frame,
                    "crop_path": str(frame.crop_path),
                    "ocr_ready_crop_path": str(frame.crop_path),
                    "context_frames_dir": frame.context_frames_dir,
                    "generated_at": generated_at,
                    **selection_context_fields(selection.selection_results, frame.race_sequence, frame.screen_type),
                    **source_crop_fields(selection.context),
                }
            )
    return rows


def source_crop_fields(context: dict[str, Any]) -> dict[str, Any]:
    """The video's median active-picture crop, as the original applies it to every frame.

    The selected crop is already cut this way; the consensus context frames are
    re-read raw from the video (or the capture buffer), so they need it too. A
    recording with black borders at full 1280x720 is otherwise read at the wrong
    positions."""
    values = [optional_int(context.get(key)) for key in (
        "median_left", "median_top", "median_crop_width", "median_crop_height")]
    if any(value is None for value in values) or values[2] <= 0 or values[3] <= 0:
        return {}
    return {"source_crop": values}


def selection_context_fields(selection_results: list[dict[str, Any]], race_sequence: int, screen_type: str) -> dict[str, Any]:
    result = next(
        (
            item for item in selection_results
            if int((item.get("candidate") or {}).get("race_number") or 0) == int(race_sequence)
        ),
        {},
    )
    payload: dict[str, Any] = {}
    if screen_type == "race_score":
        for key in (
            "race_context_start_frame",
            "race_context_end_frame",
            "points_context_start_frame",
            "points_context_end_frame",
            "selected_points_anchor_frame",
            "actual_points_anchor_frame",
            "actual_race_score_frame",
            "race_score_frame",
            "live_expected_players_before_refine",
            "live_12th_row_refinement",
        ):
            if key in result:
                payload[key] = result[key]
    elif screen_type == "total_score":
        for key in ("actual_total_score_frame", "total_score_frame", "total_score_visible_players"):
            if key in result:
                payload[key] = result[key]
    return payload


def write_exact_selection_reports(selections: list[ExactVideoSelection]) -> None:
    write_json(
        "exact_result_frame_selection_port.json",
        {
            "run_id": current_run_id(),
            "method": "SAFE_IMPORT_READ_ONLY scan_detection_segment + analyze_score_window_task; exact baseline template loader copied",
            "videos": [
                {
                    "stream_id": selection.stream_id,
                    "group_label": selection.group_label,
                    "video_path": str(selection.video_path),
                    "context": selection.context,
                    "score_detection_count": len(selection.score_detections),
                    "track_detection_count": len(selection.track_detections),
                    "selection_count": len(selection.selection_results),
                    "selected_frame_count": len(selection.selected_frames),
                    "complete_pairs": count_complete_pairs(selection.selected_frames),
                    "score_detections": selection.score_detections,
                    "track_detections": [
                        {key: value for key, value in detection.items() if key != "saved_image"}
                        for detection in selection.track_detections
                    ],
                    "selection_results": selection.selection_results,
                }
                for selection in selections
            ],
        },
    )
    write_json("selected_result_frames.json", selected_frame_report_rows(selections))
    write_selection_port_markdown(selections)


def count_complete_pairs(frames: list[ExactSelectionFrame]) -> int:
    pairs: set[int] = set()
    race_sequences = {frame.race_sequence for frame in frames}
    for race_sequence in race_sequences:
        types = {frame.screen_type for frame in frames if frame.race_sequence == race_sequence}
        if {"race_score", "total_score"} <= types:
            pairs.add(race_sequence)
    return len(pairs)


def write_json(name: str, payload: Any) -> Path:
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(DIAGNOSTICS_ROOT / name)
    path.write_text(json.dumps(attach_run_id(payload), indent=2, sort_keys=True), encoding="utf-8")
    return path


def write_selection_port_markdown(selections: list[ExactVideoSelection]) -> Path:
    path = assert_write_allowed(DIAGNOSTICS_ROOT / "exact_result_frame_selection_port.md")
    lines = [
        "# Exact Result Frame Selection Port",
        "",
        "- Baseline scan candidate function: `extract_initial_scan.scan_detection_segment` via worker-safe wrapper.",
        "- Baseline selection function: `extract_score_screen_selection.analyze_score_window_task`.",
        "- Baseline template loading: copied exactly from `extract_frames.main`, resolving baseline assets read-only.",
        "- Baseline crop/scale context: `extract_frames._prepare_video_context`.",
        "- Output path difference: selected frame crops are written under live `Live_Output/diagnostics/frame_debug/detection_crops/exact_baseline`.",
        "",
        "| Stream | Score Detections | Selection Results | Complete Pairs |",
        "| --- | ---: | ---: | ---: |",
    ]
    for selection in selections:
        lines.append(
            f"| {selection.stream_id} | {len(selection.score_detections)} | "
            f"{len(selection.selection_results)} | {count_complete_pairs(selection.selected_frames)} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
