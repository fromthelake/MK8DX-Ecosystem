"""Runs the recorded-video processing as a child process and streams its output.

Ported from the MK8DX Live Video Processor post-analysis GUI (live_processor/baseline_extractor/gui/
process_runner.py). Where the original re-invoked its own engine's ``main.py``, this runner only ever starts the
central route: the existing
``python -m tournament_processor.vision_cli all ...`` command, built by ``tournament_processor.gui.RunPlan``; this
runner never recognises anything itself. A :class:`QProcess` delivers the child's output to the GUI thread through
signals, so the window never freezes and cancelling stays isolated from the GUI process.

One addition to the original: before the process starts, the plan's recordings are linked (or, across drives,
copied) into the session's Input_Videos on a worker thread, because vision_cli reads recordings from there.
"""

from __future__ import annotations

import sys
import threading

from PySide6.QtCore import QObject, QProcess, QProcessEnvironment, Signal

from ..gui import PlanError, RunPlan, Texts, child_environment, stage_recordings
from ..log_format import LineBuffer, parse_percent


class PipelineRunner(QObject):
    """Owns a single QProcess running one analysis at a time."""

    line = Signal(str)            # one line of child output (ANSI colour codes kept for the log view)
    progress = Signal(int)        # 0-100 when the engine prints a percentage
    status = Signal(str)          # short status while recordings are being prepared
    started = Signal(str)         # human-readable label of the run that started
    finished = Signal(str, int)   # ("done" | "cancelled" | "failed", exit_code)
    failed_to_start = Signal(str)  # a PlanError message from staging
    _staged = Signal(object)      # internal: staging finished (None or a PlanError)
    _relay = Signal(str, str)     # internal: a staging message from the worker thread ("status" | "line", text)

    def __init__(self, texts: Texts, parent: QObject | None = None):
        super().__init__(parent)
        self._t = texts
        self._process: QProcess | None = None
        self._buffer = LineBuffer()
        self._cancelled = False
        self._staging = False
        self._label = ""
        self._plan: RunPlan | None = None
        # Bound-method connections on this GUI-thread object are queued when emitted from the worker thread.
        self._staged.connect(self._on_staged)
        self._relay.connect(self._on_relay)

    # -- state ---------------------------------------------------------------
    def is_running(self) -> bool:
        return self._staging or (self._process is not None and self._process.state() != QProcess.NotRunning)

    # -- control -------------------------------------------------------------
    def start_plan(self, label: str, plan: RunPlan) -> None:
        if self.is_running():
            return
        self._cancelled = False
        self._staging = True
        self._label = label
        self._plan = plan
        self.started.emit(label)

        def work() -> None:
            try:
                stage_recordings(
                    plan,
                    lambda key, values: self._relay.emit(
                        "status" if key == "status_staging" else "line", self._t(key, **values)),
                    lambda: self._cancelled,
                )
                plan.runtime_root.mkdir(parents=True, exist_ok=True)
                self._staged.emit(None)
            except PlanError as error:
                self._staged.emit(error)
            except OSError as error:
                self._staged.emit(PlanError("err_stage", path=plan.runtime_root, error=error))

        threading.Thread(target=work, name="tournament-analysis-staging", daemon=True).start()

    def _on_relay(self, kind: str, text: str) -> None:
        (self.status if kind == "status" else self.line).emit(text)

    def _on_staged(self, error) -> None:
        self._staging = False
        if error is not None:
            self.failed_to_start.emit(error.message(self._t))
            self.finished.emit("failed", -1)
            return
        if self._cancelled or self._plan is None:
            self.finished.emit("cancelled", 0)
            return
        command = self._plan.command()
        self.line.emit(self._t("log_command", command=" ".join(_quote(part) for part in command)))
        self._launch(command[0], command[1:], str(self._plan.runtime_root))

    def _launch(self, program: str, args: list[str], working_dir: str) -> None:
        self._buffer = LineBuffer()
        process = QProcess(self)
        process.setProcessChannelMode(QProcess.MergedChannels)
        process.setWorkingDirectory(working_dir)
        process.setProgram(program)
        process.setArguments(args)

        environment = QProcessEnvironment()
        for key, value in child_environment().items():
            environment.insert(key, value)
        # Ask the engine for ANSI colour codes even through a pipe; the log view renders them.
        environment.insert("MK8_FORCE_COLOR", "1")
        environment.remove("NO_COLOR")
        process.setProcessEnvironment(environment)

        process.readyReadStandardOutput.connect(self._on_ready_read)
        process.finished.connect(self._on_finished)
        process.errorOccurred.connect(self._on_error)

        self._process = process
        process.start()

    def cancel(self) -> None:
        if not self.is_running():
            return
        self._cancelled = True
        self.line.emit("\n" + self._t("log_cancelling") + "\n")
        if self._process is not None:
            _kill_process_tree(self._process)

    # -- internals -----------------------------------------------------------
    def _on_ready_read(self) -> None:
        if self._process is None:
            return
        raw = bytes(self._process.readAllStandardOutput().data())
        for text in self._buffer.feed(raw.decode("utf-8", errors="replace")):
            self._emit_line(text)

    def _emit_line(self, text: str) -> None:
        self.line.emit(text)
        percent = parse_percent(text)
        if percent is not None:
            self.progress.emit(percent)

    def _on_error(self, _error) -> None:
        if self._process is None:
            return
        self.line.emit(self._t("log_process_error", error=self._process.errorString()))
        if self._process.state() == QProcess.NotRunning and _error == QProcess.FailedToStart:
            process, self._process = self._process, None
            process.deleteLater()
            self.finished.emit("failed", -1)

    def _on_finished(self, exit_code: int, _exit_status) -> None:
        for text in self._buffer.flush():
            self._emit_line(text)
        if self._cancelled:
            kind = "cancelled"
        else:
            kind = "done" if exit_code == 0 else "failed"
        process = self._process
        self._process = None
        if process is not None:
            process.deleteLater()
        self.finished.emit(kind, int(exit_code))


def _quote(part: str) -> str:
    return f'"{part}"' if (" " in part or not part) else part


def _kill_process_tree(process: QProcess) -> None:
    """Best-effort kill of the child *and* any grandchildren it spawned (``taskkill /T`` on Windows).

    Elsewhere only the direct child is terminated: QProcess does not start the child in its own process group, so
    a process-group kill (the Live Video Processor version) could hit the GUI's own group. The Video Result
    Extractor version of this runner already made that correction; it is kept here.
    """
    pid = int(process.processId())
    if pid <= 0:
        process.kill()
        return
    if sys.platform.startswith("win"):
        try:
            import subprocess

            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return
        except Exception:  # noqa: BLE001 - fall back to Qt's own kill
            pass
        process.kill()
        return
    process.terminate()
    if not process.waitForFinished(1500):
        process.kill()


__all__ = ["PipelineRunner"]
