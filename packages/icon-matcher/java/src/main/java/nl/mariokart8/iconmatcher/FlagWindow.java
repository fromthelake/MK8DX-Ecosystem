package nl.mariokart8.iconmatcher;

import java.util.HashMap;
import java.util.Map;

/**
 * Where inside its fixed slot does the flag sit? Java counterpart of Python
 * mk8dx_icon_matcher.flag_window and TS sharedFlagWindow: the same search, each
 * language scoring a position with its centre-only tensor match.
 */
public final class FlagWindow {
    public static final int WINDOW_PAD = 5;
    private static final double INSET_RATIO = 0.055;
    private static final double POSITION_PENALTY = 0.01;
    private static final int STEP = 2;

    /** Best flag score of the crop (left, top, width, height) inside the window. */
    public interface ScoreAt {
        double score(int left, int top, int width, int height);
    }

    public static final class Read {
        public int[] cropXywh;
        public String basis;
        public double score;
        public double slotScore;
        public int evaluated;
    }

    private FlagWindow() {
    }

    public static int inset(int height) {
        return Math.max(2, (int) Math.rint(INSET_RATIO * height));
    }

    public static Read search(int windowWidth, int windowHeight, int[] slotXywh, ScoreAt scoreAt) {
        int x = slotXywh[0];
        int y = slotXywh[1];
        int width = slotXywh[2];
        int height = slotXywh[3];
        if (x < 0 || y < 0 || x + width > windowWidth || y + height > windowHeight) {
            throw new IllegalArgumentException("Flag slot must fit its window");
        }
        int inset = inset(height);
        // Two crop sizes compete, the full slot first (see the Python module doc).
        int[][] sizes = {{width, height, x, y}, {width - 2 * inset, height - 2 * inset, x + inset, y + inset}};
        Map<String, Double> cache = new HashMap<>();
        double bestValue = 0;
        int[] best = null;
        for (int[] size : sizes) {
            int cw = size[0];
            int ch = size[1];
            int cx = size[2];
            int cy = size[3];
            java.util.function.BiFunction<Integer, Integer, Double> penalised = (left, top) ->
                    cache.computeIfAbsent(left + "," + top + "," + cw + "," + ch,
                            key -> scoreAt.score(left, top, cw, ch))
                            - POSITION_PENALTY * (Math.abs(left - cx) + Math.abs(top - cy));
            double sizeValue = penalised.apply(cx, cy);
            int bx = cx;
            int by = cy;
            for (int top = 0; top <= windowHeight - ch; top += STEP) {
                for (int left = 0; left <= windowWidth - cw; left += STEP) {
                    double value = penalised.apply(left, top);
                    if (value > sizeValue) {
                        sizeValue = value;
                        bx = left;
                        by = top;
                    }
                }
            }
            int gx = bx;
            int gy = by;
            for (int top = gy - 1; top <= gy + 1; top++) {
                for (int left = gx - 1; left <= gx + 1; left++) {
                    if (left >= 0 && left <= windowWidth - cw && top >= 0 && top <= windowHeight - ch) {
                        double value = penalised.apply(left, top);
                        if (value > sizeValue) {
                            sizeValue = value;
                            bx = left;
                            by = top;
                        }
                    }
                }
            }
            if (best == null || sizeValue > bestValue) {
                bestValue = sizeValue;
                best = new int[]{bx, by, cw, ch};
            }
        }
        Read read = new Read();
        read.cropXywh = best;
        read.basis = best[0] == x && best[1] == y && best[2] == width && best[3] == height ? "fixed_slot" : "window_search";
        read.score = cache.get(best[0] + "," + best[1] + "," + best[2] + "," + best[3]);
        read.slotScore = cache.computeIfAbsent(x + "," + y + "," + width + "," + height,
                key -> scoreAt.score(x, y, width, height));
        read.evaluated = cache.size();
        return read;
    }
}
