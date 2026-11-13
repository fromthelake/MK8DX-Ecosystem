package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The shared Java context rules (ContextRules, which SharedFieldReader delegates to) against the
 * Python reference on packages/icon-matcher/vectors/context-v1.json (tools/generate_vectors.py;
 * issue #99). Every decision must be identical, with no known exceptions; the OCR normalization
 * cases replay NameMatch.normalize. Self-contained: no recognition pack needed.
 */
public class ContextParityTest {
    private static JSONObject load() throws Exception {
        return new JSONObject(new String(Files.readAllBytes(
                Paths.get("../../../packages/icon-matcher/vectors/context-v1.json")), StandardCharsets.UTF_8));
    }

    private static String optString(JSONObject object, String key) throws Exception {
        return object.isNull(key) ? null : object.getString(key);
    }

    private static ContextRules.Visual visual(JSONObject v) throws Exception {
        List<ContextRules.Candidate> top = new ArrayList<>();
        JSONArray items = v.getJSONArray("top");
        for (int i = 0; i < items.length(); i++) {
            JSONObject c = items.getJSONObject(i);
            top.add(new ContextRules.Candidate(c.getString("id"), c.getString("familyId"), c.getDouble("score")));
        }
        JSONArray familyTop = v.getJSONArray("familyTop");
        Double familyMargin = familyTop.length() > 1
                ? familyTop.getJSONObject(0).getDouble("score") - familyTop.getJSONObject(1).getDouble("score") : null;
        boolean accepted = "accepted".equals(v.getString("status"));
        return new ContextRules.Visual(v.getString("kind"), v.getString("status"),
                accepted ? top.get(0).id : null, v.getDouble("score"), v.getDouble("margin"), familyMargin, top);
    }

    private static ContextRules.Clue clue(JSONObject item) throws Exception {
        if (item.isNull("clue")) return null;
        JSONObject c = item.getJSONObject("clue");
        return new ContextRules.Clue(c.getString("id"), c.getDouble("fuzzy"), c.getDouble("margin"));
    }

    private static List<String> strings(JSONArray array) throws Exception {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) out.add(array.getString(i));
        return out;
    }

    private static String canonical(String id, String familyId, String status, List<String> evidence,
                                    String visualTop1, String suggestedId) {
        return id + "|" + familyId + "|" + status + "|" + evidence + "|" + visualTop1 + "|" + suggestedId;
    }

    @Test
    public void javaContextRulesEqualPython() throws Exception {
        JSONObject doc = load();
        assertEquals("mk8dx.context-vectors.v1", doc.getString("schema"));
        JSONObject catalog = doc.getJSONObject("catalog");
        Map<String, String> familyById = new HashMap<>();
        JSONObject families = catalog.getJSONObject("familyById");
        for (Iterator<String> it = families.keys(); it.hasNext(); ) {
            String id = it.next();
            familyById.put(id, families.getString(id));
        }
        Map<String, List<String[]>> members = new HashMap<>();
        JSONObject resultMembers = catalog.getJSONObject("resultMembers");
        for (Iterator<String> it = resultMembers.keys(); it.hasNext(); ) {
            String kind = it.next();
            List<String[]> rows = new ArrayList<>();
            JSONArray array = resultMembers.getJSONArray(kind);
            for (int i = 0; i < array.length(); i++) {
                rows.add(new String[]{array.getJSONObject(i).getString("id"),
                        array.getJSONObject(i).getString("familyId")});
            }
            members.put(kind, rows);
        }
        Map<String, String> partForCharacter = new HashMap<>();
        JSONArray relations = catalog.getJSONArray("partForCharacter");
        for (int i = 0; i < relations.length(); i++) {
            JSONArray row = relations.getJSONArray(i);
            partForCharacter.put(ContextRules.relationKey(row.getString(0), row.getString(1), row.getString(2)),
                    row.getString(3));
        }
        Map<Integer, String> tireByIndex = new HashMap<>();
        JSONArray tires = catalog.getJSONArray("tireByIndex");
        for (int i = 0; i < tires.length(); i++) {
            tireByIndex.put(tires.getJSONArray(i).getInt(0), tires.getJSONArray(i).getString(1));
        }
        ContextRules.References refs = new ContextRules.References(familyById, members, partForCharacter, tireByIndex);

        JSONArray cases = doc.getJSONArray("cases");
        assertTrue(cases.length() >= 50);
        List<String> failures = new ArrayList<>();
        for (int i = 0; i < cases.length(); i++) {
            JSONObject item = cases.getJSONObject(i);
            ContextRules.Visual read = visual(item.getJSONObject("visual"));
            ContextRules.Decision got;
            if ("character".equals(item.getString("rule"))) {
                got = ContextRules.combineCharacter(read, clue(item), familyById);
            } else {
                JSONObject c = item.getJSONObject("character");
                ContextRules.Decision character = new ContextRules.Decision(optString(c, "id"),
                        optString(c, "familyId"), c.getString("status"), strings(c.getJSONArray("evidence")),
                        optString(c, "visualTop1"), null);
                got = ContextRules.combinePart(item.getString("kind"), read, character, clue(item), refs,
                        item.getBoolean("tireTextTop3Guard"));
            }
            JSONObject want = item.getJSONObject("expected");
            String expected = canonical(optString(want, "id"), optString(want, "familyId"), want.getString("status"),
                    strings(want.getJSONArray("evidence")), optString(want, "visualTop1"),
                    optString(want, "suggestedId"));
            String actual = canonical(got.id, got.familyId, got.status, got.evidence, got.visualTop1, got.suggestedId);
            if (!expected.equals(actual)) {
                failures.add(item.getString("id") + ": python=" + expected + " java=" + actual);
            }
        }
        assertEquals(String.join("\n", failures), 0, failures.size());
    }

    @Test
    public void ocrNormalizationFoldsFullWidthDigitsLikePython() throws Exception {
        JSONArray items = load().getJSONArray("ocrNormalization");
        assertTrue(items.length() >= 4);
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.getJSONObject(i);
            assertEquals(item.getString("text"), item.getString("normalized"), NameMatch.normalize(item.getString("text")));
        }
    }

    @Test
    public void numericClueIdsAreAsciiOnly() {
        assertTrue(ContextRules.asciiIndex("12"));
        assertTrue(!ContextRules.asciiIndex("１２"));
        assertTrue(!ContextRules.asciiIndex("١٢"));
        assertTrue(!ContextRules.asciiIndex(""));
    }
}
