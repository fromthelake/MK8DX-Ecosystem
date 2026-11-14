package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java crop-search decision (CropSearch) against the Python reference on public vectors
 * (packages/icon-matcher/vectors/crop-search-v1.json, written by
 * packages/icon-matcher/tools/generate_crop_search_vectors.py; issue #99 phase 3): synthetic cases and
 * real crops from the public test set. Scale, shift, rounded score, crop box and every look must be
 * identical; real cases must also equal what the Web scanner decided on the same canonical card.
 */
public class CropSearchParityTest {
    static final String PUBLIC_VECTORS = "../../../packages/icon-matcher/vectors/crop-search-v1.json";

    private static int[] ints(JSONArray raw) throws Exception {
        int[] out = new int[raw.length()];
        for (int i = 0; i < out.length; i++) out[i] = raw.getInt(i);
        return out;
    }

    private static CropSearch.Look look(JSONObject raw) throws Exception {
        JSONArray box = raw.getJSONArray("box");
        Set<String> subset = null;
        if (!raw.isNull("subset")) {
            subset = new HashSet<>();
            JSONArray ids = raw.getJSONArray("subset");
            for (int i = 0; i < ids.length(); i++) subset.add(ids.getString(i));
        }
        List<CropSearch.Candidate> candidates = new ArrayList<>();
        JSONArray rows = raw.getJSONArray("candidates");
        for (int i = 0; i < rows.length(); i++) {
            JSONArray c = rows.getJSONArray(i);
            candidates.add(new CropSearch.Candidate(c.getString(0), c.getDouble(1), c.getDouble(2), c.getInt(3), c.getInt(4)));
        }
        return new CropSearch.Look(raw.getDouble("scale"),
                new double[]{box.getDouble(0), box.getDouble(1), box.getDouble(2), box.getDouble(3)},
                raw.getInt("search"), subset, raw.isNull("centerScore") ? 0.0 : raw.getDouble("centerScore"),
                candidates, raw.isNull("shiftedScore") ? 0.0 : raw.getDouble("shiftedScore"));
    }

    private static boolean same(CropSearch.Decision got, JSONObject want) throws Exception {
        boolean window = want.isNull("window") ? got.window == null
                : got.window != null && Arrays.equals(got.window, ints(want.getJSONArray("window")));
        return window && got.dx == want.getInt("dx") && got.dy == want.getInt("dy")
                && got.score == want.getDouble("score") && got.shifted == want.getBoolean("shifted");
    }

    @Test
    public void javaCropSearchEqualsPython() throws Exception {
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(Paths.get(PUBLIC_VECTORS)), StandardCharsets.UTF_8));
        assertEquals("mk8dx.crop-search-vectors.v1", doc.getString("schema"));
        JSONArray cases = doc.getJSONArray("cases");
        List<String> failures = new ArrayList<>();
        int real = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject item = cases.getJSONObject(i);
            List<CropSearch.Look> looks = new ArrayList<>();
            JSONArray rawLooks = item.getJSONArray("looks");
            for (int k = 0; k < rawLooks.length(); k++) looks.add(look(rawLooks.getJSONObject(k)));
            CropSearch.FieldDecision got = CropSearch.decideField(item.getInt("width"), item.getInt("height"),
                    ints(item.getJSONArray("slot")), looks);
            JSONObject want = item.getJSONObject("expected");
            boolean ok = got.scale == want.getDouble("scale") && got.best.dx == want.getInt("dx")
                    && got.best.dy == want.getInt("dy") && got.best.score == want.getDouble("score")
                    && Arrays.equals(got.cropBox, ints(want.getJSONArray("cropBox")));
            JSONArray wantLooks = want.getJSONArray("looks");
            ok = ok && wantLooks.length() == got.looks.length;
            for (int k = 0; ok && k < got.looks.length; k++) ok = same(got.looks[k], wantLooks.getJSONObject(k));
            if (!"synthetic".equals(item.getString("source"))) {
                real++;
                JSONObject web = item.getJSONObject("web");
                ok = ok && got.scale == web.getDouble("scale") && got.best.dx == web.getInt("dx")
                        && got.best.dy == web.getInt("dy") && got.best.score == web.getDouble("score")
                        && (web.isNull("cropBox") || Arrays.equals(got.cropBox, ints(web.getJSONArray("cropBox"))));
            }
            if (!ok) failures.add(item.getString("name"));
        }
        System.out.println("crop search parity cases=" + cases.length() + " real=" + real + " differences=" + failures.size());
        assertTrue("cases replayed", cases.length() >= 20 && real > 0);
        assertEquals("differences: " + failures, 0, failures.size());
    }
}
