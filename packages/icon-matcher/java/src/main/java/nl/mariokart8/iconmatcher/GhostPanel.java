package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The central Select-a-Ghost picker (Python mk8dx_icon_matcher.ghost_panel, TS
 * sharedGhostPanel.ts). The ROI Searcher has registered the panel onto its canonical frame and
 * describes it (frame-description-v1); this class refines each icon's position, compares and
 * decides every field on its own (frame-decision-v1). Pixels come through a {@link CropSource}.
 */
public final class GhostPanel {
    public static final String PICKER_VERSION = "2";
    public static final double RELIABLE_COLOUR_RESIDUAL = 28.0;
    private static final double FAMILY_MARGIN_MIN = 0.02;
    private static final double SHAPE_BACKING_MIN = 0.75;
    private static final double NAME_STRONG_FUZZY = 0.85, NAME_STRONG_MARGIN = 0.15;
    private static final double NAME_ALONE_FUZZY = 0.95, NAME_ALONE_MARGIN = 0.15;
    private static final double NAME_WEAK_FUZZY = 0.65;
    private static final double NAME_CONFLICT_FUZZY = 0.55;
    private static final String NL = "country.nl", LU = "country.lu";
    private static final String[] PART_FIELDS = {"body", "tire", "glider"};

    private GhostPanel() {
    }

    /** The slot moved by (dx, dy) and scaled around its centre, normalized (INTER_AREA, RGB 0..1); null outside. */
    public interface CropSource {
        float[] crop(String field, int dx, int dy, double scale, int width, int height);
    }

    /** Reference groups and catalog relations from the recognition pack. */
    public static final class References {
        final IconGroup characters, bodies, tires, gliders, flags;
        final Map<String, String> familyById;
        final Map<String, String> partForCharacter;
        final JSONObject partNames;

        /** {@code partForCharacter} keys are {@link #relationKey}; {@code partNames} is mk8dx.part-names.v1. */
        public References(IconGroup characters, IconGroup bodies, IconGroup tires, IconGroup gliders, IconGroup flags,
                          Map<String, String> familyById, Map<String, String> partForCharacter, JSONObject partNames) {
            this.characters = characters;
            this.bodies = bodies;
            this.tires = tires;
            this.gliders = gliders;
            this.flags = flags;
            this.familyById = familyById;
            this.partForCharacter = partForCharacter;
            this.partNames = partNames;
        }

        /** The groups GhostPanel needs from a pack loaded with at least these keys. */
        public static final String[] GROUP_KEYS = {"characters__ghost_select", "bodies__result", "tires__result",
                "gliders__result", "flags__result"};

        /** From a loaded reference pack (references.json context) and the pack's part-names table. */
        public static References fromPack(ReferencePack pack, JSONObject partNames) throws JSONException {
            if (!"mk8dx.part-names.v1".equals(partNames.optString("schema"))
                    || !pack.catalogSha256.equals(partNames.optString("catalogSha256"))) {
                throw new IllegalArgumentException("Part names are not from the reference pack's catalog");
            }
            Map<String, String> families = new LinkedHashMap<>();
            JSONObject groups = pack.manifest.getJSONObject("groups");
            for (Iterator<String> it = groups.keys(); it.hasNext(); ) {
                JSONObject group = groups.getJSONObject(it.next());
                JSONArray ids = group.getJSONArray("ids"), fams = group.getJSONArray("families");
                for (int i = 0; i < ids.length(); i++) families.put(ids.getString(i), fams.getString(i));
            }
            Map<String, String> relations = new LinkedHashMap<>();
            JSONArray rows = pack.manifest.getJSONObject("context").getJSONArray("partForCharacter");
            for (int i = 0; i < rows.length(); i++) {
                JSONArray row = rows.getJSONArray(i);
                relations.put(relationKey(row.getString(0), row.getString(1), row.getString(2)), row.getString(3));
            }
            return new References(pack.group("characters__ghost_select"), pack.group("bodies__result"),
                    pack.group("tires__result"), pack.group("gliders__result"), pack.group("flags__result"),
                    families, relations, partNames);
        }

        IconGroup part(String field) {
            return "body".equals(field) ? bodies : "tire".equals(field) ? tires : gliders;
        }
    }

    public static String relationKey(String kind, String family, String character) {
        return kind + "\u0000" + family + "\u0000" + character;
    }

    private static final class Candidate {
        final String id, familyId;
        final double score;

        Candidate(String id, String familyId, double score) {
            this.id = id;
            this.familyId = familyId;
            this.score = score;
        }
    }

    private static final class Family {
        final String familyId;
        final double score;
        final List<Candidate> variants;

        Family(String familyId, List<Candidate> variants) {
            this.familyId = familyId;
            this.score = variants.get(0).score;
            this.variants = variants;
        }
    }

    private static final class Match {
        boolean accepted;
        double score, margin;
        final List<Candidate> top = new ArrayList<>();
        final List<Family> familyTop = new ArrayList<>();
    }

    private static final class Placed {
        final Match match;
        final float[] query;
        final int dx, dy;
        final double scale;

        Placed(Match match, float[] query, int dx, int dy, double scale) {
            this.match = match;
            this.query = query;
            this.dx = dx;
            this.dy = dy;
            this.scale = scale;
        }
    }

    private static final class Decided {
        String id;
        boolean accepted;
        String basis;
        double score;
        final List<Candidate> top = new ArrayList<>();
        final JSONObject evidence = new JSONObject();
    }

    static double[] scoreAll(float[] query, IconGroup group, boolean ncc) {
        int pixels = group.width * group.height;
        double[] scores = new double[group.ids.length];
        for (int index = 0; index < scores.length; index++) {
            if (!ncc) {
                scores[index] = IconScorer.scoreAt(query, group, index);
                continue;
            }
            int base = index * pixels * 3;
            double total = group.count[index] * 3 + 1e-6, refSum = 0, querySum = 0;
            for (int offset : group.masked[index]) {
                for (int c = 0; c < 3; c++) {
                    refSum += group.rgb[base + offset + c];
                    querySum += query[offset + c];
                }
            }
            double refMean = refSum / total, queryMean = querySum / total;
            double numerator = 0, refEnergy = 0, queryEnergy = 0;
            for (int offset : group.masked[index]) {
                for (int c = 0; c < 3; c++) {
                    double a = group.rgb[base + offset + c] - refMean;
                    double b = query[offset + c] - queryMean;
                    numerator += a * b;
                    refEnergy += a * a;
                    queryEnergy += b * b;
                }
            }
            double denominator = Math.sqrt(refEnergy * queryEnergy);
            scores[index] = denominator > 1e-6 ? numerator / Math.max(denominator, 1e-6) : 0;
        }
        return scores;
    }

    private static Match match(float[] query, IconGroup group, boolean ncc, int topK) {
        double[] scores = scoreAll(query, group, ncc);
        Integer[] order = new Integer[scores.length];
        for (int i = 0; i < order.length; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> {
            int byScore = Double.compare(scores[b], scores[a]);
            return byScore != 0 ? byScore : Integer.compare(a, b);
        });
        Match out = new Match();
        out.score = scores[order[0]];
        out.margin = out.score - scores[order[1]];
        out.accepted = out.score >= (ncc ? 0.35 : 0.80) && out.margin >= 0.02;
        for (int i = 0; i < Math.min(topK, order.length); i++) {
            out.top.add(new Candidate(group.ids[order[i]], group.families[order[i]], scores[order[i]]));
        }
        Map<String, List<Candidate>> families = new LinkedHashMap<>();
        for (int index : order) {
            families.computeIfAbsent(group.families[index], k -> new ArrayList<>())
                    .add(new Candidate(group.ids[index], group.families[index], scores[index]));
        }
        for (Map.Entry<String, List<Candidate>> entry : families.entrySet()) {
            if (out.familyTop.size() == 3) break;
            out.familyTop.add(new Family(entry.getKey(), entry.getValue()));
        }
        return out;
    }

    private static Placed consider(Placed best, CropSource source, String field, IconGroup group,
                                   int dx, int dy, double scale) {
        float[] query = source.crop(field, dx, dy, scale, group.width, group.height);
        if (query == null) return best;
        Match m = match(query, group, false, 8);
        return best == null || m.score > best.match.score ? new Placed(m, query, dx, dy, scale) : best;
    }

    private static Placed searchIcon(CropSource source, String field, IconGroup group, boolean wide) {
        Placed best = null;
        if (wide) {
            for (double scale : new double[]{0.94, 1.0, 1.06}) {
                for (int dy = -8; dy <= 8; dy += 2) {
                    for (int dx = -8; dx <= 8; dx += 2) best = consider(best, source, field, group, dx, dy, scale);
                }
            }
            if (best == null) return null;
            int bx = best.dx, by = best.dy;
            double bs = best.scale;
            for (int dy = by - 1; dy <= by + 1; dy++) {
                for (int dx = bx - 1; dx <= bx + 1; dx++) best = consider(best, source, field, group, dx, dy, bs);
            }
            return best;
        }
        for (int dy = -6; dy <= 6; dy += 2) {
            for (int dx = -6; dx <= 6; dx += 2) best = consider(best, source, field, group, dx, dy, 1.0);
        }
        if (best == null) return null;
        int bx = best.dx, by = best.dy;
        for (int dy = by - 1; dy <= by + 1; dy++) {
            for (int dx = bx - 1; dx <= bx + 1; dx++) best = consider(best, source, field, group, dx, dy, 1.0);
        }
        bx = best.dx;
        by = best.dy;
        for (double scale : new double[]{0.94, 1.06}) best = consider(best, source, field, group, bx, by, scale);
        return best;
    }

    private static Decided readFlag(CropSource source, IconGroup flags) throws JSONException {
        Placed best = null;
        for (int dy = -4; dy <= 4; dy++) {
            for (int dx = -4; dx <= 4; dx++) {
                float[] query = source.crop("flag", dx, dy, 1.0, flags.width, flags.height);
                if (query == null) continue;
                Match m = match(query, flags, true, 3);
                if (best == null || m.score > best.match.score) best = new Placed(m, query, dx, dy, 1.0);
            }
        }
        if (best == null) return null;
        Decided out = new Decided();
        out.top.addAll(best.match.top);
        out.id = best.match.top.get(0).id;
        out.accepted = best.match.accepted;
        out.basis = "ncc";
        out.score = best.match.score;
        Object bandRatio = JSONObject.NULL;
        if (best.match.top.size() > 1) {
            Set<String> pair = new HashSet<>(Arrays.asList(best.match.top.get(0).id, best.match.top.get(1).id));
            if (pair.size() == 2 && pair.contains(NL) && pair.contains(LU)) {
                JSONObject band = Refinements.flagBandRatio(best.query);
                bandRatio = band.opt("ratio");
                if (!band.isNull("decisionId")) {
                    out.id = band.getString("decisionId");
                    out.accepted = true;
                    out.basis = "band_ratio";
                } else {
                    out.accepted = false;
                    out.basis = "band_ratio_between";
                }
            }
        }
        out.evidence.put("margin", best.match.margin).put("offset", new JSONArray().put(best.dx).put(best.dy))
                .put("bandRatio", bandRatio);
        return out;
    }

    private static Object[] shapeTop(Placed placed, IconGroup group) throws JSONException {
        JSONObject first = Refinements.shapeRank(placed.query, group, "masked_gray_ncc").getJSONArray("top").getJSONObject(0);
        return new Object[]{first.getString("id"), first.getDouble("score")};
    }

    private static String familyOf(References refs, String id) {
        if (id == null) return null;
        String family = refs.familyById.get(id);
        return family == null ? id : family;
    }

    /** A complete word sequence from a shorter catalog name within a longer one. */
    private static boolean nameWordsWithin(String shorter, String longer) {
        List<String> part = nameWords(shorter), whole = nameWords(longer);
        if (part.isEmpty() || whole.size() <= part.size()) return false;
        for (int start = 0; start <= whole.size() - part.size(); start++) {
            if (whole.subList(start, start + part.size()).equals(part)) return true;
        }
        return false;
    }

    private static List<String> nameWords(String value) {
        List<String> out = new ArrayList<>();
        if (value == null) return out;
        String lower = value.toLowerCase(Locale.ROOT);
        StringBuilder word = new StringBuilder();
        for (int i = 0; i < lower.length();) {
            int cp = lower.codePointAt(i);
            i += Character.charCount(cp);
            if (Character.isLetter(cp) || Character.isDigit(cp)) {
                word.appendCodePoint(cp);
            } else if (word.length() > 0) {
                out.add(word.toString());
                word.setLength(0);
            }
        }
        if (word.length() > 0) out.add(word.toString());
        return out;
    }

    /** Eroded-cutout RGB distance inside the chosen family (Python refinement cutout_rgb). */
    private static String cutoutTop(Placed placed, IconGroup group) {
        Family family = placed.match.familyTop.get(0);
        if (family.variants.size() < 2) return null;
        int width = group.width, height = group.height, pixels = width * height;
        int n = family.variants.size();
        boolean[][] eroded = new boolean[n][pixels];
        int[] counts = new int[n];
        int[] at = new int[n];
        for (int v = 0; v < n; v++) {
            at[v] = group.indexOf(family.variants.get(v).id);
            int maskBase = at[v] * pixels;
            for (int y = 0; y < height; y++) {
                for (int x = 0; x < width; x++) {
                    boolean keep = group.mask[maskBase + y * width + x] != 0;
                    for (int dy = -1; dy <= 1 && keep; dy++) {
                        for (int dx = -1; dx <= 1 && keep; dx++) {
                            int yy = y + dy, xx = x + dx;
                            if (yy < 0 || xx < 0 || yy >= height || xx >= width) continue;
                            if (group.mask[maskBase + yy * width + xx] == 0) keep = false;
                        }
                    }
                    if (keep) {
                        eroded[v][y * width + x] = true;
                        counts[v]++;
                    }
                }
            }
        }
        int observed = Integer.MAX_VALUE;
        for (int count : counts) observed = Math.min(observed, count);
        if (observed < 24) return null;
        double[] distances = new double[n];
        for (int v = 0; v < n; v++) {
            double sum = 0;
            int base = at[v] * pixels * 3;
            for (int pixel = 0; pixel < pixels; pixel++) {
                if (!eroded[v][pixel]) continue;
                for (int c = 0; c < 3; c++) sum += Math.abs(group.rgb[base + pixel * 3 + c] - placed.query[pixel * 3 + c]);
            }
            distances[v] = sum / (counts[v] * 3.0);
        }
        int bestIndex = 0;
        for (int v = 1; v < n; v++) if (distances[v] < distances[bestIndex]) bestIndex = v;
        return family.variants.get(bestIndex).id;
    }

    private static Decided decideCharacter(Placed placed, References refs, Double residual) throws JSONException {
        Match m = placed.match;
        String top = m.top.get(0).id;
        double familyMargin = m.familyTop.get(0).score - (m.familyTop.size() > 1 ? m.familyTop.get(1).score : 0.0);
        Object[] shape = shapeTop(placed, refs.characters);
        String shapeId = (String) shape[0];
        double shapeScore = (Double) shape[1];
        boolean reliable = residual != null && residual <= RELIABLE_COLOUR_RESIDUAL;
        String cutout = reliable ? cutoutTop(placed, refs.characters) : null;
        Decided out = new Decided();
        out.id = top;
        if (reliable) {
            boolean variants = m.familyTop.get(0).variants.size() > 1;
            out.accepted = m.accepted || (familyMargin >= FAMILY_MARGIN_MIN && (!variants || top.equals(cutout)));
            out.basis = m.accepted ? "colour" : "family_then_colour";
        } else {
            out.accepted = m.accepted && java.util.Objects.equals(familyOf(refs, shapeId), familyOf(refs, top))
                    && shapeScore >= SHAPE_BACKING_MIN;
            out.basis = "shape_backed";
        }
        out.score = m.score;
        for (int i = 0; i < Math.min(3, m.top.size()); i++) out.top.add(m.top.get(i));
        out.evidence.put("margin", m.margin).put("familyMargin", familyMargin)
                .put("cutoutTop", cutout == null ? JSONObject.NULL : cutout).put("shapeTop", shapeId)
                .put("shapeScore", shapeScore).put("reliableColour", reliable)
                .put("offset", new JSONArray().put(placed.dx).put(placed.dy)).put("scale", placed.scale);
        return out;
    }

    /** {id or null, fuzzy, margin}: the printed-name clue through the central name matcher (NameMatch). */
    static Object[] matchName(String text, Map<String, String> names) {
        NameMatch found = NameMatch.match(text, new ArrayList<>(names.entrySet()));
        return new Object[]{found.key, found.fuzzy, found.margin};
    }

    static Map<String, String> namesFor(JSONObject table, String field, String locale) throws JSONException {
        String key = "body".equals(field) ? "kart" : "tire".equals(field) ? "wheel" : "glider";
        Map<String, String> out = new java.util.TreeMap<>();
        JSONObject byId = table.getJSONObject("names").optJSONObject(key);
        if (byId == null) return out;
        for (Iterator<String> it = byId.keys(); it.hasNext(); ) {
            String id = it.next();
            JSONObject byLocale = byId.getJSONObject(id);
            String name = byLocale.optString(locale, "");
            if (name.isEmpty()) name = byLocale.optString("en-GB", "");
            if (name.isEmpty()) name = byLocale.optString("en-US", "");
            if (!name.isEmpty()) out.put(id, name);
        }
        return out;
    }

    private static Decided decidePart(String field, Placed placed, References refs, String text,
                                      Map<String, String> names, String character, boolean reliable,
                                      Placed wide) throws JSONException {
        String kind = "body".equals(field) ? "bodies" : "tire".equals(field) ? "tires" : "gliders";
        IconGroup group = refs.part(field);
        Object[] clue = matchName(text, names);
        String nameId = (String) clue[0];
        double fuzzy = (Double) clue[1], margin = (Double) clue[2];
        String nameFamily = familyOf(refs, nameId);
        String strong = nameId != null && fuzzy >= NAME_STRONG_FUZZY && margin >= NAME_STRONG_MARGIN ? nameFamily : null;
        Placed used = wide != null ? wide : placed;
        List<String> topIds = new ArrayList<>();
        for (int i = 0; i < Math.min(3, used.match.top.size()); i++) topIds.add(used.match.top.get(i).id);
        Object[] shape = shapeTop(used, group);
        String shapeId = (String) shape[0];
        double shapeScore = (Double) shape[1];
        String topFamily = familyOf(refs, topIds.get(0));
        String[] result = null;
        boolean accepted = false;
        if (strong != null && reliable && used.match.accepted && !strong.equals(topFamily)
                && nameWordsWithin(names.get(nameId), names.get(topFamily))) {
            result = new String[]{topIds.get(0), "partial_name_top_icon"};
            accepted = true;
        } else if (strong != null) {
            List<String> inIcons = new ArrayList<>();
            for (String id : topIds) if (strong.equals(familyOf(refs, id))) inIcons.add(id);
            if (strong.equals(familyOf(refs, shapeId))) inIcons.add(shapeId);
            String relation = related(refs, field, kind, strong, character);
            if (relation != null) {
                result = new String[]{relation, "name_family_character_colour"};
                accepted = !inIcons.isEmpty();
            } else if (!inIcons.isEmpty()) {
                result = new String[]{inIcons.get(0), "name_family_icon_colour"};
                accepted = !hasVariants(refs, field, strong) || reliable;
            } else if (topFamily != null && topFamily.equals(familyOf(refs, shapeId)) && topFamily.startsWith(strong + "_")) {
                result = new String[]{topIds.get(0), "icons_over_name_prefix"};
                accepted = true;
            } else if (fuzzy >= NAME_ALONE_FUZZY && margin >= NAME_ALONE_MARGIN) {
                String rel = related(refs, field, kind, strong, character);
                result = new String[]{rel != null ? rel : strong, "name_alone"};
                accepted = true;
            } else {
                result = new String[]{strong, "name_icon_conflict"};
                accepted = false;
            }
        } else if (nameId != null && fuzzy >= NAME_CONFLICT_FUZZY && !java.util.Objects.equals(nameFamily, topFamily)) {
            result = new String[]{topIds.get(0), "half_legible_name_conflict"};
            accepted = false;
        } else if (nameId != null && fuzzy >= NAME_WEAK_FUZZY && java.util.Objects.equals(nameFamily, topFamily)) {
            String relation = related(refs, field, kind, topFamily, character);
            result = new String[]{relation != null ? relation : topIds.get(0), "weak_name_and_icon"};
            accepted = relation != null || !hasVariants(refs, field, topFamily) || reliable;
        } else {
            boolean shapeAgrees = java.util.Objects.equals(familyOf(refs, shapeId), topFamily);
            String relation = shapeAgrees ? related(refs, field, kind, topFamily, character) : null;
            if (relation != null) {
                result = new String[]{relation, "icon_shape_character_colour"};
                accepted = true;
            } else {
                result = new String[]{topIds.get(0), "icon_and_shape"};
                accepted = used.match.accepted && shapeAgrees && (!hasVariants(refs, field, topFamily) || reliable);
            }
        }
        Decided out = new Decided();
        out.id = result[0];
        out.basis = result[1];
        out.accepted = accepted;
        out.score = used.match.score;
        for (int i = 0; i < Math.min(3, used.match.top.size()); i++) out.top.add(used.match.top.get(i));
        out.evidence.put("margin", used.match.margin).put("name", nameId == null ? JSONObject.NULL : nameId)
                .put("nameFuzzy", fuzzy).put("nameMargin", margin).put("shapeTop", shapeId).put("shapeScore", shapeScore)
                .put("wide", wide != null).put("offset", new JSONArray().put(used.dx).put(used.dy)).put("scale", used.scale);
        return out;
    }

    private static String related(References refs, String field, String kind, String family, String character) {
        if ("tire".equals(field) || character == null || family == null) return null;
        return refs.partForCharacter.get(relationKey(kind, family, character));
    }

    private static boolean hasVariants(References refs, String field, String family) {
        if ("tire".equals(field)) return false;
        int count = 0;
        for (String value : refs.familyById.values()) if (value.equals(family)) count++;
        return count > 1;
    }

    private static boolean needsWideSearch(Placed placed, References refs, String text, Map<String, String> names) {
        Object[] clue = matchName(text, names);
        String nameId = (String) clue[0];
        if (nameId == null || (Double) clue[1] < NAME_STRONG_FUZZY || (Double) clue[2] < NAME_STRONG_MARGIN) return false;
        String family = familyOf(refs, nameId);
        for (int i = 0; i < Math.min(3, placed.match.top.size()); i++) {
            if (family.equals(familyOf(refs, placed.match.top.get(i).id))) return false;
        }
        return true;
    }

    private static double round4(double value) {
        return Math.round(value * 10000.0) / 10000.0;
    }

    /** frame-description-v1 (timetrial_ghost_select) in, frame-decision-v1 out. */
    public static JSONObject decideFrame(JSONObject description, CropSource source, References refs,
                                         String fieldSemanticsVersion) throws JSONException {
        if (!"mk8dx.frame-description.v1".equals(description.optString("schema"))
                || !"timetrial_ghost_select".equals(description.optString("frame"))) {
            throw new IllegalArgumentException("Expected a timetrial_ghost_select frame description");
        }
        Set<String> wanted = new HashSet<>(Arrays.asList("character", "body", "tire", "glider", "flag"));
        JSONArray items = description.getJSONArray("fields");
        Map<String, String> texts = new LinkedHashMap<>();
        Set<String> present = new HashSet<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.getJSONObject(i);
            String field = item.getString("field");
            if (!wanted.contains(field)) throw new IllegalArgumentException("Field " + field + " is not part of the Select-a-Ghost decision");
            if (item.has("candidates")) throw new IllegalArgumentException("Candidate scopes are not supported by the Select-a-Ghost decision yet");
            present.add(field);
            JSONObject context = item.optJSONObject("context");
            texts.put(field, context == null || context.isNull("printedText") ? null : context.optString("printedText"));
        }
        Double residual = description.isNull("residual") ? null : description.getDouble("residual");
        boolean reliable = residual != null && residual <= RELIABLE_COLOUR_RESIDUAL;
        String locale = description.optString("locale", "en-GB");
        Map<String, Decided> decided = new LinkedHashMap<>();
        if (present.contains("flag")) decided.put("flag", readFlag(source, refs.flags));
        String character = null;
        if (present.contains("character")) {
            Placed placed = searchIcon(source, "character", refs.characters, false);
            if (placed != null) {
                Decided read = decideCharacter(placed, refs, residual);
                decided.put("character", read);
                if (read.accepted) character = read.id;
            }
        }
        for (String field : PART_FIELDS) {
            if (!present.contains(field)) continue;
            IconGroup group = refs.part(field);
            Placed placed = searchIcon(source, field, group, false);
            if (placed == null) continue;
            Map<String, String> names = namesFor(refs.partNames, field, locale);
            String text = texts.get(field);
            Placed wide = needsWideSearch(placed, refs, text, names) ? searchIcon(source, field, group, true) : null;
            decided.put(field, decidePart(field, placed, refs, text, names, character, reliable, wide));
        }
        JSONArray fields = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            String field = items.getJSONObject(i).getString("field");
            Decided read = decided.get(field);
            JSONObject out = new JSONObject().put("field", field);
            if (read == null) {
                fields.put(out.put("selectedId", JSONObject.NULL).put("acceptedId", JSONObject.NULL)
                        .put("basis", "not_placed").put("score", 0.0).put("alternatives", new JSONArray()));
                continue;
            }
            JSONArray alternatives = new JSONArray();
            for (int k = 0; k < Math.min(3, read.top.size()); k++) {
                alternatives.put(new JSONObject().put("id", read.top.get(k).id).put("score", round4(read.top.get(k).score)));
            }
            fields.put(out.put("selectedId", read.id).put("acceptedId", read.accepted ? read.id : JSONObject.NULL)
                    .put("basis", read.basis).put("score", read.score).put("alternatives", alternatives)
                    .put("evidence", read.evidence));
        }
        return new JSONObject().put("schema", "mk8dx.frame-decision.v1").put("frame", "timetrial_ghost_select")
                .put("fieldSemanticsVersion", fieldSemanticsVersion)
                .put("decisionVersion", "ghost_panel_picker." + PICKER_VERSION).put("reliableColour", reliable)
                .put("fields", fields);
    }
}
