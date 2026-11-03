package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assume.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Paths;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java frame geometry against Python's records (tooling/recognition/frame_geometry_vectors.py);
 * MK8DX_FRAME_DEFINITIONS (frame-definitions-v1.json) and MK8DX_FRAME_GEOMETRY_VECTORS.
 */
public class FrameGeometryParityTest {
    private static final String[] KINDS = {"character_icon", "kart_icon", "wheel_icon", "glider_icon", "flag_icon"};

    private static JSONObject read(String path) throws Exception {
        return new JSONObject(new String(Files.readAllBytes(Paths.get(path)), "UTF-8"));
    }

    private static boolean same(double[] got, JSONArray want) throws Exception {
        if (got == null || want == null) return got == null && want == null;
        if (got.length != want.length()) return false;
        for (int i = 0; i < got.length; i++) if (Math.abs(got[i] - want.getDouble(i)) > 1e-9) return false;
        return true;
    }

    private static boolean same(int[] got, JSONArray want) throws Exception {
        if (got == null || want == null) return got == null && want == null;
        if (got.length != want.length()) return false;
        for (int i = 0; i < got.length; i++) if (got[i] != want.getInt(i)) return false;
        return true;
    }

    @Test
    public void javaFrameGeometryEqualsPython() throws Exception {
        String defsPath = System.getenv("MK8DX_FRAME_DEFINITIONS");
        String vectorsPath = System.getenv("MK8DX_FRAME_GEOMETRY_VECTORS");
        assumeTrue("private frame definitions not configured", defsPath != null && vectorsPath != null);
        FrameGeometry fg = new FrameGeometry(read(defsPath));
        JSONArray cases = read(vectorsPath).getJSONArray("cases");
        int differences = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            JSONArray rawAnchor = c.optJSONArray("anchor");
            double[] anchor = rawAnchor == null ? null : new double[]{rawAnchor.getDouble(0), rawAnchor.getDouble(1)};
            JSONArray rawReg = c.optJSONArray("registration");
            double[] reg = rawReg == null ? null
                : new double[]{rawReg.getDouble(0), rawReg.getDouble(1), rawReg.getDouble(2), rawReg.getDouble(3)};
            int imageW = c.getJSONArray("image").getInt(0);
            int imageH = c.getJSONArray("image").getInt(1);
            FrameGeometry.Panel panel = fg.panelBox(c.getString("raceKey"), c.getString("owner"), anchor);
            boolean ok;
            if (panel == null || c.isNull("panel")) {
                ok = panel == null && c.isNull("panel");
            } else {
                JSONObject want = c.getJSONObject("panel");
                ok = Math.abs(panel.x - want.getDouble("x")) <= 1e-9 && Math.abs(panel.y - want.getDouble("y")) <= 1e-9
                    && Math.abs(panel.w - want.getDouble("w")) <= 1e-9 && Math.abs(panel.h - want.getDouble("h")) <= 1e-9
                    && panel.source.equals(want.getString("source"));
                String laps = FrameGeometry.raceAndLaps(c.getString("raceKey"))[1];
                boolean ghostDetail = FrameGeometry.isGhostDetail(c.getString("raceKey"));
                ok &= same(fg.registerWindow(panel, imageW, imageH), c.getJSONArray("registerWindow"));
                int right = fg.textRight(panel, ghostDetail);
                ok &= right == c.getInt("textRight") && fg.ghostNameRight(panel) == c.getInt("ghostNameRight");
                for (String kind : KINDS) {
                    JSONObject wantField = c.getJSONObject("fields").getJSONObject(kind);
                    ok &= same(fg.deployBox(kind, laps, panel.w, panel.h), wantField.optJSONArray("deployBox"));
                    int[] slot = fg.slotBox(c.getString("owner"), kind, laps, panel, reg);
                    ok &= same(slot, wantField.optJSONArray("slot"));
                    if (slot != null) {
                        ok &= same(fg.searchWindow(kind, slot, imageW, imageH), wantField.getJSONArray("searchWindow"));
                        ok &= same(fg.textStrip(slot, right), wantField.getJSONArray("textStrip"));
                    }
                }
            }
            if (!ok && ++differences <= 5) System.out.println("differs " + c);
        }
        System.out.println("frame geometry parity cases=" + cases.length() + " differences=" + differences);
        assertEquals(0, differences);
    }
}
