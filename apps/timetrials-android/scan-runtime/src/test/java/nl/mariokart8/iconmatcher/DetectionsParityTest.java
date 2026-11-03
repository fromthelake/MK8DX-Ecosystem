package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The Java detector post-processing against Python's records (packages/icon-matcher/vectors/detections-v1.json). */
public class DetectionsParityTest {
    private static File vectors() {
        File dir = new File("").getAbsoluteFile();
        while (dir != null) {
            File candidate = new File(dir, "packages/icon-matcher/vectors/detections-v1.json");
            if (candidate.isFile()) return candidate;
            dir = dir.getParentFile();
        }
        throw new IllegalStateException("detections-v1.json not found");
    }

    private static float[] floats(JSONArray array) throws Exception {
        float[] out = new float[array.length()];
        for (int i = 0; i < out.length; i++) out[i] = (float) array.getDouble(i);
        return out;
    }

    private static boolean same(Detections.Box got, JSONObject want) throws Exception {
        return got.label.equals(want.getString("label")) && got.score == (float) want.getDouble("score")
            && got.left == (float) want.getDouble("left") && got.top == (float) want.getDouble("top")
            && got.right == (float) want.getDouble("right") && got.bottom == (float) want.getDouble("bottom");
    }

    @Test
    public void javaDetectionsEqualPython() throws Exception {
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(vectors().toPath()), "UTF-8"));
        int differences = 0;
        JSONArray raw = doc.getJSONArray("raw");
        for (int i = 0; i < raw.length(); i++) {
            JSONObject c = raw.getJSONObject(i);
            List<Detections.Box> got = Detections.parse(floats(c.getJSONArray("boxes")), floats(c.getJSONArray("logits")),
                c.getInt("count"), c.getInt("numClasses"), c.getInt("width"), c.getInt("height"));
            JSONArray want = c.getJSONArray("result");
            boolean ok = got.size() == want.length();
            for (int k = 0; ok && k < got.size(); k++) ok = same(got.get(k), want.getJSONObject(k));
            if (!ok && ++differences <= 3) System.out.println("raw differs " + i);
        }
        JSONArray layouts = doc.getJSONArray("layouts");
        for (int i = 0; i < layouts.length(); i++) {
            JSONObject c = layouts.getJSONObject(i);
            JSONArray raws = c.getJSONArray("detections");
            List<Detections.Box> boxes = new ArrayList<>();
            for (int k = 0; k < raws.length(); k++) {
                JSONObject d = raws.getJSONObject(k);
                boxes.add(new Detections.Box(d.getString("label"), (float) d.getDouble("score"), (float) d.getDouble("left"),
                    (float) d.getDouble("top"), (float) d.getDouble("right"), (float) d.getDouble("bottom")));
            }
            List<Detections.Box> kept = Detections.cleanLapIndex(boxes);
            JSONArray want = c.getJSONArray("result");
            boolean ok = kept.size() == want.length();
            for (int k = 0; ok && k < kept.size(); k++) ok = boxes.indexOf(kept.get(k)) == want.getInt(k);
            if (!ok && ++differences <= 5) System.out.println("layout differs " + i);
        }
        System.out.println("detections parity raw=" + raw.length() + " layouts=" + layouts.length() + " differences=" + differences);
        assertEquals(0, differences);
    }
}
