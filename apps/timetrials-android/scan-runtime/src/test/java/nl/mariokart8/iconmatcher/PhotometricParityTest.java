package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java photometric correction against Python records (packages/icon-matcher photometric).
 *
 * Private inputs stay outside Git: MK8DX_CARD_ANCHORS, MK8DX_CARD_PHOTOMETRY and
 * MK8DX_PHOTOMETRIC_BUNDLE (bundle.json with regions/, written by
 * tooling/recognition/export_photometric_vectors.py). Without them only the synthetic card runs.
 */
public class PhotometricParityTest {
    private static final int[] DISC = {60, 61, 57};
    private static final int[] DIGIT = {237, 237, 237};
    private static final int[] CARD = {200, 190, 40};

    private static byte[] circle(int k) {
        byte[] out = new byte[33 * 33 * 3];
        for (int y = 0; y < 33; y++) {
            for (int x = 0; x < 33; x++) {
                int[] rgb = (x - 16) * (x - 16) + (y - 16) * (y - 16) <= 14 * 14 ? DISC : CARD;
                for (int bar = 0; bar < k; bar++) {
                    if (y >= 9 && y < 24 && x >= 12 + 4 * bar && x < 14 + 4 * bar) rgb = DIGIT;
                }
                for (int c = 0; c < 3; c++) out[(y * 33 + x) * 3 + c] = (byte) rgb[c];
            }
        }
        return out;
    }

    private static byte[] card() {
        byte[] rgb = new byte[1280 * 720 * 3];
        for (int i = 0; i < 1280 * 720; i++) {
            for (int c = 0; c < 3; c++) rgb[i * 3 + c] = (byte) CARD[c];
        }
        for (int k = 1; k <= 3; k++) {
            byte[] tpl = circle(k);
            int x = 1016;
            int y = 206 + (k - 1) * 44;
            for (int r = 0; r < 33; r++) System.arraycopy(tpl, r * 99, rgb, ((y + r) * 1280 + x) * 3, 99);
        }
        return rgb;
    }

    @Test
    public void aDarkenedCoolPhotoReturnsToTheHdmiColours() throws Exception {
        JSONArray player = new JSONArray();
        for (int k = 1; k <= 3; k++) player.put(Base64.getEncoder().encodeToString(circle(k)));
        CardPresence anchors = new CardPresence(new JSONObject().put("schema", "mk8dx.card-anchors.v1")
                .put("x", 1018).put("size", 33).put("search", 3).put("threshold", 0.5)
                .put("pitch", new JSONObject().put("3", 44)).put("slots", new JSONObject().put("3", new JSONObject().put("top", 208)))
                .put("offsets", new JSONArray().put(0)).put("templates", new JSONObject().put("player", player)), null);
        Photometric photometry = new Photometric(new JSONObject().put("schema", "mk8dx.card-photometry.v1")
                .put("layouts", new JSONObject().put("3", new JSONObject()
                        .put("fromCharacter", new JSONArray().put(446.5).put(66.5)).put("pitch", 44)
                        .put("disc", new JSONArray().put(60).put(61).put(57)).put("digit", new JSONArray().put(237).put(237).put(237)))), null);
        byte[] hdmi = card();
        byte[] photo = new byte[hdmi.length];
        double[] wb = {0.9, 1.0, 1.15};
        for (int i = 0; i < hdmi.length; i++) {
            photo[i] = (byte) Math.max(0, Math.min(255, (int) Math.floor((hdmi[i] & 0xff) * 0.62 * wb[i % 3] + 14 + 0.5)));
        }
        JSONObject record = photometry.record(photo, 1280, 720, 570, 140, 3, "player", anchors, null);
        assertEquals("corrected", record.getString("status"));
        byte[] corrected = Photometric.apply(photo, record);
        int worst = 0;
        for (int i = 0; i < hdmi.length; i++) worst = Math.max(worst, Math.abs((corrected[i] & 0xff) - (hdmi[i] & 0xff)));
        assertTrue("worst " + worst, worst <= 2);
        JSONObject same = photometry.record(hdmi, 1280, 720, 570, 140, 3, "player", anchors, null);
        byte[] unchanged = Photometric.apply(hdmi, same);
        assertTrue(java.util.Arrays.equals(unchanged, hdmi));
    }

    @Test
    public void aClippedBlueWhiteKeepsNlAndLuUnderReview() throws Exception {
        JSONObject read = new JSONObject().put("schema", "mk8dx.visual-field-read.v1").put("kind", "flags")
                .put("profile", "result").put("status", "accepted").put("acceptedId", "country.nl").put("top1Id", "country.nl")
                .put("cropPixelSha256", "c").put("catalogSha256", "k").put("score", .95)
                .put("top", new JSONArray().put(new JSONObject().put("id", "country.nl").put("familyId", "country.nl").put("score", .95))
                        .put(new JSONObject().put("id", "country.lu").put("familyId", "country.lu").put("score", .9)));
        JSONObject owner = new JSONObject().put("flag", new JSONObject().put("shared_icon_qa", read));
        assertEquals("country.nl", ResultProposal.compose(owner).getJSONObject("fields").getJSONObject("flag").getString("acceptedId"));
        read.put("photometric_qa", new JSONObject().put("schema", "mk8dx.card-photometric.v1").put("status", "corrected").put("blueClipped", true));
        JSONObject flag = ResultProposal.compose(owner).getJSONObject("fields").getJSONObject("flag");
        assertTrue(flag.isNull("acceptedId"));
        assertEquals("country.nl", flag.getString("selectedId"));
        assertTrue(flag.getJSONArray("evidence").toString().contains("photometric_blue_clipped"));
    }

    @Test
    public void javaEqualsPythonOnRealPhotos() throws Exception {
        String a = System.getenv("MK8DX_CARD_ANCHORS");
        String p = System.getenv("MK8DX_CARD_PHOTOMETRY");
        String b = System.getenv("MK8DX_PHOTOMETRIC_BUNDLE");
        assumeTrue("private photometric bundle not configured", a != null && p != null && b != null);
        CardPresence anchors = new CardPresence(Files.readAllBytes(Paths.get(a)));
        Photometric photometry = new Photometric(Files.readAllBytes(Paths.get(p)));
        Path dir = Paths.get(b);
        JSONObject bundle = new JSONObject(new String(Files.readAllBytes(dir.resolve("bundle.json")), "UTF-8"));
        assertEquals(bundle.getString("anchorsSha256"), anchors.sha256);
        assertEquals(bundle.getString("photometrySha256"), photometry.sha256);
        List<String> differences = new ArrayList<>();
        double worst = 0;
        JSONArray cases = bundle.getJSONArray("cases");
        for (int n = 0; n < cases.length(); n++) {
            JSONObject item = cases.getJSONObject(n);
            byte[] region = Files.readAllBytes(dir.resolve("regions").resolve(item.getString("region")));
            JSONArray box = item.getJSONArray("box");
            int x0 = box.getInt(0), y0 = box.getInt(1), w = box.getInt(2), h = box.getInt(3);
            byte[] rgb = new byte[1280 * 720 * 3];
            for (int y = 0; y < h; y++) System.arraycopy(region, y * w * 3, rgb, ((y0 + y) * 1280 + x0) * 3, w * 3);
            JSONArray character = item.getJSONArray("character");
            JSONObject measured = photometry.measure(rgb, 1280, 720, character.getDouble(0), character.getDouble(1),
                    item.getInt("laps"), item.getString("owner"), anchors);
            JSONObject correction = photometry.fit(measured, item.getInt("laps"));
            JSONObject wantMeasured = item.getJSONObject("measured");
            JSONObject want = item.getJSONObject("correction");
            boolean same = measured.getString("status").equals(wantMeasured.getString("status"))
                    && correction.getString("status").equals(want.getString("status"));
            if (same && "measured".equals(measured.getString("status"))) {
                for (int c = 0; c < 3; c++) {
                    same &= measured.getJSONArray("disc").getDouble(c) == wantMeasured.getJSONArray("disc").getDouble(c);
                    same &= measured.getJSONArray("digit").getDouble(c) == wantMeasured.getJSONArray("digit").getDouble(c);
                }
                JSONArray got = measured.getJSONArray("circles");
                JSONArray exp = wantMeasured.getJSONArray("circles");
                same &= got.length() == exp.length();
                for (int k = 0; same && k < got.length(); k++) {
                    for (int v = 0; v < 3; v++) {
                        same &= got.getJSONArray(k).getDouble(v) == exp.getJSONArray(k).getDouble(v);
                    }
                }
            }
            if (same && "corrected".equals(correction.getString("status"))) {
                for (int c = 0; c < 3; c++) {
                    worst = Math.max(worst, Math.abs(correction.getJSONArray("gain").getDouble(c) - want.getJSONArray("gain").getDouble(c)));
                    worst = Math.max(worst, Math.abs(correction.getJSONArray("offset").getDouble(c) - want.getJSONArray("offset").getDouble(c)));
                }
                same &= correction.getBoolean("blueClipped") == want.getBoolean("blueClipped");
                same &= hex(MessageDigest.getInstance("SHA-256").digest(Photometric.apply(region, correction)))
                        .equals(item.getString("correctedSha256"));
            }
            if (!same) differences.add(item.getString("region") + "|" + item.getString("owner"));
        }
        System.out.println("photometric parity: cases=" + cases.length() + " differences=" + differences.size() + " maxDelta=" + worst);
        assertTrue(differences.toString(), differences.isEmpty());
        assertTrue("delta " + worst, worst < 1e-9);
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte v : bytes) out.append(String.format(Locale.ROOT, "%02x", v));
        return out.toString();
    }
}
