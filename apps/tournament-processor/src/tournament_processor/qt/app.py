"""QApplication bootstrap for the Qt analysis window (after the MK8DX Video Result Extractor's gui/app.py)."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Sequence

from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QApplication

from ..gui import Texts, analysis_background
from . import theme
from .main_window import MainWindow


def create_window(texts: Texts, entries: Sequence[Path] = (), runtime_root: Path | None = None,
                  session_id: str | None = None) -> MainWindow:
    """The themed main window (the QApplication must exist). Used by run() and by headless tests."""
    background = analysis_background()
    window = MainWindow(texts, entries, runtime_root, session_id, background)
    if background is not None:
        # The original uses its banner artwork as the window icon too.
        window.setWindowIcon(QIcon(str(background)))
    return window


def application() -> QApplication:
    # Crisp fractional HiDPI scaling (e.g. 125% / 150% Windows display scaling) must be set before the
    # QApplication is constructed.
    if QApplication.instance() is None:
        QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication.instance() or QApplication(sys.argv[:1])
    app.setApplicationName("MK8DX Tournament Analysis")
    # An explicit point-based base font tracks the OS text-size setting.
    base_font = app.font()
    base_font.setPointSizeF(9.0)
    app.setFont(base_font)
    theme.apply(app)
    return app


def run(texts: Texts, entries: Sequence[Path] = (), runtime_root: Path | None = None,
        session_id: str | None = None, *, maximized: bool = True) -> int:
    app = application()
    window = create_window(texts, entries, runtime_root, session_id)
    if maximized:
        window.showMaximized()
    else:
        window.show()
    return app.exec()
