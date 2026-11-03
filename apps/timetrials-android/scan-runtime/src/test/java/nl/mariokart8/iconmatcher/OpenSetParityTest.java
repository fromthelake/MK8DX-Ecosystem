package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The Java open-set ("Mii?") decision and its result-card step against the Python reference
 * (packages/icon-matcher/vectors/open-set-v1.json, tooling/recognition/open_set_vectors.py). */
public class OpenSetParityTest {
    private static final String[] KEYS = {"status", "proposedId", "selectedId", "acceptedId", "proposedFamilyId",
            "reviewRequired", "evidence", "top", "openSet"};

    private static List<JSONObject> list(JSONArray array) throws Exception {
        List<JSONObject> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) out.add(array.getJSONObject(i));
        return out;
    }

    private static boolean same(Object a, Object b) throws Exception {
        if (a == null || a == JSONObject.NULL) return b == null || b == JSONObject.NULL;
        if (b == null || b == JSONObject.NULL) return false;
        if (a instanceof Number && b instanceof Number) {
            return Math.abs(((Number) a).doubleValue() - ((Number) b).doubleValue()) < 1e-9;
        }
        if (a instanceof JSONObject && b instanceof JSONObject) {
            JSONObject x = (JSONObject) a;
            JSONObject y = (JSONObject) b;
            if (x.length() != y.length()) return false;
            for (java.util.Iterator<String> keys = x.keys(); keys.hasNext(); ) {
                String key = keys.next();
                if (!y.has(key) || !same(x.get(key), y.get(key))) return false;
            }
            return true;
        }
        if (a instanceof JSONArray && b instanceof JSONArray) {
            JSONArray x = (JSONArray) a;
            JSONArray y = (JSONArray) b;
            if (x.length() != y.length()) return false;
            for (int i = 0; i < x.length(); i++) if (!same(x.get(i), y.get(i))) return false;
            return true;
        }
        return a.equals(b);
    }

    @Test
    public void javaOpenSetEqualsPython() throws Exception {
        Path fixture = Paths.get("../../../packages/icon-matcher/vectors/open-set-v1.json");
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(fixture), "UTF-8"));
        int differences = 0;
        JSONArray suggestions = doc.getJSONArray("suggestions");
        for (int i = 0; i < suggestions.length(); i++) {
            JSONObject c = suggestions.getJSONObject(i);
            JSONObject got = OpenSet.miiSuggestion(c.getString("profile"), list(c.getJSONArray("top")),
                    c.isNull("acceptedId") ? null : c.getString("acceptedId"));
            if (!same(got, c.opt("suggestion"))) differences++;
        }
        JSONArray proposals = doc.getJSONArray("proposals");
        for (int i = 0; i < proposals.length(); i++) {
            JSONObject c = proposals.getJSONObject(i);
            JSONObject owner = new JSONObject().put("character", new JSONObject().put("shared_icon_qa", c.getJSONObject("read")));
            JSONObject field = ResultProposal.compose(owner).getJSONObject("fields").getJSONObject("character");
            JSONObject want = c.getJSONObject("field");
            for (String key : KEYS) {
                if (!same(field.opt(key), want.opt(key))) {
                    differences++;
                    break;
                }
            }
        }
        assertEquals(0, differences);
    }
}
