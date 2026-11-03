package nl.mariokart8.mk8dxtimetrials.posttime

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToLog
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidHomeBootstrap
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidPublicTimeTrialResult
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource
import nl.mariokart8.mk8dxtimetrials.manual.AndroidTrustedManualSubmissionContextFactory
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalTimeTrialOutbox
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSubmissionHost
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidProducedSubmissionValidator
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanLapV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanLoadoutV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanSourceV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanTimestampsV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanVerificationV1
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * The canonical Post-a-Time task on a device: one form, one validation, one
 * armed publication, and the local-first outbox underneath it unchanged.
 */
class AndroidPostTimeTaskDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private fun outboxRoots(): Pair<File, File> {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        return File(context.filesDir, "post-time-$suffix") to
            File(context.noBackupFilesDir, "post-time-private-$suffix")
    }

    private fun contextFactory() = AndroidTrustedManualSubmissionContextFactory(
        playerId = "player.owner_01",
        producerVersion = "android-device-test",
        opaqueIdProvider = { "post-time-device-0001" },
        clock = AndroidOutboxClock { 1_786_911_000_000 },
    )

    private class MemoryStorage : AndroidPostTimeDraftStorage {
        var value: String? = null
        override fun read(): String? = value
        override fun write(value: String) { this.value = value }
        override fun clear() { value = null }
    }

    @Test
    fun aThreeLapTimeIsTypedCheckedArmedAndQueuedAsTheManualPayload() {
        val (canonicalRoot, privateRoot) = outboxRoots()
        try {
            val outbox = AndroidLocalTimeTrialOutbox(canonicalRoot, privateRoot, AndroidProducedSubmissionValidator)
            val host = AndroidOutboxSubmissionHost(outbox, AndroidOutboxClock { 1_786_911_000_100 })
            compose.setContent {
                Mk8dxTheme(Mk8dxAppearance.Dark) {
                    AndroidPostTimeTask(
                        trackId = "track.mario_kart_stadium",
                        mode = 150,
                        contextFactory = contextFactory(),
                        submissionHost = host,
                        draftStorage = MemoryStorage(),
                    )
                }
            }

            // Publish is never silently disabled: the reason is printed under it
            // and is the button's own state description, so it is announced with
            // "disabled" rather than read twice.
            compose.onNodeWithTag("post-time-publish").performScrollTo()
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Enter a total time first."))
            compose.onNodeWithTag("post-time-total").performTextInput("130000")
            compose.onNodeWithTag("post-time-lap-1").performScrollTo().performTextInput("030000")
            compose.onNodeWithTag("post-time-lap-2").performScrollTo().performTextInput("029500")
            // A lap sum that does not close is refused, with both numbers.
            compose.onNodeWithTag("post-time-lap-3").performScrollTo().performTextInput("030400")
            // The rule is said twice on purpose (§13): on the field that failed,
            // and as an outstanding check in the panel beside the publication.
            compose.onNodeWithTag("post-time-laps-error").performScrollTo()
                .assertTextContains("Your laps add up to 1:29.900, the total is 1:30.000.")
            compose.onAllNodesWithText("Your laps add up to 1:29.900, the total is 1:30.000.", substring = true)
                .assertCountEquals(2)
            // A six-digit field is full, so correcting it is a clear and a retype
            // — the same as backspacing on the phone's own keypad.
            compose.onNodeWithTag("post-time-lap-3").performTextClearance()
            compose.onNodeWithTag("post-time-lap-3").performTextInput("030500")

            // One lap can be cleared without losing the other rows. Re-enter it
            // afterwards so the publication below still proves the full path.
            compose.onNodeWithTag("post-time-clear-lap-2").performClick()
            compose.onNodeWithTag("post-time-lap-2")
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "0:00.000"))
            compose.onNodeWithTag("post-time-lap-1")
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "0:30.000"))
            compose.onNodeWithTag("post-time-lap-2").performTextInput("029500")

            // Coins are a signed change with the running balance beside them.
            compose.onNodeWithTag("post-time-currency-icon-1").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("post-time-mushroom-icon-1").assertIsDisplayed()
            compose.onNodeWithTag("post-time-coins-1-up").performScrollTo().performClick()
            compose.onNodeWithTag("post-time-coins-1-up").performClick()
            compose.onNodeWithTag("post-time-coins-1").assertIsDisplayed()
            compose.onNodeWithText("+2 · balance 2", substring = true).assertIsDisplayed()
            // Mushrooms are four one-tap values, and "not recorded" is its own.
            compose.onNodeWithTag("post-time-mushrooms-1").performScrollTo()
            compose.onNode(hasText("1") and hasAnyAncestor(hasTestTag("post-time-mushrooms-1")))
                .performClick()

            compose.onNodeWithText("Everything checks out.").performScrollTo().assertIsDisplayed()
            // The armed two-press publication: the first press publishes nothing,
            // says so on the button and announces the next step politely.
            compose.onNodeWithTag("post-time-publish").performScrollTo().performClick()
            compose.onNodeWithTag("post-time-confirmation").assertIsDisplayed()
            compose.onNodeWithTag("post-time-not-submitted").assertIsDisplayed()
            compose.onNodeWithTag("post-time-confirm-total").assertTextContains("1:30.000")
            compose.onNodeWithText("Coins +2 · Mushrooms 1", substring = true).assertIsDisplayed()
            compose.onNodeWithText("Back to adjust").assertIsDisplayed()
            compose.onNodeWithTag("post-time-publish")
                .assertTextContains("Confirm and publish · 150cc")
                .assert(
                    SemanticsMatcher.expectValue(
                        SemanticsProperties.StateDescription,
                        "Review the summary, then confirm · nothing is published yet",
                    ),
                )
            assertEquals(0, outbox.listIndex().size)
            compose.onNodeWithTag("post-time-publish").performClick()

            compose.waitUntil(5_000) { outbox.listIndex().size == 1 }
            val record = outbox.read(outbox.listIndex().single().entryKeyHash)
            val submission = record.canonicalSubmission
            assertEquals(
                "android_manual",
                submission.getValue("source").jsonObject.getValue("kind").jsonPrimitive.content,
            )
            assertEquals("track.mario_kart_stadium", submission.getValue("trackId").jsonPrimitive.content)
            assertEquals("150", submission.getValue("mode").jsonPrimitive.content)
            assertEquals("90000", submission.getValue("totalTimeMs").jsonPrimitive.content)
            val laps = submission.getValue("laps").jsonArray.map { it.jsonObject }
            assertEquals(3, laps.size)
            assertEquals("2", laps[0].getValue("coinsCollected").jsonPrimitive.content)
            assertEquals("2", laps[2].getValue("coinsCollected").jsonPrimitive.content)
            assertEquals("1", laps[0].getValue("mushroomsUsed").jsonPrimitive.content)
            assertEquals("pending", record.state.state)
            // QUEUED: the phone confirms the completed task honestly before Home takes over.
            compose.onNodeWithTag("post-time-confirmed").assertIsDisplayed()
            compose.onNodeWithTag("post-time-status").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("Waiting for the website to accept it", substring = true)
                .assertIsDisplayed()
            compose.onNodeWithTag("post-time-saved-results").assertIsDisplayed()
            compose.onNodeWithTag("post-time-home").assertIsDisplayed()
        } finally {
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    @Test
    fun aSevenLapTrackDrawsSevenLapRowsAndPublishesTotalOnly() {
        val (canonicalRoot, privateRoot) = outboxRoots()
        try {
            val outbox = AndroidLocalTimeTrialOutbox(canonicalRoot, privateRoot, AndroidProducedSubmissionValidator)
            val host = AndroidOutboxSubmissionHost(outbox, AndroidOutboxClock { 1_786_911_000_100 })
            compose.setContent {
                Mk8dxTheme(Mk8dxAppearance.Dark) {
                    AndroidPostTimeTask(
                        trackId = "track.gcn_baby_park",
                        mode = 200,
                        contextFactory = contextFactory(),
                        submissionHost = host,
                        draftStorage = MemoryStorage(),
                    )
                }
            }

            compose.onNodeWithTag("post-time-lap-7").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("post-time-total").performScrollTo().performTextInput("150000")
            compose.onNodeWithTag("post-time-publish").performScrollTo().performClick()
            compose.onNodeWithTag("post-time-publish").performClick()

            compose.waitUntil(5_000) { outbox.listIndex().size == 1 }
            val submission = outbox.read(outbox.listIndex().single().entryKeyHash).canonicalSubmission
            assertEquals("200", submission.getValue("mode").jsonPrimitive.content)
            assertEquals("track.gcn_baby_park", submission.getValue("trackId").jsonPrimitive.content)
            assertEquals(0, submission.getValue("laps").jsonArray.size)
        } finally {
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    @Test
    fun aBabyParkScanSeparatesThisRunFromTheLeaderboardDeltaKeptByThePb() {
        val source = object : AndroidTimeTrialsEcosystemDataSource {
            override fun home() = AndroidHomeBootstrap("mk8dx.home-bootstrap.v1", true)
            override fun leaderboard(trackId: String, mode: Int) = listOf(
                AndroidPublicTimeTrialResult(
                    "result.matteo", "player.matteo", "matteo", "Matteo",
                    trackId, mode, 67_124, 1,
                    sourceKind = "web_manual",
                ),
                AndroidPublicTimeTrialResult(
                    "result.ben", "player.ben", "ben", "Ben",
                    trackId, mode, 67_302, 1,
                    sourceKind = "web_manual",
                ),
                AndroidPublicTimeTrialResult(
                    "result.valerio", "player.valerio", "valerio", "Valerio",
                    trackId, mode, 67_321, 1,
                    sourceKind = "web_manual",
                ),
            )
        }
        val scanned = AndroidScanTimeTrialSubmissionV1(
            submissionId = "user_submission.time.BABYPARKDELTA01",
            revision = 1,
            mode = 150,
            trackId = "track.gcn_baby_park",
            totalTimeMs = 74_723,
            laps = listOf(12_068L, 12_154L, 10_512L, 10_608L, 10_443L, 9_939L, 8_999L)
                .mapIndexed { index, time -> ScanLapV1(index + 1, time) },
            playerReference = ScanPlayerReferenceV1("player", "player.ben"),
            source = ScanSourceV1(producerVersion = "android-device-test"),
            timestamps = ScanTimestampsV1(1_790_102_490_402, 1_790_102_490_402),
            verification = ScanVerificationV1(),
        )
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                AndroidPostTimeTask(
                    trackId = "track.gcn_baby_park",
                    mode = 150,
                    contextFactory = contextFactory(),
                    submissionHost = null,
                    ecosystemClient = source,
                    signedInPlayerId = "player.ben",
                    pendingScan = scanned,
                    draftStorage = MemoryStorage(),
                )
            }
        }

        compose.waitUntil(5_000) {
            compose.onAllNodesWithText(
                "Delta to Matteo remains +0.178 · your PB is behind.",
            ).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("This time is +7.421 slower than your 1:07.302 PB.")
            .performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Delta to Valerio remains −0.019 · your PB is ahead.")
            .performScrollTo().assertIsDisplayed()

        compose.onNodeWithTag("post-time-total").performScrollTo().performTextClearance()
        compose.onNodeWithTag("post-time-total").performTextInput("106559")
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText(
                "Delta to Matteo: −0.565 · you would be ahead.",
            ).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun theEngineSwitchIsTheOneEngineContextAndCancelsAnArmedPublication() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                AndroidPostTimeTask(
                    trackId = "track.mario_kart_stadium",
                    mode = 150,
                    contextFactory = contextFactory(),
                    submissionHost = null,
                    draftStorage = MemoryStorage(),
                )
            }
        }
        val engineOption = { label: String ->
            compose.onNode(hasText(label) and hasAnyAncestor(hasTestTag("post-time-engine")))
        }
        engineOption("150cc").assertIsSelected()
        engineOption("200cc").performClick().assertIsSelected()
        // Exactly one engine control on the page (§7).
        assertEquals(1, compose.onAllNodesWithTag("post-time-engine").fetchSemanticsNodes().size)
    }

    @Test
    fun aScanFillsTheSameFormAndPublishesTheScanPayload() {
        val (canonicalRoot, privateRoot) = outboxRoots()
        try {
            val outbox = AndroidLocalTimeTrialOutbox(canonicalRoot, privateRoot, AndroidProducedSubmissionValidator)
            val host = AndroidOutboxSubmissionHost(outbox, AndroidOutboxClock { 1_786_911_000_100 })
            val recognised = AndroidScanTimeTrialSubmissionV1(
                submissionId = "user_submission.time.ANDROIDSCANDEVICE01",
                revision = 1,
                mode = 150,
                trackId = "track.mario_kart_stadium",
                totalTimeMs = 90_000,
                laps = listOf(ScanLapV1(1, 30_000), ScanLapV1(2, 29_500), ScanLapV1(3, 30_500)),
                loadout = ScanLoadoutV1(characterId = "character.mario"),
                playerReference = ScanPlayerReferenceV1("player", "player.owner_01"),
                source = ScanSourceV1(producerVersion = "android-device-test"),
                timestamps = ScanTimestampsV1(1_786_911_000_000, 1_786_911_000_000),
                verification = ScanVerificationV1(),
            )
            compose.setContent {
                Mk8dxTheme(Mk8dxAppearance.Dark) {
                    AndroidPostTimeTask(
                        trackId = "track.mario_kart_stadium",
                        mode = 150,
                        contextFactory = contextFactory(),
                        submissionHost = host,
                        pendingScan = recognised,
                        draftStorage = MemoryStorage(),
                    )
                }
            }

            // The same form, filled, with the marks that say where it came from.
            compose.onNodeWithTag("post-time-scan-filled").assertIsDisplayed()
            compose.onNodeWithTag("post-time-source-totalDigits").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("post-time-source-laps[0].timeDigits").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("Everything checks out.").performScrollTo().assertIsDisplayed()

            compose.onNodeWithTag("post-time-publish").performScrollTo().performClick()
            compose.onNodeWithTag("post-time-publish").performClick()
            compose.waitUntil(5_000) { outbox.listIndex().size == 1 }
            val submission = outbox.read(outbox.listIndex().single().entryKeyHash).canonicalSubmission
            assertEquals(
                "android_scan",
                submission.getValue("source").jsonObject.getValue("kind").jsonPrimitive.content,
            )
            assertEquals(
                "producer_check_passed",
                submission.getValue("verification").jsonObject.getValue("status").jsonPrimitive.content,
            )
            assertEquals(
                "character.mario",
                submission.getValue("loadout").jsonObject.getValue("characterId").jsonPrimitive.content,
            )
        } finally {
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    @Test
    fun anEditedScanIsMarkedEditedAndTravelsAsACorrection() {
        val (canonicalRoot, privateRoot) = outboxRoots()
        try {
            val outbox = AndroidLocalTimeTrialOutbox(canonicalRoot, privateRoot, AndroidProducedSubmissionValidator)
            val host = AndroidOutboxSubmissionHost(outbox, AndroidOutboxClock { 1_786_911_000_100 })
            val recognised = AndroidScanTimeTrialSubmissionV1(
                submissionId = "user_submission.time.ANDROIDSCANDEVICE02",
                revision = 1,
                mode = 150,
                trackId = "track.mario_kart_stadium",
                totalTimeMs = 90_000,
                laps = listOf(ScanLapV1(1, 30_000), ScanLapV1(2, 29_500), ScanLapV1(3, 30_500)),
                playerReference = ScanPlayerReferenceV1("player", "player.owner_01"),
                source = ScanSourceV1(producerVersion = "android-device-test"),
                timestamps = ScanTimestampsV1(1_786_911_000_000, 1_786_911_000_000),
                verification = ScanVerificationV1(),
            )
            compose.setContent {
                Mk8dxTheme(Mk8dxAppearance.Dark) {
                    AndroidPostTimeTask(
                        trackId = "track.mario_kart_stadium",
                        mode = 150,
                        contextFactory = contextFactory(),
                        submissionHost = host,
                        pendingScan = recognised,
                        draftStorage = MemoryStorage(),
                    )
                }
            }

            // A mushroom the engine cannot read is the Player's to add, and the
            // scan's own check steps down to "not checked" because of it.
            compose.onNodeWithTag("post-time-mushrooms-1").performScrollTo()
            compose.onNode(hasText("2") and hasAnyAncestor(hasTestTag("post-time-mushrooms-1")))
                .performClick()
            compose.onNodeWithTag("post-time-source-laps[0].mushroomsUsed").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("post-time-publish").performScrollTo().performClick()
            compose.onNodeWithTag("post-time-publish").performClick()

            compose.waitUntil(5_000) { outbox.listIndex().size == 1 }
            val verification = outbox.read(outbox.listIndex().single().entryKeyHash)
                .canonicalSubmission.getValue("verification").jsonObject
            assertEquals("not_checked", verification.getValue("status").jsonPrimitive.content)
            assertEquals(
                "player_corrected_after_tt_scan",
                verification.getValue("method").jsonPrimitive.content,
            )
            assertEquals(
                listOf("mushrooms"),
                verification.getValue("correctedFields").jsonArray.map { it.jsonPrimitive.content },
            )
        } finally {
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    @Test
    fun withoutATrackTheTaskAsksWhichOneAndContinuesIntoTheForm() {
        var chosen: String? = null
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                AndroidPostTimeTask(
                    trackId = null,
                    mode = null,
                    contextFactory = contextFactory(),
                    submissionHost = null,
                    onTrackChosen = { chosen = it },
                    draftStorage = MemoryStorage(),
                )
            }
        }
        compose.onNodeWithTag("post-time-track-selector").assertIsDisplayed()
        compose.onNodeWithText("WHICH TRACK?").assertIsDisplayed()
        compose.onNodeWithTag("cup-selection-0").performClick()
        compose.onNodeWithTag("track-selection-row-0").performClick()
        compose.runOnIdle { assertEquals("track.mario_kart_stadium", chosen) }
    }
}
