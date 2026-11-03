package nl.mariokart8.mk8dxtimetrials.outbox

internal fun interface AndroidOutboxSynchronizationBindingFactory {
    fun create(entryKeyHash: String): AndroidOutboxSynchronizationBinding
}

internal enum class AndroidOutboxSelectionFailureCode {
    INDEX_LOAD_IN_PROGRESS,
    INDEX_NOT_LOADED,
    INDEX_UNAVAILABLE,
    ENTRY_NOT_FOUND,
    BINDING_UNAVAILABLE,
}

internal sealed interface AndroidOutboxSelectionResult {
    data class Selected(
        val binding: AndroidOutboxSynchronizationBinding,
    ) : AndroidOutboxSelectionResult

    data class Failed(
        val code: AndroidOutboxSelectionFailureCode,
    ) : AndroidOutboxSelectionResult
}

internal class AndroidOutboxSelectionCoordinator(
    private val bindingFactory: AndroidOutboxSynchronizationBindingFactory,
) {
    fun select(
        indexState: AndroidOutboxIndexState,
        loadInProgress: Boolean,
        entryKeyHash: String,
    ): AndroidOutboxSelectionResult {
        if (loadInProgress) {
            return failed(AndroidOutboxSelectionFailureCode.INDEX_LOAD_IN_PROGRESS)
        }
        val entries = when (indexState) {
            AndroidOutboxIndexState.Unloaded ->
                return failed(AndroidOutboxSelectionFailureCode.INDEX_NOT_LOADED)
            is AndroidOutboxIndexState.Unavailable ->
                return failed(AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE)
            is AndroidOutboxIndexState.Ready -> indexState.entries
        }
        val selected = try {
            if (!validEntries(entries)) {
                return failed(AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE)
            }
            if (!entryKeyHash.matches(synchronizationEntryKeyPattern)) {
                return failed(AndroidOutboxSelectionFailureCode.ENTRY_NOT_FOUND)
            }
            entries.singleOrNull { it.entryKeyHash == entryKeyHash }
                ?: return failed(AndroidOutboxSelectionFailureCode.ENTRY_NOT_FOUND)
        } catch (_: Exception) {
            return failed(AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE)
        }
        val binding = try {
            bindingFactory.create(selected.entryKeyHash)
        } catch (_: Exception) {
            return failed(AndroidOutboxSelectionFailureCode.BINDING_UNAVAILABLE)
        }
        return AndroidOutboxSelectionResult.Selected(binding)
    }

    private fun validEntries(entries: List<AndroidOutboxIndexEntry>): Boolean {
        if (entries.size > ANDROID_OUTBOX_INDEX_MAX_ENTRIES) return false
        val observedKeys = HashSet<String>(entries.size)
        return entries.all { entry ->
            observedKeys.add(entry.entryKeyHash) &&
                isValidAndroidOutboxIndexMetadata(
                    entryKeyHash = entry.entryKeyHash,
                    createdAtMs = entry.createdAtMs,
                    storedState = entry.storedState,
                    stateRevision = entry.stateRevision,
                    attemptCount = entry.attemptCount,
                    failureCode = entry.failureCode,
                )
        }
    }

    private fun failed(
        code: AndroidOutboxSelectionFailureCode,
    ): AndroidOutboxSelectionResult = AndroidOutboxSelectionResult.Failed(code)
}
