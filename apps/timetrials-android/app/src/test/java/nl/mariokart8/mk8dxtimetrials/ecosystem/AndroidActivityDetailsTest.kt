package nl.mariokart8.mk8dxtimetrials.ecosystem

import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidActivityDetailsTest {
    @Test
    fun relativeTimeUsesTheSameBucketsAsTheWebFeedInBothLanguages() {
        val now = 1_000_000_000_000L
        val minute = 60_000L
        val en = AndroidProductLanguage.ENGLISH
        val nl = AndroidProductLanguage.DUTCH
        assertEquals("just now", androidRelativeTime(now - 30_000, now, en))
        assertEquals("zojuist", androidRelativeTime(now - 30_000, now, nl))
        assertEquals("12m ago", androidRelativeTime(now - 12 * minute, now, en))
        assertEquals("12m geleden", androidRelativeTime(now - 12 * minute, now, nl))
        assertEquals("3h ago", androidRelativeTime(now - 3 * 60 * minute, now, en))
        assertEquals("3u geleden", androidRelativeTime(now - 3 * 60 * minute, now, nl))
        assertEquals("5d ago", androidRelativeTime(now - 5 * 24 * 60 * minute, now, en))
        assertEquals("5d geleden", androidRelativeTime(now - 5 * 24 * 60 * minute, now, nl))
        assertEquals("3mo ago", androidRelativeTime(now - 100 * 24 * 60 * minute, now, en))
        assertEquals("3mnd geleden", androidRelativeTime(now - 100 * 24 * 60 * minute, now, nl))
        // A clock that runs slightly behind the server never claims the future.
        assertEquals("just now", androidRelativeTime(now + 5_000, now, en))
    }

    @Test
    fun lapCoinBalancesBecomePerLapGainsAndLosses() {
        assertEquals(
            listOf(4, -3, 5),
            activityCoinDeltas(
                listOf(
                    AndroidActivityLap(1, 30_000, 4),
                    AndroidActivityLap(2, 30_000, 1),
                    AndroidActivityLap(3, 30_000, 6),
                ),
            ),
        )
    }
}
