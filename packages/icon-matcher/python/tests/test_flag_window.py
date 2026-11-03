"""The central flag-window search: same synthetic vectors as the TS and Java tests."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mk8dx_icon_matcher.flag_window import flag_inset, search_flag_window  # noqa: E402


def shifted(left, top, width, height):
    return (0.9 - 0.01 * abs(left - 11) - 0.015 * abs(top - 3) + ((left * 7 + top * 13) % 5) * 0.0005
            - (0.05 if width == 55 else 0))


def slot(left, top, width, height):
    return 0.8 - 0.02 * abs(left - 5) - 0.02 * abs(top - 5) + (0.01 if width == 55 else 0)


def test_the_border_inset_follows_the_slot_height():
    assert flag_inset(38) == 2 and flag_inset(20) == 2 and flag_inset(64) == 4


def test_a_better_position_inside_the_window_wins():
    got = search_flag_window(65, 48, (5, 5, 55, 38), shifted)
    assert got["cropXywh"] == [7, 3, 51, 34] and got["basis"] == "window_search"
    assert got["evaluated"] == 117 and abs(got["score"] - 0.8615) < 1e-9


def test_a_tight_full_slot_stays():
    got = search_flag_window(65, 48, (5, 5, 55, 38), slot)
    assert got["cropXywh"] == [5, 5, 55, 38] and got["basis"] == "fixed_slot" and got["evaluated"] == 113
