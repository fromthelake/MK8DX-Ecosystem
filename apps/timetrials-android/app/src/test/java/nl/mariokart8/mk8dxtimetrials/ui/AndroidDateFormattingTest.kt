package nl.mariokart8.mk8dxtimetrials.ui

import java.util.Locale
import java.util.TimeZone
import nl.mariokart8.mk8dxtimetrials.tournament.androidDelegationMoment
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AndroidDateFormattingTest {
    // 2026-11-15 13:06 in Amsterdam.
    private val moment = 1_794_744_360_000L
    private lateinit var savedLocale: Locale
    private lateinit var savedZone: TimeZone

    @Before
    fun englishPhoneInAmsterdam() {
        savedLocale = Locale.getDefault()
        savedZone = TimeZone.getDefault()
        Locale.setDefault(Locale.US)
        TimeZone.setDefault(TimeZone.getTimeZone("Europe/Amsterdam"))
    }

    @After
    fun restore() {
        Locale.setDefault(savedLocale)
        TimeZone.setDefault(savedZone)
    }

    @Test
    fun aDutchAppOnAnEnglishPhoneShowsDutchDatesOnA24HourClock() {
        val dutch = androidDateTimeText(AndroidProductLanguage.DUTCH, moment)
        // The JDK writes "15 nov. 2026", Android's ICU "15 nov 2026": the same Dutch month either way.
        assertTrue(dutch, Regex("""^15 nov\.? 2026""").containsMatchIn(dutch))
        assertTrue(dutch, dutch.endsWith("13:06"))
        assertFalse(dutch, dutch.contains("PM"))
        assertTrue(Regex("""^15 nov\.? 2026$""").matches(androidDateText(AndroidProductLanguage.DUTCH, moment)))
        assertEquals(dutch, androidDelegationMoment(AndroidProductLanguage.DUTCH, moment))
    }

    @Test
    fun eachLanguageKeepsItsOwnClockConvention() {
        val british = androidDateTimeText(AndroidProductLanguage.ENGLISH, moment)
        assertTrue(british, british.startsWith("15 Nov 2026"))
        assertTrue(british, british.endsWith("13:06"))
        val american = androidDateTimeText(AndroidProductLanguage.ENGLISH_US, moment)
        assertTrue(american, american.startsWith("Nov 15, 2026"))
        assertTrue(american, american.contains("1:06") && american.endsWith("PM"))
        val german = androidDateText(AndroidProductLanguage.GERMAN, moment)
        assertEquals("15.11.2026", german)
    }
}
