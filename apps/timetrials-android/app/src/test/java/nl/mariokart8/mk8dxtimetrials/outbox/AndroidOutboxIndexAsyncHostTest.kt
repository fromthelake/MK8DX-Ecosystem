package nl.mariokart8.mk8dxtimetrials.outbox

import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidOutboxIndexAsyncHostTest {
    private val ready = AndroidOutboxIndexState.Ready(
        listOf(
            AndroidOutboxIndexEntry(
                entryKeyHash = "a".repeat(64),
                createdAtMs = 1_786_900_000_000,
                storedState = AndroidOutboxStoredState.PENDING,
                stateRevision = 1,
                attemptCount = 0,
            ),
        ),
    )

    @Test
    fun createsAndLoadsOnWorkerThenReturnsOneStateOnCallbackDispatcher() {
        val workerExecutor = Executors.newSingleThreadExecutor { Thread(it, "index-worker-test") }
        val callbackExecutor = Executors.newSingleThreadExecutor { Thread(it, "index-callback-test") }
        val workerDispatcher = workerExecutor.asCoroutineDispatcher()
        val callbackDispatcher = callbackExecutor.asCoroutineDispatcher()
        val parentScope = CoroutineScope(SupervisorJob())
        val factoryThreads = Collections.synchronizedList(mutableListOf<String>())
        val actionThreads = Collections.synchronizedList(mutableListOf<String>())
        val callbackThreads = Collections.synchronizedList(mutableListOf<String>())
        val states = Collections.synchronizedList(mutableListOf<AndroidOutboxIndexState>())
        val host = AndroidOutboxIndexAsyncHost(
            parentScope = parentScope,
            actionsFactory = AndroidOutboxIndexActionsFactory {
                factoryThreads += Thread.currentThread().name
                AndroidOutboxIndexActions {
                    actionThreads += Thread.currentThread().name
                    ready
                }
            },
            onState = {
                callbackThreads += Thread.currentThread().name
                states += it
            },
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )

        try {
            assertTrue(host.load())
            assertTrue(awaitIdle(host))

            assertTrue(factoryThreads.all { it.startsWith("index-worker-test") })
            assertTrue(actionThreads.all { it.startsWith("index-worker-test") })
            assertTrue(callbackThreads.all { it.startsWith("index-callback-test") })
            assertEquals(listOf(ready), states)
        } finally {
            host.close()
            parentScope.cancel()
            workerDispatcher.close()
            callbackDispatcher.close()
        }
    }

    @Test
    fun rejectsCompetingLoadsAndDropsLateResultAfterClose() {
        val workerDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val callbackDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val parentScope = CoroutineScope(SupervisorJob())
        val actionEntered = CountDownLatch(1)
        val actionRelease = CountDownLatch(1)
        val actionFinished = CountDownLatch(1)
        val states = Collections.synchronizedList(mutableListOf<AndroidOutboxIndexState>())
        val factoryCalls = AtomicInteger(0)
        val host = AndroidOutboxIndexAsyncHost(
            parentScope = parentScope,
            actionsFactory = AndroidOutboxIndexActionsFactory {
                factoryCalls.incrementAndGet()
                AndroidOutboxIndexActions {
                    try {
                        actionEntered.countDown()
                        actionRelease.await(5, TimeUnit.SECONDS)
                        ready
                    } finally {
                        actionFinished.countDown()
                    }
                }
            },
            onState = states::add,
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )

        try {
            assertTrue(host.load())
            assertTrue(actionEntered.await(5, TimeUnit.SECONDS))
            assertFalse(host.load())
            assertEquals(1, factoryCalls.get())
            host.close()
            actionRelease.countDown()
            assertTrue(actionFinished.await(5, TimeUnit.SECONDS))
            assertFalse(host.isRunning())
            assertFalse(host.load())
            assertTrue(states.isEmpty())
        } finally {
            host.close()
            actionRelease.countDown()
            parentScope.cancel()
            workerDispatcher.close()
            callbackDispatcher.close()
        }
    }

    @Test
    fun dropsAQueuedCallbackAndRejectsLoadsAfterParentCancellation() {
        val workerDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val callbackExecutor = Executors.newSingleThreadExecutor()
        val callbackDispatcher = callbackExecutor.asCoroutineDispatcher()
        val parentScope = CoroutineScope(SupervisorJob())
        val callbackBlockEntered = CountDownLatch(1)
        val callbackRelease = CountDownLatch(1)
        val actionFinished = CountDownLatch(1)
        val states = Collections.synchronizedList(mutableListOf<AndroidOutboxIndexState>())
        callbackExecutor.submit {
            callbackBlockEntered.countDown()
            callbackRelease.await(5, TimeUnit.SECONDS)
        }
        assertTrue(callbackBlockEntered.await(5, TimeUnit.SECONDS))
        val host = AndroidOutboxIndexAsyncHost(
            parentScope = parentScope,
            actionsFactory = AndroidOutboxIndexActionsFactory {
                AndroidOutboxIndexActions {
                    ready.also { actionFinished.countDown() }
                }
            },
            onState = states::add,
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )

        try {
            assertTrue(host.load())
            assertTrue(actionFinished.await(5, TimeUnit.SECONDS))
            assertTrue(host.isRunning())
            host.close()
            callbackRelease.countDown()
            assertFalse(host.isRunning())
            assertTrue(states.isEmpty())

            val cancelledParent = CoroutineScope(SupervisorJob())
            val cancelledHost = AndroidOutboxIndexAsyncHost(
                parentScope = cancelledParent,
                actionsFactory = AndroidOutboxIndexActionsFactory {
                    error("must not create actions after parent cancellation")
                },
                onState = states::add,
                workerDispatcher = workerDispatcher,
                callbackDispatcher = callbackDispatcher,
            )
            cancelledParent.cancel()
            assertFalse(cancelledHost.load())
            assertFalse(cancelledHost.isRunning())
            cancelledHost.close()
        } finally {
            host.close()
            callbackRelease.countDown()
            parentScope.cancel()
            workerDispatcher.close()
            callbackDispatcher.close()
        }
    }

    @Test
    fun redactsFactoryAndActionFailuresToOneBoundedState() {
        val workerDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val callbackDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val parentScope = CoroutineScope(SupervisorJob())
        val factoryCalls = AtomicInteger(0)
        val states = Collections.synchronizedList(mutableListOf<AndroidOutboxIndexState>())
        val host = AndroidOutboxIndexAsyncHost(
            parentScope = parentScope,
            actionsFactory = AndroidOutboxIndexActionsFactory {
                when (factoryCalls.incrementAndGet()) {
                    1 -> error("private://factory/path")
                    2 -> AndroidOutboxIndexActions { error("private action detail") }
                    else -> AndroidOutboxIndexActions { AndroidOutboxIndexState.Unloaded }
                }
            },
            onState = states::add,
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )

        try {
            repeat(3) {
                assertTrue(host.load())
                assertTrue(awaitIdle(host))
            }
            assertEquals(listOf(unavailable(), unavailable(), unavailable()), states)
            assertFalse(states.toString().contains("private", ignoreCase = true))
            assertFalse(states.toString().contains("path", ignoreCase = true))
        } finally {
            host.close()
            parentScope.cancel()
            workerDispatcher.close()
            callbackDispatcher.close()
        }
    }

    private fun unavailable() = AndroidOutboxIndexState.Unavailable(
        AndroidOutboxIndexFailureCode.LOCAL_INDEX_UNAVAILABLE,
    )

    private fun awaitIdle(host: AndroidOutboxIndexAsyncHost): Boolean {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (host.isRunning() && System.nanoTime() < deadline) {
            Thread.sleep(5)
        }
        return !host.isRunning()
    }
}
