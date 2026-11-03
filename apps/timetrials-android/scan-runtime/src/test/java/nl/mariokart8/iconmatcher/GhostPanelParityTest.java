package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assume.assumeTrue;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.zip.GZIPInputStream;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java Select-a-Ghost picker against Python's decisions on the recorded vectors
 * (tooling/recognition/ghost_select_parity_vectors.py). Private inputs stay outside Git:
 * MK8DX_SHARED_ICON_PACK (the pack's tensor-pack) and MK8DX_GHOST_SELECT_VECTORS.
 */
public class GhostPanelParityTest {
    @Test
    public void javaPickerEqualsPythonOnTheRecordedCrops() throws Exception {
        String packPath = System.getenv("MK8DX_SHARED_ICON_PACK");
        String vectorsPath = System.getenv("MK8DX_GHOST_SELECT_VECTORS");
        assumeTrue("private Select-a-Ghost vectors not configured", packPath != null && vectorsPath != null);
        Path packDir = Paths.get(packPath);
        Path dir = Paths.get(vectorsPath);
        ReferencePack pack = new ReferencePack(name -> Files.readAllBytes(packDir.resolve(name)),
                GhostPanel.References.GROUP_KEYS);
        JSONObject index = json(dir.resolve("index.json"));
        assertEquals(index.getString("catalogSha256"), pack.catalogSha256);
        GhostPanel.References refs = GhostPanel.References.fromPack(pack, json(dir.resolve("part-names-v1.json")));
        List<String> differences = new ArrayList<>();
        int compared = 0;
        int[] misses = {0};
        double worst = 0;
        JSONArray vectors = index.getJSONArray("vectors");
        for (int v = 0; v < vectors.length(); v++) {
            JSONObject vector = vectors.getJSONObject(v);
            if (!vector.optBoolean("crops")) continue;
            String name = vector.getString("name");
            JSONObject description = json(dir.resolve(name + ".description.json"));
            JSONObject want = json(dir.resolve(name + ".decision.json"));
            JSONObject cropIndex = json(dir.resolve(name + ".crops.json"));
            byte[] blob = gunzip(dir.resolve(name + ".crops.bin.gz"));
            GhostPanel.CropSource source = (field, dx, dy, scale, width, height) -> {
                JSONArray entry = cropIndex.optJSONArray(field + "|" + dx + "|" + dy + "|"
                        + String.format(Locale.ROOT, "%.2f", scale));
                if (entry == null) {
                    misses[0]++;
                    return null;
                }
                int offset = entry.optInt(0);
                if (entry.optInt(1) != width || entry.optInt(2) != height) throw new IllegalStateException("crop size");
                float[] out = new float[width * height * 3];
                for (int i = 0; i < out.length; i++) out[i] = (blob[offset + i] & 0xff) / 255f;
                return out;
            };
            JSONObject got = GhostPanel.decideFrame(description, source, refs, want.getString("fieldSemanticsVersion"));
            compared++;
            JSONArray wantFields = want.getJSONArray("fields"), gotFields = got.getJSONArray("fields");
            for (int i = 0; i < wantFields.length(); i++) {
                JSONObject w = wantFields.getJSONObject(i), g = gotFields.getJSONObject(i);
                for (String key : new String[]{"field", "selectedId", "acceptedId", "basis"}) {
                    if (!String.valueOf(w.opt(key)).equals(String.valueOf(g.opt(key)))) {
                        differences.add(name + " " + w.getString("field") + "." + key + " java=" + g.opt(key) + " py=" + w.opt(key));
                    }
                }
                double delta = Math.abs(w.getDouble("score") - g.getDouble("score"));
                worst = Math.max(worst, delta);
                if (delta > 2e-4) differences.add(name + " " + w.getString("field") + ".score");
                if (!ids(w).equals(ids(g))) differences.add(name + " " + w.getString("field") + ".alternatives");
                JSONObject we = w.optJSONObject("evidence"), ge = g.optJSONObject("evidence");
                if (we != null && ge != null && !String.valueOf(we.opt("offset")).equals(String.valueOf(ge.opt("offset")))) {
                    differences.add(name + " " + w.getString("field") + ".offset");
                }
            }
        }
        System.out.println("ghost picker parity vectors=" + compared + " differences=" + differences.size()
                + " cropMisses=" + misses[0] + " maxScoreDelta=" + worst);
        for (String line : differences.subList(0, Math.min(12, differences.size()))) System.out.println("  " + line);
        assertEquals(0, differences.size());
    }

    private static String ids(JSONObject field) throws Exception {
        StringBuilder out = new StringBuilder();
        JSONArray alternatives = field.getJSONArray("alternatives");
        for (int i = 0; i < alternatives.length(); i++) out.append(alternatives.getJSONObject(i).getString("id")).append(',');
        return out.toString();
    }

    private static JSONObject json(Path path) throws Exception {
        return new JSONObject(new String(Files.readAllBytes(path), "UTF-8"));
    }

    private static byte[] gunzip(Path path) throws Exception {
        try (InputStream in = new GZIPInputStream(Files.newInputStream(path))) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[1 << 16];
            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }
}
