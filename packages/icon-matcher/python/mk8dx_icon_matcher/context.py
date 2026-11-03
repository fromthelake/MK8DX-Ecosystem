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
                   if kind == "tires" and clue.id.isdecimal() else clue.id)
        text_family = refs.family.get(text_id)
        if text_family and text_family != family:
            # A moderately legible in-game row contradicts this icon family.
            # Keep the named visual top three but do not turn a character-part
            # relation or a narrow visual rank into automatic acceptance.
            return Decision(None, family, "conflict", ("visual_text_conflict_review",), top.id)
    if kind == "tires" and clue and clue.strong:
        tire = refs.tire_by_index.get(int(clue.id)) if clue.id.isdecimal() else None
        if tire:
            if (tire_text_top3_guard
                    and all(candidate.id != tire for candidate in visual.top[:3])):
                return Decision(None, family, "conflict",
                                ("tire_text_outside_visual_top3",), top.id)
            return Decision(tire, tire, "accepted", ("tire_text",), top.id)
    if kind == "tires" and clue and clue.id.isdecimal():
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
    if (kind == "gliders" and strong_visual_variant and chosen == top.id
            and character.id and character.status == "accepted"
            and clue and clue.strong and clue.id == family):
        relation = refs.part_for_character.get((kind, family, character.id))
        if (relation and relation != chosen and refs.family.get(relation) == family
                and any(candidate.id == relation for candidate in visual.top[:3])):
            # The game catalog determines this character's colour inside a
            # readable glider family. Require that colour to be visible in the
            # original top three before refining an accepted visual variant.
            chosen = relation
            evidence.append("character_part_top3_variant")
    if kind in ("bodies", "gliders") and character.id and not strong_visual_variant and (
            visual.score >= 0.80 or (clue and clue.strong)):
        relation = refs.part_for_character.get((kind, family, character.id))
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
    if chosen is None and clue and clue.strong and clue.id == family:
        # The family is observed, but the exact recolour is still unknown.
        return Decision(None, family, "family_only", tuple(evidence), top.id)
    if (kind == "gliders" and chosen == top.id
            and clue and clue.strong and clue.id == family
            and character.id is None and character.status in ("unknown", "suggested")
            and character.visual_top1):
        relation = refs.part_for_character.get((kind, family, character.visual_top1))
        if relation and relation != chosen and refs.family.get(relation) == family:
            # A generic row name supports the glider family, not its colour.
            # An unaccepted character cannot choose the alternative, but its
            # conflicting catalog colour can require review of this exact ID.
            return Decision(None, family, "conflict",
                            (*evidence, "unaccepted_character_colour_conflict_review"), top.id)
    return Decision(chosen, family if chosen else None,
                    "accepted" if chosen else "unknown", tuple(evidence), top.id)
