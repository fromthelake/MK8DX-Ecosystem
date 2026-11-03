package nl.mariokart8.mk8dxtimetrials.outbox

internal interface AndroidCanonicalOutboxSynchronizationSelectionPort :
    AndroidCanonicalOutboxIndexPort,
    AndroidCanonicalOutboxDeliveryPort,
    AndroidCanonicalOutboxSynchronizationPort

internal data class AndroidOutboxSynchronizationSelectionDependencies(
    val indexBinding: AndroidOutboxIndexBinding,
    val selectionCoordinator: AndroidOutboxSelectionCoordinator,
    val batchSynchronization: AndroidOutboxBatchSynchronizationController? = null,
)

internal class AndroidOutboxSynchronizationSelectionDependencyFactory(
    private val outbox: AndroidCanonicalOutboxSynchronizationSelectionPort,
    private val transportResolver: AndroidOwnedCanonicalSubmissionTransportResolver,
    private val reviewedEvidenceAllowlist: AndroidReviewedEvidenceReferenceAllowlist,
    private val clock: AndroidOutboxSynchronizationClock,
    private val accounts: AndroidOutboxAccountAvailability =
        AndroidOutboxAccountAvailability { _, _ -> true },
) {
    fun create(): AndroidOutboxSynchronizationSelectionDependencies {
        val delivery = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox = outbox,
            transportResolver = transportResolver,
            reviewedEvidenceAllowlist = reviewedEvidenceAllowlist,
        )
        return AndroidOutboxSynchronizationSelectionDependencies(
            indexBinding = AndroidOutboxIndexBinding(
                AndroidOutboxIndexActionsFactory {
                    AndroidOutboxIndexController(
                        index = outbox,
                        onState = {},
                    )
                },
            ),
            batchSynchronization = AndroidOutboxBatchSynchronizationController(
                index = outbox,
                delivery = delivery,
                accounts = accounts,
                clock = clock,
            ),
            selectionCoordinator = AndroidOutboxSelectionCoordinator { entryKeyHash ->
                AndroidOutboxSynchronizationBinding(
                    AndroidOutboxSynchronizationActionsFactory { onState ->
                        AndroidOutboxSynchronizationController(
                            entryKey = entryKeyHash,
                            outbox = outbox,
                            delivery = delivery,
                            clock = clock,
                            onState = onState,
                        )
                    },
                )
            },
        )
    }
}

/**
 * Supplies the connection factory bound to one remembered account, or null when
 * that account has to sign in again.
 */
internal fun interface AndroidSlotBoundHttpsConnectionFactoryProvider {
    fun forSlot(owningSlotId: String): AndroidAuthenticatedHttpsConnectionFactory?
}

internal class AndroidHttpsOutboxSynchronizationSelectionDependencyFactory(
    private val outbox: AndroidCanonicalOutboxSynchronizationSelectionPort,
    private val origin: String,
    private val connectionFactoryProvider: AndroidSlotBoundHttpsConnectionFactoryProvider,
    private val reviewedEvidenceAllowlist: AndroidReviewedEvidenceReferenceAllowlist,
    private val clock: AndroidOutboxSynchronizationClock,
    private val accounts: AndroidOutboxAccountAvailability =
        AndroidOutboxAccountAvailability { _, _ -> true },
    private val connectTimeoutMs: Int = ANDROID_CANONICAL_HTTPS_DEFAULT_CONNECT_TIMEOUT_MS,
    private val readTimeoutMs: Int = ANDROID_CANONICAL_HTTPS_DEFAULT_READ_TIMEOUT_MS,
) {
    fun create(): AndroidOutboxSynchronizationSelectionDependencies =
        AndroidOutboxSynchronizationSelectionDependencyFactory(
            outbox = outbox,
            transportResolver = { owningSlotId ->
                connectionFactoryProvider.forSlot(owningSlotId)?.let { connectionFactory ->
                    createAndroidCanonicalSubmissionRequestTransport(
                        AndroidCanonicalSubmissionHttpsExecutor(
                            origin = origin,
                            connectionFactory = connectionFactory,
                            connectTimeoutMs = connectTimeoutMs,
                            readTimeoutMs = readTimeoutMs,
                        ),
                    )
                }
            },
            reviewedEvidenceAllowlist = reviewedEvidenceAllowlist,
            clock = clock,
            accounts = accounts,
        ).create()
}
