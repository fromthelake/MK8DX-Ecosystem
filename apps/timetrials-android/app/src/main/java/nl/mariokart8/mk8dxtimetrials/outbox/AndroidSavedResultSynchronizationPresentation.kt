package nl.mariokart8.mk8dxtimetrials.outbox

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

private const val SAVED_RESULT_LABEL_PATTERN = "yyyy-MM-dd HH:mm:ss"

internal class AndroidNewestFirstSynchronizationSelectionPort(
    private val delegate: AndroidCanonicalOutboxSynchronizationSelectionPort,
) : AndroidCanonicalOutboxSynchronizationSelectionPort by delegate {
    override fun listIndex(): List<AndroidCanonicalOutboxIndexRecord> =
        delegate.listIndex().sortedWith(
            compareByDescending<AndroidCanonicalOutboxIndexRecord> { it.createdAtMs }
                .thenBy { it.entryKeyHash },
        )
}

internal class AndroidSavedResultTimestampLabelProvider(
    timeZone: TimeZone = TimeZone.getDefault(),
) : AndroidOutboxSelectionLabelProvider {
    private val timeZoneId = timeZone.id

    override fun labelFor(entry: AndroidOutboxIndexEntry): String {
        val formatter = SimpleDateFormat(SAVED_RESULT_LABEL_PATTERN, Locale.ROOT).apply {
            timeZone = TimeZone.getTimeZone(timeZoneId)
            isLenient = false
        }
        return "Saved ${formatter.format(entry.createdAtMs)}"
    }
}

internal data class AndroidSavedResultSynchronizationScreenDependencies(
    val synchronization: AndroidOutboxSynchronizationSelectionDependencies,
    val labelProvider: AndroidOutboxSelectionLabelProvider,
)

internal class AndroidSavedResultSynchronizationScreenDependencyFactory(
    outbox: AndroidCanonicalOutboxSynchronizationSelectionPort,
    origin: String,
    connectionFactoryProvider: AndroidSlotBoundHttpsConnectionFactoryProvider,
    reviewedEvidenceAllowlist: AndroidReviewedEvidenceReferenceAllowlist,
    clock: AndroidOutboxSynchronizationClock,
    accounts: AndroidOutboxAccountAvailability,
    timeZone: TimeZone = TimeZone.getDefault(),
    connectTimeoutMs: Int = ANDROID_CANONICAL_HTTPS_DEFAULT_CONNECT_TIMEOUT_MS,
    readTimeoutMs: Int = ANDROID_CANONICAL_HTTPS_DEFAULT_READ_TIMEOUT_MS,
) {
    private val synchronizationFactory =
        AndroidHttpsOutboxSynchronizationSelectionDependencyFactory(
            outbox = AndroidNewestFirstSynchronizationSelectionPort(outbox),
            origin = origin,
            connectionFactoryProvider = connectionFactoryProvider,
            reviewedEvidenceAllowlist = reviewedEvidenceAllowlist,
            clock = clock,
            accounts = accounts,
            connectTimeoutMs = connectTimeoutMs,
            readTimeoutMs = readTimeoutMs,
        )
    private val labelProvider = AndroidSavedResultTimestampLabelProvider(timeZone)

    fun create(): AndroidSavedResultSynchronizationScreenDependencies =
        AndroidSavedResultSynchronizationScreenDependencies(
            synchronization = synchronizationFactory.create(),
            labelProvider = labelProvider,
        )
}
