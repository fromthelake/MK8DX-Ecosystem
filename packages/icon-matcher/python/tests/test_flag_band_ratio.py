"""NL/LU band ratio: green of the blue band over red of the red band."""
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mk8dx_icon_matcher.flag_rank import flag_band_ratio  # noqa: E402


def tricolour(red, blue, gain=(1.0, 1.0, 1.0)):
    flag = np.zeros((38, 55, 3), np.float64)
    flag[:13] = red
    flag[13:25] = (1.0, 1.0, 1.0)
    flag[25:] = blue
    return np.clip(flag * np.array(gain), 0, 1)


NL = tricolour((194 / 255, 57 / 255, 55 / 255), (4 / 255, 89 / 255, 164 / 255))
LU = tricolour((200 / 255, 59 / 255, 45 / 255), (55 / 255, 148 / 255, 213 / 255))


def test_asset_tones_decide_and_survive_a_common_exposure_change():
    assert flag_band_ratio(NL)["decisionId"] == "country.nl"
    assert flag_band_ratio(LU)["decisionId"] == "country.lu"
    darker = flag_band_ratio(NL * 0.7)
    assert darker["decisionId"] == "country.nl" and abs(darker["ratio"] - flag_band_ratio(NL)["ratio"]) < 1e-9


def test_between_tone_and_missing_bands():
    mid = tricolour((0.78, 0.22, 0.2), (0.12, 0.507, 0.75))
    result = flag_band_ratio(mid)
    assert result["status"] == "measured" and result["decisionId"] is None and result["reason"] == "between"
    grey = np.full((38, 55, 3), 0.5)
    assert flag_band_ratio(grey)["status"] == "unavailable"
