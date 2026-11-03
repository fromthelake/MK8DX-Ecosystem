package nl.mariokart8.iconmatcher;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Bring a photographed result card back to HDMI exposure and colour, from the card itself.
 * Java counterpart of Python mk8dx_icon_matcher.photometric and TS sharedCardPresence
 * (correctCard): lap circles 1-3 found from the character slot, median disc and digit colour
 * through masks derived from the circle templates, per-channel line to the HDMI anchors.
 * Pixels are packed RGB, row-major.
 */
public final class Photometric {
    private static final double DISC_LUMA_MAX = 80;
    private static final double DIGIT_LUMA_MIN = 200;
    private static final double DISC_RADIUS = 12;
    private static final double DIGIT_RADIUS = 10;
    private static final int SEARCH = 6;
    private static final double MIN_SPAN = 40;
    private static final double GAIN_MIN = 0.5;
    private static final double GAIN_MAX = 3.0;
    private static final double CLIP = 250;

    /** One lap layout: circle-template offset from the character slot, pitch, HDMI anchors (RGB). */
    public static final class Layout {
        public final double fromX;
        public final double fromY;
        public final int pitch;
        public final double[] disc;
        public final double[] digit;

        Layout(double fromX, double fromY, int pitch, double[] disc, double[] digit) {
            this.fromX = fromX;
            this.fromY = fromY;
            this.pitch = pitch;
            this.disc = disc;
            this.digit = digit;
        }
    }

    public final Map<Integer, Layout> layouts = new HashMap<>();
    public final String sha256;

    public Photometric(byte[] raw) throws Exception {
        this(new JSONObject(new String(raw, StandardCharsets.UTF_8)), hex(MessageDigest.getInstance("SHA-256").digest(raw)));
    }

    public Photometric(JSONObject document, String sha256) throws JSONException {
        if (!"mk8dx.card-photometry.v1".equals(document.optString("schema"))) {
            throw new IllegalArgumentException("Expected a mk8dx.card-photometry.v1 document");
        }
        this.sha256 = sha256;
        JSONObject all = document.getJSONObject("layouts");
        for (Iterator<String> keys = all.keys(); keys.hasNext(); ) {
            String laps = keys.next();
            JSONObject layout = all.getJSONObject(laps);
            JSONArray from = layout.getJSONArray("fromCharacter");
            layouts.put(Integer.parseInt(laps), new Layout(from.getDouble(0), from.getDouble(1), layout.getInt("pitch"),
                    doubles(layout.getJSONArray("disc")), doubles(layout.getJSONArray("digit"))));
        }
    }

    private static double[] doubles(JSONArray values) throws JSONException {
        double[] out = new double[values.length()];
        for (int i = 0; i < out.length; i++) out[i] = values.getDouble(i);
        return out;
    }

    /** Python round(): halves go to the even neighbour. */
    private static int roundHalfEven(double value) {
        return (int) Math.rint(value);
    }

    private static boolean[][] masks(byte[] raw, int size) {
        boolean[] disc = new boolean[size * size];
        boolean[] digit = new boolean[size * size];
        double centre = (size - 1) / 2.0;
        for (int y = 0; y < size; y++) {
            for (int x = 0; x < size; x++) {
                int i = y * size + x;
                double luma = 0.299 * (raw[i * 3] & 0xff) + 0.587 * (raw[i * 3 + 1] & 0xff) + 0.114 * (raw[i * 3 + 2] & 0xff);
                double radius = Math.sqrt((x - centre) * (x - centre) + (y - centre) * (y - centre));
                disc[i] = luma < DISC_LUMA_MAX && radius <= DISC_RADIUS;
                digit[i] = luma > DIGIT_LUMA_MIN && radius <= DIGIT_RADIUS;
            }
        }
        return new boolean[][]{disc, digit};
    }

    /** Per-channel median; an even count averages the two middle values. */
    private static double[] median(List<int[]> values) {
        double[] out = new double[3];
        for (int c = 0; c < 3; c++) {
            int[] ordered = new int[values.size()];
            for (int i = 0; i < ordered.length; i++) ordered[i] = values.get(i)[c];
            Arrays.sort(ordered);
            int n = ordered.length;
            out[c] = n % 2 == 1 ? ordered[n / 2] : (ordered[n / 2 - 1] + ordered[n / 2]) / 2.0;
        }
        return out;
    }

    /** The measured anchors: {"status": "measured", "circles", "disc", "digit"} or circles_not_found. */
    public JSONObject measure(byte[] rgb, int width, int height, double characterX, double characterY, int laps,
                              String owner, CardPresence anchors) throws JSONException {
        Layout layout = layouts.get(laps == 7 ? 7 : 3);
        double[][] templates = anchors.templates.get(owner);
        byte[][] raws = anchors.rawTemplates.get(owner);
        int size = anchors.size;
        List<int[]> disc = new ArrayList<>();
        List<int[]> digit = new ArrayList<>();
        JSONArray circles = new JSONArray();
        int prevLeft = 0;
        int prevTop = 0;
        for (int k = 0; k < templates.length; k++) {
            // circle 1 from the character slot; each next one from where the previous
            // was found, so a slightly scaled registration does not accumulate
            int x = k == 0 ? roundHalfEven(characterX + layout.fromX) : prevLeft;
            int y = k == 0 ? roundHalfEven(characterY + layout.fromY) : prevTop + layout.pitch;
            double[] match = CardPresence.circleMatch(rgb, width, height, templates[k], x, y, size, SEARCH);
            int left = x + (int) match[1];
            int top = y + (int) match[2];
            if (match[0] < 0.5 || left < 0 || top < 0 || left + size > width || top + size > height) {
                return new JSONObject().put("status", "circles_not_found")
                        .put("circleScores", new JSONArray().put(Math.round(match[0] * 1000) / 1000.0));
            }
            circles.put(new JSONArray().put(left).put(top).put(Math.round(match[0] * 1000) / 1000.0));
            prevLeft = left;
            prevTop = top;
            boolean[][] mask = masks(raws[k], size);
            for (int yy = 0; yy < size; yy++) {
                for (int xx = 0; xx < size; xx++) {
                    int i = yy * size + xx;
                    int at = ((top + yy) * width + left + xx) * 3;
                    int[] px = {rgb[at] & 0xff, rgb[at + 1] & 0xff, rgb[at + 2] & 0xff};
                    if (mask[0][i]) disc.add(px);
                    if (mask[1][i]) digit.add(px);
                }
            }
        }
        double[] d = median(disc);
        double[] w = median(digit);
        return new JSONObject().put("status", "measured").put("circles", circles)
                .put("disc", new JSONArray().put(d[0]).put(d[1]).put(d[2]))
                .put("digit", new JSONArray().put(w[0]).put(w[1]).put(w[2]));
    }

    /** {"status": "corrected", "gain", "offset", "blueClipped"} or {"status": "not_corrected", "reason"}. */
    public JSONObject fit(JSONObject measured, int laps) throws JSONException {
        if (!"measured".equals(measured.optString("status"))) {
            return new JSONObject().put("status", "not_corrected").put("reason", measured.optString("status"));
        }
        Layout layout = layouts.get(laps == 7 ? 7 : 3);
        JSONArray disc = measured.getJSONArray("disc");
        JSONArray digit = measured.getJSONArray("digit");
        JSONArray gain = new JSONArray();
        JSONArray offset = new JSONArray();
        for (int c = 0; c < 3; c++) {
            double span = digit.getDouble(c) - disc.getDouble(c);
            if (span < MIN_SPAN) return new JSONObject().put("status", "not_corrected").put("reason", "anchor_span");
            double g = (layout.digit[c] - layout.disc[c]) / span;
            if (g < GAIN_MIN || g > GAIN_MAX) return new JSONObject().put("status", "not_corrected").put("reason", "gain_range");
            gain.put(g);
            offset.put(layout.disc[c] - g * disc.getDouble(c));
        }
        return new JSONObject().put("status", "corrected").put("gain", gain).put("offset", offset)
                .put("blueClipped", digit.getDouble(2) >= CLIP);
    }

    /** round(value * gain + offset) per channel, clipped to 0..255; a copy, unchanged when not corrected. */
    public static byte[] apply(byte[] rgb, JSONObject correction) throws JSONException {
        byte[] out = Arrays.copyOf(rgb, rgb.length);
        if (!"corrected".equals(correction.optString("status"))) return out;
        double[] gain = doubles(correction.getJSONArray("gain"));
        double[] offset = doubles(correction.getJSONArray("offset"));
        for (int i = 0; i < out.length; i++) {
            int c = i % 3;
            double v = Math.floor((rgb[i] & 0xff) * gain[c] + offset[c] + 0.5);
            out[i] = (byte) Math.max(0, Math.min(255, (int) v));
        }
        return out;
    }

    /** The mk8dx.card-photometric.v1 record; {@code otherCard} lends its correction when this card's fails. */
    public JSONObject record(byte[] rgb, int width, int height, double characterX, double characterY, int laps,
                             String owner, CardPresence anchors, JSONObject otherCard) throws JSONException {
        JSONObject measured = measure(rgb, width, height, characterX, characterY, laps, owner, anchors);
        JSONObject correction = fit(measured, laps);
        String source = "own_card";
        if (!"corrected".equals(correction.optString("status")) && otherCard != null
                && "corrected".equals(otherCard.optString("status")) && "own_card".equals(otherCard.optString("source"))) {
            correction = new JSONObject().put("status", "corrected").put("gain", otherCard.getJSONArray("gain"))
                    .put("offset", otherCard.getJSONArray("offset")).put("blueClipped", otherCard.getBoolean("blueClipped"));
            source = "other_card";
        }
        JSONObject record = new JSONObject(correction.toString()).put("schema", "mk8dx.card-photometric.v1")
                .put("source", source).put("measured", measured).put("photometrySha256", sha256 == null ? JSONObject.NULL : sha256);
        return record;
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b));
        return out.toString();
    }
}
