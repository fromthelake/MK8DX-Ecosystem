package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The shared refinement evidence, ported from packages/icon-matcher/ts:
 * shape rank, flag exposure, distinctive flag rank, NL/LU/PY tricolour,
 * character family colour (OKLab) and neutral chroma. Arithmetic follows the
 * TypeScript (double accumulation, JavaScript rounding) so the records match.
 */
public final class Refinements {
    private Refinements() {
    }

    static long jsRound(double value) {
        return (long) Math.floor(value + 0.5);
    }

    // ---------------------------------------------------------------- shape

    private static double gray(float[] rgb, int offset) {
        return 0.299 * rgb[offset] + 0.587 * rgb[offset + 1] + 0.114 * rgb[offset + 2];
    }

    public static JSONObject shapeRank(float[] query, IconGroup group, String mode) throws JSONException {
        boolean masked = "masked_gray_ncc".equals(mode);
        int pixels = group.width * group.height;
        int count = group.ids.length;
        double[] scores = new double[count];
        for (int index = 0; index < count; index++) {
            int rgbBase = index * pixels * 3;
            int maskBase = index * pixels;
            double qMean = 0, rMean = 0;
            int n = 0;
            for (int pixel = 0; pixel < pixels; pixel++) {
                if (masked && group.mask[maskBase + pixel] == 0) continue;
                int offset = pixel * 3;
                if (masked) {
                    qMean += gray(query, offset);
                    rMean += gray(group.rgb, rgbBase + offset);
                    n++;
                } else {
                    for (int c = 0; c < 3; c++) {
                        qMean += query[offset + c];
                        rMean += group.rgb[rgbBase + offset + c];
                        n++;
                    }
                }
            }
            if (n == 0) {
                scores[index] = -1;
                continue;
            }
            qMean /= n;
            rMean /= n;
            double numerator = 0, qEnergy = 0, rEnergy = 0;
            for (int pixel = 0; pixel < pixels; pixel++) {
                if (masked && group.mask[maskBase + pixel] == 0) continue;
                int offset = pixel * 3;
                if (masked) {
                    double q = gray(query, offset) - qMean;
                    double r = gray(group.rgb, rgbBase + offset) - rMean;
                    numerator += q * r;
                    qEnergy += q * q;
                    rEnergy += r * r;
                } else {
                    for (int c = 0; c < 3; c++) {
                        double q = query[offset + c] - qMean;
                        double r = group.rgb[rgbBase + offset + c] - rMean;
                        numerator += q * r;
                        qEnergy += q * q;
                        rEnergy += r * r;
                    }
                }
            }
            scores[index] = qEnergy * rEnergy > 1e-14 ? numerator / Math.sqrt(qEnergy * rEnergy) : -1;
        }
        Integer[] order = new Integer[count];
        for (int i = 0; i < count; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> {
            int byScore = Double.compare(scores[b], scores[a]);
            return byScore != 0 ? byScore : Integer.compare(a, b);
        });
        JSONArray top = new JSONArray();
        for (int i = 0; i < Math.min(3, count); i++) {
            top.put(new JSONObject().put("id", group.ids[order[i]]).put("score", scores[order[i]]));
        }
        return new JSONObject().put("mode", mode).put("margin", scores[order[0]] - scores[order[1]]).put("top", top);
    }

    // ------------------------------------------------------------- exposure

    private static double upperQuartile(double[] values) {
        Arrays.sort(values);
        return values[(int) jsRound(.75 * (values.length - 1))];
    }

    private static double brightness(float[] rgb, int start, int width, int height) {
        double[] values = new double[width * height];
        for (int pixel = 0; pixel < values.length; pixel++) {
            int at = start + pixel * 3;
            values[pixel] = Math.max(rgb[at], Math.max(rgb[at + 1], rgb[at + 2]));
        }
        return upperQuartile(values);
    }

    private static double medianBand(float[] rgb, int width, int start, int y0, int y1, int channel) {
        double[] values = new double[(y1 - y0) * 31];
        int n = 0;
        for (int y = y0; y < y1; y++) {
            for (int x = 12; x < 43; x++) values[n++] = rgb[start + (y * width + x) * 3 + channel];
        }
        Arrays.sort(values);
        return values[values.length / 2];
    }

    private static double tricolorBlueGreen(float[] rgb, int start, int width) {
        double green = medianBand(rgb, width, start, 25, 30, 1) / Math.max(.1, medianBand(rgb, width, start, 16, 22, 1));
        double blue = medianBand(rgb, width, start, 25, 30, 2) / Math.max(.1, medianBand(rgb, width, start, 16, 22, 2));
        return blue / Math.max(.1, green);
    }

    public static JSONObject flagExposure(float[] query, IconGroup group, JSONObject shape) throws JSONException {
        int pixels = group.width * group.height;
        if (group.width != 55 || group.height != 38 || group.ids.length != 110) {
            throw new IllegalArgumentException("Expected one result flag crop and 110 references");
        }
        JSONArray shapeTop = shape.optJSONArray("top");
        if (!"full_rgb_ncc".equals(shape.optString("mode")) || shapeTop == null || shapeTop.length() == 0) {
            return exposureUnavailable("no_pattern_rank", null, null);
        }
        String patternId = shapeTop.getJSONObject(0).getString("id");
        int index = group.indexOf(patternId);
        if (index < 0) return exposureUnavailable("unknown_pattern_reference", null, null);
        double observed = brightness(query, 0, group.width, group.height);
        double expected = brightness(group.rgb, index * pixels * 3, group.width, group.height);
        if (!(observed > .1) || !(expected > .1)) return exposureUnavailable("insufficient_brightness", null, null);
        double gain = Math.min(1.8, expected / observed);
        if (gain < 1.25) return exposureUnavailable("exposure_within_normal_range", gain, patternId);
        float[] corrected = new float[query.length];
        for (int i = 0; i < query.length; i++) corrected[i] = (float) Math.min(1, query[i] * gain);
        IconScorer.Match rank = IconScorer.match(corrected, group);
        List<JSONObject> top = new ArrayList<>();
        for (int i = 0; i < rank.topIds.size(); i++) {
            top.add(new JSONObject().put("id", rank.topIds.get(i)).put("score", rank.topScores.get(i)));
        }
        JSONObject result = new JSONObject().put("schema", "mk8dx.flag-exposure-proposal.v1")
                .put("status", "measured").put("reason", "pattern_reference_exposure")
                .put("gain", gain).put("referenceId", patternId);
        boolean hasNl = false;
        for (JSONObject item : top) hasNl |= "country.nl".equals(item.getString("id"));
        if ("country.lu".equals(patternId) && !top.isEmpty() && "country.lu".equals(top.get(0).getString("id")) && hasNl) {
            int nl = group.indexOf("country.nl");
            int lu = group.indexOf("country.lu");
            if (nl >= 0 && lu >= 0) {
                double obs = tricolorBlueGreen(query, 0, group.width);
                double nlRef = tricolorBlueGreen(group.rgb, nl * pixels * 3, group.width);
                double luRef = tricolorBlueGreen(group.rgb, lu * pixels * 3, group.width);
                String preferred = Math.abs(obs - nlRef) < Math.abs(obs - luRef) ? "country.nl" : "country.lu";
                result.put("tricolorBand", new JSONObject().put("observed", obs).put("nlReference", nlRef)
                        .put("luReference", luRef).put("preferredId", preferred));
                if ("country.nl".equals(preferred)) {
                    top.sort(Comparator.comparingInt(item -> "country.nl".equals(item.optString("id")) ? 0 : 1));
                }
            }
        }
        return result.put("top", new JSONArray(top));
    }

    private static JSONObject exposureUnavailable(String reason, Double gain, String referenceId) throws JSONException {
        return new JSONObject().put("schema", "mk8dx.flag-exposure-proposal.v1").put("status", "unavailable")
                .put("reason", reason).put("gain", gain == null ? JSONObject.NULL : gain)
                .put("referenceId", referenceId == null ? JSONObject.NULL : referenceId).put("top", new JSONArray());
    }

    // ---------------------------------------------------------- distinctive

    public static JSONArray distinctiveFlagRank(float[] query, IconGroup group, List<String> ids) throws JSONException {
        int channels = group.width * group.height * 3;
        if (ids.size() != 3 || new LinkedHashSet<>(ids).size() != 3 || query.length != channels) {
            throw new IllegalArgumentException("Expected normalized RGB and three distinct flag references");
        }
        int[] indices = new int[3];
        for (int i = 0; i < 3; i++) {
            indices[i] = group.indexOf(ids.get(i));
            if (indices[i] < 0) throw new IllegalArgumentException("Unknown shortlisted flag");
        }
        double[] distances = new double[3];
        double weightSum = 0;
        for (int channel = 0; channel < channels; channel++) {
            double a = group.rgb[indices[0] * channels + channel];
            double b = group.rgb[indices[1] * channels + channel];
            double c = group.rgb[indices[2] * channels + channel];
            double weight = Math.max(a, Math.max(b, c)) - Math.min(a, Math.min(b, c)) + 0.01;
            weightSum += weight;
            distances[0] += Math.abs(a - query[channel]) * weight;
            distances[1] += Math.abs(b - query[channel]) * weight;
            distances[2] += Math.abs(c - query[channel]) * weight;
        }
        Integer[] order = {0, 1, 2};
        final double sum = weightSum;
        Arrays.sort(order, (x, y) -> {
            int byDistance = Double.compare(distances[x] / sum, distances[y] / sum);
            return byDistance != 0 ? byDistance : Integer.compare(x, y);
        });
        JSONArray out = new JSONArray();
        for (int i : order) out.put(new JSONObject().put("id", ids.get(i)).put("distance", distances[i] / sum));
        return out;
    }

    // ------------------------------------------------------------ NL/LU band ratio

    // NL and LU share the red band (assets 194,57,55 and 200,59,45); only the blue
    // differs (4,89,164 against 55,148,213). The green of the blue band over the
    // red band's red is a self-calibrating tone: assets 0.46 / 0.74, measured
    // 2026-10-23 NL 0.27-0.58 on 300+ photo and HDMI crops, LU 0.73-0.77.
    public static final double BAND_RATIO_NL_MAX = 0.62;
    public static final double BAND_RATIO_LU_MIN = 0.68;
    public static final int BAND_RATIO_MIN_PIXELS = 15;

    /** NL/LU decision from normalized RGB (0..1, row-major); Python flag_rank.flag_band_ratio. */
    public static JSONObject flagBandRatio(float[] query) throws JSONException {
        if (query.length == 0 || query.length % 3 != 0) throw new IllegalArgumentException("Expected normalized RGB");
        List<Double> redR = new ArrayList<>(), blueG = new ArrayList<>();
        for (int i = 0; i < query.length; i += 3) {
            double r = query[i], g = query[i + 1], b = query[i + 2];
            double top = Math.max(r, Math.max(g, b)), delta = top - Math.min(r, Math.min(g, b));
            if (!(delta > 0)) continue;
            double sat = top > 0 ? delta / top : 0, hue;
            if (top == r) hue = (((60 * (g - b)) / delta) % 360 + 360) % 360;
            else if (top == g) hue = (60 * (b - r)) / delta + 120;
            else hue = (60 * (r - g)) / delta + 240;
            if ((hue <= 16 || hue >= 340) && sat >= 0.35 && top >= 0.24) redR.add(r);
            if (hue >= 190 && hue <= 250 && sat >= 0.35 && top >= 0.16) blueG.add(g);
        }
        JSONObject result = new JSONObject().put("schema", "mk8dx.flag-band-ratio.v1")
                .put("redPixels", redR.size()).put("bluePixels", blueG.size())
                .put("nlMax", BAND_RATIO_NL_MAX).put("luMin", BAND_RATIO_LU_MIN);
        if (redR.size() < BAND_RATIO_MIN_PIXELS || blueG.size() < BAND_RATIO_MIN_PIXELS) {
            return result.put("status", "unavailable").put("reason", "bands_not_found")
                    .put("ratio", JSONObject.NULL).put("decisionId", JSONObject.NULL);
        }
        double ratio = median(blueG) / Math.max(median(redR), 0.05);
        String decision = ratio <= BAND_RATIO_NL_MAX ? "country.nl" : ratio >= BAND_RATIO_LU_MIN ? "country.lu" : null;
        return result.put("status", "measured")
                .put("reason", "country.nl".equals(decision) ? "nl_tone" : decision != null ? "lu_tone" : "between")
                .put("ratio", ratio).put("decisionId", decision == null ? JSONObject.NULL : decision);
    }

    // ------------------------------------------------------------ tricolour

    private static double median(List<Double> values) {
        values.sort(Double::compare);
        int middle = values.size() / 2;
        return values.size() % 2 == 1 ? values.get(middle) : (values.get(middle - 1) + values.get(middle)) / 2;
    }

    private static double sample(float[] rgb, int start, int width, int y0, int y1, int channel) {
        List<Double> values = new ArrayList<>();
        for (int y = y0; y < y1; y++) {
            for (int x = 12; x < 43; x++) values.add((double) rgb[start + (y * width + x) * 3 + channel]);
        }
        return median(values);
    }

    private static double stripe(float[] rgb, int start, int width) {
        return 1 - sample(rgb, start, width, 25, 30, 1) / Math.max(.1, sample(rgb, start, width, 16, 22, 1));
    }

    public static JSONObject flagTricolor(float[] query, IconGroup group, List<String> rawTopIds,
                                          String distinctiveTopId, JSONObject shapeRank) throws JSONException {
        int width = group.width;
        int height = group.height;
        int channels = width * height * 3;
        if (width != 55 || height != 38 || query.length != channels || group.ids.length != 110
                || rawTopIds.size() < 3 || new LinkedHashSet<>(rawTopIds).size() != rawTopIds.size()) {
            throw new IllegalArgumentException("Expected one result-profile crop and 110 flag references");
        }
        String nlId = "country.nl", luId = "country.lu", pyId = "country.py";
        if (!nlId.equals(rawTopIds.get(0))) return tricolorUnavailable("different_first_flag");
        if (!nlId.equals(distinctiveTopId)) return tricolorUnavailable("distinctive_disagreement");
        int nlStart = group.indexOf(nlId) * channels;
        int luStart = group.indexOf(luId) * channels;
        double nlStripe = stripe(group.rgb, nlStart, width);
        double luStripe = stripe(group.rgb, luStart, width);
        if (!(luStripe < nlStripe)) return tricolorUnavailable("incompatible_reference_stripes");
        double boundary = (nlStripe + luStripe) / 2;
        double contrast = stripe(query, 0, width);
        double[] queryWhite = new double[3];
        double[] nlWhite = new double[3];
        for (int c = 0; c < 3; c++) {
            queryWhite[c] = sample(query, 0, width, 16, 22, c);
            nlWhite[c] = sample(group.rgb, nlStart, width, 16, 22, c);
        }
        JSONArray pairs = new JSONArray();
        Set<String> others = new LinkedHashSet<>(rawTopIds.subList(1, rawTopIds.size()));
        others.add(pyId);
        for (String id : others) {
            if (id.equals(luId) || id.equals(nlId)) continue;
            int otherStart = group.indexOf(id) * channels;
            double[] otherWhite = new double[3];
            for (int c = 0; c < 3; c++) otherWhite[c] = sample(group.rgb, otherStart, width, 16, 22, c);
            boolean[] different = new boolean[width * height];
            for (int y = 4; y < 34; y++) {
                for (int x = 8; x < 47; x++) {
                    int at = (y * width + x) * 3;
                    double most = 0;
                    for (int c = 0; c < 3; c++) {
                        most = Math.max(most, Math.abs((double) group.rgb[nlStart + at + c] - group.rgb[otherStart + at + c]));
                    }
                    different[y * width + x] = most > .055;
                }
            }
            double advantage = 0, separation = 0;
            int pixels = 0;
            for (int y = 5; y < 33; y++) {
                for (int x = 9; x < 46; x++) {
                    boolean eroded = true;
                    for (int dy = -1; dy <= 1 && eroded; dy++) {
                        for (int dx = -1; dx <= 1; dx++) {
                            if (!different[(y + dy) * width + x + dx]) {
                                eroded = false;
                                break;
                            }
                        }
                    }
                    if (!eroded) continue;
                    int at = (y * width + x) * 3;
                    for (int c = 0; c < 3; c++) {
                        double q = Math.min(1.2, query[at + c] / Math.max(.1, queryWhite[c]));
                        double a = Math.min(1.2, group.rgb[nlStart + at + c] / Math.max(.1, nlWhite[c]));
                        double b = Math.min(1.2, group.rgb[otherStart + at + c] / Math.max(.1, otherWhite[c]));
                        advantage += Math.abs(q - b) - Math.abs(q - a);
                        separation += Math.abs(a - b);
                    }
                    pixels++;
                }
            }
            if (pixels < 20) return tricolorUnavailable("insufficient_distinctive_pixels");
            pairs.put(new JSONObject().put("id", id).put("advantage", advantage / (pixels * 3))
                    .put("referenceSeparation", separation / (pixels * 3)));
        }
        boolean supported = contrast > boundary && pairs.length() > 0;
        for (int i = 0; i < pairs.length() && supported; i++) {
            JSONObject pair = pairs.getJSONObject(i);
            supported = pair.getDouble("advantage") > .2 * pair.getDouble("referenceSeparation");
        }
        JSONArray shapeTop = shapeRank == null ? null : shapeRank.optJSONArray("top");
        JSONObject first = shapeTop == null || shapeTop.length() == 0 ? null : shapeTop.getJSONObject(0);
        boolean luPattern = !supported && contrast <= luStripe + (nlStripe - luStripe) / 4
                && "full_rgb_ncc".equals(shapeRank == null ? null : shapeRank.optString("mode"))
                && first != null && luId.equals(first.optString("id"))
                && Double.isFinite(first.optDouble("score")) && first.optDouble("score") > 0;
        JSONObject result = new JSONObject().put("schema", "mk8dx.flag-tricolor-evidence.v1").put("status", "measured")
                .put("reason", supported ? "reference_stripes_and_pairwise_agree"
                        : luPattern ? "lu_pattern_and_stripe_agree" : "insufficient_separation")
                .put("acceptedId", supported ? nlId : JSONObject.NULL).put("stripeContrast", contrast)
                .put("stripeBoundary", boundary).put("pairAdvantages", pairs);
        if (luPattern) result.put("proposalId", luId).put("proposalShapeScore", first.getDouble("score"));
        return result;
    }

    private static JSONObject tricolorUnavailable(String reason) throws JSONException {
        return new JSONObject().put("schema", "mk8dx.flag-tricolor-evidence.v1").put("status", "unavailable")
                .put("reason", reason).put("acceptedId", JSONObject.NULL).put("stripeContrast", JSONObject.NULL)
                .put("stripeBoundary", JSONObject.NULL).put("pairAdvantages", new JSONArray());
    }

    // -------------------------------------------------------- family colour

    private static double[] oklab(float[] rgb, int at) {
        double r = linear(rgb[at]);
        double g = linear(rgb[at + 1]);
        double b = linear(rgb[at + 2]);
        double l = Math.cbrt(Math.max(0, .4122214708 * r + .5363325363 * g + .0514459929 * b));
        double m = Math.cbrt(Math.max(0, .2119034982 * r + .6806995451 * g + .1073969566 * b));
        double s = Math.cbrt(Math.max(0, .0883024619 * r + .2817188376 * g + .6299787005 * b));
        return new double[]{1.5 * (.2104542553 * l + .7936177850 * m - .0040720468 * s),
                2.5 * (1.9779984951 * l - 2.4285922050 * m + .4505937099 * s),
                2.5 * (.0259040371 * l + .7827717662 * m - .8086757660 * s)};
    }

    private static double linear(double value) {
        return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4);
    }

    public static JSONObject familyColour(float[] query, IconGroup group, IconScorer.Match primary) throws JSONException {
        int width = group.width;
        int height = group.height;
        int pixels = width * height;
        String familyId = primary.topFamilies.get(0);
        List<Integer> members = new ArrayList<>();
        for (int i = 0; i < group.ids.length; i++) {
            if (group.families[i].equals(familyId)) members.add(i);
        }
        if (members.size() < 2) return null;
        List<Integer> common = new ArrayList<>();
        List<Double> spreads = new ArrayList<>();
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                boolean covered = true;
                for (int member : members) {
                    for (int yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1) && covered; yy++) {
                        for (int xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
                            if (group.mask[member * pixels + yy * width + xx] == 0) {
                                covered = false;
                                break;
                            }
                        }
                    }
                    if (!covered) break;
                }
                if (!covered) continue;
                int at = y * width + x;
                double spread = 0;
                for (int c = 0; c < 3; c++) {
                    double hi = Double.NEGATIVE_INFINITY, lo = Double.POSITIVE_INFINITY;
                    for (int member : members) {
                        double v = group.rgb[(member * pixels + at) * 3 + c];
                        hi = Math.max(hi, v);
                        lo = Math.min(lo, v);
                    }
                    spread = Math.max(spread, hi - lo);
                }
                common.add(at);
                spreads.add(spread);
            }
        }
        if (common.size() < 24) return familyColourResult(familyId, "insufficient_cutout", common.size(), new JSONArray());
        List<Double> ordered = new ArrayList<>(spreads);
        ordered.sort(Double::compare);
        double position = (ordered.size() - 1) * .85;
        int lower = (int) Math.floor(position);
        double cutoff = ordered.get(lower) + (ordered.get((int) Math.ceil(position)) - ordered.get(lower)) * (position - lower);
        List<Integer> area = new ArrayList<>();
        for (int i = 0; i < common.size(); i++) {
            if (spreads.get(i) >= cutoff) area.add(common.get(i));
        }
        if (area.size() < 24) return familyColourResult(familyId, "insufficient_colour", area.size(), new JSONArray());
        int dx = primary.offset[0];
        int dy = primary.offset[1];
        List<Object[]> distances = new ArrayList<>();
        for (int member : members) {
            double sum = 0;
            for (int pixel : area) {
                int x = pixel % width;
                int y = pixel / width;
                int sx = Math.max(0, Math.min(width - 1, x - dx));
                int sy = Math.max(0, Math.min(height - 1, y - dy));
                double[] observed = oklab(query, (sy * width + sx) * 3);
                double[] reference = oklab(group.rgb, (member * pixels + pixel) * 3);
                sum += Math.abs(reference[0] - observed[0]) + Math.abs(reference[1] - observed[1])
                        + Math.abs(reference[2] - observed[2]);
            }
            distances.add(new Object[]{group.ids[member], sum / (area.size() * 3)});
        }
        distances.sort((a, b) -> Double.compare((Double) a[1], (Double) b[1]));
        JSONArray top = new JSONArray();
        for (Object[] item : distances) top.put(new JSONObject().put("id", item[0]).put("distance", item[1]));
        return familyColourResult(familyId, "measured", area.size(), top);
    }

    private static JSONObject familyColourResult(String familyId, String status, int observed, JSONArray top) throws JSONException {
        return new JSONObject().put("schema", "mk8dx.family-colour-rank.v1").put("method", "oklab")
                .put("familyId", familyId).put("status", status).put("observedPixels", observed).put("top", top);
    }

    // ------------------------------------------------------- neutral chroma

    private static int asByte(double value) {
        return (int) Math.max(0, Math.min(255, jsRound(value * 255)));
    }

    /** {hue, saturation} exactly as sharedNeutralChroma.ts. */
    private static int[] hsv(float[] rgb, int offset) {
        int r = asByte(rgb[offset]);
        int g = asByte(rgb[offset + 1]);
        int b = asByte(rgb[offset + 2]);
        int high = Math.max(r, Math.max(g, b));
        int low = Math.min(r, Math.min(g, b));
        int delta = high - low;
        int saturation = high == 0 ? 0 : (int) jsRound(delta * 255.0 / high);
        if (delta == 0) return new int[]{0, saturation};
        double degrees = high == r ? 60.0 * (g - b) / delta : high == g ? 120 + 60.0 * (b - r) / delta
                : 240 + 60.0 * (r - g) / delta;
        if (degrees < 0) degrees += 360;
        return new int[]{(int) (jsRound(degrees / 2) % 180), saturation};
    }

    public static JSONObject neutralChroma(float[] query, IconGroup group, IconScorer.Match visual) throws JSONException {
        int pixels = group.width * group.height;
        String firstId = visual.topIds.get(0);
        double firstScore = visual.topScores.get(0);
        double firstSat = referenceSaturation(group, group.indexOf(firstId));
        JSONObject review = new JSONObject().put("schema", "mk8dx.neutral-chroma-review.v1").put("status", "not_applicable")
                .put("rawTop1Id", firstId).put("proposalId", firstId).put("rawScore", firstScore)
                .put("proposalScore", firstScore).put("referenceSaturation", firstSat)
                .put("querySaturation", JSONObject.NULL)
                .put("offset", new JSONArray().put(visual.offset[0]).put(visual.offset[1]))
                .put("considered", new JSONArray());
        if (firstSat > .06) return review;
        int firstPosition = group.indexOf(firstId);
        int dx = visual.offset[0];
        int dy = visual.offset[1];
        double sum = 0;
        int count = 0;
        for (int y = 0; y < group.height; y++) {
            for (int x = 0; x < group.width; x++) {
                if (group.mask[firstPosition * pixels + y * group.width + x] == 0) continue;
                int sx = Math.max(0, Math.min(group.width - 1, x - dx));
                int sy = Math.max(0, Math.min(group.height - 1, y - dy));
                int[] colour = hsv(query, (sy * group.width + sx) * 3);
                if (colour[0] >= 18 && colour[0] <= 36) continue;
                sum += colour[1];
                count++;
            }
        }
        if (count == 0) return review.put("status", "insufficient_pixels");
        double querySat = sum / count / 255;
        review.put("querySaturation", querySat);
        if (querySat < .12) return review.put("status", "insufficient_colour");
        review.put("status", "measured");
        JSONArray considered = review.getJSONArray("considered");
        for (int i = 1; i < Math.min(3, visual.topIds.size()); i++) {
            String id = visual.topIds.get(i);
            double score = visual.topScores.get(i);
            double referenceSat = referenceSaturation(group, group.indexOf(id));
            double gap = firstScore - score;
            considered.put(new JSONObject().put("id", id).put("score", score)
                    .put("referenceSaturation", referenceSat).put("scoreGap", gap));
            if (referenceSat > .06 && gap <= .02) {
                review.put("status", "alternative").put("proposalId", id).put("proposalScore", score);
                break;
            }
        }
        return review;
    }

    private static double referenceSaturation(IconGroup group, int position) {
        int pixels = group.width * group.height;
        double sum = 0;
        int count = 0;
        for (int pixel = 0; pixel < pixels; pixel++) {
            if (group.mask[position * pixels + pixel] == 0) continue;
            sum += hsv(group.rgb, (position * pixels + pixel) * 3)[1];
            count++;
        }
        return count > 0 ? sum / count / 255 : 0;
    }
}
