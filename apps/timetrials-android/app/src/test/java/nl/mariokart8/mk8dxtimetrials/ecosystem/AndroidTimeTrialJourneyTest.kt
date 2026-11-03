package nl.mariokart8.mk8dxtimetrials.ecosystem

import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The journey tiles report the Player's own progress, so the counting rules
 * have to match the web exactly: a time on a track counts once, and a staff
 * ghost counts only when the time is strictly faster than the staff reference.
 */
class AndroidTimeTrialJourneyTest {
    private fun staff(mode: Int) =
        AndroidBenchmarkCatalog.forKind(AndroidBenchmarkKind.NINTENDO_STAFF, mode)

    @Test
    fun eachScopeReportsTheStaffReferenceCountAsItsTotal() {
        val metrics = buildAndroidJourney(emptyList(), 150)
        assertEquals(4, metrics.size)
        val base = AndroidTimeTrialTrackScope.BASE.trackIds
        val bcp = AndroidTimeTrialTrackScope.BCP.trackIds
        val baseTotal = staff(150).count { it.trackId in base }
        val bcpTotal = staff(150).count { it.trackId in bcp }
        assertEquals(baseTotal, metrics[0].total)
        assertEquals(baseTotal, metrics[1].total)
        assertEquals(bcpTotal, metrics[2].total)
        assertEquals(bcpTotal, metrics[3].total)
        assertTrue(metrics.all { it.value == 0 && it.empty && !it.complete })
    }

    @Test
    fun aTimeCountsOnceAndOnlyBeatsTheGhostWhenItIsStrictlyFaster() {
        val reference = staff(150).first { it.trackId in AndroidTimeTrialTrackScope.BASE.trackIds }
        val bests = listOf(
            // Two revisions on the same track: one track driven, not two.
            AndroidTrackBest(reference.trackId, 150, reference.timeMs - 1, 1),
            AndroidTrackBest(reference.trackId, 150, reference.timeMs + 500, 4),
            // Exactly equal to the staff time is not a defeat.
            AndroidTrackBest(
                staff(150).first { it.trackId != reference.trackId && it.trackId in AndroidTimeTrialTrackScope.BASE.trackIds }.trackId,
                150,
                staff(150).first { it.trackId != reference.trackId && it.trackId in AndroidTimeTrialTrackScope.BASE.trackIds }.timeMs,
                2,
            ),
            // The other engine class must not leak in.
            AndroidTrackBest(reference.trackId, 200, 1L, 1),
        )
        val metrics = buildAndroidJourney(bests, 150)
        assertEquals(2, metrics[0].value)
        assertEquals(1, metrics[1].value)
    }

    @Test
    fun bcpTimesDoNotCountTowardsTheBaseTiles() {
        val bcpTrack = staff(200).first { it.trackId in AndroidTimeTrialTrackScope.BCP.trackIds }
        val metrics = buildAndroidJourney(
            listOf(AndroidTrackBest(bcpTrack.trackId, 200, bcpTrack.timeMs - 10, 1)),
            200,
        )
        assertEquals(0, metrics[0].value)
        assertEquals(0, metrics[1].value)
        assertEquals(1, metrics[2].value)
        assertEquals(1, metrics[3].value)
    }

    @Test
    fun aFullScopeReadsAsCompleteAtOneHundredPercent() {
        val bests = staff(150)
            .filter { it.trackId in AndroidTimeTrialTrackScope.BASE.trackIds }
            .map { AndroidTrackBest(it.trackId, 150, it.timeMs - 1, 1) }
        val metrics = buildAndroidJourney(bests, 150)
        assertTrue(metrics[0].complete)
        assertTrue(metrics[1].complete)
        assertEquals(100, metrics[0].percentage)
        assertEquals(100, metrics[1].percentage)
        assertTrue(metrics[2].empty)
    }

    @Test
    fun overallMasteryAndNextRankUseTheCanonicalAllTrackTotal() {
        val best = AndroidTrackBest("track.mario_kart_stadium", 200, 100_000L, 2)
        val expectedTotal = 100_000L + 95L * AndroidMasteryThresholds.UNPLAYED_FALLBACK_MS
        val target = buildAndroidJourneyTarget(
            listOf(best),
            "player.ben",
            200,
            listOf(
                AndroidRankStanding(1, "player.evan", "Evan", 200, expectedTotal - 6_425L, 0, 1, 0, 0, 0),
                AndroidRankStanding(2, "player.ben", "Ben", 200, expectedTotal, 0, 1, 0, 0, 0),
            ),
        )

        assertEquals(expectedTotal, target.totalMs)
        assertEquals(2, target.standing)
        assertEquals(6_426L, target.rankReductionMs)
        assertTrue(target.masteryReductionMs != null && target.masteryReductionMs > 0)
    }
}
