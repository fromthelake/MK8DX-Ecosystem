package nl.mariokart8.mk8dxtimetrials.outbox

import android.os.Looper
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidOutboxSynchronizationAsyncHostDeviceTest {
    private val pending = AndroidOutboxSynchronizationSnapshot(
        storedState = AndroidOutboxStoredState.PENDING,
        stateRevision = 1,
        attemptCount = 0,
    )
    private val synced = AndroidOutboxSynchronizationSnapshot(
        storedState = AndroidOutboxStoredState.SYNCED,
        stateRevision = 2,
        attemptCount = 1,
    )

    @Test
    fun workerMainSchedulingDuplicateRejectionAndDisposalAreLifecycleBounded() {
        val parentScope = CoroutineScope(SupervisorJob())
        val factoryCalls = AtomicInteger(0)
        val deliveryEntered = CountDownLatch(1)
        val deliveryRelease = CountDownLatch(1)
        val deliveryTerminal = CountDownLatch(1)
        val loadEntered = CountDownLatch(1)
        val loadRelease = CountDownLatch(1)
        val loadFinished = CountDownLatch(1)
        val actionRanOnMain = AtomicBoolean(false)
        val callbacksOnMain = Collections.synchronizedList(mutableListOf<Boolean>())
        val states = Collections.synchronizedList(
            mutableListOf<AndroidOutboxSynchronizationState>(),
        )
        val host = AndroidOutboxSynchronizationAsyncHost(
            parentScope = parentScope,
            actionsFactory = AndroidOutboxSynchronizationActionsFactory { onState ->
                val factoryCall = factoryCalls.incrementAndGet()
                object : AndroidOutboxSynchronizationActions {
                    override fun load(): AndroidOutboxSynchronizationState {
                        check(factoryCall == 2)
                        if (Looper.myLooper() == Looper.getMainLooper()) {
                            actionRanOnMain.set(true)
                        }
                        return try {
                            loadEntered.countDown()
                            loadRelease.await(5, TimeUnit.SECONDS)
                            AndroidOutboxSynchronizationState.Ready(pending)
                        } finally {
                            loadFinished.countDown()
                        }
                    }

                    override fun deliver(): AndroidOutboxSynchronizationState {
                        check(factoryCall == 1)
                        if (Looper.myLooper() == Looper.getMainLooper()) {
                            actionRanOnMain.set(true)
                        }
                        onState(
                            AndroidOutboxSynchronizationState.Working(
                                AndroidOutboxSynchronizationAction.DELIVER,
                                pending,
                            ),
                        )
                        deliveryEntered.countDown()
                        check(deliveryRelease.await(5, TimeUnit.SECONDS))
                        return AndroidOutboxSynchronizationState.Ready(synced).also(onState)
                    }

                    override fun requestRetry(): AndroidOutboxSynchronizationState =
                        error("unexpected retry")
                }
            },
            onState = {
                callbacksOnMain += Looper.myLooper() == Looper.getMainLooper()
                states += it
                if (it is AndroidOutboxSynchronizationState.Ready) {
                    deliveryTerminal.countDown()
                }
            },
        )

        try {
            assertTrue(host.deliver())
            assertTrue(deliveryEntered.await(5, TimeUnit.SECONDS))
            assertFalse(host.load())
            assertFalse(host.requestRetry())
            deliveryRelease.countDown()
            assertTrue(deliveryTerminal.await(5, TimeUnit.SECONDS))
            assertTrue(awaitIdle(host))
            assertFalse(actionRanOnMain.get())
            assertEquals(
                listOf(
                    AndroidOutboxSynchronizationState.Working(
                        AndroidOutboxSynchronizationAction.DELIVER,
                        pending,
                    ),
                    AndroidOutboxSynchronizationState.Ready(synced),
                ),
                states,
            )
            assertTrue(callbacksOnMain.all { it })

            val callbackCountBeforeClose = states.size
            assertTrue(host.load())
            assertTrue(loadEntered.await(5, TimeUnit.SECONDS))
            host.close()
            loadRelease.countDown()
            assertTrue(loadFinished.await(5, TimeUnit.SECONDS))
            assertFalse(host.isRunning())
            assertFalse(host.deliver())
            Thread.sleep(50)
            assertEquals(callbackCountBeforeClose, states.size)
        } finally {
            host.close()
            deliveryRelease.countDown()
            loadRelease.countDown()
            parentScope.cancel()
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
