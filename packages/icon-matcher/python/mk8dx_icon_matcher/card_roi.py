"""The central card ROI selection (CENTRAL_RECOGNITION section 8.6, phase 5): from the RF-DETR
detections (owner boxes, lap-index badges) and the image-derived yellow reference boxes, which part
of the photo holds the result card or the Select-a-Ghost panel.

One specification in Python (this reference), TypeScript (``ts/sharedCardRoi.ts``) and Java
(``CardRoi.java``), transcribed from the Web scanner's ``roi.ts`` (a float-exact port of the APK's
``AutoCardRoiSelector``): box coordinates are Java floats, so every value stored in a box or
computed by the APK in float arithmetic is rounded to float32 (``f32``) at the same places.

Routes, in order: the player box with at least three of its badges; a ghost box with the player's
badges split off and yellow support; a single badge column (3 or 7) with yellow support; two badge
groups (6 or 14) with the better yellow support, kept away from the other group. The ROI is
projected from the badge column (16.5 badge widths left, 7.4 right, 2.6 heights above, 0.75 below,
the missing rows split above and below, 2 % / 8 % margin) and limited by the owner box. The
Select-a-Ghost panel is projected from its badge column and row pitch (``select_ghost_detail``).

A detection is ``{"label", "score", "left", "top", "right", "bottom"}`` (normalised); a box is
``[left, top, right, bottom]`` pixels.
"""

from __future__ import annotations

import math
import struct

LAP_INDEX_WIDTH_SCALE_BREAKPOINT_PX = 40.0
LARGE_LAP_INDEX_WIDTH_SCALE = 1.012
SMALL_LAP_INDEX_WIDTH_SCALE = 1.014
OWNER_CONSTRAINT_X_MARGIN_RATIO = 0.12
OWNER_CONSTRAINT_TOP_MARGIN_RATIO = 0.04
OWNER_CONSTRAINT_BOTTOM_MARGIN_RATIO = 0.12
GHOST_DETAIL_LEFT_ROWGAP = -1.0
GHOST_DETAIL_TOP_ROWGAP = -1.0
GHOST_DETAIL_RIGHT_ROWGAP_RACE3 = 5.0
GHOST_DETAIL_RIGHT_ROWGAP_RACE7 = 6.0
GHOST_DETAIL_BOTTOM_ROWGAP = 1.0
GHOST_DETAIL_BADGE_COLUMN_ONLY = "ghost_detail_lap_badge_column_only"
MAX_VALUE = 1.7976931348623157e308
_F32_MAX = 3.4028234663852886e38


def f32(x: float) -> float:
    """Round to float32 (JavaScript ``Math.fround``)."""
    try:
        return struct.unpack("f", struct.pack("f", x))[0]
    except OverflowError:
        return math.copysign(math.inf, x)


def js_round(x: float) -> float:
    return float(math.floor(x + 0.5))


class Box:
    __slots__ = ("left", "top", "right", "bottom")

    def __init__(self, left: float, top: float, right: float, bottom: float):
        left, top, right, bottom = f32(left), f32(top), f32(right), f32(bottom)
        self.left = min(left, right)
        self.top = min(top, bottom)
        self.right = max(left, right)
        self.bottom = max(top, bottom)

    def width(self) -> float:
        return f32(max(1.0, f32(self.right - self.left)))

    def height(self) -> float:
        return f32(max(1.0, f32(self.bottom - self.top)))

    def center_x(self) -> float:
        return f32(f32(self.left + self.right) * 0.5)

    def center_y(self) -> float:
        return f32(f32(self.top + self.bottom) * 0.5)

    def contains_center(self, box: "Box") -> bool:
        cx, cy = box.center_x(), box.center_y()
        return self.left <= cx <= self.right and self.top <= cy <= self.bottom

    def expanded(self, dx: float, dy: float) -> "Box":
        return Box(self.left - dx, self.top - dy, self.right + dx, self.bottom + dy)

    def clipped(self, width: float, height: float) -> "Box":
        return Box(max(0.0, min(f32(width - 1.0), self.left)), max(0.0, min(f32(height - 1.0), self.top)),
                   max(1.0, min(width, self.right)), max(1.0, min(height, self.bottom)))

    def rounded_clamp(self, width: float, height: float) -> "Box":
        q_left = max(0.0, min(f32(width - 2.0), js_round(self.left)))
        q_top = max(0.0, min(f32(height - 2.0), float(math.ceil(self.top))))
        q_right = max(f32(q_left + 1.0), min(width, js_round(self.right)))
        q_bottom = max(f32(q_top + 1.0), min(height, js_round(self.bottom)))
        return Box(q_left, q_top, q_right, q_bottom)

    def to_list(self) -> list:
        return [self.left, self.top, self.right, self.bottom]


class Candidate:
    def __init__(self, roi: Box, reason: str):
        self.roi = roi
        self.reason = reason
        self.selected_route = ""
        self.score = 0.0
        self.rfdetr_score = 0.0
        self.lap_index_count = 0
        self.player_lap_index_count = 0
        self.ghost_lap_index_count = 0
        self.lap_index_width = 0.0
        self.lap_index_height = 0.0
        self.row_gap = 0.0
        self.projected_row_count = 0.0
        self.source_box = None
        self.alt_roi = None
        self.yellow_reference = None
        self.yellow_panel_band = None
        self.owner_constraint_box = None
        self.roi_before_owner_constraint = None
        self.roi_before_dual_owner_group_constraint = None
        self.other_lap_group_source_box = None
        self.yellow_support_score = 0.0
        self.yellow_panel_band_overlap = 0.0
        self.yellow_legacy_left_score = 0.0
        self.yellow_support_pass = False
        self.yellow_support_reason = ""
        self.owner_constraint_applied = False
        self.owner_constraint_reason = ""
        self.dual_owner_group_constraint_applied = False
        self.dual_owner_group_constraint_reason = ""
        self.dual_owner_group_separator_y = 0.0

    def copy_with_roi(self, roi: Box) -> "Candidate":
        copy = Candidate(roi, self.reason)
        copy.__dict__.update({k: v for k, v in self.__dict__.items() if k not in ("roi", "reason")})
        return copy

    def to_dict(self) -> dict:
        out = {}
        for key, value in self.__dict__.items():
            camel = key.split("_")[0] + "".join(p.title() for p in key.split("_")[1:])
            out[camel] = value.to_list() if isinstance(value, Box) else value
        return out


def _selected(candidate: Candidate, counts: dict, player: Box | None, ghost: Box | None) -> dict:
    return {"status": "implemented", "reason": "", "selectedReason": candidate.reason, "fallbackUsed": False,
            "counts": counts, "roi": candidate.roi.to_list(), "candidate": candidate.to_dict(),
            "playerOwnerBox": player.to_list() if player else None, "ghostOwnerBox": ghost.to_list() if ghost else None}


def _blocked(status: str, reason: str, counts: dict, player: Box | None, ghost: Box | None) -> dict:
    return {"status": status, "reason": reason, "selectedReason": "", "fallbackUsed": False, "counts": counts,
            "roi": None, "candidate": None, "playerOwnerBox": player.to_list() if player else None,
            "ghostOwnerBox": ghost.to_list() if ghost else None}


def _support(passed: bool, score: float, reason: str, reference=None, panel_band=None, overlap=0.0, left=0.0) -> dict:
    return {"pass": passed, "score": score, "reason": reason, "reference": reference, "panelBand": panel_band,
            "panelBandOverlap": overlap, "legacyLeftScore": left}


def median(values: list) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    mid = len(s) // 2
    if len(s) % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) * 0.5


def detection_box_pixels(d: dict, width: float, height: float) -> Box:
    return Box(f32(d["left"] * width), f32(d["top"] * height), f32(d["right"] * width), f32(d["bottom"] * height))


def count_detections(detections: list) -> dict:
    counts = {"candidateCount": len(detections), "playerCount": 0, "ghostCount": 0, "lapIndexCount": 0}
    for d in detections:
        if d["label"] == "player_timetrail_box":
            counts["playerCount"] += 1
        elif d["label"] == "ghost_timetrail_box":
            counts["ghostCount"] += 1
        elif d["label"] == "lap_index":
            counts["lapIndexCount"] += 1
    return counts


def _best_detection(detections: list, label: str) -> dict | None:
    best = None
    for d in detections:
        if d["label"] == label and (best is None or d["score"] > best["score"]):
            best = d
    return best


def _lap_index_boxes(detections: list, width: float, height: float) -> list:
    boxes = []
    for d in detections:
        if d["label"] == "lap_index":
            box = detection_box_pixels(d, width, height)
            if box.width() >= 2.0 and box.height() >= 2.0:
                boxes.append(box)
    return boxes


def bounds(boxes: list) -> Box:
    left = top = MAX_VALUE
    right = bottom = -MAX_VALUE
    for b in boxes:
        left, top = min(left, b.left), min(top, b.top)
        right, bottom = max(right, b.right), max(bottom, b.bottom)
    return Box(left, top, right, bottom)


def _expanded_owner(owner: Box) -> Box:
    return owner.expanded(f32(owner.width() * 0.08), f32(owner.height() * 0.12))


def _inside(lap_boxes: list, owner: Box) -> list:
    expanded = _expanded_owner(owner)
    return [b for b in lap_boxes if expanded.contains_center(b)]


def _outside(lap_boxes: list, owner: Box) -> list:
    expanded = _expanded_owner(owner)
    return [b for b in lap_boxes if not expanded.contains_center(b)]


def _overlap1d(a1: float, a2: float, b1: float, b2: float) -> float:
    return max(0.0, min(a2, b2) - max(a1, b1))


def _overlap_area(a: Box, b: Box) -> float:
    return _overlap1d(a.left, a.right, b.left, b.right) * _overlap1d(a.top, a.bottom, b.top, b.bottom)


def _sum(values) -> float:
    total = 0.0
    for v in values:
        total += v
    return total


def _is_straight_badge_column(boxes: list) -> bool:
    mean_x = _sum(b.center_x() for b in boxes) / len(boxes)
    mean_y = _sum(b.center_y() for b in boxes) / len(boxes)
    sxy = syy = 0.0
    for b in boxes:
        sxy += (b.center_y() - mean_y) * (b.center_x() - mean_x)
        syy += (b.center_y() - mean_y) * (b.center_y() - mean_y)
    if syy <= 0:
        return False
    k = sxy / syy
    residual = 0.0
    for b in boxes:
        off = b.center_x() - (mean_x + k * (b.center_y() - mean_y))
        residual += off * off
    return (math.sqrt(residual / len(boxes)) <= 0.2 * median([b.width() for b in boxes])
            and abs(math.atan(k) * 180.0 / math.pi) <= 8.0)


def _without_duplicate_badges(boxes: list) -> list:
    if len(boxes) < 2:
        return boxes
    limit = 0.4 * median([b.height() for b in boxes])
    kept: list = []
    for box in sorted(boxes, key=lambda b: b.center_y()):
        last = kept[-1] if kept else None
        if last is not None and abs(box.center_y() - last.center_y()) < limit and abs(box.center_x() - last.center_x()) < limit:
            continue
        kept.append(box)
    return kept


def _constrain_to_owner_envelope(projected: Box, envelope: Box, width: float, height: float) -> Box:
    left, top = max(projected.left, envelope.left), max(projected.top, envelope.top)
    right, bottom = min(projected.right, envelope.right), min(projected.bottom, envelope.bottom)
    if f32(right - left) < f32(envelope.width() * 0.45) or f32(bottom - top) < f32(envelope.height() * 0.45):
        return envelope.clipped(width, height)
    return Box(left, top, right, bottom).clipped(width, height)


def _projected_roi(group: list, width: float, height: float, reason: str, reference_score: float,
                   owner: Box | None) -> Candidate | None:
    if len(group) < 2:
        return None
    widths = [b.width() for b in group]
    heights = [b.height() for b in group]
    centers_y = sorted(b.center_y() for b in group)
    x1s = [b.left for b in group]
    x2s = [b.right for b in group]
    lap_top, lap_bottom = MAX_VALUE, -MAX_VALUE
    for b in group:
        lap_top, lap_bottom = min(lap_top, b.top), max(lap_bottom, b.bottom)
    lap_w, lap_h = median(widths), median(heights)
    row_gap = lap_h * 1.28
    if len(centers_y) >= 2:
        row_gap = median([centers_y[i + 1] - centers_y[i] for i in range(len(centers_y) - 1)])
    width_scale = LARGE_LAP_INDEX_WIDTH_SCALE if lap_w > LAP_INDEX_WIDTH_SCALE_BREAKPOINT_PX else SMALL_LAP_INDEX_WIDTH_SCALE
    eff_w, eff_h = lap_w * width_scale, lap_h
    observed_span = centers_y[-1] - centers_y[0] if centers_y else 0.0
    projected_rows = 7.0 if owner is None else max(2.0, float(len(group)))
    missing_span = max(0.0, row_gap * (projected_rows - 1.0) - observed_span)
    median_x1, median_x2 = median(x1s), median(x2s)
    source = Box(min(b.left for b in group), min(b.top for b in group), max(b.right for b in group),
                 max(b.bottom for b in group))
    card_left = median_x1 - eff_w * 16.5
    card_top = lap_top - missing_span * 0.5 - eff_h * 2.6
    card_right = median_x2 + eff_w * 7.4
    card_bottom = lap_bottom + missing_span * 0.5 + eff_h * 0.75
    card_w, card_h = max(1.0, card_right - card_left), max(1.0, card_bottom - card_top)
    roi = Box(card_left - card_w * 0.02, card_top - card_h * 0.08, card_right + card_w * 0.02,
              card_bottom + card_h * 0.08).clipped(width, height)
    before_owner = roi
    owner_box = None
    if owner is not None:
        owner_box = Box(f32(owner.left - f32(owner.width() * OWNER_CONSTRAINT_X_MARGIN_RATIO)),
                        f32(owner.top - f32(owner.height() * OWNER_CONSTRAINT_TOP_MARGIN_RATIO)),
                        f32(owner.right + f32(owner.width() * OWNER_CONSTRAINT_X_MARGIN_RATIO)),
                        f32(owner.bottom + f32(owner.height() * OWNER_CONSTRAINT_BOTTOM_MARGIN_RATIO))).clipped(width, height)
        roi = _constrain_to_owner_envelope(roi, owner_box, width, height)
    if reason == "lap_index_projected_yellow_ref":
        roi = roi.rounded_clamp(width, height)
    aspect = roi.width() / max(1.0, roi.height())
    aspect_score = max(0.0, 1.0 - abs(aspect - 2.25) / 2.25)
    candidate = Candidate(roi, reason)
    candidate.score = min(2.0, len(group) / 3.0) + aspect_score + reference_score * 2.0
    candidate.rfdetr_score = reference_score
    candidate.lap_index_count = len(group)
    candidate.lap_index_width = eff_w
    candidate.lap_index_height = eff_h
    candidate.row_gap = row_gap
    candidate.source_box = source
    candidate.projected_row_count = projected_rows
    candidate.owner_constraint_applied = owner is not None
    candidate.owner_constraint_box = owner_box
    candidate.roi_before_owner_constraint = before_owner
    candidate.owner_constraint_reason = "" if owner is None else "detected_owner_box_limits_lap_index_projection"
    return candidate


def _constrain_away(candidate: Candidate, selected: list, groups: list, selected_index: int, width: float,
                    height: float) -> Candidate:
    if candidate is None or not selected or len(groups) < 2 or selected_index < 0:
        return candidate
    selected_bounds = bounds(selected)
    selected_cy = selected_bounds.center_y()
    nearest, nearest_distance = None, MAX_VALUE
    for i, group in enumerate(groups):
        if i == selected_index or not group:
            continue
        distance = abs(bounds(group).center_y() - selected_cy)
        if nearest is None or distance < nearest_distance:
            nearest, nearest_distance = group, distance
    if nearest is None:
        return candidate
    other = bounds(nearest)
    roi = candidate.roi
    if selected_bounds.bottom <= other.top:
        separator = f32(f32(selected_bounds.bottom + other.top) * 0.5)
        constrained = Box(roi.left, roi.top, roi.right, min(roi.bottom, separator)).clipped(width, height)
    elif selected_bounds.top >= other.bottom:
        separator = f32(f32(other.bottom + selected_bounds.top) * 0.5)
        constrained = Box(roi.left, max(roi.top, separator), roi.right, roi.bottom).clipped(width, height)
    else:
        return candidate
    if (abs(constrained.left - roi.left) < 0.01 and abs(constrained.top - roi.top) < 0.01
            and abs(constrained.right - roi.right) < 0.01 and abs(constrained.bottom - roi.bottom) < 0.01):
        return candidate
    updated = candidate.copy_with_roi(constrained)
    updated.roi_before_dual_owner_group_constraint = roi
    updated.dual_owner_group_constraint_applied = True
    updated.dual_owner_group_constraint_reason = "selected_lap_index_group_must_not_cross_other_owner_group"
    updated.dual_owner_group_separator_y = separator
    updated.other_lap_group_source_box = other
    return updated


def _owner_groups(lap_boxes: list) -> list:
    s = sorted(lap_boxes, key=lambda b: b.center_y())
    if len(s) <= 7:
        return [s]
    split_at, largest = 1, -1.0
    for i in range(len(s) - 1):
        gap = f32(s[i + 1].center_y() - s[i].center_y())
        if gap > largest:
            largest, split_at = gap, i + 1
    return [s[:split_at], s[split_at:]]


def _yellow_support(group: list, refs: list, width: float, height: float) -> dict:
    if not group or len(group) < 2:
        return _support(False, 0.0, "not_enough_lap_indexes_for_yellow_support")
    if not refs:
        return _support(False, 0.0, "no_image_derived_yellow_reference")
    gb = bounds(group)
    gh, gw = max(1.0, gb.height()), max(1.0, gb.width())
    band = Box(max(0.0, gb.left - gw * 12.0), max(0.0, gb.top - gw * 1.5), min(width, gb.right + gw * 2.0),
               min(height, gb.bottom + gw * 1.5))
    band_area = max(1.0, band.width() * band.height())
    best = _support(False, 0.0, "yellow_reference_not_spatially_consistent")
    for ref in refs:
        vertical = (_overlap1d(gb.top - gh * 0.35, gb.bottom + gh * 0.35, ref.top, ref.bottom)
                    / max(1.0, min(gb.height() + gh * 0.70, ref.height())))
        band_overlap = _overlap_area(band, ref) / band_area
        left_distance = gb.left - ref.right
        left_score = max(0.0, min(1.0, left_distance / max(1.0, width * 0.18))) if ref.center_x() < gb.center_x() else 0.0
        aspect = ref.width() / max(1.0, ref.height())
        aspect_score = max(0.0, 1.0 - abs(aspect - 1.15) / 1.15)
        edge_penalty = 0.75 if (ref.top < height * 0.03 or ref.bottom > height * 0.97) else 0.0
        band_score = band_overlap * 5.0 + vertical + aspect_score * 0.25 - edge_penalty
        left_ref_score = vertical * 2.5 + left_score + aspect_score - edge_penalty
        if band_overlap >= 0.25 and band_score > best["score"]:
            best = _support(True, band_score, "yellow_reference_overlaps_lap_index_panel_band", ref, band,
                            band_overlap, left_ref_score)
        elif vertical >= 0.35 and left_score > 0.0 and left_ref_score > best["score"]:
            best = _support(True, left_ref_score, "yellow_reference_left_of_lap_indexes_with_vertical_support", ref,
                            band, band_overlap, left_ref_score)
    return best


def _boxes(raw: list) -> list:
    return [b if isinstance(b, Box) else Box(*b) for b in (raw or [])]


def select(detections: list, width: float, height: float, yellow_references: list) -> dict:
    """The end-screen card ROI (``AutoCardRoiSelector.select``)."""
    refs = _boxes(yellow_references)
    counts = count_detections(detections)
    lap_boxes = _lap_index_boxes(detections, width, height)
    player = _best_detection(detections, "player_timetrail_box")
    ghost = _best_detection(detections, "ghost_timetrail_box")
    ghost_box = detection_box_pixels(ghost, width, height) if ghost else None
    player_box = detection_box_pixels(player, width, height) if player else None
    if player:
        candidate = _projected_roi(_inside(lap_boxes, player_box), width, height, "lap_index_projected_player_ref",
                                   player["score"], player_box)
        if candidate is not None and candidate.lap_index_count >= 3:
            candidate.selected_route = "player_and_ghost_supported" if ghost else "player_box_supported"
            candidate.player_lap_index_count = candidate.lap_index_count
            candidate.ghost_lap_index_count = len(_inside(lap_boxes, ghost_box)) if ghost_box else 0
            candidate.yellow_support_pass = True
            candidate.yellow_support_reason = "owner_box_route_does_not_require_yellow_fallback"
            return _selected(candidate, counts, player_box, ghost_box)
    if not player and ghost_box and counts["lapIndexCount"] > 5:
        ghost_group = _inside(lap_boxes, ghost_box)
        player_group = _outside(lap_boxes, ghost_box)
        if len(ghost_group) >= 2 and len(player_group) >= 2:
            support = _yellow_support(player_group, refs, width, height)
            if support["pass"]:
                candidate = _projected_roi(player_group, width, height, "lap_index_projected_ghost_split_yellow_ref", 0.0, None)
                if candidate is not None:
                    candidate.selected_route = "ghost_box_lap_split"
                    candidate.player_lap_index_count = len(player_group)
                    candidate.ghost_lap_index_count = len(ghost_group)
                    candidate.yellow_support_score = support["score"]
                    candidate.yellow_support_pass = True
                    candidate.yellow_support_reason = support["reason"]
                    candidate.yellow_reference = support["reference"]
                    return _selected(candidate, counts, player_box, ghost_box)
    if not player and not ghost and counts["lapIndexCount"] in (3, 7):
        support = _yellow_support(lap_boxes, refs, width, height)
        if support["pass"]:
            candidate = _projected_roi(lap_boxes, width, height, "lap_index_projected_single_owner_yellow_ref", 0.0, None)
            if candidate is not None:
                candidate.selected_route = "lap_index_single_owner_yellow"
                candidate.player_lap_index_count = candidate.lap_index_count
                candidate.ghost_lap_index_count = 0
                candidate.yellow_support_score = support["score"]
                candidate.yellow_support_pass = True
                candidate.yellow_support_reason = support["reason"]
                candidate.yellow_reference = support["reference"]
                return _selected(candidate, counts, player_box, ghost_box)
    if not player and not ghost and counts["lapIndexCount"] in (6, 14):
        groups = _owner_groups(lap_boxes)
        best, best_support, best_index = None, _support(False, 0.0, "no_lap_index_group_with_yellow_support"), -1
        for i, group in enumerate(groups):
            if len(group) < 2:
                continue
            support = _yellow_support(group, refs, width, height)
            if not support["pass"] or support["score"] <= best_support["score"]:
                continue
            candidate = _projected_roi(group, width, height, "lap_index_projected_yellow_ref", 0.0, None)
            if candidate is None:
                continue
            best = _constrain_away(candidate, group, groups, i, width, height)
            best_support, best_index = support, i
        if best is not None:
            best.selected_route = "lap_index_dual_owner_yellow"
            best.player_lap_index_count = best.lap_index_count
            best.ghost_lap_index_count = sum(len(g) for i, g in enumerate(groups) if i != best_index)
            best.yellow_support_score = best_support["score"]
            best.yellow_support_pass = True
            best.yellow_support_reason = best_support["reason"]
            best.yellow_reference = best_support["reference"]
            best.yellow_panel_band = best_support["panelBand"]
            best.yellow_panel_band_overlap = best_support["panelBandOverlap"]
            best.yellow_legacy_left_score = best_support["legacyLeftScore"]
            return _selected(best, counts, player_box, ghost_box)
    return _blocked("blocked_missing_supported_owner_lap_index_route",
                    "Step 01 did not find a general supported route from owner boxes, lap-index grouping, and "
                    "image-derived yellow panel evidence.", counts, player_box, ghost_box)


def select_sparse_dual_yellow_candidate(detections: list, width: float, height: float,
                                        yellow_references: list) -> dict | None:
    """Opt-in recovery: two separated badge rows, no player box, yellow panel support."""
    refs = _boxes(yellow_references)
    if any(d["label"] == "player_timetrail_box" for d in detections):
        return None
    lap_boxes = sorted(_lap_index_boxes(detections, width, height), key=lambda b: b.center_y())
    if len(lap_boxes) < 4 or len(lap_boxes) > 9:
        return None
    if len(lap_boxes) > 7 and any(d["label"] == "ghost_timetrail_box" for d in detections):
        return None
    gaps = [lap_boxes[i + 1].center_y() - lap_boxes[i].center_y() for i in range(len(lap_boxes) - 1)]
    largest = max(gaps)
    split = gaps.index(largest) + 1
    other_gaps = [g for i, g in enumerate(gaps) if i != split - 1]
    if (split < 3 and len(lap_boxes) <= 7) or largest < median(other_gaps) * 2.2 or largest < height * 0.05:
        return None
    groups = [lap_boxes[:split], lap_boxes[split:]]
    if len(lap_boxes) > 7 and not any(len(g) == 7 and 1 <= len(groups[1 - i]) <= 2 for i, g in enumerate(groups)):
        return None
    best = None
    for i, group in enumerate(groups):
        if len(group) < 3 or not _is_straight_badge_column(group):
            continue
        group_gaps = [group[j + 1].center_y() - group[j].center_y() for j in range(len(group) - 1)]
        if (min(group_gaps) < median([b.height() for b in group]) * 0.55
                or max(group_gaps) > min(group_gaps) * 1.4):
            continue
        panel_refs = [r for r in refs if 2.2 <= r.width() / r.height() <= 4.5]
        support = _yellow_support(group, panel_refs, width, height)
        if not support["pass"] or support["panelBandOverlap"] < 0.25:
            continue
        candidate = _projected_roi(group, width, height, "lap_index_sparse_dual_yellow_candidate", 0, None)
        if candidate is None:
            continue
        candidate = _constrain_away(candidate, group, groups, i, width, height)
        if len(lap_boxes) > 7 and support["reference"] is not None:
            ref = support["reference"]
            margin = ref.height() * 0.03
            candidate = candidate.copy_with_roi(Box(min(candidate.roi.left, ref.left - margin),
                                                    min(candidate.roi.top, ref.top - margin),
                                                    max(candidate.roi.right, ref.right + margin),
                                                    max(candidate.roi.bottom, ref.bottom + margin)).clipped(width, height))
        candidate.selected_route = "lap_index_sparse_dual_yellow_candidate"
        candidate.player_lap_index_count = len(group)
        candidate.ghost_lap_index_count = len(groups[1 - i])
        candidate.yellow_support_pass = True
        candidate.yellow_support_reason = support["reason"]
        candidate.yellow_support_score = support["score"]
        candidate.yellow_reference = support["reference"]
        candidate.yellow_panel_band = support["panelBand"]
        candidate.yellow_panel_band_overlap = support["panelBandOverlap"]
        if best is None or support["score"] > best[1]:
            best = (candidate, support["score"])
    if best is None:
        return None
    out = _selected(best[0], count_detections(detections), None, None)
    out["playerOwnerBox"] = out["ghostOwnerBox"] = None
    return out


def _ghost_detail_roi(c1y: float, cx: float, row_gap: float, lap_count: int, right_row_gap: float, width: float,
                      height: float) -> Box:
    last_row_y = c1y + (lap_count - 1) * row_gap
    return Box(cx + GHOST_DETAIL_LEFT_ROWGAP * row_gap, c1y + GHOST_DETAIL_TOP_ROWGAP * row_gap,
               cx + right_row_gap * row_gap, last_row_y + GHOST_DETAIL_BOTTOM_ROWGAP * row_gap).clipped(width, height)


def select_ghost_detail(detections: list, width: float, height: float) -> dict:
    """The Select-a-Ghost panel ROI from its badge column (``AutoCardRoiSelector.selectGhostDetail``)."""
    counts = count_detections(detections)
    raw = _lap_index_boxes(detections, width, height)
    ghost = _best_detection(detections, "ghost_timetrail_box")
    ghost_box = detection_box_pixels(ghost, width, height) if ghost else None
    lap_boxes = raw
    if len(raw) >= 3:
        med_cx = median([b.center_x() for b in raw])
        med_w = median([b.width() for b in raw])
        lap_boxes = [b for b in raw if abs(b.center_x() - med_cx) < 1.5 * med_w]
    lap_boxes = _without_duplicate_badges(lap_boxes)
    column_only = (ghost is None and _best_detection(detections, "player_timetrail_box") is None
                   and len(lap_boxes) >= 3 and _is_straight_badge_column(lap_boxes))
    if (ghost is None and not column_only) or len(lap_boxes) < 3:
        return _blocked("blocked_missing_ghost_detail_support",
                        "Ghost-detail layout requires a ghost_timetrail_box detection plus at least three lap-index "
                        "detections.", counts, None, ghost_box)
    widths = [b.width() for b in lap_boxes]
    heights = [b.height() for b in lap_boxes]
    centers_x = [b.center_x() for b in lap_boxes]
    centers_y = sorted(b.center_y() for b in lap_boxes)
    row_gap = median([centers_y[i + 1] - centers_y[i] for i in range(len(centers_y) - 1)])
    cx = median(centers_x)
    if row_gap < 4.0:
        return _blocked("blocked_degenerate_ghost_detail_lap_geometry",
                        "Ghost-detail lap-index rows are too close together for a stable panel projection.", counts,
                        None, ghost_box)
    n = len(lap_boxes)
    profile = 7 if n >= 5 else 3
    if n == 4 or n > 7:
        return _blocked("blocked_ambiguous_ghost_detail_lap_count",
                        f"Ghost-detail lap-index count {n} does not resolve to a 3-lap or 7-lap panel.", counts, None,
                        ghost_box)
    span = centers_y[-1] - centers_y[0]
    span_rows = js_round(span / row_gap) + 1
    missing = profile - span_rows
    if missing < 0:
        return _blocked("blocked_degenerate_ghost_detail_lap_geometry",
                        f"Ghost-detail lap-index span exceeds the expected {profile}-row lattice.", counts, None,
                        ghost_box)
    right_gap = GHOST_DETAIL_RIGHT_ROWGAP_RACE7 if profile == 7 else GHOST_DETAIL_RIGHT_ROWGAP_RACE3
    roi = _ghost_detail_roi(centers_y[0], cx, row_gap, profile, right_gap, width, height)
    alt = _ghost_detail_roi(centers_y[0] - missing * row_gap, cx, row_gap, profile, right_gap, width,
                            height) if missing > 0 else None
    candidate = Candidate(roi, GHOST_DETAIL_BADGE_COLUMN_ONLY if column_only else "ghost_detail_lap_badge_projection")
    candidate.selected_route = "ghost_detail_panel"
    ghost_score = ghost["score"] if ghost else 0.0
    candidate.score = min(2.0, n / 3.0) + ghost_score * 2.0
    candidate.rfdetr_score = ghost_score
    candidate.lap_index_count = n
    candidate.player_lap_index_count = 0
    candidate.ghost_lap_index_count = n
    candidate.lap_index_width = median(widths)
    candidate.lap_index_height = median(heights)
    candidate.row_gap = row_gap
    candidate.source_box = bounds(lap_boxes)
    candidate.alt_roi = alt
    candidate.yellow_support_pass = True
    candidate.yellow_support_reason = "ghost_detail_route_does_not_use_yellow_support"
    return _selected(candidate, counts, None, ghost_box)
