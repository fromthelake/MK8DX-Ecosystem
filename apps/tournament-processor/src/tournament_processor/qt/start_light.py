"""A Mario-Kart-style start-light status indicator.

Three bulbs (red / amber / green) act as the app's status light, echoing a race
start signal:
  * ready     → green lit  (on the line, good to go)
  * running   → amber lit, gently pulsing
  * done      → green lit
  * cancelled → all dim
  * error     → red lit

Ported unchanged from the MK8DX Live Video Processor post-analysis GUI
(live_processor/baseline_extractor/gui/start_light.py, same owner).
"""

from __future__ import annotations

from PySide6.QtCore import QSize, Qt, QTimer
from PySide6.QtGui import QColor, QPainter
from PySide6.QtWidgets import QWidget

_OFF = {
    "red": QColor("#3a1414"),
    "amber": QColor("#3a2f10"),
    "green": QColor("#123a1c"),
}
_ON = {
    "red": QColor("#ff4d4d"),
    "amber": QColor("#ffc02e"),
    "green": QColor("#46d65f"),
}


class StartLight(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._lit = {"red": False, "amber": False, "green": True}
        self._pulse = False
        self._pulse_on = True
        self.setFixedSize(self.sizeHint())

        self._timer = QTimer(self)
        self._timer.setInterval(550)
        self._timer.timeout.connect(self._toggle_pulse)

    def sizeHint(self) -> QSize:
        return QSize(58, 20)

    def set_state(self, kind: str) -> None:
        mapping = {
            "ready": {"red": False, "amber": False, "green": True},
            "running": {"red": False, "amber": True, "green": False},
            "done": {"red": False, "amber": False, "green": True},
            "cancelled": {"red": False, "amber": False, "green": False},
            "error": {"red": True, "amber": False, "green": False},
        }
        self._lit = mapping.get(kind, mapping["ready"]).copy()
        self._pulse = kind == "running"
        self._pulse_on = True
        if self._pulse:
            self._timer.start()
        else:
            self._timer.stop()
        self.update()

    def _toggle_pulse(self) -> None:
        self._pulse_on = not self._pulse_on
        self.update()

    def paintEvent(self, event):  # noqa: N802 (Qt naming)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        diameter = 14
        gap = 6
        top = (self.height() - diameter) // 2
        for index, name in enumerate(("red", "amber", "green")):
            lit = self._lit[name]
            if lit and self._pulse and name == "amber" and not self._pulse_on:
                lit = False
            color = _ON[name] if lit else _OFF[name]
            painter.setBrush(color)
            painter.setPen(QColor(0, 0, 0, 90))
            x = index * (diameter + gap)
            painter.drawEllipse(x, top, diameter, diameter)
        painter.end()
