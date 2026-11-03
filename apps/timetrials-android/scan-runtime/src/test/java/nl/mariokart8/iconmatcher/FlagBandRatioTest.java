package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Same synthetic vectors as python/tests/test_flag_band_ratio.py and ts/sharedFlagBandRatio.test.mjs. */
public class FlagBandRatioTest {
    private static float[] tricolour(double[] red, double[] blue, double gain) {
        float[] out = new float[38 * 55 * 3];
        for (int y = 0; y < 38; y++) {
            double[] colour = y < 13 ? red : y < 25 ? new double[]{1, 1, 1} : blue;
            for (int x = 0; x < 55; x++) {
                for (int c = 0; c < 3; c++) out[(y * 55 + x) * 3 + c] = (float) Math.min(1, colour[c] * gain);
            }
        }
        return out;
    }

    private static float[] nl(double gain) {
        return tricolour(new double[]{194 / 255.0, 57 / 255.0, 55 / 255.0}, new double[]{4 / 255.0, 89 / 255.0, 164 / 255.0}, gain);
    }

    @Test
    public void assetTonesDecideAndACommonExposureChangeKeepsTheRatio() throws Exception {
        assertEquals("country.nl", Refinements.flagBandRatio(nl(1)).getString("decisionId"));
        float[] lu = tricolour(new double[]{200 / 255.0, 59 / 255.0, 45 / 255.0}, new double[]{55 / 255.0, 148 / 255.0, 213 / 255.0}, 1);
        assertEquals("country.lu", Refinements.flagBandRatio(lu).getString("decisionId"));
        assertEquals(Refinements.flagBandRatio(nl(1)).getDouble("ratio"), Refinements.flagBandRatio(nl(.7)).getDouble("ratio"), 1e-6);
    }

    @Test
    public void aBetweenToneKeepsReviewAndAGreyCropHasNoBands() throws Exception {
        JSONObject mid = Refinements.flagBandRatio(tricolour(new double[]{.78, .22, .2}, new double[]{.12, .507, .75}, 1));
        assertEquals("measured", mid.getString("status"));
        assertTrue(mid.isNull("decisionId"));
        float[] grey = new float[38 * 55 * 3];
        java.util.Arrays.fill(grey, .5f);
        assertEquals("unavailable", Refinements.flagBandRatio(grey).getString("status"));
    }

    private static JSONObject flagRead(String first, String second, JSONObject band) throws Exception {
        JSONArray top = new JSONArray();
        for (Object[] item : new Object[][]{{first, .91}, {second, .9}, {"country.py", .86}}) {
            top.put(new JSONObject().put("id", item[0]).put("familyId", item[0]).put("score", item[1]));
        }
        return new JSONObject().put("schema", "mk8dx.visual-field-read.v1").put("kind", "flags").put("profile", "result")
                .put("status", "accepted").put("acceptedId", first).put("top1Id", first).put("cropPixelSha256", "c")
                .put("catalogSha256", "k").put("top", top).put("flag_band_ratio_qa", band);
    }

    private static JSONObject band(double ratio, String decision, String crop) throws Exception {
        return new JSONObject().put("schema", "mk8dx.flag-band-ratio.v1").put("status", "measured")
                .put("cropPixelSha256", crop).put("ratio", ratio).put("decisionId", decision == null ? JSONObject.NULL : decision);
    }

    private static JSONObject flag(JSONObject read) throws Exception {
        return ResultProposal.compose(new JSONObject().put("flag", new JSONObject().put("shared_icon_qa", read)))
                .getJSONObject("fields").getJSONObject("flag");
    }

    @Test
    public void theBandRatioSettlesNlAndLuAndKeepsReviewBetweenThem() throws Exception {
        JSONObject read = flagRead("country.lu", "country.nl", band(.41, "country.nl", "c"));
        read.put("photometric_qa", new JSONObject().put("schema", "mk8dx.card-photometric.v1").put("status", "corrected").put("blueClipped", true));
        JSONObject nl = flag(read);
        assertEquals("country.nl", nl.getString("acceptedId"));
        assertEquals("country.nl", nl.getJSONArray("top").getJSONObject(0).getString("id"));
        JSONObject lu = flag(flagRead("country.nl", "country.lu", band(.75, "country.lu", "c")));
        assertEquals("country.lu", lu.getString("acceptedId"));
        JSONObject between = flag(flagRead("country.nl", "country.lu", band(.65, null, "c")));
        assertTrue(between.isNull("acceptedId"));
        assertEquals("country.nl", between.getString("selectedId"));
        JSONObject stale = flag(flagRead("country.nl", "country.lu", band(.75, "country.lu", "x")));
        assertEquals("country.nl", stale.getString("acceptedId"));
    }
}
