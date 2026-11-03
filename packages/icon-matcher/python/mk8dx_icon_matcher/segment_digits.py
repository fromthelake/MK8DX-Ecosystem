"""The central 7-segment digit matcher (CENTRAL_RECOGNITION section 8.6, phase 2).

One specification in Python (this reference), TypeScript (``ts/sharedSegmentDigits.ts``) and
Java (``SegmentDigits.java``). The algorithm is the one the Web scanner, Android and LiveTrial
already share (a port of the Android OfflineParityNativePipeline nodes 24/26): colour-coded
template images (segments a..g) become point masks, the template slides over the binarized slot
with a clamped scale, candidates rank by validity, margin, confidence and lit segments, and the
pattern decodes to a digit.

Input is the slot's binary patch (0/255, row-major ``bytes``/``numpy`` uint8); the caller (the ROI
Searcher) cuts the slot and binarizes it. Rounding is ``floor(v + 0.5)`` (JavaScript/Java
``Math.round``) everywhere, so the three languages agree exactly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

SEGMENT_KEYS = ("a", "b", "c", "d", "e", "f", "g")
SEGMENT_ON = 0.35
PATTERNS = {"1111110": "0", "0001100": "1", "0110111": "2", "0011111": "3", "1001101": "4",
            "1011011": "5", "1111011": "6", "0001110": "7", "1111111": "8", "1011111": "9"}
_COLOURS = {"a": (255, 0, 0), "b": (0, 255, 0), "c": (0, 0, 255), "d": (255, 255, 0),
            "e": (255, 0, 255), "f": (0, 255, 255), "g": (255, 128, 0)}


def _round(value: float) -> int:
    return int(math.floor(value + 0.5))


@dataclass(frozen=True)
class SegmentTemplate:
    width: int
    height: int
    points: dict  # key -> tuple of (x, y)

    def scaled(self, scale_x: float, scale_y: float) -> "SegmentTemplate":
        dst_w = max(1, _round(self.width * max(0.05, scale_x)))
        dst_h = max(1, _round(self.height * max(0.05, scale_y)))
        out = {}
        for key in SEGMENT_KEYS:
            unique = {}
            for x, y in self.points.get(key, ()):
                sx = max(0, min(dst_w - 1, _round(x * scale_x)))
                sy = max(0, min(dst_h - 1, _round(y * scale_y)))
                unique[(sx, sy)] = None
            out[key] = tuple(unique)
        return SegmentTemplate(dst_w, dst_h, out)


def template_from_rgb(rgb, width: int, height: int) -> SegmentTemplate:
    """A colour-coded template image (row-major RGB, any indexable of length w*h*3)."""
    masks = {key: [] for key in SEGMENT_KEYS}
    for y in range(height):
        for x in range(width):
            i = (y * width + x) * 3
            r, g, b = int(rgb[i]), int(rgb[i + 1]), int(rgb[i + 2])
            for key, (tr, tg, tb) in _COLOURS.items():
                if abs(r - tr) <= 1 and abs(g - tg) <= 1 and abs(b - tb) <= 1:
                    masks[key].append((x, y))
                    break
    return SegmentTemplate(width, height, {key: tuple(points) for key, points in masks.items()})


def decode_pattern(pattern: str) -> str:
    return PATTERNS.get(pattern, "?")


def canonical_slot_size(kind: str, slot: int) -> tuple[int, int]:
    punctuation = slot in (2, 5)
    width = (8 if punctuation else 22) if kind == "total" else (7 if punctuation else 19)
    return width, 33 if kind == "total" else 27


@dataclass(frozen=True)
class SegmentCandidate:
    values: dict
    pattern: str
    decoded: str
    valid: bool
    on_count: int
    confidence: float
    margin: float
    x: int
    y: int
    w: int
    h: int
    scale_x: float
    scale_y: float


def _margin(values: dict, states: dict) -> float:
    active_total, active_count, inactive_max = 0.0, 0, 0.0
    for key in SEGMENT_KEYS:
        if states[key]:
            active_total += values[key]
            active_count += 1
        else:
            inactive_max = max(inactive_max, values[key])
    return (0.0 if active_count == 0 else active_total / active_count) - inactive_max


def _score_at(binary, patch_w: int, patch_h: int, template: SegmentTemplate, tx: int, ty: int,
              sx: float, sy: float) -> SegmentCandidate:
    values, states = {}, {}
    on_count, confidence_sum = 0, 0.0
    for key in SEGMENT_KEYS:
        total = on = 0
        for px, py in template.points.get(key, ()):
            xx, yy = tx + px, ty + py
            if 0 <= xx < patch_w and 0 <= yy < patch_h:
                total += 1
                if binary[yy * patch_w + xx] > 127:
                    on += 1
        frac = 0.0 if total == 0 else on / total
        state = frac >= SEGMENT_ON
        values[key], states[key] = frac, state
        on_count += 1 if state else 0
        confidence_sum += frac if state else 1.0 - frac
    pattern = "".join("1" if states[key] else "0" for key in SEGMENT_KEYS)
    decoded = decode_pattern(pattern)
    return SegmentCandidate(values, pattern, decoded, decoded != "?", on_count,
                            confidence_sum / len(SEGMENT_KEYS), _margin(values, states),
                            tx, ty, template.width, template.height, sx, sy)


def compare_candidates(a: SegmentCandidate, b: SegmentCandidate) -> int:
    def cmp(x, y):
        return -1 if x < y else 1 if x > y else 0
    result = cmp(1 if a.valid else 0, 1 if b.valid else 0)
    if result:
        return result
    result = cmp(a.margin if a.valid else -1.0, b.margin if b.valid else -1.0)
    if result:
        return result
    result = cmp(a.confidence, b.confidence)
    if result:
        return result
    return cmp(a.on_count, b.on_count)


def best_segment_candidate(binary, patch_w: int, patch_h: int, base: SegmentTemplate, kind: str,
                           slot_index: int, required_digit: str | None = None) -> SegmentCandidate | None:
    """The best template placement on one binary slot (``required_digit``: only that digit)."""
    if patch_w <= 0 or patch_h <= 0 or base.width <= 0 or base.height <= 0:
        return None
    canonical = canonical_slot_size(kind, slot_index)
    sx = max(0.85, min(1.0, patch_w / max(1.0, canonical[0])))
    sy = max(0.85, min(1.2, patch_h / max(1.0, canonical[1])))
    scaled = base.scaled(sx, sy)
    if scaled.width <= 0 or scaled.height <= 0 or patch_w < scaled.width or patch_h < scaled.height:
        return None
    best = None
    for ty in range(patch_h - scaled.height + 1):
        for tx in range(patch_w - scaled.width + 1):
            candidate = _score_at(binary, patch_w, patch_h, scaled, tx, ty, sx, sy)
            if required_digit and candidate.decoded != required_digit:
                continue
            if best is None or compare_candidates(candidate, best) > 0:
                best = candidate
    return best


PUNCTUATION = {2: ":", 5: "."}


def binarize_slot(crop_bgr, *, invert: bool, profile: str):
    """The slot's binary patch: grey, inverted for dark-on-light digits (the player card's lap
    times), a 3x3 Gaussian blur on camera images only (``profile`` 'phone'; HDMI digits are clean),
    then Otsu. Returns ``(bytes, width, height)`` or None for an empty crop."""
    import cv2
    if crop_bgr is None or crop_bgr.size == 0:
        return None
    gray = crop_bgr if crop_bgr.ndim == 2 else cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    if invert:
        gray = 255 - gray
    if profile == "phone":
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
    elif profile != "hdmi":
        raise ValueError(f"unknown digit profile {profile}")
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    return binary.tobytes(), int(binary.shape[1]), int(binary.shape[0])


def read_slot(crop_bgr, template: SegmentTemplate, kind: str, slot_index: int, *, invert: bool,
              profile: str, required_digit: str | None = None) -> SegmentCandidate | None:
    """One time slot (1-based; 2 and 5 are the ':' and '.') read by the central matcher."""
    if slot_index in PUNCTUATION:
        return None
    patch = binarize_slot(crop_bgr, invert=invert, profile=profile)
    if patch is None:
        return None
    binary, w, h = patch
    return best_segment_candidate(binary, w, h, template, kind, slot_index, required_digit)


def segment_scores(binary, w: int, h: int) -> dict:
    """Fallback without a template: coverage per region (OfflineParityNativePipeline.segmentScores)."""
    def coverage(x1, y1, x2, y2):
        left = max(0, min(w - 1, _round(w * x1)))
        top = max(0, min(h - 1, _round(h * y1)))
        right = max(left + 1, min(w, _round(w * x2)))
        bottom = max(top + 1, min(h, _round(h * y2)))
        on = sum(1 for y in range(top, bottom) for x in range(left, right) if binary[y * w + x] != 0)
        return on / max(1.0, (bottom - top) * (right - left))
    return {"a": coverage(0.20, 0.03, 0.80, 0.18), "b": coverage(0.72, 0.12, 0.95, 0.48),
            "c": coverage(0.72, 0.52, 0.95, 0.88), "d": coverage(0.20, 0.82, 0.80, 0.97),
            "e": coverage(0.05, 0.52, 0.28, 0.88), "f": coverage(0.05, 0.12, 0.28, 0.48),
            "g": coverage(0.20, 0.42, 0.80, 0.58)}


# --------------------------------------------------------------------------- score profile
# Tournament Live's race and total scores (CENTRAL_RECOGNITION section 8.6): the score screen's
# digits are read per segment rectangle (the share of white pixels in each), in the score font's own
# segment layout (its "1" lights the middle column). The decode below is the rule Tournament Live
# used (ocr_scoreboard_consensus.analyze_digit_segments), moved here unchanged so every product's
# digit decision lives in one module. Python only: Tournament Live is its one consumer.
SCORE_PATTERNS = (
    (8, frozenset({"top_middle", "left_middle", "right_middle", "center", "right_bottom", "left_bottom",
                   "middle_bottom_edge"})),
    (0, frozenset({"top_middle", "left_middle", "right_middle", "left_bottom", "right_bottom", "middle_bottom_edge"})),
    (6, frozenset({"top_middle", "left_middle", "center", "right_bottom", "left_bottom", "middle_bottom_edge"})),
    (9, frozenset({"top_middle", "left_middle", "right_middle", "center", "right_bottom", "middle_bottom_edge"})),
    (2, frozenset({"top_middle", "right_middle", "center", "left_bottom", "middle_bottom_edge"})),
    (3, frozenset({"top_middle", "right_middle", "center", "right_bottom", "middle_bottom_edge"})),
    (5, frozenset({"top_middle", "left_middle", "center", "right_bottom", "middle_bottom_edge"})),
    (4, frozenset({"right_middle", "left_middle", "center", "right_bottom"})),
    (7, frozenset({"top_middle", "right_middle", "right_bottom"})),
    (1, frozenset({"middle_middle", "middle_bottom"})),
)
SCORE_SEGMENT_ON = 0.45


def score_digit_candidate(segment_stats: dict, pattern, *, active_black_penalty: float) -> float:
    score = 0.0
    for label, stats in segment_stats.items():
        white_ratio = stats["white_ratio"]
        black_ratio = stats["black_ratio"]
        if label in pattern:
            score += white_ratio
            score -= black_ratio * active_black_penalty
        else:
            score += (1.0 - white_ratio) * 0.08
            score -= white_ratio * 0.45
    return score


def decode_score_segments(segment_stats: dict) -> tuple[int, set]:
    """The score digit from per-segment ``{"white_ratio", "black_ratio"}`` stats: a pattern whose
    segments are all strongly lit wins (8 first); else three black-penalty readings vote (2 of 3);
    else the best summed score when it matches at least half its pattern. -1 = unreadable. Returns
    the digit and the strongly lit segments."""
    strong = {label for label, stats in segment_stats.items() if stats["white_ratio"] >= SCORE_SEGMENT_ON}
    for digit, pattern in SCORE_PATTERNS:
        if pattern.issubset(strong):
            return digit, strong
    if not strong:
        return -1, strong
    votes: list[int] = []
    aggregate: dict = {}
    for penalty in (1.0, 2.0, 3.0):
        best_digit, best_score = -1, float("-inf")
        for digit, pattern in SCORE_PATTERNS:
            candidate = score_digit_candidate(segment_stats, pattern, active_black_penalty=penalty)
            aggregate[digit] = aggregate.get(digit, 0.0) + candidate
            if candidate > best_score:
                best_score, best_digit = candidate, digit
        if best_digit != -1:
            votes.append(best_digit)
    if votes:
        counts: dict = {}
        for digit in votes:
            counts[digit] = counts.get(digit, 0) + 1
        top = max(counts.values())
        best = next(digit for digit in counts if counts[digit] == top)
        if top >= 2:
            return best, strong
    best = max(aggregate.items(), key=lambda item: item[1])[0]
    pattern = dict(SCORE_PATTERNS)[best]
    matched = len(pattern & strong) / max(1, len(pattern))
    return (best if matched >= 0.5 else -1), strong
