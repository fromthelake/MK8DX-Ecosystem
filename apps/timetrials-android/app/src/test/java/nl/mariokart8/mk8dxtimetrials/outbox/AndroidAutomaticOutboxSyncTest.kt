package nl.mariokart8.mk8dxtimetrials.outbox

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission

class AndroidAutomaticOutboxSyncTest {
    @get:Rule val temporary = TemporaryFolder()

    /**
     * The commonest way a saved time went nowhere: the session expired between
     * saving the result and delivering it, the entry failed once with 401, and
     * nothing ever re-drove it - not even signing in again, which does enqueue
     * a sync. It sat in the outbox looking saved and never arrived.
     */
    @Test
    fun anExpiredSessionIsRetriedOnTheNextSync() {
        val outbox = outbox()
        val key = stored(outbox)
        outbox.markFailed(key, 1, 1_001, ANDROID_CANONICAL_TRANSPORT_NOT_AUTHENTICATED)
        var observedPending = false
        AndroidAutomaticOutboxSynchronizer(
            outbox,
            synchronizeBatch = {
                observedPending = outbox.listIndex().single().storedState ==
                    AndroidOutboxStoredState.PENDING
                AndroidOutboxBatchResult()
            },
            clock = AndroidOutboxSynchronizationClock { 1_002 },
        ).synchronize()
        assertTrue(observedPending)
    }

    @Test
    fun aGarbledResponseIsRetriedOnTheNextSync() {
        val outbox = outbox()
        val key = stored(outbox)
        outbox.markFailed(key, 1, 1_001, ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID)
        var observedPending = false
        AndroidAutomaticOutboxSynchronizer(
            outbox,
            synchronizeBatch = {
                observedPending = outbox.listIndex().single().storedState ==
                    AndroidOutboxStoredState.PENDING
                AndroidOutboxBatchResult()
            },
            clock = AndroidOutboxSynchronizationClock { 1_002 },
        ).synchronize()
        assertTrue(observedPending)
    }

    /**
     * A rejected payload, a conflicting revision and an account that may not do
     * this are not transient. Retrying them forever would hide a decision a
     * person has to make, so they stay failed and stay visible.
     */
    @Test
    fun aFailureOnlyAPersonCanResolveIsNeverRetriedByItself() {
        for (code in listOf(
            ANDROID_CANONICAL_TRANSPORT_NOT_AUTHORIZED,
            ANDROID_CANONICAL_TRANSPORT_REVISION_CONFLICT,
            ANDROID_CANONICAL_TRANSPORT_SUBMISSION_REJECTED,
        )) {
            val outbox = outbox()
            val key = stored(outbox)
            outbox.markFailed(key, 1, 1_001, code)
            AndroidAutomaticOutboxSynchronizer(
                outbox,
                synchronizeBatch = { AndroidOutboxBatchResult() },
                clock = AndroidOutboxSynchronizationClock { 1_002 },
            ).synchronize()
            assertEquals(
                "$code must stay failed",
                AndroidOutboxStoredState.FAILED,
                outbox.listIndex().single().storedState,
            )
        }
    }

    @Test
    fun transientFailureIsPreparedBeforeAutomaticDelivery() {
        val outbox = outbox()
        val key = stored(outbox)
        outbox.markFailed(key, 1, 1_001, ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE)
        var observedPending = false
        val result = AndroidAutomaticOutboxSynchronizer(
            outbox,
            synchronizeBatch = {
                observedPending = outbox.listIndex().single().storedState ==
                    AndroidOutboxStoredState.PENDING
                AndroidOutboxBatchResult()
            },
            clock = AndroidOutboxSynchronizationClock { 1_002 },
        ).synchronize()
        assertTrue(observedPending)
        assertEquals(AndroidAutomaticSyncOutcome.COMPLETE, result)
    }

    @Test
    fun newTransientFailureIsLeftPendingForWorkManagerBackoff() {
        val outbox = outbox()
        val key = stored(outbox)
        val result = AndroidAutomaticOutboxSynchronizer(
            outbox,
            synchronizeBatch = {
                val pending = outbox.listIndex().single()
                outbox.markFailed(
                    key,
                    pending.stateRevision,
                    1_001,
                    ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE,
                )
                AndroidOutboxBatchResult(
                    items = listOf(
                        AndroidOutboxBatchItemResult(
                            key,
                            pending.owningSlotId,
                            AndroidOutboxBatchItemOutcome.FAILED,
                            ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE,
                        ),
                    ),
                )
            },
            clock = AndroidOutboxSynchronizationClock { 1_002 },
        ).synchronize()
        assertEquals(AndroidAutomaticSyncOutcome.RETRY, result)
        assertEquals(AndroidOutboxStoredState.PENDING, outbox.listIndex().single().storedState)
    }

    private fun outbox() = AndroidLocalTimeTrialOutbox(
        File(temporary.root, "canonical-${System.nanoTime()}"),
        File(temporary.root, "evidence-${System.nanoTime()}"),
        AndroidProducedSubmissionValidator,
    )

    private fun stored(outbox: AndroidLocalTimeTrialOutbox): String {
        val submission = createAndroidManualSubmission(
            AndroidManualSubmissionContext(
                submissionId = "user_submission.time.AUTOSYNC001",
                revision = 1,
                trackId = "track.mario_kart_stadium",
                playerReference = ManualPlayerReferenceV1("player", "player.ben"),
                createdAtMs = 1_000,
                producerVersion = "android-test",
            ),
            150,
            "130000",
        )
        return AndroidOutboxSubmissionHost(
            outbox,
            AndroidOutboxClock { 1_000 },
        ).storeManual(submission).entry.entryKey
    }
}
