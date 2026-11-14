"""Replay the generated public vectors (tools/generate_vectors.py) through the Python reference (issue #99).

A rule change that alters a decision shows here first; regenerate the vectors and replay them in the
TypeScript (ts/contextVectors.test.mjs, ts/iconScoreVectors.test.mjs) and Java (ContextParityTest,
IconScoreParityTest) runners.
icon-score-v1 needs a materialized recognition pack (MK8DX_RECOGNITION_PACK or MK8DX_SHARED_ICON_PACK) and
skips without one; context-v1 is self-contained.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import warnings

import pytest

PACKAGE = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("generate_vectors", PACKAGE / "tools" / "generate_vectors.py")
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)

TOLERANCE = 1e-6


def _load(name: str) -> dict:
    return json.loads((PACKAGE / "vectors" / name).read_text(encoding="utf-8"))


def test_context_vectors_replay_exactly():
    doc = _load("context-v1.json")
    assert doc["schema"] == "mk8dx.context-vectors.v1"
    bank = gen.context_bank(doc["catalog"])
    differences = [case["id"] for case in doc["cases"] if gen.run_context_case(case, bank) != case["expected"]]
    assert differences == []


def test_context_vectors_ocr_normalization_replays():
    from mk8dx_icon_matcher.name_match import normalize

    items = _load("context-v1.json")["ocrNormalization"]
    assert items and [item["text"] for item in items if normalize(item["text"]) != item["normalized"]] == []


def test_context_vectors_are_the_generators_output():
    assert gen.dump(gen.build_context()) == (PACKAGE / "vectors" / "context-v1.json").read_bytes()


def _decision(result: dict) -> tuple:
    return (result["status"], result["top1Id"], result["acceptedId"], tuple(c["id"] for c in result["top"]),
            tuple(result["offset"]))


def _scores(result: dict) -> list[float | None]:
    return [result["score"], result["margin"], result["familyMargin"], *(c["score"] for c in result["top"])]


def _close(a: list, b: list) -> bool:
    return all((x is None) == (y is None) and (x is None or abs(x - y) <= TOLERANCE) for x, y in zip(a, b))


TENSORS = gen.tensor_dir(None)


@pytest.mark.skipif(TENSORS is None or not (TENSORS / "references.json").is_file(),
                    reason="recognition pack not materialized (set MK8DX_RECOGNITION_PACK)")
def test_icon_score_vectors_replay():
    doc = _load("icon-score-v1.json")
    manifest, bank, hashes = gen.load_tensor_pack(TENSORS)
    assert manifest["catalogSha256"] == doc["catalogSha256"] and hashes == doc["tensors"]
    matcher = gen.IconMatcher(bank)
    failures, reported = [], []
    for case in doc["cases"]:
        query = gen.decode_query(case)
        for mode, want in sorted(case["expected"].items()):
            got = gen.python_match(matcher, case["group"], query, mode)
            if _decision(got) == _decision(want) and _close(_scores(got), _scores(want)):
                continue
            entry = f"{case['id']} {mode}: want {_decision(want)} {want['score']!r} got {_decision(got)} {got['score']!r}"
            (reported if case["boundary"] or case["nearTie"] else failures).append(entry)
    if reported:
        warnings.warn("icon-score-v1 boundary differences (issue #99): " + "; ".join(reported))
    assert failures == []
