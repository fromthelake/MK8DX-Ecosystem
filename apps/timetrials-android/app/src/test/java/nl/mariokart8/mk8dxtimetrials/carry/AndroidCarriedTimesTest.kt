package nl.mariokart8.mk8dxtimetrials.carry

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.manual.encodeAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalTimeTrialOutbox
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSubmissionHost
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidProducedSubmissionValidator
import nl.mariokart8.mk8dxtimetrials.scan.AcceptedPlayerScanObservation
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanSubmissionContext
import nl.mariokart8.mk8dxtimetrials.scan.ScanLegacyAssetResolver
import nl.mariokart8.mk8dxtimetrials.scan.ScanPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.scan.createAndroidScanSubmission
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidInstallationSettings
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AndroidCarriedTimesTest {
    @get:Rule val temporary = TemporaryFolder()

    private val source = "https://club.example"
    private val target = "https://online.example"
    private val slot = "slot." + "a".repeat(32)

    private fun outbox(name: String) = AndroidLocalTimeTrialOutbox(
        File(temporary.root, "canonical-$name"),
        File(temporary.root, "evidence-$name"),
        AndroidProducedSubmissionValidator,
    )

    private fun manual(id: String = "user_submission.time.CARRYSOURCE01") = createAndroidManualSubmission(
        AndroidManualSubmissionContext(
            submissionId = id,
            revision = 1,
            trackId = "track.mario_kart_stadium",
            playerReference = ManualPlayerReferenceV1("player", "player.source"),
            createdAtMs = 1_000,
            producerVersion = "android-test",
        ),
        150,
        "130000",
    )

    /** A sent result of the source community. */
    private fun sent(outbox: AndroidLocalTimeTrialOutbox) = AndroidOutboxSubmissionHost(outbox, AndroidOutboxClock { 1_000 })
        .storeManual(manual()).let { stored ->
            outbox.markSynced(stored.entry.entryKey, 1, 2_000)
        }

    @Test fun `a submission without carriedFrom is unchanged on the wire`() {
        val encoded = encodeAndroidManualSubmission(manual())
        assertFalse(encoded.contains("carriedFrom"))
    }

    @Test fun `carriedFrom is written with its four fields and leaves out an unknown name`() {
        val carried = manual().copy(
            carriedFrom = AndroidCarriedFromV1(
                origin = source,
                originalSubmissionId = "user_submission.time.CARRYSOURCE01",
                originalSubmittedAtMs = 2_000,
            ),
        )
        val json = Json.parseToJsonElement(encodeAndroidManualSubmission(carried)).jsonObject
        assertEquals(
            Json.parseToJsonElement(
                """{"origin":"https://club.example","originalSubmissionId":"user_submission.time.CARRYSOURCE01","originalSubmittedAtMs":2000}""",
            ),
            json["carriedFrom"],
        )
        // The strict producer check accepts the field.
        AndroidProducedSubmissionValidator.validate(json)
    }

    @Test fun `the copy is the same run under a new id, completed with the receiving Player`() {
        val original = Json.parseToJsonElement(encodeAndroidManualSubmission(manual())).jsonObject
        val from = AndroidCarriedFromV1(source, "Club", "user_submission.time.CARRYSOURCE01", 2_000)
        val staged = androidCarriedCopy(original, from, "CARRYCOPY0001", nowMs = 5_000)
        assertNull(staged["playerReference"])
        assertEquals("user_submission.time.CARRYCOPY0001", staged["submissionId"]!!.jsonPrimitive.content)
        assertEquals(1, staged["revision"]!!.jsonPrimitive.content.toInt())
        val timestamps = staged["timestamps"]!!.jsonObject
        assertEquals(1_000, timestamps["occurredAtMs"]!!.jsonPrimitive.long)
        assertEquals(5_000, timestamps["createdAtMs"]!!.jsonPrimitive.long)
        assertEquals(original["laps"], staged["laps"])
        assertEquals(original["source"], staged["source"])
        val completed = androidCompletedCarriedSubmission(staged, "player.receiver")
        assertEquals("player.receiver", completed["playerReference"]!!.jsonObject["value"]!!.jsonPrimitive.content)
        assertEquals(from, completed.carriedFromOrNull())
    }

    @Test fun `a carried scan keeps its capture time and leaves its evidence behind`() {
        val scan = createAndroidScanSubmission(
            observation = AcceptedPlayerScanObservation(
                totalTime = "1:46.784",
                lapTimes = listOf("0:37.121", "0:35.399", "0:34.264"),
                lapSumAccepted = true,
                capturedAtMs = 1_786_900_100_000,
            ),
            context = AndroidScanSubmissionContext(
                submissionId = "user_submission.time.CARRYSCAN0001",
                revision = 1,
                mode = 150,
                trackId = "track.mario_kart_stadium",
                playerReference = ScanPlayerReferenceV1("player", "player.source"),
                createdAtMs = 1_786_900_160_000,
                producerVersion = "android-test",
                scanResultReference = "local-scan-result",
            ),
            assets = object : ScanLegacyAssetResolver {
                override fun resolveTire(index: Int): String? = null
                override fun resolveCountry(index: Int): String? = null
            },
        )
        val original = Json.parseToJsonElement(
            nl.mariokart8.mk8dxtimetrials.scan.encodeAndroidScanSubmission(scan),
        ).jsonObject
        val staged = androidCarriedCopy(original, AndroidCarriedFromV1(source, originalSubmittedAtMs = 1), "CARRYSCANCOPY1", 9)
        assertNull(staged["evidence"])
        assertEquals(1_786_900_100_000, staged["timestamps"]!!.jsonObject["capturedAtMs"]!!.jsonPrimitive.long)
        assertNull(staged["timestamps"]!!.jsonObject["occurredAtMs"])
        androidCompletedCarriedSubmission(staged, "player.receiver")
    }

    private fun carry(policy: () -> AndroidCarriedTimesPolicy, queue: AndroidCarriedQueue, targetOutbox: AndroidLocalTimeTrialOutbox) =
        carryAndroidResult(
            record = sent(outbox("source-${System.nanoTime()}")),
            sourceOrigin = source,
            sourceName = null,
            targetOrigin = target,
            readPolicy = policy,
            queue = queue,
            targetSubmissions = { targetOutbox.list().map { it.canonicalSubmission } },
            nowMs = 5_000,
            newOpaqueId = { "CARRYCOPY" + System.nanoTime() },
        )

    @Test fun `a community that says off gets nothing`() {
        val queue = AndroidCarriedQueue(File(temporary.root, "queue.json"))
        assertEquals(AndroidCarryOutcome.Refused, carry({ AndroidCarriedTimesPolicy.OFF }, queue, outbox("target")))
        assertEquals(0, queue.size())
    }

    @Test fun `an unreachable community gets nothing`() {
        val queue = AndroidCarriedQueue(File(temporary.root, "queue.json"))
        assertEquals(AndroidCarryOutcome.Unreachable, carry({ error("offline") }, queue, outbox("target")))
        assertEquals(0, queue.size())
    }

    @Test fun `review and allowed queue one copy, and the same run is not queued twice`() {
        val queue = AndroidCarriedQueue(File(temporary.root, "queue.json"))
        val targetOutbox = outbox("target")
        assertEquals(AndroidCarryOutcome.Queued(review = true), carry({ AndroidCarriedTimesPolicy.REVIEW }, queue, targetOutbox))
        assertEquals(AndroidCarryOutcome.AlreadyCarried, carry({ AndroidCarriedTimesPolicy.ALLOWED }, queue, targetOutbox))
        val staged = queue.list().single()
        val from = staged.carriedFromOrNull()!!
        assertEquals(source, from.origin)
        assertEquals("user_submission.time.CARRYSOURCE01", from.originalSubmissionId)
        assertEquals(2_000, from.originalSubmittedAtMs)

        // Signed in at the receiving community: the copy moves into its outbox, owned by that account.
        assertEquals(0, promoteAndroidCarriedTimes(queue, targetOutbox, "player.receiver", null, 6_000))
        assertEquals(1, promoteAndroidCarriedTimes(queue, targetOutbox, "player.receiver", slot, 6_000))
        assertEquals(0, queue.size())
        val record = targetOutbox.list().single()
        assertEquals("pending", record.state.state)
        assertEquals(slot, record.owner?.slotId)
        assertEquals("player.receiver", record.canonicalSubmission["playerReference"]!!.jsonObject["value"]!!.jsonPrimitive.content)
        // Already in the outbox there: still not carried twice.
        assertEquals(AndroidCarryOutcome.AlreadyCarried, carry({ AndroidCarriedTimesPolicy.ALLOWED }, queue, targetOutbox))
    }

    @Test fun `an unsent result is not carried`() {
        val sourceOutbox = outbox("unsent")
        val pending = AndroidOutboxSubmissionHost(sourceOutbox, AndroidOutboxClock { 1_000 }).storeManual(manual())
        val outcome = carryAndroidResult(
            pending, source, null, target, { AndroidCarriedTimesPolicy.ALLOWED },
            AndroidCarriedQueue(File(temporary.root, "q.json")), { emptyList() }, 5_000,
        )
        assertEquals(AndroidCarryOutcome.NotCarriable, outcome)
    }

    @Test fun `the receiving community's setting defaults to off`() {
        fun decode(extra: String) = AndroidInstallationSettings.decode(
            """{"schemaVersion":"mk8dx.installation-settings.v1","playerCreation":"self_only","ratingEligibility":"all_players"$extra}""",
        ).carriedTimes
        assertEquals("off", decode(""))
        assertEquals("review", decode(""","carriedTimes":"review""""))
        assertEquals("allowed", decode(""","carriedTimes":"allowed""""))
        assertEquals("off", decode(""","carriedTimes":"everything""""))
        assertEquals("off", decode(""","carriedTimes":null"""))
        assertEquals(AndroidCarriedTimesPolicy.OFF, AndroidCarriedTimesPolicy.of(null))
        assertEquals(AndroidCarriedTimesPolicy.REVIEW, AndroidCarriedTimesPolicy.of("review"))
    }

    @Test fun `the queued message names the community and the review`() {
        val text = androidCarryQueuedText(AndroidProductLanguage.ENGLISH, "online.example", review = true)
        assertTrue(text.startsWith("It is sent when you switch to online.example and are signed in there."))
        assertTrue(text.endsWith("An administrator of online.example approves it first."))
        assertFalse(androidCarryQueuedText(AndroidProductLanguage.DUTCH, "x", review = false).contains("beheerder"))
    }
}
