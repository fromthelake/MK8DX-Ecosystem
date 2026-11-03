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
class AndroidOutboxIndexAsyncHostDeviceTest {
    @Test
    fun defaultWorkerMainSchedulingDuplicateRejectionAndDisposalAreBounded() {
        val parentScope = CoroutineScope(SupervisorJob())
        val loadCalls = AtomicInteger(0)
        val firstEntered = CountDownLatch(1)
        val firstRelease = CountDownLatch(1)
        val firstCallback = CountDownLatch(1)
        val secondEntered = CountDownLatch(1)
        val secondRelease = CountDownLatch(1)
        val secondFinished = CountDownLatch(1)
        val loadRanOnMain = AtomicBoolean(false)
        val callbacksOnMain = Collections.synchronizedList(mutableListOf<Boolean>())
        val states = Collections.synchronizedList(mutableListOf<AndroidOutboxIndexState>())
        val indexPort = AndroidCanonicalOutboxIndexPort {
            val call = loadCalls.incrementAndGet()
            if (Looper.myLooper() == Looper.getMainLooper()) loadRanOnMain.set(true)
            when (call) {
                1 -> {
                    firstEntered.countDown()
                    check(firstRelease.await(5, TimeUnit.SECONDS))
                }
                2 -> try {
                    secondEntered.countDown()
                    secondRelease.await(5, TimeUnit.SECONDS)
                } finally {
                    secondFinished.countDown()
                }
                else -> error("unexpected index load")
            }
            listOf(
                AndroidCanonicalOutboxIndexRecord(
                    entryKeyHash = "a".repeat(64),
                    createdAtMs = 1_786_900_000_000,
                    storedState = AndroidOutboxStoredState.PENDING,
                    stateRevision = 1,
                    attemptCount = 0,
                ),
            )
        }
        val host = AndroidOutboxIndexAsyncHost(
            parentScope = parentScope,
            actionsFactory = AndroidOutboxIndexActionsFactory {
                AndroidOutboxIndexController(indexPort, onState = {})
            },
            onState = {
                callbacksOnMain += Looper.myLooper() == Looper.getMainLooper()
                states += it
                firstCallback.countDown()
            },
        )

        try {
            assertTrue(host.load())
            assertTrue(firstEntered.await(5, TimeUnit.SECONDS))
            assertFalse(host.load())
            firstRelease.countDown()
            assertTrue(firstCallback.await(5, TimeUnit.SECONDS))
            assertTrue(awaitIdle(host))
            assertFalse(loadRanOnMain.get())
            assertEquals(1, states.size)
            assertTrue(states.single() is AndroidOutboxIndexState.Ready)
            assertTrue(callbacksOnMain.all { it })

            val callbackCountBeforeClose = states.size
            assertTrue(host.load())
            assertTrue(secondEntered.await(5, TimeUnit.SECONDS))
            host.close()
            secondRelease.countDown()
            assertTrue(secondFinished.await(5, TimeUnit.SECONDS))
            assertFalse(host.isRunning())
            assertFalse(host.load())
            Thread.sleep(50)
            assertEquals(callbackCountBeforeClose, states.size)
        } finally {
            host.close()
            firstRelease.countDown()
            secondRelease.countDown()
            parentScope.cancel()
        }
    }

    private fun awaitIdle(host: AndroidOutboxIndexAsyncHost): Boolean {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (host.isRunning() && System.nanoTime() < deadline) {
            Thread.sleep(5)
        }
        return !host.isRunning()
    }
}
