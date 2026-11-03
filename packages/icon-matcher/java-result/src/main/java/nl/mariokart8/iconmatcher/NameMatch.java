package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The central printed-name matcher (Python name_match.py, TS sharedNameMatch.ts;
 * CENTRAL_RECOGNITION section 8.6, phase 3): normalized Levenshtein on UTF-16 code units, first
 * best name wins, margin against the best name spelled differently. The same rules as the
 * preserved Android TextEvidence.matchVocab.
 */
public final class NameMatch {
    public static final double FUZZY_MIN = 0.85;
    public static final double MARGIN_MIN = 0.08;
    public static final double WEAK_FUZZY_MIN = 0.78;
    public static final double WEAK_MARGIN_MIN = 0.25;

    public String key;
    public String name;
    public double fuzzy;
    public double margin;

    public boolean strong() {
        return (fuzzy >= FUZZY_MIN && margin >= MARGIN_MIN) || (fuzzy >= WEAK_FUZZY_MIN && margin >= WEAK_MARGIN_MIN);
    }

    public static String normalize(String text) {
        if (text == null) return "";
        StringBuilder sb = new StringBuilder();
        String lower = text.toLowerCase(Locale.ROOT);
        for (int i = 0; i < lower.length(); ) {
            int cp = lower.codePointAt(i);
            int type = Character.getType(cp);
            if (Character.isLetter(cp) || type == Character.DECIMAL_DIGIT_NUMBER) sb.appendCodePoint(cp);
            i += Character.charCount(cp);
        }
        return sb.toString();
    }

    /** 1 - levenshtein/maxlen on UTF-16 code units. */
    public static double similarity(String a, String b) {
        if (a.isEmpty() || b.isEmpty()) return 0.0;
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] tmp = prev;
            prev = cur;
            cur = tmp;
        }
        return 1.0 - prev[b.length()] / (double) Math.max(a.length(), b.length());
    }

    /** The names of one locale (keys "id#locale"; keys without a locale stay); all when it has none. */
    public static List<Map.Entry<String, String>> filterLocale(List<Map.Entry<String, String>> vocab, String locale) {
        if (locale == null) return vocab;
        List<Map.Entry<String, String>> out = new java.util.ArrayList<>();
        for (Map.Entry<String, String> entry : vocab) {
            String key = entry.getKey();
            if (key.endsWith("#" + locale) || key.indexOf('#') < 0) out.add(entry);
        }
        return out.isEmpty() ? vocab : out;
    }

    public static List<String> vocabLocales(List<Map.Entry<String, String>> vocab) {
        java.util.TreeSet<String> locales = new java.util.TreeSet<>();
        for (Map.Entry<String, String> entry : vocab) {
            int h = entry.getKey().indexOf('#');
            if (h >= 0) locales.add(entry.getKey().substring(h + 1));
        }
        return new java.util.ArrayList<>(locales);
    }

    /** The OCR reader (script) that prints a game locale's names; null for no locale. */
    public static String scriptForLocale(String locale) {
        if (locale == null) return null;
        switch (locale) {
            case "ja-JP": return "ja";
            case "zh-CN": return "zh";
            case "zh-TW": return "zh_tw";
            case "ko-KR": return "ko";
            case "ru-RU": return "ru";
            default: return "latin";
        }
    }

    /** Every locale whose name for the matched item is spelled like the match (Python same_name_locales). */
    public static List<String> sameNameLocales(List<Map.Entry<String, String>> vocab, String key) {
        java.util.TreeSet<String> out = new java.util.TreeSet<>();
        if (key == null || key.indexOf('#') < 0) return new java.util.ArrayList<>(out);
        String item = key.substring(0, key.indexOf('#'));
        String target = null;
        for (Map.Entry<String, String> entry : vocab) if (entry.getKey().equals(key)) target = normalize(entry.getValue());
        for (Map.Entry<String, String> entry : vocab) {
            int h = entry.getKey().indexOf('#');
            if (h >= 0 && entry.getKey().substring(0, h).equals(item) && normalize(entry.getValue()).equals(target)) {
                out.add(entry.getKey().substring(h + 1));
            }
        }
        return new java.util.ArrayList<>(out);
    }

    /** The winning locale of {@link #vote}. */
    public static final class Vote {
        public String locale;
        public double score;
        public final List<String> tied = new java.util.ArrayList<>();
        public NameMatch firstMatch;
    }

    /**
     * The console language from every printed name of one card at once (Python locale_vote): the
     * highest sum of the rows' best fuzzy match per locale wins; ties go to the earlier locale in
     * preferred + sorted(rest). {@code rows}: {kind, text}, kart first.
     */
    public static Vote vote(List<String[]> rows, Map<String, List<Map.Entry<String, String>>> vocabs,
                            List<String> locales, List<String> preferred) {
        List<String> order = new java.util.ArrayList<>();
        if (preferred != null) for (String loc : preferred) if (locales.contains(loc) && !order.contains(loc)) order.add(loc);
        List<String> rest = new java.util.ArrayList<>();
        for (String loc : locales) if (!order.contains(loc)) rest.add(loc);
        java.util.Collections.sort(rest);
        order.addAll(rest);
        Map<String, Double> scores = new java.util.HashMap<>();
        Map<String, NameMatch> firsts = new java.util.HashMap<>();
        for (String locale : order) {
            double joint = 0;
            for (int i = 0; i < rows.size(); i++) {
                String text = rows.get(i)[1];
                if (text == null || text.isEmpty()) continue;
                NameMatch found = match(text, filterLocale(vocabs.get(rows.get(i)[0]), locale));
                joint += found.fuzzy;
                if (i == 0) firsts.put(locale, found);
            }
            scores.put(locale, joint);
        }
        Vote out = new Vote();
        double best = -1.0;
        for (String locale : order) {
            if (scores.get(locale) > best + 1e-9) {
                best = scores.get(locale);
                out.locale = locale;
            }
        }
        out.score = best;
        for (String locale : order) if (Math.abs(scores.get(locale) - best) <= 1e-9) out.tied.add(locale);
        out.firstMatch = out.locale == null ? null : firsts.get(out.locale);
        return out;
    }

    /** {@code vocab}: ordered (key, name) pairs. */
    public static NameMatch match(String text, List<Map.Entry<String, String>> vocab) {
        NameMatch out = new NameMatch();
        String query = normalize(text);
        if (query.length() < 3 || vocab == null || vocab.isEmpty()) return out;
        double best = -1.0;
        for (Map.Entry<String, String> entry : vocab) {
            double s = similarity(query, normalize(entry.getValue()));
            if (s > best) {
                best = s;
                out.key = entry.getKey();
                out.name = entry.getValue();
            }
        }
        double second = -1.0;
        String bestName = normalize(out.name);
        for (Map.Entry<String, String> entry : vocab) {
            String n = normalize(entry.getValue());
            if (n.equals(bestName)) continue;
            double s = similarity(query, n);
            if (s > second) second = s;
        }
        out.fuzzy = Math.max(0.0, best);
        out.margin = second < 0.0 ? best : best - second;
        return out;
    }

    /** Printed titles (track names): see match_title in name_match.py for the measurement. */
    public static final double TITLE_FUZZY_MIN = 0.65;
    public static final double TITLE_MARGIN_MIN = 0.08;
    private static final int TITLE_PREFIX_MIN_UNITS = 6;
    /** Chinese, Japanese and Korean titles: a clear winner from 0.55 with a lead of 0.12. */
    public static final double CJK_TITLE_FUZZY_MIN = 0.55;
    public static final double CJK_TITLE_MARGIN_MIN = 0.12;

    private static boolean cjk(String text) {
        if (text == null) return false;
        for (int i = 0; i < text.length(); ) {
            int c = text.codePointAt(i);
            if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0xAC00 && c <= 0xD7AF)) return true;
            i += Character.charCount(c);
        }
        return false;
    }

    /** A title match; {@code key} is null when refused; rule: tokens, prefix, fuzzy, ambiguous or null. */
    public static final class TitleMatch {
        public String key;
        public String name;
        public double fuzzy;
        public double margin;
        public String rule;
    }

    /** Runs of letters and decimal digits, lower-cased (the same characters as {@link #normalize}). */
    static List<String> tokens(String text) {
        List<String> out = new ArrayList<>();
        if (text == null) return out;
        String lower = text.toLowerCase(Locale.ROOT);
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i < lower.length(); ) {
            int cp = lower.codePointAt(i);
            if (Character.isLetter(cp) || Character.getType(cp) == Character.DECIMAL_DIGIT_NUMBER) {
                cur.appendCodePoint(cp);
            } else if (cur.length() > 0) {
                out.add(cur.toString());
                cur.setLength(0);
            }
            i += Character.charCount(cp);
        }
        if (cur.length() > 0) out.add(cur.toString());
        return out;
    }

    private static String item(String key) {
        int hash = key.indexOf('#');
        return hash < 0 ? key : key.substring(0, hash);
    }

    private static List<String> sorted(List<String> words) {
        List<String> copy = new ArrayList<>(words);
        Collections.sort(copy);
        return copy;
    }

    /** A printed title (a track name) in a vocabulary keyed "id#locale" (Python match_title). */
    public static TitleMatch matchTitle(String text, List<Map.Entry<String, String>> vocab) {
        TitleMatch out = new TitleMatch();
        List<String> words = tokens(text);
        if (words.isEmpty() || vocab == null || vocab.isEmpty()) return out;
        List<String> wanted = sorted(words);
        Map<String, Map.Entry<String, String>> exact = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : vocab) {
            String it = item(entry.getKey());
            if (!exact.containsKey(it) && sorted(tokens(entry.getValue())).equals(wanted)) exact.put(it, entry);
        }
        if (exact.size() > 1) {
            out.rule = "ambiguous";
            return out;
        }
        if (exact.size() == 1) {
            Map.Entry<String, String> hit = exact.values().iterator().next();
            out.key = hit.getKey();
            out.name = hit.getValue();
            out.fuzzy = 1.0;
            out.margin = 1.0;
            out.rule = "tokens";
            return out;
        }
        String query = normalize(text);
        if (words.size() >= 2 && query.length() >= TITLE_PREFIX_MIN_UNITS) {
            Map<String, Map.Entry<String, String>> starts = new LinkedHashMap<>();
            for (Map.Entry<String, String> entry : vocab) {
                String it = item(entry.getKey());
                List<String> nameWords = tokens(entry.getValue());
                if (!starts.containsKey(it) && nameWords.size() >= words.size()
                        && nameWords.subList(0, words.size()).equals(words)) starts.put(it, entry);
            }
            if (starts.size() == 1) {
                Map.Entry<String, String> hit = starts.values().iterator().next();
                out.key = hit.getKey();
                out.name = hit.getValue();
                out.fuzzy = similarity(query, normalize(hit.getValue()));
                out.margin = 1.0;
                out.rule = "prefix";
                return out;
            }
        }
        if (query.length() < 3) return out;
        double best = -1.0;
        String bestKey = null;
        String bestName = null;
        for (Map.Entry<String, String> entry : vocab) {
            double s = similarity(query, normalize(entry.getValue()));
            if (s > best) {
                best = s;
                bestKey = entry.getKey();
                bestName = entry.getValue();
            }
        }
        double second = -1.0;
        for (Map.Entry<String, String> entry : vocab) {
            if (item(entry.getKey()).equals(item(bestKey))) continue;
            double s = similarity(query, normalize(entry.getValue()));
            if (s > second) second = s;
        }
        double margin = second < 0.0 ? best : best - second;
        out.name = bestName;
        out.fuzzy = Math.max(0.0, best);
        out.margin = margin;
        if (best >= TITLE_FUZZY_MIN && margin >= TITLE_MARGIN_MIN) {
            out.key = bestKey;
            out.rule = "fuzzy";
        } else if (cjk(bestName) && best >= CJK_TITLE_FUZZY_MIN && margin >= CJK_TITLE_MARGIN_MIN) {
            out.key = bestKey;
            out.rule = "fuzzy_cjk";
        }
        return out;
    }
}
