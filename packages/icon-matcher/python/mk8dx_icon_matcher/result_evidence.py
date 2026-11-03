"""Shared evidence for one result-card field, in the scanner's record format.

The central profile: every product reads a result card field with the same
refinements and hands the same evidence to ``compose_result_proposal``. The
product supplies only the field crop and, where it reads them, the printed
name/part text and the tyre window. Output keys match the web engine's
``shared_icon_qa`` record so the decision vectors are interchangeable.
"""

from __future__ import annotations

from hashlib import sha256

import numpy as np

from .field_result import visual_field_result
from .flag_rank import distinctive_flag_rank, flag_band_ratio, flag_tricolor_evidence, normalized_query
from .matcher import IconMatcher

# The one refinement profile (field semantics 0.3.1 candidate).
PROFILE = {"flag_distinctive": True, "flag_tricolor": True, "flag_exposure": True,
           "shape_rank": True, "neutral_chroma": True, "family_colour": True,
           "flag_band_ratio": True}


def field_evidence(crop_bgr: np.ndarray, kind: str, matcher: IconMatcher,
                   profile: str = "result") -> dict:
    """The field's evidence record (see module doc)."""
    return field_evidence_with_match(crop_bgr, kind, matcher, profile)[0]


def field_evidence_with_match(crop_bgr: np.ndarray, kind: str, matcher: IconMatcher,
                              profile: str = "result"):
    """The evidence record and the visual match it was built on."""
    if crop_bgr is None or crop_bgr.ndim != 3 or crop_bgr.shape[2] != 3 or not crop_bgr.size:
        raise ValueError("Expected a BGR field crop")
    crop = np.ascontiguousarray(crop_bgr)
    match = matcher.match(crop, kind, profile=profile, search_mode="center_shortlist")
    read = visual_field_result(match, kind=kind, crop_pixel_sha256=sha256(crop.tobytes()).hexdigest(),
                               catalog_sha256=matcher.references.catalog_sha256)
    families = match.family_top
    read["familyMargin"] = (families[0].score - families[1].score) if len(families) > 1 else None
    group = matcher.references.groups[(kind, profile)]
    shape = None
    if PROFILE["shape_rank"] and kind in ("flags", "tires"):
        from .shape_rank import rank_icon_shape
        shape = {**rank_icon_shape(crop, group, "full_rgb_ncc" if kind == "flags" else "masked_gray_ncc"),
                 "cropPixelSha256": read["cropPixelSha256"]}
    neutral = family_colour = distinct = tricolor = exposure = band_ratio = None
    if kind == "characters" and profile == "result":
        if PROFILE["neutral_chroma"]:
            from .neutral_chroma import rank_neutral_reference
            neutral = {**rank_neutral_reference(crop, matcher, match), "cropPixelSha256": read["cropPixelSha256"]}
        if PROFILE["family_colour"]:
            from .family_colour import rank_character_family_colour
            ranked = rank_character_family_colour(normalized_query(crop, group), group, match)
            family_colour = {**ranked, "cropPixelSha256": read["cropPixelSha256"]} if ranked else None
    if kind == "flags" and PROFILE["flag_distinctive"]:
        query = normalized_query(crop, group)
        top = distinctive_flag_rank(query, group, [c["id"] for c in read["top"]])
        distinct = {"schema": "mk8dx.flag-distinctive-shadow.v1", "cropPixelSha256": read["cropPixelSha256"],
                    "originalTop1Id": read["top1Id"], "top": top}
        if PROFILE["flag_tricolor"] and profile == "result" and read["score"] >= .80:
            tricolor = {**flag_tricolor_evidence(query, group, [c["id"] for c in read["top"]],
                                                 top[0]["id"], shape),
                        "cropPixelSha256": read["cropPixelSha256"]}
        if PROFILE["flag_exposure"] and profile == "result" and shape:
            from .flag_exposure import flag_exposure_proposal
            exposure = {**flag_exposure_proposal(crop, group, shape), "cropPixelSha256": read["cropPixelSha256"]}
        if (PROFILE["flag_band_ratio"] and profile == "result"
                and any(c["id"] in ("country.nl", "country.lu") for c in read["top"])):
            band_ratio = {**flag_band_ratio(query), "cropPixelSha256": read["cropPixelSha256"]}
    read.update(flag_distinctive_qa=distinct, flag_tricolor_qa=tricolor, flag_exposure_qa=exposure,
                flag_band_ratio_qa=band_ratio,
                shape_rank_qa=shape, neutral_chroma_qa=neutral, family_colour_qa=family_colour)
    return read, match
