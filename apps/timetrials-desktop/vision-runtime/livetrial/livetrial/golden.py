"""Golden templates: references captured from THIS capture card.

The Clean Assets icons are authored art, resized into a detection box — a
different rasterisation than the one the Switch actually draws. Everything the
matcher has to compensate for (brightness gain, colour washes, lookalike
rescues) exists because reference and query come from different renderers.

A *golden* is the icon as the game itself drew it, taken from a verified result
screen at the exact slot size: same renderer, same scale, same anti-aliasing.
Matching one is then near-exact rather than approximate.

Two things make a golden more than "a screenshot of a slot":

1. **It carries a capture-derived ALPHA.** The query has no alpha channel and it
   cannot be recovered through a translucent ghost card (measured: 2380 px
   recovered vs a 1582 px true mask, true part ranked #218). But on the PLAYER
   card the background is opaque flat yellow, and there the same recovery is
   clean (IoU 0.929 against the reference alpha, ranked #1). So the cut-out is
   derived once, from a player-card capture, and then used for that part on both
   card types. That is the alpha cut-out actually doing work.
2. **It is harvested from a median STACK**, so the moving scene behind a
   translucent card has already been cancelled (see runner.STACK_*).

Layout — `livetrial/config/golden/<group>/<part>__<laps>lap__<card>.png`
(RGBA; RGB = the captured pixels, A = the capture-derived cut-out) plus
`manifest.json` recording where each one came from and how it was verified.
Harvest with `tests/_golden_harvest.py`, audit with `tests/_golden_audit.py`.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

GOLDEN_DIR = Path(__file__).resolve().parents[1] / "config" / "golden"
MANIFEST = GOLDEN_DIR / "manifest.json"

# A golden is the same renderer at the same scale, so a genuine match sits far
# above anything the generic references reach. Accept only well clear of that,
# and only with daylight to the runner-up: below either gate we fall through to
# the normal path rather than guess.
ACCEPT = 0.90
MARGIN = 0.03

_CACHE: dict = {}


def _key(part_id: str, laps: int, card: str) -> str:
    return f"{part_id.replace('.', '_')}__{7 if laps == 7 else 3}lap__{card}"


def path_for(group: str, part_id: str, laps: int, card: str) -> Path:
    return GOLDEN_DIR / group / f"{_key(part_id, laps, card)}.png"


def load(group: str) -> list[dict]:
    """[{id, card, laps, rgb (float01 HxWx3), alpha (float01 HxW)}] for a group."""
    if group in _CACHE:
        return _CACHE[group]
    out: list[dict] = []
    d = GOLDEN_DIR / group
    if d.is_dir():
        man = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
        for p in sorted(d.glob("*.png")):
            im = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
            if im is None or im.ndim != 3 or im.shape[2] != 4:
                continue
            meta = man.get(f"{group}/{p.name}") or {}
            if not meta.get("id"):
                continue
            out.append({
                "id": meta["id"], "card": meta.get("card", "player"),
                "laps": int(meta.get("laps", 3)), "file": p.name,
                "rgb": cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0,
                "alpha": (im[:, :, 3].astype(np.float32) / 255.0),
            })
    _CACHE[group] = out
    return out


def invalidate() -> None:
    _CACHE.clear()


def derive_alpha(crop_bgr: np.ndarray, tol: float = 0.10) -> np.ndarray | None:
    """Cut-out from an OPAQUE (player) card crop: the background is flat card
    colour, so everything far enough from the border median is icon. Only ever
    called on player cards — on a translucent ghost card the same test also
    catches the race scene and over-segments by ~50%."""
    q = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    h, w = q.shape[:2]
    ring = np.zeros((h, w), bool)
    r = max(2, min(h, w) // 12)
    ring[:r, :] = ring[-r:, :] = True
    ring[:, :r] = ring[:, -r:] = True
    bg = np.median(q[ring].reshape(-1, 3), axis=0)
    fg = (np.abs(q - bg[None, None]).sum(2) > tol * 3.0).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    frac = float(fg.mean())
    if frac < 0.04 or frac > 0.90:
        return None
    return fg.astype(np.float32)


def _score(q01: np.ndarray, g: dict) -> float:
    """Masked |dRGB| against a golden, on its capture-derived cut-out."""
    rgb, a = g["rgb"], g["alpha"]
    if rgb.shape[:2] != q01.shape[:2]:
        rgb = cv2.resize(rgb, (q01.shape[1], q01.shape[0]), interpolation=cv2.INTER_AREA)
        a = cv2.resize(a, (q01.shape[1], q01.shape[0]), interpolation=cv2.INTER_AREA)
    m = (a > 0.5).astype(np.float32)
    s = float(m.sum())
    if s < 24:
        return -1.0
    return 1.0 - float((np.abs(rgb - q01).sum(2) * m).sum()) / (s * 3.0 + 1e-6)


def match(crop_bgr: np.ndarray, group: str, laps: int, card: str, *,
          subset_ids: list[str] | None = None, search: int = 1) -> dict | None:
    """Best golden for this slot, or None when nothing is confident enough.

    Candidates are restricted to the same card type and lap layout: a ghost
    card's translucency and a 7-lap card's slot size both change the pixels, so
    a golden only speaks for the situation it was captured in."""
    lib = [g for g in load(group)
           if g["card"] == card and g["laps"] == (7 if laps == 7 else 3)]
    if subset_ids is not None:
        keep = set(subset_ids)
        lib = [g for g in lib if g["id"] in keep]
    if not lib:
        return None
    best = (-1.0, None)
    second = -1.0
    h, w = crop_bgr.shape[:2]
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            M = np.float32([[1, 0, -dx], [0, 1, -dy]])
            shifted = cv2.warpAffine(crop_bgr, M, (w, h), flags=cv2.INTER_LINEAR,
                                     borderMode=cv2.BORDER_REPLICATE) if (dx or dy) else crop_bgr
            q01 = cv2.cvtColor(shifted, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            for g in lib:
                v = _score(q01, g)
                if v > best[0]:
                    second = max(second, best[0])
                    best = (v, g)
                elif v > second and (best[1] is None or g["id"] != best[1]["id"]):
                    second = v
    score, g = best
    if g is None or score < ACCEPT:
        return None
    if second > -1.0 and score - second < MARGIN:
        return None
    return {"id": g["id"], "score": round(float(score), 4),
            "margin": round(float(score - second), 4) if second > -1.0 else 1.0,
            "source": "golden", "golden_file": g["file"]}
