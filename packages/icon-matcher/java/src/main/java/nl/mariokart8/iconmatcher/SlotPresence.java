package nl.mariokart8.iconmatcher;

/**
 * The central slot-presence decision (CENTRAL_RECOGNITION section 8.6): the Java port of
 * python/mk8dx_icon_matcher/slot_presence.py (the reference) and ts/sharedSlotPresence.ts. Whether
 * an icon or flag slot holds a picture or only flat card background; the product measures the slot
 * and hands the statistic in (photo: grey-value standard deviation; hdmi: mean per-channel spatial
 * standard deviation).
 */
public final class SlotPresence {
    public static final double PHOTO_ICON_MIN_GRAY_STD = 21.5;
    public static final double PHOTO_FLAG_MIN_GRAY_STD = 20.0;
    public static final double HDMI_FLAG_MIN_CHANNEL_STD = 40.0;

    private SlotPresence() {
    }

    /** The threshold for a source ("photo", "hdmi") and kind ("icon", "flag"), or NaN for none. */
    public static double threshold(String source, String kind) {
        if ("photo".equals(source)) {
            return "icon".equals(kind) ? PHOTO_ICON_MIN_GRAY_STD : "flag".equals(kind) ? PHOTO_FLAG_MIN_GRAY_STD : Double.NaN;
        }
        if ("hdmi".equals(source)) {
            return "flag".equals(kind) ? HDMI_FLAG_MIN_CHANNEL_STD : Double.NaN;
        }
        throw new IllegalArgumentException("unknown source " + source);
    }

    /** Whether the slot holds a picture; a source without a threshold for the kind accepts it. */
    public static boolean present(String source, String kind, double value) {
        double threshold = threshold(source, kind);
        return Double.isNaN(threshold) || value >= threshold;
    }
}
