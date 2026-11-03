"""Recorded extraction/OCR overlap, ported from the source Extractor's main.py.

The source's race/video jobs, spawn consumers, three queues, revision barrier,
per-video finalization and one-consumer in-memory path are retained. Recognition
and export still belong to the engine. This module adds supervised worker exits
and exception-safe cleanup; a lost child must not leave a collector waiting for
a sentinel forever. See VIDEO_PROCESSING_PARITY_INVENTORY_2026-09-05.md.
"""
from __future__ import annotations

import json
import multiprocessing as mp
import os
import queue
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence


def select_overlap_mode(config, *, gpu_enabled: bool, video_count: int) -> str:
    """Actual execution mode, distinct from the independent GPU thread policy."""
    enabled = os.environ.get("MK8_OVERLAP_OCR_BY_VIDEO", "1" if gpu_enabled else "0")
    if enabled.strip().lower() in {"0", "false", "no", "off"} or not gpu_enabled or video_count < 2:
        return "sequential"
    # The source's single consumer reads whole videos, with their frame cache.
    if config.overlap_ocr_consumers == 1:
        return "video"
    return "race" if config.overlap_ocr_mode == "auto" else config.overlap_ocr_mode


class _Trace:
    def __init__(self, path: Path | None, report: Callable | None = None):
        self.started = time.perf_counter()
        self.lock = threading.Lock()
        self.handle = None
        self.report = report
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            self.handle = path.open("w", encoding="utf-8")

    def emit(self, event: str, **details) -> None:
        if self.report is not None:
            self.report(event, details)
        if self.handle is None:
            return
        stamp = details.pop("monotonic_s", time.perf_counter())
        # OCR progress carries a phase-local elapsed_s; the trace clock is always
        # run-relative, even when the two queues deliver events out of order.
        record = {**details, "event": event, "elapsed_s": stamp - self.started,
                  "pid": details.get("pid", os.getpid())}
        with self.lock:
            self.handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            self.handle.flush()

    def close(self) -> None:
        if self.handle is not None:
            self.handle.close()


def _read_race(job: dict, progress: Callable) -> dict:
    from .engine import extract_text
    from .engine.project_paths import PROJECT_ROOT

    debug = PROJECT_ROOT / "Output_Results" / "Debug" / "Score_Frames"
    if extract_text.APP_CONFIG.write_debug_score_images:
        debug.mkdir(parents=True, exist_ok=True)
    return extract_text.process_race_group(
        job["grouped_item"], str(debug),
        extract_text.load_exported_frame_metadata(PROJECT_ROOT),
        PROJECT_ROOT / "Input_Videos", None,
    )


def _read_video(job: dict, progress: Callable) -> dict:
    from .engine import extract_text
    from .engine.project_paths import PROJECT_ROOT

    return extract_text.process_images_in_folder(
        str(PROJECT_ROOT / "Output_Results" / "Frames"),
        selected_race_classes=[job["video_label"]],
        in_memory_frame_bundles=job.get("frame_bundle_cache"),
        metadata_index_override=job.get("metadata_index"),
        write_outputs=False, emit_logs=False, progress_callback=progress,
    )


def _ocr_worker(jobs, results, progress_queue, stop, read_job: Callable) -> None:
    """Top-level spawn target; engine imports happen inside the configured child."""
    pid = os.getpid()
    try:
        while not stop.is_set():
            try:
                job = jobs.get(timeout=0.2)
            except queue.Empty:
                continue
            if job is None:
                break
            identity = {key: job[key] for key in ("video_label", "race_id", "ocr_revision") if key in job}
            progress_queue.put({"event": "job_start", "pid": pid, "monotonic_s": time.perf_counter(), **identity})

            def progress(event):
                progress_queue.put({**event, "event": "ocr_progress", "pid": pid, **identity})

            try:
                result = read_job(job, progress)
            except BaseException as exc:
                results.put({"event": "error", "error": repr(exc), "pid": pid, **identity})
                break
            results.put({"event": "result", "result": result, "pid": pid,
                         "monotonic_s": time.perf_counter(), **identity})
    finally:
        results.put({"event": "worker_exit", "pid": pid})
        progress_queue.put({"event": "worker_exit", "pid": pid})


@dataclass
class _VideoState:
    expected: dict[int, int] = field(default_factory=dict)
    completed: dict[int, int] = field(default_factory=dict)
    races: dict[int, dict] = field(default_factory=dict)
    extraction_complete: bool = False
    duration_s: float = 0.0
    future: Future | None = None
    result: dict | None = None


class _OverlapSession:
    """Own workers until the extraction producer and all finalizers have finished."""
    def __init__(self, *, mode: str, consumers: int, video_labels: Sequence[str],
                 finalize: Callable, trace: _Trace, read_job: Callable | None = None):
        self.mode = mode
        self.consumers = consumers
        self.trace = trace
        self.finalize = finalize
        self.read_job = read_job or (_read_race if mode == "race" else _read_video)
        self.states = {label: _VideoState() for label in video_labels}
        self.lock = threading.RLock()
        self.error: BaseException | None = None
        self.stopping = threading.Event()
        self.workers = []
        self.collectors = []
        self.result_exits = 0
        self.progress_exits = 0
        self.job_completion_times: list[float] = []
        self.finalizers = ThreadPoolExecutor(max_workers=max(1, min(2, consumers)))
        self.multi_process = consumers > 1
        context = mp.get_context("spawn") if self.multi_process else None
        self.jobs = context.Queue() if context else queue.Queue()
        self.results = context.Queue() if context else queue.Queue()
        self.progress = context.Queue() if context else queue.Queue()
        self.worker_stop = context.Event() if context else threading.Event()
        self.context = context

    def start(self) -> None:
        for index in range(self.consumers):
            factory = self.context.Process if self.context else threading.Thread
            worker = factory(target=_ocr_worker,
                             args=(self.jobs, self.results, self.progress, self.worker_stop, self.read_job),
                             name=f"mk8-ocr-overlap-{index + 1}", daemon=True)
            worker.start()
            self.workers.append(worker)
        for target in (self._collect_results, self._collect_progress):
            thread = threading.Thread(target=target, name=f"mk8-{target.__name__}", daemon=True)
            thread.start()
            self.collectors.append(thread)

    def _fail(self, error: BaseException) -> None:
        with self.lock:
            if self.error is None:
                self.error = error

    def check(self) -> None:
        with self.lock:
            if self.error is not None:
                raise RuntimeError(f"Overlapped OCR failed: {self.error}") from self.error

    def _state(self, label: str) -> _VideoState:
        if label not in self.states:
            raise RuntimeError(f"Unexpected extracted video: {label}")
        return self.states[label]

    def enqueue_race(self, label: str, race_id: int, revision: int, grouped_item) -> None:
        with self.lock:
            self.check()
            state = self._state(label)
            if state.extraction_complete:
                raise RuntimeError(f"Race arrived after extraction completed: {label}")
            if revision <= state.expected.get(race_id, 0):
                return
            state.expected[race_id] = revision
            self.trace.emit("race_queued", video_label=label, race_id=race_id, ocr_revision=revision)
            self.jobs.put({"video_label": label, "race_id": race_id, "ocr_revision": revision,
                           "grouped_item": grouped_item})

    def complete_video(self, payload: dict, grouped_items=None) -> None:
        label = str(payload["video_label"])
        with self.lock:
            self.check()
            state = self._state(label)
            if state.extraction_complete:
                raise RuntimeError(f"Duplicate video completion: {label}")
            if self.mode == "race":
                race_ids = {int(key[1]) for key, _ in grouped_items}
                # An old frame directory must not silently become a current race.
                if race_ids != set(state.expected):
                    raise RuntimeError(f"Extracted/queued race set differs for {label}")
            state.extraction_complete = True
            self.trace.emit("video_extraction_complete", video_label=label, expected_races=len(state.expected))
            if self.mode == "race":
                self._try_finalize(label, state)
            else:
                job = {"video_label": label}
                if not self.multi_process:
                    job.update(frame_bundle_cache=payload.get("frame_bundle_cache"),
                               metadata_index=payload.get("metadata_index"))
                self.trace.emit("video_queued", video_label=label)
                self.jobs.put(job)

    def _try_finalize(self, label: str, state: _VideoState) -> None:
        if not state.extraction_complete or state.future is not None or state.result is not None:
            return
        if any(state.completed.get(race_id, 0) < revision for race_id, revision in state.expected.items()):
            return
        if not state.expected:
            state.result = {"race_count": 0}
            return
        rows = [row for race_id in sorted(state.expected) for row in state.races[race_id].get("rows", [])]
        self.trace.emit("video_finalize_queued", video_label=label, race_count=len(state.expected))
        state.future = self.finalizers.submit(self._finalize_video, label, rows, state.duration_s)

    def _finalize_video(self, label, rows, duration_s):
        # Start/finish measure actual work, independently of executor queue wait
        # and the parent collector's polling interval.
        self.trace.emit("video_finalize_start", video_label=label)
        result = self.finalize(label, rows, duration_s)
        self.trace.emit("video_finalize_complete", video_label=label, race_count=result.get("race_count", 0))
        return result

    def _drain_finalizers(self) -> None:
        with self.lock:
            for label, state in self.states.items():
                if state.future is not None and state.future.done() and state.result is None:
                    state.result = state.future.result()

    def _accept_result(self, message: dict) -> None:
        with self.lock:
            label = str(message["video_label"])
            state = self._state(label)
            self.job_completion_times.append(message["monotonic_s"])
            self.trace.emit("job_complete", **{k: v for k, v in message.items() if k not in {"event", "result"}})
            if self.mode == "video":
                state.result = message["result"]
                return
            race_id, revision = int(message["race_id"]), int(message["ocr_revision"])
            if race_id not in state.expected:
                raise RuntimeError(f"Unrequested OCR result: {label} race {race_id}")
            state.duration_s += float(message["result"].get("duration_s", 0.0))
            if revision >= state.expected[race_id] and revision >= state.completed.get(race_id, 0):
                state.completed[race_id] = revision
                state.races[race_id] = message["result"]
            self._try_finalize(label, state)

    def _check_worker_exits(self) -> None:
        if not self.multi_process:
            return
        for worker in self.workers:
            if worker.exitcode is not None and worker.exitcode != 0:
                raise RuntimeError(f"OCR worker {worker.pid} exited with code {worker.exitcode}")
        # Called after a queue timeout: once all writers exited, no result is in
        # flight (a normal multiprocessing exit flushes its queue feeder).
        if self.workers and all(worker.exitcode is not None for worker in self.workers):
            if self.result_exits < len(self.workers):
                raise RuntimeError("OCR worker exited without its completion message")

    def _collect_results(self) -> None:
        try:
            while not self.stopping.is_set():
                try:
                    message = self.results.get(timeout=0.2)
                except queue.Empty:
                    self._check_worker_exits()
                    self._drain_finalizers()
                    continue
                if message["event"] == "worker_exit":
                    self.result_exits += 1
                elif message["event"] == "error":
                    raise RuntimeError(f"{message.get('video_label')}: {message['error']}")
                else:
                    self._accept_result(message)
                self._drain_finalizers()
        except BaseException as exc:
            self._fail(exc)

    def _collect_progress(self) -> None:
        try:
            while not self.stopping.is_set():
                try:
                    event = self.progress.get(timeout=0.2)
                except queue.Empty:
                    continue
                if event["event"] == "worker_exit":
                    self.progress_exits += 1
                else:
                    self.trace.emit(event.pop("event"), **event)
        except BaseException as exc:
            self._fail(exc)

    def finish(self) -> list[dict]:
        for _ in self.workers:
            self.jobs.put(None)
        while self.result_exits < self.consumers or self.progress_exits < self.consumers:
            self.check()
            time.sleep(0.05)
        self.check()
        for state in self.states.values():
            if state.future is not None:
                state.future.result()
        self._drain_finalizers()
        self.check()
        incomplete = [label for label, state in self.states.items()
                      if not state.extraction_complete or state.result is None]
        if incomplete:
            raise RuntimeError(f"Incomplete extracted/OCR videos: {', '.join(incomplete)}")
        return [state.result for state in self.states.values()]

    def close(self) -> None:
        self.worker_stop.set()
        self.stopping.set()
        # Termination is only needed for an interrupted/failed run. Normal workers
        # have already acknowledged their sentinel; allow their feeder to drain.
        for worker in self.workers:
            worker.join(timeout=1.0 if self.multi_process else None)
            if self.multi_process and worker.is_alive():
                worker.terminate()
                worker.join(timeout=5.0)
                if worker.is_alive():
                    worker.kill()
                    worker.join()
        for collector in self.collectors:
            collector.join()
        self.finalizers.shutdown(wait=True, cancel_futures=True)
        if self.multi_process:
            for channel in (self.jobs, self.results, self.progress):
                channel.cancel_join_thread()
                channel.close()
            for worker in self.workers:
                worker.close()


def run_recorded_pipeline(*, selected_videos, selected_race_classes,
                          include_subfolders: bool, video_labels: Sequence[str],
                          diagnostics_path: Path | None = None) -> dict:
    """Run the source's overlapped workflow and return the ordinary OCR payload."""
    from .engine import extract_frames, extract_text
    from .engine.app_runtime import easyocr_gpu_enabled, load_app_config
    from .engine.console_logging import LOGGER
    from .engine.ocr_export import build_completion_payload
    from .engine.project_paths import PROJECT_ROOT

    config = load_app_config()
    mode = select_overlap_mode(config, gpu_enabled=easyocr_gpu_enabled(config), video_count=len(video_labels))
    LOGGER.reset()
    LOGGER.log("[Run - Settings]", f"Execution: {mode} | OCR consumers: "
               f"{config.overlap_ocr_consumers if mode != 'sequential' else 0}", color_name="cyan")
    if diagnostics_path is None and os.environ.get("MK8_OVERLAP_OCR_DIAGNOSTICS", "0").lower() in {"1", "true", "yes", "on"}:
        diagnostics_path = PROJECT_ROOT / "Output_Results" / "Debug" / f"overlap-{time.time_ns()}.jsonl"
    def report(event, details):
        if event not in {"job_complete", "video_finalize_complete"}:
            return
        label = str(details.get("video_label", "")).rsplit("__", 1)[-1]
        detail = (f"Race {details['race_id']:03} | Revision {details['ocr_revision']}"
                  if "race_id" in details else f"Races {details.get('race_count', '?')}")
        LOGGER.log("[Run - Overlap]", f"{label} | {event} | {detail}", color_name="green")

    trace = _Trace(diagnostics_path, report=report)
    trace.emit("run_start", mode=mode, consumers=config.overlap_ocr_consumers if mode != "sequential" else 0)
    stop_sampler = threading.Event()

    def sample():
        while not stop_sampler.wait(2.0):
            resources = LOGGER.resources.sample()
            trace.emit("resources", scope="host", **vars(resources))

    sampler = threading.Thread(target=sample, name="mk8-overlap-diagnostics", daemon=True)
    if diagnostics_path is not None:
        sampler.start()
    session = None
    frames = str(PROJECT_ROOT / "Output_Results" / "Frames")
    started = time.time()

    def finalize(label, rows, duration_s):
        # Source race-overlap finalization is deliberately preserved, including
        # its identity/scoring/character refinement order. No second OCR pass.
        return extract_text.finalize_ocr_results(
            rows, folder_path=frames, phase_start_time=time.time(),
            per_video_ocr_durations={label: duration_s}, progress_peak_lines=[],
            ocr_profiler_lines=[], write_outputs=False, emit_logs=False,
        )

    try:
        if mode == "sequential":
            extract_frames.extract_frames(return_frame_cache=False, selected_videos=selected_videos,
                                          include_subfolders=include_subfolders)
            trace.emit("extraction_complete")
            payload = extract_text.process_images_in_folder(frames, selected_race_classes=selected_race_classes)
        else:
            session = _OverlapSession(mode=mode, consumers=config.overlap_ocr_consumers,
                                      video_labels=video_labels, finalize=finalize, trace=trace)
            session.start()

            def race_complete(payload):
                session.check()
                label, race_id = str(payload["video_label"]), int(payload["race_number"])
                session.enqueue_race(label, race_id, max(1, int(payload.get("ocr_revision", 1))),
                                     extract_text.build_grouped_race_item(frames, label, race_id))

            def video_complete(payload):
                session.check()
                grouped = extract_text.build_grouped_race_images(
                    frames, selected_race_classes=[payload["video_label"]]) if mode == "race" else None
                session.complete_video(payload, grouped)

            extract_frames.extract_frames(
                return_frame_cache=not session.multi_process, selected_videos=selected_videos,
                include_subfolders=include_subfolders, per_video_complete_callback=video_complete,
                per_race_complete_callback=race_complete if mode == "race" else None,
            )
            extraction_finished = time.perf_counter()
            trace.emit("extraction_complete", monotonic_s=extraction_finished)
            results = session.finish()
            import pandas as pd

            dataframes = [result["df"] for result in results if result.get("df") is not None and not result["df"].empty]
            if not dataframes:
                raise RuntimeError("No races were extracted; no results exported")
            # Same stable merge/export boundary as _run_all_with_video_overlap.
            combined = pd.DataFrame.from_records(
                [record for frame in dataframes for record in frame.to_dict("records")],
                columns=list(dataframes[0].columns),
            ).sort_values(["RaceClass", "RaceIDNumber", "RacePosition"], kind="stable").reset_index(drop=True)
            durations = {label: duration for result in results for label, duration in result.get("per_video_durations", {}).items()}
            payload = build_completion_payload(
                combined, frames, started, [], [f"OCR mode: overlap by {mode}",
                f"OCR consumers: {config.overlap_ocr_consumers}"], durations,
                extract_text.build_race_warning_messages, extract_text.pluralize, extract_frames.format_duration,
            )
            payload["overlap_completed_jobs"] = sum(stamp < extraction_finished for stamp in session.job_completion_times)
            LOGGER.summary_block("[OCR - Phase Complete]", payload["lines"], color_name="green")
            LOGGER.log("[Run - Overlap]", f"OCR jobs finished before extraction completed: {payload['overlap_completed_jobs']}", color_name="green")
        trace.emit("run_complete", mode=mode, race_count=payload.get("race_count", 0),
                   wall_seconds=time.time() - started)
        return payload
    except BaseException as exc:
        trace.emit("run_failed", error=repr(exc))
        raise
    finally:
        if session is not None:
            session.close()
        stop_sampler.set()
        if sampler.is_alive():
            sampler.join()
        trace.close()
