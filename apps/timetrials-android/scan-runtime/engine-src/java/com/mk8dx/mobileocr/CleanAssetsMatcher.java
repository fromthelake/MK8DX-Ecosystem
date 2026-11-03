package com.mk8dx.mobileocr;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import org.json.JSONArray;
import org.json.JSONObject;
import org.opencv.android.Utils;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.Rect;
import org.opencv.imgproc.Imgproc;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Port van scripts/clean_assets_matcher.py — de WERKENDE server-identiteitsroute
 * voor character/kart(bodies)/glider. De volledige afgeleide state (gebakken
 * templates op boxmaat, maskers, saturaties, familie-diagnostiekmaskers,
 * chroma-hoeken, char→parts-kleursets, namen) is met de server-code zelf gebakken
 * (scripts/oneshot/bake_apk_clean_assets_pack.py); deze klasse implementeert
 * alleen de besliskern: identify_crop (|dRGB| whole-box masked + gain-correctie +
 * achromatische guard + familie/sibling-refinement) en identify_crop_search
 * (±px TM_SQDIFF-positiezoek in natieve kaartpixels, 2 iteraties).
 */
public final class CleanAssetsMatcher {

    private static final String PACK_ROOT = "clean_assets";
    private static final int[][] DEFAULT_OFFSETS = {{0, 0}, {1, 0}, {-1, 0}, {0, 1}, {0, -1}};
    private static final int[][] CENTER_ONLY = {{0, 0}};

    private final Context context;
    private final JSONObject pack;
    private final Map<String, Group> groups = new HashMap<>();
    private final Map<String, String> siblingPairOf = new HashMap<>();
    private final Map<String, float[]> famMasks = new HashMap<>();
    private final Map<String, float[]> famShapeMasks = new HashMap<>();
    private final Map<String, List<Mat>> sizedRgbCache = new HashMap<>();
    private final Map<String, List<Mat>> sizedMaskCache = new HashMap<>();
    private final Map<String, double[]> sizedSumCache = new HashMap<>();

    private static class Group {
        String name;
        int boxW;
        int boxH;
        List<String> ids = new ArrayList<>();
        double[] sat;
        Map<String, String> names = new HashMap<>();
        Map<String, String> families = new HashMap<>();
        float[][] rgb;      // per ref: BGR float 0..1, interleaved boxW*boxH*3
        float[][] mask;     // per ref: 0/1 float boxW*boxH
        double[] maskSum;
        double[] rgbMaskSum; // sum(rgb*mask) over alle kanalen, voor gain-refMean
        Mat[] refBgr8;      // 8U BGR op boxmaat (voor sized resize)
        Mat[] refMask8;     // 8U masker op boxmaat
    }

    public CleanAssetsMatcher(Context context) throws Exception {
        this.context = context.getApplicationContext();
        this.pack = new JSONObject(readAssetText(PACK_ROOT + "/pack.json"));
        JSONObject boxes = pack.getJSONObject("box");
        JSONObject groupsMeta = pack.getJSONObject("groups");
        Iterator<String> it = groupsMeta.keys();
        while (it.hasNext()) {
            String name = it.next();
            JSONObject meta = groupsMeta.getJSONObject(name);
            JSONArray box = boxes.getJSONArray(name);
            Group group = new Group();
            group.name = name;
            group.boxW = box.getInt(0);
            group.boxH = box.getInt(1);
            JSONArray ids = meta.getJSONArray("ids");
            JSONArray sat = meta.getJSONArray("sat");
            group.sat = new double[ids.length()];
            group.rgb = new float[ids.length()][];
            group.mask = new float[ids.length()][];
            group.maskSum = new double[ids.length()];
            group.rgbMaskSum = new double[ids.length()];
            group.refBgr8 = new Mat[ids.length()];
            group.refMask8 = new Mat[ids.length()];
            for (int i = 0; i < ids.length(); i++) {
                group.ids.add(ids.getString(i));
                group.sat[i] = sat.getDouble(i);
                Mat bgr = readAssetBgr8(PACK_ROOT + "/refs/" + name + "/" + i + ".png");
                Mat mask8 = readAssetGray8(PACK_ROOT + "/masks/" + name + "/" + i + ".png");
                group.refBgr8[i] = bgr;
                group.refMask8[i] = mask8;
                group.rgb[i] = bgr8ToFloat(bgr);
                group.mask[i] = gray8ToBinFloat(mask8);
                double ms = 0.0;
                double rms = 0.0;
                for (int p = 0; p < group.mask[i].length; p++) {
                    float m = group.mask[i][p];
                    if (m > 0f) {
                        ms += m;
                        int pi = p * 3;
                        rms += m * (group.rgb[i][pi] + group.rgb[i][pi + 1] + group.rgb[i][pi + 2]);
                    }
                }
                group.maskSum[i] = ms;
                group.rgbMaskSum[i] = rms;
            }
            JSONObject names = meta.getJSONObject("names");
            Iterator<String> nk = names.keys();
            while (nk.hasNext()) {
                String rid = nk.next();
                group.names.put(rid, names.getString(rid));
            }
            JSONObject fams = meta.getJSONObject("families");
            Iterator<String> fk = fams.keys();
            while (fk.hasNext()) {
                String rid = fk.next();
                group.families.put(rid, fams.getString(rid));
            }
            groups.put(name, group);
        }
        JSONObject sp = pack.optJSONObject("sibling_pair_of");
        if (sp != null) {
            Iterator<String> sk = sp.keys();
            while (sk.hasNext()) {
                String rid = sk.next();
                siblingPairOf.put(rid, sp.getString(rid));
            }
        }
        JSONObject fm = pack.getJSONObject("family_masks");
        Iterator<String> mk = fm.keys();
        while (mk.hasNext()) {
            String key = mk.next();
            famMasks.put(key, gray8ToBinFloatAndRelease(readAssetGray8(PACK_ROOT + "/fam/" + key + ".png")));
        }
        JSONObject shapes = pack.optJSONObject("sibling_pair_shape");
        if (shapes != null) {
            Iterator<String> pk = shapes.keys();
            while (pk.hasNext()) {
                String key = pk.next();
                famShapeMasks.put(key, gray8ToBinFloatAndRelease(readAssetGray8(PACK_ROOT + "/fam/" + key + "_shape.png")));
            }
        }
    }

    public String displayName(String rid, String group) {
        Group g = groups.get(group);
        return g == null ? rid : g.names.getOrDefault(rid, rid);
    }

    private final Map<String, Map<String, String>> vocabCache = new HashMap<>();

    /** Meertalig tekst-vocab: "id#locale" -> naam (alle speltalen, gebakken uit de deploy-db). */
    public synchronized Map<String, String> vocabOf(String group) {
        Map<String, String> cached = vocabCache.get(group);
        if (cached != null) {
            return cached;
        }
        Map<String, String> out = new HashMap<>();
        JSONObject vocab = pack.optJSONObject("vocab");
        JSONObject table = vocab == null ? null : vocab.optJSONObject(group);
        if (table != null) {
            Iterator<String> keys = table.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                out.put(key, table.optString(key, ""));
            }
        }
        vocabCache.put(group, out);
        return out;
    }

    /** [speedLand, acceleration, traction, miniTurbo] voor een onderdeel; null indien onbekend.
     *  group: characters/bodies/gliders op clean-id, of "tires_by_index" op game-index. */
    public double[] statsFor(String group, String key) {
        JSONObject stats = pack.optJSONObject("stats");
        JSONObject table = stats == null ? null : stats.optJSONObject(group);
        org.json.JSONArray row = table == null || key == null ? null : table.optJSONArray(key);
        if (row == null || row.length() < 4) {
            return null;
        }
        double[] out = new double[row.length()];
        for (int i = 0; i < row.length(); i++) {
            out[i] = row.optDouble(i, 0);
        }
        return out;
    }

    /** Reverse-lookup: weergavenaam -> id binnen een groep (voor archiefdata zonder id). */
    public String idForName(String group, String name) {
        Group g = groups.get(group);
        if (g == null || name == null || name.isEmpty()) {
            return null;
        }
        for (Map.Entry<String, String> entry : g.names.entrySet()) {
            if (name.equals(entry.getValue())) {
                return entry.getKey();
            }
        }
        return null;
    }

    /** id -> weergavenaam van een groep (vocab voor tekst-tweede-bewijs). */

    /** Kleurvariant van dit basispart voor dit character (char_to_parts), of het basispart zelf. */
    public String variantFor(String charId, String group, String baseId) {
        JSONObject mapping = pack.optJSONObject("char_to_parts");
        JSONObject charMap = mapping == null || charId == null ? null : mapping.optJSONObject(charId);
        JSONObject groupMap = charMap == null ? null : charMap.optJSONObject(group);
        String variant = groupMap == null ? null : groupMap.optString(baseId, "");
        return variant == null || variant.isEmpty() ? baseId : variant;
    }

    /** Asset-pad (binnen de APK-assets) van het gebakken referentie-icoon voor deze id. */
    public String assetRefFor(String rid, String group) {
        Group g = groups.get(group);
        if (g == null) {
            return null;
        }
        int idx = g.ids.indexOf(rid);
        return idx < 0 ? null : PACK_ROOT + "/refs/" + group + "/" + idx + ".png";
    }

    public static String familyOf(String rid) {
        String[] parts = rid.split("\\.");
        if (parts.length >= 2 && parts[0].endsWith("_variant")) {
            return parts[0].replace("_variant", "") + "." + parts[1];
        }
        return rid;
    }

    /** Kleurset van dit karakter voor bodies/gliders (port van parts_subset_for_character). */
    public List<String> partsSubsetForCharacter(String charId, String group) {
        JSONObject mapping = pack.optJSONObject("char_to_parts");
        JSONObject charMap = mapping == null ? null : mapping.optJSONObject(charId);
        JSONObject groupMap = charMap == null ? null : charMap.optJSONObject(group);
        Group g = groups.get(group);
        if (g == null) {
            return null;
        }
        List<String> subset = new ArrayList<>();
        for (String rid : g.ids) {
            if (rid.split("\\.")[0].endsWith("_variant")) {
                continue;
            }
            String variant = groupMap == null ? null : groupMap.optString(rid, "");
            subset.add(variant == null || variant.isEmpty() ? rid : variant);
        }
        return subset.isEmpty() ? null : subset;
    }

    // ------------------------------------------------------------------
    // identify_crop — port
    // ------------------------------------------------------------------
    public JSONObject identifyCrop(Mat cropBgr, String groupName, Set<String> subsetIds, int[][] offsets, int topk) throws Exception {
        Group g = groups.get(groupName);
        if (g == null || cropBgr.empty()) {
            return new JSONObject().put("id", JSONObject.NULL).put("score", 0.0).put("margin", 0.0);
        }
        if (offsets == null) {
            offsets = DEFAULT_OFFSETS;
        }
        Mat q8 = new Mat();
        Imgproc.resize(cropBgr, q8, new org.opencv.core.Size(g.boxW, g.boxH), 0, 0, Imgproc.INTER_AREA);
        float[] qRaw = bgr8ToFloat(q8);
        int[] idx;
        if (subsetIds != null && !subsetIds.isEmpty()) {
            List<Integer> keep = new ArrayList<>();
            for (int i = 0; i < g.ids.size(); i++) {
                if (subsetIds.contains(g.ids.get(i))) {
                    keep.add(i);
                }
            }
            if (keep.isEmpty()) {
                idx = allIndices(g.ids.size());
            } else {
                idx = new int[keep.size()];
                for (int i = 0; i < keep.size(); i++) {
                    idx[i] = keep.get(i);
                }
            }
        } else {
            idx = allIndices(g.ids.size());
        }
        // gain-correctie (mild, geclampt 0.6-1.8) naar het referentieniveau van de subset
        float[] q = qRaw.clone();
        double refNum = 0.0;
        double refDen = 0.0;
        for (int i : idx) {
            refNum += g.rgbMaskSum[i];
            refDen += g.maskSum[i] * 3.0;
        }
        double refMean = refNum / Math.max(refDen, 1e-6);
        double qMean = 0.0;
        for (float v : q) {
            qMean += v;
        }
        qMean /= q.length;
        if (qMean > 1e-4) {
            double rawGain = refMean / qMean;
            // ghost-kaarten dimmen soms voorbij de server-clip van 1.8; diepe dim
            // gecontroleerd toestaan (tot 2.6) i.p.v. structureel ondercorrigeren
            double maxGain = rawGain > 1.8 ? Math.min(2.6, rawGain) : 1.8;
            float gain = (float) Math.max(0.6, Math.min(maxGain, rawGain));
            for (int p = 0; p < q.length; p++) {
                float v = q[p] * gain;
                q[p] = v < 0f ? 0f : (v > 1f ? 1f : v);
            }
        }
        // |dRGB|-scores, max over offsets
        double[] scores = new double[idx.length];
        for (int k = 0; k < idx.length; k++) {
            int i = idx[k];
            double best = -1.0;
            for (int[] off : offsets) {
                double s = dRgbScore(q, g.boxW, g.boxH, off[0], off[1], g.rgb[i], g.mask[i], g.maskSum[i]);
                if (s > best) {
                    best = s;
                }
            }
            scores[k] = best;
        }
        Integer[] order = new Integer[idx.length];
        for (int k = 0; k < idx.length; k++) {
            order[k] = k;
        }
        final double[] scoresRef = scores;
        Arrays.sort(order, (a, b) -> Double.compare(scoresRef[b], scoresRef[a]));
        // Achromatische-winnaar-guard (incl. kaart-geel-uitsluiting) — port
        if (g.sat[idx[order[0]]] <= 0.06) {
            float[] satHue = qSatHue(q, g.boxW, g.boxH);
            float[] m0 = g.mask[idx[order[0]]];
            double wSum = 0.0;
            double satSum = 0.0;
            int n = g.boxW * g.boxH;
            for (int p = 0; p < n; p++) {
                float hue = satHue[p * 2 + 1];
                float nonYellow = (hue < 18f || hue > 36f) ? 1f : 0f;
                float w = m0[p] * nonYellow;
                wSum += w;
                satSum += satHue[p * 2] * w;
            }
            double cropSat = satSum / (wSum + 1e-6);
            if (cropSat >= 0.12) {
                List<Integer> chrom = new ArrayList<>();
                List<Integer> achrom = new ArrayList<>();
                for (Integer o : order) {
                    if (g.sat[idx[o]] > 0.06) {
                        chrom.add(o);
                    } else {
                        achrom.add(o);
                    }
                }
                if (!chrom.isEmpty() && scores[order[0]] - scores[chrom.get(0)] <= 0.02) {
                    List<Integer> reordered = new ArrayList<>(chrom);
                    reordered.addAll(achrom);
                    order = reordered.toArray(new Integer[0]);
                }
            }
        }
        // Vorm-evidence (gebruikersidee 2026-07-16): whole-box-kleur is bot op
        // gedimde lookalikes — binnen een dichte kopgroep (marge < 0.04) beslist
        // het SILHOUET mee: alpha-masker-IoU van de query-voorgrond vs template.
        if (order.length > 1 && scores[order[0]] - scores[order[1]] < 0.04) {
            float[] queryFg = foregroundMask(q8);
            if (queryFg != null) {
                double bestCombined = -2.0;
                int bestPos = 0;
                for (int k = 0; k < Math.min(5, order.length); k++) {
                    if (scores[order[0]] - scores[order[k]] > 0.05) {
                        break;
                    }
                    double iou = maskIou(queryFg, g.mask[idx[order[k]]]);
                    double combined = scores[order[k]] + 0.10 * iou;
                    if (combined > bestCombined) {
                        bestCombined = combined;
                        bestPos = k;
                    }
                }
                if (bestPos != 0) {
                    Integer winner = order[bestPos];
                    for (int k = bestPos; k > 0; k--) {
                        order[k] = order[k - 1];
                    }
                    order[0] = winner;
                }
            }
        }
        JSONArray top3 = new JSONArray();
        for (int k = 0; k < Math.min(3, order.length); k++) {
            top3.put(new JSONArray().put(g.ids.get(idx[order[k]])).put(Math.round(scores[order[k]] * 10000.0) / 10000.0));
        }
        JSONArray topkList = null;
        if (topk > 0) {
            topkList = new JSONArray();
            for (int k = 0; k < Math.min(topk, order.length); k++) {
                topkList.put(new JSONArray().put(g.ids.get(idx[order[k]])).put(Math.round(scores[order[k]] * 10000.0) / 10000.0));
            }
        }
        String rid = g.ids.get(idx[order[0]]);
        double score = scores[order[0]];
        double margin = order.length > 1 ? score - scores[order[1]] : 1.0;
        String famWin = familyOf(rid);
        double marginExt = 1.0;
        for (int k = 1; k < order.length; k++) {
            if (!familyOf(g.ids.get(idx[order[k]])).equals(famWin)) {
                marginExt = score - scores[order[k]];
                break;
            }
        }
        // familie-refinement op diagnostische pixels (alleen zonder subset) — port
        if (subsetIds == null) {
            String famKey = famKeyFor(groupName, famWin);
            if (famKey != null) {
                JSONObject fmMeta = pack.getJSONObject("family_masks").getJSONObject(famKey);
                double dsum = fmMeta.getDouble("dsum");
                float[] dmask = famMasks.get(famKey);
                if (dmask != null && dsum >= 8.0) {
                    JSONArray members = fmMeta.getJSONArray("member_indices");
                    Integer pick = null;
                    double[] cropAng = chromaAngle(q8, dmask);
                    if (cropAng[0] == cropAng[0] && cropAng[1] >= 20.0) { // NaN-check
                        double bestDiff = Double.MAX_VALUE;
                        double secondDiff = Double.MAX_VALUE;
                        int bestMember = -1;
                        JSONObject chroma = pack.getJSONObject("family_chroma").getJSONObject(famKey);
                        for (int mi = 0; mi < members.length(); mi++) {
                            int refIdx = members.getInt(mi);
                            JSONArray am = chroma.optJSONArray(String.valueOf(refIdx));
                            if (am == null || am.isNull(0) || am.getDouble(1) < 20.0) {
                                continue;
                            }
                            double diff = Math.abs(((cropAng[0] - am.getDouble(0)) + 540.0) % 360.0 - 180.0);
                            if (diff < bestDiff) {
                                secondDiff = bestDiff;
                                bestDiff = diff;
                                bestMember = refIdx;
                            } else if (diff < secondDiff) {
                                secondDiff = diff;
                            }
                        }
                        if (bestMember >= 0 && (secondDiff == Double.MAX_VALUE || secondDiff - bestDiff >= 8.0)) {
                            pick = bestMember;
                        }
                    }
                    if (pick != null) {
                        rid = g.ids.get(pick);
                    } else {
                        double achromMagMax = "characters".equals(groupName) ? 18.5 : 12.0;
                        List<Integer> kandidaten = new ArrayList<>();
                        for (int mi = 0; mi < members.length(); mi++) {
                            kandidaten.add(members.getInt(mi));
                        }
                        if (cropAng[1] < achromMagMax) {
                            JSONObject chroma = pack.getJSONObject("family_chroma").getJSONObject(famKey);
                            List<Integer> achrom = new ArrayList<>();
                            for (Integer i : kandidaten) {
                                JSONArray am = chroma.optJSONArray(String.valueOf(i));
                                double mag = am == null ? 99.0 : am.getDouble(1);
                                if (mag < 20.0) {
                                    achrom.add(i);
                                }
                            }
                            if (!achrom.isEmpty()) {
                                kandidaten = achrom;
                            }
                        }
                        double fBest = -2.0;
                        int fBestIdx = kandidaten.get(0);
                        for (Integer i : kandidaten) {
                            double s = dRgbScore(q, g.boxW, g.boxH, 0, 0, g.rgb[i], dmask, dsum);
                            if (s > fBest) {
                                fBest = s;
                                fBestIdx = i;
                            }
                        }
                        rid = g.ids.get(fBestIdx);
                    }
                }
            }
            // sibling-paar (villager m/v): tinthoek beslist, vorm heeft veto — port
            String pairKey = siblingPairOf.get(rid);
            if (pairKey != null && famMasks.containsKey(pairKey)) {
                JSONObject pmMeta = pack.getJSONObject("family_masks").getJSONObject(pairKey);
                float[] pmask = famMasks.get(pairKey);
                double[] pAng = chromaAngle(q8, pmask);
                JSONObject shape = pack.optJSONObject("sibling_pair_shape") == null ? null
                        : pack.getJSONObject("sibling_pair_shape").optJSONObject(pairKey);
                boolean meisjeachtig = false;
                boolean zekerGeenKnot = false;
                if (shape != null && famShapeMasks.containsKey(pairKey)) {
                    double[] bAng = chromaAngle(q8, famShapeMasks.get(pairKey));
                    double femaleAngle = shape.isNull("female_angle") ? Double.NaN : shape.getDouble("female_angle");
                    meisjeachtig = bAng[0] == bAng[0] && bAng[1] >= 15.0 && femaleAngle == femaleAngle
                            && Math.abs(((bAng[0] - femaleAngle) + 540.0) % 360.0 - 180.0) <= 30.0;
                    zekerGeenKnot = bAng[1] < 10.0;
                }
                if (pAng[0] == pAng[0] && pAng[1] >= 20.0) {
                    JSONArray members = pmMeta.getJSONArray("member_indices");
                    JSONObject chroma = pack.getJSONObject("family_chroma").getJSONObject(pairKey);
                    List<double[]> pc = new ArrayList<>(); // {diff, refIdx}
                    for (int mi = 0; mi < members.length(); mi++) {
                        int refIdx = members.getInt(mi);
                        JSONArray am = chroma.optJSONArray(String.valueOf(refIdx));
                        if (am == null || am.isNull(0) || am.getDouble(1) < 20.0) {
                            continue;
                        }
                        pc.add(new double[]{Math.abs(((pAng[0] - am.getDouble(0)) + 540.0) % 360.0 - 180.0), refIdx});
                    }
                    pc.sort((a, b) -> Double.compare(a[0], b[0]));
                    if (pc.size() >= 2 && pc.get(1)[0] - pc.get(0)[0] >= 8.0) {
                        String doel = g.ids.get((int) pc.get(0)[1]);
                        boolean akkoord = true;
                        if (shape != null) {
                            String femaleRid = shape.getString("female_rid");
                            akkoord = doel.equals(femaleRid) ? meisjeachtig : !meisjeachtig;
                        }
                        if (akkoord) {
                            rid = doel;
                        }
                    } else if (shape != null && rid.equals(shape.getString("female_rid")) && zekerGeenKnot && !pc.isEmpty()) {
                        for (double[] entry : pc) {
                            String candidate = g.ids.get((int) entry[1]);
                            if (!candidate.equals(shape.getString("female_rid"))) {
                                rid = candidate;
                                break;
                            }
                        }
                    }
                }
            }
        }
        q8.release();
        JSONObject out = new JSONObject()
                .put("id", rid)
                .put("name", g.names.getOrDefault(rid, rid))
                .put("score", Math.round(score * 10000.0) / 10000.0)
                .put("margin", Math.round(margin * 10000.0) / 10000.0)
                .put("margin_ext", Math.round(marginExt * 10000.0) / 10000.0)
                .put("top3", top3)
                .put("family", famWin);
        if (topkList != null) {
            out.put("topk", topkList);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // identify_crop_search — port (±search px TM_SQDIFF, 2 iteraties)
    // ------------------------------------------------------------------
    public JSONObject identifyCropSearch(Mat imageBgr, double bx, double by, double bw, double bh, String groupName, Set<String> subsetIds, int search, int topk) throws Exception {
        Group g = groups.get(groupName);
        int tw = (int) Math.round(bw);
        int th = (int) Math.round(bh);
        int imgW = imageBgr.cols();
        int imgH = imageBgr.rows();
        int x1 = (int) Math.round(bx);
        int y1 = (int) Math.round(by);
        Rect nominal = clipRect(x1, y1, tw, th, imgW, imgH);
        if (g == null || nominal.width <= 0 || nominal.height <= 0) {
            return new JSONObject().put("id", JSONObject.NULL).put("score", 0.0).put("margin", 0.0).put("dx", 0).put("dy", 0);
        }
        Mat crop0 = new Mat(imageBgr, nominal);
        JSONObject best = identifyCrop(crop0, groupName, subsetIds, CENTER_ONLY, topk);
        crop0.release();
        best.put("dx", 0).put("dy", 0);
        int wx1 = Math.max(0, x1 - search);
        int wy1 = Math.max(0, y1 - search);
        int wx2 = Math.min(imgW, x1 + tw + search);
        int wy2 = Math.min(imgH, y1 + th + search);
        if (tw < 8 || th < 8 || wy2 - wy1 < th || wx2 - wx1 < tw) {
            return best;
        }
        List<Mat> rgbs = sizedRgb(groupName, tw, th);
        List<Mat> masks = sizedMask(groupName, tw, th);
        double[] msums = sizedSumCache.get(groupName + "|" + tw + "x" + th);
        Mat winF = new Mat();
        new Mat(imageBgr, new Rect(wx1, wy1, wx2 - wx1, wy2 - wy1)).convertTo(winF, CvType.CV_32FC3, 1.0 / 255.0);
        // gain over het venster naar het groepsgemiddelde (server: ref_mean over gestackte sized refs)
        double refNum = 0.0;
        double refDen = 0.0;
        for (int i = 0; i < g.ids.size(); i++) {
            refNum += g.rgbMaskSum[i] / Math.max(g.maskSum[i], 1e-6) * msums[i] / 3.0;
            refDen += msums[i] / 3.0;
        }
        double refMean = refNum / Math.max(refDen, 1e-6) / 3.0;
        org.opencv.core.Scalar winMean = Core.mean(winF);
        double m = (winMean.val[0] + winMean.val[1] + winMean.val[2]) / 3.0;
        if (m > 1e-4) {
            double gain = Math.max(0.6, Math.min(1.8, refMean / m));
            Core.multiply(winF, new org.opencv.core.Scalar(gain, gain, gain), winF);
            Core.min(winF, new org.opencv.core.Scalar(1.0, 1.0, 1.0), winF);
        }
        int curDx = 0;
        int curDy = 0;
        for (int round = 0; round < 2; round++) {
            // positie-stage over ALLE refs (was: top3 van de nominale crop —
            // seed-lock: een verkeerd geframede crop geeft verkeerde top3 en
            // de ware kandidaat krijgt nooit zijn betere positie te bewijzen;
            // ghost Baby Mario 0.831@(+8,-8) verloor zo van DK 0.764).
            // matchTemplate is native/SIMD op een klein venster — goedkoop.
            double posBestScore = -Double.MAX_VALUE;
            int posBestX = -1;
            int posBestY = -1;
            Mat result = new Mat();
            for (int refIdx = 0; refIdx < g.ids.size(); refIdx++) {
                if (msums[refIdx] < 24.0) {
                    continue;
                }
                if (subsetIds != null && !subsetIds.contains(g.ids.get(refIdx))) {
                    continue;
                }
                Imgproc.matchTemplate(winF, rgbs.get(refIdx), result, Imgproc.TM_SQDIFF, masks.get(refIdx));
                Core.patchNaNs(result, 1e12);
                Core.MinMaxLocResult mm = Core.minMaxLoc(result);
                double sc = 1.0 - mm.minVal / msums[refIdx];
                if (sc > posBestScore) {
                    posBestScore = sc;
                    posBestX = (int) mm.minLoc.x;
                    posBestY = (int) mm.minLoc.y;
                }
            }
            result.release();
            if (posBestX < 0) {
                break;
            }
            int dx = wx1 + posBestX - x1;
            int dy = wy1 + posBestY - y1;
            if (dx == curDx && dy == curDy) {
                break;
            }
            Mat shifted = new Mat(imageBgr, clipRect(x1 + dx, y1 + dy, tw, th, imgW, imgH));
            JSONObject out = identifyCrop(shifted, groupName, subsetIds, CENTER_ONLY, topk);
            shifted.release();
            if (out.optDouble("score", 0.0) < best.optDouble("score", 0.0)) {
                break;
            }
            out.put("dx", dx).put("dy", dy);
            best = out;
            curDx = dx;
            curDy = dy;
        }
        winF.release();
        return best;
    }

    // ------------------------------------------------------------------
    // Hulpjes
    // ------------------------------------------------------------------
    private String famKeyFor(String group, String family) throws Exception {
        JSONObject fm = pack.getJSONObject("family_masks");
        Iterator<String> it = fm.keys();
        while (it.hasNext()) {
            String key = it.next();
            JSONObject meta = fm.getJSONObject(key);
            if (meta.getString("group").equals(group) && meta.getString("family").equals(family)) {
                return key;
            }
        }
        return null;
    }

    /** score = 1 - Σ(mask·|dBGR|)/(masksum·3); query geshift met randreplicatie. */
    private static double dRgbScore(float[] q, int w, int h, int dx, int dy, float[] ref, float[] mask, double maskSum) {
        double d = 0.0;
        for (int y = 0; y < h; y++) {
            int sy = y - dy;
            sy = sy < 0 ? 0 : (sy >= h ? h - 1 : sy);
            for (int x = 0; x < w; x++) {
                float mv = mask[y * w + x];
                if (mv == 0f) {
                    continue;
                }
                int sx = x - dx;
                sx = sx < 0 ? 0 : (sx >= w ? w - 1 : sx);
                int qi = (sy * w + sx) * 3;
                int ri = (y * w + x) * 3;
                d += mv * (Math.abs(ref[ri] - q[qi]) + Math.abs(ref[ri + 1] - q[qi + 1]) + Math.abs(ref[ri + 2] - q[qi + 2]));
            }
        }
        return 1.0 - d / (maskSum * 3.0 + 1e-6);
    }

    /** [sat0..1, hue0..180] per pixel uit de (post-gain) query. */
    private static float[] qSatHue(float[] qBgr, int w, int h) {
        Mat bgr8 = new Mat(h, w, CvType.CV_8UC3);
        byte[] data = new byte[w * h * 3];
        for (int p = 0; p < w * h * 3; p++) {
            data[p] = (byte) Math.max(0, Math.min(255, Math.round(qBgr[p] * 255f)));
        }
        bgr8.put(0, 0, data);
        Mat hsv = new Mat();
        Imgproc.cvtColor(bgr8, hsv, Imgproc.COLOR_BGR2HSV);
        byte[] hsvData = new byte[w * h * 3];
        hsv.get(0, 0, hsvData);
        bgr8.release();
        hsv.release();
        float[] out = new float[w * h * 2];
        for (int p = 0; p < w * h; p++) {
            out[p * 2] = (hsvData[p * 3 + 1] & 0xFF) / 255f;
            out[p * 2 + 1] = hsvData[p * 3] & 0xFF;
        }
        return out;
    }

    /** Voorgrondmasker van de query: pixels die duidelijk afwijken van de
     *  rand-achtergrondkleur (kaartvlak) — silhouet-benadering voor vorm-evidence. */
    private static float[] foregroundMask(Mat q8) {
        int w = q8.cols();
        int h = q8.rows();
        byte[] data = new byte[w * h * 3];
        q8.get(0, 0, data);
        // achtergrond = gemiddelde van de 2px-rand
        double bgB = 0.0;
        double bgG = 0.0;
        double bgR = 0.0;
        int n = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                if (y >= 2 && y < h - 2 && x >= 2 && x < w - 2) {
                    continue;
                }
                int p = (y * w + x) * 3;
                bgB += data[p] & 0xFF;
                bgG += data[p + 1] & 0xFF;
                bgR += data[p + 2] & 0xFF;
                n++;
            }
        }
        if (n == 0) {
            return null;
        }
        bgB /= n;
        bgG /= n;
        bgR /= n;
        float[] fg = new float[w * h];
        int fgCount = 0;
        for (int p = 0; p < w * h; p++) {
            double d = Math.abs((data[p * 3] & 0xFF) - bgB)
                    + Math.abs((data[p * 3 + 1] & 0xFF) - bgG)
                    + Math.abs((data[p * 3 + 2] & 0xFF) - bgR);
            if (d > 60.0) {
                fg[p] = 1f;
                fgCount++;
            }
        }
        // te leeg of te vol = geen bruikbaar silhouet (egale crop / drukke scene)
        return fgCount < w * h / 20 || fgCount > w * h * 9 / 10 ? null : fg;
    }

    private static double maskIou(float[] a, float[] b) {
        int inter = 0;
        int union = 0;
        for (int p = 0; p < a.length; p++) {
            boolean pa = a[p] > 0f;
            boolean pb = b[p] > 0.5f;
            if (pa && pb) {
                inter++;
            }
            if (pa || pb) {
                union++;
            }
        }
        return union == 0 ? 0.0 : inter / (double) union;
    }

    /** Omgekeerde kleurset-relatie (server chars_for_part_variant): characters
     *  wier kleurset dit basispart in precies deze variant geeft. */
    public java.util.List<String> charsForPartVariant(String group, String variantId) {
        java.util.List<String> out = new ArrayList<>();
        JSONObject mapping = pack.optJSONObject("char_to_parts");
        if (mapping == null || variantId == null || variantId.isEmpty()) {
            return out;
        }
        Iterator<String> chars = mapping.keys();
        while (chars.hasNext()) {
            String charId = chars.next();
            JSONObject charMap = mapping.optJSONObject(charId);
            JSONObject groupMap = charMap == null ? null : charMap.optJSONObject(group);
            if (groupMap == null) {
                continue;
            }
            Iterator<String> bases = groupMap.keys();
            while (bases.hasNext()) {
                if (variantId.equals(groupMap.optString(bases.next(), ""))) {
                    out.add(charId);
                    break;
                }
            }
        }
        return out;
    }

    /** Chroma-gewogen Lab-tinthoek op gemaskeerde pixels: {hoek_graden|NaN, magnitude}. */
    private static double[] chromaAngle(Mat bgr8, float[] mask) {
        Mat lab = new Mat();
        Imgproc.cvtColor(bgr8, lab, Imgproc.COLOR_BGR2Lab);
        int n = lab.rows() * lab.cols();
        byte[] data = new byte[n * 3];
        lab.get(0, 0, data);
        lab.release();
        double sw = 0.0;
        double awSum = 0.0;
        double bwSum = 0.0;
        for (int p = 0; p < n; p++) {
            double a = (data[p * 3 + 1] & 0xFF) - 128.0;
            double b = (data[p * 3 + 2] & 0xFF) - 128.0;
            double w = mask[p] * Math.hypot(a, b);
            sw += w;
            awSum += a * w;
            bwSum += b * w;
        }
        if (sw < 1e-3) {
            return new double[]{Double.NaN, 0.0};
        }
        double aw = awSum / sw;
        double bw = bwSum / sw;
        return new double[]{Math.toDegrees(Math.atan2(bw, aw)), Math.hypot(aw, bw)};
    }

    private List<Mat> sizedRgb(String group, int tw, int th) {
        String key = group + "|" + tw + "x" + th;
        List<Mat> cached = sizedRgbCache.get(key);
        if (cached != null) {
            return cached;
        }
        Group g = groups.get(group);
        List<Mat> rgbs = new ArrayList<>();
        List<Mat> masks = new ArrayList<>();
        double[] sums = new double[g.ids.size()];
        for (int i = 0; i < g.ids.size(); i++) {
            Mat sized8 = new Mat();
            Imgproc.resize(g.refBgr8[i], sized8, new org.opencv.core.Size(tw, th), 0, 0, Imgproc.INTER_AREA);
            Mat sizedF = new Mat();
            sized8.convertTo(sizedF, CvType.CV_32FC3, 1.0 / 255.0);
            sized8.release();
            rgbs.add(sizedF);
            Mat mask8 = new Mat();
            Imgproc.resize(g.refMask8[i], mask8, new org.opencv.core.Size(tw, th), 0, 0, Imgproc.INTER_AREA);
            Mat maskBin = new Mat();
            Imgproc.threshold(mask8, maskBin, 127.5, 1.0, Imgproc.THRESH_BINARY);
            mask8.release();
            Mat maskF1 = new Mat();
            maskBin.convertTo(maskF1, CvType.CV_32F);
            maskBin.release();
            List<Mat> three = new ArrayList<>();
            three.add(maskF1);
            three.add(maskF1);
            three.add(maskF1);
            Mat mask3 = new Mat();
            Core.merge(three, mask3);
            maskF1.release();
            masks.add(mask3);
            sums[i] = Core.sumElems(mask3).val[0] + Core.sumElems(mask3).val[1] + Core.sumElems(mask3).val[2];
        }
        sizedRgbCache.put(key, rgbs);
        sizedMaskCache.put(key, masks);
        sizedSumCache.put(key, sums);
        return rgbs;
    }

    private List<Mat> sizedMask(String group, int tw, int th) {
        sizedRgb(group, tw, th);
        return sizedMaskCache.get(group + "|" + tw + "x" + th);
    }

    private static Rect clipRect(int x, int y, int w, int h, int imgW, int imgH) {
        int cx = Math.max(0, Math.min(imgW - 1, x));
        int cy = Math.max(0, Math.min(imgH - 1, y));
        int cw = Math.min(w, imgW - cx);
        int ch = Math.min(h, imgH - cy);
        return new Rect(cx, cy, Math.max(0, cw), Math.max(0, ch));
    }

    private static int[] allIndices(int n) {
        int[] out = new int[n];
        for (int i = 0; i < n; i++) {
            out[i] = i;
        }
        return out;
    }

    private String readAssetText(String path) throws Exception {
        InputStream in = context.getAssets().open(path);
        try {
            byte[] buffer = new byte[in.available()];
            int off = 0;
            int read;
            while (off < buffer.length && (read = in.read(buffer, off, buffer.length - off)) > 0) {
                off += read;
            }
            return new String(buffer, 0, off, StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }

    private Mat readAssetBgr8(String path) throws Exception {
        Bitmap bitmap = decodeAsset(path);
        Mat rgba = new Mat();
        Utils.bitmapToMat(bitmap, rgba);
        bitmap.recycle();
        Mat bgr = new Mat();
        Imgproc.cvtColor(rgba, bgr, Imgproc.COLOR_RGBA2BGR);
        rgba.release();
        return bgr;
    }

    private Mat readAssetGray8(String path) throws Exception {
        Bitmap bitmap = decodeAsset(path);
        Mat rgba = new Mat();
        Utils.bitmapToMat(bitmap, rgba);
        bitmap.recycle();
        Mat gray = new Mat();
        Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY);
        rgba.release();
        return gray;
    }

    private Bitmap decodeAsset(String path) throws Exception {
        InputStream in = context.getAssets().open(path);
        try {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
            return BitmapFactory.decodeStream(in, null, opts);
        } finally {
            in.close();
        }
    }

    private static float[] bgr8ToFloat(Mat bgr8) {
        Mat f = new Mat();
        bgr8.convertTo(f, CvType.CV_32FC3, 1.0 / 255.0);
        float[] out = new float[(int) f.total() * 3];
        f.get(0, 0, out);
        f.release();
        return out;
    }

    private static float[] gray8ToBinFloat(Mat gray8) {
        byte[] data = new byte[(int) gray8.total()];
        gray8.get(0, 0, data);
        float[] out = new float[data.length];
        for (int i = 0; i < data.length; i++) {
            out[i] = (data[i] & 0xFF) > 127 ? 1f : 0f;
        }
        return out;
    }

    private static float[] gray8ToBinFloatAndRelease(Mat gray8) {
        float[] out = gray8ToBinFloat(gray8);
        gray8.release();
        return out;
    }
}
