"""Optional camera colour calibration from the result card, never from labels.

The yellow panel is a large game-rendered surface present in normal Time Trial
result screens. Its colour may drift with camera white balance. Estimate a
bounded correction on the canonical *raw-colour* frame, after geometry, then
apply it only to copies of icon crops. The separate opt-in Ghost Select flag
anchor is implemented in ``optical_ghost``.
"""

from __future__ import annotations

import cv2
import numpy as np


def yellow_panel_median(canonical_bgr: np.ndarray, player_character_box: tuple[int, int, int, int]) -> tuple[np.ndarray, int] | None:
    if canonical_bgr.ndim != 3 or canonical_bgr.shape[2] != 3:
        raise ValueError("Expected BGR canonical frame")
    x, y, _, _ = player_character_box
    x0, x1 = max(0, x - 15), min(canonical_bgr.shape[1], x + 650)
    y0, y1 = max(0, y - 12), min(canonical_bgr.shape[0], y + 210)
    if x1 - x0 < 250 or y1 - y0 < 100:
        return None
    patch = canonical_bgr[y0:y1, x0:x1]
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    selected = ((hsv[:, :, 0] >= 8) & (hsv[:, :, 0] <= 43) &
                (hsv[:, :, 1] >= 80) & (hsv[:, :, 2] >= 100))
    # A few bright kart pixels or a yellow track do not establish the card.
    if int(selected.sum()) < 8000:
        return None
    rgb = cv2.cvtColor(patch, cv2.COLOR_BGR2RGB)
    return np.median(rgb[selected], axis=0).astype(np.float32), int(selected.sum())


def yellow_card_gains(observed_rgb: np.ndarray, target_rgb: np.ndarray) -> tuple[float, float, float] | None:
    observed = np.asarray(observed_rgb, dtype=np.float32)
    target = np.asarray(target_rgb, dtype=np.float32)
    if observed.shape != (3,) or target.shape != (3,) or not np.all(np.isfinite(observed)) or not np.all(np.isfinite(target)):
        raise ValueError("Expected finite RGB triplets")
    if np.any(observed < 3) or np.any(target < 3):
        return None
    ratio = target / observed
    # Reject severe illumination/colour changes instead of extrapolating from
    # a possibly misidentified card or clipped channel.
    if np.any(ratio[:2] < 0.7) or np.any(ratio[:2] > 1.4):
        return None
    # The panel's low blue channel is especially vulnerable to JPEG and
    # display/camera tone mapping. Do not infer a large global blue gain from it.
    if ratio[2] < 0.7 or ratio[2] > 1.4:
        ratio[2] = 1.0
    return tuple(float(v) for v in ratio)
