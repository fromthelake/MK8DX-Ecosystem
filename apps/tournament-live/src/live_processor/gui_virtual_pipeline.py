from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import traceback
from types import SimpleNamespace
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .exact_baseline_method import (
    ExactSelectionFrame,
    ExactVideoSelection,
    analyze_candidate_exact,
    load_initial_scan_templates,
    make_streaming_detection_scanner,
    optional_int,
    safe_context,
    save_exact_selected_frame_crop,
    save_exact_track_name_frame,
    selected_actual_frame_index,
    write_exact_selection_reports,
)
from .analysis_window_buffer import AnalysisWindowBuffer, retention_frames_for
from .capture import CaptureDevice
from .capture_card_source import CaptureCardSource
from .gui_events import GuiEventBus
from .config import load_live_config
from .provisional_race_result import emit_provisional_race_result
from .live_signal_pipeline import LiveSignalAnalysisManager
from .live_workbook import LiveWorkbookManager
from .paths import BASELINE_ROOT, DIAGNOSTICS_ROOT, LIVE_ROOT, assert_write_allowed
from .recording import RecordingConfig, RecorderState, RecorderSupervisor, recordings_root
from .recording_lifecycle import RecordingLifecycle, allocate_run_id
from .results_banner import GAME_LOCALE_KEY
from .virtual_capture import LocalVideoVirtualCaptureSource


from mk8dx_tournament_extraction.engine import extract_frames as baseline_extract_frames  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction.game_messages import normalize_game_locale  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction import track_names  # type: ignore  # noqa: E402
from mk8dx_tournament_extraction.engine import extract_score_screen_selection as baseline_selection  # type: ignore  # noqa: E402


# The validated TotalScore selector finds the settled standings by searching for a
# stable run of frames within [transition, transition + TOTAL_SCORE_STABLE_SEARCH_SECONDS]
# (the points roll-up + any TotalScore re-ordering animation finishes inside this
# window). It never reads beyond transition+this, so once the live buffer covers it
# the selected TotalScore frame is frame-identical to a full pass — no fixed wait
# ("gate") is needed. +0.5s margin absorbs fps rounding / the transition-vs-anchor
# delta when we trigger off the reported points anchor.
TOTAL_SCORE_SETTLE_SECONDS = float(baseline_selection.TOTAL_SCORE_STABLE_SEARCH_SECONDS)
TOTAL_SCORE_SETTLE_MARGIN_SECONDS = 0.5
# A race whose confirmed standings stay partial this many times is left for review instead of resubmitted forever.
MAX_CONSENSUS_ATTEMPTS = 5


PRESET_FIXTURE_ROOT = BASELINE_ROOT / "Input_Videos" / "2026-03-28" / "kwalificatie"
PRESET_FIXTURE_VIDEOS = [
    PRESET_FIXTURE_ROOT / "Kwalificatie_Groep_1_2026-03-27 20-00-33.mkv",
    PRESET_FIXTURE_ROOT / "Kwalificatie_Groep_2_2026-03-27 20-00-33.mp4",
    PRESET_FIXTURE_ROOT / "Kwalificatie_Groep_3_2026-03-27 20-00-33.mkv",
]

# Connection-error / reset focus: the 2025-01-03 Qualifier (Groep 1 reset @ r8,
# Groep 2 reset @ r6 + drops, Groep 3 reset @ r5) — the dataset used to validate
# connection handling against the original's expected export. Env-overridable like the
# other external-resource roots (MK8DX_BASELINE_ROOT / MK8DX_TIMETRIALS_EXPORT); the
# default points at the author's source videos and the GUI warns cleanly if absent.
CON_ERROR_PRESET_ROOT = Path(
    os.environ.get("MK8DX_CON_ERROR_PRESET_ROOT")
    or (BASELINE_ROOT / "Input_Videos" / "2025-01-03" / "Qualifier")
)
CON_ERROR_PRESET_VIDEOS = [
    CON_ERROR_PRESET_ROOT / "20250103_Groep1.mp4",
    CON_ERROR_PRESET_ROOT / "20250103_Groep2.mkv",
    CON_ERROR_PRESET_ROOT / "20250103_Groep3.mp4",
]


@dataclass(frozen=True)
class VirtualSourceConfig:
    source_id: str
    display_label: str
    stream_label: str
    video_path: Path
    start_frame: int = 0
    end_frame: int | None = None
    # Real capture-card feed (docs/real_capture_plan.md). When set, video_path is
    # a synthetic display path and the controller uses a CaptureCardSource (the
    # GUI's already-open preview session) instead of decoding a file.
    capture_device: CaptureDevice | None = None
    capture_audio_device: CaptureDevice | None = None
    # The operator's console language mode for this feed: "auto" or one of the
    # 15 game locales (game_messages.GAME_LOCALES: EUen, USen, EUfr, ...).
    game_locale: str = "auto"

    @property
    def is_capture(self) -> bool:
        return self.capture_device is not None


@dataclass(frozen=True)
class VideoPreflightResult:
    source_id: str
    stream_label: str
    video_path: Path
    status: str
    context: dict[str, Any] | None = None
    error: str = ""

    @property
    def ready(self) -> bool:
        return self.status == "ready" and self.context is not None

    @property
    def status_text(self) -> str:
        if self.ready and self.context is not None:
            return f"ready: frames {int(self.context['usable_start_frame'])}-{int(self.context['readable_end_frame'])}"
        if self.status == "failed":
            return f"failed: {self.error}"
        return self.status

    def to_report(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "stream_label": self.stream_label,
            "video_path": str(self.video_path),
            "status": self.status,
            "error": self.error,
            "context": safe_context(self.context or {}),
        }


@dataclass(frozen=True)
class ScheduledGuiEvent:
    event_type: str
    source_id: str
    stream_label: str
    timestamp: float = 0.0
    frame_index: int | None = None
    race_sequence: int | None = None
    message: str = ""
    data: dict[str, Any] | None = None


class GuiVirtualCaptureController:
    def __init__(
        self,
        sources: list[VirtualSourceConfig],
        playback_speed: float = 1.0,
        run_id: str | None = None,
        gate_playback_until_analysis_ready: bool = False,
        prepared_contexts: dict[str, dict[str, Any]] | None = None,
        record_virtual_feeds: bool = False,
        use_live_signal_pipeline: bool = False,
        consensus_worker_count: int | None = None,
        capture_sessions: dict[str, CaptureCardSource] | None = None,
        force_buffer_only: bool = False,
    ) -> None:
        # Every Start owns a collision-resistant identity, including an
        # explicitly non-recorded run. Excel/CSV/JSON output must never reuse a
        # second-resolution ``gui_*`` name after a quick false Start/Stop.
        self.run_id = run_id or allocate_run_id(recordings_root())
        self.started_at_ms: int | None = None
        self.stopped_at_ms: int | None = None
        self.event_bus = GuiEventBus(self.run_id)
        capture_sessions = capture_sessions or {}
        self.sources: list[Any] = []
        # Per feed: the chosen game locale, and once analysis runs, the feed's
        # context (where the banner reader looks it up), so a change during the
        # run applies from the next race.
        self.game_locales = {source.source_id: normalize_game_locale(source.game_locale) for source in sources}
        self._source_contexts: dict[str, dict[str, Any]] = {}
        for source in sources:
            if source.capture_device is not None:
                # Preview-to-running promotion: reuse the GUI's already-open
                # preview session (the device is opened exactly once); adopt it
                # into this run's event bus. Fall back to a fresh session only
                # when no preview was opened (e.g. headless scripts).
                session = capture_sessions.get(source.source_id)
                if session is None:
                    session = CaptureCardSource(
                        source_id=source.source_id,
                        display_label=source.display_label,
                        stream_label=source.stream_label,
                        event_bus=self.event_bus,
                        device_name=source.capture_device.name,
                        device_alternative_name=source.capture_device.alternative_name,
                        audio_device_name=source.capture_audio_device.name if source.capture_audio_device else "",
                        audio_device_alternative_name=(
                            source.capture_audio_device.alternative_name if source.capture_audio_device else ""
                        ),
                    )
                else:
                    session.event_bus = self.event_bus
                self.sources.append(session)
                continue
            self.sources.append(
                LocalVideoVirtualCaptureSource(
                    source_id=source.source_id,
                    display_label=source.display_label,
                    video_path=source.video_path,
                    stream_label=source.stream_label,
                    event_bus=self.event_bus,
                    playback_speed=playback_speed,
                    start_frame=source.start_frame,
                    end_frame=source.end_frame,
                )
            )
        # Feeds must have unique video identities: bundle folders, consensus
        # groups, and the export all key on them, so a duplicate silently merges
        # two feeds' races (bit us when two cards got the same display label).
        from mk8dx_tournament_extraction.engine.extract_common import build_video_identity  # noqa: WPS433

        identities = [build_video_identity(Path(source.video_path)) for source in self.sources]
        duplicate_identities = {i for i in identities if identities.count(i) > 1}
        if duplicate_identities:
            raise ValueError(
                "Duplicate feed identities would merge races in bundles/exports: "
                + ", ".join(sorted(duplicate_identities))
            )
        self.pipeline_state = "not_started"
        self.export_paths: dict[str, str] = {}
        self._pipeline_thread: threading.Thread | None = None
        self._scoreboard_events_emitted = 0
        # Confirmed-standings attempts per (stream, race). A race whose consensus stays partial is retired after
        # MAX_CONSENSUS_ATTEMPTS instead of being resubmitted forever (01-11: 800 runs for 8 races, the drain never
        # ended and the other races were never read).
        self._consensus_attempts: dict[tuple[str, int], int] = {}
        self._retired_consensus_pairs: set[tuple[str, int]] = set()
        self.config = load_live_config()
        self.workbook_manager = LiveWorkbookManager(self.run_id)
        self.final_export_result: dict[str, Any] | None = None
        self.finalization_pending = False
        self.consensus_worker_count = self._configured_consensus_worker_count(consensus_worker_count)
        self._consensus_executor = ThreadPoolExecutor(max_workers=self.consensus_worker_count, thread_name_prefix="gui-consensus")
        self._consensus_extractor: Any | None = None
        self._consensus_performance_records: list[dict[str, Any]] = []
        self.gate_playback_until_analysis_ready = False
        self.prepared_contexts = prepared_contexts or {}
        self.record_virtual_feeds = record_virtual_feeds
        # Validation lever: run FILE sources under the capture-card contract
        # (strict buffer-only, no file fallback) to prove the live path on the
        # known fixtures before pointing it at real hardware.
        self.force_buffer_only = bool(force_buffer_only)
        # Per-source live-faithful frame buffers, populated in start_all().
        self.analysis_buffers: dict[str, AnalysisWindowBuffer] = {}
        # Fast 'Latest race' provisional RaceScore display (emitted as soon as the
        # RaceScore frame is selected, before TotalScore consensus). Display-only:
        # never feeds the confirmed export. A small dedicated executor keeps these
        # light OCR jobs from competing with the confirmed-consensus workers.
        self._provisional_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="gui-provisional")
        # Per-stream scan+selection in parallel (synced races serialize ~12-14s each).
        self._scan_executor = ThreadPoolExecutor(max_workers=max(1, len(self.sources)), thread_name_prefix="gui-scan")
        self._provisional_emitted: set[tuple[str, int]] = set()
        self._provisional_extractor: Any | None = None
        self._provisional_extractor_lock = threading.Lock()
        # Record via x264 (CPU), not nvenc: on this hardware 3 concurrent nvenc
        # sessions contend with the CUDA OCR and ~double consensus latency, while
        # x264 keeps up at 30fps×N with 0 drops and leaves the GPU for OCR.
        self.recorder = (
            RecorderSupervisor(
                self.run_id,
                config=RecordingConfig(
                    width=int(getattr(self.config, "recording_width", 1280)),
                    height=int(getattr(self.config, "recording_height", 720)),
                    video_bitrate=str(getattr(self.config, "recording_video_bitrate", "12M")),
                    maxrate=str(getattr(self.config, "recording_maxrate", "16M")),
                    bufsize=str(getattr(self.config, "recording_bufsize", "24M")),
                    encoder_preference="x264",
                    planned_duration_hours=float(getattr(self.config, "recording_planned_duration_hours", 0.0)),
                ),
            )
            if record_virtual_feeds else None
        )
        # Confirmed RaceScore/TotalScore bundles must use the exact baseline
        # selector. The forward signal manager is useful for experiments, but
        # its drop-start timing can choose TotalScore frames too early.
        self.use_live_signal_pipeline = use_live_signal_pipeline
        self.signal_manager: LiveSignalAnalysisManager | None = None
        if self.use_live_signal_pipeline:
            self.signal_manager = LiveSignalAnalysisManager(
                self.sources,
                event_bus=self.event_bus,
                prepared_contexts=self.prepared_contexts,
            )
            for source in self.sources:
                source.frame_sink = self.signal_manager.source_sink(source.source_id)

    def _configured_consensus_worker_count(self, override: int | None = None) -> int:
        if not bool(getattr(self.config, "live_consensus_parallel_enabled", True)):
            return 1
        configured = max(1, int(override if override is not None else getattr(self.config, "live_consensus_workers_default", 2)))
        maximum = max(1, int(getattr(self.config, "live_consensus_workers_max", 3)))
        return min(configured, maximum)

    def set_game_locale(self, source_id: str, locale: str) -> None:
        """The operator changed a feed's console language; the next race reads with it."""
        value = normalize_game_locale(locale)
        self.game_locales[source_id] = value
        track_names.set_stream_locale(source_id, value)
        context = self._source_contexts.get(source_id)
        if context is not None:
            context[GAME_LOCALE_KEY] = value

    def start_all(self, run_pipeline: bool = True) -> None:
        if self.has_resumable_sources():
            self.resume_all()
            return
        if self.has_running_sources():
            return
        if self.started_at_ms is None:
            self.started_at_ms = time.time_ns() // 1_000_000
        self.write_manifest("starting")
        if self.recorder is not None:
            capture_sources = [source for source in self.sources if isinstance(source, CaptureCardSource)]
            virtual_sources = [source for source in self.sources if not isinstance(source, CaptureCardSource)]
            if capture_sources:
                self.recorder.arm_capture_sources(capture_sources)
            for source in virtual_sources:
                # Capture-card model: the recorder encodes the frame stream tapped
                # from the source (1x, full framerate), not a transcode of the file.
                recording = self.recorder.start_stream_recording(
                    source_id=source.source_id,
                    stream_label=source.stream_label,
                )
                source.recorder_sink = recording.submit
                event_type = "RECORDING_STARTED" if recording.state == RecorderState.RUNNING else "RECORDING_FAILED"
                self.event_bus.emit(
                    event_type,
                    source_id=source.source_id,
                    stream_label=source.stream_label,
                    message=recording.error or f"recording to {recording.output_path}",
                    data={"output_path": str(recording.output_path), "state": recording.state.value},
                )
        if self.use_live_signal_pipeline and self.signal_manager is not None:
            self.signal_manager.start()
        for source in self.sources:
            if self.config.analysis_window_buffer_enabled:
                # Open early so fps is known, then attach the full-rate tap
                # BEFORE the decode thread starts so no early frames are missed.
                if source.state == "initialized":
                    source.open()
                retention = retention_frames_for(
                    source.fps or 30.0, self.config.analysis_window_retention_seconds
                )
                buffer = AnalysisWindowBuffer(source.stream_label, retention)
                self.analysis_buffers[source.source_id] = buffer
                source.analysis_sink = buffer.add
            source.start()
        if run_pipeline:
            # Warm the OCR readers (model load to GPU) in the background now, during
            # the idle pre-race window, so the first race doesn't pay the ~13s
            # first-OCR warmup. Display/perf only — does not touch selection/export.
            threading.Thread(target=self._prewarm_ocr, name="gui-ocr-prewarm", daemon=True).start()
            self._pipeline_thread = threading.Thread(target=self._run_exact_pipeline_worker, name="gui-exact-pipeline", daemon=True)
            self._pipeline_thread.start()

    def pause_all(self) -> None:
        for source in self.sources:
            source.pause()
        if self.recorder is not None and self.recorder.direct_recordings:
            self._transition_recording(RecordingLifecycle.PAUSED_ANALYSIS)

    def resume_all(self) -> None:
        for source in self.sources:
            source.resume()
        if self.recorder is not None and self.recorder.direct_recordings:
            self._transition_recording(RecordingLifecycle.ACTIVE)

    def stop_all(self) -> None:
        if self.stopped_at_ms is None:
            self.stopped_at_ms = time.time_ns() // 1_000_000
        if self.recorder is not None and self.recorder.direct_recordings:
            self._transition_recording(RecordingLifecycle.STOPPING_CAPTURE)
        for source in self.sources:
            source.stop()
        if self.recorder is not None and self.recorder.direct_recordings:
            self._transition_recording(
                RecordingLifecycle.CLOSING_WORKING_PARTS,
                recordings=[recording.summary() for recording in self.recorder.direct_recordings],
            )
        if self.use_live_signal_pipeline and self.signal_manager is not None:
            self.signal_manager.stop()
        if self.recorder is not None:
            self.recorder.stop_all()
            self._emit_recording_refresh_events()

    def export_current_workbook(self, reason: str = "manual_current_export") -> dict[str, Any]:
        result = self.workbook_manager.export_current(reason=reason)
        self.event_bus.emit(
            "LIVE_WORKBOOK_UPDATED",
            message="current workbook exported",
            data=result,
        )
        return result

    def _export_final_workbook_if_possible(self, reason: str) -> dict[str, Any] | None:
        try:
            result = self.workbook_manager.export_final(reason=reason)
        except ValueError:
            return None
        except Exception as exc:
            self.event_bus.emit(
                "LIVE_WORKBOOK_FAILED",
                message=str(exc),
                data={"reason": reason},
            )
            return None
        self.final_export_result = result
        self.export_paths = {str(key): str(value) for key, value in (result.get("files") or {}).items()}
        self.event_bus.emit(
            "LIVE_WORKBOOK_UPDATED",
            message="final workbook exported",
            data=result,
        )
        self._emit_export_attention(result)
        return result

    def _emit_export_attention(self, result: dict[str, Any]) -> None:
        """Tell the operator, once per change, what the export needs after the run:
        races still without a track, and recordings that started after race 1."""
        attention = {
            "races": list(result.get("tracks_not_filled_in") or []),
            "late_starts": list(result.get("late_starts") or []),
        }
        if attention == getattr(self, "_export_attention", {"races": [], "late_starts": []}):
            return
        self._export_attention = attention
        self.event_bus.emit(
            "LIVE_EXPORT_ATTENTION",
            message=(
                f"{len(attention['races'])} race(s) without a track; "
                f"{len(attention['late_starts'])} recording(s) started after race 1"
            ),
            data=attention,
        )

    def has_resumable_sources(self) -> bool:
        return any(source.state == "paused" for source in self.sources)

    def has_running_sources(self) -> bool:
        return any(source.state == "running" for source in self.sources)

    def wait(self, timeout: float | None = None) -> None:
        start = time.perf_counter()
        if self.recorder is not None and self.recorder.direct_recordings:
            self._transition_recording(RecordingLifecycle.DRAINING_FINAL_ANALYSIS)
        for source in self.sources:
            remaining = None if timeout is None else max(0.0, timeout - (time.perf_counter() - start))
            source.wait(remaining)
        if self._pipeline_thread:
            remaining = None if timeout is None else max(0.0, timeout - (time.perf_counter() - start))
            self._pipeline_thread.join(remaining)
        # Shut down producer-first: the scan executor feeds the provisional executor
        # (and the worker loop feeds consensus), so draining scan first guarantees no
        # scan task submits to an already-closed downstream executor.
        self._scan_executor.shutdown(wait=True, cancel_futures=False)
        self._provisional_executor.shutdown(wait=True, cancel_futures=False)
        self._consensus_executor.shutdown(wait=True, cancel_futures=False)
        if self.recorder is not None:
            self.recorder.refresh()
            self._emit_recording_refresh_events()
        if self.recorder is not None and self.recorder.direct_recordings:
            self._finalize_recording_run()
        else:
            self._finalize_connected_record_without_recording()
        self.write_source_summary()
        self.event_bus.write_scoreboard_log()
        self.write_manifest(self.pipeline_state)

    def _transition_recording(self, state: RecordingLifecycle, **details: Any) -> None:
        if self.recorder is None:
            return
        self.recorder.transition(state, **details)
        self.event_bus.emit(
            "RECORDING_LIFECYCLE",
            message=state.value,
            data={"state": state.value, **details},
        )

    def _finalize_connected_record_without_recording(self) -> None:
        """Complete online evidence even when the operator deliberately disabled MKV."""
        if self.final_export_result is None:
            self._export_final_workbook_if_possible("stop_all_final_export")
        canonical = Path(str((self.final_export_result or {}).get("files", {}).get("canonical_json") or ""))
        if not canonical.is_file():
            return
        try:
            from mk8dx_tournament_connected.client import connected_delivery_barrier

            delivery = connected_delivery_barrier(
                canonical,
                started_at_ms=self.started_at_ms,
                stopped_at_ms=self.stopped_at_ms,
                analysis_completed_at_ms=time.time_ns() // 1_000_000,
            )
        except Exception as error:
            delivery = {
                "connected": True, "delivered": False, "queued": True,
                "error": f"{type(error).__name__}: {error}",
            }
        self.event_bus.emit(
            "CONNECTED_EVIDENCE_RECORD",
            message="online evidence record finalized" if delivery.get("delivered") else "online evidence record retained for retry",
            data=delivery,
        )

    def _finalize_recording_run(self) -> None:
        if self.recorder is None or not self.recorder.direct_recordings:
            return
        state = self.recorder.manifest.state if self.recorder.manifest is not None else None
        retry_assembly = state == RecordingLifecycle.FINALIZATION_FAILED
        if state == RecordingLifecycle.WAITING_FOR_ECOSYSTEM_DELIVERY:
            self._transition_recording(RecordingLifecycle.DELIVERING_CONNECTED_RESULTS)
        elif state == RecordingLifecycle.DRAINING_FINAL_ANALYSIS:
            self._transition_recording(RecordingLifecycle.FINALIZING_RESULTS)
            if self.final_export_result is None:
                self._export_final_workbook_if_possible("stop_all_final_export")
            self._transition_recording(
                RecordingLifecycle.PERSISTING_ECOSYSTEM_DATA,
                local_result_files=dict((self.final_export_result or {}).get("files") or {}),
            )
            self._transition_recording(RecordingLifecycle.DELIVERING_CONNECTED_RESULTS)
        elif state not in {RecordingLifecycle.DELIVERING_CONNECTED_RESULTS, RecordingLifecycle.FINALIZATION_FAILED}:
            return

        canonical = Path(str((self.final_export_result or {}).get("files", {}).get("canonical_json") or ""))
        delivery = {"connected": False, "delivered": True, "uploaded": 0, "visible": 0, "queued": False}
        delivery_pending = False
        if canonical.is_file() and not retry_assembly:
            try:
                from mk8dx_tournament_connected.client import connected_delivery_barrier

                delivery = connected_delivery_barrier(
                    canonical,
                    started_at_ms=self.started_at_ms,
                    stopped_at_ms=self.stopped_at_ms,
                    analysis_completed_at_ms=time.time_ns() // 1_000_000,
                )
            except Exception as error:
                delivery = {
                    "connected": True,
                    "delivered": False,
                    "uploaded": 0,
                    "visible": 0,
                    "queued": True,
                    "error": f"{type(error).__name__}: {error}",
                }
        if delivery.get("connected") and not delivery.get("delivered") and not retry_assembly:
            delivery_pending = True
            self._transition_recording(
                RecordingLifecycle.WAITING_FOR_ECOSYSTEM_DELIVERY,
                connected_delivery=delivery,
                retryable_action="retry_upload",
            )
        self.finalization_pending = False
        self._transition_recording(
            RecordingLifecycle.ASSEMBLING_RECORDINGS,
            connected_delivery=delivery,
        )
        try:
            validations = self.recorder.assemble_and_validate()
        except Exception as error:
            self._transition_recording(
                RecordingLifecycle.FINALIZATION_FAILED,
                retryable_action="retry_finalization",
                error=f"{type(error).__name__}: {error}",
            )
            return
        self._transition_recording(
            RecordingLifecycle.VERIFYING_RECORDINGS,
            final_recordings=[asdict(validation) for validation in validations],
        )
        if not validations or any(not validation.ok for validation in validations):
            self._transition_recording(
                RecordingLifecycle.FINALIZATION_FAILED,
                retryable_action="retry_finalization",
                final_recordings=[asdict(validation) for validation in validations],
            )
            return
        has_gaps = any(
            recording.archive_failed or recording.unclean_stop
            for recording in self.recorder.direct_recordings
        )
        terminal = (
            RecordingLifecycle.COMPLETED_WITH_PENDING_DELIVERY
            if delivery_pending else
            RecordingLifecycle.COMPLETED_WITH_EVIDENCE_GAPS
            if has_gaps else
            RecordingLifecycle.COMPLETED
        )
        self._transition_recording(
            terminal,
            final_recordings=[asdict(validation) for validation in validations],
            recording_evidence_gaps=has_gaps,
            connected_delivery=delivery,
        )
        self.recorder.cleanup_validated_parts(validations)

    def retry_recording_finalization(self) -> None:
        self._finalize_recording_run()

    def has_pending_delivery_outbox(self) -> bool:
        if self.recorder is None or self.recorder.manifest is None:
            return False
        if self.recorder.manifest.state != RecordingLifecycle.COMPLETED_WITH_PENDING_DELIVERY:
            return False
        canonical = Path(str((self.final_export_result or {}).get("files", {}).get("canonical_json") or ""))
        if not canonical.is_file():
            return False
        from mk8dx_tournament_connected.client import queued_upload_exists

        return queued_upload_exists(canonical)

    def mark_pending_delivery_completed(self, *, uploaded: int) -> bool:
        if self.recorder is None or self.recorder.manifest is None:
            return False
        if self.recorder.manifest.state != RecordingLifecycle.COMPLETED_WITH_PENDING_DELIVERY:
            return False
        self._transition_recording(
            RecordingLifecycle.COMPLETED,
            connected_delivery={
                "connected": True,
                "delivered": True,
                "uploaded": max(0, int(uploaded)),
                "queued": False,
                "verified_by_frozen_outbox_retry": True,
            },
            delivery_completed_after_retry=True,
        )
        return True

    def write_manifest(self, status: str) -> Path:
        payload = {
            "run_id": self.run_id,
            "status": status,
            "start_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "fixture_videos_used": [str(source.video_path) for source in self.sources],
            "source_count": len(self.sources),
            "generated_artifacts": [
                str(DIAGNOSTICS_ROOT / "gui_virtual_capture_events.jsonl"),
                str(DIAGNOSTICS_ROOT / "gui_virtual_capture_source_summary.json"),
                str(DIAGNOSTICS_ROOT / "gui_scoreboard_update_log.json"),
                str(DIAGNOSTICS_ROOT / "recording_supervisor_summary.json"),
            ],
            "export_files": self.export_paths,
            "record_virtual_feeds": self.record_virtual_feeds,
            "consensus_worker_count": self.consensus_worker_count,
        }
        path = assert_write_allowed(DIAGNOSTICS_ROOT / "gui_virtual_capture_run_manifest.json")
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        return path

    def write_source_summary(self) -> Path:
        payload = {
            "run_id": self.run_id,
            "sources": [source.summary() for source in self.sources],
            "pipeline_state": self.pipeline_state,
            "scoreboard_events": self._scoreboard_events_emitted,
            "consensus_worker_count": self.consensus_worker_count,
            "recording": self.recorder.summary() if self.recorder is not None else None,
        }
        path = assert_write_allowed(DIAGNOSTICS_ROOT / "gui_virtual_capture_source_summary.json")
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        return path

    def _run_exact_pipeline_worker(self) -> None:
        self.pipeline_state = "running"
        self.event_bus.emit("ANALYSIS_STARTED", message="incremental exact-method live extraction started", data={"source_count": len(self.sources)})
        try:
            os.environ["MK8DX_LIVE_RUN_ID"] = self.run_id
            os.environ["MK8DX_CLEAN_REPLAY_RUN_ID"] = self.run_id
            self._write_source_manifest()
            if self.use_live_signal_pipeline:
                self._run_forward_signal_exact_worker()
            else:
                self._run_incremental_exact_live_worker()
            self._export_final_workbook_if_possible("analysis_completed_final_export")
            if self.export_paths:
                self.pipeline_state = "exported"
                self.event_bus.emit("EXPORT_CREATED", message="exact-method export created", data=self.export_paths)
                self.event_bus.emit("ANALYSIS_COMPLETED", message="analysis completed and exported", data=self.export_paths)
            else:
                self.pipeline_state = "completed_no_export"
                self.event_bus.emit("ANALYSIS_COMPLETED", message="analysis completed; no validated export produced yet", data={})
        except Exception as exc:
            self.pipeline_state = "failed"
            tb = traceback.format_exc()
            try:
                assert_write_allowed(DIAGNOSTICS_ROOT / "gui_virtual_capture_pipeline_error.txt").write_text(
                    tb, encoding="utf-8"
                )
            except Exception:
                pass
            self.event_bus.emit(
                "SOURCE_FAILED",
                message=str(exc),
                data={"error_type": type(exc).__name__, "traceback": tb[-4000:]},
            )
        finally:
            if self.recorder is not None:
                self.recorder.refresh()
            if (
                self.use_live_signal_pipeline
                and self.signal_manager is not None
                and any(source.state not in {"ended", "failed", "stopped"} for source in self.sources)
            ):
                self.signal_manager.stop()
            self.write_source_summary()
            self.event_bus.write_scoreboard_log()
            self.write_manifest(self.pipeline_state)

    def _emit_recording_refresh_events(self) -> None:
        if self.recorder is None:
            return
        for recording in self.recorder.recordings:
            self.event_bus.emit(
                "RECORDING_COMPLETED" if recording.state == RecorderState.STOPPED else "RECORDING_FAILED" if recording.state == RecorderState.FAILED else "RECORDING_STATUS",
                source_id=recording.source_id,
                stream_label=recording.stream_label,
                message=recording.error or recording.state.value,
                data={"output_path": str(recording.output_path), "state": recording.state.value},
            )

    def _run_forward_signal_exact_worker(self) -> None:
        emitted_scoreboards: set[tuple[str, int]] = set()
        inflight: dict[Future[dict[str, Any]], tuple[str, int]] = {}
        last_consensus_submit = 0.0
        while any(source.state not in {"ended", "failed", "stopped"} for source in self.sources):
            now = time.perf_counter()
            self._collect_finished_consensus_jobs(inflight, emitted_scoreboards, "forward signal")
            if len(inflight) < self.consensus_worker_count and now - last_consensus_submit >= 1.0:
                if self.signal_manager is None:
                    break
                ready_pairs = self.signal_manager.complete_pair_keys - emitted_scoreboards - set(inflight.values()) - self._retired_consensus_pairs
                if ready_pairs:
                    self.signal_manager.write_selection_reports()
                    self._submit_ready_consensus_jobs(ready_pairs, inflight, "forward signal")
                    last_consensus_submit = now
            time.sleep(0.2)
        self.event_bus.emit("ANALYSIS_PROGRESS", message="sources ended; draining queued live signal frames")
        if self.signal_manager is None:
            return
        self.signal_manager.drain(timeout=120.0)
        self.signal_manager.stop()
        self._drain_consensus_jobs(inflight, emitted_scoreboards, "forward signal final")
        while True:
            remaining_pairs = self.signal_manager.complete_pair_keys - emitted_scoreboards - set(inflight.values()) - self._retired_consensus_pairs
            if not remaining_pairs and not inflight:
                break
            self.signal_manager.write_selection_reports()
            self._submit_ready_consensus_jobs(remaining_pairs, inflight, "forward signal final")
            self._drain_consensus_jobs(inflight, emitted_scoreboards, "forward signal final")

    def _run_signal_consensus_and_emit_updates(self, emitted_scoreboards: set[tuple[str, int]]) -> None:
        if self.signal_manager is None:
            return
        if not self.signal_manager.has_complete_pair:
            return
        self.signal_manager.write_selection_reports()
        for pair in sorted(self.signal_manager.complete_pair_keys - emitted_scoreboards):
            job = self._run_consensus_job({pair}, "forward signal")
            self._emit_consensus_result(job["result"], emitted_scoreboards, "forward signal", job)

    def _submit_ready_consensus_jobs(
        self,
        ready_pairs: set[tuple[str, int]],
        inflight: dict[Future[dict[str, Any]], tuple[str, int]],
        source_label: str,
    ) -> None:
        for pair in sorted(ready_pairs):
            if self._consensus_attempts.get(pair, 0) >= MAX_CONSENSUS_ATTEMPTS and pair not in self._retired_consensus_pairs:
                self._retired_consensus_pairs.add(pair)
                self.event_bus.emit(
                    "ANALYSIS_PROGRESS",
                    stream_label=pair[0],
                    race_sequence=pair[1],
                    message=f"confirmed standings for race {pair[1]} still partial after "
                            f"{MAX_CONSENSUS_ATTEMPTS} attempts; left for review",
                    data={"pairs": [f"{pair[0]}:{pair[1]}"], "attempts": MAX_CONSENSUS_ATTEMPTS},
                )
        ready_pairs = set(ready_pairs) - self._retired_consensus_pairs
        if not ready_pairs:
            return
        queue_size = len(ready_pairs)
        self.event_bus.emit(
            "ANALYSIS_PROGRESS",
            message=f"confirmed standings consensus queued for {queue_size} pending race pair(s)",
            data={
                "pairs": sorted([f"{stream}:{race}" for stream, race in ready_pairs]),
                "queue_size": queue_size,
                "worker_status": "queued",
                "consensus_worker_count": self.consensus_worker_count,
                "inflight_count": len(inflight),
            },
        )
        for pair in sorted(ready_pairs):
            if len(inflight) >= self.consensus_worker_count:
                break
            stream, race = pair
            pair_text = f"{stream}:{race}"
            self.event_bus.emit(
                "CONSENSUS_QUEUED",
                stream_label=stream,
                race_sequence=race,
                message=f"confirmed standings queued for race {race}",
                data={
                    "pairs": [pair_text],
                    "queue_size": queue_size,
                    "worker_status": "queued",
                    "consensus_worker_count": self.consensus_worker_count,
                    "inflight_count": len(inflight),
                },
            )
            self.event_bus.emit(
                "CONSENSUS_RUNNING",
                stream_label=stream,
                race_sequence=race,
                message=f"{source_label} confirmed standings running for race {race}",
                data={
                    "pairs": [pair_text],
                    "started_at": time.time(),
                    "worker_status": "running",
                    "consensus_worker_count": self.consensus_worker_count,
                    "inflight_count": len(inflight) + 1,
                },
            )
            self._consensus_attempts[pair] = self._consensus_attempts.get(pair, 0) + 1
            future = self._consensus_executor.submit(self._run_consensus_job, {pair}, source_label)
            inflight[future] = pair

    def _scan_and_select(self, state: "IncrementalSourceState") -> None:
        """One stream's per-iteration work (detection scan + ready-candidate
        selection). Runs in its own thread under parallel_stream_selection."""
        state.scan_available_frames(self.event_bus)
        state.process_ready_score_candidates(self.event_bus, max_candidates=1)
        # again after selection: the last race's TotalScore may be selected in the tick that ends the stream
        state._check_cup_final(self.event_bus)

    def _prewarm_ocr(self) -> None:
        """Load the easyocr/torch OCR readers to GPU ahead of the first race so it
        doesn't pay the one-time ~13s first-OCR warmup. Background, best-effort."""
        started = time.perf_counter()
        try:
            import numpy as np

            dummy = np.full((64, 200, 3), 255, dtype=np.uint8)
        except Exception:
            return
        warmed: list[str] = []
        # Provisional RaceScore reader = the exact extractor instance the live path uses.
        try:
            self._get_provisional_extractor()._get_reader().readtext(dummy)
            warmed.append("provisional_row_ocr")
        except Exception:
            pass
        # Confirmed consensus player-name reader.
        try:
            from mk8dx_tournament_extraction.engine.extract_text import PLAYER_NAME_EASYOCR_LANGS, _get_easyocr_reader

            _get_easyocr_reader(PLAYER_NAME_EASYOCR_LANGS).readtext(dummy)
            warmed.append("consensus_player_name")
        except Exception:
            pass
        self.event_bus.emit(
            "OCR_PREWARM_DONE",
            message=f"OCR readers warmed ({', '.join(warmed) or 'none'}) in {time.perf_counter() - started:.1f}s",
            data={"warmed": warmed, "seconds": round(time.perf_counter() - started, 2)},
        )

    def _get_provisional_extractor(self) -> Any:
        with self._provisional_extractor_lock:
            if self._provisional_extractor is None:
                from .baseline_row_ocr import BaselineRowOcrExtractor  # late import for startup speed

                self._provisional_extractor = BaselineRowOcrExtractor()
            return self._provisional_extractor

    def _submit_provisional_frame(self, source_id: str, selected: "ExactSelectionFrame") -> None:
        """Dispatch the fast provisional RaceScore OCR for one selected frame onto
        the parallel provisional executor (display-only; deduped per race)."""
        key = (selected.stream_id, int(selected.race_sequence))
        if key in self._provisional_emitted:
            return
        self._provisional_emitted.add(key)
        try:
            self._provisional_executor.submit(
                emit_provisional_race_result,
                event_bus=self.event_bus,
                source_id=source_id,
                stream_label=selected.stream_id,
                selected=selected,
                extractor=self._get_provisional_extractor(),
            )
        except RuntimeError:
            # Executor already shut down (teardown race): drop the late provisional
            # rather than crash the worker. Display-only, so nothing is lost.
            pass

    def _collect_finished_consensus_jobs(
        self,
        inflight: dict[Future[dict[str, Any]], tuple[str, int]],
        emitted_scoreboards: set[tuple[str, int]],
        source_label: str,
    ) -> None:
        for future in [item for item in inflight if item.done()]:
            pair = inflight.pop(future)
            try:
                job = future.result()
            except Exception as exc:
                job = {
                    "result": SimpleNamespace(returncode=1, stdout="", stderr=f"{type(exc).__name__}: {exc}", events=[]),
                    "pairs": [f"{pair[0]}:{pair[1]}"],
                    "started_at": 0.0,
                    "finished_at": time.time(),
                    "duration_seconds": 0.0,
                    "events": [],
                    "worker_status": "failed",
                }
            self._emit_consensus_result(job["result"], emitted_scoreboards, source_label, job)

    def _drain_consensus_jobs(
        self,
        inflight: dict[Future[dict[str, Any]], tuple[str, int]],
        emitted_scoreboards: set[tuple[str, int]],
        source_label: str,
    ) -> None:
        while inflight:
            self._collect_finished_consensus_jobs(inflight, emitted_scoreboards, source_label)
            if inflight:
                time.sleep(0.2)

    def _emit_consensus_result(
        self,
        result: subprocess.CompletedProcess[str],
        emitted_scoreboards: set[tuple[str, int]],
        source_label: str,
        job: dict[str, Any] | None = None,
    ) -> None:
        job = job or {}
        # A gallery race that the consensus intentionally skipped is "handled":
        # mark it so the incremental drain loop retires it instead of resubmitting
        # it forever (it never emits a scoreboard of its own).
        for skipped in getattr(result, "skipped_pairs", None) or []:
            emitted_scoreboards.add((str(skipped[0]), int(skipped[1])))
        self._record_consensus_performance(job, result)
        for pair in job.get("pairs", []):
            stream, _, race_text = str(pair).rpartition(":")
            try:
                race_sequence = int(race_text)
            except ValueError:
                race_sequence = None
            self.event_bus.emit(
                "CONSENSUS_COMPLETED",
                stream_label=stream,
                race_sequence=race_sequence,
                message=f"{source_label} consensus completed",
                data={
                    "pairs": [pair],
                    "duration_seconds": job.get("duration_seconds"),
                    "returncode": result.returncode,
                    "worker_status": "completed" if result.returncode == 0 else "failed",
                    "worker_thread": job.get("worker_thread", ""),
                    "consensus_worker_count": self.consensus_worker_count,
                    "stderr_tail": result.stderr[-1000:] if result.stderr else "",
                },
            )
        if result.returncode != 0:
            self.event_bus.emit(
                "ANALYSIS_PROGRESS",
                message=f"{source_label} consensus not ready yet",
                data={"returncode": result.returncode, "stderr": result.stderr[-2000:]},
            )
            return
        self.pipeline_state = "extracted"
        events = list(job.get("events") or []) if job else []
        if not events:
            events = self._load_exact_reports_as_events()
        self.event_bus.emit("ANALYSIS_REPORTS_READY", message=f"{source_label} reports ready; new events={len(events)}", data={"event_count": len(events)})
        for event in sorted(events, key=lambda item: (item.timestamp, item.stream_label, item.race_sequence or 0, item.event_type)):
            key = (event.stream_label, int(event.race_sequence or 0))
            if event.event_type == "SCOREBOARD_UPDATED" and key in emitted_scoreboards:
                continue
            if event.event_type != "SCOREBOARD_UPDATED" and key in emitted_scoreboards:
                continue
            self.event_bus.emit(
                event.event_type,
                source_id=event.source_id,
                stream_label=event.stream_label,
                timestamp=event.timestamp,
                frame_index=event.frame_index,
                race_sequence=event.race_sequence,
                message=event.message,
                data=event.data or {},
            )
            if event.event_type == "SCOREBOARD_UPDATED":
                emitted_scoreboards.add(key)
                self._scoreboard_events_emitted += 1
                self._update_live_workbook_from_scoreboard(event)

    def _update_live_workbook_from_scoreboard(self, event: ScheduledGuiEvent) -> None:
        try:
            result = self.workbook_manager.apply_scoreboard_update(
                stream_label=event.stream_label,
                race_sequence=int(event.race_sequence or 0),
                rows=list((event.data or {}).get("rows") or []),
                tournament_rows=list((event.data or {}).get("tournament_rows") or []),
            )
        except Exception as exc:
            self.event_bus.emit(
                "LIVE_WORKBOOK_FAILED",
                stream_label=event.stream_label,
                race_sequence=event.race_sequence,
                message=str(exc),
                data={"reason": "scoreboard_update"},
            )
            return
        self.event_bus.emit(
            "LIVE_WORKBOOK_UPDATED",
            stream_label=event.stream_label,
            race_sequence=event.race_sequence,
            message="current workbook updated",
            data=result,
        )
        self._emit_export_attention(result)

    def _record_consensus_performance(self, job: dict[str, Any], result: Any) -> None:
        if not job:
            return
        details: list[dict[str, Any]] = []
        try:
            payload = json.loads(str(getattr(result, "stdout", "") or "{}"))
            details = [item for item in payload.get("details", []) if isinstance(item, dict)] if isinstance(payload, dict) else []
        except json.JSONDecodeError:
            details = []
        record = {
            "run_id": self.run_id,
            "pairs": list(job.get("pairs") or []),
            "started_at": job.get("started_at"),
            "finished_at": job.get("finished_at"),
            "duration_seconds": job.get("duration_seconds"),
            "returncode": getattr(result, "returncode", None),
            "worker_thread": job.get("worker_thread", ""),
            "worker_status": job.get("worker_status", ""),
            "consensus_worker_count": self.consensus_worker_count,
            "details": details,
        }
        self._consensus_performance_records.append(record)
        path = assert_write_allowed(DIAGNOSTICS_ROOT / "consensus_worker_performance.json")
        payload = {
            "run_id": self.run_id,
            "consensus_worker_count": self.consensus_worker_count,
            "records": self._consensus_performance_records,
        }
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    def _run_consensus_job(self, scope_pairs: set[tuple[str, int]], source_label: str) -> dict[str, Any]:
        pairs = sorted([f"{stream}:{race}" for stream, race in scope_pairs])
        started = time.time()
        result = self._run_consensus_direct(scope_pairs)
        finished = time.time()
        return {
            "result": result,
            "pairs": pairs,
            "started_at": started,
            "finished_at": finished,
            "duration_seconds": round(finished - started, 3),
            "events": getattr(result, "events", []),
            "worker_thread": threading.current_thread().name,
            "worker_status": "completed" if getattr(result, "returncode", 1) == 0 else "failed",
        }

    def _run_consensus_direct(self, scope_pairs: set[tuple[str, int]]) -> Any:
        try:
            return run_consensus_from_selected_direct(scope_pairs, self._get_consensus_extractor())
        except Exception as exc:
            return SimpleNamespace(returncode=1, stdout="", stderr=f"{type(exc).__name__}: {exc}", events=[])

    def _get_consensus_extractor(self) -> Any:
        if self._consensus_extractor is None:
            from live_processor.baseline_row_ocr import BaselineRowOcrExtractor

            self._consensus_extractor = BaselineRowOcrExtractor()
        return self._consensus_extractor

    def _run_incremental_exact_live_worker(self) -> None:
        templates = load_initial_scan_templates()
        states: list[IncrementalSourceState] = []
        for index, source in enumerate(self.sources):
            is_capture = bool(getattr(source, "is_capture_card", False))
            buffer = self.analysis_buffers.get(source.source_id)
            prepared = self.prepared_contexts.get(source.source_id)
            if is_capture:
                # Live capture-card analysis: bootstrap the context from buffered
                # live frames (no file exists), then run the exact incremental
                # pipeline in strict buffer-only mode. Requires the analysis
                # window buffer (docs/real_capture_plan.md Phase 1).
                if buffer is None:
                    self.event_bus.emit(
                        "SOURCE_FAILED",
                        source_id=source.source_id,
                        stream_label=source.stream_label,
                        message=(
                            "live analysis needs the analysis window buffer "
                            "(analysis_window_buffer_enabled) — capture feed runs preview/recording only"
                        ),
                    )
                    continue
                prepared = prepare_live_capture_context(source, buffer, index + 1, len(self.sources))
                self.event_bus.emit(
                    "ANALYSIS_PROGRESS",
                    source_id=source.source_id,
                    stream_label=source.stream_label,
                    message=f"live capture context ready for {source.stream_label} (buffer-only analysis)",
                    data=safe_context(prepared),
                )
            state = IncrementalSourceState.from_source(
                source,
                len(self.sources),
                index + 1,
                templates,
                prepared_context=prepared,
                analysis_buffer=buffer,
            )
            state.buffer_only = is_capture or self.force_buffer_only
            state.context[GAME_LOCALE_KEY] = self.game_locales.get(source.source_id, "auto")
            track_names.set_stream_locale(source.source_id, state.context[GAME_LOCALE_KEY])
            self._source_contexts[source.source_id] = state.context
            states.append(state)
        if not states:
            return
        # Each stream dispatches its fast provisional result inline (the instant its
        # RaceScore is selected) via this sink, so it isn't blocked behind the other
        # streams' selections in the loop below.
        parallel = bool(getattr(self.config, "parallel_stream_selection", True)) and len(states) > 1
        for state in states:
            state.provisional_sink = self._submit_provisional_frame
            state.gate_seconds = float(getattr(self.config, "result_selection_gate_seconds", 15.0))
            state.race_probe_min_seconds = float(getattr(self.config, "race_probe_min_seconds", 1.5))
            state.min_race_gap_seconds = float(getattr(self.config, "min_race_gap_seconds", 90.0))
        emitted_scoreboards: set[tuple[str, int]] = set()
        last_report_write = 0.0
        inflight: dict[Future[dict[str, Any]], tuple[str, int]] = {}
        scan_inflight: dict[int, Future[None]] = {}
        while any(not state.done for state in states):
            if parallel:
                # Non-barrier: re-submit each stream's scan+selection as soon as ITS
                # OWN previous one finishes — a fast stream never waits on a slow
                # stream's ~12-14s selection, and gate checks stay prompt (so the
                # rolling buffer still covers the window). State reads in this loop
                # snapshot with list()/set() since stream threads append concurrently.
                for state in states:
                    sid = id(state)
                    if not state.done and sid not in scan_inflight:
                        scan_inflight[sid] = self._scan_executor.submit(self._scan_and_select, state)
                for sid, fut in list(scan_inflight.items()):
                    if fut.done():
                        fut.result()  # surface any exception
                        del scan_inflight[sid]
            else:
                for state in states:
                    self._scan_and_select(state)
            now = time.perf_counter()
            self._collect_finished_consensus_jobs(inflight, emitted_scoreboards, "incremental")
            if now - last_report_write > 2.0:
                self._write_incremental_selection_reports(states)
                ready_pairs = _complete_pair_keys_from_incremental_states(states) - emitted_scoreboards - set(inflight.values()) - self._retired_consensus_pairs
                if len(inflight) < self.consensus_worker_count and ready_pairs:
                    self._submit_ready_consensus_jobs(ready_pairs, inflight, "incremental")
                last_report_write = now
            time.sleep(0.1)
        # Drain any still-running scan tasks before returning. The loop exits the
        # moment every stream is `done`, but the last `_scan_and_select` futures may
        # still be running; if one dispatches a provisional after the executors are
        # torn down it raises "cannot schedule new futures after shutdown". Waiting
        # here means no scan task outlives the worker.
        for fut in list(scan_inflight.values()):
            fut.result()
        scan_inflight.clear()
        self._write_incremental_selection_reports(states)
        self._drain_consensus_jobs(inflight, emitted_scoreboards, "incremental final")
        while True:
            remaining_pairs = _complete_pair_keys_from_incremental_states(states) - emitted_scoreboards - set(inflight.values()) - self._retired_consensus_pairs
            if not remaining_pairs and not inflight:
                break
            self._submit_ready_consensus_jobs(remaining_pairs, inflight, "incremental final")
            self._drain_consensus_jobs(inflight, emitted_scoreboards, "incremental final")

    def _write_incremental_selection_reports(self, states: list["IncrementalSourceState"]) -> None:
        selections = [state.to_selection() for state in states]
        write_exact_selection_reports(selections)

    def _run_consensus_and_emit_new_updates(self, states: list["IncrementalSourceState"], emitted_scoreboards: set[tuple[str, int]]) -> None:
        if not any(state.has_complete_pair for state in states):
            return
        for pair in sorted(_complete_pair_keys_from_incremental_states(states) - emitted_scoreboards):
            job = self._run_consensus_job({pair}, "incremental")
            self._emit_consensus_result(job["result"], emitted_scoreboards, "incremental", job)

    def _write_source_manifest(self) -> Path:
        payload = {
            "run_id": self.run_id,
            "sources": [
                {
                    "source_id": source.source_id,
                    "display_label": source.display_label,
                    "stream_label": source.stream_label,
                    "video_path": str(source.video_path),
                }
                for source in self.sources
            ],
        }
        path = assert_write_allowed(DIAGNOSTICS_ROOT / "gui_virtual_capture_source_manifest.json")
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        return path

    def _load_exact_reports_as_events(self) -> list[ScheduledGuiEvent]:
        detailed_path = DIAGNOSTICS_ROOT / "pass_7_detailed_consensus_race_report.json"
        summary_path = DIAGNOSTICS_ROOT / "pass_7_consensus_summary.json"
        track_path = DIAGNOSTICS_ROOT / "track_name_ocr_report.json"
        if summary_path.exists():
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.export_paths = {str(key): str(value) for key, value in (summary.get("export_paths") or {}).items()}
        if not detailed_path.exists():
            return []
        races = json.loads(detailed_path.read_text(encoding="utf-8"))
        track_lookup: dict[tuple[str, int], dict[str, Any]] = {}
        if track_path.exists():
            for track in json.loads(track_path.read_text(encoding="utf-8")):
                stream = str(track.get("stream_id", ""))
                sequence = int(track.get("race_sequence") or 0)
                track_lookup[(stream, sequence)] = track
        source_lookup = {source.stream_label: source.source_id for source in self.sources}
        fps_lookup = {source.stream_label: source.fps for source in self.sources}
        events = build_scheduled_gui_events(races, track_lookup, source_lookup, fps_lookup)
        return events

    def _dispatch_scheduled_events(self, events: list[ScheduledGuiEvent]) -> None:
        sources_by_label = {source.stream_label: source for source in self.sources}
        for event in sorted(events, key=lambda item: (item.timestamp, item.stream_label, item.race_sequence or 0, item.event_type)):
            source = sources_by_label.get(event.stream_label)
            if source is not None:
                while source.state not in {"ended", "failed", "stopped"} and source.current_timestamp + 0.25 < event.timestamp:
                    time.sleep(0.05)
            self.event_bus.emit(
                event.event_type,
                source_id=event.source_id,
                stream_label=event.stream_label,
                timestamp=event.timestamp,
                frame_index=event.frame_index,
                race_sequence=event.race_sequence,
                message=event.message,
                data=event.data or {},
            )
            if event.event_type == "SCOREBOARD_UPDATED":
                self._scoreboard_events_emitted += 1
                self._update_live_workbook_from_scoreboard(event)


def save_context_frames_from_capture(
    capture: Any,
    start_frame: int,
    end_frame: int,
    stream_label: str,
    race_sequence: int,
    screen_type: str,
) -> str:
    """Persist consensus context frames from a buffered capture snapshot.

    File sources re-read these ranges from the video at consensus time
    (``load_race_score_context_frames`` / ``load_video_context_frames``); a live
    capture feed has no file, so the frames must be saved while the rolling
    buffer still holds them. Returns the directory (or "" when nothing could
    be read) — recorded on the selection row for the consensus bundle writer.
    """
    import cv2  # noqa: WPS433 - local import mirrors the module's late imports

    from .run_context import current_run_id  # noqa: WPS433

    # RUN-SCOPED path: stream/race names repeat across sessions, and the
    # consensus loader reads every frame in the directory — an unscoped dir
    # accumulated frames from ABORTED/EARLIER runs and mixed different
    # sessions' screens into one race's OCR consensus (poisoned totals).
    run_scope = "".join(
        ch if ch.isalnum() or ch in "-_" else "_" for ch in (current_run_id() or "unscoped")
    )
    safe_stream = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in stream_label)
    dest = DIAGNOSTICS_ROOT / "frame_debug" / "live_capture_context_frames" / run_scope / (
        f"{safe_stream}_race_{int(race_sequence):03d}_{screen_type}"
    )
    if dest.exists():
        # Same run re-selecting this race: replace, never merge.
        for stale in dest.glob("F*.jpg"):
            stale.unlink(missing_ok=True)
    written = 0
    for frame_index in range(max(0, int(start_frame)), int(end_frame) + 1):
        capture.set(1, int(frame_index))  # CAP_PROP_POS_FRAMES
        ok, frame = capture.read()
        if not ok or frame is None:
            continue
        if written == 0:
            dest.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(assert_write_allowed(dest / f"F{int(frame_index)}.jpg")), frame)
        written += 1
    return str(dest) if written else ""


def context_frame_range_for(result: dict[str, Any], screen_type: str, selected_frame: int) -> tuple[int, int]:
    """The consensus context range for a selected frame — mirrors the priority
    order of the consensus script's file loaders so live-saved frames cover the
    same window the file path would re-read."""
    if screen_type == "race_score":
        start = optional_int(result.get("points_context_start_frame"))
        end = optional_int(result.get("points_context_end_frame"))
        if start is not None and end is not None and end >= start:
            return int(start), int(end)
        anchor = optional_int(result.get("actual_points_anchor_frame")) or optional_int(
            result.get("selected_points_anchor_frame")
        )
        if anchor is not None and anchor > 0:
            return int(anchor) - 3, int(anchor) + 3
        start = optional_int(result.get("race_context_start_frame"))
        end = optional_int(result.get("race_context_end_frame"))
        if start is not None and end is not None and end >= start:
            return int(start), int(end)
    return int(selected_frame) - 2, int(selected_frame) + 2


def frame_to_timestamp(frame_index: int | float | None, fps: float | None) -> float:
    if frame_index in (None, ""):
        return 0.0
    try:
        frame = float(frame_index)
    except (TypeError, ValueError):
        return 0.0
    rate = float(fps or 0.0)
    if rate <= 0:
        rate = 30.0
    return frame / rate


def entry_timestamp(entry: dict[str, Any], fps: float | None, frame_key: str = "frame_index") -> float:
    value = entry.get("timestamp")
    if value not in (None, ""):
        try:
            return float(value)
        except (TypeError, ValueError):
            pass
    return frame_to_timestamp(entry.get(frame_key), fps)


def _complete_pair_keys_from_incremental_states(states: list["IncrementalSourceState"]) -> set[tuple[str, int]]:
    complete: set[tuple[str, int]] = set()
    for state in states:
        frames = list(state.selected_frames)  # snapshot vs concurrent appends
        race_sequences = {frame.race_sequence for frame in frames}
        for race_sequence in race_sequences:
            screen_types = {
                frame.screen_type
                for frame in frames
                if frame.race_sequence == race_sequence
            }
            if {"race_score", "total_score"} <= screen_types:
                complete.add((state.source.stream_label, int(race_sequence)))
    return complete


def build_scheduled_gui_events(
    races: list[dict[str, Any]],
    track_lookup: dict[tuple[str, int], dict[str, Any]],
    source_lookup: dict[str, str],
    fps_lookup: dict[str, float],
) -> list[ScheduledGuiEvent]:
    events: list[ScheduledGuiEvent] = []
    for race in races:
        stream_label = str(race.get("stream_id", ""))
        source_id = source_lookup.get(stream_label, stream_label)
        fps = fps_lookup.get(stream_label, 30.0)
        race_entry = race.get("race_entry") or {}
        total_entry = race.get("total_entry") or {}
        race_sequence = int(race.get("race_sequence") or 0)
        track = track_lookup.get((stream_label, race_sequence))
        if track:
            track_name = str(track.get("track_name") or track.get("raw_track_text") or "")
            cup_name = str(track.get("cup_name") or "")
            label = track_name if not cup_name else f"{track_name} ({cup_name})"
            track_frame = int(track.get("track_frame_index") or 0)
            events.append(
                ScheduledGuiEvent(
                    "TRACK_NAME_DETECTED",
                    source_id=source_id,
                    stream_label=stream_label,
                    timestamp=frame_to_timestamp(track_frame, fps),
                    frame_index=track_frame,
                    race_sequence=race_sequence,
                    message=label,
                    data=track,
                )
            )
        anchor_frame = int(race_entry.get("source_candidate_frame") or race_entry.get("frame_index") or 0)
        events.append(
            ScheduledGuiEvent(
                "RACE_ANCHOR_DETECTED",
                source_id=source_id,
                stream_label=stream_label,
                timestamp=frame_to_timestamp(anchor_frame, fps),
                frame_index=anchor_frame,
                race_sequence=race_sequence,
                message=f"race {race_sequence} anchor detected",
            )
        )
        race_score_time = entry_timestamp(race_entry, fps)
        race_score_frame = int(race_entry.get("frame_index") or 0)
        total_score_time = entry_timestamp(total_entry, fps)
        total_score_frame = int(total_entry.get("frame_index") or 0)
        events.append(
            ScheduledGuiEvent(
                "RESULT_SEARCH_STARTED",
                source_id=source_id,
                stream_label=stream_label,
                timestamp=race_score_time,
                frame_index=race_score_frame,
                race_sequence=race_sequence,
                message=f"race {race_sequence} result search started",
            )
        )
        events.append(ScheduledGuiEvent("RACE_SCORE_SELECTED", source_id, stream_label, race_score_time, race_score_frame, race_sequence, data=race_entry))
        events.append(ScheduledGuiEvent("TOTAL_SCORE_SELECTED", source_id, stream_label, total_score_time, total_score_frame, race_sequence, data=total_entry))
        consensus = race.get("consensus") or {}
        scoreboard_rows = consensus.get("scoreboard_rows") or []
        events.append(
            ScheduledGuiEvent(
                "CONSENSUS_VALIDATED",
                source_id,
                stream_label,
                total_score_time,
                total_score_frame,
                race_sequence,
                f"race {race_sequence} consensus rows validated: {len(scoreboard_rows)}",
                {"rows_validated": len(scoreboard_rows)},
            )
        )
        events.append(
            ScheduledGuiEvent(
                "SCOREBOARD_UPDATED",
                source_id,
                stream_label,
                total_score_time,
                total_score_frame,
                race_sequence,
                f"race {race_sequence} scoreboard updated",
                {"rows": scoreboard_rows, "tournament_rows": race.get("tournament_rows") or []},
            )
        )
    return events


@dataclass
class IncrementalSourceState:
    source: LocalVideoVirtualCaptureSource
    source_config: VirtualSourceConfig
    context: dict[str, Any]
    templates: list[tuple[Any, Any]]
    video_index: int
    total_videos: int
    last_scan_end: int
    score_detections: list[dict[str, Any]]
    track_detections: list[dict[str, Any]]
    selection_results: list[dict[str, Any]]
    selected_frames: list[ExactSelectionFrame]
    processed_score_frames: set[int]
    processed_track_frames: set[int]
    expected_players: int | None = None
    analysis_buffer: AnalysisWindowBuffer | None = None
    # Live capture-card contract: there is no file to fall back to. Detection
    # clamps to what the rolling buffer holds, selection/crops read exclusively
    # through buffered captures, and anything that aged out degrades with an
    # event instead of reaching for video_path (which is a synthetic label).
    buffer_only: bool = False
    # Called inline the instant a RaceScore frame is selected, so the fast
    # provisional OCR is dispatched immediately instead of waiting for the rest
    # of the per-stream loop (other streams' ~12s selections) to finish.
    provisional_sink: Any | None = None
    # Live latency levers (set from LiveConfig by the worker).
    # gate_seconds is a SAFETY CEILING only (the confirmed selection is event-
    # triggered on the TotalScore settle; see process_ready_score_candidates).
    gate_seconds: float = 15.0
    race_probe_min_seconds: float = 1.5
    # Refractory window for score-anchor dedup. Each race is one fixed cycle
    # (track name -> round -> race score -> total score), so two real race-score
    # screens are always a full cycle (~200s observed) apart, while a re-detection
    # of the SAME score screen across a scan-chunk boundary lands ~4s later. A
    # refractory of min_race_gap_seconds after an accepted anchor suppresses the
    # re-detection without ever merging two real races (the prior 45-frame
    # tolerance, ~1.5s, was far too small to catch the ~123-frame re-detection).
    min_race_gap_seconds: float = 90.0
    # Live-native fast finishing order: races whose provisional has fired, and the
    # last `current` we probed at (to re-probe at intervals until the roll-up shows).
    race_provisional_done: set[int] = field(default_factory=set)
    race_probe_state: dict[int, int] = field(default_factory=dict)
    # Settle-trigger state: the points-transition (roll-up) frame reported by the
    # selector per anchor, and whether the 20-frame stable TotalScore run has been
    # detected. The confirmed selection fires when the stable run is found (or the
    # whole transition+settle window is buffered), instead of on a fixed wait.
    race_transition_frame: dict[int, int] = field(default_factory=dict)
    race_total_settled: set[int] = field(default_factory=set)
    # Persistent streaming detection scanner (lazy-built on first scan); replaces the
    # per-chunk batch scan so detection runs as one continuous coarse pass.
    streaming_scanner: Any | None = None
    # Race-number screen detections (the "Race N/12" countdown). The original saves these
    # as Race_NNN/1RaceNumber.jpg; mirror that here so the live Frames bundle is complete.
    race_detections: list[dict[str, Any]] = field(default_factory=list)
    processed_race_frames: set[int] = field(default_factory=set)
    # True once the source has ended AND the streaming scan has consumed every
    # remaining frame. `done` must wait for this: a state whose found-so-far
    # candidates are all processed looks finished while its scan future is
    # still minutes deep in a long dead section (e.g. connection-reset
    # downtime) — the worker loop would exit and the late-found races would
    # never be selected (lost Groep3 races 6-8 exactly this way).
    scan_complete: bool = False
    # Cup end screen (Clean Assets 065, mk8dx_tournament_extraction.cup_final): the next buffered frame to sample,
    # the first/last frame it was seen, and the race whose bundle already holds this cup's frame.
    cup_final_next_frame: int = 0
    cup_final_first_frame: int | None = None
    cup_final_last_frame: int | None = None
    cup_final_saved_race: int = 0

    @classmethod
    def from_source(
        cls,
        source: LocalVideoVirtualCaptureSource,
        total_videos: int,
        video_index: int,
        templates: list[tuple[Any, Any]],
        prepared_context: dict[str, Any] | None = None,
        analysis_buffer: AnalysisWindowBuffer | None = None,
    ) -> "IncrementalSourceState":
        while source.fps <= 0 and source.state not in {"failed", "stopped"}:
            time.sleep(0.05)
        context = prepared_context or prepare_gui_video_context(source.video_path, source.stream_label, video_index, total_videos, templates)
        if context is None:
            raise RuntimeError(f"Could not prepare exact-method context for {source.video_path}")
        return cls(
            source=source,
            source_config=VirtualSourceConfig(source.source_id, source.display_label, source.stream_label, source.video_path),
            context=context,
            templates=templates,
            video_index=video_index,
            total_videos=total_videos,
            last_scan_end=int(context["usable_start_frame"]),
            score_detections=[],
            track_detections=[],
            selection_results=[],
            selected_frames=[],
            processed_score_frames=set(),
            processed_track_frames=set(),
            expected_players=None,
            analysis_buffer=analysis_buffer,
        )

    @property
    def done(self) -> bool:
        if self.source.state not in {"ended", "failed", "stopped"}:
            return False
        if not self.scan_complete:
            return False  # the streaming scan hasn't consumed the tail yet
        # Snapshot: the stream's own worker thread may be appending concurrently.
        processed = set(self.processed_score_frames)
        return all(int(item.get("frame_number") or 0) in processed for item in list(self.score_detections))

    @property
    def has_complete_pair(self) -> bool:
        frames = list(self.selected_frames)  # snapshot vs concurrent appends
        race_sequences = {frame.race_sequence for frame in frames}
        for race_sequence in race_sequences:
            types = {frame.screen_type for frame in frames if frame.race_sequence == race_sequence}
            if {"race_score", "total_score"} <= types:
                return True
        return False

    def _check_cup_final(self, event_bus: GuiEventBus) -> None:
        """Keep one frame of the cup end screen in the last race's bundle (Race_NNN/4CupFinal), sampled from the
        rolling buffer every 0.5 s after that race's TotalScore: SETTLE_SECONDS after it appears (the standings list
        slides in after the red frame) or DROP_BACKOFF_SECONDS before it leaves, as the post-analysis tool does."""
        from mk8dx_tournament_extraction.cup_final import (  # noqa: WPS433
            DROP_BACKOFF_SECONDS, FRAME_CONTENT, SETTLE_SECONDS, detect_cup_final,
        )

        if self.analysis_buffer is None:
            return
        totals = [frame for frame in list(getattr(self, "selected_frames", ())) if frame.screen_type == "total_score"]
        if not totals:
            return
        last_total = max(totals, key=lambda frame: frame.frame_index)
        race_sequence = int(last_total.race_sequence)
        if race_sequence <= self.cup_final_saved_race:
            return
        buffered = self.analysis_buffer.buffered_range()
        if buffered is None:
            return
        fps = float(self.context.get("fps") or 30.0)
        step = max(1, int(round(0.5 * fps)))
        settle = int(round(SETTLE_SECONDS * fps))
        backoff = int(round(DROP_BACKOFF_SECONDS * fps))
        index = max(self.cup_final_next_frame, int(last_total.frame_index), int(buffered[0]))
        target = None
        while index <= int(buffered[1]) and target is None:
            frame = self._buffered_frame(index, fps)
            if frame is not None and detect_cup_final(frame).present:
                if self.cup_final_first_frame is None:
                    self.cup_final_first_frame = index
                self.cup_final_last_frame = index
                if index - self.cup_final_first_frame >= settle:
                    target = index
            elif frame is not None and self.cup_final_first_frame is not None:
                target = max(self.cup_final_first_frame, min(int(self.cup_final_last_frame or index), index - backoff))
            index += step
        self.cup_final_next_frame = index
        if target is None:
            return
        frame = self._buffered_frame(target, fps)
        self.cup_final_first_frame = self.cup_final_last_frame = None
        if frame is None:
            return
        from mk8dx_tournament_extraction.engine.extract_common import build_video_identity  # noqa: WPS433
        from .live_frame_bundles import LiveFrameBundleWriter  # noqa: WPS433

        path = LiveFrameBundleWriter().write_anchor(
            frame=frame,
            video_label=build_video_identity(Path(self.source.video_path)),
            stream_id=self.source.stream_label,
            race_number=race_sequence,
            frame_content=FRAME_CONTENT,
            frame_index=target,
            timestamp=target / fps,
            source_rule="incremental_cup_final_settled",
        )
        self.cup_final_saved_race = race_sequence
        event_bus.emit(
            "CUP_FINAL_FRAME_RETAINED",
            source_id=self.source.source_id,
            stream_label=self.source.stream_label,
            timestamp=target / fps,
            frame_index=target,
            race_sequence=race_sequence,
            message=f"cup end screen saved with race {race_sequence}",
            data={"path": str(path)},
        )

    def _buffered_frame(self, index: int, fps: float) -> Any | None:
        import cv2  # noqa: WPS433 - local import mirrors the module's late imports

        capture = self.analysis_buffer.build_capture(index, index, fps)
        try:
            capture.set(cv2.CAP_PROP_POS_FRAMES, index)
            ok, frame = capture.read()
            return frame if ok else None
        finally:
            capture.release()

    def scan_available_frames(self, event_bus: GuiEventBus) -> None:
        self._check_cup_final(event_bus)
        current = int(self.source.current_frame_index or 0)
        readable_end = int(self.context.get("readable_end_frame") or current)
        # Live-faithful: only scan frames that actually arrived (were decoded).
        # On end we scan up to the last decoded frame, NOT readable_end — otherwise
        # a stream that stops early (e.g. a clipped/windowed feed, or a real capture
        # that ends) would bulk-scan the rest of the FILE and "detect" races that
        # were never streamed. In a full run current reaches readable_end anyway.
        scan_end = min(current, readable_end)
        fps = float(self.context.get("fps") or 30.0)
        ended = self.source.state in {"ended", "stopped", "failed"}
        # Streaming detection: one persistent coarse scan whose state + position
        # survive across ticks (no fixed scan chunk). It reads through the rolling
        # analysis buffer (already-decoded frames) instead of opening a SECOND video
        # decoder per stream — the second decoder made the live feed fall behind
        # real time. Equivalent by construction to a continuous scan over
        # [usable_start, scan_end] (run_streaming_detection_equivalence.py), so
        # detection latency is bounded by the detector's ~3s sampling step, not
        # 0..chunk + sampling, and chunk-boundary dupes vanish.
        if self.streaming_scanner is None:
            self.streaming_scanner = make_streaming_detection_scanner(
                self.context, self.templates, scan_start=int(self.last_scan_end),
            )
        fc = int(self.streaming_scanner.frame_count)
        # Stay the detector's coarse step (~3s) + 1s behind the live edge: to take a
        # sample at frame F the loop grabs F+frame_skip(~3s) to skip ahead, and the
        # track-frame read needs F+1s — all must already be in the buffer (a grab
        # past the buffer end would corrupt frame_count). On end the file fallback
        # covers it. This bounds detection latency to ~4s but keeps it consistent.
        margin = int(fps * 3.0) + int(fps * 1.0)
        target_end = scan_end if ended else (scan_end - margin)
        if target_end <= fc:
            if ended:
                self.scan_complete = True  # nothing left to scan after the end
            return
        # Read from the rolling buffer (no extra decode) when it covers the window;
        # the detector's forward read reaches ~target_end+1s, so cover up to scan_end.
        capture = None
        if self.buffer_only:
            # Live capture: the buffer is the ONLY frame source. Clamp the scan to
            # the buffered window; if the scanner fell behind the rolling window
            # (frames evicted), skip the gap — a live feed cannot be re-read.
            if self.analysis_buffer is None:
                if ended:
                    self.scan_complete = True  # no frame source left at all
                return
            buffered = self.analysis_buffer.buffered_range()
            if buffered is None:
                if ended:
                    self.scan_complete = True
                return
            buffer_start, buffer_end = int(buffered[0]), int(buffered[1])
            if fc < buffer_start:
                event_bus.emit(
                    "ANALYSIS_PROGRESS",
                    source_id=self.source.source_id,
                    stream_label=self.source.stream_label,
                    timestamp=self.source.current_timestamp,
                    frame_index=self.source.current_frame_index,
                    message=(
                        f"live detection skipped frames {fc}-{buffer_start - 1} "
                        "(aged out of the rolling buffer)"
                    ),
                    data={"detection_gap": [fc, buffer_start - 1]},
                )
                self.streaming_scanner.close()
                self.streaming_scanner = make_streaming_detection_scanner(
                    self.context, self.templates, scan_start=buffer_start,
                )
                fc = int(self.streaming_scanner.frame_count)
            scan_end = min(scan_end, buffer_end)
            target_end = scan_end if ended else (scan_end - margin)
            if target_end <= fc:
                if ended:
                    self.scan_complete = True  # buffer tail fully scanned
                return
            # Detection owns a snapshot, but new anchor pins are installed only
            # after advance returns. Hold its prefix in the rolling buffer too:
            # otherwise capture can evict it during detection before we can pin it.
            self.analysis_buffer.pin(-1, max(0, fc - int(3 * fps) - 30))
            capture = self.analysis_buffer.build_capture(fc, scan_end, fps)
        elif not ended and self.analysis_buffer is not None and self.analysis_buffer.covers(fc, scan_end):
            capture = self.analysis_buffer.build_capture(fc, scan_end, fps)
        try:
            new_detections = self.streaming_scanner.advance(target_end, capture)
            self.last_scan_end = int(self.streaming_scanner.frame_count)
            for detection in new_detections.get("track_detections", []):
                self._handle_track_detection(detection, event_bus)
            for detection in new_detections.get("score_detections", []):
                self._handle_score_detection(detection, event_bus)
            # Race-number screens last: each belongs to the next score screen.
            for detection in new_detections.get("race_detections", []):
                self._handle_race_number_detection(detection, event_bus)
        finally:
            if capture is not None:
                capture.release()
            if self.buffer_only and self.analysis_buffer is not None:
                self.analysis_buffer.unpin(-1)
        if ended:
            self.streaming_scanner.close()
        event_bus.emit(
            "ANALYSIS_PROGRESS",
            source_id=self.source.source_id,
            stream_label=self.source.stream_label,
            timestamp=self.source.current_timestamp,
            frame_index=self.source.current_frame_index,
            message=f"scanned through frame {self.last_scan_end}",
            data={
                "scan_start": fc,
                "scan_end": self.last_scan_end,
                "buffered_detection": capture is not None,
                "score_detections": len(self.score_detections),
                "track_detections": len(self.track_detections),
            },
        )

    def _handle_track_detection(self, detection: dict[str, Any], event_bus: GuiEventBus) -> None:
        frame_index = int(detection.get("save_frame_number") or detection.get("frame_number") or 0)
        if frame_index <= 0 or self._is_duplicate_frame(frame_index, self.processed_track_frames, tolerance=45):
            return
        race_sequence = len(self.track_detections) + 1
        self.track_detections.append(dict(detection))
        self.processed_track_frames.add(frame_index)
        saved_image = detection.get("saved_image")
        if saved_image is None and self.buffer_only:
            # No detector-saved image and no file to re-read: crop the frame
            # from the rolling buffer (same crop path as the file fallback).
            if self.analysis_buffer is None or not self.analysis_buffer.covers(frame_index, frame_index):
                event_bus.emit(
                    "TRACK_NAME_OCR_FAILED",
                    source_id=self.source.source_id,
                    stream_label=self.source.stream_label,
                    timestamp=frame_index / float(self.context["fps"]),
                    frame_index=frame_index,
                    race_sequence=race_sequence,
                    message=f"track frame {frame_index} aged out of the live buffer",
                )
                return
            frame_capture = self.analysis_buffer.build_capture(frame_index, frame_index, float(self.context["fps"]))
            try:
                crop_path, frame_hash = save_exact_selected_frame_crop(
                    context=self.context,
                    video_path=self.source.video_path,
                    stream_id=self.source.stream_label,
                    group_label=self.source.stream_label,
                    race_sequence=race_sequence,
                    screen_type="track_name",
                    frame_index=frame_index,
                    layout_id="track_name",
                    capture=frame_capture,
                    allow_file_fallback=False,
                )
            finally:
                frame_capture.release()
        else:
            crop_path, frame_hash = save_exact_track_name_frame(
                context=self.context,
                video_path=self.source.video_path,
                stream_id=self.source.stream_label,
                group_label=self.source.stream_label,
                race_sequence=race_sequence,
                frame_index=frame_index,
                saved_image=saved_image,
            )
        selected = ExactSelectionFrame(
            stream_id=self.source.stream_label,
            group_label=self.source.stream_label,
            race_sequence=race_sequence,
            video_path=self.source.video_path,
            screen_type="track_name",
            frame_index=frame_index,
            timestamp=frame_index / float(self.context["fps"]),
            layout_id="track_name",
            crop_path=crop_path,
            frame_hash=frame_hash,
            selection_reason="incremental_exact_scan_detection_segment_track_detection",
            source_candidate_frame=int(detection.get("frame_number") or frame_index),
            confidence=float(detection.get("confidence", 0.0)),
        )
        self.selected_frames.append(selected)
        metadata = try_extract_track_metadata(selected)
        message = metadata.get("track_name") or metadata.get("raw_track_text") or f"track frame detected for race {race_sequence}"
        if metadata.get("cup_name") and metadata.get("track_name"):
            message = f"{metadata['track_name']} ({metadata['cup_name']})"
        event_bus.emit(
            "TRACK_NAME_DETECTED",
            source_id=self.source.source_id,
            stream_label=self.source.stream_label,
            timestamp=selected.timestamp,
            frame_index=frame_index,
            race_sequence=race_sequence,
            message=str(message),
            data=metadata,
        )

    def _handle_race_number_detection(self, detection: dict[str, Any], event_bus: GuiEventBus) -> None:
        """Save the race-number ("Race N/12") screen as Race_NNN/1RaceNumber.jpg, matching
        the original's save_auxiliary_detection_frames. The screen is attached to the race
        of the next score screen (it precedes its own race's score)."""
        from mk8dx_tournament_extraction.engine.extract_common import build_video_identity  # noqa: WPS433
        from mk8dx_tournament_extraction.engine.extract_initial_scan import assign_race_number  # noqa: WPS433
        from .live_frame_bundles import LiveFrameBundleWriter  # noqa: WPS433

        frame_index = int(detection.get("save_frame_number") or detection.get("frame_number") or 0)
        saved_image = detection.get("saved_image")
        if frame_index <= 0 or saved_image is None:
            return
        if self._is_duplicate_frame(frame_index, self.processed_race_frames, tolerance=45):
            return
        self.processed_race_frames.add(frame_index)
        self.race_detections.append(dict(detection))
        score_frames = sorted(int(item.get("frame_number") or 0) for item in list(self.score_detections))
        race_sequence = assign_race_number(int(detection.get("frame_number") or frame_index), score_frames)
        # Write through the live bundle writer so 1RaceNumber.jpg lands under
        # Live_Output/Frames in the same Race_NNN folder as 2RaceScore/3TotalScore
        # (extract_common.FRAMES_ROOT points at Output_Results during a live run). The
        # video-identity label (stem, e.g. "20250103_Groep1") matches the score bundles.
        video_label = build_video_identity(Path(self.source.video_path))
        path = LiveFrameBundleWriter().write_anchor(
            frame=saved_image,
            video_label=video_label,
            stream_id=self.source.stream_label,
            race_number=race_sequence,
            frame_content="1RaceNumber",
            frame_index=frame_index,
            timestamp=frame_index / float(self.context["fps"]),
            source_rule="incremental_exact_scan_race_number_detection",
        )
        event_bus.emit(
            "RACE_NUMBER_DETECTED",
            source_id=self.source.source_id,
            stream_label=self.source.stream_label,
            timestamp=frame_index / float(self.context["fps"]),
            frame_index=frame_index,
            race_sequence=race_sequence,
            message=f"race-number frame saved for race {race_sequence}",
            data={"path": str(path), "confidence": float(detection.get("confidence", 0.0))},
        )

    def _handle_score_detection(self, detection: dict[str, Any], event_bus: GuiEventBus) -> None:
        frame_index = int(detection.get("frame_number") or 0)
        # Reject within the refractory window of an already-accepted anchor: this
        # merges a same-screen re-detection (~4s / ~123 frames later, across a scan
        # chunk boundary) while real races (a full cycle apart) always pass.
        refractory = int(float(self.context.get("fps") or 30.0) * float(self.min_race_gap_seconds))
        existing_anchors = {int(item.get("frame_number") or 0) for item in self.score_detections}
        if frame_index <= 0 or self._is_duplicate_frame(frame_index, existing_anchors, tolerance=refractory):
            return
        candidate = {
            "race_number": len(self.score_detections) + 1,
            "frame_number": frame_index,
            "score_layout_id": detection.get("score_layout_id"),
            "confidence": float(detection.get("confidence", 0.0)),
        }
        self.score_detections.append(candidate)
        # Pin the selector window head against buffer eviction until this
        # anchor's selection completes: with a late points roll-up + the
        # TotalScore settle, the confirmed selection can fire past the steady
        # retention, and a live capture feed cannot re-read evicted frames.
        if self.analysis_buffer is not None:
            fps = float(self.context.get("fps") or 30.0)
            self.analysis_buffer.pin(frame_index, max(0, frame_index - int(3 * fps) - 30))
        event_bus.emit(
            "RACE_ANCHOR_DETECTED",
            source_id=self.source.source_id,
            stream_label=self.source.stream_label,
            timestamp=frame_index / float(self.context["fps"]),
            frame_index=frame_index,
            race_sequence=int(candidate["race_number"]),
            message=f"race {candidate['race_number']} score anchor detected",
            data=candidate,
        )

    def _try_early_race_provisional(self, candidate: dict[str, Any], current_end: int) -> bool:
        """Live-native fast finishing order: run the (now fast) selection over the
        buffer up to current_end. The selector reports whether the points roll-up
        is present; if so, the RaceScore frame is frame-identical to the full gated
        pass -> save its crop + dispatch the provisional, return True. If the roll-up
        isn't in the buffered window yet, return False (retry as more frames stream).
        Display-only: does NOT append to selected_frames / the confirmed bundle."""
        frame_number = int(candidate.get("frame_number") or 0)
        fps = float(self.context["fps"])
        win_start = max(0, int(frame_number - 3 * fps))
        win_end = int(current_end)
        if self.analysis_buffer is None or not self.analysis_buffer.covers(win_start, win_end):
            return False
        cap = self.analysis_buffer.build_capture(win_start, win_end, fps)
        try:
            result = analyze_candidate_exact(
                self.context, self.templates, candidate, expected_players=self.expected_players, capture=cap,
            )
            # Roll-up must be in the buffered window; else the finishing-order frames
            # (and the 12th-row settle) haven't fully arrived yet -> wait.
            if optional_int(result.get("selected_points_anchor_frame")) is None \
                    and optional_int(result.get("actual_points_anchor_frame")) is None:
                return False
            # Record the roll-up (transition) frame + whether the TotalScore stable
            # run is already detected, so the confirmed selection below can fire on
            # the settle instead of a fixed wait.
            trace = result.get("analysis_trace") or {}
            transition = optional_int(trace.get("transition_frame"))
            if transition is None:
                transition = optional_int(result.get("selected_points_anchor_frame")) \
                    or optional_int(result.get("actual_points_anchor_frame"))
            if transition is not None:
                self.race_transition_frame[frame_number] = int(transition)
            if optional_int(trace.get("stable_total_score_frame")) is not None:
                self.race_total_settled.add(frame_number)
            race_frame = selected_actual_frame_index(result, "race_score", "race_score_frame")
            if race_frame <= 0:
                return False
            crop_capture = cap if race_frame in cap.buffered_indices() else None
            if crop_capture is None and self.buffer_only:
                return False  # retry once more frames stream in (no file to read)
            layout_id = str(result.get("score_layout_id") or candidate.get("score_layout_id") or "")
            crop_path, frame_hash = save_exact_selected_frame_crop(
                context=self.context, video_path=self.source.video_path,
                stream_id=self.source.stream_label, group_label=self.source.stream_label,
                race_sequence=int(candidate["race_number"]), screen_type="race_score",
                frame_index=race_frame, layout_id=layout_id, capture=crop_capture,
                allow_file_fallback=not self.buffer_only,
            )
            selected = ExactSelectionFrame(
                stream_id=self.source.stream_label, group_label=self.source.stream_label,
                race_sequence=int(candidate["race_number"]), video_path=self.source.video_path,
                screen_type="race_score", frame_index=race_frame, timestamp=race_frame / fps,
                layout_id=layout_id, crop_path=crop_path, frame_hash=frame_hash,
                selection_reason="incremental_exact_live_rollup_race_provisional",
                source_candidate_frame=frame_number, confidence=float(candidate.get("confidence", 0.0)),
            )
            if self.provisional_sink is not None:
                self.provisional_sink(self.source.source_id, selected)
            return True
        finally:
            cap.release()

    def _is_static_screen_candidate(self, frame_number: int, fps: float) -> bool:
        """True when the buffered window after a score anchor is a frozen image.

        A REAL race screen always animates (the points roll-up, then the exit
        fade), so a candidate that reaches the gate ceiling without any motion
        is a stray static screen — a paused/scrubbed player before playback, a
        pre-tournament leftover scoreboard, or the end-of-video gallery. Uses
        the original's static-gallery similarity test on buffered frames."""
        from mk8dx_tournament_extraction.engine.extract_score_screen_selection import is_static_gallery_race_bundle  # noqa: WPS433

        if self.analysis_buffer is None:
            return False
        window_end = int(frame_number + fps * min(float(self.gate_seconds), 12.0))
        if not self.analysis_buffer.covers(frame_number, window_end):
            return False
        capture = self.analysis_buffer.build_capture(frame_number, window_end, fps)
        try:
            step = max(1, int(fps // 3))
            entries = []
            for index in range(int(frame_number), window_end + 1, step):
                capture.set(1, index)
                ok, frame = capture.read()
                if ok and frame is not None:
                    entries.append((index, frame))
            if len(entries) < 3:
                return False
            is_static, _similarity = is_static_gallery_race_bundle(entries)
            return bool(is_static)
        finally:
            capture.release()

    def _skip_static_candidate(self, candidate: dict[str, Any], event_bus: GuiEventBus) -> None:
        """Drop a frozen-screen candidate and renumber later candidates so race
        numbers stay aligned with the real races (a stray screen before race 1
        would otherwise shift every subsequent race by one)."""
        frame_number = int(candidate.get("frame_number") or 0)
        race_number = int(candidate.get("race_number") or 0)
        if candidate in self.score_detections:
            self.score_detections.remove(candidate)
        for other in self.score_detections:
            if int(other.get("frame_number") or 0) > frame_number:
                other["race_number"] = int(other.get("race_number") or 0) - 1
        self.processed_score_frames.add(frame_number)
        if self.analysis_buffer is not None:
            self.analysis_buffer.unpin(frame_number)
        event_bus.emit(
            "RACE_CANDIDATE_SKIPPED_STATIC",
            source_id=self.source.source_id,
            stream_label=self.source.stream_label,
            timestamp=frame_number / float(self.context.get("fps") or 30.0),
            frame_index=frame_number,
            race_sequence=race_number,
            message=(
                f"static screen at frame {frame_number} skipped (no points roll-up, no motion); "
                "later races renumbered"
            ),
        )

    def process_ready_score_candidates(self, event_bus: GuiEventBus, max_candidates: int | None = None) -> None:
        ended = self.source.state in {"ended", "stopped", "failed"}
        current = int(self.source.current_frame_index or 0)
        if ended:
            current = min(int(self.context.get("readable_end_frame") or current), max(current, int(self.source.current_frame_index or 0)))
        processed = 0
        for candidate in list(self.score_detections):
            if max_candidates is not None and processed >= max(1, int(max_candidates)):
                break
            frame_number = int(candidate.get("frame_number") or 0)
            fps = float(self.context["fps"])
            # Live-native fast finishing order: once a little buffer exists past the
            # anchor, probe the (fast) selection — it fires only when the selector
            # reports the points roll-up is present (adapts to the real animation
            # moment, retries otherwise), so the provisional shows well before the
            # TotalScore gate below. Frame-identical: same selection, just earlier.
            if (
                frame_number not in self.race_provisional_done
                and frame_number not in self.processed_score_frames
                and (ended or current >= frame_number + int(fps * self.race_probe_min_seconds))
                and current - self.race_probe_state.get(frame_number, -(10 ** 9)) >= int(fps)
            ):
                self.race_probe_state[frame_number] = current
                if self._try_early_race_provisional(candidate, current):
                    self.race_provisional_done.add(frame_number)
            if frame_number in self.processed_score_frames:
                continue
            # No fixed wait ("gate"): fire the confirmed selection the moment the
            # TotalScore has SETTLED. The selector's stable-run search is bounded to
            # [transition, transition+TOTAL_SCORE_SETTLE_SECONDS] (the points roll-up
            # AND any TotalScore re-ordering animation finish inside that window), so
            # once the live buffer covers it the selected frames are frame-identical
            # to a full pass. Trigger when the 20-frame stable run is detected, or once
            # the whole settle window is buffered (covers the rare no-settle fallback).
            # `ended`: source done, no more frames -> process whatever we have so a
            # late/spurious anchor can't hang the worker. gate_seconds now acts ONLY
            # as a safety ceiling for the rare case where the roll-up is never found.
            if not ended:
                transition = self.race_transition_frame.get(frame_number)
                if transition is None:
                    if current < frame_number + int(fps * float(self.gate_seconds)):
                        continue
                    # Gate ceiling reached without any roll-up: a real race always
                    # animates, so a frozen window is a stray screen (paused or
                    # scrubbed player, pre-tournament leftover, gallery) — skip it
                    # instead of forcing a selection that contaminates the totals.
                    if self._is_static_screen_candidate(frame_number, fps):
                        self._skip_static_candidate(candidate, event_bus)
                        processed += 1
                        continue
                else:
                    settle_frames = int(round(
                        (TOTAL_SCORE_SETTLE_SECONDS + TOTAL_SCORE_SETTLE_MARGIN_SECONDS) * fps
                    ))
                    if frame_number not in self.race_total_settled \
                            and current < int(transition) + settle_frames:
                        continue
            # Live-faithful selection: read the selector window from the rolling
            # buffer of already-received frames, not the file. We fire on the settle
            # trigger above, so `current` already covers the selector's read window
            # (race frame + 12th-row refinement <= cap_source, TotalScore stable run
            # <= transition+settle, all <= current); read [anchor-3s, current] from the
            # buffer. Fall back to the file only if the buffer doesn't fully cover it
            # (e.g. source ended long ago) — proven frame-identical, see
            # _archive/cleanup_2026-07-06/scripts/run_buffer_selection_equivalence.py.
            fps = float(self.context["fps"])
            win_start = max(0, int(frame_number - 3 * fps))
            win_end = int(current)
            buffered_capture = None
            if self.analysis_buffer is not None and self.analysis_buffer.covers(win_start, win_end):
                buffered_capture = self.analysis_buffer.build_capture(win_start, win_end, fps)
            if self.buffer_only and buffered_capture is None:
                # Live capture: no file to fall back to. If the window head aged
                # out of the rolling buffer the race is unrecoverable — surface it
                # and move on; otherwise retry next tick (transient near-edge gap).
                buffered = self.analysis_buffer.buffered_range() if self.analysis_buffer is not None else None
                if buffered is not None and win_start >= int(buffered[0]):
                    continue
                event_bus.emit(
                    "RESULT_SELECTION_MISSED",
                    source_id=self.source.source_id,
                    stream_label=self.source.stream_label,
                    timestamp=frame_number / fps,
                    frame_index=frame_number,
                    race_sequence=int(candidate["race_number"]),
                    message=(
                        f"race {candidate['race_number']} selection window "
                        f"[{win_start}, {win_end}] aged out of the live buffer"
                    ),
                    data={"selector_window": [win_start, win_end], "buffered_range": list(buffered or ())},
                )
                self.processed_score_frames.add(frame_number)
                if self.analysis_buffer is not None:
                    self.analysis_buffer.unpin(frame_number)
                processed += 1
                continue
            buffer_used = buffered_capture is not None
            event_bus.emit(
                "RESULT_SEARCH_STARTED",
                source_id=self.source.source_id,
                stream_label=self.source.stream_label,
                timestamp=frame_number / float(self.context["fps"]),
                frame_index=frame_number,
                race_sequence=int(candidate["race_number"]),
                message=f"race {candidate['race_number']} exact result-frame selection started",
                data={"buffered_selection": buffer_used, "selector_window": [win_start, win_end]},
            )
            result = analyze_candidate_exact(
                self.context, self.templates, candidate,
                expected_players=self.expected_players, capture=buffered_capture,
            )
            total_visible_players = optional_int(result.get("total_score_visible_players"))
            if total_visible_players is not None:
                self.expected_players = max(int(self.expected_players or 0), int(total_visible_players))
            self.selection_results.append(result)
            self.processed_score_frames.add(frame_number)
            if self.analysis_buffer is not None:
                self.analysis_buffer.unpin(frame_number)
            for screen_type, key in [("race_score", "race_score_frame"), ("total_score", "total_score_frame")]:
                selected_frame = selected_actual_frame_index(result, screen_type, key)
                if selected_frame <= 0:
                    continue
                # Save the crop from the same buffer snapshot if it holds this
                # frame; otherwise let the saver read the file (fallback). In
                # buffer-only mode the buffer snapshot is the only source — a
                # frame that aged out degrades this screen_type with an event.
                crop_capture = (
                    buffered_capture
                    if buffered_capture is not None and selected_frame in buffered_capture.buffered_indices()
                    else None
                )
                try:
                    crop_path, frame_hash = save_exact_selected_frame_crop(
                        context=self.context,
                        video_path=self.source.video_path,
                        stream_id=self.source.stream_label,
                        group_label=self.source.stream_label,
                        race_sequence=int(candidate["race_number"]),
                        screen_type=screen_type,
                        frame_index=selected_frame,
                        layout_id=str(result.get("score_layout_id") or candidate.get("score_layout_id") or ""),
                        capture=crop_capture,
                        allow_file_fallback=not self.buffer_only,
                    )
                except RuntimeError as exc:
                    if not self.buffer_only:
                        raise
                    event_bus.emit(
                        "RESULT_SELECTION_MISSED",
                        source_id=self.source.source_id,
                        stream_label=self.source.stream_label,
                        timestamp=selected_frame / float(self.context["fps"]),
                        frame_index=selected_frame,
                        race_sequence=int(candidate["race_number"]),
                        message=f"race {candidate['race_number']} {screen_type} crop unavailable from live buffer: {exc}",
                    )
                    continue
                # Live capture: persist the consensus context frames now, while
                # the buffer snapshot still holds them — the consensus bundle
                # writer cannot re-read a device like it re-reads a file. This
                # feeds the multi-frame OCR consensus AND the static-gallery
                # filter (which needs >= 2 frames to recognise a frozen screen).
                context_dir = ""
                if self.buffer_only and buffered_capture is not None:
                    ctx_start, ctx_end = context_frame_range_for(result, screen_type, selected_frame)
                    context_dir = save_context_frames_from_capture(
                        buffered_capture,
                        ctx_start,
                        ctx_end,
                        self.source.stream_label,
                        int(candidate["race_number"]),
                        screen_type,
                    )
                selected = ExactSelectionFrame(
                    stream_id=self.source.stream_label,
                    group_label=self.source.stream_label,
                    race_sequence=int(candidate["race_number"]),
                    video_path=self.source.video_path,
                    screen_type=screen_type,
                    frame_index=selected_frame,
                    timestamp=selected_frame / float(self.context["fps"]),
                    layout_id=str(result.get("score_layout_id") or candidate.get("score_layout_id") or ""),
                    crop_path=crop_path,
                    frame_hash=frame_hash,
                    selection_reason="incremental_exact_analyze_score_window_task",
                    source_candidate_frame=frame_number,
                    confidence=float(candidate.get("confidence", 0.0)),
                    context_frames_dir=context_dir,
                )
                self.selected_frames.append(selected)
                event_bus.emit(
                    "RACE_SCORE_SELECTED" if screen_type == "race_score" else "TOTAL_SCORE_SELECTED",
                    source_id=self.source.source_id,
                    stream_label=self.source.stream_label,
                    timestamp=selected.timestamp,
                    frame_index=selected.frame_index,
                    race_sequence=selected.race_sequence,
                    message=f"race {selected.race_sequence} {screen_type} selected",
                    data=result,
                )
                # Dispatch the fast provisional result NOW (parallel executor), so it
                # isn't blocked behind the rest of this loop's per-stream selections.
                if screen_type == "race_score" and self.provisional_sink is not None:
                    self.provisional_sink(self.source.source_id, selected)
            if buffered_capture is not None:
                buffered_capture.release()
            processed += 1

    def to_selection(self) -> ExactVideoSelection:
        return ExactVideoSelection(
            stream_id=self.source.stream_label,
            group_label=self.source.stream_label,
            video_path=self.source.video_path,
            context=safe_context(self.context),
            score_detections=list(self.score_detections),
            track_detections=list(self.track_detections),
            selection_results=list(self.selection_results),
            selected_frames=list(self.selected_frames),
        )

    @staticmethod
    def _is_duplicate_frame(frame_index: int, frames: set[int], tolerance: int) -> bool:
        return any(abs(frame_index - existing) <= tolerance for existing in frames)


def try_extract_track_metadata(frame: ExactSelectionFrame) -> dict[str, Any]:
    try:
        from .consensus_from_selected import extract_track_metadata

        metadata = extract_track_metadata(
            {
                "run_id": "",
                "stream_id": frame.stream_id,
                "race_sequence": frame.race_sequence,
                "crop_path": str(frame.crop_path),
                "ocr_ready_crop_path": str(frame.crop_path),
                "frame_index": frame.frame_index,
                "confidence": frame.confidence,
            }
        )
        return {
            "stream_id": metadata.stream_id,
            "race_sequence": metadata.race_sequence,
            "track_name": metadata.track_name,
            "track_name_nl": metadata.track_name_nl,
            "cup_name": metadata.cup_name,
            "cup_name_nl": metadata.cup_name_nl,
            "track_id": metadata.track_id,
            # cup_id drives the cup icon (/assets/cup/<cup_id>.webp) on the overlay.
            "cup_id": metadata.cup_id,
            "raw_track_text": metadata.raw_track_text,
            "confidence": metadata.confidence,
            "status": metadata.status,
            "error": metadata.error,
            "track_frame_index": metadata.track_frame_index,
            "track_frame_path": metadata.track_frame_path,
        }
    except Exception as exc:
        return {
            "stream_id": frame.stream_id,
            "race_sequence": frame.race_sequence,
            "track_name": "",
            "track_name_nl": "",
            "cup_name": "",
            "cup_name_nl": "",
            "track_id": "",
            "cup_id": "",
            "raw_track_text": "",
            "confidence": 0.0,
            "status": "failed",
            "error": str(exc),
            "track_frame_index": frame.frame_index,
            "track_frame_path": str(frame.crop_path),
        }


def run_consensus_from_selected_subprocess(scope_pairs: set[tuple[str, int]] | None = None) -> subprocess.CompletedProcess[str]:
    env = consensus_subprocess_env()
    if scope_pairs:
        env["MK8_CONSENSUS_SCOPE"] = ",".join(
            sorted([f"{stream}:{race}" for stream, race in scope_pairs])
        )
    python = LIVE_ROOT / ".venv" / "Scripts" / "python.exe"
    executable = str(python) if python.exists() else sys.executable
    result = subprocess.run(
        [executable, str(LIVE_ROOT / "scripts" / "run_pass_7_consensus_from_selected.py")],
        cwd=str(LIVE_ROOT),
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    (assert_write_allowed(DIAGNOSTICS_ROOT / "gui_exact_virtual_capture_consensus_stdout.txt")).write_text(result.stdout[-12000:], encoding="utf-8")
    (assert_write_allowed(DIAGNOSTICS_ROOT / "gui_exact_virtual_capture_consensus_stderr.txt")).write_text(result.stderr[-12000:], encoding="utf-8")
    return result


def run_consensus_from_selected_direct(scope_pairs: set[tuple[str, int]], extractor: Any) -> Any:
    from .consensus_from_selected import (
        build_track_metadata,
        classify_entry,
        load_live_bundle_race_groups,
        load_selected_frames,
        pair_selected_frames,
        sanitize_video_label,
        to_expected_tournament_rows,
        write_live_frame_bundles_from_selected,
    )
    from live_processor.baseline_bundle_ocr import StaticGalleryRaceError, run_baseline_bundle_consensus  # noqa: WPS433 - late import for GUI startup speed
    from live_processor.character_prior_replay import apply_stream_character_prior_replay  # noqa: WPS433 - late import for GUI startup speed
    from live_processor.character_variant_refinement import apply_stream_character_variant_refinement  # noqa: WPS433 - late import for GUI startup speed
    from live_processor.shared_export_characters import reassert_shared_characters  # noqa: WPS433 - late import for GUI startup speed

    run_id = os.environ.get("MK8DX_LIVE_RUN_ID") or os.environ.get("MK8DX_CLEAN_REPLAY_RUN_ID") or ""
    selected = load_selected_frames()
    if run_id:
        selected = [item for item in selected if item.get("run_id") == run_id]
    track_scope = selected
    if scope_pairs:
        scope_streams = {stream_id for stream_id, _race_sequence in scope_pairs}
        # Track screens are paired against every race of the stream so far,
        # not only this scope's: a race may only use the track screen shown
        # after the previous race's scoreboard.
        track_scope = [
            item
            for item in selected
            if classify_entry(item) in {"track_name", "race_score"}
            and str(item.get("stream_id", "unknown")) in scope_streams
        ]
        selected = [
            item
            for item in selected
            if (
                classify_entry(item) == "track_name"
                and str(item.get("stream_id", "unknown")) in scope_streams
            )
            or (
                classify_entry(item) != "track_name"
                and (
                    str(item.get("stream_id", "unknown")),
                    int(item.get("race_sequence") or 0),
                )
                in scope_pairs
            )
        ]
    track_metadata = build_track_metadata(track_scope)
    pairs = pair_selected_frames(selected)
    if scope_pairs:
        pairs = [
            pair
            for pair in pairs
            if (
                str(pair["race"].get("stream_id") or pair["total"].get("stream_id") or "unknown"),
                int(pair["race"].get("race_sequence") or pair["total"].get("race_sequence") or 0),
            )
            in scope_pairs
        ]
    write_live_frame_bundles_from_selected(selected, pairs)
    bundle_groups = {
        (group.video_label, group.race_number): group
        for group in load_live_bundle_race_groups()
    }
    events: list[ScheduledGuiEvent] = []
    detailed: list[dict[str, Any]] = []
    skipped_pairs: list[tuple[str, int]] = []
    for pair in pairs:
        race_entry = pair["race"]
        total_entry = pair["total"]
        stream_id = str(race_entry.get("stream_id") or total_entry.get("stream_id") or "unknown_stream")
        race_sequence = int(race_entry.get("race_sequence") or total_entry.get("race_sequence") or 1)
        video_path_text = str(race_entry.get("video_path") or total_entry.get("video_path") or "")
        bundle_group = bundle_groups.get((sanitize_video_label(Path(video_path_text)), race_sequence))
        if bundle_group is None:
            raise FileNotFoundError(f"No live frame bundle found for {stream_id} race {race_sequence}")
        try:
            exact = run_baseline_bundle_consensus(
                bundle_group=bundle_group,
                race_entry=race_entry,
                total_entry=total_entry,
                stream_id=stream_id,
                race_sequence=race_sequence,
            )
        except StaticGalleryRaceError as exc:
            # A race opened in the gallery, not a real race — skip it entirely so
            # it never becomes a confirmed race in the overlay or the export.
            # Record the pair so the scheduler can mark it *handled* (otherwise the
            # incremental drain loop, which only retires a pair once it emits a
            # scoreboard, would resubmit this gallery pair forever).
            skipped_pairs.append((stream_id, race_sequence))
            detailed.append(
                {
                    "stream_id": stream_id,
                    "race_sequence": race_sequence,
                    "skipped": "static_gallery_race_bundle",
                    "similarity": exc.similarity,
                }
            )
            continue
        replayed_scoreboard_rows, character_replay = apply_stream_character_prior_replay(
            stream_id=stream_id,
            video_context=bundle_group.video_label,
            race_sequence=race_sequence,
            scoreboard_rows=exact.scoreboard_rows,
        )
        replayed_scoreboard_rows = reassert_shared_characters(replayed_scoreboard_rows)
        refined_scoreboard_rows, variant_refinement = apply_stream_character_variant_refinement(
            stream_id=stream_id,
            video_context=bundle_group.video_label,
            race_sequence=race_sequence,
            scoreboard_rows=replayed_scoreboard_rows,
            race_score_anchor_path=bundle_group.race_score_anchor_path,
        )
        refined_scoreboard_rows = reassert_shared_characters(refined_scoreboard_rows)
        tournament_rows = to_expected_tournament_rows(
            refined_scoreboard_rows,
            race_entry,
            total_entry,
            track_metadata,
        )
        total_timestamp = float(total_entry.get("timestamp") or exact.total_score_timestamp)
        total_frame = int(total_entry.get("frame_index") or exact.total_score_frame_index)
        validation = exact.validation
        events.append(
            ScheduledGuiEvent(
                "CONSENSUS_VALIDATED",
                source_id=str(total_entry.get("source_id") or race_entry.get("source_id") or ""),
                stream_label=stream_id,
                timestamp=total_timestamp,
                frame_index=total_frame,
                race_sequence=race_sequence,
                message=(
                    f"race {race_sequence} consensus "
                    f"{validation.get('final_validation_status', 'partial')}: "
                    f"{len(exact.scoreboard_rows)} rows in {exact.duration_seconds:.3f}s"
                ),
                data={
                    "rows_validated": len(exact.scoreboard_rows),
                    "validation": validation,
                    "worker_status": validation.get("final_validation_status", "partial"),
                    "ocr_duration_seconds": exact.duration_seconds,
                    "ocr_timing": exact.timing,
                    "character_prior_replay": character_replay,
                    "character_variant_refinement": variant_refinement,
                    "review_rows": [
                        row
                        for row in refined_scoreboard_rows
                        if str(row.get("ReviewNeeded", "")).lower() == "true"
                    ],
                },
            )
        )
        if validation.get("final_validation_status") == "validated" and refined_scoreboard_rows:
            events.append(
                ScheduledGuiEvent(
                    "SCOREBOARD_UPDATED",
                    source_id=str(total_entry.get("source_id") or race_entry.get("source_id") or ""),
                    stream_label=stream_id,
                    timestamp=total_timestamp,
                    frame_index=total_frame,
                    race_sequence=race_sequence,
                    message=f"race {race_sequence} scoreboard updated",
                    data={
                        "rows": refined_scoreboard_rows,
                        "tournament_rows": tournament_rows,
                        "ocr_duration_seconds": exact.duration_seconds,
                        "ocr_timing": exact.timing,
                        "character_prior_replay": character_replay,
                        "character_variant_refinement": variant_refinement,
                    },
                )
            )
        detailed.append(
            {
                "stream_id": stream_id,
                "race_sequence": race_sequence,
                "validation": validation,
                "scoreboard_rows": len(refined_scoreboard_rows),
                "ocr_duration_seconds": exact.duration_seconds,
                "ocr_timing": exact.timing,
                "character_prior_replay": character_replay,
                "character_variant_refinement": variant_refinement,
                "event_count": len(events),
            }
        )
    stdout = json.dumps(
        {
            "scope_pairs": sorted([f"{stream}:{race}" for stream, race in scope_pairs]),
            "pairs_processed": len(pairs),
            "events": len(events),
            "skipped_static_gallery": sorted([f"{stream}:{race}" for stream, race in skipped_pairs]),
            "details": detailed,
        },
        indent=2,
        sort_keys=True,
    )
    stdout_path, stderr_path = consensus_job_stdio_paths(scope_pairs)
    stdout_path.write_text(stdout, encoding="utf-8")
    stderr_path.write_text("", encoding="utf-8")
    # returncode 0 only when this job actually emitted events; a skip-only job stays
    # at returncode 1 ("nothing to emit") so _emit_consensus_result returns early
    # instead of falling through to reload stale on-disk reports. The skipped pair is
    # still retired separately via `skipped_pairs` -> emitted_scoreboards, so it is
    # not resubmitted despite the non-zero code.
    return SimpleNamespace(
        returncode=0 if events else 1,
        stdout=stdout,
        stderr="",
        events=events,
        skipped_pairs=skipped_pairs,
    )


def consensus_job_stdio_paths(scope_pairs: set[tuple[str, int]]) -> tuple[Path, Path]:
    pair = sorted(scope_pairs)[0] if scope_pairs else ("unknown", 0)
    stream = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(pair[0] or "unknown")).strip("_") or "unknown"
    run_id = re.sub(
        r"[^A-Za-z0-9_.-]+",
        "_",
        str(os.environ.get("MK8DX_LIVE_RUN_ID") or os.environ.get("MK8DX_CLEAN_REPLAY_RUN_ID") or "unknown_run"),
    )
    root = assert_write_allowed(DIAGNOSTICS_ROOT / "pipeline_state" / "consensus_jobs" / run_id / stream / f"Race_{int(pair[1]):03d}")
    root.mkdir(parents=True, exist_ok=True)
    return (
        assert_write_allowed(root / "gui_exact_virtual_capture_consensus_stdout.txt"),
        assert_write_allowed(root / "gui_exact_virtual_capture_consensus_stderr.txt"),
    )


def consensus_subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONWARNINGS"] = "ignore"
    env["MK8DX_LIVE_RUN_ID"] = env.get("MK8DX_LIVE_RUN_ID", time.strftime("gui_incremental_%Y%m%d_%H%M%S"))
    config = load_live_config()
    env.setdefault("MK8_PARALLEL_VIDEO_SCAN_WORKERS", str(max(1, int(config.live_parallel_video_scan_workers))))
    env.setdefault("MK8_SCORE_ANALYSIS_WORKERS", str(max(1, int(config.live_score_analysis_workers))))
    env.setdefault("MK8_OCR_WORKERS", str(max(1, int(config.live_cuda_ocr_workers))))
    env.setdefault("MK8_OVERLAP_OCR_CONSUMERS", str(max(1, int(config.live_ocr_consumers))))
    env.setdefault("MK8_EASYOCR_GPU", "1")
    return env


# Sentinel "end" for a live device: it has no frame count and never ends by
# itself. Large enough that min(current, readable_end) always picks the live edge.
LIVE_UNBOUNDED_END_FRAME = 10**12


def prepare_live_capture_context(
    source: Any,
    analysis_buffer: AnalysisWindowBuffer,
    video_index: int,
    total_videos: int,
    *,
    min_buffer_seconds: float = 5.0,
    timeout_seconds: float = 90.0,
    sample_count: int = 19,
) -> dict[str, Any]:
    """Live capture-card equivalent of the baseline file preflight context.

    The file path samples 19 frames from the video to measure the content
    geometry (letterbox bounds -> median scale/crop). A live device has no file,
    but the measurement itself is per-frame — so sample the same way from the
    rolling analysis buffer once it has a few seconds of real feed. This also
    measures the geometry of the *actual HDMI chain* (playback letterboxing
    shows up here, before any race is scanned).
    """
    from collections import defaultdict

    from mk8dx_tournament_extraction.engine.extract_common import determine_scaling  # type: ignore
    from .capture_card_source import usable_capture_content_box

    import numpy as np

    fps = float(source.fps or 30.0)
    needed = max(2, int(fps * min_buffer_seconds))
    deadline = time.perf_counter() + timeout_seconds
    rng = analysis_buffer.buffered_range()
    while rng is None or (rng[1] - rng[0] + 1) < needed:
        if source.state in {"stopped", "failed", "ended"}:
            raise RuntimeError(
                f"Capture source {source.stream_label} stopped before the live context bootstrap buffered {min_buffer_seconds:.0f}s"
            )
        if time.perf_counter() > deadline:
            raise RuntimeError(
                f"No live frames buffered for {source.stream_label} within {timeout_seconds:.0f}s (no signal?)"
            )
        time.sleep(0.1)
        rng = analysis_buffer.buffered_range()

    # Prefer the source's calibrated geometry. Dark content may not provide a
    # usable game rectangle, even when its average intensity passes the guard.
    # Apply the same aspect check to calibration and the buffered fallback.
    calibration_deadline = time.perf_counter() + 60.0
    while (
        getattr(source, "border_status", None) == "calibrating"
        and time.perf_counter() < calibration_deadline
        and source.state not in {"stopped", "failed", "ended"}
    ):
        time.sleep(0.5)
    calibrated_box = None
    if getattr(source, "border_status", None) in {"clean", "borders"}:
        calibrated_box = getattr(source, "border_box", None)
        if calibrated_box and not usable_capture_content_box(
            calibrated_box, int(source.width), int(source.height),
        ):
            calibrated_box = None

    start, end = int(rng[0]), int(rng[1])
    scales: list[tuple[Any, ...]] = []
    source_height = 0
    if calibrated_box:
        left = int(calibrated_box["left"])
        top = int(calibrated_box["top"])
        crop_w = max(1, int(calibrated_box["right"]) - left)
        crop_h = max(1, int(calibrated_box["bottom"]) - top)
        source_height = int(getattr(source, "height", 0) or 720)
        scales.append((1280.0 / crop_w, 720.0 / crop_h, left, top, crop_w, crop_h))
    else:
        # Calibration can have waited while playback moved beyond a dark
        # opening. Sample the current buffer, not the earlier opening window.
        rng = analysis_buffer.buffered_range()
        if rng is not None:
            start, end = int(rng[0]), int(rng[1])
        capture = analysis_buffer.build_capture(start, end, fps)
        try:
            for index in np.linspace(start, end, num=min(sample_count, end - start + 1)).astype(int):
                capture.set(1, int(index))  # CAP_PROP_POS_FRAMES
                ok, frame = capture.read()
                if not ok or frame is None:
                    continue
                source_height = source_height or int(frame.shape[0])
                scale = determine_scaling(frame)
                _, _, left, top, crop_w, crop_h = scale
                box = dict(left=int(left), top=int(top), right=int(left + crop_w), bottom=int(top + crop_h))
                if usable_capture_content_box(box, int(frame.shape[1]), int(frame.shape[0])):
                    scales.append(scale)
        finally:
            capture.release()
    if not scales:
        raise RuntimeError(f"No usable game geometry for {source.stream_label}; check the live picture and restart analysis")
    display_name = str(getattr(source, "display_label", "") or source.stream_label)
    return {
        "video_path": str(source.video_path),
        "video_index": video_index,
        "total_videos": total_videos,
        "video_start": time.perf_counter(),
        "video_stats": defaultdict(float),
        "corrupt_check_status": "live_capture",
        "processing_video_path": str(source.video_path),
        "video_name": display_name,
        "video_label": source.stream_label,
        "source_display_name": display_name,
        "original_source_display_name": display_name,
        "display_video_index": video_index,
        "display_total_videos": total_videos,
        "fps": fps,
        "frame_skip": int(3 * max(1, int(fps))),
        "total_frames": LIVE_UNBOUNDED_END_FRAME,
        "usable_start_frame": start,
        "readable_end_frame": LIVE_UNBOUNDED_END_FRAME,
        "eof_guard_frames": int(3 * max(1, int(fps))),
        "capture_poisoned": False,
        "median_scale_x": float(np.median([s[0] for s in scales])),
        "median_scale_y": float(np.median([s[1] for s in scales])),
        "median_left": int(np.median([s[2] for s in scales])),
        "median_top": int(np.median([s[3] for s in scales])),
        "median_crop_width": int(np.median([s[4] for s in scales])),
        "median_crop_height": int(np.median([s[5] for s in scales])),
        "source_height": int(source_height),
        "is_low_res_source": False,
    }


def prepare_gui_video_context(
    video_path: Path,
    stream_label: str,
    video_index: int,
    total_videos: int,
    templates: list[tuple[Any, Any]] | None = None,
) -> dict[str, Any]:
    active_templates = templates or load_initial_scan_templates()
    context = baseline_extract_frames._prepare_video_context(
        str(video_path),
        str(video_path.parent),
        False,
        video_index,
        total_videos,
        0.0,
        active_templates,
        video_label=stream_label,
        source_display_name=video_path.name,
    )
    if context is None:
        raise RuntimeError(f"Could not prepare exact-method context for {video_path}")
    return context


def preflight_video_source(
    source: VirtualSourceConfig,
    total_videos: int,
    video_index: int,
    templates: list[tuple[Any, Any]] | None = None,
) -> VideoPreflightResult:
    try:
        context = prepare_gui_video_context(source.video_path, source.stream_label, video_index, total_videos, templates)
        return VideoPreflightResult(
            source_id=source.source_id,
            stream_label=source.stream_label,
            video_path=source.video_path,
            status="ready",
            context=context,
        )
    except Exception as exc:
        return VideoPreflightResult(
            source_id=source.source_id,
            stream_label=source.stream_label,
            video_path=source.video_path,
            status="failed",
            error=str(exc),
        )


def write_gui_preflight_report(run_id: str, results: list[VideoPreflightResult], *, worker_count: int | None = None) -> Path:
    payload = {
        "run_id": run_id,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "worker_count": worker_count,
        "sources": [result.to_report() for result in results],
        "all_ready": all(result.ready for result in results) if results else False,
    }
    path = assert_write_allowed(DIAGNOSTICS_ROOT / "gui_virtual_capture_preflight_report.json")
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


def _source_configs_for(videos: list[Path]) -> list[VirtualSourceConfig]:
    return [
        VirtualSourceConfig(
            source_id=f"source_{index}",
            display_label=path.name,
            stream_label=f"groep_{index}",
            video_path=path,
        )
        for index, path in enumerate(videos, start=1)
    ]


def preset_source_configs() -> list[VirtualSourceConfig]:
    return _source_configs_for(PRESET_FIXTURE_VIDEOS)


def con_error_preset_source_configs() -> list[VirtualSourceConfig]:
    return _source_configs_for(CON_ERROR_PRESET_VIDEOS)
