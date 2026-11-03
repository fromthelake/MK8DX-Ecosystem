package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Looking at somebody else's tournament record. The Web reaches the same place
 * through `?ranking=tournament&player=`, so both clients have to resolve a
 * name to the same person, and fall back the same way when they cannot.
 */
class AndroidTournamentFocusTest {

    private fun entry(rank: Int, username: String) = AndroidTournamentStandingEntry(
        rank = rank,
        playerId = "player.$username",
        username = username,
        displayName = username.replaceFirstChar(Char::uppercase),
        score = 30.0 - rank,
        tournaments = 6,
        races = 48,
        wins = 12,
        podiums = 30,
        points = 480,
        finishPositionTotal = 144,
        finishes = List(12) { 4 },
    )

    private val standing = listOf(
        entry(1, "gideon"), entry(2, "ben"), entry(3, "clementine"), entry(4, "matteo"),
    )

    @Test
    fun `no reference means the person holding the phone`() {
        assertEquals(
            "player.ben",
            androidTournamentFocus(standing, null, "player.ben")?.playerId,
        )
    }

    @Test
    fun `a screen name finds the player, whatever the casing`() {
        // The Web hands out links carrying the username, not the player id.
        assertEquals(
            "player.clementine",
            androidTournamentFocus(standing, "CLEMENTINE", "player.ben")?.playerId,
        )
        assertEquals(
            "player.clementine",
            androidTournamentFocus(standing, "  clementine ", "player.ben")?.playerId,
        )
    }

    @Test
    fun `a player id works as well as a name`() {
        assertEquals(
            "player.matteo",
            androidTournamentFocus(standing, "player.matteo", "player.ben")?.playerId,
        )
    }

    @Test
    fun `a name nobody has lands on you rather than on nothing`() {
        assertEquals(
            "player.ben",
            androidTournamentFocus(standing, "nobody", "player.ben")?.playerId,
        )
    }

    @Test
    fun `signed out, the section still shows the Player at the top`() {
        assertEquals("player.gideon", androidTournamentFocus(standing, null, null)?.playerId)
    }

    @Test
    fun `an empty standing has nobody to focus on`() {
        assertNull(androidTournamentFocus(emptyList(), "clementine", "player.ben"))
    }

    private fun rival(username: String) = AndroidTournamentRivalry(
        playerId = "player.$username",
        username = username,
        displayName = username.replaceFirstChar(Char::uppercase),
        sharedRaces = 40, ahead = 20, behind = 18, tied = 2,
        averagePointsDelta = -1.7,
    )

    @Test
    fun `a focused page compares that player with the people they race`() {
        // Not with the rivals the reader follows: that put one person's charts
        // under another person's name.
        assertEquals(
            listOf("player.clementine", "player.gideon", "player.matteo"),
            androidTournamentFocusSelection(
                standing,
                "player.clementine",
                listOf(rival("gideon"), rival("matteo"), rival("ben")),
            ),
        )
    }

    @Test
    fun `an opponent outside the standing cannot be charted`() {
        assertEquals(
            listOf("player.clementine", "player.ben"),
            androidTournamentFocusSelection(
                standing,
                "player.clementine",
                listOf(rival("someone-else"), rival("ben")),
            ),
        )
    }

    @Test
    fun `no subject means no selection to impose`() {
        assertTrue(androidTournamentFocusSelection(standing, null, emptyList()).isEmpty())
        assertTrue(
            androidTournamentFocusSelection(standing, "player.ghost", emptyList()).isEmpty(),
        )
    }

    @Test
    fun `the first year away costs nothing, and is not marked`() {
        val dag = 86_400_000L
        val nu = 1_000L * dag
        // Missing one Tournament is 217 to 315 days. The Web uses the same rule.
        assertTrue(!androidRatingIsReverting(nu - 300 * dag, nu))
        assertTrue(!androidRatingIsReverting(nu - 365 * dag, nu))
        assertTrue(androidRatingIsReverting(nu - 400 * dag, nu))
        assertTrue(!androidRatingIsReverting(null, nu))
    }

    @Test
    fun `one letter is not a search`() {
        // Otherwise every keystroke dumps the whole standing into the card.
        assertTrue(androidTournamentPlayerMatches(standing, "c").isEmpty())
        assertTrue(androidTournamentPlayerMatches(standing, " ").isEmpty())
    }

    @Test
    fun `a name that starts with what was typed comes first`() {
        val hits = androidTournamentPlayerMatches(
            standing + entry(5, "clem_the_second") + entry(6, "anclemt"),
            "clem",
        )
        assertEquals("player.clementine", hits.first().playerId)
        assertTrue(hits.any { it.playerId == "player.anclemt" })
    }

    @Test
    fun `the picker never returns more than it can show`() {
        val many = (1..30).map { entry(it, "racer$it") }
        assertEquals(
            ANDROID_TOURNAMENT_PICKER_LIMIT,
            androidTournamentPlayerMatches(many, "racer").size,
        )
    }
}
