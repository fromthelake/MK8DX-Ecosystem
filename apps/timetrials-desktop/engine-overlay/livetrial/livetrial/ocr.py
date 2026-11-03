"""Minimal, purpose-built 7-segment OCR engine for the MK8 capture-card path.

This replaces the giant vendored Workflow Lab framework (scripts/workflow_lab.py
+ workflow_lab_core/ + src/mk8_production/workflow_ocr_engine.py) for the ONLY
node path the capture-card workflow actually exercises: InputImage ->
FixedMK8Grid (visual no-op) -> SevenSegmentOCRProbe -> SevenSegmentOCRInspect
(skipped in production). The active SevenSegmentOCRProbe reads a clean, already
y-aligned 1280x720 BGR frame into a flat field dict of time strings.

The proven decode/geometry primitives are ported VERBATIM from workflow_lab.py
(segment-mask template matching, canonical slot sizes, grid geometry, time
validation). The driver is rewritten as ordinary code from the active branch of
PipelineRunner._run_node_impl (workflow_lab.py 15977-22103) with the runtime
config baked in from the two capture-card workflow JSONs: slot_template decode,
segment_threshold 0.35, capture_card_y_layout "auto" ({0, -30} scored by a
lap-sum-weighted metric), all *_repair / *_refinement / quad / rfdetr flags OFF.

Contract (what results.py consumes): OcrEngine(lap_count).run_frame(label, bgr)
returns an object whose `.fields` is a flat dict keyed player_total,
player_lap_1..N, ghost_total, ghost_lap_1..N with values like "1:26.950".
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np

# Diagnostic hook: when LT_GRID_DEBUG is set, each run_frame appends one entry
# to this list recording the absolute 7-segment digit/field slot boxes it built
# (for the SELECTED y-layout), mirroring identity._GRID_DEBUG. Empty and
# untouched in normal operation. A tool can then project the OCR grid onto the
# result screen for visual verification.
_GRID_DEBUG: list = []

# --------------------------------------------------------------------------- #
# Constants (ported verbatim from workflow_lab.py ~86-186)
# --------------------------------------------------------------------------- #
_DATA = Path(__file__).resolve().parent / "data"
GRID_PATH = _DATA / "new_relative_grid_combined.json"
SEGMENT_TEMPLATE_LAP = _DATA / "template_7segments_17x25.png"
SEGMENT_TEMPLATE_TOTAL = _DATA / "template_7segments_18x29.png"

CANONICAL_SIZE = (1280, 720)

SEG_COLOR_RGB = {
    "a": (255, 0, 0),
    "b": (0, 255, 0),
    "c": (0, 0, 255),
    "d": (255, 255, 0),
    "e": (255, 0, 255),
    "f": (0, 255, 255),
    "g": (255, 128, 0),
}
DIG_PAT = {
    "0": {"a", "b", "c", "d", "e", "f"},
    "1": {"d", "e"},
    "2": {"b", "c", "e", "f", "g"},
    "3": {"c", "d", "e", "f", "g"},
    "4": {"a", "d", "e", "g"},
    "5": {"a", "c", "d", "f", "g"},
    "6": {"a", "b", "c", "d", "f", "g"},
    "7": {"d", "e", "f"},
    "8": {"a", "b", "c", "d", "e", "f", "g"},
    "9": {"a", "c", "d", "e", "f", "g"},
}

# Per-slot integer pixel nudges applied before the fixed-size normalize (proven
# calibration; ported verbatim from workflow_lab.py SEGMENT_OFFSETS ~165-186).
SEGMENT_OFFSETS = {
    "race7": {
        "player": {
            "total": {"colX": {1: -3, 2: 0, 3: -2, 4: -3, 5: -2, 6: -3, 7: -1, 8: -2}, "rowY": -3},
            "lap": {"colX": {1: -2, 2: -1, 3: -2, 4: -1, 5: -2, 6: -1, 7: -2, 8: 0}, "rowY": {1: -2, 2: -2, 3: -2, 4: -2, 5: -2, 6: -2, 7: -2}},
        },
        "ghost": {
            "total": {"colX": {1: -2, 2: 1, 3: -2, 4: -3, 5: -1, 6: -2, 7: -1, 8: -2}, "rowY": -4},
            "lap": {"colX": {1: -2, 2: -1, 3: -2, 4: -1, 5: -2, 6: -1, 7: -2, 8: 0}, "rowY": {1: -4, 2: -4, 3: -4, 4: -4, 5: -4, 6: -4, 7: -4}},
        },
    },
    "race3": {
        "player": {
            "total": {"colX": {1: -1, 2: 1, 3: -2, 4: -1, 5: 0, 6: -2, 7: -1, 8: -2}, "rowY": -2},
            "lap": {"colX": {1: -1, 2: 0, 3: -1, 4: 0, 5: -1, 6: 0, 7: -1, 8: 1}, "rowY": {1: -1, 2: -1, 3: -2}},
        },
        "ghost": {
            "total": {"colX": {1: -2, 2: 1, 3: -2, 4: -2, 5: -1, 6: -1, 7: -1, 8: -2}, "rowY": -3},
            "lap": {"colX": {1: -1, 2: 0, 3: -1, 4: 0, 5: -1, 6: 0, 7: -1, 8: 1}, "rowY": {1: -1, 2: -1, 3: 0}},
        },
    },
}

# Baked SevenSegmentOCRProbe params for the two capture-card workflows
# (MK8_Capture_Card_Grid_OCR_AutoY_v001.json / ..._7Lap_v001.json). Only the
# values the ACTIVE path reads are kept; the many *_repair/*refinement flags are
# OFF and thus omitted (their code paths are not ported).
_PROBE_PARAMS = {
    "segment_threshold": 0.35,
    "template_scale_mode": "slot_scale_float",
    "template_scale_x_min": 0.85,
    "template_scale_x_max": 1.0,
    "template_scale_y_min": 0.85,
    "template_scale_y_max": 1.2,
    "template_scale_step": 0.05,
    "digit_box_offset_x_px": 0.0,
    "digit_box_offset_y_px": -30.0,
    "digit_spacing_x_px": 0.0,
    "digit_box_scale_x": 1.0,
    "digit_box_scale_y": 1.0,
    "capture_card_y_layout": "auto",
    "apply_segment_offsets": True,
    "check_lap_sum": True,
}

_SEGMENT_MASK_CACHE: dict[str, dict[str, Any]] = {}
_SEGMENT_SCALED_MASK_CACHE: dict[tuple[Any, float, float], dict[str, Any]] = {}
_SEGMENT_MASK_ARRAY_CACHE: dict[Any, dict[str, Any]] = {}
_GRID_CACHE: dict[str, Any] | None = None


# --------------------------------------------------------------------------- #
# Segment decode core (ported verbatim from workflow_lab.py ~2618-2988)
# --------------------------------------------------------------------------- #
def _as_bgr(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR) if img.ndim == 2 else img.copy()


def _load_segment_masks(path: Path) -> dict[str, Any]:
    cache_key = str(Path(path).resolve())
    cached = _SEGMENT_MASK_CACHE.get(cache_key)
    if cached is not None:
        return cached
    im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if im is None:
        result = {"w": 0, "h": 0, "masks": {key: [] for key in "abcdefg"}, "cache_key": cache_key}
        _SEGMENT_MASK_CACHE[cache_key] = result
        return result
    if im.ndim == 2:
        rgb = cv2.cvtColor(im, cv2.COLOR_GRAY2RGB)
    elif im.shape[2] == 4:
        rgb = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2RGB)
    else:
        rgb = cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    masks = {key: [] for key in "abcdefg"}
    for y in range(h):
        for x in range(w):
            r, g, b = [int(v) for v in rgb[y, x]]
            for key, color in SEG_COLOR_RGB.items():
                if abs(r - color[0]) <= 1 and abs(g - color[1]) <= 1 and abs(b - color[2]) <= 1:
                    masks[key].append((x, y))
                    break
    result = {"w": w, "h": h, "masks": masks, "cache_key": cache_key}
    _SEGMENT_MASK_CACHE[cache_key] = result
    return result


def _canonical_segment_slot_size(kind: str, slot_idx: int) -> tuple[int, int]:
    punct = slot_idx in (2, 5)
    w = (8 if punct else 22) if kind == "total" else (7 if punct else 19)
    h = 33 if kind == "total" else 27
    return w, h


def _normalize_segment_box(box: list[int], kind: str, slot_idx: int) -> list[int]:
    x1, y1 = int(box[0]), int(box[1])
    w, h = _canonical_segment_slot_size(kind, slot_idx)
    return [x1, y1, x1 + w, y1 + h]


# MK8DX ecosystem overlay (CENTRAL_RECOGNITION section 8.6, phase 2): a time slot is read by the
# central 7-segment matcher (packages/icon-matcher segment_digits, the same specification as the
# Web scanner and Android), profile 'hdmi' (no blur: this route always read clean HDMI digits).
# Without the staged package the slot is unread: the verbatim reader above is no longer a route
# (removed 2026-10-31, as every previous route).
_CENTRAL_DIGITS: Any = None
_CENTRAL_TEMPLATES: dict[str, Any] = {}


def _central_digits():
    global _CENTRAL_DIGITS
    if _CENTRAL_DIGITS is None:
        try:
            from .shared_field_shadow import _field_package
            package = _field_package()
            _CENTRAL_DIGITS = __import__(package.__name__ + ".segment_digits", fromlist=["read_slot"])
            if not hasattr(_CENTRAL_DIGITS, "read_slot"):
                _CENTRAL_DIGITS = False
        except Exception:
            _CENTRAL_DIGITS = False
    return _CENTRAL_DIGITS


def _predict_segment_char_with_template(bgr, box, owner, kind, slot_idx, segment_masks, threshold, *args, **kwargs):
    digits = _central_digits()
    if not digits:
        return "?", 0.0, {}, {"reason": "central_matcher_unavailable", "reader": "central"}
    if slot_idx in (2, 5):
        return (":" if slot_idx == 2 else "."), 1.0, {}, {"valid_digit": True, "reader": "punctuation"}
    key = segment_masks.get("cache_key", id(segment_masks))
    template = _CENTRAL_TEMPLATES.get(key)
    if template is None:
        template = digits.SegmentTemplate(int(segment_masks.get("w", 0)), int(segment_masks.get("h", 0)),
                                          {k: tuple(segment_masks.get("masks", {}).get(k, [])) for k in "abcdefg"})
        _CENTRAL_TEMPLATES[key] = template
    h, w = bgr.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in box]
    x1 = max(0, min(w - 1, x1))
    y1 = max(0, min(h - 1, y1))
    x2 = max(x1 + 1, min(w, x2))
    y2 = max(y1 + 1, min(h, y2))
    patch = bgr[y1:y2, x1:x2]
    if patch.size == 0:
        return "", 0.0, {}, {"reason": "empty_patch", "reader": "central"}
    best = digits.read_slot(patch, template, kind, int(slot_idx), invert=(owner == "player" and kind == "lap"),
                            profile="hdmi")
    if best is None:
        return "", 0.0, {}, {"reason": "template_larger_than_patch", "reader": "central"}
    states = {k: best.values[k] >= digits.SEGMENT_ON for k in "abcdefg"}
    meta = {"reader": "central", "template_box_in_patch": [best.x, best.y, best.x + best.w, best.y + best.h],
            "template_scale_x": best.scale_x, "template_scale_y": best.scale_y, "template_w": best.w,
            "template_h": best.h, "segment_values": dict(best.values), "valid_digit": best.valid,
            "margin": best.margin}
    return best.decoded, float(best.confidence), states, meta


def _scale_box_about_center(box: list[int], scale_x: float, scale_y: float, dx: int = 0, dy: int = 0) -> list[int]:
    x1, y1, x2, y2 = [float(v) for v in box]
    cx = (x1 + x2) * 0.5 + float(dx)
    cy = (y1 + y2) * 0.5 + float(dy)
    hw = max(1.0, (x2 - x1) * 0.5 * float(scale_x))
    hh = max(1.0, (y2 - y1) * 0.5 * float(scale_y))
    return [int(round(cx - hw)), int(round(cy - hh)), int(round(cx + hw)), int(round(cy + hh))]


def _clip_box_to_image(box, shape) -> list[int]:
    h, w = int(shape[0]), int(shape[1])
    x1, y1, x2, y2 = [int(round(float(v))) for v in box]
    x1 = max(0, min(w - 1, x1))
    y1 = max(0, min(h - 1, y1))
    x2 = max(x1 + 1, min(w, x2))
    y2 = max(y1 + 1, min(h, y2))
    return [x1, y1, x2, y2]


# --------------------------------------------------------------------------- #
# Grid geometry (ported verbatim from workflow_lab.py ~11009-11020)
# --------------------------------------------------------------------------- #
def _load_grid() -> dict[str, Any]:
    # MK8DX ecosystem overlay (CENTRAL_RECOGNITION section 8.6, phase 5): the time grid is the
    # recognition pack's (frame-definitions-v1.json timeGrids.endScreen), the same grid the Web
    # scanner and Android read; replaying 37 runs on 36 HDMI clips, the 12 fixtures and the golden
    # video with it gave byte-identical times and identity (2026-10-30). Without the staged file
    # there is no grid (the engine's own copy is no longer a route, 2026-10-31).
    global _GRID_CACHE
    if _GRID_CACHE is None:
        import json
        grid = None
        try:
            from .identity_matcher import assets_root
            defs_path = Path(assets_root()).parent / "frame-definitions-v1.json"
            if defs_path.is_file():
                defs = json.loads(defs_path.read_text(encoding="utf-8"))
                if defs.get("schema") == "mk8dx.frame-definitions.v1":
                    grid = (defs.get("timeGrids") or {}).get("endScreen")
        except Exception:
            grid = None
        _GRID_CACHE = grid if grid is not None else {}
    return _GRID_CACHE


def _owner_abs_box(owner: dict[str, Any], rel: list[float]) -> list[float]:
    anchor = owner.get("anchor") or {}
    ax = float(anchor.get("x", 0.0))
    ay = float(anchor.get("y", 0.0))
    x1, y1, x2, y2 = [float(v) for v in rel]
    return [ax + x1, ay + y1, ax + x2, ay + y2]


# --------------------------------------------------------------------------- #
# Owner / yellow-slot resolution (ported from workflow_lab.py ~11139-11164)
# --------------------------------------------------------------------------- #
def _detect_yellow_player_slot_hsv_lab(bgr: np.ndarray) -> dict[str, Any]:
    h, w = bgr.shape[:2]
    slots = {
        "top": [int(0.42 * w), int(0.06 * h), int(0.98 * w), int(0.50 * h)],
        "bottom": [int(0.42 * w), int(0.50 * h), int(0.98 * w), int(0.93 * h)],
    }
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    scores: dict[str, float] = {}
    for name, (x1, y1, x2, y2) in slots.items():
        roi_hsv = hsv[y1:y2, x1:x2]
        roi_lab = lab[y1:y2, x1:x2]
        if roi_hsv.size == 0 or roi_lab.size == 0:
            scores[name] = 0.0
            continue
        hch, sch, vch = cv2.split(roi_hsv)
        lch, _ach, bch = cv2.split(roi_lab)
        mask = ((hch >= 12) & (hch <= 40) & (sch >= 35) & (vch >= 80) & (bch >= 145) & (lch >= 75))
        scores[name] = float(np.count_nonzero(mask)) / float(max(1, mask.size))
    top = scores.get("top", 0.0)
    bottom = scores.get("bottom", 0.0)
    if max(top, bottom) < 0.08 or abs(top - bottom) < 0.04:
        position = None
    else:
        position = "top" if top > bottom else "bottom"
    return {"position": position, "scores": scores}


def _swap_player_ghost_keys(data: dict[str, Any]) -> dict[str, Any]:
    swapped: dict[str, Any] = {}
    for key, value in data.items():
        key_s = str(key)
        if key_s.startswith("player_"):
            swapped["ghost_" + key_s[len("player_"):]] = value
        elif key_s.startswith("ghost_"):
            swapped["player_" + key_s[len("ghost_"):]] = value
        else:
            swapped[key_s] = value
    return swapped


# --------------------------------------------------------------------------- #
# Field kind + time parse/validate (ported verbatim ~4520, 5199-5210)
# --------------------------------------------------------------------------- #
def _field_kind(field_name: str) -> str:
    return "total" if "_total" in str(field_name) else "lap"


def _format_segment_valid(text: str) -> bool:
    if len(text) != 8 or text[1] != ":" or text[4] != ".":
        return False
    if not (text[0].isdigit() and text[2:4].isdigit() and text[5:8].isdigit()):
        return False
    return 0 <= int(text[2:4]) <= 59


def _segment_time_ms(text: str) -> int | None:
    if not _format_segment_valid(text):
        return None
    return int(text[0]) * 60000 + int(text[2:4]) * 1000 + int(text[5:8])


def _race_lap_count(race_key: str) -> int:
    return 3 if str(race_key) == "race3" else 7


# --------------------------------------------------------------------------- #
# Driver: rewritten from the ACTIVE SevenSegmentOCRProbe branch
# (workflow_lab.py 15977-22103). Production execution mode, keep_node_packets
# False, build_visual_artifacts skipped, pkt.meta {} (no gate / no rfdetr / no
# canonical-align), so: owners = (player, ghost); race key explicit from the
# workflow; owner order comes purely from the yellow-slot HSV/LAB detection.
# --------------------------------------------------------------------------- #
class OcrEngine:
    """Minimal capture-card 7-segment OCR engine.

    Usage mirrors the old WorkflowOcrEngine construction site in results.py:
        engine = OcrEngine(lap_count)
        result = engine.run_frame(label, bgr_frame)
        result.fields  # dict[str, str] of "M:SS.mmm" time strings
    """

    def __init__(self, lap_count: int) -> None:
        self.race_key = "race7" if int(lap_count) == 7 else "race3"
        self.rel_grid = _load_grid()
        self._seg_lap = _load_segment_masks(SEGMENT_TEMPLATE_LAP)
        self._seg_total = _load_segment_masks(SEGMENT_TEMPLATE_TOTAL)

    def run_frame(self, label: str, image: np.ndarray) -> "_OcrResult":
        fields = self._read(_as_bgr(image))
        return _OcrResult(fields)

    # -- internal ---------------------------------------------------------- #
    def _read(self, ocr_image: np.ndarray) -> dict[str, str]:
        p = _PROBE_PARAMS
        threshold = float(p["segment_threshold"])
        template_scale_mode = str(p["template_scale_mode"])
        sx_min, sx_max = float(p["template_scale_x_min"]), float(p["template_scale_x_max"])
        sy_min, sy_max = float(p["template_scale_y_min"]), float(p["template_scale_y_max"])
        scale_step = float(p["template_scale_step"])
        digit_box_offset_x = float(p["digit_box_offset_x_px"])
        digit_spacing_x = float(p["digit_spacing_x_px"])
        digit_box_scale_x = float(p["digit_box_scale_x"])
        digit_box_scale_y = float(p["digit_box_scale_y"])
        apply_segment_offsets = bool(p["apply_segment_offsets"])
        check_lap_sum = bool(p["check_lap_sum"])

        seg_lap, seg_total = self._seg_lap, self._seg_total
        owners = ("player", "ghost")

        player_slot = _detect_yellow_player_slot_hsv_lab(ocr_image)
        pos = player_slot.get("position")
        resolved_player_slot = pos if pos in {"top", "bottom"} else None

        def digit_polarity_owner(canonical_owner: str) -> str:
            # Canonical grid: top = ghost slot, bottom = player slot. When the
            # yellow/player card is on top, swap polarity so lap-digit ink
            # inversion follows the physical card colour.
            if resolved_player_slot == "top":
                if canonical_owner == "ghost":
                    return "player"
                if canonical_owner == "player":
                    return "ghost"
            return canonical_owner

        def adjust_digit_box(box: list[int], slot_idx: int, layout_offset_y: float) -> list[int]:
            spacing_dx = (int(slot_idx) - 1) * digit_spacing_x
            adjusted = _scale_box_about_center(box, digit_box_scale_x, digit_box_scale_y, digit_box_offset_x + spacing_dx, layout_offset_y)
            return _clip_box_to_image(adjusted, ocr_image.shape)

        def read_segment_digit(box, owner, kind, slot_idx, masks):
            if int(slot_idx) == 2:
                return ":", 1.0, {}, {"valid_digit": True}
            if int(slot_idx) == 5:
                return ".", 1.0, {}, {"valid_digit": True}
            canonical_w, canonical_h = _canonical_segment_slot_size(kind, slot_idx)
            box_w = max(1.0, float(box[2] - box[0]))
            box_h = max(1.0, float(box[3] - box[1]))
            hint_x = box_w / max(1.0, float(canonical_w))
            hint_y = box_h / max(1.0, float(canonical_h))
            return _predict_segment_char_with_template(
                ocr_image, list(box), owner, kind, slot_idx, masks, threshold,
                template_scale_mode, sx_min, sx_max, sy_min, sy_max, scale_step,
                hint_x, hint_y,
            )

        dbg_on = bool(os.environ.get("LT_GRID_DEBUG"))

        def read_race(race_key: str, layout: dict[str, Any]) -> dict[str, Any]:
            grid_owners = (((self.rel_grid.get(race_key) or {}).get("owners") or {}))
            offsets = SEGMENT_OFFSETS[race_key]
            fields: dict[str, str] = {}
            details: list[dict[str, Any]] = []
            dbg_boxes: list[dict[str, Any]] = []
            layout_offset_y = float(layout["offset_y_px"])
            for owner in owners:
                polarity_owner = digit_polarity_owner(owner)
                owner_grid = grid_owners.get(owner) or {}
                if not owner_grid:
                    continue
                total_chars: list[str] = []
                for slot_idx, rel in enumerate(owner_grid.get("total_digits_rel") or [], start=1):
                    base_box = [int(round(v)) for v in _owner_abs_box(owner_grid, rel)]
                    ox = int(offsets[owner]["total"]["colX"].get(slot_idx, 0)) if apply_segment_offsets else 0
                    oy = int(offsets[owner]["total"]["rowY"]) if apply_segment_offsets else 0
                    read_box = adjust_digit_box(
                        _normalize_segment_box([base_box[0] + ox, base_box[1] + oy, base_box[2] + ox, base_box[3] + oy], "total", slot_idx),
                        slot_idx, layout_offset_y,
                    )
                    char, conf, _states, tmeta = read_segment_digit(read_box, polarity_owner, "total", slot_idx, seg_total)
                    total_chars.append(char)
                    details.append({"field": f"{owner}_total", "char": char, "confidence": conf})
                    if dbg_on:
                        dbg_boxes.append({"owner": owner, "kind": "total", "field": f"{owner}_total",
                                          "slotIdx": slot_idx, "box": [int(v) for v in read_box]})
                if total_chars:
                    fields[f"{owner}_total"] = "".join(total_chars)
                for lap_idx, row in enumerate(owner_grid.get("lap_digits_rel") or [], start=1):
                    lap_chars: list[str] = []
                    for slot_idx, rel in enumerate(row, start=1):
                        base_box = [int(round(v)) for v in _owner_abs_box(owner_grid, rel)]
                        ox = int(offsets[owner]["lap"]["colX"].get(slot_idx, 0)) if apply_segment_offsets else 0
                        oy = int(offsets[owner]["lap"]["rowY"].get(lap_idx, 0)) if apply_segment_offsets else 0
                        read_box = adjust_digit_box(
                            _normalize_segment_box([base_box[0] + ox, base_box[1] + oy, base_box[2] + ox, base_box[3] + oy], "lap", slot_idx),
                            slot_idx, layout_offset_y,
                        )
                        char, conf, _states, tmeta = read_segment_digit(read_box, polarity_owner, "lap", slot_idx, seg_lap)
                        lap_chars.append(char)
                        details.append({"field": f"{owner}_lap_{lap_idx}", "char": char, "confidence": conf})
                        if dbg_on:
                            dbg_boxes.append({"owner": owner, "kind": "lap", "field": f"{owner}_lap_{lap_idx}",
                                              "lapIdx": lap_idx, "slotIdx": slot_idx, "box": [int(v) for v in read_box]})
                    if lap_chars:
                        fields[f"{owner}_lap_{lap_idx}"] = "".join(lap_chars)

            valid_fields = {key: _format_segment_valid(val) for key, val in fields.items()}
            lap_sum_ok: bool | None = None
            lap_sum_error_ms: int | None = None
            if check_lap_sum:
                for owner in owners:
                    total_key = f"{owner}_total"
                    if total_key not in fields:
                        continue
                    total_ms = _segment_time_ms(fields.get(total_key, ""))
                    lap_values = []
                    max_laps = 7 if race_key == "race7" else 3
                    for idx in range(1, max_laps + 1):
                        lap_values.append(_segment_time_ms(fields.get(f"{owner}_lap_{idx}", "")))
                    if total_ms is not None and all(val is not None for val in lap_values):
                        lap_sum = sum(int(val) for val in lap_values if val is not None)
                        lap_sum_error_ms = abs(lap_sum - int(total_ms))
                        lap_sum_ok = lap_sum_error_ms <= 3
                        break

            valid_count = sum(1 for ok in valid_fields.values() if ok)
            field_count = max(1, len(fields))
            confidence_values = [float(item.get("confidence", 0.0)) for item in details if item.get("char") not in {"", "?", None}]
            avg_confidence = float(np.mean(confidence_values)) if confidence_values else 0.0
            unknown_count = sum(1 for item in details if item.get("char") in {"", "?"})
            expected_fields = len(owners) * (1 + (7 if race_key == "race7" else 3))
            lap_bonus = 1.0 if lap_sum_ok else (0.0 if lap_sum_ok is False else 0.35)
            lap_penalty = 0.0 if lap_sum_error_ms is None else min(1.0, float(lap_sum_error_ms) / 3000.0)
            score = (
                4.0 * (valid_count / field_count)
                + 2.0 * avg_confidence
                + 1.4 * min(1.0, len(fields) / max(1, expected_fields))
                + 1.2 * lap_bonus
                - 1.0 * (unknown_count / max(1, len(details)))
                - lap_penalty
            )
            return {
                "race_key": race_key,
                "fields": fields,
                "score": float(score),
                "layout_name": str(layout.get("name")),
                "layout_offset_y": layout_offset_y,
                "_dbgBoxes": dbg_boxes,
            }

        def _fully_closes(res: dict[str, Any]) -> bool:
            # A layout is definitively correct when every owner that appears
            # present (has a parseable total or lap time) has a valid total AND
            # all valid laps whose sum matches the total within 3ms. When that
            # holds, the other y-layout cannot yield a "more correct" read
            # (max lap-sum bonus + full valid_count already), so it is skipped.
            # Same early-exit logic results.py already uses for its shift sweep.
            f = res.get("fields") or {}
            max_laps = _race_lap_count(self.race_key)
            any_present = False
            for owner in owners:
                total_ms = _segment_time_ms(f.get(f"{owner}_total", ""))
                lap_ms = [_segment_time_ms(f.get(f"{owner}_lap_{i}", "")) for i in range(1, max_laps + 1)]
                if total_ms is None and not any(v is not None for v in lap_ms):
                    continue  # owner absent (phantom-ghost) -> not required to close
                any_present = True
                if total_ms is None or any(v is None for v in lap_ms):
                    return False
                if abs(sum(int(v) for v in lap_ms) - int(total_ms)) > 3:
                    return False
            return any_present

        # Try the race-preferred y-layout first (measured: 3-lap reads native
        # y=0, 7-lap reads message-bar y=-30) and stop as soon as it fully
        # closes -- this skips computing the losing layout on the happy path,
        # halving the per-frame template matching. Falls through to both layouts
        # (identical to before) when the first one does not close.
        if self.race_key == "race7":
            layout_candidates = [
                {"name": "message_bar_y_minus30", "offset_y_px": -30.0},
                {"name": "native_y", "offset_y_px": 0.0},
            ]
        else:
            layout_candidates = [
                {"name": "native_y", "offset_y_px": 0.0},
                {"name": "message_bar_y_minus30", "offset_y_px": -30.0},
            ]
        race_results = []
        for layout in layout_candidates:
            race_results.append(read_race(self.race_key, layout))
            if _fully_closes(race_results[-1]):
                break
        selected = sorted(race_results, key=lambda item: float(item.get("score", 0.0)), reverse=True)[0]
        fields = dict(selected["fields"])
        if dbg_on:
            _GRID_DEBUG.append({
                "raceKey": selected.get("race_key"),
                "layout": selected.get("layout_name"),
                "layoutOffsetY": selected.get("layout_offset_y"),
                "playerSlot": resolved_player_slot,
                "swapped": resolved_player_slot == "top",
                "boxes": selected.get("_dbgBoxes") or [],
            })
        if resolved_player_slot == "top":
            fields = _swap_player_ghost_keys(fields)
        return fields


class _OcrResult:
    __slots__ = ("fields",)

    def __init__(self, fields: dict[str, str]) -> None:
        self.fields = fields


# Backwards-compatible factory alias (results.py constructs OcrEngine(lap_count)).
def make_engine(lap_count: int) -> OcrEngine:
    return OcrEngine(lap_count)
