"""Select-a-Ghost panel photometry on synthetic canonical panels.

The parity vector (``panel_image(noise=True)``) is repeated in
ts/sharedPanelPhotometric.test.mjs and in Java PanelPhotometricTest.
"""
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mk8dx_icon_matcher.panel_photometric import PanelPhotometry, correct_panel  # noqa: E402

PHOTOMETRY = PanelPhotometry.load()


def panel_image(gain=1.0, offset=0.0, noise=False):
    """A canonical with every element box filled with its HDMI colour, seen through gain/offset."""
    yy, xx = np.mgrid[:720, :1280]
    rgb = np.zeros((720, 1280, 3), np.float64)
    for c in range(3):
        rgb[..., c] = (xx * 7 + yy * 13 + c * 29) % 200 + 20
    for element in PHOTOMETRY.elements:
        x0, y0, x1, y1 = element["box"]
        rgb[y0:y1, x0:x1] = element["hdmi"]
    rgb = rgb * gain + offset
    if noise:
        for c in range(3):
            rgb[..., c] += (xx * 7 + yy * 13 + c * 29) % 11 - 5
    return np.clip(np.floor(rgb + 0.5), 0, 255).astype(np.uint8)


def test_an_hdmi_panel_maps_to_itself():
    out, record = correct_panel(panel_image(), PHOTOMETRY)
    assert record["status"] == "corrected" and record["residual"] < 1
    assert np.allclose(record["gain"], 1, atol=0.01) and np.allclose(record["offset"], 0, atol=1)
    assert np.abs(out.astype(int) - panel_image().astype(int)).max() <= 1


def test_a_dark_lifted_photo_is_brought_back():
    _, record = correct_panel(panel_image(0.6, 30), PHOTOMETRY)
    assert record["status"] == "corrected"
    assert np.allclose(record["gain"], 1 / 0.6, atol=0.02) and np.allclose(record["offset"], -50, atol=1.5)


def test_a_flat_photo_is_left_alone():
    out, record = correct_panel(panel_image(0.1, 100), PHOTOMETRY)
    assert record["status"] == "not_corrected" and record["reason"] == "anchor_span"
    assert (out == panel_image(0.1, 100)).all()


def test_only_the_canonical_size_is_measured():
    _, record = correct_panel(np.zeros((360, 640, 3), np.uint8), PHOTOMETRY)
    assert record["reason"] == "not_canonical"


def test_parity_vector():
    _, record = correct_panel(panel_image(0.7, 25, noise=True), PHOTOMETRY)
    assert record["status"] == "corrected"
    assert [round(v, 6) for v in record["gain"]] == PARITY_GAIN
    assert [round(v, 6) for v in record["offset"]] == PARITY_OFFSET
    assert record["residual"] == PARITY_RESIDUAL


PARITY_GAIN = [1.439261, 1.339596, 1.424378]
PARITY_OFFSET = [-36.344757, -24.484343, -36.657721]
PARITY_RESIDUAL = 2.674
