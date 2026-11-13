from pathlib import Path
import sys

import cv2
import numpy as np
import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mk8dx_icon_matcher.matcher import IconMatcher, ReferenceBank, _Group
from mk8dx_icon_matcher.matcher import Candidate, MatchResult
from mk8dx_icon_matcher.context import Decision, TextClue, combine_character, combine_part
from mk8dx_icon_matcher.field_result import visual_field_result
from mk8dx_icon_matcher.field_reader import FieldContext, read_field


def bank() -> ReferenceBank:
    source = ReferenceBank.__new__(ReferenceBank)
    a = np.zeros((48, 48, 3), np.float32)
    b = np.zeros_like(a)
    a[8:40, 8:40] = (0.9, 0.2, 0.1)
    b[8:40, 8:40] = (0.2, 0.9, 0.1)
    mask = np.zeros((2, 48, 48), np.float32)
    mask[:, 8:40, 8:40] = 1
    source.groups = {("characters", "result"): _Group(
        ("character.red", "character.green"),
        ("character.red", "character.green"), np.stack((a, b)), mask, mask.sum((1, 2)))}
    return source


def crop(rgb: tuple[float, float, float]) -> np.ndarray:
    image = np.zeros((48, 48, 3), np.uint8)
    image[8:40, 8:40] = tuple(round(v * 255) for v in rgb[::-1])
    return image


def test_full_visual_rank_and_abstain():
    matcher = IconMatcher(bank())
    red = matcher.match(crop((0.9, 0.2, 0.1)), "characters")
    assert red.id == "character.red"
    assert [c.id for c in red.top] == ["character.red", "character.green"]
    assert red.family_id == "character.red"
    uncertain = matcher.match(crop((0.55, 0.55, 0.1)), "characters")
    assert uncertain.id is None and uncertain.status == "unknown"
    assert len(uncertain.top) == 2


def test_family_rank_keeps_other_family_when_variants_fill_visual_top_three():
    refs = bank()
    group = refs.groups[("characters", "result")]
    red = group.rgb[0]
    variants = np.stack((red, red * 0.98, red * 0.96, group.rgb[1]))
    masks = np.repeat(group.mask[:1], 4, axis=0)
    refs.groups[("characters", "result")] = _Group(
        ("character.red", "character_variant.red.light", "character_variant.red.dark", "character.green"),
        ("character.red", "character.red", "character.red", "character.green"),
        variants, masks, masks.sum((1, 2)))
    visual = IconMatcher(refs).match(crop((0.9, 0.2, 0.1)), "characters")
    assert all(candidate.family_id == "character.red" for candidate in visual.top)
    assert [family.family_id for family in visual.family_top] == ["character.red", "character.green"]
    assert [candidate.id for candidate in visual.family_top[0].variants] == [
        "character.red", "character_variant.red.light", "character_variant.red.dark"]


def test_absent_and_invalid_profile():
    matcher = IconMatcher(bank())
    absent = matcher.match(crop((0.9, 0.2, 0.1)), "characters", present=False)
    assert absent.id is None and absent.top == () and absent.status == "absent"
    with pytest.raises(ValueError, match="Unsupported"):
        matcher.match(crop((0.9, 0.2, 0.1)), "characters", profile="scoreboard")


def test_field_read_separates_presence_visual_and_final_decision():
    refs = bank()
    refs.catalog_sha256 = "a" * 64
    refs.family = {"character.red": "character.red", "character.green": "character.green"}
    matcher = IconMatcher(refs)
    image = crop((0.9, 0.2, 0.1))
    visible = read_field(image, "characters", "result",
                         FieldContext("direct_game", "result_card", "player"), matcher)
    assert (visible["sourceFamily"], visible["screen"], visible["owner"]) == (
        "direct_game", "result_card", "player")
    assert visible["top1Id"] == visible["acceptedId"] == "character.red"
    assert visible["selectedId"] == "character.red"
    assert visible["reviewRequired"] is False
    assert visible["visualRead"]["cropPixelSha256"] == visible["cropPixelSha256"]
    assert visible["visualRead"]["top"][0]["familyId"] == "character.red"
    assert [item["id"] for item in visible["rankedCandidates"]] == ["character.red", "character.green"]
    assert visible["rankedCandidates"][0]["score"] == visible["visualRead"]["score"]
    assert visible["evidence"] == ["visual"]
    for presence in ("absent", "unknown"):
        skipped = read_field(image, "characters", "result",
                             FieldContext("direct_game", "result_card", "player", presence), matcher)
        assert skipped["status"] == presence and skipped["visualRead"] is None
        assert skipped["top1Id"] is None and skipped["acceptedId"] is None
        assert skipped["selectedId"] is None and skipped["reviewRequired"] is False
        assert skipped["rankedCandidates"] == [] and skipped["suggestion"] is None
        assert skipped["proposedFamilyId"] is None and skipped["familyMargin"] is None
        assert skipped["cropPixelSha256"] == visible["cropPixelSha256"]
    structural = read_field(None, "characters", "result",
                            FieldContext("direct_game", "scoreboard", "row_1", "absent"), matcher)
    assert structural["visualRead"] is None and structural["cropPixelSha256"] is None


def test_field_read_keeps_ambiguous_visual_top1_without_accepting_it():
    refs = bank()
    refs.catalog_sha256 = "b" * 64
    result = read_field(crop((0.55, 0.55, 0.1)), "characters", "result",
                        FieldContext("webcam", "result_card", "ghost"), IconMatcher(refs))
    assert result["status"] == "suggested" and result["acceptedId"] is None
    assert result["selectedId"] == "character.red" and result["reviewRequired"] is True
    assert result["top1Id"] is not None and len(result["visualRead"]["top"]) == 2
    assert result["suggestion"]["id"] == result["top1Id"]
    assert result["suggestion"]["score"] == result["rankedCandidates"][0]["score"]
    assert result["selectedId"] == result["suggestion"]["id"]


def test_high_score_close_character_is_named_suggestion(monkeypatch):
    refs = bank()
    refs.catalog_sha256 = "1" * 64
    refs.display_names = {"character.red": {"nl-NL": "Rood"},
                          "character.green": {"nl-NL": "Groen"}}
    matcher = IconMatcher(refs)
    visual = MatchResult(None, None, "unknown", 0.89, 0.015,
                         (Candidate("character.red", "character.red", 0.89),
                          Candidate("character.green", "character.green", 0.875)),
                         "rgb", "result", (0, 0))
    monkeypatch.setattr(matcher, "match", lambda *args, **kwargs: visual)
    result = read_field(crop((0.9, 0.2, 0.1)), "characters", "result",
                        FieldContext("direct_game", "scoreboard", "row_1"), matcher)
    assert result["status"] == "suggested" and result["acceptedId"] is None
    assert result["selectedId"] == "character.red" and result["reviewRequired"] is True
    assert result["suggestion"]["label"] == "Rood?"
    assert result["suggestion"]["alternative"] == {
        "id": "character.green", "label": "Groen", "score": 0.875}
    assert result["visualRead"]["status"] == "unknown"


def test_visible_ambiguous_flag_names_choice_and_alternative(monkeypatch):
    refs = bank()
    refs.catalog_sha256 = "e" * 64
    refs.groups[("flags", "result")] = refs.groups[("characters", "result")]
    refs.country_names = {
        "country.us": {"nl-NL": "Verenigde Staten", "en-GB": "United States"},
        "country.my": {"nl-NL": "Maleisië", "en-GB": "Malaysia"},
    }
    matcher = IconMatcher(refs)
    visual = MatchResult(None, None, "unknown", 0.78455, 0.01966,
                         (Candidate("country.us", "country.us", 0.78455),
                          Candidate("country.my", "country.my", 0.76489)),
                         "rgb", "result", (2, -1))
    monkeypatch.setattr(matcher, "match", lambda *args, **kwargs: visual)
    result = read_field(crop((0.9, 0.2, 0.1)), "flags", "result",
                        FieldContext("direct_game", "result_card", "ghost"), matcher)
    assert result["status"] == "suggested" and result["acceptedId"] is None
    assert result["top1Id"] == "country.us"
    assert result["selectedId"] == "country.us" and result["reviewRequired"] is True
    assert result["suggestion"]["id"] == "country.us"
    assert result["suggestion"]["label"] == "Verenigde Staten?"
    assert result["suggestion"]["score"] == 0.78455
    assert result["suggestion"]["alternative"] == {
        "id": "country.my", "label": "Maleisië", "score": 0.76489}
    assert [row["score"] for row in result["rankedCandidates"]] == [0.78455, 0.76489]
    assert result["visualRead"]["status"] == "unknown"
    clipped = read_field(crop((0.9, 0.2, 0.1)), "flags", "result",
                         FieldContext("webcam", "result_card", "ghost", clipped=True), matcher)
    assert clipped["status"] == "suggested" and clipped["suggestion"]["id"] == "country.us"
    assert clipped["acceptedId"] is None


def test_ranked_top_three_keeps_scores_and_variant_family(monkeypatch):
    refs = bank()
    refs.catalog_sha256 = "f" * 64
    refs.display_names = {
        "body.standard_kart": {"nl-NL": "Standaardkart"},
        "body.inkstriker": {"nl-NL": "Inkstriker"},
    }
    refs.variant_slugs = {"body_variant.standard_kart.red": "red"}
    refs.groups[("bodies", "result")] = refs.groups[("characters", "result")]
    matcher = IconMatcher(refs)
    visual = MatchResult(None, None, "unknown", 0.93, 0.005,
                         (Candidate("body_variant.standard_kart.red", "body.standard_kart", 0.93),
                          Candidate("body.standard_kart", "body.standard_kart", 0.925),
                          Candidate("body.inkstriker", "body.inkstriker", 0.89)),
                         "rgb", "result", (0, 0))
    monkeypatch.setattr(matcher, "match", lambda *args, **kwargs: visual)
    result = read_field(crop((0.9, 0.2, 0.1)), "bodies", "result",
                        FieldContext("direct_game", "result_card", "player"), matcher)
    rows = result["rankedCandidates"]
    assert [row["score"] for row in rows] == [0.93, 0.925, 0.89]
    assert [row["relationToFirst"] for row in rows] == ["same_family", "same_family", "different_family"]
    assert rows[0]["label"] == "Standaardkart (red)"
    assert [family["familyId"] for family in result["rankedFamilies"]] == [
        "body.standard_kart", "body.inkstriker"]
    assert [variant["score"] for variant in result["rankedFamilies"][0]["variants"]] == [0.93, 0.925]
    assert result["proposedFamilyId"] == "body.standard_kart"
    assert result["familyMargin"] == pytest.approx(0.04)
    assert result["variantMargin"] == pytest.approx(0.005)
    assert result["status"] == "suggested" and result["acceptedId"] is None
    assert [row["id"] for row in result["suggestion"]["alternatives"]] == [
        "body.standard_kart", "body.inkstriker"]


def test_field_read_rejects_unsupported_profile_before_skipping_match():
    refs = bank()
    refs.catalog_sha256 = "c" * 64
    with pytest.raises(ValueError, match="Unsupported kind/profile"):
        read_field(crop((0.9, 0.2, 0.1)), "characters", "ghost_select",
                   FieldContext("direct_game", "ghost_select", "ghost", "absent"), IconMatcher(refs))


def test_clipped_cell_keeps_visual_proposal_but_never_accepts_it():
    refs = bank()
    refs.catalog_sha256 = "d" * 64
    clipped = read_field(crop((0.9, 0.2, 0.1)), "characters", "result",
                         FieldContext("webcam", "result_card", "ghost", clipped=True), IconMatcher(refs))
    assert clipped["visualRead"]["acceptedId"] == "character.red"
    assert clipped["top1Id"] == "character.red"
    assert clipped["acceptedId"] is None and clipped["status"] == "suggested"
    assert clipped["suggestion"]["id"] == "character.red"
    assert clipped["evidence"] == ["clipped_field", "visual_suggestion"]


def test_visual_field_record_preserves_proposal_and_abstention():
    matcher = IconMatcher(bank())
    digest = "a" * 64
    accepted = visual_field_result(matcher.match(crop((0.9, 0.2, 0.1)), "characters"),
                                   kind="characters", crop_pixel_sha256=digest, catalog_sha256=digest)
    unknown = visual_field_result(matcher.match(crop((0.55, 0.55, 0.1)), "characters"),
                                  kind="characters", crop_pixel_sha256=digest, catalog_sha256=digest)
    absent = visual_field_result(matcher.match(crop((0.9, 0.2, 0.1)), "characters", present=False),
                                 kind="characters", crop_pixel_sha256=digest, catalog_sha256=digest)
    assert accepted["top1Id"] == accepted["acceptedId"] == "character.red"
    assert unknown["top1Id"] is not None and unknown["acceptedId"] is None
    assert absent["top1Id"] is None and absent["acceptedId"] is None
    assert accepted["cropPixelSha256"] == unknown["cropPixelSha256"] == absent["cropPixelSha256"]


def test_bounded_external_white_balance():
    matcher = IconMatcher(bank())
    changed = matcher.match(crop((0.75, 0.2, 0.1)), "characters", white_balance=(1.2, 1, 1))
    assert changed.id == "character.red"
    with pytest.raises(ValueError, match="bounded"):
        matcher.match(crop((0.9, 0.2, 0.1)), "characters", white_balance=(3, 1, 1))


def test_menu_outline_selects_art_not_another_colour_method():
    refs = ReferenceBank.__new__(ReferenceBank)
    ids = ("character.red", "character.green")
    score_art = np.ones((2, 48, 48, 3), np.float32)
    score_art[0, 7:41, 7:41] = (0.9, 0.1, 0.1)
    score_art[1, 7:41, 7:41] = (0.1, 0.9, 0.1)
    menu_art = score_art.copy()
    menu_art[:, 4:44, 4:44] = 0
    menu_art[:, 7:41, 7:41] = score_art[:, 7:41, 7:41]
    mask = np.ones((2, 48, 48), np.float32)
    refs.groups = {
        ("characters", "result"): _Group(ids, ids, score_art, mask, mask.sum((1, 2))),
        ("characters", "ghost_select"): _Group(ids, ids, menu_art, mask, mask.sum((1, 2))),
    }
    image = (menu_art[0, :, :, ::-1] * 255).astype(np.uint8)
    matcher = IconMatcher(refs)
    menu = matcher.match(image, "characters", profile="ghost_select")
    score = matcher.match(image, "characters", profile="result")
    assert menu.id == "character.red" and menu.family_id == "character.red"
    assert menu.top[0].id == score.top[0].id == "character.red"
    assert menu.score > score.score
    assert menu.method == score.method == "rgb"
    adaptive = matcher.match(image, "characters", profile="ghost_select", search_mode="center_then_full")
    assert adaptive.id == menu.id and adaptive.offset == (0, 0)
    quick = matcher.match(image, "characters", profile="ghost_select", search_mode="center_then_shortlist")
    assert quick.id == menu.id and quick.offset == (0, 0)
    with pytest.raises(ValueError, match="Search radius"):
        matcher.match(image, "characters", profile="ghost_select", search_radius=3)
    with pytest.raises(ValueError, match="Adaptive search"):
        matcher.match(image, "characters", profile="ghost_select", search_mode="center_then_full", search_radius=1)


def test_adaptive_alignment_falls_back_for_shifted_scoreboard_crop():
    refs = ReferenceBank.__new__(ReferenceBank)
    rng = np.random.default_rng(12)
    art = rng.random((2, 48, 48, 3), dtype=np.float32)
    mask = np.ones((2, 48, 48), np.float32)
    refs.groups = {("characters", "scoreboard"): _Group(
        ("character.red", "character.green"),
        ("character.red", "character.green"), art, mask, mask.sum((1, 2)))}
    shifted = cv2.warpAffine((art[0, :, :, ::-1] * 255).astype(np.uint8),
                             np.float32([[1, 0, 2], [0, 1, -2]]), (48, 48),
                             borderMode=cv2.BORDER_REPLICATE)
    matcher = IconMatcher(refs)
    centered = matcher.match(shifted, "characters", profile="scoreboard", search_radius=0)
    full = matcher.match(shifted, "characters", profile="scoreboard")
    adaptive = matcher.match(shifted, "characters", profile="scoreboard", search_mode="center_then_full")
    shortlisted = matcher.match(shifted, "characters", profile="scoreboard", search_mode="center_shortlist")
    quick = matcher.match(shifted, "characters", profile="scoreboard", search_mode="center_then_shortlist")
    assert centered.status == "unknown"
    assert full.id == adaptive.id == shortlisted.id == quick.id == "character.red"
    assert full.offset == adaptive.offset
    assert quick.offset == shortlisted.offset
    with pytest.raises(ValueError, match="Adaptive search"):
        matcher.match(shifted, "characters", profile="scoreboard", search_mode="center_then_shortlist", search_radius=1)
    with pytest.raises(ValueError, match="Shortlist size"):
        matcher.match(shifted, "characters", profile="scoreboard", search_mode="center_shortlist", shortlist_size=0)


def test_text_resolves_only_close_base_variant_tie():
    refs = ReferenceBank.__new__(ReferenceBank)
    refs.family = {"character.blue": "character.blue", "character_variant.blue.cyan": "character.blue"}
    top = (Candidate("character_variant.blue.cyan", "character.blue", 0.794),
           Candidate("character.blue", "character.blue", 0.784))
    visual = MatchResult(None, None, "unknown", 0.794, 0.010, top, "rgb", "result", (0, 0))
    found = combine_character(visual, TextClue("character.blue", 1.0), refs)
    assert found.id == "character.blue" and found.evidence == ("name_base_close_visual",)
    high = MatchResult(None, None, "unknown", 0.91, 0.010, top, "rgb", "result", (0, 0))
    assert combine_character(high, TextClue("character.blue", 1.0), refs).id is None


def test_approximate_colour_name_cannot_replace_accepted_visual_variant():
    refs = ReferenceBank.__new__(ReferenceBank)
    refs.family = {"character.yoshi.black": "character.yoshi",
                   "character.yoshi.yellow": "character.yoshi"}
    visual = MatchResult("character.yoshi.black", "character.yoshi", "accepted", 0.882,
                         0.042, (Candidate("character.yoshi.black", "character.yoshi", 0.882),
                                 Candidate("character.yoshi.yellow", "character.yoshi", 0.840)),
                         "rgb", "result", (0, 0))
    conflict = combine_character(visual, TextClue("character.yoshi.yellow", 0.89), refs)
    assert conflict == Decision(None, "character.yoshi", "conflict",
                                ("visual_name_variant_conflict",), "character.yoshi.black")
    exact = combine_character(visual, TextClue("character.yoshi.yellow", 1.0), refs)
    assert exact.id == "character.yoshi.yellow" and exact.status == "accepted"


def test_medium_tire_text_only_confirms_visual_top1():
    refs = ReferenceBank.__new__(ReferenceBank)
    refs.tire_by_index = {21: "tire.leaf", 13: "tire.blue"}
    refs.family = {"tire.leaf": "tire.leaf", "tire.blue": "tire.blue"}
    visual = MatchResult(None, None, "unknown", 0.817, 0.013,
                         (Candidate("tire.leaf", "tire.leaf", 0.817),
                          Candidate("tire.blue", "tire.blue", 0.804)),
                         "rgb", "result", (0, 0))
    character = Decision(None, None, "unknown", (), None)
    assert combine_part("tires", visual, character, TextClue("21", 0.73, 0.45), refs).id == "tire.leaf"
    conflict = combine_part("tires", visual, character, TextClue("13", 0.73, 0.45), refs)
    assert conflict.id is None and conflict.status == "conflict"
    assert conflict.visual_top1 == "tire.leaf"


def test_opt_in_strong_tire_text_requires_its_visual_top_three():
    refs = ReferenceBank.__new__(ReferenceBank)
    refs.tire_by_index = {1: "tire.button", 2: "tire.slim", 3: "tire.gold",
                          4: "tire.roller"}
    refs.family = {rid: rid for rid in refs.tire_by_index.values()}
    top = (Candidate("tire.gold", "tire.gold", .829),
           Candidate("tire.button", "tire.button", .805),
           Candidate("tire.slim", "tire.slim", .790))
    visual = MatchResult("tire.gold", "tire.gold", "accepted", .829, .024,
                         top, "rgb", "result", (0, 0))
    character = Decision(None, None, "unknown", (), None)
    rescued = combine_part("tires", visual, character, TextClue("1", 1.0, .57),
                           refs, tire_text_top3_guard=True)
    assert rescued.id == "tire.button" and rescued.status == "accepted"
    legacy = combine_part("tires", visual, character, TextClue("4", 1.0, .57), refs)
    assert legacy.id == "tire.roller"
    guarded = combine_part("tires", visual, character, TextClue("4", 1.0, .57),
                           refs, tire_text_top3_guard=True)
    assert guarded == Decision(None, "tire.gold", "conflict",
                               ("tire_text_outside_visual_top3",), "tire.gold")


def test_medium_cross_family_text_blocks_character_relation_acceptance():
    refs = ReferenceBank.__new__(ReferenceBank)
    refs.family = {"glider.paper": "glider.paper", "glider.super": "glider.super"}
    refs.tire_by_index = {}
    top = (Candidate("glider.super", "glider.super", 0.819),)
    visual = MatchResult(None, None, "unknown", 0.819, 0.009, top, "rgb", "result", (0, 0))
    character = Decision("character.a", "character.a", "accepted", (), "character.a")
    conflict = combine_part("gliders", visual, character, TextClue("glider.paper", 0.76, 0.43), refs)
    assert conflict.id is None and conflict.family_id == "glider.super"
    assert conflict.status == "conflict" and conflict.visual_top1 == "glider.super"
    assert conflict.evidence == ("visual_text_conflict_review",)


def test_character_relation_needs_readable_name_or_distinct_family():
    from mk8dx_icon_matcher.matcher import FamilyCandidate

    refs = ReferenceBank.__new__(ReferenceBank)
    refs.family = {"glider.parasol": "glider.parasol", "glider.parachute": "glider.parachute"}
    refs.part_for_character = {("gliders", "glider.parasol", "character.baby"): "glider.parasol"}
    refs.tire_by_index = {}
    refs.groups = {("gliders", "result"): type("Group", (), {
        "ids": ("glider.parasol", "glider.parachute"),
        "families": ("glider.parasol", "glider.parachute")})()}
    top = Candidate("glider.parasol", "glider.parasol", 0.805)
    other = Candidate("glider.parachute", "glider.parachute", 0.800)
    character = Decision("character.baby", "character.baby", "accepted", (), "character.baby")
    close = MatchResult(None, None, "unknown", 0.805, 0.005, (top, other),
                        "rgb", "result", (0, 0),
                        (FamilyCandidate("glider.parasol", 0.805, (top,)),
                         FamilyCandidate("glider.parachute", 0.800, (other,))))
    withheld = combine_part("gliders", close, character, None, refs)
    assert withheld.id is None and withheld.status == "unknown"
    assert "weak_family_relation_review" in withheld.evidence
    assert combine_part("gliders", close, character,
                        TextClue("glider.parasol", 1.0, 0.4), refs).id == "glider.parasol"
    wide = MatchResult(None, None, "unknown", 0.805, 0.005, (top, other),
                       "rgb", "result", (0, 0),
                       (FamilyCandidate("glider.parasol", 0.805, (top,)),
                        FamilyCandidate("glider.parachute", 0.750, (other,))))
    assert combine_part("gliders", wide, character, None, refs).id == "glider.parasol"
    refs.part_for_character[("bodies", "body.kart", "character.baby")] = "body.kart"
    body = MatchResult(None, None, "unknown", 0.805, 0.005,
                       (Candidate("body.kart", "body.kart", 0.805),
                        Candidate("body.bike", "body.bike", 0.800)),
                       "rgb", "result", (0, 0),
                       (FamilyCandidate("body.kart", 0.805, (Candidate("body.kart", "body.kart", 0.805),)),
                        FamilyCandidate("body.bike", 0.800, (Candidate("body.bike", "body.bike", 0.800),))))
    assert combine_part("bodies", body, character, None, refs).id == "body.kart"


def test_accepted_glider_colour_uses_named_family_and_character_top_three():
    refs = ReferenceBank.__new__(ReferenceBank)
    refs.family = {"glider.blue": "glider.super", "glider.toad": "glider.super",
                   "glider.other": "glider.super", "glider.fourth": "glider.super"}
    refs.part_for_character = {("gliders", "glider.super", "character.toad"): "glider.toad"}
    refs.tire_by_index = {}
    refs.groups = {("gliders", "result"): type("Group", (), {
        "ids": tuple(refs.family), "families": tuple(refs.family.values())})()}
    candidates = (Candidate("glider.blue", "glider.super", .875),
                  Candidate("glider.toad", "glider.super", .848),
                  Candidate("glider.other", "glider.super", .844),
                  Candidate("glider.fourth", "glider.super", .810))
    visual = MatchResult("glider.blue", "glider.super", "accepted", .875, .027,
                         candidates, "rgb", "result", (0, 0))
    character = Decision("character.toad", "character.toad", "accepted", (), "character.toad")
    clue = TextClue("glider.super", 1.0, .2)
    refined = combine_part("gliders", visual, character, clue, refs)
    assert refined.id == "glider.toad"
    assert refined.visual_top1 == "glider.blue"
    assert "character_part_top3_variant" in refined.evidence
    # The catalog colour decides without a printed name too (issue #99 rule 2).
    assert combine_part("gliders", visual, character, None, refs).id == "glider.toad"
    # A character that is not accepted settles the family only; its catalog colour is the proposal.
    uncertain_character = Decision("character.toad", "character.toad", "unknown", (), "character.toad")
    unaccepted_character = Decision(None, None, "suggested", (), "character.toad")
    for unsettled in (uncertain_character, unaccepted_character):
        for text in (clue, None):
            proposed = combine_part("gliders", visual, unsettled, text, refs)
            assert proposed.id is None and proposed.status == "family_only"
            assert proposed.family_id == "glider.super" and proposed.suggested_id == "glider.toad"
            assert proposed.visual_top1 == "glider.blue"
            assert "glider_colour_needs_character" in proposed.evidence
    weak_visual = MatchResult(None, None, "unknown", .858, .019,
                              candidates, "rgb", "result", (0, 0))
    assert combine_part("gliders", weak_visual, unaccepted_character, clue, refs).id is None
    nobody = combine_part("gliders", visual, Decision(None, None, "unknown", (), None), clue, refs)
    assert nobody.id is None and nobody.status == "family_only" and nobody.suggested_id is None
    # A clearly seen colour outside the top three that the character cannot have: keep the catalog
    # colour as the proposal and ask for review.
    refs.part_for_character[("gliders", "glider.super", "character.toad")] = "glider.fourth"
    clash = combine_part("gliders", visual, character, clue, refs)
    assert clash.id is None and clash.status == "conflict" and clash.suggested_id == "glider.fourth"
    assert "character_colour_conflict_review" in clash.evidence
    # A single-colour glider, or no catalog link for the character: the icon decides.
    del refs.part_for_character[("gliders", "glider.super", "character.toad")]
    assert combine_part("gliders", visual, character, clue, refs).id == "glider.blue"


def test_numeric_clue_ids_are_ascii_and_ocr_folds_full_width_digits():
    from mk8dx_icon_matcher.context import ascii_index
    from mk8dx_icon_matcher.name_match import match_name, normalize

    assert ascii_index("12") and not ascii_index("") and not ascii_index("１２")
    assert not ascii_index("١٢") and not ascii_index("٣") and not ascii_index("1a")
    assert normalize("Ｒｏｗ　１２") == "ｒｏｗ12" and normalize("١٢") == "١٢"
    # A full-width OCR read matches an ASCII-digit name exactly.
    assert match_name("B-Dash ２", [("7#en-GB", "B-Dash 2"), ("8#en-GB", "B-Dash 3")]).fuzzy == 1.0


def test_opaque_flag_references_keep_the_same_match_contract(tmp_path):
    red = np.full((40, 60, 3), (10, 10, 220), np.uint8)
    blue = np.full((40, 60, 3), (220, 10, 10), np.uint8)
    cv2.imwrite(str(tmp_path / "red.png"), red)
    cv2.imwrite(str(tmp_path / "blue.png"), blue)
    refs = ReferenceBank.__new__(ReferenceBank)
    refs.asset_root = tmp_path
    refs.groups = {("flags", "result"): refs._load(
        [("country.red", "country.red", "red.png"),
         ("country.blue", "country.blue", "blue.png")], (55, 38), allow_opaque=True)}
    result = IconMatcher(refs).match(red, "flags")
    assert result.id == "country.red" and result.family_id == "country.red"
    assert IconMatcher(refs).match(red, "flags", present=False).status == "absent"


def test_optical_flag_window_retains_top_choice_and_uses_all_references():
    refs = ReferenceBank.__new__(ReferenceBank)
    base = np.zeros((38, 55, 3), np.uint8)
    base[:, :19] = (12, 40, 205)
    base[:, 19:37] = (210, 40, 20)
    base[:, 37:] = (25, 210, 45)
    other = np.roll(base, 14, axis=1)
    rgb = np.stack([image[:, :, ::-1].astype(np.float32) / 255 for image in (base, other)])
    mask = np.ones((2, 38, 55), np.float32)
    refs.groups = {("flags", "result"): _Group(
        ("country.first", "country.second"), ("country.first", "country.second"),
        rgb, mask, mask.sum((1, 2)))}
    matcher = IconMatcher(refs)
    frame = np.zeros((90, 110, 3), np.uint8)
    frame[23:61, 25:80] = base
    result = matcher.match_flag_window(frame, (27, 24, 55, 38))
    assert result.proposed_id == result.accepted_id == "country.first"
    assert result.offset_px == (-2, -1) and result.scale == 1.0
    assert [item.id for item in result.top] == ["country.first", "country.second"]
    refs.catalog_sha256 = "a" * 64
    refs.country_names = {}
    field = read_field(frame[24:62, 27:82], "flags", "result",
                       FieldContext("webcam", "ghost_select", "ghost"), matcher,
                       flag_window=(frame, (27, 24, 55, 38)))
    assert field["top1Id"] == field["acceptedId"] == "country.first"
    assert field["visualRead"]["method"] == "template_ncc"
    assert field["opticalWindow"]["offsetPx"] == [-2, -1]
    with pytest.raises(ValueError, match="exact supplied crop"):
        read_field(np.zeros((38, 55, 3), np.uint8), "flags", "result",
                   FieldContext("webcam", "ghost_select", "ghost"), matcher,
                   flag_window=(frame, (27, 24, 55, 38)))
    with pytest.raises(ValueError, match="complete fixed surround"):
        matcher.match_flag_window(frame, (0, 0, 55, 38))


def test_optical_flag_window_keeps_ambiguous_first_choice_and_alternatives():
    refs = ReferenceBank.__new__(ReferenceBank)
    base = np.zeros((38, 55, 3), np.uint8)
    base[:, :20] = (15, 25, 210)
    base[:, 20:37] = (220, 30, 20)
    base[:, 37:] = (35, 215, 45)
    image = base[:, :, ::-1].astype(np.float32) / 255
    rgb = np.stack([image] * 3)
    mask = np.ones((3, 38, 55), np.float32)
    ids = ("country.first", "country.second", "country.third")
    refs.groups = {("flags", "result"): _Group(ids, ids, rgb, mask, mask.sum((1, 2)))}
    refs.catalog_sha256 = "a" * 64
    refs.country_names = {}
    frame = np.zeros((90, 110, 3), np.uint8)
    frame[24:62, 27:82] = base
    result = read_field(frame[24:62, 27:82], "flags", "result",
                        FieldContext("webcam", "ghost_select", "ghost"), IconMatcher(refs),
                        flag_window=(frame, (27, 24, 55, 38)))
    assert result["status"] == "suggested" and result["acceptedId"] is None
    assert result["top1Id"] == "country.first"
    assert result["suggestion"]["label"].endswith("?")
    assert [item["id"] for item in result["rankedCandidates"]] == list(ids)
