import json
import os
from pathlib import Path

import cv2
import jsonschema
import numpy as np
import pytest

from mk8dx_icon_matcher.ghost_panel import decide_ghost_select_frame, match_name

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
VECTORS = Path(os.environ.get("MK8DX_GHOST_SELECT_VECTORS", "private-qa/ghost-select-vectors-v1"))
CLEAN_ASSETS = Path(os.environ.get("MK8_CLEAN_ASSETS_ROOT", "clean-assets"))


def _description(**changes):
    base = {"schema": "mk8dx.frame-description.v1", "frame": "timetrial_ghost_select", "console": "switch1",
            "source": "hdmi", "image": {"width": 8, "height": 8}, "residual": 10.0,
            "fields": [{"field": "character", "slot": [0, 0, 4, 4]}]}
    base.update(changes)
    return base


def test_contract_schemas_are_valid_and_accept_the_description():
    for name in ("frame-description-v1", "frame-decision-v1"):
        jsonschema.Draft202012Validator.check_schema(
            json.loads((CONTRACTS / f"{name}.schema.json").read_text(encoding="utf-8")))
    schema = json.loads((CONTRACTS / "frame-description-v1.schema.json").read_text(encoding="utf-8"))
    jsonschema.validate(_description(), schema)


def test_decision_refuses_other_frames_sizes_and_candidate_scopes():
    image = np.zeros((8, 8, 3), np.uint8)
    with pytest.raises(ValueError, match="timetrial_ghost_select"):
        decide_ghost_select_frame(_description(frame="timetrial_end_screen"), image, None)
    with pytest.raises(ValueError, match="size"):
        decide_ghost_select_frame(_description(image={"width": 9, "height": 8}), image, None)
    scoped = _description(fields=[{"field": "character", "slot": [0, 0, 4, 4],
                                   "candidates": {"ids": ["character.mario"], "reason": "test_scope",
                                                  "fallback": "none"}}])
    with pytest.raises(ValueError, match="Candidate scopes"):
        decide_ghost_select_frame(scoped, image, None)


def test_printed_name_clue_needs_a_lead_over_other_names():
    names = {"body.standard_kart": "Standard Kart", "body.pipe_frame": "Pipe Frame"}
    rid, fuzzy, margin = match_name("Standard Kar", names)
    assert rid == "body.standard_kart" and fuzzy > 0.9 and margin > 0.15
    assert match_name("ab", names) == (None, 0.0, 0.0)


@pytest.mark.skipif(not (VECTORS / "index.json").exists() or not (CLEAN_ASSETS / "database.json").exists(),
                    reason="private Select-a-Ghost vectors unavailable")
def test_python_reproduces_the_recorded_vectors():
    from mk8dx_icon_matcher.matcher import IconMatcher, ReferenceBank
    index = json.loads((VECTORS / "index.json").read_text(encoding="utf-8"))
    matcher = IconMatcher(ReferenceBank(CLEAN_ASSETS))
    assert matcher.references.catalog_sha256 == index["catalogSha256"]
    for vector in index["vectors"][:6]:
        name = vector["name"]
        description = json.loads((VECTORS / f"{name}.description.json").read_text(encoding="utf-8"))
        want = json.loads((VECTORS / f"{name}.decision.json").read_text(encoding="utf-8"))
        image = cv2.imread(str(VECTORS / "canon" / f"{name}.png"), cv2.IMREAD_COLOR)
        got = json.loads(json.dumps(decide_ghost_select_frame(description, image, matcher)))
        # The decision is pinned; the version label moves with every reader release.
        got.pop("fieldSemanticsVersion")
        want.pop("fieldSemanticsVersion")
        assert got == want, name
