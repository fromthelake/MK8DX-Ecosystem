import base64
import json
import os
from pathlib import Path

import pytest

from mk8dx_icon_matcher import segment_digits as sd

VECTORS = Path(os.environ.get("MK8DX_SEGMENT_DIGIT_VECTORS",
                              "private-qa/segment-digit-vectors-v1/vectors.json"))
DIGIT_PATTERN = {digit: pattern for pattern, digit in sd.PATTERNS.items()}


def _synthetic_template(w=17, h=25):
    """Seven bars at the usual positions, enough to exercise placement and decoding."""
    bars = {"a": (3, 1, 13, 2), "b": (13, 3, 14, 11), "c": (13, 13, 14, 21), "d": (3, 22, 13, 23),
            "e": (2, 13, 3, 21), "f": (2, 3, 3, 11), "g": (3, 12, 13, 12)}
    points = {k: tuple((x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1))
              for k, (x0, y0, x1, y1) in bars.items()}
    return sd.SegmentTemplate(w, h, points)


def _render(template, digit, w, h, ox=1, oy=1):
    patch = bytearray(w * h)
    for key, on in zip(sd.SEGMENT_KEYS, DIGIT_PATTERN[digit]):
        if on == "1":
            for x, y in template.points[key]:
                if 0 <= ox + x < w and 0 <= oy + y < h:
                    patch[(oy + y) * w + ox + x] = 255
    return bytes(patch)


@pytest.mark.parametrize("digit", list(DIGIT_PATTERN))
def test_every_digit_reads_back_from_its_own_segments(digit):
    template = _synthetic_template()
    best = sd.best_segment_candidate(_render(template, digit, 19, 27), 19, 27, template, "lap", 1)
    assert best is not None and best.decoded == digit and best.valid


def test_required_digit_and_rounding_rules():
    template = _synthetic_template()
    patch = _render(template, "8", 19, 27)
    assert sd.best_segment_candidate(patch, 19, 27, template, "lap", 1, required_digit="0").decoded == "0"
    assert sd._round(2.5) == 3 and sd._round(1.5) == 2  # Math.round, not banker's rounding
    assert sd.canonical_slot_size("total", 2) == (8, 33) and sd.canonical_slot_size("lap", 4) == (19, 27)
    assert sd.decode_pattern("0000000") == "?"


@pytest.mark.skipif(not VECTORS.is_file(), reason="private segment vectors unavailable")
def test_python_reproduces_the_recorded_vectors():
    doc = json.loads(VECTORS.read_text(encoding="utf-8"))
    templates = {kind: sd.template_from_rgb(base64.b64decode(t["rgb"]), t["width"], t["height"])
                 for kind, t in doc["templates"].items()}
    for case in doc["cases"][:300]:
        binary = base64.b64decode(case["binary"])
        best = sd.best_segment_candidate(binary, case["width"], case["height"], templates[case["kind"]],
                                         case["kind"], case["slot"])
        want = case["best"]
        assert (best is None) == (want is None), case["id"]
        if best is not None:
            assert (best.decoded, best.x, best.y) == (want["decoded"], want["x"], want["y"]), case["id"]
