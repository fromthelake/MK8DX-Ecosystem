package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assume.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java lap grid against Python's records: the public vectors
 * (packages/icon-matcher/vectors/lap-grid-v1.json, tools/generate_rule_vectors.py; issue #99), or
 * MK8DX_LAP_GRID_VECTORS. Needs the pack's frame-definitions-v1.json (MK8DX_FRAME_DEFINITIONS or
 * MK8DX_RECOGNITION_PACK); skips without it.
 */
public class LapGridParityTest {
    static final String PUBLIC_VECTORS = "../../../packages/icon-matcher/vectors/lap-grid-v1.json";

    private static List<LapGrid.Detection> detections(JSONArray raw) throws Exception {
        List<LapGrid.Detection> out = new ArrayList<>();
        for (int i = 0; i < raw.length(); i++) {
            JSONObject d = raw.getJSONObject(i);
            out.add(new LapGrid.Detection(d.getString("label"), d.getDouble("score"), d.getDouble("left"),
                d.getDouble("top"), d.getDouble("right"), d.getDouble("bottom")));
        }
        return out;
    }

    private static boolean same(LapGrid.Box box, JSONArray want) throws Exception {
        return Math.abs(box.left - want.getDouble(0)) <= 1e-9 && Math.abs(box.top - want.getDouble(1)) <= 1e-9
            && Math.abs(box.right - want.getDouble(2)) <= 1e-9 && Math.abs(box.bottom - want.getDouble(3)) <= 1e-9;
    }

    private static boolean same(LapGrid.Grid got, JSONObject want) throws Exception {
        if (got.available != want.getBoolean("available") || !got.status.equals(want.getString("status"))
            || got.activeLapCount != want.getInt("activeLapCount") || got.expectedFieldCount != want.getInt("expectedFieldCount")
            || got.matchedLapIndexCount != want.getInt("matchedLapIndexCount")) return false;
        JSONArray owners = want.getJSONArray("activeOwners");
        if (owners.length() != got.activeOwners.size()) return false;
        for (int i = 0; i < owners.length(); i++) if (!owners.getString(i).equals(got.activeOwners.get(i))) return false;
        JSONArray fields = want.getJSONArray("fields");
        if (fields.length() != got.fields.size()) return false;
        for (int i = 0; i < fields.length(); i++) {
            JSONObject f = fields.getJSONObject(i);
            LapGrid.Field g = got.fields.get(i);
            if (!g.name.equals(f.getString("name")) || !same(g.box, f.getJSONArray("box"))) return false;
            JSONArray slots = f.getJSONArray("slots");
            if (slots.length() != g.slots.size()) return false;
            for (int k = 0; k < slots.length(); k++) if (!same(g.slots.get(k), slots.getJSONArray(k))) return false;
        }
        JSONObject anchors = want.getJSONObject("ownerAnchors");
        if (anchors.length() != got.ownerAnchors.size()) return false;
        for (String owner : got.ownerAnchors.keySet()) {
            JSONArray a = anchors.getJSONArray(owner);
            double[] b = got.ownerAnchors.get(owner);
            if (Math.abs(a.getDouble(0) - b[0]) > 1e-9 || Math.abs(a.getDouble(1) - b[1]) > 1e-9) return false;
        }
        JSONObject matches = want.getJSONObject("ownerMatches");
        if (matches.length() != got.ownerMatches.size()) return false;
        for (String owner : got.ownerMatches.keySet()) {
            JSONObject w = matches.getJSONObject(owner);
            LapGrid.OwnerMatches g = got.ownerMatches.get(owner);
            if (w.getInt("inferredLapCount") != g.inferredLapCount || w.getJSONArray("matches").length() != g.matches.size()) return false;
            for (int k = 0; k < g.matches.size(); k++) {
                JSONObject m = w.getJSONArray("matches").getJSONObject(k);
                if (m.getInt("rowIndex") != g.matches.get(k).rowIndex || m.getInt("detIndex") != g.matches.get(k).detIndex) return false;
            }
        }
        return true;
    }

    @Test
    public void javaLapGridEqualsPython() throws Exception {
        String defsPath = FrameGeometryParityTest.frameDefinitions();
        String vectorsPath = System.getenv("MK8DX_LAP_GRID_VECTORS");
        if (vectorsPath == null) vectorsPath = PUBLIC_VECTORS;
        assumeTrue("frame definitions not available (set MK8DX_RECOGNITION_PACK)", defsPath != null);
        JSONObject grids = new JSONObject(new String(Files.readAllBytes(Paths.get(defsPath)), "UTF-8")).getJSONObject("timeGrids");
        JSONArray cases = new JSONObject(new String(Files.readAllBytes(Paths.get(vectorsPath)), "UTF-8")).getJSONArray("cases");
        int differences = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            LapGrid.Grid got = LapGrid.build(grids.getJSONObject(c.getString("timeGrid")), c.getString("raceKey"),
                c.getBoolean("ghostDetail"), c.getInt("width"), c.getInt("height"), detections(c.getJSONArray("detections")),
                detections(c.getJSONArray("lapRows")), c.getBoolean("nominal"));
            if (!same(got, c.getJSONObject("result")) && ++differences <= 5) System.out.println("differs " + i + " " + got.status);
        }
        System.out.println("lap grid parity cases=" + cases.length() + " differences=" + differences);
        assertEquals(0, differences);
    }
}
