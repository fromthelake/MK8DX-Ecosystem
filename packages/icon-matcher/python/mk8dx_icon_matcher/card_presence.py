"""Is an owner's result card at one of the fixed slots? Evidence from lap circles 1, 2, 3.

On the 1280x720 result screen (HDMI as captured, or a photo registered onto
that grid) each owner card shows its circled lap indices in one column. The
card sits in a fixed slot: top or bottom, 3- or 7-lap layout, optionally 30 px
higher for the "new ghost" footer. One circle on a translucent card over a
bright background can look weak; three circles at the layout's fixed row pitch
cannot appear by chance. The card is present when circles 1, 2 and 3 all clear
the threshold at one slot position.

The templates and geometry come from a private, versioned anchors file
(``mk8dx.card-anchors.v1``, built by ``tooling/recognition/build_card_anchors.py``).
TypeScript (``ts/sharedCardPresence.ts``) and Java (``CardPresence``) implement
the same arithmetic and are checked against shared vectors.
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import numpy as np

SCHEMA = "mk8dx.card-anchors.v1"
RESULT_SCHEMA = "mk8dx.card-presence.v1"


class CardAnchors:
    """Parsed anchors file: zero-mean, unit-norm circle templates plus geometry."""

    def __init__(self, document: dict, sha256: str | None = None):
        if document.get("schema") != SCHEMA:
            raise ValueError("Expected a mk8dx.card-anchors.v1 document")
        self.sha256 = sha256
        self.x = int(document["x"])
        self.size = int(document["size"])
        self.search = int(document["search"])
        self.threshold = float(document["threshold"])
        self.pitch = {int(k): int(v) for k, v in document["pitch"].items()}
        self.slots = {int(k): {s: int(y) for s, y in v.items()} for k, v in document["slots"].items()}
        self.offsets = [int(v) for v in document["offsets"]]
        self.templates = {}
        self.raw_templates = {}
        for owner, circles in document["templates"].items():
            raw = [np.frombuffer(base64.b64decode(c), np.uint8) for c in circles]
            self.raw_templates[owner] = raw
            self.templates[owner] = [_unit(r) for r in raw]

    @classmethod
    def load(cls, path: Path) -> "CardAnchors":
        raw = Path(path).read_bytes()
        return cls(json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest())


def _unit(values: np.ndarray) -> np.ndarray:
    v = values.astype(np.float64)
    v = v - v.mean()
    return v / np.linalg.norm(v)


def circle_score(rgb: np.ndarray, template: np.ndarray, x: int, y: int, size: int, search: int) -> float:
    """Best zero-mean normalized correlation of a size x size RGB patch around (x, y)."""
    return circle_match(rgb, template, x, y, size, search)[0]


def circle_match(rgb: np.ndarray, template: np.ndarray, x: int, y: int, size: int,
                 search: int) -> tuple[float, int, int]:
    """(score, dx, dy) of the best patch; the first maximum in dy-then-dx order wins."""
    best, best_dx, best_dy = -1.0, 0, 0
    height, width = rgb.shape[:2]
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            px, py = x + dx, y + dy
            if px < 0 or py < 0 or px + size > width or py + size > height:
                continue
            patch = rgb[py:py + size, px:px + size].astype(np.float64).reshape(-1)
            patch = patch - patch.mean()
            norm = float(np.sqrt(np.dot(patch, patch)))
            if norm < 1e-6:
                continue
            score = float(np.dot(template, patch)) / norm
            if score > best:
                best, best_dx, best_dy = score, dx, dy
    return best, best_dx, best_dy


def card_presence(rgb: np.ndarray, anchors: CardAnchors, owner: str, lap_count: int,
                  exclude_slot: str | None = None) -> dict:
    """Best slot position for ``owner``'s card and whether its three circles agree.

    ``rgb`` is the 1280x720 RGB screen. ``exclude_slot`` skips a slot already
    taken by the other owner. Positions are tried in a fixed order; the first
    with the highest weakest-circle score wins.
    """
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("Expected an RGB image")
    laps = 7 if lap_count == 7 else 3
    templates = anchors.templates[owner]
    positions = []
    for slot, base in anchors.slots[laps].items():
        if slot == exclude_slot:
            continue
        for offset in anchors.offsets:
            y = base + offset
            matches = [circle_match(rgb, templates[k], anchors.x, y + k * anchors.pitch[laps],
                                    anchors.size, anchors.search) for k in range(len(templates))]
            scores = [m[0] for m in matches]
            positions.append({"slot": slot, "offset": offset, "y": y, "circleY": y + matches[0][2],
                              "scores": scores, "weakest": min(scores)})
    best = None
    for position in positions:
        if best is None or position["weakest"] > best["weakest"]:
            best = position
    present = best is not None and best["weakest"] >= anchors.threshold
    return {"schema": RESULT_SCHEMA, "owner": owner, "lapCount": laps, "present": present,
            "slot": best["slot"] if present else None, "y": best["y"] if present else None,
            "circleY": best["circleY"] if present else None,
            "best": best, "threshold": anchors.threshold, "anchorsSha256": anchors.sha256}
