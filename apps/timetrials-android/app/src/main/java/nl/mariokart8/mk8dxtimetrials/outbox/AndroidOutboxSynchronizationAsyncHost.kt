package nl.mariokart8.mk8dxtimetrials.outbox

import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

internal fun interface AndroidOutboxSynchronizationActionsFactory {
    fun create(
        onState: (AndroidOutboxSynchronizationState) -> Unit,
    ): AndroidOutboxSynchronizationActions
}

private enum class AndroidOutboxSynchronizationRequest {
    LOAD,
    DELIVER,
    RETRY,
}

internal class AndroidOutboxSynchronizationAsyncHost(
    parentScope: CoroutineScope,
    private val actionsFactory: AndroidOutboxSynchronizationActionsFactory,
    private val onState: (AndroidOutboxSynchronizationState) -> Unit,
    private val workerDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val callbackDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) : AutoCloseable {
    private val lock = Any()
    private val lifecycleJob = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + lifecycleJob)
    private val tokenSequence = AtomicLong(0)
    private var activeToken: Long? = null
    private var closed = false

    init {
        lifecycleJob.invokeOnCompletion {
            synchronized(lock) {
                activeToken = null
            }
        }
    }

    fun load(): Boolean = start(AndroidOutboxSynchronizationRequest.LOAD)

    fun deliver(): Boolean = start(AndroidOutboxSynchronizationRequest.DELIVER)

    fun requestRetry(): Boolean = start(AndroidOutboxSynchronizationRequest.RETRY)

    fun isRunning(): Boolean = synchronized(lock) { activeToken != null }

    override fun close() {
        synchronized(lock) {
            if (closed) return
            closed = true
            activeToken = null
        }
        lifecycleJob.cancel()
    }

    private fun start(request: AndroidOutboxSynchronizationRequest): Boolean {
        val token = synchronized(lock) {
            if (closed || !lifecycleJob.isActive || activeToken != null) return false
            tokenSequence.incrementAndGet().also { activeToken = it }
        }
        val events = Channel<AndroidOutboxSynchronizationState>(Channel.UNLIMITED)

        scope.launch(callbackDispatcher) {
            try {
                for (state in events) {
                    if (accepts(token)) onState(state)
                }
            } finally {
                synchronized(lock) {
                    if (activeToken == token) activeToken = null
                }
            }
        }
        scope.launch(workerDispatcher) {
            val latestState = AtomicReference<AndroidOutboxSynchronizationState?>()
            try {
                val actions = actionsFactory.create { state ->
                    latestState.set(state)
                    events.trySend(state)
                }
                val result = when (request) {
                    AndroidOutboxSynchronizationRequest.LOAD -> actions.load()
                    AndroidOutboxSynchronizationRequest.DELIVER -> actions.deliver()
                    AndroidOutboxSynchronizationRequest.RETRY -> actions.requestRetry()
                }
                if (latestState.get() != result) {
                    latestState.set(result)
                    events.trySend(result)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                events.trySend(
                    AndroidOutboxSynchronizationState.ActionFailed(
                        code = request.unavailableCode(),
                        snapshot = latestState.get().presentationSnapshot(),
                    ),
                )
            } finally {
                events.close()
            }
        }
        return true
    }

    private fun accepts(token: Long): Boolean = synchronized(lock) {
        !closed && activeToken == token
    }
}

private fun AndroidOutboxSynchronizationRequest.unavailableCode():
    AndroidOutboxSynchronizationFailureCode = when (this) {
    AndroidOutboxSynchronizationRequest.LOAD ->
        AndroidOutboxSynchronizationFailureCode.LOCAL_STATE_UNAVAILABLE
    AndroidOutboxSynchronizationRequest.DELIVER ->
        AndroidOutboxSynchronizationFailureCode.DELIVERY_UNAVAILABLE
    AndroidOutboxSynchronizationRequest.RETRY ->
        AndroidOutboxSynchronizationFailureCode.RETRY_UNAVAILABLE
}

private fun AndroidOutboxSynchronizationState?.presentationSnapshot():
    AndroidOutboxSynchronizationSnapshot? = when (this) {
    null,
    AndroidOutboxSynchronizationState.Unloaded,
    -> null
    is AndroidOutboxSynchronizationState.Ready -> snapshot
    is AndroidOutboxSynchronizationState.Working -> snapshot
    is AndroidOutboxSynchronizationState.ActionFailed -> snapshot
}
