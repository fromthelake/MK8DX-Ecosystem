package nl.mariokart8.mk8dxtimetrials.outbox

import java.util.concurrent.locks.ReentrantLock

/** Whether one remembered account can authenticate right now. */
internal fun interface AndroidOutboxAccountAvailability {
    fun canAuthenticate(owningSlotId: String, nowMs: Long): Boolean
}

internal enum class AndroidOutboxBatchItemOutcome {
    SYNCED,
    FAILED,
    SKIPPED,
}

internal data class AndroidOutboxBatchItemResult(
    val entryKeyHash: String,
    val owningSlotId: String?,
    val outcome: AndroidOutboxBatchItemOutcome,
    val failureCode: String? = null,
)

internal data class AndroidOutboxBatchResult(
    val items: List<AndroidOutboxBatchItemResult> = emptyList(),
    val busy: Boolean = false,
    val indexUnavailable: Boolean = false,
) {
    val syncedCount: Int
        get() = items.count { it.outcome == AndroidOutboxBatchItemOutcome.SYNCED }
    val failedCount: Int
        get() = items.count { it.outcome == AndroidOutboxBatchItemOutcome.FAILED }
    val skippedCount: Int
        get() = items.count { it.outcome == AndroidOutboxBatchItemOutcome.SKIPPED }
}

/**
 * Delivers every pending entry using each entry's own account. Entries are
 * grouped per owning slot so one account's credentials are resolved once and can
 * never be reused for a neighbouring group.
 */
internal class AndroidOutboxBatchSynchronizationController(
    private val index: AndroidCanonicalOutboxIndexPort,
    private val delivery: AndroidExplicitCanonicalOutboxDeliveryAction,
    private val accounts: AndroidOutboxAccountAvailability,
    private val clock: AndroidOutboxSynchronizationClock,
) {
    private val batchLock = ReentrantLock()

    fun synchronizeAll(): AndroidOutboxBatchResult {
        if (!batchLock.tryLock()) return AndroidOutboxBatchResult(busy = true)
        return try {
            val pending = try {
                index.listIndex().filter {
                    it.storedState == AndroidOutboxStoredState.PENDING &&
                        it.entryKeyHash.matches(synchronizationEntryKeyPattern)
                }
            } catch (_: Exception) {
                return AndroidOutboxBatchResult(indexUnavailable = true)
            }
            AndroidOutboxBatchResult(
                pending.groupBy { it.owningSlotId }.flatMap { (owningSlotId, entries) ->
                    deliverGroup(owningSlotId, entries)
                },
            )
        } finally {
            batchLock.unlock()
        }
    }

    private fun deliverGroup(
        owningSlotId: String?,
        entries: List<AndroidCanonicalOutboxIndexRecord>,
    ): List<AndroidOutboxBatchItemResult> {
        // An account that has to sign in again is skipped without an attempt, so
        // its entries stay pending instead of burning a retry they cannot win.
        val deliverable = owningSlotId != null &&
            owningSlotId.matches(androidOutboxOwningSlotIdPattern) &&
            available(owningSlotId)
        return entries.map { entry ->
            if (!deliverable) {
                AndroidOutboxBatchItemResult(
                    entryKeyHash = entry.entryKeyHash,
                    owningSlotId = owningSlotId,
                    outcome = AndroidOutboxBatchItemOutcome.SKIPPED,
                    failureCode = ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED,
                )
            } else {
                deliverEntry(entry.entryKeyHash, owningSlotId)
            }
        }
    }

    private fun deliverEntry(
        entryKeyHash: String,
        owningSlotId: String?,
    ): AndroidOutboxBatchItemResult {
        val record = try {
            delivery.deliver(entryKeyHash, clock.nowMs())
        } catch (_: Exception) {
            return AndroidOutboxBatchItemResult(
                entryKeyHash = entryKeyHash,
                owningSlotId = owningSlotId,
                outcome = AndroidOutboxBatchItemOutcome.FAILED,
            )
        }
        return AndroidOutboxBatchItemResult(
            entryKeyHash = entryKeyHash,
            owningSlotId = owningSlotId,
            outcome = if (record.state.state == "synced") {
                AndroidOutboxBatchItemOutcome.SYNCED
            } else {
                AndroidOutboxBatchItemOutcome.FAILED
            },
            failureCode = record.state.failureCode,
        )
    }

    private fun available(owningSlotId: String): Boolean = try {
        accounts.canAuthenticate(owningSlotId, clock.nowMs())
    } catch (_: Exception) {
        false
    }
}
