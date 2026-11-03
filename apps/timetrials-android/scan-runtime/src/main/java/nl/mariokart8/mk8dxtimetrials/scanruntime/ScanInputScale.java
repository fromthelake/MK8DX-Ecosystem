package nl.mariokart8.mk8dxtimetrials.scanruntime;

import android.graphics.Bitmap;

/**
 * Brings a camera frame down to the size the recognizer was built for.
 *
 * The preserved engine shrinks its card region into a 1280x720 working image
 * with a plain bilinear warp. That is exact for the frames it was validated on
 * (960x540 live frames, 1280x720 and 1920x1080 stills), but a 12 MP photo makes
 * it shrink by four or more, and bilinear sampling then skips most pixels and
 * breaks the thin gaps between seven-segment bars. Shrinking here first, in
 * halving steps that each average neighbouring pixels, hands the engine a
 * picture in its own range without touching the engine.
 */
public final class ScanInputScale {
    private ScanInputScale() {
    }

    /**
     * A copy no larger than {@code maxLongSide} on its longer side, or the
     * input itself when it already fits. The input is never recycled here.
     */
    public static Bitmap toLongSide(Bitmap source, int maxLongSide) {
        int width = source.getWidth();
        int height = source.getHeight();
        int longSide = Math.max(width, height);
        if (maxLongSide <= 0 || longSide <= maxLongSide) {
            return source;
        }
        Bitmap current = source;
        // Halve while a whole halving still stays at or above the target: each
        // 2:1 bilinear step averages the four pixels it replaces.
        while (Math.max(current.getWidth(), current.getHeight()) / 2 >= maxLongSide) {
            Bitmap half = Bitmap.createScaledBitmap(
                    current,
                    Math.max(1, current.getWidth() / 2),
                    Math.max(1, current.getHeight() / 2),
                    true);
            if (current != source) {
                current.recycle();
            }
            current = half;
        }
        double factor = (double) maxLongSide / Math.max(current.getWidth(), current.getHeight());
        if (factor < 1.0) {
            Bitmap last = Bitmap.createScaledBitmap(
                    current,
                    Math.max(1, (int) Math.round(current.getWidth() * factor)),
                    Math.max(1, (int) Math.round(current.getHeight() * factor)),
                    true);
            if (current != source) {
                current.recycle();
            }
            current = last;
        }
        return current;
    }
}
