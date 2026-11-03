from copy import deepcopy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from mk8dx_tournament_extraction import CanonicalizationError, canonicalize_confirmed_rows

from rows import confirmed_rows, source


def test_confirmed_rows_keep_score_and_unresolved_identity_separate():
    result, = canonicalize_confirmed_rows(confirmed_rows(), source=source(), created_at_ms=1000)
    domain = Path(__file__).resolve().parents[2] / "packages/domain"
    catalog = json.loads((domain / "schema-catalog-v1.json").read_text(encoding="utf-8"))
    registry = Registry()
    for entry in catalog["schemas"]:
        document = json.loads((domain / entry["path"]).read_text(encoding="utf-8"))
        registry = registry.with_resource(entry["schemaId"], Resource.from_contents(document))
    schema = json.loads((domain / "schemas/tournament-race-result-v1.schema.json").read_text(encoding="utf-8"))
    assert list(Draft202012Validator(schema, registry=registry).iter_errors(result)) == []
    assert result["schemaVersion"] == "mk8dx.tournament-race-result.v1"
    assert result["trackId"] == "track.toad_harbour"
    assert [row["scoring"]["totalAfterRace"] for row in result["placements"]] == [15, 12]
    assert [row["scoring"]["rankAfterRace"] for row in result["placements"]] == [1, 2]
    assert all(row["participantReference"]["namespace"] == "unresolved_observation"
               for row in result["placements"])


def test_invalid_total_does_not_become_a_result():
    rows = deepcopy(confirmed_rows())
    rows[0]["Total After Race"] = 16
    with pytest.raises(CanonicalizationError, match="expected 15"):
        canonicalize_confirmed_rows(rows, source=source(), created_at_ms=1000)
