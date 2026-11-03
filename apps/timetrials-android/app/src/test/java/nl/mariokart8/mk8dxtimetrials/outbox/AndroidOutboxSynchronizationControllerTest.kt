package nl.mariokart8.mk8dxtimetrials.outbox

import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidOutboxSynchronizationControllerTest {
    private val entryKey = "a".repeat(64)
    private val nowMs = 1_786_900_600_000L

    private fun record(
        state: String = "pending",
        stateRevision: Long = 1,
        attemptCount: Long = 0,
        failureCode: String? = null,
        syncedAtMs: Long? = null,
        recordEntryKey: String = entryKey,
        stateEntryKey: String = entryKey,
    ) = AndroidLocalOutboxRecord(
        entry = AndroidLocalOutboxEntryV1(
            entryKey = recordEntryKey,
            submissionSha256 = "b".repeat(64),
            createdAtMs = nowMs - 1_000,
            privateEvidencePresent = true,
        ),
        canonicalSubmission = buildJsonObject {
            put("submissionId", "user_submission.time.SYNCHRONIZATION01")
            put("privateCanonicalDetail", "must not reach presentation")
        },
        state = AndroidLocalOutboxStateV1(
            entryKey = stateEntryKey,
            stateRevision = stateRevision,
            state = state,
            attemptCount = attemptCount,
            updatedAtMs = nowMs - 500,
            lastAttemptAtMs = (nowMs - 500).takeIf { attemptCount > 0 },
            failureCode = failureCode,
            syncedAtMs = syncedAtMs,
        ),
    )

    private class FakeSynchronizationOutbox(
        var current: AndroidLocalOutboxRecord,
    ) : AndroidCanonicalOutboxSynchronizationPort {
        var readFailure = false
        var retryFailure = false
        var retryCalls = 0
        var lastRetryRevision: Long? = null
        var lastRetryAtMs: Long? = null

        override fun read(entryKey: String): AndroidLocalOutboxRecord {
            if (readFailure) error("private local path")
            return current
        }

        override fun requestRetry(
            entryKey: String,
            expectedStateRevision: Long,
            requestedAtMs: Long,
        ): AndroidLocalOutboxRecord {
            retryCalls += 1
            lastRetryRevision = expectedStateRevision
            lastRetryAtMs = requestedAtMs
            if (retryFailure) error("private retry detail")
            check(current.state.state == "failed")
            check(current.state.stateRevision == expectedStateRevision)
            current = current.copy(
                state = current.state.copy(
                    stateRevision = expectedStateRevision + 1,
                    state = "pending",
                    updatedAtMs = requestedAtMs,
                    lastAttemptAtMs = null,
                    failureCode = null,
                ),
            )
            return current
        }
    }

    private fun controller(
        outbox: FakeSynchronizationOutbox,
        delivery: AndroidExplicitCanonicalOutboxDeliveryAction,
        states: MutableList<AndroidOutboxSynchronizationState> = mutableListOf(),
    ) = AndroidOutboxSynchronizationController(
        entryKey = entryKey,
        outbox = outbox,
        delivery = delivery,
        clock = AndroidOutboxSynchronizationClock { nowMs },
        onState = states::add,
    )

    @Test
    fun loadProjectsOnlyBoundedLocalState() {
        val outbox = FakeSynchronizationOutbox(record())
        val states = mutableListOf<AndroidOutboxSynchronizationState>()
        val controller = controller(
            outbox,
            AndroidExplicitCanonicalOutboxDeliveryAction { _, _ -> error("unused") },
            states,
        )

        val result = controller.load()

        assertEquals(
            AndroidOutboxSynchronizationState.Ready(
                AndroidOutboxSynchronizationSnapshot(
                    AndroidOutboxStoredState.PENDING,
                    stateRevision = 1,
                    attemptCount = 0,
                ),
            ),
            result,
        )
        assertEquals(result, controller.currentState())
        assertEquals(listOf(result), states)
        assertFalse(result.toString().contains(entryKey))
        assertFalse(result.toString().contains("submission", ignoreCase = true))
        assertFalse(result.toString().contains("private", ignoreCase = true))
    }

    @Test
    fun deliveryEmitsWorkingThenExactSyncedProjection() {
        val outbox = FakeSynchronizationOutbox(record())
        val states = mutableListOf<AndroidOutboxSynchronizationState>()
        var deliveredKey: String? = null
        var deliveredAtMs: Long? = null
        val result = controller(
            outbox,
            AndroidExplicitCanonicalOutboxDeliveryAction { key, attemptedAtMs ->
                deliveredKey = key
                deliveredAtMs = attemptedAtMs
                outbox.current = record(
                    state = "synced",
                    stateRevision = 2,
                    attemptCount = 1,
                    syncedAtMs = attemptedAtMs,
                )
                outbox.current
            },
            states,
        ).deliver()

        assertEquals(entryKey, deliveredKey)
        assertEquals(nowMs, deliveredAtMs)
        assertEquals(2, states.size)
        assertEquals(
            AndroidOutboxSynchronizationState.Working(
                AndroidOutboxSynchronizationAction.DELIVER,
                AndroidOutboxSynchronizationSnapshot(
                    AndroidOutboxStoredState.PENDING,
                    1,
                    0,
                ),
            ),
            states.first(),
        )
        assertEquals(
            AndroidOutboxSynchronizationState.Ready(
                AndroidOutboxSynchronizationSnapshot(
                    AndroidOutboxStoredState.SYNCED,
                    2,
                    1,
                ),
            ),
            result,
        )
    }

    @Test
    fun boundedDeliveryFailureRemainsAReadyStoredState() {
        val outbox = FakeSynchronizationOutbox(record())
        val result = controller(
            outbox,
            AndroidExplicitCanonicalOutboxDeliveryAction { _, attemptedAtMs ->
                val failed = record(
                    state = "failed",
                    stateRevision = 2,
                    attemptCount = 1,
                    failureCode = "transport.failed",
                )
                outbox.current = failed.copy(
                    state = failed.state.copy(updatedAtMs = attemptedAtMs),
                )
                outbox.current
            },
        ).deliver()

        assertEquals(
            AndroidOutboxSynchronizationState.Ready(
                AndroidOutboxSynchronizationSnapshot(
                    AndroidOutboxStoredState.FAILED,
                    2,
                    1,
                    "transport.failed",
                ),
            ),
            result,
        )
    }

    @Test
    fun deliveryAndRetryAreDistinctGuardedActions() {
        val outbox = FakeSynchronizationOutbox(
            record(
                state = "failed",
                stateRevision = 2,
                attemptCount = 1,
                failureCode = "transport.failed",
            ),
        )
        var deliveryCalls = 0
        val controller = controller(
            outbox,
            AndroidExplicitCanonicalOutboxDeliveryAction { _, _ ->
                deliveryCalls += 1
                outbox.current
            },
        )

        val invalidDelivery = controller.deliver()
        assertEquals(
            AndroidOutboxSynchronizationFailureCode.DELIVERY_REQUIRES_PENDING,
            (invalidDelivery as AndroidOutboxSynchronizationState.ActionFailed).code,
        )
        assertEquals(0, deliveryCalls)

        val retry = controller.requestRetry()
        assertEquals(
            AndroidOutboxStoredState.PENDING,
            (retry as AndroidOutboxSynchronizationState.Ready).snapshot.storedState,
        )
        assertEquals(1, outbox.retryCalls)
        assertEquals(2L, outbox.lastRetryRevision)
        assertEquals(nowMs, outbox.lastRetryAtMs)

        val secondRetry = controller.requestRetry()
        assertEquals(
            AndroidOutboxSynchronizationFailureCode.RETRY_REQUIRES_FAILED,
            (secondRetry as AndroidOutboxSynchronizationState.ActionFailed).code,
        )
        assertEquals(1, outbox.retryCalls)
    }

    @Test
    fun syncedEntriesRejectBothActionsWithoutSideEffects() {
        val outbox = FakeSynchronizationOutbox(
            record(
                state = "synced",
                stateRevision = 2,
                attemptCount = 1,
                syncedAtMs = nowMs - 500,
            ),
        )
        var deliveryCalls = 0
        val controller = controller(
            outbox,
            AndroidExplicitCanonicalOutboxDeliveryAction { _, _ ->
                deliveryCalls += 1
                outbox.current
            },
        )

        assertEquals(
            AndroidOutboxSynchronizationFailureCode.DELIVERY_REQUIRES_PENDING,
            (controller.deliver() as AndroidOutboxSynchronizationState.ActionFailed).code,
        )
        assertEquals(
            AndroidOutboxSynchronizationFailureCode.RETRY_REQUIRES_FAILED,
            (controller.requestRetry() as AndroidOutboxSynchronizationState.ActionFailed).code,
        )
        assertEquals(0, deliveryCalls)
        assertEquals(0, outbox.retryCalls)
    }

    @Test
    fun storageAndActionExceptionsRemainBounded() {
        val unreadable = FakeSynchronizationOutbox(record()).also { it.readFailure = true }
        val loadFailure = controller(
            unreadable,
            AndroidExplicitCanonicalOutboxDeliveryAction { _, _ -> error("unused") },
        ).load()
        assertEquals(
            AndroidOutboxSynchronizationFailureCode.LOCAL_STATE_UNAVAILABLE,
            (loadFailure as AndroidOutboxSynchronizationState.ActionFailed).code,
        )
        assertFalse(loadFailure.toString().contains("private", ignoreCase = true))

        val deliveryOutbox = FakeSynchronizationOutbox(record())
        val deliveryFailure = controller(
            deliveryOutbox,
            AndroidExplicitCanonicalOutboxDeliveryAction { _, _ ->
                error("private response body")
            },
        ).deliver()
        assertEquals(
            AndroidOutboxSynchronizationFailureCode.DELIVERY_UNAVAILABLE,
            (deliveryFailure as AndroidOutboxSynchronizationState.ActionFailed).code,
        )
        assertFalse(deliveryFailure.toString().contains("private", ignoreCase = true))

        val retryOutbox = FakeSynchronizationOutbox(
            record(
                state = "failed",
                stateRevision = 2,
                attemptCount = 1,
                failureCode = "transport.failed",
            ),
        ).also { it.retryFailure = true }
        val retryFailure = controller(
            retryOutbox,
            AndroidExplicitCanonicalOutboxDeliveryAction { _, _ -> error("unused") },
        ).requestRetry()
        assertEquals(
            AndroidOutboxSynchronizationFailureCode.RETRY_UNAVAILABLE,
            (retryFailure as AndroidOutboxSynchronizationState.ActionFailed).code,
        )
        assertFalse(retryFailure.toString().contains("private", ignoreCase = true))
    }

    @Test
    fun concurrentActionIsRejectedWithoutReplacingWorkingPresentation() {
        val outbox = FakeSynchronizationOutbox(record())
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val states = Collections.synchronizedList(
            mutableListOf<AndroidOutboxSynchronizationState>(),
        )
        val controller = controller(
            outbox,
            AndroidExplicitCanonicalOutboxDeliveryAction { _, attemptedAtMs ->
                started.countDown()
                assertTrue(release.await(5, TimeUnit.SECONDS))
                outbox.current = record(
                    state = "synced",
                    stateRevision = 2,
                    attemptCount = 1,
                    syncedAtMs = attemptedAtMs,
                )
                outbox.current
            },
            states,
        )
        val executor = Executors.newSingleThreadExecutor()
        try {
            val delivery = executor.submit<AndroidOutboxSynchronizationState> {
                controller.deliver()
            }
            assertTrue(started.await(5, TimeUnit.SECONDS))

            val rejected = controller.requestRetry()
            assertEquals(
                AndroidOutboxSynchronizationFailureCode.ACTION_IN_PROGRESS,
                (rejected as AndroidOutboxSynchronizationState.ActionFailed).code,
            )
            assertEquals(
                AndroidOutboxSynchronizationAction.DELIVER,
                (controller.currentState() as AndroidOutboxSynchronizationState.Working).action,
            )
            assertFalse(states.any {
                it is AndroidOutboxSynchronizationState.ActionFailed &&
                    it.code == AndroidOutboxSynchronizationFailureCode.ACTION_IN_PROGRESS
            })

            release.countDown()
            assertTrue(
                delivery.get(10, TimeUnit.SECONDS) is AndroidOutboxSynchronizationState.Ready,
            )
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun malformedRecordsFailClosedBeforeEitherAction() {
        val malformed = listOf(
            record(recordEntryKey = "c".repeat(64)),
            record(stateEntryKey = "c".repeat(64)),
            record(state = "unknown"),
            record(
                state = "failed",
                stateRevision = 2,
                attemptCount = 1,
                failureCode = "private detail",
            ),
            record(
                state = "synced",
                stateRevision = 2,
                attemptCount = 1,
            ),
        )
        malformed.forEach { record ->
            var deliveryCalls = 0
            val outbox = FakeSynchronizationOutbox(record)
            val result = controller(
                outbox,
                AndroidExplicitCanonicalOutboxDeliveryAction { _, _ ->
                    deliveryCalls += 1
                    outbox.current
                },
            ).deliver()
            assertEquals(
                AndroidOutboxSynchronizationFailureCode.LOCAL_STATE_UNAVAILABLE,
                (result as AndroidOutboxSynchronizationState.ActionFailed).code,
            )
            assertEquals(0, deliveryCalls)
            assertEquals(0, outbox.retryCalls)
        }
    }
}
