package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java geometry before the crop (CanonicalWarp) against the Python reference on public vectors
 * (packages/icon-matcher/vectors/canonical-warp-v1.json, written by
 * packages/icon-matcher/tools/generate_canonical_warp_vectors.py; issue #99 phase 5): the constants, the
 * step functions and whole cards, double for double; real cards must also equal what the Web scanner
 * computed on the public test set.
 */
public class CanonicalWarpParityTest {
    static final String PUBLIC_VECTORS = "../../../packages/icon-matcher/vectors/canonical-warp-v1.json";

    private static JSONObject doc() throws Exception {
        return new JSONObject(new String(Files.readAllBytes(Paths.get(PUBLIC_VECTORS)), StandardCharsets.UTF_8));
    }

    private static double[] doubles(Object raw) throws Exception {
        if (raw == null || raw == JSONObject.NULL) return null;
        JSONArray a = (JSONArray) raw;
        double[] out = new double[a.length()];
        for (int i = 0; i < out.length; i++) out[i] = a.getDouble(i);
        return out;
    }

    private static int[] ints(Object raw) throws Exception {
        JSONArray a = (JSONArray) raw;
        int[] out = new int[a.length()];
        for (int i = 0; i < out.length; i++) out[i] = a.getInt(i);
        return out;
    }

    private static double[][] quad(Object raw) throws Exception {
        JSONArray a = (JSONArray) raw;
        double[][] out = new double[a.length()][];
        for (int i = 0; i < out.length; i++) out[i] = doubles(a.get(i));
        return out;
    }

    /** A Java value against the JSON value Python recorded (numbers compared as doubles, exactly). */
    private static boolean matches(Object got, Object want) throws Exception {
        if (got == null || want == JSONObject.NULL) return got == null && want == JSONObject.NULL;
        if (got instanceof int[]) {
            int[] g = (int[]) got;
            double[] d = new double[g.length];
            for (int i = 0; i < g.length; i++) d[i] = g[i];
            got = d;
        }
        if (got instanceof double[]) {
            if (!(want instanceof JSONArray)) return false;
            double[] g = (double[]) got;
            JSONArray w = (JSONArray) want;
            if (w.length() != g.length) return false;
            for (int i = 0; i < g.length; i++) if (g[i] != w.getDouble(i)) return false;
            return true;
        }
        if (got instanceof double[][]) {
            double[][] g = (double[][]) got;
            if (!(want instanceof JSONArray) || ((JSONArray) want).length() != g.length) return false;
            for (int i = 0; i < g.length; i++) if (!matches(g[i], ((JSONArray) want).get(i))) return false;
            return true;
        }
        if (got instanceof CanonicalWarp.Target) {
            CanonicalWarp.Target t = (CanonicalWarp.Target) got;
            JSONObject w = (JSONObject) want;
            return w.length() == 2 && t.source.equals(w.getString("source")) && matches(t.box, w.get("box"));
        }
        if (got instanceof CanonicalWarp.AntialiasPlan) {
            CanonicalWarp.AntialiasPlan p = (CanonicalWarp.AntialiasPlan) got;
            JSONObject w = (JSONObject) want;
            return w.length() == 4 && p.factor == w.getDouble("factor") && p.reducedW == w.getInt("reducedW")
                && p.reducedH == w.getInt("reducedH") && matches(p.unscale, w.get("unscale"));
        }
        return false;
    }

    private static Object call(String fn, JSONArray a) throws Exception {
        switch (fn) {
            case "boundingRect": return CanonicalWarp.boundingRect(quad(a.get(0)), a.getInt(1), a.getInt(2));
            case "quadFromRect": return CanonicalWarp.quadFromRect(ints(a.get(0)));
            case "shiftedQuad": return CanonicalWarp.shiftedQuad(quad(a.get(0)), a.getDouble(1), a.getDouble(2));
            case "quadBox": return CanonicalWarp.quadBox(quad(a.get(0)));
            case "contentExtent": return CanonicalWarp.contentExtent(a.isNull(0) ? null : a.getJSONObject(0));
            case "targetBox": return CanonicalWarp.targetBox(a.getString(0), a.getString(1), a.getBoolean(2),
                doubles(a.get(3)), doubles(a.get(4)));
            case "canonicalAlign": return CanonicalWarp.canonicalAlign(doubles(a.get(0)), doubles(a.get(1)));
            case "alignMatrix": return CanonicalWarp.alignMatrix(doubles(a.get(0)));
            case "compose": return CanonicalWarp.compose(doubles(a.get(0)), doubles(a.get(1)));
            case "antialiasPlan": return CanonicalWarp.antialiasPlan(doubles(a.get(0)), a.getInt(1), a.getInt(2));
            default: throw new IllegalArgumentException("unknown helper " + fn);
        }
    }

    private static CanonicalWarp.Result transform(JSONObject c) throws Exception {
        JSONArray frame = c.getJSONArray("frame");
        return CanonicalWarp.canonicalTransform(frame.getInt(0), frame.getInt(1), quad(c.get("quad")), c.getString("seed"),
            doubles(c.get("deskewRoi")), c.getString("owner"), c.getString("raceKey"), c.getBoolean("ghostDetail"),
            doubles(c.get("race3Content")), doubles(c.get("race7Content")), doubles(c.get("homography")),
            doubles(c.get("registration")));
    }

    private static boolean same(CanonicalWarp.Result got, JSONObject want) throws Exception {
        return matches(got.bounds, want.get("bounds")) && matches(got.destination, want.get("destination"))
            && matches(got.currentBox, want.get("currentBox")) && matches(got.target, want.get("target"))
            && matches(got.align, want.get("align")) && matches(got.affine, want.get("affine"))
            && matches(got.composed, want.get("composed")) && matches(got.antialias, want.get("antialias"))
            && matches(got.fin, want.get("final")) && matches(got.warpSource, want.get("warpSource"));
    }

    @Test
    public void constantsAreTheVectors() throws Exception {
        JSONObject want = doc().getJSONObject("constants");
        assertEquals(8, want.length());
        assertTrue(matches(new int[]{CanonicalWarp.CANONICAL_W, CanonicalWarp.CANONICAL_H}, want.get("canonicalSize")));
        assertTrue(matches(CanonicalWarp.playerBoxRace7(), want.get("playerBoxRace7")));
        assertTrue(matches(CanonicalWarp.ghostBoxRace7(), want.get("ghostBoxRace7")));
        assertTrue(matches(CanonicalWarp.ghostDetailBoxRace3(), want.get("ghostDetailBoxRace3")));
        assertTrue(matches(CanonicalWarp.ghostDetailBoxRace7(), want.get("ghostDetailBoxRace7")));
        assertEquals(want.getDouble("antialiasBelowScale"), CanonicalWarp.ANTIALIAS_BELOW_SCALE, 0.0);
        assertEquals(want.getDouble("antialiasTargetScale"), CanonicalWarp.ANTIALIAS_TARGET_SCALE, 0.0);
        JSONArray keys = want.getJSONArray("contentKeys");
        String[] got = CanonicalWarp.contentKeys();
        assertEquals(keys.length(), got.length);
        for (int i = 0; i < got.length; i++) assertEquals(keys.getString(i), got[i]);
    }

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
        System.out.println("canonical warp helpers=" + cases.length() + " differences=" + failures.size());
        assertTrue("helper cases", cases.length() >= 30);
        assertEquals("differences: " + failures, 0, failures.size());
    }

    @Test
    public void javaCanonicalWarpEqualsPython() throws Exception {
        JSONObject doc = doc();
        assertEquals("mk8dx.canonical-warp-vectors.v1", doc.getString("schema"));
        JSONArray cases = doc.getJSONArray("cases");
        List<String> failures = new ArrayList<>();
        int real = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject item = cases.getJSONObject(i);
            CanonicalWarp.Result got = transform(item);
            boolean ok = same(got, item.getJSONObject("expected"));
            if (!"synthetic".equals(item.getString("source"))) {
                real++;
                JSONObject web = item.getJSONObject("web");
                ok = ok && matches(got.destination, web.get("destination")) && matches(got.affine, web.get("affine"))
                    && matches(got.composed, web.get("composed")) && matches(got.fin, web.get("final"))
                    && matches(got.warpSource, web.get("warpSource"));
            }
            if (!ok) failures.add(item.getString("name"));
        }
        System.out.println("canonical warp parity cases=" + cases.length() + " real=" + real + " differences=" + failures.size());
        assertTrue("cases replayed", cases.length() >= 20 && real > 0);
        assertEquals("differences: " + failures, 0, failures.size());
    }
}
