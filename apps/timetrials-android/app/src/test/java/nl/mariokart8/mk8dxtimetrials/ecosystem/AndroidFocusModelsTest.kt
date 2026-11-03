package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class AndroidFocusModelsTest {
    @Test
    fun globalFocusProducesTheThreeHistoricalChallengeTypes() {
        val rows = listOf(
            focusRow("track.mario_kart_stadium", 150, 91_000, 90_700, 8, 7),
            focusRow("track.water_park", 150, 100_000, 96_000, 15, 14),
            focusRow("track.thwomp_ruins", 200, 75_000, 74_000, 5, 4),
        )

        val result = buildAndroidGlobalFocus(rows, emptyList())

        assertEquals(AndroidFocusKind.LOWEST_MASTERY, result.best?.kind)
        assertEquals(AndroidFocusKind.CLOSEST_BATTLE, result.closest?.kind)
        assertEquals(AndroidFocusKind.BIGGEST_GAP, result.biggest?.kind)
        assertEquals("track.mario_kart_stadium", result.closest?.trackId)
        assertEquals("track.water_park", result.biggest?.trackId)
        assertEquals("track.mario_kart_stadium", result.best?.trackId)
    }

    @Test
    fun rivalFocusOnlyUsesSharedTimesWhereRivalIsAhead() {
        val bests = AndroidTrackBestsDocument(
            "mk8dx.public-track-bests.v1",
            listOf(
                AndroidTrackBestPlayer("player.me", listOf(AndroidTrackBest("track.water_park", 150, 100_000, 4))),
                AndroidTrackBestPlayer("player.rival", listOf(AndroidTrackBest("track.water_park", 150, 99_500, 3))),
            ),
        )

        val result = buildAndroidRivalFocus(
            "player.me",
            listOf(AndroidRivalComparison("player.rival", "Rival", 1, 0, 1, 500)),
            bests,
        )

        assertNotNull(result.best)
        assertEquals(AndroidFocusKind.LOWEST_MASTERY, result.best?.kind)
        assertEquals("Rival", result.closest?.headline)
        assertEquals(500L, result.closest?.gapMs)
    }

    @Test
    fun gapFormattingKeepsTimeTrialPrecision() {
        assertEquals("0:00.437", formatAndroidGap(437))
        assertEquals("1:01.005", formatAndroidGap(61_005))
    }

    private fun focusRow(
        trackId: String,
        mode: Int,
        mine: Long,
        target: Long,
        myRank: Int,
        targetRank: Int,
    ) = AndroidFocusRow(
        trackId,
        mode,
        mine,
        myRank,
        30,
        target - 1_000,
        AndroidFocusTarget("player.$targetRank", "Player $targetRank", target, targetRank),
    )
}
