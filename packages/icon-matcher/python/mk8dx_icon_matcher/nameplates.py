"""Nameplates: which name a menu prints, from the shape of its glyphs.

The central matcher for printed names on HDMI sources (CENTRAL_RECOGNITION section 8.6; moved from the
LiveTrial engine overlay 2026-10-30, unchanged). Python only: the scanners read phone photos, where
the owner keeps OCR plus the central name matcher (2026-10-29).

Clean Assets v5.7 carries, per item and game locale, the binary mask of the
name exactly as the console prints it (`assets.nameplate.byLocale`): the name
banner of the cup, character and vehicle screens and the name line of the cup
screen's four track tiles. `detection.nameplates` is the contract this module
follows: the same mask is built from the live frame and compared with the
locale's nameplates by IoU with a 2 px search; a winner counts only under the
decision rule, otherwise the crop is undecided and the caller falls back to
OCR. Measured on the 2026-10-28 HDMI walks (all 15 locales at 1920x1080) on a
Nintendo Switch (first generation, system 23.0.1): 4916 shots, no wrong and no
undecided match. A Nintendo Switch 2 is untested and may render menus differently.

LiveTrial sees 1280x720, so a crop is enlarged to the 1920x1080 reference
scale before the mask is taken (measured in tests/test_nameplates.py on the
walks scaled to 720p).

A nameplate says which items print that text in which locale. Languages that
print the same name (Mario, Luigi...) tie: like a shared template, the result
narrows the console language to a group.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

REFERENCE_HEIGHT = 1080
BANNER = "nameBar"
TILE = "trackTileName"
SEARCH = 2          # px, both axes
SIZE_SLACK = 6      # px: a plate this much wider or taller scores 0
CLUSTER_GAP = 40    # px at reference scale: icons and the -/+ glyphs sit beyond such a gap
WHITE = 200         # banner glyphs: min(B, G, R) above this (contract, 1080p)
DARK = 110          # tile glyphs: grey below this (contract, 1080p)
# A 720p crop enlarged to reference scale has softer glyph edges; these thresholds left
# the fewest crops undecided on the walks scaled to 720p (swept 150-215 / 95-160).
WHITE_SCALED = 170
DARK_SCALED = 135
RULES = ((0.85, 0.10), (0.65, 0.25), (0.95, 0.04))   # (top, margin), any one accepts
BANNER_KINDS = ("character", "body", "tire", "glider", "cup")
COLLECTIONS = (("characters", "character"), ("vehicleBodies", "body"), ("vehicleTires", "tire"),
               ("vehicleGliders", "glider"), ("cups", "cup"), ("tracks", "track"))


LANGUAGE_MARGIN = 0.10   # a language outside the tie must score this much lower
TIE = 0.01


def decided(top: float, margin: float) -> bool:
    return any(top >= t and margin >= m for t, m in RULES)


def _norm(text: str) -> str:
    import unicodedata
    return "".join(ch for ch in unicodedata.normalize("NFKC", text).casefold() if ch.isalnum())


def text_mask(crop, dark: bool, scale: float = 1.0):
    """The glyph mask of a name crop at reference scale, cropped to the text; None when empty.
    `crop` is RGB or BGR (the thresholds are channel-blind); `scale` enlarges it first."""
    import cv2
    img = np.asarray(crop)
    white, darkest = WHITE, DARK
    if scale != 1.0:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        white, darkest = WHITE_SCALED, DARK_SCALED
    if dark:
        grey = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        mask = grey < darkest
    else:
        mask = (img.min(axis=2) if img.ndim == 3 else img) > white
    cols = np.nonzero(mask.any(axis=0))[0]
    if len(cols) == 0:
        return None
    runs, start = [], cols[0]
    for a, b in zip(cols, cols[1:]):
        if b - a > CLUSTER_GAP:
            runs.append((start, a))
            start = b
    runs.append((start, cols[-1]))
    centre = mask.shape[1] // 2
    x0, x1 = min(runs, key=lambda r: 0 if r[0] <= centre <= r[1]
                 else min(abs(r[0] - centre), abs(r[1] - centre)))
    part = mask[:, x0:x1 + 1]
    rows = np.nonzero(part.any(axis=1))[0]
    return part[rows[0]:rows[-1] + 1]


def iou(a, b, search: int = SEARCH) -> float:
    """Best IoU of two boolean masks over offsets of -search..+search px (either mask moves)."""
    best = 0.0
    h = max(a.shape[0], b.shape[0]) + 2 * search
    w = max(a.shape[1], b.shape[1]) + 2 * search
    A = np.zeros((h, w), bool)
    A[search:search + a.shape[0], search:search + a.shape[1]] = a
    na = int(a.sum())
    nb = int(b.sum())
    for dy in range(2 * search + 1):
        for dx in range(2 * search + 1):
            inter = int(A[dy:dy + b.shape[0], dx:dx + b.shape[1]][b].sum())
            union = na + nb - inter
            if union:
                best = max(best, inter / union)
    return best


class Nameplates:
    """The nameplates of database.json, loaded once (about 4000 small PNGs)."""

    def __init__(self, db: dict, root: Path):
        from PIL import Image
        self.locales: dict[str, dict[str, list]] = {}   # locale -> group -> [(item ids, text, mask)]
        tags = set((db.get("detection") or {}).get("nameplates", {}).get("regions", {})
                   .get("trackTileTag", {}).get("tags") or ())
        self.track_tag: dict[tuple[str, str], str] = {}
        collections = db.get("collections") or {}
        items = [(it, kind) for name, kind in COLLECTIONS for it in collections.get(name) or []]
        items += [(it, "character") for it in (db.get("relationships") or {}).get("characterVariants") or []]
        plates: dict[tuple[str, str, str], dict] = {}
        for it, kind in items:
            for loc, plate in ((it.get("assets") or {}).get("nameplate", {}).get("byLocale") or {}).items():
                if not plate:
                    continue
                group = "tile" if kind == "track" else "banner"
                key = (loc, group, plate["path"])
                entry = plates.setdefault(key, {"ids": [], "text": plate.get("text", "")})
                entry["ids"].append(it["id"])
                if kind == "track":
                    head = (it.get("names") or {}).get(loc, "").split(" ", 1)[0]
                    self.track_tag[(loc, it["id"])] = head if head in tags else ""
        cache: dict[str, np.ndarray] = {}
        for (loc, group, path), entry in plates.items():
            if path not in cache:
                cache[path] = np.asarray(Image.open(root / path, formats=["PNG"]).convert("L")) > 127
            self.locales.setdefault(loc, {}).setdefault(group, []).append(
                (tuple(entry["ids"]), entry["text"], cache[path]))

    def __bool__(self) -> bool:
        return bool(self.locales)

    def match(self, mask, locale: str, group: str, tag: str | None = None):
        """(item ids, text, top, margin) of the best plate, or None for no plate of that size.
        margin = top minus the best plate with a different text; `tag` limits track tiles."""
        if mask is None:
            return None
        scored = []
        for ids, text, ref in self.locales.get(locale, {}).get(group, ()):
            if tag is not None and self.track_tag.get((locale, ids[0]), "") != tag:
                continue
            if abs(ref.shape[0] - mask.shape[0]) > SIZE_SLACK or abs(ref.shape[1] - mask.shape[1]) > SIZE_SLACK:
                continue
            scored.append((iou(mask, ref), ids, text))
        if not scored:
            return None
        scored.sort(key=lambda s: -s[0])
        top, ids, text = scored[0]
        second = next((s for s, _, t in scored[1:] if t != text), 0.0)
        return ids, text, round(top, 3), round(top - second, 3)

    def crop_languages(self, crop, kind: str, languages: dict[str, list[str]], scale: float):
        """The languages one crop names, or None (undecided: leave it to OCR).

        Per language the best plate over its locales. The top one must be decided within its
        own locale; languages whose best plate prints the same text tie with it (Mario, Luigi);
        every other language must stay LANGUAGE_MARGIN below. Returns
        {"languages": [...], "text": ..., "ids": [...], "locale": ..., "score": ...}."""
        mask = text_mask(crop, dark=(kind == "tracks"), scale=scale)
        if mask is None:
            return None
        group = "tile" if kind == "tracks" else "banner"
        best: dict[str, tuple] = {}
        for code, locales in languages.items():
            for loc in locales:
                res = self.match(mask, loc, group)
                if res and res[2] > best.get(code, (0.0,))[0]:
                    best[code] = (res[2], res[3], res[0], res[1], loc)
        if not best:
            return None
        code = max(best, key=lambda c: best[c][0])
        top, margin, ids, text, loc = best[code]
        if not decided(top, margin):
            return None
        same = _norm(text)
        tie = {c for c, v in best.items() if _norm(v[3]) == same or v[0] >= top - TIE}
        rest = [v[0] for c, v in best.items() if c not in tie]
        if rest and top - max(rest) < LANGUAGE_MARGIN:
            return None
        return {"languages": sorted(tie), "text": text, "ids": list(ids), "locale": loc, "score": top}


def load(root: Path) -> Nameplates | None:
    """The nameplates of the Clean Assets folder at `root`, or None before v5.7."""
    try:
        db = json.loads((Path(root) / "database.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    plates = Nameplates(db, Path(root))
    return plates or None
