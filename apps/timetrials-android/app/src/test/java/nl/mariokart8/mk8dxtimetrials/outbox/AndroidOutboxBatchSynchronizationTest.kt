package nl.mariokart8.mk8dxtimetrials.outbox

import java.io.File
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AndroidOutboxBatchSynchronizationTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val createdAtMs = 1_786_901_000_000L
    private val attemptedAtMs = createdAtMs + 1_000
    private val slotA = "slot." + "a".repeat(32)
    private val slotB = "slot." + "b".repeat(32)

    private fun outbox(): AndroidLocalTimeTrialOutbox {
        val parent = temporary.newFolder()
        return AndroidLocalTimeTrialOutbox(
            File(parent, "canonical"),
            File(parent, "private"),
            AndroidProducedSubmissionValidator,
            AndroidExclusiveFileInstaller { source, target ->
                try {
                    Files.createLink(target.toPath(), source.toPath())
                } catch (_: FileAlreadyExistsException) {
                    throw AndroidLocalOutboxConflictException(
                        "Local outbox entry already exists.",
                    )
                }
            },
            AndroidDirectorySync {},
        )
    }

    private fun store(
        outbox: AndroidLocalTimeTrialOutbox,
        owningSlotId: String?,
        suffix: String,
    ): String = AndroidOutboxSubmissionHost(
        outbox,
        AndroidOutboxClock { createdAtMs },
        owningSlot = { owningSlotId },
    ).storeManual(
        createAndroidManualSubmission(
            AndroidManualSubmissionContext(
                submissionId = "user_submission.time.ANDROIDBATCH$suffix",
                revision = 1,
                trackId = "track.mario_kart_stadium",
                playerReference = ManualPlayerReferenceV1(
                    "producer_local_profile",
                    "batch-profile-$suffix",
                ),
                createdAtMs = createdAtMs,
                producerVersion = "android-batch-test",
            ),
            mode = 150,
            timeDigits = "123456",
        ),
    ).entry.entryKey

    private fun acknowledgement(submission: JsonObject): JsonObject = buildJsonObject {
        put("submissionId", submission.getValue("submissionId"))
        put("revision", submission.getValue("revision"))
    }

    @Test
    fun groupsPendingEntriesPerAccountAndUsesEachAccountsOwnTransport() {
        val outbox = outbox()
        val firstOfA = store(outbox, slotA, "A1")
        val ofB = store(outbox, slotB, "B1")
        val secondOfA = store(outbox, slotA, "A2")
        val transportsPerSlot = mutableListOf<String>()
        val submittedBySlot = mutableMapOf<String, MutableList<String>>()
        val delivery = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            { owningSlotId ->
                transportsPerSlot += owningSlotId
                AndroidAuthenticatedCanonicalSubmissionTransport { submission ->
                    submittedBySlot.getOrPut(owningSlotId) { mutableListOf() } +=
                        submission.getValue("submissionId").toString()
                    acknowledgement(submission)
                }
            },
            AndroidReviewedEvidenceReferenceAllowlist { true },
        )

        val result = AndroidOutboxBatchSynchronizationController(
            index = outbox,
            delivery = delivery,
            accounts = { _, _ -> true },
            clock = { attemptedAtMs },
        ).synchronizeAll()

        assertEquals(3, result.syncedCount)
        assertEquals(0, result.failedCount)
        assertEquals(0, result.skippedCount)
        assertEquals(setOf(slotA, slotB), transportsPerSlot.toSet())
        assertEquals(2, submittedBySlot.getValue(slotA).size)
        assertEquals(1, submittedBySlot.getValue(slotB).size)
        listOf(firstOfA, ofB, secondOfA).forEach { entryKey ->
            assertEquals("synced", outbox.read(entryKey).state.state)
        }
        // Entries stayed grouped: nothing crossed between the two accounts.
        assertTrue(
            submittedBySlot.getValue(slotB).none { it.contains("ANDROIDBATCHA") },
        )
    }

    @Test
    fun skipsAccountsThatMustSignInAgainAndLeavesTheirEntriesPending() {
        val outbox = outbox()
        val ofA = store(outbox, slotA, "A1")
        val ofB = store(outbox, slotB, "B1")
        val orphan = store(outbox, null, "N1")
        var deliveries = 0
        val delivery = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            { owningSlotId ->
                AndroidAuthenticatedCanonicalSubmissionTransport { submission ->
                    deliveries += 1
                    acknowledgement(submission)
                }.takeIf { owningSlotId == slotA }
            },
            AndroidReviewedEvidenceReferenceAllowlist { true },
        )

        val result = AndroidOutboxBatchSynchronizationController(
            index = outbox,
            delivery = delivery,
            accounts = { owningSlotId, _ -> owningSlotId == slotA },
            clock = { attemptedAtMs },
        ).synchronizeAll()

        assertEquals(1, result.syncedCount)
        assertEquals(2, result.skippedCount)
        assertEquals(1, deliveries)
        assertEquals("synced", outbox.read(ofA).state.state)
        // Skipped entries keep their pending state and their owner binding.
        assertEquals("pending", outbox.read(ofB).state.state)
        assertEquals(1L, outbox.read(ofB).state.stateRevision)
        assertEquals(slotB, outbox.read(ofB).owner?.slotId)
        assertEquals("pending", outbox.read(orphan).state.state)
        assertEquals(
            listOf(ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED),
            result.items
                .filter { it.outcome == AndroidOutboxBatchItemOutcome.SKIPPED }
                .map { it.failureCode }
                .distinct(),
        )
    }

    @Test
    fun recordsPerItemFailuresWithoutStoppingTheBatch() {
        val outbox = outbox()
        val first = store(outbox, slotA, "A1")
        val second = store(outbox, slotA, "A2")
        val delivery = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            {
                AndroidAuthenticatedCanonicalSubmissionTransport { submission ->
                    if (submission.getValue("submissionId").toString().contains("A1")) {
                        throw AndroidCanonicalDeliveryTransportException("http.unavailable")
                    }
                    acknowledgement(submission)
                }
            },
            AndroidReviewedEvidenceReferenceAllowlist { true },
        )

        val result = AndroidOutboxBatchSynchronizationController(
            index = outbox,
            delivery = delivery,
            accounts = { _, _ -> true },
            clock = { attemptedAtMs },
        ).synchronizeAll()

        assertEquals(1, result.syncedCount)
        assertEquals(1, result.failedCount)
        assertEquals(2, result.items.size)
        assertEquals("failed", outbox.read(first).state.state)
        assertEquals("http.unavailable", outbox.read(first).state.failureCode)
        assertEquals("synced", outbox.read(second).state.state)
    }

    @Test
    fun reportsAnUnavailableIndexWithoutAttemptingDelivery() {
        var deliveries = 0
        val result = AndroidOutboxBatchSynchronizationController(
            index = { throw AndroidLocalOutboxIoException("Local outbox read failed.") },
            delivery = { _, _ ->
                deliveries += 1
                error("delivery must not run")
            },
            accounts = { _, _ -> true },
            clock = { attemptedAtMs },
        ).synchronizeAll()

        assertTrue(result.indexUnavailable)
        assertEquals(emptyList<AndroidOutboxBatchItemResult>(), result.items)
        assertEquals(0, deliveries)
    }
}
