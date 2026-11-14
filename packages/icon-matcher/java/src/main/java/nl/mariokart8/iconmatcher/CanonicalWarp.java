package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The canonical card geometry before the crop (issue #99, phase 5): from the card quad in the frame to
 * the 1280x720 canonical card that the slot and crop search read. The Python reference
 * (python/mk8dx_icon_matcher/canonical_warp.py) documents the steps; this class and
 * ts/sharedCanonicalWarp.ts hold the same pure arithmetic in the same order. OpenCV's perspective solve,
 * the products' matrix use and the warps stay in the engine; the solved homography (and a panel
 * registration) are inputs. All three replay vectors/canonical-warp-v1.json. Rounding is Math.round
 * (half up). Points and quads are {@code double[][]} of {x, y}; boxes are {left, top, right, bottom};
 * rectangles {x, y, w, h}; matrices row-major {@code double[9]}.
 */
public final class CanonicalWarp {
    // The constants; canonical_warp.py and sharedCanonicalWarp.ts hold the same values and the vectors'
    // "constants" record is checked against all three.
    public static final int CANONICAL_W = 1280;
    public static final int CANONICAL_H = 720;
    private static final double[] PLAYER_BOX_RACE7 = {548.0, 362.0, 1231.0, 661.0};
    private static final double[] GHOST_BOX_RACE7 = {548.0, 42.0, 1231.0, 349.0};
    private static final double[] GHOST_DETAIL_BOX_RACE3 = {540.0, 170.0, 782.0, 331.0};
    private static final double[] GHOST_DETAIL_BOX_RACE7 = {540.0, 120.0, 767.0, 379.0};
    public static final double ANTIALIAS_BELOW_SCALE = 0.5;
    public static final double ANTIALIAS_TARGET_SCALE = 0.8;
    private static final String[] CONTENT_KEYS = {"lap_index_boxes_rel", "total_strip_rel", "lap_strips_rel"};
    public static final String GHOST_DETAIL_DESKEW_SEED = "ghost_detail_deskew_seed";

    private CanonicalWarp() {
    }

    public static double[] playerBoxRace7() {
        return PLAYER_BOX_RACE7.clone();
    }

    public static double[] ghostBoxRace7() {
        return GHOST_BOX_RACE7.clone();
    }

    public static double[] ghostDetailBoxRace3() {
        return GHOST_DETAIL_BOX_RACE3.clone();
    }

    public static double[] ghostDetailBoxRace7() {
        return GHOST_DETAIL_BOX_RACE7.clone();
    }

    public static String[] contentKeys() {
        return CONTENT_KEYS.clone();
    }

    /** {x, y, w, h}: floor of the smallest and ceil of the largest corner, clipped to the frame. */
    public static int[] boundingRect(double[][] quad, int width, int height) {
        double minX = Double.MAX_VALUE;
        double minY = Double.MAX_VALUE;
        double maxX = -Double.MAX_VALUE;
        double maxY = -Double.MAX_VALUE;
        for (double[] p : quad) {
            minX = Math.min(minX, p[0]);
            minY = Math.min(minY, p[1]);
            maxX = Math.max(maxX, p[0]);
            maxY = Math.max(maxY, p[1]);
        }
        int x = Math.max(0, Math.min(width - 1, (int) Math.floor(minX)));
        int y = Math.max(0, Math.min(height - 1, (int) Math.floor(minY)));
        int right = Math.max(x + 1, Math.min(width, (int) Math.ceil(maxX)));
        int bottom = Math.max(y + 1, Math.min(height, (int) Math.ceil(maxY)));
        return new int[]{x, y, right - x, bottom - y};
    }

    /** The four corners of a rectangle, clockwise from top-left; right and bottom are x + w - 1. */
    public static double[][] quadFromRect(int[] rect) {
        int x = rect[0];
        int y = rect[1];
        int w = rect[2];
        int h = rect[3];
        return new double[][]{{x, y}, {x + w - 1, y}, {x + w - 1, y + h - 1}, {x, y + h - 1}};
    }

    /** Every corner moved by (dx, dy) (the engine's Quad.shifted). */
    public static double[][] shiftedQuad(double[][] quad, double dx, double dy) {
        double[][] out = new double[quad.length][];
        for (int i = 0; i < quad.length; i++) out[i] = new double[]{quad[i][0] + dx, quad[i][1] + dy};
        return out;
    }

    /** {left, top, right, bottom} around the quad's corners. */
    public static double[] quadBox(double[][] quad) {
        double left = Double.MAX_VALUE;
        double top = Double.MAX_VALUE;
        double right = -Double.MAX_VALUE;
        double bottom = -Double.MAX_VALUE;
        for (double[] p : quad) {
            left = Math.min(left, p[0]);
            top = Math.min(top, p[1]);
            right = Math.max(right, p[0]);
            bottom = Math.max(bottom, p[1]);
        }
        return new double[]{left, top, right, bottom};
    }

    private static void appendRel(JSONObject grid, JSONArray value, List<double[]> boxes) {
        if (value.length() == 4 && !(value.opt(0) instanceof JSONArray)) {
            JSONObject anchor = grid.optJSONObject("anchor");
            double ax = anchor == null ? 0.0 : anchor.optDouble("x", 0.0);
            double ay = anchor == null ? 0.0 : anchor.optDouble("y", 0.0);
            double x1 = ax + value.optDouble(0, 0.0);
            double y1 = ay + value.optDouble(1, 0.0);
            double x2 = ax + value.optDouble(2, 0.0);
            double y2 = ay + value.optDouble(3, 0.0);
            // ordered, as the engine's BoxD
            boxes.add(new double[]{Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)});
            return;
        }
        for (int i = 0; i < value.length(); i++) {
            JSONArray child = value.optJSONArray(i);
            if (child != null) appendRel(grid, child, boxes);
        }
    }

    /** The union of an owner grid's lap-index, total and lap strips (anchor plus relative box, each box ordered), or null. */
    public static double[] contentExtent(JSONObject ownerGrid) {
        if (ownerGrid == null) return null;
        List<double[]> boxes = new ArrayList<>();
        for (String key : CONTENT_KEYS) {
            JSONArray value = ownerGrid.optJSONArray(key);
            if (value != null) appendRel(ownerGrid, value, boxes);
        }
        if (boxes.isEmpty()) return null;
        double left = Double.MAX_VALUE;
        double top = Double.MAX_VALUE;
        double right = -Double.MAX_VALUE;
        double bottom = -Double.MAX_VALUE;
        for (double[] b : boxes) {
            left = Math.min(left, b[0]);
            top = Math.min(top, b[1]);
            right = Math.max(right, b[2]);
            bottom = Math.max(bottom, b[3]);
        }
        return new double[]{left, top, right, bottom};
    }

    /** Where the card lies on the canonical frame: its box and the name of the rule that chose it. */
    public static final class Target {
        public final double[] box;
        public final String source;

        Target(double[] box, String source) {
            this.box = box;
            this.source = source;
        }
    }

    public static Target targetBox(String owner, String raceKey, boolean ghostDetail, double[] race3Content,
                                   double[] race7Content) {
        if (ghostDetail) {
            boolean race7 = "race7".equals(raceKey);
            return new Target((race7 ? GHOST_DETAIL_BOX_RACE7 : GHOST_DETAIL_BOX_RACE3).clone(),
                "fixed_ghost_detail_canonical_target_" + (race7 ? "race7" : "race3"));
        }
        double[] race7 = "ghost".equals(owner) ? GHOST_BOX_RACE7 : PLAYER_BOX_RACE7;
        if (!"race3".equals(raceKey)) return new Target(race7.clone(), "fixed_race7_canonical_target");
        if (race3Content == null || race7Content == null) {
            return new Target(race7.clone(), "fallback_fixed_race7_missing_relative_grid_content_extent");
        }
        double left = race7Content[0] - race7[0];
        double top = race7Content[1] - race7[1];
        double right = race7[2] - race7Content[2];
        double bottom = race7[3] - race7Content[3];
        return new Target(new double[]{race3Content[0] - left, race3Content[1] - top, race3Content[2] + right,
            race3Content[3] + bottom}, "derived_from_race3_relative_grid_using_race7_card_content_margins");
    }

    /** {scaleX, scaleY, translateX, translateY} that map currentBox onto target (a side under 1 counts as 1). */
    public static double[] canonicalAlign(double[] currentBox, double[] target) {
        double sx = Math.max(1.0, target[2] - target[0]) / Math.max(1.0, currentBox[2] - currentBox[0]);
        double sy = Math.max(1.0, target[3] - target[1]) / Math.max(1.0, currentBox[3] - currentBox[1]);
        return new double[]{sx, sy, target[0] - currentBox[0] * sx, target[1] - currentBox[1] * sy};
    }

    public static double[] alignMatrix(double[] align) {
        return new double[]{align[0], 0.0, align[2], 0.0, align[1], align[3], 0.0, 0.0, 1.0};
    }

    /** a x b for row-major 3x3 matrices, each element summed left to right (OpenCV gemm). */
    public static double[] compose(double[] a, double[] b) {
        double[] out = new double[9];
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 3; j++) {
                out[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
            }
        }
        return out;
    }

    /** The area reduction before a warp that shrinks below 0.5. */
    public static final class AntialiasPlan {
        public final double factor;
        public final int reducedW;
        public final int reducedH;
        public final double[] unscale;

        AntialiasPlan(double factor, int reducedW, int reducedH, double[] unscale) {
            this.factor = factor;
            this.reducedW = reducedW;
            this.reducedH = reducedH;
            this.unscale = unscale;
        }
    }

    /** The reduction plan, or null when the warp keeps a scale of 0.5 or more. */
    public static AntialiasPlan antialiasPlan(double[] align, int cols, int rows) {
        double shrink = Math.min(align[0], align[1]);
        if (!(shrink > 0.0 && shrink < ANTIALIAS_BELOW_SCALE)) return null;
        double factor = shrink / ANTIALIAS_TARGET_SCALE;
        int reducedW = Math.max(1, (int) Math.round(cols * factor));
        int reducedH = Math.max(1, (int) Math.round(rows * factor));
        return new AntialiasPlan(factor, reducedW, reducedH,
            new double[]{cols / (double) reducedW, 0.0, 0.0, 0.0, rows / (double) reducedH, 0.0, 0.0, 0.0, 1.0});
    }

    /** The whole geometry of one card (canonical_warp.canonical_transform). */
    public static final class Result {
        public int[] bounds;
        public double[][] destination;
        public double[] currentBox;
        public Target target;
        public double[] align;
        public double[] affine;
        public double[] composed;
        public AntialiasPlan antialias;
        public double[] fin;
        public int[] warpSource;
    }

    /**
     * deskewRoi (the deskew seed only) is {left, top, cols, rows}: the ROI crop's size placed at the ROI
     * box's fractional top-left; registration may be null.
     */
    public static Result canonicalTransform(int cols, int rows, double[][] quad, String seed, double[] deskewRoi,
                                            String owner, String raceKey, boolean ghostDetail, double[] race3Content,
                                            double[] race7Content, double[] homography, double[] registration) {
        Result r = new Result();
        if (GHOST_DETAIL_DESKEW_SEED.equals(seed)) {
            double[][] roi = quadFromRect(new int[]{0, 0, (int) deskewRoi[2], (int) deskewRoi[3]});
            r.bounds = boundingRect(shiftedQuad(roi, deskewRoi[0], deskewRoi[1]), cols, rows);
        } else {
            r.bounds = boundingRect(quad, cols, rows);
        }
        r.destination = quadFromRect(r.bounds);
        r.currentBox = quadBox(r.destination);
        r.target = targetBox(owner, raceKey, ghostDetail, race3Content, race7Content);
        r.align = canonicalAlign(r.currentBox, r.target.box);
        r.affine = alignMatrix(r.align);
        r.composed = compose(r.affine, homography);
        r.antialias = antialiasPlan(r.align, cols, rows);
        if (r.antialias != null) r.composed = compose(r.composed, r.antialias.unscale);
        r.fin = registration == null ? r.composed : compose(registration, r.composed);
        r.warpSource = r.antialias == null ? new int[]{cols, rows} : new int[]{r.antialias.reducedW, r.antialias.reducedH};
        return r;
    }
}
