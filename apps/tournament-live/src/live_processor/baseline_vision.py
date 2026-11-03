from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2  # type: ignore
import numpy as np  # type: ignore

from .baseline_assets import resolve_live_asset_file
from .paths import assert_read_allowed

TARGET_WIDTH = 1280
TARGET_HEIGHT = 720

# One copy of the score-screen geometry: the central scoreboard frames, as the extraction engine
# loads them (packages/icon-matcher frame_geometry.scoreboard_frames).
from mk8dx_tournament_extraction.engine.score_layouts import (  # noqa: E402
    _SCORE_LAYOUTS as SCORE_LAYOUTS,
    DEFAULT_SCORE_LAYOUT_ID,
    LAN1_SCORE_LAYOUT_ID,
    SCORE_LAYOUT_SHIFT_X,
    ScoreLayout,
)
from mk8dx_tournament_extraction import locale_templates  # noqa: E402

INITIAL_SCAN_GATE_TEMPLATE_GRID_X = 313
INITIAL_SCAN_GATE_TEMPLATE_GRID_Y = 46
INITIAL_SCAN_GATE_TEMPLATE_GRID_SIZE = 52

POSITION_SCAN_MIN_PLAYERS = 6
POSITION_SCAN_MIN_ROW_COEFF = 0.4
POSITION_SCAN_MIN_AVG_COEFF = 0.6
POSITION_GATE_THRESHOLD = 0.3

VERTICAL_DILATE_KERNEL = np.ones((3, 1), np.uint8)


@dataclass(frozen=True)
class TemplateImage:
    name: str
    path: Path
    gray: Any
    alpha_mask: Any | None


def template_root() -> Path:
    return assert_read_allowed(resolve_live_asset_file("templates", "Trackname_template.png").parent)


def load_template(name: str) -> TemplateImage:
    path = assert_read_allowed(resolve_live_asset_file("templates", name))
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise FileNotFoundError(f"Could not read imported baseline template: {path}")
    if len(image.shape) == 3 and image.shape[2] == 4:
        alpha_mask = image[:, :, 3]
        gray = cv2.cvtColor(image[:, :, :3], cv2.COLOR_BGR2GRAY)
    elif len(image.shape) == 3:
        alpha_mask = None
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        alpha_mask = None
        gray = image
    return TemplateImage(name=name, path=path, gray=gray, alpha_mask=alpha_mask)


def load_score_gate_templates() -> dict[str, TemplateImage]:
    return {
        "white": load_template("Score_template_white.png"),
        "black": load_template("Score_template_black.png"),
    }


def locale_race_templates() -> tuple[locale_templates.LocaleTemplate, ...]:
    """The "Race" counter templates of the other game locales (manifest beside the templates, roadmap
    LANGUAGES_15 A1); none without a manifest."""
    templates_dir = resolve_live_asset_file("templates", "Race_template.png").parent
    return tuple(entry for entry in locale_templates.read_manifest(templates_dir) if entry.kind == "race")


def locale_race_candidates() -> tuple[dict[str, object], ...]:
    return tuple({"roi": entry.roi, "template_name": f"race_{entry.locale}"} for entry in locale_race_templates())


def load_initial_scan_templates() -> dict[str, TemplateImage]:
    templates = {
        "track": load_template("Trackname_template.png"),
        "race": load_template("Race_template.png"),
        "race_nl": load_template("Race_template_NL_final.png"),
        "ignore": load_template("ignore.png"),
        "ignore_album_gallery": load_template("albumgallery_ignore.png"),
        "ignore_2": load_template("ignore_2.png"),
    }
    templates_dir = resolve_live_asset_file("templates", "Race_template.png").parent
    for entry in locale_race_templates():
        templates[f"race_{entry.locale}"] = load_template(entry.file.relative_to(templates_dir.resolve()).as_posix())
    return templates


def determine_scaling(image: Any) -> tuple[float, float, int, int, int, int]:
    gray_frame = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    sum_row_intensity = np.sum(gray_frame, axis=1)
    sum_col_intensity = np.sum(gray_frame, axis=0)
    top, left, bottom, right = find_borders(sum_row_intensity, sum_col_intensity, threshold=15000)
    crop_width = max(1, right - left)
    crop_height = max(1, bottom - top)
    scale_x = TARGET_WIDTH / crop_width
    scale_y = TARGET_HEIGHT / crop_height
    return scale_x, scale_y, left, top, crop_width, crop_height


def find_borders(
    sum_row_intensity: Any,
    sum_col_intensity: Any,
    *,
    threshold: int,
) -> tuple[int, int, int, int]:
    row_indices = np.where(sum_row_intensity > threshold)[0]
    col_indices = np.where(sum_col_intensity > threshold)[0]
    if row_indices.size == 0 or col_indices.size == 0:
        return 0, 0, TARGET_HEIGHT, TARGET_WIDTH
    top = int(row_indices[0])
    bottom = int(row_indices[-1] + 1)
    left = int(col_indices[0])
    right = int(col_indices[-1] + 1)
    return top, left, bottom, right


def crop_and_upscale_image(
    image: Any,
    left: int,
    top: int,
    crop_width: int,
    crop_height: int,
    target_width: int = TARGET_WIDTH,
    target_height: int = TARGET_HEIGHT,
) -> Any:
    cropped_image = image[top : top + crop_height, left : left + crop_width]
    return cv2.resize(cropped_image, (target_width, target_height), interpolation=cv2.INTER_LINEAR)


def to_working_canvas(frame: Any) -> Any:
    _scale_x, _scale_y, left, top, crop_width, crop_height = determine_scaling(frame)
    return crop_and_upscale_image(frame, left, top, crop_width, crop_height)


def preprocess_score_roi(roi: Any) -> Any:
    _, binary_section = cv2.threshold(roi, 180, 255, cv2.THRESH_BINARY)
    modified_binary_section = binary_section.copy()
    step_height = max(1, roi.shape[0] // 12)
    for i in range(12):
        sub_region_y_start = i * step_height
        sub_region_y_end = min((i + 1) * step_height, roi.shape[0])
        sub_region = binary_section[sub_region_y_start:sub_region_y_end, :]
        if sub_region.size == 0:
            continue
        white_pixels = cv2.countNonZero(sub_region)
        black_pixels = sub_region.size - white_pixels
        if white_pixels > black_pixels:
            _, binary_section_sub = cv2.threshold(sub_region, 120, 255, cv2.THRESH_BINARY)
            sub_region_copy = cv2.dilate(binary_section_sub.copy(), VERTICAL_DILATE_KERNEL, iterations=1)
            sub_region_copy = cv2.bitwise_not(sub_region_copy)
            modified_binary_section[sub_region_y_start:sub_region_y_end, :] = sub_region_copy
        else:
            modified_binary_section[sub_region_y_start:sub_region_y_end, :] = cv2.dilate(
                sub_region, VERTICAL_DILATE_KERNEL, iterations=1
            )
    return modified_binary_section


def preprocess_initial_scan_roi(roi: Any, process_type: int) -> Any:
    if process_type == 0:
        return preprocess_score_roi(roi)
    blurred = cv2.GaussianBlur(roi, (5, 5), 0)
    if len(blurred.shape) == 3 and blurred.shape[2] == 3:
        gray_blurred = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY)
    else:
        gray_blurred = blurred
    thresholded = cv2.adaptiveThreshold(gray_blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    return cv2.filter2D(thresholded, -1, kernel)


def expanded_roi(image: Any, roi_definition: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """Match the baseline initial-scan ROI padding for small capture shifts."""
    roi_x, roi_y, roi_width, roi_height = roi_definition
    roi_x = max(int(roi_x) - 25, 0)
    roi_y = max(int(roi_y) - 25, 0)
    roi_width = min(int(roi_width) + 50, int(image.shape[1]) - roi_x)
    roi_height = min(int(roi_height) + 50, int(image.shape[0]) - roi_y)
    return roi_x, roi_y, roi_width, roi_height


def bounded_roi(image: Any, roi_definition: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """Clamp an ROI without applying the broader initial-scan padding."""
    roi_x, roi_y, roi_width, roi_height = roi_definition
    roi_x = max(int(roi_x), 0)
    roi_y = max(int(roi_y), 0)
    roi_width = min(int(roi_width), int(image.shape[1]) - roi_x)
    roi_height = min(int(roi_height), int(image.shape[0]) - roi_y)
    return roi_x, roi_y, roi_width, roi_height


def match_template(processed_roi: Any, template_binary: Any, alpha_mask: Any | None = None) -> float:
    if processed_roi.shape[0] < template_binary.shape[0] or processed_roi.shape[1] < template_binary.shape[1]:
        processed_roi = cv2.resize(
            processed_roi,
            (max(template_binary.shape[1], processed_roi.shape[1]), max(template_binary.shape[0], processed_roi.shape[0])),
            interpolation=cv2.INTER_LINEAR,
        )
    if alpha_mask is None:
        result = cv2.matchTemplate(processed_roi, template_binary, cv2.TM_CCOEFF_NORMED)
    else:
        result = cv2.matchTemplate(processed_roi, template_binary, cv2.TM_CCOEFF_NORMED, mask=alpha_mask)
    _min_val, max_val, _min_loc, _max_loc = cv2.minMaxLoc(result)
    if np.isnan(max_val):
        return 0.0
    return float(max_val)


def gate_tile_roi(image_source: Any, row_number: int, layout: ScoreLayout) -> Any:
    tile_size = INITIAL_SCAN_GATE_TEMPLATE_GRID_SIZE
    x1 = layout.score_anchor_roi[0] - 2
    y1 = INITIAL_SCAN_GATE_TEMPLATE_GRID_Y + ((int(row_number) - 1) * tile_size)
    return image_source[y1 : y1 + tile_size, x1 : x1 + tile_size]


def template_gate_tile(template: TemplateImage, row_number: int) -> tuple[Any, Any | None]:
    tile_size = INITIAL_SCAN_GATE_TEMPLATE_GRID_SIZE
    tile_y = (int(row_number) - 1) * tile_size
    tile = template.gray[tile_y : tile_y + tile_size, 0:tile_size]
    mask = None
    if template.alpha_mask is not None:
        mask = template.alpha_mask[tile_y : tile_y + tile_size, 0:tile_size]
    return tile, mask
