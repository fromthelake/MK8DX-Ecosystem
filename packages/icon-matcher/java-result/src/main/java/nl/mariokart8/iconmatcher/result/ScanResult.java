package nl.mariokart8.iconmatcher.result;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The central scan result (CENTRAL_RECOGNITION section 8.6, phase 4): the Java port of
 * python/mk8dx_icon_matcher/scan_result.py (the reference) and ts/sharedScanResult.ts, kept equal
 * by the parity vectors (tooling/recognition/scan_result_vectors.py). Plain Java on maps and lists
 * (the parsed JSON of the sequence decision's result), so the Android app uses it without the scan
 * runtime.
 */
public final class ScanResult {
    public static final String SCHEMA = "mk8dx.scan-result.v1";
    public static final double DOUBT_BELOW = 0.75;
    private static final int MAX_ALTERNATIVES = 2;
    private static final int MAX_NAME_CODE_POINTS = 64;
    private static final int MAX_TIME_MS = 599999;
    private static final Pattern TIME = Pattern.compile("^([0-9]):([0-5][0-9])\\.([0-9]{3})$");
    /** Contract part name, then the sequence decision's slot name. */
    public static final String[][] PARTS = {
        {"character", "character"}, {"body", "kart"}, {"tire", "wheel"}, {"glider", "glider"}, {"country", "flag"},
    };

    public static final class Alternative {
        public String id;
        public Integer index;
        public String name;
    }

    public static final class Part {
        public boolean present;
        public boolean accepted;
        public String id;
        public Integer index;
        public Double score;
        public boolean doubt;
        public final List<Alternative> alternatives = new ArrayList<>();
    }

    public static final class Lap {
        public String time;
        public Integer ms;
    }

    public String status = "ok";
    public String owner;
    public String layout;
    public String captureLayout;
    public String acceptPath;
    public String totalTime;
    public Integer totalMs;
    public final List<Lap> laps = new ArrayList<>();
    public boolean lapsComplete;
    public Boolean lapSumMatches;
    public final Map<String, Part> parts = new LinkedHashMap<>();
    public final Map<String, Double> confidence = new LinkedHashMap<>();
    /** Part names and "laps" the player must check. */
    public final List<String> doubt = new ArrayList<>();
    public String observedPlayerName;

    /** Milliseconds of a readable m:ss.mmm time; null for anything else. */
    public static Integer timeMs(Object value) {
        if (!(value instanceof String)) return null;
        Matcher m = TIME.matcher((String) value);
        if (!m.matches()) return null;
        int ms = Integer.parseInt(m.group(1)) * 60000 + Integer.parseInt(m.group(2)) * 1000 + Integer.parseInt(m.group(3));
        return ms >= 1 && ms <= MAX_TIME_MS ? ms : null;
    }

    private static Double round4(Object score) {
        if (!(score instanceof Number) || score instanceof Boolean) return null;
        double value = ((Number) score).doubleValue();
        if (Double.isNaN(value) || Double.isInfinite(value)) return null;
        return Math.floor(value * 10000 + 0.5) / 10000;
    }

    private static Integer intOf(Object value) {
        if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte) {
            return ((Number) value).intValue();
        }
        if (value instanceof Number) {
            double d = ((Number) value).doubleValue();
            if (d == Math.rint(d) && !Double.isInfinite(d)) return (int) d;
        }
        return null;
    }

    private static Part partOf(Object raw) {
        Part part = new Part();
        if (!(raw instanceof Map)) return part;
        Map<?, ?> slot = (Map<?, ?>) raw;
        part.present = true;
        part.accepted = Boolean.TRUE.equals(slot.get("ok"));
        part.score = round4(slot.get("score"));
        Object id = slot.get("id");
        part.id = id instanceof String && !((String) id).isEmpty() ? (String) id : null;
        part.index = intOf(slot.get("index"));
        Object alternatives = slot.get("alternatives");
        if (!part.accepted && alternatives instanceof List) {
            List<?> list = (List<?>) alternatives;
            for (int i = 0; i < list.size() && i < MAX_ALTERNATIVES; i++) {
                if (!(list.get(i) instanceof Map)) continue;
                Map<?, ?> a = (Map<?, ?>) list.get(i);
                Alternative alt = new Alternative();
                alt.id = a.get("id") instanceof String ? (String) a.get("id") : null;
                alt.index = intOf(a.get("index"));
                alt.name = a.get("name") instanceof String ? (String) a.get("name") : null;
                part.alternatives.add(alt);
            }
        }
        part.doubt = part.accepted && part.score != null && part.score < DOUBT_BELOW;
        return part;
    }

    private static boolean blank(char c) {
        return c == ' ' || c == '\t' || c == '\r' || c == '\n';
    }

    private static String nameOf(Object value) {
        if (!(value instanceof String)) return null;
        String s = (String) value;
        int start = 0;
        int end = s.length();
        while (start < end && blank(s.charAt(start))) start++;
        while (end > start && blank(s.charAt(end - 1))) end--;
        String name = s.substring(start, end);
        int points = name.codePointCount(0, name.length());
        return points >= 1 && points <= MAX_NAME_CODE_POINTS ? name : null;
    }

    /** The scan result of a sequence decision; lapCount: the track's lap count when known (null otherwise). */
    public static ScanResult compose(Map<String, ?> consensus, Integer lapCount) {
        ScanResult out = new ScanResult();
        Object rawFields = consensus.get("fields");
        Map<?, ?> fields = rawFields instanceof Map ? (Map<?, ?>) rawFields : new LinkedHashMap<>();
        out.owner = fields.containsKey("player_total") ? "player" : "ghost";
        Object layout = consensus.get("layout");
        out.layout = "endscreen".equals(layout) || "ghost_detail".equals(layout) ? (String) layout
            : "player".equals(out.owner) ? "endscreen" : "ghost_detail";
        out.captureLayout = "endscreen".equals(out.layout) ? "time_trial_result" : "ghost_details";
        Object path = consensus.containsKey("acceptPath") ? consensus.get("acceptPath") : consensus.get("accept_path");
        out.acceptPath = path instanceof String ? (String) path : null;
        if (!Boolean.TRUE.equals(consensus.get("locked"))) {
            out.status = "not_locked";
            return out;
        }
        Object total = fields.get(out.owner + "_total");
        Integer totalMs = timeMs(total);
        if (totalMs == null) {
            out.status = "no_total";
            return out;
        }
        out.totalTime = (String) total;
        out.totalMs = totalMs;
        int last = 0;
        for (int lap = 1; lap <= 7; lap++) if (fields.containsKey(out.owner + "_lap_" + lap)) last = lap;
        boolean allRead = true;
        int sum = 0;
        for (int lap = 1; lap <= last; lap++) {
            Object value = fields.get(out.owner + "_lap_" + lap);
            Lap l = new Lap();
            l.ms = timeMs(value);
            l.time = l.ms != null ? (String) value : null;
            if (l.ms == null) allRead = false; else sum += l.ms;
            out.laps.add(l);
        }
        out.lapsComplete = (last == 3 || last == 7) && allRead && (lapCount == null || last == lapCount);
        if (out.lapsComplete) {
            out.lapSumMatches = sum == totalMs;
            if (!out.lapSumMatches) out.doubt.add("laps");
        }
        Object rawIdentity = consensus.get("identity");
        Object rawOwner = rawIdentity instanceof Map ? ((Map<?, ?>) rawIdentity).get(out.owner) : null;
        Map<?, ?> identity = rawOwner instanceof Map ? (Map<?, ?>) rawOwner : new LinkedHashMap<>();
        for (String[] pair : PARTS) {
            Part part = partOf(identity.get(pair[1]));
            out.parts.put(pair[0], part);
            if (part.accepted && part.score != null) out.confidence.put(pair[0], part.score);
            if (part.doubt) out.doubt.add(pair[0]);
        }
        out.observedPlayerName = nameOf(identity.get("card_name"));
        return out;
    }
}
