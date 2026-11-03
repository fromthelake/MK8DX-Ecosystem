package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidActivityFeedModelTest {
    private val ownBests = mapOf(
        "track.mario_kart_stadium#150" to 92_000L,
        "track.big_blue#200" to 87_000L,
    )

    @Test
    fun canonicalOvertakesAreActionableCappedAndSortedByCloseness() {
        val stories = listOf(
            story("a", 91_000, 4, overtakeDelta = -1_000),
            story("b", 91_800, 3, overtakeDelta = -200),
            story("c", 91_500, 2, overtakeDelta = -500),
            story("d", 91_900, 1, overtakeDelta = -100),
        )

        val sections = buildAndroidActivityFeed(stories, ownBests, "player.ben")

        assertEquals(listOf("d", "b", "c"), sections.action.map { it.story.player.displayName })
        assertTrue(sections.action.all { it.relevance == AndroidActivityRelevance.OVERTAKEN })
        assertEquals(listOf("a"), sections.attention.map { it.story.player.displayName })
    }

    @Test
    fun derivesOnlyClaimsProvenByCurrentPersonalReference() {
        val stories = listOf(
            story("Near", 92_650, 4, personalBest = true),
            story("Far", 94_000, 3),
            story("Ben PB", 92_000, 2, playerId = "player.ben", personalBest = true),
            story("Ben run", 92_400, 1, playerId = "player.ben"),
        )

        val sections = buildAndroidActivityFeed(stories, ownBests, "player.ben", nowMs = 100)

        assertEquals(AndroidActivityRelevance.THREATENED, sections.attention.single().relevance)
        assertEquals(listOf(AndroidActivityRelevance.OWN_PR, AndroidActivityRelevance.OWN_RUN),
            sections.ownSessions.map { it.relevance })
        assertTrue(sections.ownSessions.first().isReferenceRun)
        assertEquals(listOf("Far"), sections.community.map { it.story.player.displayName })
    }

    @Test
    fun ownSessionsStayInDiaryOrderInsteadOfPinningAnOldPersonalBest() {
        // Owner report 2026-08-30: a days-old 200cc PB sat on top of MY
        // SESSIONS above newer sessions with no visible reason. The PB badge
        // marks the record; the order stays chronological.
        val stories = listOf(
            story("Old PB", 92_000, 10, playerId = "player.ben", personalBest = true),
            story("New run", 92_400, 90, playerId = "player.ben"),
        )

        val sections = buildAndroidActivityFeed(stories, ownBests, "player.ben")

        assertEquals(listOf("New run", "Old PB"), sections.ownSessions.map { it.story.player.displayName })
        assertEquals(
            listOf(AndroidActivityRelevance.OWN_RUN, AndroidActivityRelevance.OWN_PR),
            sections.ownSessions.map { it.relevance },
        )
    }

    @Test
    fun signedOutFeedHasNoInventedPersonalRelevance() {
        val stories = listOf(
            story("Older", 91_000, 1, overtakeDelta = -1_000, playerDeltaMs = -500),
            story("Newer", 92_500, 2, playerDeltaMs = 250),
        )

        val sections = buildAndroidActivityFeed(stories, ownBests, null)

        assertTrue(sections.action.isEmpty())
        assertTrue(sections.attention.isEmpty())
        assertTrue(sections.ownSessions.isEmpty())
        assertEquals(listOf("Newer", "Older"), sections.community.map { it.story.player.displayName })
        assertTrue(sections.community.all { it.relevance == AndroidActivityRelevance.OTHER })
        assertEquals(listOf(250L, -500L), sections.community.map { it.resultDeltaMs })
    }

    @Test
    fun ownRowsUseTheHistoricalSelfDeltaInsteadOfComparingWithTheCurrentBest() {
        val sections = buildAndroidActivityFeed(
            listOf(story("Ben", 92_000, 1, playerId = "player.ben", personalBest = true, playerDeltaMs = -611)),
            ownBests,
            "player.ben",
        )

        assertEquals(-611L, sections.ownSessions.single().resultDeltaMs)
        assertTrue(sections.ownSessions.single().isReferenceRun)
    }

    @Test
    fun filtersUseTheExistingBatchedTrackAndModeKeysForTwoHundredStories() {
        val stories = (0 until 200).map { index ->
            story(
                name = "Player $index",
                timeMs = 90_000L + index,
                at = index.toLong(),
                trackId = if (index % 2 == 0) "track.mario_kart_stadium" else "track.unplayed",
                mode = if (index % 3 == 0) 200 else 150,
            )
        }

        val cc200 = buildAndroidActivityFeed(
            stories, ownBests, "player.ben", modeFilter = AndroidActivityModeFilter.CC200,
        )
        val mine = buildAndroidActivityFeed(
            stories, ownBests, "player.ben", scopeFilter = AndroidActivityScopeFilter.MY_TRACKS,
        )

        assertEquals(67, (cc200.action + cc200.rivals + cc200.attention + cc200.ownSessions + cc200.community).size)
        assertEquals(66, (mine.action + mine.rivals + mine.attention + mine.ownSessions + mine.community).size)
    }

    @Test
    fun closePersonalBestExpiresAndRecentRivalActivityTakesPriority() {
        val now = ACTIVITY_RELEVANCE_WINDOW_MS * 2
        val recentThreat = story(
            "Near", 92_200, now - ACTIVITY_RELEVANCE_WINDOW_MS, personalBest = true,
        )
        val staleThreat = story(
            "Stale", 92_100, now - ACTIVITY_RELEVANCE_WINDOW_MS - 1, personalBest = true,
        )
        val rival = story(
            "Rival", 95_000, now - 1, playerId = "player.rival",
        )
        val sections = buildAndroidActivityFeed(
            listOf(staleThreat, recentThreat, rival),
            ownBests,
            "player.ben",
            rivalPlayerIds = setOf("player.rival"),
            nowMs = now,
        )

        assertEquals(listOf("Rival"), sections.rivals.map { it.story.player.displayName })
        assertEquals(listOf("Near"), sections.attention.map { it.story.player.displayName })
        assertEquals(listOf("Stale"), sections.community.map { it.story.player.displayName })
    }

    @Test
    fun homePreviewIsTenRowsAndStartsWithOneStoryPerRival() {
        val now = 1_000L
        val rivals = listOf(
            story("A latest", 95_000, 999, playerId = "player.a"),
            story("A older", 95_100, 998, playerId = "player.a"),
            story("B", 95_200, 997, playerId = "player.b"),
            story("C", 95_300, 996, playerId = "player.c"),
        )
        val sections = buildAndroidActivityFeed(
            rivals, ownBests, "player.ben",
            rivalPlayerIds = setOf("player.a", "player.b", "player.c"),
            nowMs = now,
        )
        val preview = limitAndroidActivityFeed(sections, 3)

        assertEquals(listOf("player.a", "player.b", "player.c"),
            preview.rivals.map { it.story.player.playerId })
        assertEquals(3, preview.rivals.size)
    }

    private fun story(
        name: String,
        timeMs: Long,
        at: Long,
        playerId: String = "player.${name.lowercase().replace(' ', '_')}",
        personalBest: Boolean = false,
        overtakeDelta: Long? = null,
        trackId: String = "track.mario_kart_stadium",
        mode: Int = 150,
        playerDeltaMs: Long? = null,
    ) = AndroidActivityStory(
        player = AndroidActivityPlayer(playerId, name),
        trackId = trackId,
        mode = mode,
        runs = 1,
        startMs = timeMs,
        bestMs = timeMs,
        personalBest = personalBest,
        latestAtMs = at,
        viewerOvertake = overtakeDelta?.let {
            AndroidViewerOvertake("notification.$name", timeMs, 92_000, it, 4)
        },
        playerDeltaMs = playerDeltaMs,
    )
}
