package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The left keyline on an Activity row carries meaning, so it has to mean the
 * same thing on both clients: green when you are ahead here or it is a
 * personal record, red when the run beat your best, nothing on a tie.
 */
class AndroidActivityOutcomeTest {
    private fun story(
        playerId: String,
        bestMs: Long,
        personalBest: Boolean = false,
    ) = AndroidActivityStory(
        player = AndroidActivityPlayer(playerId, playerId.substringAfterLast('.')),
        trackId = "track.mario_kart_stadium",
        mode = 150,
        runs = 1,
        startMs = 0,
        bestMs = bestMs,
        personalBest = personalBest,
        latestAtMs = 1_000,
    )

    private fun feed(
        stories: List<AndroidActivityStory>,
        ownBestMs: Long? = null,
    ) = buildAndroidActivityFeed(
        stories = stories,
        ownBests = ownBestMs?.let { mapOf("track.mario_kart_stadium#150" to it) }.orEmpty(),
        viewerPlayerId = "player.ben",
        nowMs = 2_000,
    )

    private fun outcomes(sections: AndroidActivityFeedSections) =
        (sections.action + sections.rivals + sections.attention +
            sections.ownSessions + sections.community).map(::androidActivityOutcome)

    @Test
    fun aSlowerRunByAnotherPlayerReadsAsWon() {
        val sections = feed(listOf(story("player.lex", 100_000)), ownBestMs = 99_000)
        assertEquals(listOf(AndroidActivityOutcome.WON), outcomes(sections))
    }

    @Test
    fun aFasterRunByAnotherPlayerReadsAsLost() {
        val sections = feed(listOf(story("player.lex", 98_000)), ownBestMs = 99_000)
        assertEquals(listOf(AndroidActivityOutcome.LOST), outcomes(sections))
    }

    @Test
    fun anExactTieLeavesThePersonalRecordMarkerStanding() {
        // The web only replaces the record class when the outcome is won or
        // lost, so a tie on someone's personal best stays green.
        val sections = feed(
            listOf(story("player.lex", 99_000, personalBest = true)),
            ownBestMs = 99_000,
        )
        assertEquals(listOf(AndroidActivityOutcome.RECORD), outcomes(sections))
    }

    @Test
    fun anExactTieWithoutARecordDrawsNoKeyline() {
        val sections = feed(listOf(story("player.lex", 99_000)), ownBestMs = 99_000)
        assertEquals(listOf(AndroidActivityOutcome.NONE), outcomes(sections))
    }

    @Test
    fun aComparisonOutranksThePersonalRecordMarker() {
        val sections = feed(
            listOf(story("player.lex", 98_000, personalBest = true)),
            ownBestMs = 99_000,
        )
        assertEquals(listOf(AndroidActivityOutcome.LOST), outcomes(sections))
    }

    @Test
    fun theViewersOwnPersonalBestIsGreenAndIsNeverComparedToItself() {
        val sections = feed(
            listOf(story("player.ben", 99_000, personalBest = true)),
            ownBestMs = 99_000,
        )
        assertEquals(listOf(AndroidActivityOutcome.RECORD), outcomes(sections))
    }

    @Test
    fun withoutATimeOnThatTrackThereIsNothingToCompare() {
        val sections = feed(listOf(story("player.lex", 98_000)))
        assertEquals(listOf(AndroidActivityOutcome.NONE), outcomes(sections))
    }
}
