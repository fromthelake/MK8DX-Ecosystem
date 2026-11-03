from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import Any

from .paths import DIAGNOSTICS_ROOT, LIVE_OUTPUT, assert_write_allowed

FRAMES_ROOT = LIVE_OUTPUT / "Frames"
MANUAL_FRAME_ARCHIVE_ROOT = DIAGNOSTICS_ROOT / "manual_frame_archives"


def _unique_archive_path(base: Path) -> Path:
    candidate = base
    suffix = 1
    while candidate.exists():
        candidate = base.with_name(f"{base.name}_{suffix:02d}")
        suffix += 1
    return candidate


def archive_live_frames_folder(reason: str = "manual_clear_frames") -> dict[str, Any]:
    """Archive the live frame bundle folder and recreate it empty.

    The GUI uses this as a safe "clear frames" action. It never touches the
    baseline project and does not delete the frame bundles permanently.
    """

    assert_write_allowed(FRAMES_ROOT)
    assert_write_allowed(MANUAL_FRAME_ARCHIVE_ROOT)
    MANUAL_FRAME_ARCHIVE_ROOT.mkdir(parents=True, exist_ok=True)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    archived_to: Path | None = None
    moved = False
    had_frames_folder = FRAMES_ROOT.exists()
    item_count = 0

    if had_frames_folder:
        item_count = sum(1 for _ in FRAMES_ROOT.iterdir())
        if item_count:
            archived_to = _unique_archive_path(MANUAL_FRAME_ARCHIVE_ROOT / f"Frames_{timestamp}")
            assert_write_allowed(archived_to)
            shutil.move(str(FRAMES_ROOT), str(archived_to))
            moved = True

    FRAMES_ROOT.mkdir(parents=True, exist_ok=True)

    result: dict[str, Any] = {
        "timestamp": timestamp,
        "reason": reason,
        "frames_root": str(FRAMES_ROOT),
        "had_frames_folder": had_frames_folder,
        "item_count": item_count,
        "archived": moved,
        "archive_path": str(archived_to) if archived_to else None,
        "frames_root_recreated": FRAMES_ROOT.exists(),
    }

    last_report = DIAGNOSTICS_ROOT / "live_frames_clear_last.json"
    assert_write_allowed(last_report)
    last_report.write_text(json.dumps(result, indent=2), encoding="utf-8")

    archive_report = MANUAL_FRAME_ARCHIVE_ROOT / f"clear_{timestamp}.json"
    assert_write_allowed(archive_report)
    archive_report.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result
