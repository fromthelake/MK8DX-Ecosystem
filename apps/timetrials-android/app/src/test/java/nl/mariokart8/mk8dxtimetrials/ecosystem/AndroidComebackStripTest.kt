package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind

/** Home event wording stays aligned with the web for Players using both clients. */
class AndroidComebackStripTest {
    private fun comeback(
        standing: Int = 3,
        previousStanding: Int? = null,
        rivals: List<AndroidRivalComparison> = emptyList(),
    ) = AndroidHomeComeback(
        schemaVersion = "mk8dx.home-comeback.v1",
        player = AndroidHomePlayer("player.ben", "Ben"),
        timeTrials = AndroidTimeTrialStanding(standing, 8, 1_000_000, previousStanding),
        rivals = rivals,
        sinceMs = 1,
    )

    private fun rival(
        tracksAhead: Int,
        totalDeltaMs: Long,
        previous: AndroidRivalComparisonSnapshot?,
    ) = AndroidRivalComparison(
        playerId = "player.evan",
        displayName = "Evan",
        tracksAhead = tracksAhead,
        tracksBehind = 0,
        sharedCombos = 10,
        totalDeltaMs = totalDeltaMs,
        previous = previous,
    )

    @Test
    fun anUneventfulVisitProducesNoLines() {
        assertTrue(androidComebackLines(comeback()).isEmpty())
        // A rival without a previous comparison cannot have moved.
        assertTrue(androidComebackLines(comeback(rivals = listOf(rival(2, 500, null)))).isEmpty())
    }

    @Test
    fun aStandingChangeIsReportedWithItsDirection() {
        assertEquals(
            listOf("↑ You moved from #5 to #3 in Time Trials 150cc"),
            androidComebackLines(comeback(standing = 3, previousStanding = 5)),
        )
        assertEquals(
            listOf("↓ You moved from #3 to #5 in Time Trials 150cc"),
            androidComebackLines(comeback(standing = 5, previousStanding = 3)),
        )
    }

    @Test
    fun rivalMovementNamesWhoGainedAndByHowMuch() {
        val lines = androidComebackLines(
            comeback(
                rivals = listOf(
                    rival(4, 2_500, AndroidRivalComparisonSnapshot(2, 0, 10, 1_000)),
                ),
            ),
        )
        assertEquals(
            listOf(
                "⚔ You gained 2 tracks on Evan",
                "⏱ Your advantage over Evan improved by 1.500s",
            ),
            lines,
        )
    }

    @Test
    fun aLosingRivalSwapsBothVerbs() {
        val lines = androidComebackLines(
            comeback(
                rivals = listOf(
                    rival(1, -3_000, AndroidRivalComparisonSnapshot(2, 0, 10, -1_000)),
                ),
            ),
        )
        assertEquals(
            listOf(
                "⚔ Evan gained 1 track on you",
                "⏱ Your gap to Evan grew by 2.000s",
            ),
            lines,
        )
    }

    @Test
    fun aGapOfAMinuteOrMoreIsReadAsAClockTime() {
        assertEquals("0.500s", androidAggregateGap(500))
        assertEquals("59.999s", androidAggregateGap(59_999))
        assertEquals("1:00.000", androidAggregateGap(60_000))
        assertEquals("2:03.004", androidAggregateGap(-123_004))
    }

    @Test
    fun recentPbNamesThePassedRivalCurrentGapAndNintendoGhost() {
        val staff = AndroidBenchmarkCatalog.forKind(AndroidBenchmarkKind.NINTENDO_STAFF, 150).first()
        val now = 2_000_000_000_000L
        val best = staff.timeMs - 500
        val home = AndroidHomeBootstrap(
            schemaVersion = "mk8dx.home-bootstrap.v1",
            authenticated = true,
            comeback = comeback(
                standing = 1,
                rivals = listOf(
                    AndroidRivalComparison("player.valerio", "Valerio", 1, 0, 1, 500L),
                    AndroidRivalComparison("player.matteo", "Matteo", 0, 1, 1, -2_000L),
                ),
            ),
            trackBests = AndroidTrackBestsDocument(
                "mk8dx.public-track-bests.v1",
                listOf(
                    AndroidTrackBestPlayer("player.ben", listOf(AndroidTrackBest(staff.trackId, 150, best, 2))),
                    AndroidTrackBestPlayer("player.valerio", listOf(AndroidTrackBest(staff.trackId, 150, best + 500, 3))),
                    AndroidTrackBestPlayer("player.matteo", listOf(AndroidTrackBest(staff.trackId, 150, best - 2_000, 1))),
                ),
            ),
            stories = AndroidActivityStoriesDocument(
                "mk8dx.activity-stories.v1",
                listOf(
                    AndroidActivityStory(
                        player = AndroidActivityPlayer("player.ben", "Ben"),
                        trackId = staff.trackId,
                        mode = 150,
                        runs = 1,
                        startMs = best,
                        bestMs = best,
                        personalBest = true,
                        rank = AndroidActivityRank(
                            after = 2,
                            before = 3,
                            passed = listOf(AndroidPassedPlayer("player.valerio", "Valerio")),
                            passedCount = 1,
                        ),
                        latestAtMs = now - 1_000,
                        personalBestDeltaMs = 4_000,
                    ),
                ),
            ),
        )
        val events = androidRecentKeyEvents(home, now)
        assertEquals(1, events.size)
        val outcomes = listOf(events.single().primaryOutcome) + events.single().secondaryOutcomes
        val text = outcomes.map { it.english }
        assertTrue(text.any { "passed Valerio ✓ · lead 0.500s" in it })
        assertTrue(text.any { "Nintendo Ghost defeated ✓" in it })
        assertTrue(text.any { "track rank: #3 → 🥈 #2" in it })
        assertTrue(text.any { "new PB by 4.000s" in it })
        assertTrue(outcomes.none { it.targetName == "Matteo" })
        assertTrue(outcomes.any { it.kind == AndroidRecentKeyEventKind.PASSED && it.deltaMs == -500L })
        assertTrue(outcomes.any { it.kind == AndroidRecentKeyEventKind.GHOST && it.deltaMs == -500L })
    }

    @Test
    fun equalAcceptedRunIsNotAKeyAchievement() {
        val staff = AndroidBenchmarkCatalog.forKind(AndroidBenchmarkKind.NINTENDO_STAFF, 150).first()
        val now = 2_000_000_000_000L
        val home = AndroidHomeBootstrap(
            schemaVersion = "mk8dx.home-bootstrap.v1",
            authenticated = true,
            comeback = comeback(standing = 1),
            trackBests = AndroidTrackBestsDocument(
                "mk8dx.public-track-bests.v1",
                listOf(AndroidTrackBestPlayer("player.ben", listOf(AndroidTrackBest(staff.trackId, 150, staff.timeMs, 1)))),
            ),
            stories = AndroidActivityStoriesDocument(
                "mk8dx.activity-stories.v1",
                listOf(
                    AndroidActivityStory(
                        player = AndroidActivityPlayer("player.ben", "Ben"),
                        trackId = staff.trackId,
                        mode = 150,
                        runs = 1,
                        startMs = staff.timeMs,
                        bestMs = staff.timeMs,
                        personalBest = true,
                        latestAtMs = now - 1_000,
                        playerDeltaMs = 0,
                    ),
                ),
            ),
        )
        val events = androidRecentKeyEvents(home, now)
        assertTrue(events.isEmpty())
    }

    @Test
    fun runIdentityDeduplicatesDerivedAchievementsButNotEnginesOrGenuineRuns() {
        val now = 2_000_000_000_000L
        val trackId = AndroidBenchmarkCatalog.forKind(AndroidBenchmarkKind.NINTENDO_STAFF, 150).first().trackId
        fun story(mode: Int, details: List<AndroidActivityRun>) = AndroidActivityStory(
            player = AndroidActivityPlayer("player.ben", "Ben"),
            trackId = trackId,
            mode = mode,
            runs = details.size,
            startMs = 101_000,
            bestMs = 100_000,
            personalBest = true,
            latestAtMs = now - 1_000,
            runDetails = details,
            personalBestDeltaMs = 2_000,
        )
        val first = AndroidActivityRun("result.same", 101_000, now - 2_000, sourceKind = "manual")
        val second = AndroidActivityRun("result.other", 100_000, now - 1_000, sourceKind = "manual")
        val mode150 = story(150, listOf(first, second))
        val mode200 = story(200, listOf(first.copy(timeMs = 100_000)))
        val home = AndroidHomeBootstrap(
            schemaVersion = "mk8dx.home-bootstrap.v1",
            authenticated = true,
            comeback = comeback(standing = 1),
            stories = AndroidActivityStoriesDocument(
                "mk8dx.activity-stories.v1",
                listOf(mode150, mode150, mode200),
            ),
        )

        val events = androidRecentKeyEvents(home, now)
        assertEquals(3, events.size)
        assertEquals(setOf(150, 200), events.map { it.mode }.toSet())
        assertEquals(2, events.count { it.mode == 150 })
        assertEquals(1, events.count { it.runId == "result.same" && it.mode == 150 })
        assertEquals(1, events.count { it.runId == "result.same" && it.mode == 200 })
    }
}
