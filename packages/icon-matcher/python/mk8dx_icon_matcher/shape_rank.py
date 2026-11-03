"""Contrast-invariant shape evidence on one already selected field crop.

This ranks Clean Assets on the same pixels as the ordinary field read. It does
not decide acceptance or use a product prediction or a human label.
"""

from __future__ import annotations

from typing import Literal

import cv2
import numpy as np

from .matcher import _Group


ShapeMode = Literal["masked_gray_ncc", "full_rgb_ncc"]


def rank_icon_shape(crop_bgr: np.ndarray, group: _Group,
                    mode: ShapeMode) -> dict:
    """Return the three strongest reference IDs and their separate NCC scores."""
    if (mode not in ("masked_gray_ncc", "full_rgb_ncc")
            or crop_bgr.ndim != 3 or crop_bgr.shape[2] != 3
            or crop_bgr.dtype != np.uint8 or not crop_bgr.size
            or len(group.ids) < 2 or group.rgb.shape[:3] != group.mask.shape
            or group.rgb.shape[0] != len(group.ids) or group.rgb.shape[3] != 3):
        raise ValueError("Incompatible shape tensor")
    size = (group.rgb.shape[2], group.rgb.shape[1])
    query = cv2.cvtColor(cv2.resize(crop_bgr, size, interpolation=cv2.INTER_AREA),
                         cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    scores = []
    for index, reference in enumerate(group.rgb):
        if mode == "masked_gray_ncc":
            selected = group.mask[index].astype(bool)
            weights = np.array((.299, .587, .114), dtype=np.float64)
            left = query[selected].astype(np.float64) @ weights
            right = reference[selected].astype(np.float64) @ weights
        else:
            left = query.astype(np.float64).ravel()
            right = reference.astype(np.float64).ravel()
        if not left.size:
            scores.append(-1.0)
            continue
        left -= left.mean()
        right -= right.mean()
        denominator = np.linalg.norm(left) * np.linalg.norm(right)
        scores.append(float(left @ right / denominator) if denominator > 1e-7 else -1.0)
    order = sorted(range(len(scores)), key=lambda index: (-scores[index], index))
    return {"mode": mode, "margin": scores[order[0]] - scores[order[1]],
            "top": [{"id": group.ids[index], "score": scores[index]}
                    for index in order[:3]]}
