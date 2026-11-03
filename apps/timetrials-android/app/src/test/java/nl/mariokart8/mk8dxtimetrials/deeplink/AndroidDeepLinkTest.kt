package nl.mariokart8.mk8dxtimetrials.deeplink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The addresses the site's own router dispatches, read on the phone.
 *
 * Every case here is a real link the Web writes into the address bar or a real
 * link one of the notification rules produces. If the two ever disagree, a
 * link somebody shared opens one thing on a laptop and another on a phone,
 * which is the whole reason there is one grammar.
 */
class AndroidDeepLinkTest {
    private fun parse(address: String) = parseAndroidDeepLink(address)

    @Test
    fun `a tournaments link opens the list, and a night opens the night`() {
        assertEquals(
            AndroidDeepLink.Tournaments(),
            parse("https://example.invalid/?tournaments=1"),
        )
        assertEquals(
            AndroidDeepLink.TournamentNight("tournament.522ab3d3-1462-4710-a2e7-03f3c240dd50"),
            parse("https://example.invalid/?tournaments=tournament.522ab3d3-1462-4710-a2e7-03f3c240dd50"),
        )
        // A published edition's report and a public night are the same page here.
        assertEquals(
            AndroidDeepLink.TournamentNight("tournament.history-tn12"),
            parse("https://example.invalid/?night-report=tournament.history-tn12"),
        )
        // The report's first address `?evan-report=` is retired (2026-11-02, no old links).
        assertEquals(
            AndroidDeepLink.Home,
            parse("https://example.invalid/?evan-report=tournament.history-tn12"),
        )
        assertEquals(
            AndroidDeepLink.TournamentNight("tournament.history-tn4"),
            parse("https://example.invalid/?tournament=tournament.history-tn4"),
        )
    }

    @Test
    fun `the statistics panel travels with the view the sender had`() {
        assertEquals(
            AndroidDeepLink.Tournaments(statistics = true),
            parse("https://example.invalid/?tournaments=1#alle-races"),
        )
        val sorted = parse(
            "https://example.invalid/?tournaments=1&stats_sort=players&stats_dir=asc" +
                "&stats_focus=track.mario_circuit&stats_races=%3E3",
        )
        assertEquals(
            AndroidDeepLink.Tournaments(
                statistics = true,
                statisticsSort = "players",
                statisticsDescending = false,
                statisticsFilters = mapOf("races" to ">3"),
                statisticsFocus = "track.mario_circuit",
            ),
            sorted,
        )
        // A link that says nothing about the panel does not open it.
        assertEquals(
            AndroidDeepLink.Tournaments(statistics = false),
            parse("https://example.invalid/?tournaments=1&director=player.ben"),
        )
    }

    @Test
    fun `a leaderboard link carries its track and engine class`() {
        assertEquals(
            AndroidDeepLink.Track("track.mario_circuit", 200),
            parse("https://example.invalid/?leaderboard=track.mario_circuit&mode=200"),
        )
        // The address a notification carries, with the read mark on it.
        assertEquals(
            AndroidDeepLink.Track("track.mario_circuit", 150),
            parse("/?leaderboard=track.mario_circuit&mode=150&notification=41"),
        )
        // A shared run: that leaderboard with that run's Details open (ADR-0199 &run=).
        assertEquals(
            AndroidDeepLink.Track("track.mario_circuit", 200, "user_submission.time.A1"),
            parse("https://example.invalid/?leaderboard=track.mario_circuit&mode=200&run=user_submission.time.A1"),
        )
        // The short leaderboard a LiveTrial upload links (ADR-0199): the schema-9 track index.
        assertEquals(
            AndroidDeepLink.Track("track.sunshine_airport", 150),
            parse("https://example.invalid/?lb=8&mode=150"),
        )
        assertEquals(AndroidDeepLink.Tracks, parse("https://example.invalid/?lb=999&mode=150"))
        // A shared run's code is passed on as it is; the board finds the result it names.
        assertEquals(
            AndroidDeepLink.Track("track.sunshine_airport", 150, "41c260da"),
            parse("https://example.invalid/?lb=8&mode=150&run=41c260da"),
        )
        // A track this build has never heard of opens the list, not nothing.
        assertEquals(
            AndroidDeepLink.Tracks,
            parse("https://example.invalid/?leaderboard=track.not_a_track&mode=150"),
        )
    }

    @Test
    fun `the ranking keeps the whole view the sender had`() {
        // The address the owner actually shared. The names in it are
        // usernames, which is what the site writes - refusing anything that
        // was not a canonical id threw away the Player the link was about.
        assertEquals(
            AndroidDeepLink.Ranking(
                tournament = true,
                player = "evan",
                compare = listOf("moss-hm", "clementine"),
                tracksOpen = true,
                trackSort = "win",
                trackDescending = false,
                trackFilters = mapOf("races" to ">3"),
            ),
            parse(
                "https://example.invalid/?ranking=tournament&player=evan&sort=win&dir=asc" +
                    "&compare=moss-hm%2Cclementine&tracks=open&f_raced=%3E3",
            ),
        )
        assertEquals(
            AndroidDeepLink.Ranking(
                tournament = true, player = "player.gideon",
            ),
            parse("https://example.invalid/?ranking=tournament&player=player.gideon"),
        )
        assertEquals(
            AndroidDeepLink.Ranking(
                tournament = false, mode = 200, scope = "bcp", tab = "tracks",
            ),
            parse("https://example.invalid/?ranking=timetrials&mode=200&scope=bcp&tab=tracks"),
        )
        assertEquals(
            AndroidDeepLink.PlayerPage("player.ben"),
            parse("https://example.invalid/?player=player.ben"),
        )
        assertEquals(
            AndroidDeepLink.PlayerPage("evan"),
            parse("https://example.invalid/?player=evan"),
        )
        // Comparing two Players is the Ranking's own comparison.
        assertEquals(
            AndroidDeepLink.Ranking(tournament = false, compare = listOf("ben", "evan")),
            parse("https://example.invalid/?compare=ben,evan"),
        )
    }

    @Test
    fun `the small routes land where the phone keeps them`() {
        assertEquals(AndroidDeepLink.Home, parse("https://example.invalid/"))
        assertEquals(AndroidDeepLink.Home, parse("https://example.invalid"))
        assertEquals(AndroidDeepLink.Tracks, parse("https://example.invalid/?cups=1"))
        assertEquals(AndroidDeepLink.Records, parse("https://example.invalid/?records=1"))
        assertEquals(AndroidDeepLink.Notifications, parse("https://example.invalid/?notifications=1"))
        assertEquals(AndroidDeepLink.Settings, parse("https://example.invalid/?settings=1&section=groups"))
        assertEquals(AndroidDeepLink.Administration, parse("https://example.invalid/?admin=1"))
        assertEquals(AndroidDeepLink.Account, parse("https://example.invalid/device?user_code=ABCD-EFGH"))
        assertEquals(AndroidDeepLink.Account, parse("https://example.invalid/?signin=1"))
        assertEquals(
            AndroidDeepLink.Build(listOf("character.mario", "body.pipe_frame")),
            parse("https://example.invalid/?build=character.mario,body.pipe_frame"),
        )
        // The page this app is downloaded from is taken, so a tap never
        // bounces - and then handed to a browser, because it is a web page.
        assertEquals(AndroidDeepLink.Apps, parse("https://example.invalid/?apps=1"))
    }

    @Test
    fun `nothing but this product's own addresses is taken`() {
        assertNull(parse("https://example.com/?tournaments=1"))
        assertNull(parse("http://example.invalid/?tournaments=1"))
        assertNull(parse("https://example.invalid.evil.test/?tournaments=1"))
        // Paths this app has no screen for stay with the browser.
        assertNull(parse("https://example.invalid/scanner/"))
        assertNull(parse("https://example.invalid/game-assets/track/1.png"))
        assertNull(parseAndroidDeepLink(null))
        assertNull(parse(""))
    }

    @Test
    fun `a user info trick cannot smuggle another host past the check`() {
        // "https://example.invalid@evil.test/" is a link to evil.test.
        assertNull(parse("https://example.invalid@evil.test/?tournaments=1"))
        assertTrue(parse("https://www.example.invalid/?tournaments=1") != null)
    }
}
