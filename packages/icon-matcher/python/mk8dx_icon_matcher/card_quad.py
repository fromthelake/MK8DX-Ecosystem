"""The central card quad (CENTRAL_RECOGNITION section 8.6, phase 5): which four card edges the
photographed result card has, from the straight line segments the product found in its card mask.

One specification in Python (this reference), TypeScript (``ts/sharedCardQuad.ts``) and Java
(``CardQuad.java``), taken from the Web scanner's ``pipeline.ts`` (a port of the APK's
``OfflineParityNativePipeline``). The products keep the pixel work (mask, Canny, ``HoughLinesP``)
and the warp; they hand the segments in:

1. ``filter_angles``: keep near-horizontal and near-vertical segments (within 14 degrees);
2. ``short_line_guard``: drop segments shorter than 70 px when two horizontal and two vertical
   clusters remain, else keep them all;
3. ``cluster_lines``: per orientation, segments within 12 px and 6 degrees of a cluster's mean
   join it; each cluster becomes one length-weighted line;
4. ``select_quad``: over the longest 14 horizontal and 12 vertical clusters, every top/bottom and
   left/right pair at least 16 % of the mask apart whose corners give an aspect within 0.45..2.2
   of the mask's; score ``1.5 * length + aspect + 0.7 * area``, the first highest wins.

``ghost_detail_deskew_seed``: on the Select-a-Ghost panel the lap-index badges stand in one
column; a line fit through their centres measures how far the photo is turned (0.2..8 degrees),
and the seed is the ROI rectangle turned about that column.

A segment is ``[x1, y1, x2, y2]`` pixels; a quad is ``[[x, y] tl, tr, br, bl]``. Angles are
``atan2(dy, dx) * 180 / pi`` in that order, in every port.
"""

from __future__ import annotations

import math

HOUGH_MIN_LINE_LENGTH_PX = 45.0
SHORT_LINE_MIN_LENGTH_PX = 70.0
AXIS_TOLERANCE_DEGREES = 14.0
CLUSTER_DISTANCE_PX = 12.0
CLUSTER_ANGLE_DEGREES = 6.0
DESKEW_MIN_DEGREES = 0.2
DESKEW_MAX_DEGREES = 8.0


class Line:
    """A segment, or a cluster's weighted line (``workflow_length``: its longest member)."""

    __slots__ = ("x1", "y1", "x2", "y2", "workflow_length", "angle", "support", "count", "key_name", "key_value")

    def __init__(self, x1: float, y1: float, x2: float, y2: float):
        self.x1, self.y1, self.x2, self.y2 = x1, y1, x2, y2
        self.workflow_length = math.nan
        self.angle = math.nan
        self.support = 0.0
        self.count = 1.0
        self.key_name = ""
        self.key_value = math.nan

    def angle_deg(self) -> float:
        return math.atan2(self.y2 - self.y1, self.x2 - self.x1) * 180.0 / math.pi

    def length(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)

    def workflow_len(self) -> float:
        return self.length() if math.isnan(self.workflow_length) else self.workflow_length

    def center_x(self) -> float:
        return (self.x1 + self.x2) * 0.5

    def center_y(self) -> float:
        return (self.y1 + self.y2) * 0.5

    def to_dict(self) -> dict:
        return {"x1": self.x1, "y1": self.y1, "x2": self.x2, "y2": self.y2,
                "workflowLength": self.workflow_len(), "angle": self.angle_deg() if math.isnan(self.angle) else self.angle,
                "support": self.support, "count": self.count, "keyName": self.key_name,
                "keyValue": None if math.isnan(self.key_value) else self.key_value}


def lines_from_segments(segments: list) -> list:
    return [Line(float(s[0]), float(s[1]), float(s[2]), float(s[3])) for s in segments]


def folded(line: Line) -> float:
    angle = abs(line.angle_deg())
    return min(angle, abs(180.0 - angle))


def filter_angles(lines: list) -> list:
    out = []
    for line in lines:
        f = folded(line)
        if f <= AXIS_TOLERANCE_DEGREES or abs(f - 90.0) <= AXIS_TOLERANCE_DEGREES:
            out.append(line)
    return out


def short_line_guard(axis_lines: list) -> tuple[list, bool, bool]:
    """``(lines, guard_used, fallback_used)``."""
    guarded = [line for line in axis_lines if line.workflow_len() >= SHORT_LINE_MIN_LENGTH_PX]
    if has_enough_cluster_support(guarded):
        return guarded, True, False
    return axis_lines, False, True


def has_enough_cluster_support(lines: list) -> bool:
    return count_orientation_clusters(lines, True) >= 2 and count_orientation_clusters(lines, False) >= 2


def count_orientation_clusters(lines: list, horizontal: bool) -> int:
    return sum(1 for line in cluster_lines(lines) if (folded(line) <= 45.0) == horizontal)


def cluster_lines(lines: list) -> list:
    horizontal = [line for line in lines if folded(line) <= 45.0]
    vertical = [line for line in lines if folded(line) > 45.0]
    return _cluster_orientation(horizontal, True) + _cluster_orientation(vertical, False)


def _coord(line: Line, horizontal: bool) -> float:
    return line.center_y() if horizontal else line.center_x()


def _cluster_orientation(lines: list, horizontal: bool) -> list:
    clusters: list = []
    for line in sorted(lines, key=lambda l: _coord(l, horizontal)):
        coord = _coord(line, horizontal)
        angle = line.angle_deg()
        for cluster in clusters:
            c_coord = _sum(_coord(l, horizontal) for l in cluster) / len(cluster)
            c_angle = _sum(l.angle_deg() for l in cluster) / len(cluster)
            if abs(coord - c_coord) <= CLUSTER_DISTANCE_PX and abs(angle - c_angle) <= CLUSTER_ANGLE_DEGREES:
                cluster.append(line)
                break
        else:
            clusters.append([line])
    out = []
    for cluster in clusters:
        line = _weighted_line(cluster)
        line.key_name = "y" if horizontal else "x"
        line.key_value = _coord(line, horizontal)
        out.append(line)
    return out


def _sum(values) -> float:
    # Left-to-right accumulation, as the JavaScript and Java loops do.
    total = 0.0
    for v in values:
        total += v
    return total


def _weighted_line(lines: list) -> Line:
    weight = x1 = y1 = x2 = y2 = max_length = support = 0.0
    for line in lines:
        length = max(1.0, line.length())
        weight += length
        x1 += line.x1 * length
        y1 += line.y1 * length
        x2 += line.x2 * length
        y2 += line.y2 * length
        max_length = max(max_length, line.workflow_len())
        support += line.support * length
    denom = max(1.0, weight)
    out = Line(x1 / denom, y1 / denom, x2 / denom, y2 / denom)
    out.workflow_length = max_length
    out.angle = 0.0
    for line in lines:
        length = max(1.0, line.length())
        out.angle += line.angle_deg() * length / denom
    out.support = support / denom
    out.count = float(len(lines))
    return out


def line_intersection(a: Line, b: Line) -> list | None:
    den = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2)
    if abs(den) < 1e-4:
        return None
    left_cross = a.x1 * a.y2 - a.y1 * a.x2
    right_cross = b.x1 * b.y2 - b.y1 * b.x2
    return [(left_cross * (b.x1 - b.x2) - (a.x1 - a.x2) * right_cross) / den,
            (left_cross * (b.y1 - b.y2) - (a.y1 - a.y2) * right_cross) / den]


def _dist(a: list, b: list) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def quad_aspect(quad: list) -> float:
    width = max(_dist(quad[1], quad[0]), _dist(quad[2], quad[3]))
    height = max(_dist(quad[3], quad[0]), _dist(quad[2], quad[1]))
    return width / max(1.0, height)


def quad_area(quad: list) -> float:
    total = 0.0
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        total += a[0] * b[1] - b[0] * a[1]
    return total * 0.5


def select_quad(mask_w: int, mask_h: int, clusters: list) -> list | None:
    """The best card quad from the clustered lines, or None."""
    h_clusters, v_clusters = [], []
    for line in clusters:
        if folded(line) <= 45.0:
            line.key_name, line.key_value = "y", line.center_y()
            h_clusters.append(line)
        else:
            line.key_name, line.key_value = "x", line.center_x()
            v_clusters.append(line)
    if len(h_clusters) < 2 or len(v_clusters) < 2:
        return None
    h_clusters.sort(key=lambda l: -l.workflow_len())
    v_clusters.sort(key=lambda l: -l.workflow_len())
    h_limit, v_limit = min(14, len(h_clusters)), min(12, len(v_clusters))
    h, w = mask_h, mask_w
    expected_aspect = w / max(1.0, h)
    best_score, best_quad = -math.inf, None
    for hi in range(h_limit):
        top_a = h_clusters[hi]
        for hj in range(hi + 1, h_limit):
            bottom_a = h_clusters[hj]
            top = top_a if top_a.center_y() <= bottom_a.center_y() else bottom_a
            bottom = bottom_a if top is top_a else top_a
            if abs(bottom.center_y() - top.center_y()) < h * 0.16:
                continue
            for vi in range(v_limit):
                left_a = v_clusters[vi]
                for vj in range(vi + 1, v_limit):
                    right_a = v_clusters[vj]
                    left = left_a if left_a.center_x() <= right_a.center_x() else right_a
                    right = right_a if left is left_a else left_a
                    if abs(right.center_x() - left.center_x()) < w * 0.16:
                        continue
                    corners = [line_intersection(top, left), line_intersection(top, right),
                               line_intersection(bottom, right), line_intersection(bottom, left)]
                    if any(c is None for c in corners):
                        continue
                    aspect = quad_aspect(corners)
                    if aspect <= 0.0:
                        continue
                    ratio = aspect / max(0.001, expected_aspect)
                    if ratio < 0.45 or ratio > 2.2:
                        continue
                    length_score = min(1.0, (0.5 * (top.workflow_len() + bottom.workflow_len())) / max(1.0, w))
                    length_score += min(1.0, (0.5 * (left.workflow_len() + right.workflow_len())) / max(1.0, h))
                    aspect_score = max(0.0, 1.0 - abs(math.log(max(0.05, ratio))) / math.log(2.0))
                    area_score = min(1.0, abs(quad_area(corners)) / max(1.0, w * h * 0.45))
                    score = 1.5 * length_score + aspect_score + 0.7 * area_score
                    if score > best_score:
                        best_score, best_quad = score, corners
    return best_quad


def ghost_detail_deskew_seed(detections: list, frame_w: int, frame_h: int, roi_left: float, roi_top: float,
                             crop_w: int, crop_h: int) -> tuple[list, float] | None:
    """``(quad, degrees)`` of the turned ROI seed in ROI-crop coordinates, or None. ``detections``:
    ``{"label", "left", "top", "right", "bottom"}`` normalised."""
    if not frame_w or not frame_h:
        return None
    boxes = []
    for d in detections:
        if d["label"] != "lap_index":
            continue
        w = (d["right"] - d["left"]) * frame_w
        if w < 2.0:
            continue
        boxes.append(((d["left"] + d["right"]) / 2 * frame_w, (d["top"] + d["bottom"]) / 2 * frame_h, w))
    if len(boxes) < 3:
        return None
    med_cx = sorted(b[0] for b in boxes)[len(boxes) // 2]
    med_w = sorted(b[2] for b in boxes)[len(boxes) // 2]
    column = [b for b in boxes if abs(b[0] - med_cx) < 1.5 * med_w]
    if len(column) < 3:
        return None
    mean_y = _sum(b[1] for b in column) / len(column)
    mean_x = _sum(b[0] for b in column) / len(column)
    sxy = syy = 0.0
    for b in column:
        sxy += (b[1] - mean_y) * (b[0] - mean_x)
        syy += (b[1] - mean_y) * (b[1] - mean_y)
    if syy <= 0:
        return None
    k = sxy / syy
    residual = 0.0
    for b in column:
        off = b[0] - (mean_x + k * (b[1] - mean_y))
        residual += off * off
    if math.sqrt(residual / len(column)) > 0.2 * med_w:
        return None
    degrees = math.atan(k) * 180.0 / math.pi
    if abs(degrees) < DESKEW_MIN_DEGREES or abs(degrees) > DESKEW_MAX_DEGREES:
        return None
    n = math.hypot(1.0, k)
    ux, uy, vx, vy = 1.0 / n, -k / n, k / n, 1.0 / n
    px, py = mean_x - roi_left, mean_y - roi_top
    upright = [[0.0, 0.0], [crop_w - 1.0, 0.0], [crop_w - 1.0, crop_h - 1.0], [0.0, crop_h - 1.0]]
    quad = []
    for x, y in upright:
        dx, dy = x - px, y - py
        quad.append([px + dx * ux + dy * vx, py + dx * uy + dy * vy])
    return quad, degrees
