package nl.mariokart8.iconmatcher;

import java.util.List;
import java.util.Set;

/**
 * The decision of the Web/Android icon crop search, without pixels (issue #99, phase 3). The Python
 * reference (python/mk8dx_icon_matcher/crop_search.py) holds the whole search, pixel work included,
 * transcribed from the Web scanner's cleanAssets.ts identifyCropSearch and kartConfig.ts matchCard (ports
 * of the APK's CleanAssetsMatcher and KartConfigMatcher); this class and ts/sharedCropSearch.ts replay its
 * decision on the measurements in vectors/crop-search-v1.json. The APK still runs its own copy
 * (unifying it is phase 4). Rounding is Math.round (half up).
 */
public final class CropSearch {
    public static final double MIN_TEMPLATE_SUM = 24.0;

    private CropSearch() {
    }

    /** One reference of the masked TM_SQDIFF position pass: its mask sum, minimum and top-left position. */
    public static final class Candidate {
        public final String id;
        public final double sum;
        public final double minVal;
        public final int x;
        public final int y;

        public Candidate(String id, double sum, double minVal, int x, int y) {
            this.id = id;
            this.sum = sum;
            this.minVal = minVal;
            this.x = x;
            this.y = y;
        }
    }

    /** One identifyCropSearch call: fractional box, search radius, subset (null: all) and its measurements. */
    public static final class Look {
        public final double scale;
        public final double[] box;
        public final int search;
        public final Set<String> subset;
        public final double centerScore;
        public final List<Candidate> candidates;
        public final double shiftedScore;

        public Look(double scale, double[] box, int search, Set<String> subset, double centerScore,
                    List<Candidate> candidates, double shiftedScore) {
            this.scale = scale;
            this.box = box;
            this.search = search;
            this.subset = subset;
            this.centerScore = centerScore;
            this.candidates = candidates;
            this.shiftedScore = shiftedScore;
        }
    }

    public static final class Decision {
        public final int dx;
        public final int dy;
        public final double score;
        public final boolean shifted;
        public final int[] window;

        Decision(int dx, int dy, double score, boolean shifted, int[] window) {
            this.dx = dx;
            this.dy = dy;
            this.score = score;
            this.shifted = shifted;
            this.window = window;
        }
    }

    public static final class FieldDecision {
        public final double scale;
        public final Decision best;
        public final int[] cropBox;
        public final Decision[] looks;

        FieldDecision(double scale, Decision best, int[] cropBox, Decision[] looks) {
            this.scale = scale;
            this.best = best;
            this.cropBox = cropBox;
            this.looks = looks;
        }
    }

    private static int round(double v) {
        return (int) Math.round(v);
    }

    /** {@code [wx1, wy1, wx2, wy2]} of the position pass, or null when it does not run. */
    public static int[] searchWindow(int x1, int y1, int tw, int th, int width, int height, int search) {
        int wx1 = Math.max(0, x1 - search);
        int wy1 = Math.max(0, y1 - search);
        int wx2 = Math.min(width, x1 + tw + search);
        int wy2 = Math.min(height, y1 + th + search);
        if (tw < 8 || th < 8 || wy2 - wy1 < th || wx2 - wx1 < tw) {
            return null;
        }
        return new int[]{wx1, wy1, wx2, wy2};
    }

    /** The first strictly highest {@code 1 - minVal / sum} of the voting references, or null. */
    public static int[] pickPosition(List<Candidate> candidates, Set<String> subset) {
        double bestScore = Double.NEGATIVE_INFINITY;
        int[] best = null;
        for (Candidate c : candidates) {
            if (c.sum < MIN_TEMPLATE_SUM || (subset != null && !subset.contains(c.id))) {
                continue;
            }
            double score = 1.0 - c.minVal / c.sum;
            if (score > bestScore) {
                bestScore = score;
                best = new int[]{c.x, c.y};
            }
        }
        return best;
    }

    public static Decision decideSearch(Look look, int width, int height) {
        int tw = round(look.box[2]);
        int th = round(look.box[3]);
        int x1 = round(look.box[0]);
        int y1 = round(look.box[1]);
        int cx = Math.max(0, Math.min(width - 1, x1));
        int cy = Math.max(0, Math.min(height - 1, y1));
        if (Math.min(tw, width - cx) <= 0 || Math.min(th, height - cy) <= 0) {
            return new Decision(0, 0, 0.0, false, null);
        }
        int[] window = searchWindow(x1, y1, tw, th, width, height, look.search);
        if (window == null) {
            return new Decision(0, 0, look.centerScore, false, null);
        }
        int[] picked = pickPosition(look.candidates, look.subset);
        if (picked != null) {
            int dx = window[0] + picked[0] - x1;
            int dy = window[1] + picked[1] - y1;
            if ((dx != 0 || dy != 0) && look.shiftedScore >= look.centerScore) {
                return new Decision(dx, dy, look.shiftedScore, true, window);
            }
        }
        return new Decision(0, 0, look.centerScore, false, window);
    }

    /** The crop the shared reader scores: the slot scaled about its centre, then shifted. */
    public static int[] cropBox(int[] slot, double scale, int dx, int dy) {
        int cw = Math.max(8, round(slot[2] * scale));
        int ch = Math.max(8, round(slot[3] * scale));
        return new int[]{round(slot[0] + (slot[2] - cw) / 2.0) + dx, round(slot[1] + (slot[3] - ch) / 2.0) + dy, cw, ch};
    }

    /** A field over its looks (one per scale): the first strictly highest score wins. */
    public static FieldDecision decideField(int width, int height, int[] slot, List<Look> looks) {
        Decision[] decided = new Decision[looks.size()];
        int best = -1;
        for (int i = 0; i < looks.size(); i++) {
            decided[i] = decideSearch(looks.get(i), width, height);
            if (best < 0 || decided[i].score > decided[best].score) {
                best = i;
            }
        }
        double scale = looks.get(best).scale;
        Decision got = decided[best];
        return new FieldDecision(scale, got, cropBox(slot, scale, got.dx, got.dy), decided);
    }
}
