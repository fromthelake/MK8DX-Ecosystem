package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The Java card registration decision against Python's records (packages/icon-matcher/vectors/card-registration-v1.json). */
public class CardRegistrationParityTest {
    private static File vectors() {
        File dir = new File("").getAbsoluteFile();
        while (dir != null) {
            File candidate = new File(dir, "packages/icon-matcher/vectors/card-registration-v1.json");
            if (candidate.isFile()) return candidate;
            dir = dir.getParentFile();
        }
        throw new IllegalStateException("card-registration-v1.json not found");
    }

    private static double[] numbers(JSONArray array) throws Exception {
        double[] out = new double[array.length()];
        for (int i = 0; i < out.length; i++) out[i] = array.getDouble(i);
        return out;
    }

    @Test
    public void javaRegistrationEqualsPython() throws Exception {
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(vectors().toPath()), "UTF-8"));
        double half = doc.getJSONObject("registration").getDouble("half");
        double scoreMin = doc.getJSONObject("registration").getDouble("scoreMin");
        JSONArray cases = doc.getJSONArray("cases");
        int differences = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            JSONObject p = c.getJSONObject("panel");
            FrameGeometry.Panel panel = new FrameGeometry.Panel(p.getDouble("x"), p.getDouble("y"), p.getDouble("w"), p.getDouble("h"), p.getString("source"));
            double[] w = numbers(c.getJSONArray("window"));
            int[] window = {(int) w[0], (int) w[1], (int) w[2], (int) w[3]};
            JSONObject coarse = c.getJSONObject("coarse");
            double[] fine = numbers(c.getJSONArray("fine"));
            List<String> fineCalls = new ArrayList<>();
            double[] got = FrameGeometry.registerCard(half, scoreMin, panel, window, new FrameGeometry.RegisterMatcher() {
                @Override
                public double[] coarse(int tw, int th) {
                    try {
                        String key = tw + "x" + th;
                        return coarse.has(key) ? numbers(coarse.getJSONArray(key)) : new double[]{Double.NaN, 0, 0};
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                }

                @Override
                public double[] fine(int x1, int y1, int x2, int y2, int tw, int th) {
                    fineCalls.add(x1 + "," + y1 + "," + x2 + "," + y2 + "," + tw + "," + th);
                    return fine;
                }
            });
            double[] want = numbers(c.getJSONArray("result"));
            boolean same = got.length == want.length;
            for (int k = 0; same && k < want.length; k++) same = Math.abs(got[k] - want[k]) <= 1e-9;
            JSONArray wantCalls = c.getJSONArray("fineCalls");
            same = same && wantCalls.length() == fineCalls.size();
            for (int k = 0; same && k < wantCalls.length(); k++) {
                JSONArray call = wantCalls.getJSONArray(k);
                same = fineCalls.get(k).equals(call.getInt(0) + "," + call.getInt(1) + "," + call.getInt(2) + ","
                    + call.getInt(3) + "," + call.getInt(4) + "," + call.getInt(5));
            }
            if (!same && ++differences <= 5) System.out.println("differs " + i);
        }
        System.out.println("card registration parity cases=" + cases.length() + " differences=" + differences);
        assertEquals(0, differences);
    }
}
