"""A read-only log view that renders ANSI/SGR colour codes.

Ported from the MK8DX Video Result Extractor GUI (gui/ansi_log.py). The recognition engine prints coloured
console output; through a pipe it does so when MK8_FORCE_COLOR is set, and this widget turns those codes into Qt
text formats so the activity log looks like the console, while keeping the exact spacing of aligned tables
(plain text with per-run colours rather than HTML, which would collapse whitespace). The parsing itself is in
``tournament_processor.log_format`` so it is tested without Qt.
"""

from __future__ import annotations

from PySide6.QtGui import QColor, QTextCharFormat, QTextCursor
from PySide6.QtWidgets import QPlainTextEdit

from ..log_format import AnsiState, Style


class AnsiLogView(QPlainTextEdit):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setReadOnly(True)
        self.setMaximumBlockCount(6000)
        self._state = AnsiState()

    def append_ansi(self, line: str) -> None:
        cursor = self.textCursor()
        cursor.movePosition(QTextCursor.End)
        if not self.document().isEmpty():
            cursor.insertText("\n")
        for text, style in self._state.runs(line):
            cursor.insertText(text, self._char_format(style))
        self.moveCursor(QTextCursor.End)

    def reset_styles(self) -> None:
        self._state.reset()

    @staticmethod
    def _char_format(style: Style) -> QTextCharFormat:
        fmt = QTextCharFormat()
        fmt.setForeground(QColor(style.color()))
        if style.bold:
            fmt.setFontWeight(75)
        return fmt
