package nl.mariokart8.mk8dxtimetrials.outbox

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import nl.mariokart8.mk8dxtimetrials.lan.AndroidOriginTrust
import nl.mariokart8.mk8dxtimetrials.BuildConfig
import nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin
import nl.mariokart8.mk8dxtimetrials.auth.AndroidHttpsConnectionOpener
import nl.mariokart8.mk8dxtimetrials.auth.AndroidKeystoreNativeSessionStore
import nl.mariokart8.mk8dxtimetrials.auth.AndroidSlotBoundSessionCanonicalConnectionFactory

private const val AUTOMATIC_SYNC_WORK = "mk8dx-time-trial-automatic-sync-v1"
/**
 * Failures the app may retry on its own, because nothing about the result has
 * to change for the next attempt to succeed.
 *
 * `transport.unavailable` is the network being down or the host being busy.
 * `transport.not_authenticated` is a session that expired between saving a
 * result and delivering it - the commonest way a saved time went nowhere: the
 * entry failed once, was never re-driven, and sat in the outbox even after the
 * Player signed in again. Signing in already enqueues a sync, so retrying is
 * exactly what closes that gap. `response.invalid` is a garbled or intercepted
 * response to a request the app formed correctly.
 *
 * Deliberately absent: `not_authorized` (this account may genuinely not do
 * this), `revision.conflict` (the server holds a newer revision and a human
 * must decide) and `submission.rejected` (the payload itself is wrong, so a
 * retry would fail identically forever).
 */
private val automaticallyRetryableFailures = setOf(
    ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE,
    ANDROID_CANONICAL_TRANSPORT_NOT_AUTHENTICATED,
    ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID,
)

internal enum class AndroidAutomaticSyncOutcome { COMPLETE, RETRY }

internal class AndroidAutomaticOutboxSynchronizer(
    private val outbox: AndroidCanonicalOutboxSynchronizationSelectionPort,
    private val synchronizeBatch: () -> AndroidOutboxBatchResult,
    private val clock: AndroidOutboxSynchronizationClock,
) {
    fun synchronize(): AndroidAutomaticSyncOutcome {
        if (!prepareRetryableFailures()) return AndroidAutomaticSyncOutcome.RETRY
        val result = synchronizeBatch()
        if (result.busy || result.indexUnavailable) return AndroidAutomaticSyncOutcome.RETRY
        val retryableFailure = result.items.any {
            it.outcome == AndroidOutboxBatchItemOutcome.FAILED &&
                it.failureCode in automaticallyRetryableFailures
        }
        if (!retryableFailure) return AndroidAutomaticSyncOutcome.COMPLETE
        prepareRetryableFailures()
        return AndroidAutomaticSyncOutcome.RETRY
    }

    private fun prepareRetryableFailures(): Boolean = try {
        outbox.listIndex()
            .filter {
                it.storedState == AndroidOutboxStoredState.FAILED &&
                    it.failureCode in automaticallyRetryableFailures
            }
            .forEach { entry ->
                outbox.requestRetry(entry.entryKeyHash, entry.stateRevision, clock.nowMs())
            }
        true
    } catch (_: Exception) {
        false
    }
}

internal object AndroidAutomaticSyncScheduler {
    fun enqueue(context: Context) {
        val request = OneTimeWorkRequestBuilder<AndroidAutomaticSyncWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            AUTOMATIC_SYNC_WORK,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            request,
        )
    }
}

class AndroidAutomaticSyncWorker(
    context: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val context = applicationContext
        val server = AndroidServerOrigin.current(context) ?: return Result.success()
        val outbox = createAndroidProductTimeTrialOutbox(context)
        val sessions = AndroidKeystoreNativeSessionStore(context)
        val opener = AndroidHttpsConnectionOpener { url ->
            AndroidOriginTrust.open(context, url)
        }
        val clock = AndroidOutboxSynchronizationClock(System::currentTimeMillis)
        val dependencies = AndroidSavedResultSynchronizationScreenDependencyFactory(
            outbox = outbox,
            origin = server,
            connectionFactoryProvider = { owningSlotId ->
                AndroidSlotBoundSessionCanonicalConnectionFactory(
                    owningSlotId,
                    sessions,
                    opener,
                ).takeIf { sessions.load(owningSlotId, System.currentTimeMillis()) != null }
            },
            reviewedEvidenceAllowlist = AndroidReviewedEvidenceReferenceAllowlist {
                evidence -> evidence.isEmpty()
            },
            clock = clock,
            accounts = AndroidOutboxAccountAvailability { owningSlotId, nowMs ->
                sessions.load(owningSlotId, nowMs) != null
            },
        ).create().synchronization
        val batch = dependencies.batchSynchronization ?: return Result.failure()
        return when (AndroidAutomaticOutboxSynchronizer(
            outbox,
            batch::synchronizeAll,
            clock,
        ).synchronize()) {
            AndroidAutomaticSyncOutcome.COMPLETE -> Result.success()
            AndroidAutomaticSyncOutcome.RETRY -> Result.retry()
        }
    }
}
