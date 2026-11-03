"""The Time Trial ghost menu: the Select-a-Ghost panel and ghost replays.

Two things a player does on the ghost menu that the race engine never saw:

1. **Looking at a ghost.** The panel top right shows the selected ghost. It is
   *collapsed* (name, flag, character, total) until the player opens its
   details; *expanded* it adds every lap time and the body / tire / glider.
   Both are useful: a replay can be started straight from a collapsed panel.
   `GhostPanelReader.read` returns what is on screen and says which it was.

2. **Watching a ghost's replay.** "View Ghost" (084) -> "Start Replay?" (083)
   plays the ghost's run with the normal race HUD, so the engine's racing
   logic already sees its coins, mushrooms and laps. The replay loops until the
   player quits it through the replay menu (075-082: Continue Replay, Replay
   from Start, Race against Ghost, Quit Replay). `GhostMenuScreens` names those
   screens so the analyzer can mark such a run as a replay of that ghost -
   never as the player's own run - and follow the menu choice.

Geometry comes from Clean Assets v5.2+ detection.ghostMenuPanel through the
engine's TemplateDb. The caller supplies a direct 1280x720 game frame.
"""

from __future__ import annotations

import difflib
import re

import cv2
import numpy as np

T = "hud_template."

def _box(cell: dict) -> tuple[int, int, int, int]:
    return tuple(int(cell[key]) for key in ("x", "y", "w", "h"))


def _panel_geometry(tdb) -> dict:
    panel = (getattr(tdb, "db", {}).get("detection") or {}).get("ghostMenuPanel")
    if not panel or panel.get("frame") != {"width": 1280, "height": 720}:
        raise ValueError("Ghost Select needs Clean Assets v5.2+ ghostMenuPanel geometry")
    for profile, count in (("3lap", 3), ("7lap", 7)):
        layout = panel["layouts"][profile]
        if layout["lapCount"] != count or len(layout["lapTimes"]["cells"]) != count:
            raise ValueError(f"Invalid Ghost Select {profile} geometry")
    return panel


def _layout_profile(bgr: np.ndarray, panel: dict, *, wide_edge_probe: bool = False) -> str | None:
    """Find the first part bar's lower edge in the in-game image."""
    if wide_edge_probe:
        # The opt-in QA edge can also fire on the bright chart behind a
        # collapsed 150cc ghost. Compare the chart with this frame's own dark
        # header before allowing an expanded-panel classification. The normal
        # product edge probe is unchanged.
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        chart_delta = float(np.median(gray[230:310, 900:1020])
                            - np.median(gray[105:130, 900:1020]))
        if chart_delta >= 40:
            return None
    probe = panel["layoutDetect"]["probe"]
    x, w = int(probe["x"]), int(probe["w"])
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    jumps = {}
    for profile, edge in panel["layoutDetect"]["edges"].items():
        edge = int(edge)
        narrow = float(gray[edge + 1, x:x + w].mean() - gray[edge, x:x + w].mean())
        jumps[profile] = narrow
        if wide_edge_probe:
            # The opt-in optical QA path also checks the continuing bar edge
            # beyond a moving ghost portrait that can cover the narrow probe.
            name = panel["layouts"]["3lap"]["partNames"]["cells"]["body"]
            wide_x = int(name["x"]) + 23
            wide_w = min(120, int(name["w"]) - 23)
            wide = float(gray[edge + 1, wide_x:wide_x + wide_w].mean() -
                         gray[edge, wide_x:wide_x + wide_w].mean())
            jumps[profile] = max(narrow, wide)
    profile = max(jumps, key=jumps.get)
    return profile if jumps[profile] >= 12.0 else None

TIME_RE = re.compile(r"^\d:\d\d\.\d\d\d$")


def time_to_ms(text: str | None) -> int | None:
    if not text or not TIME_RE.match(text):
        return None
    m, rest = text.split(":")
    s, ms = rest.split(".")
    return int(m) * 60000 + int(s) * 1000 + int(ms)


_CENTRAL_TIME = None


def _central_lap_sum_ok(total_text, lap_texts) -> bool:
    """The central time decision's lap-sum rule (packages/icon-matcher time_decision, the same as
    the Web scanner and Android). Without the central package nothing closes (the previous own
    check was removed on 2026-10-31)."""
    global _CENTRAL_TIME
    if _CENTRAL_TIME is None:
        try:
            from .shared_field_shadow import _field_package
            _CENTRAL_TIME = __import__(_field_package().__name__ + ".time_decision", fromlist=["lap_sum_complete"])
        except Exception:
            _CENTRAL_TIME = False
    if not _CENTRAL_TIME:
        return False
    return _CENTRAL_TIME.lap_sum_complete([{"total": total_text, "laps": list(lap_texts)}])


# --- seven-segment digits -----------------------------------------------------
# The panel prints times in the game's upright seven-segment font. Each glyph
# is found as a column run of bright "ink" and decoded by sampling its seven
# segments; ':' and '.' are the short runs. Colour-free (the total is white,
# the laps are pale yellow) and brightness-free (ink is measured against the
# panel background inside the same box).
_SEGMENTS = {  # a b c d e f g
    (1, 1, 1, 1, 1, 1, 0): "0", (0, 1, 1, 0, 0, 0, 0): "1", (1, 1, 0, 1, 1, 0, 1): "2",
    (1, 1, 1, 1, 0, 0, 1): "3", (0, 1, 1, 0, 0, 1, 1): "4", (1, 0, 1, 1, 0, 1, 1): "5",
    (1, 0, 1, 1, 1, 1, 1): "6", (1, 1, 1, 0, 0, 0, 0): "7", (1, 1, 1, 1, 1, 1, 1): "8",
    (1, 1, 1, 1, 0, 1, 1): "9", (1, 1, 1, 0, 0, 1, 0): "7",
}
_SEG_POINTS = ((0.5, 0.06), (0.88, 0.28), (0.88, 0.72), (0.5, 0.94),
               (0.12, 0.72), (0.12, 0.28), (0.5, 0.5))
INK_ON = 0.45


def _ink(crop_bgr: np.ndarray) -> np.ndarray:
    g = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    bg = np.percentile(g, 35)
    hi = np.percentile(g, 97)
    if hi - bg < 25:          # nothing printed here (a flat box)
        return np.zeros_like(g)
    return (g - bg) / (hi - bg)


def _runs(mask_1d: np.ndarray) -> list[tuple[int, int]]:
    out, start = [], None
    for i, v in enumerate(mask_1d):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask_1d)))
    return out


def read_digits(bgr: np.ndarray, box) -> str | None:
    """'d:dd.ddd' from a panel time box, or None when it does not decode to
    exactly that shape (collapsed rows, fades and transitions all land here).

    The ROI Searcher's presence probe (0.3 ms): is a ghost panel on screen. The times the panel
    reports are read by the central matcher (``CentralPanelTimes``)."""
    x, y, w, h = box
    crop = bgr[y:y + h, x:x + w]
    if crop.size == 0:
        return None
    ink = _ink(crop)
    on = ink > INK_ON
    rows = np.where(on.sum(1) > 0)[0]
    if len(rows) == 0:
        return None
    gy0, gy1 = int(rows[0]), int(rows[-1]) + 1
    gh = gy1 - gy0
    if gh < 12:
        return None
    band = on[gy0:gy1]
    runs = []
    for a, b in _runs(band.any(0)):
        if runs and a - runs[-1][1] <= 1:
            runs[-1] = (runs[-1][0], b)
        else:
            runs.append((a, b))
    wide = [b - a for a, b in runs if (b - a) > gh * 0.3]
    if not wide:
        return None
    cw = float(np.median(wide))
    text = []
    for a, b in runs:
        prof = band[:, a:b].any(1)
        blobs = [e - s for s, e in _runs(prof)]
        extent = (np.where(prof)[0][-1] - np.where(prof)[0][0] + 1) / gh if prof.any() else 0
        if extent < 0.45:                      # '.' sits low, anything else is noise
            top = np.where(prof)[0][0] / gh if prof.any() else 0
            text.append("." if top >= 0.5 else "?")
            continue
        if b - a < cw * 0.6:                   # narrow: '1' (two long strokes) or ':' (two dots)
            text.append(":" if blobs and max(blobs) < gh * 0.3 else "1")
            continue
        cell = ink[gy0:gy1, a:b]
        r = max(1, int(round(gh * 0.04)))
        seg = []
        for fx, fy in _SEG_POINTS:
            xi, yi = int(round(fx * (b - a))), int(round(fy * gh))
            patch = cell[max(0, yi - r):yi + r + 1, max(0, xi - r):xi + r + 1]
            seg.append(int(patch.size > 0 and float(patch.mean()) > INK_ON))
        text.append(_SEGMENTS.get(tuple(seg), "?"))
    s = "".join(text)
    return s if TIME_RE.match(s) else None


# The seven-lap panel is taller: the scanners register it with its centre where the three-lap panel's
# centre is, while on HDMI its header stays where the three-lap header is. On the canonical frame the
# seven-lap grid therefore sits this far from the HDMI transform above (measured on the Baby Park
# panel, the only seven-lap track: every total and lap right for dx -8..-6, dy -55..-51).
SEVEN_LAP_CANONICAL_SHIFT = (-7, -53)


class CentralPanelTimes:
    """The panel's times read centrally (CENTRAL_RECOGNITION section 8.6): the pack's ghost-detail
    time grid (frame-definitions-v1.json ``timeGrids.ghostDetail``) laid nominally on the canonical
    panel (lap_grid.build_dynamic_grid, ``nominal``; the HDMI frame is warped onto it with
    ``HDMI_FROM_PANEL_CANONICAL``) and every digit slot read by segment_digits.read_slot with the
    engine's 7-segment templates - the same grid and matcher as the Web scanner and Android.
    Measured on the 152 staff76 HDMI panels: every total and every lap of the 76 expanded panels
    equal to the previous reader (2026-10-31). A read is kept per panel state until its laps close."""

    def __init__(self, modules=None):
        # ``modules``: (lap_grid, segment_digits, ghost-detail grid, templates), else loaded lazily
        self._modules = modules
        self._grids: dict = {}
        self._cache: dict = {}

    def _load(self):
        if self._modules is None:
            try:
                import json
                from pathlib import Path

                from . import ocr
                from .identity_matcher import assets_root
                from .shared_field_shadow import _field_package
                package = _field_package()
                lap_grid = __import__(package.__name__ + ".lap_grid", fromlist=["build_dynamic_grid"])
                digits = __import__(package.__name__ + ".segment_digits", fromlist=["read_slot"])
                defs = json.loads((Path(assets_root()).parent / "frame-definitions-v1.json").read_text(encoding="utf-8"))
                templates = {}
                for kind, path in (("lap", ocr.SEGMENT_TEMPLATE_LAP), ("total", ocr.SEGMENT_TEMPLATE_TOTAL)):
                    masks = ocr._load_segment_masks(path)
                    templates[kind] = digits.SegmentTemplate(int(masks["w"]), int(masks["h"]),
                                                             {k: tuple(masks["masks"][k]) for k in "abcdefg"})
                self._modules = (lap_grid, digits, defs["timeGrids"]["ghostDetail"], templates)
            except Exception:
                self._modules = False
        return self._modules

    def _slots(self, race_key: str):
        lap_grid, _digits, grid, _templates = self._modules
        if race_key not in self._grids:
            owner = grid[race_key]["owners"]["ghost"]
            rows = [{"label": "lap_index", "score": 1.0, "left": b.left / 1280, "top": b.top / 720,
                     "right": b.right / 1280, "bottom": b.bottom / 720}
                    for b in lap_grid.canonical_lap_index_boxes(owner)]
            built = lap_grid.build_dynamic_grid(grid, race_key, True, 1280, 720, rows, rows, nominal=True)
            self._grids[race_key] = {f["name"]: (f["type"], f["slots"]) for f in built["fields"]}
        return self._grids[race_key]

    def read(self, bgr: np.ndarray, lap_count: int, key) -> dict | None:
        """``{"ghost_total": text|None, "ghost_lap_1": ...}`` (an unreadable time is None), or None
        without the central package."""
        if not self._load():
            return None
        if key in self._cache:
            return self._cache[key]
        _lap_grid, digits, _grid, templates = self._modules
        canonical = cv2.warpAffine(bgr, HDMI_FROM_PANEL_CANONICAL, (bgr.shape[1], bgr.shape[0]),
                                   flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
        if lap_count == 7:
            dx, dy = SEVEN_LAP_CANONICAL_SHIFT
            canonical = cv2.warpAffine(canonical, np.float32([[1, 0, dx], [0, 1, dy]]),
                                       (canonical.shape[1], canonical.shape[0]), borderMode=cv2.BORDER_REPLICATE)
        out = {}
        for name, (kind, slots) in self._slots("race7" if lap_count == 7 else "race3").items():
            chars = []
            for index, (x1, y1, x2, y2) in enumerate(slots, 1):
                if index in (2, 5):
                    chars.append(":" if index == 2 else ".")
                    continue
                best = digits.read_slot(canonical[int(y1):int(y2), int(x1):int(x2)], templates[kind], kind, index,
                                        invert=False, profile="hdmi")
                chars.append(best.decoded if best else "?")
            text = "".join(chars)
            # a time counts only in the central format (scan_result.time_ms: seconds below 60)
            out[name] = text if TIME_RE.match(text) and int(text[2:4]) < 60 else None
        laps = [out.get(f"ghost_lap_{i}") for i in range(1, lap_count + 1)]
        if _central_lap_sum_ok(out.get("ghost_total"), [lap or "" for lap in laps]):
            if len(self._cache) > 64:
                self._cache.clear()
            self._cache[key] = out
        return out


# --- the panel -----------------------------------------------------------------

_CENTRAL_NAMES = None


def _central_names():
    """The staged central name matcher (packages/icon-matcher name_match); False without it."""
    global _CENTRAL_NAMES
    if _CENTRAL_NAMES is None:
        try:
            from .shared_field_shadow import _field_package
            package = _field_package()
            _CENTRAL_NAMES = __import__(package.__name__ + ".name_match", fromlist=["match_name"])
            if not hasattr(_CENTRAL_NAMES, "match_name"):
                _CENTRAL_NAMES = False
        except Exception:
            _CENTRAL_NAMES = False
    return _CENTRAL_NAMES

# A player name follows the player, not the console language: once the console language is
# decided only that script's reader is loaded, so a Japanese name read with the Latin reader comes
# out as garbage ("7+a9uvy+ ("), and on a Japanese, Korean, Chinese or Russian console a Spanish
# "Peña" is read by that script's reader. Such a read is read again: first with the reader of the
# script the ghost's country writes in (owner, 2026-10-30: the flag hints the second reader; a country
# outside FLAG_SCRIPT writes Latin), then with the other scripts until one reads it clearly. The read
# with the higher OCR confidence wins.
FLAG_SCRIPT = {"country.jp": "ja", "country.kr": "ko", "country.cn": "zh-cn", "country.tw": "zh-tw",
               "country.hk": "zh-tw", "country.ru": "ru", "country.by": "ru", "country.kz": "ru",
               "country.ua": "ru", "country.bg": "ru", "country.rs": "ru"}
SCRIPT_KEYS = ("latin", "ja", "ko", "zh-cn", "zh-tw", "ru")
NAME_GARBAGE_SYMBOLS = set("+()[]{}|\\/<>=_~^`@#$%&;")
NAME_MIN_CONFIDENCE = 0.5
NAME_REREAD_GAIN = 0.1
_SCRIPT_READERS: dict = {}


def name_looks_unread(text: str, confidence: float) -> bool:
    """A Latin read of a name that is probably another script: low confidence, or symbols no
    profile name in the Latin readers' alphabet would print twice."""
    if not text:
        return True
    return confidence < NAME_MIN_CONFIDENCE or sum(c in NAME_GARBAGE_SYMBOLS for c in text) >= 2


def _script_reader(key: str):
    if key not in _SCRIPT_READERS:
        try:
            from .consolelang import OCR_READERS, _easyocr_reader
            _SCRIPT_READERS[key] = _easyocr_reader(OCR_READERS[key])
        except Exception:
            _SCRIPT_READERS[key] = None
    return _SCRIPT_READERS[key]


class GhostPanelReader:
    """Reads the Select-a-Ghost panel from one clean 1280x720 BGR frame."""

    def __init__(self, tdb, easyocr_reader=None, identity_reader=None, shared_candidate=None, times=None):
        self.tdb = tdb
        self.panel = _panel_geometry(tdb)
        self._times = times if times is not None else CentralPanelTimes()
        self._ocr = easyocr_reader
        self._identity = identity_reader
        self.shared_candidate = shared_candidate
        self.wide_edge_probe = False
        self._part_names = None
        self._picker = None

    # names of bodies/tires/gliders in every locale: ordered ("<id>#<locale>", name) pairs
    def _parts_vocab(self) -> dict:
        if self._part_names is None:
            vocab = {"bodies": [], "tires": [], "gliders": []}
            cols = self.tdb.db.get("collections", {})
            for group, key in (("bodies", "vehicleBodies"), ("tires", "vehicleTires"),
                               ("gliders", "vehicleGliders")):
                for rec in cols.get(key, []) or []:
                    for locale, name in sorted((rec.get("names") or {}).items()):
                        if name:
                            vocab[group].append((f"{rec['id']}#{locale}", name))
            self._part_names = vocab
        return self._part_names

    def _text(self, bgr, box) -> str:
        if self._ocr is None:
            return ""
        x, y, w, h = box
        crop = cv2.resize(bgr[y:y + h, x:x + w], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        try:
            res = self._ocr.readtext(crop, detail=0, paragraph=False)
        except Exception:
            return ""
        return " ".join(str(t) for t in res).strip()

    @staticmethod
    def _read_with(reader, crop) -> tuple[str, float]:
        try:
            res = reader.readtext(crop, detail=1, paragraph=False)
        except Exception:
            return "", 0.0
        if not res:
            return "", 0.0
        if all(isinstance(item, str) for item in res):   # a reader without confidences
            return " ".join(res).strip(), 1.0
        text = " ".join(str(item[1]) for item in res).strip()
        return text, float(sum(float(item[2]) for item in res) / len(res))

    def _name(self, bgr, box, flag_id: str | None) -> str:
        """The ghost's player name; a probably-unread Latin read is read again in the script of
        the ghost's country (FLAG_SCRIPT), or in every script when the flag gives no hint."""
        if self._ocr is None:
            return ""
        x, y, w, h = box
        crop = cv2.resize(bgr[y:y + h, x:x + w], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        text, confidence = self._read_with(self._ocr, crop)
        if not name_looks_unread(text, confidence):
            return text
        hint = FLAG_SCRIPT.get(flag_id, "latin") if flag_id else None
        keys = ([hint] if hint else []) + [key for key in SCRIPT_KEYS if key != hint]
        best = (text, confidence)
        for key in keys:
            reader = _script_reader(key)
            if reader is None:
                continue
            candidate = self._read_with(reader, crop)
            if candidate[0] and candidate[1] >= best[1] + NAME_REREAD_GAIN:
                best = candidate
            if not name_looks_unread(*best):
                break   # read clearly: the remaining scripts are not loaded
        return best[0]

    def _part_from_text(self, raw: str, group: str) -> dict | None:
        # MK8DX ecosystem overlay (CENTRAL_RECOGNITION section 8.6, phase 3): the printed part name
        # is matched by the central name matcher (packages/icon-matcher name_match, the same
        # specification as the Web scanner and Android): normalized Levenshtein, margin against
        # the best name spelled differently. Below 0.6 there is no clue, as before.
        if not raw:
            return None
        names = _central_names()
        if not names:
            return None
        found = names.match_name(raw, self._parts_vocab()[group])
        if found.key is None or found.fuzzy < 0.6:
            return None
        return {"id": found.key[:found.key.index("#")], "raw": raw, "ratio": round(found.fuzzy, 3),
                "margin": round(found.margin, 3)}

    def _icon(self, bgr, box, group, subset=None, *, screen="collapsed",
              character=None, text=None) -> dict | None:
        if self.shared_candidate is not None:
            result = self.shared_candidate.read(
                source=bgr, box=box, kind=group,
                profile="ghost_select" if group == "characters" else "result",
                presence="present", owner="ghost", screen=screen,
                character=character,
                text=(text["id"], text["ratio"], text["margin"]) if text else None)
            visual = result["visualRead"] or {}
            return {"id": result["acceptedId"],
                    "selectedId": result["selectedId"],
                    "reviewRequired": result["reviewRequired"],
                    "score": round(float(visual.get("score", 0)), 3),
                    "margin": round(float(visual.get("margin", 0)), 3),
                    "status": result["status"],
                    "rankedCandidates": result["rankedCandidates"],
                    "rankedFamilies": result["rankedFamilies"],
                    "proposedFamilyId": result["proposedFamilyId"],
                    "familyMargin": result["familyMargin"],
                    "variantMargin": result["variantMargin"],
                    **({"suggestion": result["suggestion"]}
                       if result["suggestion"] else {})}
        try:
            from . import identity_matcher as cam
            r = cam.identify_crop_search(bgr, box, group, subset_ids=subset, search=2, topk=8)
        except Exception:
            return None
        if not r or not r.get("id"):
            return None
        return {"id": r["id"], "score": round(float(r.get("score", 0.0)), 3),
                "margin": round(float(r.get("margin", 0.0)), 3)}

    def _decide_centrally(self, bgr, header, layout, profile, out) -> None:
        """The expanded panel decided by the central Select-a-Ghost picker (packages/icon-matcher
        ghost_panel, the same picker as the Web scanner and Android; CENTRAL_RECOGNITION section 8).
        LiveTrial is the ROI Searcher: HDMI, fixed positions from the Clean Assets panel geometry;
        the three-lap panel is colour-corrected first, as in the other products. The per-field
        reads above stay as the previous decision (``legacy``)."""
        if self._picker is None:
            self._picker = _picker_modules(self.shared_candidate.api) or False
        if not self._picker:
            return
        picker, photometric, photometry = self._picker
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        residual, image = None, bgr
        if profile == "3lap":
            # Measure the panel's constant elements where the photometry defines them (the
            # canonical panel), then apply that per-channel correction to the HDMI frame.
            canonical = cv2.warpAffine(rgb, HDMI_FROM_PANEL_CANONICAL, (rgb.shape[1], rgb.shape[0]),
                                       flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                                       borderMode=cv2.BORDER_REPLICATE)
            _, record = photometric.correct_panel(canonical, photometry)
            residual = record.get("residual")
            if record.get("status") != "corrected":
                # The expanded panel's constant elements are not there (a collapsed panel the
                # layout probe took for expanded: residual about 63 against 2-14 on real HDMI
                # panels); keep the previous decision rather than read parts that are absent.
                return
            image = cv2.cvtColor(photometric.apply_correction(rgb, record), cv2.COLOR_RGB2BGR)
        boxes = {"character": _box(header["character"]), "flag": _box(header["flag"]),
                 **{kind: _box(layout["icons"]["cells"][kind]) for kind in ("body", "tire", "glider")}}
        texts = {field: (out.get(field) or {}).get("nameRaw")
                 or self._text(bgr, _box(layout["partNames"]["cells"][field])) or None
                 for field in ("body", "tire", "glider")}
        self._apply_picker(picker, image, residual, boxes, texts, out)

    def _apply_picker(self, picker, image, residual, boxes, texts, out) -> None:
        """One frame-description-v1 to the central picker; its decision replaces the fields."""
        fields = []
        for field in ("character", "body", "tire", "glider", "flag"):
            if field not in boxes:
                continue
            item = {"field": field, "slot": list(boxes[field])}
            if field in ("body", "tire", "glider"):
                item["context"] = {"printedText": texts.get(field)}
            fields.append(item)
        description = {"schema": "mk8dx.frame-description.v1", "frame": "timetrial_ghost_select",
                       "console": "unknown", "source": "hdmi",
                       "image": {"width": int(image.shape[1]), "height": int(image.shape[0])},
                       "residual": None if residual is None else float(residual), "locale": "en-GB",
                       "fields": fields}
        try:
            decision = picker.decide_ghost_select_frame(description, image, self.shared_candidate.matcher)
        except Exception:
            return
        for decided in decision["fields"]:
            field = decided["field"]
            legacy = out.get(field)
            alternatives = decided["alternatives"]
            out[field] = {"id": decided["acceptedId"], "selectedId": decided["selectedId"],
                          "reviewRequired": decided["acceptedId"] is None,
                          "score": round(float(decided["score"]), 3),
                          "margin": round(float((decided.get("evidence") or {}).get("margin", 0.0)), 3),
                          "status": decided["basis"], "decision": decision["decisionVersion"],
                          "rankedCandidates": [{"id": item["id"], "score": item["score"]} for item in alternatives],
                          **({"nameRaw": legacy["nameRaw"]} if legacy and legacy.get("nameRaw") else {}),
                          "legacy": {key: (legacy or {}).get(key) for key in ("id", "selectedId", "status")}}
        out["panelDecision"] = {"decision": decision["decisionVersion"], "reliableColour": decision["reliableColour"],
                                "residual": residual}

    def read(self, bgr: np.ndarray, *, identity: bool = True) -> dict | None:
        """None when no ghost panel is on screen. Otherwise the panel as shown:
        state 'collapsed' (header only) or 'expanded' (laps + parts too).

        The total in the header is the gate: every panel prints it, nothing
        else on the ghost menu decodes to d:dd.ddd at that spot."""
        if bgr is None or bgr.shape[:2] != (720, 1280):
            return None
        header = self.panel["header"]
        # the searcher's presence probe: a ghost panel prints a total exactly here
        if time_to_ms(read_digits(bgr, _box(header["totalTime"]))) is None:
            return None
        profile = _layout_profile(bgr, self.panel, wide_edge_probe=self.wide_edge_probe)
        layout = self.panel["layouts"][profile] if profile else None
        lap_count = layout["lapCount"] if layout else 3
        times = self._times.read(bgr, lap_count, (profile, read_digits(bgr, _box(header["totalTime"]))))
        if times is None:
            return None   # no central matcher: the panel's times are unknown
        total = times.get("ghost_total")
        total_ms = time_to_ms(total)
        if total_ms is None:
            return None
        laps = [times.get(f"ghost_lap_{i}") for i in range(1, lap_count + 1)] if layout else []
        lap_ms = [time_to_ms(t) for t in laps]
        out = {"state": "expanded" if layout else "collapsed",
               "total": total, "totalMs": total_ms}
        if layout:
            out["lapTimes"] = laps
            out["lapTimesMs"] = lap_ms
            out["lapSumOk"] = _central_lap_sum_ok(total, [lap or "" for lap in laps])
        if not identity:
            return out
        flag = self._icon(bgr, _box(header["flag"]), "flags", screen=out["state"])
        # the flag first: it hints the script of a name the console-language reader cannot read
        out["name"] = self._name(bgr, _box(header["name"]), (flag or {}).get("id") or (flag or {}).get("selectedId")) or None
        out["character"] = self._icon(bgr, _box(header["character"]), "characters",
                                      screen=out["state"])
        out["flag"] = flag
        track_box = _box(self.panel["trackName"]["roi"])
        out["trackNameRaw"] = re.sub(r"\s*'\s*", "'", self._text(bgr, track_box)) or None
        if layout:
            char_id = (out.get("character") or {}).get("id")
            for kind, group in (("body", "bodies"), ("tire", "tires"), ("glider", "gliders")):
                subset = None
                if char_id and group != "tires":
                    try:
                        from . import identity_matcher as cam
                        subset = cam.parts_subset_for_character(char_id, group)
                    except Exception:
                        subset = None
                character = None
                if self.shared_candidate is not None:
                    refs = self.shared_candidate.matcher.references
                    character = self.shared_candidate.api.Decision(
                        char_id, refs.family.get(char_id),
                        "accepted" if char_id else "unknown", (), char_id)
                text = self._part_from_text(
                    self._text(bgr, _box(layout["partNames"]["cells"][kind])), group)
                if self.shared_candidate is not None:
                    # The central reader decides with the printed name as its text
                    # clue and the character's catalog colour (combine_part), the
                    # same rules as on result cards in every product.
                    icon = self._icon(bgr, _box(layout["icons"]["cells"][kind]), group,
                                      subset, screen=out["state"], character=character, text=text)
                    out[kind] = dict(icon, nameRaw=text["raw"]) if icon and text else icon
                else:
                    icon = self._icon(bgr, _box(layout["icons"]["cells"][kind]), group,
                                      subset, screen=out["state"], character=character)
                    out[kind] = _colour_for_character(_agree(icon, text), subset)
        # A collapsed panel keeps the central field reader per field (field_reader.read_field, the
        # ghost_select profile): the panel picker needs the expanded panel's colour fit, and without
        # it (shape-backed) it refused 17 right HDMI characters on staff76 (2026-10-31).
        if layout and self.shared_candidate is not None:
            self._decide_centrally(bgr, header, layout, profile, out)
        return out


# The Web scanner's registered Select-a-Ghost panel (the canonical the central picker and the
# panel photometry were measured on) is the HDMI panel scaled by about 1.015 and moved left and
# up. Canonical -> HDMI 1280x720, median of ten staff192 HDMI captures (ECC 0.995-0.998; spread
# under 1 px in x, about 1.5 px in y). The fixed-position searcher strategy for HDMI (section 8.2).
HDMI_FROM_PANEL_CANONICAL = np.float32([[0.985, -0.004, 280.6], [0.003, 0.984, 21.9]])


def _picker_modules(api):
    """The central Select-a-Ghost picker and the panel colour correction of the staged
    shared field package, or None when that package predates them (reader < 0.4.0)."""
    try:
        picker = __import__(api.__name__ + ".ghost_panel", fromlist=["decide_ghost_select_frame"])
        photometric = __import__(api.__name__ + ".panel_photometric", fromlist=["correct_panel"])
    except ImportError:
        return None
    if not hasattr(picker, "decide_ghost_select_frame"):
        return None
    return picker, photometric, photometric.PanelPhotometry.load()


def _family(rid: str | None) -> str | None:
    if not rid:
        return None
    parts = rid.split(".")
    if parts[0].endswith("_variant") and len(parts) >= 2:
        return parts[0].replace("_variant", "") + "." + parts[1]
    return rid


def _agree(icon: dict | None, text: dict | None) -> dict | None:
    """The panel prints the part's NAME beside its icon: two independent reads.
    The name is exact once it matches (and names no colour), the icon carries
    the colour variant. Agreement keeps the icon id (variant) and says so."""
    if not icon and not text:
        return None
    if icon and text and _family(icon["id"]) == _family(text["id"]):
        return dict(icon, nameRaw=text["raw"], nameConfirms=True)
    if text and text["ratio"] >= 0.8:
        return {"id": text["id"], "nameRaw": text["raw"], "ratio": text["ratio"],
                **({"iconId": icon["id"], "iconScore": icon["score"]} if icon else {})}
    return dict(icon or {}, **({"nameRaw": text["raw"]} if text else {}))


def _colour_for_character(part: dict | None, subset: list | None) -> dict | None:
    """The part in the colour the game gives THIS character. The printed name
    fixes which body or glider it is but not its colour, and the small icon
    loses the colour vote to lookalikes (owner 2026-09-28: Races as they come
    in showed Buggybud and gliders in the wrong colour). The character's own
    colour set (identity_matcher.parts_subset_for_character, what the result-
    card reader uses) holds exactly one entry per base part: its variant, or
    the base part when that character has no special colour."""
    if not part or not part.get("id") or not subset:
        return part
    family = _family(part["id"])
    coloured = next((pid for pid in subset if _family(pid) == family), None)
    if coloured is None or coloured == part["id"]:
        return part
    return dict(part, id=coloured, readId=part["id"], colourFrom="character")


def mark_staff_ghost(tdb, panel: dict | None, track_id: str | None, cc) -> dict | None:
    """Only the TIME can prove a Nintendo staff ghost (a player may call
    themselves anything, including one letter away from 'Nin★Sho'): when the
    track, cc and total equal a database staff time exactly, the name becomes
    the canonical staff name (the OCR drops the star) and the panel says so."""
    if not panel or not track_id or cc is None:
        return panel
    for rec in tdb.db["collections"].get("nintendoStaffTimes", []) or []:
        if rec.get("trackId") == track_id and str(rec.get("mode")) == str(cc) \
                and rec.get("timeMs") == panel.get("totalMs"):
            out = dict(panel, staffGhost=True, nameRaw=panel.get("name"),
                       name=rec.get("playerName") or panel.get("name"))
            return out
    return panel


def mark_world_record(tdb, panel: dict | None, track_id: str | None, cc) -> dict | None:
    """A total equal to the database world record for this track + cc. Not a
    proof of who drove it — a hint that the Player must confirm twice (ADR-0210)."""
    if not panel or not track_id or cc is None:
        return panel
    for rec in tdb.db["collections"].get("worldRecords", []) or []:
        if rec.get("trackId") == track_id and str(rec.get("mode")) == str(cc) \
                and rec.get("timeMs") == panel.get("totalMs"):
            return dict(panel, worldRecord=True)
    return panel


def same_ghost(a: dict | None, b: dict | None) -> bool:
    """Two panel reads of the same ghost: same total, and the name agrees when
    both have one (two ghosts with an identical total are possible)."""
    if not a or not b or a.get("totalMs") != b.get("totalMs"):
        return False
    na, nb = (a.get("name") or "").lower(), (b.get("name") or "").lower()
    return not na or not nb or difflib.SequenceMatcher(None, na, nb).ratio() >= 0.7


def merge_panel(best: dict | None, new: dict | None) -> dict | None:
    """Keep the most complete read of one ghost: an expanded read beats a
    collapsed one; a new ghost replaces the old one outright."""
    if new is None:
        return best
    if best is None or not same_ghost(best, new):
        return dict(new)
    out = dict(best)
    if new.get("state") == "expanded" and (best.get("state") != "expanded" or
                                           new.get("lapSumOk") and not best.get("lapSumOk")):
        for k in ("state", "lapTimes", "lapTimesMs", "lapSumOk", "body", "tire", "glider"):
            if k in new:
                out[k] = new[k]
    for k in ("name", "character", "flag", "trackNameRaw"):
        if not out.get(k) and new.get(k):
            out[k] = new[k]
    out["reads"] = int(best.get("reads", 1)) + 1
    return out


# --- ghost-menu screens ---------------------------------------------------------
REPLAY_ROWS = ("continue_replay", "replay_from_start", "race_against_ghost", "quit_replay")
START_REPLAY_TITLE_ROWS = 45   # the "Start Replay?" title inside template 083


class GhostMenuScreens:
    """Names the ghost-menu screens from the 075-084 templates.

    The replay menu shows four rows; each has a selected and a not-selected
    template, so the highlighted row is the one whose *selected* template beats
    its *not-selected* one. The "Start Replay?" prompt (083) shares its big OK
    button with "Start Time Trial?" (race against a ghost), so the prompt is
    only accepted when the title text itself matches as well."""

    def __init__(self, tdb):
        self.tdb = tdb
        self.available = all(f"{T}ghost_replay_{r}_selected" in tdb.templates for r in REPLAY_ROWS) \
            and f"{T}ghost_replay_start_replay_selected" in tdb.templates
        # one title cut per language variant, made when that language is consulted
        self._titles: dict = {}

    def _title_score(self, frame):
        """Best title-only score over the consulted languages; None = no title cut."""
        rid = f"{T}ghost_replay_start_replay_selected"
        scores = []
        for full in self.tdb.variants(rid):
            if full.id not in self._titles:
                self._titles[full.id] = self._title_template(full)
            title = self._titles[full.id]
            if title is None:
                return None
            scores.append(title.corr(frame, 2))
        return max(scores, default=None)

    def _title_template(self, full):
        """Template 083 cut down to its title rows ("Start Replay?")."""
        rid = f"{T}ghost_replay_start_replay_selected"
        rec = next((r for r in self.tdb.db["collections"]["hudTemplates"] if r["id"] == rid), None)
        if rec is None:
            return None
        from .templates import Template, _imread_rgba
        by_lang = (rec.get("assets", {}).get("template", {}).get("byLanguage") or {})
        lang = full.id.split(":")[-1] if ":" in full.id else "en"
        path = (by_lang.get(lang) or {}).get("path")
        if not path:
            return None
        img = np.asarray(_imread_rgba(self.tdb.root / path))
        ys, xs = np.where(img[:START_REPLAY_TITLE_ROWS, :, 3] > 128)
        if len(ys) < 50:
            return None
        sub = Template.__new__(Template)
        sub.__dict__ = dict(full.__dict__)
        sub.ys, sub.xs = ys, xs
        px = img[ys, xs, :3].astype(np.float32).flatten()
        px -= px.mean()
        sub.pixels = px / max(np.linalg.norm(px), 1e-6)
        return sub

    def corr(self, frame, slug, search=1) -> float:
        return self.tdb.corr(frame, T + "ghost_replay_" + slug, search)

    def replay_menu(self, frame, thr=0.8) -> str | None:
        """The highlighted replay-menu row, or None when the menu is not up."""
        if not self.available:
            return None
        best, best_c = None, 0.0
        for row in REPLAY_ROWS:
            sel = self.corr(frame, row + "_selected")
            if sel >= thr and sel > best_c:
                not_sel = self.corr(frame, row + "_not_selected")
                if sel > not_sel:
                    best, best_c = row, sel
        return best

    # Measured on 2026-09-28 08-28-57.mp4: the real "Start Replay?" prompts
    # score 0.985 on the full template and 0.60-0.62 on the title alone (the
    # title sits on a translucent band, so the menu behind it moves the score);
    # "Start Time Trial?" scores 0.79-0.92 on the full template but 0.00-0.11
    # on the title. 0.40 sits in the middle of that gap.
    def start_replay_prompt(self, frame, thr=0.8, title_thr=0.4) -> bool:
        if not self.available or self.corr(frame, "start_replay_selected") < thr:
            return False
        title = self._title_score(frame)
        return title is None or title >= title_thr

    def view_ghost_selected(self, frame, thr=0.8) -> bool:
        return self.available and self.corr(frame, "view_ghost_selected") >= thr


# --- detected ghosts (ADR-0210) --------------------------------------------------
DETECTED_GHOSTS_FORMAT = "mk8dx.detected-ghosts.v1"
# A replay's lap crossing must land this close to the panel's cumulative lap
# times for its per-lap coins and mushrooms to be trusted (the lap counter is
# read a few frames after the line; measured 10-50 ms on the owner's capture).
REPLAY_LAP_AGREEMENT_MS = 500


def replay_finish_ms(run: dict, total_ms: int | None) -> int | None:
    """When a ghost replay FINISHED, or None. A replay shows no banner and no
    result screen; at the line the race clock top right freezes on the ghost's
    total (owner, 2026-09-28). A clock sample equal to the panel total to the
    millisecond is therefore the proof — two unrelated reads of one number."""
    if not total_ms:
        return None
    for rel, value in run.get("_clockSamples") or []:
        if value == total_ms:
            return int(total_ms)
    return None


def replay_summary(run: dict, panel: dict | None, finish_ms: int | None) -> dict:
    """What one replay loop shows, on the game clock (`race` stamps). Per lap:
    coins gained (as mkwrs counts `coinCountsPerLap`), the coin balance at the
    line, mushrooms used; plus every coin change and mushroom use in race time.
    Only a finished loop whose lap crossings agree with the panel's laps is
    `usable` — anything else is kept for provenance, never for the numbers."""
    events = run.get("events") or []
    lap_count = int(run.get("lapCount") or 3)
    crossings = sorted(int(e.get("race", e.get("t", 0))) for e in events if e.get("type") == "lap")
    lap_times = (panel or {}).get("lapTimesMs") if (panel or {}).get("lapSumOk") else None
    agrees = None
    if lap_times and len(lap_times) == lap_count:
        expected, acc = [], 0
        for v in lap_times[:-1]:
            acc += v
            expected.append(acc)
        agrees = len(crossings) == len(expected) and all(
            abs(a - b) <= REPLAY_LAP_AGREEMENT_MS for a, b in zip(crossings, expected))
        boundaries = expected
    else:
        boundaries = crossings[:lap_count - 1]

    def lap_of(race_ms: int) -> int:
        return 1 + sum(1 for b in boundaries if race_ms >= b)

    coin_events, mushroom_events = [], []
    gained = [0] * lap_count
    balance = [None] * lap_count
    used = [0] * lap_count
    for e in events:
        race = int(e.get("race", e.get("t", 0)))
        if finish_ms is not None and race > finish_ms:
            continue
        lap = min(lap_of(race), lap_count)
        if e.get("type") == "coin":
            coin_events.append({"raceMs": race, "lap": lap, "from": e.get("from"), "to": e.get("to")})
            gained[lap - 1] += max(0, int(e.get("to") or 0) - int(e.get("from") or 0))
        elif str(e.get("type", "")).startswith("mushroom_use_"):
            mushroom_events.append({"raceMs": race, "lap": lap})
            used[lap - 1] += 1
    running = 0
    for lap in range(lap_count):
        for c in coin_events:
            if c["lap"] == lap + 1:
                running = int(c["to"] or 0)
        balance[lap] = running
    return {
        "loop": run.get("replayLoop", 1),
        "finished": finish_ms is not None,
        "finishRaceMs": finish_ms,
        "lapCrossingsRaceMs": crossings,
        "lapsAgreeWithPanel": agrees,
        "usable": bool(finish_ms is not None and agrees),
        "coinCountsPerLap": gained,
        "coinBalanceAtLapEnd": balance,
        "mushroomsPerLap": used,
        "events": {"status": "available", "timeBase": "race_elapsed_ms",
                   "coinEvents": coin_events, "mushroomEvents": mushroom_events},
    }


def _norm_name(name: str | None) -> str:
    return re.sub(r"[^0-9a-z]", "", (name or "").lower())


def ghost_matches(rec: dict | None, g: dict | None) -> bool:
    """One ghost, however it was read: the same cc and total, the same track
    when both know it, and names that agree when both have one."""
    if not rec or not g:
        return False
    if str(rec.get("cc")) != str(g.get("cc")) or rec.get("totalMs") != g.get("totalMs"):
        return False
    if rec.get("trackId") and g.get("trackId") and rec["trackId"] != g["trackId"]:
        return False
    a, b = _norm_name(rec.get("name")), _norm_name(g.get("name"))
    return not (a and b and difflib.SequenceMatcher(None, a, b).ratio() < 0.7)


class GhostRecords:
    """One record per ghost, however often it is seen (ADR-0210 rule 2): the
    same track + cc + total + name, collapsed or expanded, in replay loops. The
    record keeps the fullest data — laps and parts only from an expanded panel
    whose laps close on the total, replay numbers only from a finished loop
    whose crossings agree with those laps. It never names an owner."""

    def __init__(self):
        self.records: list[dict] = []
        self.version = 0

    def _find(self, g: dict) -> dict | None:
        for rec in self.records:
            if ghost_matches(rec, g):
                return rec
        return None

    def note_panel(self, panel: dict, ms: int, wall_ms: int) -> dict | None:
        if not panel or panel.get("totalMs") is None or panel.get("cc") is None:
            return None
        rec = self._find(panel)
        if rec is None:
            rec = {"key": f"ghost-{len(self.records) + 1:03d}", "cc": str(panel["cc"]),
                   "totalMs": panel["totalMs"], "total": panel.get("total"),
                   "state": "collapsed", "sightings": 0,
                   "firstSeenMs": ms, "firstSeenAtMs": wall_ms, "replays": []}
            self.records.append(rec)
        rec["sightings"] += 1
        rec["lastSeenMs"], rec["lastSeenAtMs"] = ms, wall_ms
        for k in ("trackId", "name", "nameRaw", "staffGhost", "worldRecord"):
            if panel.get(k) and not rec.get(k):
                rec[k] = panel[k]
        if panel.get("staffGhost"):          # the canonical staff name wins
            rec["name"], rec["staffGhost"] = panel.get("name"), True
        for k, src in (("characterId", "character"), ("countryId", "flag")):
            if (panel.get(src) or {}).get("id") and not rec.get(k):
                rec[k] = panel[src]["id"]
        if panel.get("state") == "expanded" and panel.get("lapSumOk") and not rec.get("lapSumOk"):
            rec["state"] = "expanded"
            rec["lapTimes"], rec["lapTimesMs"], rec["lapSumOk"] = (
                panel.get("lapTimes"), panel.get("lapTimesMs"), True)
            for k in ("body", "tire", "glider"):
                part = panel.get(k) or {}
                if part.get("id"):
                    rec[f"{k}Id"] = part["id"]
                    rec[f"{k}NameConfirmed"] = bool(part.get("nameConfirms") or part.get("ratio", 0) >= 0.8)
        self.version += 1
        return rec

    def note_replay(self, run: dict, panel: dict | None, ms: int, wall_ms: int,
                    finish_ms: int | None = None) -> dict | None:
        """A replay loop of the ghost `panel` described (run['replayOf']).
        `finish_ms` comes from replay_finish_ms, taken BEFORE the run's clock
        samples are consumed by the race-time stamping."""
        rec = self._find(panel) if panel else None
        if rec is None:
            if not panel:
                return None
            rec = self.note_panel(panel, ms, wall_ms)
            if rec is None:
                return None
        summary = replay_summary(run, rec, finish_ms)
        rec["replays"].append({k: summary[k] for k in (
            "loop", "finished", "finishRaceMs", "lapsAgreeWithPanel", "usable")})
        if summary["usable"]:
            keep = {k: summary[k] for k in ("coinCountsPerLap", "coinBalanceAtLapEnd",
                                            "mushroomsPerLap", "events", "lapCrossingsRaceMs")}
            prev = rec.get("replay")
            if prev is None:
                rec["replay"] = keep
            elif (prev["coinCountsPerLap"], prev["mushroomsPerLap"]) != (
                    keep["coinCountsPerLap"], keep["mushroomsPerLap"]):
                # a ghost is fixed data: two finished loops that disagree mean
                # one read is wrong — say so, never overwrite
                rec["replayConflict"] = {"a": prev["coinCountsPerLap"], "b": keep["coinCountsPerLap"],
                                         "mushroomsA": prev["mushroomsPerLap"],
                                         "mushroomsB": keep["mushroomsPerLap"]}
        rec["lastSeenMs"], rec["lastSeenAtMs"] = ms, wall_ms
        self.version += 1
        return rec

    def note_clip(self, g: dict, clip_name: str, go_at_ms: int | None, ms: int,
                  wall_ms: int) -> dict | None:
        """The ghost's replay was kept as `clip_name` (a file beside ghosts.json).
        `go_at_ms` is the replay's GO on the session clock, so the desktop app
        can place the laps in the clip through its timeline."""
        rec = self._find(g) or self.note_panel(g, ms, wall_ms)
        if rec is None:
            return None
        rec["clip"] = clip_name
        if go_at_ms is not None:
            rec["clipGoAtMs"] = int(go_at_ms)
        self.version += 1
        return rec

    def document(self, source: str) -> dict:
        return {"format": DETECTED_GHOSTS_FORMAT, "source": source,
                "ghosts": [dict(r) for r in self.records]}


_LAP_TEXT = re.compile(r"^(\d{1,2}):(\d{2})\.(\d{3})$")


def replay_hud_lap_times(run: dict, total_ms: int | None) -> list[int] | None:
    """A finished replay's lap times from its own HUD, for when the panel gave
    none (a collapsed panel; the seven-lap panel is not read yet). The frozen
    clock after each line shows that lap's time (`lapTime` events, read by
    hudtimes); the last lap has no such freeze, so it is the total minus the
    others. All earlier laps must have been read, and the last one must be a
    plausible lap (between half and twice the others' average), or None: a
    lap time is never guessed. Owner capture 2026-09-29: Cloudtop Cruise's HUD
    laps equal its panel laps to the millisecond."""
    lap_count = int(run.get("lapCount") or 0)
    if not total_ms or lap_count < 2:
        return None
    read: dict[int, int] = {}
    for e in run.get("events") or []:
        if e.get("type") != "lapTime" or not isinstance(e.get("lap"), int):
            continue
        m = _LAP_TEXT.match(str(e.get("text") or "").strip())
        if m:
            read.setdefault(e["lap"], int(m.group(1)) * 60_000 + int(m.group(2)) * 1000 + int(m.group(3)))
    earlier = [read.get(n) for n in range(1, lap_count)]
    if any(v is None or v <= 0 for v in earlier):
        return None
    last = int(total_ms) - sum(earlier)
    average = sum(earlier) / len(earlier)
    if not (0.5 * average <= last <= 2 * average):
        return None
    return earlier + [last]


# --- ghost-replay clips (owner 2026-09-29) -----------------------------------
# A clip of a ghost replay runs from that ghost's panel to the end of its
# replay, once per ghost. Browsing the ghost menu never records anything.
# No lead-in before the chosen ghost's panel: on the owner's capture a 2 s lead
# opened BAwSer's clip on Nin★Leonel, the ghost browsed just before it.
GHOST_CLIP_LEAD_MS = 0
GHOST_CLIP_PANEL_HOLD_FRAMES = 30    # 2 s of the panel snapshot at the ring's ~15 fps
GHOST_CLIP_MAX_PREROLL_MS = 15000    # the pre-roll ring holds ~15 s
GHOST_CLIP_TAIL_MS = 3000            # the frozen clock after the line
GHOST_CLIP_PROMPT_TIMEOUT_MS = 45000 # "Start Replay?" to the replay's countdown
GHOST_CLIP_FINISH_CHECK_MS = 250


class GhostClipPlanner:
    """Decides when a ghost replay becomes a clip.

    - A clip STARTS only when "Start Replay?" is on screen for a ghost that has
      no clip yet, with the pre-roll trimmed to when that ghost's panel came up,
      so looking through ghosts is not recorded. When the panel is older than
      the ring, watch.py opens the clip on a snapshot of it instead.
    - It is KEPT only when the replay's first loop reaches the line: the race
      clock freezes on the ghost's total (replay_finish_ms). Backing out of the
      prompt, quitting the replay early, racing instead, or the session ending
      first discards it; nothing half-watched is left behind.
    - Once per ghost: later loops and later replays of a ghost that has a clip
      (this session or an earlier one, `clipped`) are not recorded.

    `step` returns ("start", ghost, preroll_from_ms), ("keep", ghost, run),
    ("discard", ghost, reason) or None; watch.py does the recording.
    """

    def __init__(self, clipped: list[dict] | tuple = ()):
        self.clipped = [dict(g) for g in clipped]
        self.active: dict | None = None
        self._seen_prompt = None
        self._checked = None

    def is_clipped(self, ghost: dict | None) -> bool:
        return any(ghost_matches(c, ghost) for c in self.clipped)

    def step(self, ms: int, pending: dict | None, run: dict | None, *,
             recording: bool = False, enabled: bool = True):
        a = self.active
        if a is None:
            if not pending or pending.get("ms") == self._seen_prompt:
                return None
            self._seen_prompt = pending.get("ms")
            ghost = pending.get("ghost") or {}
            if not enabled or recording or ghost.get("totalMs") is None or self.is_clipped(ghost):
                return None
            start = pending["ms"] - GHOST_CLIP_MAX_PREROLL_MS
            since = pending.get("panelSinceMs")
            if isinstance(since, int):
                start = max(start, since - GHOST_CLIP_LEAD_MS)
            self.active = {"ghost": dict(ghost), "promptMs": pending["ms"],
                           "phase": "prompt", "finishMs": None}
            self._checked = None
            return ("start", self.active["ghost"], min(start, pending["ms"]))
        ghost = a["ghost"]
        first_loop = bool(run) and run.get("kind") == "replay" \
            and int(run.get("replayLoop") or 0) == 1 and same_ghost(run.get("replayOf"), ghost)
        if a["phase"] == "prompt":
            if first_loop:
                a["phase"] = "replay"
            elif pending and same_ghost(pending.get("ghost"), ghost):
                if ms - a["promptMs"] > GHOST_CLIP_PROMPT_TIMEOUT_MS:
                    return self._drop("no_replay")
                return None
            else:
                return self._drop("cancelled")
        if a["finishMs"] is None:
            if not first_loop:
                return self._drop("not_finished")
            if self._checked is None or ms - self._checked >= GHOST_CLIP_FINISH_CHECK_MS:
                self._checked = ms
                if replay_finish_ms(run, ghost.get("totalMs")) is not None:
                    a["finishMs"], a["goAtMs"] = ms, run.get("goAtMs")
            return None
        if ms - a["finishMs"] >= GHOST_CLIP_TAIL_MS:
            self.active = None
            self.clipped.append(ghost)
            return ("keep", ghost, {"goAtMs": a.get("goAtMs")})
        return None

    def finish(self):
        """The session ends: a ghost clip that did not reach the line is not kept."""
        if self.active is None:
            return None
        if self.active["finishMs"] is not None:
            ghost, go = self.active["ghost"], self.active.get("goAtMs")
            self.active = None
            self.clipped.append(ghost)
            return ("keep", ghost, {"goAtMs": go})
        return self._drop("session_end")

    def _drop(self, reason: str):
        ghost, self.active = self.active["ghost"], None
        return ("discard", ghost, reason)
