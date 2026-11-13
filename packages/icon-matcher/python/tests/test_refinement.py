from pathlib import Path
import sys

import numpy as np
import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mk8dx_icon_matcher.matcher import Candidate, FamilyCandidate, IconMatcher, MatchResult, _Group
from mk8dx_icon_matcher.refinement import refine_family_variants, rank_family_colour_space
from mk8dx_icon_matcher.context import Decision
from mk8dx_icon_matcher.field_reader import FieldContext, read_field
import mk8dx_icon_matcher.field_reader as field_reader
from tooling.review.family_colour_space_probe import rank as diagnostic_colour_rank


def test_colour_pass_can_disagree_without_changing_primary_acceptance(monkeypatch):
    ids = ("glider.test.red", "glider.test.green", "glider.test.blue")
    colours = np.zeros((3, 50, 80, 3), np.float32)
    for index in range(3):
        colours[index, :, :, index] = 1
    masks = np.ones((3, 50, 80), np.float32)
    bank = type("Bank", (), {})()
    bank.catalog_sha256 = "a" * 64
    bank.groups = {("gliders", "result"): _Group(ids, ("glider.test",) * 3,
                                                   colours, masks, masks.sum((1, 2)))}
    matcher = IconMatcher(bank)
    candidates = tuple(Candidate(rid, "glider.test", score)
                       for rid, score in zip(ids, (.91, .90, .89)))
    primary = MatchResult(ids[0], "glider.test", "accepted", .91, .01,
                          candidates, "rgb", "result", (0, 0),
                          (FamilyCandidate("glider.test", .91, candidates),))
    blue_bgr = np.zeros((50, 80, 3), np.uint8)
    blue_bgr[:, :, 0] = 255
    fine = refine_family_variants(blue_bgr, "gliders", matcher, primary)
    assert fine.status == "measured" and fine.observed_pixels == 4000
    assert fine.primary_top1 == ids[0] and fine.ordered[0].id == ids[2]
    assert primary.id == ids[0] and primary.status == "accepted"
    monkeypatch.setattr(matcher, "match", lambda *args, **kwargs: primary)
    monkeypatch.setattr(field_reader, "QUALIFIED_COLOUR_REVIEW_FAMILIES",
                        frozenset({("gliders", "glider.test")}))
    # An accepted character without a catalog colour for this glider: the icon decides (#99 rule 3).
    bank.part_for_character = {}
    bank.family = dict.fromkeys(ids, "glider.test")
    character = Decision("character.test", "character.test", "accepted", ("visual",), "character.test")
    context = FieldContext("direct_game", "result_card", "player", character=character)
    default = read_field(blue_bgr, "gliders", "result", context, matcher)
    reviewed = read_field(blue_bgr, "gliders", "result", context, matcher,
                          variant_colour_review=True)
    assert default["acceptedId"] == ids[0] and "variantColourRead" not in default
    assert reviewed["status"] == "suggested" and reviewed["acceptedId"] is None
    assert reviewed["top1Id"] == reviewed["visualRead"]["acceptedId"] == ids[0]
    assert reviewed["suggestion"]["id"] == ids[2]
    assert reviewed["variantColourRead"]["ordered"][0]["id"] == ids[2]
    assert reviewed["variantColourRead"]["metric"] == "hue"
    assert reviewed["variantColourRead"]["ordered"][0]["hueDistance"] is not None
    assert "variant_colour_disagreement" in reviewed["evidence"]
    grey = np.full((50, 80, 3), 100, np.uint8)
    assert refine_family_variants(grey, "gliders", matcher, primary).status == "insufficient_colour"
    grey_review = read_field(grey, "gliders", "result", context, matcher,
                             variant_colour_review=True)
    assert grey_review["acceptedId"] == ids[0]
    assert grey_review["variantColourRead"]["status"] == "insufficient_colour"
    red_bgr = np.zeros((50, 80, 3), np.uint8)
    red_bgr[:, :, 2] = 255
    agreeing = read_field(red_bgr, "gliders", "result", context, matcher,
                          variant_colour_review=True)
    assert agreeing["acceptedId"] == ids[0]
    assert agreeing["variantColourRead"]["ordered"][0]["id"] == ids[0]
    with pytest.raises(ValueError, match="positive"):
        refine_family_variants(blue_bgr, "gliders", matcher, primary, min_pixels=0)


def test_fourth_family_variant_remains_eligible_for_colour_pass(monkeypatch):
    ids = tuple(f"character.test.{colour}" for colour in
                ("red", "green", "blue", "cyan"))
    colours = np.zeros((4, 48, 48, 3), np.float32)
    colours[0, :, :, 0] = 1
    colours[1, :, :, 1] = 1
    colours[2, :, :, 2] = 1
    colours[3, :, :, 1:] = 1
    masks = np.ones((4, 48, 48), np.float32)
    bank = type("Bank", (), {})()
    bank.catalog_sha256 = "b" * 64
    bank.groups = {("characters", "result"):
                   _Group(ids, ("character.test",) * 4,
                          colours, masks, masks.sum((1, 2)))}
    matcher = IconMatcher(bank)
    red_bgr = np.zeros((48, 48, 3), np.uint8)
    red_bgr[:, :, 2] = 255
    actual = matcher.match(red_bgr, "characters", profile="result")
    assert len(actual.family_top[0].variants) == 4
    primary_candidates = tuple(Candidate(rid, "character.test", score)
                               for rid, score in zip(ids, (.91, .90, .89, .88)))
    primary = MatchResult(ids[0], "character.test", "accepted", .91, .01,
                          primary_candidates[:3], "rgb", "result", (0, 0),
                          (FamilyCandidate("character.test", .91,
                                           primary_candidates),))
    cyan_bgr = np.zeros((48, 48, 3), np.uint8)
    cyan_bgr[:, :, :2] = 255
    fine = refine_family_variants(cyan_bgr, "characters", matcher, primary)
    assert len(fine.ordered) == 4 and fine.ordered[0].id == ids[3]
    monkeypatch.setattr(matcher, "match", lambda *args, **kwargs: primary)
    reviewed = read_field(cyan_bgr, "characters", "result",
                          FieldContext("direct_game", "result_card", "player"),
                          matcher, variant_colour_review=True)
    assert len(reviewed["rankedFamilies"][0]["variants"]) == 3
    assert reviewed["acceptedId"] == ids[0]
    assert reviewed["variantColourRead"]["ordered"][0]["id"] == ids[3]


def test_dark_yoshi_uses_eroded_alpha_cutout_and_keeps_background_out():
    ids = ("character_variant.yoshi.018_black",
           "character_variant.yoshi.017_light_blue")
    rgb = np.zeros((2, 48, 48, 3), np.float32)
    rgb[0, 8:40, 8:40] = (.14, .15, .16)
    rgb[1, 8:40, 8:40] = (.08, .65, .95)
    masks = np.zeros((2, 48, 48), np.float32)
    masks[:, 8:40, 8:40] = 1
    bank = type("Bank", (), {})()
    bank.groups = {("characters", "result"):
                   _Group(ids, ("character.yoshi",) * 2, rgb, masks,
                          masks.sum((1, 2)))}
    matcher = IconMatcher(bank)
    candidates = tuple(Candidate(rid, "character.yoshi", score)
                       for rid, score in zip(ids, (.85, .84)))
    primary = MatchResult(ids[0], "character.yoshi", "accepted", .85, .01,
                          candidates, "rgb", "result", (0, 0),
                          (FamilyCandidate("character.yoshi", .85, candidates),))
    crop = np.full((48, 48, 3), (255, 200, 20), np.uint8)
    crop[8:40, 8:40] = (65, 35, 18)  # dark navy in BGR, not bright blue
    crop[8:9, 8:40] = (255, 200, 20)  # colour bleed on the cutout edge
    fine = refine_family_variants(crop, "characters", matcher, primary)
    assert fine.metric == "cutout_rgb" and fine.status == "measured"
    assert fine.observed_pixels == 30 * 30
    assert fine.ordered[0].id == ids[0]
    assert fine.ordered[0].distance < fine.ordered[1].distance
    assert fine.primary_top1 == ids[0]


def test_body_family_uses_cutout_rgb_inside_vehicle_shape():
    ids = ("body_variant.test.black", "body_variant.test.blue")
    rgb = np.zeros((2, 50, 80, 3), np.float32)
    rgb[0, 10:40, 10:70] = (.12, .13, .14)
    rgb[1, 10:40, 10:70] = (.08, .60, .90)
    masks = np.zeros((2, 50, 80), np.float32)
    masks[:, 10:40, 10:70] = 1
    bank = type("Bank", (), {})()
    bank.groups = {("bodies", "result"):
                   _Group(ids, ("body.test",) * 2, rgb, masks,
                          masks.sum((1, 2)))}
    matcher = IconMatcher(bank)
    candidates = tuple(Candidate(rid, "body.test", score)
                       for rid, score in zip(ids, (.86, .84)))
    primary = MatchResult(ids[0], "body.test", "accepted", .86, .02,
                          candidates, "rgb", "result", (0, 0),
                          (FamilyCandidate("body.test", .86, candidates),))
    crop = np.full((50, 80, 3), (255, 200, 20), np.uint8)
    crop[10:40, 10:70] = (65, 35, 18)
    fine = refine_family_variants(crop, "bodies", matcher, primary)
    assert fine.metric == "cutout_rgb" and fine.observed_pixels == 28 * 58
    assert fine.ordered[0].id == ids[0]


def test_fast_family_colour_rank_matches_paired_diagnostic_with_alpha_background():
    ids = tuple(f"character.yoshi.{name}" for name in ("black", "yellow", "orange"))
    rgb = np.zeros((3, 48, 48, 3), np.float32)
    for index, colour in enumerate(((.14, .15, .16), (.90, .79, .12), (.92, .40, .08))):
        rgb[index, 8:40, 8:40] = colour
    masks = np.zeros((3, 48, 48), np.float32)
    masks[:, 8:40, 8:40] = 1
    bank = type("Bank", (), {})()
    bank.groups = {("characters", "result"): _Group(ids, ("character.yoshi",) * 3,
                                                    rgb, masks, masks.sum((1, 2)))}
    matcher = IconMatcher(bank)
    variants = tuple(Candidate(rid, "character.yoshi", score)
                     for rid, score in zip(ids, (.82, .81, .80)))
    primary = MatchResult(ids[0], "character.yoshi", "accepted", .82, .01,
                          variants, "rgb", "result", (0, 0),
                          (FamilyCandidate("character.yoshi", .82, variants),))
    crop = np.full((48, 48, 3), (255, 40, 40), np.uint8)  # unrelated blue background
    crop[8:40, 8:40] = (30, 197, 220)  # yellow object in BGR
    orders = diagnostic_colour_rank(crop, "characters", "result",
                                    "character.yoshi", matcher, (0, 0))
    for metric, weight in (("oklab", 0), ("oklab_hue", 1)):
        fine = rank_family_colour_space(crop, "characters", matcher, primary,
                                        metric=metric)
        assert fine.status == "measured" and fine.observed_pixels == 30 * 30
        ok = dict(orders["oklab_lightness_p85"])
        hue = dict(orders["hsv_balanced_p85"])
        expected = sorted(ids, key=lambda rid: ok[rid] + weight * hue[rid])
        assert [item.id for item in fine.ordered] == expected
        assert fine.ordered[0].id == ids[1]
    assert primary.id == ids[0]
