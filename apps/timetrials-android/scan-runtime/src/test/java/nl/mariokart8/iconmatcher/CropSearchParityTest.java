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

    private static JSONObject doc() throws Exception {
        return new JSONObject(new String(Files.readAllBytes(Paths.get(PUBLIC_VECTORS)), StandardCharsets.UTF_8));
    }

    /** A helper's Java result against the JSON value Python recorded (numbers compared as doubles). */
    private static boolean matches(Object got, Object want) throws Exception {
        if (got == null || want == JSONObject.NULL) {
            return got == null && want == JSONObject.NULL;
        }
        if (got instanceof int[] || got instanceof double[]) {
            if (!(want instanceof JSONArray)) return false;
            JSONArray array = (JSONArray) want;
            int n = got instanceof int[] ? ((int[]) got).length : ((double[]) got).length;
            if (array.length() != n) return false;
            for (int i = 0; i < n; i++) {
                double value = got instanceof int[] ? ((int[]) got)[i] : ((double[]) got)[i];
                if (value != array.getDouble(i)) return false;
            }
            return true;
        }
        if (got instanceof Boolean) return got.equals(want);
        return want instanceof Number && ((Number) got).doubleValue() == ((Number) want).doubleValue();
    }

    private static Set<String> subset(Object raw) throws Exception {
        if (raw == JSONObject.NULL) return null;
        Set<String> out = new HashSet<>();
        JSONArray ids = (JSONArray) raw;
        for (int i = 0; i < ids.length(); i++) out.add(ids.getString(i));
        return out;
    }

    private static Object call(String fn, JSONArray a) throws Exception {
        switch (fn) {
            case "searchPx": return CropSearch.searchPx(a.getString(0));
            case "searchWindow": return CropSearch.searchWindow(a.getInt(0), a.getInt(1), a.getInt(2), a.getInt(3),
                    a.getInt(4), a.getInt(5), a.getInt(6));
            case "windowGain": return CropSearch.windowGain(a.getDouble(0), a.getDouble(1));
            case "votes": return CropSearch.votes(a.getString(0), a.getDouble(1), subset(a.get(2)));
            case "pickedShift": return CropSearch.pickedShift(ints(a.getJSONArray(0)), ints(a.getJSONArray(1)),
                    a.getInt(2), a.getInt(3));
            case "acceptShift": return CropSearch.acceptShift(a.getDouble(0), a.getDouble(1));
            case "boostRegion": return CropSearch.boostRegion(ints(a.getJSONArray(0)), a.getInt(1), a.getInt(2));
            case "boostFactor": return CropSearch.boostFactor(a.getDouble(0));
            case "lookBox": return CropSearch.lookBox(ints(a.getJSONArray(0)), a.getDouble(1), a.getInt(2), a.getInt(3));
            case "betterLook": return CropSearch.betterLook(a.getDouble(0), a.isNull(1) ? null : a.getDouble(1));
            case "cropBox": return CropSearch.cropBox(ints(a.getJSONArray(0)), a.getDouble(1), a.getInt(2), a.getInt(3));
            default: throw new IllegalArgumentException("unknown helper " + fn);
        }
    }

    /** The constants the APK's CleanAssetsMatcher/KartConfigMatcher read from CropSearch (phase 4). */
    @Test
    public void constantsAreTheVectors() throws Exception {
        JSONObject want = doc().getJSONObject("constants");
        JSONArray scales = want.getJSONArray("characterScales");
        double[] got = CropSearch.characterScales();
        assertEquals(scales.length(), got.length);
        for (int i = 0; i < got.length; i++) assertEquals(scales.getDouble(i), got[i], 0.0);
        JSONObject px = want.getJSONObject("searchPx");
        assertEquals(3, px.length());
        for (String group : new String[]{"characters", "bodies", "gliders"}) {
            assertEquals(group, px.getInt(group), CropSearch.searchPx(group));
        }
        assertEquals(want.getInt("boostMargin"), CropSearch.BOOST_MARGIN);
        assertEquals(want.getDouble("boostSatMin"), CropSearch.BOOST_SAT_MIN, 0.0);
        assertEquals(want.getDouble("boostSatMax"), CropSearch.BOOST_SAT_MAX, 0.0);
        assertEquals(want.getDouble("boostSatTarget"), CropSearch.BOOST_SAT_TARGET, 0.0);
        assertEquals(want.getDouble("boostMaxFactor"), CropSearch.BOOST_MAX_FACTOR, 0.0);
        assertEquals(want.getDouble("windowGainMin"), CropSearch.WINDOW_GAIN_MIN, 0.0);
        assertEquals(want.getDouble("windowGainMax"), CropSearch.WINDOW_GAIN_MAX, 0.0);
        assertEquals(want.getDouble("minWindowMean"), CropSearch.MIN_WINDOW_MEAN, 0.0);
        assertEquals(want.getInt("minTemplatePx"), CropSearch.MIN_TEMPLATE_PX);
        assertEquals(want.getInt("minCropPx"), CropSearch.MIN_CROP_PX);
        assertEquals(want.getDouble("minTemplateSum"), CropSearch.MIN_TEMPLATE_SUM, 0.0);
        assertEquals(13, want.length());
    }

    /** The step functions the APK calls, one case per branch. */
    @Test
    public void helperCasesReplay() throws Exception {
        JSONArray cases = doc().getJSONArray("helperCases");
        List<String> failures = new ArrayList<>();
        for (int i = 0; i < cases.length(); i++) {
            JSONObject item = cases.getJSONObject(i);
            if (!matches(call(item.getString("fn"), item.getJSONArray("args")), item.get("expected"))) {
                failures.add(item.getString("fn") + item.getJSONArray("args"));
            }
        }
        System.out.println("crop search helpers=" + cases.length() + " differences=" + failures.size());
        assertTrue("helper cases", cases.length() >= 40);
        assertEquals("differences: " + failures, 0, failures.size());
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
