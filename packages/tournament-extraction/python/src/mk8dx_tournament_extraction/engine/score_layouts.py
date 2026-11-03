from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np

from .extract_common import EXPORT_IMAGE_SUFFIX, write_export_image
from .project_paths import PROJECT_ROOT

DEFAULT_SCORE_LAYOUT_ID = "lan2_split_2p"
LAN1_SCORE_LAYOUT_ID = "lan1_full_1p"


@dataclass(frozen=True)
class ScoreLayout:
    layout_id: str
    score_anchor_roi: Tuple[int, int, int, int]
    scoreboard_points_roi: Tuple[int, int, int, int]
    twelfth_place_check_roi: Tuple[int, int, int, int]
    player_name_coords: List[Tuple[Tuple[int, int], Tuple[int, int]]]
    base_position_strip_roi: Tuple[Tuple[int, int], Tuple[int, int]]
    character_roi_left: int
    race_points_coords: List[Tuple[Tuple[int, int], Tuple[int, int]]]
    total_points_coords: List[Tuple[Tuple[int, int], Tuple[int, int]]]
    race_digit_starts: List[Tuple[int, int]]
    total_digit_starts: List[Tuple[int, int]]


def _rects(values) -> List[Tuple[Tuple[int, int], Tuple[int, int]]]:
    return [((x1, y1), (x2, y2)) for x1, y1, x2, y2 in values]


def _load_score_layouts() -> Dict[str, ScoreLayout]:
    """The score-screen geometry from the central scoreboard frames (packages/icon-matcher
    frame_geometry.scoreboard_frames; one copy for Tournament Live and this engine)."""
    from mk8dx_icon_matcher.frame_geometry import scoreboard_frames

    layouts = {}
    for layout_id, layout in scoreboard_frames()["scoreboard"]["layouts"].items():
        x1, y1, x2, y2 = layout["positionStripRect"]
        layouts[layout_id] = ScoreLayout(
            layout_id=layout_id,
            score_anchor_roi=tuple(layout["scoreAnchorRoi"]),
            scoreboard_points_roi=tuple(layout["scoreboardPointsRoi"]),
            twelfth_place_check_roi=tuple(layout["twelfthPlaceCheckRoi"]),
            player_name_coords=_rects(layout["playerNameRects"]),
            base_position_strip_roi=((x1, y1), (x2, y2)),
            character_roi_left=int(layout["characterLeft"]),
            race_points_coords=_rects(layout["racePointsRects"]),
            total_points_coords=_rects(layout["totalPointsRects"]),
            race_digit_starts=[tuple(point) for point in layout["raceDigitStarts"]],
            total_digit_starts=[tuple(point) for point in layout["totalDigitStarts"]],
        )
    return layouts


_SCORE_LAYOUTS: Dict[str, ScoreLayout] = _load_score_layouts()
# The full-screen (1p) score board sits this far right of the split-screen (2p) one.
SCORE_LAYOUT_SHIFT_X = (_SCORE_LAYOUTS[LAN1_SCORE_LAYOUT_ID].character_roi_left
                        - _SCORE_LAYOUTS[DEFAULT_SCORE_LAYOUT_ID].character_roi_left)

_SCORE_LAYOUT_TAGS: Dict[str, str] = {
    DEFAULT_SCORE_LAYOUT_ID: "2p",
    LAN1_SCORE_LAYOUT_ID: "1p",
}
_SCORE_LAYOUT_IDS_BY_TAG: Dict[str, str] = {
    tag: layout_id for layout_id, tag in _SCORE_LAYOUT_TAGS.items()
}


def get_score_layout(layout_id: str | None) -> ScoreLayout:
    return _SCORE_LAYOUTS.get(str(layout_id or "").strip(), _SCORE_LAYOUTS[DEFAULT_SCORE_LAYOUT_ID])


def all_score_layouts() -> List[ScoreLayout]:
    return [_SCORE_LAYOUTS[DEFAULT_SCORE_LAYOUT_ID], _SCORE_LAYOUTS[LAN1_SCORE_LAYOUT_ID]]


def score_layout_tag_from_id(layout_id: str | None) -> str:
    return _SCORE_LAYOUT_TAGS.get(str(layout_id or "").strip(), _SCORE_LAYOUT_TAGS[DEFAULT_SCORE_LAYOUT_ID])


def score_layout_id_from_filename(image_path: str | os.PathLike[str] | None) -> str:
    if not image_path:
        return DEFAULT_SCORE_LAYOUT_ID
    stem = Path(str(image_path)).stem
    stem_parts = re.split(r"[+_]", stem)
    for part in reversed(stem_parts):
        if part in _SCORE_LAYOUTS:
            return part
        if part in _SCORE_LAYOUT_IDS_BY_TAG:
            return _SCORE_LAYOUT_IDS_BY_TAG[part]
    for layout_id in _SCORE_LAYOUTS:
        if layout_id in stem:
            return layout_id
    return DEFAULT_SCORE_LAYOUT_ID


def build_score_frame_filename(video_label: str, race_number: int, frame_content: str, score_layout_id: str) -> str:
    return f"{video_label}+Race_{race_number:03}+{frame_content}+{score_layout_id}{EXPORT_IMAGE_SUFFIX}"


def draw_score_layout_demo(
    image: np.ndarray,
    layout_id: str,
    frame_content: str,
    output_path: str | os.PathLike[str],
) -> None:
    layout = get_score_layout(layout_id)
    annotated = image.copy()
    colors = {
        "score_anchor": (0, 255, 255),
        "score_points": (0, 165, 255),
        "twelfth_check": (0, 0, 255),
        "position_strip": (255, 255, 0),
        "character": (0, 255, 0),
        "player_name": (255, 0, 255),
        "race_points": (255, 128, 0),
        "total_points": (255, 0, 0),
    }

    def _draw_box(name: str, roi: Tuple[int, int, int, int], color_key: str) -> None:
        x, y, width, height = roi
        cv2.rectangle(annotated, (x, y), (x + width, y + height), colors[color_key], 2)
        cv2.putText(
            annotated,
            name,
            (x, max(18, y - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            colors[color_key],
            1,
            cv2.LINE_AA,
        )

    def _draw_rectangles(name: str, rectangles: List[Tuple[Tuple[int, int], Tuple[int, int]]], color_key: str) -> None:
        for index, ((x1, y1), (x2, y2)) in enumerate(rectangles, start=1):
            cv2.rectangle(annotated, (x1, y1), (x2, y2), colors[color_key], 1)
            if index == 1:
                cv2.putText(
                    annotated,
                    name,
                    (x1, max(18, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    colors[color_key],
                    1,
                    cv2.LINE_AA,
                )

    _draw_box("score anchor", layout.score_anchor_roi, "score_anchor")
    _draw_box("scoreboard points", layout.scoreboard_points_roi, "score_points")
    _draw_box("12th check", layout.twelfth_place_check_roi, "twelfth_check")
    (px1, py1), (px2, py2) = layout.base_position_strip_roi
    cv2.rectangle(annotated, (px1, py1), (px2, py2), colors["position_strip"], 2)
    cv2.putText(annotated, "position strip", (px1, max(18, py1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, colors["position_strip"], 1, cv2.LINE_AA)
    _draw_rectangles("player names", layout.player_name_coords, "player_name")
    _draw_rectangles("race points", layout.race_points_coords, "race_points")
    _draw_rectangles("total points", layout.total_points_coords, "total_points")
    first_character = ((layout.character_roi_left, 47), (layout.character_roi_left + 48, 47 + 626))
    cv2.rectangle(annotated, first_character[0], first_character[1], colors["character"], 2)
    cv2.putText(
        annotated,
        "character column",
        (first_character[0][0], max(18, first_character[0][1] - 6)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        colors["character"],
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        annotated,
        f"{frame_content} | {layout.layout_id}",
        (18, 24),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    write_export_image(output_file, annotated)


def score_demo_output_path(video_label: str, race_number: int, frame_content: str, score_layout_id: str) -> Path:
    return PROJECT_ROOT / "Output_Results" / "Debug" / "Score_Layout_Demos" / (
        f"{video_label}+Race_{race_number:03}+{frame_content}+{score_layout_id}+roi_demo{EXPORT_IMAGE_SUFFIX}"
    )
