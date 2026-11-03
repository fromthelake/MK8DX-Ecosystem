package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * One result-card field read with the shared refinement profile, in the web
 * engine's {@code shared_icon_qa} record format (Python:
 * result_evidence.field_evidence). The product supplies the normalized crop
 * (INTER_AREA to the group size, RGB 0..1) and its pixel hash.
 */
public final class FieldEvidence {
    private FieldEvidence() {
    }

    public static JSONObject read(float[] query, IconGroup group, String kind, String catalogSha256,
                                  String cropPixelSha256) throws JSONException {
        return read(query, group, kind, "result", catalogSha256, cropPixelSha256);
    }

    /** {@code profile} names the reference group: "result", or "ghost_select" for the Select-a-Ghost character. */
    public static JSONObject read(float[] query, IconGroup group, String kind, String profile, String catalogSha256,
                                  String cropPixelSha256) throws JSONException {
        IconScorer.Match match = IconScorer.match(query, group);
        JSONArray top = new JSONArray();
        List<String> topIds = new ArrayList<>();
        for (int i = 0; i < match.topIds.size(); i++) {
            top.put(new JSONObject().put("id", match.topIds.get(i)).put("familyId", match.topFamilies.get(i))
                    .put("score", match.topScores.get(i)));
            topIds.add(match.topIds.get(i));
        }
        JSONObject read = new JSONObject().put("schema", "mk8dx.visual-field-read.v1").put("kind", kind)
                .put("profile", profile).put("method", "rgb").put("catalogSha256", catalogSha256)
                .put("cropPixelSha256", cropPixelSha256).put("status", match.status).put("top1Id", match.top1Id)
                .put("acceptedId", match.acceptedId == null ? JSONObject.NULL : match.acceptedId)
                .put("score", match.score).put("margin", match.margin)
                .put("familyMargin", match.familyMargin == null ? JSONObject.NULL : match.familyMargin)
                .put("offset", new JSONArray().put(match.offset[0]).put(match.offset[1])).put("top", top);
        JSONObject shape = null;
        if ("flags".equals(kind) || "tires".equals(kind)) {
            shape = Refinements.shapeRank(query, group, "flags".equals(kind) ? "full_rgb_ncc" : "masked_gray_ncc")
                    .put("cropPixelSha256", cropPixelSha256);
        }
        Object neutral = JSONObject.NULL, colour = JSONObject.NULL, distinct = JSONObject.NULL,
                tricolor = JSONObject.NULL, exposure = JSONObject.NULL, bandRatio = JSONObject.NULL;
        if ("characters".equals(kind) && "result".equals(profile)) {
            neutral = Refinements.neutralChroma(query, group, match).put("cropPixelSha256", cropPixelSha256);
            JSONObject ranked = Refinements.familyColour(query, group, match);
            if (ranked != null) colour = ranked.put("cropPixelSha256", cropPixelSha256);
        }
        if ("flags".equals(kind)) {
            JSONArray distinctTop = Refinements.distinctiveFlagRank(query, group, topIds);
            distinct = new JSONObject().put("schema", "mk8dx.flag-distinctive-shadow.v1")
                    .put("cropPixelSha256", cropPixelSha256).put("originalTop1Id", match.top1Id).put("top", distinctTop);
            if (match.score >= .80) {
                tricolor = Refinements.flagTricolor(query, group, topIds,
                        distinctTop.getJSONObject(0).getString("id"), shape).put("cropPixelSha256", cropPixelSha256);
            }
            exposure = Refinements.flagExposure(query, group, shape).put("cropPixelSha256", cropPixelSha256);
            if (topIds.contains("country.nl") || topIds.contains("country.lu")) {
                bandRatio = Refinements.flagBandRatio(query).put("cropPixelSha256", cropPixelSha256);
            }
        }
        return read.put("flag_distinctive_qa", distinct).put("flag_tricolor_qa", tricolor).put("flag_band_ratio_qa", bandRatio)
                .put("flag_exposure_qa", exposure).put("shape_rank_qa", shape == null ? JSONObject.NULL : shape)
                .put("neutral_chroma_qa", neutral).put("family_colour_qa", colour);
    }
}
