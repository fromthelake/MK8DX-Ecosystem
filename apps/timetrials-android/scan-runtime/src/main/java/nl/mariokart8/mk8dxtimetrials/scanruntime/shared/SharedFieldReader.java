package nl.mariokart8.mk8dxtimetrials.scanruntime.shared;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;
import org.opencv.core.Mat;
import org.opencv.core.Rect;
import org.opencv.core.Size;
import org.opencv.imgproc.Imgproc;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The shared MK8DX field decision (packages/icon-matcher, field semantics
 * {@link #SEMANTICS_VERSION}) on the Android scanner's own result-card crops.
 *
 * <p>This is a Java port of the TypeScript reader the browser scanner uses
 * (sharedIconScorer, sharedIconCvReader tire window, sharedCharacterContext,
 * sharedPartContext and the result proposal's selected/accepted split). It
 * reads the staged, hash-checked reference pack under {@code assets/shared_icon}.
 * The engine's own decision stays beside each field as {@code shared_field.legacy} (diagnostics
 * only). There is no previous reader to fall back to (removed 2026-10-30): a field the central
 * reader cannot decide is unknown ({@link #clearChoices}).</p>
 */
public final class SharedFieldReader {
    public static final String SEMANTICS_VERSION = nl.mariokart8.iconmatcher.FieldSemantics.VERSION;
    private static final String TAG = "MK8SharedField";
    private static final String ROOT = "shared_icon";
    private static final String[] FIELDS = {"character", "kart", "wheel", "glider", "flag"};

    private static SharedFieldReader instance;
    private static String unavailableReason;

    static final class Group {
        final int width;
        final int height;
        final String[] ids;
        final String[] families;
        final float[] rgb;
        final byte[] mask;
        final float[] count;
        /** Per reference: the RGB offsets of its masked pixels, in pixel order. */
        final int[][] masked;

        Group(int width, int height, String[] ids, String[] families, float[] rgb, byte[] mask, float[] count) {
            this.width = width;
            this.height = height;
            this.ids = ids;
            this.families = families;
            this.rgb = rgb;
            this.mask = mask;
            this.count = count;
            int pixels = width * height;
            masked = new int[ids.length][];
            for (int index = 0; index < ids.length; index++) {
                int n = 0;
                for (int pixel = 0; pixel < pixels; pixel++) {
                    if (mask[index * pixels + pixel] != 0) {
                        n++;
                    }
                }
                int[] offsets = new int[n];
                n = 0;
                for (int pixel = 0; pixel < pixels; pixel++) {
                    if (mask[index * pixels + pixel] != 0) {
                        offsets[n++] = pixel * 3;
                    }
                }
                masked[index] = offsets;
            }
        }
    }

    static final class Visual {
        String status;
        String top1Id;
        int[] cropXywh;
        String acceptedId;
        double score;
        double margin;
        Double familyMargin;
        final List<String[]> top = new ArrayList<>(); // {id, familyId}
        final List<Double> topScores = new ArrayList<>();
    }

    static final class Decision {
        final String id;
        final String familyId;
        final String status;
        final String visualTop1;

        Decision(String id, String familyId, String status, String visualTop1) {
            this.id = id;
            this.familyId = familyId;
            this.status = status;
            this.visualTop1 = visualTop1;
        }
    }

    private final Map<String, Group> groups = new HashMap<>();
    /** The same tensors as the shared package's groups (packages/icon-matcher/java). */
    private final Map<String, nl.mariokart8.iconmatcher.IconGroup> profileGroups = new HashMap<>();
    private final Map<String, String> familyById = new HashMap<>();
    private final Map<String, String> partForCharacter = new HashMap<>();
    private final Map<Integer, String> tireByIndex = new HashMap<>();
    private final Map<String, Integer> tireIndexById = new HashMap<>();
    private final Map<String, Integer> flagIndexById = new HashMap<>();
    private final Map<String, List<String[]>> resultMembers = new HashMap<>();
    /** The central Select-a-Ghost picker's references (CENTRAL_RECOGNITION section 8); null = per-field only. */
    private final nl.mariokart8.iconmatcher.GhostPanel.References ghostPicker;
    private final JSONObject names;
    private final String catalogSha256;

    /** The loaded reader, or null when the pack is unavailable (then the engine decides). */
    public static synchronized SharedFieldReader get(Context context) {
        if (instance != null || unavailableReason != null) {
            return instance;
        }
        try {
            instance = new SharedFieldReader(context.getApplicationContext().getAssets());
            Log.i(TAG, "shared field reader " + SEMANTICS_VERSION + " loaded; Select-a-Ghost: " + instance.ghostPanelDecision());
        } catch (Exception error) {
            unavailableReason = error.getClass().getSimpleName() + ": " + error.getMessage();
            Log.w(TAG, "shared field reader unavailable; fields stay unknown (" + unavailableReason + ")");
        }
        return instance;
    }

    public static synchronized String unavailableReason() {
        return unavailableReason;
    }

    /** A field the central reader did not decide: no choice is shown ({@code ?}), nothing is certain. */
    static void clearChoice(JSONObject entry) throws org.json.JSONException {
        entry.put("ok", false);
        entry.put("id", JSONObject.NULL);
        entry.put("index", JSONObject.NULL);
        entry.put("name", "");
        entry.remove("asset_ref");
    }

    /**
     * Every field of an owner unknown: the central reader is unavailable or its adoption failed.
     * {@code reason} is recorded in each field's shared_field.
     */
    public static void clearChoices(JSONObject owner, String reason) throws org.json.JSONException {
        for (String field : FIELDS) {
            JSONObject entry = owner.optJSONObject(field);
            if (entry == null) continue;
            JSONObject legacy = new JSONObject()
                    .put("id", entry.opt("id") == null ? JSONObject.NULL : entry.opt("id"))
                    .put("index", entry.opt("index") == null ? JSONObject.NULL : entry.opt("index"))
                    .put("name", entry.optString("name", ""))
                    .put("ok", entry.optBoolean("ok", false));
            clearChoice(entry);
            entry.put("shared_field", new JSONObject().put("version", SEMANTICS_VERSION)
                    .put("status", reason).put("legacy", legacy));
        }
    }

    private SharedFieldReader(AssetManager assets) throws Exception {
        JSONObject manifest = new JSONObject(new String(read(assets, ROOT + "/references.json"), StandardCharsets.UTF_8));
        if (!"mk8dx.shared-icon-references.v1".equals(manifest.getString("schema"))) {
            throw new IllegalStateException("unexpected reference schema");
        }
        catalogSha256 = manifest.getString("catalogSha256");
        JSONObject index = new JSONObject(new String(read(assets, ROOT + "/field-index.json"), StandardCharsets.UTF_8));
        if (!"mk8dx.scanner-field-index.v1".equals(index.getString("schema"))
                || !catalogSha256.equals(index.getString("catalogSha256"))) {
            throw new IllegalStateException("field index does not match the reference pack");
        }
        JSONObject flags = index.getJSONObject("flags");
        for (Iterator<String> it = flags.keys(); it.hasNext(); ) {
            String id = it.next();
            flagIndexById.put(id, flags.getInt(id));
        }
        JSONObject groupSpecs = manifest.getJSONObject("groups");
        for (String key : new String[]{"characters__result", "characters__ghost_select", "bodies__result",
                "tires__result", "gliders__result", "flags__result"}) {
            Group group = loadGroup(assets, groupSpecs.getJSONObject(key));
            groups.put(key, group);
            profileGroups.put(key, new nl.mariokart8.iconmatcher.IconGroup(group.width, group.height,
                    group.ids, group.families, group.rgb, group.mask, group.count));
        }
        for (Group group : groups.values()) {
            for (int i = 0; i < group.ids.length; i++) {
                familyById.put(group.ids[i], group.families[i]);
            }
        }
        for (String kind : new String[]{"bodies", "gliders", "tires"}) {
            Group group = groups.get(kind + "__result");
            List<String[]> members = new ArrayList<>();
            for (int i = 0; i < group.ids.length; i++) {
                members.add(new String[]{group.ids[i], group.families[i]});
            }
            resultMembers.put(kind, members);
        }
        JSONObject context = manifest.getJSONObject("context");
        JSONArray relations = context.getJSONArray("partForCharacter");
        for (int i = 0; i < relations.length(); i++) {
            JSONArray row = relations.getJSONArray(i);
            partForCharacter.put(relationKey(row.getString(0), row.getString(1), row.getString(2)), row.getString(3));
        }
        JSONArray tires = context.getJSONArray("tireByIndex");
        for (int i = 0; i < tires.length(); i++) {
            JSONArray row = tires.getJSONArray(i);
            tireByIndex.put(row.getInt(0), row.getString(1));
            tireIndexById.put(row.getString(1), row.getInt(0));
        }
        names = new JSONObject(new String(read(assets, "kart_config/names.json"), StandardCharsets.UTF_8));
        // The central Select-a-Ghost picker needs the pack's printed part names (pack 0.4.0 and
        // later); without them a panel keeps the per-field decision only.
        nl.mariokart8.iconmatcher.GhostPanel.References picker = null;
        try {
            JSONObject partNames = new JSONObject(new String(read(assets, ROOT + "/part-names-v1.json"), StandardCharsets.UTF_8));
            if ("mk8dx.part-names.v1".equals(partNames.optString("schema"))
                    && catalogSha256.equals(partNames.optString("catalogSha256"))) {
                picker = new nl.mariokart8.iconmatcher.GhostPanel.References(
                        profileGroups.get("characters__ghost_select"), profileGroups.get("bodies__result"),
                        profileGroups.get("tires__result"), profileGroups.get("gliders__result"),
                        profileGroups.get("flags__result"), familyById, partForCharacter, partNames);
            }
        } catch (Exception missing) {
            picker = null;
        }
        ghostPicker = picker;
    }

    /** Which Select-a-Ghost decision runs: the central picker, or the per-field decision only. */
    public String ghostPanelDecision() {
        return ghostPicker != null ? "central_picker" : "per_field";
    }

    private static Group loadGroup(AssetManager assets, JSONObject spec) throws Exception {
        JSONArray size = spec.getJSONArray("size");
        int width = size.getInt(0);
        int height = size.getInt(1);
        JSONArray idArray = spec.getJSONArray("ids");
        JSONArray familyArray = spec.getJSONArray("families");
        String[] ids = new String[idArray.length()];
        String[] families = new String[ids.length];
        for (int i = 0; i < ids.length; i++) {
            ids[i] = idArray.getString(i);
            families[i] = familyArray.getString(i);
        }
        JSONObject tensors = spec.getJSONObject("tensors");
        byte[] rgbBytes = tensor(assets, tensors.getJSONObject("rgb"));
        byte[] maskBytes = tensor(assets, tensors.getJSONObject("mask"));
        byte[] countBytes = tensor(assets, tensors.getJSONObject("count"));
        float[] rgb = floats(rgbBytes);
        float[] count = floats(countBytes);
        int pixels = width * height;
        if (rgb.length != ids.length * pixels * 3 || maskBytes.length != ids.length * pixels
                || count.length != ids.length || ids.length < 2) {
            throw new IllegalStateException("incompatible tensor shape");
        }
        return new Group(width, height, ids, families, rgb, maskBytes, count);
    }

    private static byte[] tensor(AssetManager assets, JSONObject spec) throws Exception {
        String file = spec.getString("file");
        if (!file.matches("[a-z0-9_.-]+")) {
            throw new IllegalStateException("unsafe tensor name");
        }
        byte[] bytes = read(assets, ROOT + "/" + file);
        if (bytes.length != spec.getInt("bytes") || !sha256(bytes).equals(spec.getString("sha256"))) {
            throw new IllegalStateException("tensor checksum mismatch: " + file);
        }
        return bytes;
    }

    private static float[] floats(byte[] bytes) {
        float[] out = new float[bytes.length / 4];
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(out);
        return out;
    }

    private static byte[] read(AssetManager assets, String path) throws Exception {
        try (InputStream in = assets.open(path)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[1 << 16];
            int n;
            while ((n = in.read(buffer)) > 0) {
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }

    static String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) {
            sb.append(String.format(Locale.ROOT, "%02x", b));
        }
        return sb.toString();
    }

    private static String relationKey(String kind, String familyId, String characterId) {
        return kind + "\u0000" + familyId + "\u0000" + characterId;
    }

    // ------------------------------------------------------------------
    // Scorer (sharedIconScorer.ts, masked RGB on normalized tensors)
    // ------------------------------------------------------------------

    static float[] normalize(Mat cropBgr, int width, int height) {
        Mat resized = new Mat();
        Mat rgb = new Mat();
        try {
            Imgproc.resize(cropBgr, resized, new Size(width, height), 0, 0, Imgproc.INTER_AREA);
            Imgproc.cvtColor(resized, rgb, Imgproc.COLOR_BGR2RGB);
            byte[] bytes = new byte[width * height * 3];
            rgb.get(0, 0, bytes);
            float[] out = new float[bytes.length];
            for (int i = 0; i < bytes.length; i++) {
                out[i] = (bytes[i] & 0xff) / 255f;
            }
            return out;
        } finally {
            rgb.release();
            resized.release();
        }
    }

    // Same pixel order and double accumulation as sharedIconScorer.ts, so the
    // scores are identical; only the unmasked pixels are visited.
    private static float scoreAt(float[] query, Group group, int index) {
        int rgbBase = index * group.width * group.height * 3;
        float[] rgb = group.rgb;
        double distance = 0;
        for (int offset : group.masked[index]) {
            int reference = rgbBase + offset;
            distance += Math.abs(rgb[reference] - query[offset]);
            distance += Math.abs(rgb[reference + 1] - query[offset + 1]);
            distance += Math.abs(rgb[reference + 2] - query[offset + 2]);
        }
        return (float) (1 - distance / (group.count[index] * 3 + 1e-6));
    }

    private static float[] shifted(float[] query, int width, int height, int dx, int dy) {
        float[] out = new float[query.length];
        for (int y = 0; y < height; y++) {
            int sy = Math.max(0, Math.min(height - 1, y - dy));
            for (int x = 0; x < width; x++) {
                int sx = Math.max(0, Math.min(width - 1, x - dx));
                int target = (y * width + x) * 3;
                int source = (sy * width + sx) * 3;
                out[target] = query[source];
                out[target + 1] = query[source + 1];
                out[target + 2] = query[source + 2];
            }
        }
        return out;
    }

    private static Integer[] ranked(float[] scores) {
        Integer[] order = new Integer[scores.length];
        for (int i = 0; i < order.length; i++) {
            order[i] = i;
        }
        Arrays.sort(order, (left, right) -> {
            int byScore = Float.compare(scores[right], scores[left]);
            return byScore != 0 ? byScore : Integer.compare(left, right);
        });
        return order;
    }

    /** center_shortlist: centre, then ±2 px over the top-8 centre families. */
    static Visual match(float[] query, Group group, boolean shortlist) {
        int count = group.ids.length;
        float[] scores = new float[count];
        java.util.stream.IntStream.range(0, count).parallel()
                .forEach(i -> scores[i] = scoreAt(query, group, i));
        if (shortlist) {
            Integer[] centre = ranked(scores);
            Set<String> families = new HashSet<>();
            for (int i = 0; i < Math.min(8, centre.length); i++) {
                families.add(group.families[centre[i]]);
            }
            List<Integer> selected = new ArrayList<>();
            for (Integer i : centre) {
                if (families.contains(group.families[i])) {
                    selected.add(i);
                }
            }
            for (int dy = -2; dy <= 2; dy++) {
                for (int dx = -2; dx <= 2; dx++) {
                    if (dx == 0 && dy == 0) {
                        continue;
                    }
                    float[] moved = shifted(query, group.width, group.height, dx, dy);
                    selected.parallelStream().forEach(i -> {
                        float candidate = scoreAt(moved, group, i);
                        if (candidate > scores[i]) {
                            scores[i] = candidate;
                        }
                    });
                }
            }
        }
        Integer[] order = ranked(scores);
        Visual visual = new Visual();
        int first = order[0];
        visual.score = scores[first];
        visual.margin = scores[first] - scores[order[1]];
        visual.status = visual.score >= 0.80 && visual.margin >= 0.02 ? "accepted" : "unknown";
        visual.top1Id = group.ids[first];
        visual.acceptedId = "accepted".equals(visual.status) ? visual.top1Id : null;
        for (Integer i : order) {
            if (!group.families[i].equals(group.families[first])) {
                visual.familyMargin = (double) (scores[first] - scores[i]);
                break;
            }
        }
        for (int i = 0; i < Math.min(3, order.length); i++) {
            visual.top.add(new String[]{group.ids[order[i]], group.families[order[i]]});
            visual.topScores.add((double) scores[order[i]]);
        }
        return visual;
    }

    private static Mat roi(Mat canonical, int x, int y, int w, int h) {
        int x0 = Math.max(0, Math.min(canonical.cols() - 1, x));
        int y0 = Math.max(0, Math.min(canonical.rows() - 1, y));
        int ww = Math.min(w, canonical.cols() - x0);
        int hh = Math.min(h, canonical.rows() - y0);
        if (ww < 4 || hh < 4) {
            return null;
        }
        return canonical.submat(new Rect(x0, y0, ww, hh));
    }

    /** The crop the engine settled on: its slot, scaled and shifted as matched. */
    private static int[] selectedBox(JSONObject entry) {
        JSONArray slot = entry.optJSONArray("slot_xywh");
        if (slot == null || slot.length() != 4) {
            return null;
        }
        int x1 = slot.optInt(0);
        int y1 = slot.optInt(1);
        int slotW = slot.optInt(2);
        int slotH = slot.optInt(3);
        double scale = entry.optDouble("scale", 1.0);
        int cw = Math.max(8, (int) Math.round(slotW * scale));
        int ch = Math.max(8, (int) Math.round(slotH * scale));
        int x = (int) Math.round(x1 + (slotW - cw) / 2.0) + (int) Math.round(entry.optDouble("dx", 0));
        int y = (int) Math.round(y1 + (slotH - ch) / 2.0) + (int) Math.round(entry.optDouble("dy", 0));
        return new int[]{x, y, cw, ch, x1, y1, slotW, slotH};
    }

    private Visual readField(Mat canonical, String kind, JSONObject entry) {
        int[] box = selectedBox(entry);
        if (box == null) {
            return null;
        }
        Group group = groups.get(kind + "__result");
        if ("tires".equals(kind)) {
            return readTireWindow(canonical, group, box[4], box[5], box[6], box[7]);
        }
        Mat crop = roi(canonical, box[0], box[1], box[2], box[3]);
        if (crop == null) {
            return null;
        }
        try {
            Visual visual = match(normalize(crop, group.width, group.height), group, true);
            visual.cropXywh = new int[]{box[0], box[1], crop.cols(), crop.rows()};
            return visual;
        } finally {
            crop.release();
        }
    }

    /** Tire: the fixed slot first, then the 10-px padded window at 2-px steps. */
    private static Visual readTireWindow(Mat canonical, Group group, int x1, int y1, int slotW, int slotH) {
        Mat slot = roi(canonical, x1, y1, slotW, slotH);
        if (slot == null) {
            return null;
        }
        Visual centre;
        try {
            centre = match(normalize(slot, group.width, group.height), group, false);
        } finally {
            slot.release();
        }
        if ("accepted".equals(centre.status)) {
            return centre;
        }
        int wx = Math.max(0, x1 - 10);
        int wy = Math.max(0, y1 - 10);
        int ww = Math.min(canonical.cols(), x1 + slotW + 10) - wx;
        int wh = Math.min(canonical.rows(), y1 + slotH + 10) - wy;
        List<int[]> positions = new ArrayList<>();
        for (int top = 0; top <= wh - slotH; top += 2) {
            for (int left = 0; left <= ww - slotW; left += 2) {
                positions.add(new int[]{left, top});
            }
        }
        Visual[] reads = new Visual[positions.size()];
        java.util.stream.IntStream.range(0, reads.length).parallel().forEach(k -> {
            int[] at = positions.get(k);
            Mat crop = canonical.submat(new Rect(wx + at[0], wy + at[1], slotW, slotH));
            try {
                reads[k] = match(normalize(crop, group.width, group.height), group, false);
            } finally {
                crop.release();
            }
        });
        // First best in scan order, exactly as the sequential browser search.
        Visual best = null;
        for (Visual candidate : reads) {
            if (best == null || candidate.score > best.score) {
                best = candidate;
            }
        }
        return best != null ? best : centre;
    }

    // ------------------------------------------------------------------
    // Context decisions (sharedCharacterContext.ts, sharedPartContext.ts)
    // ------------------------------------------------------------------

    /**
     * A printed name identifies a family only: the catalog gives every colour
     * variant its base name, and the engine's vocabulary keeps whichever
     * variant came last (Inkling-jongen read as the purple variant). The
     * browser's vocabulary yields the base ID; do the same here.
     */
    private String printedFamily(String id) {
        if (id == null) {
            return null;
        }
        String family = familyById.get(id);
        return family != null ? family : id;
    }

    private Decision combineCharacter(Visual visual, JSONObject nameText) {
        String topId = visual.top.get(0)[0];
        String topFamily = visual.top.get(0)[1];
        String clueId = nameText == null ? null : printedFamily(nameText.optString("id", null));
        double fuzzy = nameText == null ? Double.NaN : nameText.optDouble("fuzzy", Double.NaN);
        String clueFamily = clueId == null ? null : familyById.get(clueId);
        boolean strong = clueId != null && !Double.isNaN(fuzzy) && fuzzy >= 0.85;
        String observedFamily = visual.acceptedId != null ? topFamily : null;
        if (strong && topFamily.equals(clueFamily)) {
            if ("accepted".equals(visual.status) && !clueId.equals(topId)
                    && !clueId.equals(topFamily) && fuzzy < 1) {
                return new Decision(null, topFamily, "conflict", topId);
            }
            if (clueId.equals(topFamily) && !topId.equals(topFamily)) {
                for (int i = 0; i < visual.top.size(); i++) {
                    if (visual.top.get(i)[0].equals(clueId)) {
                        if (visual.score < 0.80 && visual.topScores.get(0) - visual.topScores.get(i) <= 0.015) {
                            return new Decision(clueId, topFamily, "accepted", topId);
                        }
                        break;
                    }
                }
                return new Decision(visual.acceptedId, observedFamily, visual.status, topId);
            }
            return new Decision(clueId, topFamily, "accepted", topId);
        }
        if (strong && clueFamily != null) {
            if (fuzzy >= 0.90 && (visual.score < 0.85 || visual.margin < 0.05)) {
                return new Decision(clueId, clueFamily, "accepted", topId);
            }
            return new Decision(null, null, "conflict", topId);
        }
        return new Decision(visual.acceptedId, observedFamily, visual.status, topId);
    }

    private Decision combinePart(String kind, Visual visual, Decision character, JSONObject text) {
        String topId = visual.top.get(0)[0];
        String topFamily = visual.top.get(0)[1];
        String family = topFamily;
        String rawClue = text == null ? null : text.optString("id", null);
        String clueId = rawClue != null && rawClue.matches("\\d+") ? rawClue : printedFamily(rawClue);
        double fuzzy = text == null ? Double.NaN : text.optDouble("fuzzy", Double.NaN);
        double margin = text == null ? Double.NaN : text.optDouble("margin", Double.NaN);
        boolean finite = clueId != null && !Double.isNaN(fuzzy) && !Double.isNaN(margin);
        boolean strong = finite && fuzzy >= 0.85 && margin >= 0.08;
        boolean numeric = clueId != null && clueId.matches("\\d+");
        String textId = "tires".equals(kind) && numeric ? tireByIndex.get(Integer.parseInt(clueId)) : clueId;
        String textFamily = textId == null ? null : familyById.get(textId);
        if (finite && !strong && fuzzy >= 0.65 && margin >= 0.15 && textFamily != null
                && !textFamily.equals(topFamily)) {
            return new Decision(null, topFamily, "conflict", topId);
        }
        if ("tires".equals(kind) && strong && numeric) {
            String tire = tireByIndex.get(Integer.parseInt(clueId));
            if (tire != null) {
                boolean inTop3 = false;
                for (String[] candidate : visual.top) {
                    inTop3 |= candidate[0].equals(tire);
                }
                if (!inTop3) {
                    return new Decision(null, family, "conflict", topId);
                }
                return new Decision(tire, tire, "accepted", topId);
            }
        }
        if ("tires".equals(kind) && finite && numeric) {
            String tire = tireByIndex.get(Integer.parseInt(clueId));
            if (topId.equals(tire) && fuzzy >= 0.70 && margin >= 0.30
                    && visual.score >= 0.80 && visual.margin >= 0.01) {
                return new Decision(tire, tire, "accepted", topId);
            }
        }
        if (strong && textFamily != null) {
            family = textFamily;
        }
        String chosen = family.equals(topFamily) ? visual.acceptedId : null;
        boolean strongVisualVariant = "accepted".equals(visual.status) && family.equals(topFamily);
        if ("gliders".equals(kind) && strongVisualVariant && topId.equals(chosen)
                && character.id != null && "accepted".equals(character.status) && strong
                && family.equals(clueId)) {
            String relation = partForCharacter.get(relationKey(kind, family, character.id));
            if (relation != null && !relation.equals(chosen) && family.equals(familyById.get(relation))) {
                for (String[] candidate : visual.top) {
                    if (candidate[0].equals(relation)) {
                        chosen = relation;
                        break;
                    }
                }
            }
        }
        if (("bodies".equals(kind) || "gliders".equals(kind)) && character.id != null && !strongVisualVariant
                && (visual.score >= 0.80 || strong)) {
            String relation = partForCharacter.get(relationKey(kind, family, character.id));
            if (relation != null) {
                boolean weakFamily = "gliders".equals(kind) && !strong && visual.familyMargin != null
                        && visual.familyMargin < 0.02;
                if (!weakFamily) {
                    chosen = relation;
                }
            }
        }
        if (chosen == null && strong) {
            List<String[]> members = new ArrayList<>();
            for (String[] member : resultMembers.get(kind)) {
                if (member[1].equals(family)) {
                    members.add(member);
                }
            }
            if (members.size() == 1) {
                chosen = members.get(0)[0];
            } else if (family.equals(topFamily) && visual.score >= 0.75 && visual.margin >= 0.01) {
                chosen = topId;
            }
        }
        if (chosen == null && strong && family.equals(clueId)) {
            return new Decision(null, family, "family_only", topId);
        }
        if ("gliders".equals(kind) && topId.equals(chosen) && strong && family.equals(clueId)
                && character.id == null && "unknown".equals(character.status) && character.visualTop1 != null) {
            String relation = partForCharacter.get(relationKey(kind, family, character.visualTop1));
            if (relation != null && !relation.equals(chosen) && family.equals(familyById.get(relation))) {
                return new Decision(null, family, "conflict", topId);
            }
        }
        return new Decision(chosen, chosen != null ? family : null, chosen != null ? "accepted" : "unknown", topId);
    }

    // ------------------------------------------------------------------
    // Product adoption on one owner's result card
    // ------------------------------------------------------------------

    /**
     * Let the shared decision supply the five visible fields of one result-card
     * owner. Wheels and flags keep the engine's index shape; the shared ID is in
     * {@code shared_field.selectedId}. Returns false when nothing was adopted.
     */
    public boolean adopt(Mat canonicalBgr, JSONObject owner) {
        return adopt(canonicalBgr, owner, false);
    }

    /**
     * {@code ghostSelect}: the owner is a Select-a-Ghost panel. Its character is
     * read against the ghost_select references (the panel's own portrait); the
     * parts and flag use the result-card references, as in every product. The
     * central decision then only confirms the panel reader's own choices.
     */
    public boolean adopt(Mat canonicalBgr, JSONObject owner, boolean ghostSelect) {
        return adopt(canonicalBgr, owner, ghostSelect, false);
    }

    /**
     * {@code threeLapPanel}: the canonical is the registered three-lap Select-a-Ghost
     * panel, whose constant elements correct a photo toward HDMI first
     * (packages/icon-matcher PanelPhotometric); the shared reads use the corrected copy.
     */
    public boolean adopt(Mat canonicalBgr, JSONObject owner, boolean ghostSelect, boolean threeLapPanel) {
        Mat corrected = null;
        try {
            JSONObject panelRecord = null;
            if (ghostSelect && threeLapPanel) {
                PanelCorrection panel = panelCorrection(canonicalBgr);
                if (panel != null) {
                    panelRecord = panel.record;
                    corrected = panel.mat;
                    owner.put("photometric_qa", panelRecord);
                }
            }
            if (corrected != null) {
                canonicalBgr = corrected;
            }
            if (ghostSelect && ghostPicker != null) {
                decideGhostPanel(canonicalBgr, owner, panelRecord);
                return true;
            }
            String[] kinds = {"characters", "bodies", "tires", "gliders", "flags"};
            JSONObject[] reads = new JSONObject[FIELDS.length];
            Visual[] visuals = new Visual[FIELDS.length];
            int[][] boxes = new int[FIELDS.length][];
            long[] elapsed = new long[FIELDS.length];
            for (int i = 0; i < FIELDS.length; i++) {
                JSONObject entry = owner.optJSONObject(FIELDS[i]);
                long started = System.nanoTime();
                if (entry != null) {
                    if ("tires".equals(kinds[i])) {
                        visuals[i] = readField(canonicalBgr, kinds[i], entry);
                        reads[i] = visuals[i] == null ? null : visualRecord(visuals[i], kinds[i]);
                    } else {
                        reads[i] = sharedEvidence(canonicalBgr, kinds[i],
                                ghostSelect && i == 0 ? "ghost_select" : "result", entry, boxes, i);
                        visuals[i] = reads[i] == null ? null : visualOf(reads[i]);
                    }
                }
                elapsed[i] = (System.nanoTime() - started) / 1_000_000L;
            }
            if (panelRecord != null && reads[4] != null) {
                // ResultProposal keeps NL/LU under review when the correction's white clipped in blue.
                reads[4].put("photometric_qa", panelRecord);
            }
            // The shared result-card decision (packages/icon-matcher ResultProposal)
            // on the shared evidence plus this scanner's printed-name context.
            JSONObject characterEntry = owner.optJSONObject("character");
            Decision character = visuals[0] == null ? new Decision(null, null, "unknown", null)
                    : combineCharacter(visuals[0], characterEntry == null ? null : characterEntry.optJSONObject("name_text"));
            JSONObject evidenceOwner = new JSONObject();
            Decision[] contexts = new Decision[FIELDS.length];
            for (int i = 0; i < FIELDS.length; i++) {
                if (reads[i] == null) continue;
                JSONObject field = new JSONObject().put("shared_icon_qa", reads[i]);
                if (i == 0) {
                    contexts[i] = character;
                    field.put("character_text_qa", new JSONObject().put("chosenBasis", "selected")
                            .put("chosen", decisionRecord(character)));
                } else if (i != 4) {
                    JSONObject entry = owner.optJSONObject(FIELDS[i]);
                    contexts[i] = combinePart(kinds[i], visuals[i], character, entry.optJSONObject("text"));
                    field.put("part_text_qa", new JSONObject()
                            .put("cropPixelSha256", reads[i].getString("cropPixelSha256"))
                            .put("chosen", decisionRecord(contexts[i])));
                }
                evidenceOwner.put(FIELDS[i], field);
            }
            JSONObject proposals = nl.mariokart8.iconmatcher.ResultProposal.compose(evidenceOwner).getJSONObject("fields");
            for (int i = 0; i < FIELDS.length; i++) {
                JSONObject entry = owner.optJSONObject(FIELDS[i]);
                if (entry == null) {
                    continue;
                }
                JSONObject legacy = new JSONObject()
                        .put("id", entry.opt("id") == null ? JSONObject.NULL : entry.opt("id"))
                        .put("index", entry.opt("index") == null ? JSONObject.NULL : entry.opt("index"))
                        .put("name", entry.optString("name", ""))
                        .put("ok", entry.optBoolean("ok", false));
                JSONObject proposal = proposals.getJSONObject(FIELDS[i]);
                String selectedId = proposal.isNull("selectedId") ? null : proposal.getString("selectedId");
                String acceptedId = proposal.isNull("acceptedId") ? null : proposal.getString("acceptedId");
                if (reads[i] == null || selectedId == null) {
                    clearChoice(entry);
                    entry.put("shared_field", new JSONObject().put("version", SEMANTICS_VERSION)
                            .put("status", "unavailable").put("legacy", legacy));
                    continue;
                }
                JSONObject view = view(FIELDS[i], selectedId);
                if (view == null) {
                    clearChoice(entry);
                    entry.put("shared_field", new JSONObject().put("version", SEMANTICS_VERSION)
                            .put("status", "unmapped").put("selectedId", selectedId).put("legacy", legacy));
                    continue;
                }
                entry.put("id", "wheel".equals(FIELDS[i]) || "flag".equals(FIELDS[i]) ? JSONObject.NULL : selectedId);
                entry.put("index", view.opt("index"));
                JSONObject openSet = proposal.optJSONObject("openSet");
                entry.put("name", openSet != null && "propose".equals(openSet.optString("mode"))
                        && selectedId.equals(openSet.optString("id")) ? openSet.getString("label") : view.getString("name"));
                if (view.has("asset_ref")) {
                    entry.put("asset_ref", view.getString("asset_ref"));
                }
                entry.put("ok", acceptedId != null);
                JSONArray top = proposal.getJSONArray("top");
                for (int k = 0; k < top.length(); k++) {
                    JSONObject candidate = top.getJSONObject(k);
                    if (selectedId.equals(candidate.optString("id")) && !candidate.isNull("matchScore")) {
                        entry.put("score", Math.round(candidate.getDouble("matchScore") * 1000.0) / 1000.0);
                    }
                }
                entry.put("evidence", "shared_field_" + SEMANTICS_VERSION);
                JSONArray alternatives = new JSONArray();
                for (int k = 0; k < top.length() && alternatives.length() < 2; k++) {
                    String id = top.getJSONObject(k).optString("id");
                    if (id.equals(selectedId)) continue;
                    JSONObject alternative = view(FIELDS[i], id);
                    if (alternative != null) {
                        // the central open-set suggestion is a bare "Mii", whatever the catalog calls its id
                        if ("open_set".equals(top.getJSONObject(k).optString("basis"))) {
                            alternative.put("name", nl.mariokart8.iconmatcher.OpenSet.MII_LABEL);
                        }
                        alternatives.put(alternative);
                    }
                }
                Visual visual = visuals[i];
                entry.put("shared_field", new JSONObject().put("version", SEMANTICS_VERSION)
                        .put("status", acceptedId != null ? "accepted" : "proposed")
                        .put("selectedId", selectedId)
                        .put("acceptedId", acceptedId == null ? JSONObject.NULL : acceptedId)
                        .put("reviewRequired", acceptedId == null)
                        .put("proposedFamilyId", proposal.opt("proposedFamilyId"))
                        .put("evidence", proposal.getJSONArray("evidence"))
                        .put("visualTop1", visual.top.get(0)[0])
                        .put("visualScore", Math.round(visual.score * 1000.0) / 1000.0)
                        .put("visualTop", topTrace(visual))
                        .put("cropXywh", boxes[i] == null ? (visual.cropXywh == null ? JSONObject.NULL
                                : new JSONArray().put(visual.cropXywh[0]).put(visual.cropXywh[1])
                                        .put(visual.cropXywh[2]).put(visual.cropXywh[3]))
                                : new JSONArray().put(boxes[i][0]).put(boxes[i][1]).put(boxes[i][2]).put(boxes[i][3]))
                        .put("context", contexts[i] == null ? JSONObject.NULL : contexts[i].status)
                        .put("ms", elapsed[i])
                        .put("alternatives", alternatives)
                        .put("legacy", legacy));
            }
            return true;
        } catch (Exception error) {
            Log.w(TAG, "shared field adoption failed; fields stay unknown", error);
            return false;
        } finally {
            if (corrected != null) corrected.release();
        }
    }

    /**
     * Select-a-Ghost panel, decided centrally (packages/icon-matcher GhostPanel, the same picker as
     * Python and the Web scanner): this engine is the ROI Searcher and describes the registered,
     * colour-corrected panel (frame-description-v1); the picker refines every icon's position,
     * compares and decides each field (frame-decision-v1). The engine only shows the decision: the
     * selected choice, certain only when accepted. The previous decision stays in shared_field.legacy.
     */
    private void decideGhostPanel(Mat canonical, JSONObject owner, JSONObject panelRecord) throws Exception {
        String[] contract = {"character", "body", "tire", "glider", "flag"};
        JSONArray fields = new JSONArray();
        Map<String, int[]> slots = new HashMap<>();
        for (int i = 0; i < FIELDS.length; i++) {
            JSONObject entry = owner.optJSONObject(FIELDS[i]);
            JSONArray slot = entry == null ? null : entry.optJSONArray("slot_xywh");
            if (slot == null || slot.length() != 4) continue;
            int[] s = {(int) Math.round(slot.optDouble(0)), (int) Math.round(slot.optDouble(1)),
                    (int) Math.round(slot.optDouble(2)), (int) Math.round(slot.optDouble(3))};
            slots.put(contract[i], s);
            JSONObject item = new JSONObject().put("field", contract[i])
                    .put("slot", new JSONArray().put(s[0]).put(s[1]).put(s[2]).put(s[3]));
            if (i >= 1 && i <= 3) {
                JSONObject text = entry.optJSONObject("text");
                item.put("context", new JSONObject().put("printedText",
                        text == null || !text.has("text") ? JSONObject.NULL : text.optString("text")));
            }
            fields.put(item);
        }
        if (fields.length() == 0) return;
        Object residual = panelRecord == null ? null : panelRecord.opt("residual");
        JSONObject description = new JSONObject().put("schema", "mk8dx.frame-description.v1")
                .put("frame", "timetrial_ghost_select").put("console", "unknown").put("source", "phone_photo")
                .put("image", new JSONObject().put("width", canonical.cols()).put("height", canonical.rows()))
                .put("residual", residual instanceof Number ? residual : JSONObject.NULL)
                .put("locale", "en-GB").put("fields", fields);
        // crop_at (Python ghost_panel): floor(v + 0.5) on the moved, scaled slot; none outside the frame.
        Map<String, float[]> cache = new HashMap<>();
        nl.mariokart8.iconmatcher.GhostPanel.CropSource crops = (field, dx, dy, scale, width, height) -> {
            String key = field + "|" + dx + "|" + dy + "|" + String.format(java.util.Locale.ROOT, "%.2f", scale)
                    + "|" + width + "x" + height;
            if (cache.containsKey(key)) return cache.get(key);
            int[] s = slots.get(field);
            double cx = s[0] + s[2] / 2.0 + dx, cy = s[1] + s[3] / 2.0 + dy;
            double hw = s[2] * scale / 2.0, hh = s[3] * scale / 2.0;
            int x0 = (int) Math.floor(cx - hw + 0.5), y0 = (int) Math.floor(cy - hh + 0.5);
            int x1 = (int) Math.floor(cx + hw + 0.5), y1 = (int) Math.floor(cy + hh + 0.5);
            float[] query = null;
            if (x0 >= 0 && y0 >= 0 && x1 <= canonical.cols() && y1 <= canonical.rows() && x1 - x0 >= 4 && y1 - y0 >= 4) {
                Mat region = canonical.submat(new Rect(x0, y0, x1 - x0, y1 - y0));
                try {
                    query = normalize(region, width, height);
                } finally {
                    region.release();
                }
            }
            cache.put(key, query);
            return query;
        };
        long started = System.nanoTime();
        JSONObject decision = nl.mariokart8.iconmatcher.GhostPanel.decideFrame(description, crops, ghostPicker, SEMANTICS_VERSION);
        long ms = (System.nanoTime() - started) / 1_000_000L;
        JSONArray decided = decision.getJSONArray("fields");
        for (int k = 0; k < decided.length(); k++) {
            JSONObject read = decided.getJSONObject(k);
            int i = java.util.Arrays.asList(contract).indexOf(read.getString("field"));
            JSONObject entry = owner.optJSONObject(FIELDS[i]);
            if (entry == null) continue;
            JSONObject legacy = new JSONObject()
                    .put("id", entry.opt("id") == null ? JSONObject.NULL : entry.opt("id"))
                    .put("index", entry.opt("index") == null ? JSONObject.NULL : entry.opt("index"))
                    .put("name", entry.optString("name", ""))
                    .put("ok", entry.optBoolean("ok", false));
            String selectedId = read.isNull("selectedId") ? null : read.getString("selectedId");
            String acceptedId = read.isNull("acceptedId") ? null : read.getString("acceptedId");
            JSONObject view = selectedId == null ? null : view(FIELDS[i], selectedId);
            String status = read.getString("basis");
            if (view != null) {
                entry.put("id", "wheel".equals(FIELDS[i]) || "flag".equals(FIELDS[i]) ? JSONObject.NULL : selectedId);
                entry.put("index", view.opt("index"));
                entry.put("name", view.getString("name"));
                if (view.has("asset_ref")) entry.put("asset_ref", view.getString("asset_ref"));
                entry.put("evidence", "ghost_panel_picker_" + SEMANTICS_VERSION);
                entry.put("ok", acceptedId != null);
            } else {
                // A choice this scanner has no picture for (or none placed): unknown, for the player to pick.
                clearChoice(entry);
                if (selectedId != null) status = "not_displayable";
            }
            entry.put("shared_field", new JSONObject().put("version", SEMANTICS_VERSION)
                    .put("decision", decision.getString("decisionVersion")).put("status", status)
                    .put("selectedId", selectedId == null ? JSONObject.NULL : selectedId)
                    .put("acceptedId", acceptedId == null ? JSONObject.NULL : acceptedId)
                    .put("reviewRequired", !entry.optBoolean("ok", false))
                    .put("alternatives", read.getJSONArray("alternatives")).put("legacy", legacy));
        }
        owner.put("ghost_panel_decision_qa", decision.put("ms", ms));
    }

    /** The panel's mk8dx.panel-photometric.v1 record and, when corrected, the corrected BGR copy. */
    private static final class PanelCorrection {
        final JSONObject record;
        final Mat mat;

        PanelCorrection(JSONObject record, Mat mat) {
            this.record = record;
            this.mat = mat;
        }
    }

    private static PanelCorrection panelCorrection(Mat canonicalBgr) throws Exception {
        if (canonicalBgr.channels() != 3 || canonicalBgr.cols() != nl.mariokart8.iconmatcher.PanelPhotometric.WIDTH
                || canonicalBgr.rows() != nl.mariokart8.iconmatcher.PanelPhotometric.HEIGHT) {
            return null;
        }
        Mat rgb = new Mat();
        try {
            Imgproc.cvtColor(canonicalBgr, rgb, Imgproc.COLOR_BGR2RGB);
            byte[] bytes = new byte[(int) (rgb.total() * 3)];
            rgb.get(0, 0, bytes);
            JSONObject record = nl.mariokart8.iconmatcher.PanelPhotometric.record(bytes, rgb.cols(), rgb.rows());
            if (!"corrected".equals(record.optString("status"))) {
                return new PanelCorrection(record, null);
            }
            Mat out = new Mat(rgb.rows(), rgb.cols(), org.opencv.core.CvType.CV_8UC3);
            out.put(0, 0, nl.mariokart8.iconmatcher.PanelPhotometric.apply(bytes, record));
            Imgproc.cvtColor(out, out, Imgproc.COLOR_RGB2BGR);
            return new PanelCorrection(record, out);
        } finally {
            rgb.release();
        }
    }

    /** Shared evidence (packages/icon-matcher FieldEvidence) on the engine's selected crop. */
    private JSONObject sharedEvidence(Mat canonical, String kind, String profile, JSONObject entry, int[][] boxes, int i)
            throws Exception {
        int[] box = selectedBox(entry);
        if (box == null) {
            return null;
        }
        nl.mariokart8.iconmatcher.IconGroup group = profileGroups.get(kind + "__" + profile);
        if ("flags".equals(kind)) {
            // Central flag position (packages/icon-matcher FlagWindow): the shared
            // references choose the flag inside its padded slot, without the
            // grey card border the fixed slot carries.
            int[] located = centralFlagBox(canonical, group, box[4], box[5], box[6], box[7]);
            if (located != null) {
                box = located;
            }
        }
        Mat crop = roi(canonical, box[0], box[1], box[2], box[3]);
        if (crop == null) {
            return null;
        }
        try {
            Mat dense = crop.clone();
            byte[] bytes = new byte[(int) (dense.total() * dense.channels())];
            dense.get(0, 0, bytes);
            dense.release();
            boxes[i] = new int[]{box[0], box[1], crop.cols(), crop.rows()};
            return nl.mariokart8.iconmatcher.FieldEvidence.read(normalize(crop, group.width, group.height),
                    group, kind, profile, catalogSha256, sha256(bytes));
        } finally {
            crop.release();
        }
    }

    /** The central flag-window search on the canonical card image (canonical coordinates). */
    private static int[] centralFlagBox(Mat canonical, nl.mariokart8.iconmatcher.IconGroup group,
                                        int x1, int y1, int slotW, int slotH) {
        int pad = nl.mariokart8.iconmatcher.FlagWindow.WINDOW_PAD;
        int wx = Math.max(0, x1 - pad);
        int wy = Math.max(0, y1 - pad);
        int ww = Math.min(canonical.cols(), x1 + slotW + pad) - wx;
        int wh = Math.min(canonical.rows(), y1 + slotH + pad) - wy;
        if (x1 < wx || y1 < wy || x1 + slotW > wx + ww || y1 + slotH > wy + wh) {
            return null;
        }
        nl.mariokart8.iconmatcher.FlagWindow.Read read = nl.mariokart8.iconmatcher.FlagWindow.search(ww, wh,
                new int[]{x1 - wx, y1 - wy, slotW, slotH}, (left, top, width, height) -> {
                    Mat crop = roi(canonical, wx + left, wy + top, width, height);
                    if (crop == null) {
                        return -1.0;
                    }
                    try {
                        return nl.mariokart8.iconmatcher.IconScorer.centreScore(
                                normalize(crop, group.width, group.height), group);
                    } finally {
                        crop.release();
                    }
                });
        return new int[]{wx + read.cropXywh[0], wy + read.cropXywh[1], read.cropXywh[2], read.cropXywh[3]};
    }

    /** The scanner's tyre-window read in the shared visual record format. */
    private JSONObject visualRecord(Visual visual, String kind) throws Exception {
        JSONArray top = new JSONArray();
        for (int k = 0; k < visual.top.size(); k++) {
            top.put(new JSONObject().put("id", visual.top.get(k)[0]).put("familyId", visual.top.get(k)[1])
                    .put("score", visual.topScores.get(k)));
        }
        return new JSONObject().put("schema", "mk8dx.visual-field-read.v1").put("kind", kind).put("profile", "result")
                .put("method", "rgb").put("catalogSha256", catalogSha256).put("cropPixelSha256", "tire_window")
                .put("status", visual.status).put("top1Id", visual.top1Id)
                .put("acceptedId", visual.acceptedId == null ? JSONObject.NULL : visual.acceptedId)
                .put("score", visual.score).put("margin", visual.margin)
                .put("familyMargin", visual.familyMargin == null ? JSONObject.NULL : visual.familyMargin).put("top", top);
    }

    private static Visual visualOf(JSONObject read) throws Exception {
        Visual visual = new Visual();
        visual.status = read.getString("status");
        visual.top1Id = read.getString("top1Id");
        visual.acceptedId = read.isNull("acceptedId") ? null : read.getString("acceptedId");
        visual.score = read.getDouble("score");
        visual.margin = read.getDouble("margin");
        visual.familyMargin = read.isNull("familyMargin") ? null : read.getDouble("familyMargin");
        JSONArray top = read.getJSONArray("top");
        for (int k = 0; k < top.length(); k++) {
            JSONObject item = top.getJSONObject(k);
            visual.top.add(new String[]{item.getString("id"), item.getString("familyId")});
            visual.topScores.add(item.getDouble("score"));
        }
        return visual;
    }

    private static JSONObject decisionRecord(Decision decision) throws Exception {
        return new JSONObject().put("id", decision.id == null ? JSONObject.NULL : decision.id)
                .put("familyId", decision.familyId == null ? JSONObject.NULL : decision.familyId)
                .put("status", decision.status)
                .put("visualTop1", decision.visualTop1 == null ? JSONObject.NULL : decision.visualTop1)
                .put("evidence", new JSONArray());
    }

    private static JSONArray topTrace(Visual visual) throws Exception {
        JSONArray out = new JSONArray();
        for (int i = 0; i < visual.top.size(); i++) {
            out.put(new JSONArray().put(visual.top.get(i)[0])
                    .put(Math.round(visual.topScores.get(i) * 10000.0) / 10000.0));
        }
        return out;
    }

    /** The panel reader's choice as a shared ID (wheels and flags carry an index only). */
    /** The NL/LU band decision of a central flag proposal: the decided id, "between", or null. */
    private static String nlLuBand(JSONObject proposal) {
        JSONArray evidence = proposal.optJSONArray("evidence");
        if (evidence == null) {
            return null;
        }
        for (int k = 0; k < evidence.length(); k++) {
            String item = evidence.optString(k);
            if ("flag_band_ratio_between".equals(item)) {
                return "between";
            }
            if ("flag_band_ratio".equals(item) && !proposal.isNull("acceptedId")) {
                String accepted = proposal.optString("acceptedId");
                if ("country.nl".equals(accepted) || "country.lu".equals(accepted)) {
                    return accepted;
                }
            }
        }
        return null;
    }

    /** Same family rule as cleanAssets.ts familyOf: a *_variant id belongs to its base. */
    static String familyOfId(String id) {
        String[] parts = id.split("[.]");
        if (parts.length >= 2 && parts[0].endsWith("_variant")) {
            return parts[0].substring(0, parts[0].length() - "_variant".length()) + "." + parts[1];
        }
        return id;
    }

    /** Shows the chosen shared ID on the panel entry unless it is the panel reader's own. */
    private boolean takeGhostChoice(String field, JSONObject entry, String id, String panel) throws Exception {
        if (id.equals(panel)) {
            return true;
        }
        JSONObject chosen = view(field, id);
        if (chosen == null) {
            return false;
        }
        entry.put("id", "wheel".equals(field) || "flag".equals(field) ? JSONObject.NULL : id);
        entry.put("index", chosen.opt("index"));
        entry.put("name", chosen.getString("name"));
        if (chosen.has("asset_ref")) {
            entry.put("asset_ref", chosen.getString("asset_ref"));
        }
        entry.put("evidence", "shared_field_" + SEMANTICS_VERSION);
        return true;
    }

    private JSONObject view(String field, String id) throws Exception {
        if ("wheel".equals(field) || "flag".equals(field)) {
            Integer index = "wheel".equals(field) ? tireIndexById.get(id) : flagIndexById.get(id);
            if (index == null) {
                return null;
            }
            String dir = "wheel".equals(field) ? "tire" : "mk8_flags";
            return new JSONObject().put("id", id).put("index", index).put("name", displayName(dir, index))
                    .put("asset_ref", "kart_config/" + dir + "/" + index + ".png");
        }
        String group = "character".equals(field) ? "characters" : "kart".equals(field) ? "bodies" : "gliders";
        JSONObject view = new JSONObject().put("id", id).put("index", JSONObject.NULL)
                .put("name", displayName(id, group));
        String assetRef = catalogNames == null ? null : catalogNames.assetRefFor(id, group);
        if (assetRef != null) {
            view.put("asset_ref", assetRef);
        }
        return view;
    }

    private String displayName(String dir, int index) {
        JSONObject table = names.optJSONObject(dir);
        JSONObject entry = table == null ? null : table.optJSONObject(String.valueOf(index));
        if (entry == null) {
            return "#" + index;
        }
        String uk = entry.optString("uk", "");
        return uk.isEmpty() ? entry.optString("nl", "") : uk;
    }

    /** Clean Assets names come from the engine's own matcher; set by the pipeline. */
    public interface CatalogNames {
        String displayName(String id, String group);

        String assetRefFor(String id, String group);
    }

    private CatalogNames catalogNames;

    public void setCatalogNames(CatalogNames catalogNames) {
        this.catalogNames = catalogNames;
    }

    private String displayName(String id, String group) {
        return catalogNames == null ? id : catalogNames.displayName(id, group);
    }

    public String catalogSha256() {
        return catalogSha256;
    }
}
