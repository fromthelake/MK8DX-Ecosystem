package nl.mariokart8.mk8dxtimetrials.scan

import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

internal fun interface ScanAsyncControllerFactory<Frame> {
    fun create(
        onState: (ScanComponentState) -> Unit,
        onSubmission: (AndroidScanTimeTrialSubmissionV1) -> Unit,
    ): ScanComponentController<Frame>
}

private sealed interface ScanAsyncEvent {
    data class State(val value: ScanComponentState) : ScanAsyncEvent
    data class Submission(val value: AndroidScanTimeTrialSubmissionV1) : ScanAsyncEvent
}

internal class ScanAsyncHost<Frame>(
    parentScope: CoroutineScope,
    private val controllerFactory: ScanAsyncControllerFactory<Frame>,
    private val onState: (ScanComponentState) -> Unit,
    private val onSubmission: (AndroidScanTimeTrialSubmissionV1) -> Unit,
    private val workerDispatcher: CoroutineDispatcher = Dispatchers.Default,
    private val callbackDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) : AutoCloseable {
    private val lock = Any()
    private val lifecycleJob = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + lifecycleJob)
    private val tokenSequence = AtomicLong(0)
    private var activeToken: Long? = null
    private var closed = false

    fun startScan(): Boolean {
        val token = synchronized(lock) {
            if (closed || activeToken != null) return false
            tokenSequence.incrementAndGet().also { activeToken = it }
        }
        val events = Channel<ScanAsyncEvent>(Channel.UNLIMITED)

        scope.launch(callbackDispatcher) {
            try {
                for (event in events) {
                    if (!accepts(token)) continue
                    when (event) {
                        is ScanAsyncEvent.State -> onState(event.value)
                        is ScanAsyncEvent.Submission -> onSubmission(event.value)
                    }
                }
            } finally {
                synchronized(lock) {
                    if (activeToken == token) activeToken = null
                }
            }
        }
        scope.launch(workerDispatcher) {
            try {
                controllerFactory.create(
                    onState = { events.trySend(ScanAsyncEvent.State(it)) },
                    onSubmission = { events.trySend(ScanAsyncEvent.Submission(it)) },
                ).scan { accepts(token) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                events.trySend(
                    ScanAsyncEvent.State(
                        ScanComponentState.Failed(ScanComponentFailureCode.EXECUTION_FAILURE),
                    ),
                )
            } finally {
                events.close()
            }
        }
        return true
    }

    fun isRunning(): Boolean = synchronized(lock) { activeToken != null }

    override fun close() {
        synchronized(lock) {
            if (closed) return
            closed = true
            activeToken = null
        }
        lifecycleJob.cancel()
    }

    private fun accepts(token: Long): Boolean = synchronized(lock) {
        !closed && activeToken == token
    }
}
