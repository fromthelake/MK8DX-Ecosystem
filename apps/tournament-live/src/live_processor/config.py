from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .paths import LIVE_ROOT


@dataclass(frozen=True)
class LiveConfig:
    frame_buffer_seconds: float = 90.0
    frame_buffer_max_fps: float = 5.0
    frame_buffer_store_full_resolution: str = "candidate_only"
    frame_buffer_full_resolution_window_seconds: float = 10.0
    frame_buffer_max_memory_mb_per_stream: float = 512.0
    replay_analysis_fps: float = 1.0
    replay_sample_duration_seconds: float = 900.0
    replay_sample_mode: str = "middle"
    result_search_delay_seconds: float = 35.0
    result_search_lookback_seconds: float = 10.0
    result_search_early_tolerance_seconds: float = 5.0
    result_search_late_timeout_seconds: float = 120.0
    min_race_gap_seconds: float = 90.0
    recording_width: int = 1280
    recording_height: int = 720
    recording_video_bitrate: str = "12M"
    recording_maxrate: str = "16M"
    recording_bufsize: str = "24M"
    recording_encoder_preference: str = "x264"
    # Zero means no invented tournament-duration reserve. Operators may set a
    # measured event duration; preflight always reports remaining estimated
    # hours and enforces this reserve when configured.
    recording_planned_duration_hours: float = 0.0
    gui_preflight_workers: int = 2
    live_parallel_video_scan_workers: int = 2
    live_score_analysis_workers: int = 4
    live_cuda_ocr_workers: int = 4
    live_ocr_consumers: int = 2
    live_consensus_workers_default: int = 2
    live_consensus_workers_max: int = 3
    live_consensus_worker_mode: str = "exact_bundle"
    live_consensus_parallel_enabled: bool = True
    # Live-faithful frame selection: feed the validated selector from a rolling
    # buffer of already-received frames instead of re-reading the video file.
    # Lossless + full-fps is mandatory (JPEG/throttling shift TotalScore frames,
    # see _archive/cleanup_2026-07-06/scripts/run_buffer_selection_equivalence.py). Retention must cover the
    # selector window [anchor-3s, anchor+13s] back from the live edge (~24s); 26s
    # adds margin. Detection now reads this same buffer too (no second decoder).
    # Memory ~= retention_seconds * fps * frame_bytes per stream (~6GB across 3x
    # 720p streams). File read is used as a fallback only when the buffer does not
    # fully cover the window (e.g. source ended).
    analysis_window_buffer_enabled: bool = True
    analysis_window_retention_seconds: float = 26.0
    # Live latency levers (full reasoning: docs/live_latency_architecture.md).
    # SAFETY CEILING ONLY — NOT a fixed wait. The confirmed selection is event-
    # triggered on the 20-frame TotalScore settle (~transition+5s); this value only
    # bounds the wait in the rare case where the points roll-up is never detected,
    # so the worker cannot hang. The normal path never reaches it.
    result_selection_gate_seconds: float = 15.0
    # Live-native fast finishing order: earliest seconds past the anchor to start
    # probing the selection. The probe FIRES only when the selector reports the
    # points roll-up is present (adapts to the real animation moment, not a fixed
    # offset); otherwise it retries as more frames stream in. The confirmed
    # TotalScore is event-triggered on the settle (see above). Frame-identical.
    race_probe_min_seconds: float = 1.5
    # Run each stream's scan+selection in parallel (synced races otherwise
    # serialize ~12-14s each in one worker thread).
    parallel_stream_selection: bool = True


def load_live_config(path: Path | None = None) -> LiveConfig:
    path = path or (LIVE_ROOT / "config" / "live_config.json")
    if not path.exists():
        return LiveConfig()
    payload = json.loads(path.read_text(encoding="utf-8"))
    fields = {field.name for field in LiveConfig.__dataclass_fields__.values()}
    return LiveConfig(**{key: payload[key] for key in fields if key in payload})
