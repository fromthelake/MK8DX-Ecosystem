package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The central 7-segment digit matcher (Python segment_digits.py, TS sharedSegmentDigits.ts;
 * CENTRAL_RECOGNITION section 8.6, phase 2). Colour-coded template images (segments a..g) become
 * point masks; the template slides over the binarized slot (0/255, row-major) with a clamped
 * scale; candidates rank by validity, margin, confidence and lit segments; the pattern decodes to
 * a digit. Rounding is {@code Math.round} (floor(v + 0.5)), as in the other two languages.
 */
public final class SegmentDigits {
    public static final String[] KEYS = {"a", "b", "c", "d", "e", "f", "g"};
    public static final double SEGMENT_ON = 0.35;
    private static final Map<String, String> PATTERNS = new HashMap<>();
    private static final int[][] COLOURS = {{255, 0, 0}, {0, 255, 0}, {0, 0, 255}, {255, 255, 0},
            {255, 0, 255}, {0, 255, 255}, {255, 128, 0}};

    static {
        String[][] table = {{"1111110", "0"}, {"0001100", "1"}, {"0110111", "2"}, {"0011111", "3"},
                {"1001101", "4"}, {"1011011", "5"}, {"1111011", "6"}, {"0001110", "7"}, {"1111111", "8"},
                {"1011111", "9"}};
        for (String[] row : table) PATTERNS.put(row[0], row[1]);
    }

    private SegmentDigits() {
    }

    /** One template: per segment the (x, y) points, as {@code int[n][2]}. */
    public static final class Template {
        public final int width, height;
        public final int[][][] points;

        public Template(int width, int height, int[][][] points) {
            this.width = width;
            this.height = height;
            this.points = points;
        }

        public Template scaled(double scaleX, double scaleY) {
            int dstW = Math.max(1, (int) Math.round(width * Math.max(0.05, scaleX)));
            int dstH = Math.max(1, (int) Math.round(height * Math.max(0.05, scaleY)));
            int[][][] out = new int[KEYS.length][][];
            for (int k = 0; k < KEYS.length; k++) {
                Set<Long> unique = new LinkedHashSet<>();
                List<int[]> kept = new ArrayList<>();
                for (int[] p : points[k]) {
                    int x = Math.max(0, Math.min(dstW - 1, (int) Math.round(p[0] * scaleX)));
                    int y = Math.max(0, Math.min(dstH - 1, (int) Math.round(p[1] * scaleY)));
                    if (unique.add(((long) x << 32) | y)) kept.add(new int[]{x, y});
                }
                out[k] = kept.toArray(new int[0][]);
            }
            return new Template(dstW, dstH, out);
        }
    }

    /** A colour-coded template image, row-major RGB bytes (0..255). */
    public static Template templateFromRgb(byte[] rgb, int width, int height) {
        List<List<int[]>> masks = new ArrayList<>();
        for (int k = 0; k < KEYS.length; k++) masks.add(new ArrayList<>());
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int i = (y * width + x) * 3;
                int r = rgb[i] & 0xff, g = rgb[i + 1] & 0xff, b = rgb[i + 2] & 0xff;
                for (int k = 0; k < KEYS.length; k++) {
                    if (Math.abs(r - COLOURS[k][0]) <= 1 && Math.abs(g - COLOURS[k][1]) <= 1
                            && Math.abs(b - COLOURS[k][2]) <= 1) {
                        masks.get(k).add(new int[]{x, y});
                        break;
                    }
                }
            }
        }
        int[][][] points = new int[KEYS.length][][];
        for (int k = 0; k < KEYS.length; k++) points[k] = masks.get(k).toArray(new int[0][]);
        return new Template(width, height, points);
    }

    public static String decodePattern(String pattern) {
        String digit = PATTERNS.get(pattern);
        return digit == null ? "?" : digit;
    }

    public static int[] canonicalSlotSize(String kind, int slot) {
        boolean punctuation = slot == 2 || slot == 5;
        boolean total = "total".equals(kind);
        return new int[]{total ? (punctuation ? 8 : 22) : (punctuation ? 7 : 19), total ? 33 : 27};
    }

    public static final class Candidate {
        public final double[] values = new double[KEYS.length];
        public String pattern, decoded;
        public boolean valid;
        public int onCount, x, y, w, h;
        public double confidence, margin, scaleX, scaleY;
    }

    private static Candidate scoreAt(byte[] binary, int patchW, int patchH, Template t, int tx, int ty,
                                     double sx, double sy) {
        Candidate c = new Candidate();
        boolean[] states = new boolean[KEYS.length];
        double confidenceSum = 0;
        StringBuilder pattern = new StringBuilder();
        for (int k = 0; k < KEYS.length; k++) {
            int total = 0, on = 0;
            for (int[] p : t.points[k]) {
                int xx = tx + p[0], yy = ty + p[1];
                if (xx >= 0 && xx < patchW && yy >= 0 && yy < patchH) {
                    total++;
                    if ((binary[yy * patchW + xx] & 0xff) > 127) on++;
                }
            }
            double frac = total == 0 ? 0.0 : (double) on / total;
            boolean state = frac >= SEGMENT_ON;
            c.values[k] = frac;
            states[k] = state;
            c.onCount += state ? 1 : 0;
            confidenceSum += state ? frac : 1.0 - frac;
            pattern.append(state ? '1' : '0');
        }
        c.pattern = pattern.toString();
        c.decoded = decodePattern(c.pattern);
        c.valid = !"?".equals(c.decoded);
        c.confidence = confidenceSum / KEYS.length;
        double activeTotal = 0, inactiveMax = 0;
        int activeCount = 0;
        for (int k = 0; k < KEYS.length; k++) {
            if (states[k]) {
                activeTotal += c.values[k];
                activeCount++;
            } else {
                inactiveMax = Math.max(inactiveMax, c.values[k]);
            }
        }
        c.margin = (activeCount == 0 ? 0.0 : activeTotal / activeCount) - inactiveMax;
        c.x = tx;
        c.y = ty;
        c.w = t.width;
        c.h = t.height;
        c.scaleX = sx;
        c.scaleY = sy;
        return c;
    }

    public static int compare(Candidate a, Candidate b) {
        int r = Integer.compare(a.valid ? 1 : 0, b.valid ? 1 : 0);
        if (r != 0) return r;
        r = Double.compare(a.valid ? a.margin : -1.0, b.valid ? b.margin : -1.0);
        if (r != 0) return r;
        r = Double.compare(a.confidence, b.confidence);
        if (r != 0) return r;
        return Integer.compare(a.onCount, b.onCount);
    }

    /** The best template placement on one binary slot; {@code requiredDigit} limits it to that digit. */
    public static Candidate best(byte[] binary, int patchW, int patchH, Template base, String kind, int slotIndex,
                                 String requiredDigit) {
        if (patchW <= 0 || patchH <= 0 || base.width <= 0 || base.height <= 0) return null;
        int[] canonical = canonicalSlotSize(kind, slotIndex);
        double sx = Math.max(0.85, Math.min(1.0, patchW / Math.max(1.0, canonical[0])));
        double sy = Math.max(0.85, Math.min(1.2, patchH / Math.max(1.0, canonical[1])));
        Template scaled = base.scaled(sx, sy);
        if (scaled.width <= 0 || scaled.height <= 0 || patchW < scaled.width || patchH < scaled.height) return null;
        Candidate best = null;
        for (int ty = 0; ty <= patchH - scaled.height; ty++) {
            for (int tx = 0; tx <= patchW - scaled.width; tx++) {
                Candidate c = scoreAt(binary, patchW, patchH, scaled, tx, ty, sx, sy);
                if (requiredDigit != null && !requiredDigit.isEmpty() && !requiredDigit.equals(c.decoded)) continue;
                if (best == null || compare(c, best) > 0) best = c;
            }
        }
        return best;
    }

    /** Fallback without a template: coverage per region. */
    public static double[] segmentScores(byte[] binary, int w, int h) {
        double[][] regions = {{0.20, 0.03, 0.80, 0.18}, {0.72, 0.12, 0.95, 0.48}, {0.72, 0.52, 0.95, 0.88},
                {0.20, 0.82, 0.80, 0.97}, {0.05, 0.52, 0.28, 0.88}, {0.05, 0.12, 0.28, 0.48}, {0.20, 0.42, 0.80, 0.58}};
        double[] out = new double[KEYS.length];
        for (int k = 0; k < KEYS.length; k++) {
            double[] r = regions[k];
            int left = Math.max(0, Math.min(w - 1, (int) Math.round(w * r[0])));
            int top = Math.max(0, Math.min(h - 1, (int) Math.round(h * r[1])));
            int right = Math.max(left + 1, Math.min(w, (int) Math.round(w * r[2])));
            int bottom = Math.max(top + 1, Math.min(h, (int) Math.round(h * r[3])));
            int on = 0;
            for (int y = top; y < bottom; y++) {
                for (int x = left; x < right; x++) {
                    if (binary[y * w + x] != 0) on++;
                }
            }
            out[k] = on / Math.max(1.0, (double) (bottom - top) * (right - left));
        }
        return out;
    }
}
