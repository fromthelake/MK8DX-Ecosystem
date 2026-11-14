"""Write public cross-runtime parity vectors from the Python reference (issue #99).

    python packages/icon-matcher/tools/generate_vectors.py [--pack DIR] [--only NAME] [--check]

Outputs in packages/icon-matcher/vectors/:

* ``context-v1.json``: ``combine_character`` and ``combine_part`` (context.py) over a small synthetic catalog
  and synthetic text clues, one case per branch and on the edges of every threshold band, plus the OCR
  text normalization that runs before them (``name_match.normalize``: full-width digits to ASCII). No pack
  needed.
* ``icon-score-v1.json``: the masked RGB icon rank (matcher.py) on synthetic query tensors made from the
  public recognition pack's own references (exact, shifted/noisy, blended and gate-boundary queries). Queries
  are box-sized uint8 RGB, base64, so every runtime reads them as bytes / 255 exactly. Needs the pack:
  ``node tooling/assets/materialize_collection.mjs recognition-pack <dir>`` then ``--pack <dir>`` (or
  MK8DX_RECOGNITION_PACK / MK8DX_SHARED_ICON_PACK).

Everything is deterministic (no RNG, sorted keys, LF); ``--check`` regenerates in memory and fails when a
committed file differs. Cases within 1e-5 of the 0.80 score or 0.02 margin gate carry ``"boundary": true``;
runtimes report rather than fail on those until the arithmetic is unified (Phase 2 of #99).
"""

from __future__ import annotations

import argparse
import base64
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent
sys.path.insert(0, str(PACKAGE / "python"))

from mk8dx_icon_matcher.context import Decision, TextClue, combine_character, combine_part  # noqa: E402
from mk8dx_icon_matcher.name_match import normalize  # noqa: E402
from mk8dx_icon_matcher.matcher import (  # noqa: E402
    Candidate, FamilyCandidate, IconMatcher, MatchResult, ReferenceBank, _Group)

VECTORS = PACKAGE / "vectors"
SCORE_GATE, MARGIN_GATE, BOUNDARY = 0.80, 0.02, 1e-5
MODES = ("center_shortlist", "center_then_shortlist")


def dump(document: dict) -> bytes:
    return (json.dumps(document, indent=1, sort_keys=True, ensure_ascii=True) + "\n").encode("ascii")


# --------------------------------------------------------------------------------------------- context-v1

CATALOG = {
    "characters": {
        "character.alpha": ["character.alpha", "character_variant.alpha.001_red", "character_variant.alpha.002_blue"],
        "character.beta": ["character.beta"],
        "character.gamma": ["character.gamma", "character_variant.gamma.001_green"],
    },
    "bodies": {
        "body.kart_a": ["body.kart_a", "body_variant.kart_a.001_red", "body_variant.kart_a.002_blue"],
        "body.kart_b": ["body.kart_b"],
        "body.kart_c": ["body.kart_c", "body_variant.kart_c.001_red"],
    },
    "gliders": {
        "glider.wing_a": ["glider.wing_a", "glider_variant.wing_a.001_red", "glider_variant.wing_a.002_blue"],
        "glider.wing_b": ["glider.wing_b"],
    },
    "tires": {"tire.round": ["tire.round"], "tire.slick": ["tire.slick"],
              "tire.knobby": ["tire.knobby"], "tire.wide": ["tire.wide"], "tire.offroad": ["tire.offroad"]},
}
TIRE_BY_INDEX = [[0, "tire.round"], [1, "tire.slick"], [2, "tire.knobby"], [3, "tire.wide"], [12, "tire.offroad"]]
PART_FOR_CHARACTER = [
    ["bodies", "body.kart_a", "character.beta", "body.kart_a"],
    ["bodies", "body.kart_a", "character_variant.alpha.001_red", "body_variant.kart_a.001_red"],
    ["bodies", "body.kart_a", "character_variant.alpha.002_blue", "body_variant.kart_a.002_blue"],
    ["bodies", "body.kart_c", "character.gamma", "body_variant.kart_c.001_red"],
    ["gliders", "glider.wing_a", "character.beta", "glider.wing_a"],
    ["gliders", "glider.wing_a", "character_variant.alpha.001_red", "glider_variant.wing_a.001_red"],
    ["gliders", "glider.wing_a", "character_variant.alpha.002_blue", "glider_variant.wing_a.002_blue"],
]
FAMILY = {member: family for kind in CATALOG.values() for family, members in kind.items() for member in members}


def context_bank(catalog: dict) -> ReferenceBank:
    """The duck-typed slice of ReferenceBank that context.py reads."""
    bank = ReferenceBank.__new__(ReferenceBank)
    bank.family = dict(catalog["familyById"])
    bank.tire_by_index = {index: rid for index, rid in catalog["tireByIndex"]}
    bank.part_for_character = {(kind, family, character): part
                               for kind, family, character, part in catalog["partForCharacter"]}
    bank.groups = {(kind, "result"): SimpleNamespace(ids=tuple(m["id"] for m in members),
                                                     families=tuple(m["familyId"] for m in members))
                   for kind, members in catalog["resultMembers"].items()}
    return bank


def visual_match(visual: dict) -> MatchResult:
    """A vector visual read as the MatchResult combine_* receive."""
    top = tuple(Candidate(c["id"], c["familyId"], c["score"]) for c in visual["top"])
    accepted = visual["status"] == "accepted"
    family_top = tuple(FamilyCandidate(f["familyId"], f["score"], ()) for f in visual["familyTop"])
    return MatchResult(top[0].id if accepted else None, top[0].family_id if accepted else None,
                       visual["status"], visual["score"], visual["margin"], top, "rgb", "result", (0, 0),
                       family_top)


def clue_of(clue: dict | None) -> TextClue | None:
    return None if clue is None else TextClue(clue["id"], clue["fuzzy"], clue["margin"])


def decision_json(decision: Decision) -> dict:
    return {"id": decision.id, "familyId": decision.family_id, "status": decision.status,
            "evidence": list(decision.evidence), "visualTop1": decision.visual_top1,
            "suggestedId": decision.suggested_id}


def run_context_case(case: dict, bank: ReferenceBank) -> dict:
    visual = visual_match(case["visual"])
    if case["rule"] == "character":
        return decision_json(combine_character(visual, clue_of(case["clue"]), bank))
    c = case["character"]
    character = Decision(c["id"], c["familyId"], c["status"], tuple(c["evidence"]), c["visualTop1"])
    return decision_json(combine_part(case["kind"], visual, character, clue_of(case["clue"]), bank,
                                      tire_text_top3_guard=case["tireTextTop3Guard"]))


def _visual(kind: str, status: str, top: list[tuple[str, float]], margin: float,
            family_second: float | None = None) -> dict:
    candidates = [{"id": rid, "familyId": FAMILY[rid], "score": score} for rid, score in top]
    family_top = [{"familyId": candidates[0]["familyId"], "score": top[0][1]}]
    if family_second is not None:
        other = next((c["familyId"] for c in candidates if c["familyId"] != candidates[0]["familyId"]),
                     "family.other")
        family_top.append({"familyId": other, "score": family_second})
    return {"kind": kind, "status": status, "score": top[0][1], "margin": margin,
            "top": candidates, "familyTop": family_top}


def _clue(rid: str, fuzzy: float, margin: float = 1.0) -> dict:
    return {"id": rid, "fuzzy": fuzzy, "margin": margin}


def _character(rid: str | None, status: str, visual_top1: str | None) -> dict:
    return {"id": rid, "familyId": FAMILY.get(rid) if rid else None, "status": status,
            "evidence": ["visual"], "visualTop1": visual_top1}


A, A_RED, A_BLUE = "character.alpha", "character_variant.alpha.001_red", "character_variant.alpha.002_blue"
B, G, G_GREEN = "character.beta", "character.gamma", "character_variant.gamma.001_green"
KA, KA_RED, KA_BLUE, KB = "body.kart_a", "body_variant.kart_a.001_red", "body_variant.kart_a.002_blue", "body.kart_b"
KC, KC_RED = "body.kart_c", "body_variant.kart_c.001_red"
WA, WA_RED, WA_BLUE, WB = "glider.wing_a", "glider_variant.wing_a.001_red", "glider_variant.wing_a.002_blue", "glider.wing_b"
ROUND, SLICK, KNOBBY, WIDE, OFFROAD = "tire.round", "tire.slick", "tire.knobby", "tire.wide", "tire.offroad"


def character_cases() -> list[tuple]:
    acc_red = _visual("characters", "accepted", [(A_RED, 0.91), (A_BLUE, 0.85), (A, 0.84)], 0.06, 0.70)
    unk_red = _visual("characters", "unknown", [(A_RED, 0.79), (A, 0.776), (B, 0.70)], 0.014, 0.70)
    return [
        ("char.variant_conflict", acc_red, _clue(A_BLUE, 0.89), False),
        ("char.variant_exact_fuzzy1", acc_red, _clue(A_BLUE, 1.0), True),
        ("char.same_id_exact_name", acc_red, _clue(A_RED, 0.92), False),
        ("char.unknown_variant_exact_name", unk_red, _clue(A_BLUE, 0.88), False),
        ("char.base_close_visual", unk_red, _clue(A, 0.95), False),
        ("char.base_gap_0.015_edge", _visual("characters", "unknown", [(A_RED, 0.795), (A, 0.78), (B, 0.6)],
                                             0.015, 0.6), _clue(A, 0.95), True),
        ("char.base_gap_0.0151", _visual("characters", "unknown", [(A_RED, 0.7951), (A, 0.78), (B, 0.6)],
                                         0.0151, 0.6), _clue(A, 0.95), True),
        ("char.base_score_0.80_edge", _visual("characters", "unknown", [(A_RED, 0.80), (A, 0.79), (B, 0.6)],
                                              0.01, 0.6), _clue(A, 0.95), True),
        ("char.base_not_in_top", _visual("characters", "accepted", [(A_RED, 0.86), (A_BLUE, 0.80), (B, 0.6)],
                                         0.06, 0.6), _clue(A, 0.95), False),
        ("char.base_name_on_base_top", _visual("characters", "accepted", [(A, 0.9), (A_RED, 0.8), (B, 0.6)],
                                               0.1, 0.6), _clue(A, 0.95), False),
        ("char.cross_family_low_score", _visual("characters", "accepted", [(B, 0.84), (G, 0.70)], 0.14, 0.70),
         _clue(G_GREEN, 0.93), False),
        ("char.cross_family_low_margin", _visual("characters", "accepted", [(B, 0.90), (G, 0.851)], 0.049, 0.851),
         _clue(G, 0.90), True),
        ("char.cross_family_fuzzy_0.8999", _visual("characters", "unknown", [(B, 0.70), (G, 0.69)], 0.01, 0.69),
         _clue(G, 0.8999), True),
        ("char.cross_family_visual_strong", _visual("characters", "accepted", [(B, 0.85), (G, 0.80)], 0.05, 0.80),
         _clue(G, 0.97), True),
        ("char.strong_edge_0.85_0.08", unk_red, _clue(A_BLUE, 0.85, 0.08), True),
        ("char.weak_fuzzy_0.8499", unk_red, _clue(A_BLUE, 0.8499, 0.5), True),
        ("char.weak_margin_0.0799", acc_red, _clue(B, 0.99, 0.0799), True),
        ("char.unknown_clue_id", acc_red, _clue("character.not_in_catalog", 0.99), False),
        ("char.no_clue_accepted", acc_red, None, False),
        ("char.no_clue_unknown", unk_red, None, False),
    ]


def part_cases() -> list[tuple]:
    char_red = _character(A_RED, "accepted", A_RED)
    char_beta = _character(B, "accepted", B)
    char_gamma = _character(G, "accepted", G)
    char_none = _character(None, "unknown", None)
    char_unacc_blue = _character(None, "unknown", A_BLUE)
    char_sugg_blue = _character(None, "suggested", A_BLUE)
    char_sugg_beta = _character(None, "suggested", B)
    char_conflict_blue = _character(None, "conflict", A_BLUE)
    char_red_not_accepted = _character(A_RED, "unknown", A_RED)
    glider_acc_blue = _visual("gliders", "accepted", [(WA_BLUE, 0.92), (WA, 0.88), (WA_RED, 0.86)], 0.04, 0.6)
    glider_single = _visual("gliders", "accepted", [(WB, 0.90), (WA, 0.84), (WA_RED, 0.83)], 0.06, 0.84)
    body_acc = _visual("bodies", "accepted", [(KA, 0.90), (KA_RED, 0.86), (KB, 0.70)], 0.04, 0.70)
    body_acc_no_red = _visual("bodies", "accepted", [(KA, 0.92), (KA_BLUE, 0.88), (KB, 0.80)], 0.04, 0.80)
    body_single = _visual("bodies", "accepted", [(KB, 0.90), (KA, 0.84), (KA_RED, 0.83)], 0.06, 0.84)
    body_unk = _visual("bodies", "unknown", [(KA_BLUE, 0.83), (KA_RED, 0.82), (KA, 0.81)], 0.01, 0.70)
    glider_acc = _visual("gliders", "accepted", [(WA, 0.92), (WA_RED, 0.88), (WA_BLUE, 0.86)], 0.04, 0.60)
    glider_acc_no_red = _visual("gliders", "accepted", [(WA, 0.92), (WA_BLUE, 0.88), (WB, 0.80)], 0.04, 0.80)
    glider_unk = _visual("gliders", "unknown", [(WA_BLUE, 0.84), (WA, 0.83), (WB, 0.825)], 0.01, 0.825)
    glider_unk_wide = _visual("gliders", "unknown", [(WA_BLUE, 0.84), (WA, 0.83), (WB, 0.80)], 0.01, 0.80)
    tire_acc = _visual("tires", "accepted", [(ROUND, 0.88), (SLICK, 0.84), (KNOBBY, 0.80)], 0.04, 0.84)
    tire_unk = _visual("tires", "unknown", [(ROUND, 0.80), (SLICK, 0.79), (KNOBBY, 0.70)], 0.01, 0.79)
    return [
        # moderately legible text contradicting the visual family
        ("part.body_text_conflict", "bodies", body_acc, char_none, _clue(KB, 0.70, 0.20), False, False),
        ("part.body_text_conflict_edge_0.65_0.15", "bodies", body_acc, char_none, _clue(KB, 0.65, 0.15), False, True),
        ("part.body_text_below_0.6499", "bodies", body_acc, char_none, _clue(KB, 0.6499, 0.5), False, True),
        ("part.body_text_margin_0.1499", "bodies", body_acc, char_none, _clue(KB, 0.80, 0.1499), False, True),
        ("part.body_text_same_family", "bodies", body_acc, char_none, _clue(KA_RED, 0.70, 0.20), False, False),
        ("part.tire_numeric_text_conflict", "tires", tire_acc, char_none, _clue("2", 0.75, 0.40), False, False),
        # tyre row numbers
        ("part.tire_text_strong", "tires", tire_unk, char_none, _clue("3", 0.90, 0.20), False, False),
        ("part.tire_text_guard_outside_top3", "tires", tire_unk, char_none, _clue("3", 0.90, 0.20), True, False),
        ("part.tire_text_guard_inside_top3", "tires", tire_unk, char_none, _clue("2", 0.90, 0.20), True, False),
        ("part.tire_text_unknown_index", "tires", tire_acc, char_none, _clue("9", 0.90, 0.20), False, False),
        ("part.tire_medium_text", "tires", tire_unk, char_none, _clue("0", 0.75, 0.40), False, False),
        ("part.tire_medium_text_edges", "tires", tire_unk, char_none, _clue("0", 0.70, 0.30), False, True),
        ("part.tire_medium_text_fuzzy_0.6999", "tires", tire_unk, char_none, _clue("0", 0.6999, 0.40), False, True),
        ("part.tire_medium_text_visual_margin_0.0099", "tires",
         _visual("tires", "unknown", [(ROUND, 0.80), (SLICK, 0.7901), (KNOBBY, 0.70)], 0.0099, 0.7901),
         char_none, _clue("0", 0.75, 0.40), False, True),
        ("part.tire_medium_text_visual_score_0.7999", "tires",
         _visual("tires", "unknown", [(ROUND, 0.7999), (SLICK, 0.70), (KNOBBY, 0.60)], 0.0999, 0.70),
         char_none, _clue("0", 0.75, 0.40), False, True),
        # numeric clue IDs are ASCII 0-9 only; full-width digits are folded at the OCR boundary
        ("part.tire_unicode_digit", "tires", tire_unk, char_none, _clue("٣", 0.90, 0.20), False, False),
        ("part.tire_arabic_indic_index_12", "tires", tire_unk, char_none, _clue("١٢", 0.90, 0.20), False, False),
        ("part.tire_fullwidth_index_12", "tires", tire_unk, char_none, _clue("１２", 0.90, 0.20), False, False),
        ("part.tire_ascii_index_12", "tires", tire_unk, char_none, _clue("12", 0.90, 0.20), False, False),
        # strong text family
        ("part.body_text_family_same", "bodies", body_acc, char_none, _clue(KA, 0.95, 0.20), False, False),
        ("part.body_text_other_family_relation", "bodies", body_acc, char_gamma, _clue(KC, 0.95, 0.20), False, False),
        ("part.body_text_other_family_unique", "bodies", body_acc, char_none, _clue(KB, 0.95, 0.20), False, False),
        ("part.body_text_other_family_only", "bodies", body_acc, char_none, _clue(KC, 0.95, 0.20), False, False),
        ("part.body_text_other_variant_unknown", "bodies", body_acc, char_none, _clue(KC_RED, 0.95, 0.20), False, False),
        # character relations
        ("part.body_relation_unknown_visual", "bodies", body_unk, char_red, None, False, False),
        ("part.body_relation_base", "bodies", body_unk, char_beta, None, False, False),
        ("part.body_relation_score_below", "bodies",
         _visual("bodies", "unknown", [(KA_BLUE, 0.7999), (KA_RED, 0.79), (KA, 0.78)], 0.0099, 0.70),
         char_red, None, False, True),
        ("part.body_accepted_character_top3_variant", "bodies", body_acc, char_red, None, False, False),
        ("part.glider_relation_weak_family_review", "gliders", glider_unk, char_red, None, False, False),
        ("part.glider_relation_family_margin_0.02_edge", "gliders",
         _visual("gliders", "unknown", [(WA_BLUE, 0.84), (WA, 0.83), (WB, 0.82)], 0.01, 0.82),
         char_red, None, False, True),
        ("part.glider_relation_wide_family", "gliders", glider_unk_wide, char_red, None, False, False),
        ("part.glider_relation_strong_text", "gliders", glider_unk, char_red, _clue(WA, 0.95, 0.2), False, False),
        ("part.glider_relation_single_family", "gliders",
         _visual("gliders", "unknown", [(WA_BLUE, 0.84), (WA, 0.83), (WA_RED, 0.82)], 0.01), char_red, None,
         False, False),
        ("part.glider_top3_variant", "gliders", glider_acc, char_red, _clue(WA, 0.95, 0.2), False, False),
        ("part.glider_top3_variant_missing", "gliders", glider_acc_no_red, char_red, _clue(WA, 0.95, 0.2), False, False),
        ("part.glider_top3_variant_variant_clue", "gliders", glider_acc, char_red, _clue(WA_RED, 0.95, 0.2), False, False),
        # text-supported variants and family-only
        ("part.body_text_supported_variant", "bodies",
         _visual("bodies", "unknown", [(KA_BLUE, 0.76), (KA_RED, 0.75), (KA, 0.70)], 0.01, 0.6),
         char_none, _clue(KA, 0.95, 0.2), False, True),
        ("part.body_text_supported_variant_0.7499", "bodies",
         _visual("bodies", "unknown", [(KA_BLUE, 0.7499), (KA_RED, 0.70), (KA, 0.69)], 0.0499, 0.6),
         char_none, _clue(KA, 0.95, 0.2), False, True),
        ("part.body_family_only_variant_clue", "bodies",
         _visual("bodies", "unknown", [(KA_BLUE, 0.7499), (KA_RED, 0.70), (KA, 0.69)], 0.0499, 0.6),
         char_none, _clue(KA_RED, 0.95, 0.2), False, False),
        # glider colour follows the character (#99 phase 2)
        ("part.glider_accepted_character_visual_clash", "gliders", glider_acc_no_red, char_red, None, False, False),
        ("part.glider_accepted_character_top3_no_clue", "gliders", glider_acc, char_red, None, False, False),
        ("part.glider_accepted_character_same_colour", "gliders",
         _visual("gliders", "accepted", [(WA_RED, 0.92), (WA, 0.88), (WA_BLUE, 0.86)], 0.04, 0.6),
         char_red, None, False, False),
        ("part.glider_accepted_character_no_link", "gliders", glider_acc_blue, char_gamma, None, False, False),
        ("part.glider_single_colour_unaccepted_character", "gliders", glider_single, char_sugg_blue, None,
         False, False),
        ("part.glider_single_colour_accepted_character", "gliders", glider_single, char_red, None, False, False),
        ("part.glider_suggested_character_no_clue", "gliders", glider_acc, char_sugg_blue, None, False, False),
        ("part.glider_suggested_character_base_colour", "gliders", glider_acc_blue, char_sugg_beta, None,
         False, False),
        ("part.glider_conflict_character", "gliders", glider_acc, char_conflict_blue, None, False, False),
        ("part.glider_character_id_not_accepted", "gliders", glider_acc_blue, char_red_not_accepted, None,
         False, False),
        ("part.glider_no_character", "gliders", glider_acc, char_none, None, False, False),
        ("part.glider_unaccepted_character_unknown_visual", "gliders", glider_unk_wide, char_sugg_blue, None,
         False, False),
        # body colour follows the character too (#99 owner amendment)
        ("part.body_accepted_character_visual_clash", "bodies", body_acc_no_red, char_red, None, False, False),
        ("part.body_accepted_character_visual_clash_text", "bodies", body_acc_no_red, char_red,
         _clue(KA, 0.95, 0.2), False, False),
        ("part.body_accepted_character_same_colour", "bodies",
         _visual("bodies", "accepted", [(KA_RED, 0.92), (KA, 0.88), (KA_BLUE, 0.86)], 0.04, 0.6),
         char_red, None, False, False),
        ("part.body_accepted_character_no_link", "bodies", body_acc, char_gamma, None, False, False),
        ("part.body_suggested_character_clash", "bodies", body_acc, char_sugg_blue, None, False, False),
        ("part.body_unknown_character_clash", "bodies", body_acc_no_red, char_unacc_blue, None, False, False),
        ("part.body_conflict_character_clash", "bodies", body_acc, char_conflict_blue, None, False, False),
        ("part.body_character_id_not_accepted", "bodies", body_acc, char_red_not_accepted, None, False, False),
        ("part.body_suggested_character_text", "bodies", body_acc, char_sugg_blue, _clue(KA, 0.95, 0.2),
         False, False),
        ("part.body_single_colour_unaccepted_character", "bodies", body_single, char_sugg_blue, None,
         False, False),
        ("part.body_unaccepted_character_unknown_visual", "bodies", body_unk, char_sugg_blue, None, False, False),
        # unaccepted character + printed family name: the icon's own colour stands (owner option 2, #173);
        # the unaccepted character neither supplies nor vetoes a colour
        ("part.glider_unaccepted_character_conflict", "gliders", glider_acc, char_unacc_blue, _clue(WA, 0.95, 0.2),
         False, False),
        ("part.glider_suggested_character_conflict", "gliders", glider_acc, char_sugg_blue, _clue(WA, 0.95, 0.2),
         False, False),
        ("part.glider_unaccepted_character_same_colour", "gliders",
         _visual("gliders", "accepted", [(WA_BLUE, 0.92), (WA, 0.88), (WA_RED, 0.86)], 0.04, 0.6),
         char_unacc_blue, _clue(WA, 0.95, 0.2), False, False),
        # no text
        ("part.no_clue_accepted", "bodies", body_acc, char_none, None, False, False),
        ("part.no_clue_unknown_tire", "tires", tire_unk, char_none, None, False, False),
    ]


# OCR text before the context rules (name_match.normalize): full-width digits become ASCII, other
# digit scripts stay what they are (and are then no numeric clue ID).
OCR_NORMALIZATION = ["１２", "Ｒｏｗ　１２", "١٢", "٣", "12", "Ｂ-Dash ０"]


def build_context() -> dict:
    catalog = {
        "familyById": dict(sorted(FAMILY.items())),
        "resultMembers": {kind: [{"id": member, "familyId": family}
                                 for family, members in CATALOG[kind].items() for member in members]
                          for kind in ("bodies", "gliders", "tires")},
        "partForCharacter": PART_FOR_CHARACTER,
        "tireByIndex": TIRE_BY_INDEX,
    }
    bank = context_bank(catalog)
    cases = []
    for name, visual, clue, boundary in character_cases():
        case = {"id": name, "rule": "character", "kind": "characters", "visual": visual, "clue": clue,
                "boundary": boundary}
        case["expected"] = run_context_case(case, bank)
        cases.append(case)
    for name, kind, visual, character, clue, guard, boundary in part_cases():
        case = {"id": name, "rule": "part", "kind": kind, "visual": visual, "character": character,
                "clue": clue, "tireTextTop3Guard": guard, "boundary": boundary}
        case["expected"] = run_context_case(case, bank)
        cases.append(case)
    normalization = [{"text": text, "normalized": normalize(text)} for text in OCR_NORMALIZATION]
    ids = [case["id"] for case in cases]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate context case id")
    return {"schema": "mk8dx.context-vectors.v1",
            "source": "packages/icon-matcher/python/mk8dx_icon_matcher/context.py",
            "generator": "packages/icon-matcher/tools/generate_vectors.py",
            "catalog": catalog, "cases": cases, "ocrNormalization": normalization}


# ------------------------------------------------------------------------------------------ icon-score-v1

GROUP_KEYS = ("characters__result", "characters__scoreboard", "characters__ghost_select", "bodies__result",
              "tires__result", "gliders__result", "flags__result")


def tensor_dir(pack: str | None) -> Path | None:
    if pack:
        root = Path(pack)
        return root / "tensor-pack" if (root / "tensor-pack").is_dir() else root
    if os.environ.get("MK8DX_SHARED_ICON_PACK"):
        return Path(os.environ["MK8DX_SHARED_ICON_PACK"])
    if os.environ.get("MK8DX_RECOGNITION_PACK"):
        return Path(os.environ["MK8DX_RECOGNITION_PACK"]) / "tensor-pack"
    return None


def load_tensor_pack(directory: Path, keys=GROUP_KEYS) -> tuple[dict, ReferenceBank, dict]:
    """The pack's sha-pinned tensors as a ReferenceBank slice (equal to the PNG-built bank, see
    test_reference_bank_matches_pack.py)."""
    manifest = json.loads((directory / "references.json").read_text(encoding="utf-8"))
    bank = ReferenceBank.__new__(ReferenceBank)
    bank.groups, hashes = {}, {}
    for key in keys:
        spec = manifest["groups"][key]
        width, height = spec["size"]
        n = len(spec["ids"])
        data = {}
        for part in ("rgb", "mask", "count"):
            raw = (directory / spec["tensors"][part]["file"]).read_bytes()
            if sha256(raw).hexdigest() != spec["tensors"][part]["sha256"]:
                raise ValueError(f"tensor checksum mismatch: {key} {part}")
            data[part] = raw
        hashes[key] = {part: spec["tensors"][part]["sha256"] for part in ("rgb", "mask", "count")}
        rgb = np.frombuffer(data["rgb"], dtype="<f4").reshape(n, height, width, 3).astype(np.float32)
        mask = np.frombuffer(data["mask"], dtype=np.uint8).reshape(n, height, width).astype(np.float32)
        count = np.frombuffer(data["count"], dtype="<f4").astype(np.float32)
        kind, profile = key.split("__")
        bank.groups[(kind, profile)] = _Group(tuple(spec["ids"]), tuple(spec["families"]), rgb, mask, count)
    return manifest, bank, hashes


def match_json(result: MatchResult) -> dict:
    family_margin = (result.family_top[0].score - result.family_top[1].score
                     if len(result.family_top) > 1 else None)
    return {"status": result.status, "top1Id": result.top[0].id, "acceptedId": result.id,
            "score": result.score, "margin": result.margin, "familyMargin": family_margin,
            "offset": list(result.offset),
            "top": [{"id": c.id, "familyId": c.family_id, "score": c.score} for c in result.top]}


def python_match(matcher: IconMatcher, key: str, query_rgb: np.ndarray, mode: str) -> dict:
    kind, profile = key.split("__")
    return match_json(matcher.match(np.ascontiguousarray(query_rgb[:, :, ::-1]), kind, profile=profile,
                                    search_mode=mode))


def decode_query(case: dict) -> np.ndarray:
    width, height = case["size"]
    return np.frombuffer(base64.b64decode(case["query"]), dtype=np.uint8).reshape(height, width, 3)


def flags_of(expected: dict) -> dict:
    boundary = any(abs(e["score"] - SCORE_GATE) < BOUNDARY or abs(e["margin"] - MARGIN_GATE) < BOUNDARY
                   for e in expected.values())
    near_tie = any(abs(a - b) < 1e-6 and a != b for e in expected.values()
                   for a, b in zip([c["score"] for c in e["top"]], [c["score"] for c in e["top"]][1:]))
    return {"boundary": bool(boundary), "nearTie": bool(near_tie)}


def _lcg_noise(shape: tuple[int, ...], seed: int, amplitude: int) -> np.ndarray:
    """Integer noise in [-amplitude, amplitude] from a fixed 32-bit LCG (platform and library independent)."""
    out = np.empty(int(np.prod(shape)), dtype=np.int16)
    state = seed & 0xFFFFFFFF
    span = 2 * amplitude + 1
    for i in range(out.size):
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        out[i] = (state >> 16) % span - amplitude
    return out.reshape(shape)


def _shift(image: np.ndarray, dx: int, dy: int) -> np.ndarray:
    height, width = image.shape[:2]
    ys = np.clip(np.arange(height) - dy, 0, height - 1)
    xs = np.clip(np.arange(width) - dx, 0, width - 1)
    return image[ys][:, xs]


def _u8(values: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(values), 0, 255).astype(np.uint8)


class QueryFactory:
    def __init__(self, matcher: IconMatcher, key: str):
        kind, profile = key.split("__")
        self.matcher, self.key = matcher, key
        self.group = matcher.references.groups[(kind, profile)]

    def ref(self, index: int) -> np.ndarray:
        return self.group.rgb[index] * 255.0

    def score(self, query: np.ndarray) -> dict:
        return python_match(self.matcher, self.key, query, "center_shortlist")

    def neighbour(self, index: int, same_family: bool) -> int:
        """The reference closest to ``index`` at the centre, inside or outside its family."""
        values = IconMatcher._score(self.group.rgb[index], self.group, "rgb")
        family = self.group.families[index]
        order = [int(i) for i in np.argsort(-values, kind="stable") if int(i) != index]
        pick = [i for i in order if (self.group.families[i] == family) == same_family]
        return pick[0] if pick else order[0]

    def score_boundary(self, index: int, above: bool) -> np.ndarray:
        """Move masked channels of one reference away from it until its score sits on the 0.80 gate."""
        base = _u8(self.ref(index)).astype(np.int32)
        mask = self.group.mask[index] > 0
        positions = [(y, x, c) for y, x in zip(*np.nonzero(mask)) for c in range(3)]
        room = [(255 - base[p]) if base[p] < 128 else -base[p] for p in positions]
        target = 0.80 + (2e-6 if above else -2e-6)

        def build(units: int) -> np.ndarray:
            query = base.copy()
            left = units
            for p, r in zip(positions, room):
                if left <= 0:
                    break
                step = min(abs(r), left)
                query[p] += step if r > 0 else -step
                left -= step
            return query.astype(np.uint8)

        count = float(self.group.count[index])
        units = int(round((1 - target) * (3 * count) * 255))
        best = None
        for _ in range(12):
            query = build(units)
            score = self.score(query)["score"]
            if best is None or abs(score - target) < abs(best[0] - target):
                best = (score, query)
            if abs(score - target) < 1e-6 and (score >= SCORE_GATE) == above:
                break
            units += int(round((score - target) * 3 * count * 255)) or (1 if score > target else -1)
        return best[1]

    def margin_boundary(self, index: int, other: int, above: bool) -> np.ndarray:
        """Blend toward a neighbouring reference until the decision margin sits on the 0.02 gate."""
        a, b = self.ref(index), self.ref(other)
        target = 0.02 + (2e-6 if above else -2e-6)
        low, high = 0.0, 0.5
        best = None
        for _ in range(40):
            t = (low + high) / 2
            query = _u8((1 - t) * a + t * b)
            margin = self.score(query)["margin"]
            if best is None or abs(margin - target) < abs(best[0] - target):
                best = (margin, query)
            if margin > target:
                low = t
            else:
                high = t
        return best[1]


PLAN = {
    "characters__result": dict(picks=(0.0, 0.37, 0.71), boundary=True),
    "characters__scoreboard": dict(picks=(0.13, 0.55), boundary=False),
    "characters__ghost_select": dict(picks=(0.21, 0.83), boundary=False),
    "bodies__result": dict(picks=(0.05, 0.6), boundary=True),
    "tires__result": dict(picks=(0.0, 0.5), boundary=True),
    "gliders__result": dict(picks=(0.1, 0.65), boundary=True),
    "flags__result": dict(picks=(0.0, 0.5), boundary=True),
}


def icon_queries(matcher: IconMatcher, key: str) -> list[tuple[str, np.ndarray]]:
    factory = QueryFactory(matcher, key)
    n = len(factory.group.ids)
    out = []
    plan = PLAN[key]
    for number, fraction in enumerate(plan["picks"]):
        index = min(n - 1, int(fraction * n))
        rid = factory.group.ids[index]
        ref = factory.ref(index)
        sibling = factory.neighbour(index, same_family=True)
        stranger = factory.neighbour(index, same_family=False)
        if number == 0:
            out.append((f"{rid}/exact", _u8(ref)))
        noise = _lcg_noise(ref.shape, seed=1000 * number + len(key), amplitude=6)
        out.append((f"{rid}/shift_gain_noise", _u8(_shift(ref, 1, -1) * 0.93 + noise)))
        if number == 0:
            out.append((f"{rid}/sibling_blend_0.5", _u8(0.5 * ref + 0.5 * factory.ref(sibling))))
            out.append((f"{rid}/stranger_blend_0.35",
                        _u8(0.65 * ref + 0.35 * factory.ref(stranger) + _lcg_noise(ref.shape, 7, 3))))
            if plan["boundary"]:
                out.append((f"{rid}/score_gate_above", factory.score_boundary(index, True)))
                out.append((f"{rid}/score_gate_below", factory.score_boundary(index, False)))
                out.append((f"{rid}/margin_gate_above", factory.margin_boundary(index, sibling, True)))
                out.append((f"{rid}/margin_gate_below", factory.margin_boundary(index, sibling, False)))
    unique, seen = [], set()
    for name, query in out:
        if query.tobytes() not in seen:
            seen.add(query.tobytes())
            unique.append((name, query))
    return unique


def build_icon_score(directory: Path) -> dict:
    manifest, bank, hashes = load_tensor_pack(directory)
    matcher = IconMatcher(bank)
    cases = []
    for key in GROUP_KEYS:
        for name, query in icon_queries(matcher, key):
            case = {"id": f"{key}/{name}", "group": key, "size": [int(query.shape[1]), int(query.shape[0])],
                    "query": base64.b64encode(np.ascontiguousarray(query).tobytes()).decode("ascii")}
            case["expected"] = {mode: python_match(matcher, key, query, mode) for mode in MODES}
            case.update(flags_of(case["expected"]))
            cases.append(case)
    return {"schema": "mk8dx.icon-score-vectors.v1",
            "source": "packages/icon-matcher/python/mk8dx_icon_matcher/matcher.py",
            "generator": "packages/icon-matcher/tools/generate_vectors.py",
            "catalogSha256": manifest["catalogSha256"], "tensors": hashes,
            "query": "box-sized uint8 RGB, row-major, base64; the runtime query tensor is bytes / 255 (float32)",
            "gates": {"score": SCORE_GATE, "margin": MARGIN_GATE, "boundary": BOUNDARY},
            "cases": cases}


# --------------------------------------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--pack", help="materialized recognition-pack directory (or its tensor-pack/)")
    parser.add_argument("--only", choices=("context", "icon-score"))
    parser.add_argument("--out", default=str(VECTORS))
    parser.add_argument("--check", action="store_true", help="fail when a committed vector differs")
    args = parser.parse_args(argv)
    outputs = {}
    if args.only in (None, "context"):
        outputs["context-v1.json"] = dump(build_context())
    if args.only in (None, "icon-score"):
        directory = tensor_dir(args.pack)
        if directory is None or not (directory / "references.json").is_file():
            if args.only == "icon-score":
                parser.error("icon-score needs --pack (a materialized recognition pack)")
            print("skip icon-score-v1.json: no recognition pack", file=sys.stderr)
        else:
            outputs["icon-score-v1.json"] = dump(build_icon_score(directory))
    status = 0
    for name, data in outputs.items():
        target = Path(args.out) / name
        if args.check:
            same = target.is_file() and target.read_bytes() == data
            print(f"{'ok' if same else 'DIFFERS'} {name}")
            status |= 0 if same else 1
        else:
            target.write_bytes(data)
            print(f"wrote {name} ({len(data)} bytes, {len(json.loads(data)['cases'])} cases)")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
