"""The central card-detector post-processing (CENTRAL_RECOGNITION section 8.6, phase 5).

One specification in Python (this reference), TypeScript (``ts/sharedDetections.ts``) and Java
(``Detections.java``), the first part of the "detect and register" searcher strategy. Running the
RF-DETR model stays with each product (onnxruntime-web, Android's runtime); what its raw output
means is decided here:

- ``parse_detections``: per query and class (ghost card, player card, lap-index badge) the
  sigmoid score, kept at 0.20 or more; centre/size boxes become normalised left/top/right/bottom,
  clamped to the image; stable sort by score, at most 40. Arithmetic is float32 where the
  products computed in float32 (Java ``float``, JavaScript ``Math.fround``), so all three agree.
- ``clean_lap_index``: the lap-index badge clean-up both scanners ran (duplicate, then outlier,
  then off-lattice), each removing at most one weak extra badge on an otherwise complete
  six-badge end screen. Not for the Select-a-Ghost panel (its badges have their own route).

A detection is ``{"label", "score", "left", "top", "right", "bottom"}`` (normalised 0..1).
"""

from __future__ import annotations

import math

import numpy as np

DETECT_THRESHOLD = 0.2
CLASS_NAMES = ("ghost_timetrail_box", "player_timetrail_box", "lap_index", "background")
MAX_DETECTIONS = 40


def _f32(value: float) -> float:
    return float(np.float32(value))


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def parse_detections(boxes, logits, count: int, num_classes: int, width: int, height: int) -> list[dict]:
    """``boxes``: ``count * 4`` float32 (cx, cy, w, h, normalised); ``logits``: ``count *
    num_classes`` float32."""
    out = []
    n_cls = min(3, num_classes)
    for i in range(count):
        for cls in range(n_cls):
            score = _f32(1.0 / (1.0 + math.exp(-float(logits[i * num_classes + cls]))))
            if score < DETECT_THRESHOLD:
                continue
            cx, cy, bw, bh = (_f32(boxes[i * 4 + k]) for k in range(4))
            left = _clamp(_f32(_f32(cx - _f32(bw / 2.0)) * width), 0, width)
            top = _clamp(_f32(_f32(cy - _f32(bh / 2.0)) * height), 0, height)
            right = _clamp(_f32(_f32(cx + _f32(bw / 2.0)) * width), 0, width)
            bottom = _clamp(_f32(_f32(cy + _f32(bh / 2.0)) * height), 0, height)
            out.append({"label": CLASS_NAMES[cls], "score": score, "left": _f32(left / width),
                        "top": _f32(top / height), "right": _f32(right / width), "bottom": _f32(bottom / height)})
    out.sort(key=lambda d: -d["score"])  # stable, like Collections.sort / Array.prototype.sort
    return out[:MAX_DETECTIONS]


def _upper_median(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def _center_x(d: dict) -> float:
    return (d["left"] + d["right"]) / 2


def _center_y(d: dict) -> float:
    return (d["top"] + d["bottom"]) / 2


def _badges(detections: list[dict]) -> list[dict]:
    return [d for d in detections if d["label"] == "lap_index"]


def _best_owner(detections: list[dict], label: str) -> dict | None:
    candidates = [d for d in detections if d["label"] == label and d["score"] >= 0.8]
    candidates.sort(key=lambda d: -d["score"])
    return candidates[0] if candidates else None


def _without(detections: list[dict], removed: dict) -> list[dict]:
    return [d for d in detections if d is not removed]


def remove_weak_lap_index_outlier(detections: list[dict]) -> list[dict]:
    """One weak off-column badge beside six strong ones in one column."""
    badges = _badges(detections)
    if len(badges) != 7:
        return detections
    strong = [d for d in badges if d["score"] >= 0.85]
    weak = [d for d in badges if d["score"] <= 0.45]
    if len(strong) != 6 or len(weak) != 1:
        return detections
    column_x = _upper_median([_center_x(d) for d in strong])
    badge_width = _upper_median([d["right"] - d["left"] for d in strong])
    if badge_width <= 0 or any(abs(_center_x(d) - column_x) > badge_width * 0.25 for d in strong):
        return detections
    if abs(_center_x(weak[0]) - column_x) <= badge_width * 0.4:
        return detections
    return _without(detections, weak[0])


def _overlap(a: dict, b: dict) -> float:
    def area(d):
        return max(0.0, d["right"] - d["left"]) * max(0.0, d["bottom"] - d["top"])
    inter = max(0.0, min(a["right"], b["right"]) - max(a["left"], b["left"])) * \
        max(0.0, min(a["bottom"], b["bottom"]) - max(a["top"], b["top"]))
    union = area(a) + area(b) - inter
    return inter / union if union > 0 else 0.0


def _inside(d: dict, box: dict) -> bool:
    return box["top"] <= _center_y(d) <= box["bottom"]


def remove_weak_duplicate_lap_index(detections: list[dict]) -> list[dict]:
    """One weak badge duplicating a stronger one, when both three-row cards stay supported."""
    badges = _badges(detections)
    if len(badges) != 7:
        return detections
    player = _best_owner(detections, "player_timetrail_box")
    ghost = _best_owner(detections, "ghost_timetrail_box")
    if player is None or ghost is None or _center_y(ghost) >= _center_y(player):
        return detections
    duplicates = []
    for i in range(len(badges)):
        for j in range(i + 1, len(badges)):
            a, b = badges[i], badges[j]
            weaker = a if a["score"] <= b["score"] else b
            stronger = b if weaker is a else a
            if _overlap(a, b) >= 0.9 and weaker["score"] <= 0.5 and stronger["score"] >= 0.65:
                duplicates.append(weaker)
    if len(duplicates) != 1:
        return detections
    remaining = [d for d in badges if d is not duplicates[0]]
    if (sum(1 for d in remaining if _inside(d, ghost)) != 3 or sum(1 for d in remaining if _inside(d, player)) != 3
            or any(_inside(d, ghost) == _inside(d, player) for d in remaining)):
        return detections
    return _without(detections, duplicates[0])


def remove_weak_off_lattice_lap_index(detections: list[dict]) -> list[dict]:
    """One weak extra badge when both owners keep a complete three-row badge lattice."""
    badges = _badges(detections)
    if len(badges) != 7:
        return detections
    weak = [d for d in badges if d["score"] <= 0.55]
    strong = [d for d in badges if d["score"] >= 0.8]
    if len(weak) != 1 or len(strong) != 6:
        return detections
    player = _best_owner(detections, "player_timetrail_box")
    ghost = _best_owner(detections, "ghost_timetrail_box")
    if player is None or ghost is None:
        return detections
    owners = (player, ghost)
    if any(sum(1 for box in owners if _inside(d, box)) != 1 for d in strong):
        return detections
    for box in owners:
        rows = sorted(_center_y(d) for d in strong if _inside(d, box))
        height = box["bottom"] - box["top"]
        if (len(rows) != 3 or height <= 0
                or not 0.16 <= (rows[1] - rows[0]) / height <= 0.23
                or not 0.16 <= (rows[2] - rows[1]) / height <= 0.23):
            return detections
    column_x = _upper_median([_center_x(d) for d in strong])
    badge_width = _upper_median([d["right"] - d["left"] for d in strong])
    if badge_width <= 0 or any(abs(_center_x(d) - column_x) > badge_width * 0.3 for d in strong):
        return detections
    return _without(detections, weak[0])


def clean_lap_index(detections: list[dict]) -> list[dict]:
    """Duplicate, then outlier, then off-lattice (both scanners' order)."""
    return remove_weak_off_lattice_lap_index(remove_weak_lap_index_outlier(remove_weak_duplicate_lap_index(detections)))
