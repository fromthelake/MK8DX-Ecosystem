import json
from pathlib import Path

from mk8dx_icon_matcher import card_quad as cq

VECTORS = Path(__file__).resolve().parents[2] / "vectors" / "card-quad-v1.json"


def _close(got, want):
    """Recorded floats compare with the TypeScript and Java ports' relative tolerance.

    The vectors come from one platform's libm; another platform may differ in the last
    bits, so exact float equality fails there. Ints, booleans, strings and the shape
    of the document stay exact, and a real change (1e-6) still differs.
    """
    if isinstance(want, bool) or isinstance(got, bool):
        return got is want
    if isinstance(want, (int, float)) and isinstance(got, (int, float)):
        return abs(got - want) <= 1e-9 * max(1.0, abs(got), abs(want))
    if isinstance(want, dict) and isinstance(got, dict):
        return got.keys() == want.keys() and all(_close(got[k], want[k]) for k in want)
    if isinstance(want, (list, tuple)) and isinstance(got, (list, tuple)):
        return len(got) == len(want) and all(_close(g, w) for g, w in zip(got, want))
    return got == want


def _quad(segments, w, h):
    guarded, guard_used, fallback_used = cq.short_line_guard(cq.filter_angles(cq.lines_from_segments(segments)))
    return cq.select_quad(w, h, cq.cluster_lines(guarded)), guard_used, fallback_used


def test_reproduces_recorded_vectors():
    # The TypeScript (card_quad_parity.mjs) and Java (CardQuadParityTest) ports replay them too.
    doc = json.loads(VECTORS.read_text(encoding="utf-8"))
    for case in doc["quads"]:
        axis = cq.filter_angles(cq.lines_from_segments(case["segments"]))
        guarded, guard_used, fallback_used = cq.short_line_guard(axis)
        clusters = cq.cluster_lines(guarded)
        quad = cq.select_quad(case["maskW"], case["maskH"], clusters)
        assert [len(axis), guard_used, fallback_used, len(guarded)] == [
            case["axisCount"], case["guardUsed"], case["fallbackUsed"], case["guardedCount"]]
        assert _close([c.to_dict() for c in clusters], case["clusters"]) and _close(quad, case["quad"])
    for case in doc["deskews"]:
        seed = cq.ghost_detail_deskew_seed(case["detections"], case["frameW"], case["frameH"], case["roiLeft"],
                                           case["roiTop"], case["cropW"], case["cropH"])
        assert _close(None if seed is None else {"quad": seed[0], "degrees": seed[1]}, case["result"])


def test_clean_rectangle_gives_its_corners():
    segments = [[100, 50, 700, 50], [100, 350, 700, 350], [100, 50, 100, 350], [700, 50, 700, 350]]
    quad, guard_used, _ = _quad(segments, 800, 400)
    assert guard_used and quad == [[100.0, 50.0], [700.0, 50.0], [700.0, 350.0], [100.0, 350.0]]


def test_short_lines_are_kept_when_the_guard_would_lose_an_edge():
    segments = [[100, 50, 700, 50], [100, 350, 700, 350], [100, 50, 100, 110], [700, 50, 700, 110]]
    _quad_, guard_used, fallback_used = _quad(segments, 800, 400)
    assert not guard_used and fallback_used


def test_too_close_edges_give_no_quad():
    segments = [[100, 50, 700, 50], [100, 80, 700, 80], [100, 50, 100, 350], [700, 50, 700, 350]]
    assert _quad(segments, 800, 400)[0] is None


def test_deskew_needs_a_turned_straight_column():
    upright = [{"label": "lap_index", "left": 0.5, "top": 0.1 * i, "right": 0.52, "bottom": 0.1 * i + 0.02}
               for i in range(1, 5)]
    assert cq.ghost_detail_deskew_seed(upright, 1280, 720, 0, 0, 400, 300) is None
    turned = [{"label": "lap_index", "left": 0.5 + 0.004 * i, "top": 0.1 * i, "right": 0.52 + 0.004 * i,
               "bottom": 0.1 * i + 0.02} for i in range(1, 5)]
    quad, degrees = cq.ghost_detail_deskew_seed(turned, 1280, 720, 0, 0, 400, 300)
    assert 0.2 < degrees < 8.0 and len(quad) == 4


def test_recorded_vector_comparison_is_tolerant_only_to_rounding():
    doc = json.loads(VECTORS.read_text(encoding="utf-8"))
    case = next(c for c in doc["quads"] if c["quad"] is not None)
    x = case["quad"][0][0]
    assert _close([[x * (1 + 1e-12), *case["quad"][0][1:]], *case["quad"][1:]], case["quad"])
    assert not _close([[x + 1e-6 * max(1.0, abs(x)), *case["quad"][0][1:]], *case["quad"][1:]], case["quad"])
    assert not _close(None, case["quad"]) and not _close(case["quad"][:-1], case["quad"])
    assert not _close(True, 1) and not _close({"a": 1}, {"a": 1, "b": 2})
