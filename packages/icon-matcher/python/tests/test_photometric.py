"""photometric.correct_card on a synthetic card (no private frames)."""

import base64
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mk8dx_icon_matcher.card_presence import CardAnchors  # noqa: E402
from mk8dx_icon_matcher.photometric import CardPhotometry, correct_card  # noqa: E402

DISC, DIGIT, CARD = (60, 61, 57), (237, 237, 237), (200, 190, 40)


def circle(k: int) -> np.ndarray:
    yy, xx = np.mgrid[:33, :33]
    out = np.zeros((33, 33, 3), np.uint8)
    out[:] = CARD
    out[(xx - 16) ** 2 + (yy - 16) ** 2 <= 14 ** 2] = DISC
    for bar in range(k):
        out[9:24, 12 + 4 * bar:14 + 4 * bar] = DIGIT
    return out


ANCHORS = CardAnchors({"schema": "mk8dx.card-anchors.v1", "x": 1018, "size": 33, "search": 3, "threshold": 0.5,
                       "pitch": {"3": 44}, "slots": {"3": {"top": 208}}, "offsets": [0],
                       "templates": {"player": [base64.b64encode(circle(k).tobytes()).decode() for k in (1, 2, 3)]}})
PHOTOMETRY = CardPhotometry({"schema": "mk8dx.card-photometry.v1", "layouts": {
    "3": {"fromCharacter": [446.5, 66.5], "pitch": 44, "disc": list(DISC), "digit": list(DIGIT)}}})
CHARACTER = (570, 140)


def card() -> np.ndarray:
    rgb = np.zeros((720, 1280, 3), np.uint8)
    rgb[:] = CARD
    for k in (1, 2, 3):
        x, y = int(round(CHARACTER[0] + 446.5)), int(round(CHARACTER[1] + 66.5 + (k - 1) * 44))
        rgb[y:y + 33, x:x + 33] = circle(k)
    return rgb


def camera(rgb, gain, lift, white_balance=(1.0, 1.0, 1.0)) -> np.ndarray:
    x = rgb.astype(np.float64) * gain * np.asarray(white_balance) + lift
    return np.clip(np.floor(x + 0.5), 0, 255).astype(np.uint8)


def test_a_darkened_cool_photo_returns_to_the_hdmi_colours():
    photo = camera(card(), 0.62, 14, (0.9, 1.0, 1.15))
    corrected, record = correct_card(photo, CHARACTER, 3, "player", ANCHORS, PHOTOMETRY)
    assert record["status"] == "corrected" and record["blueClipped"] is False
    assert np.abs(corrected.astype(int) - card().astype(int)).max() <= 2


def test_hdmi_is_left_as_it_is():
    corrected, record = correct_card(card(), CHARACTER, 3, "player", ANCHORS, PHOTOMETRY)
    assert record["status"] == "corrected" and np.array_equal(corrected, card())


def test_a_flat_or_missing_card_is_not_corrected():
    flat = np.full((720, 1280, 3), 120, np.uint8)
    corrected, record = correct_card(flat, CHARACTER, 3, "player", ANCHORS, PHOTOMETRY)
    assert record["status"] == "not_corrected" and np.array_equal(corrected, flat)


def test_a_clipped_blue_white_is_reported():
    photo = camera(card(), 1.25, 0, (1.0, 1.0, 1.2))
    _, record = correct_card(photo, CHARACTER, 3, "player", ANCHORS, PHOTOMETRY)
    assert record["status"] == "corrected" and record["blueClipped"] is True
