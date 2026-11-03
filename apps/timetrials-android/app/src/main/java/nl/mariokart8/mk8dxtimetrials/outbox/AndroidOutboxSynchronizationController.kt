package nl.mariokart8.mk8dxtimetrials.outbox

import java.util.concurrent.locks.ReentrantLock

internal const val MAX_SYNCHRONIZATION_TIMESTAMP_MS = 253_402_300_799_999L
internal val synchronizationEntryKeyPattern = Regex("^[0-9a-f]{64}$")
internal val synchronizationFailureCodePattern = Regex("^[a-z0-9]+(?:[._-][a-z0-9]+)*$")

internal fun interface AndroidOutboxSynchronizationClock {
    fun nowMs(): Long
}

internal enum class AndroidOutboxStoredState {
    PENDING,
    FAILED,
    SYNCED,
}

internal data class AndroidOutboxSynchronizationSnapshot(
    val storedState: AndroidOutboxStoredState,
    val stateRevision: Long,
    val attemptCount: Long,
    val failureCode: String? = null,
    val feedback: AndroidSubmissionFeedback? = null,
)

internal enum class AndroidOutboxSynchronizationAction {
    DELIVER,
    RETRY,
}

internal enum class AndroidOutboxSynchronizationFailureCode {
    ACTION_IN_PROGRESS,
    LOCAL_STATE_UNAVAILABLE,
    DELIVERY_REQUIRES_PENDING,
    RETRY_REQUIRES_FAILED,
    DELIVERY_UNAVAILABLE,
    RETRY_UNAVAILABLE,
}

internal sealed interface AndroidOutboxSynchronizationState {
    data object Unloaded : AndroidOutboxSynchronizationState

    data class Ready(
        val snapshot: AndroidOutboxSynchronizationSnapshot,
    ) : AndroidOutboxSynchronizationState

    data class Working(
        val action: AndroidOutboxSynchronizationAction,
        val snapshot: AndroidOutboxSynchronizationSnapshot,
    ) : AndroidOutboxSynchronizationState

    data class ActionFailed(
        val code: AndroidOutboxSynchronizationFailureCode,
        val snapshot: AndroidOutboxSynchronizationSnapshot?,
    ) : AndroidOutboxSynchronizationState
}

internal interface AndroidOutboxSynchronizationActions {
    fun load(): AndroidOutboxSynchronizationState

    fun deliver(): AndroidOutboxSynchronizationState

    fun requestRetry(): AndroidOutboxSynchronizationState
}

internal class AndroidOutboxSynchronizationController(
    private val entryKey: String,
    private val outbox: AndroidCanonicalOutboxSynchronizationPort,
    private val delivery: AndroidExplicitCanonicalOutboxDeliveryAction,
    private val clock: AndroidOutboxSynchronizationClock,
    private val onState: (AndroidOutboxSynchronizationState) -> Unit,
) : AndroidOutboxSynchronizationActions {
    private val actionLock = ReentrantLock()

    @Volatile
    private var state: AndroidOutboxSynchronizationState =
        AndroidOutboxSynchronizationState.Unloaded

    init {
        require(entryKey.matches(synchronizationEntryKeyPattern)) {
            "Android synchronization entry key is invalid."
        }
    }

    fun currentState(): AndroidOutboxSynchronizationState = state

    override fun load(): AndroidOutboxSynchronizationState {
        if (!actionLock.tryLock()) return busyResult()
        return try {
            val snapshot = readSnapshot()
                ?: return emitUnavailable(AndroidOutboxSynchronizationFailureCode.LOCAL_STATE_UNAVAILABLE)
            emit(AndroidOutboxSynchronizationState.Ready(snapshot))
        } finally {
            actionLock.unlock()
        }
    }

    override fun deliver(): AndroidOutboxSynchronizationState = perform(
        action = AndroidOutboxSynchronizationAction.DELIVER,
        requiredState = AndroidOutboxStoredState.PENDING,
        invalidStateCode = AndroidOutboxSynchronizationFailureCode.DELIVERY_REQUIRES_PENDING,
        operationFailureCode = AndroidOutboxSynchronizationFailureCode.DELIVERY_UNAVAILABLE,
    ) {
        delivery.deliver(entryKey, clock.nowMs())
    }

    override fun requestRetry(): AndroidOutboxSynchronizationState = perform(
        action = AndroidOutboxSynchronizationAction.RETRY,
        requiredState = AndroidOutboxStoredState.FAILED,
        invalidStateCode = AndroidOutboxSynchronizationFailureCode.RETRY_REQUIRES_FAILED,
        operationFailureCode = AndroidOutboxSynchronizationFailureCode.RETRY_UNAVAILABLE,
    ) { before ->
        outbox.requestRetry(entryKey, before.stateRevision, clock.nowMs())
    }

    private fun perform(
        action: AndroidOutboxSynchronizationAction,
        requiredState: AndroidOutboxStoredState,
        invalidStateCode: AndroidOutboxSynchronizationFailureCode,
        operationFailureCode: AndroidOutboxSynchronizationFailureCode,
        operation: (AndroidOutboxSynchronizationSnapshot) -> AndroidLocalOutboxRecord,
    ): AndroidOutboxSynchronizationState {
        if (!actionLock.tryLock()) return busyResult()
        return try {
            val before = readSnapshot()
                ?: return emitUnavailable(AndroidOutboxSynchronizationFailureCode.LOCAL_STATE_UNAVAILABLE)
            if (before.storedState != requiredState) {
                return emit(
                    AndroidOutboxSynchronizationState.ActionFailed(
                        invalidStateCode,
                        before,
                    ),
                )
            }
            emit(AndroidOutboxSynchronizationState.Working(action, before))
            val record = try {
                operation(before)
            } catch (_: Exception) {
                return emit(
                    AndroidOutboxSynchronizationState.ActionFailed(
                        operationFailureCode,
                        recoverSnapshot(before),
                    ),
                )
            }
            val after = project(record)
                ?: return emitUnavailable(
                    AndroidOutboxSynchronizationFailureCode.LOCAL_STATE_UNAVAILABLE,
                    recoverSnapshot(before),
                )
            emit(AndroidOutboxSynchronizationState.Ready(after))
        } finally {
            actionLock.unlock()
        }
    }

    private fun readSnapshot(): AndroidOutboxSynchronizationSnapshot? = try {
        project(outbox.read(entryKey))
    } catch (_: Exception) {
        null
    }

    private fun recoverSnapshot(
        fallback: AndroidOutboxSynchronizationSnapshot,
    ): AndroidOutboxSynchronizationSnapshot = readSnapshot() ?: fallback

    private fun project(
        record: AndroidLocalOutboxRecord,
    ): AndroidOutboxSynchronizationSnapshot? {
        val storedState = when (record.state.state) {
            "pending" -> AndroidOutboxStoredState.PENDING
            "failed" -> AndroidOutboxStoredState.FAILED
            "synced" -> AndroidOutboxStoredState.SYNCED
            else -> return null
        }
        val failureCode = record.state.failureCode
        if (
            record.entry.entryKey != entryKey ||
            record.state.entryKey != entryKey ||
            record.state.stateRevision !in 1..LOCAL_OUTBOX_MAX_STATE_REVISIONS.toLong() ||
            record.state.attemptCount !in 0L until record.state.stateRevision ||
            record.state.updatedAtMs !in 0..MAX_SYNCHRONIZATION_TIMESTAMP_MS ||
            (storedState == AndroidOutboxStoredState.FAILED) != (failureCode != null) ||
            (failureCode != null && (
                failureCode.length !in 1..64 ||
                    !failureCode.matches(synchronizationFailureCodePattern)
                )) ||
            (storedState == AndroidOutboxStoredState.SYNCED) !=
            (record.state.syncedAtMs != null)
        ) {
            return null
        }
        return AndroidOutboxSynchronizationSnapshot(
            storedState = storedState,
            stateRevision = record.state.stateRevision,
            attemptCount = record.state.attemptCount,
            failureCode = failureCode,
            feedback = androidSubmissionFeedbackOrNull(record.state.feedback),
        )
    }

    private fun emitUnavailable(
        code: AndroidOutboxSynchronizationFailureCode,
        snapshot: AndroidOutboxSynchronizationSnapshot? = snapshotFrom(state),
    ): AndroidOutboxSynchronizationState = emit(
        AndroidOutboxSynchronizationState.ActionFailed(code, snapshot),
    )

    private fun busyResult(): AndroidOutboxSynchronizationState =
        AndroidOutboxSynchronizationState.ActionFailed(
            AndroidOutboxSynchronizationFailureCode.ACTION_IN_PROGRESS,
            snapshotFrom(state),
        )

    private fun emit(next: AndroidOutboxSynchronizationState): AndroidOutboxSynchronizationState {
        state = next
        onState(next)
        return next
    }
}

private fun snapshotFrom(
    state: AndroidOutboxSynchronizationState,
): AndroidOutboxSynchronizationSnapshot? = when (state) {
    AndroidOutboxSynchronizationState.Unloaded -> null
    is AndroidOutboxSynchronizationState.Ready -> state.snapshot
    is AndroidOutboxSynchronizationState.Working -> state.snapshot
    is AndroidOutboxSynchronizationState.ActionFailed -> state.snapshot
}
