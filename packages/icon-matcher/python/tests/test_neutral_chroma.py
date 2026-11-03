from pathlib import Path
import sys

import numpy as np
import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mk8dx_icon_matcher.field_reader import FieldContext, read_field
from mk8dx_icon_matcher.matcher import Candidate, FamilyCandidate, IconMatcher, MatchResult, _Group
from mk8dx_icon_matcher.neutral_chroma import rank_neutral_reference


def _fixture():
    ids = ("character.neutral", "character.red", "character.blue")
    rgb = np.zeros((3, 48, 48, 3), np.float32)
    rgb[0] = .8
    rgb[1, :, :, 0] = 1
    rgb[2, :, :, 2] = 1
    masks = np.ones((3, 48, 48), np.float32)
    bank = type("Bank", (), {})()
    bank.catalog_sha256 = "a" * 64
    bank.groups = {("characters", "result"):
                   _Group(ids, ids, rgb, masks, masks.sum((1, 2)))}
    bank.display_names = {}
    bank.variant_slugs = {}
    bank.family = {rid: rid for rid in ids}
    matcher = IconMatcher(bank)
    candidates = tuple(Candidate(rid, rid, score)
                       for rid, score in zip(ids, (.91, .90, .70)))
    families = tuple(FamilyCandidate(item.family_id, item.score, (item,))
                     for item in candidates)
    visual = MatchResult(ids[0], ids[0], "accepted", .91, .01,
                         candidates, "rgb", "result", (0, 0), families)
    red_bgr = np.zeros((48, 48, 3), np.uint8)
    red_bgr[:, :, 2] = 255
    return matcher, visual, red_bgr


def test_neutral_chroma_is_an_opt_in_proposal_without_acceptance_change(monkeypatch):
    matcher, visual, red_bgr = _fixture()
    evidence = rank_neutral_reference(red_bgr, matcher, visual)
    assert evidence["status"] == "alternative"
    assert evidence["proposalId"] == "character.red"
    assert evidence["querySaturation"] == pytest.approx(1)
    assert evidence["referenceSaturation"] == 0
    monkeypatch.setattr(matcher, "match", lambda *args, **kwargs: visual)
    context = FieldContext("phone-camera", "result_card", "player")
    raw = read_field(red_bgr, "characters", "result", context, matcher)
    reviewed = read_field(red_bgr, "characters", "result", context, matcher,
                          neutral_chroma_review=True)
    assert "neutralChromaReview" not in raw
    assert reviewed["acceptedId"] == raw["acceptedId"] == "character.neutral"
    assert reviewed["top1Id"] == raw["top1Id"] == "character.neutral"
    assert reviewed["neutralChromaReview"]["proposalId"] == "character.red"
    assert reviewed["neutralChromaReview"]["cropPixelSha256"] == reviewed["cropPixelSha256"]


def test_neutral_chroma_excludes_yellow_and_requires_result_character():
    matcher, visual, red_bgr = _fixture()
    yellow_bgr = red_bgr.copy()
    yellow_bgr[:, :, 1] = 255
    evidence = rank_neutral_reference(yellow_bgr, matcher, visual)
    assert evidence["status"] == "insufficient_pixels"
    assert evidence["proposalId"] == visual.top[0].id
    with pytest.raises(ValueError, match="result character"):
        read_field(red_bgr, "bodies", "result",
                   FieldContext("direct_game", "result_card", "player"),
                   matcher, neutral_chroma_review=True)
