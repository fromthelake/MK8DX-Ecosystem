"""Optional evidence fusion after visual ranking; preserve its original trace."""

from __future__ import annotations

from dataclasses import dataclass

from .matcher import MatchResult, ReferenceBank


@dataclass(frozen=True)
class TextClue:
    id: str
    fuzzy: float
    margin: float = 1.0

    @property
    def strong(self) -> bool:
        return self.fuzzy >= 0.85 and self.margin >= 0.08


@dataclass(frozen=True)
class Decision:
    id: str | None
    family_id: str | None
    status: str
    evidence: tuple[str, ...]
    visual_top1: str | None
    # A colour to propose for review when ``id`` is None (the glider colour that
    # follows the character, issue #99); never an accepted value on its own.
    suggested_id: str | None = None


def ascii_index(text: str) -> bool:
    """A numeric clue ID (tyre row index): ASCII ``0``-``9`` only, in every runtime.

    OCR text is folded to ASCII digits where it is normalized (``name_match.normalize``);
    other digit scripts are not numeric IDs.
    """
    return bool(text) and all("0" <= ch <= "9" for ch in text)


def _colour_family(refs: ReferenceBank, kind: str, family: str) -> bool:
    """The family has more than one colour in the result catalog."""
    group = refs.groups[(kind, "result")]
    return sum(1 for base in group.families if base == family) > 1


def _glider_relation(refs: ReferenceBank, family: str, character_id: str | None) -> str | None:
    """The catalog colour of this glider family for this character, if the catalog links them."""
    relation = refs.part_for_character.get(("gliders", family, character_id)) if character_id else None
    return relation if relation and refs.family.get(relation) == family else None


def combine_character(visual: MatchResult, clue: TextClue | None, refs: ReferenceBank) -> Decision:
    if visual.status == "absent":
        return Decision(None, None, "absent", ("presence",), None)
    top = visual.top[0]
    if clue and clue.strong and clue.id in refs.family and refs.family[clue.id] == top.family_id:
        if (visual.status == "accepted" and clue.id != top.id
                and clue.id != top.family_id and clue.fuzzy < 1.0):
            # An approximate OCR variant must not replace an independently
            # accepted different colour in the same family. Retain the visual
            # top three for review and do not pass a false character colour
            # into body/glider relations.
            return Decision(None, top.family_id, "conflict",
                            ("visual_name_variant_conflict",), top.id)
        if clue.id == top.family_id and top.id != top.family_id:
            # A generic name can resolve a close base/variant colour tie only
            # when the base image itself is among the visible top candidates.
            # A distant base must not overwrite a confidently seen recolour.
            base = next((candidate for candidate in visual.top if candidate.id == clue.id), None)
            if base and visual.score < 0.80 and top.score - base.score <= 0.015:
                return Decision(clue.id, top.family_id, "accepted",
                                ("name_base_close_visual",), top.id)
            return Decision(visual.id, visual.family_id, visual.status,
                            ("visual", "name_family"), top.id)
        return Decision(clue.id, top.family_id, "accepted", ("visual_family", "exact_name"), top.id)
    if clue and clue.strong and clue.id in refs.family:
        if clue.fuzzy >= 0.90 and (visual.score < 0.85 or visual.margin < 0.05):
            return Decision(clue.id, refs.family[clue.id], "accepted",
                            ("exact_name_cross_family", "visual_disagreement"), top.id)
        return Decision(None, None, "conflict", ("visual_name_conflict",), top.id)
    return Decision(visual.id, visual.family_id, visual.status, ("visual",), top.id)


def combine_part(kind: str, visual: MatchResult, character: Decision, clue: TextClue | None,
                 refs: ReferenceBank, *, tire_text_top3_guard: bool = False) -> Decision:
    if kind not in ("bodies", "gliders", "tires"):
        raise ValueError(f"Unsupported part: {kind}")
    if visual.status == "absent":
        return Decision(None, None, "absent", ("presence",), None)
    top = visual.top[0]
    family = top.family_id
    evidence = ["visual_family"]
    if clue and not clue.strong and clue.fuzzy >= 0.65 and clue.margin >= 0.15:
        text_id = (refs.tire_by_index.get(int(clue.id))
                   if kind == "tires" and ascii_index(clue.id) else clue.id)
        text_family = refs.family.get(text_id)
        if text_family and text_family != family:
            # A moderately legible in-game row contradicts this icon family.
            # Keep the named visual top three but do not turn a character-part
            # relation or a narrow visual rank into automatic acceptance.
            return Decision(None, family, "conflict", ("visual_text_conflict_review",), top.id)
    if kind == "tires" and clue and clue.strong:
        tire = refs.tire_by_index.get(int(clue.id)) if ascii_index(clue.id) else None
        if tire:
            if (tire_text_top3_guard
                    and all(candidate.id != tire for candidate in visual.top[:3])):
                return Decision(None, family, "conflict",
                                ("tire_text_outside_visual_top3",), top.id)
            return Decision(tire, tire, "accepted", ("tire_text",), top.id)
    if kind == "tires" and clue and ascii_index(clue.id):
        tire = refs.tire_by_index.get(int(clue.id))
        if tire == top.id and clue.fuzzy >= 0.70 and clue.margin >= 0.30 and (
                visual.score >= 0.80 and visual.margin >= 0.01):
            return Decision(tire, tire, "accepted", ("visual_medium_tire_text",), top.id)
    if clue and clue.strong and clue.id in refs.family:
        family = refs.family[clue.id]
        evidence = ["exact_text_family"] if family != top.family_id else ["visual_family", "text_family"]
    if family == top.family_id:
        chosen = visual.id
    else:
        chosen = None
    strong_visual_variant = visual.status == "accepted" and family == top.family_id
    character_accepted = bool(character.id) and character.status == "accepted"
    # Glider colour follows the character (issue #99): the catalog colour of an
    # accepted character, or of the suggested character for a review proposal.
    colour = (_glider_relation(refs, family, character.id if character_accepted
                               else character.visual_top1)
              if kind == "gliders" else None)
    if (kind == "gliders" and character_accepted and colour and strong_visual_variant
            and colour != chosen):
        if any(candidate.id == colour for candidate in visual.top[:3]):
            # A close colour in the visual top three: the catalog decides.
            chosen = colour
            evidence.append("character_part_top3_variant")
        else:
            # The icon clearly shows a colour this character cannot have. Keep
            # the catalog colour as the proposal; the clash usually means the
            # character is wrong, so the field needs review.
            return Decision(None, family, "conflict",
                            (*evidence, "character_colour_conflict_review"), top.id, colour)
    if kind in ("bodies", "gliders") and character.id and not strong_visual_variant and (
            visual.score >= 0.80 or (clue and clue.strong)):
        relation = (colour if character_accepted else None) if kind == "gliders" else (
            refs.part_for_character.get((kind, family, character.id)))
        if relation:
            family_margin = (visual.family_top[0].score - visual.family_top[1].score
                             if len(visual.family_top) > 1 else None)
            if (kind == "gliders" and not (clue and clue.strong)
                    and family_margin is not None and family_margin < 0.02):
                # A character relationship refines colour inside an observed
                # family. Without a readable family name, a near-tied family
                # cannot be promoted to an exact ID by that relationship.
                evidence.append("weak_family_relation_review")
            else:
                chosen = relation
                evidence.append("character_part_relation")
    if chosen is None and clue and clue.strong:
        members = [rid for rid, base in zip(refs.groups[(kind, "result")].ids,
                                              refs.groups[(kind, "result")].families) if base == family]
        if len(members) == 1:
            chosen = members[0]
            evidence.append("unique_text_family")
        elif family == top.family_id and visual.score >= 0.75 and visual.margin >= 0.01:
            chosen = top.id
            evidence.append("text_supported_visual_variant")
    suggestion = colour if kind == "gliders" and chosen is None else None
    if (kind == "gliders" and chosen is not None and not character_accepted
            and _colour_family(refs, kind, family)):
        # The family is readable and carries the stats, but an unaccepted
        # character cannot settle its colour: accept the family only and
        # propose the suggested character's catalog colour, else the icon's.
        return Decision(None, family, "family_only",
                        (*evidence, "glider_colour_needs_character",
                         *(("character_colour_suggestion",) if colour else ())),
                        top.id, colour)
    if suggestion:
        evidence.append("character_colour_suggestion")
    if chosen is None and clue and clue.strong and clue.id == family:
        # The family is observed, but the exact recolour is still unknown.
        return Decision(None, family, "family_only", tuple(evidence), top.id, suggestion)
    return Decision(chosen, family if chosen else None,
                    "accepted" if chosen else "unknown", tuple(evidence), top.id, suggestion)
