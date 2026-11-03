package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java card presence against Python records (packages/icon-matcher card_presence).
 *
 * Private inputs stay outside Git: set MK8DX_CARD_ANCHORS (card-anchors-v1.json) and
 * MK8DX_CARD_PRESENCE_BUNDLE (bundle.json with columns/), written by
 * tooling/recognition/export_card_presence_vectors.py. Without them only the
 * synthetic screen runs.
 */
public class CardPresenceParityTest {
    private static byte[] circle(int k) {
        byte[] out = new byte[33 * 33 * 3];
        for (int y = 0; y < 33; y++) {
            for (int x = 0; x < 33; x++) {
                boolean inside = (x - 16) * (x - 16) + (y - 16) * (y - 16) <= 14 * 14;
                int[] rgb = inside ? new int[]{48, 50, 56} : new int[]{92, 92, 98};
                for (int bar = 0; bar < k; bar++) {
                    if (y >= 9 && y < 24 && x >= 12 + 4 * bar && x < 14 + 4 * bar) rgb = new int[]{245, 245, 245};
                }
                for (int c = 0; c < 3; c++) out[(y * 33 + x) * 3 + c] = (byte) rgb[c];
            }
        }
        return out;
    }

    private static byte[] screen(int[] circles, int y, int pitch) {
        byte[] rgb = new byte[1280 * 720 * 3];
        for (int r = 0; r < 720; r++) {
            for (int c = 0; c < 1280; c++) {
                int i = (r * 1280 + c) * 3;
                rgb[i] = (byte) ((c * 7 + r * 13) % 60 + 120);
                rgb[i + 1] = (byte) ((c * 11 + r * 5) % 50 + 110);
                rgb[i + 2] = (byte) ((c * 3 + r * 17) % 40 + 130);
            }
        }
        for (int k : circles) {
            byte[] tpl = circle(k);
            int top = y + (k - 1) * pitch;
            for (int r = 0; r < 33; r++) System.arraycopy(tpl, r * 99, rgb, ((top + r) * 1280 + 1018) * 3, 99);
        }
        return rgb;
    }

    @Test
    public void threeCirclesAtASlotAreACard() throws Exception {
        JSONArray ghost = new JSONArray();
        for (int k = 1; k <= 3; k++) ghost.put(Base64.getEncoder().encodeToString(circle(k)));
        CardPresence anchors = new CardPresence(new JSONObject().put("schema", "mk8dx.card-anchors.v1")
                .put("x", 1018).put("size", 33).put("search", 3).put("threshold", 0.5)
                .put("pitch", new JSONObject().put("3", 44).put("7", 32))
                .put("slots", new JSONObject().put("3", new JSONObject().put("top", 208).put("bottom", 441))
                        .put("7", new JSONObject().put("top", 122).put("bottom", 424)))
                .put("offsets", new JSONArray().put(0).put(-30))
                .put("templates", new JSONObject().put("ghost", ghost)), null);
        JSONObject got = anchors.presence(screen(new int[]{1, 2, 3}, 208, 44), 1280, 720, "ghost", 3, null);
        assertTrue(got.getBoolean("present"));
        assertEquals("top", got.getString("slot"));
        assertFalse(anchors.presence(screen(new int[]{1}, 208, 44), 1280, 720, "ghost", 3, null).getBoolean("present"));
        assertFalse(anchors.presence(screen(new int[]{1, 2, 3}, 208, 44), 1280, 720, "ghost", 3, "top").getBoolean("present"));
        JSONObject seven = anchors.presence(screen(new int[]{1, 2, 3}, 394, 32), 1280, 720, "ghost", 7, null);
        assertEquals("bottom", seven.getString("slot"));
        assertEquals(-30, seven.getJSONObject("best").getInt("offset"));
    }

    @Test
    public void javaEqualsPythonOnRealColumns() throws Exception {
        String anchorsPath = System.getenv("MK8DX_CARD_ANCHORS");
        String bundlePath = System.getenv("MK8DX_CARD_PRESENCE_BUNDLE");
        assumeTrue("private card-presence bundle not configured", anchorsPath != null && bundlePath != null);
        CardPresence anchors = new CardPresence(Files.readAllBytes(Paths.get(anchorsPath)));
        Path dir = Paths.get(bundlePath);
        JSONObject bundle = new JSONObject(new String(Files.readAllBytes(dir.resolve("bundle.json")), "UTF-8"));
        assertEquals(bundle.getString("anchorsSha256"), anchors.sha256);
        int x0 = bundle.getJSONArray("columnX").getInt(0);
        int x1 = bundle.getJSONArray("columnX").getInt(1);
        Map<String, byte[]> screens = new HashMap<>();
        List<String> differences = new ArrayList<>();
        double worst = 0;
        JSONArray cases = bundle.getJSONArray("cases");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject item = cases.getJSONObject(i);
            String name = item.getString("column");
            byte[] rgb = screens.get(name);
            if (rgb == null) {
                byte[] column = Files.readAllBytes(dir.resolve("columns").resolve(name));
                rgb = new byte[1280 * 720 * 3];
                int w = (x1 - x0) * 3;
                for (int y = 0; y < 720; y++) System.arraycopy(column, y * w, rgb, (y * 1280 + x0) * 3, w);
                screens.put(name, rgb);
            }
            JSONObject got = anchors.presence(rgb, 1280, 720, item.getString("owner"), item.getInt("lapCount"),
                    item.isNull("excludeSlot") ? null : item.getString("excludeSlot"));
            JSONObject want = item.getJSONObject("expected");
            boolean same = got.getBoolean("present") == want.getBoolean("present")
                    && String.valueOf(got.opt("slot")).equals(String.valueOf(want.opt("slot")))
                    && String.valueOf(got.opt("circleY")).equals(String.valueOf(want.opt("circleY")))
                    && got.getJSONObject("best").getString("slot").equals(want.getJSONObject("best").getString("slot"))
                    && got.getJSONObject("best").getInt("offset") == want.getJSONObject("best").getInt("offset");
            JSONArray a = got.getJSONObject("best").getJSONArray("scores");
            JSONArray b = want.getJSONObject("best").getJSONArray("scores");
            for (int k = 0; k < b.length(); k++) worst = Math.max(worst, Math.abs(a.getDouble(k) - b.getDouble(k)));
            if (!same) differences.add(name + "|" + item.getString("owner") + "|" + item.getInt("lapCount"));
        }
        System.out.println("card presence parity: cases=" + cases.length() + " differences=" + differences.size()
                + " maxScoreDelta=" + worst);
        assertTrue(differences.toString(), differences.isEmpty());
        assertTrue("score delta " + worst, worst < 1e-9);
    }
}
