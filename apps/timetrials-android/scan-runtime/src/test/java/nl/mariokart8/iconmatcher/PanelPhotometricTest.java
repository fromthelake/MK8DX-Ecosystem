package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Same synthetic panels as python/tests/test_panel_photometric.py and ts/sharedPanelPhotometric.test.mjs. */
public class PanelPhotometricTest {
    private static byte[] panelImage(double gain, double offset, boolean noise) {
        byte[] rgb = new byte[1280 * 720 * 3];
        double[] value = new double[3];
        for (int y = 0; y < 720; y++) {
            for (int x = 0; x < 1280; x++) {
                for (int c = 0; c < 3; c++) value[c] = (x * 7 + y * 13 + c * 29) % 200 + 20;
                for (PanelPhotometric.Element e : PanelPhotometric.ELEMENTS) {
                    if (x >= e.box[0] && x < e.box[2] && y >= e.box[1] && y < e.box[3]) {
                        for (int c = 0; c < 3; c++) value[c] = e.hdmi[c];
                    }
                }
                for (int c = 0; c < 3; c++) {
                    double v = value[c] * gain + offset;
                    if (noise) v += (x * 7 + y * 13 + c * 29) % 11 - 5;
                    rgb[(y * 1280 + x) * 3 + c] = (byte) Math.max(0, Math.min(255, (int) Math.floor(v + 0.5)));
                }
            }
        }
        return rgb;
    }

    private static Path document() {
        for (Path dir = Paths.get("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
            Path candidate = dir.resolve("packages/icon-matcher/python/mk8dx_icon_matcher/references/panel-photometry-v1.json");
            if (Files.exists(candidate)) return candidate;
        }
        throw new IllegalStateException("panel-photometry-v1.json not found");
    }

    @Test
    public void theConstantsEqualTheReferenceDocument() throws Exception {
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(document()), StandardCharsets.UTF_8));
        assertEquals("mk8dx.panel-photometry.v1", doc.getString("schema"));
        JSONArray elements = doc.getJSONArray("elements");
        assertEquals(PanelPhotometric.ELEMENTS.length, elements.length());
        for (int i = 0; i < elements.length(); i++) {
            JSONObject e = elements.getJSONObject(i);
            PanelPhotometric.Element mine = PanelPhotometric.ELEMENTS[i];
            assertEquals(e.getString("name"), mine.name);
            assertEquals(e.getString("kind"), mine.kind);
            assertEquals(e.getDouble("fraction"), mine.fraction, 0);
            for (int k = 0; k < 4; k++) assertEquals(e.getJSONArray("box").getInt(k), mine.box[k]);
            for (int c = 0; c < 3; c++) assertEquals(e.getJSONArray("hdmi").getDouble(c), mine.hdmi[c], 0);
        }
    }

    @Test
    public void aFlatPhotoIsLeftAlone() throws Exception {
        JSONObject record = PanelPhotometric.record(panelImage(0.1, 100, false), 1280, 720);
        assertEquals("not_corrected", record.getString("status"));
        assertEquals("anchor_span", record.getString("reason"));
    }

    @Test
    public void parityVector() throws Exception {
        JSONObject record = PanelPhotometric.record(panelImage(0.7, 25, true), 1280, 720);
        assertEquals("corrected", record.getString("status"));
        double[] gain = new double[3];
        double[] offset = new double[3];
        for (int c = 0; c < 3; c++) {
            gain[c] = Math.round(record.getJSONArray("gain").getDouble(c) * 1e6) / 1e6;
            offset[c] = Math.round(record.getJSONArray("offset").getDouble(c) * 1e6) / 1e6;
        }
        assertArrayEquals(new double[]{1.439261, 1.339596, 1.424378}, gain, 0);
        assertArrayEquals(new double[]{-36.344757, -24.484343, -36.657721}, offset, 0);
        assertEquals(2.674, record.getDouble("residual"), 0);
    }
}
