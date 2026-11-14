"""Replay vectors/canonical-warp-v1.json (tools/generate_canonical_warp_vectors.py; issue #99 phase 5)
through the Python reference. TypeScript (ts/canonical_warp_parity.mjs) and Java
(CanonicalWarpParityTest) replay the same file.

Real cases also record what the Web scanner computed on the public test set: the reference must give
the same destination corners, alignment, composed and final matrix, double for double.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from mk8dx_icon_matcher import canonical_warp as cw

PACKAGE = Path(__file__).resolve().parents[2]
VECTORS = PACKAGE / "vectors" / "canonical-warp-v1.json"
FNS = {"boundingRect": cw.bounding_rect, "quadFromRect": cw.quad_from_rect, "shiftedQuad": cw.shifted_quad,
       "quadBox": cw.quad_box, "contentExtent": cw.content_extent, "targetBox": cw.target_box,
       "canonicalAlign": cw.canonical_align, "alignMatrix": cw.align_matrix, "compose": cw.compose,
       "antialiasPlan": cw.antialias_plan}


def _doc() -> dict:
    return json.loads(VECTORS.read_text(encoding="utf-8"))


def test_every_case_replays():
    doc = _doc()
    assert doc["schema"] == "mk8dx.canonical-warp-vectors.v1"
    assert [c["name"] for c in doc["cases"] if cw.canonical_transform(c) != c["expected"]] == []
    assert sum(c["source"] == "synthetic" for c in doc["cases"]) >= 10
    assert [h for h in doc["helperCases"] if FNS[h["fn"]](*h["args"]) != h["expected"]] == []


def test_real_cards_equal_the_web_scanner():
    real = [c for c in _doc()["cases"] if c["source"] == "public-test-set"]
    assert len(real) >= 10, "no real cases"
    for case in real:
        for key in ("destination", "affine", "composed", "final", "warpSource"):
            assert case["expected"][key] == case["web"][key], (case["name"], key)


def test_synthetic_part_is_current():
    spec = importlib.util.spec_from_file_location("generate_canonical_warp_vectors",
                                                  PACKAGE / "tools" / "generate_canonical_warp_vectors.py")
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    doc = _doc()
    assert json.loads(json.dumps(gen.synthetic_cases())) == [c for c in doc["cases"] if c["source"] == "synthetic"]
    assert json.loads(json.dumps(gen.helper_cases())) == doc["helperCases"]
    assert gen.constants() == doc["constants"]


def test_constants_are_the_vectors():
    assert _doc()["constants"] == {
        "canonicalSize": list(cw.CANONICAL_SIZE), "playerBoxRace7": list(cw.PLAYER_BOX_RACE7),
        "ghostBoxRace7": list(cw.GHOST_BOX_RACE7), "ghostDetailBoxRace3": list(cw.GHOST_DETAIL_BOX_RACE3),
        "ghostDetailBoxRace7": list(cw.GHOST_DETAIL_BOX_RACE7), "antialiasBelowScale": cw.ANTIALIAS_BELOW_SCALE,
        "antialiasTargetScale": cw.ANTIALIAS_TARGET_SCALE, "contentKeys": list(cw.CONTENT_KEYS)}
