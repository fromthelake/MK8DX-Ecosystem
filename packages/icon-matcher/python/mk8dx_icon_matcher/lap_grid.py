"""The central lap-row anchor grid (CENTRAL_RECOGNITION section 8.6, phase 5): where every time
digit of a Time Trial card is cut, from the lap-index badges found on the canonical frame.

One specification in Python (this reference), TypeScript (``ts/sharedLapGrid.ts``) and Java
(``LapGrid.java``), taken from the Web scanner's ``Pipeline.buildDynamicGrid`` (a port of the APK's
``OfflineParityNativePipeline``) on the pack's time grid (``frame-definitions-v1.json``
``timeGrids``):

1. owners: the card boxes say which owner cards are on screen (ghost above, player below); the
   Select-a-Ghost panel has only the ghost; without boxes the badge count decides;
2. per owner the badges are matched in order to the grid's lap-index rows (at most 48 px from a
   row; most matches, then least distance, then highest score), near-duplicate badges first
   reduced to the strongest (two boxes overlapping 70 % in both directions are one badge);
3. the lap count (3 or 7) from the matches, which all owners must agree on;
4. per row a refinement (matched rows: the badge position; other rows: a linear fit of the
   offsets; the vertical scale from the badge spread, 0.85..1.18), the total row from the same
   fit; every digit slot is the grid slot with its per-slot nudge and canonical size, moved with
   its row's refinement (horizontally half way) and clipped to the frame.

A detection is ``{"label", "score", "left", "top", "right", "bottom"}`` (normalised); boxes are
``[left, top, right, bottom]`` pixels. Rounding is ``floor(x + 0.5)`` (JavaScript/Java Math.round).
"""

from __future__ import annotations

import math

from .segment_digits import canonical_slot_size

MAX_ANCHOR_DISTANCE_PX = 48.0
_PLAYER_TOTAL_X = (0, -3, 0, -2, -3, -2, -3, -1, -2)
_GHOST_TOTAL_X = (0, -2, 1, -2, -3, -1, -2, -1, -2)
_LAP_X = (0, -2, -1, -2, -1, -2, -1, -2, 0)


def _round(x: float) -> float:
    return float(math.floor(x + 0.5))


def _fsum(values) -> float:
    """Left-to-right float accumulation (Python's sum() compensates; the ports do not)."""
    total = 0.0
    for v in values:
        total += v
    return total


class Box:
    __slots__ = ("left", "top", "right", "bottom")

    def __init__(self, left: float, top: float, right: float, bottom: float):
        self.left, self.right = min(left, right), max(left, right)
        self.top, self.bottom = min(top, bottom), max(top, bottom)

    def clipped(self, width: int, height: int) -> "Box":
        return Box(max(0, min(width - 1, self.left)), max(0, min(height - 1, self.top)),
                   max(1, min(width, self.right)), max(1, min(height, self.bottom)))

    def width(self) -> float:
        return max(1.0, self.right - self.left)

    def height(self) -> float:
        return max(1.0, self.bottom - self.top)

    def center_x(self) -> float:
        return (self.left + self.right) * 0.5

    def center_y(self) -> float:
        return (self.top + self.bottom) * 0.5

    def as_list(self) -> list:
        return [float(self.left), float(self.top), float(self.right), float(self.bottom)]


def _owner_abs_box(owner_grid: dict, rel) -> Box:
    anchor = owner_grid.get("anchor") or {}
    ax = float(anchor.get("x", 0.0) or 0.0)
    ay = float(anchor.get("y", 0.0) or 0.0)
    def at(i):
        return float(rel[i]) if i < len(rel) and rel[i] is not None else 0.0
    return Box(ax + at(0), ay + at(1), ax + at(2), ay + at(3))


def canonical_lap_index_boxes(owner_grid: dict) -> list:
    rels = owner_grid.get("lap_index_boxes_rel")
    if rels is not None:
        return [_owner_abs_box(owner_grid, rel) for rel in rels if isinstance(rel, list)]
    strips = owner_grid.get("lap_strips_rel")
    anchor = owner_grid.get("anchor")
    if strips is None or anchor is None:
        return []
    ax = float(anchor.get("x", 0.0) or 0.0)
    ay = float(anchor.get("y", 0.0) or 0.0)
    out = []
    for rel in strips:
        if not isinstance(rel, list) or len(rel) < 4:
            continue
        cy = ay + (float(rel[1]) + float(rel[3])) * 0.5
        out.append(Box(ax - 12.5, cy - 12.5, ax + 12.5, cy + 12.5))
    return out


def _detection_box(d: dict, width: int, height: int) -> Box:
    return Box(d["left"] * width, d["top"] * height, d["right"] * width, d["bottom"] * height)


def active_owner_candidates(detections: list, lap_index_count: int, ghost_detail: bool) -> list:
    if ghost_detail:
        return ["ghost"]
    owners = []
    for owner in ("ghost", "player"):
        for d in detections:
            if d["label"] != f"{owner}_timetrail_box":
                continue
            physical = "ghost" if float(_f32((d["top"] + d["bottom"]) * 0.5)) < 0.5 else "player"
            if physical not in owners:
                owners.append(physical)
    if owners:
        owners.sort(key=lambda o: 0 if o == "ghost" else 1)
        return owners
    if lap_index_count >= 10:
        return ["ghost", "player"]
    if lap_index_count >= 2:
        return ["player"]
    return []


def _f32(value: float) -> float:
    import numpy as np
    return float(np.float32(value))


def match_owner_lap_rows(detections: list, owner_grid: dict, width: int, height: int, used: list) -> list:
    canonical = canonical_lap_index_boxes(owner_grid)
    if not canonical:
        return []
    available = [(i, d, _detection_box(d, width, height)) for i, d in enumerate(detections) if i not in used]
    available.sort(key=lambda c: -c[1]["score"])
    distinct = []
    for cand in available:
        box = cand[2]
        if any(max(0.0, min(box.right, k[2].right) - max(box.left, k[2].left)) >= 0.7 * min(box.width(), k[2].width())
               and max(0.0, min(box.bottom, k[2].bottom) - max(box.top, k[2].top)) >= 0.7 * min(box.height(), k[2].height())
               for k in distinct):
            continue
        distinct.append(cand)
    distinct.sort(key=lambda c: (c[2].center_y(), -c[1]["score"]))
    best = {"matches": [], "distance": float("inf"), "score": -float("inf")}

    def consider(current, distance_sum, score_sum):
        n, bn = len(current), len(best["matches"])
        if n > bn or (n == bn and distance_sum < best["distance"] - 1e-6) or \
                (n == bn and abs(distance_sum - best["distance"]) <= 1e-6 and score_sum > best["score"]):
            best["matches"] = list(current)
            best["distance"] = distance_sum
            best["score"] = score_sum

    def visit(row_pos, min_det, current, distance_sum, score_sum):
        if row_pos >= len(canonical):
            consider(current, distance_sum, score_sum)
            return
        visit(row_pos + 1, min_det, current, distance_sum, score_sum)
        row = canonical[row_pos]
        for det_pos in range(min_det, len(distinct)):
            index, d, box = distinct[det_pos]
            dx = box.center_x() - row.center_x()
            dy = box.center_y() - row.center_y()
            distance = math.sqrt(dx * dx + dy * dy)
            if distance > MAX_ANCHOR_DISTANCE_PX:
                continue
            current.append({"detIndex": index, "rowIndex": row_pos + 1, "canonical": row, "detected": box,
                            "distance": distance, "score": d["score"]})
            visit(row_pos + 1, det_pos + 1, current, distance_sum + distance, score_sum + d["score"])
            current.pop()

    visit(0, 0, [], 0.0, 0.0)
    for m in best["matches"]:
        used.append(m["detIndex"])
    return best["matches"]


def infer_active_lap_count(matches: list, total_lap_index_count: int) -> int:
    if len(matches) < 2:
        return 0
    max_row = max(m["rowIndex"] for m in matches)
    if len(matches) <= 3 and total_lap_index_count <= 8:
        return 3
    if len(matches) >= 5 or total_lap_index_count >= 10 or max_row >= 5:
        return 7
    if max_row <= 3:
        return 3
    return 0


def _common_lap_count(counts: dict) -> int:
    value = 0
    for count in counts.values():
        if not count or count <= 0:
            return 0
        if value == 0:
            value = count
        elif value != count:
            return 0
    return value


def _range(values: list) -> float:
    return max(values) - min(values) if values else 0.0


def _median(values: list) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 == 1 else (s[mid - 1] + s[mid]) * 0.5


def _linear_eval(samples: list, y: float, fallback: float) -> float:
    if not samples:
        return fallback
    if len(samples) >= 2 and _range([s[0] for s in samples]) > 1.0:
        mean_x = 0.0
        mean_y = 0.0
        for sy, value in samples:
            mean_x += sy
            mean_y += value
        mean_x /= len(samples)
        mean_y /= len(samples)
        num = 0.0
        den = 0.0
        for sy, value in samples:
            num += (sy - mean_x) * (value - mean_y)
            den += (sy - mean_x) * (sy - mean_x)
        if den > 1e-6:
            slope = num / den
            return slope * y + (mean_y - slope * mean_x)
    return _median([s[1] for s in samples])


def build_row_refinements(owner_grid: dict, matches: list) -> dict:
    out: dict = {}
    if not matches:
        return out
    canon_y = [m["canonical"].center_y() for m in matches]
    det_y = [m["detected"].center_y() for m in matches]
    row_sy = 1.0
    if len(matches) >= 2 and _range(canon_y) > 1.0:
        row_sy = max(0.85, min(1.18, _range(det_y) / max(1.0, _range(canon_y))))
    rows = canonical_lap_index_boxes(owner_grid)
    if not rows:
        return out
    dx_samples = []
    dy_samples = []
    for m in matches:
        c, d = m["canonical"], m["detected"]
        dx_samples.append((c.center_y(), d.center_x() - c.center_x()))
        dy_samples.append((c.center_y(), d.center_y() - c.center_y()))
        out[m["rowIndex"]] = {"anchorX": c.center_x(), "anchorY": c.center_y(), "refinedX": d.center_x(),
                              "refinedY": d.center_y(), "scaleX": 1.0, "scaleY": row_sy}
    for i, can in enumerate(rows):
        if i + 1 in out:
            continue
        out[i + 1] = {"anchorX": can.center_x(), "anchorY": can.center_y(),
                      "refinedX": can.center_x() + _linear_eval(dx_samples, can.center_y(), 0.0),
                      "refinedY": can.center_y() + _linear_eval(dy_samples, can.center_y(), 0.0),
                      "scaleX": 1.0, "scaleY": row_sy}
    return out


def _segment_offset_x(owner: str, kind: str, slot: int) -> int:
    if kind == "total":
        return (_GHOST_TOTAL_X if owner == "ghost" else _PLAYER_TOTAL_X)[slot]
    return _LAP_X[slot]


def _segment_offset_y(owner: str, kind: str) -> int:
    if kind == "total":
        return -4 if owner == "ghost" else -3
    return -4 if owner == "ghost" else -2


def canonical_slot_box(owner_grid: dict, rel, owner: str, kind: str, slot: int) -> Box:
    base = _owner_abs_box(owner_grid, rel)
    ox = _segment_offset_x(owner, kind, slot)
    oy = _segment_offset_y(owner, kind)
    w, h = canonical_slot_size(kind, slot)
    return Box(base.left + ox, base.top + oy, base.left + ox + w, base.top + oy + h)


def _total_refinement(owner_grid: dict, row_refs: dict) -> dict | None:
    total = owner_grid.get("total_digits_rel")
    if not total:
        return None
    anchor_rel = total[min(1, len(total) - 1)]
    if anchor_rel is None:
        return None
    anchor = canonical_slot_box(owner_grid, anchor_rel, "", "total", min(2, len(total)))
    dx = [(r["anchorY"], r["refinedX"] - r["anchorX"]) for r in row_refs.values()]
    dy = [(r["anchorY"], r["refinedY"] - r["anchorY"]) for r in row_refs.values()]
    sy = [r["scaleY"] for r in row_refs.values()]
    return {"anchorX": anchor.center_x(), "anchorY": anchor.center_y(),
            "refinedX": anchor.center_x() + _linear_eval(dx, anchor.center_y(), 0.0),
            "refinedY": anchor.center_y() + _linear_eval(dy, anchor.center_y(), 0.0),
            "scaleX": 1.0, "scaleY": 1.0 if not sy else _median(sy)}


def _transform_around_anchor(box: Box, ref: dict) -> Box:
    x1 = ref["refinedX"] + (_round(box.left) - ref["anchorX"]) * ref["scaleX"]
    y1 = ref["refinedY"] + (_round(box.top) - ref["anchorY"]) * ref["scaleY"]
    x2 = ref["refinedX"] + (_round(box.right) - ref["anchorX"]) * ref["scaleX"]
    y2 = ref["refinedY"] + (_round(box.bottom) - ref["anchorY"]) * ref["scaleY"]
    return Box(_round(min(x1, x2)), _round(min(y1, y2)), _round(max(x1, x2)), _round(max(y1, y2)))


def _blend_x(nominal: Box, refined: Box, blend: float) -> Box:
    b = max(0.0, min(1.0, blend))
    return Box(_round(nominal.left + (refined.left - nominal.left) * b), refined.top,
               _round(nominal.right + (refined.right - nominal.right) * b), refined.bottom)


def _slots_from_row(owner_grid: dict, rels, owner: str, kind: str, ref: dict | None, width: int, height: int) -> list:
    slots = []
    for i, rel in enumerate(rels):
        if not isinstance(rel, list):
            continue
        canonical = canonical_slot_box(owner_grid, rel, owner, kind, i + 1)
        read = canonical if ref is None else _blend_x(canonical, _transform_around_anchor(canonical, ref), 0.5)
        slots.append(read.clipped(width, height))
    return slots


def _union(boxes: list) -> Box:
    if not boxes:
        return Box(0, 0, 1, 1)
    return Box(min(b.left for b in boxes), min(b.top for b in boxes), max(b.right for b in boxes),
               max(b.bottom for b in boxes))


def build_dynamic_grid(time_grid: dict, race_key: str, ghost_detail: bool, width: int, height: int,
                       detections: list, lap_rows: list, nominal: bool = False) -> dict:
    """The digit slots of every active owner. ``time_grid``: ``{race key: {"owners": {...}}}`` (the
    pack's ``timeGrids.endScreen`` or ``timeGrids.ghostDetail``); ``lap_rows``: the lap-index
    detections; ``ghost_detail``: the Select-a-Ghost panel layout (one ghost owner, its own grid);
    ``nominal``: slots at their grid position (a registered Select-a-Ghost panel)."""
    race_key = race_key or "race7"
    grid = {"available": False, "status": "implemented", "reason": "", "raceKey": race_key,
            "activeLapCount": 0, "expectedFieldCount": 0, "activeOwners": [], "fields": [],
            "ownerAnchors": {}, "matchedLapIndexCount": 0, "ownerMatches": {}}
    race = time_grid.get(race_key)
    owners_root = race.get("owners") if isinstance(race, dict) else None
    if owners_root is None:
        grid["status"] = "blocked_missing_relative_grid"
        grid["reason"] = f"relative grid did not contain owners for {race_key}."
        return grid
    if len(lap_rows) < 2:
        grid["status"] = "blocked_insufficient_lap_index_support"
        grid["reason"] = "Need at least two native RF-DETR lap-index detections to build dynamic/refined grid."
        return grid
    owners = active_owner_candidates(detections, len(lap_rows), ghost_detail)
    if not owners:
        grid["status"] = "blocked_unresolved_active_ocr_profile"
        grid["reason"] = ("Could not resolve active player/ghost owner profile from Step 19 owner boxes or "
                          "lap-index support.")
        return grid
    used: list = []
    matches_by_owner: dict = {}
    lap_count_by_owner: dict = {}
    for owner in owners:
        owner_grid = owners_root.get(owner)
        if owner_grid is None:
            continue
        matches = match_owner_lap_rows(lap_rows, owner_grid, width, height, used)
        inferred = infer_active_lap_count(matches, len(lap_rows))
        grid["ownerMatches"][owner] = {"inferredLapCount": inferred, "matches": [
            {"rowIndex": m["rowIndex"], "detIndex": m["detIndex"], "distance": m["distance"], "score": m["score"]}
            for m in matches]}
        if inferred <= 0:
            continue
        matches_by_owner[owner] = matches
        lap_count_by_owner[owner] = inferred
        if matches:
            grid["ownerAnchors"][owner] = [_fsum(m["detected"].center_x() for m in matches) / len(matches),
                                           _fsum(m["detected"].center_y() for m in matches) / len(matches)]
    if not matches_by_owner:
        grid["status"] = "blocked_insufficient_owner_lap_index_support"
        grid["reason"] = "No active owner had enough matched lap-index rows to build a scoped dynamic grid."
        return grid
    active = _common_lap_count(lap_count_by_owner)
    if active <= 0:
        grid["status"] = "blocked_ambiguous_active_lap_count"
        grid["reason"] = "Active owners did not agree on a supported 3-lap or 7-lap OCR profile."
        return grid
    grid["available"] = True
    grid["activeLapCount"] = active
    for owner, matches in matches_by_owner.items():
        owner_grid = owners_root.get(owner)
        if owner_grid is None:
            continue
        grid["activeOwners"].append(owner)
        grid["matchedLapIndexCount"] += len(matches)
        row_refs = {} if nominal else build_row_refinements(owner_grid, matches)
        if ghost_detail and row_refs:
            grid["ownerAnchors"][owner] = [_fsum(r["refinedX"] for r in row_refs.values()) / len(row_refs),
                                           _fsum(r["refinedY"] for r in row_refs.values()) / len(row_refs)]
        lap_rels = owner_grid.get("lap_digits_rel")
        for lap in range(1, active + 1):
            if lap_rels is None or len(lap_rels) < lap or lap_rels[lap - 1] is None:
                continue
            slots = _slots_from_row(owner_grid, lap_rels[lap - 1], owner, "lap", row_refs.get(lap), width, height)
            grid["fields"].append({"name": f"{owner}_lap_{lap}", "owner": owner, "type": "lap", "lapIndex": lap,
                                   "box": _union(slots).clipped(width, height).as_list(),
                                   "slots": [s.as_list() for s in slots]})
        total_rels = owner_grid.get("total_digits_rel")
        if total_rels is not None:
            slots = _slots_from_row(owner_grid, total_rels, owner, "total", _total_refinement(owner_grid, row_refs),
                                    width, height)
            grid["fields"].append({"name": f"{owner}_total", "owner": owner, "type": "total", "lapIndex": 0,
                                   "box": _union(slots).clipped(width, height).as_list(),
                                   "slots": [s.as_list() for s in slots]})
    grid["expectedFieldCount"] = len(grid["activeOwners"]) * (grid["activeLapCount"] + 1)
    return grid
