package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The central card-detector post-processing (CENTRAL_RECOGNITION section 8.6, phase 5): the Java
 * port of python/mk8dx_icon_matcher/detections.py (the reference) and ts/sharedDetections.ts, kept
 * equal by the parity vectors (tooling/recognition/detections_vectors.py). Running the model stays
 * with the product; {@link #parse} decides what its raw output means (float32 arithmetic) and
 * {@link #cleanLapIndex} removes at most one weak extra badge per rule.
 */
public final class Detections {
    public static final float DETECT_THRESHOLD = 0.2f;
    public static final String[] CLASS_NAMES = {"ghost_timetrail_box", "player_timetrail_box", "lap_index", "background"};
    private static final int MAX_DETECTIONS = 40;

    private Detections() {
    }

    /** A normalised detection box (0..1). */
    public static final class Box {
        public final String label;
        public final float score;
        public final float left;
        public final float top;
        public final float right;
        public final float bottom;

        public Box(String label, float score, float left, float top, float right, float bottom) {
            this.label = label;
            this.score = score;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }
    }

    private static float clamp(float v, float lo, float hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    public static List<Box> parse(float[] boxes, float[] logits, int count, int numClasses, int width, int height) {
        List<Box> out = new ArrayList<>();
        int nCls = Math.min(3, numClasses);
        for (int i = 0; i < count; i++) {
            for (int cls = 0; cls < nCls; cls++) {
                float score = (float) (1.0 / (1.0 + Math.exp(-logits[i * numClasses + cls])));
                if (score < DETECT_THRESHOLD) continue;
                float cx = boxes[i * 4];
                float cy = boxes[i * 4 + 1];
                float bw = boxes[i * 4 + 2];
                float bh = boxes[i * 4 + 3];
                float left = clamp((cx - bw / 2.0f) * width, 0, width);
                float top = clamp((cy - bh / 2.0f) * height, 0, height);
                float right = clamp((cx + bw / 2.0f) * width, 0, width);
                float bottom = clamp((cy + bh / 2.0f) * height, 0, height);
                out.add(new Box(CLASS_NAMES[cls], score, left / width, top / height, right / width, bottom / height));
            }
        }
        Collections.sort(out, (a, b) -> Float.compare(b.score, a.score));
        return out.size() > MAX_DETECTIONS ? new ArrayList<>(out.subList(0, MAX_DETECTIONS)) : out;
    }

    private static double upperMedian(List<Double> values) {
        List<Double> ordered = new ArrayList<>(values);
        Collections.sort(ordered);
        return ordered.get(ordered.size() / 2);
    }

    private static double centerX(Box d) {
        return ((double) d.left + d.right) / 2;
    }

    private static double centerY(Box d) {
        return ((double) d.top + d.bottom) / 2;
    }

    private static List<Box> badges(List<Box> ds) {
        List<Box> out = new ArrayList<>();
        for (Box d : ds) if ("lap_index".equals(d.label)) out.add(d);
        return out;
    }

    private static Box bestOwner(List<Box> ds, String label) {
        Box best = null;
        for (Box d : ds) {
            if (label.equals(d.label) && d.score >= 0.8 && (best == null || d.score > best.score)) best = d;
        }
        return best;
    }

    private static boolean inside(Box d, Box box) {
        double cy = centerY(d);
        return cy >= box.top && cy <= box.bottom;
    }

    private static double overlap(Box a, Box b) {
        double areaA = Math.max(0, (double) a.right - a.left) * Math.max(0, (double) a.bottom - a.top);
        double areaB = Math.max(0, (double) b.right - b.left) * Math.max(0, (double) b.bottom - b.top);
        double inter = Math.max(0, Math.min((double) a.right, b.right) - Math.max((double) a.left, b.left))
            * Math.max(0, Math.min((double) a.bottom, b.bottom) - Math.max((double) a.top, b.top));
        double union = areaA + areaB - inter;
        return union > 0 ? inter / union : 0;
    }

    /** One weak off-column badge beside six strong ones in one column; null when the rule does not apply. */
    public static Box weakLapIndexOutlier(List<Box> ds) {
        List<Box> bs = badges(ds);
        if (bs.size() != 7) return null;
        List<Box> strong = new ArrayList<>();
        List<Box> weak = new ArrayList<>();
        for (Box d : bs) {
            if (d.score >= 0.85) strong.add(d);
            if (d.score <= 0.45) weak.add(d);
        }
        if (strong.size() != 6 || weak.size() != 1) return null;
        List<Double> xs = new ArrayList<>();
        List<Double> ws = new ArrayList<>();
        for (Box d : strong) {
            xs.add(centerX(d));
            ws.add((double) d.right - d.left);
        }
        double columnX = upperMedian(xs);
        double badgeWidth = upperMedian(ws);
        if (badgeWidth <= 0) return null;
        for (Box d : strong) if (Math.abs(centerX(d) - columnX) > badgeWidth * 0.25) return null;
        if (Math.abs(centerX(weak.get(0)) - columnX) <= badgeWidth * 0.4) return null;
        return weak.get(0);
    }

    /** One weak badge duplicating a stronger one, when both three-row cards stay supported. */
    public static Box weakDuplicateLapIndex(List<Box> ds) {
        List<Box> bs = badges(ds);
        if (bs.size() != 7) return null;
        Box player = bestOwner(ds, "player_timetrail_box");
        Box ghost = bestOwner(ds, "ghost_timetrail_box");
        if (player == null || ghost == null || centerY(ghost) >= centerY(player)) return null;
        List<Box> duplicates = new ArrayList<>();
        for (int i = 0; i < bs.size(); i++) {
            for (int j = i + 1; j < bs.size(); j++) {
                Box a = bs.get(i);
                Box b = bs.get(j);
                Box weaker = a.score <= b.score ? a : b;
                Box stronger = weaker == a ? b : a;
                if (overlap(a, b) >= 0.9 && weaker.score <= 0.5 && stronger.score >= 0.65) duplicates.add(weaker);
            }
        }
        if (duplicates.size() != 1) return null;
        int inGhost = 0;
        int inPlayer = 0;
        for (Box d : bs) {
            if (d == duplicates.get(0)) continue;
            boolean g = inside(d, ghost);
            boolean p = inside(d, player);
            if (g == p) return null;
            if (g) inGhost++;
            if (p) inPlayer++;
        }
        if (inGhost != 3 || inPlayer != 3) return null;
        return duplicates.get(0);
    }

    /** One weak extra badge when both owners keep a complete three-row badge lattice. */
    public static Box weakOffLatticeLapIndex(List<Box> ds) {
        List<Box> bs = badges(ds);
        if (bs.size() != 7) return null;
        List<Box> weak = new ArrayList<>();
        List<Box> strong = new ArrayList<>();
        for (Box d : bs) {
            if (d.score <= 0.55) weak.add(d);
            if (d.score >= 0.8) strong.add(d);
        }
        if (weak.size() != 1 || strong.size() != 6) return null;
        Box player = bestOwner(ds, "player_timetrail_box");
        Box ghost = bestOwner(ds, "ghost_timetrail_box");
        if (player == null || ghost == null) return null;
        Box[] owners = {player, ghost};
        for (Box d : strong) {
            int n = 0;
            for (Box box : owners) if (inside(d, box)) n++;
            if (n != 1) return null;
        }
        for (Box box : owners) {
            List<Double> rows = new ArrayList<>();
            for (Box d : strong) if (inside(d, box)) rows.add(centerY(d));
            Collections.sort(rows);
            double height = (double) box.bottom - box.top;
            if (rows.size() != 3 || height <= 0) return null;
            double g1 = (rows.get(1) - rows.get(0)) / height;
            double g2 = (rows.get(2) - rows.get(1)) / height;
            if (g1 < 0.16 || g1 > 0.23 || g2 < 0.16 || g2 > 0.23) return null;
        }
        List<Double> xs = new ArrayList<>();
        List<Double> ws = new ArrayList<>();
        for (Box d : strong) {
            xs.add(centerX(d));
            ws.add((double) d.right - d.left);
        }
        double columnX = upperMedian(xs);
        double badgeWidth = upperMedian(ws);
        if (badgeWidth <= 0) return null;
        for (Box d : strong) if (Math.abs(centerX(d) - columnX) > badgeWidth * 0.3) return null;
        return weak.get(0);
    }

    /** Duplicate, then outlier, then off-lattice (both scanners' order). */
    public static List<Box> cleanLapIndex(List<Box> ds) {
        List<Box> out = ds;
        Box removed = weakDuplicateLapIndex(out);
        if (removed != null) out = without(out, removed);
        removed = weakLapIndexOutlier(out);
        if (removed != null) out = without(out, removed);
        removed = weakOffLatticeLapIndex(out);
        if (removed != null) out = without(out, removed);
        return out;
    }

    private static List<Box> without(List<Box> ds, Box removed) {
        List<Box> out = new ArrayList<>();
        for (Box d : ds) if (d != removed) out.add(d);
        return out;
    }
}
