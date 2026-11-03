"""Dark Qt theme (QSS) and the painted MK8 banner for the PySide6 console."""

from __future__ import annotations

from pathlib import Path

from PySide6 import QtCore, QtGui, QtWidgets

from .baseline_assets import IMPORTED_ASSETS_ROOT

# Palette shared between the QSS and the hand-painted widgets. Mirrors the
# broadcast overlay so the operator console and the audience view feel related.
COLORS = {
    "bg": "#0d1130",
    "bg_elev": "#161c46",
    "panel": "#141a3e",
    "row": "#1a2049",
    "row_alt": "#161b40",
    "line": "#2a3262",
    "text": "#f1f3ff",
    "muted": "#aab2e6",
    "faint": "#7b84c0",
    "accent": "#e52521",
    "accent_2": "#ff5a2c",
    "gold": "#ffcf33",
    "ok": "#4fde95",
    "warn": "#ffcf33",
    "err": "#ff6b69",
}

RAINBOW = ["#ff3b3b", "#ff9d2e", "#ffe14d", "#4fde95", "#37a0ff", "#9b6bff", "#ff5ad0"]

BANNER_PATH = IMPORTED_ASSETS_ROOT / "gui" / "bg.jpg"


def build_qss() -> str:
    c = COLORS
    return f"""
    QWidget {{
        background: {c['bg']};
        color: {c['text']};
        font-family: "Segoe UI", "Inter", sans-serif;
        font-size: 13px;
    }}
    QFrame#panel, QGroupBox {{
        background: {c['panel']};
        border: 1px solid {c['line']};
        border-radius: 12px;
    }}
    QGroupBox {{
        margin-top: 14px;
        padding: 10px;
        font-weight: 600;
    }}
    QGroupBox::title {{
        subcontrol-origin: margin;
        left: 12px;
        padding: 0 6px;
        color: {c['muted']};
    }}
    QLabel#sectionTitle {{ color: {c['muted']}; font-weight: 600; font-size: 12px; }}
    QLabel#statusLine {{ color: {c['text']}; font-size: 13px; padding: 4px 2px; }}
    QLabel#hint {{ color: {c['faint']}; font-size: 11px; }}

    QPushButton {{
        background: {c['bg_elev']};
        border: 1px solid {c['line']};
        border-radius: 9px;
        padding: 8px 12px;
        color: {c['text']};
    }}
    QPushButton:hover {{ border-color: {c['muted']}; background: #1c2356; }}
    QPushButton:pressed {{ background: #11163a; }}
    QPushButton:disabled {{ color: {c['faint']}; border-color: #232a52; background: #11152f; }}
    QPushButton#primary {{
        background: {c['accent']};
        border: 1px solid {c['accent']};
        color: #ffffff;
        font-weight: 700;
        padding: 10px 12px;
    }}
    QPushButton#primary:hover {{ background: {c['accent_2']}; border-color: {c['accent_2']}; }}
    QPushButton#primary:disabled {{ background: #5a2a2a; border-color: #5a2a2a; color: #c9b3b3; }}
    /* Segmented toggle: the selected option turns green. */
    QPushButton#segment {{ padding: 8px 18px; font-weight: 600; }}
    QPushButton#segment:checked {{
        background: {c['ok']};
        border-color: {c['ok']};
        color: #07150d;
        font-weight: 800;
    }}
    QPushButton#segment:checked:hover {{ background: {c['ok']}; border-color: {c['ok']}; }}

    QLineEdit, QComboBox {{
        background: {c['bg']};
        border: 1px solid {c['line']};
        border-radius: 8px;
        padding: 7px 9px;
        selection-background-color: {c['accent']};
    }}
    QComboBox:hover, QLineEdit:focus, QComboBox:focus {{ border-color: {c['muted']}; }}
    QComboBox QAbstractItemView {{
        background: {c['bg_elev']};
        border: 1px solid {c['line']};
        selection-background-color: {c['accent']};
        outline: none;
    }}
    QCheckBox {{ spacing: 8px; }}
    QCheckBox::indicator {{
        width: 16px; height: 16px; border-radius: 5px;
        border: 1px solid {c['line']}; background: {c['bg']};
    }}
    QCheckBox::indicator:checked {{ background: {c['accent']}; border-color: {c['accent']}; }}

    QTableWidget, QListWidget, QTreeWidget {{
        background: {c['bg']};
        border: 1px solid {c['line']};
        border-radius: 10px;
        gridline-color: {c['line']};
        outline: none;
        alternate-background-color: {c['row_alt']};
    }}
    QTableWidget::item, QListWidget::item {{ padding: 5px 6px; }}
    QTableWidget::item:selected, QListWidget::item:selected {{
        background: #233067; color: {c['text']};
    }}
    QHeaderView::section {{
        background: {c['bg_elev']};
        color: {c['muted']};
        border: none;
        border-right: 1px solid {c['line']};
        border-bottom: 1px solid {c['line']};
        padding: 6px 8px;
        font-weight: 600;
    }}
    QTableCornerButton::section {{ background: {c['bg_elev']}; border: none; }}

    QTabWidget::pane {{ border: 1px solid {c['line']}; border-radius: 10px; top: -1px; }}
    QTabBar::tab {{
        background: {c['bg']};
        color: {c['muted']};
        border: 1px solid {c['line']};
        border-bottom: none;
        border-top-left-radius: 8px; border-top-right-radius: 8px;
        padding: 7px 14px; margin-right: 3px;
    }}
    QTabBar::tab:selected {{ background: {c['accent']}; color: #ffffff; border-color: {c['accent']}; }}
    QTabBar::tab:hover:!selected {{ color: {c['text']}; }}

    QScrollBar:vertical {{ background: transparent; width: 11px; margin: 2px; }}
    QScrollBar::handle:vertical {{ background: #2c3470; border-radius: 5px; min-height: 28px; }}
    QScrollBar::handle:vertical:hover {{ background: #3a4488; }}
    QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
    QScrollBar:horizontal {{ background: transparent; height: 11px; margin: 2px; }}
    QScrollBar::handle:horizontal {{ background: #2c3470; border-radius: 5px; min-width: 28px; }}
    QSplitter::handle {{ background: {c['line']}; }}
    """


class BannerWidget(QtWidgets.QWidget):
    """MK8 header banner: cover-scaled artwork + dark overlay + rainbow strip + title."""

    def __init__(self, title: str, subtitle: str = "", parent: QtWidgets.QWidget | None = None) -> None:
        super().__init__(parent)
        self._title = title
        self._subtitle = subtitle
        self._pixmap = QtGui.QPixmap(str(BANNER_PATH)) if BANNER_PATH.exists() else QtGui.QPixmap()
        self.setFixedHeight(108)
        self.setSizePolicy(QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Fixed)

    def set_copy(self, title: str, subtitle: str) -> None:
        self._title = title
        self._subtitle = subtitle
        self.update()

    def paintEvent(self, event: QtGui.QPaintEvent) -> None:  # noqa: N802 - Qt API
        painter = QtGui.QPainter(self)
        painter.setRenderHint(QtGui.QPainter.Antialiasing)
        rect = self.rect()

        painter.setBrush(QtGui.QColor(COLORS["bg_elev"]))
        painter.setPen(QtCore.Qt.NoPen)
        painter.drawRect(rect)

        if not self._pixmap.isNull():
            scaled = self._pixmap.scaled(
                rect.size(), QtCore.Qt.KeepAspectRatioByExpanding, QtCore.Qt.SmoothTransformation
            )
            x = (scaled.width() - rect.width()) // 2
            y = (scaled.height() - rect.height()) // 2
            painter.drawPixmap(rect, scaled, QtCore.QRect(x, y, rect.width(), rect.height()))

        overlay = QtGui.QLinearGradient(0, 0, rect.width(), 0)
        overlay.setColorAt(0.0, QtGui.QColor(8, 11, 32, 232))
        overlay.setColorAt(0.55, QtGui.QColor(8, 11, 32, 150))
        overlay.setColorAt(1.0, QtGui.QColor(8, 11, 32, 70))
        painter.fillRect(rect, overlay)

        # Rainbow Road strip along the bottom edge.
        strip_h = 5
        strip = QtCore.QRect(0, rect.height() - strip_h, rect.width(), strip_h)
        grad = QtGui.QLinearGradient(strip.left(), 0, strip.right(), 0)
        for i, color in enumerate(RAINBOW):
            grad.setColorAt(i / (len(RAINBOW) - 1), QtGui.QColor(color))
        painter.fillRect(strip, grad)

        # Title block.
        painter.setPen(QtGui.QColor(COLORS["text"]))
        title_font = QtGui.QFont("Segoe UI", 21, QtGui.QFont.Bold)
        painter.setFont(title_font)
        painter.drawText(QtCore.QRect(22, 18, rect.width() - 44, 40), QtCore.Qt.AlignLeft, self._title)

        if self._subtitle:
            painter.setPen(QtGui.QColor(COLORS["muted"]))
            painter.setFont(QtGui.QFont("Segoe UI", 11))
            painter.drawText(
                QtCore.QRect(24, 60, rect.width() - 48, 24), QtCore.Qt.AlignLeft, self._subtitle
            )
        painter.end()
