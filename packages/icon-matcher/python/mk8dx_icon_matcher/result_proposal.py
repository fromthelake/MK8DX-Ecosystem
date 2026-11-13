"""Result-screen decision from the shared reads on one frame.

Python counterpart of ``ts/sharedResultProposal.ts`` (``composeResultProposal``):
the same evidence objects in, the same proposal out, checked against shared
vectors so every product decides one result card identically. The selected
visual top three and its crop stay intact. A separate name or part-text
decision may change the proposed ID. No old product ID or truth label enters.
"""

from __future__ import annotations

import math
from typing import Any

from .open_set import mii_suggestion

FIELDS = ("character", "kart", "wheel", "glider", "flag")
_KIND = {"character": "characters", "kart": "bodies", "wheel": "tires",
         "glider": "gliders", "flag": "flags"}


def _visual(value: Any) -> dict | None:
    return value if isinstance(value, dict) and value.get("schema") == "mk8dx.visual-field-read.v1" else None


def _coalesce(value: Any, fallback: Any) -> Any:
    """JavaScript ``??``: only None falls through."""
    return fallback if value is None else value


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


COLOUR_GUARD = True
NL_SETTLED_GUARD = True
NL_LU_GAP = 0.05
BAND_RATIO_GUARD = True


def _lu_gap(distinct_top: list | None) -> float:
    """LU's distinctive distance minus NL's when NL ranks first (LU absent: infinite)."""
    if not distinct_top or distinct_top[0]["id"] != "country.nl":
        return -math.inf
    lu = next((c["distance"] for c in distinct_top if c["id"] == "country.lu"), None)
    return math.inf if lu is None else lu - distinct_top[0]["distance"]


def _colour_rank(visual: dict, raw_top: list) -> list | None:
    """The measured family-colour order, when the icon's top two share its family."""
    colour = visual.get("family_colour_qa")
    if not (isinstance(colour, dict) and colour.get("schema") == "mk8dx.family-colour-rank.v1"
            and colour.get("method") == "oklab" and colour.get("status") == "measured"
            and colour.get("cropPixelSha256") == visual.get("cropPixelSha256")
            and raw_top and colour.get("familyId") == raw_top[0].get("familyId")
            and len(raw_top) >= 2 and raw_top[1].get("familyId") == colour.get("familyId")):
        return None
    ctop = colour.get("top") or []
    if (len(ctop) >= 2 and len({c["id"] for c in ctop}) == len(ctop)
            and all(_finite(c.get("distance")) for c in ctop)
            and any(item["id"] == ctop[0]["id"] for item in raw_top)):
        return ctop
    return None


def _band_ratio_decision(field: str, visual: dict | None, out: dict) -> dict:
    """NL and LU differ only in the tone of their blue band. The measured blue
    to red ratio settles a proposed NL or LU, or keeps it under review when the
    tone lies between the two flags."""
    band = (visual or {}).get("flag_band_ratio_qa")
    if not (BAND_RATIO_GUARD and field == "flag" and isinstance(band, dict)
            and band.get("schema") == "mk8dx.flag-band-ratio.v1" and band.get("status") == "measured"
            and band.get("cropPixelSha256") == visual.get("cropPixelSha256")
            and out["proposedId"] in ("country.nl", "country.lu")):
        return out
    decision = band.get("decisionId")
    if decision not in ("country.nl", "country.lu"):
        return {**out, "status": "proposed", "acceptedId": None, "reviewRequired": True,
                "evidence": [*out["evidence"], "flag_band_ratio_between"]}
    first = next((c for c in out["top"] if c["id"] == decision),
                 {"id": decision, "matchScore": None, "textFuzzy": None, "distinctiveDistance": None,
                  "basis": "band_ratio"})
    top = [first, *(c for c in out["top"] if c["id"] != decision)][:3]
    return {**out, "status": "accepted", "proposedId": decision, "selectedId": decision, "acceptedId": decision,
            "proposedFamilyId": decision, "reviewRequired": False, "top": top,
            "evidence": [*out["evidence"], "flag_band_ratio"]}


def _compose_field(field: str, entry: dict | None) -> dict:
    entry = entry or {}
    selected = _visual(entry.get("shared_icon_qa"))
    slot = _visual(entry.get("character_slot_qa"))
    tire_window = _visual(entry.get("tire_window_qa"))
    context = (entry.get("character_text_qa") if field == "character"
               else None if field == "flag" else entry.get("part_text_qa"))
    if not isinstance(context, dict):
        context = None
    if field == "character" and context and context.get("chosenBasis") == "slot" and slot:
        read = slot
    elif (field == "wheel" and context and context.get("cropPixelSha256")
          and tire_window and tire_window.get("cropPixelSha256") == context.get("cropPixelSha256")):
        read = tire_window
    else:
        read = selected
    # The Select-a-Ghost panel reads its character with the ghost_select
    # references; every other field, and every result-card field, with result.
    profile_ok = read is not None and (read.get("profile") == "result"
                                       or (field == "character" and read.get("profile") == "ghost_select"))
    valid = (profile_ok and read.get("kind") == _KIND[field]
             and isinstance(read.get("top"), list) and len(read["top"]) > 0)
    visual = read if valid else None
    chosen = context.get("chosen") if context else None
    if not isinstance(chosen, dict):
        chosen = None
    raw_top = list(visual["top"][:3]) if visual else []

    distinctive = visual.get("flag_distinctive_qa") if field == "flag" and visual else None
    distinct_top = None
    if (isinstance(distinctive, dict) and distinctive.get("cropPixelSha256") == visual.get("cropPixelSha256")
            and len(raw_top) == 3 and len(distinctive.get("top") or []) == 3):
        dtop = distinctive["top"]
        if (all(_finite(c.get("distance")) for c in dtop) and len({c["id"] for c in dtop}) == 3
                and all(any(item["id"] == c["id"] for item in raw_top) for c in dtop)):
            distinct_top = dtop
    if distinct_top:
        ranked_top = [{**next(item for item in raw_top if item["id"] == c["id"]),
                       "distinctiveDistance": c["distance"]} for c in distinct_top]
    else:
        ranked_top = [{**item, "distinctiveDistance": None} for item in raw_top]

    context_accepted = (chosen["id"] if visual and chosen and chosen.get("status") == "accepted"
                        and chosen.get("id") else None)
    # A colour the context proposes for review (the glider colour that follows
    # the character); it leads the proposal but is never accepted by itself.
    suggested = chosen.get("suggestedId") if visual and chosen and not context_accepted else None
    context_suggested = suggested if isinstance(suggested, str) and suggested else None
    colour_rank = _colour_rank(visual, raw_top) if field == "character" and visual else None
    colour_top = colour_rank if visual and visual.get("status") == "unknown" and not context_accepted else None
    # A colour variant settled by the icon (or by a name that names only the
    # family) while the family-colour rank puts another variant of that family
    # first is not settled: show the colour rank's best match for review.
    colour_doubt = nl_settled = False
    if COLOUR_GUARD and colour_rank and not colour_top:
        settled = _coalesce(context_accepted, (visual or {}).get("acceptedId"))
        exact = "exact_name" in ((chosen or {}).get("evidence") or [])
        if (settled and not exact and settled != colour_rank[0]["id"]
                and any(c["id"] == settled for c in colour_rank)):
            colour_top, context_accepted, colour_doubt = colour_rank, None, True
    if colour_top:
        reordered = [item for c in colour_top for item in ranked_top if item["id"] == c["id"]]
        reordered += [item for item in ranked_top if not any(c["id"] == item["id"] for c in colour_top)]
        ranked_top = reordered

    visual_accepted = (visual or {}).get("acceptedId")
    tri = (visual or {}).get("flag_tricolor_qa")
    tricolor = (tri if field == "flag" and visual and visual.get("top1Id") == "country.nl"
                and distinct_top and distinct_top[0]["id"] == "country.nl"
                and isinstance(tri, dict) and tri.get("schema") == "mk8dx.flag-tricolor-evidence.v1"
                and tri.get("status") == "measured"
                and tri.get("cropPixelSha256") == visual.get("cropPixelSha256") else None)
    if colour_doubt:
        accepted_id = None
    elif tricolor:
        accepted_id = tricolor.get("acceptedId")
        # Stripes that cannot be measured apart are no evidence against NL: a
        # settled NL whose distinctive rank keeps LU clearly behind stays.
        if (accepted_id is None and NL_SETTLED_GUARD and tricolor.get("reason") == "insufficient_separation"
                and visual_accepted == "country.nl" and _lu_gap(distinct_top) >= NL_LU_GAP):
            accepted_id, nl_settled = "country.nl", True
    elif context is not None:
        accepted_id = context_accepted
    else:
        accepted_id = None if distinct_top and visual_accepted != distinct_top[0]["id"] else visual_accepted
    # A photo whose white anchor clipped in blue cannot calibrate the blue tone
    # that separates NL from LU: either flag stays a reviewed best match.
    photometric = (visual or {}).get("photometric_qa")
    blue_doubt = (field == "flag" and accepted_id in ("country.nl", "country.lu")
                  and isinstance(photometric, dict)
                  and photometric.get("schema") in ("mk8dx.card-photometric.v1", "mk8dx.panel-photometric.v1")
                  and photometric.get("status") == "corrected" and photometric.get("blueClipped") is True)
    if blue_doubt:
        accepted_id = None
    shape = (visual or {}).get("shape_rank_qa")
    lu_shape = None
    if (tricolor and tricolor.get("proposalId") == "country.lu" and isinstance(shape, dict)
            and shape.get("cropPixelSha256") == visual.get("cropPixelSha256")
            and shape.get("mode") == "full_rgb_ncc" and shape.get("top")
            and shape["top"][0].get("id") == "country.lu"
            and shape["top"][0].get("score") == tricolor.get("proposalShapeScore")):
        lu_shape = shape["top"][0]
    exp = (visual or {}).get("flag_exposure_qa")
    exposure = (exp["top"] if field == "flag" and not accepted_id and not lu_shape
                and isinstance(exp, dict) and exp.get("schema") == "mk8dx.flag-exposure-proposal.v1"
                and exp.get("status") == "measured"
                and exp.get("cropPixelSha256") == visual.get("cropPixelSha256")
                and len(exp.get("top") or []) >= 2
                and all(_finite(item.get("score")) for item in exp["top"]) else None)
    exposed_top = exposure[0] if exposure and visual and visual.get("kind") == "flags" else None
    proposed_id = _coalesce(accepted_id, "country.lu" if lu_shape
                            else _coalesce((exposed_top or {}).get("id"),
                                           _coalesce(context_suggested,
                                                     ranked_top[0]["id"] if ranked_top else None)))

    top: list[dict] = []

    def cand(cid, score, fuzzy, dist, basis, **extra):
        return {"id": cid, "matchScore": score, "textFuzzy": fuzzy,
                "distinctiveDistance": dist, "basis": basis, **extra}

    if lu_shape:
        top.append(cand("country.lu", None, None, None, "shape_ncc", shapeScore=lu_shape["score"]))
    if exposed_top:
        top.append(cand(exposed_top["id"], None, None, None, "exposure", exposureScore=exposed_top["score"]))
    for item in (exposure or [])[1:]:
        if any(c["id"] == item["id"] for c in top):
            continue
        top.append(cand(item["id"], None, None, None, "exposure", exposureScore=item["score"]))
    if exposure:
        del top[3:]
    fuzzy = ((context or {}).get("clue") or {}).get("fuzzy")
    if proposed_id and (context_accepted or proposed_id == context_suggested):
        top.append(cand(proposed_id, next((i["score"] for i in raw_top if i["id"] == proposed_id), None),
                        fuzzy, None, "context"))
    for item in ranked_top:
        if len(top) == 3:
            break
        if any(c["id"] == item["id"] for c in top):
            continue
        colour_item = next((c for c in colour_top or [] if c["id"] == item["id"]), None)
        basis = ("context" if item["id"] == context_accepted else "distinctive" if distinct_top
                 else "family_colour" if colour_item else "visual")
        top.append(cand(item["id"], item["score"], fuzzy if item["id"] == context_accepted else None,
                        item["distinctiveDistance"], basis,
                        **({"familyColourDistance": colour_item["distance"]} if colour_item else {})))
        if len(top) == 3:
            break

    proposed_family = _coalesce((chosen or {}).get("familyId"),
                                "country.lu" if lu_shape
                                else _coalesce((exposed_top or {}).get("id"),
                                               ranked_top[0].get("familyId") if ranked_top else None))
    evidence = [*((chosen or {}).get("evidence") or []),
                *(["flag_distinctive_rank"] if distinct_top else []),
                *(["flag_tricolor_evidence"] if tricolor else []),
                *(["flag_nl_distinctive_settled"] if nl_settled else []),
                *(["photometric_blue_clipped"] if blue_doubt else []),
                *(["flag_lu_pattern"] if lu_shape else []),
                *(["flag_exposure_rank"] if exposed_top else []),
                *(["family_colour_rank"] if colour_top else [])]
    out = {"status": "unavailable" if not proposed_id else "accepted" if accepted_id else "proposed",
            "proposedId": proposed_id, "selectedId": proposed_id, "acceptedId": accepted_id,
            "proposedFamilyId": proposed_family,
            "reviewRequired": proposed_id is not None and accepted_id is None,
            "cropPixelSha256": (visual or {}).get("cropPixelSha256"),
            "selectedCropPixelSha256": (selected or {}).get("cropPixelSha256"),
            "catalogSha256": (visual or {}).get("catalogSha256"),
            "contextStatus": (chosen or {}).get("status"),
            "evidence": evidence, "top": top,
            "visualTop3": [{"id": i["id"], "familyId": i["familyId"], "score": i["score"]} for i in raw_top],
            "familyColour": visual.get("family_colour_qa") if colour_top else None}
    return _open_set_decision(field, visual, raw_top, _band_ratio_decision(field, visual, out))


def _open_set_decision(field: str, visual: dict | None, raw_top: list, out: dict) -> dict:
    """A character the closed set did not accept and without a clear winner: suggest "Mii"
    (open_set.mii_suggestion), never accepted and without a size; the visual top stays the
    alternatives."""
    if field != "character" or not visual or out["acceptedId"] is not None:
        return out
    suggestion = mii_suggestion(visual.get("profile"), raw_top, None)
    if suggestion is None:
        return out
    open_set = {"id": suggestion["id"], "label": suggestion["label"], "mode": suggestion["mode"],
                "score": suggestion["score"], "familyMargin": suggestion["familyMargin"]}
    candidate = {"id": suggestion["id"], "matchScore": None, "textFuzzy": None,
                 "distinctiveDistance": None, "basis": "open_set"}
    if suggestion["mode"] == "alternative":
        # beside the best match: second in the list, the best match stays proposed
        top = [c for c in out["top"] if c["id"] != suggestion["id"]]
        return {**out, "top": [*top[:1], candidate, *top[1:2]],
                "evidence": [*out["evidence"], suggestion["evidence"] + "_alternative"], "openSet": open_set}
    top = [candidate, *(c for c in out["top"] if c["id"] != suggestion["id"])][:3]
    return {**out, "status": "proposed", "proposedId": suggestion["id"], "selectedId": suggestion["id"],
            "proposedFamilyId": suggestion["id"], "reviewRequired": True, "top": top,
            "evidence": [*out["evidence"], suggestion["evidence"]], "openSet": open_set}


def compose_result_proposal(owner: dict) -> dict:
    """Proposal for one owner's five result-card fields (TS: composeResultProposal)."""
    return {"schema": "mk8dx.web-result-field-proposal.v1",
            "fields": {field: _compose_field(field, (owner or {}).get(field)) for field in FIELDS}}
