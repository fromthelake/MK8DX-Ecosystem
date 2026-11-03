package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.compose.ui.Modifier
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Step 3 against the source Manager's `renderGroupBoard`: the board hint, the
 * group header badge, the tier breakdown, the rank stats, the seat rows, the
 * placement status and the confirm action.
 */
@RunWith(AndroidJUnit4::class)
class TournamentGroupDraftStepVisualTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun stationCardShowsTheSourceEthernetIconAndTournamentCableNumber() {
        setContent()

        compose.onNodeWithTag("tournament-group-draft-step")
            .performScrollToNode(hasContentDescription("UTP-kabel"))
        compose.onAllNodesWithContentDescription("UTP-kabel").assertCountEquals(2)
        compose.onNodeWithText("#1").assertIsDisplayed()
    }

    @Test
    fun theBoardShowsTheSourceHintAndStageTotals() {
        setContent()

        compose.onNodeWithTag("tournament-group-draft-step").assertIsDisplayed()
        compose.onNodeWithText(" op een kaart om in te delen, te wisselen of te parkeren.")
            .assertIsDisplayed()
        compose.onNodeWithText("Kwalificatie Groepen indeling").performScrollTo().assertIsDisplayed()
        // Two stations plus one parked station, four seated plus one parked Player.
        compose.onNodeWithTag("tournament-group-draft-total").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("3 Switches & 5 deelnemers").assertIsDisplayed()
    }

    @Test
    fun aGroupHeaderCarriesTheSourceCountBadgeAndTierBreakdown() {
        setContent()

        compose.onNodeWithText("Groep 1").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("2/6 Switch · 4/4 plek").performScrollTo().assertIsDisplayed()
        // Ranks 1 and 5 are Kampioen, rank 20 is Talent, an unranked Player is Nieuw.
        compose.onNodeWithText("Kampioen 2/2").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Talent 1/1").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Nieuw 1/1").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun theRankStatsUseTheSourceDutchDecimals() {
        setContent()

        // 30,00 / 26,00 / 22,00 / 18,00 averages to 24,00 with a +6,00 / -6,00 spread.
        compose.onNodeWithText("Gem. SP: 24,00 · Spreiding: +6,00 / -6,00")
            .performScrollTo().assertIsDisplayed()
    }

    @Test
    fun anUnplacedParticipantBlocksTheConfirmActionAndIsParked() {
        setContent()

        val list = compose.onNodeWithTag("tournament-group-draft-step")
        list.performScrollToNode(hasText("Geparkeerde deelnemers (1)"))
        compose.onNodeWithText("Geparkeerde deelnemers (1)").assertIsDisplayed()
        compose.onNodeWithTag("tournament-group-parked-player.parked").assertIsDisplayed()
        val warning = "Nog 1 deelnemers niet ingedeeld. Controleer de groepen voordat je doorgaat."
        list.performScrollToNode(hasText(warning))
        compose.onNodeWithText(warning).assertIsDisplayed()
    }

    @Test
    fun selectingASeatedPlayerOffersTheSourceMoveTargets() {
        setContent()

        compose.onNodeWithTag("tournament-group-player-player.one").performScrollTo().performClick()
        compose.onNodeWithText("Verplaats Gideon").assertIsDisplayed()
        compose.onNodeWithTag("tournament-move-sheet-group-group.two").assertIsDisplayed()
    }

    @Test
    fun everyEditableParticipantCardCarriesTheSourceMoveArrow() {
        setContent()

        compose.onNodeWithContentDescription("Verplaats Gideon")
            .performClick()

        compose.onNodeWithText("Verplaats Gideon").assertIsDisplayed()
    }

    @Test
    fun aParkedPlayerCanBeSentBackToParkingFromTheBoard() {
        val moves = mutableListOf<Pair<String, String?>>()
        setContent(onMovePlayer = { playerId, target -> moves += playerId to target })

        compose.onNodeWithTag("tournament-group-player-player.one").performScrollTo().performClick()
        compose.onNodeWithTag("tournament-move-sheet-park").performClick()

        assertEquals(listOf<Pair<String, String?>>("player.one" to null), moves)
    }

    @Test
    fun finalGroupsOfferOnlyTheExplicitAdminPlayerSwap() {
        val base = groupBoardDocument()
        val groups = listOf(
            base.groups[0].copy(stage = "final"),
            base.groups[1].copy(
                stage = "final",
                members = listOf(
                    AndroidTournamentMember(
                        "player.parked", "Wachtende", 1,
                        AndroidTournamentMemberStation("player.parked", "Wachtende", "ns1", 1),
                    ),
                ),
            ),
        )
        val seats = mutableListOf<List<Any>>()
        setContent(
            document = base.copy(groups = groups),
            stage = "final",
            stepNumber = 7,
            allowFinalGroupOverride = true,
            onSeatPlayer = { player, group, owner, switchType, seat ->
                seats += listOf(player, group, owner, switchType, seat)
            },
        )

        compose.onNodeWithTag("tournament-group-player-player.one").performScrollTo().performClick()
        compose.onNodeWithTag("tournament-move-sheet-group-group.two").performClick()
        compose.onNodeWithText("Wachtende · wissel").performClick()

        assertEquals(listOf(listOf("player.one", "group.two", "player.parked", "ns1", 1)), seats)
    }

    @Test
    fun aLockedBoardOffersReopenInsteadOfConfirm() {
        setContent(document = groupBoardDocument(locked = true))

        compose.onNodeWithTag("tournament-group-draft-step")
            .performScrollToNode(hasTestTag("tournament-group-draft-confirm"))
        compose.onNodeWithTag("tournament-group-draft-confirm").assertIsDisplayed()
        compose.onNodeWithText("Indeling heropenen").assertIsDisplayed()
        compose.onAllNodesWithText("Indeling bevestigen en doorgaan").assertCountEquals(0)
    }

    @Test
    fun theCsvBlockAnnouncesTheSourceColumns() {
        setContent()

        compose.onNodeWithTag("tournament-group-draft-csv").performScrollTo().performClick()
        compose.onNodeWithText(
            "CSV kolommen: Switcheigenaar, Console (NS1/NS2), Deelnemer 1, Deelnemer 2, Groep.",
            substring = true,
        ).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun theExportUsesTheSourceHeaderAndOneRowPerConsole() {
        val csv = androidGroupBoardCsv(groupBoardDocument().groups)
        val lines = csv.trim().lines()

        assertEquals("\uFEFFSwitcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep", lines.first())
        assertTrue(lines.contains("Gideon;NS1;Gideon;Ewald;Groep 1"))
        assertTrue(lines.contains("Moss HM;NS2;Moss HM;Nieuwkomer;Groep 1"))
    }

    private fun setContent(
        document: AndroidTournamentDocument = groupBoardDocument(),
        stage: String = "qualifier",
        stepNumber: Int = 3,
        onMovePlayer: (String, String?) -> Unit = { _, _ -> },
        allowFinalGroupOverride: Boolean = false,
        onSwapPlayers: (String, String) -> Unit = { _, _ -> },
        onSeatPlayer: (String, String, String, String, Int) -> Unit = { _, _, _, _, _ -> },
    ) {
        compose.setContent {
            DutchBoardTheme {
                TournamentGroupDraftStep(
                    document = document,
                    stage = stage,
                    stepNumber = stepNumber,
                    busy = false,
                    error = null,
                    notice = null,
                    onHome = {},
                    onBack = {},
                    onRefresh = {},
                    onLeave = {},
                    onMovePlayer = onMovePlayer,
                    onConfirmPlacement = {},
                    onReopenPlacement = {},
                    onExportCsv = {},
                    onImportCsvText = {},
                    allowFinalGroupOverride = allowFinalGroupOverride,
                    onSwapPlayers = onSwapPlayers,
                    onSeatPlayer = onSeatPlayer,
                    modifier = Modifier,
                )
            }
        }
    }
}

internal fun groupBoardDocument(locked: Boolean = false): AndroidTournamentDocument {
    fun participant(id: String, name: String, rank: Int?, score: Double?, ns1: Boolean = false, ns2: Boolean = false) =
        AndroidTournamentParticipant(
            playerId = id, username = id.removePrefix("player."), displayName = name,
            attendance = ATTENDANCE_PRESENT, hasSwitch1 = ns1, hasSwitch2 = ns2,
            seedScore = score, seedRank = rank,
        )

    fun member(id: String, name: String, owner: String, ownerName: String, type: String, seat: Int, order: Int) =
        AndroidTournamentMember(
            playerId = id, displayName = name, seatOrder = order,
            station = AndroidTournamentMemberStation(
                ownerPlayerId = owner, ownerDisplayName = ownerName,
                switchType = type, seatNumber = seat, utpCableNumber = if (seat == 1) 1 else null,
            ),
        )

    val participants = listOf(
        participant("player.one", "Gideon", 1, 30.0, ns1 = true),
        participant("player.two", "Ewald", 5, 26.0),
        participant("player.three", "Moss HM", 20, 22.0, ns2 = true),
        participant("player.four", "Nieuwkomer", null, 18.0),
        participant("player.parked", "Wachtende", 40, 12.0),
    )
    val groupOne = AndroidTournamentGroup(
        groupId = "group.one", stage = "qualifier", sequence = 1, name = "Groep 1",
        locked = locked, manualScoreSegments = 1,
        members = listOf(
            member("player.one", "Gideon", "player.one", "Gideon", "ns1", 1, 1),
            member("player.two", "Ewald", "player.one", "Gideon", "ns1", 2, 2),
            member("player.three", "Moss HM", "player.three", "Moss HM", "ns2", 1, 3),
            member("player.four", "Nieuwkomer", "player.three", "Moss HM", "ns2", 2, 4),
        ),
        races = emptyList(), manualScores = emptyList(),
        standings = AndroidTournamentStandings(source = "manual", rows = emptyList()),
    )
    val groupTwo = AndroidTournamentGroup(
        groupId = "group.two", stage = "qualifier", sequence = 2, name = "Groep 2",
        locked = locked, manualScoreSegments = 1, members = emptyList(),
        races = emptyList(), manualScores = emptyList(),
        standings = AndroidTournamentStandings(source = "manual", rows = emptyList()),
    )
    return AndroidTournamentDocument(
        schemaVersion = "mk8dx.tournament-operation.v1",
        summary = AndroidTournamentSummary(
            tournamentId = "tournament.board", name = "PORTREF", stage = "qualifiers",
            workflowStep = 3, qualifierRounds = true, maxParticipants = null, revision = 8,
            seedingSource = "community_rating", placementStrategy = "balanced", ownerSeatingMode = "owner_strict",
            participantCount = participants.size, presentCount = participants.size,
            publicResults = false, affectsRating = false, updatedAtMs = 1_787_420_000_000,
        ),
        participants = participants,
        stations = listOf(
            AndroidTournamentStation("player.one", "Gideon", "ns1", 1),
            AndroidTournamentStation("player.three", "Moss HM", "ns2", 2),
            AndroidTournamentStation("player.parked", "Wachtende", "ns1", 3),
        ),
        groups = listOf(groupOne, groupTwo),
        overall = emptyList(),
        lifecycle = emptyList(),
    )
}
