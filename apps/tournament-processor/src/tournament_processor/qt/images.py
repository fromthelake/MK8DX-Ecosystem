"""Image loading for the banner background.

Ported from the MK8DX Live Video Processor post-analysis GUI (gui/images.py), which loads through Pillow. Here Qt
reads the image first (JPEG/PNG need no extra plugin) and Pillow, when present, covers other formats.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtGui import QImage, QPixmap


def load_pixmap(path: Path | None) -> QPixmap | None:
    if path is None:
        return None
    pixmap = QPixmap(str(path))
    if not pixmap.isNull():
        return pixmap
    try:
        from PIL import Image

        image = Image.open(path).convert("RGBA")
    except Exception:  # noqa: BLE001 - an unreadable optional image simply means the drawn banner
        return None
    data = image.tobytes("raw", "RGBA")
    qimage = QImage(data, image.width, image.height, QImage.Format_RGBA8888)
    # Copy so the QImage owns its buffer once `data` goes out of scope.
    return QPixmap.fromImage(qimage.copy())
