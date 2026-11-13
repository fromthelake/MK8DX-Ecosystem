"""Main window of the Qt analysis GUI, ported from the MK8DX Live Video Processor post-analysis GUI
(live_processor/baseline_extractor/gui/main_window.py).

The layout guides the operator through the race order, top to bottom:

    [ banner ]
    ① Choose recordings  →  ② Choose videos  →  ③ Run  →  🏁 Results
    [ live activity log ]
    [ Rainbow Road progress bar + start-light status ]

All long-running work goes to :class:`PipelineRunner`, which runs the existing ``vision_cli all`` command as a
child process, so the window stays responsive and shows a live, coloured log, a progress bar and a working
Cancel button. The plan (which recordings, which session folder, which command) comes from
``tournament_processor.gui`` and is the same one the classic Tkinter window uses. The original's bridge to its own
engine (core_bridge.py and the flags of its main.py: extract-only, OCR-only, subfolders, CPU/GPU modes, clean-up)
is not ported: this window only starts the central ``vision_cli all`` route.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Sequence

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QFileDialog,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from ..gui import (
    OUTPUT_FOLDER,
    VIDEO_SUFFIXES,
    PlanError,
    Texts,
    build_plan,
    check_environment,
    default_runtime_root,
    default_session_id,
    entry_is_folder,
    folder_videos,
    open_folder,
)
from .ansi_log import AnsiLogView
from .banner import HeaderBanner
from .process_runner import PipelineRunner
from .start_light import StartLight


def _hint(text: str, name: str = "cardHint") -> QLabel:
    label = QLabel(text)
    label.setObjectName(name)
    label.setWordWrap(True)
    return label


def _numbered_card(number: str, title: str, hint: str | None = None) -> tuple[QFrame, QVBoxLayout]:
    """A stage card with a numbered badge header, returning (frame, body layout)."""
    frame = QFrame()
    frame.setObjectName("card")
    layout = QVBoxLayout(frame)
    layout.setContentsMargins(13, 9, 13, 10)
    layout.setSpacing(6)

    header = QHBoxLayout()
    header.setSpacing(8)
    badge = QLabel(number)
    badge.setObjectName("stepBadge")
    title_label = QLabel(title)
    title_label.setObjectName("cardTitle")
    header.addWidget(badge)
    header.addWidget(title_label)
    header.addStretch(1)
    layout.addLayout(header)
    if hint:
        layout.addWidget(_hint(hint))
    return frame, layout


class MainWindow(QWidget):
    def __init__(self, texts: Texts, entries: Sequence[Path] = (), runtime_root: Path | None = None,
                 session_id: str | None = None, background: Path | None = None):
        super().__init__()
        self.t = texts
        self._background = background
        self.setObjectName("root")
        self.setWindowTitle(texts("title"))
        self.resize(1060, 700)
        self.setMinimumSize(900, 600)

        self._runner = PipelineRunner(texts, self)
        self._runner.line.connect(self._on_line)
        self._runner.status.connect(lambda text: self._status_text.setText(text))
        self._runner.progress.connect(self._on_progress)
        self._runner.started.connect(self._on_started)
        self._runner.finished.connect(self._on_finished)
        self._runner.failed_to_start.connect(self._on_failed_to_start)

        self._run_start_time = 0.0
        self._run_label = ""
        self._last_output: Path | None = None
        self._elapsed_timer = QTimer(self)
        self._elapsed_timer.setInterval(1000)
        self._elapsed_timer.timeout.connect(self._tick_elapsed)

        self._busy_widgets: list[QWidget] = []
        self._session_edited = session_id is not None
        self._root_edited = runtime_root is not None

        self._build_ui()
        if session_id is not None:
            self._session_edit.setText(session_id)
        if runtime_root is not None:
            self._root_edit.setText(str(runtime_root))
            self._root_edit.setCursorPosition(0)
        self.add_entries(entries)
        self._log.append_ansi(self.t("log_intro"))
        self._set_status("ready", self.t("status_on_line"))

    # -- construction --------------------------------------------------------
    def _build_ui(self) -> None:
        outer = QVBoxLayout(self)
        outer.setContentsMargins(14, 12, 14, 10)
        outer.setSpacing(10)

        outer.addWidget(HeaderBanner(self.t("banner_title"), self.t("banner_subtitle"), self._background))

        splitter = QSplitter(Qt.Horizontal)
        splitter.addWidget(self._build_left_column())
        splitter.addWidget(self._build_log_panel())
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 4)
        splitter.setChildrenCollapsible(False)
        outer.addWidget(splitter, stretch=1)

        outer.addLayout(self._build_footer())

    def _build_left_column(self) -> QWidget:
        container = QWidget()
        container.setObjectName("scrollBody")
        column = QVBoxLayout(container)
        column.setContentsMargins(0, 0, 6, 0)
        column.setSpacing(9)
        column.addWidget(_hint(self.t("intro"), "intro"))
        column.addWidget(_hint(self.t("intro_live"), "introLive"))
        column.addWidget(self._build_recordings_card())
        column.addWidget(self._build_videos_card())
        column.addWidget(self._build_run_card())
        column.addWidget(self._build_results_card())
        column.addStretch(1)

        # A scroll area keeps every card at its natural size and adds a scrollbar when the window is short.
        scroll = QScrollArea()
        scroll.setObjectName("leftScroll")
        scroll.setWidget(container)
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setFrameShape(QScrollArea.NoFrame)
        return scroll

    def _build_recordings_card(self) -> QFrame:
        frame, layout = _numbered_card("1", self.t("card_choose_recordings"), self.t("recordings_hint"))
        row = QHBoxLayout()
        add_videos = QPushButton("📂  " + self.t("add_videos"))
        add_videos.clicked.connect(self._pick_videos)
        add_folder = QPushButton("🗂  " + self.t("add_folder"))
        add_folder.clicked.connect(self._pick_folder)
        row.addWidget(add_videos)
        row.addWidget(add_folder)
        layout.addLayout(row)
        self._busy_widgets += [add_videos, add_folder]
        return frame

    def _build_videos_card(self) -> QFrame:
        frame, layout = _numbered_card("2", self.t("card_choose_videos"), self.t("card_choose_videos_hint"))

        self._video_list = QListWidget()
        self._video_list.setSelectionMode(QListWidget.NoSelection)
        self._video_list.setMinimumHeight(84)
        self._video_list.setMaximumHeight(150)
        self._video_list.itemChanged.connect(self._on_selection_changed)
        layout.addWidget(self._video_list)

        controls = QHBoxLayout()
        self._summary_label = _hint("")
        controls.addWidget(self._summary_label, stretch=1)
        select_all = QPushButton(self.t("all"))
        select_all.clicked.connect(lambda: self._set_all_checked(True))
        select_none = QPushButton(self.t("none"))
        select_none.clicked.connect(lambda: self._set_all_checked(False))
        clear = QPushButton(self.t("clear"))
        clear.clicked.connect(self._clear_entries)
        for button in (select_all, select_none, clear):
            button.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Fixed)
            controls.addWidget(button)
        layout.addLayout(controls)
        self._busy_widgets += [select_all, select_none, clear, self._video_list]
        return frame

    def _build_run_card(self) -> QFrame:
        frame, layout = _numbered_card("3", self.t("card_run"), self.t("card_run_hint"))

        form = QGridLayout()
        form.setHorizontalSpacing(8)
        form.setVerticalSpacing(4)
        session_label = QLabel(self.t("session_id"))
        session_label.setObjectName("fieldLabel")
        self._session_edit = QLineEdit()
        self._session_edit.setToolTip(self.t("session_hint"))
        self._session_edit.textEdited.connect(lambda _text: setattr(self, "_session_edited", True))
        root_label = QLabel(self.t("results_folder"))
        root_label.setObjectName("fieldLabel")
        self._root_edit = QLineEdit()
        self._root_edit.textEdited.connect(lambda _text: setattr(self, "_root_edited", True))
        browse = QPushButton(self.t("browse"))
        browse.clicked.connect(self._pick_results)
        form.addWidget(session_label, 0, 0)
        form.addWidget(self._session_edit, 0, 1, 1, 2)
        form.addWidget(root_label, 1, 0)
        form.addWidget(self._root_edit, 1, 1)
        form.addWidget(browse, 1, 2)
        form.setColumnStretch(1, 1)
        layout.addLayout(form)

        # Start is the headline action — the green start light.
        run_row = QHBoxLayout()
        self._start_btn = QPushButton(self.t("start_big"))
        self._start_btn.setObjectName("primary")
        self._start_btn.clicked.connect(self._run)
        self._cancel_btn = QPushButton(self.t("cancel"))
        self._cancel_btn.setObjectName("danger")
        self._cancel_btn.setEnabled(False)
        self._cancel_btn.clicked.connect(self._runner.cancel)
        run_row.addWidget(self._start_btn, stretch=1)
        run_row.addWidget(self._cancel_btn)
        layout.addLayout(run_row)
        self._busy_widgets += [self._session_edit, self._root_edit, browse, self._start_btn]
        return frame

    def _build_results_card(self) -> QFrame:
        frame, layout = _numbered_card("🏁", self.t("card_results"), self.t("card_results_hint"))
        row = QHBoxLayout()
        open_excel = QPushButton(self.t("open_excel"))
        open_excel.clicked.connect(self._open_excel)
        open_frames = QPushButton(self.t("open_frames"))
        open_frames.clicked.connect(self._open_frames)
        row.addWidget(open_excel)
        row.addWidget(open_frames)
        layout.addLayout(row)
        # The original opened a fixed Output_Results; here every session has its own, so it gets a button.
        open_results = QPushButton(self.t("open_results_folder"))
        open_results.clicked.connect(self._open_results_folder)
        layout.addWidget(open_results)
        return frame

    def _build_log_panel(self) -> QWidget:
        frame = QFrame()
        frame.setObjectName("card")
        layout = QVBoxLayout(frame)
        layout.setContentsMargins(13, 9, 13, 10)
        layout.setSpacing(6)

        header = QHBoxLayout()
        title = QLabel(self.t("activity_log"))
        title.setObjectName("cardTitle")
        header.addWidget(title)
        header.addStretch(1)
        clear_log = QPushButton(self.t("clear"))
        clear_log.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Fixed)
        header.addWidget(clear_log)
        layout.addLayout(header)

        self._log = AnsiLogView()
        self._log.setObjectName("log")
        self._log.setPlaceholderText(self.t("log_placeholder"))
        clear_log.clicked.connect(self._log.clear)
        layout.addWidget(self._log, stretch=1)
        return frame

    def _build_footer(self) -> QVBoxLayout:
        footer = QVBoxLayout()
        footer.setSpacing(8)

        self._progress = QProgressBar()
        self._progress.setRange(0, 100)
        self._progress.setValue(0)
        self._progress.setTextVisible(True)
        self._progress.setFormat("")
        footer.addWidget(self._progress)

        status_row = QHBoxLayout()
        self._start_light = StartLight()
        self._status_text = QLabel("")
        self._status_text.setObjectName("sectionHint")
        self._elapsed_label = QLabel("")
        self._elapsed_label.setObjectName("sectionHint")
        status_row.addWidget(self._start_light)
        status_row.addSpacing(8)
        status_row.addWidget(self._status_text)
        status_row.addStretch(1)
        status_row.addWidget(self._elapsed_label)
        footer.addLayout(status_row)
        return footer

    # -- recordings ----------------------------------------------------------
    def entries(self) -> list[Path]:
        return [Path(self._video_list.item(index).data(Qt.UserRole)) for index in range(self._video_list.count())]

    def selected_entries(self) -> list[Path]:
        return [Path(self._video_list.item(index).data(Qt.UserRole)) for index in range(self._video_list.count())
                if self._video_list.item(index).checkState() == Qt.Checked]

    def add_entries(self, paths: Sequence[Path | str]) -> None:
        known = {str(path).lower() for path in self.entries()}
        self._video_list.blockSignals(True)
        for raw in paths:
            path = Path(raw)
            if str(path).lower() in known:
                continue
            known.add(str(path).lower())
            if entry_is_folder(path):
                count = len(folder_videos(path)) if path.is_dir() else 0
                kind = self.t("kind_folder_count", count=count) if count else self.t("kind_folder")
                display = f"📁  {path.name}  —  {kind}"
            else:
                display = f"🎬  {path.name}"
            item = QListWidgetItem(display)
            item.setData(Qt.UserRole, str(path))
            item.setToolTip(str(path))
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(Qt.Checked)
            self._video_list.addItem(item)
        self._video_list.blockSignals(False)
        self._on_selection_changed()

    def _clear_entries(self) -> None:
        if not self._runner.is_running():
            self._video_list.clear()
            self._on_selection_changed()

    def _set_all_checked(self, checked: bool) -> None:
        state = Qt.Checked if checked else Qt.Unchecked
        for index in range(self._video_list.count()):
            self._video_list.item(index).setCheckState(state)

    def _on_selection_changed(self, *_args) -> None:
        total = self._video_list.count()
        selected = self.selected_entries()
        self._summary_label.setText(self.t("selected_summary", selected=len(selected), total=total))
        basis = selected or self.entries()
        if not self._session_edited:
            self._session_edit.setText(default_session_id(basis))
        if not self._root_edited:
            default = default_runtime_root(basis)
            self._root_edit.setText(str(default) if default else "")
            self._root_edit.setCursorPosition(0)

    def _pick_videos(self) -> None:
        patterns = " ".join(f"*{suffix}" for suffix in VIDEO_SUFFIXES)
        chosen, _ = QFileDialog.getOpenFileNames(
            self, self.t("pick_videos"), "", f"{self.t('video_files')} ({patterns});;{self.t('all_files')} (*.*)")
        self.add_entries([Path(item) for item in chosen])

    def _pick_folder(self) -> None:
        chosen = QFileDialog.getExistingDirectory(self, self.t("pick_folder"))
        if chosen:
            self.add_entries([Path(chosen)])

    def _pick_results(self) -> None:
        chosen = QFileDialog.getExistingDirectory(self, self.t("pick_results"))
        if chosen:
            self._root_edit.setText(str(Path(chosen)))
            self._root_edited = True

    # -- run -----------------------------------------------------------------
    def _run(self) -> None:
        if self._runner.is_running():
            return
        selected = self.selected_entries()
        if self._video_list.count() and not selected:
            QMessageBox.warning(self, self.t("nothing_selected_title"), self.t("nothing_selected"))
            return
        try:
            check_environment()
            plan = build_plan(selected, self._session_edit.text(), self._root_edit.text())
        except PlanError as error:
            message = error.message(self.t)
            self._log.append_ansi("\x1b[91m" + message + "\x1b[0m")
            QMessageBox.critical(self, self.t("error_title"), message)
            return
        self._session_edit.setText(plan.session_id)
        self._last_output = plan.output_dir
        self._runner.start_plan(self.t("run_label", count=len(selected)), plan)

    # -- results -------------------------------------------------------------
    def _output_dir(self) -> Path | None:
        if self._last_output is not None:
            return self._last_output
        text = self._root_edit.text().strip()
        return Path(text) / OUTPUT_FOLDER if text else None

    def _open_results_folder(self) -> None:
        self._open_path(self._output_dir(), self.t("results_missing"))

    def _open_frames(self) -> None:
        output = self._output_dir()
        self._open_path(output / "Frames" if output else None, self.t("frames_missing"))

    def _open_excel(self) -> None:
        output = self._output_dir()
        workbooks = sorted(output.rglob("*.xlsx"), key=lambda path: path.stat().st_mtime) if (
            output and output.is_dir()) else []
        if workbooks:
            self._open_path(workbooks[-1], "")
        else:
            QMessageBox.information(self, self.t("no_workbook_title"), self.t("no_workbook"))

    def _open_path(self, path: Path | None, missing_message: str) -> None:
        if path is None or not path.exists():
            if missing_message:
                QMessageBox.warning(self, self.t("not_found_title"), missing_message)
            return
        try:
            if path.is_dir():
                open_folder(path)
            elif sys.platform == "win32":
                os.startfile(str(path))  # type: ignore[attr-defined]
            else:
                open_folder(path.parent)
        except Exception as exc:  # pragma: no cover - platform dependent
            QMessageBox.critical(self, self.t("error_title"), self.t("open_error", path=path, error=exc))

    # -- runner signal handlers ---------------------------------------------
    def _on_line(self, text: str) -> None:
        self._log.append_ansi(text)

    def _on_progress(self, percent: int) -> None:
        if self._progress.maximum() == 0:
            self._progress.setRange(0, 100)
        self._progress.setValue(percent)
        self._progress.setFormat(f"{percent}%")

    def _on_started(self, label: str) -> None:
        self._run_label = label
        self._set_busy(True)
        self._set_status("running", label)
        self._progress.setRange(0, 0)  # indeterminate until a percentage arrives
        self._progress.setFormat("")
        self._run_start_time = time.monotonic()
        self._elapsed_timer.start()
        self._tick_elapsed()
        self._log.reset_styles()
        self._log.append_ansi("\n" + self.t("log_started", label=label))

    def _on_failed_to_start(self, message: str) -> None:
        self._log.append_ansi("\x1b[91m" + message + "\x1b[0m")
        QMessageBox.critical(self, self.t("error_title"), message)

    def _on_finished(self, kind: str, exit_code: int) -> None:
        self._elapsed_timer.stop()
        self._set_busy(False)
        self._progress.setRange(0, 100)
        self._log.reset_styles()
        if kind == "done":
            self._progress.setValue(100)
            self._progress.setFormat(self.t("badge_finished"))
            self._set_status("done", self.t("finished"))
            self._log.append_ansi(self.t("log_completed") + "\n")
            self._log.append_ansi(self.t("log_results", path=self._output_dir()))
        elif kind == "cancelled":
            self._progress.setValue(0)
            self._progress.setFormat("")
            self._set_status("cancelled", self.t("cancelled"))
            self._log.append_ansi(self.t("log_cancelled") + "\n")
        else:
            self._progress.setValue(0)
            self._progress.setFormat(self.t("badge_failed"))
            self._set_status("error", self.t("failed", code=exit_code))
            self._log.append_ansi(self.t("log_failed", code=exit_code) + "\n")

    def _set_busy(self, busy: bool) -> None:
        for widget in self._busy_widgets:
            widget.setEnabled(not busy)
        self._cancel_btn.setEnabled(busy)

    # -- status --------------------------------------------------------------
    def _set_status(self, kind: str, text: str) -> None:
        self._start_light.set_state(kind)
        self._status_text.setText(text)
        if kind != "running":
            self._elapsed_label.setText("")

    def _tick_elapsed(self) -> None:
        seconds = int(time.monotonic() - self._run_start_time)
        self._elapsed_label.setText(f"⏱ {seconds // 60:02d}:{seconds % 60:02d}")

    # -- window lifecycle ----------------------------------------------------
    def closeEvent(self, event):  # noqa: N802 (Qt naming)
        if self._runner.is_running():
            if QMessageBox.question(self, self.t("quit_title"), self.t("confirm_close")) != QMessageBox.Yes:
                event.ignore()
                return
            self._runner.cancel()
        event.accept()
