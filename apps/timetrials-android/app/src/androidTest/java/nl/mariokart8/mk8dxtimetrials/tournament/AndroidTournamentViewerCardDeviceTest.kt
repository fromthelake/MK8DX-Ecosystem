package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.runtime.mutableStateOf
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import org.junit.Rule
import org.junit.Test

/**
 * A night's card, rendered on a device.
 *
 * Signing the phone in needs a password at the device-approval page, which is
 * the owner's to type, so the card is proven here instead: a real Compose
 * render of a real night, asserting the lines the site shows. The card is on
 * the shelf where its night belongs now, so its heading is the night's own
 * name and "Jouw toernooi" is a chip on it.
 */
class AndroidTournamentViewerCardDeviceTest {

    @get:Rule
    val compose = createComposeRule()

    /** 2026-09-11T18:00:00Z, Friday at 20:00 in Amsterdam. */
    private val fridayEight = 1_789_149_600_000L

    private fun summary(
        startAtMs: Long?,
        step: Int?,
        stage: String = "qualifiers",
    ) = AndroidPublicTournamentSummary(
        tournamentId = "tournament.night",
        name = "Toernooi 13v2",
        stage = stage,
        participantCount = 33,
        updatedAtMs = fridayEight,
        eventDate = "2026-09-11",
        startAtMs = startAtMs,
        timezone = "Europe/Amsterdam",
        workflowStep = step,
        directorDisplayName = "Ben",
        viewerParticipated = true,
    )

    private fun standing(
        startAtMs: Long?,
        running: Boolean,
        step: Int?,
    ) = AndroidViewerStanding(
        tournamentId = "tournament.night",
        name = "Toernooi 13v2",
        eventDate = "2026-09-11",
        startAtMs = startAtMs,
        timezone = "Europe/Amsterdam",
        running = running,
        workflowStep = step,
        groupName = "Groep 2",
        seedRank = 5,
        stationOwnerPlayerId = "player.ben",
        stationOwnerDisplayName = "Ben",
        switchType = "ns1",
        seatNumber = 1,
        seatMates = listOf(
            AndroidPublicSeat(
                playerId = "player.jory", displayName = "Jory", seatOrder = 1,
                stationOwnerDisplayName = "Ben", switchType = "ns1", seatNumber = 2,
                seedRank = 40,
            ),
        ),
        points = null, races = null, groupRank = null, groupSize = null,
        placement = null, of = null,
    )

    @Test
    fun aNightStillToComeIsComingUpWithItsDayAndItsClock() {
        val tick = mutableStateOf(fridayEight - 2 * 86_400_000L)
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                NightCard(
                    night = summary(startAtMs = fridayEight, step = 4),
                    standing = standing(startAtMs = fridayEight, running = false, step = 4),
                    event = null,
                    dutch = false,
                    tick = tick,
                    shelfNow = fridayEight - 2 * 86_400_000L,
                )
            }
        }
        // The night's own name is the heading; whose night it is, is a chip.
        compose.onNodeWithText("TOERNOOI 13V2").assertIsDisplayed()
        compose.onNodeWithText("Your tournament").assertIsDisplayed()
        compose.onNodeWithText("33 players · Director: Ben").assertIsDisplayed()
        compose.onNodeWithText("Friday 11 September 2026 at 20:00").assertIsDisplayed()
        // Where you sit, who is beside you, and the SP ranks as their own
        // coloured chips - so the line is several nodes, not one string.
        compose.onNodeWithText("Groep 2").assertIsDisplayed()
        compose.onNodeWithText("· [NS1] Ben’s Switch").assertIsDisplayed()
        compose.onNodeWithText("· seat #1").assertIsDisplayed()
        compose.onNodeWithText("· you").assertIsDisplayed()
        compose.onNodeWithText("next to").assertIsDisplayed()
        compose.onNodeWithText("Jory").assertIsDisplayed()
        // Ben is #5 (champion band) and Jory #40 (adventure); both are chips.
        compose.onNodeWithText("#5").assertIsDisplayed()
        compose.onNodeWithText("#40").assertIsDisplayed()
        // The card prints what the step is waiting for, not the step's name.
        compose.onNodeWithText(
            "Step 4 of 10 · Qualifier layout ready · being shared",
        ).assertIsDisplayed()
    }

    @Test
    fun aNightBeingRacedIsTonightAndShowsHowItIsGoing() {
        val started = System.currentTimeMillis() - 3_600_000L
        val racing = standing(startAtMs = started, running = true, step = 5).copy(
            points = 82, races = 8, groupRank = 2, groupSize = 12,
        )
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                NightCard(
                    night = summary(startAtMs = started, step = 5, stage = "qualifiers"),
                    standing = racing,
                    event = null,
                    dutch = true,
                    tick = mutableStateOf(System.currentTimeMillis()),
                    shelfNow = System.currentTimeMillis(),
                )
            }
        }
        compose.onNodeWithText("Jouw toernooi").assertIsDisplayed()
        compose.onNodeWithText("2e van 12 in Groep 2 · 82 punten uit 8 races").assertIsDisplayed()
        compose.onNodeWithText("Stap 5 van 10", substring = true).assertIsDisplayed()
    }
}
