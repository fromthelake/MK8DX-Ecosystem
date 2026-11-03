package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The Java panel registration decision against Python's records (packages/icon-matcher/vectors/panel-registration-v1.json). */
public class PanelRegistrationParityTest {
    private static File vectors() {
        File dir = new File("").getAbsoluteFile();
        while (dir != null) {
            File candidate = new File(dir, "packages/icon-matcher/vectors/panel-registration-v1.json");
            if (candidate.isFile()) return candidate;
            dir = dir.getParentFile();
        }
        throw new IllegalStateException("panel-registration-v1.json not found");
    }

    private static boolean close(double a, double b) {
        return Math.abs(a - b) <= 1e-9 * Math.max(1.0, Math.max(Math.abs(a), Math.abs(b)));
    }

    private static double num(JSONArray a, int i) throws Exception {
        return a.isNull(i) ? Double.NaN : a.getDouble(i);
    }

    @Test
    public void javaPanelRegistrationEqualsPython() throws Exception {
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(vectors().toPath()), "UTF-8"));
        JSONArray cases = doc.getJSONArray("cases");
        int differences = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            JSONArray rawBoxes = c.getJSONArray("boxes");
            List<int[]> boxes = new ArrayList<>();
            for (int k = 0; k < rawBoxes.length(); k++) {
                JSONArray b = rawBoxes.getJSONArray(k);
                boxes.add(new int[]{b.getInt(0), b.getInt(1), b.getInt(2), b.getInt(3)});
            }
            JSONArray matches = c.getJSONArray("matches");
            List<List<double[]>> seen = new ArrayList<>();
            PanelRegistration.Result got = PanelRegistration.registerPanel(c.getString("variant"), boxes, c.getInt("imageW"),
                c.getInt("imageH"), new PanelRegistration.Pixels() {
                    @Override
                    public double[] match(int index, int[] window) throws Exception {
                        JSONArray m = matches.getJSONArray(index);
                        return new double[]{m.getDouble(0), m.getDouble(1), m.getDouble(2), num(m, 3), num(m, 4), num(m, 5), num(m, 6)};
                    }

                    @Override
                    public PanelRegistration.Homography homography(List<double[]> found, List<double[]> reference) throws Exception {
                        seen.add(found);
                        double[] h = null;
                        if (!c.isNull("homography")) {
                            JSONArray raw = c.getJSONArray("homography");
                            h = new double[9];
                            for (int k = 0; k < 9; k++) h[k] = raw.getDouble(k);
                        }
                        return new PanelRegistration.Homography(h, c.getInt("inliers"));
                    }
                });
            JSONObject want = c.getJSONObject("result");
            boolean ok = (got.h == null) == want.isNull("h");
            if (ok && got.h != null) {
                JSONArray wh = want.getJSONArray("h");
                for (int k = 0; k < 9; k++) ok &= close(got.h[k], wh.getDouble(k));
            }
            JSONObject info = want.getJSONObject("info");
            ok &= info.length() == got.info.size();
            for (Iterator<String> it = info.keys(); ok && it.hasNext(); ) {
                String key = it.next();
                Object g = got.info.get(key);
                Object w = info.get(key);
                ok = g instanceof Number && w instanceof Number ? close(((Number) g).doubleValue(), ((Number) w).doubleValue()) : w.equals(g);
            }
            if (!c.isNull("found")) {
                JSONArray wf = c.getJSONArray("found");
                ok &= seen.size() == 1 && seen.get(0).size() == wf.length();
                for (int k = 0; ok && k < wf.length(); k++) {
                    ok = close(seen.get(0).get(k)[0], wf.getJSONArray(k).getDouble(0)) && close(seen.get(0).get(k)[1], wf.getJSONArray(k).getDouble(1));
                }
            }
            if (!ok && ++differences <= 5) System.out.println("differs " + i + " " + got.info);
        }
        System.out.println("panel registration parity cases=" + cases.length() + " differences=" + differences);
        assertEquals(0, differences);
    }
}
