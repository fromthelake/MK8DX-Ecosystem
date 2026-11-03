package nl.mariokart8.iconmatcher;

import java.util.List;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The central open-set character decision (CENTRAL_RECOGNITION section 8.7): the Java port of
 * python/mk8dx_icon_matcher/open_set.py (the reference) and ts/sharedOpenSet.ts. A Mii is no
 * character the references can hold, so an unaccepted character read without a clear winner
 * suggests "Mii": never accepted, without a size (the catalog's bare Mii, character.mii_medium).
 */
public final class OpenSet {
    public static final String MII_ID = "character.mii_medium";
    public static final String MII_LABEL = "Mii";
    public static final String MII_EVIDENCE = "open_set_mii";
    public static final String[] MII_LOOKALIKES = {"character.pauline", "character.champion_link"};
    /** Per profile the visual top score must stay below this; NaN = no measured threshold. */
    public static final double SCOREBOARD_MAX_SCORE = 0.84;
    public static final double RESULT_MAX_SCORE = 0.81;
    /** Per profile the gap to the best other family must stay below this; NaN = not used. */
    public static final double SCOREBOARD_MAX_FAMILY_MARGIN = Double.NaN;
    public static final double RESULT_MAX_FAMILY_MARGIN = 0.012;
    /** What the suggestion does: "propose" makes Mii the proposed value, "alternative" offers it
     * beside the best match (cards: unread real characters share the no-clear-winner zone). */
    public static final String SCOREBOARD_MODE = "propose";
    public static final String RESULT_MODE = "alternative";

    private OpenSet() {
    }

    /** The first score minus the best score of another family, or NaN; top items carry id, familyId, score. */
    public static double familyMargin(List<JSONObject> top) throws JSONException {
        if (top.isEmpty()) return Double.NaN;
        String family = top.get(0).optString("familyId", top.get(0).getString("id"));
        double first = top.get(0).getDouble("score");
        for (int i = 1; i < top.size(); i++) {
            JSONObject item = top.get(i);
            if (!family.equals(item.optString("familyId", item.getString("id")))) return first - item.getDouble("score");
        }
        return Double.NaN;
    }

    /** The Mii suggestion for an unaccepted read, or null. */
    public static JSONObject miiSuggestion(String profile, List<JSONObject> top, String acceptedId) throws JSONException {
        double maxScore = "scoreboard".equals(profile) ? SCOREBOARD_MAX_SCORE : "result".equals(profile) ? RESULT_MAX_SCORE : Double.NaN;
        double maxMargin = "scoreboard".equals(profile) ? SCOREBOARD_MAX_FAMILY_MARGIN
                : "result".equals(profile) ? RESULT_MAX_FAMILY_MARGIN : Double.NaN;
        if (acceptedId != null || Double.isNaN(maxScore) || top.isEmpty()) return null;
        double score = top.get(0).getDouble("score");
        double margin = familyMargin(top);
        if (score >= maxScore) return null;
        if (!Double.isNaN(maxMargin) && !Double.isNaN(margin) && margin >= maxMargin) return null;
        return new JSONObject().put("id", MII_ID).put("label", MII_LABEL).put("evidence", MII_EVIDENCE)
                .put("mode", "scoreboard".equals(profile) ? SCOREBOARD_MODE : RESULT_MODE)
                .put("score", score).put("familyMargin", Double.isNaN(margin) ? JSONObject.NULL : margin);
    }
}
