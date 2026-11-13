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

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The shared Java icon scorer against the Python reference on public vectors
 * (packages/icon-matcher/vectors/icon-score-v1.json, written by
 * packages/icon-matcher/tools/generate_vectors.py; issue #99).
 *
 * <p>IconScorer implements center_shortlist only, so that mode is replayed. Decisions (status, top-1,
 * accepted ID, ordered top 3, offset) must be identical and scores within 1e-6. Cases flagged boundary or
 * nearTie are reported, not failed, until the arithmetic is unified. The Android context rules
 * (SharedFieldReader.combineCharacter/combinePart) are app-local and not covered here; context-v1.json is
 * replayed by Python and TypeScript only.
 *
 * <p>Needs a materialized recognition pack: MK8DX_SHARED_ICON_PACK (its tensor-pack/) or
 * MK8DX_RECOGNITION_PACK (the pack root); skips without one.
 */
public class IconScoreParityTest {
    private static final double TOLERANCE = 1e-6;
    private static final String MODE = "center_shortlist";

    private static Path packDir() {
        String tensors = System.getenv("MK8DX_SHARED_ICON_PACK");
        if (tensors != null) return Paths.get(tensors);
        String root = System.getenv("MK8DX_RECOGNITION_PACK");
        return root == null ? null : Paths.get(root, "tensor-pack");
    }

    private static String decision(String status, String top1, String accepted, List<String> top, int[] offset) {
        return status + "|" + top1 + "|" + accepted + "|" + top + "|" + offset[0] + "," + offset[1];
    }

    @Test
    public void javaIconScorerEqualsPython() throws Exception {
        Path pack = packDir();
        assumeTrue("recognition pack not materialized (set MK8DX_RECOGNITION_PACK)",
                pack != null && Files.isRegularFile(pack.resolve("references.json")));
        Path fixture = Paths.get("../../../packages/icon-matcher/vectors/icon-score-v1.json");
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(fixture), StandardCharsets.UTF_8));
        assertEquals("mk8dx.icon-score-vectors.v1", doc.getString("schema"));
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
        double maxDelta = 0;
        JSONArray cases = doc.getJSONArray("cases");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject item = cases.getJSONObject(i);
            byte[] bytes = Base64.getDecoder().decode(item.getString("query"));
            float[] query = new float[bytes.length];
            for (int b = 0; b < bytes.length; b++) query[b] = (bytes[b] & 0xff) / 255f;
            IconScorer.Match got = IconScorer.match(query, references.group(item.getString("group")));
            JSONObject want = item.getJSONObject("expected").getJSONObject(MODE);

            JSONArray wantTop = want.getJSONArray("top");
            List<String> wantIds = new ArrayList<>();
            for (int t = 0; t < wantTop.length(); t++) wantIds.add(wantTop.getJSONObject(t).getString("id"));
            JSONArray wantOffset = want.getJSONArray("offset");
            String wantDecision = decision(want.getString("status"), want.getString("top1Id"),
                    want.isNull("acceptedId") ? null : want.getString("acceptedId"), wantIds,
                    new int[]{wantOffset.getInt(0), wantOffset.getInt(1)});
            String gotDecision = decision(got.status, got.top1Id, got.acceptedId, got.topIds, got.offset);

            double delta = Math.max(Math.abs(got.score - want.getDouble("score")),
                    Math.abs(got.margin - want.getDouble("margin")));
            boolean familyMarginSame = want.isNull("familyMargin") ? got.familyMargin == null
                    : got.familyMargin != null;
            if (got.familyMargin != null && !want.isNull("familyMargin")) {
                delta = Math.max(delta, Math.abs(got.familyMargin - want.getDouble("familyMargin")));
            }
            for (int t = 0; t < Math.min(wantTop.length(), got.topScores.size()); t++) {
                delta = Math.max(delta, Math.abs(got.topScores.get(t) - wantTop.getJSONObject(t).getDouble("score")));
            }
            maxDelta = Math.max(maxDelta, delta);
            if (wantDecision.equals(gotDecision) && familyMarginSame && delta <= TOLERANCE) continue;
            String entry = item.getString("id") + ": python " + wantDecision + " " + want.getDouble("score")
                    + " java " + gotDecision + " " + got.score + " (delta " + delta + ")";
            if (item.optBoolean("boundary") || item.optBoolean("nearTie")) reported.add(entry);
            else failures.add(entry);
        }
        System.out.println("icon-score-v1: " + cases.length() + " Java replays, max |score delta| " + maxDelta);
        if (!reported.isEmpty()) System.out.println("icon-score-v1 boundary differences (issue #99): " + reported);
        assertEquals(String.join("\n", failures), 0, failures.size());
    }
}
