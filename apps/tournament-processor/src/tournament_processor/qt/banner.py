"""Mario Kart 8 themed header banner, ported from the MK8DX Live Video Processor post-analysis GUI (gui/banner.py).

Paints the banner artwork (the packaged ``qt/assets/bg.jpg``, or ``MK8DX_ANALYSIS_BACKGROUND``) cover-scaled
behind the title, with a dark gradient overlay so text stays readable, and a Rainbow Road colour strip along the
bottom edge (painted once on resize, no per-frame cost). When no image is available the background is drawn in
code (dark asphalt with faint rainbow racing lines) instead of the original's flat fill.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QPointF, QRect, QRectF, Qt
from PySide6.QtGui import QColor, QLinearGradient, QPainter, QPainterPath, QPen, QPixmap
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout

from .images import load_pixmap

# Rainbow Road stops (red → violet), used for the banner strip and progress bar.
RAINBOW_STOPS = [
    (0.00, "#ff3b3b"), (0.17, "#ff9e2c"), (0.34, "#ffe23b"),
    (0.51, "#4cd964"), (0.68, "#34a8ff"), (0.85, "#7a5cff"), (1.00, "#ff4ce0"),
]


class HeaderBanner(QFrame):
    STRIP_HEIGHT = 5

    def __init__(self, title: str, subtitle: str, background: Path | None = None, parent=None):
        super().__init__(parent)
        self.setFixedHeight(92)
        self._pixmap: QPixmap | None = load_pixmap(background)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(20, 10, 20, 12)

        title_block = QVBoxLayout()
        title_block.setSpacing(2)
        title_label = QLabel(title)
        title_label.setObjectName("bannerTitle")
        subtitle_label = QLabel(subtitle)
        subtitle_label.setObjectName("bannerSubtitle")
        title_block.addStretch(1)
        title_block.addWidget(title_label)
        title_block.addWidget(subtitle_label)
        title_block.addStretch(1)
        layout.addLayout(title_block)
        layout.addStretch(1)

        flag = QLabel("🏁")
        flag.setObjectName("bannerFlag")
        flag.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        layout.addWidget(flag)

    @property
    def has_image(self) -> bool:
        return self._pixmap is not None and not self._pixmap.isNull()

    def paintEvent(self, event):  # noqa: N802 (Qt naming)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.SmoothPixmapTransform, True)
        painter.setRenderHint(QPainter.Antialiasing, True)
        rect = self.rect()
        clip = QPainterPath()
        clip.addRoundedRect(QRectF(rect), 12, 12)
        painter.setClipPath(clip)

        if self.has_image:
            scaled = self._pixmap.scaled(rect.size(), Qt.KeepAspectRatioByExpanding, Qt.SmoothTransformation)
            x = (scaled.width() - rect.width()) // 2
            y = (scaled.height() - rect.height()) // 2
            painter.drawPixmap(rect, scaled, QRect(x, y, rect.width(), rect.height()))
        else:
            self._paint_drawn_track(painter, rect)

        overlay = QLinearGradient(QPointF(0, 0), QPointF(rect.width(), 0))
        overlay.setColorAt(0.0, QColor(7, 10, 18, 235))
        overlay.setColorAt(0.6, QColor(7, 10, 18, 170))
        overlay.setColorAt(1.0, QColor(7, 10, 18, 120))
        painter.fillRect(rect, overlay)

        strip = QRect(0, rect.height() - self.STRIP_HEIGHT, rect.width(), self.STRIP_HEIGHT)
        rainbow = QLinearGradient(QPointF(strip.left(), 0), QPointF(strip.right(), 0))
        for position, color in RAINBOW_STOPS:
            rainbow.setColorAt(position, QColor(color))
        painter.fillRect(strip, rainbow)
        painter.end()

    @staticmethod
    def _paint_drawn_track(painter: QPainter, rect: QRect) -> None:
        """The code-drawn background: night-blue asphalt with faint rainbow racing lines."""
        base = QLinearGradient(QPointF(0, 0), QPointF(rect.width(), rect.height()))
        base.setColorAt(0.0, QColor("#101a26"))
        base.setColorAt(1.0, QColor("#1a2340"))
        painter.fillRect(rect, base)

        # Diagonal racing lines in the rainbow colours, faint so the overlay keeps the title calm.
        height = rect.height()
        spacing = 34
        for index, x in enumerate(range(-height, rect.width() + height, spacing)):
            _, color = RAINBOW_STOPS[index % len(RAINBOW_STOPS)]
            pen_color = QColor(color)
            pen_color.setAlpha(70)
            painter.setPen(QPen(pen_color, 6))
            painter.drawLine(QPointF(x, height), QPointF(x + height * 0.9, 0))
