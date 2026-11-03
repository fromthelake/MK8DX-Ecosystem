package nl.mariokart8.mk8dxtimetrials.outbox

import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidSavedResultSynchronizationPresentationTest {
    @Test
    fun ordersNewestFirstWithStableHashTieBreakWithoutChangingRecords() {
        val older = record("b".repeat(64), 1_786_900_000_000)
        val newerSecond = record("d".repeat(64), 1_786_900_100_000)
        val newerFirst = record("c".repeat(64), 1_786_900_100_000)
        val delegate = FakeSelectionPort(listOf(older, newerSecond, newerFirst))

        val result = AndroidNewestFirstSynchronizationSelectionPort(delegate).listIndex()

        assertEquals(listOf(newerFirst, newerSecond, older), result)
        assertEquals(listOf(older, newerSecond, newerFirst), delegate.records)
    }

    @Test
    fun formatsOneBoundedStableUtcLabelWithoutExposingTheEntryHash() {
        val entry = AndroidOutboxIndexEntry(
            entryKeyHash = "a".repeat(64),
            createdAtMs = 1_786_900_100_000,
            storedState = AndroidOutboxStoredState.PENDING,
            stateRevision = 1,
            attemptCount = 0,
        )

        val label = AndroidSavedResultTimestampLabelProvider(
            TimeZone.getTimeZone("UTC"),
        ).labelFor(entry)

        assertEquals("Saved 2026-08-16 17:08:20", label)
        assertEquals(label, boundedAndroidOutboxSelectionLabel(label))
        assert(!label.contains(entry.entryKeyHash))
    }

    private fun record(
        hash: String,
        createdAtMs: Long,
    ) = AndroidCanonicalOutboxIndexRecord(
        entryKeyHash = hash,
        createdAtMs = createdAtMs,
        storedState = AndroidOutboxStoredState.PENDING,
        stateRevision = 1,
        attemptCount = 0,
    )

    private class FakeSelectionPort(
        val records: List<AndroidCanonicalOutboxIndexRecord>,
    ) : AndroidCanonicalOutboxSynchronizationSelectionPort {
        override fun listIndex(): List<AndroidCanonicalOutboxIndexRecord> = records.toList()

        override fun read(entryKey: String): AndroidLocalOutboxRecord =
            throw UnsupportedOperationException()

        override fun markFailed(
            entryKey: String,
            expectedStateRevision: Long,
            attemptedAtMs: Long,
            failureCode: String,
        ): AndroidLocalOutboxRecord = throw UnsupportedOperationException()

        override fun markSynced(
            entryKey: String,
            expectedStateRevision: Long,
            attemptedAtMs: Long,
            feedback: kotlinx.serialization.json.JsonObject?,
        ): AndroidLocalOutboxRecord = throw UnsupportedOperationException()

        override fun requestRetry(
            entryKey: String,
            expectedStateRevision: Long,
            requestedAtMs: Long,
        ): AndroidLocalOutboxRecord = throw UnsupportedOperationException()
    }
}
