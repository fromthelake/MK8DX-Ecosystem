package nl.mariokart8.mk8dxtimetrials.outbox

internal const val ANDROID_OUTBOX_INDEX_MAX_ENTRIES = 1_000

internal val androidOutboxOwningSlotIdPattern = Regex("^slot\\.[0-9a-f]{32}$")

internal fun isValidAndroidOutboxPlayerReference(
    reference: AndroidLocalOutboxPlayerReferenceV1,
): Boolean = reference.namespace.matches(Regex("^[a-z][a-z0-9_]{0,63}$")) &&
    reference.value.length in 1..255 &&
    reference.value.none(Char::isISOControl)

internal data class AndroidCanonicalOutboxIndexRecord(
    val entryKeyHash: String,
    val createdAtMs: Long,
    val storedState: AndroidOutboxStoredState,
    val stateRevision: Long,
    val attemptCount: Long,
    val failureCode: String? = null,
    val owningSlotId: String? = null,
    val playerReference: AndroidLocalOutboxPlayerReferenceV1? = null,
    val isTestResult: Boolean = false,
)

internal fun interface AndroidCanonicalOutboxIndexPort {
    fun listIndex(): List<AndroidCanonicalOutboxIndexRecord>
}

internal data class AndroidOutboxIndexEntry(
    val entryKeyHash: String,
    val createdAtMs: Long,
    val storedState: AndroidOutboxStoredState,
    val stateRevision: Long,
    val attemptCount: Long,
    val failureCode: String? = null,
    val owningSlotId: String? = null,
    val playerReference: AndroidLocalOutboxPlayerReferenceV1? = null,
    val isTestResult: Boolean = false,
)

internal enum class AndroidOutboxIndexFailureCode {
    LOCAL_INDEX_UNAVAILABLE,
}

internal sealed interface AndroidOutboxIndexState {
    data object Unloaded : AndroidOutboxIndexState

    data class Ready(
        val entries: List<AndroidOutboxIndexEntry>,
    ) : AndroidOutboxIndexState

    data class Unavailable(
        val code: AndroidOutboxIndexFailureCode,
    ) : AndroidOutboxIndexState
}

internal fun interface AndroidOutboxIndexActions {
    fun load(): AndroidOutboxIndexState
}

internal class AndroidOutboxIndexController(
    private val index: AndroidCanonicalOutboxIndexPort,
    private val onState: (AndroidOutboxIndexState) -> Unit,
) : AndroidOutboxIndexActions {
    private var state: AndroidOutboxIndexState = AndroidOutboxIndexState.Unloaded

    fun currentState(): AndroidOutboxIndexState = state

    override fun load(): AndroidOutboxIndexState {
        val entries = try {
            project(index.listIndex())
        } catch (_: Exception) {
            null
        }
        if (entries == null) return emitUnavailable()
        return emit(AndroidOutboxIndexState.Ready(entries))
    }

    private fun project(
        records: List<AndroidCanonicalOutboxIndexRecord>,
    ): List<AndroidOutboxIndexEntry>? {
        if (records.size > ANDROID_OUTBOX_INDEX_MAX_ENTRIES) return null
        val observedKeys = HashSet<String>(records.size)
        return records.map { record ->
            if (
                !observedKeys.add(record.entryKeyHash) ||
                !isValidAndroidOutboxIndexMetadata(
                    entryKeyHash = record.entryKeyHash,
                    createdAtMs = record.createdAtMs,
                    storedState = record.storedState,
                    stateRevision = record.stateRevision,
                    attemptCount = record.attemptCount,
                    failureCode = record.failureCode,
                )
            ) {
                return null
            }
            AndroidOutboxIndexEntry(
                entryKeyHash = record.entryKeyHash,
                createdAtMs = record.createdAtMs,
                storedState = record.storedState,
                stateRevision = record.stateRevision,
                attemptCount = record.attemptCount,
                failureCode = record.failureCode,
                // Ownership is presentation metadata here. Unreadable ownership
                // degrades to "unknown account" instead of hiding saved results.
                owningSlotId = record.owningSlotId
                    ?.takeIf { it.matches(androidOutboxOwningSlotIdPattern) },
                playerReference = record.playerReference
                    ?.takeIf(::isValidAndroidOutboxPlayerReference),
                isTestResult = record.isTestResult,
            )
        }.toList()
    }

    private fun emitUnavailable(): AndroidOutboxIndexState = emit(
        AndroidOutboxIndexState.Unavailable(
            AndroidOutboxIndexFailureCode.LOCAL_INDEX_UNAVAILABLE,
        ),
    )

    private fun emit(next: AndroidOutboxIndexState): AndroidOutboxIndexState {
        state = next
        onState(next)
        return next
    }
}

internal fun isValidAndroidOutboxIndexMetadata(
    entryKeyHash: String,
    createdAtMs: Long,
    storedState: AndroidOutboxStoredState,
    stateRevision: Long,
    attemptCount: Long,
    failureCode: String?,
): Boolean =
    entryKeyHash.matches(synchronizationEntryKeyPattern) &&
        createdAtMs in 0..MAX_SYNCHRONIZATION_TIMESTAMP_MS &&
        stateRevision in 1..LOCAL_OUTBOX_MAX_STATE_REVISIONS.toLong() &&
        attemptCount in 0L until stateRevision &&
        (storedState == AndroidOutboxStoredState.FAILED) == (failureCode != null) &&
        (failureCode == null || (
            failureCode.length in 1..64 &&
                failureCode.matches(synchronizationFailureCodePattern)
            ))
