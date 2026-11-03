package nl.mariokart8.mk8dxtimetrials.tournament

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * What the migrated night page derives before it draws anything (Phase 11,
 * A06 / W19-W21): which track's art is the hero's backdrop, what a Player's
 * meta line says now that the podium is a colour rather than a glyph, and the
 * one definition of a tier's colour that replaced the screen's two.
 */
class AndroidTournamentNightPresentationTest {

    private fun race(number: Int, trackId: String?) = AndroidPublicRace(
        raceNumber = number,
        trackId = trackId,
        countsTowardStandings = true,
    )

    private fun event(vararg races: AndroidPublicRace) = AndroidPublicTournamentEvent(
        tournamentId = "tournament.n",
        name = "Night",
        stage = "finalized",
        groups = listOf(
            AndroidPublicGroup(
                groupId = "g1", stage = "final", sequence = 1,
                name = "Kampioen", tierKey = "champion",
                races = races.toList(),
            ),
        ),
    )

    @Test
    fun `the hero backdrop is the track the night drove most`() {
        val index = androidNightHeroTrackIndex(
            event(
                race(1, "track.baby_park"),
                race(2, "track.mario_kart_stadium"),
                race(3, "track.mario_kart_stadium"),
            ),
        )
        assertEquals(
            nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
                .find("track.mario_kart_stadium")?.index,
            index,
        )
    }

    @Test
    fun `a night with no recorded track has no backdrop rather than a wrong one`() {
        assertNull(androidNightHeroTrackIndex(event(race(1, null))))
        assertNull(androidNightHeroTrackIndex(event()))
    }

    @Test
    fun `a tier has one colour, and a group without a tier has none`() {
        // The report kept a second, paler set for its paper; there is no paper
        // any more, so there is one definition.
        assertNotNull(androidTournamentTierColor("champion"))
        assertEquals(
            androidTournamentTierColor("champion"),
            androidTournamentTierColor("winners"),
        )
        assertEquals(
            androidTournamentTierColor("talent"),
            androidTournamentTierColor("losers"),
        )
        assertNull(androidTournamentTierColor(null))
        assertNull(androidTournamentTierColor("groep-1"))
    }

    @Test
    fun `the meta line names the rank and the group without a medal glyph`() {
        val player = AndroidReportPlayer(
            playerId = "player.ann",
            displayName = "Ann",
            character = null,
            groupName = "Kampioen",
            groupTierKey = "champion",
            groupRank = 1,
            overallRank = 1,
            points = 27,
            raceCount = 2,
            winCount = 1,
            top3Count = 2,
            bestFinish = 1,
            avgFinish = 1.5,
            rows = emptyList(),
            distribution = emptyList(),
            benchmarkFirst = emptyList(),
            benchmarkSecond = emptyList(),
            benchmarkThird = emptyList(),
            opponent = null,
        )
        val line = playerMetaLine(player, playerCount = 35, dutch = true)
        assertEquals("Rank #1 van #35 | Kampioen #1", line)
        for (medal in listOf("🏆", "🥈", "🥉")) {
            assertFalse(line.contains(medal))
        }
    }
}
