package nl.mariokart8.mk8dxtimetrials.ui

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class AndroidProductCatalogTest {
    private val german = """
        {"schemaVersion":"mk8dx.web-message-catalog.v1","language":"de","messages":{
          "Settings":"Einstellungen",
          "Asked on {0}":"Angefragt am {0}",
          "{0} of {1} links":"{0} von {1} Verknüpfungen",
          "Open {0}'s profile":"Profil von {0} öffnen",
          "{0} player{1}":"{0} Spieler"},
         "gameNames":{"Water Park":"Wasserpark","Mario Kart Stadium":"Mario Kart-Stadion"}}
    """.trimIndent()

    @Before
    fun installCatalogs() {
        AndroidProductCatalog.install { path -> if (path == "i18n/de.json") german else null }
    }

    @After
    fun clearCatalogs() {
        AndroidProductCatalog.install { null }
    }

    @Test
    fun `exact texts, templates and game names come from the catalog`() {
        assertEquals("Einstellungen", AndroidProductCatalog.translate("de", "Settings"))
        assertEquals("Angefragt am 31 Okt", AndroidProductCatalog.translate("de", "Asked on 31 Okt"))
        assertEquals("3 von 12 Verknüpfungen", AndroidProductCatalog.translate("de", "3 of 12 links"))
        assertEquals("Profil von Wasserpark öffnen", AndroidProductCatalog.translate("de", "Open Water Park's profile"))
        assertNull(AndroidProductCatalog.translate("de", "Nothing like this"))
        assertEquals("Best on Mario Kart-Stadion", AndroidProductCatalog.replaceGameNames("de", "Best on Mario Kart Stadium"))
    }

    @Test
    fun `English and Dutch stay in the code, other languages fall back to English`() {
        assertEquals("Settings", androidText(AndroidProductLanguage.ENGLISH, "Settings", "Instellingen"))
        assertEquals("Instellingen", androidText(AndroidProductLanguage.DUTCH, "Settings", "Instellingen"))
        assertEquals("Einstellungen", androidText(AndroidProductLanguage.GERMAN, "Settings", "Instellingen"))
        // No Japanese catalog installed in this test: the English stays.
        assertEquals("Settings", androidText(AndroidProductLanguage.JAPANESE, "Settings", "Instellingen"))
    }

    @Test
    fun `rendered English from code branches reads from the catalog, keeping its surrounding space`() {
        assertEquals(" Einstellungen ", androidCatalogPresentation(AndroidProductLanguage.GERMAN, " Settings "))
        // A text the catalog lacks still gets its game names.
        assertEquals("Wasserpark · 150cc", androidCatalogPresentation(AndroidProductLanguage.GERMAN, "Water Park · 150cc"))
        assertEquals("Settings", androidCatalogPresentation(AndroidProductLanguage.ENGLISH, "Settings"))
        assertEquals("Settings", androidCatalogPresentation(AndroidProductLanguage.DUTCH, "Settings"))
        assertEquals("de-DE", AndroidProductLanguage.GERMAN.locale.toLanguageTag())
        // Upper-cased headings and lines joined from parts.
        assertEquals("EINSTELLUNGEN", AndroidProductCatalog.translate("de", "SETTINGS"))
        assertEquals("Einstellungen · 3 von 12 Verknüpfungen · 2026-09-11",
            AndroidProductCatalog.translate("de", "Settings · 3 of 12 links · 2026-09-11"))
        // A template that drops a plural placeholder does not swallow the joined date.
        assertEquals("Einstellungen · 36 Spieler · 2026-09-11",
            AndroidProductCatalog.translate("de", "Settings · 36 players · 2026-09-11"))
    }

    @Test
    fun `the 15 codes match the website and read in any case`() {
        assertEquals(15, AndroidProductLanguage.entries.size)
        assertEquals(AndroidProductLanguage.CHINESE_TRADITIONAL, AndroidProductLanguage.fromCode("ZH-tw"))
        assertEquals(AndroidProductLanguage.SPANISH_LATIN_AMERICA, AndroidProductLanguage.fromCode("es-419"))
        assertNull(AndroidProductLanguage.fromCode("pt-BR"))
    }
}
