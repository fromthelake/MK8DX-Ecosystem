package nl.mariokart8.iconmatcher;

import java.util.List;
import java.util.Set;

/**
 * The decision of the Web/Android icon crop search, without pixels (issue #99). The Python reference
 * (python/mk8dx_icon_matcher/crop_search.py) holds the whole search, pixel work included; this class and
 * ts/sharedCropSearch.ts hold its decision steps and constants. Since phase 4 the APK's CleanAssetsMatcher
 * identifyCropSearch and KartConfigMatcher character sweep call them for every decision; only the pixel
 * work stays in the engine. All three replay vectors/crop-search-v1.json: its constants, a case list per
 * helper and whole searches. Rounding is Math.round (half up).
 */
public final class CropSearch {
    // The searcher's constants; crop_search.py and sharedCropSearch.ts hold the same values and the
    // vectors' "constants" record is checked against all three.
    private static final double[] CHARACTER_SCALES = {0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06};
    public static final int SEARCH_PX_CHARACTERS = 10;
    public static final int SEARCH_PX_PARTS = 6;
    public static final int BOOST_MARGIN = 18;
    public static final double BOOST_SAT_MIN = 1.0;
    public static final double BOOST_SAT_MAX = 80.0;
    public static final double BOOST_SAT_TARGET = 90.0;
    public static final double BOOST_MAX_FACTOR = 2.0;
    public static final double WINDOW_GAIN_MIN = 0.6;
    public static final double WINDOW_GAIN_MAX = 1.8;
    public static final double MIN_WINDOW_MEAN = 1e-4;
    public static final int MIN_TEMPLATE_PX = 8;
    public static final int MIN_CROP_PX = 8;
    public static final double MIN_TEMPLATE_SUM = 24.0;

    private CropSearch() {
    }

    /** The seven scales of the character sweep, in sweep order (a copy). */
    public static double[] characterScales() {
        return CHARACTER_SCALES.clone();
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

    /** The position pass radius of a group ("characters", "bodies", "gliders"). */
    public static int searchPx(String group) {
        switch (group) {
            case "characters":
                return SEARCH_PX_CHARACTERS;
            case "bodies":
            case "gliders":
                return SEARCH_PX_PARTS;
            default:
                throw new IllegalArgumentException("not a crop-search group: " + group);
        }
    }

    /** {@code [wx1, wy1, wx2, wy2]} of the position pass, or null when it does not run. */
    public static int[] searchWindow(int x1, int y1, int tw, int th, int width, int height, int search) {
        int wx1 = Math.max(0, x1 - search);
        int wy1 = Math.max(0, y1 - search);
        int wx2 = Math.min(width, x1 + tw + search);
        int wy2 = Math.min(height, y1 + th + search);
        if (tw < MIN_TEMPLATE_PX || th < MIN_TEMPLATE_PX || wy2 - wy1 < th || wx2 - wx1 < tw) {
            return null;
        }
        return new int[]{wx1, wy1, wx2, wy2};
    }

    /** The search window's gain towards the references' mean, or null (gain 1) for a dark window. */
    public static Double windowGain(double refMean, double windowMean) {
        if (windowMean > MIN_WINDOW_MEAN) {
            return Math.max(WINDOW_GAIN_MIN, Math.min(WINDOW_GAIN_MAX, refMean / windowMean));
        }
        return null;
    }

    /** Whether a sized reference takes part in the position pass. */
    public static boolean votes(String id, double sum, Set<String> subset) {
        return !(sum < MIN_TEMPLATE_SUM || (subset != null && !subset.contains(id)));
    }

    /** The first strictly highest {@code 1 - minVal / sum} of the voting references, or null. */
    public static int[] pickPosition(List<Candidate> candidates, Set<String> subset) {
        double bestScore = Double.NEGATIVE_INFINITY;
        int[] best = null;
        for (Candidate c : candidates) {
            if (!votes(c.id, c.sum, subset)) {
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

    /** The shift {@code [dx, dy]} of the picked window position from the nominal crop, or null when zero. */
    public static int[] pickedShift(int[] window, int[] picked, int x1, int y1) {
        int dx = window[0] + picked[0] - x1;
        int dy = window[1] + picked[1] - y1;
        return dx == 0 && dy == 0 ? null : new int[]{dx, dy};
    }

    /** The shifted crop replaces the nominal one when its rounded score is at least as high. */
    public static boolean acceptShift(double shiftedScore, double centerScore) {
        return shiftedScore >= centerScore;
    }

    /** {@code [x, y, w, h]} around a character slot that the ghost-card saturation boost measures and recolours. */
    public static int[] boostRegion(int[] slot, int width, int height) {
        int roiX = Math.max(0, slot[0] - BOOST_MARGIN);
        int roiY = Math.max(0, slot[1] - BOOST_MARGIN);
        return new int[]{roiX, roiY, Math.min(width - roiX, slot[2] + 2 * BOOST_MARGIN),
                Math.min(height - roiY, slot[3] + 2 * BOOST_MARGIN)};
    }

    /** The ghost-card boost's saturation factor for the region's mean saturation, or null (no boost). */
    public static Double boostFactor(double meanSat) {
        if (meanSat > BOOST_SAT_MIN && meanSat < BOOST_SAT_MAX) {
            return Math.min(BOOST_MAX_FACTOR, BOOST_SAT_TARGET / meanSat);
        }
        return null;
    }

    /** The fractional {@code [x, y, w, h]} one look of the character sweep searches, in its source's coordinates. */
    public static double[] lookBox(int[] slot, double scale, int roiX, int roiY) {
        double w2 = slot[2] * scale;
        double h2 = slot[3] * scale;
        return new double[]{slot[0] + (slot[2] - w2) / 2.0 - roiX, slot[1] + (slot[3] - h2) / 2.0 - roiY, w2, h2};
    }

    /** Whether a look beats the best so far (null: it is the first): the first strictly highest wins. */
    public static boolean betterLook(double score, Double bestScore) {
        return bestScore == null || score > bestScore;
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
        int[] shift = picked == null ? null : pickedShift(window, picked, x1, y1);
        if (shift != null && acceptShift(look.shiftedScore, look.centerScore)) {
            return new Decision(shift[0], shift[1], look.shiftedScore, true, window);
        }
        return new Decision(0, 0, look.centerScore, false, window);
    }

    /** The crop the shared reader scores: the slot scaled about its centre, then shifted. */
    public static int[] cropBox(int[] slot, double scale, int dx, int dy) {
        int cw = Math.max(MIN_CROP_PX, round(slot[2] * scale));
        int ch = Math.max(MIN_CROP_PX, round(slot[3] * scale));
        return new int[]{round(slot[0] + (slot[2] - cw) / 2.0) + dx, round(slot[1] + (slot[3] - ch) / 2.0) + dy, cw, ch};
    }

    /** A field over its looks (one per scale): the first strictly highest score wins. */
    public static FieldDecision decideField(int width, int height, int[] slot, List<Look> looks) {
        Decision[] decided = new Decision[looks.size()];
        int best = -1;
        for (int i = 0; i < looks.size(); i++) {
            decided[i] = decideSearch(looks.get(i), width, height);
            if (betterLook(decided[i].score, best < 0 ? null : decided[best].score)) {
                best = i;
            }
        }
        double scale = looks.get(best).scale;
        Decision got = decided[best];
        return new FieldDecision(scale, got, cropBox(slot, scale, got.dx, got.dy), decided);
    }
}
