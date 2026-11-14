package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Text and character context after visual ranking: the present-field branches of Python
 * {@code context.combine_character} / {@code combine_part}, ported from
 * {@code sharedCharacterContext.ts} and {@code sharedPartContext.ts}. Decisions are replayed
 * against {@code vectors/context-v1.json} (ContextParityTest). Presence is decided upstream;
 * the caller supplies catalog relationships from the same pinned Clean Assets version as the
 * visual references. The visual top three is kept unchanged.
 */
public final class ContextRules {
    private ContextRules() {
    }

    /** One ranked visual candidate. */
    public static final class Candidate {
        public final String id;
        public final String familyId;
        public final double score;

        public Candidate(String id, String familyId, double score) {
            this.id = id;
            this.familyId = familyId;
            this.score = score;
        }
    }

    /** A present visual field read (mk8dx.visual-field-read.v1, the fields context uses). */
    public static final class Visual {
        public final String kind;
        public final String status;
        public final String acceptedId;
        public final double score;
        public final double margin;
        public final Double familyMargin;
        public final List<Candidate> top;

        public Visual(String kind, String status, String acceptedId, double score, double margin,
                      Double familyMargin, List<Candidate> top) {
            this.kind = kind;
            this.status = status;
            this.acceptedId = acceptedId;
            this.score = score;
            this.margin = margin;
            this.familyMargin = familyMargin;
            this.top = Collections.unmodifiableList(new ArrayList<>(top));
        }
    }

    /** A text clue: a catalog ID (or a tyre row index) with its fuzzy score and margin. */
    public static final class Clue {
        public final String id;
        public final double fuzzy;
        public final double margin;

        public Clue(String id, double fuzzy, double margin) {
            this.id = id;
            this.fuzzy = fuzzy;
            this.margin = margin;
        }

        boolean finite() {
            return !Double.isNaN(fuzzy) && !Double.isInfinite(fuzzy)
                    && !Double.isNaN(margin) && !Double.isInfinite(margin);
        }

        boolean strong() {
            return finite() && fuzzy >= 0.85 && margin >= 0.08;
        }
    }

    /** A context decision; {@code suggestedId} is a review proposal when {@code id} is null. */
    public static final class Decision {
        public final String id;
        public final String familyId;
        public final String status;
        public final List<String> evidence;
        public final String visualTop1;
        public final String suggestedId;

        public Decision(String id, String familyId, String status, List<String> evidence,
                        String visualTop1, String suggestedId) {
            this.id = id;
            this.familyId = familyId;
            this.status = status;
            this.evidence = Collections.unmodifiableList(new ArrayList<>(evidence));
            this.visualTop1 = visualTop1;
            this.suggestedId = suggestedId;
        }
    }

    /** Catalog relationships: family by ID, result members per kind ({id, familyId}), part for character, tyre rows. */
    public static final class References {
        public final Map<String, String> familyById;
        public final Map<String, List<String[]>> resultMembers;
        public final Map<String, String> partForCharacter;
        public final Map<Integer, String> tireByIndex;

        public References(Map<String, String> familyById, Map<String, List<String[]>> resultMembers,
                          Map<String, String> partForCharacter, Map<Integer, String> tireByIndex) {
            this.familyById = familyById;
            this.resultMembers = resultMembers;
            this.partForCharacter = partForCharacter;
            this.tireByIndex = tireByIndex;
        }
    }

    public static String relationKey(String kind, String familyId, String characterId) {
        return kind + '\u0000' + familyId + '\u0000' + characterId;
    }

    /**
     * A numeric clue ID (tyre row index): ASCII 0-9 only, in every runtime. OCR text is folded to
     * ASCII digits where it is normalized (NameMatch.normalize).
     */
    public static boolean asciiIndex(String text) {
        if (text == null || text.isEmpty()) return false;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch < '0' || ch > '9') return false;
        }
        return true;
    }

    /** The tyre for an ASCII row index; an index longer than any catalog row is no tyre. */
    private static String tire(References refs, String index) {
        return index.length() > 9 ? null : refs.tireByIndex.get(Integer.parseInt(index));
    }

    private static List<String> list(String... values) {
        List<String> out = new ArrayList<>();
        Collections.addAll(out, values);
        return out;
    }

    private static void check(Visual visual, String kind) {
        if (visual == null || !kind.equals(visual.kind) || visual.top.isEmpty()
                || "accepted".equals(visual.status) != (visual.acceptedId != null)) {
            throw new IllegalArgumentException("Expected a present " + kind + " visual read");
        }
    }

    public static Decision combineCharacter(Visual visual, Clue clue, Map<String, String> familyById) {
        check(visual, "characters");
        Candidate top = visual.top.get(0);
        String clueFamily = clue == null ? null : familyById.get(clue.id);
        boolean strong = clue != null && clue.strong();
        String observedFamily = visual.acceptedId != null ? top.familyId : null;
        if (strong && top.familyId.equals(clueFamily)) {
            if ("accepted".equals(visual.status) && !clue.id.equals(top.id)
                    && !clue.id.equals(top.familyId) && clue.fuzzy < 1) {
                // Approximate OCR cannot replace an accepted different colour and then
                // propagate that colour through a character-part catalog relation.
                return new Decision(null, top.familyId, "conflict", list("visual_name_variant_conflict"),
                        top.id, null);
            }
            if (clue.id.equals(top.familyId) && !top.id.equals(top.familyId)) {
                Candidate base = null;
                for (Candidate candidate : visual.top) {
                    if (candidate.id.equals(clue.id)) {
                        base = candidate;
                        break;
                    }
                }
                if (base != null && visual.score < 0.80 && top.score - base.score <= 0.015) {
                    return new Decision(clue.id, top.familyId, "accepted", list("name_base_close_visual"),
                            top.id, null);
                }
                return new Decision(visual.acceptedId, observedFamily, visual.status,
                        list("visual", "name_family"), top.id, null);
            }
            return new Decision(clue.id, top.familyId, "accepted", list("visual_family", "exact_name"),
                    top.id, null);
        }
        if (strong && clueFamily != null) {
            if (clue.fuzzy >= 0.90 && (visual.score < 0.85 || visual.margin < 0.05)) {
                return new Decision(clue.id, clueFamily, "accepted",
                        list("exact_name_cross_family", "visual_disagreement"), top.id, null);
            }
            return new Decision(null, null, "conflict", list("visual_name_conflict"), top.id, null);
        }
        return new Decision(visual.acceptedId, observedFamily, visual.status, list("visual"), top.id, null);
    }

    private static boolean inTop3(Visual visual, String id) {
        for (int i = 0; i < Math.min(3, visual.top.size()); i++) {
            if (visual.top.get(i).id.equals(id)) return true;
        }
        return false;
    }

    private static boolean colourFamily(References refs, String kind, String family) {
        int count = 0;
        for (String[] member : refs.resultMembers.get(kind)) {
            if (member[1].equals(family)) count++;
        }
        return count > 1;
    }

    /** The catalog colour of this body or glider family for this character, if the catalog links them. */
    private static String catalogColour(References refs, String kind, String family, String characterId) {
        if (characterId == null || characterId.isEmpty()) return null;
        String relation = refs.partForCharacter.get(relationKey(kind, family, characterId));
        return relation != null && family.equals(refs.familyById.get(relation)) ? relation : null;
    }

    public static Decision combinePart(String kind, Visual visual, Decision character, Clue clue,
                                       References refs, boolean tireTextTop3Guard) {
        check(visual, kind);
        if (!refs.resultMembers.containsKey(kind)) {
            throw new IllegalArgumentException("Expected a part catalog for " + kind);
        }
        Candidate top = visual.top.get(0);
        String family = top.familyId;
        List<String> evidence = list("visual_family");
        boolean strong = clue != null && clue.strong();
        boolean numeric = clue != null && asciiIndex(clue.id);
        String textId = "tires".equals(kind) && numeric
                ? tire(refs, clue.id) : clue == null ? null : clue.id;
        String textFamily = textId == null ? null : refs.familyById.get(textId);
        if (clue != null && !strong && clue.finite() && clue.fuzzy >= 0.65 && clue.margin >= 0.15
                && textFamily != null && !textFamily.equals(top.familyId)) {
            return new Decision(null, top.familyId, "conflict", list("visual_text_conflict_review"),
                    top.id, null);
        }
        if ("tires".equals(kind) && strong && numeric) {
            String tire = tire(refs, clue.id);
            if (tire != null && tireTextTop3Guard && !inTop3(visual, tire)) {
                return new Decision(null, family, "conflict", list("tire_text_outside_visual_top3"),
                        top.id, null);
            }
            if (tire != null) return new Decision(tire, tire, "accepted", list("tire_text"), top.id, null);
        }
        if ("tires".equals(kind) && numeric) {
            String tire = tire(refs, clue.id);
            if (top.id.equals(tire) && clue.fuzzy >= 0.70 && clue.margin >= 0.30
                    && visual.score >= 0.80 && visual.margin >= 0.01) {
                return new Decision(tire, tire, "accepted", list("visual_medium_tire_text"), top.id, null);
            }
        }
        if (strong && textFamily != null) {
            family = textFamily;
            evidence = !family.equals(top.familyId) ? list("exact_text_family")
                    : list("visual_family", "text_family");
        }
        String chosen = family.equals(top.familyId) ? visual.acceptedId : null;
        boolean strongVisualVariant = "accepted".equals(visual.status) && family.equals(top.familyId);
        boolean colouredPart = "bodies".equals(kind) || "gliders".equals(kind);
        boolean characterAccepted = character.id != null && !character.id.isEmpty()
                && "accepted".equals(character.status);
        // Body and glider colour follow the character (issue #99): only an accepted
        // character supplies a catalog colour. An unknown, suggested or conflicting
        // character never does, not even as a review proposal.
        String colour = colouredPart && characterAccepted
                ? catalogColour(refs, kind, family, character.id) : null;
        if (colour != null && strongVisualVariant && !colour.equals(chosen)) {
            if (inTop3(visual, colour)) {
                // A close colour in the visual top three: the catalog decides.
                chosen = colour;
                evidence.add("character_part_top3_variant");
            } else {
                // The icon clearly shows a colour this character cannot have. Keep the
                // catalog colour as the proposal; the clash usually means the character
                // is wrong, so the field needs review.
                evidence.add("character_colour_conflict_review");
                return new Decision(null, family, "conflict", evidence, top.id, colour);
            }
        }
        if (colouredPart && character.id != null && !character.id.isEmpty()
                && !strongVisualVariant && (visual.score >= 0.80 || strong)) {
            String relation = colour;
            if (relation != null) {
                if ("gliders".equals(kind) && !strong && visual.familyMargin != null
                        && visual.familyMargin < 0.02) {
                    evidence.add("weak_family_relation_review");
                } else {
                    chosen = relation;
                    evidence.add("character_part_relation");
                }
            }
        }
        if (chosen == null && strong) {
            List<String> members = new ArrayList<>();
            for (String[] member : refs.resultMembers.get(kind)) {
                if (member[1].equals(family)) members.add(member[0]);
            }
            if (members.size() == 1) {
                chosen = members.get(0);
                evidence.add("unique_text_family");
            } else if (family.equals(top.familyId) && visual.score >= 0.75 && visual.margin >= 0.01) {
                chosen = top.id;
                evidence.add("text_supported_visual_variant");
            }
        }
        String suggestion = chosen == null ? colour : null;
        boolean colourOpen = colouredPart && chosen != null && !characterAccepted && colourFamily(refs, kind, family);
        if (colourOpen && chosen.equals(top.id) && strong && family.equals(textFamily)) {
            // Owner option 2 (#173): without an accepted character, the icon's own colour
            // is kept when the printed name reads this family. An unaccepted character
            // plays no part: it neither supplies nor vetoes a colour.
            evidence.add("name_supported_icon_colour");
        } else if (colourOpen) {
            // The family is readable and carries the stats, but an unaccepted character
            // cannot settle its colour: accept the family only. The colour proposal is
            // the icon's own (no suggestedId).
            evidence.add("gliders".equals(kind) ? "glider_colour_needs_character" : "body_colour_needs_character");
            return new Decision(null, family, "family_only", evidence, top.id, null);
        }
        if (suggestion != null) evidence.add("character_colour_suggestion");
        if (chosen == null && strong && family.equals(clue.id)) {
            return new Decision(null, family, "family_only", evidence, top.id, suggestion);
        }
        return new Decision(chosen, chosen != null ? family : null, chosen != null ? "accepted" : "unknown",
                evidence, top.id, suggestion);
    }
}
