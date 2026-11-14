"""The icon crop search of the Web scanner and Android (issue #99, phase 3): where inside a
character, kart-body or glider slot of the canonical result card the product cuts the icon crop
that the shared reader then scores.

This is a Python reference of product code that is not shared yet: the Web scanner's
``cleanAssets.ts`` (``identifyCrop``, ``identifyCropSearch``) and ``kartConfig.ts`` (``matchCard``:
the character scale sweep and saturation boost), ports of the APK's ``CleanAssetsMatcher`` and
``KartConfigMatcher``. Tyres and flags are not here: their crops come from the central tyre window
and ``flag_window``. The steps, as the products do them:

1. ``identify_crop``: the crop resized to the group's box (INTER_AREA), a mild gain towards the
   references' mean (0.6..1.8, deep dimming up to 2.6), the masked RGB score
   ``1 - sum(mask * |ref - q|) / (3 * masksum + 1e-6)`` against every reference, a stable sort, the
   achromatic-winner guard (a grey winner within 0.02 of the best coloured reference yields when the
   crop is coloured outside the card yellow) and the silhouette tie-break (within 0.04: score plus
   0.10 times the foreground IoU over the first five within 0.05). The family colour pick that follows
   in the products changes the reported colour variant, not the score, and is not part of the box.
2. ``identify_crop_search``: the nominal crop is scored; the window ``search`` pixels around it gets
   the gain towards the references' mean (0.6..1.8, capped at 1), every reference with at least 24
   mask values is matched with masked ``TM_SQDIFF``; the reference with the highest
   ``1 - min / masksum`` (first strict maximum) names the shift. The shifted crop replaces the
   nominal one when its rounded score is at least as high.
3. ``search_character``: on a ghost card (not the player's yellow card) a slot region with a mean
   saturation between 1 and 80 gets its saturation multiplied by ``min(2, 90 / mean)``; the search runs
   at seven scales (0.94..1.06) and the first strictly highest rounded score wins.
   ``search_part``: bodies and gliders search 6 px at scale 1.
4. ``crop_box``: the box the shared reader receives, ``round(x + (w - cw) / 2) + dx`` with
   ``cw = max(8, round(w * scale))``.

The pixel work uses OpenCV like the products. Two operations are written out because desktop
OpenCV differs from OpenCV.js there: ``HSV2BGR`` (desktop SIMD gives values one lower on about a third
of all inputs; ``hsv_to_bgr`` equals OpenCV.js on every one of the 11.8 million inputs) and the 8-bit
``convertTo`` scale (``rint(float32(v) * float32(alpha))``). The decision steps are pure functions
(``search_window``, ``pick_position``, ``decide_search``, ``decide_field``, ``crop_box``) so the
TypeScript (``ts/sharedCropSearch.ts``) and Java (``CropSearch.java``) replays of
``vectors/crop-search-v1.json`` run without OpenCV.

Rounding is the products' ``Math.round`` (half up, ``floor(x + 0.5)``), never Python's ``round``.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

SCHEMA = "mk8dx.crop-search.v1"
F32 = np.float32
CHARACTER_SCALES = (0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06)
SEARCH_PX = {"characters": 10, "bodies": 6, "gliders": 6}
SEARCH_PAD_PX = 10             # kartConfig.ts SEARCH_PAD_PX; the boost region adds 8 more
BOOST_MARGIN = SEARCH_PAD_PX + 8
MIN_TEMPLATE_SUM = 24.0        # a sized reference with fewer mask values does not vote for a position
CENTER_ONLY = ((0, 0),)
DEFAULT_OFFSETS = ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1))


def js_round(value: float) -> int:
    """JavaScript/Java ``Math.round``: half up."""
    return int(math.floor(value + 0.5))


def round4(value: float) -> float:
    return math.floor(value * 10000.0 + 0.5) / 10000.0


def family_of(rid: str) -> str:
    parts = rid.split(".")
    if len(parts) >= 2 and parts[0].endswith("_variant"):
        return parts[0].replace("_variant", "") + "." + parts[1]
    return rid


def _seq_sum(values) -> float:
    """Left-to-right float64 sum, as the products' loops (numpy's ``sum`` is pairwise)."""
    array = np.asarray(values, dtype=np.float64).ravel()
    return float(np.cumsum(array)[-1]) if array.size else 0.0


def clip_rect(x: int, y: int, w: int, h: int, width: int, height: int) -> tuple[int, int, int, int]:
    cx = max(0, min(width - 1, x))
    cy = max(0, min(height - 1, y))
    return cx, cy, max(0, min(w, width - cx)), max(0, min(h, height - cy))


def bgr8_to_float(bgr8: np.ndarray) -> np.ndarray:
    """``Math.fround(v / 255)`` per byte, flat (``bgr8ToFloat``)."""
    return (bgr8.astype(np.float64) / 255.0).astype(F32).ravel()


def convert_to_float(bgr8: np.ndarray) -> np.ndarray:
    """OpenCV ``convertTo(CV_32F, 1/255)``: a float32 product, not a correctly rounded quotient."""
    return bgr8.astype(F32) * F32(1.0 / 255.0)


def scale_u8(channel: np.ndarray, alpha: float) -> np.ndarray:
    """OpenCV ``convertTo(-1, alpha, 0)`` on 8-bit data: float32 product, round half to even, saturate."""
    return np.clip(np.rint(channel.astype(F32) * F32(alpha)), 0, 255).astype(np.uint8)


_SECTORS = np.array([[1, 3, 0], [1, 0, 2], [3, 0, 1], [0, 2, 1], [0, 1, 3], [2, 1, 0]])


def hsv_to_bgr(hsv: np.ndarray) -> np.ndarray:
    """OpenCV ``COLOR_HSV2BGR`` on 8-bit data (hue 0..180), its scalar float32 path as OpenCV.js runs it."""
    h = hsv[..., 0].astype(F32) * F32(6.0 / 180.0)
    s = hsv[..., 1].astype(F32) * F32(1.0 / 255.0)
    v = hsv[..., 2].astype(F32) * F32(1.0 / 255.0)
    h = np.fmod(h, F32(6.0)).astype(F32)
    sector = np.floor(h).astype(np.int64)
    h = (h - sector.astype(F32)).astype(F32)
    bad = (sector < 0) | (sector >= 6)
    sector[bad] = 0
    h[bad] = 0
    one = F32(1.0)
    tab = np.stack([v, v * (one - s), v * (one - s * h), v * (one - s * (one - h))], axis=-1).astype(F32)
    out = np.take_along_axis(tab, _SECTORS[sector], axis=-1)
    grey = s == 0
    out[grey] = v[grey][:, None]
    return np.clip(np.rint(out * F32(255.0)), 0, 255).astype(np.uint8)


@dataclass
class CropGroup:
    """One reference group of the products' clean-assets pack (``characters``, ``bodies``, ``gliders``)."""

    name: str
    box_w: int
    box_h: int
    ids: list[str]
    sat: list[float]
    ref_bgr8: list[np.ndarray]
    ref_mask8: list[np.ndarray]
    rgb: np.ndarray = field(init=False)          # (n, box_h * box_w * 3) float32
    mask: np.ndarray = field(init=False)         # (n, box_h * box_w) float32 0/1
    mask_sum: list[float] = field(init=False)
    rgb_mask_sum: list[float] = field(init=False)
    _sized: dict = field(init=False, default_factory=dict)

    def __post_init__(self) -> None:
        self.rgb = np.stack([bgr8_to_float(ref) for ref in self.ref_bgr8])
        self.mask = np.stack([(mask > 127).astype(F32).ravel() for mask in self.ref_mask8])
        self.mask_sum = [_seq_sum(row) for row in self.mask]
        per_pixel = self.rgb.reshape(len(self.ids), -1, 3).astype(np.float64)
        sums = (per_pixel[..., 0] + per_pixel[..., 1]) + per_pixel[..., 2]
        self.rgb_mask_sum = [_seq_sum(self.mask[i] * sums[i]) for i in range(len(self.ids))]

    def index_set(self, subset) -> list[int]:
        if subset:
            keep = [i for i, rid in enumerate(self.ids) if rid in subset]
            if keep:
                return keep
        return list(range(len(self.ids)))

    def sized(self, tw: int, th: int):
        """References resized to the crop (INTER_AREA, ``convertTo`` 1/255) and binary 3-channel masks."""
        key = (tw, th)
        if key not in self._sized:
            rgbs, masks, sums = [], [], []
            for ref, mask8 in zip(self.ref_bgr8, self.ref_mask8):
                rgbs.append(convert_to_float(cv2.resize(ref, (tw, th), interpolation=cv2.INTER_AREA)))
                small = cv2.resize(mask8, (tw, th), interpolation=cv2.INTER_AREA)
                _, binary = cv2.threshold(small, 127.5, 1.0, cv2.THRESH_BINARY)
                mask3 = cv2.merge([binary.astype(F32)] * 3)
                masks.append(mask3)
                sums.append(_seq_sum(mask3))
            self._sized[key] = (rgbs, masks, sums)
        return self._sized[key]


def load_clean_assets(root: Path) -> dict[str, CropGroup]:
    """The groups of a materialized ``clean_assets`` folder (``pack.json``, ``refs/``, ``masks/``)."""
    root = Path(root)
    pack = json.loads((root / "pack.json").read_text(encoding="utf-8"))
    groups = {}
    for name, meta in pack["groups"].items():
        box_w, box_h = pack["box"][name]
        refs, masks = [], []
        for i in range(len(meta["ids"])):
            refs.append(cv2.imread(str(root / "refs" / name / f"{i}.png"), cv2.IMREAD_COLOR))
            masks.append(cv2.imread(str(root / "masks" / name / f"{i}.png"), cv2.IMREAD_GRAYSCALE))
        groups[name] = CropGroup(name, int(box_w), int(box_h), list(meta["ids"]), [float(v) for v in meta["sat"]],
                                 refs, masks)
    return groups


def _rgb_scores(q: np.ndarray, group: CropGroup, idx: list[int], w: int, h: int, offsets) -> list[float]:
    """Masked RGB score per reference, the best over ``offsets`` (query shifted, edges replicated)."""
    qq = q.reshape(h, w, 3).astype(np.float64)
    best = np.full(len(idx), -1.0)
    rgb = group.rgb[idx].reshape(len(idx), h, w, 3).astype(np.float64)
    mask = group.mask[idx].reshape(len(idx), h * w).astype(np.float64)
    denominators = np.array([group.mask_sum[i] * 3.0 + 1e-6 for i in idx])
    for dx, dy in offsets:
        sy = np.clip(np.arange(h) - dy, 0, h - 1)
        sx = np.clip(np.arange(w) - dx, 0, w - 1)
        shifted = qq[sy][:, sx]
        diff = np.abs(rgb - shifted[None])
        terms = mask * ((diff[..., 0] + diff[..., 1]) + diff[..., 2]).reshape(len(idx), -1)
        d = np.cumsum(terms, axis=1)[:, -1]
        scores = 1.0 - d / denominators
        best = np.where(scores > best, scores, best)
    return [float(v) for v in best]


def _sat_hue(q: np.ndarray, w: int, h: int) -> tuple[np.ndarray, np.ndarray]:
    q8 = np.clip(np.floor(q.astype(np.float64) * 255.0 + 0.5), 0, 255).astype(np.uint8).reshape(h, w, 3)
    hsv = cv2.cvtColor(q8, cv2.COLOR_BGR2HSV)
    return (hsv[..., 1].astype(np.float64) / 255.0).astype(F32).ravel(), hsv[..., 0].astype(F32).ravel()


def foreground_mask(q8: np.ndarray):
    """Pixels clearly off the 2-px border's mean colour; None when too empty or too full."""
    h, w = q8.shape[:2]
    data = q8.astype(np.int64)
    border = np.ones((h, w), dtype=bool)
    border[2:h - 2, 2:w - 2] = False
    n = int(border.sum())
    if n == 0:
        return None
    bg = [float(data[..., c][border].sum()) / n for c in range(3)]
    d = (np.abs(data[..., 0] - bg[0]) + np.abs(data[..., 1] - bg[1])) + np.abs(data[..., 2] - bg[2])
    fg = (d > 60.0).ravel()
    count = int(fg.sum())
    if count < (w * h) // 20 or count > (w * h * 9) // 10:
        return None
    return fg


def mask_iou(query_fg: np.ndarray, mask: np.ndarray) -> float:
    pb = mask > 0.5
    union = int((query_fg | pb).sum())
    return 0.0 if union == 0 else int((query_fg & pb).sum()) / union


def identify_crop(crop_bgr: np.ndarray, group: CropGroup, subset=None, offsets=DEFAULT_OFFSETS,
                  raw_rgb: bool = False) -> dict:
    """The ranking part of ``identifyCrop``: visual winner, rounded score, margins and top three."""
    if crop_bgr is None or crop_bgr.size == 0:
        return {"id": None, "score": 0.0, "margin": 0.0}
    w, h = group.box_w, group.box_h
    q8 = cv2.resize(crop_bgr, (w, h), interpolation=cv2.INTER_AREA)
    q = bgr8_to_float(q8)
    idx = group.index_set(subset)
    if not raw_rgb:
        ref_num = _seq_sum([group.rgb_mask_sum[i] for i in idx])
        ref_den = _seq_sum([group.mask_sum[i] * 3.0 for i in idx])
        ref_mean = ref_num / max(ref_den, 1e-6)
        q_mean = _seq_sum(q) / q.size
        if q_mean > 1e-4:
            raw_gain = ref_mean / q_mean
            max_gain = min(2.6, raw_gain) if raw_gain > 1.8 else 1.8
            gain = F32(max(0.6, min(max_gain, raw_gain)))
            q = np.clip(q * gain, F32(0), F32(1)).astype(F32)
    scores = _rgb_scores(q, group, idx, w, h, offsets)
    order = sorted(range(len(idx)), key=lambda k: -scores[k])
    if group.sat[idx[order[0]]] <= 0.06:
        sat, hue = _sat_hue(q, w, h)
        non_yellow = ((hue < 18) | (hue > 36)).astype(F32)
        weights = (group.mask[idx[order[0]]] * non_yellow).astype(F32)
        crop_sat = _seq_sum(sat.astype(np.float64) * weights) / (_seq_sum(weights) + 1e-6)
        if crop_sat >= 0.12:
            chrom = [o for o in order if group.sat[idx[o]] > 0.06]
            achrom = [o for o in order if group.sat[idx[o]] <= 0.06]
            if chrom and scores[order[0]] - scores[chrom[0]] <= 0.02:
                order = chrom + achrom
    if len(order) > 1 and scores[order[0]] - scores[order[1]] < 0.04:
        query_fg = foreground_mask(q8)
        if query_fg is not None:
            best_combined, best_pos = -2.0, 0
            for k in range(min(5, len(order))):
                if scores[order[0]] - scores[order[k]] > 0.05:
                    break
                combined = scores[order[k]] + 0.10 * mask_iou(query_fg, group.mask[idx[order[k]]])
                if combined > best_combined:
                    best_combined, best_pos = combined, k
            if best_pos != 0:
                order = [order[best_pos]] + order[:best_pos] + order[best_pos + 1:]
    rid = group.ids[idx[order[0]]]
    score = scores[order[0]]
    margin = score - scores[order[1]] if len(order) > 1 else 1.0
    family = family_of(rid)
    margin_ext = 1.0
    for k in order[1:]:
        if family_of(group.ids[idx[k]]) != family:
            margin_ext = score - scores[k]
            break
    return {"id": rid, "family": family, "score": round4(score), "margin": round4(margin),
            "margin_ext": round4(margin_ext),
            "top3": [[group.ids[idx[k]], round4(scores[k])] for k in order[:3]]}


# ---------------------------------------------------------------- the decision, without pixels

def search_window(x1: int, y1: int, tw: int, th: int, width: int, height: int, search: int):
    """``[wx1, wy1, wx2, wy2]`` the position pass searches, or None when it does not run."""
    wx1, wy1 = max(0, x1 - search), max(0, y1 - search)
    wx2, wy2 = min(width, x1 + tw + search), min(height, y1 + th + search)
    if tw < 8 or th < 8 or wy2 - wy1 < th or wx2 - wx1 < tw:
        return None
    return [wx1, wy1, wx2, wy2]


def pick_position(candidates, subset=None):
    """The position pass over ``[id, masksum, minVal, x, y]`` per reference, in reference order:
    references under 24 mask values or outside ``subset`` do not vote; the first strictly highest
    ``1 - minVal / masksum`` gives the top-left ``(x, y)`` in the window, or None."""
    best_score, best = -math.inf, None
    for rid, total, min_val, x, y in candidates:
        if total < MIN_TEMPLATE_SUM or (subset is not None and rid not in subset):
            continue
        score = 1.0 - min_val / total
        if score > best_score:
            best_score, best = score, (int(x), int(y))
    return best


def decide_search(look: dict, width: int, height: int) -> dict:
    """One ``identifyCropSearch`` decision from its measurements: ``look`` has ``box`` (fractional
    ``[x, y, w, h]``), ``search``, ``subset`` (list or None), ``centerScore`` (the nominal crop's
    rounded score, None when the nominal crop is empty), ``candidates`` and ``shiftedScore`` (the
    rounded score of the crop at the picked shift; unused when there is none)."""
    bx, by, bw, bh = look["box"]
    tw, th, x1, y1 = js_round(bw), js_round(bh), js_round(bx), js_round(by)
    _, _, nw, nh = clip_rect(x1, y1, tw, th, width, height)
    if nw <= 0 or nh <= 0:
        return {"dx": 0, "dy": 0, "score": 0.0, "shifted": False, "window": None}
    center = float(look["centerScore"])
    window = search_window(x1, y1, tw, th, width, height, int(look["search"]))
    if window is None:
        return {"dx": 0, "dy": 0, "score": center, "shifted": False, "window": None}
    subset = None if look.get("subset") is None else set(look["subset"])
    picked = pick_position(look["candidates"], subset)
    if picked is not None:
        dx, dy = window[0] + picked[0] - x1, window[1] + picked[1] - y1
        if (dx != 0 or dy != 0) and float(look["shiftedScore"]) >= center:
            return {"dx": dx, "dy": dy, "score": float(look["shiftedScore"]), "shifted": True, "window": window}
    return {"dx": 0, "dy": 0, "score": center, "shifted": False, "window": window}


def crop_box(slot, scale: float, dx: int, dy: int) -> list[int]:
    """The crop the shared reader scores: the slot scaled about its centre, then shifted."""
    x1, y1, slot_w, slot_h = slot
    cw, ch = max(8, js_round(slot_w * scale)), max(8, js_round(slot_h * scale))
    return [js_round(x1 + (slot_w - cw) / 2.0) + dx, js_round(y1 + (slot_h - ch) / 2.0) + dy, cw, ch]


def decide_field(case: dict) -> dict:
    """A field's decision over its looks (one per scale): the first strictly highest score wins."""
    looks = [decide_search(look, case["width"], case["height"]) for look in case["looks"]]
    best = None
    for look, got in zip(case["looks"], looks):
        if best is None or got["score"] > best[1]["score"]:
            best = (look, got)
    scale = float(best[0]["scale"])
    return {"scale": scale, "dx": best[1]["dx"], "dy": best[1]["dy"], "score": best[1]["score"],
            "cropBox": crop_box(case["slot"], scale, best[1]["dx"], best[1]["dy"]),
            "looks": [{"dx": got["dx"], "dy": got["dy"], "score": got["score"], "shifted": got["shifted"],
                       "window": got["window"]} for got in looks]}


# ---------------------------------------------------------------- the search with pixels

def identify_crop_search(image: np.ndarray, bx: float, by: float, bw: float, bh: float, group: CropGroup,
                         subset=None, search: int = 6, raw_rgb: bool = False, trace: dict | None = None) -> dict:
    """``identifyCropSearch``: the nominal crop, the position pass, the shifted crop. ``trace`` (a
    dict) receives the measurements ``decide_search`` needs."""
    height, width = image.shape[:2]
    tw, th, x1, y1 = js_round(bw), js_round(bh), js_round(bx), js_round(by)
    nx, ny, nw, nh = clip_rect(x1, y1, tw, th, width, height)
    look = {"box": [bx, by, bw, bh], "search": search, "subset": None if subset is None else sorted(subset),
            "centerScore": None, "candidates": [], "shiftedScore": None}
    if trace is not None:
        trace.update(look)
    if nw <= 0 or nh <= 0:
        return {"id": None, "score": 0.0, "margin": 0.0, "dx": 0, "dy": 0}
    best = identify_crop(image[ny:ny + nh, nx:nx + nw], group, subset, CENTER_ONLY, raw_rgb)
    best.update(dx=0, dy=0)
    if trace is not None:
        trace["centerScore"] = best["score"]
    window = search_window(x1, y1, tw, th, width, height, search)
    if window is None:
        return best
    wx1, wy1, wx2, wy2 = window
    rgbs, masks, sums = group.sized(tw, th)
    win = convert_to_float(image[wy1:wy2, wx1:wx2])
    ref_num = _seq_sum([group.rgb_mask_sum[i] / max(group.mask_sum[i], 1e-6) * sums[i] / 3.0
                        for i in range(len(group.ids))])
    ref_den = _seq_sum([s / 3.0 for s in sums])
    ref_mean = ref_num / max(ref_den, 1e-6) / 3.0
    mean = cv2.mean(win)
    m = (mean[0] + mean[1] + mean[2]) / 3.0
    if m > 1e-4:
        gain = max(0.6, min(1.8, ref_mean / m))
        win = np.minimum(win * F32(gain), F32(1.0))
    candidates = []
    for i, rid in enumerate(group.ids):
        if sums[i] < MIN_TEMPLATE_SUM or (subset is not None and rid not in subset):
            continue
        result = cv2.matchTemplate(win, rgbs[i], cv2.TM_SQDIFF, mask=masks[i])
        result[np.isnan(result)] = 1e12
        min_val, _, min_loc, _ = cv2.minMaxLoc(result)
        candidates.append([rid, sums[i], float(min_val), int(min_loc[0]), int(min_loc[1])])
    picked = pick_position(candidates, None)
    if trace is not None:
        trace["candidates"] = candidates
    if picked is not None:
        dx, dy = wx1 + picked[0] - x1, wy1 + picked[1] - y1
        if dx != 0 or dy != 0:
            sx, sy, sw, sh = clip_rect(x1 + dx, y1 + dy, tw, th, width, height)
            out = identify_crop(image[sy:sy + sh, sx:sx + sw], group, subset, CENTER_ONLY, raw_rgb)
            if trace is not None:
                trace["shiftedScore"] = out["score"]
            if out["score"] >= best["score"]:
                out.update(dx=dx, dy=dy)
                best = out
    return best


def boost_saturation(canonical: np.ndarray, slot) -> tuple[np.ndarray, int, int] | None:
    """The ghost-card saturation boost around a character slot: ``(image, roi_x, roi_y)`` or None."""
    height, width = canonical.shape[:2]
    x1, y1, slot_w, slot_h = (int(v) for v in slot)
    roi_x, roi_y = max(0, x1 - BOOST_MARGIN), max(0, y1 - BOOST_MARGIN)
    roi_w, roi_h = min(width - roi_x, slot_w + 2 * BOOST_MARGIN), min(height - roi_y, slot_h + 2 * BOOST_MARGIN)
    hsv = cv2.cvtColor(np.ascontiguousarray(canonical[roi_y:roi_y + roi_h, roi_x:roi_x + roi_w]), cv2.COLOR_BGR2HSV)
    mean_sat = cv2.mean(hsv)[1]
    if not 1.0 < mean_sat < 80.0:
        return None
    hsv = hsv.copy()
    hsv[..., 1] = scale_u8(hsv[..., 1], min(2.0, 90.0 / mean_sat))
    return hsv_to_bgr(hsv), roi_x, roi_y


def search_character(canonical: np.ndarray, slot, group: CropGroup, yellow_card: bool, subset=None,
                     raw_rgb: bool = False, trace: dict | None = None) -> dict:
    """The character slot: the boost on a ghost card, then the seven-scale sweep."""
    x1, y1, slot_w, slot_h = slot
    source, roi_x, roi_y = canonical, 0, 0
    if not yellow_card:
        boosted = boost_saturation(canonical, slot)
        if boosted is not None:
            source, roi_x, roi_y = boosted
    looks, best = [], None
    for scale in CHARACTER_SCALES:
        w2, h2 = slot_w * scale, slot_h * scale
        look: dict = {}
        got = identify_crop_search(source, x1 + (slot_w - w2) / 2.0 - roi_x, y1 + (slot_h - h2) / 2.0 - roi_y,
                                   w2, h2, group, subset, SEARCH_PX["characters"], raw_rgb, look)
        got["scale"] = scale
        looks.append({"scale": scale, **look})
        if best is None or got["score"] > best["score"]:
            best = got
    if trace is not None:
        trace.update(width=source.shape[1], height=source.shape[0], roiOffset=[roi_x, roi_y], looks=looks)
    return best


def search_part(canonical: np.ndarray, slot, group: CropGroup, subset=None, raw_rgb: bool = False,
                trace: dict | None = None) -> dict:
    """A body or glider slot: one look at scale 1, 6 px around the slot."""
    x1, y1, slot_w, slot_h = slot
    look: dict = {}
    got = identify_crop_search(canonical, x1, y1, slot_w, slot_h, group, subset, SEARCH_PX[group.name], raw_rgb, look)
    got["scale"] = 1.0
    if trace is not None:
        trace.update(width=canonical.shape[1], height=canonical.shape[0], roiOffset=[0, 0],
                     looks=[{"scale": 1.0, **look}])
    return got
