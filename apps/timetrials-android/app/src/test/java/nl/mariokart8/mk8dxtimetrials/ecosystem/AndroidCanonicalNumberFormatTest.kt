package nl.mariokart8.mk8dxtimetrials.ecosystem

import java.util.Locale
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * Times and ratings are canonical values, not localised copy. On the owner's
 * Dutch phone a `String.format` without an explicit locale turned the Home
 * hero's "Rating 27.15" into "27,15" while the web showed "27.15"; the same
 * default would have put a comma in every gap this file formats.
 *
 * The product's convention is `Locale.ROOT` for anything numeric that a Player
 * compares against another client. These tests run under a comma locale so a
 * missing `Locale.ROOT` fails here rather than on a phone.
 */
class AndroidCanonicalNumberFormatTest {
    private val original = Locale.getDefault()

    @Before
    fun useACommaLocale() {
        Locale.setDefault(Locale.forLanguageTag("nl-NL"))
    }

    @After
    fun restoreLocale() {
        Locale.setDefault(original)
    }

    @Test
    fun aSubMinuteGapKeepsItsDecimalPoint() {
        assertEquals("0.500s", androidAggregateGap(500))
        assertEquals("1.500s", androidAggregateGap(1_500))
        assertEquals("59.999s", androidAggregateGap(59_999))
    }

    @Test
    fun aLongerGapKeepsItsClockPunctuation() {
        assertEquals("1:00.000", androidAggregateGap(60_000))
        assertEquals("2:03.004", androidAggregateGap(-123_004))
    }

    @Test
    fun theComebackLinesCarryPointFormattedGaps() {
        val comeback = AndroidHomeComeback(
            schemaVersion = "mk8dx.home-comeback.v1",
            player = AndroidHomePlayer("player.ben", "Ben"),
            timeTrials = AndroidTimeTrialStanding(3, 8, 1_000_000),
            rivals = listOf(
                AndroidRivalComparison(
                    playerId = "player.evan",
                    displayName = "Evan",
                    tracksAhead = 2,
                    tracksBehind = 0,
                    sharedCombos = 10,
                    totalDeltaMs = 2_500,
                    previous = AndroidRivalComparisonSnapshot(2, 0, 10, 1_000),
                ),
            ),
            sinceMs = 1,
        )
        assertEquals(
            listOf("⏱ Your advantage over Evan improved by 1.500s"),
            androidComebackLines(comeback),
        )
    }

    @Test
    fun aRatingKeepsItsDecimalPoint() {
        // The Home hero formats the Tournament rating the same way.
        assertEquals("27.15", String.format(Locale.ROOT, "%.2f", 27.15))
    }
}
