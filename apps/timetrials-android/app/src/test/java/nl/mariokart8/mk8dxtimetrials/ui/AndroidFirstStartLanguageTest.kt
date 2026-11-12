package nl.mariokart8.mk8dxtimetrials.ui

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

/** The first screen speaks the phone's language until a language is chosen (owner, 2026-11-12). */
class AndroidFirstStartLanguageTest {
    private fun of(tag: String) = AndroidProductLanguageStore.deviceLanguage(Locale.forLanguageTag(tag))

    @Test
    fun aDutchPhoneGetsDutch() {
        assertEquals(AndroidProductLanguage.DUTCH, of("nl-NL"))
        assertEquals(AndroidProductLanguage.DUTCH, of("nl-BE"))
    }

    @Test
    fun aRegionTheAppHasWinsOverItsLanguage() {
        assertEquals(AndroidProductLanguage.ENGLISH_US, of("en-US"))
        assertEquals(AndroidProductLanguage.FRENCH_CANADA, of("fr-CA"))
        assertEquals(AndroidProductLanguage.FRENCH, of("fr-BE"))
    }

    @Test
    fun anUnknownLanguageFallsBackToUkEnglish() {
        assertEquals(AndroidProductLanguage.ENGLISH, of("en-GB"))
        assertEquals(AndroidProductLanguage.ENGLISH, of("sv-SE"))
    }
}
