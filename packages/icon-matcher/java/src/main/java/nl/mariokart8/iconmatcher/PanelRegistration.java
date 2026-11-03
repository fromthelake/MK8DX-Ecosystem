package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The central Select-a-Ghost panel registration decision (CENTRAL_RECOGNITION section 8.6, phase 5):
 * the Java port of python/mk8dx_icon_matcher/panel_registration.py (the reference) and
 * ts/sharedPanelRegistration.ts, kept equal by the parity vectors (tooling/recognition/
 * panel_registration_vectors.py, vectors/panel-registration-v1.json). The product hands in its pixel
 * work: the anchor template match (peak and its four neighbours, NaN at the border) and OpenCV's
 * findHomography (RANSAC, 2 px).
 */
public final class PanelRegistration {
    public static final int SEARCH_X = 30;
    public static final int SEARCH_Y = 12;
    private static final double MIN_SCORE = 0.45;
    private static final int MIN_ANCHORS = 8;
    private static final double MIN_INLIER_SHARE = 0.7;
    private static final double MAX_SHIFT = 40.0;
    public static final double RANSAC_THRESHOLD = 2.0;

    private PanelRegistration() {
    }

    /** The product's pixel work. */
    public interface Pixels {
        /** {score, x, y, left, right, up, down}: the peak and its neighbours (NaN at the map's border). */
        double[] match(int index, int[] window) throws Exception;

        /** The homography through found -> reference: h (9 numbers row by row, null when none) and inliers. */
        Homography homography(List<double[]> found, List<double[]> reference) throws Exception;
    }

    /** findHomography's answer. */
    public static final class Homography {
        public final double[] h;
        public final int inliers;

        public Homography(double[] h, int inliers) {
            this.h = h;
            this.inliers = inliers;
        }
    }

    /** The decision: h (null when not applied) and the diagnostics in the products' info keys. */
    public static final class Result {
        public final double[] h;
        public final Map<String, Object> info;

        Result(double[] h, Map<String, Object> info) {
            this.h = h;
            this.info = info;
        }
    }

    /** {left, top, right, bottom} searched around an anchor's reference box, or null. */
    public static int[] anchorWindow(int[] box, int imageW, int imageH) {
        int wl = Math.max(0, box[0] - SEARCH_X);
        int wt = Math.max(0, box[1] - SEARCH_Y);
        int wr = Math.min(imageW, box[2] + SEARCH_X);
        int wb = Math.min(imageH, box[3] + SEARCH_Y);
        if (wr - wl < (box[2] - box[0]) + 2 || wb - wt < (box[3] - box[1]) + 2) return null;
        return new int[]{wl, wt, wr, wb};
    }

    public static double subPixelPeak(double before, double peak, double after) {
        if (Double.isNaN(before) || Double.isNaN(after)) return 0.0;
        double den = before - 2.0 * peak + after;
        return den == 0.0 ? 0.0 : 0.5 * (before - after) / den;
    }

    public static Result registerPanel(String variant, List<int[]> boxes, int imageW, int imageH, Pixels pixels) throws Exception {
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("variant", variant);
        info.put("anchors", boxes.size());
        info.put("applied", false);
        List<double[]> found = new ArrayList<>();
        List<double[]> reference = new ArrayList<>();
        for (int index = 0; index < boxes.size(); index++) {
            int[] box = boxes.get(index);
            int[] window = anchorWindow(box, imageW, imageH);
            if (window == null) continue;
            double[] m = pixels.match(index, window);
            if (m[0] < MIN_SCORE) continue;
            double px = m[1] + subPixelPeak(m[3], m[0], m[4]);
            double py = m[2] + subPixelPeak(m[5], m[0], m[6]);
            found.add(new double[]{window[0] + px + (box[2] - box[0]) / 2.0, window[1] + py + (box[3] - box[1]) / 2.0});
            reference.add(new double[]{(box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0});
        }
        int n = found.size();
        info.put("found", n);
        if (n < MIN_ANCHORS) {
            info.put("reason", "too_few_anchors");
            return new Result(null, info);
        }
        Homography hom = pixels.homography(found, reference);
        info.put("inliers", hom.inliers);
        double[] h = hom.h;
        if (h == null || hom.inliers < MIN_ANCHORS || hom.inliers < MIN_INLIER_SHARE * n) {
            info.put("reason", "anchors_disagree");
            return new Result(null, info);
        }
        double shift = 0.0;
        double sumSq = 0.0;
        for (int i = 0; i < n; i++) {
            double x = found.get(i)[0];
            double y = found.get(i)[1];
            double w = h[6] * x + h[7] * y + h[8];
            double qx = (h[0] * x + h[1] * y + h[2]) / w;
            double qy = (h[3] * x + h[4] * y + h[5]) / w;
            shift = Math.max(shift, Math.hypot(qx - x, qy - y));
            double dx = qx - reference.get(i)[0];
            double dy = qy - reference.get(i)[1];
            sumSq += dx * dx + dy * dy;
        }
        info.put("max_shift_px", shift);
        info.put("rms_px", Math.sqrt(sumSq / n));
        if (shift > MAX_SHIFT) {
            info.put("reason", "implausible_shift");
            return new Result(null, info);
        }
        info.put("applied", true);
        return new Result(h.clone(), info);
    }
}
