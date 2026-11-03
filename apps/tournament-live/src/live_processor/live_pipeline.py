from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from .baseline_anchor_detector import BaselineAnchorDetector
from .baseline_score_detector import BaselineScoreScreenDetector
from .config import LiveConfig
from .detection import DetectionEvent, DetectionStateMachine
from .frame_buffer import FrameBufferEntry, RollingFrameBuffer, decode_compressed_frame
from .ocr import FrameOcrAdapter, OcrResult
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .performance import PerformanceTracker
from .run_context import attach_run_id, current_run_id
from .session import LiveSession


class StreamExtractionState(str, Enum):
    WAITING_FOR_RACE_SCREEN = "WAITING_FOR_RACE_SCREEN"
    RACE_SCREEN_DETECTED = "RACE_SCREEN_DETECTED"
    WAITING_FOR_RESULT_SEARCH_WINDOW = "WAITING_FOR_RESULT_SEARCH_WINDOW"
    SEARCHING_RACE_SCORE_FRAME = "SEARCHING_RACE_SCORE_FRAME"
    SEARCHING_TOTAL_SCORE_FRAME = "SEARCHING_TOTAL_SCORE_FRAME"
    OCR_PENDING = "OCR_PENDING"
    OCR_RUNNING = "OCR_RUNNING"
    OCR_DONE = "OCR_DONE"
    SCOREBOARD_UPDATED = "SCOREBOARD_UPDATED"
    WAITING_FOR_NEXT_RACE = "WAITING_FOR_NEXT_RACE"
    STREAM_ENDED = "STREAM_ENDED"
    STREAM_FAILED = "STREAM_FAILED"


@dataclass
class RaceSequenceState:
    race_sequence: int
    race_detected_timestamp: float | None = None
    race_detected_frame_index: int | None = None
    scheduled_search_start_timestamp: float | None = None
    actual_search_start_timestamp: float | None = None
    timeout_timestamp: float | None = None
    buffer_lookup_start_timestamp: float | None = None
    buffer_lookup_end_timestamp: float | None = None
    buffered_frames_searched: int = 0
    selected_race_score: DetectionEvent | None = None
    selected_total_score: DetectionEvent | None = None
    ocr_start_timestamp: float | None = None
    ocr_end_timestamp: float | None = None
    scoreboard_update_timestamp: float | None = None
    final_status: str = "PARTIAL"
    transition_log: list[dict[str, object]] = field(default_factory=list)


class LiveStreamProcessor:
    def __init__(
        self,
        *,
        stream_id: str,
        video_path: Path,
        session: LiveSession,
        tracker: PerformanceTracker,
        config: LiveConfig,
        enable_ocr: bool = True,
    ) -> None:
        self.stream_id = stream_id
        self.video_path = video_path
        self.session = session
        self.tracker = tracker
        self.config = config
        self.run_id = current_run_id()
        self.enable_ocr = enable_ocr
        self.state = StreamExtractionState.WAITING_FOR_RACE_SCREEN
        self.buffer = RollingFrameBuffer(stream_id, config)
        self.ocr = FrameOcrAdapter(tracker)
        self.total_detector = DetectionStateMachine(tracker)
        self.anchor_detector = BaselineAnchorDetector()
        self.score_detector = BaselineScoreScreenDetector()
        self.races: list[RaceSequenceState] = []
        self.current_race: RaceSequenceState | None = None
        self.race_detection_events: list[dict[str, object]] = []
        self.result_windows: list[dict[str, object]] = []
        self.result_candidates: list[dict[str, object]] = []
        self.selected_frames: list[dict[str, object]] = []
        self.ocr_reports: list[dict[str, object]] = []
        self.scoreboard_updates: list[dict[str, object]] = []
        self._candidate_cache: dict[tuple[int, str, int], DetectionEvent | None] = {}

    def process_frame(self, frame_index: int, timestamp_seconds: float, frame: Any) -> None:
        entry = self.buffer.add_frame(self.video_path, frame_index, timestamp_seconds, frame)
        if entry is None:
            return
        if self.state in {
            StreamExtractionState.WAITING_FOR_RACE_SCREEN,
            StreamExtractionState.WAITING_FOR_NEXT_RACE,
            StreamExtractionState.SCOREBOARD_UPDATED,
        }:
            self._maybe_detect_race_screen(entry, frame)
        if self.current_race and self.state == StreamExtractionState.WAITING_FOR_RESULT_SEARCH_WINDOW:
            self._maybe_start_result_search(timestamp_seconds)
        if self.current_race and self.state in {
            StreamExtractionState.SEARCHING_RACE_SCORE_FRAME,
            StreamExtractionState.SEARCHING_TOTAL_SCORE_FRAME,
        }:
            self._search_result_frames(timestamp_seconds)

    def end_stream(self) -> None:
        if self.current_race and self.current_race.final_status == "PARTIAL":
            if self.current_race.selected_total_score is None:
                self.current_race.final_status = "TOTAL_SCORE_NOT_FOUND"
            elif self.current_race.ocr_end_timestamp is None:
                self.current_race.final_status = "OCR_FAILED"
        self._transition(StreamExtractionState.STREAM_ENDED, None)

    def _maybe_detect_race_screen(self, entry: FrameBufferEntry, frame: Any) -> None:
        if self.races:
            last_timestamp = self.races[-1].race_detected_timestamp
            if last_timestamp is not None and entry.timestamp_seconds < last_timestamp + self.config.min_race_gap_seconds:
                return
        detection_frame = entry.full_resolution_frame
        if detection_frame is None:
            detection_frame = decode_compressed_frame(entry.compressed_full_resolution_bytes)
        if detection_frame is None:
            detection_frame = frame
        match = self.anchor_detector.detect_race_anchor(
            frame=detection_frame,
            stream_id=self.stream_id,
            frame_index=entry.frame_index,
            write_debug=False,
        )
        if not match.matched:
            return
        confidence = match.confidence
        race_sequence = len(self.races) + 1
        crop_path = match.debug_frame_path or write_full_frame_debug("race_screen", self.stream_id, entry.frame_index, detection_frame)
        race = RaceSequenceState(
            race_sequence=race_sequence,
            race_detected_timestamp=entry.timestamp_seconds,
            race_detected_frame_index=entry.frame_index,
            scheduled_search_start_timestamp=entry.timestamp_seconds + self.config.result_search_delay_seconds,
            timeout_timestamp=entry.timestamp_seconds
            + self.config.result_search_delay_seconds
            + self.config.result_search_late_timeout_seconds,
        )
        self.current_race = race
        self.races.append(race)
        self.race_detection_events.append(
            {
                "run_id": self.run_id,
                "stream_id": self.stream_id,
                "video_path": str(self.video_path),
                "frame_index": entry.frame_index,
                "timestamp": entry.timestamp_seconds,
                "confidence": confidence,
                "detection_reason_features": match.features,
                "debug_frame_path": str(crop_path),
                "crop_path": str(match.crop_path or ""),
                "baseline_template_name": match.template_name,
                "baseline_roi": list(match.roi),
                "race_sequence": race_sequence,
            }
        )
        self._transition(StreamExtractionState.RACE_SCREEN_DETECTED, race)
        self._transition(StreamExtractionState.WAITING_FOR_RESULT_SEARCH_WINDOW, race)

    def _maybe_start_result_search(self, current_timestamp: float) -> None:
        race = self.current_race
        if race is None or race.scheduled_search_start_timestamp is None:
            return
        if current_timestamp < race.scheduled_search_start_timestamp:
            return
        race.actual_search_start_timestamp = current_timestamp
        race.buffer_lookup_start_timestamp = max(
            0.0, race.scheduled_search_start_timestamp - self.config.result_search_lookback_seconds
        )
        race.buffer_lookup_end_timestamp = current_timestamp
        self.result_windows.append(
            {
                "stream_id": self.stream_id,
                "race_detection_timestamp": race.race_detected_timestamp,
                "scheduled_search_start_timestamp": race.scheduled_search_start_timestamp,
                "actual_search_start_timestamp": race.actual_search_start_timestamp,
                "timeout_timestamp": race.timeout_timestamp,
                "race_sequence": race.race_sequence,
                "state_transition_log": race.transition_log,
            }
        )
        self._transition(StreamExtractionState.SEARCHING_RACE_SCORE_FRAME, race)

    def _search_result_frames(self, current_timestamp: float) -> None:
        race = self.current_race
        if race is None or race.buffer_lookup_start_timestamp is None:
            return
        if race.timeout_timestamp is not None and current_timestamp > race.timeout_timestamp:
            race.final_status = "RESULT_SEARCH_TIMEOUT"
            self._transition(StreamExtractionState.WAITING_FOR_NEXT_RACE, race)
            return
        frames = self.buffer.query_range(race.buffer_lookup_start_timestamp, current_timestamp)
        race.buffered_frames_searched += len(frames)
        race.buffer_lookup_end_timestamp = current_timestamp
        if race.selected_race_score is None:
            candidate = self._best_candidate_from_entries(frames, "race_score")
            if candidate is not None:
                race.selected_race_score = candidate
                self.buffer.preserve_frame(candidate.frame_index)
                self._record_selected_frame(race, candidate, "highest confidence baseline score-template candidate in active search window")
                self._transition(StreamExtractionState.SEARCHING_TOTAL_SCORE_FRAME, race)
                return
        if race.selected_total_score is None and race.selected_race_score is not None:
            total_frames = [entry for entry in frames if entry.timestamp_seconds >= race.selected_race_score.timestamp + 1.0]
            candidate = self._best_candidate_from_entries(total_frames, "total_score")
            if candidate is not None:
                race.selected_total_score = candidate
                self.buffer.preserve_frame(candidate.frame_index)
                self._record_selected_frame(race, candidate, "highest confidence baseline score-template candidate after RaceScore")
                self._transition(StreamExtractionState.OCR_PENDING, race)
                self._run_ocr_immediately(race, candidate)
                return

    def _best_candidate_from_entries(self, entries: list[FrameBufferEntry], candidate_type: str) -> DetectionEvent | None:
        best: DetectionEvent | None = None
        for entry in entries:
            candidate = self._candidate_from_entry(entry, candidate_type)
            if candidate is not None and (best is None or candidate.confidence > best.confidence):
                best = candidate
        return best

    def _candidate_from_entry(self, entry: FrameBufferEntry, candidate_type: str) -> DetectionEvent | None:
        race_sequence = self.current_race.race_sequence if self.current_race else 0
        cache_key = (race_sequence, candidate_type, entry.frame_index)
        if cache_key in self._candidate_cache:
            return self._candidate_cache[cache_key]
        detection_frame = entry.full_resolution_frame
        if detection_frame is None:
            detection_frame = decode_compressed_frame(entry.compressed_full_resolution_bytes)
        if detection_frame is None:
            detection_frame = entry.analysis_frame
        match = self.score_detector.detect_score_screen(
            frame=detection_frame,
            stream_id=self.stream_id,
            frame_index=entry.frame_index,
            candidate_type=candidate_type,
            write_debug=False,
        )
        features = dict(match.features)
        features["crop_paths"] = match.crop_paths
        features["frame_hash"] = entry.frame_hash
        confidence = match.confidence
        accepted = match.is_score_screen
        rejection_reason = "" if accepted else match.reason
        crop_path = match.crop_path
        self.result_candidates.append(
            {
                "stream_id": self.stream_id,
                "video_path": str(self.video_path),
                "race_sequence": race_sequence or None,
                "frame_index": entry.frame_index,
                "timestamp": entry.timestamp_seconds,
                "frame_hash": entry.frame_hash,
                "candidate_type": candidate_type if accepted else "unknown_result_screen",
                "confidence": confidence,
                "visual_features_used": features,
                "detection_method": "baseline_roi_template_matching",
                "layout_id": match.layout_id,
                "accepted_position_rows": match.accepted_rows,
                "average_accepted_position_score": match.average_accepted_score,
                "accepted": accepted,
                "rejection_reason": rejection_reason,
                "crop_paths": [str(crop_path)] if crop_path else [],
                "all_crop_paths": match.crop_paths,
                "full_frame_debug_image_path": str(match.full_frame_debug_path or ""),
            }
        )
        if not accepted:
            self._candidate_cache[cache_key] = None
            return None
        self.session.detection_candidate_count += 1
        entry.full_resolution_frame = detection_frame.copy()
        event = DetectionEvent(
            stream_id=self.stream_id,
            video_path=str(self.video_path),
            frame_index=entry.frame_index,
            timestamp=entry.timestamp_seconds,
            screen_type=candidate_type,
            confidence=confidence,
            complete=True,
            event_id=f"{self.stream_id}:{race_sequence}:{candidate_type}",
            reason=match.reason,
            features=features,
            crop_path=crop_path,
        )
        self._candidate_cache[cache_key] = event
        return event

    def _run_ocr_immediately(self, race: RaceSequenceState, candidate: DetectionEvent) -> None:
        if candidate.crop_path is None:
            return
        race.ocr_start_timestamp = candidate.timestamp
        self._transition(StreamExtractionState.OCR_RUNNING, race)
        if not self.enable_ocr:
            result = OcrResult(
                stream_id=self.stream_id,
                screen_type=candidate.screen_type,
                frame_index=candidate.frame_index,
                timestamp=candidate.timestamp,
                crop_path=candidate.crop_path,
                raw_text=[],
                parsed_rows=[],
                confidence=0.0,
                parsing_status="disabled",
                validation_status=False,
                error_message="OCR disabled for this run",
            )
        else:
            result = self.ocr.read_score_screen(
                stream_id=self.stream_id,
                screen_type=candidate.screen_type,
                frame_index=candidate.frame_index,
                timestamp=candidate.timestamp,
                crop_path=candidate.crop_path,
                race_sequence=race.race_sequence,
            )
        race.ocr_end_timestamp = candidate.timestamp
        self._record_ocr_result(race, result)
        if result.validation_status:
            previous_hash = hash_rows(self.session.scoreboard.final_rows)
            updated = self.session.scoreboard.apply_live_ocr_result(candidate, result, self.tracker)
            if updated:
                race.scoreboard_update_timestamp = time.time()
                race.final_status = "COMPLETE_SCOREBOARD_UPDATED"
                self._record_scoreboard_update(race, candidate, result, previous_hash)
                self._transition(StreamExtractionState.SCOREBOARD_UPDATED, race)
                self._transition(StreamExtractionState.WAITING_FOR_NEXT_RACE, race)
                return
        self.session.ocr_failure_count += 0 if result.validation_status else 1
        self.session.ocr_success_count += 1 if result.validation_status else 0
        race.final_status = "OCR_FAILED"
        self._transition(StreamExtractionState.OCR_DONE, race)
        self._transition(StreamExtractionState.WAITING_FOR_NEXT_RACE, race)

    def _record_ocr_result(self, race: RaceSequenceState, result: OcrResult) -> None:
        self.ocr_reports.append(
            {
                "stream_id": result.stream_id,
                "race_sequence": race.race_sequence,
                "source_frame_index": result.frame_index,
                "source_timestamp": result.timestamp,
                "rows": [
                    {
                        "stream_id": result.stream_id,
                        "race_sequence": race.race_sequence,
                        "source_frame_index": result.frame_index,
                        "source_timestamp": result.timestamp,
                        "position": row.get("Position", ""),
                        "character_icon": row.get("Character", ""),
                        "player_name": row.get("Player", ""),
                        "race_points": row.get("RacePoints", ""),
                        "previous_total_points": row.get("PreviousTotal", ""),
                        "new_total_race_points": row.get("Total", ""),
                        "raw_ocr_text": " | ".join(result.raw_text),
                        "confidence": result.confidence,
                        "validation_status": result.validation_status,
                        "validation_errors": result.error_message or "",
                    }
                    for row in result.parsed_rows
                ],
                "raw_ocr_text": result.raw_text,
                "confidence": result.confidence,
                "parsing_status": result.parsing_status,
                "validation_status": result.validation_status,
                "error_message": result.error_message,
            }
        )

    def _record_scoreboard_update(
        self,
        race: RaceSequenceState,
        candidate: DetectionEvent,
        result: OcrResult,
        previous_hash: str,
    ) -> None:
        new_hash = hash_rows(self.session.scoreboard.final_rows)
        self.scoreboard_updates.append(
            {
                "stream_id": self.stream_id,
                "race_sequence": race.race_sequence,
                "ocr_source_frame_index": candidate.frame_index,
                "ocr_source_timestamp": candidate.timestamp,
                "update_timestamp": race.scoreboard_update_timestamp,
                "rows_updated": result.parsed_rows,
                "validation_status": result.validation_status,
                "previous_scoreboard_state_hash": previous_hash,
                "new_scoreboard_state_hash": new_hash,
            }
        )

    def _record_selected_frame(self, race: RaceSequenceState, candidate: DetectionEvent, reason: str) -> None:
        self.selected_frames.append(
            {
                "stream_id": self.stream_id,
                "race_sequence": race.race_sequence,
                "video_path": candidate.video_path,
                "screen_type": candidate.screen_type,
                "selected_race_score_frame": candidate.frame_index if candidate.screen_type == "race_score" else None,
                "selected_total_score_frame": candidate.frame_index if candidate.screen_type == "total_score" else None,
                "timestamp": candidate.timestamp,
                "frame_index": candidate.frame_index,
                "confidence": candidate.confidence,
                "frame_hash": candidate.features.get("frame_hash", ""),
                "selection_reason": reason,
                "crop_path": str(candidate.crop_path or ""),
                "ocr_ready_crop_path": str(candidate.crop_path or ""),
                "crop_paths": candidate.features.get("crop_paths", {}),
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )

    def _transition(self, new_state: StreamExtractionState, race: RaceSequenceState | None) -> None:
        self.state = new_state
        if race is not None:
            race.transition_log.append({"state": new_state.value, "at": time.time()})

    def write_reports(self) -> None:
        write_json_report("race_screen_detection_report.json", self.race_detection_events)
        write_json_report("result_search_window_report.json", self.result_windows)
        write_json_report("result_frame_search_report.json", self.result_candidates)
        write_json_report("selected_result_frames.json", self.selected_frames)
        write_json_report("ocr_result_frame_report.json", self.ocr_reports)
        write_json_report("scoreboard_update_report.json", self.scoreboard_updates)
        write_json_report("live_event_timeline_report.json", [timeline_for_race(self.stream_id, race) for race in self.races])
        write_timeline_markdown([timeline_for_race(self.stream_id, race) for race in self.races])

    def report_payloads(self) -> dict[str, list[dict[str, object]]]:
        timelines = [timeline_for_race(self.stream_id, race) for race in self.races]
        return {
            "race_screen_detection_report.json": self.race_detection_events,
            "result_search_window_report.json": self.result_windows,
            "result_frame_search_report.json": self.result_candidates,
            "selected_result_frames.json": self.selected_frames,
            "ocr_result_frame_report.json": self.ocr_reports,
            "scoreboard_update_report.json": self.scoreboard_updates,
            "live_event_timeline_report.json": timelines,
        }


def write_full_frame_debug(kind: str, stream_id: str, frame_index: int, frame: Any) -> Path:
    import cv2  # type: ignore

    root = DIAGNOSTICS_ROOT / kind
    root.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(root / f"{stream_id}_{frame_index}.jpg")
    cv2.imwrite(str(path), frame)
    return path


def write_json_report(name: str, payload: object) -> Path:
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(DIAGNOSTICS_ROOT / name)
    path.write_text(json.dumps(attach_run_id(payload), indent=2, sort_keys=True), encoding="utf-8")
    return path


def write_timeline_markdown(items: list[dict[str, object]]) -> Path:
    path = assert_write_allowed(DIAGNOSTICS_ROOT / "live_event_timeline_report.md")
    run_id = current_run_id()
    lines = ["# Live Event Timeline Report", ""]
    if run_id:
        lines += [f"- Run ID: {run_id}", ""]
    for item in items:
        lines += [
            f"## {item['stream_id']} Race {item['race_sequence']}",
            "",
            f"- Race screen detected: {item.get('race_screen_detection_timestamp')}",
            f"- Result search scheduled: {item.get('result_search_scheduled_timestamp')}",
            f"- Result search actual start: {item.get('result_search_actual_start_timestamp')}",
            f"- Race-score frame: {item.get('race_score_frame_timestamp')}",
            f"- Total-score frame: {item.get('total_score_frame_timestamp')}",
            f"- OCR start: {item.get('ocr_start_timestamp')}",
            f"- OCR end: {item.get('ocr_end_timestamp')}",
            f"- Scoreboard update: {item.get('scoreboard_update_timestamp')}",
            f"- Final status: {item.get('final_status')}",
            "",
        ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def timeline_for_race(stream_id: str, race: RaceSequenceState) -> dict[str, object]:
    return {
        "run_id": current_run_id(),
        "stream_id": stream_id,
        "race_sequence": race.race_sequence,
        "race_screen_detection_timestamp": race.race_detected_timestamp,
        "result_search_scheduled_timestamp": race.scheduled_search_start_timestamp,
        "result_search_actual_start_timestamp": race.actual_search_start_timestamp,
        "race_score_frame_timestamp": race.selected_race_score.timestamp if race.selected_race_score else None,
        "total_score_frame_timestamp": race.selected_total_score.timestamp if race.selected_total_score else None,
        "ocr_start_timestamp": race.ocr_start_timestamp,
        "ocr_end_timestamp": race.ocr_end_timestamp,
        "scoreboard_update_timestamp": race.scoreboard_update_timestamp,
        "final_status": race.final_status,
        "buffer_lookup_range": [race.buffer_lookup_start_timestamp, race.buffer_lookup_end_timestamp],
        "buffered_frames_searched": race.buffered_frames_searched,
        "selected_candidate_frame_timestamp": race.selected_total_score.timestamp if race.selected_total_score else None,
        "selected_candidate_frame_index": race.selected_total_score.frame_index if race.selected_total_score else None,
    }


def hash_rows(rows: list[dict[str, str]]) -> str:
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode("utf-8")).hexdigest()


def write_combined_live_pipeline_reports(processors: list[LiveStreamProcessor]) -> None:
    combined: dict[str, list[dict[str, object]]] = {
        "race_screen_detection_report.json": [],
        "result_search_window_report.json": [],
        "result_frame_search_report.json": [],
        "selected_result_frames.json": [],
        "ocr_result_frame_report.json": [],
        "scoreboard_update_report.json": [],
        "live_event_timeline_report.json": [],
    }
    for processor in processors:
        payloads = processor.report_payloads()
        for name, rows in payloads.items():
            combined[name].extend(rows)
    for name, rows in combined.items():
        write_json_report(name, rows)
    write_timeline_markdown(combined["live_event_timeline_report.json"])
