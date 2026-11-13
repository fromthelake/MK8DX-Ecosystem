"""Python open-set rule replayed on the committed cross-runtime vectors (vectors/open-set-v1.json).

TypeScript (sharedOpenSet.test.mjs) and Java (OpenSetParityTest) replay the same file. Decisions
(ids, status, evidence, order) must be identical; scores may differ by at most 1e-6.
"""
import json
import math
from pathlib import Path

from mk8dx_icon_matcher import open_set
from mk8dx_icon_matcher.result_proposal import compose_result_proposal

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "vectors" / "open-set-v1.json")
                     .read_text(encoding="utf-8"))
TOLERANCE = 1e-6
# The recorded field is the decision part of the proposal (Java OpenSetParityTest compares the same
# keys); diagnostic keys such as crop hashes are not part of the vectors. A missing key equals null.
FIELD_KEYS = ("status", "proposedId", "selectedId", "acceptedId", "proposedFamilyId", "reviewRequired",
              "evidence", "top", "openSet")


def _differences(got, want, path="$"):
    """Paths where ``got`` and ``want`` differ: exact for everything but numbers (tolerance)."""
    if isinstance(want, bool) or isinstance(got, bool):
        return [] if got is want else [path]
    if isinstance(want, (int, float)) and isinstance(got, (int, float)):
        return [] if math.isclose(got, want, rel_tol=0.0, abs_tol=TOLERANCE) else [path]
    if isinstance(want, dict) and isinstance(got, dict):
        if set(got) != set(want):
            return [f"{path} keys {sorted(set(got) ^ set(want))}"]
        return [d for key in want for d in _differences(got[key], want[key], f"{path}.{key}")]
    if isinstance(want, list) and isinstance(got, list):
        if len(got) != len(want):
            return [f"{path} length {len(got)} != {len(want)}"]
        return [d for i, (g, w) in enumerate(zip(got, want)) for d in _differences(g, w, f"{path}[{i}]")]
    return [] if got == want else [path]


def test_vectors_are_the_expected_schema_and_not_empty():
    assert VECTORS["suggestions"] and VECTORS["proposals"]
    assert {c["suggestion"] is None for c in VECTORS["suggestions"]} == {True, False}


def test_mii_suggestion_equals_the_recorded_vectors():
    failures = []
    for i, case in enumerate(VECTORS["suggestions"]):
        got = open_set.mii_suggestion(case["profile"], case["top"], case["acceptedId"])
        diff = _differences(json.loads(json.dumps(got)), case["suggestion"])
        if diff:
            failures.append((i, diff[:3]))
    assert not failures, f"{len(failures)} of {len(VECTORS['suggestions'])} differ, first: {failures[:5]}"


def test_result_proposal_open_set_field_equals_the_recorded_vectors():
    failures = []
    for i, case in enumerate(VECTORS["proposals"]):
        field = compose_result_proposal({"character": {"shared_icon_qa": case["read"]}})["fields"]["character"]
        field = json.loads(json.dumps(field))
        assert set(case["field"]) == set(FIELD_KEYS)
        diff = [d for key in FIELD_KEYS for d in _differences(field.get(key), case["field"][key], f"$.{key}")]
        if diff:
            failures.append((i, diff[:3]))
    assert not failures, f"{len(failures)} of {len(VECTORS['proposals'])} differ, first: {failures[:5]}"


def test_a_changed_id_or_score_is_detected():
    case = VECTORS["proposals"][0]["field"]
    changed = json.loads(json.dumps(case))
    changed["top"][0]["matchScore"] += 2e-6
    assert _differences(changed, case)
    changed = json.loads(json.dumps(case))
    changed["top"][0]["id"] += "_x"
    assert _differences(changed, case)
