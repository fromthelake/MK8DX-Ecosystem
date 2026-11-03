package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A Home tile must land on the same list on both clients, so these are the
 * web's `rank-track-focus.ts` rules restated as assertions.
 */
class AndroidRankTrackFocusTest {
    private fun matches(focus: AndroidRankTrackFocus, evidence: AndroidRankTrackEvidence) =
        matchesAndroidRankTrackFocus(focus, evidence)

    @Test
    fun theApiValuesAreTheOnesTheWebLinksCarry() {
        assertEquals(
            listOf(
                "staff-left", "near-record", "current-records",
                "tracks-left", "top-three", "outside-top-ten",
            ).sorted(),
            AndroidRankTrackFocus.entries.map { it.apiValue }.sorted(),
        )
        assertEquals(AndroidRankTrackFocus.TOP_THREE, AndroidRankTrackFocus.parse("top-three"))
        assertNull(AndroidRankTrackFocus.parse("nonsense"))
        assertNull(AndroidRankTrackFocus.parse(null))
    }

    @Test
    fun aStaffGhostIsStillLeftUntilTheTimeIsStrictlyFaster() {
        val focus = AndroidRankTrackFocus.STAFF_LEFT
        assertTrue(matches(focus, AndroidRankTrackEvidence(staffTimeMs = 90_000)))
        assertTrue(matches(focus, AndroidRankTrackEvidence(bestTimeMs = 90_000, staffTimeMs = 90_000)))
        assertFalse(matches(focus, AndroidRankTrackEvidence(bestTimeMs = 89_999, staffTimeMs = 90_000)))
        // A track without a staff reference is never "left" to defeat.
        assertFalse(matches(focus, AndroidRankTrackEvidence(bestTimeMs = 10_000)))
    }

    @Test
    fun nearRecordNeedsARankBehindTheLeaderInsideOneSecond() {
        val focus = AndroidRankTrackFocus.NEAR_RECORD
        assertTrue(matches(focus, AndroidRankTrackEvidence(bestRank = 2, bestTimeMs = 91_000, leaderTimeMs = 90_000)))
        assertFalse(matches(focus, AndroidRankTrackEvidence(bestRank = 2, bestTimeMs = 91_001, leaderTimeMs = 90_000)))
        assertFalse(matches(focus, AndroidRankTrackEvidence(bestRank = 1, bestTimeMs = 90_000, leaderTimeMs = 90_000)))
    }

    @Test
    fun theRankBoundariesMatchTheirLabels() {
        assertTrue(matches(AndroidRankTrackFocus.CURRENT_RECORDS, AndroidRankTrackEvidence(bestRank = 1)))
        assertFalse(matches(AndroidRankTrackFocus.CURRENT_RECORDS, AndroidRankTrackEvidence(bestRank = 2)))
        assertTrue(matches(AndroidRankTrackFocus.TOP_THREE, AndroidRankTrackEvidence(bestRank = 3)))
        assertFalse(matches(AndroidRankTrackFocus.TOP_THREE, AndroidRankTrackEvidence(bestRank = 4)))
        assertTrue(matches(AndroidRankTrackFocus.OUTSIDE_TOP_TEN, AndroidRankTrackEvidence(bestRank = 11)))
        assertFalse(matches(AndroidRankTrackFocus.OUTSIDE_TOP_TEN, AndroidRankTrackEvidence(bestRank = 10)))
    }

    @Test
    fun tracksLeftIsExactlyTheTracksWithoutATime() {
        assertTrue(matches(AndroidRankTrackFocus.TRACKS_LEFT, AndroidRankTrackEvidence(staffTimeMs = 90_000)))
        assertFalse(matches(AndroidRankTrackFocus.TRACKS_LEFT, AndroidRankTrackEvidence(bestTimeMs = 90_000)))
    }

    @Test
    fun everyJourneyAndCompetitiveCellCarriesAFocus() {
        val counts = buildAndroidCompetitive(emptyList(), emptyList(), 150, AndroidTimeTrialTrackScope.ALL)
        assertEquals(
            listOf("near-record", "top-three", "current-records", "outside-top-ten"),
            counts.map { it.focus.apiValue },
        )
    }
}
