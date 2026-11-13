"""Centralised theme for the Qt analysis window.

Ported unchanged from the MK8DX Video Result Extractor GUI (gui/theme.py, same owner), so the analysis window
looks like that window. Everything visual (colours, fonts, spacing, the QSS stylesheet) lives here so the look
can be changed in one place. One polished dark theme, consistent across Windows, Linux and macOS.
"""

from __future__ import annotations

# --- Palette -----------------------------------------------------------------
# A calm dark surface with a single Mario-Kart gold accent and a red used only
# for destructive / stop actions. Colour encodes *state*, not decoration.
COLORS = {
    "bg": "#0d1018",            # window background
    "surface": "#151a26",      # cards / panels
    "surface_alt": "#1c2230",  # inputs, list rows
    "surface_hover": "#232b3b",
    "border": "#2a3346",
    "border_strong": "#3a4660",
    "text": "#e7ecf5",
    "text_muted": "#94a2b8",
    "text_faint": "#5f6b80",
    "accent": "#ffd34d",        # MK gold — primary actions / highlights
    "accent_hover": "#ffe07a",
    "accent_text": "#1a1405",   # text drawn on top of the gold accent
    "danger": "#d94c4c",        # destructive actions / errors
    "danger_hover": "#e76a6a",
    "danger_text": "#2a0d0d",
    "ok": "#43c463",            # success / ready
    "running": "#4aa3ff",       # in-progress
    "warn": "#e0a32f",
    "go": "#39c75a",            # race-start green — the primary "GO" action
    "go_hover": "#4ade6e",
    "go_text": "#06210d",
}

FONT_FAMILY_FALLBACKS = '"Segoe UI", "Inter", "Roboto", "Noto Sans", sans-serif'
MONO_FAMILY_FALLBACKS = '"Cascadia Mono", "Consolas", "Menlo", "DejaVu Sans Mono", monospace'


def build_stylesheet() -> str:
    c = COLORS
    return f"""
* {{
    font-family: {FONT_FAMILY_FALLBACKS};
    color: {c['text']};
}}

QWidget#root {{
    background: {c['bg']};
}}

QScrollArea#leftScroll, QWidget#scrollBody {{
    background: transparent;
    border: none;
}}

QFrame#card {{
    background: {c['surface']};
    border: 1px solid {c['border']};
    border-radius: 12px;
}}

QLabel#h1 {{
    color: {c['accent']};
    font-size: 15pt;
    font-weight: 600;
}}
QLabel#subtitle {{
    color: {c['text_muted']};
    font-size: 8pt;
    letter-spacing: 1px;
}}
QLabel#cardTitle {{
    color: {c['text']};
    font-size: 11pt;
    font-weight: 600;
}}
QLabel#cardHint, QLabel#sectionHint {{
    color: {c['text_muted']};
    font-size: 8.5pt;
}}
QLabel#stepBadge {{
    color: {c['accent_text']};
    background: {c['accent']};
    border-radius: 10px;
    min-width: 20px;
    max-width: 20px;
    min-height: 20px;
    max-height: 20px;
    font-size: 9.5pt;
    font-weight: 600;
    qproperty-alignment: AlignCenter;
}}
QLabel#stageArrow {{
    color: {c['text_faint']};
    font-size: 12pt;
}}

QFrame#banner {{
    background: {c['bg']};
    border: 1px solid {c['border']};
    border-radius: 12px;
}}
QLabel#bannerTitle {{
    color: {c['accent']};
    font-size: 16pt;
    font-weight: 600;
    background: transparent;
}}
QLabel#bannerSubtitle {{
    color: #d8e0ee;
    font-size: 8pt;
    letter-spacing: 2px;
    background: transparent;
}}
QLabel#bannerFlag {{
    font-size: 18pt;
    background: transparent;
}}

QPushButton {{
    background: {c['surface_alt']};
    border: 1px solid {c['border']};
    border-radius: 7px;
    padding: 6px 12px;
    min-height: 16px;
    color: {c['text']};
    font-size: 9pt;
    font-weight: 600;
}}
QPushButton:hover {{
    background: {c['surface_hover']};
    border-color: {c['border_strong']};
}}
QPushButton:pressed {{
    background: {c['surface']};
}}
QPushButton:disabled {{
    color: {c['text_faint']};
    background: {c['surface']};
    border-color: {c['border']};
}}

QPushButton#primary {{
    background: {c['go']};
    color: {c['go_text']};
    border: 1px solid {c['go']};
    font-size: 10.5pt;
    padding: 8px 14px;
    min-height: 20px;
}}
QPushButton#primary:hover {{
    background: {c['go_hover']};
    border-color: {c['go_hover']};
}}
QPushButton#primary:disabled {{
    background: {c['surface_alt']};
    color: {c['text_faint']};
    border-color: {c['border']};
}}

QPushButton#danger {{
    background: transparent;
    color: {c['danger_hover']};
    border: 1px solid {c['danger']};
}}
QPushButton#danger:hover {{
    background: {c['danger']};
    color: {c['danger_text']};
}}

QCheckBox {{
    spacing: 8px;
    color: {c['text']};
}}
QCheckBox::indicator {{
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid {c['border_strong']};
    background: {c['surface_alt']};
}}
QCheckBox::indicator:checked {{
    background: {c['accent']};
    border-color: {c['accent']};
}}

QComboBox {{
    background: {c['surface_alt']};
    border: 1px solid {c['border']};
    border-radius: 7px;
    padding: 4px 9px;
    min-width: 78px;
    min-height: 16px;
    font-size: 9pt;
}}
QComboBox:hover {{
    border-color: {c['border_strong']};
}}
QComboBox QAbstractItemView {{
    background: {c['surface_alt']};
    border: 1px solid {c['border_strong']};
    selection-background-color: {c['accent']};
    selection-color: {c['accent_text']};
    outline: none;
}}

QLineEdit {{
    background: {c['surface_alt']};
    border: 1px solid {c['border']};
    border-radius: 7px;
    padding: 4px 9px;
    min-height: 16px;
    font-size: 9pt;
    selection-background-color: {c['accent']};
    selection-color: {c['accent_text']};
}}
QLineEdit:hover {{
    border-color: {c['border_strong']};
}}
QLineEdit:focus {{
    border-color: {c['accent']};
}}
QLineEdit:disabled {{
    color: {c['text_faint']};
}}
QLabel#fieldLabel {{
    color: {c['text_muted']};
    font-size: 8.5pt;
}}
QLabel#intro {{
    color: {c['text_muted']};
    font-size: 8.5pt;
}}
QLabel#introLive {{
    color: {c['accent']};
    font-size: 8.5pt;
}}

QListWidget {{
    background: {c['surface_alt']};
    border: 1px solid {c['border']};
    border-radius: 8px;
    padding: 4px;
}}
QListWidget::item {{
    padding: 4px 6px;
    border-radius: 5px;
    font-size: 9pt;
}}
QListWidget::item:hover {{
    background: {c['surface_hover']};
}}

QPlainTextEdit#log {{
    background: #090c12;
    border: 1px solid {c['border']};
    border-radius: 8px;
    color: #cdd6e5;
    font-family: {MONO_FAMILY_FALLBACKS};
    font-size: 9pt;
    padding: 7px;
}}

QProgressBar {{
    background: {c['surface_alt']};
    border: 1px solid {c['border']};
    border-radius: 7px;
    min-height: 15px;
    text-align: center;
    color: {c['text']};
    font-size: 8pt;
}}
QProgressBar::chunk {{
    border-radius: 7px;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #ff3b3b, stop:0.17 #ff9e2c, stop:0.34 #ffe23b,
        stop:0.51 #4cd964, stop:0.68 #34a8ff, stop:0.85 #7a5cff, stop:1 #ff4ce0);
}}
QLabel#progressBadge {{
    background: rgba(0, 0, 0, 0.74);
    color: #ffffff;
    border-radius: 8px;
    padding: 1px 12px;
    font-size: 8.5pt;
    font-weight: 600;
}}

QScrollBar:vertical {{
    background: transparent;
    width: 10px;
    margin: 2px;
}}
QScrollBar::handle:vertical {{
    background: {c['border_strong']};
    border-radius: 5px;
    min-height: 24px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0px;
}}
QToolTip {{
    background: {c['surface_alt']};
    color: {c['text']};
    border: 1px solid {c['border_strong']};
    padding: 4px 6px;
}}
"""


def apply(app) -> None:
    """Apply the dark theme stylesheet to a QApplication."""
    app.setStyleSheet(build_stylesheet())
