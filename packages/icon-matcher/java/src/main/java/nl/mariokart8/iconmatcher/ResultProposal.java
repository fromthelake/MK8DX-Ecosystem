package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Result-screen decision from one owner's shared reads (ts/sharedResultProposal.ts
 * composeResultProposal, Python result_proposal.compose_result_proposal): the
 * same evidence in, the same proposal out, checked on shared vectors.
 */
public final class ResultProposal {
    public static final String[] FIELDS = {"character", "kart", "wheel", "glider", "flag"};

    private ResultProposal() {
    }

    private static String kindOf(String field) {
        switch (field) {
            case "character": return "characters";
            case "kart": return "bodies";
            case "wheel": return "tires";
            case "glider": return "gliders";
            default: return "flags";
        }
    }

    private static JSONObject visual(Object value) {
        return value instanceof JSONObject && "mk8dx.visual-field-read.v1".equals(((JSONObject) value).optString("schema"))
                ? (JSONObject) value : null;
    }

    private static JSONObject obj(JSONObject parent, String key) {
        Object value = parent == null ? null : parent.opt(key);
        return value instanceof JSONObject ? (JSONObject) value : null;
    }

    private static String str(JSONObject parent, String key) {
        Object value = parent == null ? null : parent.opt(key);
        return value instanceof String ? (String) value : null;
    }

    private static boolean finite(Object value) {
        return value instanceof Number && Double.isFinite(((Number) value).doubleValue());
    }

    private static boolean same(Object a, Object b) {
        return a == null ? b == null : a.equals(b);
    }

    private static Object orNull(Object value) {
        return value == null ? JSONObject.NULL : value;
    }

    private static JSONObject candidate(String id, Object matchScore, Object fuzzy, Object distance, String basis)
            throws JSONException {
        return new JSONObject().put("id", id).put("matchScore", orNull(matchScore)).put("textFuzzy", orNull(fuzzy))
                .put("distinctiveDistance", orNull(distance)).put("basis", basis);
    }

    private static final double NL_LU_GAP = 0.05;

    /** LU's distinctive distance minus NL's when NL ranks first (LU absent: infinite). */
    private static double luGap(JSONArray top) throws JSONException {
        if (top == null || top.length() == 0 || !"country.nl".equals(top.getJSONObject(0).optString("id"))) {
            return Double.NEGATIVE_INFINITY;
        }
        for (int i = 0; i < top.length(); i++) {
            if ("country.lu".equals(top.getJSONObject(i).optString("id"))) {
                return top.getJSONObject(i).getDouble("distance") - top.getJSONObject(0).getDouble("distance");
            }
        }
        return Double.POSITIVE_INFINITY;
    }

    private static boolean hasId(List<JSONObject> list, String id) {
        for (JSONObject item : list) {
            if (id.equals(item.optString("id"))) return true;
        }
        return false;
    }

    private static JSONObject composeField(String field, JSONObject entry) throws JSONException {
        if (entry == null) entry = new JSONObject();
        JSONObject selected = visual(entry.opt("shared_icon_qa"));
        JSONObject slot = visual(entry.opt("character_slot_qa"));
        JSONObject tireWindow = visual(entry.opt("tire_window_qa"));
        JSONObject context = "character".equals(field) ? obj(entry, "character_text_qa")
                : "flag".equals(field) ? null : obj(entry, "part_text_qa");
        JSONObject read;
        if ("character".equals(field) && context != null && "slot".equals(str(context, "chosenBasis")) && slot != null) {
            read = slot;
        } else if ("wheel".equals(field) && context != null && str(context, "cropPixelSha256") != null
                && !str(context, "cropPixelSha256").isEmpty() && tireWindow != null
                && same(str(tireWindow, "cropPixelSha256"), str(context, "cropPixelSha256"))) {
            read = tireWindow;
        } else {
            read = selected;
        }
        JSONArray readTop = read == null ? null : read.optJSONArray("top");
        // The Select-a-Ghost panel reads its character with the ghost_select
        // references; every other field, and every result-card field, with result.
        boolean profileOk = read != null && ("result".equals(str(read, "profile"))
                || ("character".equals(field) && "ghost_select".equals(str(read, "profile"))));
        boolean valid = profileOk && kindOf(field).equals(str(read, "kind"))
                && readTop != null && readTop.length() > 0;
        JSONObject vis = valid ? read : null;
        JSONObject chosen = context == null ? null : obj(context, "chosen");
        List<JSONObject> rawTop = new ArrayList<>();
        if (vis != null) {
            for (int i = 0; i < Math.min(3, readTop.length()); i++) rawTop.add(readTop.getJSONObject(i));
        }
        String visCrop = vis == null ? null : str(vis, "cropPixelSha256");

        JSONObject distinctive = "flag".equals(field) && vis != null ? obj(vis, "flag_distinctive_qa") : null;
        JSONArray distinctTop = null;
        if (distinctive != null && same(str(distinctive, "cropPixelSha256"), visCrop) && rawTop.size() == 3) {
            JSONArray dtop = distinctive.optJSONArray("top");
            if (dtop != null && dtop.length() == 3) {
                boolean ok = true;
                Set<String> ids = new HashSet<>();
                for (int i = 0; i < 3; i++) {
                    JSONObject c = dtop.getJSONObject(i);
                    ok &= finite(c.opt("distance")) && hasId(rawTop, c.optString("id"));
                    ids.add(c.optString("id"));
                }
                if (ok && ids.size() == 3) distinctTop = dtop;
            }
        }
        List<JSONObject> rankedTop = new ArrayList<>();
        if (distinctTop != null) {
            for (int i = 0; i < distinctTop.length(); i++) {
                JSONObject c = distinctTop.getJSONObject(i);
                for (JSONObject item : rawTop) {
                    if (item.optString("id").equals(c.optString("id"))) {
                        rankedTop.add(new JSONObject(item.toString()).put("distinctiveDistance", c.get("distance")));
                        break;
                    }
                }
            }
        } else {
            for (JSONObject item : rawTop) rankedTop.add(new JSONObject(item.toString()).put("distinctiveDistance", JSONObject.NULL));
        }

        String contextAccepted = vis != null && chosen != null && "accepted".equals(str(chosen, "status"))
                && str(chosen, "id") != null && !str(chosen, "id").isEmpty() ? str(chosen, "id") : null;
        // A colour the context proposes for review (the glider colour that follows
        // the character); it leads the proposal but is never accepted by itself.
        String contextSuggested = vis != null && chosen != null && contextAccepted == null
                && str(chosen, "suggestedId") != null && !str(chosen, "suggestedId").isEmpty()
                ? str(chosen, "suggestedId") : null;
        JSONObject colour = "character".equals(field) && vis != null ? obj(vis, "family_colour_qa") : null;
        JSONArray colourRank = null;
        if (colour != null && "mk8dx.family-colour-rank.v1".equals(str(colour, "schema"))
                && "oklab".equals(str(colour, "method")) && "measured".equals(str(colour, "status"))
                && same(str(colour, "cropPixelSha256"), visCrop) && !rawTop.isEmpty()
                && same(str(colour, "familyId"), str(rawTop.get(0), "familyId")) && rawTop.size() >= 2
                && same(str(rawTop.get(1), "familyId"), str(colour, "familyId"))) {
            JSONArray ctop = colour.optJSONArray("top");
            if (ctop != null && ctop.length() >= 2) {
                Set<String> ids = new HashSet<>();
                boolean ok = true;
                for (int i = 0; i < ctop.length(); i++) {
                    ids.add(ctop.getJSONObject(i).optString("id"));
                    ok &= finite(ctop.getJSONObject(i).opt("distance"));
                }
                if (ok && ids.size() == ctop.length() && hasId(rawTop, ctop.getJSONObject(0).optString("id"))) colourRank = ctop;
            }
        }
        JSONArray colourTop = vis != null && "unknown".equals(str(vis, "status")) && contextAccepted == null
                ? colourRank : null;
        // A colour variant settled by the icon (or by a name that names only the
        // family) while the family-colour rank puts another variant of that family
        // first is not settled: show the colour rank's best match for review.
        boolean colourDoubt = false;
        if (colourRank != null && colourTop == null) {
            String settled = contextAccepted != null ? contextAccepted : str(vis, "acceptedId");
            JSONArray chosenEvidence = chosen == null ? null : chosen.optJSONArray("evidence");
            boolean exact = false;
            for (int i = 0; chosenEvidence != null && i < chosenEvidence.length(); i++) {
                exact |= "exact_name".equals(chosenEvidence.optString(i));
            }
            boolean inFamily = false;
            for (int i = 0; settled != null && i < colourRank.length(); i++) {
                inFamily |= settled.equals(colourRank.getJSONObject(i).optString("id"));
            }
            if (settled != null && !exact && !settled.equals(colourRank.getJSONObject(0).optString("id"))
                    && inFamily) {
                colourTop = colourRank;
                contextAccepted = null;
                colourDoubt = true;
            }
        }
        if (colourTop != null) {
            List<JSONObject> reordered = new ArrayList<>();
            Set<String> colourIds = new HashSet<>();
            for (int i = 0; i < colourTop.length(); i++) {
                String id = colourTop.getJSONObject(i).optString("id");
                colourIds.add(id);
                for (JSONObject item : rankedTop) {
                    if (item.optString("id").equals(id)) reordered.add(item);
                }
            }
            for (JSONObject item : rankedTop) {
                if (!colourIds.contains(item.optString("id"))) reordered.add(item);
            }
            rankedTop = reordered;
        }

        String visualAccepted = vis == null ? null : str(vis, "acceptedId");
        JSONObject tri = vis == null ? null : obj(vis, "flag_tricolor_qa");
        JSONObject tricolor = "flag".equals(field) && vis != null && "country.nl".equals(str(vis, "top1Id"))
                && distinctTop != null && "country.nl".equals(distinctTop.getJSONObject(0).optString("id"))
                && tri != null && "mk8dx.flag-tricolor-evidence.v1".equals(str(tri, "schema"))
                && "measured".equals(str(tri, "status")) && same(str(tri, "cropPixelSha256"), visCrop) ? tri : null;
        String acceptedId;
        boolean nlSettled = false;
        if (colourDoubt) {
            acceptedId = null;
        } else if (tricolor != null) {
            acceptedId = str(tricolor, "acceptedId");
            // Stripes that cannot be measured apart are no evidence against NL: a
            // settled NL whose distinctive rank keeps LU clearly behind stays.
            if (acceptedId == null && "insufficient_separation".equals(str(tricolor, "reason"))
                    && "country.nl".equals(visualAccepted) && luGap(distinctTop) >= NL_LU_GAP) {
                acceptedId = "country.nl";
                nlSettled = true;
            }
        } else if (context != null) {
            acceptedId = contextAccepted;
        } else {
            acceptedId = distinctTop != null && !same(visualAccepted, distinctTop.getJSONObject(0).optString("id"))
                    ? null : visualAccepted;
        }
        // A photo whose white anchor clipped in blue cannot calibrate the blue tone
        // that separates NL from LU: either flag stays a reviewed best match.
        JSONObject photometric = vis == null ? null : obj(vis, "photometric_qa");
        boolean blueDoubt = "flag".equals(field) && ("country.nl".equals(acceptedId) || "country.lu".equals(acceptedId))
                && photometric != null && ("mk8dx.card-photometric.v1".equals(str(photometric, "schema"))
                        || "mk8dx.panel-photometric.v1".equals(str(photometric, "schema")))
                && "corrected".equals(str(photometric, "status"))
                && Boolean.TRUE.equals(photometric.opt("blueClipped"));
        if (blueDoubt) acceptedId = null;
        JSONObject shape = vis == null ? null : obj(vis, "shape_rank_qa");
        JSONObject luShape = null;
        if (tricolor != null && "country.lu".equals(str(tricolor, "proposalId")) && shape != null
                && same(str(shape, "cropPixelSha256"), visCrop) && "full_rgb_ncc".equals(str(shape, "mode"))) {
            JSONArray stop = shape.optJSONArray("top");
            if (stop != null && stop.length() > 0 && "country.lu".equals(stop.getJSONObject(0).optString("id"))
                    && same(stop.getJSONObject(0).opt("score") instanceof Number
                            ? ((Number) stop.getJSONObject(0).opt("score")).doubleValue() : null,
                    tricolor.opt("proposalShapeScore") instanceof Number
                            ? ((Number) tricolor.opt("proposalShapeScore")).doubleValue() : null)) {
                luShape = stop.getJSONObject(0);
            }
        }
        JSONObject exp = vis == null ? null : obj(vis, "flag_exposure_qa");
        JSONArray exposure = null;
        if ("flag".equals(field) && acceptedId == null && luShape == null && exp != null
                && "mk8dx.flag-exposure-proposal.v1".equals(str(exp, "schema")) && "measured".equals(str(exp, "status"))
                && same(str(exp, "cropPixelSha256"), visCrop)) {
            JSONArray etop = exp.optJSONArray("top");
            if (etop != null && etop.length() >= 2) {
                boolean ok = true;
                for (int i = 0; i < etop.length(); i++) ok &= finite(etop.getJSONObject(i).opt("score"));
                if (ok) exposure = etop;
            }
        }
        JSONObject exposedTop = exposure != null && exposure.length() > 0 && "flags".equals(str(vis, "kind"))
                ? exposure.getJSONObject(0) : null;
        String proposedId = acceptedId != null ? acceptedId
                : luShape != null ? "country.lu"
                : exposedTop != null ? exposedTop.optString("id")
                : contextSuggested != null ? contextSuggested
                : rankedTop.isEmpty() ? null : rankedTop.get(0).optString("id");

        List<JSONObject> top = new ArrayList<>();
        if (luShape != null) top.add(candidate("country.lu", null, null, null, "shape_ncc").put("shapeScore", luShape.get("score")));
        if (exposedTop != null) {
            top.add(candidate(exposedTop.optString("id"), null, null, null, "exposure").put("exposureScore", exposedTop.get("score")));
        }
        if (exposure != null) {
            for (int i = 1; i < exposure.length(); i++) {
                JSONObject item = exposure.getJSONObject(i);
                if (hasId(top, item.optString("id"))) continue;
                top.add(candidate(item.optString("id"), null, null, null, "exposure").put("exposureScore", item.get("score")));
            }
            while (top.size() > 3) top.remove(top.size() - 1);
        }
        JSONObject clue = context == null ? null : obj(context, "clue");
        Object fuzzy = clue == null ? null : (clue.isNull("fuzzy") ? null : clue.opt("fuzzy"));
        if (proposedId != null && (contextAccepted != null || proposedId.equals(contextSuggested))) {
            Object score = null;
            for (JSONObject item : rawTop) {
                if (item.optString("id").equals(proposedId)) {
                    score = item.opt("score");
                    break;
                }
            }
            top.add(candidate(proposedId, score, fuzzy, null, "context"));
        }
        for (JSONObject item : rankedTop) {
            if (top.size() == 3) break;
            String id = item.optString("id");
            if (hasId(top, id)) continue;
            JSONObject colourItem = null;
            if (colourTop != null) {
                for (int i = 0; i < colourTop.length(); i++) {
                    if (colourTop.getJSONObject(i).optString("id").equals(id)) colourItem = colourTop.getJSONObject(i);
                }
            }
            String basis = id.equals(contextAccepted) ? "context" : distinctTop != null ? "distinctive"
                    : colourItem != null ? "family_colour" : "visual";
            JSONObject c = candidate(id, item.opt("score"), id.equals(contextAccepted) ? fuzzy : null,
                    item.isNull("distinctiveDistance") ? null : item.opt("distinctiveDistance"), basis);
            if (colourItem != null) c.put("familyColourDistance", colourItem.get("distance"));
            top.add(c);
            if (top.size() == 3) break;
        }

        String chosenFamily = chosen == null ? null : str(chosen, "familyId");
        String proposedFamily = chosenFamily != null ? chosenFamily
                : luShape != null ? "country.lu"
                : exposedTop != null ? exposedTop.optString("id")
                : rankedTop.isEmpty() ? null : str(rankedTop.get(0), "familyId");
        JSONArray evidence = new JSONArray();
        JSONArray chosenEvidence = chosen == null ? null : chosen.optJSONArray("evidence");
        if (chosenEvidence != null) {
            for (int i = 0; i < chosenEvidence.length(); i++) evidence.put(chosenEvidence.get(i));
        }
        if (distinctTop != null) evidence.put("flag_distinctive_rank");
        if (tricolor != null) evidence.put("flag_tricolor_evidence");
        if (nlSettled) evidence.put("flag_nl_distinctive_settled");
        if (blueDoubt) evidence.put("photometric_blue_clipped");
        if (luShape != null) evidence.put("flag_lu_pattern");
        if (exposedTop != null) evidence.put("flag_exposure_rank");
        if (colourTop != null) evidence.put("family_colour_rank");
        JSONArray visualTop3 = new JSONArray();
        for (JSONObject item : rawTop) {
            visualTop3.put(new JSONObject().put("id", item.get("id")).put("familyId", item.get("familyId")).put("score", item.get("score")));
        }
        JSONObject out = new JSONObject()
                .put("status", proposedId == null ? "unavailable" : acceptedId != null ? "accepted" : "proposed")
                .put("proposedId", orNull(proposedId)).put("selectedId", orNull(proposedId))
                .put("acceptedId", orNull(acceptedId)).put("proposedFamilyId", orNull(proposedFamily))
                .put("reviewRequired", proposedId != null && acceptedId == null)
                .put("cropPixelSha256", orNull(visCrop))
                .put("selectedCropPixelSha256", orNull(selected == null ? null : str(selected, "cropPixelSha256")))
                .put("catalogSha256", orNull(vis == null ? null : str(vis, "catalogSha256")))
                .put("contextStatus", orNull(chosen == null ? null : str(chosen, "status")))
                .put("evidence", evidence).put("top", new JSONArray(top)).put("visualTop3", visualTop3)
                .put("familyColour", colourTop != null ? colour : JSONObject.NULL);
        return openSetDecision(field, vis, rawTop, bandRatioDecision(field, vis, out));
    }

    /** A character the closed set did not accept and without a clear winner: suggest "Mii"
     * (OpenSet.miiSuggestion), never accepted and without a size; the visual top stays the
     * alternatives. */
    private static JSONObject openSetDecision(String field, JSONObject vis, List<JSONObject> rawTop, JSONObject out)
            throws JSONException {
        if (!"character".equals(field) || vis == null || !out.isNull("acceptedId")) return out;
        JSONObject suggestion = OpenSet.miiSuggestion(str(vis, "profile"), rawTop, null);
        if (suggestion == null) return out;
        String id = suggestion.getString("id");
        JSONObject openSet = new JSONObject().put("id", id).put("label", suggestion.get("label"))
                .put("mode", suggestion.get("mode")).put("score", suggestion.get("score"))
                .put("familyMargin", suggestion.get("familyMargin"));
        JSONObject candidate = new JSONObject().put("id", id).put("matchScore", JSONObject.NULL)
                .put("textFuzzy", JSONObject.NULL).put("distinctiveDistance", JSONObject.NULL).put("basis", "open_set");
        JSONArray oldTop = out.getJSONArray("top");
        List<JSONObject> others = new ArrayList<>();
        for (int i = 0; i < oldTop.length(); i++) {
            if (!id.equals(oldTop.getJSONObject(i).optString("id"))) others.add(oldTop.getJSONObject(i));
        }
        JSONArray top = new JSONArray();
        if ("alternative".equals(suggestion.getString("mode"))) {
            // beside the best match: second in the list, the best match stays proposed
            if (!others.isEmpty()) top.put(others.get(0));
            top.put(candidate);
            if (others.size() > 1) top.put(others.get(1));
            out.getJSONArray("evidence").put(suggestion.getString("evidence") + "_alternative");
            return out.put("top", top).put("openSet", openSet);
        }
        top.put(candidate);
        for (int i = 0; i < others.size() && top.length() < 3; i++) top.put(others.get(i));
        out.getJSONArray("evidence").put(suggestion.getString("evidence"));
        return out.put("status", "proposed").put("proposedId", id).put("selectedId", id)
                .put("proposedFamilyId", id).put("reviewRequired", true).put("top", top).put("openSet", openSet);
    }

    static final boolean BAND_RATIO_GUARD = true;

    /** NL and LU differ only in the tone of their blue band. The measured blue to
     * red ratio settles a proposed NL or LU, or keeps it under review when the
     * tone lies between the two flags. */
    private static JSONObject bandRatioDecision(String field, JSONObject vis, JSONObject out) throws JSONException {
        JSONObject band = vis == null ? null : vis.optJSONObject("flag_band_ratio_qa");
        String proposed = out.isNull("proposedId") ? null : out.getString("proposedId");
        if (!(BAND_RATIO_GUARD && "flag".equals(field) && band != null
                && "mk8dx.flag-band-ratio.v1".equals(str(band, "schema")) && "measured".equals(str(band, "status"))
                && same(str(band, "cropPixelSha256"), str(vis, "cropPixelSha256"))
                && ("country.nl".equals(proposed) || "country.lu".equals(proposed)))) return out;
        String decision = band.isNull("decisionId") ? null : band.getString("decisionId");
        JSONArray evidence = out.getJSONArray("evidence");
        if (!"country.nl".equals(decision) && !"country.lu".equals(decision)) {
            evidence.put("flag_band_ratio_between");
            return out.put("status", "proposed").put("acceptedId", JSONObject.NULL).put("reviewRequired", true);
        }
        JSONArray oldTop = out.getJSONArray("top");
        JSONObject first = null;
        for (int i = 0; i < oldTop.length(); i++) {
            if (decision.equals(oldTop.getJSONObject(i).optString("id"))) first = oldTop.getJSONObject(i);
        }
        if (first == null) {
            first = new JSONObject().put("id", decision).put("matchScore", JSONObject.NULL).put("textFuzzy", JSONObject.NULL)
                    .put("distinctiveDistance", JSONObject.NULL).put("basis", "band_ratio");
        }
        JSONArray top = new JSONArray().put(first);
        for (int i = 0; i < oldTop.length() && top.length() < 3; i++) {
            if (!decision.equals(oldTop.getJSONObject(i).optString("id"))) top.put(oldTop.getJSONObject(i));
        }
        evidence.put("flag_band_ratio");
        return out.put("status", "accepted").put("proposedId", decision).put("selectedId", decision)
                .put("acceptedId", decision).put("proposedFamilyId", decision).put("reviewRequired", false).put("top", top);
    }

    public static JSONObject compose(JSONObject owner) throws JSONException {
        JSONObject fields = new JSONObject();
        for (String field : FIELDS) fields.put(field, composeField(field, owner == null ? null : obj(owner, field)));
        return new JSONObject().put("schema", "mk8dx.web-result-field-proposal.v1").put("fields", fields);
    }
}
