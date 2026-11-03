package nl.mariokart8.mk8dxtimetrials.scanruntime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.Test;

public class TireNameCatalogTest {
    @Test
    public void everyTireHasANameInEveryGameLocale() {
        Map<String, String> vocab = TireNameCatalog.vocab();
        Set<String> indices = new HashSet<>();
        Set<String> locales = new HashSet<>();
        for (String key : vocab.keySet()) {
            indices.add(key.substring(0, key.indexOf('#')));
            locales.add(key.substring(key.indexOf('#') + 1));
            assertTrue(key, !vocab.get(key).isEmpty());
        }
        assertEquals(22, indices.size());
        assertEquals(13, locales.size());
        assertEquals(22 * 13, vocab.size());
    }

    @Test
    public void namesAreKeyedByTheEngineTireIndex() {
        Map<String, String> vocab = TireNameCatalog.vocab();
        assertEquals("Gold Wheels", vocab.get("17#en-GB"));
        assertEquals("ゴールドタイヤ", vocab.get("17#ja-JP"));
        assertEquals("Normal", vocab.get("0#en-GB"));
    }
}
