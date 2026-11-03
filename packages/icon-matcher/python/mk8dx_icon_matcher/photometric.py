"""Bring a photographed result card back to HDMI exposure and colour, from the card itself.

A camera photo of the TV is darker or brighter, lifted in the blacks and shifted
in white balance; a colour comparison then reads the wrong icons (measured on
real phone photos: 10 wrong acceptances in 31 photos). The card carries two
opaque elements whose colour is a game constant in every layout and owner: the
dark grey disc of the circled lap indices and the white digit inside it (over 645
HDMI cards the disc spreads 0-1 and the digit 0-1.5 per channel; the yellow card
and the time boxes are translucent and are not used).

``correct_card`` finds lap circle 1 from the character slot through the fixed
card layout and each next circle one row pitch below the previous (a small
template search each time), takes the median disc and digit colour
through masks derived from the circle templates, and maps each channel by the
line through (observed disc, observed digit) -> (HDMI disc, HDMI digit). It
corrects only when both anchors are measured, their span is wide enough and the
gains are plausible; otherwise it reports why and leaves the image unchanged.
A digit at the camera's ceiling in the blue channel cannot calibrate the blue
tone that separates NL from LU; the result says so (``blueClipped``) and the
decision then keeps those two flags under review.

TypeScript (``ts/sharedPhotometric.ts``) and Java (``Photometric``) implement the
same steps; the HDMI references and layout come from the private photometry file
(``mk8dx.card-photometry.v1``, ``tooling/recognition/build_card_photometry.py``).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

from .card_presence import CardAnchors, circle_match

SCHEMA = "mk8dx.card-photometry.v1"
RESULT_SCHEMA = "mk8dx.card-photometric.v1"
DISC_LUMA_MAX = 80.0
DIGIT_LUMA_MIN = 200.0
DISC_RADIUS = 12.0
DIGIT_RADIUS = 10.0
SEARCH = 6
MIN_SPAN = 40.0
GAIN_RANGE = (0.5, 3.0)
CLIP = 250.0


class CardPhotometry:
    """HDMI anchor colours and the circle offsets from the character slot, per lap layout."""

    def __init__(self, document: dict, sha256: str | None = None):
        if document.get("schema") != SCHEMA:
            raise ValueError("Expected a mk8dx.card-photometry.v1 document")
        self.sha256 = sha256
        self.layouts = {}
        for laps, layout in document["layouts"].items():
            self.layouts[int(laps)] = {
                "fromCharacter": [float(v) for v in layout["fromCharacter"]],
                "pitch": int(layout["pitch"]),
                "disc": np.asarray(layout["disc"], np.float64),
                "digit": np.asarray(layout["digit"], np.float64),
            }

    @classmethod
    def load(cls, path: Path) -> "CardPhotometry":
        raw = Path(path).read_bytes()
        return cls(json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest())


def _masks(anchors: CardAnchors, owner: str) -> list[tuple[np.ndarray, np.ndarray]]:
    """Per circle template: (disc mask, digit mask) over the template's pixels."""
    size = anchors.size
    yy, xx = np.mgrid[:size, :size]
    centre = (size - 1) / 2.0
    radius = np.sqrt((xx - centre) ** 2 + (yy - centre) ** 2)
    out = []
    for raw in anchors.raw_templates[owner]:
        rgb = raw.reshape(size, size, 3).astype(np.float64)
        luma = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
        out.append(((luma < DISC_LUMA_MAX) & (radius <= DISC_RADIUS),
                    (luma > DIGIT_LUMA_MIN) & (radius <= DIGIT_RADIUS)))
    return out


def _median(values: np.ndarray) -> np.ndarray:
    """Per-channel median; an even count averages the two middle values."""
    ordered = np.sort(values, axis=0)
    n = ordered.shape[0]
    if n % 2:
        return ordered[n // 2].astype(np.float64)
    return (ordered[n // 2 - 1].astype(np.float64) + ordered[n // 2].astype(np.float64)) / 2.0


def measure_anchors(rgb: np.ndarray, character_xy: tuple[float, float], laps: int, owner: str,
                    anchors: CardAnchors, photometry: CardPhotometry) -> dict:
    """Locate lap circles 1-3 and return the median disc and digit RGB (or a reason)."""
    layout = photometry.layouts[7 if laps == 7 else 3]
    fx, fy = layout["fromCharacter"]
    templates = anchors.templates[owner]
    masks = _masks(anchors, owner)
    size = anchors.size
    disc_px, digit_px, circles = [], [], []
    for k in range(len(templates)):
        # circle 1 from the character slot; each next one from where the previous
        # was found, so a slightly scaled registration does not accumulate
        if k == 0:
            x = int(round(character_xy[0] + fx))
            y = int(round(character_xy[1] + fy))
        else:
            x, y = circles[-1][0], circles[-1][1] + layout["pitch"]
        score, dx, dy = circle_match(rgb, templates[k], x, y, size, SEARCH)
        left, top = x + dx, y + dy
        patch = rgb[top:top + size, left:left + size]
        if score < 0.5 or patch.shape[:2] != (size, size):
            return {"status": "circles_not_found", "circleScores": [round(float(score), 3)]}
        circles.append([left, top, round(float(score), 3)])
        disc_px.append(patch[masks[k][0]])
        digit_px.append(patch[masks[k][1]])
    return {"status": "measured", "circles": circles,
            "disc": _median(np.concatenate(disc_px)).tolist(),
            "digit": _median(np.concatenate(digit_px)).tolist()}


def fit_correction(measured: dict, laps: int, photometry: CardPhotometry) -> dict:
    """Per-channel gain/offset to the HDMI anchors, or the reason it is not trustworthy."""
    if measured.get("status") != "measured":
        return {"status": "not_corrected", "reason": measured.get("status")}
    layout = photometry.layouts[7 if laps == 7 else 3]
    disc, digit = np.asarray(measured["disc"]), np.asarray(measured["digit"])
    gain, offset = [], []
    for c in range(3):
        span = digit[c] - disc[c]
        if span < MIN_SPAN:
            return {"status": "not_corrected", "reason": "anchor_span"}
        g = (layout["digit"][c] - layout["disc"][c]) / span
        if not GAIN_RANGE[0] <= g <= GAIN_RANGE[1]:
            return {"status": "not_corrected", "reason": "gain_range"}
        gain.append(g)
        offset.append(layout["disc"][c] - g * disc[c])
    return {"status": "corrected", "gain": gain, "offset": offset,
            "blueClipped": bool(digit[2] >= CLIP)}


def apply_correction(rgb: np.ndarray, correction: dict) -> np.ndarray:
    """``round(value * gain + offset)`` per channel, clipped to 0..255; unchanged when not corrected."""
    if correction.get("status") != "corrected":
        return rgb
    gain = np.asarray(correction["gain"], np.float64)
    offset = np.asarray(correction["offset"], np.float64)
    return np.clip(np.floor(rgb.astype(np.float64) * gain + offset + 0.5), 0, 255).astype(np.uint8)


def correct_card(rgb: np.ndarray, character_xy: tuple[float, float], laps: int, owner: str,
                 anchors: CardAnchors, photometry: CardPhotometry,
                 other_card: dict | None = None) -> tuple[np.ndarray, dict]:
    """``(corrected RGB, record)``; the record is the ``mk8dx.card-photometric.v1`` evidence.

    ``other_card`` is the record of the other card on the same photo. Both cards
    share the photo's exposure, so a card whose own circles cannot be measured
    (a dark translucent ghost card on a dark photo) takes that correction."""
    measured = measure_anchors(rgb, character_xy, laps, owner, anchors, photometry)
    correction = fit_correction(measured, laps, photometry)
    source = "own_card"
    if (correction["status"] != "corrected" and isinstance(other_card, dict)
            and other_card.get("status") == "corrected" and other_card.get("source") == "own_card"):
        correction = {key: other_card[key] for key in ("status", "gain", "offset", "blueClipped")}
        source = "other_card"
    record = {"schema": RESULT_SCHEMA, **correction, "source": source, "measured": measured,
              "photometrySha256": photometry.sha256}
    return apply_correction(rgb, correction), record
