package nl.mariokart8.mk8dxtimetrials.ecosystem

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceChoice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTimeTrialsEcosystemClientTest {
    @Test
    fun bootstrapUsesCanonicalSingleRequestContract() {
        lateinit var opened: URL
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            null,
            AndroidEcosystemConnectionOpener { url ->
                opened = url
                EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.home-bootstrap.v1","authenticated":false,"stories":{"schemaVersion":"mk8dx.activity-stories.v1","stories":[]}}""",
                )
            },
        )

        val home = client.home()

        assertEquals("https://example.invalid/v1/bootstrap", opened.toString())
        assertTrue(!home.authenticated)
        assertEquals(0, home.stories?.stories?.size)
    }

    @Test
    fun bootstrapMapsCanonicalUsernameValueObject() {
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            null,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.home-bootstrap.v1","authenticated":true,"player":{"playerId":"player.ben","username":{"value":"ben"},"displayName":"Ben"}}""",
                )
            },
        )

        val player = client.home().player

        assertEquals("ben", player?.username?.value)
        assertEquals("Ben", player?.displayName)
    }

    @Test
    fun bootstrapMapsCommunityLapCoinsAndLoadoutDetails() {
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            null,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.home-bootstrap.v1","authenticated":false,"stories":{"schemaVersion":"mk8dx.activity-stories.v1","stories":[{"player":{"playerId":"player.ben","displayName":"Ben","countryId":"country.nl","avatarId":"character.yoshi"},"trackId":"track.mario_kart_stadium","mode":150,"runs":1,"startMs":107284,"bestMs":106784,"personalBest":true,"personalBestDeltaMs":500,"playerDeltaMs":-500,"runRank":4,"latestAtMs":1900000000000,"runDetails":[{"resultId":"user_submission.time.ACTIVITYDETAIL01","timeMs":106784,"atMs":1900000000000,"sourceKind":"android_scan","correctedFields":["body"],"laps":[{"lapNumber":1,"timeMs":37121,"coinsCollected":10,"mushroomsUsed":1},{"lapNumber":2,"timeMs":35399,"coinsCollected":8,"mushroomsUsed":0},{"lapNumber":3,"timeMs":34264,"mushroomsUsed":2}],"loadout":{"characterId":"character.yoshi","bodyId":"body.mr_scooty","tireId":"tire.roller","gliderId":"glider.cloud_glider"}}]}]}}""",
                )
            },
        )

        val story = client.home().stories!!.stories.single()
        val run = story.runDetails.single()

        assertEquals(4, story.runRank)
        assertEquals(500L, story.personalBestDeltaMs)
        assertEquals(-500L, story.playerDeltaMs)
        assertEquals("country.nl", story.player.countryId)
        assertEquals("character.yoshi", story.player.avatarId)
        assertEquals(10, run.laps.first().coinsCollected)
        assertEquals(1, run.laps.first().mushroomsUsed)
        assertEquals("character.yoshi", run.loadout?.characterId)
        assertEquals("body.mr_scooty", run.loadout?.bodyId)
        assertEquals("tire.roller", run.loadout?.tireId)
        assertEquals("glider.cloud_glider", run.loadout?.gliderId)
        assertEquals("android_scan", run.sourceKind)
        assertEquals(listOf("body"), run.correctedFields)
    }

    @Test
    fun bootstrapKeepsCanonicalOvertakeEvidenceOnTheStory() {
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            null,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.home-bootstrap.v1","authenticated":true,"stories":{"schemaVersion":"mk8dx.activity-stories.v1","stories":[{"player":{"playerId":"player.floyd","displayName":"Floyd"},"trackId":"track.mario_kart_stadium","mode":150,"runs":1,"startMs":116331,"bestMs":116331,"personalBest":true,"latestAtMs":1900000000000,"viewerOvertake":{"notificationId":"notification.42","actorTimeMs":116331,"recipientTimeMs":116942,"deltaMs":-611,"recipientRank":4}}]}}""",
                )
            },
        )

        val overtake = client.home().stories!!.stories.single().viewerOvertake!!

        assertEquals("notification.42", overtake.notificationId)
        assertEquals(-611, overtake.deltaMs)
        assertEquals(4, overtake.recipientRank)
    }

    @Test
    fun leaderboardValidatesTrackAndModeAndMapsCommunityRows() {
        lateinit var connection: EcosystemFakeConnection
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            null,
            AndroidEcosystemConnectionOpener { url ->
                connection = EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.public-time-trial-leaderboard.v1","results":[{"resultId":"result.1","playerId":"player.ben","playerUsername":"ben","playerDisplayName":"Ben","trackId":"track.mario_kart_stadium","mode":150,"totalTimeMs":91234,"sourceKind":"web_manual","rank":1}]}""",
                )
                connection
            },
        )

        val rows = client.leaderboard("track.mario_kart_stadium", 150)

        assertEquals("trackId=track.mario_kart_stadium&mode=150", connection.url.query)
        assertEquals("Ben", rows.single().playerDisplayName)
        assertEquals(91_234, rows.single().totalTimeMs)
        assertTrue(connection.disconnected)
    }

    @Test
    fun authenticatedAppsCatalogSelectsTheCanonicalAndroidRelease() {
        lateinit var opened: URL
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            null,
            AndroidEcosystemConnectionOpener { url ->
                opened = url
                EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.app-downloads.v1","entries":[{"id":"android-timetrials","platform":"android","title":"MK8DX TimeTrials","version":"2.7-build13","releasedOn":"2026-08-24","fileName":"app.apk","bytes":1,"sha256":"${"0".repeat(64)}","requirements":[],"installSteps":[],"updateSteps":[]}]}""",
                )
            },
        )

        val release = client.latestAndroidRelease()

        assertEquals("https://example.invalid/v1/app-downloads", opened.toString())
        assertEquals("2.7-build13", release?.version)
        assertEquals("2026-08-24", release?.releasedOn)
    }

    @Test
    fun updateComparisonUsesTheManifestBuildAsAndroidVersionCode() {
        val release = AndroidAppRelease("2.7-build13", "2026-08-24")

        assertEquals(13, release.availableAfter(12)?.versionCode)
        assertEquals("2.7", release.availableAfter(12)?.version)
        assertEquals(null, release.availableAfter(13))
        assertEquals(null, AndroidAppRelease("2.7", "2026-08-24").availableAfter(12))
    }

    @Test
    fun profileResultsKeepCanonicalLapCoinMushroomAndLoadoutDetails() {
        lateinit var opened: URL
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            null,
            AndroidEcosystemConnectionOpener { url ->
                opened = url
                EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.public-player-time-trials.v1","results":[{"resultId":"user_submission.time.PROFILEDETAIL01","revision":2,"playerId":"player.ben","playerUsername":"ben","playerDisplayName":"Ben","trackId":"track.mario_kart_stadium","mode":150,"totalTimeMs":106784,"laps":[{"lapNumber":1,"timeMs":37121,"coinsCollected":10,"mushroomsUsed":1}],"loadout":{"characterId":"character.yoshi","bodyId":"body.mr_scooty","tireId":"tire.roller","gliderId":"glider.cloud_glider"},"sourceKind":"livetrial_capture","correctedFields":["character"],"resultAtMs":1900000000000,"publishedAtMs":1900000001000}]}""",
                )
            },
        )

        val result = client.playerResults("player.ben").single()

        assertEquals("/v1/public/players/player.ben/time-trials", opened.path)
        assertEquals(10, result.laps.single().coinsCollected)
        assertEquals(1, result.laps.single().mushroomsUsed)
        assertEquals("character.yoshi", result.loadout?.characterId)
    }

    @Test
    fun ownerCanListAndRetireAnAccountOwnedResultWithCsrfProtection() {
        val session = AndroidAuthenticatedNativeSession(
            "token-for-ecosystem-tests", 1_900_000_000_000, "player.ben",
        )
        val opened = mutableListOf<EcosystemFakeConnection>()
        val active = managedResultJson("active", "published")
        val retired = managedResultJson("retired", "withheld")
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            session,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(
                    url,
                    when {
                        url.path.endsWith("/session/csrf") ->
                            """{"schemaVersion":"mk8dx.web-csrf.v1","headerName":"X-MK8DX-CSRF","value":"csrf-test"}"""
                        url.path.endsWith("/actions/retire") ->
                            """{"schemaVersion":"mk8dx.managed-time-trial.v1","result":$retired}"""
                        else -> """{"schemaVersion":"mk8dx.managed-time-trial-list.v1","results":[$active]}"""
                    },
                ).also(opened::add)
            },
        )

        assertEquals("active", client.managedTimeTrials().single().retirementState)
        val result = client.retireTimeTrial(
            "user_submission.time.RESULT01", "wrong_track_or_mode",
        )

        val action = opened.last()
        assertEquals("retired", result?.retirementState)
        assertEquals("POST", action.requestMethod)
        assertEquals("csrf-test", action.getRequestProperty("X-MK8DX-CSRF"))
        assertTrue(action.requestBody().contains("\"reasonCode\":\"wrong_track_or_mode\""))
    }

    @Test
    fun ownerCorrectsInTheFormOfPostATimeAndAttachesOrRemovesAVideo() {
        val session = AndroidAuthenticatedNativeSession(
            "token-for-ecosystem-tests", 1_900_000_000_000, "player.ben",
        )
        val opened = mutableListOf<EcosystemFakeConnection>()
        val active = managedResultJson("active", "published")
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            session,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(
                    url,
                    if (url.path.endsWith("/session/csrf")) {
                        """{"schemaVersion":"mk8dx.web-csrf.v1","headerName":"X-MK8DX-CSRF","value":"csrf-test"}"""
                    } else {
                        """{"schemaVersion":"mk8dx.managed-time-trial.v1","result":$active}"""
                    },
                ).also(opened::add)
            },
        )

        client.correctTimeTrial(
            "user_submission.time.RESULT01",
            AndroidTimeTrialCorrection(
                totalTimeMs = 105_000, laps = listOf(35_000, 35_000, 35_000),
                lapDetails = listOf(AndroidManagedLapCounts(5, 1), AndroidManagedLapCounts(8, 1), AndroidManagedLapCounts(10, 1)),
                reasonCode = "incorrect_time",
            ),
        )
        val correct = opened.last()
        assertTrue(correct.url.path.endsWith("/actions/correct"))
        assertEquals("csrf-test", correct.getRequestProperty("X-MK8DX-CSRF"))
        // Only what changed travels: no loadout and no note were set, so none is sent.
        assertEquals(
            """{"totalTimeMs":105000,"laps":[35000,35000,35000],"lapDetails":[{"coinsCollected":5,"mushroomsUsed":1},{"coinsCollected":8,"mushroomsUsed":1},{"coinsCollected":10,"mushroomsUsed":1}],"reasonCode":"incorrect_time"}""",
            correct.requestBody(),
        )

        client.setTimeTrialVideo("user_submission.time.RESULT01", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assertEquals("""{"videoUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}""", opened.last().requestBody())
        // Removing the video says so explicitly: the API requires the key.
        client.setTimeTrialVideo("user_submission.time.RESULT01", null)
        assertTrue(opened.last().url.path.endsWith("/actions/video"))
        assertEquals("""{"videoUrl":null}""", opened.last().requestBody())
    }

    @Test
    fun aRefusedCorrectionCarriesTheSitesCode() {
        val session = AndroidAuthenticatedNativeSession(
            "token-for-ecosystem-tests", 1_900_000_000_000, "player.ben",
        )
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            session,
            AndroidEcosystemConnectionOpener { url ->
                if (url.path.endsWith("/session/csrf")) {
                    EcosystemFakeConnection(url, """{"schemaVersion":"mk8dx.web-csrf.v1","headerName":"X-MK8DX-CSRF","value":"csrf-test"}""")
                } else {
                    EcosystemFakeConnection(
                        url,
                        """{"code":"time_trial_time_implausible","message":"The proposed time is highly unreasonable, please double check all information."}""",
                        status = 400,
                    )
                }
            },
        )
        val refused = runCatching {
            client.correctTimeTrial(
                "user_submission.time.RESULT01",
                AndroidTimeTrialCorrection(totalTimeMs = 1_000, laps = listOf(300, 300, 400), reasonCode = "incorrect_time"),
            )
        }.exceptionOrNull() as AndroidEcosystemClientException
        assertEquals(400, refused.statusCode)
        assertEquals("time_trial_time_implausible", refused.code)
        assertEquals(
            "De voorgestelde tijd is zeer onwaarschijnlijk, controleer alle gegevens nog eens.",
            androidManageFailureMessage(refused, dutch = true),
        )
    }

    @Test
    fun recordBookUsesCanonicalPublicProjection() {
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            null,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.public-record-book.v1","categories":[{"key":"firsts","holders":[{"playerId":"player.ben","displayName":"Ben","value":12}]}]}""",
                )
            },
        )

        assertEquals("Ben", client.recordBook().categories.single().holders.single().displayName)
    }

    @Test
    fun worldRecordsPreserveEveryEqualTimeHolder() {
        val records = listOf(150, 200).flatMap { mode ->
            (0 until 96).map { index ->
                val player = if (mode == 200 && index == 0) "Pii / Technical" else "Player $index"
                val holders = if (mode == 200 && index == 0) {
                    """[{"playerName":"Pii","videoUrl":"https://youtu.be/first","lapTimesMs":[20000,20000,18982],"coinsPerLap":[3,3,4],"mushroomsPerLap":[1,1,1]},{"playerName":"Technical","videoUrl":"https://youtu.be/second","lapTimesMs":[20000,20000,18982],"coinsPerLap":[3,3,4],"mushroomsPerLap":[1,1,1]}]"""
                } else {
                    """[{"playerName":"Player $index","lapTimesMs":[20000,20000,18982],"coinsPerLap":[3,3,4],"mushroomsPerLap":[1,1,1]}]"""
                }
                """{"mode":$mode,"trackId":"track.$index","trackName":"Track $index","totalTimeMs":58982,"playerName":"$player","lapTimesMs":[20000,20000,18982],"coinsPerLap":[3,3,4],"mushroomsPerLap":[1,1,1],"holders":$holders}"""
            }
        }
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            null,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.world-records.v1","records":[${records.joinToString(",")}]}""",
                )
            },
        )

        val record = client.worldRecords().first { it.mode == 200 && it.trackId == "track.0" }

        assertEquals(listOf("Pii", "Technical"), record.holders.map { it.playerName })
        assertEquals("https://youtu.be/second", record.holders.last().videoUrl)
    }

    @Test
    fun notificationsAndRivalsUseTheProtectedSession() {
        val paths = mutableListOf<String>()
        val session = AndroidAuthenticatedNativeSession(
            "token-for-ecosystem-tests",
            1_900_000_000_000,
            "player.ben",
        )
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            session,
            AndroidEcosystemConnectionOpener { url ->
                paths += url.path
                EcosystemFakeConnection(
                    url,
                    if (url.path.endsWith("notifications")) {
                        """{"schemaVersion":"mk8dx.notifications.v1","unreadCount":1,"notifications":[{"notificationId":"7","kind":"time_beaten","count":1,"lastEventAtMs":1900000000000,"read":false}]}"""
                    } else {
                        """{"schemaVersion":"mk8dx.player-rivals.v1","rivals":[{"playerId":"player.friend","displayName":"Friend"}]}"""
                    },
                )
            },
        )

        assertEquals(1, client.notifications()?.unreadCount)
        assertEquals("Friend", client.rivals().single().displayName)
        assertEquals(listOf("/v1/notifications", "/v1/account/rivals"), paths)
    }

    @Test
    fun clearsOneNotificationAndClearsThemAll() {
        // The route has always accepted either form; only Android could not
        // ask to clear everything, so a notification nobody wanted to read
        // had no way off the screen.
        val session = AndroidAuthenticatedNativeSession(
            "token-for-ecosystem-tests",
            1_900_000_000_000,
            "player.ben",
        )
        val connections = mutableListOf<EcosystemFakeConnection>()
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            session,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(url, """{"acknowledged":true}""")
                    .also { connections += it }
            },
        )

        client.markNotificationsRead(listOf("31", "31", "42"))
        client.markAllNotificationsRead()

        assertEquals(2, connections.size)
        // Duplicates collapse; the identifiers are sent as themselves.
        assertEquals("""{"notificationIds":["31","42"]}""", connections[0].requestBody())
        assertEquals("""{"all":true}""", connections[1].requestBody())
    }

    @Test
    fun neverAsksToClearNotificationsWithoutASession() {
        var opened = 0
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid",
            null,
            AndroidEcosystemConnectionOpener { url ->
                opened += 1
                EcosystemFakeConnection(url, """{"acknowledged":true}""")
            },
        )

        client.markNotificationsRead(listOf("31"))
        client.markAllNotificationsRead()

        assertEquals(0, opened)
    }
}

private fun managedResultJson(retirementState: String, publicationStatus: String) =
    """{"submissionId":"user_submission.time.RESULT01","playerId":"player.ben","playerUsername":"ben","playerDisplayName":"Ben","retirementState":"$retirementState","publicationStatus":"$publicationStatus","publicationReason":"owner lifecycle","current":{"revision":1,"modeCc":150,"trackId":"track.mario_kart_stadium","totalTimeMs":91234,"laps":[30000,30000,31234],"sourceKind":"android_scan","createdAtMs":1900000000000}}"""

/**
 * ADR-0205 on the wire: only the choice travels, and it travels through the
 * account route the API serves, with the CSRF proof every account write needs.
 */
class AndroidAccountAppearanceSyncTest {
    private val session = AndroidAuthenticatedNativeSession(
        "token-for-appearance-tests", 1_900_000_000_000, "player.ben",
    )

    @Test
    fun anAccountThatHasNeverChosenReadsAsNoChoice() {
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid", session,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.account-appearance-preference.v1","appearance":null}""",
                )
            },
        )

        assertEquals(null, AndroidAccountAppearanceSync(client).readAccountChoice())
    }

    @Test
    fun theAccountChoiceIsReadFromTheRouteTheApiServes() {
        lateinit var opened: URL
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid", session,
            AndroidEcosystemConnectionOpener { url ->
                opened = url
                EcosystemFakeConnection(
                    url,
                    """{"schemaVersion":"mk8dx.account-appearance-preference.v1","appearance":"dark"}""",
                )
            },
        )

        val choice = AndroidAccountAppearanceSync(client).readAccountChoice()

        assertEquals("https://example.invalid/v1/account/appearance-preference", opened.toString())
        assertEquals(Mk8dxAppearanceChoice.Dark, choice)
    }

    @Test
    fun writingTheChoiceSendsOnlyTheChoiceWithACsrfProof() {
        val opened = mutableListOf<EcosystemFakeConnection>()
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid", session,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(
                    url,
                    if (url.path.endsWith("/session/csrf")) {
                        """{"schemaVersion":"mk8dx.web-csrf.v1","headerName":"X-MK8DX-CSRF","value":"csrf-token"}"""
                    } else {
                        """{"schemaVersion":"mk8dx.account-appearance-preference.v1","appearance":"light"}"""
                    },
                ).also(opened::add)
            },
        )

        val stored = AndroidAccountAppearanceSync(client).writeAccountChoice(Mk8dxAppearanceChoice.Light)

        assertTrue(stored)
        val write = opened.last()
        assertEquals("""{"appearance":"light"}""", write.requestBody())
        assertEquals("csrf-token", write.getRequestProperty("X-MK8DX-CSRF"))
    }

    @Test
    fun anAccountThatStoredSomethingElseIsNotReportedAsStored() {
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid", session,
            AndroidEcosystemConnectionOpener { url ->
                EcosystemFakeConnection(
                    url,
                    if (url.path.endsWith("/session/csrf")) {
                        """{"schemaVersion":"mk8dx.web-csrf.v1","headerName":"X-MK8DX-CSRF","value":"csrf-token"}"""
                    } else {
                        """{"schemaVersion":"mk8dx.account-appearance-preference.v1","appearance":"dark"}"""
                    },
                )
            },
        )

        assertTrue(!AndroidAccountAppearanceSync(client).writeAccountChoice(Mk8dxAppearanceChoice.Light))
    }

    @Test
    fun signedOutKeepsTheChoiceOnThePhone() {
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid", null,
            AndroidEcosystemConnectionOpener { url -> EcosystemFakeConnection(url, "{}") },
        )

        assertEquals(null, androidAppearanceSync(client, playerId = null))
        assertEquals(null, AndroidAccountAppearanceSync(client).readAccountChoice())
    }

    @Test
    fun gamesAndRunReactionsUseTheSameCsrfProtectedCanonicalApi() {
        val opened = mutableListOf<EcosystemFakeConnection>()
        val client = AndroidTimeTrialsEcosystemClient(
            "https://example.invalid", session,
            AndroidEcosystemConnectionOpener { url ->
                val response = when {
                    url.path.endsWith("/session/csrf") ->
                        """{"schemaVersion":"mk8dx.web-csrf.v1","headerName":"X-MK8DX-CSRF","value":"csrf-game"}"""
                    url.path.endsWith("/engagements") ->
                        """{"engagementId":"player_engagement.test_123456","kind":"dice_roll","recipientPlayerId":"player.floyd","detail":{"face":5}}"""
                    url.path.endsWith("/reply") ->
                        """{"schemaVersion":"mk8dx.player-engagement-result.v1","engagement":{"engagementId":"player_engagement.test_123456","kind":"rock_paper_scissors","actorPlayerId":"player.floyd","recipientPlayerId":"player.ben","detail":{"hand":"rock","recipientHand":"paper","outcome":"recipient"},"createdAtMs":1000}}"""
                    url.path.endsWith("/public/time-trial-reactions") ->
                        """{"schemaVersion":"mk8dx.public-time-trial-reactions.v1","reactions":[{"resultId":"user_submission.time.RESULT01","counts":{"fire":2},"mine":"fire"}]}"""
                    else -> """{"acknowledged":true}"""
                }
                EcosystemFakeConnection(url, response,
                    if (url.path.endsWith("/engagements")) 201 else 200).also(opened::add)
            },
        )

        assertEquals(5, client.sendEngagement("player.floyd", "dice_roll")?.face)
        assertEquals("csrf-game", opened.last().getRequestProperty("X-MK8DX-CSRF"))
        assertTrue(opened.last().requestBody().contains("\"kind\":\"dice_roll\""))
        assertEquals("recipient", client.answerRps("player_engagement.test_123456", "paper").detail?.outcome)
        assertEquals("csrf-game", opened.last().getRequestProperty("X-MK8DX-CSRF"))
        client.reactToRun("user_submission.time.RESULT01", "fire")
        assertEquals("PUT", opened.last().requestMethod)
        assertEquals("csrf-game", opened.last().getRequestProperty("X-MK8DX-CSRF"))
        assertEquals(2, client.reactionSummaries(listOf("user_submission.time.RESULT01")).single().counts["fire"])
        assertEquals("fire", client.reactionSummaries(listOf("user_submission.time.RESULT01")).single().mine)
        client.removeReaction("user_submission.time.RESULT01")
        assertEquals("DELETE", opened.last().requestMethod)
        assertEquals("csrf-game", opened.last().getRequestProperty("X-MK8DX-CSRF"))
    }
}

private class EcosystemFakeConnection(
    url: URL,
    body: String,
    private val status: Int = 200,
) : HttpsURLConnection(url) {
    private val response = ByteArrayInputStream(body.toByteArray())
    private val request = ByteArrayOutputStream()
    var disconnected = false
        private set

    override fun connect() = Unit
    override fun disconnect() { disconnected = true }
    override fun usingProxy(): Boolean = false
    override fun getCipherSuite(): String = "TLS_TEST"
    override fun getLocalCertificates(): Array<Certificate>? = null
    override fun getServerCertificates(): Array<Certificate> = emptyArray()
    override fun getResponseCode(): Int = status
    override fun getInputStream(): InputStream = response
    override fun getErrorStream(): InputStream? = if (status == 200) null else response
    override fun getOutputStream(): OutputStream = request
    fun requestBody(): String = request.toString(Charsets.UTF_8.name())
}
