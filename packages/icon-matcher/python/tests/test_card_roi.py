import json
from pathlib import Path

from mk8dx_icon_matcher import card_roi as cr

VECTORS = Path(__file__).resolve().parents[2] / "vectors" / "card-roi-v1.json"


def _badge(x, y, w=0.02, h=0.03):
    return {"label": "lap_index", "score": 0.9, "left": x, "top": y, "right": x + w, "bottom": y + h}


def test_reproduces_recorded_vectors():
    # The TypeScript (card_roi_parity.mjs) and Java (CardRoiParityTest) ports replay them too.
    doc = json.loads(VECTORS.read_text(encoding="utf-8"))
    for c in doc["endScreens"]:
        assert cr.select(c["detections"], c["width"], c["height"], c["yellow"]) == c["select"]
        assert cr.select_sparse_dual_yellow_candidate(c["detections"], c["width"], c["height"], c["yellow"]) == c["sparse"]
    for c in doc["ghostDetails"]:
        assert cr.select_ghost_detail(c["detections"], c["width"], c["height"]) == c["selectGhostDetail"]


def test_player_box_with_three_badges_is_the_route():
    dets = [{"label": "player_timetrail_box", "score": 0.9, "left": 0.43, "top": 0.54, "right": 0.96, "bottom": 0.85}]
    dets += [_badge(0.66, 0.62 + i * 0.05) for i in range(3)]
    out = cr.select(dets, 1280, 720, [])
    assert out["status"] == "implemented" and out["candidate"]["selectedRoute"] == "player_box_supported"
    left, top, right, bottom = out["roi"]
    assert left >= out["candidate"]["ownerConstraintBox"][0] and right <= out["candidate"]["ownerConstraintBox"][2]


def test_badges_alone_need_yellow_support():
    dets = [_badge(0.66, 0.62 + i * 0.05) for i in range(3)]
    assert cr.select(dets, 1280, 720, [])["status"] == "blocked_missing_supported_owner_lap_index_route"


def test_ghost_detail_column_and_ambiguous_count():
    column = [_badge(0.43, 0.3 + i * 0.04, 0.015, 0.025) for i in range(3)]
    out = cr.select_ghost_detail(column, 1280, 720)
    assert out["selectedReason"] == cr.GHOST_DETAIL_BADGE_COLUMN_ONLY and out["candidate"]["lapIndexCount"] == 3
    four = [_badge(0.43, 0.3 + i * 0.04, 0.015, 0.025) for i in range(4)]
    assert cr.select_ghost_detail(four, 1280, 720)["status"] == "blocked_ambiguous_ghost_detail_lap_count"


def test_f32_rounds_like_math_fround():
    assert cr.f32(0.1) == 0.10000000149011612
    assert cr.f32(1e39) == float("inf")
