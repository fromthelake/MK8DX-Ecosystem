package nl.mariokart8.iconmatcher.result;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The central sequence decision for a Time Trial scan (CENTRAL_RECOGNITION section 8.6, phase 6):
 * the Java port of python/mk8dx_icon_matcher/sequence_decision.py (the reference) and
 * ts/sharedSequenceDecision.ts, kept equal by the parity vectors
 * (tooling/recognition/sequence_decision_vectors.py). Plain Java on maps and lists. Iteration order
 * is insertion order everywhere (first best wins on ties).
 */
public final class SequenceDecision {
    public static final int FIELD_MIN_SUPPORT = 3;
    public static final int FIELD_MIN_MARGIN = 2;
    private static final int ACCEPTED_VOTE_WEIGHT = 2;
    public static final String[] KINDS = {"character", "kart", "wheel", "glider", "flag"};
    private static final Pattern TIME = Pattern.compile("[0-9]:[0-9][0-9]\\.[0-9][0-9][0-9]");

    public boolean locked;
    public String acceptPath = "";
    public Map<String, String> lockedFields = new LinkedHashMap<>();
    public int framesAnalyzed;
    public int acceptedFrames;
    public int identityFrames;

    private final List<Map<String, String>> frames = new ArrayList<>();
    private final List<Boolean> accepted = new ArrayList<>();
    private Map<String, String> repairCandidate;
    private int expected;
    private final Map<String, LinkedHashMap<String, Integer>> votes = new LinkedHashMap<>();
    private final Map<String, LinkedHashMap<String, Map<?, ?>>> meta = new LinkedHashMap<>();
    private final Map<String, LinkedHashMap<String, Integer>> names = new LinkedHashMap<>();

    private static long millis(String value) {
        return (value.charAt(0) - '0') * 60000L + (value.charAt(2) - '0') * 10000L + (value.charAt(3) - '0') * 1000L
            + Long.parseLong(value.substring(5));
    }

    private static void repairImpossibleSeconds(Map<String, String> valid) {
        for (String owner : new String[]{"player", "ghost"}) {
            String total = valid.get(owner + "_total");
            if (total == null || total.charAt(2) > '5') continue;
            List<String> lapKeys = new ArrayList<>();
            for (int lap = 1; lap <= 7; lap++) {
                String key = owner + "_lap_" + lap;
                if (!valid.containsKey(key)) break;
                lapKeys.add(key);
            }
            if (lapKeys.size() < 2) continue;
            long sum = 0;
            String broken = null;
            for (String key : lapKeys) {
                String value = valid.get(key);
                if (value.charAt(2) > '5') {
                    if (broken != null) return;
                    broken = key;
                }
                sum += millis(value);
            }
            if (broken == null) continue;
            String value = valid.get(broken);
            String fixed = value.substring(0, 2) + "0" + value.substring(3);
            if (sum - millis(value) + millis(fixed) == millis(total)) valid.put(broken, fixed);
        }
    }

    /** {best key, best count, second count}. */
    private static Object[] best(Map<String, Integer> counts) {
        String bestKey = null;
        int top = 0;
        int second = 0;
        for (Map.Entry<String, Integer> entry : counts.entrySet()) {
            int count = entry.getValue();
            if (count > top) {
                second = top;
                top = count;
                bestKey = entry.getKey();
            } else if (count > second) {
                second = count;
            }
        }
        return new Object[]{bestKey, top, second};
    }

    /** The winner of {@link #fieldVote}. */
    public static final class FieldVote {
        public Object value;
        public double weight;
        public double second;
        public double share;
    }

    /**
     * The shared multi-frame vote for one field (Python field_vote): {value, weight} pairs per frame,
     * empty values skipped, negative weights count as 0 (the first value wins when every weight is 0); weights sum per value in first-seen order; the
     * highest sum wins, the first on a tie; null below minSupport or with a lead under minMargin.
     */
    public static FieldVote fieldVote(List<Object[]> values, double minSupport, double minMargin) {
        Map<Object, Double> sums = new LinkedHashMap<>();
        double total = 0;
        for (Object[] pair : values) {
            Object value = pair[0];
            if (value == null || "".equals(value)) continue;
            double w = Math.max(0.0, ((Number) pair[1]).doubleValue());
            if (Double.isNaN(w)) w = 0.0;
            sums.merge(value, w, Double::sum);
            total += w;
        }
        if (sums.isEmpty()) return null;
        Object bestValue = null;
        double top = 0;
        double second = 0;
        for (Map.Entry<Object, Double> entry : sums.entrySet()) {
            double count = entry.getValue();
            if (count > top) {
                second = top;
                top = count;
                bestValue = entry.getKey();
            } else if (count > second) {
                second = count;
            }
        }
        if (bestValue == null) bestValue = sums.keySet().iterator().next();  // every weight 0
        if (top < minSupport || top - second < minMargin) return null;
        FieldVote out = new FieldVote();
        out.value = bestValue;
        out.weight = top;
        out.second = second;
        out.share = total > 0 ? top / total : 0;
        return out;
    }

    private static double scoreOf(Map<?, ?> observation) {
        if (observation == null) return 0.0;
        Object score = observation.get("score");
        return score instanceof Number ? ((Number) score).doubleValue() : 0.0;
    }

    /** One analysed frame's times; true when this frame locked the times. */
    public boolean updateTimes(Map<String, ?> fields, boolean lapSumOk, int lapSumRepairs, int expectedFields) {
        framesAnalyzed++;
        if (fields == null || fields.isEmpty()) return false;
        if (expectedFields > 0) expected = expectedFields;
        Map<String, String> valid = new LinkedHashMap<>();
        for (Map.Entry<String, ?> entry : fields.entrySet()) {
            Object value = entry.getValue();
            if (value instanceof String && ((String) value).length() == 8 && TIME.matcher((String) value).matches()) {
                valid.put(entry.getKey(), (String) value);
            }
        }
        repairImpossibleSeconds(valid);
        valid.entrySet().removeIf(entry -> entry.getValue().charAt(2) > '5');
        if (valid.isEmpty()) return false;
        frames.add(valid);
        accepted.add(lapSumOk);
        if (lapSumOk) acceptedFrames++;
        if (locked) return false;
        if (lapSumOk && lapSumRepairs == 0 && valid.size() >= Math.max(2, expected)) {
            lock(valid, "direct_lap_som");
            return true;
        }
        if (lapSumOk && lapSumRepairs > 0) {
            if (repairCandidate != null && repairCandidate.equals(valid)) {
                lock(valid, "bevestigd_na_reparatie");
                return true;
            }
            repairCandidate = new LinkedHashMap<>(valid);
        }
        Map<String, String> candidate = fieldVoteCandidate();
        int required = expected > 0 ? expected : valid.size();
        if (required > 0 && candidate.size() >= required) {
            lock(candidate, "veld_stemming");
            return true;
        }
        return false;
    }

    private void lock(Map<String, String> fields, String path) {
        locked = true;
        acceptPath = path;
        lockedFields = new LinkedHashMap<>(fields);
    }

    private Map<String, String> fieldVoteCandidate() {
        Map<String, List<Object[]>> votes = new LinkedHashMap<>();
        for (int i = 0; i < frames.size(); i++) {
            int weight = accepted.get(i) ? ACCEPTED_VOTE_WEIGHT : 1;
            for (Map.Entry<String, String> entry : frames.get(i).entrySet()) {
                votes.computeIfAbsent(entry.getKey(), k -> new ArrayList<>()).add(new Object[]{entry.getValue(), weight});
            }
        }
        Map<String, String> candidate = new LinkedHashMap<>();
        for (Map.Entry<String, List<Object[]>> entry : votes.entrySet()) {
            FieldVote won = fieldVote(entry.getValue(), FIELD_MIN_SUPPORT, FIELD_MIN_MARGIN);
            if (won != null) candidate.put(entry.getKey(), (String) won.value);
        }
        return candidate;
    }

    private static boolean blank(char c) {
        return c == ' ' || c == '\t' || c == '\r' || c == '\n';
    }

    private static String trim(String s) {
        int start = 0;
        int end = s.length();
        while (start < end && blank(s.charAt(start))) start++;
        while (end > start && blank(s.charAt(end - 1))) end--;
        return s.substring(start, end);
    }

    private static String keyText(Object value) {
        if (value instanceof Double || value instanceof Float) {
            double d = ((Number) value).doubleValue();
            if (d == Math.rint(d) && !Double.isInfinite(d)) return Long.toString((long) d);
        }
        return String.valueOf(value);
    }

    /** One frame's identity reads: {owner: {kind: observation, "card_name": text}}. */
    public void addIdentity(Map<String, ?> owners) {
        if (owners == null) return;
        identityFrames++;
        for (Map.Entry<String, ?> ownerEntry : owners.entrySet()) {
            if (!(ownerEntry.getValue() instanceof Map)) continue;
            String owner = ownerEntry.getKey();
            Map<?, ?> match = (Map<?, ?>) ownerEntry.getValue();
            Object rawName = match.get("card_name");
            String cardName = rawName instanceof String ? trim((String) rawName) : "";
            if (!cardName.isEmpty()) names.computeIfAbsent(owner, k -> new LinkedHashMap<>()).merge(cardName, 1, Integer::sum);
            for (String kind : KINDS) {
                if (!(match.get(kind) instanceof Map)) continue;
                Map<?, ?> result = (Map<?, ?>) match.get(kind);
                String voteKey = result.get("id") != null ? keyText(result.get("id"))
                    : result.get("index") != null ? keyText(result.get("index")) : "";
                if (voteKey.isEmpty()) continue;
                String slot = owner + "|" + kind;
                boolean ok = Boolean.TRUE.equals(result.get("ok"));
                votes.computeIfAbsent(slot, k -> new LinkedHashMap<>()).merge(voteKey, ok ? ACCEPTED_VOTE_WEIGHT : 1, Integer::sum);
                LinkedHashMap<String, Map<?, ?>> slotMeta = meta.computeIfAbsent(slot, k -> new LinkedHashMap<>());
                Map<?, ?> previous = slotMeta.get(voteKey);
                if (previous == null || (ok && !Boolean.TRUE.equals(previous.get("ok"))) || scoreOf(result) > scoreOf(previous)) {
                    slotMeta.put(voteKey, result);
                }
            }
        }
    }

    public boolean identitySettled() {
        if (identityFrames < 2 || votes.isEmpty()) return false;
        for (Map.Entry<String, LinkedHashMap<String, Integer>> entry : votes.entrySet()) {
            String bestKey = null;
            int top = 0;
            int total = 0;
            for (Map.Entry<String, Integer> vote : entry.getValue().entrySet()) {
                total += vote.getValue();
                if (vote.getValue() > top) {
                    top = vote.getValue();
                    bestKey = vote.getKey();
                }
            }
            if (bestKey == null || top < 2 || top != total) return false;
            Map<?, ?> m = meta.get(entry.getKey()) == null ? null : meta.get(entry.getKey()).get(bestKey);
            if (m == null || !Boolean.TRUE.equals(m.get("ok"))) return false;
        }
        return true;
    }

    /** {owner: {kind: entry map, "card_name": text}}, entries as the products' snapshots carry them. */
    public Map<String, Map<String, Object>> identitySnapshot() {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        for (Map.Entry<String, LinkedHashMap<String, Integer>> slotEntry : votes.entrySet()) {
            String slot = slotEntry.getKey();
            int bar = slot.indexOf('|');
            String owner = slot.substring(0, bar);
            String kind = slot.substring(bar + 1);
            Object[] b = best(slotEntry.getValue());
            if (b[0] == null) continue;
            int top = (Integer) b[1];
            int second = (Integer) b[2];
            Map<?, ?> m = meta.get(slot) == null ? null : meta.get(slot).get((String) b[0]);
            boolean uncertain = second >= top || m == null || !Boolean.TRUE.equals(m.get("ok"));
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", m == null || m.get("id") == null ? "" : keyText(m.get("id")));
            entry.put("index", m == null || !(m.get("index") instanceof Number) ? -1 : ((Number) m.get("index")).intValue());
            entry.put("name", m != null && m.get("name") instanceof String ? m.get("name") : "");
            entry.put("asset_ref", m != null && m.get("asset_ref") instanceof String ? m.get("asset_ref") : "");
            entry.put("score", scoreOf(m));
            entry.put("ok", !uncertain);
            entry.put("votes", top);
            entry.put("frames", identityFrames);
            if (m != null && m.get("crop_png") instanceof String) entry.put("crop_png", m.get("crop_png"));
            if (m != null && m.get("crop_path") instanceof String) entry.put("crop_path", m.get("crop_path"));
            if (uncertain && m != null && m.get("alternatives") instanceof List && !((List<?>) m.get("alternatives")).isEmpty()) {
                entry.put("alternatives", m.get("alternatives"));
            }
            out.computeIfAbsent(owner, k -> new LinkedHashMap<>()).put(kind, entry);
        }
        for (Map.Entry<String, LinkedHashMap<String, Integer>> ownerNames : names.entrySet()) {
            String bestName = null;
            int top = 0;
            for (Map.Entry<String, Integer> vote : ownerNames.getValue().entrySet()) {
                if (vote.getValue() > top) {
                    top = vote.getValue();
                    bestName = vote.getKey();
                }
            }
            if (bestName != null) out.computeIfAbsent(ownerNames.getKey(), k -> new LinkedHashMap<>()).put("card_name", bestName);
        }
        return out;
    }

    /** The sequence decision as the central scan result reads it (ScanResult.compose). */
    public Map<String, Object> result() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("locked", locked);
        out.put("acceptPath", acceptPath);
        out.put("fields", new LinkedHashMap<>(lockedFields));
        out.put("identity", identitySnapshot());
        out.put("framesAnalyzed", framesAnalyzed);
        out.put("acceptedFrames", acceptedFrames);
        return out;
    }
}
