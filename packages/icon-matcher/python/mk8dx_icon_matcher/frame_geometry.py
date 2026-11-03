"""The central frame geometry (CENTRAL_RECOGNITION section 8.6, phase 5): where a Time Trial card's
fields lie on the canonical 1280x720 frame.

One specification in Python (this reference), TypeScript (``ts/sharedFrameGeometry.ts``) and Java
(``FrameGeometry.java``), on one data file in the recognition pack
(``frame-definitions-v1.json``, mk8dx.frame-definitions.v1, built by
``tooling/recognition/build_frame_definitions.py`` from the geometry the Web scanner and Android
staged byte-identically: ``icon_grid.json``, ``reg.json`` and the two relative grids). It is the
arithmetic part of the ROI Searcher. The card registration's decision is central too
(``register_card``: scale grid, score, refinement rule); its pixel work (the edge map and the
template match) stays with each product and is handed in as two callbacks.

- ``panel_box``: the card from the lap-index anchor and ``panel_rels``, else the static panel;
- ``register_window``: the region the card registration searches (pad from ``reg.json``);
- ``register_card``: where the card's edge template fits in that window (offset, scale), or a
  refusal;
- ``deploy_box``: a field's box on the registered deploy card, scaled to the panel;
- ``slot_box``: a field's rough slot: centred on the registered deploy box when the card
  registered, else the panel-relative slot of ``icon_grid.json``;
- ``search_window``: the slot widened by the matcher's search pad, clipped to the frame;
- ``text_strip``: the printed-name strip right of a slot (row text ends at 52% of the card, 95%
  on the Select-a-Ghost panel).

Rounding is half up (``floor(x + 0.5)``, as JavaScript's and Java's ``Math.round``); the
registration window truncates toward zero, as both products did.
"""

from __future__ import annotations

import math

SCHEMA = "mk8dx.frame-definitions.v1"
GHOST_DETAIL_KEYS = ("ghost_detail", "ghost_detail7")
REG_GROUP = {"character_icon": "characters", "kart_icon": "bodies", "wheel_icon": "tires",
             "glider_icon": "gliders", "flag_icon": "flags"}


def _round(x: float) -> int:
    return math.floor(x + 0.5)


def _trunc(x: float) -> int:
    return math.trunc(x)


def race_and_laps(race_key: str) -> tuple[str, str, bool]:
    """``(race, laps, ghost_detail)`` for an engine race key (``race3``, ``race7``, ``ghost_detail``,
    ``ghost_detail7``)."""
    ghost_detail = race_key in GHOST_DETAIL_KEYS
    if ghost_detail:
        return race_key, race_key, True
    race = "race7" if race_key == "race7" else "race3"
    return race, ("7laps" if race == "race7" else "3laps"), False


def panel_box(defs: dict, race_key: str, owner: str, anchor: list | None) -> dict | None:
    """``{x, y, w, h, source}`` of the owner's card, or None when the frame has no such panel."""
    race, _laps, _gd = race_and_laps(race_key)
    rels = (defs["endScreen"].get("panelRels") or {}).get(race) or {}
    rel = rels.get(owner)
    if anchor is not None and rel is not None:
        return {"x": anchor[0] + rel[0], "y": anchor[1] + rel[1], "w": rel[2] - rel[0], "h": rel[3] - rel[1],
                "source": "lap_index_anchor"}
    panel = (defs["endScreen"]["panels"].get(race) or {}).get(owner)
    if panel is None:
        return None
    return {"x": panel[0], "y": panel[1], "w": panel[2] - panel[0], "h": panel[3] - panel[1],
            "source": "static_canonical"}


def register_window(defs: dict, panel: dict, image_w: int, image_h: int) -> list:
    """``[x1, y1, x2, y2]`` the card registration searches (``reg.json`` pad: side, top, bottom)."""
    side, top, bottom = defs["registration"]["pad"]
    return [max(0, _trunc(panel["x"] - side)), max(0, _trunc(panel["y"] - top)),
            min(image_w, _trunc(panel["x"] + panel["w"] + side)), min(image_h, _trunc(panel["y"] + panel["h"] + bottom))]


REGISTER_SCALES_Y = (0.94, 0.96, 0.98, 1.00, 1.02, 1.04)
REGISTER_SCALES_X = (0.97, 1.00, 1.03)
REGISTER_SCALE_PENALTY = 0.25
REGISTER_MIN_WINDOW = 32
REGISTER_MIN_TEMPLATE = 8
REGISTER_REFINE_MARGIN = 5
REGISTER_REFINE_TOLERANCE = 0.05


def register_coarse_size(defs: dict, window: list) -> list:
    """``[w, h]`` of the reduced edge map the coarse search runs on (``registration.half``)."""
    half = defs["registration"]["half"]
    return [_round((window[2] - window[0]) * half), _round((window[3] - window[1]) * half)]


def register_card(defs: dict, panel: dict, window: list, coarse, fine) -> list:
    """Where the card's edge template fits: ``[dx, dy, sx, sy, raw, failed]``, the offset from the
    panel's corner, the scales, the match score and 1 when the card did not register (then
    ``[0, 0, 1, 1, raw, 1]``).

    ``window``: ``register_window``. The products do the pixel work: ``coarse(tw, th)`` matches the
    template resized to ``tw x th`` on the edge map reduced to ``register_coarse_size`` and returns
    ``(score, x, y)`` of the best place; ``fine(x1, y1, x2, y2, tw, th)`` matches the full-size
    template inside that part of the full edge map and returns ``(score, x, y)`` relative to it.
    Normalised cross-correlation (TM_CCOEFF_NORMED) on the edge magnitude, in both products."""
    reg = defs["registration"]
    half = reg["half"]
    ww, wh = window[2] - window[0], window[3] - window[1]
    if ww < REGISTER_MIN_WINDOW or wh < REGISTER_MIN_WINDOW:
        return [0, 0, 1, 1, 0, 1]
    cw, ch = register_coarse_size(defs, window)
    best = None
    for sy in REGISTER_SCALES_Y:
        for sx in REGISTER_SCALES_X:
            tw, th = _round(panel["w"] * half * sx), _round(panel["h"] * half * sy)
            if tw < REGISTER_MIN_TEMPLATE or th < REGISTER_MIN_TEMPLATE or tw > cw or th > ch:
                continue
            raw, x, y = coarse(tw, th)
            score = raw - REGISTER_SCALE_PENALTY * (abs(sy - 1.0) + abs(sx - 1.0))
            if best is None or score > best[0]:
                best = (score, x, y, sx, sy, raw)
    if best is None:
        return [0, 0, 1, 1, 0.0, 1]
    _score, bx, by, sx, sy, raw = best
    if raw < reg["scoreMin"]:
        return [0, 0, 1, 1, raw, 1]
    tw, th = _round(panel["w"] * sx), _round(panel["h"] * sy)
    fx, fy = _round(bx / half), _round(by / half)
    m = REGISTER_REFINE_MARGIN
    x1, y1 = max(0, fx - m), max(0, fy - m)
    x2, y2 = min(ww, fx + tw + m), min(wh, fy + th + m)
    if y2 - y1 >= th and x2 - x1 >= tw:
        fine_raw, x, y = fine(x1, y1, x2, y2, tw, th)
        if fine_raw >= best[5] - REGISTER_REFINE_TOLERANCE:
            fx, fy, raw = x1 + x, y1 + y, fine_raw
    return [window[0] + fx - panel["x"], window[1] + fy - panel["y"], sx, sy, raw, 0]


def deploy_box(defs: dict, icon_kind: str, laps: str, panel_w: float, panel_h: float) -> list | None:
    """A field's ``[x, y, w, h]`` on the deploy card, scaled to the panel; None without data."""
    reg = defs["registration"]
    group = REG_GROUP.get(icon_kind)
    lap_key = "7lap" if laps == "7laps" else "3lap"
    try:
        off = reg["offsets"][lap_key][group]
        size = reg["boxSizes"][group]
        dw, dh = reg["deployCard"][laps]
    except (KeyError, TypeError, ValueError):
        return None
    return [off[0] / dw * panel_w, off[1] / dh * panel_h, size[0] / dw * panel_w, size[1] / dh * panel_h]


def slot_rel(defs: dict, owner: str, icon_kind: str, laps: str) -> list | None:
    slots = defs["endScreen"]["slots"]
    slot = slots.get(f"{owner}_{icon_kind}_{laps}") or slots.get(f"player_{icon_kind}_{laps}")
    return None if slot is None else slot["rel_xywh"]


def slot_box(defs: dict, owner: str, icon_kind: str, laps: str, panel: dict,
             registration: list | None) -> list | None:
    """The field's rough slot ``[x, y, w, h]``. ``registration``: ``[dx, dy, sx, sy]`` of a
    registered card (the products' edge template match), None when it did not register."""
    rel = slot_rel(defs, owner, icon_kind, laps)
    if rel is None:
        return None
    box = deploy_box(defs, icon_kind, laps, panel["w"], panel["h"]) if registration is not None else None
    if box is not None:
        dx, dy, sx, sy = registration
        return [_round(panel["x"] + dx + sx * (box[0] + box[2] / 2.0) - box[2] / 2.0),
                _round(panel["y"] + dy + sy * (box[1] + box[3] / 2.0) - box[3] / 2.0),
                _round(box[2]), _round(box[3])]
    return [_round(panel["x"] + rel[0] * panel["w"]), _round(panel["y"] + rel[1] * panel["h"]),
            _round(rel[2] * panel["w"]), _round(rel[3] * panel["h"])]


def search_window(defs: dict, icon_kind: str, slot: list, image_w: int, image_h: int) -> list:
    """``[x1, y1, x2, y2]``: the slot widened by the matcher's search pad (smaller for flags)."""
    pads = defs["matcher"]["searchPad"]
    pad = pads["flag"] if icon_kind == "flag_icon" else pads["icon"]
    return [max(0, slot[0] - pad), max(0, slot[1] - pad), min(image_w, slot[0] + slot[2] + pad),
            min(image_h, slot[1] + slot[3] + pad)]


def text_right(defs: dict, panel: dict, ghost_detail: bool) -> int:
    """Where printed row text ends (x)."""
    ratios = defs["textStrip"]["rightRatio"]
    return _round(panel["x"] + (ratios["ghostDetail"] if ghost_detail else ratios["card"]) * panel["w"])


def text_strip(defs: dict, slot: list, right: int) -> list:
    """``[x, y, w, h]`` of the printed name right of a slot, up to ``right``."""
    strip = defs["textStrip"]
    x = slot[0] + slot[2] + strip["gap"]
    return [x, slot[1] + strip["top"], right - x, slot[3] + strip["heightPad"]]


def ghost_name_right(defs: dict, panel: dict) -> int:
    """Where the rider name ends on the Select-a-Ghost panel (x)."""
    return _round(panel["x"] + defs["textStrip"]["ghostNameRightRatio"] * panel["w"])


# Tournament screens: the score screens (RaceScore/TotalScore) and the track-intro lobby
# (0TrackName). One data file beside the references (``references/scoreboard-frames-v1.json``,
# mk8dx.scoreboard-frames.v1), staged with this package into every product; the recognition pack's
# frame definitions pin its SHA-256. Python only: Tournament is the one product reading these screens.
SCOREBOARD_SCHEMA = "mk8dx.scoreboard-frames.v1"
_SCOREBOARD: dict | None = None


def scoreboard_frames() -> dict:
    global _SCOREBOARD
    if _SCOREBOARD is None:
        import json
        from pathlib import Path

        data = json.loads((Path(__file__).parent / "references" / "scoreboard-frames-v1.json").read_bytes())
        if data.get("schema") != SCOREBOARD_SCHEMA or data.get("canonical") != [1280, 720]:
            raise ValueError("Unsupported scoreboard frames")
        _SCOREBOARD = data
    return _SCOREBOARD


def score_layout(layout_id: str) -> dict:
    """One score-screen layout (``lan2_split_2p``, ``lan1_full_1p``)."""
    return scoreboard_frames()["scoreboard"]["layouts"][layout_id]


def score_character_box(layout_id: str, row: int) -> list:
    """The character cell of score row ``row`` (1-12) as ``[x, y, w, h]``."""
    board = scoreboard_frames()["scoreboard"]
    cell = board["character"]
    return [score_layout(layout_id)["characterLeft"], cell["top"] + (row - 1) * board["rowHeight"],
            cell["width"], cell["height"]]


def lobby_boxes() -> tuple[list, list]:
    """The track-intro lobby's 12 face boxes and 12 name boxes (``[x, y, w, h]``, slots 0-5 left
    column top to bottom, 6-11 right column)."""
    lobby = scoreboard_frames()["lobby"]
    return lobby["faceBoxes"], lobby["nameBoxes"]
