"""Image loading for the optional banner background (MK8DX_ANALYSIS_BACKGROUND).

Qt reads JPEG/PNG itself; Pillow, when present, covers formats whose Qt image plugin is missing. Ported from the
MK8DX Video Result Extractor GUI (gui/images.py). No image is shipped with the package.
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
