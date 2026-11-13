package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assume.assumeTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Iterator;
import java.util.List;
import java.util.TreeSet;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The shared Java refinements (Refinements: shape rank, distinctive flag rank, NL/LU band ratio, NL/LU/PY
 * tricolour, flag exposure, character family colour, neutral chroma) against the Python reference on
 * public vectors (packages/icon-matcher/vectors/refinement-v1.json, written by
 * packages/icon-matcher/tools/generate_rule_vectors.py; issue #99).
 *
 * <p>Each case carries the upstream inputs Python computed (visual read, shape rank, shortlist), so one
 * refinement is replayed at a time. Strings, booleans and nulls must be identical and numbers within 1e-6;
 * cases flagged boundary are reported, not failed.
 *
 * <p>Needs a materialized recognition pack: MK8DX_SHARED_ICON_PACK (its tensor-pack/) or
 * MK8DX_RECOGNITION_PACK (the pack root); skips without one.
 */
public class RefinementParityTest {
    private static final double TOLERANCE = 1e-6;

    private static Path packDir() {
        String tensors = System.getenv("MK8DX_SHARED_ICON_PACK");
        if (tensors != null) return Paths.get(tensors);
        String root = System.getenv("MK8DX_RECOGNITION_PACK");
        return root == null ? null : Paths.get(root, "tensor-pack");
    }

    private static List<String> strings(JSONArray raw) throws Exception {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < raw.length(); i++) out.add(raw.getString(i));
        return out;
    }

    /** A recorded visual read (generate_vectors.match_json) as the IconScorer.Match the refinements take. */
    private static IconScorer.Match match(JSONObject visual) throws Exception {
        IconScorer.Match m = new IconScorer.Match();
        m.status = visual.getString("status");
        m.top1Id = visual.getString("top1Id");
        m.acceptedId = visual.isNull("acceptedId") ? null : visual.getString("acceptedId");
        m.score = visual.getDouble("score");
        m.margin = visual.getDouble("margin");
        m.familyMargin = visual.isNull("familyMargin") ? null : visual.getDouble("familyMargin");
        JSONArray offset = visual.getJSONArray("offset");
        m.offset = new int[]{offset.getInt(0), offset.getInt(1)};
        JSONArray top = visual.getJSONArray("top");
        for (int i = 0; i < top.length(); i++) {
            JSONObject c = top.getJSONObject(i);
            m.topIds.add(c.getString("id"));
            m.topFamilies.add(c.getString("familyId"));
            m.topScores.add(c.getDouble("score"));
        }
        return m;
    }

    private static Object run(String name, float[] query, IconGroup group, JSONObject inputs) throws Exception {
        switch (name) {
            case "shape":
                return Refinements.shapeRank(query, group, inputs.getString("shapeMode"));
            case "distinctive":
                return Refinements.distinctiveFlagRank(query, group, strings(inputs.getJSONArray("distinctiveIds")));
            case "bandRatio":
                return Refinements.flagBandRatio(query);
            case "tricolor":
                return Refinements.flagTricolor(query, group, strings(inputs.getJSONArray("rawTopIds")),
                        inputs.getString("distinctiveTopId"), inputs.getJSONObject("shape"));
            case "exposure":
                return Refinements.flagExposure(query, group, inputs.getJSONObject("shape"));
            case "familyColour":
                return Refinements.familyColour(query, group, match(inputs.getJSONObject("visual")));
            case "neutralChroma":
                return Refinements.neutralChroma(query, group, match(inputs.getJSONObject("visual")));
            default:
                throw new IllegalArgumentException("unknown refinement " + name);
        }
    }

    /** null when equal (same shape, numbers within TOLERANCE), else where they differ. */
    static String close(Object got, Object want, String path) throws Exception {
        if (got == null) got = JSONObject.NULL;
        if (want == null) want = JSONObject.NULL;
        if (want instanceof JSONObject) {
            if (!(got instanceof JSONObject)) return path + ": " + got + " is not an object";
            JSONObject g = (JSONObject) got, w = (JSONObject) want;
            TreeSet<String> keys = new TreeSet<>();
            for (Iterator<String> it = w.keys(); it.hasNext(); ) keys.add(it.next());
            for (Iterator<String> it = g.keys(); it.hasNext(); ) keys.add(it.next());
            for (String key : keys) {
                if (!w.has(key)) return path + "." + key + ": unexpected key";
                if (!g.has(key)) return path + "." + key + ": missing";
                String difference = close(g.get(key), w.get(key), path + "." + key);
                if (difference != null) return difference;
            }
            return null;
        }
        if (want instanceof JSONArray) {
            if (!(got instanceof JSONArray)) return path + ": " + got + " is not an array";
            JSONArray g = (JSONArray) got, w = (JSONArray) want;
            if (g.length() != w.length()) return path + ": length " + g.length() + " != " + w.length();
            for (int i = 0; i < w.length(); i++) {
                String difference = close(g.get(i), w.get(i), path + "[" + i + "]");
                if (difference != null) return difference;
            }
            return null;
        }
        if (want instanceof Number && !(want instanceof Boolean)) {
            if (!(got instanceof Number)) return path + ": " + got + " != " + want;
            double delta = Math.abs(((Number) got).doubleValue() - ((Number) want).doubleValue());
            return delta <= TOLERANCE ? null : path + ": " + got + " != " + want;
        }
        return want.equals(got) ? null : path + ": " + got + " != " + want;
    }

    @Test
    public void javaRefinementsEqualPython() throws Exception {
        Path pack = packDir();
        assumeTrue("recognition pack not materialized (set MK8DX_RECOGNITION_PACK)",
                pack != null && Files.isRegularFile(pack.resolve("references.json")));
        Path fixture = Paths.get("../../../packages/icon-matcher/vectors/refinement-v1.json");
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(fixture), StandardCharsets.UTF_8));
        assertEquals("mk8dx.refinement-vectors.v1", doc.getString("schema"));
        JSONObject tensors = doc.getJSONObject("tensors");
        List<String> keys = new ArrayList<>();
        for (Iterator<String> it = tensors.keys(); it.hasNext(); ) keys.add(it.next());
        ReferencePack references = new ReferencePack(name -> Files.readAllBytes(pack.resolve(name)),
                keys.toArray(new String[0]));
        assertEquals("vectors were generated from another pack", doc.getString("catalogSha256"),
                references.catalogSha256);
        JSONObject groups = references.manifest.getJSONObject("groups");
        for (String key : keys) {
            for (String part : new String[]{"rgb", "mask", "count"}) {
                assertEquals(key + " " + part, tensors.getJSONObject(key).getString(part),
                        groups.getJSONObject(key).getJSONObject("tensors").getJSONObject(part).getString("sha256"));
            }
        }

        List<String> failures = new ArrayList<>();
        List<String> reported = new ArrayList<>();
        int replays = 0;
        JSONArray cases = doc.getJSONArray("cases");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject item = cases.getJSONObject(i);
            byte[] bytes = Base64.getDecoder().decode(item.getString("query"));
            float[] query = new float[bytes.length];
            for (int b = 0; b < bytes.length; b++) query[b] = (bytes[b] & 0xff) / 255f;
            IconGroup group = references.group(item.getString("group"));
            JSONObject got = new JSONObject();
            String difference;
            try {
                JSONArray names = item.getJSONArray("refinements");
                for (int r = 0; r < names.length(); r++) {
                    Object value = run(names.getString(r), query, group, item.getJSONObject("inputs"));
                    got.put(names.getString(r), value == null ? JSONObject.NULL : value);
                    replays++;
                }
                difference = close(got, item.getJSONObject("expected"), "$");
            } catch (RuntimeException error) {
                difference = "threw " + error;
            }
            if (difference == null) continue;
            String entry = item.getString("id") + ": " + difference;
            if (item.optBoolean("boundary")) reported.add(entry);
            else failures.add(entry);
        }
        System.out.println("refinement-v1: " + cases.length() + " cases, " + replays + " Java refinement replays");
        if (!reported.isEmpty()) System.out.println("refinement-v1 boundary differences (issue #99): " + reported);
        assertEquals(String.join("\n", failures), 0, failures.size());
    }
}
