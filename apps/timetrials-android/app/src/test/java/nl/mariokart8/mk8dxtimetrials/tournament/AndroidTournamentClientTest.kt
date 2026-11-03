package nl.mariokart8.mk8dxtimetrials.tournament

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTournamentClientTest {
    private val session = AndroidAuthenticatedNativeSession(
        bearerToken = "token-for-native-tournament-tests",
        expiresAtMs = 1_800_000_000_000,
        playerId = "player.ben",
    )

    @Test
    fun listUsesExactNativePathBearerAndParsesSummary() {
        var opened: URL? = null
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments"),
            responseBody = """{"schemaVersion":"mk8dx.native-tournaments.v1","tournaments":[{"tournamentId":"tournament.demo","name":"Community Cup","stage":"qualification","revision":7,"participantCount":12,"presentCount":10,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000000}]}""",
        )
        val client = AndroidTournamentClient(
            "https://example.invalid",
            session,
            AndroidTournamentConnectionOpener { url -> opened = url; connection },
        )

        val summary = client.list().single()

        assertEquals("https://example.invalid/v1/native/tournaments", opened.toString())
        assertEquals("GET", connection.requestMethod)
        assertEquals("Bearer ${session.bearerToken}", connection.getRequestProperty("Authorization"))
        assertEquals("Community Cup", summary.name)
        assertEquals(10, summary.presentCount)
        assertTrue(connection.disconnected)
    }

    @Test
    fun summaryDecodesTheNightRatingOptions() {
        val withOptions = """{"schemaVersion":"mk8dx.native-tournaments.v1","tournaments":[{"tournamentId":"tournament.demo","name":"Cup","stage":"setup","seedingSource":"director_nights","verifiedOnly":true,"revision":7,"participantCount":0,"presentCount":0,"publicResults":false,"affectsRating":true,"updatedAtMs":1787420000000}]}"""
        val random = """{"schemaVersion":"mk8dx.native-tournaments.v1","tournaments":[{"tournamentId":"tournament.demo","name":"Cup","stage":"setup","seedingSource":"random","verifiedOnly":false,"revision":7,"participantCount":0,"presentCount":0,"publicResults":false,"affectsRating":true,"updatedAtMs":1787420000000}]}"""
        fun first(body: String) = AndroidTournamentClient(
            "https://example.invalid", session,
            AndroidTournamentConnectionOpener { TournamentFakeHttpsConnection(URL("https://example.invalid/v1/native/tournaments"), responseBody = body) },
        ).list().single()

        val current = first(withOptions)
        assertEquals("director_nights", current.effectiveSeedingSource)
        assertTrue(current.verifiedOnly)
        val drawn = first(random)
        assertEquals("random", drawn.effectiveSeedingSource)
        assertEquals(false, drawn.verifiedOnly)
        assertEquals("community_rating", drawn.copy(seedingSource = "unknown").effectiveSeedingSource)
    }

    @Test
    fun updateSettingsSendsTheSeedingSourceAndVerifiedOnly() {
        val document = """{"schemaVersion":"mk8dx.tournament-operation.v1","summary":{"tournamentId":"tournament.demo","name":"Cup","stage":"setup","revision":8,"participantCount":0,"presentCount":0,"publicResults":false,"affectsRating":true,"updatedAtMs":1787420000001},"participants":[],"stations":[],"groups":[],"overall":[],"lifecycle":[]}"""
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments/tournament.demo/actions/update-settings"),
            responseBody = document,
        )
        val client = AndroidTournamentClient("https://example.invalid", session, AndroidTournamentConnectionOpener { connection })

        client.updateSettings(
            "tournament.demo", 7, "manual", "balanced", "owner_strict", null,
            verifiedOnly = true,
        )

        assertEquals(
            """{"expectedRevision":7,"seedingSource":"manual","verifiedOnly":true,"placementStrategy":"balanced","ownerSeatingMode":"owner_strict","maxParticipants":null}""",
            connection.writtenBody(),
        )
        val random = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments/tournament.demo/actions/update-settings"),
            responseBody = document,
        )
        AndroidTournamentClient("https://example.invalid", session, AndroidTournamentConnectionOpener { random })
            .updateSettings("tournament.demo", 7, "random", "balanced", "owner_strict", 36)
        assertTrue(random.writtenBody().contains(""""seedingSource":"random""""))
        assertFalse(random.writtenBody().contains("seedOrder"))
    }

    @Test
    fun installationSettingsDecodeWithSafeDefaults() {
        var opened: URL? = null
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/installation-settings"),
            responseBody = """{"schemaVersion":"mk8dx.installation-settings.v1","playerCreation":"self_only","ratingEligibility":"claimed_only"}""",
        )
        val settings = AndroidTournamentClient(
            "https://example.invalid", null, AndroidTournamentConnectionOpener { url -> opened = url; connection },
        ).installationSettings()
        assertEquals("https://example.invalid/v1/installation-settings", opened.toString())
        assertEquals("self_only", settings.playerCreation)
        assertEquals("claimed_only", settings.ratingEligibility)
        assertEquals(false, settings.directorsMayCreatePlayers)

        val unknown = AndroidInstallationSettings.decode(
            """{"schemaVersion":"mk8dx.installation-settings.v1","playerCreation":"everybody_else","ratingEligibility":"martians"}""",
        )
        assertEquals(AndroidInstallationSettings.DEFAULTS, unknown)
        assertTrue(unknown.directorsMayCreatePlayers)
        assertThrows(AndroidTournamentClientException::class.java) {
            AndroidInstallationSettings.decode("""{"schemaVersion":"mk8dx.other.v1"}""")
        }
    }

    @Test
    fun rosterCreationRefusedByTheInstallationCarriesItsCode() {
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/roster-players"),
            statusCode = 403,
            errorBody = """{"code":"player_creation_directors_disabled","message":"On this site, Players create themselves."}""",
        )
        val failure = AndroidTournamentClient("https://example.invalid", session, AndroidTournamentConnectionOpener { connection })
            .createRosterPlayers(listOf(2 to "Mal")).exceptionOrNull()
        assertTrue(androidPlayerCreationRefused(requireNotNull(failure)))
        assertEquals(
            "On this site Players create themselves when they sign up. Ask the person to sign up, then add their Player.",
            androidTournamentMutationError(failure, nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage.ENGLISH),
        )
    }

    @Test
    fun publicArchivePlacementsUseOneBoundedRequest() {
        var opened: URL? = null
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/public/tournament-placements?ids=tournament.demo01,tournament.demo02"),
            responseBody = """{"schemaVersion":"mk8dx.public-tournament-placements.v1","tournaments":[{"tournamentId":"tournament.demo01","fieldSize":24,"placements":[{"playerId":"player.ben","placement":3}]}]}""",
        )
        val client = AndroidTournamentClient(
            "https://example.invalid", session,
            AndroidTournamentConnectionOpener { url -> opened = url; connection },
        )

        val snapshot = client.loadPublicPlacements(listOf("tournament.demo01", "tournament.demo02")).single()

        assertEquals(
            "https://example.invalid/v1/public/tournament-placements?ids=tournament.demo01,tournament.demo02",
            opened.toString(),
        )
        assertEquals(24, snapshot.fieldSize)
        assertEquals(3, snapshot.placements.single().placement)
        assertTrue(connection.disconnected)
    }

    @Test
    fun participantUpdateSendsOptimisticRevisionAndServerOwnedIdentity() {
        val document = """{"schemaVersion":"mk8dx.tournament-operation.v1","summary":{"tournamentId":"tournament.demo","name":"Community Cup","stage":"qualification","revision":8,"participantCount":1,"presentCount":1,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000001},"participants":[],"stations":[],"groups":[],"overall":[],"lifecycle":[]}"""
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments/tournament.demo/participants"),
            responseBody = document,
        )
        val client = AndroidTournamentClient(
            "https://example.invalid/",
            session,
            AndroidTournamentConnectionOpener { connection },
        )

        val updated = client.updateParticipant(
            "tournament.demo",
            revision = 7,
            participant = AndroidTournamentParticipant(
                playerId = "player.ben",
                username = "ben",
                displayName = "Ben",
                attendance = "registered",
                hasSwitch1 = false,
                hasSwitch2 = false,
            ),
            attendance = "present",
            hasSwitch1 = true,
        )

        assertEquals("POST", connection.requestMethod)
        assertEquals(8, updated.summary.revision)
        assertEquals(
            """{"expectedRevision":7,"playerId":"player.ben","attendance":"present","hasSwitch1":true,"hasSwitch2":false}""",
            connection.writtenBody(),
        )
        assertTrue(connection.disconnected)
    }

    @Test
    fun rosterImportSendsEveryRowInOneRequest() {
        val document = """{"schemaVersion":"mk8dx.tournament-operation.v1","summary":{"tournamentId":"tournament.demo","name":"Community Cup","stage":"qualification","revision":9,"participantCount":2,"presentCount":2,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000002},"participants":[],"stations":[],"groups":[],"overall":[],"lifecycle":[]}"""
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments/tournament.demo/participants/actions/import"),
            responseBody = document,
        )
        var opened: URL? = null
        val client = AndroidTournamentClient(
            "https://example.invalid",
            session,
            AndroidTournamentConnectionOpener { url -> opened = url; connection },
        )

        val imported = client.importParticipants(
            "tournament.demo",
            revision = 8,
            rows = listOf(
                AndroidParticipantImportRow("player.ben", attendance = "present", hasSwitch1 = true, hasSwitch2 = false),
                AndroidParticipantImportRow("player.evan", attendance = "absent"),
            ),
        )

        assertEquals("https://example.invalid/v1/native/tournaments/tournament.demo/participants/actions/import", opened.toString())
        assertEquals("POST", connection.requestMethod)
        assertEquals(9, imported.summary.revision)
        assertEquals(
            """{"expectedRevision":8,"rows":[{"playerId":"player.ben","attendance":"present","hasSwitch1":true,"hasSwitch2":false},{"playerId":"player.evan","attendance":"absent"}]}""",
            connection.writtenBody(),
        )
        assertTrue(connection.disconnected)
    }

    @Test
    fun createAndFinalizationUseTheCompleteNativeWorkflow() {
        val summary = """{"tournamentId":"tournament.demo","name":"Community Cup","stage":"draft","revision":1,"participantCount":0,"presentCount":0,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000001}"""
        val createConnection = TournamentFakeHttpsConnection(URL("https://example.invalid/v1/native/tournaments"), responseBody = summary)
        val created = AndroidTournamentClient("https://example.invalid", session, AndroidTournamentConnectionOpener { createConnection }).create("Community Cup", "2026-08-27", "19:30")
        assertEquals("Community Cup", created.name)
        assertTrue(createConnection.writtenBody().contains("\"name\":\"Community Cup\""))
        assertTrue(createConnection.writtenBody().contains("\"eventDate\":\"2026-08-27\""))
        assertTrue(createConnection.writtenBody().contains("\"qualifierRounds\":true"))

        val document = """{"schemaVersion":"mk8dx.tournament-operation.v1","summary":{"tournamentId":"tournament.demo","name":"Community Cup","stage":"finalized","revision":9,"participantCount":2,"presentCount":2,"publicResults":true,"affectsRating":false,"updatedAtMs":1787420000002},"participants":[],"stations":[],"groups":[],"overall":[],"lifecycle":[]}"""
        val finalizeConnection = TournamentFakeHttpsConnection(URL("https://example.invalid/v1/native/tournaments/tournament.demo/actions/finalize"), responseBody = document)
        val finalized = AndroidTournamentClient("https://example.invalid", session, AndroidTournamentConnectionOpener { finalizeConnection }).finalize("tournament.demo", 8, true, false)
        assertEquals("finalized", finalized.summary.stage)
        assertEquals("""{"expectedRevision":8,"publicResults":true,"affectsRating":false,"reasonCode":"android_operator_finalization"}""", finalizeConnection.writtenBody())
    }

    @Test
    fun deleteDraftUsesTheProtectedNativeRouteAndOptimisticRevision() {
        var opened: URL? = null
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments/tournament.demo/actions/delete"),
            responseBody = """{"deleted":true}""",
        )
        val client = AndroidTournamentClient(
            "https://example.invalid",
            session,
            AndroidTournamentConnectionOpener { url -> opened = url; connection },
        )

        client.deleteDraft("tournament.demo", 7)

        assertEquals("https://example.invalid/v1/native/tournaments/tournament.demo/actions/delete", opened.toString())
        assertEquals("POST", connection.requestMethod)
        assertEquals("""{"expectedRevision":7}""", connection.writtenBody())
        assertTrue(connection.disconnected)
    }

    @Test
    fun guidedWorkflowPlayerDirectoryAndManualScoresUseCanonicalRoutes() {
        val document = """{"schemaVersion":"mk8dx.tournament-operation.v1","summary":{"tournamentId":"tournament.demo","name":"Community Cup","stage":"qualifiers","workflowStep":5,"qualifierRounds":true,"maxParticipants":32,"revision":9,"participantCount":2,"presentCount":2,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000002},"participants":[],"stations":[],"groups":[],"overall":[],"lifecycle":[]}"""
        val connections = ArrayDeque(
            listOf(
                TournamentFakeHttpsConnection(
                    URL("https://example.invalid/v1/player-directory"),
                    responseBody = """{"schemaVersion":"mk8dx.player-directory.v1","players":[{"playerId":"player.ben","username":"ben","displayName":"Ben"},{"playerId":"player.floyd","username":"floyd","displayName":"Floyd"}]}""",
                ),
                TournamentFakeHttpsConnection(
                    URL("https://example.invalid/v1/native/tournaments/tournament.demo/participants/actions/add-historical"),
                    responseBody = document,
                ),
                TournamentFakeHttpsConnection(
                    URL("https://example.invalid/v1/native/tournaments/tournament.demo/participants/actions/add-recent"),
                    responseBody = document,
                ),
                TournamentFakeHttpsConnection(
                    URL("https://example.invalid/v1/native/tournaments/tournament.demo/actions/advance-current-step"),
                    responseBody = document,
                ),
                TournamentFakeHttpsConnection(
                    URL("https://example.invalid/v1/native/tournaments/tournament.demo/manual-scores"),
                    responseBody = document,
                ),
            ),
        )
        val client = AndroidTournamentClient(
            "https://example.invalid", session,
            AndroidTournamentConnectionOpener { connections.removeFirst() },
        )

        assertEquals(listOf("Ben", "Floyd"), client.listPlayers().map { it.displayName })
        assertEquals(5, client.addHistoricalParticipants("tournament.demo", 8).summary.workflowStep)
        assertEquals(5, client.addRecentParticipants("tournament.demo", 8).summary.workflowStep)
        assertEquals(5, client.setWorkflowStep("tournament.demo", 8, 5, direction = "advance").summary.workflowStep)
        assertEquals(
            9,
            client.setManualScores(
                "tournament.demo", 8, "tournament_group.synthetic_1", 2,
                mapOf("player.ben" to listOf(48, 52), "player.floyd" to listOf(40, null)),
            ).summary.revision,
        )
    }

    @Test
    fun phaseTieBreakModeAndManualOrderUseCanonicalNativeRoutes() {
        val document = """{"schemaVersion":"mk8dx.tournament-operation.v1","summary":{"tournamentId":"tournament.demo","name":"Community Cup","stage":"qualifiers","workflowStep":5,"qualifierRounds":true,"qualifierTieBreakMode":"manual","finalTieBreakMode":"lottery","revision":10,"participantCount":2,"presentCount":2,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000002},"participants":[],"stations":[],"groups":[],"overall":[],"lifecycle":[]}"""
        val modeConnection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments/tournament.demo/actions/update-settings"),
            responseBody = document,
        )
        val orderConnection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments/tournament.demo/tie-breaks"),
            responseBody = document,
        )
        val connections = ArrayDeque(listOf(modeConnection, orderConnection))
        val client = AndroidTournamentClient(
            "https://example.invalid", session,
            AndroidTournamentConnectionOpener { connections.removeFirst() },
        )

        val updated = client.updateTieBreakMode("tournament.demo", 9, "qualifier", "manual")
        assertEquals("manual", updated.summary.qualifierTieBreakMode)
        assertEquals("lottery", updated.summary.finalTieBreakMode)
        assertEquals("""{"expectedRevision":9,"qualifierTieBreakMode":"manual"}""", modeConnection.writtenBody())

        client.setTieBreakOrder(
            "tournament.demo", 9, "tournament_group.synthetic_1", 42,
            listOf("player.floyd", "player.ben"),
        )
        assertEquals(
            """{"expectedRevision":9,"groupId":"tournament_group.synthetic_1","points":42,"playerIds":["player.floyd","player.ben"]}""",
            orderConnection.writtenBody(),
        )
    }

    @Test
    fun groupMoveSupportsCanonicalParkingAndNativeOptimisticWrite() {
        fun group(id: String, playerId: String) = AndroidTournamentGroup(
            groupId = id,
            stage = "qualifier",
            sequence = if (id.endsWith("1")) 1 else 2,
            name = id,
            locked = false,
            manualScoreSegments = 1,
            members = listOf(AndroidTournamentMember(playerId, playerId, 1)),
            races = emptyList(),
            manualScores = emptyList(),
            standings = AndroidTournamentStandings("none", emptyList()),
        )
        val groups = listOf(group("tournament_group.synthetic_1", "player.alpha"), group("tournament_group.synthetic_2", "player.bravo"))
        val moved = tournamentGroupsAfterMove(groups, "qualifier", "player.alpha", groups[1].groupId)
        assertEquals(emptyList<String>(), moved[0].members)
        assertEquals(listOf("player.bravo", "player.alpha"), moved[1].members)
        assertEquals(emptyList<String>(), tournamentGroupsAfterMove(groups, "qualifier", "player.alpha", null)[0].members)

        val finalGroups = groups.map { it.copy(stage = "final") }
        val swapped = tournamentGroupsAfterSwap(
            finalGroups, "final", "player.alpha", "player.bravo",
        )
        assertEquals(listOf("player.bravo"), swapped[0].members)
        assertEquals(listOf("player.alpha"), swapped[1].members)

        val document = """{"schemaVersion":"mk8dx.tournament-operation.v1","summary":{"tournamentId":"tournament.demo","name":"Community Cup","stage":"qualifiers","revision":9,"participantCount":2,"presentCount":2,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000002},"participants":[],"stations":[],"groups":[],"overall":[],"lifecycle":[]}"""
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments/tournament.demo/groups"),
            responseBody = document,
        )
        val client = AndroidTournamentClient(
            "https://example.invalid",
            session,
            AndroidTournamentConnectionOpener { connection },
        )

        val updated = client.updateGroups("tournament.demo", 8, "qualifier", moved)

        assertEquals(9, updated.summary.revision)
        assertEquals(
            """{"expectedRevision":8,"stage":"qualifier","groups":[{"groupId":"tournament_group.synthetic_1","members":[]},{"groupId":"tournament_group.synthetic_2","members":["player.bravo","player.alpha"]}]}""",
            connection.writtenBody(),
        )
    }

    @Test
    fun invalidOriginAndTypedServerFailureFailClosed() {
        assertThrows(IllegalArgumentException::class.java) {
            AndroidTournamentClient(
                "http://example.invalid",
                session,
                AndroidTournamentConnectionOpener { error("must not open") },
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            AndroidTournamentClient(
                "https://operator@example.invalid",
                session,
                AndroidTournamentConnectionOpener { error("must not open") },
            )
        }
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments"),
            statusCode = 409,
            errorBody = """{"code":"revision_conflict","message":"Tournament changed; refresh first."}""",
        )
        val client = AndroidTournamentClient(
            "https://example.invalid",
            session,
            AndroidTournamentConnectionOpener { connection },
        )

        val failure = assertThrows(AndroidTournamentClientException::class.java) { client.list() }

        assertEquals(409, failure.statusCode)
        assertEquals("Tournament changed; refresh first.", failure.message)
        assertTrue(connection.disconnected)
    }

    @Test
    fun publicLiveGroupsKeepObservedNamesAndTotalWithoutPlayerResolution() {
        var opened: URL? = null
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/public/tournaments/tournament.demo/live-standings"),
            responseBody = """{"schemaVersion":"mk8dx.public-tournament-live-groups.v1","groups":[{"recordId":"record.live","groupId":"group.one","phase":"qualifier","status":"live","streamRevision":3,"countedRaces":1,"receivedRaces":2,"lastReceivedAtMs":123,"controlPoints":["1 excluded race"],"standings":[{"rank":1,"observedPlayerName":"BEN★","total":35,"participantReference":{"namespace":"producer_local_player","value":"local.ben"}}]}]}""",
        )
        val client = AndroidTournamentClient(
            "https://example.invalid", session,
            AndroidTournamentConnectionOpener { url -> opened = url; connection },
        )

        val group = client.publicLiveGroups("tournament.demo").single()

        assertEquals("https://example.invalid/v1/public/tournaments/tournament.demo/live-standings", opened.toString())
        assertEquals("BEN★", group.standings.single().observedPlayerName)
        assertEquals(35, group.standings.single().total)
        assertEquals(listOf("1 excluded race"), group.controlPoints)
    }
}


class AndroidTournamentRosterPlayerClientTest {
    private val session = AndroidAuthenticatedNativeSession(
        bearerToken = "token-for-native-tournament-tests",
        expiresAtMs = 1_800_000_000_000,
        playerId = "player.ben",
    )

    /** ADR-0177 decisions 9 and 10: the created batch comes back whole. */
    @Test
    fun createdRosterPlayersCarryTheDerivedUsername() {
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/roster-players"),
            statusCode = 201,
            responseBody = """{"schemaVersion":"mk8dx.native-roster-players.v1","created":[{"playerId":"player.new","username":"nieuwespelereen","displayName":"NieuweSpelerEen"}]}""",
        )
        val client = AndroidTournamentClient(
            "https://example.invalid",
            session,
            AndroidTournamentConnectionOpener { connection },
        )

        val created = client.createRosterPlayers(listOf(6 to "NieuweSpelerEen")).getOrThrow().single()

        assertEquals("player.new", created.playerId)
        assertEquals("nieuwespelereen", created.username)
        assertTrue(connection.writtenBody().contains("\"row\":6"))
    }

    /** A rejected roster must reach the operator with its offending rows intact. */
    @Test
    fun aRejectedRosterKeepsTheOffendingRows() {
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/roster-players"),
            statusCode = 409,
            errorBody = """{"schemaVersion":"mk8dx.native-roster-players-rejected.v1","code":"roster_rejected","rejections":[{"row":4,"displayName":"Jan Piet","reason":"duplicate_display_name_in_file"}]}""",
        )
        val client = AndroidTournamentClient(
            "https://example.invalid",
            session,
            AndroidTournamentConnectionOpener { connection },
        )

        val failure = client.createRosterPlayers(listOf(3 to "Jan-Piet", 4 to "Jan Piet")).exceptionOrNull()

        val rejections = (failure as AndroidTournamentClientException).rejections
        assertEquals(1, rejections.size)
        assertEquals(4, rejections.single().row)
        assertEquals("duplicate_display_name_in_file", rejections.single().reason)
        assertEquals(
            "Er is niets geïmporteerd. regel 4 \"Jan Piet\": naam staat dubbel in het bestand.",
            androidRosterRejectionMessage(rejections),
        )
    }

    /** ADR-0218: the candidates a name may mean, one entry per name, with context. */
    @Test
    fun rosterCandidatesAskOncePerNameAndParseTheContext() {
        var opened: URL? = null
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/roster-player-candidates"),
            responseBody = """{"schemaVersion":"mk8dx.roster-player-candidates.v1","entries":[{"name":"Mal","sameNameInOwnNights":true,"candidates":[{"playerId":"player.mal","username":"mal","displayName":"Mal","matchedBy":"display_name","claimed":true,"inTournament":false,"nights":12,"nightsWithDirector":3,"lastNightName":"TN13","lastNightDate":"2026-10-04","directorNames":["Ben"],"characterKey":"character.yoshi","characterLabel":"Yoshi"}]}]}""",
        )
        val client = AndroidTournamentClient(
            "https://example.invalid", session,
            AndroidTournamentConnectionOpener { url -> opened = url; connection },
        )

        val entry = client.rosterCandidates(listOf(" Mal "), "tournament.demo_night", partial = true).single()

        assertEquals("https://example.invalid/v1/native/roster-player-candidates", opened.toString())
        assertEquals("POST", connection.requestMethod)
        val body = connection.writtenBody()
        assertTrue(body.contains("\"names\":[\"Mal\"]"))
        assertTrue(body.contains("\"tournamentId\":\"tournament.demo_night\""))
        assertTrue(body.contains("\"partial\":true"))
        assertTrue(entry.sameNameInOwnNights)
        assertEquals(3, entry.candidates.single().nightsWithDirector)
        assertEquals("character.yoshi", entry.candidates.single().characterKey)
    }

    /** ADR-0218: "yes, another Mal" travels per row, with the night it is for. */
    @Test
    fun createdRosterPlayersCarryTheSameNameConfirmationAndTheNight() {
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/roster-players"),
            statusCode = 201,
            responseBody = """{"schemaVersion":"mk8dx.native-roster-players.v1","created":[{"playerId":"player.mal_2","username":"mal-2","displayName":"Mal"}]}""",
        )
        val client = AndroidTournamentClient(
            "https://example.invalid", session,
            AndroidTournamentConnectionOpener { connection },
        )

        val created = client.createRosterPlayers(
            listOf(AndroidRosterPlayerRequest(1, "Mal", confirmSameName = true)), "tournament.demo_night",
        ).getOrThrow().single()

        assertEquals("mal-2", created.username)
        val body = connection.writtenBody()
        assertTrue(body.contains("\"tournamentId\":\"tournament.demo_night\""))
        assertTrue(body.contains("\"confirmSameName\":true"))
    }

    @Test
    fun rememberedAliasesPostToTheNightAndCountWhatWasNew() {
        var opened: URL? = null
        val connection = TournamentFakeHttpsConnection(
            URL("https://example.invalid/v1/native/tournaments/tournament.demo_night/roster-aliases"),
            responseBody = """{"schemaVersion":"mk8dx.roster-aliases.v1","created":[{"playerId":"player.mal","aliasText":"Malie"}],"existing":0}""",
        )
        val client = AndroidTournamentClient(
            "https://example.invalid", session,
            AndroidTournamentConnectionOpener { url -> opened = url; connection },
        )

        assertEquals(1, client.rememberRosterAliases("tournament.demo_night", listOf("player.mal" to " Malie ")))
        assertEquals("https://example.invalid/v1/native/tournaments/tournament.demo_night/roster-aliases", opened.toString())
        assertTrue(connection.writtenBody().contains("\"name\":\"Malie\""))
    }
}

private class TournamentFakeHttpsConnection(
    url: URL,
    private val statusCode: Int = 200,
    responseBody: String = "",
    errorBody: String? = null,
) : HttpsURLConnection(url) {
    private val response = ByteArrayInputStream(responseBody.toByteArray())
    private val error = errorBody?.let { ByteArrayInputStream(it.toByteArray()) }
    private val output = ByteArrayOutputStream()
    var disconnected = false
        private set

    override fun connect() = Unit
    override fun disconnect() { disconnected = true }
    override fun usingProxy(): Boolean = false
    override fun getCipherSuite(): String = "TLS_SYNTHETIC"
    override fun getLocalCertificates(): Array<Certificate>? = null
    override fun getServerCertificates(): Array<Certificate> = emptyArray()
    override fun getResponseCode(): Int = statusCode
    override fun getInputStream(): InputStream = response
    override fun getErrorStream(): InputStream? = error
    override fun getOutputStream(): OutputStream = output
    fun writtenBody(): String = output.toString(Charsets.UTF_8.name())
}
