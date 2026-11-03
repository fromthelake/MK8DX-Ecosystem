from __future__ import annotations

import json
import queue
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import cv2  # type: ignore
from mk8dx_tournament_extraction.cup_final import FRAME_CONTENT as CUP_FINAL_CONTENT
from mk8dx_tournament_extraction.cup_final import DROP_BACKOFF_SECONDS as CUP_FINAL_DROP_BACKOFF_SECONDS
from mk8dx_tournament_extraction.cup_final import SETTLE_SECONDS as CUP_FINAL_SETTLE_SECONDS
from mk8dx_tournament_extraction.cup_final import detect_cup_final

from .baseline_score_detector import BaselineScoreScreenDetector
from .baseline_consensus import get_race_points, official_visible_row_count_from_attempt, race_points_source_for_player_count
from .baseline_export_metadata import TrackMetadata, extract_track_metadata
from .baseline_row_ocr import BaselineRowOcrExtractor
from .baseline_vision import (
    TARGET_HEIGHT,
    TARGET_WIDTH,
    bounded_roi,
    expanded_roi,
    load_initial_scan_templates,
    match_template,
    preprocess_initial_scan_roi,
    to_working_canvas,
)
from .config import LiveConfig, load_live_config
from .exact_baseline_method import ExactSelectionFrame, ExactVideoSelection, safe_context, write_exact_selection_reports
from .frame_buffer import RollingFrameBuffer, decode_compressed_frame, hash_frame, write_frame_buffer_report
from .gui_events import GuiEventBus
from .live_frame_bundles import LiveFrameBundleWriter, sanitize_video_label
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed


TRACK_ROI = (141, 607, 183, 101)
RACE_ROI = (540, 590, 144, 48)
RACE_ALT_ROIS = ((640, 590, 144, 48), (694, 594, 130, 40))
IGNORE_ROIS = ((413, 667, 808, 36), (660, 667, 561, 33), (556, 667, 664, 34))


@dataclass(frozen=True)
class DecodedFrame:
    source_id: str
    stream_label: str
    video_path: Path
    frame_index: int
    timestamp: float
    frame: Any


@dataclass
class LiveFrameSignal:
    stream_label: str
    frame_index: int
    timestamp: float
    ignore_overlay_present: bool = False
    track_name_present: bool = False
    race_number_present: bool = False
    score_screen_visible: bool = False
    score_layout_id: str = ""
    visible_player_count: int = 0
    confidence: float = 0.0
    cup_final_present: bool = False
    features: dict[str, Any] = field(default_factory=dict)


@dataclass
class LiveRaceBundleState:
    race_sequence: int
    state: str = "WAITING_FOR_RACE"
    track_detected_frame: int | None = None
    track_save_frame: int | None = None
    track_saved: bool = False
    race_number_frame: int | None = None
    race_number_saved: bool = False
    first_score_frame: int | None = None
    last_score_frame: int | None = None
    score_layout_id: str = ""
    score_candidates: list[LiveFrameSignal] = field(default_factory=list)
    drop_start_frame: int | None = None
    race_score_frame: int | None = None
    total_score_frame: int | None = None
    finalized: bool = False
    provisional_started: bool = False


class LiveSignalSourceAnalyzer:
    def __init__(
        self,
        *,
        source_id: str,
        stream_label: str,
        video_path: Path,
        fps: float,
        event_bus: GuiEventBus,
        context: dict[str, Any] | None = None,
        config: LiveConfig | None = None,
    ) -> None:
        self.source_id = source_id
        self.stream_label = stream_label
        self.video_path = video_path
        self.fps = float(fps or 30.0)
        self.video_label = sanitize_video_label(video_path)
        self.event_bus = event_bus
        self.context = context or {"fps": self.fps, "usable_start_frame": 0, "readable_end_frame": 0}
        self.config = config or load_live_config()
        self.config = LiveConfig(
            **{
                **self.config.__dict__,
                "frame_buffer_seconds": max(15.0, float(self.config.frame_buffer_seconds)),
                "frame_buffer_max_fps": max(float(self.fps), float(self.config.frame_buffer_max_fps)),
            }
        )
        self.buffer = RollingFrameBuffer(stream_label, self.config)
        self.bundle_writer = LiveFrameBundleWriter()
        # Keep virtual-live playback close to analysis. A large queue lets Full Speed
        # preview race far ahead of TrackName/score detection, which looks like the
        # GUI skipped detections even though frames are eventually analyzed.
        self.queue: queue.Queue[DecodedFrame | None] = queue.Queue(maxsize=max(15, int(self.fps * 2)))
        self.score_detector = BaselineScoreScreenDetector()
        self.initial_templates = load_initial_scan_templates()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._signals: list[dict[str, Any]] = []
        self._state_log: list[dict[str, Any]] = []
        self._current_race: LiveRaceBundleState | None = None
        self._completed_races: list[LiveRaceBundleState] = []
        self._selected_frames: list[ExactSelectionFrame] = []
        self._last_score_visible = False
        self._last_track_emit_frame = -10_000_000
        self._last_race_emit_frame = -10_000_000
        self._track_metadata: dict[tuple[str, int], TrackMetadata] = {}
        self._track_ocr_threads: list[threading.Thread] = []
        self._race_score_ocr_threads: list[threading.Thread] = []
        self._row_ocr_extractor: BaselineRowOcrExtractor | None = None
        # The cup end screen (065): first frame it was seen, and whether this cup's frame is kept.
        self._cup_final_first_frame: int | None = None
        self._cup_final_last_frame: int | None = None
        self._cup_final_saved = False

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name=f"live-signal-{self.source_id}", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self.queue.put(None)
        if self._thread:
            self._thread.join(timeout=10.0)
        for thread in list(self._track_ocr_threads):
            thread.join(timeout=10.0)
        for thread in list(self._race_score_ocr_threads):
            thread.join(timeout=10.0)
        self.write_reports()

    def drain(self, timeout: float = 60.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.queue.empty():
                return True
            time.sleep(0.05)
        return self.queue.empty()

    def submit(self, decoded: DecodedFrame) -> None:
        self.queue.put(decoded)

    def _run(self) -> None:
        while not self._stop.is_set():
            item = self.queue.get()
            if item is None:
                break
            try:
                self._process_frame(item)
            except Exception as exc:
                self.event_bus.emit(
                    "ANALYSIS_PROGRESS",
                    source_id=self.source_id,
                    stream_label=self.stream_label,
                    timestamp=item.timestamp,
                    frame_index=item.frame_index,
                    message=f"signal analysis error: {exc}",
                )
        self.write_reports()

    def _process_frame(self, decoded: DecodedFrame) -> None:
        normalized = normalize_live_frame(decoded.frame)
        entry = self.buffer.add_frame(decoded.video_path, decoded.frame_index, decoded.timestamp, normalized)
        if entry is not None:
            entry.detection_metadata["normalized_size"] = [TARGET_WIDTH, TARGET_HEIGHT]
        signal = self._detect_signal(normalized, decoded)
        self._signals.append(signal_to_dict(signal))
        self._advance_state(signal)

    def _detect_signal(self, normalized: Any, decoded: DecodedFrame) -> LiveFrameSignal:
        gray = cv2.cvtColor(normalized, cv2.COLOR_BGR2GRAY)
        ignore_scores = [
            _template_score(gray, roi, self.initial_templates[name], process_type=1, expand=False)
            for roi, name in zip(IGNORE_ROIS, ("ignore", "ignore_album_gallery", "ignore_2"))
        ]
        track_score = _template_score(gray, TRACK_ROI, self.initial_templates["track"], process_type=1)
        race_scores = [_template_score(gray, RACE_ROI, self.initial_templates["race"], process_type=1)]
        race_scores.append(_template_score(gray, RACE_ALT_ROIS[0], self.initial_templates["race"], process_type=1))
        race_scores.append(_template_score(gray, RACE_ALT_ROIS[1], self.initial_templates["race_nl"], process_type=1))
        score_match = self.score_detector.detect_score_screen(
            frame=normalized,
            stream_id=self.stream_label,
            frame_index=decoded.frame_index,
            candidate_type="live_signal",
            write_debug=False,
        )
        cup_final = detect_cup_final(normalized)
        return LiveFrameSignal(
            stream_label=self.stream_label,
            frame_index=decoded.frame_index,
            timestamp=decoded.timestamp,
            ignore_overlay_present=max(ignore_scores or [0.0]) >= 0.75,
            track_name_present=track_score >= 0.6,
            race_number_present=max(race_scores or [0.0]) >= 0.6,
            score_screen_visible=score_match.is_score_screen,
            score_layout_id=score_match.layout_id,
            visible_player_count=score_match.accepted_rows,
            cup_final_present=cup_final.present,
            confidence=max(float(track_score), float(max(race_scores or [0.0])), float(score_match.confidence)),
            features={
                "track_score": track_score,
                "race_score": max(race_scores or [0.0]),
                "ignore_score": max(ignore_scores or [0.0]),
                "score_confidence": score_match.confidence,
                "accepted_rows": score_match.accepted_rows,
                "cup_final_score": cup_final.score,
                "normalized_size": [TARGET_WIDTH, TARGET_HEIGHT],
            },
        )

    def _advance_state(self, signal: LiveFrameSignal) -> None:
        if signal.ignore_overlay_present:
            return
        self._track_cup_final(signal)
        if signal.track_name_present and signal.frame_index - self._last_track_emit_frame > int(self.fps * 20):
            self._last_track_emit_frame = signal.frame_index
            self._cup_final_saved = False
            race = self._ensure_race()
            race.track_detected_frame = signal.frame_index
            race.track_save_frame = signal.frame_index + int(round(self.fps))
            race.state = "TRACK_SEEN"
            self._log_state(race, signal, "TRACK_SEEN", "track-name signal detected")
            self.event_bus.emit(
                "TRACK_SIGNAL_DETECTED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=signal.timestamp,
                frame_index=signal.frame_index,
                race_sequence=race.race_sequence,
                message="track-name signal detected; save scheduled at +1s",
                data=signal_to_dict(signal),
            )
        race = self._current_race
        if race and race.track_save_frame is not None and not race.track_saved and signal.frame_index >= race.track_save_frame:
            selected = self._select_buffered_frame(race, "track_name", race.track_save_frame, "live_forward_track_signal_plus_1s")
            if selected is not None:
                race.track_saved = True
                self._selected_frames.append(selected)
                self.event_bus.emit(
                    "TRACK_NAME_FRAME_RETAINED",
                    source_id=self.source_id,
                    stream_label=self.stream_label,
                    timestamp=selected.timestamp,
                    frame_index=selected.frame_index,
                    race_sequence=selected.race_sequence,
                    message="track-name frame retained; OCR queued",
                    data={"crop_path": str(selected.crop_path), "selection_reason": selected.selection_reason},
                )
                self._start_track_metadata_ocr(selected)
        if signal.race_number_present and signal.frame_index - self._last_race_emit_frame > int(self.fps * 60):
            self._last_race_emit_frame = signal.frame_index
            race = self._ensure_race()
            race.race_number_frame = signal.frame_index
            race.state = "RACE_NUMBER_SEEN"
            self._log_state(race, signal, "RACE_NUMBER_SEEN", "race-number signal detected")
            self.event_bus.emit(
                "RACE_NUMBER_DETECTED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=signal.timestamp,
                frame_index=signal.frame_index,
                race_sequence=race.race_sequence,
                message="race-number signal detected",
                data=signal_to_dict(signal),
            )
            selected = self._select_buffered_frame(
                race,
                "race_number",
                signal.frame_index,
                "live_forward_race_number_signal",
            )
            if selected is not None:
                race.race_number_saved = True
                self._selected_frames.append(selected)
        if signal.score_screen_visible:
            race = self._ensure_race()
            if race.first_score_frame is None:
                race.first_score_frame = signal.frame_index
                race.score_layout_id = signal.score_layout_id
                race.state = "SCOREBOARD_VISIBLE"
                self._log_state(race, signal, "SCOREBOARD_VISIBLE", "score screen visible")
                self.event_bus.emit(
                    "RACE_ANCHOR_DETECTED",
                    source_id=self.source_id,
                    stream_label=self.stream_label,
                    timestamp=signal.timestamp,
                    frame_index=signal.frame_index,
                    race_sequence=race.race_sequence,
                    message="score screen visible from normalized frame signal",
                    data=signal_to_dict(signal),
                )
            race.last_score_frame = signal.frame_index
            race.score_candidates.append(signal)
            if race.state == "SCOREBOARD_VISIBLE" and len(race.score_candidates) >= max(1, int(self.fps * 0.5)):
                race.state = "RACESCORE_CANDIDATE_HELD"
                self._log_state(race, signal, "RACESCORE_CANDIDATE_HELD", "holding RaceScore candidates")
                self.event_bus.emit(
                    "RACE_SCORE_CANDIDATE_HELD",
                    source_id=self.source_id,
                    stream_label=self.stream_label,
                    timestamp=signal.timestamp,
                    frame_index=signal.frame_index,
                    race_sequence=race.race_sequence,
                    message="RaceScore candidates retained in rolling buffer",
                    data={"candidate_count": len(race.score_candidates), "score_layout_id": race.score_layout_id},
                )
            # Fast "Latest Race" pass: once the RaceScore screen has been visible
            # ~1s a clean frame is already buffered, so OCR it and publish the
            # provisional result immediately — without waiting for the TotalScore
            # drop or the heavy consensus (which still run for the confirmed totals).
            if (
                not race.provisional_started
                and race.first_score_frame is not None
                and signal.frame_index - int(race.first_score_frame) >= int(round(1.0 * self.fps))
            ):
                self._start_early_provisional(race)
            self._last_score_visible = True
            return
        if self._last_score_visible and race is not None and race.first_score_frame is not None:
            if race.drop_start_frame is None:
                race.drop_start_frame = signal.frame_index
                race.state = "WAITING_FOR_TOTAL_DROP"
                self._log_state(race, signal, "WAITING_FOR_TOTAL_DROP", "score signal dropped")
                self.event_bus.emit(
                    "SCORE_SIGNAL_DROPPED",
                    source_id=self.source_id,
                    stream_label=self.stream_label,
                    timestamp=signal.timestamp,
                    frame_index=signal.frame_index,
                    race_sequence=race.race_sequence,
                    message="score signal dropped; waiting for sustained absence",
                )
        if (
            race is not None
            and race.first_score_frame is not None
            and race.drop_start_frame is not None
            and race.total_score_frame is None
        ):
            drop_frames = signal.frame_index - int(race.drop_start_frame) + 1
            if drop_frames >= max(1, int(round(0.5 * self.fps))) and race.total_score_frame is None:
                race.state = "TOTAL_DROP_CONFIRMED"
                race.race_score_frame = self._choose_race_score_frame(race)
                race.total_score_frame = max(0, int(race.drop_start_frame) - int(round(2.7 * self.fps)))
                self._log_state(race, signal, "TOTAL_DROP_CONFIRMED", "sustained score absence confirmed")
                self.event_bus.emit(
                    "TOTAL_DROP_CONFIRMED",
                    source_id=self.source_id,
                    stream_label=self.stream_label,
                    timestamp=signal.timestamp,
                    frame_index=signal.frame_index,
                    race_sequence=race.race_sequence,
                    message="TotalScore drop timing confirmed",
                    data={"race_score_frame": race.race_score_frame, "total_score_frame": race.total_score_frame},
                )
        self._last_score_visible = False
        if race is not None and race.total_score_frame is not None and not race.finalized:
            future_frames = signal.frame_index - int(race.total_score_frame)
            if future_frames >= max(1, int(round(1.0 * self.fps))):
                self._finalize_bundle(race, signal)

    def _track_cup_final(self, signal: LiveFrameSignal) -> None:
        """Keep one frame of the cup end screen with the last race's bundles: SETTLE_SECONDS after it appears (the
        standings list slides in after the red frame), or DROP_BACKOFF_SECONDS before it leaves when sooner."""
        if self._cup_final_saved:
            return
        if signal.cup_final_present:
            if self._cup_final_first_frame is None:
                self._cup_final_first_frame = signal.frame_index
            self._cup_final_last_frame = signal.frame_index
            target = self._cup_final_first_frame + int(round(CUP_FINAL_SETTLE_SECONDS * self.fps))
            if signal.frame_index < target:
                return
        elif self._cup_final_first_frame is not None and self._cup_final_last_frame is not None:
            backoff = int(round(CUP_FINAL_DROP_BACKOFF_SECONDS * self.fps))
            target = max(self._cup_final_first_frame, min(self._cup_final_last_frame, signal.frame_index - backoff))
            self._cup_final_first_frame = self._cup_final_last_frame = None
        else:
            return
        if self._current_race is not None and self._current_race.first_score_frame is not None:
            race = self._current_race
        elif self._completed_races:
            race = self._completed_races[-1]
        else:
            return
        selected = self._select_buffered_frame(race, "cup_final", target, "live_forward_cup_final_settled")
        if selected is None:
            return
        self._cup_final_saved = True
        self._log_state(race, signal, "CUP_FINAL_SAVED", "cup end screen retained")
        self.event_bus.emit(
            "CUP_FINAL_FRAME_RETAINED",
            source_id=self.source_id,
            stream_label=self.stream_label,
            timestamp=selected.timestamp,
            frame_index=selected.frame_index,
            race_sequence=selected.race_sequence,
            message="cup end screen retained",
            data={"crop_path": str(selected.crop_path), "selection_reason": selected.selection_reason},
        )

    def _ensure_race(self) -> LiveRaceBundleState:
        if self._current_race is None or self._current_race.finalized:
            self._current_race = LiveRaceBundleState(race_sequence=len(self._completed_races) + 1)
        return self._current_race

    def _start_early_provisional(self, race: LiveRaceBundleState) -> None:
        frame_index = self._choose_race_score_frame(race)
        selected = self._select_buffered_frame(
            race,
            "race_score",
            int(frame_index),
            "live_forward_early_race_score_provisional",
            write_baseline_bundle=False,
        )
        if selected is None:
            return
        race.provisional_started = True
        self._start_provisional_race_score_ocr(selected)

    def _choose_race_score_frame(self, race: LiveRaceBundleState) -> int:
        if not race.score_candidates:
            return int(race.first_score_frame or 0)
        target = int(race.first_score_frame or race.score_candidates[0].frame_index) + int(round(0.7 * self.fps))
        return min(race.score_candidates, key=lambda item: abs(item.frame_index - target)).frame_index

    def _finalize_bundle(self, race: LiveRaceBundleState, signal: LiveFrameSignal) -> None:
        race.state = "BUNDLE_FINALIZED"
        race.finalized = True
        self._log_state(race, signal, "BUNDLE_FINALIZED", "RaceScore/TotalScore bundle finalized from rolling buffer")
        for screen_type, frame_index, reason in [
            ("race_score", race.race_score_frame, "live_forward_score_visible_plus_0_7s_after_transition"),
            ("total_score", race.total_score_frame, "live_forward_drop_start_minus_2_7s"),
        ]:
            if frame_index is None:
                continue
            selected = self._select_buffered_frame(race, screen_type, int(frame_index), reason)
            if selected is not None:
                self._selected_frames.append(selected)
                event_type = "RACE_SCORE_SELECTED" if screen_type == "race_score" else "TOTAL_SCORE_SELECTED"
                self.event_bus.emit(
                    event_type,
                    source_id=self.source_id,
                    stream_label=self.stream_label,
                    timestamp=selected.timestamp,
                    frame_index=selected.frame_index,
                    race_sequence=selected.race_sequence,
                    message=f"{screen_type} selected from rolling buffer",
                    data={"crop_path": str(selected.crop_path), "selection_reason": selected.selection_reason},
                )
                # Skip if the fast early pass already published the provisional.
                if event_type == "RACE_SCORE_SELECTED" and not race.provisional_started:
                    self._start_provisional_race_score_ocr(selected)
        self._completed_races.append(race)
        self._current_race = None

    def _select_buffered_frame(
        self,
        race: LiveRaceBundleState,
        screen_type: str,
        frame_index: int,
        reason: str,
        *,
        write_baseline_bundle: bool = True,
    ) -> ExactSelectionFrame | None:
        entries = list(self.buffer.entries)
        if not entries:
            return None
        entry = min(entries, key=lambda item: abs(item.frame_index - int(frame_index)))
        frame = decode_compressed_frame(entry.compressed_full_resolution_bytes)
        if frame is None:
            frame = entry.analysis_frame
        if write_baseline_bundle:
            crop_path = self._write_bundle_anchor(
                frame=frame,
                screen_type=screen_type,
                frame_index=entry.frame_index,
                race_sequence=race.race_sequence,
                timestamp=entry.timestamp_seconds,
                layout_id=race.score_layout_id or "track_name",
                frame_hash=entry.frame_hash,
                source_rule=reason,
            )
        else:
            crop_path = write_buffer_frame(
                frame=frame,
                stream_label=self.stream_label,
                race_sequence=race.race_sequence,
                screen_type=screen_type,
                frame_index=entry.frame_index,
            )
        self.buffer.preserve_frame(entry.frame_index, frame)
        if write_baseline_bundle:
            self._write_bundle_neighbors(race, screen_type, entry.frame_index, race.score_layout_id or "track_name")
        return ExactSelectionFrame(
            stream_id=self.stream_label,
            group_label=self.stream_label,
            race_sequence=race.race_sequence,
            video_path=self.video_path,
            screen_type=screen_type,
            frame_index=entry.frame_index,
            timestamp=entry.timestamp_seconds,
            layout_id=race.score_layout_id or "track_name",
            crop_path=crop_path,
            frame_hash=entry.frame_hash,
            selection_reason=reason,
            source_candidate_frame=frame_index,
            confidence=1.0,
        )

    def _write_bundle_anchor(
        self,
        *,
        frame: Any,
        screen_type: str,
        frame_index: int,
        race_sequence: int,
        timestamp: float | None,
        layout_id: str,
        frame_hash: str,
        source_rule: str,
    ) -> Path:
        frame_content = bundle_folder(screen_type)
        return self.bundle_writer.write_anchor(
            frame=frame,
            video_label=self.video_label,
            stream_id=self.stream_label,
            race_number=race_sequence,
            frame_content=frame_content,
            frame_index=frame_index,
            timestamp=timestamp,
            layout_id=layout_id if frame_content in {"2RaceScore", "3TotalScore"} else None,
            frame_hash=frame_hash,
            source_rule=source_rule,
        )

    def _write_bundle_neighbors(
        self,
        race: LiveRaceBundleState,
        screen_type: str,
        anchor_frame_index: int,
        layout_id: str,
    ) -> None:
        if screen_type not in {"race_score", "total_score"}:
            return
        radius = max(1, int(round(0.5 * self.fps)))
        nearby = [
            entry
            for entry in self.buffer.entries
            if abs(int(entry.frame_index) - int(anchor_frame_index)) <= radius
        ]
        for entry in sorted(nearby, key=lambda item: item.frame_index):
            frame = decode_compressed_frame(entry.compressed_full_resolution_bytes)
            if frame is None:
                frame = entry.analysis_frame
            if screen_type == "race_score":
                self.bundle_writer.write_race_context(
                    frame=frame,
                    video_label=self.video_label,
                    stream_id=self.stream_label,
                    race_number=race.race_sequence,
                    frame_index=entry.frame_index,
                    timestamp=entry.timestamp_seconds,
                    layout_id=layout_id,
                    frame_hash=entry.frame_hash,
                    source_rule="live_forward_race_score_context_from_rolling_buffer",
                )
            else:
                self.bundle_writer.write_total_consensus(
                    frame=frame,
                    video_label=self.video_label,
                    stream_id=self.stream_label,
                    race_number=race.race_sequence,
                    frame_index=entry.frame_index,
                    timestamp=entry.timestamp_seconds,
                    layout_id=layout_id,
                    frame_hash=entry.frame_hash,
                    source_rule="live_forward_total_score_consensus_from_rolling_buffer",
                )

    def _start_track_metadata_ocr(self, selected: ExactSelectionFrame) -> None:
        self.event_bus.emit(
            "TRACK_NAME_OCR_STARTED",
            source_id=self.source_id,
            stream_label=self.stream_label,
            timestamp=selected.timestamp,
            frame_index=selected.frame_index,
            race_sequence=selected.race_sequence,
            message="track-name OCR running",
            data={"crop_path": str(selected.crop_path)},
        )
        thread = threading.Thread(target=self._run_track_metadata_ocr, args=(selected,), name=f"track-ocr-{self.source_id}-{selected.race_sequence}", daemon=True)
        self._track_ocr_threads.append(thread)
        thread.start()

    def _start_provisional_race_score_ocr(self, selected: ExactSelectionFrame) -> None:
        self.event_bus.emit(
            "PROVISIONAL_RACE_RESULT_OCR_STARTED",
            source_id=self.source_id,
            stream_label=self.stream_label,
            timestamp=selected.timestamp,
            frame_index=selected.frame_index,
            race_sequence=selected.race_sequence,
            message="RaceScore OCR running for provisional race outcome",
            data={"crop_path": str(selected.crop_path), "selection_reason": selected.selection_reason},
        )
        thread = threading.Thread(
            target=self._run_provisional_race_score_ocr,
            args=(selected,),
            name=f"race-score-ocr-{self.source_id}-{selected.race_sequence}",
            daemon=True,
        )
        self._race_score_ocr_threads.append(thread)
        thread.start()

    def _run_provisional_race_score_ocr(self, selected: ExactSelectionFrame) -> None:
        try:
            if self._row_ocr_extractor is None:
                self._row_ocr_extractor = BaselineRowOcrExtractor()
            attempt = self._row_ocr_extractor.extract(
                stream_id=selected.stream_id,
                race_sequence=selected.race_sequence,
                screen_type="race_score",
                frame_index=selected.frame_index,
                timestamp=selected.timestamp,
                crop_path=selected.crop_path,
            )
            visible_player_count = official_visible_row_count_from_attempt(attempt)
            rows: list[dict[str, Any]] = []
            for row in attempt.rows[:visible_player_count]:
                report = row.to_report()
                try:
                    position = int(report.get("position") or row.row_index)
                except (TypeError, ValueError):
                    position = row.row_index
                race_points = get_race_points(position, visible_player_count)
                if race_points is not None:
                    report["race_points"] = str(race_points)
                    report["race_points_source"] = race_points_source_for_player_count(visible_player_count)
                    report["player_count_for_scoring"] = str(visible_player_count)
                rows.append(report)
            self.event_bus.emit(
                "PROVISIONAL_RACE_RESULT_UPDATED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=selected.timestamp,
                frame_index=selected.frame_index,
                race_sequence=selected.race_sequence,
                message=f"provisional RaceScore result extracted: {len(rows)} visible rows",
                data={
                    "rows": rows,
                    "summary": attempt.summary,
                    "visible_player_count": visible_player_count,
                    "crop_path": str(selected.crop_path),
                    "source_status": "provisional_race_score_only",
                },
            )
        except Exception as exc:
            self.event_bus.emit(
                "PROVISIONAL_RACE_RESULT_FAILED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=selected.timestamp,
                frame_index=selected.frame_index,
                race_sequence=selected.race_sequence,
                message=f"provisional RaceScore OCR failed: {exc}",
                data={"crop_path": str(selected.crop_path), "error": str(exc)},
            )

    def _run_track_metadata_ocr(self, selected: ExactSelectionFrame) -> None:
        try:
            metadata = extract_track_metadata(
                {
                    "stream_id": selected.stream_id,
                    "race_sequence": selected.race_sequence,
                    "frame_index": selected.frame_index,
                    "timestamp": selected.timestamp,
                    "crop_path": str(selected.crop_path),
                    "ocr_ready_crop_path": str(selected.crop_path),
                    "confidence": selected.confidence,
                    "screen_type": "track_name",
                }
            )
            self._track_metadata[(metadata.stream_id, metadata.race_sequence)] = metadata
            label = metadata.track_name or metadata.raw_track_text or "track name OCR did not match catalog"
            if metadata.track_name and metadata.cup_name:
                label = f"{metadata.track_name} ({metadata.cup_name})"
            self.event_bus.emit(
                "TRACK_NAME_DETECTED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=selected.timestamp,
                frame_index=selected.frame_index,
                race_sequence=selected.race_sequence,
                message=label,
                data=asdict(metadata),
            )
        except Exception as exc:
            self.event_bus.emit(
                "TRACK_NAME_OCR_FAILED",
                source_id=self.source_id,
                stream_label=self.stream_label,
                timestamp=selected.timestamp,
                frame_index=selected.frame_index,
                race_sequence=selected.race_sequence,
                message=f"track-name OCR failed: {exc}",
                data={"crop_path": str(selected.crop_path), "error": str(exc)},
            )

    @property
    def has_complete_pair(self) -> bool:
        return bool(self.complete_pair_keys)

    @property
    def complete_pair_keys(self) -> set[tuple[str, int]]:
        complete: set[tuple[str, int]] = set()
        race_sequences = {frame.race_sequence for frame in self._selected_frames}
        for race_sequence in race_sequences:
            screen_types = {frame.screen_type for frame in self._selected_frames if frame.race_sequence == race_sequence}
            if {"race_score", "total_score"} <= screen_types:
                complete.add((self.stream_label, int(race_sequence)))
        return complete

    def to_selection(self) -> ExactVideoSelection:
        return ExactVideoSelection(
            stream_id=self.stream_label,
            group_label=self.stream_label,
            video_path=self.video_path,
            context=safe_context(self.context),
            score_detections=[
                {
                    "race_number": race.race_sequence,
                    "frame_number": race.first_score_frame,
                    "score_layout_id": race.score_layout_id,
                    "confidence": 1.0,
                }
                for race in self._completed_races
            ],
            track_detections=[],
            selection_results=[
                {
                    "race_number": race.race_sequence,
                    "race_score_frame": race.race_score_frame,
                    "total_score_frame": race.total_score_frame,
                    "score_layout_id": race.score_layout_id,
                    "selection_method": "forward_only_normalized_signal_state_machine",
                }
                for race in self._completed_races
            ],
            selected_frames=list(self._selected_frames),
        )

    def write_reports(self) -> None:
        write_frame_buffer_report([self.buffer])
        self.bundle_writer.write_manifest()
        write_json(f"live_frame_signal_report_{self.source_id}.json", {"stream_id": self.stream_label, "signals": self._signals[-5000:]})
        write_json(f"live_race_state_machine_report_{self.source_id}.json", {"stream_id": self.stream_label, "state_transitions": self._state_log})
        if self._track_metadata:
            write_json(
                f"live_track_name_ocr_report_{self.source_id}.json",
                {"stream_id": self.stream_label, "track_metadata": [asdict(item) for item in self._track_metadata.values()]},
            )

    def _log_state(self, race: LiveRaceBundleState, signal: LiveFrameSignal, state: str, message: str) -> None:
        self._state_log.append(
            {
                "stream_id": self.stream_label,
                "race_sequence": race.race_sequence,
                "state": state,
                "frame_index": signal.frame_index,
                "timestamp": signal.timestamp,
                "message": message,
            }
        )


class LiveSignalAnalysisManager:
    def __init__(
        self,
        sources: list[Any],
        *,
        event_bus: GuiEventBus,
        prepared_contexts: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        self.analyzers: dict[str, LiveSignalSourceAnalyzer] = {}
        for source in sources:
            context = (prepared_contexts or {}).get(source.source_id)
            fps = float((context or {}).get("fps") or source.fps or 30.0)
            self.analyzers[source.source_id] = LiveSignalSourceAnalyzer(
                source_id=source.source_id,
                stream_label=source.stream_label,
                video_path=source.video_path,
                fps=fps,
                event_bus=event_bus,
                context=context,
            )

    def start(self) -> None:
        for analyzer in self.analyzers.values():
            analyzer.start()

    def stop(self) -> None:
        for analyzer in self.analyzers.values():
            analyzer.stop()
        write_frame_buffer_report([analyzer.buffer for analyzer in self.analyzers.values()])
        self.write_selection_reports()

    def drain(self, timeout: float = 60.0) -> bool:
        deadline = time.time() + timeout
        drained = True
        for analyzer in self.analyzers.values():
            remaining = max(0.0, deadline - time.time())
            drained = analyzer.drain(remaining) and drained
        return drained

    def submit(self, decoded: DecodedFrame) -> None:
        analyzer = self.analyzers.get(decoded.source_id)
        if analyzer is not None:
            analyzer.submit(decoded)

    def source_sink(self, source_id: str):
        def sink(*, source_id: str, stream_label: str, video_path: Path, frame_index: int, timestamp: float, frame: Any) -> None:
            self.submit(
                DecodedFrame(
                    source_id=source_id,
                    stream_label=stream_label,
                    video_path=video_path,
                    frame_index=frame_index,
                    timestamp=timestamp,
                    frame=frame.copy(),
                )
            )

        return sink

    @property
    def has_complete_pair(self) -> bool:
        return bool(self.complete_pair_keys)

    @property
    def complete_pair_keys(self) -> set[tuple[str, int]]:
        complete: set[tuple[str, int]] = set()
        for analyzer in self.analyzers.values():
            complete.update(analyzer.complete_pair_keys)
        return complete

    def write_selection_reports(self) -> None:
        selections = [analyzer.to_selection() for analyzer in self.analyzers.values()]
        if selections:
            write_exact_selection_reports(selections)
        write_json(
            "live_frame_signal_report.json",
            {
                "streams": [
                    {
                        "source_id": analyzer.source_id,
                        "stream_id": analyzer.stream_label,
                        "signals": analyzer._signals[-5000:],
                    }
                    for analyzer in self.analyzers.values()
                ]
            },
        )
        write_json(
            "live_race_state_machine_report.json",
            {
                "streams": [
                    {
                        "source_id": analyzer.source_id,
                        "stream_id": analyzer.stream_label,
                        "state_transitions": analyzer._state_log,
                    }
                    for analyzer in self.analyzers.values()
                ]
            },
        )
        track_metadata = [
            asdict(item)
            for analyzer in self.analyzers.values()
            for item in analyzer._track_metadata.values()
        ]
        if track_metadata:
            write_json("live_track_name_ocr_report.json", {"track_metadata": track_metadata})


def normalize_live_frame(frame: Any) -> Any:
    if frame.shape[1] == TARGET_WIDTH and frame.shape[0] == TARGET_HEIGHT:
        return frame.copy()
    return to_working_canvas(frame)


def _template_score(gray: Any, roi: tuple[int, int, int, int], template: Any, process_type: int, *, expand: bool = True) -> float:
    x, y, w, h = expanded_roi(gray, roi) if expand else bounded_roi(gray, roi)
    crop = gray[y : y + h, x : x + w]
    processed = preprocess_initial_scan_roi(crop, process_type)
    return match_template(processed, template.gray, template.alpha_mask)


def write_buffer_frame(*, frame: Any, stream_label: str, race_sequence: int, screen_type: str, frame_index: int) -> Path:
    root = DIAGNOSTICS_ROOT / "live_signal_bundles" / stream_label / f"race_{race_sequence:02d}" / bundle_folder(screen_type)
    root.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(root / f"anchor_{frame_index:06d}.png")
    cv2.imwrite(str(path), frame)
    return path


def bundle_folder(screen_type: str) -> str:
    return {
        "track_name": "0TrackName",
        "race_number": "1RaceNumber",
        "race_score": "2RaceScore",
        "total_score": "3TotalScore",
        "cup_final": CUP_FINAL_CONTENT,
    }.get(screen_type, screen_type)


def signal_to_dict(signal: LiveFrameSignal) -> dict[str, Any]:
    return {
        "stream_label": signal.stream_label,
        "frame_index": signal.frame_index,
        "timestamp": signal.timestamp,
        "ignore_overlay_present": signal.ignore_overlay_present,
        "track_name_present": signal.track_name_present,
        "race_number_present": signal.race_number_present,
        "score_screen_visible": signal.score_screen_visible,
        "score_layout_id": signal.score_layout_id,
        "visible_player_count": signal.visible_player_count,
        "cup_final_present": signal.cup_final_present,
        "confidence": signal.confidence,
        "features": signal.features,
    }


def write_json(name: str, payload: Any) -> Path:
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(DIAGNOSTICS_ROOT / name)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path
