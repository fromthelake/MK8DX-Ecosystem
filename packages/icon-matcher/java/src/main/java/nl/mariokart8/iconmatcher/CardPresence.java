package nl.mariokart8.iconmatcher;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Is an owner's result card at one of the fixed slots? Evidence from lap circles 1, 2, 3.
 * Java counterpart of Python mk8dx_icon_matcher.card_presence and TS sharedCardPresence;
 * the same anchors file (mk8dx.card-anchors.v1) and arithmetic, checked against shared
 * vectors. The screen is the 1280x720 result grid, packed RGB, row-major.
 */
public final class CardPresence {
    public final int x;
    public final int size;
    public final int search;
    public final double threshold;
    public final Map<Integer, Integer> pitch = new HashMap<>();
    /** Per lap count, the slots in file order as {name, y}. */
    public final Map<Integer, List<Object[]>> slots = new HashMap<>();
    public final int[] offsets;
    public final Map<String, double[][]> templates = new HashMap<>();
    /** The circle templates' own RGB bytes (masks for the photometric anchors). */
    public final Map<String, byte[][]> rawTemplates = new HashMap<>();
    public final String sha256;

    public CardPresence(byte[] raw) throws Exception {
        this(new JSONObject(new String(raw, StandardCharsets.UTF_8)), hex(MessageDigest.getInstance("SHA-256").digest(raw)));
    }

    public CardPresence(JSONObject document, String sha256) throws JSONException {
        if (!"mk8dx.card-anchors.v1".equals(document.optString("schema"))) {
            throw new IllegalArgumentException("Expected a mk8dx.card-anchors.v1 document");
        }
        this.sha256 = sha256;
        x = document.getInt("x");
        size = document.getInt("size");
        search = document.getInt("search");
        threshold = document.getDouble("threshold");
        JSONObject pitches = document.getJSONObject("pitch");
        for (Iterator<String> keys = pitches.keys(); keys.hasNext(); ) {
            String key = keys.next();
            pitch.put(Integer.parseInt(key), pitches.getInt(key));
        }
        // Slot order matters (first maximum wins): Python and TS keep the file
        // order top, bottom; org.json does not keep key order, so fix it here.
        JSONObject bySlots = document.getJSONObject("slots");
        for (Iterator<String> keys = bySlots.keys(); keys.hasNext(); ) {
            String laps = keys.next();
            JSONObject named = bySlots.getJSONObject(laps);
            List<Object[]> ordered = new ArrayList<>();
            for (String name : new String[]{"top", "bottom"}) {
                if (named.has(name)) ordered.add(new Object[]{name, named.getInt(name)});
            }
            slots.put(Integer.parseInt(laps), ordered);
        }
        JSONArray offs = document.getJSONArray("offsets");
        offsets = new int[offs.length()];
        for (int i = 0; i < offsets.length; i++) offsets[i] = offs.getInt(i);
        JSONObject owners = document.getJSONObject("templates");
        for (Iterator<String> keys = owners.keys(); keys.hasNext(); ) {
            String owner = keys.next();
            JSONArray circles = owners.getJSONArray(owner);
            double[][] units = new double[circles.length()][];
            byte[][] raws = new byte[circles.length()][];
            for (int k = 0; k < units.length; k++) {
                raws[k] = Base64.getDecoder().decode(circles.getString(k));
                units[k] = unit(raws[k]);
            }
            templates.put(owner, units);
            rawTemplates.put(owner, raws);
        }
    }

    private static double[] unit(byte[] values) {
        double mean = 0;
        for (byte value : values) mean += value & 0xff;
        mean /= values.length;
        double[] out = new double[values.length];
        double norm = 0;
        for (int i = 0; i < values.length; i++) {
            out[i] = (values[i] & 0xff) - mean;
            norm += out[i] * out[i];
        }
        norm = Math.sqrt(norm);
        for (int i = 0; i < out.length; i++) out[i] /= norm;
        return out;
    }

    /** {score, dx, dy} of the best patch; the first maximum in dy-then-dx order wins. */
    public static double[] circleMatch(byte[] rgb, int width, int height, double[] template,
                                       int x, int y, int size, int search) {
        double best = -1;
        int bestDx = 0;
        int bestDy = 0;
        int n = size * size * 3;
        double[] patch = new double[n];
        for (int dy = -search; dy <= search; dy++) {
            for (int dx = -search; dx <= search; dx++) {
                int px = x + dx;
                int py = y + dy;
                if (px < 0 || py < 0 || px + size > width || py + size > height) continue;
                double mean = 0;
                int k = 0;
                for (int row = 0; row < size; row++) {
                    int base = ((py + row) * width + px) * 3;
                    for (int i = 0; i < size * 3; i++) {
                        patch[k] = rgb[base + i] & 0xff;
                        mean += patch[k];
                        k++;
                    }
                }
                mean /= n;
                double dot = 0;
                double norm = 0;
                for (int i = 0; i < n; i++) {
                    double value = patch[i] - mean;
                    dot += template[i] * value;
                    norm += value * value;
                }
                norm = Math.sqrt(norm);
                if (norm < 1e-6) continue;
                double score = dot / norm;
                if (score > best) {
                    best = score;
                    bestDx = dx;
                    bestDy = dy;
                }
            }
        }
        return new double[]{best, bestDx, bestDy};
    }

    /** The mk8dx.card-presence.v1 record (same keys as Python and TS). */
    public JSONObject presence(byte[] rgb, int width, int height, String owner, int lapCount,
                               String excludeSlot) throws JSONException {
        if (rgb.length != width * height * 3) throw new IllegalArgumentException("Expected packed RGB pixels");
        int laps = lapCount == 7 ? 7 : 3;
        double[][] circles = templates.get(owner);
        JSONObject best = null;
        double bestWeakest = 0;
        for (Object[] slot : slots.get(laps)) {
            String name = (String) slot[0];
            if (name.equals(excludeSlot)) continue;
            for (int offset : offsets) {
                int y = (Integer) slot[1] + offset;
                JSONArray scores = new JSONArray();
                double weakest = Double.POSITIVE_INFINITY;
                int circleY = y;
                for (int k = 0; k < circles.length; k++) {
                    double[] match = circleMatch(rgb, width, height, circles[k], x, y + k * pitch.get(laps), size, search);
                    scores.put(match[0]);
                    weakest = Math.min(weakest, match[0]);
                    if (k == 0) circleY = y + (int) match[2];
                }
                if (best == null || weakest > bestWeakest) {
                    best = new JSONObject().put("slot", name).put("offset", offset).put("y", y)
                            .put("circleY", circleY).put("scores", scores).put("weakest", weakest);
                    bestWeakest = weakest;
                }
            }
        }
        boolean present = best != null && bestWeakest >= threshold;
        return new JSONObject().put("schema", "mk8dx.card-presence.v1").put("owner", owner)
                .put("lapCount", laps).put("present", present)
                .put("slot", present ? best.get("slot") : JSONObject.NULL)
                .put("y", present ? best.get("y") : JSONObject.NULL)
                .put("circleY", present ? best.get("circleY") : JSONObject.NULL)
                .put("best", best == null ? JSONObject.NULL : best).put("threshold", threshold)
                .put("anchorsSha256", sha256 == null ? JSONObject.NULL : sha256);
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b));
        return out.toString();
    }
}
