package nl.mariokart8.mk8dxtimetrials.outbox

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun interface AndroidOutboxIndexActionsFactory {
    fun create(): AndroidOutboxIndexActions
}

internal class AndroidOutboxIndexAsyncHost(
    parentScope: CoroutineScope,
    private val actionsFactory: AndroidOutboxIndexActionsFactory,
    private val onState: (AndroidOutboxIndexState) -> Unit,
    private val workerDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val callbackDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) : AutoCloseable {
    private val lock = Any()
    private val lifecycleJob = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + lifecycleJob)
    private var tokenSequence = 0L
    private var activeToken: Long? = null
    private var closed = false

    init {
        lifecycleJob.invokeOnCompletion {
            synchronized(lock) {
                activeToken = null
            }
        }
    }

    fun load(): Boolean {
        val token = synchronized(lock) {
            if (closed || !lifecycleJob.isActive || activeToken != null) return false
            tokenSequence += 1
            tokenSequence.also { activeToken = it }
        }
        scope.launch(workerDispatcher) {
            try {
                val result = try {
                    when (val loaded = actionsFactory.create().load()) {
                        AndroidOutboxIndexState.Unloaded -> unavailable()
                        is AndroidOutboxIndexState.Ready,
                        is AndroidOutboxIndexState.Unavailable,
                        -> loaded
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    unavailable()
                }
                withContext(callbackDispatcher) {
                    if (accepts(token)) onState(result)
                }
            } finally {
                synchronized(lock) {
                    if (activeToken == token) activeToken = null
                }
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

    private fun unavailable() = AndroidOutboxIndexState.Unavailable(
        AndroidOutboxIndexFailureCode.LOCAL_INDEX_UNAVAILABLE,
    )
}
