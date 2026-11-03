package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AndroidTournamentStandingTest {
    private fun entry(
        playerId: String = "player.ben",
        rank: Int = 1,
        races: Int = 48,
        finishPositionTotal: Int = 144,
        points: Int = 480,
    ) = AndroidTournamentStandingEntry(
        rank = rank,
        playerId = playerId,
        username = playerId.substringAfterLast('.'),
        displayName = playerId.substringAfterLast('.').replaceFirstChar(Char::uppercase),
        score = 31.25,
        tournaments = 6,
        races = races,
        wins = 12,
        podiums = 30,
        points = points,
        finishPositionTotal = finishPositionTotal,
        finishes = listOf(12, 10, 8, 6, 4, 3, 2, 1, 1, 1, 0, 0),
    )

    @Test
    fun averagesAreTheRatiosTheCardShows() {
        val row = entry()
        assertEquals(3.0, androidTournamentAverageFinish(row)!!, 1e-9)
        assertEquals(10.0, androidTournamentAveragePoints(row)!!, 1e-9)
    }

    @Test
    fun aPlayerWithNoRacesHasNoAverageRatherThanZero() {
        val row = entry(races = 0, finishPositionTotal = 0, points = 0)
        assertNull(androidTournamentAverageFinish(row))
        assertNull(androidTournamentAveragePoints(row))
    }

    @Test
    fun comparisonOpensOnTheViewerAndTheirRivals() {
        val entries = listOf(
            entry("player.ben", rank = 1),
            entry("player.evan", rank = 2),
            entry("player.nova", rank = 3),
        )
        assertEquals(
            listOf("player.ben", "player.nova"),
            androidTournamentDefaultSelection(entries, "player.ben", setOf("player.nova")),
        )
    }

    @Test
    fun aVisitorStillSeesOneCurveRatherThanAnEmptyChart() {
        val entries = listOf(entry("player.ben"), entry("player.evan", rank = 2))
        assertEquals(
            listOf("player.ben"),
            androidTournamentDefaultSelection(entries, null, emptySet()),
        )
    }

    @Test
    fun theComparisonHoldsThreePlayersLikeTheTimeTrialHalf() {
        var selection = emptyList<String>()
        listOf("a", "b", "c", "d", "e").forEach {
            selection = androidTournamentToggleSelection(selection, "player.$it")
        }
        assertEquals(ANDROID_RANK_COMPARE_LIMIT, selection.size)
        assertEquals(listOf("player.c", "player.d", "player.e"), selection)
    }

    @Test
    fun theDefaultSelectionAlsoStopsAtThree() {
        val entries = listOf(
            entry("player.ben"),
            entry("player.evan", rank = 2),
            entry("player.nova", rank = 3),
            entry("player.matteo", rank = 4),
        )
        assertEquals(
            ANDROID_RANK_COMPARE_LIMIT,
            androidTournamentDefaultSelection(
                entries,
                "player.ben",
                setOf("player.evan", "player.nova", "player.matteo"),
            ).size,
        )
    }

    @Test
    fun pickingAPlayerTwiceRemovesThemAgainButNeverTheMainPlayer() {
        val once = androidTournamentToggleSelection(listOf("player.ben"), "player.evan", "player.ben")
        assertEquals(listOf("player.ben", "player.evan"), once)
        // The main Player stays in their own comparison (owner, 2026-09-17).
        assertEquals(once, androidTournamentToggleSelection(once, "player.ben", "player.ben"))
        assertEquals(
            listOf("player.ben"),
            androidTournamentToggleSelection(once, "player.evan", "player.ben"),
        )
    }

    @Test
    fun aThirdOtherReplacesTheOldestAndTheMainPlayerLeads() {
        var selection = listOf("player.ben")
        listOf("evan", "nova", "matteo").forEach {
            selection = androidTournamentToggleSelection(selection, "player.$it", "player.ben")
        }
        assertEquals(listOf("player.ben", "player.nova", "player.matteo"), selection)
        assertEquals(
            listOf("player.ben", "player.matteo", "player.valerio"),
            androidTournamentAnchoredSelection(
                listOf("player.matteo", "player.valerio", "player.ben"), "player.ben",
            ),
        )
    }

    @Test
    fun theComparisonDrawsOnlyTheRacesEveryoneFinished() {
        val entries = listOf(
            entry("player.ben", races = 300, points = 2634),
            entry("player.matteo", rank = 2, races = 327, points = 3505),
            entry("player.valerio", rank = 3, races = 207, points = 1938),
        )
        val selection = listOf("player.ben", "player.matteo", "player.valerio")
        // Alone, the main Player is their own record.
        assertEquals(
            300,
            androidTournamentComparedRows(entries, listOf("player.ben"), null).single().races,
        )
        assertEquals(emptyList<String>(), androidTournamentComparisonKey(entries, listOf("player.ben")))
        // Compared, nothing is drawn until the shared count is here...
        assertEquals(selection, androidTournamentComparisonKey(entries, selection))
        assertEquals(emptyList<AndroidTournamentStandingEntry>(),
            androidTournamentComparedRows(entries, selection, null))
        // ...and then every row is the record over those shared races.
        val record = { id: String, points: Int ->
            AndroidTournamentSharedRecord(id, 105, 8, 38, points, 567, List(12) { if (it == 11) 105 else 0 })
        }
        val rows = androidTournamentComparedRows(
            entries, selection,
            AndroidTournamentSharedRaces(105, listOf(
                record("player.ben", 838), record("player.matteo", 1101), record("player.valerio", 978),
            )),
        )
        assertEquals(listOf(105, 105, 105), rows.map { it.races })
        assertEquals(838.0 / 105, androidTournamentAveragePoints(rows[0])!!, 1e-9)
        // The rank and the name still come from the standing.
        assertEquals("Matteo", rows[1].displayName)
    }
}
