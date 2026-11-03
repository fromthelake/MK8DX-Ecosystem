package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java shared profile against the web reader's own evidence and decisions.
 *
 * Private inputs stay outside Git: set MK8DX_PROFILE_PARITY_BUNDLE (bundle.json
 * with queries/) and MK8DX_SHARED_ICON_PACK (references.json + tensors), written
 * by tooling/recognition/export_profile_parity_bundle.py. Without them only the
 * hand-made decision cases run.
 */
public class SharedProfileParityTest {
    private static final String[] GROUPS = {"characters__result", "bodies__result", "tires__result",
            "gliders__result", "flags__result"};

    @Test
    public void doubtKeepsTheBestMatchWithAQuestionMark() throws Exception {
        JSONObject read = new JSONObject().put("schema", "mk8dx.visual-field-read.v1").put("kind", "bodies")
                .put("profile", "result").put("status", "unknown").put("acceptedId", JSONObject.NULL)
                .put("top1Id", "body_variant.pipe_frame.006_iggy").put("cropPixelSha256", "c").put("catalogSha256", "k")
                .put("top", new JSONArray()
                        .put(new JSONObject().put("id", "body_variant.pipe_frame.006_iggy").put("familyId", "body.pipe_frame").put("score", .846))
                        .put(new JSONObject().put("id", "body_variant.pipe_frame.005_green").put("familyId", "body.pipe_frame").put("score", .84)));
        JSONObject kart = ResultProposal.compose(new JSONObject().put("kart", new JSONObject().put("shared_icon_qa", read)))
                .getJSONObject("fields").getJSONObject("kart");
        assertEquals("body_variant.pipe_frame.006_iggy", kart.getString("selectedId"));
        assertTrue(kart.isNull("acceptedId"));
        assertTrue(kart.getBoolean("reviewRequired"));
        assertEquals("body.pipe_frame", kart.getString("proposedFamilyId"));
    }

    @Test
    public void javaProfileEqualsTheWebReaderOnTheSameCrops() throws Exception {
        String bundlePath = System.getenv("MK8DX_PROFILE_PARITY_BUNDLE");
        String packPath = System.getenv("MK8DX_SHARED_ICON_PACK");
        assumeTrue("private parity bundle not configured", bundlePath != null && packPath != null);
        Path bundleDir = Paths.get(bundlePath);
        Path packDir = Paths.get(packPath);
        JSONObject bundle = new JSONObject(new String(Files.readAllBytes(bundleDir.resolve("bundle.json")), "UTF-8"));
        ReferencePack pack = new ReferencePack(name -> Files.readAllBytes(packDir.resolve(name)), GROUPS);
        assertEquals(bundle.getString("catalogSha256"), pack.catalogSha256);

        List<String> differences = new ArrayList<>();
        JSONArray fields = bundle.getJSONArray("fields");
        for (int i = 0; i < fields.length(); i++) {
            JSONObject item = fields.getJSONObject(i);
            String kind = item.getString("kind");
            float[] query = ReferencePack.floats(Files.readAllBytes(bundleDir.resolve("queries").resolve(item.getString("query"))));
            JSONObject expected = item.getJSONObject("expected");
            JSONObject mine = FieldEvidence.read(query, pack.group(kind + "__result"), kind,
                    expected.getString("catalogSha256"), expected.getString("cropPixelSha256"));
            for (String part : new String[]{"top", "status", "acceptedId", "familyMargin", "offset", "shape_rank_qa",
                    "neutral_chroma_qa", "family_colour_qa", "flag_distinctive_qa", "flag_tricolor_qa", "flag_exposure_qa"}) {
                if (!close(expected.opt(part), mine.opt(part))) {
                    differences.add(kind + ":" + part + " " + item.getString("query").substring(0, 12)
                            + " web=" + String.valueOf(expected.opt(part)).substring(0, Math.min(160, String.valueOf(expected.opt(part)).length()))
                            + " java=" + String.valueOf(mine.opt(part)).substring(0, Math.min(160, String.valueOf(mine.opt(part)).length())));
                }
            }
        }
        JSONArray owners = bundle.getJSONArray("owners");
        for (int i = 0; i < owners.length(); i++) {
            JSONObject item = owners.getJSONObject(i);
            JSONObject mine = ResultProposal.compose(item.getJSONObject("input")).getJSONObject("fields");
            JSONObject want = item.getJSONObject("expected").getJSONObject("fields");
            for (Iterator<String> it = want.keys(); it.hasNext(); ) {
                String field = it.next();
                for (String key : new String[]{"status", "proposedId", "selectedId", "acceptedId", "proposedFamilyId",
                        "reviewRequired", "evidence", "top", "visualTop3"}) {
                    if (!close(want.getJSONObject(field).opt(key), mine.getJSONObject(field).opt(key))) {
                        differences.add("decision " + item.getString("key") + " " + field + "." + key);
                    }
                }
            }
        }
        System.out.println("parity fields=" + fields.length() + " owners=" + owners.length()
                + " differences=" + differences.size());
        for (String line : differences.subList(0, Math.min(12, differences.size()))) System.out.println("  " + line);
        assertNotNull(pack);
        assertEquals(0, differences.size());
    }

    private static boolean close(Object a, Object b) {
        if (a == null || a == JSONObject.NULL) return b == null || b == JSONObject.NULL;
        if (b == null || b == JSONObject.NULL) return false;
        if (a instanceof Boolean || b instanceof Boolean) return a.equals(b);
        if (a instanceof Number && b instanceof Number) {
            double x = ((Number) a).doubleValue();
            double y = ((Number) b).doubleValue();
            return Math.abs(x - y) <= 1e-5 * Math.max(1, Math.max(Math.abs(x), Math.abs(y)));
        }
        if (a instanceof JSONObject && b instanceof JSONObject) {
            JSONObject x = (JSONObject) a;
            JSONObject y = (JSONObject) b;
            List<String> keys = new ArrayList<>();
            for (Iterator<String> it = x.keys(); it.hasNext(); ) keys.add(it.next());
            if (keys.size() != y.length()) return false;
            for (String key : keys) {
                if (!y.has(key) || !close(x.opt(key), y.opt(key))) return false;
            }
            return true;
        }
        if (a instanceof JSONArray && b instanceof JSONArray) {
            JSONArray x = (JSONArray) a;
            JSONArray y = (JSONArray) b;
            if (x.length() != y.length()) return false;
            for (int i = 0; i < x.length(); i++) {
                if (!close(x.opt(i), y.opt(i))) return false;
            }
            return true;
        }
        return a.equals(b);
    }
}
