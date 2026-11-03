package nl.mariokart8.iconmatcher;

import java.util.Arrays;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Bring a photographed Select-a-Ghost panel back to HDMI exposure and colour, from the panel itself.
 * Java counterpart of Python mk8dx_icon_matcher.panel_photometric and TS sharedPanelPhotometric:
 * the panel's constant elements taken from fixed boxes of the registered ghost canonical by rank,
 * their median colour fitted per channel to the HDMI colour. Pixels are packed RGB, row-major.
 * {@link #ELEMENTS} equals python/mk8dx_icon_matcher/references/panel-photometry-v1.json
 * (PanelPhotometricTest).
 */
public final class PanelPhotometric {
    private static final int MIN_ELEMENTS = 4;
    private static final double MIN_SPAN = 40;
    private static final double GAIN_MIN = 0.5;
    private static final double GAIN_MAX = 4.0;
    private static final double MAX_RESIDUAL = 60;
    private static final double CLIP = 250;
    public static final int WIDTH = 1280;
    public static final int HEIGHT = 720;

    /** One constant panel element: canonical box, selection kind and fraction, HDMI colour (RGB). */
    public static final class Element {
        public final String name;
        public final int[] box;
        public final String kind;
        public final double fraction;
        public final double[] hdmi;

        Element(String name, int[] box, String kind, double fraction, double[] hdmi) {
            this.name = name;
            this.box = box;
            this.kind = kind;
            this.fraction = fraction;
            this.hdmi = hdmi;
        }
    }

    public static final Element[] ELEMENTS = {
        new Element("x_button_fill", new int[]{826, 106, 856, 136}, "yellow", 0.15, new double[]{213.0, 194.0, 15.0}),
        new Element("x_button_glyph", new int[]{830, 113, 853, 133}, "dark", 0.25, new double[]{39.0, 32.0, 7.0}),
        new Element("magnifier", new int[]{857, 105, 890, 137}, "bright", 0.12, new double[]{243.0, 245.0, 245.0}),
        new Element("name_text", new int[]{521, 89, 730, 118}, "bright", 0.12, new double[]{239.0, 242.0, 243.0}),
        new Element("total_time", new int[]{664, 123, 804, 164}, "bright", 0.12, new double[]{244.0, 246.0, 246.2}),
        new Element("lap_times", new int[]{641, 193, 763, 311}, "bright", 0.12, new double[]{253.0, 248.0, 153.0}),
        new Element("lap_discs", new int[]{564, 197, 598, 311}, "dark", 0.08, new double[]{55.0, 55.0, 58.0}),
        new Element("lap_box", new int[]{767, 193, 846, 308}, "dark", 0.5, new double[]{64.0, 84.0, 87.0}),
    };

    private PanelPhotometric() {
    }

    private static double score(int r, int g, int b, String kind) {
        if ("bright".equals(kind)) return 0.299 * r + 0.587 * g + 0.114 * b;
        if ("dark".equals(kind)) return -(0.299 * r + 0.587 * g + 0.114 * b);
        return r + g - 2.0 * b;
    }

    /** Per-channel median; an even count averages the two middle values. */
    private static double[] median(int[][] values) {
        double[] out = new double[3];
        int n = values.length;
        for (int c = 0; c < 3; c++) {
            int[] ordered = new int[n];
            for (int i = 0; i < n; i++) ordered[i] = values[i][c];
            Arrays.sort(ordered);
            out[c] = n % 2 == 1 ? ordered[n / 2] : (ordered[n / 2 - 1] + ordered[n / 2]) / 2.0;
        }
        return out;
    }

    /** Median RGB of the box pixels that rank highest for the element (ties keep row-major order), or null. */
    public static double[] elementColour(byte[] rgb, int width, int height, Element element) {
        int x0 = element.box[0], y0 = element.box[1], x1 = element.box[2], y1 = element.box[3];
        if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 - x0 < 2 || y1 - y0 < 2) return null;
        int n = (x1 - x0) * (y1 - y0);
        int[][] pixels = new int[n][];
        double[] scores = new double[n];
        int k = 0;
        for (int y = y0; y < y1; y++) {
            for (int x = x0; x < x1; x++) {
                int at = (y * width + x) * 3;
                int r = rgb[at] & 0xff, g = rgb[at + 1] & 0xff, b = rgb[at + 2] & 0xff;
                pixels[k] = new int[]{r, g, b};
                scores[k] = score(r, g, b, element.kind);
                k++;
            }
        }
        Integer[] order = new Integer[n];
        for (int i = 0; i < n; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> {
            int byScore = Double.compare(scores[b], scores[a]);
            return byScore != 0 ? byScore : Integer.compare(a, b);
        });
        int count = Math.max(1, (int) Math.floor(n * element.fraction));
        int[][] chosen = new int[count][];
        for (int i = 0; i < count; i++) chosen[i] = pixels[order[i]];
        return median(chosen);
    }

    /** Python round(value, 3) for the reported residual. */
    private static double round3(double value) {
        double scaled = value * 1000;
        double floor = Math.floor(scaled);
        double diff = scaled - floor;
        double rounded = diff > 0.5 ? floor + 1 : diff < 0.5 ? floor : (floor % 2 == 0 ? floor : floor + 1);
        return rounded / 1000;
    }

    /** {"status": "corrected", "gain", "offset", "residual", "blueClipped"} or {"status": "not_corrected", "reason"}. */
    public static JSONObject fit(double[][] observed) throws JSONException {
        int n = 0;
        for (double[] o : observed) if (o != null) n++;
        if (n < MIN_ELEMENTS) return new JSONObject().put("status", "not_corrected").put("reason", "too_few_elements");
        double[][] x = new double[3][n];
        double[][] y = new double[3][n];
        double blue = Double.NEGATIVE_INFINITY;
        int k = 0;
        for (int e = 0; e < ELEMENTS.length; e++) {
            if (observed[e] == null) continue;
            for (int c = 0; c < 3; c++) {
                x[c][k] = observed[e][c];
                y[c][k] = ELEMENTS[e].hdmi[c];
            }
            blue = Math.max(blue, observed[e][2]);
            k++;
        }
        // Plain sequential sums, as in Python, so the three implementations agree to the bit.
        JSONArray gain = new JSONArray();
        JSONArray offset = new JSONArray();
        double residual = 0;
        for (int c = 0; c < 3; c++) {
            double min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
            for (int i = 0; i < n; i++) {
                min = Math.min(min, x[c][i]);
                max = Math.max(max, x[c][i]);
            }
            if (max - min < MIN_SPAN) return new JSONObject().put("status", "not_corrected").put("reason", "anchor_span");
            double sx = 0, sy = 0;
            for (int i = 0; i < n; i++) {
                sx += x[c][i];
                sy += y[c][i];
            }
            double mx = sx / n, my = sy / n;
            double sxy = 0, sxx = 0;
            for (int i = 0; i < n; i++) {
                sxy += (x[c][i] - mx) * (y[c][i] - my);
                sxx += (x[c][i] - mx) * (x[c][i] - mx);
            }
            double g = sxy / sxx;
            if (g < GAIN_MIN || g > GAIN_MAX) return new JSONObject().put("status", "not_corrected").put("reason", "gain_range");
            double o = my - g * mx;
            double se = 0;
            for (int i = 0; i < n; i++) {
                double d = g * x[c][i] + o - y[c][i];
                se += d * d;
            }
            residual = Math.max(residual, Math.sqrt(se / n));
            gain.put(g);
            offset.put(o);
        }
        if (residual > MAX_RESIDUAL) {
            return new JSONObject().put("status", "not_corrected").put("reason", "fit_residual").put("residual", round3(residual));
        }
        return new JSONObject().put("status", "corrected").put("gain", gain).put("offset", offset)
                .put("residual", round3(residual)).put("blueClipped", blue >= CLIP);
    }

    /** The mk8dx.panel-photometric.v1 record of a registered ghost canonical. */
    public static JSONObject record(byte[] rgb, int width, int height) throws JSONException {
        JSONObject measured;
        JSONObject correction;
        if (width != WIDTH || height != HEIGHT || rgb.length != width * height * 3) {
            measured = new JSONObject().put("status", "not_canonical");
            correction = new JSONObject().put("status", "not_corrected").put("reason", "not_canonical");
        } else {
            double[][] observed = new double[ELEMENTS.length][];
            JSONObject elements = new JSONObject();
            for (int e = 0; e < ELEMENTS.length; e++) {
                observed[e] = elementColour(rgb, width, height, ELEMENTS[e]);
                elements.put(ELEMENTS[e].name, observed[e] == null ? JSONObject.NULL
                        : new JSONArray().put(observed[e][0]).put(observed[e][1]).put(observed[e][2]));
            }
            measured = new JSONObject().put("status", "measured").put("elements", elements);
            correction = fit(observed);
        }
        return new JSONObject(correction.toString()).put("schema", "mk8dx.panel-photometric.v1").put("measured", measured);
    }

    /** floor(value * gain + offset + 0.5) per channel, clipped to 0..255; a copy, unchanged when not corrected. */
    public static byte[] apply(byte[] rgb, JSONObject correction) throws JSONException {
        return Photometric.apply(rgb, correction);
    }
}
