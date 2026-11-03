package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;

import java.io.File;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The Java card ROI selection against Python's records (packages/icon-matcher/vectors/card-roi-v1.json). */
public class CardRoiParityTest {
    private static File vectors() {
        File dir = new File("").getAbsoluteFile();
        while (dir != null) {
            File candidate = new File(dir, "packages/icon-matcher/vectors/card-roi-v1.json");
            if (candidate.isFile()) return candidate;
            dir = dir.getParentFile();
        }
        throw new IllegalStateException("card-roi-v1.json not found");
    }

    private static List<CardRoi.Detection> detections(JSONArray raw) throws Exception {
        List<CardRoi.Detection> out = new ArrayList<>();
        for (int i = 0; i < raw.length(); i++) {
            JSONObject d = raw.getJSONObject(i);
            out.add(new CardRoi.Detection(d.getString("label"), (float) d.getDouble("score"), (float) d.getDouble("left"),
                (float) d.getDouble("top"), (float) d.getDouble("right"), (float) d.getDouble("bottom")));
        }
        return out;
    }

    private static boolean sameBox(CardRoi.Box got, Object want) throws Exception {
        if (want == null || JSONObject.NULL.equals(want)) return got == null;
        if (got == null) return false;
        JSONArray w = (JSONArray) want;
        return got.left == (float) w.getDouble(0) && got.top == (float) w.getDouble(1)
            && got.right == (float) w.getDouble(2) && got.bottom == (float) w.getDouble(3);
    }

    private static boolean sameValue(Object got, Object want) throws Exception {
        if (got instanceof CardRoi.Box || got == null) return sameBox((CardRoi.Box) got, want);
        if (got instanceof Boolean || got instanceof String) return got.equals(want);
        if (got instanceof Number) return ((Number) got).doubleValue() == ((Number) want).doubleValue();
        return false;
    }

    private static String diff(CardRoi.Selection got, Object wantObject) throws Exception {
        if (wantObject == null || JSONObject.NULL.equals(wantObject)) return got == null ? null : "unexpected selection";
        if (got == null) return "missing selection";
        JSONObject want = (JSONObject) wantObject;
        if (!got.status.equals(want.getString("status")) || !got.reason.equals(want.getString("reason"))
            || !got.selectedReason.equals(want.getString("selectedReason"))) return "status " + got.status;
        JSONObject counts = want.getJSONObject("counts");
        if (got.counts.candidateCount != counts.getInt("candidateCount") || got.counts.playerCount != counts.getInt("playerCount")
            || got.counts.ghostCount != counts.getInt("ghostCount") || got.counts.lapIndexCount != counts.getInt("lapIndexCount")) return "counts";
        if (!sameBox(got.roi, want.opt("roi"))) return "roi";
        if (!sameBox(got.playerOwnerBox, want.opt("playerOwnerBox")) || !sameBox(got.ghostOwnerBox, want.opt("ghostOwnerBox"))) return "owner boxes";
        Object candidate = want.opt("candidate");
        if (candidate == null || JSONObject.NULL.equals(candidate)) return got.candidate == null ? null : "unexpected candidate";
        JSONObject wc = (JSONObject) candidate;
        for (Iterator<String> it = wc.keys(); it.hasNext(); ) {
            String key = it.next();
            Field field = CardRoi.Candidate.class.getField(key);
            if (!sameValue(field.get(got.candidate), wc.opt(key))) return "candidate." + key + " " + field.get(got.candidate) + " vs " + wc.opt(key);
        }
        return null;
    }

    @Test
    public void javaCardRoiEqualsPython() throws Exception {
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(vectors().toPath()), "UTF-8"));
        int differences = 0;
        JSONArray ends = doc.getJSONArray("endScreens");
        for (int i = 0; i < ends.length(); i++) {
            JSONObject c = ends.getJSONObject(i);
            List<CardRoi.Detection> dets = detections(c.getJSONArray("detections"));
            List<CardRoi.Box> refs = new ArrayList<>();
            JSONArray yellow = c.getJSONArray("yellow");
            for (int k = 0; k < yellow.length(); k++) {
                JSONArray r = yellow.getJSONArray(k);
                refs.add(new CardRoi.Box((float) r.getDouble(0), (float) r.getDouble(1), (float) r.getDouble(2), (float) r.getDouble(3)));
            }
            int w = c.getInt("width");
            int h = c.getInt("height");
            String d1 = diff(CardRoi.select(dets, w, h, refs), c.opt("select"));
            String d2 = diff(CardRoi.selectSparseDualYellowCandidate(dets, w, h, refs), c.opt("sparse"));
            if ((d1 != null || d2 != null) && ++differences <= 5) System.out.println("end " + i + " " + d1 + " / " + d2);
        }
        JSONArray ghosts = doc.getJSONArray("ghostDetails");
        for (int i = 0; i < ghosts.length(); i++) {
            JSONObject c = ghosts.getJSONObject(i);
            String d = diff(CardRoi.selectGhostDetail(detections(c.getJSONArray("detections")), c.getInt("width"), c.getInt("height")),
                c.opt("selectGhostDetail"));
            if (d != null && ++differences <= 5) System.out.println("ghost " + i + " " + d);
        }
        System.out.println("card roi parity end=" + ends.length() + " ghost=" + ghosts.length() + " differences=" + differences);
        assertEquals(0, differences);
    }
}
