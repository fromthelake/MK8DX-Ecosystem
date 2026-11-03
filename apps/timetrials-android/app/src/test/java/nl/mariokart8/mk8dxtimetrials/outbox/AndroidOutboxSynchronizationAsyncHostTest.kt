package nl.mariokart8.mk8dxtimetrials.outbox

import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidOutboxSynchronizationAsyncHostTest {
    private val pending = AndroidOutboxSynchronizationSnapshot(
        storedState = AndroidOutboxStoredState.PENDING,
        stateRevision = 1,
        attemptCount = 0,
    )
    private val synced = AndroidOutboxSynchronizationSnapshot(
        storedState = AndroidOutboxStoredState.SYNCED,
        stateRevision = 3,
        attemptCount = 2,
    )

    @Test
    fun routesAllActionsOnWorkerAndMarshalsEachStateOnce() {
        val workerExecutor = Executors.newSingleThreadExecutor { Thread(it, "sync-worker-test") }
        val callbackExecutor = Executors.newSingleThreadExecutor { Thread(it, "sync-callback-test") }
        val workerDispatcher = workerExecutor.asCoroutineDispatcher()
        val callbackDispatcher = callbackExecutor.asCoroutineDispatcher()
        val parentScope = CoroutineScope(SupervisorJob())
        val actionCalls = Collections.synchronizedList(mutableListOf<String>())
        val workerThreads = Collections.synchronizedList(mutableListOf<String>())
        val callbackThreads = Collections.synchronizedList(mutableListOf<String>())
        val states = Collections.synchronizedList(
            mutableListOf<AndroidOutboxSynchronizationState>(),
        )
        val host = AndroidOutboxSynchronizationAsyncHost(
            parentScope = parentScope,
            actionsFactory = AndroidOutboxSynchronizationActionsFactory { onState ->
                object : AndroidOutboxSynchronizationActions {
                    override fun load(): AndroidOutboxSynchronizationState {
                        actionCalls += "load"
                        workerThreads += Thread.currentThread().name
                        return AndroidOutboxSynchronizationState.Ready(pending).also(onState)
                    }

                    override fun deliver(): AndroidOutboxSynchronizationState {
                        actionCalls += "deliver"
                        workerThreads += Thread.currentThread().name
                        onState(
                            AndroidOutboxSynchronizationState.Working(
                                AndroidOutboxSynchronizationAction.DELIVER,
                                pending,
                            ),
                        )
                        return AndroidOutboxSynchronizationState.Ready(synced).also(onState)
                    }

                    override fun requestRetry(): AndroidOutboxSynchronizationState {
                        actionCalls += "retry"
                        workerThreads += Thread.currentThread().name
                        return AndroidOutboxSynchronizationState.Ready(pending)
                    }
                }
            },
            onState = {
                states += it
                callbackThreads += Thread.currentThread().name
            },
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )

        try {
            assertTrue(host.load())
            assertTrue(awaitIdle(host))
            assertTrue(host.deliver())
            assertTrue(awaitIdle(host))
            assertTrue(host.requestRetry())
            assertTrue(awaitIdle(host))

            assertEquals(listOf("load", "deliver", "retry"), actionCalls)
            assertTrue(workerThreads.all { it.startsWith("sync-worker-test") })
            assertTrue(callbackThreads.all { it.startsWith("sync-callback-test") })
            assertEquals(
                listOf(
                    AndroidOutboxSynchronizationState.Ready(pending),
                    AndroidOutboxSynchronizationState.Working(
                        AndroidOutboxSynchronizationAction.DELIVER,
                        pending,
                    ),
                    AndroidOutboxSynchronizationState.Ready(synced),
                    AndroidOutboxSynchronizationState.Ready(pending),
                ),
                states,
            )
        } finally {
            host.close()
            parentScope.cancel()
            workerDispatcher.close()
            callbackDispatcher.close()
        }
    }

    @Test
    fun rejectsCompetingStartsAndDropsQueuedOrLateStateAfterClose() {
        val workerExecutor = Executors.newSingleThreadExecutor { Thread(it, "sync-close-worker") }
        val callbackExecutor = Executors.newSingleThreadExecutor { Thread(it, "sync-close-callback") }
        val workerDispatcher = workerExecutor.asCoroutineDispatcher()
        val callbackDispatcher = callbackExecutor.asCoroutineDispatcher()
        val parentScope = CoroutineScope(SupervisorJob())
        val callbackBlockEntered = CountDownLatch(1)
        val callbackRelease = CountDownLatch(1)
        val workerEntered = CountDownLatch(1)
        val workerRelease = CountDownLatch(1)
        val workerFinished = CountDownLatch(1)
        val callbacks = Collections.synchronizedList(
            mutableListOf<AndroidOutboxSynchronizationState>(),
        )
        callbackExecutor.submit {
            callbackBlockEntered.countDown()
            callbackRelease.await(5, TimeUnit.SECONDS)
        }
        assertTrue(callbackBlockEntered.await(5, TimeUnit.SECONDS))
        val host = AndroidOutboxSynchronizationAsyncHost(
            parentScope = parentScope,
            actionsFactory = AndroidOutboxSynchronizationActionsFactory { onState ->
                object : AndroidOutboxSynchronizationActions {
                    override fun load() = AndroidOutboxSynchronizationState.Ready(pending)

                    override fun deliver(): AndroidOutboxSynchronizationState {
                        return try {
                            onState(
                                AndroidOutboxSynchronizationState.Working(
                                    AndroidOutboxSynchronizationAction.DELIVER,
                                    pending,
                                ),
                            )
                            workerEntered.countDown()
                            workerRelease.await(5, TimeUnit.SECONDS)
                            AndroidOutboxSynchronizationState.Ready(synced)
                        } finally {
                            workerFinished.countDown()
                        }
                    }

                    override fun requestRetry() = AndroidOutboxSynchronizationState.Ready(pending)
                }
            },
            onState = callbacks::add,
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )

        try {
            assertTrue(host.deliver())
            assertTrue(workerEntered.await(5, TimeUnit.SECONDS))
            assertFalse(host.load())
            assertFalse(host.deliver())
            assertFalse(host.requestRetry())
            host.close()
            workerRelease.countDown()
            callbackRelease.countDown()
            assertTrue(workerFinished.await(5, TimeUnit.SECONDS))
            assertFalse(host.isRunning())
            assertFalse(host.load())
            assertTrue(callbacks.isEmpty())

            val cancelledParent = CoroutineScope(SupervisorJob())
            val cancelledHost = AndroidOutboxSynchronizationAsyncHost(
                parentScope = cancelledParent,
                actionsFactory = AndroidOutboxSynchronizationActionsFactory {
                    error("must not create actions after parent cancellation")
                },
                onState = callbacks::add,
                workerDispatcher = workerDispatcher,
                callbackDispatcher = callbackDispatcher,
            )
            cancelledParent.cancel()
            assertFalse(cancelledHost.load())
            assertFalse(cancelledHost.isRunning())
            cancelledHost.close()
        } finally {
            host.close()
            workerRelease.countDown()
            callbackRelease.countDown()
            parentScope.cancel()
            workerDispatcher.close()
            callbackDispatcher.close()
        }
    }

    @Test
    fun unexpectedActionFailuresUseOnlyRequestSpecificBoundedCodes() {
        val workerDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val callbackDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val parentScope = CoroutineScope(SupervisorJob())
        val states = Collections.synchronizedList(
            mutableListOf<AndroidOutboxSynchronizationState>(),
        )
        val host = AndroidOutboxSynchronizationAsyncHost(
            parentScope = parentScope,
            actionsFactory = AndroidOutboxSynchronizationActionsFactory {
                object : AndroidOutboxSynchronizationActions {
                    override fun load(): AndroidOutboxSynchronizationState =
                        error("private load path")

                    override fun deliver(): AndroidOutboxSynchronizationState =
                        error("private response body")

                    override fun requestRetry(): AndroidOutboxSynchronizationState =
                        error("private retry detail")
                }
            },
            onState = states::add,
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )

        try {
            val starts = listOf(host::load, host::deliver, host::requestRetry)
            starts.forEach {
                assertTrue(it())
                assertTrue(awaitIdle(host))
            }
            assertEquals(
                listOf(
                    AndroidOutboxSynchronizationFailureCode.LOCAL_STATE_UNAVAILABLE,
                    AndroidOutboxSynchronizationFailureCode.DELIVERY_UNAVAILABLE,
                    AndroidOutboxSynchronizationFailureCode.RETRY_UNAVAILABLE,
                ),
                states.map {
                    (it as AndroidOutboxSynchronizationState.ActionFailed).code
                },
            )
            assertTrue(states.all { it.presentationSnapshotForTest() == null })
            assertFalse(states.toString().contains("private", ignoreCase = true))
        } finally {
            host.close()
            parentScope.cancel()
            workerDispatcher.close()
            callbackDispatcher.close()
        }
    }

    private fun awaitIdle(host: AndroidOutboxSynchronizationAsyncHost): Boolean {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (host.isRunning() && System.nanoTime() < deadline) {
            Thread.sleep(5)
        }
        return !host.isRunning()
    }
}

private fun AndroidOutboxSynchronizationState.presentationSnapshotForTest():
    AndroidOutboxSynchronizationSnapshot? = when (this) {
    AndroidOutboxSynchronizationState.Unloaded -> null
    is AndroidOutboxSynchronizationState.Ready -> snapshot
    is AndroidOutboxSynchronizationState.Working -> snapshot
    is AndroidOutboxSynchronizationState.ActionFailed -> snapshot
}
