package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidNotification
import nl.mariokart8.mk8dxtimetrials.notifications.androidNotificationLink
import nl.mariokart8.mk8dxtimetrials.notifications.androidNotificationPresentation
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** ADR-0222: the status line, the sign-up document and the Director's board, the twin of the website. */
class AndroidTournamentSignupTest {
    // Friday 6 November 2026, 20:00 in Amsterdam; read on the Tuesday before.
    private val closes = 1_793_991_600_000L
    private val now = 1_793_707_200_000L

    private fun document(state: String, extra: String = "") = """
        {"schemaVersion":"mk8dx.tournament-signup.v1","tournamentId":"tournament.signup-friday","mode":"open",
         "selection":"draw","status":"open","closesAtMs":$closes,"timezone":"Europe/Amsterdam","capacity":36,
         "taken":24,"closedAtMs":null,"drawSeed":null,"drawAlgorithm":null,
         "active":[{"position":1,"playerId":"player.bo","displayName":"Bo"}],
         "waiting":[{"position":1,"playerId":null,"displayName":"Cy"}],
         "viewer":{"state":"$state","playerId":"player.ada","hasSwitch1":true,"hasSwitch2":false,
           "waitingPosition":3,"canSignUp":false,"canWithdraw":true,"canChangeConsoles":true}$extra}
    """.trimIndent()

    @Test
    fun `parses the document and refuses another schema`() {
        val signup = parseAndroidTournamentSignup(document("pending"))
        assertEquals("pending", signup.viewer.state)
        assertTrue(signup.viewer.hasSwitch1)
        assertEquals(listOf("Bo"), signup.active.map { it.displayName })
        assertNull(signup.waiting.single().playerId)
        assertThrows(AndroidTournamentClientException::class.java) {
            parseAndroidTournamentSignup(document("pending").replace("tournament-signup.v1", "tournament-signup.v9"))
        }
    }

    @Test
    fun `says the owner's lines in English and Dutch`() {
        val english = AndroidProductLanguage.ENGLISH
        val dutch = AndroidProductLanguage.DUTCH
        fun line(state: String, language: AndroidProductLanguage) =
            androidSignupStatusLine(language, parseAndroidTournamentSignup(document(state)), now)?.text

        assertEquals("Sign-up closes Fri 20:00 · 24 of 36 places", line("not_signed_up", english))
        assertEquals("Aanmelden sluit vr 20:00 · 24 van 36 plaatsen", line("not_signed_up", dutch))
        assertEquals("You're signed up · the draw is on Fri 20:00", line("pending", english))
        assertEquals("Je bent aangemeld · er wordt geloot op vr 20:00", line("pending", dutch))
        assertEquals("You're in", line("selected", english))
        assertEquals("Je doet mee", line("selected", dutch))
        assertEquals("Waiting list · number 3", line("waiting", english))
        assertEquals("Wachtlijst · nummer 3", line("waiting", dutch))
        assertEquals("You withdrew", line("withdrawn", english))
        assertEquals("Sign-up is closed", line("closed", english))
        assertEquals("The Director puts the list together", line("director_roster", english))
        assertEquals("De Directeur stelt de lijst samen", line("director_roster", dutch))
    }

    @Test
    fun `the Director's board warns when too few consoles come`() {
        val board = parseAndroidTournamentSignupBoard(
            """
            {"schemaVersion":"mk8dx.tournament-signup-board.v1","tournamentId":"tournament.signup-friday","editable":true,
             "settings":{"mode":"open","selection":"first_come","status":"open","closesAtMs":$closes,"capacity":2,
               "closedAtMs":null,"drawSeed":null,"drawAlgorithm":null},
             "entries":[{"playerId":"player.bo","displayName":"Bo","status":"waiting","position":1,"signedUpAtMs":$now,
               "attendance":"waiting","hasSwitch1":false,"hasSwitch2":false}],
             "consoles":{"players":3,"coming":1,"needed":2,"warning":true}}
            """.trimIndent(),
        )
        assertEquals(
            "Too few consoles: 1 coming for 3 players, 2 needed.",
            androidSignupConsoleWarning(AndroidProductLanguage.ENGLISH, board),
        )
        assertEquals("Wachtlijst 1", androidSignupEntryLabel(AndroidProductLanguage.DUTCH, board.entries.single()))
        assertNull(androidSignupConsoleWarning(AndroidProductLanguage.ENGLISH, board.copy(consoles = board.consoles.copy(warning = false))))
    }

    @Test
    fun `a sign-up notification names the night and opens its page`() {
        fun notification(kind: String, detail: String) = AndroidNotification(
            notificationId = "4", kind = kind, detail = detail, tournamentId = "tournament.signup-friday",
            tournamentName = "Friday", count = 1, lastEventAtMs = now, read = false,
        )
        assertEquals("Je doet mee aan Friday", androidNotificationPresentation(notification("tournament_signup_selected", "selected")).title)
        assertEquals("Je staat op de wachtlijst voor Friday", androidNotificationPresentation(notification("tournament_signup_selected", "waiting")).title)
        assertEquals(
            "You moved up from the waiting list: you're in for Friday",
            androidNotificationPresentation(notification("tournament_signup_moved_up", "moved_up"), AndroidProductLanguage.ENGLISH).title,
        )
        assertEquals(
            "De Directeur heeft je van de lijst voor Friday gehaald",
            androidNotificationPresentation(notification("tournament_signup_removed", "removed")).title,
        )
        assertEquals("/?tournaments=tournament.signup-friday", androidNotificationLink(notification("tournament_signup_removed", "removed")))
        assertEquals(
            "/?tournaments=1",
            androidNotificationLink(notification("tournament_signup_selected", "selected").copy(tournamentId = null)),
        )
    }
}
