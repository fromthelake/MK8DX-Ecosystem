package nl.mariokart8.iconmatcher;

import java.util.List;

/**
 * The central time decision across the fields of one card (Python time_decision.py, TS
 * sharedTimeDecision.ts; CENTRAL_RECOGNITION section 8.6, phase 2c): the M:SS.mmm format, the
 * lap sum, the single-digit fill/flip that closes it, and the repair-confidence guard.
 */
public final class TimeDecision {
    public static final int[] DIGIT_POSITIONS = {0, 2, 3, 5, 6, 7};
    public static final double REPAIR_MIN_DIGIT_CONFIDENCE = 0.65;

    private TimeDecision() {
    }

    private static boolean isDigit(char c) {
        return c >= '0' && c <= '9';
    }

    public static boolean formatValid(String text) {
        if (text == null || text.length() != 8 || text.charAt(1) != ':' || text.charAt(4) != '.') return false;
        for (int pos : DIGIT_POSITIONS) if (!isDigit(text.charAt(pos))) return false;
        int seconds = Integer.parseInt(text.substring(2, 4));
        return seconds >= 0 && seconds <= 59;
    }

    public static Integer timeMs(String text) {
        if (!formatValid(text)) return null;
        return Integer.parseInt(text.substring(0, 1)) * 60000 + Integer.parseInt(text.substring(2, 4)) * 1000
                + Integer.parseInt(text.substring(5, 8));
    }

    /** One owner's times; {@code total} may be null. */
    public static final class OwnerTimes {
        public final String total;
        public final List<String> laps;

        public OwnerTimes(String total, List<String> laps) {
            this.total = total;
            this.laps = laps;
        }
    }

    /** Every owner that shows times closes, and at least one does. */
    public static boolean lapSumComplete(List<OwnerTimes> owners) {
        int closed = 0;
        for (OwnerTimes owner : owners) {
            if (owner.total == null && owner.laps.isEmpty()) continue;
            Integer total = owner.total == null ? null : timeMs(owner.total);
            if (total == null || owner.laps.isEmpty()) return false;
            int lapSum = 0;
            for (String lap : owner.laps) {
                Integer ms = timeMs(lap);
                if (ms == null) return false;
                lapSum += ms;
            }
            if (lapSum != total) return false;
            closed++;
        }
        return closed > 0;
    }

    private static String replaceAt(String text, int pos, char c) {
        return text.substring(0, pos) + c + text.substring(pos + 1);
    }

    private static Integer delta(List<String> texts, int index, String replacement) {
        int total = 0, lapSum = 0;
        for (int i = 0; i < texts.size(); i++) {
            Integer ms = timeMs(i == index ? replacement : texts.get(i));
            if (ms == null) return null;
            if (i == 0) total = ms;
            else lapSum += ms;
        }
        return lapSum - total;
    }

    /** The single repair that closes one owner's sum. */
    public static final class Repair {
        public final int field, pos;
        public final String from, to, kind;

        Repair(int field, int pos, String from, String to, String kind) {
            this.field = field;
            this.pos = pos;
            this.from = from;
            this.to = to;
            this.kind = kind;
        }
    }

    /** {@code texts}: one owner's [total, lap1, lap2, ...]; the repair, or null. */
    public static Repair lapSumClosure(List<String> texts) {
        for (String t : texts) {
            if (t == null || t.length() != 8 || t.charAt(1) != ':' || t.charAt(4) != '.') return null;
        }
        int unknownCount = 0, unknownField = -1, unknownPos = -1;
        for (int f = 0; f < texts.size(); f++) {
            for (int pos : DIGIT_POSITIONS) {
                if (!isDigit(texts.get(f).charAt(pos))) {
                    unknownCount++;
                    unknownField = f;
                    unknownPos = pos;
                }
            }
        }
        if (unknownCount == 1) {
            String fit = null;
            int fits = 0;
            for (int d = 0; d <= 9; d++) {
                String candidate = replaceAt(texts.get(unknownField), unknownPos, (char) ('0' + d));
                Integer delta = delta(texts, unknownField, candidate);
                if (formatValid(candidate) && delta != null && delta == 0) {
                    fit = candidate;
                    fits++;
                }
            }
            return fits == 1 ? new Repair(unknownField, unknownPos, texts.get(unknownField), fit, "fill") : null;
        }
        if (unknownCount > 0) return null;
        Integer current = delta(texts, -1, null);
        if (current == null || current == 0) return null;
        Repair found = null;
        int count = 0;
        for (int f = 0; f < texts.size(); f++) {
            String text = texts.get(f);
            for (int pos : DIGIT_POSITIONS) {
                for (int d = 0; d <= 9; d++) {
                    char c = (char) ('0' + d);
                    if (c == text.charAt(pos)) continue;
                    String candidate = replaceAt(text, pos, c);
                    Integer delta = delta(texts, f, candidate);
                    if (formatValid(candidate) && delta != null && delta == 0) {
                        found = new Repair(f, pos, text, candidate, "flip");
                        count++;
                    }
                }
            }
        }
        return count == 1 ? found : null;
    }

    /** True when a repaired, closed sum must count as open (the guard applies). */
    public static boolean repairGuardApplies(boolean lapSumOk, int repairCount, double minDigitConfidence) {
        return lapSumOk && repairCount > 0 && minDigitConfidence < REPAIR_MIN_DIGIT_CONFIDENCE;
    }


    /** A refinement cannot displace a closed seed if its closure fails the confidence guard. */
    public static boolean preferClosedSeed(boolean seedLapSumOk, boolean refinedLapSumOk,
            int refinedRepairCount, double refinedMinDigitConfidence) {
        return seedLapSumOk && (!refinedLapSumOk || repairGuardApplies(
                refinedLapSumOk, refinedRepairCount, refinedMinDigitConfidence));
    }
}
