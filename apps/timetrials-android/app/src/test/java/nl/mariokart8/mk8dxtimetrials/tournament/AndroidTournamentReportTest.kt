package nl.mariokart8.mk8dxtimetrials.tournament

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The night's derivation, which the charts are drawn from. Every case here has
 * a twin in the Web's `tournament-report.ts`; the two clients have to agree
 * about a running total, a shared rank and who was being chased, or the same
 * night reads differently depending on which one you open.
 */
class AndroidTournamentReportTest {

    private fun race(
        number: Int,
        trackId: String?,
        vararg finishes: Pair<String, Int>,
    ) = AndroidPublicRace(
        raceNumber = number,
        trackId = trackId,
        countsTowardStandings = true,
        placements = finishes.mapIndexed { index, (name, points) ->
            AndroidPublicPlacement(
                finishPosition = index + 1,
                playerId = "player.$name",
                displayName = name,
                racePoints = points,
            )
        },
    )

    private fun standing(rank: Int, name: String, points: Int) = AndroidPublicStanding(
        rank = rank, playerId = "player.$name", displayName = name, points = points,
        races = 2, wins = if (rank == 1) 1 else 0,
    )

    /** Two races, three Players; A wins the first, B the second. */
    private val event = AndroidPublicTournamentEvent(
        tournamentId = "tournament.n",
        name = "Night",
        stage = "finalized",
        groups = listOf(
            AndroidPublicGroup(
                groupId = "g1", stage = "final", sequence = 1, name = "Kampioen",
                tierKey = "champion",
                standings = listOf(
                    standing(1, "Ann", 27),
                    standing(2, "Bea", 24),
                    standing(3, "Cas", 9),
                ),
                races = listOf(
                    race(1, "track.baby_park", "Ann" to 15, "Bea" to 12, "Cas" to 6),
                    race(2, "track.baby_park", "Bea" to 12, "Ann" to 12, "Cas" to 3),
                ),
            ),
        ),
        overall = listOf(
            AndroidPublicOverallRow(1, "player.Ann", "Ann"),
            AndroidPublicOverallRow(2, "player.Bea", "Bea"),
            AndroidPublicOverallRow(3, "player.Cas", "Cas"),
        ),
    )

    @Test
    fun `a running total and the standing after every race`() {
        val report = androidTournamentReport(event)
        val ann = report.groups.single().players.single { it.displayName == "Ann" }
        assertEquals(listOf(15, 27), ann.rows.map { it.totalAfter })
        assertEquals(listOf(1, 1), ann.rows.map { it.positionAfter })
        assertEquals(listOf(1, 2), ann.rows.map { it.position })
        assertEquals(listOf("track.baby_park", "track.baby_park"), ann.rows.map { it.trackId })
    }

    @Test
    fun `equal totals share a rank and are marked as tied`() {
        // After race 1: Ann 15, Bea 12. After race 2: Ann 27, Bea 24 - no tie.
        // Give Bea 15 in race 1 instead and both sit on 27 after race 2.
        val tied = event.copy(
            groups = listOf(
                event.groups.single().copy(
                    races = listOf(
                        race(1, null, "Ann" to 15, "Bea" to 15, "Cas" to 6),
                        race(2, null, "Bea" to 12, "Ann" to 12, "Cas" to 3),
                    ),
                ),
            ),
        )
        val report = androidTournamentReport(tied)
        val players = report.groups.single().players
        val ann = players.single { it.displayName == "Ann" }
        val bea = players.single { it.displayName == "Bea" }
        assertEquals(listOf(1, 1), ann.rows.map { it.positionAfter })
        assertEquals(listOf(1, 1), bea.rows.map { it.positionAfter })
        assertTrue(ann.rows.all { it.tiedAfter })
    }

    @Test
    fun `the benchmark names who held the place and both totals`() {
        val report = androidTournamentReport(event)
        val bea = report.groups.single().players.single { it.displayName == "Bea" }
        // After race 1 Ann leads on 15 and Bea has 12: three behind.
        val first = bea.benchmarkFirst.first()
        assertEquals("Ann", first.displayName)
        assertEquals(15, first.benchmarkTotal)
        assertEquals(12, first.playerTotal)
        assertEquals(-3, first.delta)
    }

    @Test
    fun `the duel is with the place above, and the leader duels the second`() {
        val report = androidTournamentReport(event)
        val players = report.groups.single().players
        val ann = players.single { it.displayName == "Ann" }
        val bea = players.single { it.displayName == "Bea" }
        // The leader has nobody above, so the site pairs them with second.
        assertEquals("Bea", ann.opponent?.displayName)
        assertEquals(listOf(3, 3), ann.opponent?.deltas)
        // Bea is chasing Ann, so the same gap with the sign the other way.
        assertEquals("Ann", bea.opponent?.displayName)
        assertEquals(listOf(-3, -3), bea.opponent?.deltas)
    }

    @Test
    fun `the distribution counts finishes per position`() {
        val report = androidTournamentReport(event)
        val ann = report.groups.single().players.single { it.displayName == "Ann" }
        // One first and one second, and the row is as long as the field.
        assertEquals(report.maxPosition, ann.distribution.size)
        assertEquals(1, ann.distribution[0])
        assertEquals(1, ann.distribution[1])
        assertEquals(0, ann.distribution[2])
    }

    @Test
    fun `the stats line reads from the same rows`() {
        val report = androidTournamentReport(event)
        val ann = report.groups.single().players.single { it.displayName == "Ann" }
        assertEquals(2, ann.raceCount)
        assertEquals(1, ann.winCount)
        assertEquals(2, ann.top3Count)
        assertEquals(1, ann.bestFinish)
        assertEquals(1.5, ann.avgFinish!!, 0.0001)
        assertEquals(1, ann.overallRank)
        assertEquals("champion", ann.groupTierKey)
    }

    @Test
    fun `the top tracks are the ones driven most`() {
        val report = androidTournamentReport(event)
        assertEquals(listOf("track.baby_park" to 2), report.topTracks)
        // A race with no track recorded simply does not count.
        val untracked = androidTournamentReport(
            event.copy(
                groups = listOf(
                    event.groups.single().copy(races = listOf(race(1, null, "Ann" to 15))),
                ),
            ),
        )
        assertEquals(emptyList<Pair<String, Int>>(), untracked.topTracks)
    }

    @Test
    fun `a race that does not count is left out of the standing`() {
        val withBonus = event.copy(
            groups = listOf(
                event.groups.single().copy(
                    races = event.groups.single().races +
                        race(3, null, "Cas" to 15).copy(countsTowardStandings = false),
                ),
            ),
        )
        val cas = androidTournamentReport(withBonus).groups.single()
            .players.single { it.displayName == "Cas" }
        assertEquals(listOf(6, 9), cas.rows.map { it.totalAfter })
    }

    @Test
    fun `the accent hue walks the golden angle so a group reads apart`() {
        assertEquals(0f, androidReportAccentHue(1))
        assertEquals(138f, androidReportAccentHue(2))
        // Thirteen wraps back onto the first accent, as twelve is the cycle.
        assertEquals(androidReportAccentHue(1), androidReportAccentHue(13))
    }

    @Test
    fun `a number reads in the reader's own language`() {
        assertEquals("4,4", androidReportNumber(4.36, 1, dutch = true))
        assertEquals("4.4", androidReportNumber(4.36, 1, dutch = false))
        assertEquals("5", androidReportNumber(5.0, 1, dutch = true))
        assertEquals("50%", androidReportPercent(1, 2, dutch = true))
        assertEquals("0%", androidReportPercent(1, 0, dutch = true))
    }

    @Test
    fun `a night with no races derives nothing rather than throwing`() {
        val empty = AndroidPublicTournamentEvent(
            tournamentId = "t", name = "Empty", stage = "setup",
        )
        val report = androidTournamentReport(empty)
        assertEquals(emptyList<AndroidReportGroup>(), report.groups)
        assertEquals(0, report.raceCount)
        assertNull(report.groups.firstOrNull())
    }
}
