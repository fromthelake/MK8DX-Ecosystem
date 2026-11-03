package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The Java card quad against Python's records (packages/icon-matcher/vectors/card-quad-v1.json). */
public class CardQuadParityTest {
    private static File vectors() {
        File dir = new File("").getAbsoluteFile();
        while (dir != null) {
            File candidate = new File(dir, "packages/icon-matcher/vectors/card-quad-v1.json");
            if (candidate.isFile()) return candidate;
            dir = dir.getParentFile();
        }
        throw new IllegalStateException("card-quad-v1.json not found");
    }

    private static boolean close(double a, double b) {
        return Math.abs(a - b) <= 1e-9 * Math.max(1.0, Math.max(Math.abs(a), Math.abs(b)));
    }

    private static boolean sameQuad(double[][] got, Object want) throws Exception {
        if (got == null || want == null || JSONObject.NULL.equals(want)) {
            return got == null && (want == null || JSONObject.NULL.equals(want));
        }
        JSONArray w = (JSONArray) want;
        for (int i = 0; i < 4; i++) {
            JSONArray p = w.getJSONArray(i);
            if (!close(got[i][0], p.getDouble(0)) || !close(got[i][1], p.getDouble(1))) return false;
        }
        return true;
    }

    private static boolean sameLine(CardQuad.Line l, JSONObject w) throws Exception {
        double angle = Double.isNaN(l.angle) ? l.angleDeg() : l.angle;
        return close(l.x1, w.getDouble("x1")) && close(l.y1, w.getDouble("y1")) && close(l.x2, w.getDouble("x2"))
            && close(l.y2, w.getDouble("y2")) && close(l.workflowLen(), w.getDouble("workflowLength"))
            && close(angle, w.getDouble("angle")) && close(l.support, w.getDouble("support"))
            && l.count == w.getDouble("count") && l.keyName.equals(w.getString("keyName"))
            && close(l.keyValue, w.getDouble("keyValue"));
    }

    @Test
    public void javaCardQuadEqualsPython() throws Exception {
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(vectors().toPath()), "UTF-8"));
        int differences = 0;
        JSONArray quads = doc.getJSONArray("quads");
        for (int i = 0; i < quads.length(); i++) {
            JSONObject c = quads.getJSONObject(i);
            JSONArray segments = c.getJSONArray("segments");
            List<CardQuad.Line> lines = new ArrayList<>();
            for (int k = 0; k < segments.length(); k++) {
                JSONArray s = segments.getJSONArray(k);
                lines.add(new CardQuad.Line(s.getDouble(0), s.getDouble(1), s.getDouble(2), s.getDouble(3)));
            }
            List<CardQuad.Line> axis = CardQuad.filterAngles(lines);
            CardQuad.Guard guard = CardQuad.shortLineGuard(axis);
            List<CardQuad.Line> clusters = CardQuad.clusterLines(guard.lines);
            double[][] quad = CardQuad.selectQuad(c.getInt("maskW"), c.getInt("maskH"), clusters);
            JSONArray wantClusters = c.getJSONArray("clusters");
            boolean ok = axis.size() == c.getInt("axisCount") && guard.guardUsed == c.getBoolean("guardUsed")
                && guard.fallbackUsed == c.getBoolean("fallbackUsed") && guard.lines.size() == c.getInt("guardedCount")
                && clusters.size() == wantClusters.length() && sameQuad(quad, c.opt("quad"));
            for (int k = 0; ok && k < clusters.size(); k++) ok = sameLine(clusters.get(k), wantClusters.getJSONObject(k));
            if (!ok && ++differences <= 5) System.out.println("quad differs " + i);
        }
        JSONArray deskews = doc.getJSONArray("deskews");
        for (int i = 0; i < deskews.length(); i++) {
            JSONObject c = deskews.getJSONObject(i);
            JSONArray dets = c.getJSONArray("detections");
            List<double[]> lapIndex = new ArrayList<>();
            for (int k = 0; k < dets.length(); k++) {
                JSONObject d = dets.getJSONObject(k);
                if (!"lap_index".equals(d.getString("label"))) continue;
                lapIndex.add(new double[]{d.getDouble("left"), d.getDouble("top"), d.getDouble("right"), d.getDouble("bottom")});
            }
            CardQuad.Deskew got = CardQuad.ghostDetailDeskewSeed(lapIndex, c.getInt("frameW"), c.getInt("frameH"),
                c.getDouble("roiLeft"), c.getDouble("roiTop"), c.getInt("cropW"), c.getInt("cropH"));
            Object want = c.opt("result");
            boolean ok;
            if (got == null || want == null || JSONObject.NULL.equals(want)) {
                ok = got == null && (want == null || JSONObject.NULL.equals(want));
            } else {
                JSONObject w = (JSONObject) want;
                ok = close(got.degrees, w.getDouble("degrees")) && sameQuad(got.quad, w.getJSONArray("quad"));
            }
            if (!ok && ++differences <= 5) System.out.println("deskew differs " + i);
        }
        System.out.println("card quad parity quads=" + quads.length() + " deskews=" + deskews.length() + " differences=" + differences);
        assertEquals(0, differences);
    }
}
