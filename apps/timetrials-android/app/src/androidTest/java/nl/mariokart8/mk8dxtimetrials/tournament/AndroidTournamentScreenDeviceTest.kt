package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidTournamentScreenDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun organizerCanInspectTheBoundedRaceDayWorkflow() {
        val requests = mutableListOf<String>()
        val client = AndroidTournamentClient(
            origin = "https://example.invalid",
            session = AndroidAuthenticatedNativeSession(
                bearerToken = "tournament-device-screen-token",
                expiresAtMs = 1_800_000_000_000,
                playerId = "player.ben",
            ),
            opener = AndroidTournamentConnectionOpener { url ->
                synchronized(requests) { requests += url.path }
                TournamentScreenFakeConnection(url, responseFor(url.path))
            },
        )

        compose.setContent {
            MaterialTheme {
                AndroidTournamentConsole(client = client, onSignIn = {})
            }
        }

        loadFirstTournament()
        // Step 5 is now the source-faithful score screen, which still mounts the
        // Live/Processor evidence the ecosystem polls here. The source phone header
        // shows the board title, not the Tournament name.
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-score-entry-step").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Step 5 · Enter qualifier scores").assertIsDisplayed()
        compose.onAllNodesWithTag("tournament-mobile-tabs").assertCountEquals(0)
        for (removedTab in listOf("Overview", "People", "Groups", "Standings", "Incoming", "Scores")) {
            compose.onAllNodesWithText(removedTab).assertCountEquals(0)
        }
        compose.onNodeWithTag("tournament-score-entry-step")
            .performScrollToNode(hasTestTag("tournament-live-score-guide"))
        compose.onNodeWithText("Recommended on race day: Tournament Live").assertIsDisplayed()
        compose.onNodeWithTag("tournament-score-entry-step")
            .performScrollToNode(hasText("Step 5 · Tournament Live / Processor incoming results"))
        compose.onNodeWithText("Step 5 · Tournament Live / Processor incoming results").assertIsDisplayed()
        compose.onNodeWithTag("tournament-score-entry-step")
            .performScrollToNode(hasText("Mario Kart Stadium"))
        compose.onNodeWithText("Mario Kart Stadium").assertIsDisplayed()
        compose.onAllNodesWithText("Quick manual race entry").assertCountEquals(0)
        compose.onAllNodesWithText("Participants & attendance").assertCountEquals(0)

        assertEquals(
            setOf(
                "/v1/native/tournament-directors",
                "/v1/native/tournaments",
                "/v1/native/tournaments/tournament.demo",
                "/v1/native/tournaments/tournament.demo/incoming-results",
                "/v1/native/tournaments/tournament.demo/evidence-records",
                // Loading a Tournament also reads the Player directory once, for
                // the public aliases a score workbook resolves in-game names by.
                "/v1/player-directory",
            ),
            synchronized(requests) { requests.toSet() },
        )
    }

    @Test
    fun organizerCanLeaveChooseAndRemoveAnEmptyDraft() {
        var deleted = false
        val requests = mutableListOf<String>()
        val client = AndroidTournamentClient(
            origin = "https://example.invalid",
            session = AndroidAuthenticatedNativeSession(
                bearerToken = "tournament-device-delete-token",
                expiresAtMs = 1_800_000_000_000,
                playerId = "player.ben",
            ),
            opener = AndroidTournamentConnectionOpener { url ->
                synchronized(requests) { requests += url.path }
                val response = when (url.path) {
                    "/v1/native/tournament-directors" -> """{"schemaVersion":"mk8dx.native-tournament-directors.v1","canActForOthers":true,"directors":[{"userAccountId":"user_account.ben","displayName":"Ben","isAdministrator":true},{"userAccountId":"user_account.evan","displayName":"Evan","isAdministrator":false}]}"""
                    "/v1/native/tournaments" -> if (deleted) {
                        """{"schemaVersion":"mk8dx.native-tournaments.v1","tournaments":[]}"""
                    } else {
                        """{"schemaVersion":"mk8dx.native-tournaments.v1","tournaments":[${summary()}]}"""
                    }
                    "/v1/native/tournaments/tournament.demo" -> document()
                    "/v1/native/tournaments/tournament.demo/incoming-results" ->
                        """{"schemaVersion":"mk8dx.native-tournament-incoming.v1","results":[]}"""
                    "/v1/native/tournaments/tournament.demo/evidence-records" ->
                        """{"schemaVersion":"mk8dx.native-tournament-evidence-records.v1","records":[]}"""
                    "/v1/native/tournaments/tournament.demo/actions/remove" -> {
                        deleted = true
                        """{"removed":true}"""
                    }
                    else -> error("Unexpected Tournament chooser-test path: ${url.path}")
                }
                TournamentScreenFakeConnection(url, response)
            },
        )

        compose.setContent {
            MaterialTheme { AndroidTournamentConsole(client = client, onSignIn = {}) }
        }
        loadFirstTournament()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-score-entry-step").fetchSemanticsNodes().isNotEmpty()
        }

        compose.onNodeWithTag("tournament-score-entry-menu").performClick()
        compose.onNodeWithTag("tournament-score-entry-leave").performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-start-step").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Step 1: Start tournament").assertIsDisplayed()
        compose.onNodeWithTag("tournament-start-load").performScrollTo().performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-score-entry-menu").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("tournament-score-entry-menu").performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-score-entry-delete").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("tournament-score-entry-delete").performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText("No tournaments available").fetchSemanticsNodes().isNotEmpty()
        }

        compose.onNodeWithText("No tournaments available").assertIsDisplayed()
        assertEquals(true, deleted)
        assertEquals(2, synchronized(requests) { requests.count { it == "/v1/native/tournaments" } })
    }

    @Test
    fun organizerCanReachEveryControlOnTheNoActiveTournamentScreen() {
        val client = AndroidTournamentClient(
            origin = "https://example.invalid",
            session = AndroidAuthenticatedNativeSession(
                bearerToken = "tournament-device-empty-token",
                expiresAtMs = 1_800_000_000_000,
                playerId = "player.ben",
            ),
            opener = AndroidTournamentConnectionOpener { url ->
                val response = when (url.path) {
                    "/v1/native/tournament-directors" -> """{"schemaVersion":"mk8dx.native-tournament-directors.v1","canActForOthers":true,"directors":[{"userAccountId":"user_account.ben","displayName":"Ben","isAdministrator":true},{"userAccountId":"user_account.evan","displayName":"Evan","isAdministrator":false}]}"""
                    "/v1/native/tournaments" ->
                        """{"schemaVersion":"mk8dx.native-tournaments.v1","tournaments":[]}"""
                    else -> error("Unexpected empty-list path: ${url.path}")
                }
                TournamentScreenFakeConnection(url, response)
            },
        )

        compose.setContent {
            MaterialTheme { AndroidTournamentConsole(client = client, onSignIn = {}) }
        }
        confirmDirector()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-start-step").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("New tournament").assertIsDisplayed()
        compose.onNodeWithTag("tournament-start-name").assertIsDisplayed()
        compose.onNodeWithTag("tournament-start-create").assertIsDisplayed()
        compose.onNodeWithText("No tournaments available").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("tournament-start-menu").assertIsDisplayed()
    }

    @Test
    fun emptyStepTwoDraftAutomaticallyRestoresHistoricalPlayersAsHiddenInactiveAbsentees() {
        var reconciled = false
        val requests = mutableListOf<String>()
        fun summaryJson(): String =
            """{"tournamentId":"tournament.empty_roster","name":"Empty roster","stage":"setup","workflowStep":2,"qualifierRounds":true,"maxParticipants":32,"revision":${if (reconciled) 2 else 1},"participantCount":${if (reconciled) 1 else 0},"presentCount":0,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000000}"""
        fun documentJson(): String {
            val players = if (reconciled) {
                """[{"playerId":"player.old","username":"old_racer","displayName":"Old Racer","attendance":"absent","hasSwitch1":false,"hasSwitch2":false,"inactive":true}]"""
            } else "[]"
            return """{"schemaVersion":"mk8dx.tournament-operation.v1","summary":${summaryJson()},"participants":$players,"stations":[],"groups":[],"overall":[],"lifecycle":[]}"""
        }
        val client = AndroidTournamentClient(
            origin = "https://example.invalid",
            session = AndroidAuthenticatedNativeSession(
                bearerToken = "tournament-device-history-token",
                expiresAtMs = 1_800_000_000_000,
                playerId = "player.ben",
            ),
            opener = AndroidTournamentConnectionOpener { url ->
                synchronized(requests) { requests += url.path }
                val response = when (url.path) {
                    "/v1/native/tournament-directors" -> """{"schemaVersion":"mk8dx.native-tournament-directors.v1","canActForOthers":true,"directors":[{"userAccountId":"user_account.ben","displayName":"Ben","isAdministrator":true},{"userAccountId":"user_account.evan","displayName":"Evan","isAdministrator":false}]}"""
                    "/v1/native/tournaments" ->
                        """{"schemaVersion":"mk8dx.native-tournaments.v1","tournaments":[${summaryJson()}]}"""
                    "/v1/native/tournaments/tournament.empty_roster" -> documentJson()
                    "/v1/native/tournaments/tournament.empty_roster/incoming-results" ->
                        """{"schemaVersion":"mk8dx.native-tournament-incoming.v1","results":[]}"""
                    "/v1/native/tournaments/tournament.empty_roster/participants/actions/add-historical" -> {
                        reconciled = true
                        documentJson()
                    }
                    else -> error("Unexpected history-restoration path: ${url.path}")
                }
                TournamentScreenFakeConnection(url, response)
            },
        )

        compose.setContent {
            MaterialTheme { AndroidTournamentConsole(client = client, onSignIn = {}) }
        }
        loadFirstTournament()
        compose.waitUntil(5_000) {
            synchronized(requests) {
                requests.contains("/v1/native/tournaments/tournament.empty_roster/participants/actions/add-historical")
            }
        }
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText("Absent 1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onAllNodesWithText("Old Racer").assertCountEquals(0)
        compose.onNodeWithTag("tournament-participants-hide-inactive")
            .performScrollTo().assertIsDisplayed().performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText("Old Racer").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Old Racer").assertIsDisplayed()
    }

    @Test
    fun organizerCanCompleteTheManualTournamentWorkflowFromStartToFinish() {
        var step = 2
        var revision = 2
        var qualifierScored = false
        var finalScored = false
        var finalized = false

        fun summaryJson(): String {
            val stage = when {
                finalized -> "finalized"
                step >= 7 -> "finals"
                step >= 3 -> "qualifiers"
                else -> "setup"
            }
            return """{"tournamentId":"tournament.manual_flow","name":"Manual Flow","stage":"$stage","workflowStep":$step,"qualifierRounds":true,"maxParticipants":12,"revision":$revision,"participantCount":2,"presentCount":2,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000000}"""
        }

        fun groupJson(stage: String, scored: Boolean, locked: Boolean): String {
            val id = if (stage == "qualifier") "tournament_group.qualifier_manual" else "tournament_group.final_manual"
            val name = if (stage == "qualifier") "Qualifier A" else "Final A"
            val manualScores = if (scored) {
                """[{"playerId":"player.ben","segmentPoints":[18,12]},{"playerId":"player.evan","segmentPoints":[14,11]}]"""
            } else "[]"
            val rows = if (scored) {
                """[{"rank":1,"playerId":"player.ben","displayName":"Ben","points":30,"races":0,"wins":0,"bestRace":0,"complete":true},{"rank":2,"playerId":"player.evan","displayName":"Evan","points":25,"races":0,"wins":0,"bestRace":0,"complete":true}]"""
            } else "[]"
            return """{"groupId":"$id","stage":"$stage","sequence":1,"name":"$name","locked":$locked,"manualScoreSegments":${if (scored) 2 else 1},"members":[{"playerId":"player.ben","displayName":"Ben","seatOrder":1,"station":{"ownerPlayerId":"player.ben","ownerDisplayName":"Ben","switchType":"ns1","seatNumber":1}},{"playerId":"player.evan","displayName":"Evan","seatOrder":2,"station":{"ownerPlayerId":"player.ben","ownerDisplayName":"Ben","switchType":"ns1","seatNumber":2}}],"races":[],"manualScores":$manualScores,"standings":{"source":"manual","rows":$rows}}"""
        }

        fun documentJson(): String {
            val groups = buildList {
                if (step >= 3) add(groupJson("qualifier", qualifierScored, step >= 4))
                if (step >= 7) add(groupJson("final", finalScored, step >= 8))
            }.joinToString(",")
            return """{"schemaVersion":"mk8dx.tournament-operation.v1","summary":${summaryJson()},"participants":[{"playerId":"player.ben","username":"ben","displayName":"Ben","attendance":"present","hasSwitch1":true,"hasSwitch2":false,"inactive":false},{"playerId":"player.evan","username":"evan","displayName":"Evan","attendance":"present","hasSwitch1":false,"hasSwitch2":false,"inactive":false}],"stations":[{"ownerPlayerId":"player.ben","ownerDisplayName":"Ben","switchType":"ns1"}],"groups":[$groups],"overall":[],"lifecycle":[]}"""
        }

        val requests = mutableListOf<String>()
        val client = AndroidTournamentClient(
            origin = "https://example.invalid",
            session = AndroidAuthenticatedNativeSession(
                bearerToken = "tournament-device-full-flow-token",
                expiresAtMs = 1_800_000_000_000,
                playerId = "player.ben",
            ),
            opener = AndroidTournamentConnectionOpener { url ->
                synchronized(requests) { requests += url.path }
                val response = when (url.path) {
                    "/v1/native/tournament-directors" -> """{"schemaVersion":"mk8dx.native-tournament-directors.v1","canActForOthers":true,"directors":[{"userAccountId":"user_account.ben","displayName":"Ben","isAdministrator":true},{"userAccountId":"user_account.evan","displayName":"Evan","isAdministrator":false}]}"""
                    "/v1/native/tournaments" ->
                        """{"schemaVersion":"mk8dx.native-tournaments.v1","tournaments":[${summaryJson()}]}"""
                    "/v1/native/tournaments/tournament.manual_flow" -> documentJson()
                    "/v1/native/tournaments/tournament.manual_flow/incoming-results" ->
                        """{"schemaVersion":"mk8dx.native-tournament-incoming.v1","results":[]}"""
                    "/v1/native/tournaments/tournament.manual_flow/actions/generate-groups" -> {
                        step = if (step == 2) 3 else 7
                        revision += 1
                        documentJson()
                    }
                    "/v1/native/tournaments/tournament.manual_flow/actions/lock-groups" -> {
                        step = if (step == 3) 4 else 8
                        revision += 1
                        documentJson()
                    }
                    "/v1/native/tournaments/tournament.manual_flow/actions/advance-current-step" -> {
                        step = when (step) { 4 -> 5; 5 -> 6; 8 -> 9; 9 -> 10; else -> error("Unexpected workflow step $step") }
                        revision += 1
                        documentJson()
                    }
                    "/v1/native/tournaments/tournament.manual_flow/manual-scores" -> {
                        if (step == 5) qualifierScored = true else finalScored = true
                        revision += 1
                        documentJson()
                    }
                    "/v1/native/tournaments/tournament.manual_flow/actions/finalize" -> {
                        finalized = true
                        revision += 1
                        documentJson()
                    }
                    else -> error("Unexpected full-flow path: ${url.path}")
                }
                TournamentScreenFakeConnection(url, response)
            },
        )

        compose.setContent {
            MaterialTheme { AndroidTournamentConsole(client = client, onSignIn = {}) }
        }

        fun waitForStep(value: Int) {
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("STEP $value OF 10").fetchSemanticsNodes().isNotEmpty()
            }
        }
        fun clickWorkflowAction(label: String) {
            compose.onNodeWithTag("tournament-mobile-content").performScrollToNode(hasText(label))
            compose.onNodeWithText(label).assertIsDisplayed().performClick()
        }
        fun enterAndSaveScores(groupId: String) {
            // Step 5 and Step 9 are now the source-faithful score screens.
            compose.waitUntil(5_000) {
                compose.onAllNodesWithTag("tournament-score-entry-step").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("tournament-score-entry-step")
                .performScrollToNode(hasTestTag("tournament-score-errors-$groupId-1"))
            compose.onNodeWithTag("tournament-score-errors-$groupId-1").performClick()
            val entries = listOf(
                "tournament-score-$groupId-player.ben-1" to "18",
                "tournament-score-$groupId-player.ben-2" to "12",
                "tournament-score-$groupId-player.evan-1" to "14",
                "tournament-score-$groupId-player.evan-2" to "11",
            )
            entries.forEach { (tag, score) ->
                compose.onNodeWithTag("tournament-score-entry-step").performScrollToNode(hasTestTag(tag))
                compose.onNodeWithTag(tag).performTextInput(score)
            }
            compose.onNodeWithTag("tournament-score-entry-step")
                .performScrollToNode(hasTestTag("tournament-save-scores-$groupId"))
            compose.onNodeWithTag("tournament-save-scores-$groupId").performClick()
        }

        loadFirstTournament()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-participants-seed").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("tournament-participants-seed").performScrollTo().performClick()
        // Step 3 is now the source-faithful layout board, which carries the
        // source phase marker instead of the removed workbench header.
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-group-draft-step").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("tournament-group-draft-step")
            .performScrollToNode(hasTestTag("tournament-group-draft-confirm"))
        compose.onNodeWithTag("tournament-group-draft-confirm").performClick()
        // Step 4 is now the source-faithful layout export.
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-layout-export-step").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("tournament-layout-export-step")
            .performScrollToNode(hasTestTag("tournament-layout-export-continue"))
        compose.onNodeWithTag("tournament-layout-export-continue").performClick()
        enterAndSaveScores("tournament_group.qualifier_manual")
        compose.waitUntil(5_000) { qualifierScored }
        compose.onNodeWithTag("tournament-score-entry-step")
            .performScrollToNode(hasTestTag("tournament-score-entry-continue"))
        compose.onNodeWithTag("tournament-score-entry-continue").performClick()
        // Step 6 is now the source-faithful results export.
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-results-export-step").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Step 6: Qualifier result export").assertIsDisplayed()
        compose.onNodeWithTag("tournament-results-export-step")
            .performScrollToNode(hasTestTag("tournament-results-export-continue"))
        compose.onNodeWithTag("tournament-results-export-continue").performClick()
        // Step 7 is now the source-faithful board for the final groups.
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-group-draft-step").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("tournament-group-draft-step").performScrollToNode(hasText("Final A"))
        compose.onNodeWithText("Final A").assertIsDisplayed()
        compose.onAllNodesWithText("Qualifier A").assertCountEquals(0)
        compose.onNodeWithTag("tournament-group-draft-step")
            .performScrollToNode(hasTestTag("tournament-group-draft-confirm"))
        compose.onNodeWithTag("tournament-group-draft-confirm").performClick()
        // Step 8 is now the source-faithful export for the final layout.
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-layout-export-step").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("tournament-layout-export-step")
            .performScrollToNode(hasTestTag("tournament-layout-export-continue"))
        compose.onNodeWithTag("tournament-layout-export-continue").performClick()
        enterAndSaveScores("tournament_group.final_manual")
        compose.waitUntil(5_000) { finalScored }
        compose.onNodeWithTag("tournament-score-entry-step")
            .performScrollToNode(hasTestTag("tournament-score-entry-continue"))
        compose.onNodeWithTag("tournament-score-entry-continue").performClick()
        // Step 10 is now the source results export with finalization mounted in it.
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-results-export-step").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Step 10: Final group results export").assertIsDisplayed()
        compose.onNodeWithTag("tournament-results-export-step")
            .performScrollToNode(hasText("Review finalization"))
        compose.onNodeWithText("Review finalization").assertIsDisplayed().performClick()
        compose.onNodeWithTag("tournament-results-export-step")
            .performScrollToNode(hasTestTag("tournament-finalize"))
        compose.onNodeWithTag("tournament-finalize").performClick()
        compose.waitUntil(5_000) { finalized }
        assertEquals(true, synchronized(requests) { requests.contains("/v1/native/tournaments/tournament.manual_flow/actions/finalize") })
    }

    /**
     * ADR-0176/0177: the screen now always opens on Step 0. Device scenarios
     * walk the same numbered route an operator does before asserting anything
     * about a mounted Tournament.
     */
    private fun confirmDirector() {
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-director-select").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("tournament-director-select").performClick()
        compose.onNodeWithText("Ben", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("tournament-director-continue").performClick()
    }

    private fun loadFirstTournament() {
        confirmDirector()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-start-load").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("tournament-start-load").performScrollTo().performClick()
    }

    private fun responseFor(path: String): String = when (path) {
        "/v1/native/tournaments" ->
            """{"schemaVersion":"mk8dx.native-tournaments.v1","tournaments":[${summary()}]}"""
        "/v1/native/tournaments/tournament.demo" -> document()
        "/v1/native/tournaments/tournament.demo/incoming-results" -> incoming()
        "/v1/native/tournaments/tournament.demo/evidence-records" ->
            """{"schemaVersion":"mk8dx.native-tournament-evidence-records.v1","records":[]}"""
        "/v1/native/tournament-directors" ->
            """{"schemaVersion":"mk8dx.native-tournament-directors.v1","canActForOthers":true,"directors":[{"userAccountId":"user_account.ben","displayName":"Ben","isAdministrator":true},{"userAccountId":"user_account.evan","displayName":"Evan","isAdministrator":false}]}"""
        else -> error("Unexpected Tournament device-test path: $path")
    }

    private fun summary(): String =
        """{"tournamentId":"tournament.demo","name":"Community Cup","stage":"qualifiers","workflowStep":5,"qualifierRounds":true,"maxParticipants":32,"revision":7,"participantCount":3,"presentCount":2,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000000}"""

    private fun document(): String =
        """{"schemaVersion":"mk8dx.tournament-operation.v1","summary":${summary()},"participants":[{"playerId":"player.ben","username":"ben","displayName":"Ben","attendance":"present","hasSwitch1":true,"hasSwitch2":false,"inactive":false},{"playerId":"player.alex","username":"alex","displayName":"Alex","attendance":"present","hasSwitch1":false,"hasSwitch2":false,"inactive":false},{"playerId":"player.old","username":"old_racer","displayName":"Old Racer","attendance":"absent","hasSwitch1":false,"hasSwitch2":false,"inactive":true}],"stations":[{"ownerPlayerId":"player.ben","ownerDisplayName":"Ben","switchType":"ns1"}],"groups":[{"groupId":"tournament_group.synthetic_group_a","stage":"qualifier","sequence":1,"name":"Group A","locked":true,"manualScoreSegments":1,"members":[{"playerId":"player.ben","displayName":"Ben","seatOrder":1,"station":{"ownerPlayerId":"player.ben","ownerDisplayName":"Ben","switchType":"ns1","seatNumber":1}},{"playerId":"player.alex","displayName":"Alex","seatOrder":2,"station":{"ownerPlayerId":"player.ben","ownerDisplayName":"Ben","switchType":"ns1","seatNumber":2}}],"races":[],"manualScores":[],"standings":{"source":"races","rows":[{"rank":1,"playerId":"player.ben","displayName":"Ben","points":15,"races":1,"wins":1,"bestRace":1,"complete":false}]}}],"overall":[{"placement":1,"playerId":"player.ben","displayName":"Ben","groupName":"Group A","groupRank":1,"points":15}],"lifecycle":[]}"""

    private fun incoming(): String =
        """{"schemaVersion":"mk8dx.native-tournament-incoming.v1","results":[{"incomingResultId":"incoming.demo","tournamentId":"tournament.demo","sourceKind":"tournament_live","status":"pending","revision":1,"result":{"trackId":"track.mario_kart_stadium","raceNumber":1,"placements":[{"finishPosition":1,"participantReference":{"namespace":"player","value":"player.ben"}},{"finishPosition":2,"participantReference":{"namespace":"player","value":"player.alex"}}]},"suggestedGroupId":"group.a","suggestedRaceNumber":1,"duplicateWarning":false,"createdAtMs":1787420000100}]}"""
}

private class TournamentScreenFakeConnection(
    url: URL,
    responseBody: String,
) : HttpsURLConnection(url) {
    private val response = responseBody.toByteArray()

    override fun connect() = Unit
    override fun disconnect() = Unit
    override fun usingProxy(): Boolean = false
    override fun getCipherSuite(): String = "TLS_SYNTHETIC"
    override fun getLocalCertificates(): Array<Certificate>? = null
    override fun getServerCertificates(): Array<Certificate> = emptyArray()
    override fun getResponseCode(): Int = 200
    override fun getInputStream(): InputStream = ByteArrayInputStream(response)
    override fun getOutputStream(): OutputStream = ByteArrayOutputStream()
}
