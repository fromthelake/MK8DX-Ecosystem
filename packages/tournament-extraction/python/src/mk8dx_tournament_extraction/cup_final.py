"""The cup end screen (Clean Assets 065 `lan_score_frame`): the final standings shown a few seconds after the last
race's TotalScore screen, with the red checkered frame top left and bottom right.

Tournament Live and the post-analysis tool both keep one frame of it per recording, in
`Race_<last>/4CupFinal/anchor_<frame>.jpg` next to that race's 2RaceScore/3TotalScore bundles.

The test is the template's frame mask on a 64x36 grid: the cells listed below are fully covered by the red frame in
065. The class badge (top left) is left out, because it shows 50/100/150/200 or the Mirror badge; the header text
varies per outcome and language and is not part of the mask either. A frame shows the screen when nearly every cell is
red. Regenerate the cells from the template with `tooling/tournament/cup_final_cells.py`.

This module lives outside `engine/` on purpose: the engine-provenance manifest pins every `engine/*.py`.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

GRID = (64, 36)
FRAME_CONTENT = "4CupFinal"
# Rows of the 64x36 grid: (y, x_start, x_end) runs of cells that 065's frame mask covers fully, badge excluded.
CELL_RUNS = (
    (0, 11, 19), (0, 21, 26), (0, 27, 30),
    (1, 8, 17), (1, 20, 27), (1, 28, 29),
    (2, 9, 30),
    (32, 53, 64),
    (33, 51, 60), (33, 61, 63),
    (34, 51, 53), (34, 56, 59), (34, 60, 62),
    (35, 49, 52), (35, 53, 54), (35, 55, 58), (35, 59, 61), (35, 63, 64),
)
CELLS = tuple((y, x) for y, start, end in CELL_RUNS for x in range(start, end))
THRESHOLD = 0.85
# The red frame comes first with only the trophy; the standings list slides in about 4 s later and the screen holds
# about 15 s (01-11 150cc cup). Both tools keep the frame SETTLE_SECONDS after the frame first appears, or
# DROP_BACKOFF_SECONDS before it leaves when that comes sooner.
SETTLE_SECONDS = 8.0
DROP_BACKOFF_SECONDS = 1.0


@dataclass(frozen=True)
class CupFinalMatch:
    present: bool
    score: float


def cup_final_score(frame_bgr: Any) -> float:
    """Share of the frame cells that are red, on any frame size (the screen is 16:9)."""
    import cv2  # type: ignore

    small = cv2.resize(frame_bgr, GRID, interpolation=cv2.INTER_AREA).astype("int32")
    red = 0
    for y, x in CELLS:
        b, g, r = (int(value) for value in small[y, x][:3])
        if r >= 110 and g * 100 <= r * 45 and b * 100 <= r * 50:  # red, not orange or pink
            red += 1
    return red / len(CELLS)


def detect_cup_final(frame_bgr: Any, threshold: float = THRESHOLD) -> CupFinalMatch:
    score = cup_final_score(frame_bgr)
    return CupFinalMatch(present=score >= threshold, score=round(score, 3))


@dataclass(frozen=True)
class CupFinalFrame:
    frame_index: int
    timestamp: float
    score: float
    first_seen_frame: int


def find_cup_final_frame(
    video_path: Path,
    *,
    start_frame: int = 0,
    step_seconds: float = 0.5,
) -> Optional[CupFinalFrame]:
    """Scan a recording from `start_frame` (normally the last TotalScore frame) for the cup end screen; returns the
    frame SETTLE_SECONDS after it first appears (or DROP_BACKOFF_SECONDS before it leaves, when sooner), or None
    when the recording never shows it."""
    import cv2  # type: ignore

    capture = cv2.VideoCapture(str(video_path))
    try:
        fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
        step = max(1, int(round(step_seconds * fps)))
        settle = int(round(SETTLE_SECONDS * fps))
        backoff = int(round(DROP_BACKOFF_SECONDS * fps))
        index = max(0, int(start_frame))
        first_seen = None
        last_seen = None
        last_score = 0.0
        while True:
            capture.set(cv2.CAP_PROP_POS_FRAMES, index)
            ok, frame = capture.read()
            match = detect_cup_final(frame) if ok else CupFinalMatch(False, 0.0)
            if match.present:
                if first_seen is None:
                    first_seen = index
                last_seen, last_score = index, match.score
                if index - first_seen >= settle:
                    return CupFinalFrame(index, index / fps, match.score, first_seen)
            elif first_seen is not None:
                # it left before settling: a frame shortly before it went, at least a list's slide-in in
                target = max(first_seen, min(last_seen, index - backoff))
                return CupFinalFrame(target, target / fps, last_score, first_seen)
            if not ok:
                return None
            index += step
    finally:
        capture.release()


def _anchor_frame(path: Path) -> int:
    digits = path.stem.split("_")[1] if path.stem.startswith("anchor_") else ""
    return int(digits) if digits.isdigit() else -1


def save_cup_final(video_path: Path, video_frames_dir: Path, image_suffix: str = ".jpg") -> Optional[Path]:
    """Post-analysis: after extraction, keep the cup end screen of one recording in the last race's folder.

    The scan starts at the last race's TotalScore anchor, so a recording without races or without the screen keeps
    nothing. Returns the written path."""
    import cv2  # type: ignore

    races = sorted(path for path in Path(video_frames_dir).glob("Race_*") if (path / "3TotalScore").is_dir())
    if not races:
        return None
    last = races[-1]
    anchors = [_anchor_frame(path) for path in (last / "3TotalScore").glob("anchor_*")]
    if not anchors or max(anchors) < 0:
        return None
    found = find_cup_final_frame(Path(video_path), start_frame=max(anchors))
    if found is None:
        return None
    capture = cv2.VideoCapture(str(video_path))
    try:
        capture.set(cv2.CAP_PROP_POS_FRAMES, found.frame_index)
        ok, frame = capture.read()
    finally:
        capture.release()
    if not ok:
        return None
    folder = last / FRAME_CONTENT
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("anchor_*"):
        old.unlink()
    path = folder / f"anchor_{found.frame_index}{image_suffix}"
    cv2.imwrite(str(path), frame)
    return path
