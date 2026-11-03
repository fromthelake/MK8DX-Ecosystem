package nl.mariokart8.mk8dxtimetrials.outbox

import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Test

class AndroidOutboxSelectionCoordinatorTest {
    private val keyA = "a".repeat(64)
    private val keyB = "b".repeat(64)
    private val keyC = "c".repeat(64)
    private val binding = AndroidOutboxSynchronizationBinding(
        AndroidOutboxSynchronizationActionsFactory { error("binding must remain opaque") },
    )

    @Test
    fun rejectsLoadingUnloadedAndUnavailableIndexesBeforeBindingConstruction() {
        val calls = AtomicInteger(0)
        val coordinator = AndroidOutboxSelectionCoordinator {
            calls.incrementAndGet()
            binding
        }

        assertEquals(
            failed(AndroidOutboxSelectionFailureCode.INDEX_LOAD_IN_PROGRESS),
            coordinator.select(ready(entry(keyA)), true, keyA),
        )
        assertEquals(
            failed(AndroidOutboxSelectionFailureCode.INDEX_NOT_LOADED),
            coordinator.select(AndroidOutboxIndexState.Unloaded, false, keyA),
        )
        assertEquals(
            failed(AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE),
            coordinator.select(
                AndroidOutboxIndexState.Unavailable(
                    AndroidOutboxIndexFailureCode.LOCAL_INDEX_UNAVAILABLE,
                ),
                false,
                keyA,
            ),
        )
        assertEquals(0, calls.get())
    }

    @Test
    fun delegatesEveryExplicitlyChosenStoredStateWithoutFilteringOrDefaulting() {
        val observedKeys = mutableListOf<String>()
        val coordinator = AndroidOutboxSelectionCoordinator { key ->
            observedKeys += key
            binding
        }
        val state = ready(
            entry(keyA),
            entry(
                keyB,
                state = AndroidOutboxStoredState.FAILED,
                revision = 2,
                attempts = 1,
                failureCode = "api.unavailable",
            ),
            entry(
                keyC,
                state = AndroidOutboxStoredState.SYNCED,
                revision = 2,
                attempts = 1,
            ),
        )

        listOf(keyC, keyA, keyB).forEach { key ->
            val result = coordinator.select(state, false, key)
                as AndroidOutboxSelectionResult.Selected
            assertSame(binding, result.binding)
        }

        assertEquals(listOf(keyC, keyA, keyB), observedKeys)
    }

    @Test
    fun rejectsInvalidOrAbsentCallerChoiceWithoutCallingTheFactory() {
        val calls = AtomicInteger(0)
        val coordinator = AndroidOutboxSelectionCoordinator {
            calls.incrementAndGet()
            binding
        }

        assertEquals(
            failed(AndroidOutboxSelectionFailureCode.ENTRY_NOT_FOUND),
            coordinator.select(ready(entry(keyA)), false, "A".repeat(64)),
        )
        assertEquals(
            failed(AndroidOutboxSelectionFailureCode.ENTRY_NOT_FOUND),
            coordinator.select(ready(entry(keyA)), false, keyB),
        )
        assertEquals(0, calls.get())
    }

    @Test
    fun failsClosedForMalformedOrDuplicateReadyIndexes() {
        val baseline = entry(keyA)
        val malformed = listOf(
            listOf(baseline, baseline.copy()),
            listOf(baseline.copy(entryKeyHash = "A".repeat(64))),
            listOf(baseline.copy(createdAtMs = -1)),
            listOf(baseline.copy(stateRevision = 0)),
            listOf(baseline.copy(attemptCount = 1)),
            listOf(baseline.copy(failureCode = "unexpected")),
            List(ANDROID_OUTBOX_INDEX_MAX_ENTRIES + 1) { index ->
                entry(index.toString(16).padStart(64, '0'))
            },
            object : AbstractList<AndroidOutboxIndexEntry>() {
                override val size: Int = 1

                override fun get(index: Int): AndroidOutboxIndexEntry =
                    error("private://broken-index")
            },
        )
        val coordinator = AndroidOutboxSelectionCoordinator { binding }

        malformed.forEachIndexed { index, entries ->
            assertEquals(
                "malformed variant $index",
                failed(AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE),
                coordinator.select(AndroidOutboxIndexState.Ready(entries), false, keyA),
            )
        }
        assertEquals(
            failed(AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE),
            coordinator.select(
                AndroidOutboxIndexState.Ready(listOf(baseline.copy(createdAtMs = -1))),
                false,
                "A".repeat(64),
            ),
        )
    }

    @Test
    fun redactsBindingFactoryFailure() {
        val coordinator = AndroidOutboxSelectionCoordinator {
            error("private://transport/configuration")
        }

        val result = coordinator.select(ready(entry(keyA)), false, keyA)

        assertEquals(failed(AndroidOutboxSelectionFailureCode.BINDING_UNAVAILABLE), result)
        assertFalse(result.toString().contains("private://"))
        assertFalse(result.toString().contains("transport"))
    }

    private fun entry(
        key: String,
        state: AndroidOutboxStoredState = AndroidOutboxStoredState.PENDING,
        revision: Long = 1,
        attempts: Long = 0,
        failureCode: String? = null,
    ) = AndroidOutboxIndexEntry(
        entryKeyHash = key,
        createdAtMs = 1_786_900_000_000,
        storedState = state,
        stateRevision = revision,
        attemptCount = attempts,
        failureCode = failureCode,
    )

    private fun ready(
        vararg entries: AndroidOutboxIndexEntry,
    ) = AndroidOutboxIndexState.Ready(entries.toList())

    private fun failed(
        code: AndroidOutboxSelectionFailureCode,
    ) = AndroidOutboxSelectionResult.Failed(code)
}
