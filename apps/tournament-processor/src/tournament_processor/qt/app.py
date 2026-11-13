"""QApplication bootstrap for the Qt analysis window.

After the MK8DX Live Video Processor post-analysis GUI (live_processor/baseline_extractor/gui/app.py).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Sequence

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication

from ..gui import Texts, analysis_background
from . import theme
from .icon import set_window_icon
from .main_window import MainWindow


def create_window(texts: Texts, entries: Sequence[Path] = (), runtime_root: Path | None = None,
                  session_id: str | None = None) -> MainWindow:
    """The themed main window (the QApplication must exist). Used by run() and by headless tests."""
    background = analysis_background()
    window = MainWindow(texts, entries, runtime_root, session_id, background)
    set_window_icon(window, background)
    return window


def application() -> QApplication:
    # Crisp fractional HiDPI scaling (e.g. 125% / 150% Windows display scaling) must be set before the
    # QApplication is constructed.
    if QApplication.instance() is None:
        QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication.instance() or QApplication(sys.argv[:1])
    app.setApplicationName("MK8DX Tournament Analysis")
    # An explicit point-based base font tracks the OS text-size setting and keeps the UI legible regardless of
    # the display's pixel density.
    base_font = app.font()
    base_font.setPointSizeF(9.0)
    app.setFont(base_font)
    theme.apply(app)
    return app


def run(texts: Texts, entries: Sequence[Path] = (), runtime_root: Path | None = None,
        session_id: str | None = None) -> int:
    app = application()
    window = create_window(texts, entries, runtime_root, session_id)
    window.show()
    return app.exec()
