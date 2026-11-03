"""Bring a photographed Select-a-Ghost panel back to HDMI exposure and colour, from the panel itself.

The result card's correction (``photometric``) does not apply: the panel has
its own layout. It carries several opaque elements whose colour is a game
constant for every ghost (staff and player): the yellow X button and its dark glyph, the white magnifier, the white
name and total time, the cream lap times, the dark lap-index discs and the dark
lap box. Measured over all 192 HDMI panels of the 96-track walk they spread at
most a few levels per channel. The Y button and the bin are not used (dimmed on
a staff ghost, bright on the player's own), nor is the panel background (it is
translucent over the moving menu).

``correct_panel`` takes each element from a fixed box of the registered ghost
canonical (1280x720): the pixels that rank highest for the element's kind
(brightest, darkest or most yellow), a fixed fraction of the box, so the choice
does not depend on the exposure. Their median colour is compared with the HDMI
colour of the same selection, and each channel is mapped by the least-squares
line through the pairs. It corrects only when enough elements are measured,
their span is wide enough, the gains are plausible and the line fits; otherwise
it reports why and leaves the image unchanged. A camera loses saturation,
which one line per channel cannot restore: on the webcam panels of the walk the
fit stays 31-45 levels from the HDMI colours (HDMI itself: 1.4), so the
residual limit only refuses a measurement that is grossly inconsistent.

TypeScript (``ts/sharedPanelPhotometric.ts``) and Java (``PanelPhotometric``)
implement the same steps on the same reference document
(``references/panel-photometry-v1.json``, built by
``tooling/recognition/build_panel_photometry.py``; boxes and colours only).
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np

SCHEMA = "mk8dx.panel-photometry.v1"
RESULT_SCHEMA = "mk8dx.panel-photometric.v1"
MIN_ELEMENTS = 4
MIN_SPAN = 40.0
GAIN_RANGE = (0.5, 4.0)
MAX_RESIDUAL = 60.0
CLIP = 250.0
DEFAULT_DOCUMENT = Path(__file__).resolve().parent / "references" / "panel-photometry-v1.json"


class PanelPhotometry:
    """The panel elements: canonical box, selection kind and fraction, HDMI colour."""

    def __init__(self, document: dict, sha256: str | None = None):
        if document.get("schema") != SCHEMA:
            raise ValueError("Expected a mk8dx.panel-photometry.v1 document")
        self.sha256 = sha256
        self.canonical = tuple(int(v) for v in document["canonical"])
        self.elements = [{"name": e["name"], "box": [int(v) for v in e["box"]], "kind": e["kind"],
                          "fraction": float(e["fraction"]),
                          "hdmi": None if e.get("hdmi") is None else [float(v) for v in e["hdmi"]]}
                         for e in document["elements"]]

    @classmethod
    def load(cls, path: Path = DEFAULT_DOCUMENT) -> "PanelPhotometry":
        raw = Path(path).read_bytes()
        return cls(json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest())


def _median(values: np.ndarray) -> np.ndarray:
    """Per-channel median; an even count averages the two middle values."""
    ordered = np.sort(values, axis=0)
    n = ordered.shape[0]
    if n % 2:
        return ordered[n // 2].astype(np.float64)
    return (ordered[n // 2 - 1].astype(np.float64) + ordered[n // 2].astype(np.float64)) / 2.0


def _score(pixels: np.ndarray, kind: str) -> np.ndarray:
    """Higher is more the element: brightest ('bright'), darkest ('dark') or most yellow ('yellow')."""
    r, g, b = pixels[:, 0].astype(np.float64), pixels[:, 1].astype(np.float64), pixels[:, 2].astype(np.float64)
    if kind == "bright":
        return 0.299 * r + 0.587 * g + 0.114 * b
    if kind == "dark":
        return -(0.299 * r + 0.587 * g + 0.114 * b)
    if kind == "yellow":
        return r + g - 2.0 * b
    raise ValueError(f"unknown element kind {kind}")


def element_colour(rgb: np.ndarray, element: dict) -> list[float] | None:
    """Median RGB of the box pixels that rank highest for the element (ties keep row-major order)."""
    x0, y0, x1, y1 = element["box"]
    height, width = rgb.shape[:2]
    if x0 < 0 or y0 < 0 or x1 > width or y1 > height or x1 - x0 < 2 or y1 - y0 < 2:
        return None
    pixels = rgb[y0:y1, x0:x1].reshape(-1, 3)
    count = max(1, int(np.floor(pixels.shape[0] * element["fraction"])))
    order = np.argsort(-_score(pixels, element["kind"]), kind="stable")[:count]
    return _median(pixels[order]).tolist()


def measure_panel(rgb: np.ndarray, photometry: PanelPhotometry) -> dict:
    """Every element's observed colour (or null when its box is outside the image)."""
    return {"status": "measured",
            "elements": {e["name"]: element_colour(rgb, e) for e in photometry.elements}}


def fit_correction(measured: dict, photometry: PanelPhotometry) -> dict:
    """Per-channel least-squares gain/offset to the HDMI colours, or the reason it is not trustworthy."""
    pairs = [(measured["elements"].get(e["name"]), e["hdmi"]) for e in photometry.elements]
    pairs = [(o, h) for o, h in pairs if o is not None and h is not None]
    if len(pairs) < MIN_ELEMENTS:
        return {"status": "not_corrected", "reason": "too_few_elements"}
    # Plain sequential sums (not numpy's pairwise ones), so TypeScript and Java agree to the bit.
    n = len(pairs)
    gain, offset, residual = [], [], 0.0
    for c in range(3):
        x = [float(o[c]) for o, _ in pairs]
        y = [float(h[c]) for _, h in pairs]
        if max(x) - min(x) < MIN_SPAN:
            return {"status": "not_corrected", "reason": "anchor_span"}
        mx, my = sum(x) / n, sum(y) / n
        sxy = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
        sxx = sum((xi - mx) ** 2 for xi in x)
        g = sxy / sxx
        if not GAIN_RANGE[0] <= g <= GAIN_RANGE[1]:
            return {"status": "not_corrected", "reason": "gain_range"}
        o = my - g * mx
        residual = max(residual, math.sqrt(sum((g * xi + o - yi) ** 2 for xi, yi in zip(x, y)) / n))
        gain.append(g)
        offset.append(o)
    if residual > MAX_RESIDUAL:
        return {"status": "not_corrected", "reason": "fit_residual", "residual": round(residual, 3)}
    return {"status": "corrected", "gain": gain, "offset": offset, "residual": round(residual, 3),
            "blueClipped": max(o[2] for o, _ in pairs) >= CLIP}


def apply_correction(rgb: np.ndarray, correction: dict) -> np.ndarray:
    """``floor(value * gain + offset + 0.5)`` per channel, clipped to 0..255; unchanged when not corrected."""
    if correction.get("status") != "corrected":
        return rgb
    gain = np.asarray(correction["gain"], np.float64)
    offset = np.asarray(correction["offset"], np.float64)
    return np.clip(np.floor(rgb.astype(np.float64) * gain + offset + 0.5), 0, 255).astype(np.uint8)


def correct_panel(rgb: np.ndarray, photometry: PanelPhotometry) -> tuple[np.ndarray, dict]:
    """``(corrected RGB, record)``; the record is the ``mk8dx.panel-photometric.v1`` evidence."""
    if rgb.ndim != 3 or rgb.shape[2] != 3 or (rgb.shape[1], rgb.shape[0]) != photometry.canonical:
        measured = {"status": "not_canonical"}
        correction = {"status": "not_corrected", "reason": "not_canonical"}
    else:
        measured = measure_panel(rgb, photometry)
        correction = fit_correction(measured, photometry)
    record = {"schema": RESULT_SCHEMA, **correction, "measured": measured, "photometrySha256": photometry.sha256}
    return apply_correction(rgb, correction), record
