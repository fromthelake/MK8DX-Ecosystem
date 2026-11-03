"""One central picker for the registered Select-a-Ghost panel (the merged picker).

The product supplies the registered canonical panel, the static slot of each icon,
the printed part names its OCR read, the panel's colour-correction residual and the
display locale. The central reader then finds, compares and decides every field on
its own; the engine's previous matcher is no longer a witness.

Per field:

* position: the reader searches the slot itself (``search_icon``): a 2-px grid of
  +-6 px, +-1 px refinement and a 0.94/1.06 scale step; a wide grid (+-8 px at
  three scales) runs only when the printed name and the icon disagree;
* flag: grey-value (NCC) comparison over +-4 px, then the NL/LU band ratio
  (``read_flag``): the colour comparison takes the US flag for Malaysia's on phone
  photos, the grey comparison does not;
* character: family first; the colour variant is accepted when a second,
  independent colour measurement (the eroded-cutout RGB ranking) agrees, and only
  when the panel's colour fit is reliable; on an unreliable fit (webcam) a
  family must also be backed by the shape (``decide_character``);
* body, tyres, glider: a legible printed name sets the family and the accepted
  character's catalog relation sets the colour; without a legible name the icon
  and the shape must agree (``decide_part``).

Measured on staff192 (384 phone/HDMI images) and staff76 (152 HDMI/webcam):
every field right on every phone and HDMI image, none accepted wrong on webcam.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import refinement
from .flag_rank import flag_band_ratio
from .matcher import BOX, IconMatcher, MatchResult
from .shape_rank import rank_icon_shape

GHOST_PANEL_PICKER_VERSION = "1"
# Panel colour-fit residual (panel_photometric) above which colours are not trusted:
# HDMI 5-19, phone 15-23, webcam 33-45 on the labelled sets.
RELIABLE_COLOUR_RESIDUAL = 28.0
FAMILY_MARGIN_MIN = 0.02
SHAPE_BACKING_MIN = 0.75
NAME_STRONG_FUZZY, NAME_STRONG_MARGIN = 0.85, 0.15
NAME_ALONE_FUZZY, NAME_ALONE_MARGIN = 0.95, 0.15
NAME_WEAK_FUZZY = 0.65
NAME_CONFLICT_FUZZY = 0.55
NL, LU = "country.nl", "country.lu"
PART_KIND = {"kart": "bodies", "wheel": "tires", "glider": "gliders"}
NAME_KIND = {"kart": "body", "wheel": "tire", "glider": "glider"}


def _round(value: float) -> int:
    """floor(v + 0.5): the same in Python, TypeScript and Java."""
    return int(np.floor(value + 0.5))


def crop_at(image: np.ndarray, slot: tuple[int, int, int, int], dx: int = 0, dy: int = 0,
            scale: float = 1.0) -> np.ndarray | None:
    """The slot moved by (dx, dy) and scaled around its centre; None when it leaves the image."""
    x, y, w, h = slot
    cx, cy = x + w / 2.0 + dx, y + h / 2.0 + dy
    hw, hh = w * scale / 2.0, h * scale / 2.0
    x0, y0, x1, y1 = _round(cx - hw), _round(cy - hh), _round(cx + hw), _round(cy + hh)
    if x0 < 0 or y0 < 0 or x1 > image.shape[1] or y1 > image.shape[0] or x1 - x0 < 4 or y1 - y0 < 4:
        return None
    return image[y0:y1, x0:x1]


@dataclass(frozen=True)
class Placed:
    match: MatchResult
    crop: np.ndarray
    dx: int
    dy: int
    scale: float


def search_icon(image: np.ndarray, slot, kind: str, profile: str, matcher: IconMatcher, *,
                wide: bool = False, top_k: int = 8) -> Placed | None:
    """The best-scoring placement of one icon inside its slot (see module docstring)."""
    best: Placed | None = None

    def consider(dx: int, dy: int, scale: float) -> None:
        nonlocal best
        crop = crop_at(image, slot, dx, dy, scale)
        if crop is None:
            return
        result = matcher.match(crop, kind, profile=profile, search_radius=0, top_k=top_k)
        if best is None or result.score > best.match.score:
            best = Placed(result, crop, dx, dy, scale)

    if wide:
        for scale in (0.94, 1.0, 1.06):
            for dy in range(-8, 9, 2):
                for dx in range(-8, 9, 2):
                    consider(dx, dy, scale)
        if best is None:
            return None
        bx, by, bs = best.dx, best.dy, best.scale
        for dy in (by - 1, by, by + 1):
            for dx in (bx - 1, bx, bx + 1):
                consider(dx, dy, bs)
        return best
    for dy in range(-6, 7, 2):
        for dx in range(-6, 7, 2):
            consider(dx, dy, 1.0)
    if best is None:
        return None
    bx, by = best.dx, best.dy
    for dy in (by - 1, by, by + 1):
        for dx in (bx - 1, bx, bx + 1):
            consider(dx, dy, 1.0)
    bx, by = best.dx, best.dy
    for scale in (0.94, 1.06):
        consider(bx, by, scale)
    return best


def read_flag(image: np.ndarray, slot, matcher: IconMatcher) -> dict | None:
    """Grey-value flag decision with the NL/LU band ratio."""
    best: Placed | None = None
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            crop = crop_at(image, slot, dx, dy)
            if crop is None:
                continue
            result = matcher.match(crop, "flags", method="ncc", search_radius=0, top_k=3)
            if best is None or result.score > best.match.score:
                best = Placed(result, crop, dx, dy, 1.0)
    if best is None:
        return None
    top = [candidate.id for candidate in best.match.top]
    chosen, accepted, basis = top[0], best.match.status == "accepted", "ncc"
    band = None
    if len(top) > 1 and {top[0], top[1]} == {NL, LU}:
        query = cv2.cvtColor(cv2.resize(best.crop, BOX["flags"], interpolation=cv2.INTER_AREA),
                             cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        band = flag_band_ratio(query)
        if band["decisionId"]:
            chosen, accepted, basis = band["decisionId"], True, "band_ratio"
        else:
            accepted, basis = False, "band_ratio_between"
    return {"id": chosen, "accepted": accepted, "basis": basis, "score": best.match.score,
            "margin": best.match.margin, "offset": [best.dx, best.dy],
            "top": [[c.id, round(c.score, 4)] for c in best.match.top],
            "bandRatio": None if band is None else band.get("ratio")}


def _shape_top(placed: Placed, kind: str, profile: str, matcher: IconMatcher) -> tuple[str, float]:
    group = matcher.references.groups[(kind, profile)]
    ranked = rank_icon_shape(placed.crop, group, "masked_gray_ncc")["top"][0]
    return ranked["id"], float(ranked["score"])


def _family(matcher: IconMatcher, rid: str | None) -> str | None:
    return None if rid is None else matcher.references.family.get(rid, rid)


def _cutout_top(placed: Placed, matcher: IconMatcher) -> str | None:
    """The second colour opinion: eroded-cutout RGB ranking inside the chosen family."""
    family = placed.match.family_top[0]
    if len(family.variants) < 2:
        return None
    saved = refinement.CUTOUT_RGB_FAMILIES
    refinement.CUTOUT_RGB_FAMILIES = frozenset({("characters", family.family_id)})
    try:
        ranked = refinement.refine_family_variants(placed.crop, "characters", matcher, placed.match)
    finally:
        refinement.CUTOUT_RGB_FAMILIES = saved
    return ranked.ordered[0].id if ranked.ordered else None


def decide_character(placed: Placed, matcher: IconMatcher, residual: float | None) -> dict:
    match = placed.match
    top = match.top[0].id
    families = match.family_top
    family_margin = families[0].score - (families[1].score if len(families) > 1 else 0.0)
    shape_id, shape_score = _shape_top(placed, "characters", "ghost_select", matcher)
    reliable = residual is not None and residual <= RELIABLE_COLOUR_RESIDUAL
    cutout = _cutout_top(placed, matcher) if reliable else None
    if reliable:
        variants = len(families[0].variants) > 1
        accepted = match.status == "accepted" or (
            family_margin >= FAMILY_MARGIN_MIN and (not variants or cutout == top))
        basis = "colour" if match.status == "accepted" else "family_then_colour"
    else:
        accepted = (match.status == "accepted" and _family(matcher, shape_id) == _family(matcher, top)
                    and shape_score >= SHAPE_BACKING_MIN)
        basis = "shape_backed"
    return {"id": top, "accepted": bool(accepted), "basis": basis, "score": match.score,
            "margin": match.margin, "familyMargin": family_margin, "cutoutTop": cutout,
            "shapeTop": shape_id, "shapeScore": shape_score, "reliableColour": reliable,
            "offset": [placed.dx, placed.dy], "scale": placed.scale,
            "top": [[c.id, round(c.score, 4)] for c in match.top[:3]]}


def match_name(text: str | None, names: dict[str, str]) -> tuple[str | None, float, float]:
    """The printed-name clue through the central name matcher (name_match): best id, its
    similarity and its lead over the best name spelled differently."""
    from .name_match import match_name as central_match
    found = central_match(text, list(names.items()))
    return found.key, found.fuzzy, found.margin


def part_names(matcher: IconMatcher, locale: str = "en-GB") -> dict[str, dict[str, str]]:
    """Central printed names of the base parts per field, from the Clean Assets catalog."""
    return names_for_locale(part_name_table(matcher.references), locale)


def part_name_table(references) -> dict:
    """mk8dx.part-names.v1: every base part's printed names in all locales (pack component;
    TypeScript and Java read this table instead of the whole catalog)."""
    names: dict[str, dict[str, dict[str, str]]] = {field: {} for field in NAME_KIND}
    for rid, by_locale in sorted(references.display_names.items()):
        prefix = rid.split(".", 1)[0]
        for field, kind in NAME_KIND.items():
            if prefix == kind and references.family.get(rid, rid) == rid:
                kept = {locale: text for locale, text in sorted(by_locale.items()) if isinstance(text, str) and text}
                if kept:
                    names[field][rid] = kept
    return {"schema": "mk8dx.part-names.v1", "catalogSha256": references.catalog_sha256, "names": names}


def names_for_locale(table: dict, locale: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {field: {} for field in NAME_KIND}
    for field, by_id in table["names"].items():
        for rid, by_locale in by_id.items():
            name = by_locale.get(locale) or by_locale.get("en-GB") or by_locale.get("en-US")
            if name:
                out[field][rid] = name
    return out


def decide_part(field: str, placed: Placed, matcher: IconMatcher, text: str | None,
                names: dict[str, str], character: str | None, reliable: bool,
                wide: Placed | None = None) -> dict:
    """Body, tyres or glider (see module docstring). ``wide`` is the wide-search placement,
    computed by the caller only when ``needs_wide_search`` says so."""
    refs = matcher.references
    kind = PART_KIND[field]
    name_id, fuzzy, margin = match_name(text, names)
    name_family = _family(matcher, name_id)
    strong = name_family if name_id and fuzzy >= NAME_STRONG_FUZZY and margin >= NAME_STRONG_MARGIN else None
    used = wide if wide is not None else placed
    top_ids = [c.id for c in used.match.top[:3]]
    shape_id, shape_score = _shape_top(used, kind, "result", matcher)

    def related(family: str | None) -> str | None:
        if field == "wheel" or not character or not family:
            return None
        return refs.part_for_character.get((kind, family, character))

    def has_variants(family: str | None) -> bool:
        return field != "wheel" and sum(1 for f in refs.family.values() if f == family) > 1

    def result(rid, accepted, basis):
        return {"id": rid, "accepted": bool(accepted), "basis": basis, "score": used.match.score,
                "margin": used.match.margin, "name": name_id,
                "nameFuzzy": fuzzy, "nameMargin": margin, "shapeTop": shape_id, "shapeScore": shape_score,
                "wide": wide is not None, "offset": [used.dx, used.dy], "scale": used.scale,
                "top": [[c.id, round(c.score, 4)] for c in used.match.top[:3]]}

    if strong:
        in_icons = [rid for rid in top_ids if _family(matcher, rid) == strong]
        if _family(matcher, shape_id) == strong:
            in_icons.append(shape_id)
        relation = related(strong)
        if relation:
            return result(relation, bool(in_icons), "name_family_character_colour")
        if in_icons:
            return result(in_icons[0], not has_variants(strong) or reliable, "name_family_icon_colour")
        top_family = _family(matcher, top_ids[0])
        if (_family(matcher, shape_id) == top_family and top_family and top_family.startswith(strong + "_")):
            return result(top_ids[0], True, "icons_over_name_prefix")
        if fuzzy >= NAME_ALONE_FUZZY and margin >= NAME_ALONE_MARGIN:
            return result(related(strong) or strong, True, "name_alone")
        return result(strong, False, "name_icon_conflict")
    top_family = _family(matcher, top_ids[0])
    if name_id and fuzzy >= NAME_CONFLICT_FUZZY and name_family != top_family:
        return result(top_ids[0], False, "half_legible_name_conflict")
    if name_id and fuzzy >= NAME_WEAK_FUZZY and name_family == top_family:
        relation = related(top_family)
        return result(relation or top_ids[0], bool(relation) or not has_variants(top_family) or reliable,
                      "weak_name_and_icon")
    shape_agrees = _family(matcher, shape_id) == top_family
    relation = related(top_family) if shape_agrees else None
    if relation:
        return result(relation, True, "icon_shape_character_colour")
    accepted = (used.match.status == "accepted" and shape_agrees
                and (not has_variants(top_family) or reliable))
    return result(top_ids[0], accepted, "icon_and_shape")


def needs_wide_search(field: str, placed: Placed, matcher: IconMatcher, text: str | None,
                      names: dict[str, str]) -> bool:
    """A legible printed name whose family is not among the icon's first three."""
    name_id, fuzzy, margin = match_name(text, names)
    if not name_id or fuzzy < NAME_STRONG_FUZZY or margin < NAME_STRONG_MARGIN:
        return False
    family = _family(matcher, name_id)
    return not any(_family(matcher, c.id) == family for c in placed.match.top[:3])


def read_ghost_panel(image: np.ndarray, slots: dict, texts: dict, residual: float | None,
                     matcher: IconMatcher, *, locale: str = "en-GB") -> dict:
    """All five fields of one registered panel. ``slots`` maps field -> (x, y, w, h);
    ``texts`` maps kart/wheel/glider -> the OCR line of the printed name (or None)."""
    reliable = residual is not None and residual <= RELIABLE_COLOUR_RESIDUAL
    out: dict = {"version": GHOST_PANEL_PICKER_VERSION, "reliableColour": reliable, "residual": residual}
    if slots.get("flag"):
        out["flag"] = read_flag(image, slots["flag"], matcher)
    character = None
    if slots.get("character"):
        placed = search_icon(image, slots["character"], "characters", "ghost_select", matcher)
        if placed is not None:
            out["character"] = decide_character(placed, matcher, residual)
            if out["character"]["accepted"]:
                character = out["character"]["id"]
    names = part_names(matcher, locale)
    for field in ("kart", "wheel", "glider"):
        if not slots.get(field):
            continue
        placed = search_icon(image, slots[field], PART_KIND[field], "result", matcher)
        if placed is None:
            continue
        text = texts.get(field)
        wide = (search_icon(image, slots[field], PART_KIND[field], "result", matcher, wide=True)
                if needs_wide_search(field, placed, matcher, text, names[field]) else None)
        out[field] = decide_part(field, placed, matcher, text, names[field], character, reliable, wide)
    return out


# Contract field names (frame-description-v1) and the picker's own names.
CONTRACT_FIELD = {"character": "character", "kart": "body", "wheel": "tire", "glider": "glider", "flag": "flag"}
PICKER_FIELD = {contract: picker for picker, contract in CONTRACT_FIELD.items()}
_TRACE_KEYS = ("basis", "score", "top", "id", "accepted")


def decide_ghost_select_frame(description: dict, image: np.ndarray, matcher: IconMatcher) -> dict:
    """frame-description-v1 (frame ``timetrial_ghost_select``) in, frame-decision-v1 out.

    The searcher has registered the panel onto its canonical frame; ``image`` is that frame.
    App candidate scopes (section 8.4) are not supported by this decision yet and are refused
    rather than silently ignored."""
    from . import FIELD_SEMANTICS_VERSION
    if description.get("schema") != "mk8dx.frame-description.v1" or \
            description.get("frame") != "timetrial_ghost_select":
        raise ValueError("Expected a timetrial_ghost_select frame description")
    if image.shape[1] != description["image"]["width"] or image.shape[0] != description["image"]["height"]:
        raise ValueError("Image size differs from the frame description")
    slots, texts = {}, {}
    for item in description["fields"]:
        picker = PICKER_FIELD.get(item["field"])
        if picker is None:
            raise ValueError(f"Field {item['field']} is not part of the Select-a-Ghost decision")
        if item.get("candidates"):
            raise ValueError("Candidate scopes are not supported by the Select-a-Ghost decision yet")
        slots[picker] = tuple(item["slot"])
        if picker in PART_KIND:
            texts[picker] = (item.get("context") or {}).get("printedText")
    read = read_ghost_panel(image, slots, texts, description["residual"], matcher,
                            locale=description.get("locale", "en-GB"))
    fields = []
    for item in description["fields"]:
        picker = PICKER_FIELD[item["field"]]
        decided = read.get(picker)
        if decided is None:
            fields.append({"field": item["field"], "selectedId": None, "acceptedId": None,
                           "basis": "not_placed", "score": 0.0, "alternatives": []})
            continue
        fields.append({
            "field": item["field"], "selectedId": decided["id"],
            "acceptedId": decided["id"] if decided["accepted"] else None,
            "basis": decided["basis"], "score": float(decided["score"]),
            "alternatives": [{"id": rid, "score": float(score)} for rid, score in decided["top"][:3]],
            "evidence": {key: value for key, value in decided.items() if key not in _TRACE_KEYS},
        })
    return {"schema": "mk8dx.frame-decision.v1", "frame": "timetrial_ghost_select",
            "fieldSemanticsVersion": FIELD_SEMANTICS_VERSION,
            "decisionVersion": f"ghost_panel_picker.{GHOST_PANEL_PICKER_VERSION}",
            "reliableColour": read["reliableColour"], "fields": fields}
