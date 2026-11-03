package nl.mariokart8.iconmatcher;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The central frame geometry (CENTRAL_RECOGNITION section 8.6, phase 5): the Java port of
 * python/mk8dx_icon_matcher/frame_geometry.py (the reference) and ts/sharedFrameGeometry.ts, kept
 * equal by the parity vectors (tooling/recognition/frame_geometry_vectors.py). Where a Time Trial
 * card's fields lie on the canonical frame, from the pack's frame-definitions-v1.json (read once
 * here). Rounding is half up (Math.round); the registration window truncates toward zero.
 */
public final class FrameGeometry {
    public static final String SCHEMA = "mk8dx.frame-definitions.v1";
    public static final Map<String, String> REG_GROUP = new HashMap<>();

    static {
        REG_GROUP.put("character_icon", "characters");
        REG_GROUP.put("kart_icon", "bodies");
        REG_GROUP.put("wheel_icon", "tires");
        REG_GROUP.put("glider_icon", "gliders");
        REG_GROUP.put("flag_icon", "flags");
    }

    /** The owner's card. */
    public static final class Panel {
        public final double x;
        public final double y;
        public final double w;
        public final double h;
        public final String source;

        public Panel(double x, double y, double w, double h, String source) {
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
            this.source = source;
        }
    }

    /** race -> owner -> 4 numbers. */
    private final Map<String, Map<String, double[]>> panels;
    private final Map<String, Map<String, double[]>> panelRels;
    private final Map<String, double[]> slots = new HashMap<>();
    private final double[] pad;
    private final double registerHalf;
    private final double registerScoreMin;
    /** "3lap"/"7lap" -> group -> {x, y}. */
    private final Map<String, Map<String, double[]>> offsets;
    private final Map<String, double[]> boxSizes = new HashMap<>();
    private final Map<String, double[]> deployCard = new HashMap<>();
    private final int searchPadIcon;
    private final int searchPadFlag;
    private final double rightCard;
    private final double rightGhostDetail;
    private final int stripGap;
    private final int stripTop;
    private final int stripHeightPad;
    private final double ghostNameRightRatio;

    public FrameGeometry(JSONObject defs) throws JSONException {
        if (!SCHEMA.equals(defs.optString("schema"))) throw new IllegalArgumentException("not " + SCHEMA);
        JSONObject endScreen = defs.getJSONObject("endScreen");
        panels = nested(endScreen.getJSONObject("panels"));
        panelRels = endScreen.isNull("panelRels") ? new HashMap<>() : nested(endScreen.getJSONObject("panelRels"));
        JSONObject rawSlots = endScreen.getJSONObject("slots");
        for (Iterator<String> it = rawSlots.keys(); it.hasNext(); ) {
            String key = it.next();
            slots.put(key, numbers(rawSlots.getJSONObject(key).getJSONArray("rel_xywh")));
        }
        JSONObject reg = defs.getJSONObject("registration");
        pad = numbers(reg.getJSONArray("pad"));
        registerHalf = reg.getDouble("half");
        registerScoreMin = reg.getDouble("scoreMin");
        offsets = nested(reg.getJSONObject("offsets"));
        flat(reg.getJSONObject("boxSizes"), boxSizes);
        flat(reg.getJSONObject("deployCard"), deployCard);
        JSONObject searchPad = defs.getJSONObject("matcher").getJSONObject("searchPad");
        searchPadIcon = searchPad.getInt("icon");
        searchPadFlag = searchPad.getInt("flag");
        JSONObject strip = defs.getJSONObject("textStrip");
        rightCard = strip.getJSONObject("rightRatio").getDouble("card");
        rightGhostDetail = strip.getJSONObject("rightRatio").getDouble("ghostDetail");
        stripGap = strip.getInt("gap");
        stripTop = strip.getInt("top");
        stripHeightPad = strip.getInt("heightPad");
        ghostNameRightRatio = strip.getDouble("ghostNameRightRatio");
    }

    private static double[] numbers(JSONArray array) throws JSONException {
        double[] out = new double[array.length()];
        for (int i = 0; i < out.length; i++) out[i] = array.getDouble(i);
        return out;
    }

    private static void flat(JSONObject object, Map<String, double[]> out) throws JSONException {
        for (Iterator<String> it = object.keys(); it.hasNext(); ) {
            String key = it.next();
            out.put(key, numbers(object.getJSONArray(key)));
        }
    }

    private static Map<String, Map<String, double[]>> nested(JSONObject object) throws JSONException {
        Map<String, Map<String, double[]>> out = new HashMap<>();
        for (Iterator<String> it = object.keys(); it.hasNext(); ) {
            String key = it.next();
            Map<String, double[]> inner = new HashMap<>();
            flat(object.getJSONObject(key), inner);
            out.put(key, inner);
        }
        return out;
    }

    private static int round(double x) {
        return (int) Math.floor(x + 0.5);
    }

    public static boolean isGhostDetail(String raceKey) {
        return "ghost_detail".equals(raceKey) || "ghost_detail7".equals(raceKey);
    }

    /** {race, laps} for an engine race key. */
    public static String[] raceAndLaps(String raceKey) {
        if (isGhostDetail(raceKey)) return new String[]{raceKey, raceKey};
        String race = "race7".equals(raceKey) ? "race7" : "race3";
        return new String[]{race, "race7".equals(race) ? "7laps" : "3laps"};
    }

    /** The owner's card, or null when the frame has no such panel. */
    public Panel panelBox(String raceKey, String owner, double[] anchor) {
        String race = raceAndLaps(raceKey)[0];
        Map<String, double[]> raceRels = panelRels.get(race);
        double[] rel = raceRels == null ? null : raceRels.get(owner);
        if (anchor != null && rel != null) {
            return new Panel(anchor[0] + rel[0], anchor[1] + rel[1], rel[2] - rel[0], rel[3] - rel[1], "lap_index_anchor");
        }
        Map<String, double[]> racePanels = panels.get(race);
        double[] panel = racePanels == null ? null : racePanels.get(owner);
        if (panel == null) return null;
        return new Panel(panel[0], panel[1], panel[2] - panel[0], panel[3] - panel[1], "static_canonical");
    }

    /** {x1, y1, x2, y2} the card registration searches. */
    public int[] registerWindow(Panel panel, int imageW, int imageH) {
        return new int[]{Math.max(0, (int) (panel.x - pad[0])), Math.max(0, (int) (panel.y - pad[1])),
            Math.min(imageW, (int) (panel.x + panel.w + pad[0])), Math.min(imageH, (int) (panel.y + panel.h + pad[2]))};
    }

    /** A field's {x, y, w, h} on the deploy card, scaled to the panel; null without data. */
    public double[] deployBox(String iconKind, String laps, double panelW, double panelH) {
        String group = REG_GROUP.get(iconKind);
        Map<String, double[]> lapOffsets = offsets.get("7laps".equals(laps) ? "7lap" : "3lap");
        double[] off = lapOffsets == null || group == null ? null : lapOffsets.get(group);
        double[] size = group == null ? null : boxSizes.get(group);
        double[] card = deployCard.get(laps);
        if (off == null || size == null || card == null) return null;
        return new double[]{off[0] / card[0] * panelW, off[1] / card[1] * panelH,
            size[0] / card[0] * panelW, size[1] / card[1] * panelH};
    }

    public double[] slotRel(String owner, String iconKind, String laps) {
        double[] rel = slots.get(owner + "_" + iconKind + "_" + laps);
        return rel != null ? rel : slots.get("player_" + iconKind + "_" + laps);
    }

    /** The field's rough slot {x, y, w, h}; registration: {dx, dy, sx, sy} of a registered card, else null. */
    public int[] slotBox(String owner, String iconKind, String laps, Panel panel, double[] registration) {
        double[] rel = slotRel(owner, iconKind, laps);
        if (rel == null) return null;
        double[] box = registration != null ? deployBox(iconKind, laps, panel.w, panel.h) : null;
        if (box != null) {
            return new int[]{round(panel.x + registration[0] + registration[2] * (box[0] + box[2] / 2.0) - box[2] / 2.0),
                round(panel.y + registration[1] + registration[3] * (box[1] + box[3] / 2.0) - box[3] / 2.0),
                round(box[2]), round(box[3])};
        }
        return new int[]{round(panel.x + rel[0] * panel.w), round(panel.y + rel[1] * panel.h),
            round(rel[2] * panel.w), round(rel[3] * panel.h)};
    }

    /** {x1, y1, x2, y2}: the slot widened by the matcher's search pad (smaller for flags). */
    public int[] searchWindow(String iconKind, int[] slot, int imageW, int imageH) {
        int p = "flag_icon".equals(iconKind) ? searchPadFlag : searchPadIcon;
        return new int[]{Math.max(0, slot[0] - p), Math.max(0, slot[1] - p),
            Math.min(imageW, slot[0] + slot[2] + p), Math.min(imageH, slot[1] + slot[3] + p)};
    }

    /** Where printed row text ends (x). */
    public int textRight(Panel panel, boolean ghostDetail) {
        return round(panel.x + (ghostDetail ? rightGhostDetail : rightCard) * panel.w);
    }

    /** {x, y, w, h} of the printed name right of a slot, up to right. */
    public int[] textStrip(int[] slot, int right) {
        int x = slot[0] + slot[2] + stripGap;
        return new int[]{x, slot[1] + stripTop, right - x, slot[3] + stripHeightPad};
    }

    /** Where the rider name ends on the Select-a-Ghost panel (x). */
    public int ghostNameRight(Panel panel) {
        return round(panel.x + ghostNameRightRatio * panel.w);
    }

    private static final double[] REGISTER_SCALES_Y = {0.94, 0.96, 0.98, 1.00, 1.02, 1.04};
    private static final double[] REGISTER_SCALES_X = {0.97, 1.00, 1.03};
    private static final double REGISTER_SCALE_PENALTY = 0.25;
    private static final int REGISTER_MIN_WINDOW = 32;
    private static final int REGISTER_MIN_TEMPLATE = 8;
    private static final int REGISTER_REFINE_MARGIN = 5;
    private static final double REGISTER_REFINE_TOLERANCE = 0.05;

    /** The product's pixel work for the card registration: {score, x, y} of a template match. */
    public interface RegisterMatcher {
        /** The template resized to tw x th on the edge map reduced to registerCoarseSize. */
        double[] coarse(int tw, int th);

        /** The full-size template inside {x1, y1, x2, y2} of the full edge map; x, y relative to it. */
        double[] fine(int x1, int y1, int x2, int y2, int tw, int th);
    }

    /** {w, h} of the reduced edge map the coarse search runs on. */
    public int[] registerCoarseSize(int[] window) {
        return registerCoarseSize(registerHalf, window);
    }

    public static int[] registerCoarseSize(double half, int[] window) {
        return new int[]{round((window[2] - window[0]) * half), round((window[3] - window[1]) * half)};
    }

    /**
     * Where the card's edge template fits: {dx, dy, sx, sy, raw, failed} (offset from the panel's
     * corner, scales, match score, 1 when the card did not register).
     */
    public double[] registerCard(Panel panel, int[] window, RegisterMatcher matcher) {
        return registerCard(registerHalf, registerScoreMin, panel, window, matcher);
    }

    public static double[] registerCard(double half, double scoreMin, Panel panel, int[] window, RegisterMatcher matcher) {
        int ww = window[2] - window[0];
        int wh = window[3] - window[1];
        if (ww < REGISTER_MIN_WINDOW || wh < REGISTER_MIN_WINDOW) return new double[]{0, 0, 1, 1, 0, 1};
        int[] coarseSize = registerCoarseSize(half, window);
        boolean found = false;
        double bestScore = 0;
        double bestX = 0;
        double bestY = 0;
        double bestSx = 1.0;
        double bestSy = 1.0;
        double bestRaw = 0.0;
        for (double sy : REGISTER_SCALES_Y) {
            for (double sx : REGISTER_SCALES_X) {
                int tw = round(panel.w * half * sx);
                int th = round(panel.h * half * sy);
                if (tw < REGISTER_MIN_TEMPLATE || th < REGISTER_MIN_TEMPLATE || tw > coarseSize[0] || th > coarseSize[1]) continue;
                double[] match = matcher.coarse(tw, th);
                double score = match[0] - REGISTER_SCALE_PENALTY * (Math.abs(sy - 1.0) + Math.abs(sx - 1.0));
                if (!found || score > bestScore) {
                    found = true;
                    bestScore = score;
                    bestX = match[1];
                    bestY = match[2];
                    bestSx = sx;
                    bestSy = sy;
                    bestRaw = match[0];
                }
            }
        }
        if (!found) return new double[]{0, 0, 1, 1, 0, 1};
        if (bestRaw < scoreMin) return new double[]{0, 0, 1, 1, bestRaw, 1};
        int tw = round(panel.w * bestSx);
        int th = round(panel.h * bestSy);
        int fx = round(bestX / half);
        int fy = round(bestY / half);
        double raw = bestRaw;
        int x1 = Math.max(0, fx - REGISTER_REFINE_MARGIN);
        int y1 = Math.max(0, fy - REGISTER_REFINE_MARGIN);
        int x2 = Math.min(ww, fx + tw + REGISTER_REFINE_MARGIN);
        int y2 = Math.min(wh, fy + th + REGISTER_REFINE_MARGIN);
        if (y2 - y1 >= th && x2 - x1 >= tw) {
            double[] match = matcher.fine(x1, y1, x2, y2, tw, th);
            if (match[0] >= bestRaw - REGISTER_REFINE_TOLERANCE) {
                fx = x1 + (int) match[1];
                fy = y1 + (int) match[2];
                raw = match[0];
            }
        }
        return new double[]{window[0] + fx - panel.x, window[1] + fy - panel.y, bestSx, bestSy, raw, 0};
    }
}
