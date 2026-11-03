"""Loadout identity reading: character / body / tire / glider / flag per owner.

Built on the existing Python matcher (`scripts/clean_assets_matcher.py`,
imported read-only; references derive ONLY from the MK8DX Clean Assets
database — MK8_CLEAN_ASSETS_ROOT is pointed at the repo copy), extended with
the APK's parity-winning rules that apply to clean frames:

- owner-by-fill: the yellow card is the player wherever it sits; the ghost
  card is found at the grid-anchor delta above or below it (edge-NCC decides)
- character-conditioned variant resolution (color follows the character)
- saturation restore for dimmed ghost avatars (sat x min(2, 90/meanSat) when
  meanSat < 80) before matching
- name-strip is authoritative for the player character (the yellow card shows
  the character NAME; fuzzy >= 0.78 accepts the override)
- phantom-ghost rule: no ghost card evidence -> no ghost identity
"""

from __future__ import annotations

import difflib
import importlib
import json
import os
import re
import sys
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"

os.environ.setdefault("MK8_CLEAN_ASSETS_ROOT", str(REPO_ROOT / "MK8DX Clean Assets"))

from . import identity_matcher as cam  # noqa: E402

KINDS = ("character", "kart", "wheel", "glider", "flag")
_GRID = json.loads((CONFIG_DIR / "new_relative_grid_combined.json").read_text(encoding="utf-8"))


# Colour variants of one character differ only where the ink is; the rest of
# the icon (skin, eyes, clothes) is identical and dominates a whole-icon score.
# Measured on the owner's default Inkling Boy card 2026-09-07: the whole icon
# put cyan 0.012 above the default, while the pixels where the three icons
# differ scored default 26.8 against cyan 42.7 and purple 44.1 (mean L1 on
# 0-255). So when two colours of one character sit within this margin, the
# colour is decided on those pixels alone.
VARIANT_INK_DIFF = 120.0 / 255.0      # summed RGB difference that marks an ink pixel
VARIANT_INK_MIN_PIXELS = 30


_FLAG_GRID = (4, 6)  # rows x cols of the coarse colour-position grid

# Player name strip -> character. See _name_strip_override for why a margin is
# required, and _read_card for why the icon outranks it.
# The icon is the primary read (self-audit: 79/79, 0 cross-base misranks; real
# cards score margin 0.066-0.104). The name strip garbles ~70% of the time
# ('3owser', 'Jeach', 'sahelle'), so it may only overrule an icon that is itself
# undecided — well below every margin observed on a real card.
NAME_OVERRIDE_MAX_ICON_MARGIN = 0.04
# Colour variants print the colour in the player's name strip. When the icon and
# text agree on the base character family, a strong strip read is better evidence
# for the variant colour than a near-white/yellow icon margin.
NAME_VARIANT_OVERRIDE_MIN = 0.84


# Calibrated result-card geometry (config/card_grid.json, documented in
# config/CARD_GRID.md). It rides on production's per-frame card localisation
# rather than replacing it: the lap-index probe still finds the card every
# frame — which is what absorbs capture jitter and the 30 px new-ghost shift —
# and only the WITHIN-CARD offsets come from the grid, translated by the
# measured constant between the two card conventions.
#
# Benchmarked over 290 icon slots on 58 real cards (tests/_grid_benchmark.py):
# slots with a cross-base margin under 0.03 fell from 73 to 7, the mean margin
# rose 0.0895 -> 0.1263 and the 10th percentile 0.0097 -> 0.0360. Fixed absolute
# origins (no per-frame localisation) were tried too and are NOT used: they
# score worse than production at the tail because any jitter mis-anchors them.
_GRID_CACHE: dict = {}


def _hdmi_frame_variant() -> dict:
    """The recognition pack's HDMI frame variant (frame-definitions-v1.json ``variants.hdmi``;
    CENTRAL_RECOGNITION section 8.6, phase 5): this engine's calibrated card box and icon slots, kept
    in the one frame definition every product reads. Empty when the file is not staged."""
    if "hdmi" not in _GRID_CACHE:
        variant = {}
        try:
            from .identity_matcher import assets_root
            path = Path(assets_root()).parent / "frame-definitions-v1.json"
            if path.is_file():
                defs = json.loads(path.read_text(encoding="utf-8"))
                if defs.get("schema") == "mk8dx.frame-definitions.v1":
                    variant = (defs.get("variants") or {}).get("hdmi") or {}
        except Exception:
            variant = {}
        _GRID_CACHE["hdmi"] = variant
    return _GRID_CACHE["hdmi"]


def _card_grid() -> dict:
    if "g" not in _GRID_CACHE:
        grid = _hdmi_frame_variant().get("cardGrid")
        if grid is None:
            try:
                grid = json.loads((CONFIG_DIR / "card_grid.json").read_text(encoding="utf-8"))
            except Exception:
                grid = {}
        _GRID_CACHE["g"] = grid
    return _GRID_CACHE["g"]


def _grid_slots(laps: str, slot: str):
    """Within-card slot boxes from the calibrated grid, already translated onto
    the card box identity.py finds. `slot` is 'top' or 'bottom' — the anchor
    differs by ~2 px between them because the grid's bottomDy and production's
    measured card spacing disagree by that much."""
    g = _card_grid()
    mode = "7lap" if laps == "7laps" else "3lap"
    c = (g.get("cards") or {}).get(mode)
    if not c:
        return None
    dx, dy = ((g.get("productionAnchor") or {}).get(mode) or {}).get(slot, (0, 0))
    p = c["icons"]["parts"]
    out = {"character": (c["icons"]["character"]["x"] + dx, c["icons"]["character"]["y"] + dy,
                         c["icons"]["character"]["w"], c["icons"]["character"]["h"]),
           "flag": (c["icons"]["flag"]["x"] + dx, c["icons"]["flag"]["y"] + dy,
                    c["icons"]["flag"]["w"], c["icons"]["flag"]["h"])}
    for i, nm in enumerate(("kart", "wheel", "glider")):
        out[nm] = (p["x"] + dx, p["y0"] + i * p["pitch"] + dy, p["w"], p["h"])
    return out


# Set MK8_CARD_GRID=0 to fall back to the database detection offsets.
USE_CARD_GRID = os.environ.get("MK8_CARD_GRID", "1") not in ("0", "false", "False")

# Console language, most-preferred first. The card prints names in the SWITCH's
# language, and the DB carries 14 locales — so with no hint the vocabulary is
# 668 strings of which 232 sit within the fuzzy gate of a name belonging to a
# DIFFERENT character (`aldeana`/`aldeano`, `bewohner`/`bewohnerin`, the whole
# Birdo colour set). Naming the console language collapses that pool to the ~90
# strings that can actually be on screen.
#
# It is a PREFERENCE, not a filter: an unset or wrong value must not break
# reading, so a confident hit in the preferred locales wins and anything else
# falls back to the full pool. Note this belongs HERE and not at the OCR call —
# measured, adding 'nl' to easyocr alongside 'en' made character-name reads
# WORSE (21/27 -> 18/27), because a second language model competes on the same
# glyphs. Language helps the lookup, not the pixels.
PREFERRED_LOCALES: list[str] = [s.strip() for s in
                                os.environ.get("MK8_LOCALES", "").split(",") if s.strip()]


def set_locales(locales) -> None:
    """Set the console language order (e.g. ['nl-NL', 'en-US'])."""
    global PREFERRED_LOCALES
    PREFERRED_LOCALES = [str(s) for s in (locales or []) if s]


def _anchor_delta(race_key: str) -> float:
    """Vertical distance between the ghost and player card anchors (px)."""
    o = _GRID[race_key]["owners"]
    return float(o["player"]["anchor"]["y"] - o["ghost"]["anchor"]["y"])


def find_player_card(bgr) -> tuple[int, int, int, int] | None:
    """The player card is the saturated yellow rectangle (owner-by-fill)."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (18, 110, 140), (38, 255, 255))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    best = None
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if w < 300 or h < 120:  # the card is a large solid block
            continue
        if best is None or area > best[4]:
            best = (x, y, w, h, area)
    if best is None:
        return None
    x, y, w, h, _ = best
    # sanity: the card is ~682x227 at 720p (7-lap ~682x297). A much larger
    # blob means the yellow mask bled into a bright scene (winner animation)
    # — reject the frame; the multi-frame consensus covers it
    if w > 780 or h > 420 or w < 450 or h < 150:
        return None
    return (x, y, x + w, y + h)


def _saturation_restore(crop: np.ndarray) -> np.ndarray:
    """APK v145 fix: ghost dimming crushes saturation -> colorless lookalikes
    win. Restore adaptively before matching."""
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).astype(np.float32)
    mean_sat = float(hsv[:, :, 1].mean())
    if mean_sat < 80 and mean_sat > 1e-3:
        hsv[:, :, 1] = np.clip(hsv[:, :, 1] * min(2.0, 90.0 / mean_sat), 0, 255)
        return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    return crop


# Diagnostic hook: when the env flag LT_GRID_DEBUG is set, _read_card records the
# exact card box + the five loadout slot boxes it placed, so a tool can project
# the identity grid onto the result screen for visual verification. Empty and
# untouched in normal operation.
_GRID_DEBUG: list = []


class IdentityReader:
    # Fixed capture-card grid (docs/capture_card_grid_templates.md). The card is
    # at a FIXED position; only the physical slot (top/bottom), lap count, and
    # the 30px bottom-text offset vary. The card box is a fixed offset from the
    # player's lap-1 index circle, so identity uses the SAME localisation as the
    # times (the lap-index probe) instead of searching for the yellow card —
    # which leaked into the yellow Baby Park background and misplaced every slot.
    # yp = lap-1 circle top; y1 = yp - HEADER; the 30px offset needs no special
    # case because yp moves with it. x1/x2 and heights are the documented values.
    _CARD_X = (549, 1232)
    # timetrail-box top-left = lap-1 circle top - HEADER. These values are tuned
    # to the probe's matched circle reference (empirically correct); a check vs
    # the hand-labelled COCO ground truth confirmed the card x1/x2, heights and
    # this header already place the nominal card box right. The identity-slot
    # drift that flipped lookalikes (King Boo<->Metal Mario, Monster<->Slim) came
    # NOT from here but from register_card's re-alignment (see _read_card).
    _CARD_HEADER = {3: 78, 7: 59}
    _CARD_HEIGHT = {3: 227, 7: 298}

    # Per-(lap x physical-slot x field) Y calibration (px, added to the nominal
    # deploy slot Y). The capture card renders the top and bottom result cards on
    # slightly different sub-pixel grids, and the 7-lap (Baby Park) card has a
    # taller header, so the DB deploy offsets land a few px off per slot. These
    # optima were measured on the 12 scenario fixtures; baking them (and then
    # trusting the box, see below) lifted player identity 41->45/48 with the
    # times test and reference video unchanged. The physical slot is read from
    # the lap-1 circle y (midpoint 3lap 320, 7lap 258): top above it, bottom
    # below. Flags carry no nudge (they don't shift with lap mode).
    _SLOT_Y_CAL = {
        (3, "top"):    {"character": 0.5, "kart": 0.0, "wheel": 0.0, "glider": 1.0},
        (3, "bottom"): {"character": 2.5, "kart": 2.0, "wheel": 2.0, "glider": 3.0},
        (7, "top"):    {"character": -2.5, "kart": -1.0, "wheel": -1.0, "glider": 0.0},
        (7, "bottom"): {"character": -3.5, "kart": -3.0, "wheel": -3.0, "glider": -2.0},
    }
    _SLOT_MID = {3: 320, 7: 258}

    # Flag box: hand-corrected to 54x36 at offset (388,15) from the timetrail
    # top-left (was 55x38 @ (388,14) in the DB); flags don't shift with lap mode.
    # (Historic note: an earlier Y nudge regressed matching because it was applied
    # ON TOP of the +-2px robust offset-grid + +-3px internal search, so a sub-3px
    # shift only moved that window and flipped near-ties. It works now because the
    # grid is dropped and the internal search cut to +-1px — see _read_card — so
    # the matcher trusts the calibrated box. The residual King Boo/Metal Mario and
    # Monster/Slim/Ancient lookalikes are handled by _char_achromatic_rerank and
    # _tire_disambiguate.)
    _FLAG_BOX = (388.0, 15.0, 54.0, 36.0)

    def __init__(self, easyocr_reader=None, shared_candidate=None):
        self._reader = easyocr_reader
        # Explicit QA route. The ordinary runner never supplies this argument.
        self.shared_candidate = shared_candidate
        self._char_names = None
        self._char_disp = {}
        self._staff = None
        self._staff_rec = None
        from .results import _LapIndexProbe
        self._probe = _LapIndexProbe()

    def _card_box(self, yp, lap_count):
        k = 3 if lap_count == 3 else 7
        card = _hdmi_frame_variant().get("card") or {}
        x1, x2 = card.get("x") or self._CARD_X
        header = (card.get("header") or {}).get(str(k), self._CARD_HEADER[k])
        height = (card.get("height") or {}).get(str(k), self._CARD_HEIGHT[k])
        y1 = int(round(yp - header))
        return (x1, y1, x2, y1 + height)

    # -- name strip (player) ------------------------------------------------
    def _character_names(self, locales=None):
        """lower(name) -> character id. `locales` restricts the vocabulary to
        those console languages; None means every locale in the database."""
        if self._char_names is None:
            db = cam._ensure_loaded()["db"] if "db" in cam._ensure_loaded() else None
            db = db or cam._load_db()
            per: dict[str, dict] = {}
            disp: dict[str, str] = {}
            entries = list(db["collections"]["characters"]) + \
                list(db["relationships"]["characterVariants"])
            for c in entries:
                for loc, nm in c["names"].items():
                    key = nm.lower()
                    # Colour variants of one character carry the SAME name in
                    # every locale the database has ("Inkling Boy" three
                    # times), so the last one written used to win: a plain
                    # "Inkling-jongen" strip resolved to the CYAN variant.
                    # The name names the family; a variant id may only own a
                    # name that no base character owns.
                    prior = per.setdefault(loc, {}).get(key)
                    if prior is not None and not prior.startswith("character_variant."):
                        continue
                    per[loc][key] = c["id"]
                    disp[key] = nm
            self._char_names = per
            self._char_disp = disp
        per = self._char_names
        if not locales:
            out = {}
            for d in per.values():
                out.update(d)
            return out
        out = {}
        for loc in locales:
            out.update(per.get(loc, {}))
        return out

    def is_staff_ghost(self, track_id, cc, total_ms, lap_times_ms=None,
                       loadout=None, tol_ms: int = 0) -> bool:
        """Proof, not resemblance: is this ghost the Nintendo staff ghost?

        Names cannot settle it — a player may call themselves anything,
        including one edit from a staff name — so the record must. Three
        independent facts have to agree, and any one of them missing is a NO:

        1. **Total time** equals the database staff time for this course+cc.
           Exact, `tol_ms=0`: measured on a real 200cc Mario Kart Stadium run
           the ghost card OCR'd 81984 ms and the database holds 81984 ms — the
           same millisecond by two unrelated paths (7-segment decode vs the
           record table).
        2. **Lap times** are present and sum to that total. The staff entries
           carry NO lap splits (world records do; staff records do not), so
           there is nothing to compare them against — what the laps prove is
           that the total is a corroborated read rather than one lone number
           that happened to land on a known value.
        3. **Loadout** matches the staff loadout the database stores for this
           entry (200cc MKS: Gold Mario / Gold Kart / Gold Wheels / Gold
           Glider). Only the fields the caller supplies are checked, so this
           can be skipped on the first read and applied once identity is known.
        """
        if not track_id or total_ms is None:
            return False
        if self._staff_rec is None:
            db = cam._load_db()
            it = db["collections"]["nintendoStaffTimes"]
            items = it["items"] if isinstance(it, dict) and "items" in it else it
            self._staff_rec = {(x.get("trackId"), str(x.get("mode"))): x for x in items}
        rec = self._staff_rec.get((track_id, str(cc)))
        if not rec or rec.get("timeMs") is None:
            return False
        if abs(int(total_ms) - int(rec["timeMs"])) > tol_ms:
            return False
        if lap_times_ms is not None:
            laps = [v for v in lap_times_ms if v is not None]
            if len(laps) != len(lap_times_ms) or not laps:
                return False
            if abs(sum(int(v) for v in laps) - int(total_ms)) > tol_ms:
                return False
        if loadout:
            # Compare by BASE part. A vehicle's COLOUR is a function of the
            # character riding it, not an independent choice, so the database
            # storing `body.sport_bike` while the matcher reports
            # `body_variant.sport_bike.001_orange` is agreement, not conflict.
            # Comparing exact ids here would refuse to canonicalise the name of
            # a genuine staff ghost — the same mistake the splits exporter made.
            from .staffsplits import _base
            want = rec.get("loadout") or {}
            for k, v in loadout.items():
                if v and want.get(k) and _base(v) != _base(want[k]):
                    return False
        return True

    def _staff_names(self):
        """The 31 distinct Nintendo staff-ghost names, from the database."""
        if self._staff is None:
            db = cam._load_db()
            it = db["collections"]["nintendoStaffTimes"]
            items = it["items"] if isinstance(it, dict) and "items" in it else it
            self._staff = sorted({x["playerName"] for x in items if x.get("playerName")})
        return self._staff

    def _staff_name_snap(self, raw: str | None) -> str | None:
        """A ghost name is free text — EXCEPT when it is a staff ghost, and then
        it comes from a closed 31-name set the database already holds.

        The star in 'Nin*Joost' has no stable OCR: across real cards it came
        back as a space, `k`, `^` and `'`. The central printed-name matcher ignores
        every non-letter, so the star simply drops out. Measured 2026-10-30 against the
        31 staff names: the staff reads resolve (Nin Joost, Ninkjoost, Nin^Chris,
        Vin*Chris, Nin'Sophia), while human profile names ('Valerio', 'Ben', 'BEnZor',
        and even 'Joost' or 'Sophia' without the prefix) stay far from a strong match,
        so a human ghost is never rewritten into a staff one.
        """
        if not raw or len(raw) < 4:
            return None
        name_match = self._central_name_match()
        if name_match is None:
            return None
        # the central printed-name matcher over the closed staff list (it ignores the star and
        # every other non-letter, which is exactly the unstable glyph)
        found = name_match.match_name(raw, [(name, name) for name in self._staff_names()])
        return found.name if found.key and found.strong() else None

    def _read_name_strip(self, bgr, card_box) -> str | None:
        """OCR the card's name strip (top row, right of the character icon).
        The player card shows the CHARACTER name; the ghost card shows the other
        player's PROFILE name (e.g. 'Nin*Sophia' for a Nintendo staff ghost).

        The ROI is measured, not estimated. Against the card's own width the
        icon ends at 10%, the name starts at ~10%, the flag begins at 57% and
        the time at 70%. The strip used to be 11%..58%, which was wrong at BOTH
        ends: 11% sliced through the first glyph (so 'Isabelle' OCR'd as
        'sahelle' and every staff ghost's 'Nin*' read as 'Vin*'), and 58% ran
        past the card into the racetrack — the ghost card is translucent, so a
        trackside billboard landed in the crop and 'Nin*Sophia' came back as
        'Vin;~Sophia GOLDENW'. Measured over all 27 end-screen stills, moving to
        9%..50% takes exact player-name reads from 1/27 to 21/27 and trackside
        junk from 1/27 to 0.

        Deliberately NOT thresholded. Binarising was the obvious next step and
        it loses: a mask built from the measured glyph colours (ghost font
        [234,235,230], player font on the yellow card [52,105,102]) scored
        15/27 against raw pixels' 21/27, inventing errors like 'Yashi' and
        'Bawse'. easyocr is a CNN over natural images, so the anti-aliased edges
        a binary image destroys are exactly what it reads. A plain 2x upsample
        is the only preprocessing that pays (fuzzy 0.975 -> 0.978).
        """
        self._last_strip = None
        if self._reader is None:
            return None
        x1, y1, x2, y2 = card_box
        cw = x2 - x1
        strip = bgr[y1 + 2:y1 + 46, x1 + int(cw * 0.09):x1 + int(cw * 0.50)]
        if strip.size == 0:
            return None
        strip = cv2.resize(strip, (strip.shape[1] * 2, strip.shape[0] * 2),
                           interpolation=cv2.INTER_CUBIC)
        self._last_strip = strip
        raw, _confidence = self._strip_text(self._reader, strip)
        return raw

    @staticmethod
    def _strip_text(reader, strip) -> tuple[str | None, float]:
        """The name on a name strip as one reader reads it, with its mean OCR confidence."""
        try:
            res = reader.readtext(strip)
        except Exception:
            return None, 0.0
        if not res:
            return None, 0.0
        # Keep only the leftmost CONTIGUOUS run of detections. The name is
        # anchored at the left; anything beyond a wide gap is scenery showing
        # through the translucent card, never part of the name. This is the
        # belt to the ROI's braces — it holds even if a long profile name
        # forces the crop wider one day.
        boxes = sorted((min(p[0] for p in b), max(p[0] for p in b), t) for b, t, _ in res)
        keep = [boxes[0]]
        for b in boxes[1:]:
            if b[0] - keep[-1][1] > 0.25 * strip.shape[1]:
                break
            keep.append(b)
        raw = " ".join(b[2] for b in keep).strip()
        # the Nintendo star in ghost names ('Nin*Chris') OCRs as ~ / * / #
        # (same lesson as the camera app's 'Nin*Alice' symbol merge)
        raw = re.sub(r"(?<=\w)\s*[~*#=+]\s*(?=\w)", "★", raw)
        texts = {b[2] for b in keep}
        confidences = [float(c) for _box, t, c in res if t in texts]
        confidence = sum(confidences) / len(confidences) if confidences else 0.0
        return (raw if len(raw) >= 2 else None), confidence

    def _reread_ghost_name(self, flag_id: str | None) -> tuple[str | None, str] | None:
        """A ghost's profile name the console-language reader probably did not read (another script):
        the same strip read again in the script of the ghost's country, then the other scripts
        (ghostmenu.FLAG_SCRIPT / SCRIPT_KEYS, the Select-a-Ghost panel's rule); ``(name, script)``."""
        strip = getattr(self, "_last_strip", None)
        if strip is None or self._reader is None:
            return None
        from . import ghostmenu as gm
        text, confidence = self._strip_text(self._reader, strip)
        if not gm.name_looks_unread(text or "", confidence):
            return None
        hint = gm.FLAG_SCRIPT.get(flag_id, "latin") if flag_id else None
        best, script = (text, confidence), None
        for key in ([hint] if hint else []) + [k for k in gm.SCRIPT_KEYS if k != hint]:
            reader = gm._script_reader(key)
            if reader is None:
                continue
            candidate = self._strip_text(reader, strip)
            if candidate[0] and candidate[1] >= best[1] + gm.NAME_REREAD_GAIN:
                best, script = candidate, key
            if not gm.name_looks_unread(best[0] or "", best[1]):
                break
        return (best[0], script) if script else None

    def _name_strip_override(self, raw: str | None) -> tuple[str, float, str] | None:
        """Resolve the player card's name strip to a character.

        The player card shows the CHARACTER name (the ghost card shows the other
        player's profile name), so this is a closed vocabulary — but a large and
        treacherous one: the DB carries every locale, 668 strings, and 232 of
        them sit within the 0.78 gate of a name belonging to a DIFFERENT
        character. Almost all of those are cross-language near-twins where the
        text is nearly identical and the ICON is definitive: `aldeana`/`aldeano`
        (Villager female/male in Spanish), `bewohner`/`bewohnerin` in German,
        and the whole Birdo colour set, where the distinguishing fact is a
        COLOUR the icon reads directly and the text only names.

        So a bare "closest string wins" is not safe here: the central printed-name
        matcher (the scanners' rule) accepts only a strong match whose margin is against
        a differently spelled name, so an ambiguous strip resolves to nothing rather than
        to a coin flip, and the central card decision takes the result as a name clue.

        Returns (character_id, ratio, display_name) — the display name is the
        matched vocabulary entry in its ORIGINAL casing and language, so a card
        rendered in Dutch reports the Dutch spelling rather than an English one.
        """
        if not raw or len(raw) < 3:
            return None
        name_match = self._central_name_match()
        if name_match is None:
            return None

        def best_in(names):
            # the central printed-name matcher (packages/icon-matcher name_match, the scanners'
            # rule): a strong match whose margin is against a differently spelled name
            if not names:
                return None
            vocab = [(f"{cid}#{key}", self._char_disp.get(key, key)) for key, cid in names.items()]
            found = name_match.match_name(raw, vocab)
            if not found.key or not found.strong():
                return None
            return found.key.split("#", 1)[0], found.fuzzy, found.name

        # console language first, whole database as the fallback
        return (best_in(self._character_names(PREFERRED_LOCALES))
                or best_in(self._character_names(None)))

    # -- per-owner loadout ---------------------------------------------------

    def _central_name_match(self):
        """The central name matcher of the loaded central reader, or None without it."""
        if self.shared_candidate is None:
            return None
        return importlib.import_module(self.shared_candidate.api.__name__ + ".name_match")

    def _candidate_field(self, source, box, group, owner, laps, presence="present",
                         character=None):
        field = self.shared_candidate.read(
            source=source, box=box, kind=group, profile="result",
            presence=presence, owner=owner, screen=laps, character=character)
        visual = field["visualRead"] or {}
        return {"id": field["acceptedId"], "selectedId": field["selectedId"],
                "reviewRequired": field["reviewRequired"],
                "score": visual.get("score", 0.0),
                "margin": visual.get("margin", 0.0), "status": field["status"],
                "suggestion": field["suggestion"], "top1Id": field["top1Id"],
                "rankedCandidates": field["rankedCandidates"],
                "rankedFamilies": field["rankedFamilies"],
                "proposedFamilyId": field["proposedFamilyId"],
                "familyMargin": field["familyMargin"],
                "variantMargin": field["variantMargin"]}

    def _decide_card_centrally(self, out, boxes, name_hit) -> None:
        """Let the central result-card decision (packages/icon-matcher
        read_result_card) settle the five fields: the same evidence, printed-name
        context and wheel window as every other product. The per-field reads
        above stay as the ranked lists the report shows."""
        import importlib
        api = self.shared_candidate.api
        read_result_card = importlib.import_module(api.__name__ + ".result_card").read_result_card

        def cut(source, box, pad=0):
            x, y, w, h = (int(round(v)) for v in box)
            x0, y0 = max(0, x - pad), max(0, y - pad)
            return source[y0:y + h + pad, x0:x + w + pad], (x - x0, y - y0, w, h)

        crops = {field: cut(source, box)[0] for field, (source, box) in boxes.items()}
        window = None
        if "wheel" in boxes:
            window = cut(*boxes["wheel"], pad=10)
        clue = api.TextClue(name_hit[0], float(name_hit[1]), 1.0) if name_hit else None
        flag_window = None
        if "flag" in boxes:
            pad = importlib.import_module(api.__name__ + ".flag_window").WINDOW_PAD
            flag_window = cut(*boxes["flag"], pad=pad)
        card = read_result_card(crops, self.shared_candidate.matcher, name_clue=clue, wheel_window=window,
                                flag_window=flag_window)
        names = {}
        for field, current in out.items():
            if isinstance(current, dict):
                for item in current.get("rankedCandidates") or []:
                    names[item["id"]] = item.get("label") or item["id"]
        for field, proposal in card["proposal"]["fields"].items():
            current = out.get(field)
            if not isinstance(current, dict) or proposal["selectedId"] is None:
                continue
            decided = dict(current, id=proposal["acceptedId"], selectedId=proposal["selectedId"],
                           reviewRequired=proposal["reviewRequired"], status=proposal["status"],
                           proposedFamilyId=proposal["proposedFamilyId"],
                           centralEvidence=proposal["evidence"])
            if proposal["acceptedId"] is None:
                label = names.get(proposal["selectedId"], proposal["selectedId"])
                decided["suggestion"] = dict(current.get("suggestion") or {}, id=proposal["selectedId"],
                                             label=f"{label}?")
            else:
                decided.pop("suggestion", None)
            out[field] = decided

    mii_pick = None

    def _mii_pick_decision(self, out, source, box) -> None:
        """The Mii picked on the character select (engine.mii_pick) as ONE extra candidate next to
        the character references on the player card's icon (central open_set.own_face_wins): when
        the picked face beats every character, the character is a Mii - accepted, no size."""
        pick = self.mii_pick
        character = out.get("character")
        if not pick or not isinstance(character, dict):
            return
        api = self.shared_candidate.api
        open_set = importlib.import_module(api.__name__ + ".open_set")
        x, y, w, h = (int(round(v)) for v in box)
        crop = source[max(0, y):y + h, max(0, x):x + w]
        if crop.size == 0:
            return
        top = float(character.get("score") or 0.0)
        won, score = open_set.own_face_wins(self.shared_candidate.matcher, crop, pick["face"], top, "result")
        out["miiPick"] = {"faceScore": round(score, 4), "characterScore": round(top, 4), "won": won,
                          "cell": pick.get("cell")}
        if won:
            out["character"] = dict(character, id=open_set.MII_ID, selectedId=open_set.MII_ID, status="accepted",
                                    reviewRequired=False, score=round(score, 4), source="character_select_mii",
                                    suggestion=None)

    def _read_card(self, bgr, card_box, owner: str, laps: str, *, name_override=True,
                   text_src=None) -> dict:
        x1, y1, x2, y2 = card_box
        # Nominal placement: on the capture card the grid is FIXED (no
        # perspective warp), so the label-calibrated card box + the database
        # deploy offsets already land the slots to ~0.5px. register_card was
        # built for the warped camera/phone path; on this fixed grid its
        # template re-alignment overrides the (now-correct) card box and adds
        # residual (measured net -4 vs nominal on the 12 scenarios), so it is
        # bypassed here.
        reg = {"dx": 0.0, "dy": 0.0, "sx": 1.0, "sy": 1.0, "score": 1.0, "fallback": False}
        cw, ch = (x2 - x1) * reg["sx"], (y2 - y1) * reg["sy"]
        ox, oy = x1 + reg["dx"], y1 + reg["dy"]
        slots = cam.deploy_slot_boxes(laps, cw, ch)
        # override the flag slot with the hand-corrected box (deploy-scaled)
        dw, dh = cam.DEPLOY_CARD[laps]
        fb = self._FLAG_BOX
        slots = dict(slots)
        slots["flag"] = (fb[0] / dw * cw, fb[1] / dh * ch, fb[2] / dw * cw, fb[3] / dh * ch)
        # per-(lap x slot x field) Y calibration: read the physical slot from the
        # lap-1 circle y (y1 = circle_y - header) and nudge each field's box.
        lap = 3 if laps == "3laps" else 7
        circle_y = y1 + self._CARD_HEADER[lap]
        pslot = "top" if circle_y < self._SLOT_MID[lap] else "bottom"
        # The calibrated grid supersedes BOTH the deploy offsets above and the
        # hand-tuned per-field nudges below — it was measured against the frame
        # directly, on both lap modes and both card slots, so those two layers
        # collapse into one set of numbers with a single documented source.
        gslots = _grid_slots(laps, pslot) if USE_CARD_GRID else None
        if gslots:
            slots = gslots
        else:
            cal = self._SLOT_Y_CAL[(lap, pslot)]
            for k, dyk in cal.items():
                bx = slots[k]
                slots[k] = (bx[0], bx[1] + dyk * reg["sy"], bx[2], bx[3])
        if os.environ.get("LT_GRID_DEBUG"):
            _GRID_DEBUG.append({"owner": owner, "cardBox": (int(x1), int(y1), int(x2), int(y2)),
                "slots": {k: (int(ox + slots[k][0]), int(oy + slots[k][1]),
                              int(slots[k][2]), int(slots[k][3]))
                          for k in ("character", "kart", "wheel", "glider", "flag")}})
        work = bgr
        if owner == "ghost":
            work = bgr.copy()
            gx1, gy1 = max(0, int(ox) - 8), max(0, int(oy) - 8)
            gx2, gy2 = min(bgr.shape[1], int(ox + cw) + 8), min(bgr.shape[0], int(oy + ch) + 8)
            work[gy1:gy2, gx1:gx2] = _saturation_restore(bgr[gy1:gy2, gx1:gx2])

        out = {"owner": owner, "cardBox": [int(x1), int(y1), int(x2), int(y2)],
               "registration": {k: round(float(reg[k]), 3) for k in ("dx", "dy", "sx", "sy", "score")}}
        # name strip: player card = character name, ghost card = user name
        # The NAME comes from a sharp single frame, never the median stack:
        # stacking is there to cancel the moving scene behind the translucent
        # card, and it does that for icons — but a median over frames softens
        # anti-aliased glyph edges just enough to cost the OCR a letter
        # (measured: a ghost name read 'Nin*Joost' pristine, 'Vin*Joost'
        # stacked). Icons want the stack, text wants the sharp frame.
        raw_name = self._read_name_strip(text_src if text_src is not None else bgr, card_box)
        out["name"] = raw_name
        out["nameRaw"] = raw_name   # provenance: what the OCR actually saw
        if owner == "ghost" and getattr(self, "_staff_ok", False):
            staff = self._staff_name_snap(raw_name)
            if staff:
                out["name"] = staff
                out["staffGhost"] = True
        # The central reader decides every field (packages/icon-matcher); there is no previous
        # reader to fall back to (removed 2026-10-30): without it, or where it cannot read a
        # field, the field is unknown. Character first: it conditions the body/glider variants.
        central = self.shared_candidate is not None
        cx, cy, cw2, ch2 = slots["character"]
        cbox = (ox + cx, oy + cy, cw2, ch2)
        char = self._candidate_field(work, cbox, "characters", owner, laps) if central else None
        # The player card prints the character name: a second, independent witness the central
        # decision takes as its name clue.
        name_hit = self._name_strip_override(raw_name) if owner == "player" and central else None
        out["character"] = _slim(char) if char else None
        char_id = char.get("id") if char else None
        central_boxes = {"character": (work, cbox)}
        for kind, group in (("kart", "bodies"), ("wheel", "tires"), ("glider", "gliders")):
            sx_, sy_, sw_, sh_ = slots[kind]
            wbox = (ox + sx_, oy + sy_, sw_, sh_)
            r = None
            if central:
                family = self.shared_candidate.matcher.references.family.get(char_id)
                character = self.shared_candidate.api.Decision(
                    char_id, family, "accepted" if char_id else "unknown", (),
                    char.get("top1Id") if char else None)
                r = self._candidate_field(work, wbox, group, owner, laps, character=character)
            out[kind] = _slim(r) if r else None
            central_boxes[kind] = (work, wbox)
        fx, fy, fw, fh = slots["flag"]
        # The flag is read from the PRISTINE frame, never the ghost's saturation-restored `work`
        # (the restore drives an already-saturated flag to the clip ceiling).
        fsrc = bgr
        # no-nationality guard: a profile without a flag leaves the slot as flat card background.
        # This engine measures the slot (mean per-channel spatial std); whether that is a flag is
        # the central slot-presence decision (packages/icon-matcher slot_presence, source "hdmi").
        fy1, fy2 = int(oy + fy + 2), int(oy + fy + fh - 2)
        fx1, fx2 = int(ox + fx + 2), int(ox + fx + fw - 2)
        fcrop = fsrc[fy1:fy2, fx1:fx2]
        flat = True
        if central and fcrop.size:
            presence = importlib.import_module(self.shared_candidate.api.__name__ + ".slot_presence")
            spread = float(np.mean(fcrop.reshape(-1, 3).astype(np.float32).std(axis=0)))
            flat = not presence.slot_present("hdmi", "flag", spread)["present"]
        if flat:
            out["flag"] = None
        else:
            flag = self._candidate_field(fsrc, (ox + fx, oy + fy, fw, fh), "flags", owner, laps) if central else None
            out["flag"] = _slim(flag) if flag else None
            central_boxes["flag"] = (fsrc, (ox + fx, oy + fy, fw, fh))
        if owner == "ghost" and not out.get("staffGhost"):
            # the flag is known now: it hints the script of a name the console-language reader missed
            flag_id = (out.get("flag") or {}).get("id") or (out.get("flag") or {}).get("selectedId")
            reread = self._reread_ghost_name(flag_id)
            if reread:
                out["name"], out["nameScript"] = reread
        if central:
            try:
                self._decide_card_centrally(out, central_boxes, name_hit)
            except Exception as error:
                out["centralDecisionError"] = f"{type(error).__name__}: {error}"[:200]
            if owner == "player":
                self._mii_pick_decision(out, work, cbox)
            # The card literally prints the character name: once the central decision settled the
            # character, the canonical spelling replaces the garbled OCR string.
            decided = out.get("character") or {}
            if name_hit and name_hit[0] in (decided.get("id"), decided.get("selectedId")):
                out["name"] = name_hit[2]
        else:
            out["fieldReaderUnavailable"] = True
        return out

    def read(self, bgr, lap_count: int, owners=("player", "ghost"), text_src=None,
             staff_ghost=False) -> dict:
        """Identify owners on a settled result screen (clean frame).

        Run this on the frame where the owner's TIME read closed (lap sum) —
        that frame is settled by definition; mid-animation frames mislead.

        `staff_ghost` says the caller has PROVEN this ghost is a Nintendo staff
        ghost (its total matches the database staff time for this track+cc to
        the millisecond). Only then may the ghost name be rewritten to the
        canonical `Nin*X`, because players are free to choose their own names
        and a lookalike must never be renamed into a staff ghost.

        Localisation is the FIXED capture-card grid: the lap-index probe finds
        each owner's lap-1 circle (player = yellow bg, ghost = grey bg) and the
        card box is a fixed offset from it. No yellow-mask card search."""
        laps = "7laps" if lap_count == 7 else "3laps"
        self._staff_ok = bool(staff_ghost)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        cp, yp = self._probe._best_y(rgb, "player")
        out = {"player": None, "ghost": None}
        if yp is None or cp < 0.7:
            # No confident player lap-1 circle -> this frame is NOT a settled
            # result card: it's a save-ghost "Ja/Nee" dialog (shown after a new
            # record), a transition, or a fade. Do NOT fall back to a yellow-mask
            # search — it locks onto the dialog / yellow scenery and returns a
            # bogus box, reading the wrong character (e.g. Excitebike new-record
            # read Metal Mario off the "Ja" dialog instead of Toad). The result
            # reader samples many frames and will retry on one where the card IS
            # present; returning nothing here also skips the heavy slot ID work.
            return {"player": None, "ghost": None, "error": "no_player_card"}
        pbox = self._card_box(yp, lap_count)
        if "player" in owners:
            out["player"] = self._read_card(bgr, pbox, "player", laps, text_src=text_src)
        if "ghost" not in owners:
            return out
        # ghost: its own lap-1 circle (grey card bg) gives its box directly.
        # Phantom-ghost rule: no confident ghost circle -> no ghost result.
        # Use the same 0.70 gate as the result reader's ghost rescue: real
        # ghost circles can land around 0.78 on busy translucent cards, while
        # absent ghosts sit far below 0.5 in the measured corpus.
        anchors = self.shared_candidate.card_anchors() if self.shared_candidate is not None else None
        if anchors is not None:
            # Central presence (packages/icon-matcher card_presence): lap
            # circles 1, 2 and 3 at one fixed ghost slot. A translucent ghost
            # card over a bright background weakens one circle, never three
            # at the layout's row pitch; solo screens score far below.
            import importlib
            presence = importlib.import_module(self.shared_candidate.api.__name__ + ".card_presence")
            laps_key = 7 if lap_count == 7 else 3
            pslot = min(anchors.slots[laps_key].items(),
                        key=lambda item: min(abs(item[1] + off - yp) for off in anchors.offsets))[0]
            ghost = presence.card_presence(rgb, anchors, "ghost", lap_count, exclude_slot=pslot)
            out["ghostPresence"] = {"present": ghost["present"], "slot": ghost["best"]["slot"],
                                    "scores": [round(s, 3) for s in ghost["best"]["scores"]],
                                    "anchorsSha256": anchors.sha256}
            if ghost["present"]:
                # Presence and slot are central; the exact y stays this
                # engine's own probe (its card grid is calibrated on it).
                yg = _engine_ghost_y(self._probe, rgb, ghost["circleY"])
                out["ghost"] = self._read_card(bgr, self._card_box(yg, lap_count), "ghost",
                                               laps, name_override=False, text_src=text_src)
            return out
        cg, yg = self._probe._best_y(rgb, "ghost")
        if yg is not None and cg >= 0.7:
            out["ghost"] = self._read_card(bgr, self._card_box(yg, lap_count), "ghost", laps,
                                           name_override=False, text_src=text_src)
        return out


def _engine_ghost_y(probe, rgb, circle_y: int) -> int:
    """The engine probe's own ghost y (its full scan, on which the card grid is
    calibrated) when it lands on the central slot; else its best y right there."""
    _cg, yg = probe._best_y(rgb, "ghost")
    if yg is not None and abs(yg - circle_y) <= 8:
        return yg
    start = 70 + ((circle_y - 6 - 70) // 6) * 6  # stay on the scan's 6-px grid
    return probe._best_y(rgb, "ghost", start, circle_y + 13)[1]


def _vote_name(votes: dict) -> str | None:
    """Consensus name from per-frame candidates.

    A plain majority handles the easy case. When frames disagree without a
    winner, take the MEDOID — the candidate most similar to all the others —
    rather than the longest or the first. OCR noise scatters in different
    places on different frames, so the central reading is the one the frames
    agree about; an outlier carrying extra junk is far from all of them and
    loses even if it appears as often. 'Nin*Chris'/'Nin*Chns'/'Vin*Chris' elects
    'Nin*Chris'; 'Nin*Sophia' beats 'Vin;~Sophia GOLDENW'.
    """
    if not votes:
        return None
    top = max(votes.values())
    front = [k for k, c in votes.items() if c == top]
    if len(front) == 1:
        return front[0]
    others = list(votes)
    return max(front, key=lambda k: sum(
        difflib.SequenceMatcher(None, k.lower(), o.lower()).ratio() * votes[o]
        for o in others if o != k))


def merge_identity(best: dict | None, new: dict | None) -> dict | None:
    """Per-field best-score consensus across frames. Icons can still be mid-
    animation when the TIME read closes; correct reads score ~0.84-0.92 while
    unsettled/lookalike reads sit ~0.75-0.82, so the highest-scoring frame per
    field wins."""
    if best is None or new is None:
        return best or new
    out = dict(new)
    for k in KINDS:
        a, b = best.get(k), new.get(k)
        if a and b:
            # the name-strip override is AUTHORITATIVE (the player card's name
            # IS the character name) — it must never lose the consensus to a
            # higher-scoring icon lookalike (Wiggler 0.81 once beat an
            # overridden Toad 0.787 on a solo card)
            ao, bo = bool(a.get("name_strip_override")), bool(b.get("name_strip_override"))
            if ao != bo:
                out[k] = a if ao else b
            else:
                out[k] = a if float(a.get("score", 0)) >= float(b.get("score", 0)) else b
        else:
            out[k] = a or b
    # --- name strip: vote across frames, never "longest wins" ----------------
    # Longest-wins was actively harmful: it is a rule that rewards exactly the
    # failure mode this field has. 'Vin;~Sophia GOLDENW' (a billboard bleeding
    # through the translucent ghost card) is LONGER than the correct
    # 'Nin*Sophia', so contamination beat the clean read every time.
    #
    # We already sample many frames per result screen, so let them vote. Most
    # frames agree; the disagreements are per-frame noise in different places.
    votes: dict[str, int] = {}
    for src in (best, new):
        v = src.get("nameVotes")
        if v:
            for k, c in v.items():
                votes[k] = votes.get(k, 0) + c
        elif src.get("name"):
            votes[src["name"]] = votes.get(src["name"], 0) + 1
    out["nameVotes"] = votes
    out["name"] = _vote_name(votes)
    out["cardBox"] = new.get("cardBox") or best.get("cardBox")
    out["evidenceFile"] = new.get("evidenceFile") or best.get("evidenceFile")
    return out


def identity_confident(ident: dict | None, min_score: float = 0.84) -> bool:
    if not ident:
        return False
    vals = [ident.get(k) for k in KINDS]
    return all(v and (float(v.get("score", 0)) >= min_score
                      # a golden already cleared its own (stricter) accept gate
                      or v.get("source") == "golden"
                      or (v.get("name_strip_override")
                          and float(v.get("name_strip_ratio", 0)) >= 0.9))
               for v in vals)


def _slim(r: dict) -> dict:
    return {"id": r.get("id"), "score": round(float(r.get("score", 0.0)), 3),
            "margin": round(float(r.get("margin", 0.0)), 3),
            **({"selectedId": r["selectedId"], "reviewRequired": r.get("reviewRequired", False)}
               if "selectedId" in r else {}),
            **({"status": r["status"]} if "status" in r else {}),
            **({"suggestion": r["suggestion"]} if r.get("suggestion") else {}),
            **({"rankedCandidates": r["rankedCandidates"]}
               if r.get("rankedCandidates") else {}),
            **({"rankedFamilies": r["rankedFamilies"]}
               if r.get("rankedFamilies") else {}),
            **({"proposedFamilyId": r["proposedFamilyId"],
                "familyMargin": r.get("familyMargin"),
                "variantMargin": r.get("variantMargin")}
               if r.get("proposedFamilyId") else {}),
            # which reference settled it — a golden (captured from this capture
            # card) is near-exact, so the distinction is worth carrying through
            # to the report and the submission
            **({"source": "golden"} if r.get("source") == "golden" else {}),
            **({"name_strip_override": True, "name_strip_ratio": r["name_strip_ratio"]}
               if r.get("name_strip_override") else {}),
            # the printed name agreeing with the icon is a second independent
            # read of the same fact — surface it rather than discard it
            **({"name_strip_confirms": True} if r.get("name_strip_confirms") else {}),
            # the plain family name settled a colour the icon could not
            **({"name_strip_default_variant": True, "icon_variant": r.get("icon_variant"),
                "icon_variant_margin": r.get("icon_variant_margin")}
               if r.get("name_strip_default_variant") else {}),
            # the ink settled a near-tie between colours of one character
            **({"variant_ink_rerank": True, "variant_ink_l1": r.get("variant_ink_l1"),
                **({"variant_ink_replaced": r["variant_ink_replaced"]}
                   if r.get("variant_ink_replaced") else {})}
               if r.get("variant_ink_rerank") else {}),
            **({"name_strip_conflict": r["name_strip_conflict"],
                "name_strip_ratio": r["name_strip_ratio"]}
               if r.get("name_strip_conflict") else {})}
