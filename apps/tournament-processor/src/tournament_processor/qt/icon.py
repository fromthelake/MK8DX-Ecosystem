"""Window-icon helper. Best-effort: silently does nothing if no image is found.

Ported from the MK8DX Live Video Processor post-analysis GUI (gui/icon.py): the banner artwork is the icon too.
"""

from __future__ import annotations

from pathlib import Path


def set_window_icon(window, image: Path | None) -> None:
    if image is None:
        return
    try:
        from PySide6.QtGui import QIcon

        window.setWindowIcon(QIcon(str(image)))
    except Exception:  # noqa: BLE001 - an icon is decoration only
        pass
