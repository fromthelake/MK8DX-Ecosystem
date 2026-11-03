from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .config import LiveConfig, load_live_config
from .export import export_session
from .fixtures import ReplayFixture, discover_replay_fixtures
from .frame_buffer import write_frame_buffer_report
from .live_pipeline import LiveStreamProcessor, write_combined_live_pipeline_reports
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .performance import PerformanceTracker
from .run_context import attach_run_id, current_run_id
from .session import LiveSession
from .source import LiveSource, SourceRole, SourceState
from .gui import GuiSnapshot, LiveDebugGui


@dataclass(frozen=True)
class VideoMetadata:
    frame_count: int
    fps: float
    duration_seconds: float
    source: str


@dataclass(frozen=True)
class ReplayOptions:
    sample_mode: Literal["full", "middle", "start"] = "middle"
    sample_duration_seconds: float = 900.0
    analysis_fps: float = 1.0
    show_gui: bool = False


def read_video_metadata(path: Path) -> VideoMetadata:
    try:
        import cv2  # type: ignore

        cap = cv2.VideoCapture(str(path))
        if cap.isOpened():
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1800
            fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
            cap.release()
            return VideoMetadata(frame_count, fps, frame_count / fps, "opencv")
        cap.release()
    except Exception:
        pass
    size = max(path.stat().st_size, 1)
    frame_count = max(1800, min(18000, size // (1024 * 512)))
    fps = 30.0
    return VideoMetadata(int(frame_count), fps, int(frame_count) / fps, "file_size_estimate")


class ReplayEngine:
    def __init__(
        self,
        tracker: PerformanceTracker,
        speed: float = 30.0,
        enable_ocr: bool = True,
        config: LiveConfig | None = None,
        options: ReplayOptions | None = None,
    ) -> None:
        self.tracker = tracker
        self.speed = speed
        self.enable_ocr = enable_ocr
        self.config = config or load_live_config()
        self.options = options or ReplayOptions(
            sample_mode=self.config.replay_sample_mode if self.config.replay_sample_mode in {"full", "middle", "start"} else "middle",
            sample_duration_seconds=self.config.replay_sample_duration_seconds,
            analysis_fps=self.config.replay_analysis_fps,
            show_gui=False,
        )
        self.frame_reports: list[dict[str, object]] = []
        self.processors: list[LiveStreamProcessor] = []

    def run(
        self,
        fixtures: list[ReplayFixture] | None = None,
        limit: int | None = None,
        export: bool = True,
    ) -> tuple[LiveSession, dict[str, Path]]:
        with self.tracker.track("replay.run"):
            fixtures = fixtures or discover_replay_fixtures()
            if limit is not None:
                fixtures = fixtures[:limit]
            session = LiveSession.create(self.tracker)
            session.fixture_videos = [fixture.path.name for fixture in fixtures]
            gui = LiveDebugGui() if self.options.show_gui else None
            started = time.perf_counter()
            try:
                for fixture in fixtures:
                    self._run_stream(session, fixture, gui)
            finally:
                if gui is not None:
                    gui.close()
            session.scoreboard.freeze()
            session.save_state()
            exports: dict[str, Path] = {}
            if export:
                try:
                    exports = export_session(session, self.tracker)
                except Exception as exc:
                    session.export_status = "failed"
                    self.tracker.record_error("export.export_session", type(exc).__name__, str(exc))
                    self._write_export_failure(session, exc)
            elapsed = max(time.perf_counter() - started, 0.000001)
            logical_duration = sum(read_video_metadata(f.path).duration_seconds for f in fixtures)
            self.tracker.record_replay(
                stream_id="all",
                requested_speed=self.speed,
                achieved_speed=logical_duration / elapsed,
                logical_duration_seconds=logical_duration,
                wall_time_seconds=elapsed,
            )
            self.tracker.sample_system()
            self._write_frame_processing_report()
            write_frame_buffer_report([processor.buffer for processor in self.processors])
            write_combined_live_pipeline_reports(self.processors)
            session.save_state()
            self.tracker.write_reports()
            return session, exports

    def _run_stream(self, session: LiveSession, fixture: ReplayFixture, gui: LiveDebugGui | None = None) -> None:
        import cv2  # type: ignore

        source = LiveSource(
            source_id=fixture.stream_id,
            display_label=fixture.label,
            role=SourceRole.MK8_FEED,
            path=fixture.path,
        )
        with self.tracker.track("replay.run_stream", stream_id=source.source_id):
            source.transition(SourceState.RUNNING)
            metadata = read_video_metadata(fixture.path)
            cap = cv2.VideoCapture(str(fixture.path))
            if not cap.isOpened():
                source.fail(f"Could not open replay video: {fixture.path}")
                session.source_states[source.source_id] = source.lifecycle_state.value
                self.tracker.record_error("replay.open_video", "VideoOpenError", source.error_state or "")
                return
            processor = LiveStreamProcessor(
                stream_id=source.source_id,
                video_path=fixture.path,
                session=session,
                tracker=self.tracker,
                config=self.config,
                enable_ocr=self.enable_ocr,
            )

            sample_start_frame, sample_end_frame = sample_frame_range(metadata, self.options)
            cap.set(cv2.CAP_PROP_POS_FRAMES, sample_start_frame)
            frame_count_read = 0
            frames_skipped_by_grab = 0
            frame_read_errors = 0
            analyzed_indexes: list[int] = []
            timestamps: list[float] = []
            first_hash: str | None = None
            middle_hash: str | None = None
            last_hash: str | None = None
            last_frame = None
            analysis_step_frames = max(1, int(round(metadata.fps / max(self.options.analysis_fps, 0.001))))
            sample_interval = analysis_step_frames
            target_middle = max(1, metadata.frame_count // 2)

            while True:
                current_pos = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
                if current_pos > sample_end_frame:
                    break
                ok, frame = cap.read()
                if not ok:
                    break
                frame_count_read += 1
                source.metrics.frames_processed += 1
                frame_index = max(1, current_pos)
                source.current_timestamp = frame_index / metadata.fps
                last_frame = frame
                if first_hash is None:
                    first_hash = frame_hash(frame)
                if middle_hash is None and frame_index >= target_middle:
                    middle_hash = frame_hash(frame)
                processor.process_frame(frame_index, source.current_timestamp, frame)
                if gui is not None:
                    gui.update_frame(
                        frame,
                        GuiSnapshot(
                            stream_id=source.source_id,
                            frame_index=frame_index,
                            timestamp=source.current_timestamp,
                            state=processor.state.value,
                            race_count=len(processor.races),
                            detection_count=session.detection_candidate_count,
                            ocr_success_count=session.ocr_success_count,
                            ocr_failure_count=session.ocr_failure_count,
                            scoreboard_update_count=session.scoreboard.update_count,
                        ),
                    )
                if frame_index == 1 or frame_index % sample_interval == 0:
                    analyzed_indexes.append(frame_index)
                    timestamps.append(source.current_timestamp)
                if frame_index % max(1, metadata.frame_count // 10) == 0:
                    self.tracker.record_queue(
                        stream_id=source.source_id,
                        frame_index=frame_index,
                        queue_size=0,
                        backlog=source.metrics.backlog,
                        dropped_overload=source.metrics.frames_dropped_overload,
                    )
                for _ in range(max(0, analysis_step_frames - 1)):
                    if int(cap.get(cv2.CAP_PROP_POS_FRAMES)) > sample_end_frame:
                        break
                    if not cap.grab():
                        break
                    frames_skipped_by_grab += 1
            cap.release()
            if frame_count_read == 0:
                source.fail(f"No frames decoded from replay video: {fixture.path}")
                frame_read_errors += 1
            else:
                last_hash = frame_hash(last_frame)
                processor.end_stream()
                self.processors.append(processor)
                source.transition(SourceState.ENDED)
            session.source_states[source.source_id] = source.lifecycle_state.value
            self.frame_reports.append(
                {
                    "run_id": current_run_id(),
                    "video_path": str(fixture.path),
                    "stream_id": source.source_id,
                    "frame_count_read": frame_count_read,
                    "frame_indexes_sampled_analyzed": analyzed_indexes,
                    "timestamps_processed": timestamps,
                    "first_frame_hash": first_hash,
                    "middle_frame_hash": middle_hash,
                    "last_frame_hash": last_hash,
                    "video_duration": metadata.duration_seconds,
                    "fps_detected": metadata.fps,
                    "total_decoded_frames": frame_count_read,
                    "sample_mode": self.options.sample_mode,
                    "sample_start_frame": sample_start_frame,
                    "sample_end_frame": sample_end_frame,
                    "analysis_fps": self.options.analysis_fps,
                    "analysis_step_frames": analysis_step_frames,
                    "frames_skipped_by_grab": frames_skipped_by_grab,
                    "processed_frames": source.metrics.frames_processed,
                    "frame_read_errors": frame_read_errors,
                    "end_state": source.lifecycle_state.value,
                }
            )
            self.tracker.record_stream(
                stream_id=source.source_id,
                label=source.display_label,
                frame_count_read=frame_count_read,
                frame_count_processed=source.metrics.frames_processed,
                frame_count_rejected=source.metrics.frames_rejected,
                frames_intentionally_skipped=source.metrics.frames_intentionally_skipped,
                frames_dropped_overload=source.metrics.frames_dropped_overload,
                metadata_source=metadata.source,
                duration_seconds=metadata.duration_seconds,
                end_state=source.lifecycle_state.value,
            )

    def _write_frame_processing_report(self) -> Path:
        DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
        path = assert_write_allowed(DIAGNOSTICS_ROOT / "replay_frame_processing_report.json")
        path.write_text(json.dumps(attach_run_id(self.frame_reports), indent=2, sort_keys=True), encoding="utf-8")
        return path

    def _write_export_failure(self, session: LiveSession, exc: Exception) -> Path:
        DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
        path = assert_write_allowed(DIAGNOSTICS_ROOT / f"{session.session_id}_export_failure.txt")
        path.write_text(str(exc) + "\n", encoding="utf-8")
        return path


def frame_hash(frame: object) -> str:
    if frame is None:
        return ""
    try:
        import cv2  # type: ignore

        ok, encoded = cv2.imencode(".jpg", frame)
        if ok:
            return hashlib.sha256(encoded.tobytes()).hexdigest()
    except Exception:
        pass
    return hashlib.sha256(str(frame).encode("utf-8")).hexdigest()


def sample_frame_range(metadata: VideoMetadata, options: ReplayOptions) -> tuple[int, int]:
    if options.sample_mode == "full":
        return 0, max(0, metadata.frame_count - 1)
    duration = min(max(1.0, options.sample_duration_seconds), metadata.duration_seconds)
    sample_frames = int(duration * metadata.fps)
    if options.sample_mode == "start":
        start = 0
    else:
        start = max(0, (metadata.frame_count - sample_frames) // 2)
    end = min(metadata.frame_count - 1, start + sample_frames)
    return start, end
