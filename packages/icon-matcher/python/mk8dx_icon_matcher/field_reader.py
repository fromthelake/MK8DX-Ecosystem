"""Source-independent decision on one already selected BGR field crop.

The caller owns screen detection, ROI geometry and presence evidence. A skipped
field has no visual match; context may refine a visible result without changing
the saved visual ranking.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Literal

import numpy as np

from .context import Decision, TextClue, combine_character, combine_part
from .field_result import visual_field_result
from .matcher import FamilyCandidate, IconMatcher, Kind, MatchResult, Profile, SearchMode


# Only families with real-crop negative evidence may use colour disagreement
# to withhold an otherwise accepted exact ID. Other families remain diagnostic.
QUALIFIED_COLOUR_REVIEW_FAMILIES = frozenset({("characters", "character.inkling_boy")})


Presence = Literal["present", "absent", "unknown"]


@dataclass(frozen=True)
class FieldContext:
    source_family: str
    screen: str
    owner: str
    presence: Presence = "present"
    text: TextClue | None = None
    character: Decision | None = None
    clipped: bool = False
    locale: str = "nl-NL"


NL_LU = ("country.nl", "country.lu")


def _open_set_step(profile: Profile, visual: MatchResult, suggestion: dict, decision: Decision
                   ) -> tuple[dict, Decision]:
    """A character without a clear winner (open_set.mii_suggestion): "Mii" proposed (score rows)
    or offered as the first alternative beside the best match (cards); never accepted, no size."""
    from .open_set import mii_suggestion

    mii = mii_suggestion(profile, visual.top, None)
    if mii is None:
        return suggestion, decision
    entry = {"rank": None, "id": mii["id"], "label": mii["label"], "familyId": mii["id"],
             "familyLabel": mii["label"], "relationToFirst": "open_set", "score": None}
    open_set = {key: mii[key] for key in ("id", "label", "mode", "score", "familyMargin")}
    if mii["mode"] == "alternative":
        alternatives = [entry, *suggestion["alternatives"]][:2]
        return ({**suggestion, "alternatives": alternatives, "openSet": open_set},
                Decision(None, decision.family_id, decision.status,
                         (*decision.evidence, mii["evidence"] + "_alternative"), decision.visual_top1))
    best = {"rank": 1, "id": suggestion["id"], "label": suggestion["label"].rstrip("?"),
            "score": suggestion["score"]}
    return ({**suggestion, "id": mii["id"], "label": mii["label"] + "?", "score": None,
             "alternatives": [best, *suggestion["alternatives"]][:2], "openSet": open_set},
            Decision(None, mii["id"], decision.status, (*decision.evidence, mii["evidence"]),
                     decision.visual_top1))


def _nl_lu_band(crop_bgr: np.ndarray, matcher: IconMatcher, profile: Profile, visual: MatchResult,
                decision: Decision, result: dict) -> Decision:
    """NL and LU differ only in the tone of their blue band: on every screen and in every app the
    band measurement (flag_rank.flag_band_ratio; TS sharedFlagBandRatio, Java Refinements) decides a
    flag read as NL or LU, and keeps it under review when the tone lies between the two flags."""
    if visual.top[0].id not in NL_LU and decision.id not in NL_LU:
        return decision
    from .flag_rank import flag_band_ratio, normalized_query
    band = flag_band_ratio(normalized_query(crop_bgr, matcher.references.groups[("flags", profile)]))
    result["flagBandRatio"] = band
    if band["status"] != "measured":
        return decision
    if band["decisionId"] in NL_LU:
        return Decision(band["decisionId"], band["decisionId"], "accepted",
                        (*decision.evidence, "flag_band_ratio"), visual.top[0].id)
    return Decision(None, decision.family_id, "unknown",
                    (*decision.evidence, "flag_band_ratio_between"), visual.top[0].id)


def read_field(crop_bgr: np.ndarray | None, kind: Kind, profile: Profile,
               context: FieldContext, matcher: IconMatcher, *,
               search_mode: SearchMode = "center_then_shortlist",
               top_k: int = 4, variant_colour_review: bool = False,
               shape_review: bool = False,
               flag_exposure_review: bool = False,
               neutral_chroma_review: bool = False,
               flag_window: tuple[np.ndarray, tuple[int, int, int, int]] | None = None,
               tire_text_top3_guard: bool = False) -> dict:
    """Return visual evidence and a final decision, without altering the crop.

    ``unknown`` presence means a cell may exist but is not readable enough to
    match. In both skipped states ``visualRead`` is null. A matched cell always
    retains three ranked choices (or the whole smaller reference group), with
    a review suggestion when no final ID is accepted. Text and relation
    evidence are evaluated only after a real visual read.
    """
    if context.presence not in ("present", "absent", "unknown"):
        raise ValueError("Unsupported field presence")
    if not all((context.source_family, context.screen, context.owner)):
        raise ValueError("Field provenance needs source family, screen and owner")
    if neutral_chroma_review and (kind != "characters" or profile != "result"):
        raise ValueError("Neutral chroma review requires a result character")
    if flag_exposure_review and (kind != "flags" or profile != "result"):
        raise ValueError("Flag exposure review requires a result flag")
    if (kind, profile) not in matcher.references.groups:
        raise ValueError(f"Unsupported kind/profile: {kind}/{profile}")
    if top_k < 1:
        raise ValueError("top_k must be positive")
    if flag_window is not None and (kind != "flags" or profile != "result"):
        raise ValueError("Optical flag window requires flags/result")
    if flag_window is not None and context.presence != "present":
        raise ValueError("Optical flag window requires a visible field")
    if crop_bgr is not None and (crop_bgr.size == 0 or crop_bgr.ndim != 3 or crop_bgr.shape[2] != 3):
        raise ValueError("Expected nonempty BGR field crop")
    if context.presence == "present" and crop_bgr is None:
        raise ValueError("Present field needs a BGR crop")
    crop_hash = sha256(crop_bgr.tobytes()).hexdigest() if crop_bgr is not None else None
    result = {"schema": "mk8dx.field-read.v1", "kind": kind, "profile": profile,
              "sourceFamily": context.source_family, "screen": context.screen,
              "owner": context.owner,
              "catalogSha256": matcher.references.catalog_sha256,
              "cropPixelSha256": crop_hash, "presence": context.presence,
              "visualRead": None, "top1Id": None, "rankedCandidates": [],
              "rankedFamilies": [], "proposedFamilyId": None,
              "familyMargin": None, "variantMargin": None,
              "selectedId": None, "acceptedId": None, "reviewRequired": False,
              "familyId": None, "status": context.presence,
              "suggestion": None, "evidence": ["presence"]}
    if context.presence != "present":
        return result
    if (shape_review or flag_exposure_review) and kind in ("tires", "flags"):
        from .shape_rank import rank_icon_shape
        mode = "masked_gray_ncc" if kind == "tires" else "full_rgb_ncc"
        result["shapeRank"] = {**rank_icon_shape(
            crop_bgr, matcher.references.groups[(kind, profile)], mode),
            "cropPixelSha256": crop_hash}
    if flag_exposure_review:
        from .flag_exposure import flag_exposure_proposal

        result["flagExposureReview"] = {
            **flag_exposure_proposal(
                crop_bgr, matcher.references.groups[(kind, profile)], result["shapeRank"]),
            "cropPixelSha256": crop_hash,
        }
    optical_window = None
    if flag_window is not None:
        frame, slot = flag_window
        if (not isinstance(frame, np.ndarray) or not isinstance(slot, tuple) or len(slot) != 4
                or not np.array_equal(frame[slot[1]:slot[1]+slot[3], slot[0]:slot[0]+slot[2]], crop_bgr)):
            raise ValueError("Optical flag window must contain the exact supplied crop")
        optical_window = matcher.match_flag_window(frame, slot)
        visual = MatchResult(
            optical_window.accepted_id, optical_window.accepted_id,
            "accepted" if optical_window.accepted_id else "unknown",
            optical_window.score, optical_window.margin, optical_window.top,
            "template_ncc", profile, optical_window.offset_px,
            tuple(FamilyCandidate(item.id, item.score, (item,)) for item in optical_window.top),
        )
    else:
        visual = matcher.match(crop_bgr, kind, profile=profile,
                               search_mode=search_mode, top_k=max(3, top_k))
    if neutral_chroma_review:
        from .neutral_chroma import rank_neutral_reference
        result["neutralChromaReview"] = {
            **rank_neutral_reference(crop_bgr, matcher, visual),
            "cropPixelSha256": crop_hash,
        }
    names = getattr(matcher.references, "display_names", None)
    if names is None:
        names = getattr(matcher.references, "country_names", {})
    slugs = getattr(matcher.references, "variant_slugs", {})

    def label(rid: str, family_id: str) -> str:
        variants = names.get(rid) or names.get(family_id) or {}
        base = variants.get(context.locale) or variants.get("en-GB") or rid
        slug = slugs.get(rid)
        return f"{base} ({slug.replace('_', ' ')})" if slug and slug != "default" else base

    first_family = visual.top[0].family_id
    ranked = [{"rank": rank, "id": candidate.id,
               "label": label(candidate.id, candidate.family_id),
               "familyId": candidate.family_id,
               "familyLabel": label(candidate.family_id, candidate.family_id),
               "relationToFirst": ("same_family" if candidate.family_id == first_family
                                   else "different_family"),
               "score": candidate.score}
              for rank, candidate in enumerate(visual.top[:3], 1)]
    family_groups = visual.family_top
    if not family_groups:
        # Compatibility with saved/mocked MatchResult records lacking the
        # full family ranking. Real matcher results use all reference scores.
        grouped: dict[str, list] = {}
        for candidate in visual.top:
            grouped.setdefault(candidate.family_id, []).append(candidate)
        family_groups = tuple((family, members[0].score, members[:3])
                              for family, members in list(grouped.items())[:3])
    ranked_families = []
    for rank, group in enumerate(family_groups, 1):
        family_id, family_score, variants = (
            (group.family_id, group.score, group.variants)
            if hasattr(group, "family_id") else group)
        ranked_families.append({"rank": rank, "familyId": family_id,
                                "label": label(family_id, family_id),
                                "score": family_score,
                                "variants": [{"rank": position, "id": variant.id,
                                              "label": label(variant.id, family_id),
                                              "score": variant.score}
                                             for position, variant in enumerate(variants[:3], 1)]})
    family_margin = (ranked_families[0]["score"] - ranked_families[1]["score"]
                     if len(ranked_families) > 1 else None)
    first_variants = ranked_families[0]["variants"]
    variant_margin = (first_variants[0]["score"] - first_variants[1]["score"]
                      if len(first_variants) > 1 else None)
    if kind == "characters":
        decision = combine_character(visual, context.text, matcher.references)
    elif kind in ("bodies", "tires", "gliders"):
        character = context.character or Decision(None, None, "unknown", (), None)
        decision = combine_part(kind, visual, character, context.text,
                                matcher.references,
                                tire_text_top3_guard=tire_text_top3_guard)
    else:
        decision = Decision(visual.id, visual.family_id, visual.status,
                            ("visual",), visual.top[0].id)
        if kind == "flags":
            decision = _nl_lu_band(crop_bgr, matcher, profile, visual, decision, result)
    colour_read = None
    proposal_ranked = ranked
    if variant_colour_review and visual.family_top and kind in ("characters", "bodies", "gliders") and (
            len(visual.family_top[0].variants) > 1):
        from .refinement import refine_family_variants
        fine = refine_family_variants(crop_bgr, kind, matcher, visual)
        colour_read = {"status": fine.status, "metric": fine.metric,
                       "observedPixels": fine.observed_pixels,
                       "primaryTop1": fine.primary_top1,
                       "ordered": [{"id": item.id, "coarseScore": item.coarse_score,
                                    "distance": item.distance,
                                    "hueDistance": item.distance if fine.metric == "hue" else None,
                                    "cutoutRgbDistance": item.distance if fine.metric == "cutout_rgb" else None}
                                   for item in fine.ordered]}
        if (fine.ordered and fine.ordered[0].id != visual.top[0].id
                and (kind, fine.family_id) in QUALIFIED_COLOUR_REVIEW_FAMILIES):
            proposal_ranked = [{"rank": rank, "id": item.id,
                                "label": label(item.id, fine.family_id),
                                "familyId": fine.family_id,
                                "familyLabel": label(fine.family_id, fine.family_id),
                                "relationToFirst": "same_family",
                                "score": item.coarse_score}
                               for rank, item in enumerate(fine.ordered[:3], 1)]
            if decision.id == visual.top[0].id:
                decision = Decision(None, decision.family_id, "unknown",
                                    (*decision.evidence, "variant_colour_disagreement"),
                                    visual.top[0].id)
    suggestion = None
    if context.clipped:
        decision = Decision(None, None, "unknown", ("clipped_field",), visual.top[0].id)
    if decision.id is None:
        # A match always has a strongest visual choice. Keep the acceptance
        # gate independent of this review proposal, including clipped cells.
        catalog_first = bool(decision.suggested_id) and decision.suggested_id != proposal_ranked[0]["id"]
        if catalog_first:
            # The glider colour that follows the character (combine_part) leads
            # the proposal; the visual order stays as the alternatives.
            sid = decision.suggested_id
            score = next((candidate.score for candidate in visual.top if candidate.id == sid), None)
            sfamily = decision.family_id or ranked_families[0]["familyId"]
            proposal_ranked = [{"rank": 1, "id": sid, "label": label(sid, sfamily),
                                "familyId": sfamily, "familyLabel": label(sfamily, sfamily),
                                "relationToFirst": ("same_family" if sfamily == first_family
                                                    else "different_family"),
                                "score": score},
                               *({**item, "rank": rank} for rank, item in enumerate(
                                   (item for item in proposal_ranked if item["id"] != sid), 2))][:3]
        suggestion = {"id": proposal_ranked[0]["id"],
                      "label": proposal_ranked[0]["label"] + "?",
                      "score": proposal_ranked[0]["score"],
                      "alternatives": proposal_ranked[1:],
                      "family": ranked_families[0],
                      "familyAlternatives": ranked_families[1:]}
        if catalog_first:
            suggestion["basis"] = "character_catalog_colour"
        elif proposal_ranked is not ranked:
            suggestion["basis"] = "variant_colour_review"
        if len(proposal_ranked) > 1:
            suggestion["alternative"] = {"id": proposal_ranked[1]["id"],
                                          "label": proposal_ranked[1]["label"],
                                          "score": proposal_ranked[1]["score"]}
        decision = Decision(None, decision.family_id, "suggested",
                            (*decision.evidence, "visual_suggestion"), visual.top[0].id,
                            decision.suggested_id)
        if kind == "characters":
            suggestion, decision = _open_set_step(profile, visual, suggestion, decision)
    result.update(visualRead=visual_field_result(
        visual, kind=kind, crop_pixel_sha256=crop_hash,
        catalog_sha256=matcher.references.catalog_sha256),
        top1Id=visual.top[0].id, rankedCandidates=ranked,
        rankedFamilies=ranked_families, proposedFamilyId=ranked_families[0]["familyId"],
        familyMargin=family_margin, variantMargin=variant_margin,
        selectedId=decision.id or (suggestion["id"] if suggestion else None),
        acceptedId=decision.id, reviewRequired=suggestion is not None,
        familyId=decision.family_id, status=decision.status,
        suggestion=suggestion,
        evidence=list(decision.evidence))
    if variant_colour_review:
        result["variantColourRead"] = colour_read
    if optical_window is not None:
        result["opticalWindow"] = {"scale": optical_window.scale,
                                    "offsetPx": list(optical_window.offset_px),
                                    "method": "all_country_template_ncc"}
    return result
