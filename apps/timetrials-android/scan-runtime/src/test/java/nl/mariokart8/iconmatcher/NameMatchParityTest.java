package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assume.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The Java name matcher against Python's records (tooling/recognition/name_match_vectors.py); MK8DX_NAME_MATCH_VECTORS. */
public class NameMatchParityTest {
    @Test
    public void javaMatcherEqualsPython() throws Exception {
        String path = System.getenv("MK8DX_NAME_MATCH_VECTORS");
        assumeTrue("private name vectors not configured", path != null);
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(Paths.get(path)), "UTF-8"));
        Map<String, List<Map.Entry<String, String>>> vocabs = new HashMap<>();
        JSONObject raw = doc.getJSONObject("vocabs");
        for (Iterator<String> it = raw.keys(); it.hasNext(); ) {
            String kind = it.next();
            JSONArray rows = raw.getJSONArray(kind);
            List<Map.Entry<String, String>> list = new ArrayList<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONArray row = rows.getJSONArray(i);
                list.add(new AbstractMap.SimpleEntry<>(row.getString(0), row.getString(1)));
            }
            vocabs.put(kind, list);
        }
        JSONArray cases = doc.getJSONArray("cases");
        int differences = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            NameMatch m = NameMatch.match(c.getString("query"), vocabs.get(c.getString("kind")));
            boolean same = String.valueOf(m.key).equals(String.valueOf(c.isNull("key") ? null : c.getString("key")))
                    && Math.abs(m.fuzzy - c.getDouble("fuzzy")) <= 1e-12 && Math.abs(m.margin - c.getDouble("margin")) <= 1e-12
                    && m.strong() == c.getBoolean("strong");
            if (!same && ++differences <= 5) System.out.println("differs " + c.getString("query") + " " + m.key);
        }
        List<String> locales = new ArrayList<>();
        JSONArray rawLocales = doc.getJSONArray("locales");
        for (int i = 0; i < rawLocales.length(); i++) locales.add(rawLocales.getString(i));
        JSONArray votes = doc.getJSONArray("votes");
        for (int i = 0; i < votes.length(); i++) {
            JSONObject v = votes.getJSONObject(i);
            List<String[]> rows = new ArrayList<>();
            JSONArray rawRows = v.getJSONArray("rows");
            for (int k = 0; k < rawRows.length(); k++) {
                rows.add(new String[]{rawRows.getJSONArray(k).getString(0), rawRows.getJSONArray(k).getString(1)});
            }
            List<String> preferred = new ArrayList<>();
            JSONArray rawPreferred = v.getJSONArray("preferred");
            for (int k = 0; k < rawPreferred.length(); k++) preferred.add(rawPreferred.getString(k));
            NameMatch.Vote got = NameMatch.vote(rows, vocabs, locales, preferred);
            List<String> tied = new ArrayList<>();
            JSONArray rawTied = v.getJSONArray("tied");
            for (int k = 0; k < rawTied.length(); k++) tied.add(rawTied.getString(k));
            boolean same = String.valueOf(got.locale).equals(v.getString("locale"))
                    && Math.abs(got.score - v.getDouble("score")) <= 1e-12 && got.tied.equals(tied)
                    && String.valueOf(got.firstMatch == null ? null : got.firstMatch.key)
                    .equals(String.valueOf(v.isNull("firstKey") ? null : v.getString("firstKey")));
            if (!same && ++differences <= 5) System.out.println("vote differs " + got.locale + " " + v.getString("locale"));
        }
        JSONArray sameNames = doc.optJSONArray("sameNames");
        for (int i = 0; sameNames != null && i < sameNames.length(); i++) {
            JSONObject c = sameNames.getJSONObject(i);
            List<String> locs = NameMatch.sameNameLocales(vocabs.get("bodies"), c.getString("key"));
            java.util.TreeSet<String> scripts = new java.util.TreeSet<>();
            for (String loc : locs) scripts.add(NameMatch.scriptForLocale(loc));
            List<String> wantLocs = new ArrayList<>();
            for (int k = 0; k < c.getJSONArray("locales").length(); k++) wantLocs.add(c.getJSONArray("locales").getString(k));
            List<String> wantScripts = new ArrayList<>();
            for (int k = 0; k < c.getJSONArray("scripts").length(); k++) wantScripts.add(c.getJSONArray("scripts").getString(k));
            if ((!locs.equals(wantLocs) || !new ArrayList<>(scripts).equals(wantScripts)) && ++differences <= 5) {
                System.out.println("same-name differs " + c.getString("key"));
            }
        }
        JSONArray titles = doc.optJSONArray("titles");
        List<Map.Entry<String, String>> enNl = new ArrayList<>();
        for (Map.Entry<String, String> entry : vocabs.get("tracks")) {
            String key = entry.getKey();
            if (key.endsWith("#en-GB") || key.endsWith("#en-US") || key.endsWith("#nl-NL")) enNl.add(entry);
        }
        for (int i = 0; titles != null && i < titles.length(); i++) {
            JSONObject t = titles.getJSONObject(i);
            NameMatch.TitleMatch m = NameMatch.matchTitle(t.getString("query"),
                    "all".equals(t.getString("subset")) ? vocabs.get("tracks") : enNl);
            boolean same = String.valueOf(m.key).equals(String.valueOf(t.isNull("key") ? null : t.getString("key")))
                    && String.valueOf(m.name).equals(String.valueOf(t.isNull("name") ? null : t.getString("name")))
                    && String.valueOf(m.rule).equals(String.valueOf(t.isNull("rule") ? null : t.getString("rule")))
                    && Math.abs(m.fuzzy - t.getDouble("fuzzy")) <= 1e-12 && Math.abs(m.margin - t.getDouble("margin")) <= 1e-12;
            if (!same && ++differences <= 5) System.out.println("title differs " + t.getString("query") + " " + m.key + " " + m.rule);
        }
        System.out.println("name match parity queries=" + cases.length() + " votes=" + votes.length()
                + " titles=" + (titles == null ? 0 : titles.length()) + " differences=" + differences);
        assertEquals(0, differences);
    }
}
