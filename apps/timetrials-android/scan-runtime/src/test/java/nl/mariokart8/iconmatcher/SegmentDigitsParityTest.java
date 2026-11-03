package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assume.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Base64;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java 7-segment matcher against Python's records (tooling/recognition/segment_digit_vectors.py).
 * The private vectors stay outside Git: MK8DX_SEGMENT_DIGIT_VECTORS.
 */
public class SegmentDigitsParityTest {
    @Test
    public void javaMatcherEqualsPython() throws Exception {
        String path = System.getenv("MK8DX_SEGMENT_DIGIT_VECTORS");
        assumeTrue("private segment vectors not configured", path != null);
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(Paths.get(path)), "UTF-8"));
        Map<String, SegmentDigits.Template> templates = new HashMap<>();
        JSONObject raw = doc.getJSONObject("templates");
        for (Iterator<String> it = raw.keys(); it.hasNext(); ) {
            String kind = it.next();
            JSONObject t = raw.getJSONObject(kind);
            templates.put(kind, SegmentDigits.templateFromRgb(Base64.getDecoder().decode(t.getString("rgb")),
                    t.getInt("width"), t.getInt("height")));
        }
        JSONArray cases = doc.getJSONArray("cases");
        int differences = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            byte[] binary = Base64.getDecoder().decode(c.getString("binary"));
            int w = c.getInt("width"), h = c.getInt("height"), slot = c.getInt("slot");
            String kind = c.getString("kind");
            String required = c.isNull("required") ? null : c.getString("required");
            boolean ok = same(SegmentDigits.best(binary, w, h, templates.get(kind), kind, slot, null), c.opt("best"))
                    && same(required == null ? null : SegmentDigits.best(binary, w, h, templates.get(kind), kind, slot, required),
                    c.opt("bestRequired"));
            double[] scores = SegmentDigits.segmentScores(binary, w, h);
            JSONArray want = c.getJSONArray("segmentScores");
            for (int k = 0; k < 7 && ok; k++) ok = Math.abs(scores[k] - want.getDouble(k)) <= 1e-9;
            if (!ok && ++differences <= 5) System.out.println("differs " + c.getInt("id"));
        }
        System.out.println("segment parity vectors=" + cases.length() + " differences=" + differences);
        assertEquals(0, differences);
    }

    private static boolean same(SegmentDigits.Candidate got, Object wantObject) throws Exception {
        if (wantObject == null || wantObject == JSONObject.NULL) return got == null;
        if (got == null) return false;
        JSONObject want = (JSONObject) wantObject;
        if (!got.pattern.equals(want.getString("pattern")) || !got.decoded.equals(want.getString("decoded"))
                || got.valid != want.getBoolean("valid") || got.onCount != want.getInt("onCount")
                || got.x != want.getInt("x") || got.y != want.getInt("y") || got.w != want.getInt("w")
                || got.h != want.getInt("h")) return false;
        if (Math.abs(got.confidence - want.getDouble("confidence")) > 1e-9
                || Math.abs(got.margin - want.getDouble("margin")) > 1e-9
                || Math.abs(got.scaleX - want.getDouble("scaleX")) > 1e-9
                || Math.abs(got.scaleY - want.getDouble("scaleY")) > 1e-9) return false;
        JSONArray values = want.getJSONArray("values");
        for (int k = 0; k < 7; k++) if (Math.abs(got.values[k] - values.getDouble(k)) > 1e-9) return false;
        return true;
    }
}
