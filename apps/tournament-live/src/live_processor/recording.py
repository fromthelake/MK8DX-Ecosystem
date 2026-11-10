from __future__ import annotations

import hashlib
import json
import os
import queue
import shutil
import subprocess
import threading
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from .paths import DIAGNOSTICS_ROOT, LIVE_OUTPUT, assert_write_allowed
from .recording_lifecycle import (
    RecordingLifecycle,
    RecordingPreflightResult,
    RecordingRunManifest,
    RecordingRunPaths,
    RecordingValidationResult,
    unfinished_recording_runs,
)


class RecorderState(str, Enum):
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    FAILED = "failed"


@dataclass(frozen=True)
class RecorderCommand:
    args: list[str]
    output_pattern: Path


@dataclass(frozen=True)
class RecordingConfig:
    width: int = 1280
    height: int = 720
    fps: int = 30
    video_bitrate: str = "12M"
    maxrate: str = "16M"
    bufsize: str = "24M"
    pixel_format: str = "yuv420p"
    encoder_preference: str = "x264"
    nvenc_preset: str = "p5"
    x264_preset: str = "veryfast"
    gop_frames: int = 30
    cluster_time_limit_ms: int = 1000
    analysis_transport_queue_chunks: int = 64
    analysis_transport_chunk_bytes: int = 64 * 1024
    analysis_fifo_packets: int = 64
    planned_duration_hours: float = 0.0
    archive_stall_seconds: float = 8.0
    disk_emergency_minutes: float = 10.0
    max_writer_restarts: int = 3
    # Legacy virtual/file replay recorder only. Real capture-card archives never
    # pass through this queue; their primary FFmpeg branch is recording-first.
    virtual_stream_queue_frames: int = 16


@dataclass
class RecordingProcess:
    source_id: str
    stream_label: str
    command: RecorderCommand
    state: RecorderState = RecorderState.STARTING
    process: subprocess.Popen[Any] | None = None
    started_at: float | None = None
    stopped_at: float | None = None
    error: str = ""
    stderr_log_path: Path | None = None
    _stderr_handle: Any | None = field(default=None, repr=False)
    # Stream-capture (frame-tap) internals, set up by start_stream_recording.
    width: int = 1280
    height: int = 720
    frames_submitted: int = 0
    frames_written: int = 0
    frames_dropped: int = 0
    _queue: Any = field(default=None, repr=False)
    _feeder: Any = field(default=None, repr=False)

    @property
    def output_path(self) -> Path:
        return self.command.output_pattern

    def submit(self, frame: Any) -> None:
        """Tap one captured frame for recording (called from the source's decode
        thread). Non-blocking: drops the frame if the encoder is behind so the
        capture/analysis pipeline is never stalled by recording."""
        q = self._queue
        if q is None:
            return
        self.frames_submitted += 1
        try:
            q.put_nowait(frame)
        except queue.Full:
            self.frames_dropped += 1


@dataclass(frozen=True)
class RecordingFirstCommand:
    capture_args: list[str]
    decoder_args: list[str]
    output_path: Path
    progress_path: Path
    audio_selected: bool


@dataclass
class DirectCaptureRecording:
    source_id: str
    stream_label: str
    device_name: str
    device_alternative_name: str
    paths: RecordingRunPaths
    config: RecordingConfig
    audio_device_name: str = ""
    audio_device_alternative_name: str = ""
    # All direct writers in one run share this output root. Remaining time and
    # the emergency reserve therefore use their combined configured bitrate.
    shared_writer_count: int = 1
    parts: list[Path] = field(default_factory=list)
    progress_paths: list[Path] = field(default_factory=list)
    current_command: RecordingFirstCommand | None = None
    capture_exit_codes: list[int | None] = field(default_factory=list)
    analysis_transport_chunks: int = 0
    analysis_transport_dropped: int = 0
    analysis_decoder_restarts: int = 0
    started_at: float | None = None
    stopped_at: float | None = None
    error: str = ""
    archive_failed: bool = False
    unclean_stop: bool = False
    recovery_exhausted: bool = False
    last_observed_bytes: int = 0
    last_growth_at: float | None = None
    last_progress_frame: int = 0
    last_progress_at: float | None = None
    free_bytes: int = 0
    estimated_hours_remaining: float = 0.0
    signal_intervals: list[dict[str, Any]] = field(default_factory=list)

    def next_command(self) -> RecordingFirstCommand:
        part_number = len(self.parts) + 1
        if part_number > 1 + max(0, int(self.config.max_writer_restarts)):
            self.recovery_exhausted = True
            raise RuntimeError("Archive writer recovery limit reached")
        output_path = self.paths.part(self.stream_label, part_number)
        progress_path = output_path.with_suffix(".progress")
        if output_path.exists():
            raise FileExistsError(f"Recording part already exists: {output_path}")
        command = build_recording_first_capture_command(
            device_name=self.device_name,
            device_alternative_name=self.device_alternative_name,
            output_path=output_path,
            progress_path=progress_path,
            audio_device_name=self.audio_device_name,
            audio_device_alternative_name=self.audio_device_alternative_name,
            config=self.config,
        )
        self.parts.append(output_path)
        self.progress_paths.append(progress_path)
        self.current_command = command
        if self.started_at is None:
            self.started_at = time.time()
        return command

    @property
    def current_part(self) -> Path | None:
        return self.parts[-1] if self.parts else None

    def summary(self) -> dict[str, Any]:
        part = self.current_part
        return {
            "source_id": self.source_id,
            "stream_label": self.stream_label,
            "device_name": self.device_name,
            "device_alternative_name": self.device_alternative_name,
            "audio_device_name": self.audio_device_name,
            "parts": [str(value) for value in self.parts],
            "part_number": len(self.parts),
            "current_part": str(part) if part else "",
            "current_part_bytes": part.stat().st_size if part and part.exists() else 0,
            "capture_exit_codes": self.capture_exit_codes,
            "analysis_transport_chunks": self.analysis_transport_chunks,
            "analysis_transport_dropped": self.analysis_transport_dropped,
            "analysis_decoder_restarts": self.analysis_decoder_restarts,
            "archive_failed": self.archive_failed,
            "unclean_stop": self.unclean_stop,
            "recovery_exhausted": self.recovery_exhausted,
            "last_progress_frame": self.last_progress_frame,
            "free_bytes": self.free_bytes,
            "estimated_hours_remaining": round(self.estimated_hours_remaining, 2),
            "audio_selected": bool(self.audio_device_name or self.audio_device_alternative_name),
            "shared_writer_count": max(1, self.shared_writer_count),
            "signal_intervals": list(self.signal_intervals),
            "error": self.error,
            "started_at": self.started_at,
            "stopped_at": self.stopped_at,
        }

    def observe_health(self) -> bool:
        now = time.time()
        part = self.current_part
        current_bytes = part.stat().st_size if part and part.exists() else 0
        if current_bytes > self.last_observed_bytes:
            self.last_observed_bytes = current_bytes
            self.last_growth_at = now
        elif self.last_growth_at is None:
            self.last_growth_at = self.started_at or now
        progress = self.progress_paths[-1] if self.progress_paths else None
        if progress and progress.is_file():
            try:
                values = dict(
                    line.split("=", 1)
                    for line in progress.read_text(encoding="utf-8", errors="replace").splitlines()
                    if "=" in line
                )
                progress_frame = int(values.get("frame") or self.last_progress_frame)
                if progress_frame > self.last_progress_frame:
                    self.last_progress_frame = progress_frame
                    self.last_progress_at = now
            except (OSError, TypeError, ValueError):
                pass
        self.free_bytes = shutil.disk_usage(self.paths.run_root).free
        bitrate = max(1, _bitrate_bits(self.config.video_bitrate))
        combined_bitrate = bitrate * max(1, self.shared_writer_count)
        self.estimated_hours_remaining = self.free_bytes * 8 / combined_bitrate / 3600
        emergency_bytes = int(combined_bitrate / 8 * 60 * max(0.0, self.config.disk_emergency_minutes))
        healthy = True
        if self.free_bytes <= emergency_bytes:
            self.archive_failed = True
            self.error = "Recording disk space is critically low"
            healthy = False
        last_activity = max(
            value for value in (self.last_growth_at, self.last_progress_at, self.started_at) if value is not None
        )
        if (
            self.started_at is not None
            and now - self.started_at > self.config.archive_stall_seconds
            and now - last_activity > self.config.archive_stall_seconds
        ):
            self.archive_failed = True
            self.error = "Archive file/progress stalled"
            healthy = False
        return healthy


def build_recording_first_capture_command(
    *,
    device_name: str,
    output_path: Path,
    progress_path: Path,
    device_alternative_name: str = "",
    audio_device_name: str = "",
    audio_device_alternative_name: str = "",
    config: RecordingConfig | None = None,
    input_args: list[str] | None = None,
) -> RecordingFirstCommand:
    """Build the single-owner archive-first FFmpeg command.

    The Matroska output is the required tee branch. The MPEG-TS analysis branch
    is wrapped in FFmpeg's fifo muxer and may drop only its own packets. Python
    drains that branch continuously; archive frames never enter a Python queue.
    ``input_args`` exists solely for the synthetic lavfi integration gate.
    """
    config = config or RecordingConfig(encoder_preference="x264")
    output_path = assert_write_allowed(output_path)
    progress_path = assert_write_allowed(progress_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if input_args is None:
        video = device_alternative_name or device_name
        audio = audio_device_alternative_name or audio_device_name
        input_spec = f"video={video}" + (f":audio={audio}" if audio else "")
        input_args = [
            "-f", "dshow", "-rtbufsize", "128M", "-framerate", str(config.fps), "-i", input_spec,
        ]
    maps = ["-map", "0:v:0"]
    if audio_device_name or audio_device_alternative_name:
        maps += ["-map", "0:a:0?"]
    archive = _tee_escape(output_path)
    tee = (
        f"[f=matroska:onfail=abort:cluster_time_limit={config.cluster_time_limit_ms}]{archive}"
        f"|[f=fifo:fifo_format=mpegts:queue_size={max(8, int(config.analysis_fifo_packets))}:drop_pkts_on_overflow=1:"
        "attempt_recovery=1:recovery_wait_time=1:onfail=ignore:select=v]pipe\\:1"
    )
    capture_args = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "warning",
        *input_args,
        *maps,
        "-vf", f"scale={config.width}:{config.height}:flags=lanczos",
        *_encoder_args(config),
        "-flags", "+global_header",
        "-pix_fmt", config.pixel_format,
        "-g", str(config.gop_frames),
        "-keyint_min", str(config.gop_frames),
        "-sc_threshold", "0",
    ]
    if audio_device_name or audio_device_alternative_name:
        capture_args += ["-c:a", "aac", "-b:a", "192k"]
    capture_args += [
        "-progress", str(progress_path),
        "-f", "tee", tee,
    ]
    decoder_args = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning",
        "-fflags", "+discardcorrupt+nobuffer", "-flags", "low_delay",
        "-f", "mpegts", "-i", "pipe:0", "-an",
        "-vf", f"scale={config.width}:{config.height}",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1",
    ]
    return RecordingFirstCommand(
        capture_args=capture_args,
        decoder_args=decoder_args,
        output_path=output_path,
        progress_path=progress_path,
        audio_selected=bool(audio_device_name or audio_device_alternative_name),
    )


def _tee_escape(path: Path) -> str:
    # tee's slave parser treats ':' and apostrophes specially even though no
    # shell is involved. Forward slashes avoid the Windows backslash layer.
    return str(path.resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "'\\''")


def preflight_recording_environment(
    *,
    output_root: Path,
    feed_count: int,
    config: RecordingConfig,
    which: Callable[[str], str | None] = shutil.which,
) -> list[RecordingPreflightResult]:
    results: list[RecordingPreflightResult] = []
    for executable in ("ffmpeg", "ffprobe"):
        results.append(RecordingPreflightResult(
            ok=which(executable) is not None,
            code=f"{executable}_available",
            message=f"{executable} available" if which(executable) is not None else f"{executable} was not found",
        ))
    output_root = assert_write_allowed(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    probe = output_root / ".recording-write-test"
    try:
        probe.write_bytes(b"mk8dx")
        probe.unlink()
        results.append(RecordingPreflightResult(True, "output_writable", "Recording output is writable"))
    except OSError as error:
        results.append(RecordingPreflightResult(False, "output_writable", str(error)))
    usage = shutil.disk_usage(output_root)
    bitrate = _bitrate_bits(config.video_bitrate)
    estimated_hours = usage.free * 8 / max(1, bitrate * max(1, feed_count)) / 3600
    reserve_bytes = int(bitrate / 8 * 3600 * max(0.0, config.planned_duration_hours) * max(1, feed_count))
    results.append(RecordingPreflightResult(
        ok=usage.free > reserve_bytes,
        code="disk_reserve",
        message="Recording disk reserve available" if usage.free > reserve_bytes else "Insufficient recording disk reserve",
        details={
            "free_bytes": usage.free,
            "configured_reserve_bytes": reserve_bytes,
            "estimated_hours_for_all_feeds": round(estimated_hours, 2),
        },
    ))
    encoder = {"x264": "libx264", "nvenc": "h264_nvenc"}.get(config.encoder_preference, "")
    try:
        check = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=10, check=False,
        ) if which("ffmpeg") else None
        encoder_ok = bool(encoder) and check is not None and encoder in (check.stdout + check.stderr)
    except (OSError, subprocess.TimeoutExpired):
        encoder_ok = False
    results.append(RecordingPreflightResult(
        encoder_ok,
        "encoder_available",
        f"Encoder {encoder} available" if encoder_ok else f"Encoder {encoder} is unavailable",
        {"encoder": encoder},
    ))
    formats_ok = False
    dshow_ok = False
    if which("ffmpeg"):
        try:
            formats = subprocess.run(
                ["ffmpeg", "-hide_banner", "-formats"], capture_output=True, text=True, timeout=10, check=False,
            )
            format_text = formats.stdout + formats.stderr
            formats_ok = all(name in format_text for name in ("matroska", " tee", " fifo", "mpegts"))
            devices = subprocess.run(
                ["ffmpeg", "-hide_banner", "-devices"], capture_output=True, text=True, timeout=10, check=False,
            )
            dshow_ok = "dshow" in (devices.stdout + devices.stderr)
        except (OSError, subprocess.TimeoutExpired):
            pass
    results.append(RecordingPreflightResult(
        formats_ok,
        "recording_muxers_available",
        "Matroska/tee/fifo/MPEG-TS capabilities available" if formats_ok else "Required FFmpeg recording muxers are unavailable",
    ))
    results.append(RecordingPreflightResult(
        dshow_ok,
        "directshow_available",
        "DirectShow capture available" if dshow_ok else "FFmpeg DirectShow input is unavailable",
    ))
    return results


def validate_recording(path: Path, *, ffprobe: str = "ffprobe", ffmpeg: str = "ffmpeg") -> RecordingValidationResult:
    errors: list[str] = []
    if not path.is_file() or path.stat().st_size <= 0:
        return RecordingValidationResult(False, str(path), errors=("Recording file is missing or empty",))
    try:
        probe = subprocess.run(
            [
                ffprobe, "-v", "error", "-show_entries",
                "format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,channels,sample_rate",
                "-of", "json", str(path),
            ],
            capture_output=True, text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return RecordingValidationResult(False, str(path), errors=(str(error),))
    if probe.returncode != 0:
        errors.append(probe.stderr.strip() or f"ffprobe exited with {probe.returncode}")
        payload: dict[str, Any] = {}
    else:
        try:
            payload = json.loads(probe.stdout)
        except json.JSONDecodeError as error:
            errors.append(f"Invalid ffprobe JSON: {error}")
            payload = {}
    format_value = payload.get("format", {}) if isinstance(payload, dict) else {}
    streams = payload.get("streams", []) if isinstance(payload, dict) else []
    format_name = str(format_value.get("format_name") or "")
    try:
        duration = float(format_value.get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0
    video_streams = sum(1 for stream in streams if stream.get("codec_type") == "video")
    audio_streams = sum(1 for stream in streams if stream.get("codec_type") == "audio")
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    if "matroska" not in format_name:
        errors.append(f"Expected Matroska, found {format_name or 'unknown format'}")
    if video_streams < 1:
        errors.append("No video stream")
    if duration <= 0:
        errors.append("Non-positive duration")
    if not errors:
        demux = subprocess.run(
            [ffmpeg, "-v", "error", "-i", str(path), "-map", "0", "-c", "copy", "-f", "null", "-"],
            capture_output=True, timeout=120, check=False,
        )
        if demux.returncode != 0:
            errors.append(demux.stderr.decode(errors="replace")[-2000:] or "Complete demux pass failed")
    if not errors:
        for seek in (0.0, max(0.0, duration - 0.5)):
            decode = subprocess.run(
                [ffmpeg, "-v", "error", "-ss", f"{seek:.3f}", "-i", str(path), "-frames:v", "1", "-f", "null", "-"],
                capture_output=True, timeout=30, check=False,
            )
            if decode.returncode != 0:
                errors.append(f"Video decode failed at {seek:.3f}s")
                break
    digest = _sha256(path) if not errors else ""
    return RecordingValidationResult(
        ok=not errors,
        path=str(path),
        format_name=format_name,
        duration_seconds=duration,
        video_streams=video_streams,
        audio_streams=audio_streams,
        video_codec=str(video.get("codec_name") or ""),
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        pixel_format=str(video.get("pix_fmt") or ""),
        frame_rate=str(video.get("r_frame_rate") or ""),
        sha256=digest,
        bytes=path.stat().st_size,
        errors=tuple(errors),
    )


def assemble_recording(recording: DirectCaptureRecording) -> RecordingValidationResult:
    final = recording.paths.final(recording.stream_label)
    if final.exists():
        # A successful one-part assembly atomically moves its working part.
        # Retry/recovery must validate that final artifact before requiring the
        # old part path, which correctly no longer exists.
        return _validate_expected_recording(recording, final)
    parts = [part for part in recording.parts if part.is_file() and part.stat().st_size > 0]
    if not parts:
        return RecordingValidationResult(False, str(recording.paths.final(recording.stream_label)), errors=("No recording parts",))
    partial = recording.paths.partial_final(recording.stream_label)
    if partial.exists():
        partial_result = validate_recording(partial)
        if partial_result.ok:
            os.replace(partial, final)
            return _validate_expected_recording(recording, final)
        return RecordingValidationResult(False, str(final), errors=("Partial final recording already exists and is invalid",))
    part_results = [validate_recording(part) for part in parts]
    if any(not result.ok for result in part_results):
        errors = tuple(error for result in part_results for error in result.errors)
        return RecordingValidationResult(False, str(final), errors=errors or ("A recording part failed validation",))
    if len(parts) == 1:
        os.replace(parts[0], final)
    else:
        if not _parts_compatible(parts):
            return RecordingValidationResult(False, str(final), errors=("Recording parts have incompatible streams",))
        required = sum(part.stat().st_size for part in parts)
        if shutil.disk_usage(recording.paths.run_root).free <= required:
            return RecordingValidationResult(False, str(final), errors=("Insufficient free space for lossless remux",))
        concat_path = recording.paths.concat_list(recording.stream_label)
        concat_path.write_text(
            "".join(f"file '{_concat_escape(part)}'\n" for part in parts),
            encoding="utf-8",
        )
        remux = subprocess.run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "warning",
                "-f", "concat", "-safe", "0", "-i", str(concat_path),
                "-map", "0", "-c", "copy", "-f", "matroska", str(partial),
            ],
            capture_output=True, timeout=3600, check=False,
        )
        if remux.returncode != 0:
            return RecordingValidationResult(
                False, str(final), errors=(remux.stderr.decode(errors="replace")[-4000:] or "Lossless remux failed",),
            )
        partial_result = validate_recording(partial)
        expected_duration = sum(result.duration_seconds for result in part_results)
        tolerance = max(1.0, expected_duration * 0.01)
        if not partial_result.ok or abs(partial_result.duration_seconds - expected_duration) > tolerance:
            return RecordingValidationResult(
                False,
                str(final),
                errors=partial_result.errors + (
                    f"Remux duration {partial_result.duration_seconds:.3f}s does not match parts {expected_duration:.3f}s",
                ),
            )
        os.replace(partial, final)
    return _validate_expected_recording(recording, final)


# A capture card that delivers MJPEG (full-range JPEG colour) makes ffmpeg tag the encoded
# yuv420p stream "yuvj420p": the same planar layout with a full-range flag. The group-2 card
# of the LAN rig does this (TN13 replay on A2, 2026-11-10); the recording itself is fine.
_EQUIVALENT_PIXEL_FORMATS = {"yuv420p": {"yuv420p", "yuvj420p"}}


def _same_pixel_layout(found: str, expected: str) -> bool:
    return found in _EQUIVALENT_PIXEL_FORMATS.get(expected, {expected})


def _validate_expected_recording(
    recording: DirectCaptureRecording, final: Path,
) -> RecordingValidationResult:
    final_result = validate_recording(final)
    expectation_errors: list[str] = []
    if final_result.ok:
        if final_result.video_codec != "h264":
            expectation_errors.append(f"Expected H.264, found {final_result.video_codec}")
        if (final_result.width, final_result.height) != (recording.config.width, recording.config.height):
            expectation_errors.append(
                f"Expected {recording.config.width}x{recording.config.height}, "
                f"found {final_result.width}x{final_result.height}"
            )
        if not _same_pixel_layout(final_result.pixel_format, recording.config.pixel_format):
            expectation_errors.append(
                f"Expected {recording.config.pixel_format}, found {final_result.pixel_format}"
            )
        audio_required = bool(recording.audio_device_name or recording.audio_device_alternative_name)
        if audio_required and final_result.audio_streams < 1:
            expectation_errors.append("Selected capture audio stream is absent")
        if recording.started_at is not None and recording.stopped_at is not None:
            wall_duration = max(0.0, recording.stopped_at - recording.started_at)
            tolerance = max(3.0, wall_duration * 0.05)
            if abs(final_result.duration_seconds - wall_duration) > tolerance:
                expectation_errors.append(
                    f"Recording duration {final_result.duration_seconds:.3f}s differs from capture boundary "
                    f"{wall_duration:.3f}s"
                )
    if expectation_errors:
        return RecordingValidationResult(
            **{**asdict(final_result), "ok": False, "sha256": "", "errors": tuple(expectation_errors)},
        )
    return final_result


def cleanup_assembled_parts(recording: DirectCaptureRecording, validation: RecordingValidationResult) -> None:
    if not validation.ok:
        return
    final = Path(validation.path).resolve()
    if not final.is_file() or _sha256(final) != validation.sha256:
        raise RuntimeError("Final recording changed before working-part cleanup")
    for part in recording.parts:
        if part.exists() and part.resolve() != final:
            part.unlink()
    concat = recording.paths.concat_list(recording.stream_label)
    concat.unlink(missing_ok=True)


def recover_recording_run(manifest_path: Path) -> dict[str, Any]:
    manifest = RecordingRunManifest.load(manifest_path)
    manifest.begin_recovery()
    paths = manifest.paths
    config_value = manifest.document.get("recording_config", {})
    config_fields = set(RecordingConfig.__dataclass_fields__)
    config = RecordingConfig(**{
        key: value for key, value in config_value.items() if key in config_fields
    }) if isinstance(config_value, dict) else RecordingConfig()
    recordings: list[DirectCaptureRecording] = []
    for feed in manifest.document.get("feeds", []):
        if not isinstance(feed, dict):
            continue
        stream_label = str(feed.get("stream_label") or feed.get("source_id") or "feed")
        parts = sorted(paths.feed_working_dir(stream_label).glob("part-*.mkv"))
        recordings.append(DirectCaptureRecording(
            source_id=str(feed.get("source_id") or stream_label),
            stream_label=stream_label,
            device_name=str(feed.get("device_name") or "recovery"),
            device_alternative_name=str(feed.get("device_alternative_name") or ""),
            audio_device_name=str(feed.get("audio_device_name") or ""),
            audio_device_alternative_name=str(feed.get("audio_device_alternative_name") or ""),
            paths=paths,
            config=config,
            parts=parts,
            archive_failed=True,
        ))
    validations = [assemble_recording(recording) for recording in recordings]
    manifest.transition(
        RecordingLifecycle.VERIFYING_RECORDINGS,
        final_recordings=[asdict(validation) for validation in validations],
    )
    if not validations or any(not validation.ok for validation in validations):
        manifest.transition(
            RecordingLifecycle.FINALIZATION_FAILED,
            retryable_action="retry_recovery",
            final_recordings=[asdict(validation) for validation in validations],
        )
        return {"ok": False, "run_id": paths.run_id, "validations": [asdict(value) for value in validations]}
    manifest.transition(
        RecordingLifecycle.COMPLETED_WITH_EVIDENCE_GAPS,
        final_recordings=[asdict(validation) for validation in validations],
        recovered_after_unclean_exit=True,
    )
    for recording, validation in zip(recordings, validations, strict=True):
        cleanup_assembled_parts(recording, validation)
    manifest.update(cleanup_complete=True)
    return {"ok": True, "run_id": paths.run_id, "validations": [asdict(value) for value in validations]}


def discover_recoverable_recordings() -> list[Path]:
    return unfinished_recording_runs(recordings_root())


def _parts_compatible(parts: list[Path]) -> bool:
    signatures: list[str] = []
    for part in parts:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries",
                "stream=index,codec_type,codec_name,width,height,pix_fmt,time_base,channels,sample_rate,channel_layout",
                "-of", "json", str(part),
            ],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if result.returncode != 0:
            return False
        try:
            streams = json.loads(result.stdout).get("streams", [])
        except json.JSONDecodeError:
            return False
        signatures.append(json.dumps(streams, sort_keys=True))
    return len(set(signatures)) == 1


def _concat_escape(path: Path) -> str:
    return str(path.resolve()).replace("\\", "/").replace("'", "'\\''")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _bitrate_bits(value: str) -> int:
    normalized = value.strip().upper()
    multiplier = 1
    if normalized.endswith("K"):
        normalized, multiplier = normalized[:-1], 1_000
    elif normalized.endswith("M"):
        normalized, multiplier = normalized[:-1], 1_000_000
    elif normalized.endswith("G"):
        normalized, multiplier = normalized[:-1], 1_000_000_000
    return int(float(normalized) * multiplier)


def build_stream_capture_mkv_command(
    output_dir: Path | None = None,
    *,
    stream_label: str = "virtual",
    run_id: str = "manual",
    config: RecordingConfig | None = None,
) -> RecorderCommand:
    """ffmpeg command that ENCODES a raw BGR frame stream piped on stdin into an
    MKV. The recorder behaves like a real capture card: it captures the frames
    flowing through the (virtual) capture device at 1x and encodes them — it does
    NOT re-read or transcode the source video file."""
    config = config or RecordingConfig()
    output_dir = assert_write_allowed(output_dir or recordings_root())
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = assert_write_allowed(
        output_dir / f"{_safe_name(run_id)}_{_safe_name(stream_label)}_{config.width}x{config.height}.mkv"
    )
    input_args = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
        "-s",
        f"{config.width}x{config.height}",
        "-framerate",
        str(config.fps),
        "-i",
        "pipe:0",
    ]
    args = [
        *input_args,
        "-map",
        "0:v:0",
        *_encoder_args(config),
        "-pix_fmt",
        config.pixel_format,
        "-r",
        str(config.fps),
        str(output_path),
    ]
    return RecorderCommand(args=args, output_pattern=output_path)


def _feed_frames(recording: "RecordingProcess") -> None:
    """Feeder thread: drain captured frames from the bounded queue, resize to the
    recording size, and write raw bytes to ffmpeg's stdin. Exits on the ``None``
    sentinel or a broken pipe; never raises into the capture pipeline."""
    process = recording.process
    if process is None or process.stdin is None:
        return
    import cv2  # type: ignore  # legacy virtual/file recorder only
    w, h = int(recording.width), int(recording.height)
    stdin = process.stdin
    try:
        while True:
            item = recording._queue.get()
            if item is None:  # stop sentinel
                break
            try:
                if item.shape[1] != w or item.shape[0] != h:
                    item = cv2.resize(item, (w, h), interpolation=cv2.INTER_AREA)
                stdin.write(item.tobytes())
                recording.frames_written += 1
            except (BrokenPipeError, OSError, ValueError):
                break
    finally:
        try:
            stdin.close()
        except OSError:
            pass


class RecorderSupervisor:
    def __init__(self, run_id: str, output_dir: Path | None = None, config: RecordingConfig | None = None) -> None:
        self.run_id = run_id
        self.output_dir = assert_write_allowed(output_dir or recordings_root() / _safe_name(run_id))
        self.config = config or RecordingConfig()
        self.recordings: list[RecordingProcess] = []
        self.direct_recordings: list[DirectCaptureRecording] = []
        self.paths = RecordingRunPaths(self.output_dir.parent, _safe_name(run_id))
        self.manifest: RecordingRunManifest | None = None
        self.preflight_results: list[RecordingPreflightResult] = []

    def arm_capture_sources(self, sources: list[Any], timeout: float = 20.0) -> None:
        """Arm all live capture feeds as one transaction or roll them all back."""
        if not sources:
            return
        self.preflight_results = preflight_recording_environment(
            output_root=self.output_dir.parent,
            feed_count=len(sources),
            config=self.config,
        )
        feed_documents = [{
            "source_id": source.source_id,
            "stream_label": source.stream_label,
            "device_name": source.device_name,
            "device_alternative_name": source.device_alternative_name,
            "audio_device_name": getattr(source, "audio_device_name", ""),
            "audio_device_alternative_name": getattr(source, "audio_device_alternative_name", ""),
        } for source in sources]
        self.paths.create([source.stream_label for source in sources])
        self.manifest = RecordingRunManifest(self.paths, feeds=feed_documents)
        self.manifest.update(recording_config=asdict(self.config))
        self.manifest.transition(
            RecordingLifecycle.PREFLIGHTING,
            preflight=[asdict(result) for result in self.preflight_results],
        )
        failures = [result for result in self.preflight_results if not result.ok]
        signal_failures = [source.stream_label for source in sources if not source.signal_alive]
        if failures or signal_failures:
            message = "; ".join(result.message for result in failures)
            if signal_failures:
                message += ("; " if message else "") + "No ready signal: " + ", ".join(signal_failures)
            self.manifest.transition(RecordingLifecycle.ARMING_FAILED, retryable_action="retry_start", error=message)
            raise RuntimeError(message)
        self.manifest.transition(RecordingLifecycle.ARMING)
        armed: list[Any] = []
        try:
            for source in sources:
                recording = DirectCaptureRecording(
                    source_id=source.source_id,
                    stream_label=source.stream_label,
                    device_name=source.device_name,
                    device_alternative_name=source.device_alternative_name,
                    audio_device_name=getattr(source, "audio_device_name", ""),
                    audio_device_alternative_name=getattr(source, "audio_device_alternative_name", ""),
                    shared_writer_count=len(sources),
                    paths=self.paths,
                    config=self.config,
                )
                source.arm_recording(recording, timeout=timeout)
                self.direct_recordings.append(recording)
                armed.append(source)
        except Exception as error:
            for source in armed:
                source.disarm_recording()
            self.manifest.transition(
                RecordingLifecycle.ARMING_FAILED,
                retryable_action="retry_start",
                error=str(error),
                recordings=[recording.summary() for recording in self.direct_recordings],
            )
            raise
        self.manifest.transition(
            RecordingLifecycle.ACTIVE,
            recordings=[recording.summary() for recording in self.direct_recordings],
        )

    def transition(self, state: RecordingLifecycle, **details: Any) -> None:
        if self.manifest is not None and self.manifest.state != state:
            self.manifest.transition(state, **details)

    def assemble_and_validate(self) -> list[RecordingValidationResult]:
        validations = [assemble_recording(recording) for recording in self.direct_recordings]
        if self.manifest is not None:
            self.manifest.update(
                recordings=[recording.summary() for recording in self.direct_recordings],
                final_recordings=[asdict(validation) for validation in validations],
            )
        return validations

    def cleanup_validated_parts(self, validations: list[RecordingValidationResult]) -> None:
        for recording, validation in zip(self.direct_recordings, validations, strict=True):
            cleanup_assembled_parts(recording, validation)
        if self.manifest is not None:
            self.manifest.update(cleanup_complete=True)

    def start_stream_recording(self, *, source_id: str, stream_label: str) -> RecordingProcess:
        """Start a capture-card-style recorder: ffmpeg encodes a raw frame stream
        piped on stdin. Returns the RecordingProcess whose ``submit(frame)`` the
        capture source calls per decoded frame."""
        command = build_stream_capture_mkv_command(
            self.output_dir,
            stream_label=stream_label,
            run_id=self.run_id,
            config=self.config,
        )
        recording = RecordingProcess(
            source_id=source_id,
            stream_label=stream_label,
            command=command,
            width=self.config.width,
            height=self.config.height,
            _queue=queue.Queue(maxsize=max(2, int(self.config.virtual_stream_queue_frames))),
        )
        self._start_pipe_process(recording)
        self.recordings.append(recording)
        self.write_summary()
        return recording

    def stop_all(self, timeout: float = 10.0) -> None:
        for recording in self.recordings:
            self._stop_process(recording, timeout)
        self.write_summary()

    def refresh(self) -> None:
        for recording in self.recordings:
            if recording.process is not None and recording.process.poll() is not None and recording.state == RecorderState.RUNNING:
                recording.state = RecorderState.STOPPED if recording.process.returncode == 0 else RecorderState.FAILED
                recording.stopped_at = time.time()
                if recording.process.returncode != 0:
                    recording.error = f"ffmpeg exited with code {recording.process.returncode}"
                self._close_stderr(recording)
        self.write_summary()

    def summary(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "recording_root": str(self.output_dir),
            "config": {
                "width": self.config.width,
                "height": self.config.height,
                "video_bitrate": self.config.video_bitrate,
                "maxrate": self.config.maxrate,
                "bufsize": self.config.bufsize,
                "pixel_format": self.config.pixel_format,
                "encoder_preference": self.config.encoder_preference,
            },
            "recordings": [recording_summary(recording) for recording in self.recordings],
            "direct_recordings": [recording.summary() for recording in self.direct_recordings],
            "lifecycle": self.manifest.state.value if self.manifest is not None else None,
            "manifest": str(self.paths.manifest) if self.manifest is not None else "",
            "preflight": [asdict(result) for result in self.preflight_results],
        }

    def write_summary(self) -> Path:
        DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
        path = assert_write_allowed(DIAGNOSTICS_ROOT / "recording_supervisor_summary.json")
        path.write_text(json.dumps(self.summary(), indent=2, sort_keys=True), encoding="utf-8")
        return path

    def _start_process(self, recording: RecordingProcess) -> None:
        if shutil.which("ffmpeg") is None:
            recording.state = RecorderState.FAILED
            recording.error = "ffmpeg was not found on PATH"
            return
        log_path = assert_write_allowed(self.output_dir / f"{_safe_name(recording.stream_label)}_ffmpeg_stderr.log")
        handle = log_path.open("w", encoding="utf-8", errors="replace")
        recording.stderr_log_path = log_path
        recording._stderr_handle = handle
        recording.started_at = time.time()
        try:
            recording.process = subprocess.Popen(recording.command.args, stdout=subprocess.DEVNULL, stderr=handle)
            recording.state = RecorderState.RUNNING
        except Exception as exc:
            recording.state = RecorderState.FAILED
            recording.error = str(exc)
            self._close_stderr(recording)

    def _start_pipe_process(self, recording: RecordingProcess) -> None:
        if shutil.which("ffmpeg") is None:
            recording.state = RecorderState.FAILED
            recording.error = "ffmpeg was not found on PATH"
            return
        log_path = assert_write_allowed(self.output_dir / f"{_safe_name(recording.stream_label)}_ffmpeg_stderr.log")
        handle = log_path.open("w", encoding="utf-8", errors="replace")
        recording.stderr_log_path = log_path
        recording._stderr_handle = handle
        recording.started_at = time.time()
        try:
            recording.process = subprocess.Popen(
                recording.command.args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=handle
            )
            recording.state = RecorderState.RUNNING
            recording._feeder = threading.Thread(
                target=_feed_frames, args=(recording,), name=f"recorder-feeder-{recording.stream_label}", daemon=True
            )
            recording._feeder.start()
        except Exception as exc:
            recording.state = RecorderState.FAILED
            recording.error = str(exc)
            self._close_stderr(recording)

    def _stop_process(self, recording: RecordingProcess, timeout: float) -> None:
        process = recording.process
        if process is None:
            return
        recording.state = RecorderState.STOPPING
        if recording._queue is not None:
            # Stream-capture: stop the feeder so it drains + closes stdin, letting
            # ffmpeg finalize the MKV cleanly (terminating would corrupt the file).
            try:
                recording._queue.put_nowait(None)
            except queue.Full:
                try:
                    recording._queue.get_nowait()
                except queue.Empty:
                    pass
                try:
                    recording._queue.put_nowait(None)
                except queue.Full:
                    pass
            if recording._feeder is not None:
                recording._feeder.join(timeout=timeout)
            if process.poll() is None:
                try:
                    process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5.0)
        elif process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5.0)
        recording.stopped_at = time.time()
        recording.state = RecorderState.STOPPED if process.returncode == 0 else RecorderState.FAILED
        if process.returncode not in (0, None):
            recording.error = f"ffmpeg exited with code {process.returncode}"
        self._close_stderr(recording)

    @staticmethod
    def _close_stderr(recording: RecordingProcess) -> None:
        if recording._stderr_handle is not None:
            recording._stderr_handle.close()
            recording._stderr_handle = None


def recording_summary(recording: RecordingProcess) -> dict[str, Any]:
    output = recording.output_path
    stderr_tail = ""
    if recording.stderr_log_path and recording.stderr_log_path.exists():
        stderr_tail = recording.stderr_log_path.read_text(encoding="utf-8", errors="replace")[-4000:]
    return {
        "source_id": recording.source_id,
        "stream_label": recording.stream_label,
        "state": recording.state.value,
        "output_path": str(output),
        "output_exists": output.exists(),
        "output_bytes": output.stat().st_size if output.exists() else 0,
        "command": recording.command.args,
        "started_at": recording.started_at,
        "stopped_at": recording.stopped_at,
        "frames_submitted": recording.frames_submitted,
        "frames_written": recording.frames_written,
        "frames_dropped": recording.frames_dropped,
        "error": recording.error,
        "stderr_log_path": str(recording.stderr_log_path) if recording.stderr_log_path else "",
        "stderr_tail": stderr_tail,
    }


def recordings_root() -> Path:
    return assert_write_allowed(LIVE_OUTPUT / "recordings")


def _encoder_args(config: RecordingConfig) -> list[str]:
    if config.encoder_preference == "x264":
        return _x264_args(config)
    if config.encoder_preference == "nvenc":
        return _nvenc_args(config)
    raise ValueError(f"Unsupported recording encoder profile: {config.encoder_preference}")


def _nvenc_args(config: RecordingConfig) -> list[str]:
    return [
        "-c:v",
        "h264_nvenc",
        "-preset",
        config.nvenc_preset,
        "-b:v",
        config.video_bitrate,
        "-maxrate",
        config.maxrate,
        "-bufsize",
        config.bufsize,
    ]


def _x264_args(config: RecordingConfig) -> list[str]:
    return [
        "-c:v",
        "libx264",
        "-preset",
        config.x264_preset,
        "-b:v",
        config.video_bitrate,
        "-maxrate",
        config.maxrate,
        "-bufsize",
        config.bufsize,
    ]


def _safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in value).strip("_") or "capture"
