"""The canonical card geometry before the crop (issue #99, phase 5): how the Web scanner and Android
turn the card quad found in the frame into the 1280x720 canonical card that the slot and crop search
(``crop_search``) read.

The products' stages 17 and 18 (``pipeline.ts``, ``OfflineParityNativePipeline.java``), in order:

1. ``bounding_rect``: the integer rectangle around the quad (floor/ceil, clipped to the frame). For the
   ghost_detail deskew seed it is the rectangle around the upright ROI crop instead (``shifted_quad``).
2. ``quad_from_rect``: the destination corners of the perspective warp (right and bottom edges ``- 1``).
   The products solve the perspective transform quad -> corners with OpenCV
   (``getPerspectiveTransform``); that solve is pixel work and its result is an input here.
3. ``target_box``: where the card lies on the canonical frame: a fixed race-7 box per owner, a race-3 box
   derived from the relative grid's content extents (``content_extent``) with the race-7 margins, or a
   fixed ghost_detail panel box.
4. ``canonical_align``: the scale and translation that put the warped quad's box onto the target box,
   as a 3x3 matrix composed onto the homography (``compose``, OpenCV ``gemm`` order).
5. ``antialias_plan``: when the warp shrinks below 0.5, the frame is first area-reduced so that the warp
   keeps a scale of 0.8; the composed matrix is rescaled by ``unscale``.
6. On a registered Select-a-Ghost panel the panel registration (``panel_registration``) is composed on
   top, once more as an input from the pixel work.

Everything here is pure arithmetic in a fixed order, so Python, TypeScript (``ts/sharedCanonicalWarp.ts``)
and Java (``CanonicalWarp.java``) give the same doubles; ``vectors/canonical-warp-v1.json`` checks that,
including real cases recorded from the Web scanner on the public test set
(``tools/capture_canonical_warp_web.mjs``). Rounding is ``Math.round`` (half up).
"""

from __future__ import annotations

import math

SCHEMA = "mk8dx.canonical-warp.v1"
CANONICAL_SIZE = (1280, 720)
# The canonical target boxes [left, top, right, bottom] (pipeline.ts / OfflineParityNativePipeline.java).
PLAYER_BOX_RACE7 = (548.0, 362.0, 1231.0, 661.0)
GHOST_BOX_RACE7 = (548.0, 42.0, 1231.0, 349.0)
GHOST_DETAIL_BOX_RACE3 = (540.0, 170.0, 782.0, 331.0)
GHOST_DETAIL_BOX_RACE7 = (540.0, 120.0, 767.0, 379.0)
ANTIALIAS_BELOW_SCALE = 0.5   # a warp that shrinks more than this is area-reduced first ...
ANTIALIAS_TARGET_SCALE = 0.8  # ... until the warp keeps this scale
CONTENT_KEYS = ("lap_index_boxes_rel", "total_strip_rel", "lap_strips_rel")
GHOST_DETAIL_DESKEW_SEED = "ghost_detail_deskew_seed"


def js_round(value: float) -> int:
    """JavaScript/Java ``Math.round``: half up."""
    return int(math.floor(value + 0.5))


def bounding_rect(quad, width: int, height: int) -> list[int]:
    """``[x, y, w, h]``: floor of the smallest and ceil of the largest corner, clipped to the frame."""
    xs = [float(p[0]) for p in quad]
    ys = [float(p[1]) for p in quad]
    x = max(0, min(width - 1, math.floor(min(xs))))
    y = max(0, min(height - 1, math.floor(min(ys))))
    right = max(x + 1, min(width, math.ceil(max(xs))))
    bottom = max(y + 1, min(height, math.ceil(max(ys))))
    return [x, y, right - x, bottom - y]


def quad_from_rect(rect) -> list[list[float]]:
    """The four corners of a rectangle, clockwise from top-left; right and bottom are ``x + w - 1``."""
    x, y, w, h = rect
    return [[x, y], [x + w - 1, y], [x + w - 1, y + h - 1], [x, y + h - 1]]


def shifted_quad(quad, dx: float, dy: float) -> list[list[float]]:
    """Every corner moved by ``(dx, dy)`` (the products' ``Quad.shifted``)."""
    return [[float(p[0]) + dx, float(p[1]) + dy] for p in quad]


def quad_box(quad) -> list[float]:
    """``[left, top, right, bottom]`` around the quad's corners."""
    xs = [float(p[0]) for p in quad]
    ys = [float(p[1]) for p in quad]
    return [min(xs), min(ys), max(xs), max(ys)]


def _append_rel(grid: dict, value, boxes: list) -> None:
    if isinstance(value, list) and len(value) == 4 and not isinstance(value[0], list):
        anchor = grid.get("anchor") or {}
        ax, ay = float(anchor.get("x", 0.0) or 0.0), float(anchor.get("y", 0.0) or 0.0)
        rel = [float(v) if v is not None else 0.0 for v in value]
        x1, y1, x2, y2 = ax + rel[0], ay + rel[1], ax + rel[2], ay + rel[3]
        boxes.append([min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)])   # ordered, as the products' BoxD
        return
    if isinstance(value, list):
        for child in value:
            if isinstance(child, list):
                _append_rel(grid, child, boxes)


def content_extent(owner_grid) -> list[float] | None:
    """The union ``[left, top, right, bottom]`` of an owner grid's lap-index, total and lap strips
    (anchor plus relative box, each box ordered), or None when it has none."""
    if not owner_grid:
        return None
    boxes: list = []
    for key in CONTENT_KEYS:
        value = owner_grid.get(key)
        if isinstance(value, list):
            _append_rel(owner_grid, value, boxes)
    if not boxes:
        return None
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def target_box(owner: str, race_key: str, ghost_detail: bool, race3_content=None, race7_content=None) -> dict:
    """``{"box": [l, t, r, b], "source": ...}``: where the card lies on the canonical frame."""
    if ghost_detail:
        race7 = race_key == "race7"
        return {"box": list(GHOST_DETAIL_BOX_RACE7 if race7 else GHOST_DETAIL_BOX_RACE3),
                "source": "fixed_ghost_detail_canonical_target_" + ("race7" if race7 else "race3")}
    race7 = GHOST_BOX_RACE7 if owner == "ghost" else PLAYER_BOX_RACE7
    if race_key != "race3":
        return {"box": list(race7), "source": "fixed_race7_canonical_target"}
    if race3_content is None or race7_content is None:
        return {"box": list(race7), "source": "fallback_fixed_race7_missing_relative_grid_content_extent"}
    left = race7_content[0] - race7[0]
    top = race7_content[1] - race7[1]
    right = race7[2] - race7_content[2]
    bottom = race7[3] - race7_content[3]
    return {"box": [race3_content[0] - left, race3_content[1] - top, race3_content[2] + right,
                    race3_content[3] + bottom],
            "source": "derived_from_race3_relative_grid_using_race7_card_content_margins"}


def canonical_align(current_box, target) -> list[float]:
    """``[scaleX, scaleY, translateX, translateY]`` that map ``current_box`` onto ``target`` (both boxes
    ordered; a side shorter than 1 counts as 1, as the products' ``BoxD.width``)."""
    sx = max(1.0, target[2] - target[0]) / max(1.0, current_box[2] - current_box[0])
    sy = max(1.0, target[3] - target[1]) / max(1.0, current_box[3] - current_box[1])
    return [sx, sy, target[0] - current_box[0] * sx, target[1] - current_box[1] * sy]


def align_matrix(align) -> list[float]:
    sx, sy, tx, ty = align
    return [sx, 0.0, tx, 0.0, sy, ty, 0.0, 0.0, 1.0]


def compose(a, b) -> list[float]:
    """``a x b`` for row-major 3x3 matrices, each element summed left to right (OpenCV ``gemm``)."""
    return [a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j] for i in range(3) for j in range(3)]


def antialias_plan(align, cols: int, rows: int) -> dict | None:
    """The area reduction before a strongly shrinking warp: ``factor``, the reduced size and the matrix
    ``unscale`` that the composed transform is multiplied with; None when the warp keeps 0.5 or more."""
    shrink = min(align[0], align[1])
    if not (0 < shrink < ANTIALIAS_BELOW_SCALE):
        return None
    factor = shrink / ANTIALIAS_TARGET_SCALE
    reduced_w = max(1, js_round(cols * factor))
    reduced_h = max(1, js_round(rows * factor))
    return {"factor": factor, "reducedW": reduced_w, "reducedH": reduced_h,
            "unscale": [cols / reduced_w, 0.0, 0.0, 0.0, rows / reduced_h, 0.0, 0.0, 0.0, 1.0]}


def canonical_transform(case: dict) -> dict:
    """The whole geometry of one card from a case's inputs: ``frame`` ``[cols, rows]``, ``quad`` (the
    card quad in frame pixels), ``seed``, ``deskewRoi``, ``owner``, ``raceKey``, ``ghostDetail``,
    ``race3Content`` / ``race7Content`` and the pixel work's ``homography`` (and ``registration`` or
    None). ``deskewRoi`` (the deskew seed only) is ``[left, top, cols, rows]``: the ROI crop's size placed
    at the ROI box's fractional top-left."""
    cols, rows = case["frame"]
    if case.get("seed") == GHOST_DETAIL_DESKEW_SEED:
        left, top, roi_cols, roi_rows = case["deskewRoi"]
        bounds = bounding_rect(shifted_quad(quad_from_rect([0, 0, roi_cols, roi_rows]), left, top), cols, rows)
    else:
        bounds = bounding_rect(case["quad"], cols, rows)
    destination = quad_from_rect(bounds)
    current = quad_box(destination)
    target = target_box(case["owner"], case["raceKey"], bool(case["ghostDetail"]), case.get("race3Content"),
                        case.get("race7Content"))
    align = canonical_align(current, target["box"])
    affine = align_matrix(align)
    composed = compose(affine, case["homography"])
    plan = antialias_plan(align, cols, rows)
    if plan is not None:
        composed = compose(composed, plan["unscale"])
    final = composed if case.get("registration") is None else compose(case["registration"], composed)
    return {"bounds": bounds, "destination": destination, "currentBox": current, "target": target,
            "align": align, "affine": affine, "composed": composed, "antialias": plan, "final": final,
            "warpSource": [cols, rows] if plan is None else [plan["reducedW"], plan["reducedH"]]}
