"""Replay the public rule vectors of tools/generate_rule_vectors.py through the Python reference (issue #99).

refinement-v1 (tensor pack), frame-geometry-v1 and lap-grid-v1 (frame definitions) need a materialized
recognition pack (MK8DX_RECOGNITION_PACK, or MK8DX_FRAME_DEFINITIONS for the geometry) and skip without
one; segment-digits-v1 and name-match-v1 are self-contained. The TypeScript (ts/refinementVectors.test.mjs,
ts/vectorParity.test.mjs) and Java (RefinementParityTest, FrameGeometry/LapGrid/SegmentDigits/NameMatch
ParityTest) runners replay the same files.
"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import warnings

import pytest

PACKAGE = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("generate_rule_vectors",
                                               PACKAGE / "tools" / "generate_rule_vectors.py")
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)

TOLERANCE = 1e-6
TENSORS = gen.gv.tensor_dir(None)
DEFS = gen.frame_definitions_path(None)
needs_tensors = pytest.mark.skipif(TENSORS is None or not (TENSORS / "references.json").is_file(),
                                   reason="recognition pack not materialized (set MK8DX_RECOGNITION_PACK)")
needs_defs = pytest.mark.skipif(DEFS is None or not DEFS.is_file(),
                                reason="frame definitions not available (set MK8DX_RECOGNITION_PACK)")


def _path(name: str) -> Path:
    return PACKAGE / "vectors" / name


def _load(name: str) -> dict:
    return json.loads(_path(name).read_text(encoding="utf-8"))


def close(got, want, tolerance: float = TOLERANCE) -> bool:
    """Same JSON shape, strings/booleans/null equal, numbers within ``tolerance``."""
    if isinstance(want, bool) or want is None or isinstance(want, str):
        return got == want
    if isinstance(want, (int, float)):
        return isinstance(got, (int, float)) and not isinstance(got, bool) and abs(got - want) <= tolerance
    if isinstance(want, list):
        return isinstance(got, list) and len(got) == len(want) and all(close(g, w, tolerance)
                                                                       for g, w in zip(got, want))
    if isinstance(want, dict):
        return isinstance(got, dict) and got.keys() == want.keys() and all(close(got[k], want[k], tolerance)
                                                                           for k in want)
    raise TypeError(type(want))


@needs_tensors
def test_refinement_vectors_replay():
    doc = _load("refinement-v1.json")
    assert doc["schema"] == "mk8dx.refinement-vectors.v1"
    manifest, bank, hashes = gen.gv.load_tensor_pack(TENSORS, gen.REFINEMENT_GROUPS)
    assert manifest["catalogSha256"] == doc["catalogSha256"] and hashes == doc["tensors"]
    failures, reported = [], []
    for case in doc["cases"]:
        got = gen.run_refinement_case(case, bank)
        if not close(got, case["expected"]):
            (reported if case["boundary"] else failures).append(case["id"])
    if reported:
        warnings.warn("refinement-v1 boundary differences (issue #99): " + ", ".join(reported))
    assert failures == []


@needs_tensors
def test_refinement_vectors_are_the_generators_output():
    assert gen.dump(gen.build_refinement(TENSORS)) == _path("refinement-v1.json").read_bytes()


@needs_defs
def test_frame_geometry_and_lap_grid_vectors_are_the_generators_output():
    for name, build in (("frame-geometry-v1.json", gen.build_frame_geometry),
                        ("lap-grid-v1.json", gen.build_lap_grid)):
        doc = build(DEFS)
        assert doc["frameDefinitionsSha256"] == _load(name)["frameDefinitionsSha256"], \
            f"{name} was generated from other frame definitions"
        assert gen.dump(doc) == _path(name).read_bytes(), name


@needs_defs
def test_lap_grid_vectors_cover_resolved_and_blocked_grids():
    statuses = {case["result"]["status"] for case in _load("lap-grid-v1.json")["cases"]}
    assert {"implemented", "blocked_missing_relative_grid", "blocked_insufficient_lap_index_support",
            "blocked_insufficient_owner_lap_index_support", "blocked_ambiguous_active_lap_count"} <= statuses


def test_segment_digit_vectors_replay():
    doc = _load("segment-digits-v1.json")
    assert doc["schema"] == "mk8dx.segment-digit-vectors.v1" and len(doc["cases"]) >= 60
    assert gen.dump(gen.build_segment_digits()) == _path("segment-digits-v1.json").read_bytes()


def test_name_match_vectors_replay():
    doc = _load("name-match-v1.json")
    assert doc["schema"] == "mk8dx.name-match-vectors.v1" and len(doc["cases"]) >= 150
    assert {t["rule"] for t in doc["titles"]} == {"tokens", "prefix", "fuzzy", "fuzzy_cjk", "ambiguous", None}
    assert gen.dump(gen.build_name_match()) == _path("name-match-v1.json").read_bytes()
