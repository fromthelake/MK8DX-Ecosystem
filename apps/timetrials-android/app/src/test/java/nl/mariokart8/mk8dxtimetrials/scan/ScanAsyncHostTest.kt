package nl.mariokart8.mk8dxtimetrials.scan

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanAsyncHostTest {
    private val validFields = linkedMapOf(
        "player_total" to "1:00.000",
        "player_lap_1" to "0:20.000",
        "player_lap_2" to "0:19.500",
        "player_lap_3" to "0:20.500",
    )

    private fun context() = AndroidScanSubmissionContext(
        submissionId = "user_submission.time.ANDROIDASYNC001",
        revision = 1,
        mode = 150,
        trackId = "track.mario_kart_stadium",
        playerReference = ScanPlayerReferenceV1(
            namespace = "unresolved_observation",
            value = "async-host-test",
        ),
        createdAtMs = 1_786_900_000_100,
        producerVersion = "async-host-test",
        localRecordId = "async-host-record",
    )

    private fun controllerFactory(
        burstProvider: ScanBurstProvider<Int>,
    ) = ScanAsyncControllerFactory<Int> { onState, onSubmission ->
        ScanComponentController(
            burstProvider = burstProvider,
            coordinatorFactory = ScanCoordinatorFactory { coordinatorState ->
                ScanCoordinator(
                    analyzer = ScanFrameAnalyzer { _, _, identityOnly ->
                        ScanConsensusFrame(
                            fields = if (identityOnly) emptyMap() else validFields,
                            lapSumAccepted = !identityOnly,
                            expectedFieldCount = 4,
                        )
                    },
                    onState = coordinatorState,
                )
            },
            contextProvider = ::context,
            onSubmission = onSubmission,
            onState = onState,
        )
    }

    @Test
    fun runsOnWorkerMarshalsCallbacksAndRejectsConcurrentStart() {
        val workerExecutor = Executors.newSingleThreadExecutor { Thread(it, "scan-worker-test") }
        val callbackExecutor = Executors.newSingleThreadExecutor { Thread(it, "scan-callback-test") }
        val workerDispatcher = workerExecutor.asCoroutineDispatcher()
        val callbackDispatcher = callbackExecutor.asCoroutineDispatcher()
        val parentScope = CoroutineScope(SupervisorJob())
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val completed = CountDownLatch(1)
        val workerThread = AtomicReference<String>()
        val callbackThread = AtomicReference<String>()
        val output = AtomicReference<AndroidScanTimeTrialSubmissionV1?>()
        val host = ScanAsyncHost(
            parentScope = parentScope,
            controllerFactory = controllerFactory(
                ScanBurstProvider {
                    workerThread.set(Thread.currentThread().name)
                    entered.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                    ScanCapturedBurst((0..4).toList(), 1_786_900_000_000)
                },
            ),
            onState = {
                callbackThread.set(Thread.currentThread().name)
                if (it is ScanComponentState.Completed) completed.countDown()
            },
            onSubmission = output::set,
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )

        try {
            assertTrue(host.startScan())
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            assertFalse(host.startScan())
            release.countDown()
            assertTrue(completed.await(5, TimeUnit.SECONDS))
            assertTrue(workerThread.get().startsWith("scan-worker-test"))
            assertTrue(callbackThread.get().startsWith("scan-callback-test"))
            assertEquals("android_scan", output.get()?.source?.kind)
        } finally {
            host.close()
            parentScope.cancel()
            workerDispatcher.close()
            callbackDispatcher.close()
        }
    }

    @Test
    fun expectedAndUnexpectedFailuresAreBoundedOnCallbackDispatcher() {
        val workerDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val callbackDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val parentScope = CoroutineScope(SupervisorJob())
        val terminal = CountDownLatch(1)
        val state = AtomicReference<ScanComponentState?>()
        val outputCalls = AtomicInteger(0)
        val host = ScanAsyncHost(
            parentScope = parentScope,
            controllerFactory = controllerFactory(
                ScanBurstProvider { error("private capture detail") },
            ),
            onState = {
                state.set(it)
                if (it is ScanComponentState.Failed) terminal.countDown()
            },
            onSubmission = { outputCalls.incrementAndGet() },
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )

        try {
            assertTrue(host.startScan())
            assertTrue(terminal.await(5, TimeUnit.SECONDS))
            assertEquals(
                ScanComponentState.Failed(ScanComponentFailureCode.CAPTURE_FAILURE),
                state.get(),
            )
            assertFalse(state.get().toString().contains("private capture detail"))
            assertEquals(0, outputCalls.get())
        } finally {
            host.close()
            parentScope.cancel()
            workerDispatcher.close()
            callbackDispatcher.close()
        }

        val unexpectedWorker = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val unexpectedCallback = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val unexpectedScope = CoroutineScope(SupervisorJob())
        val unexpectedTerminal = CountDownLatch(1)
        val unexpectedState = AtomicReference<ScanComponentState?>()
        val unexpectedHost = ScanAsyncHost<Int>(
            parentScope = unexpectedScope,
            controllerFactory = ScanAsyncControllerFactory { _, _ ->
                error("private factory detail")
            },
            onState = {
                unexpectedState.set(it)
                unexpectedTerminal.countDown()
            },
            onSubmission = {},
            workerDispatcher = unexpectedWorker,
            callbackDispatcher = unexpectedCallback,
        )
        try {
            assertTrue(unexpectedHost.startScan())
            assertTrue(unexpectedTerminal.await(5, TimeUnit.SECONDS))
            assertEquals(
                ScanComponentState.Failed(ScanComponentFailureCode.EXECUTION_FAILURE),
                unexpectedState.get(),
            )
            assertFalse(unexpectedState.get().toString().contains("private factory detail"))
        } finally {
            unexpectedHost.close()
            unexpectedScope.cancel()
            unexpectedWorker.close()
            unexpectedCallback.close()
        }
    }

    @Test
    fun closeCancelsWorkAndDropsLaterCallbacks() {
        val workerDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val callbackDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val parentScope = CoroutineScope(SupervisorJob())
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val closed = AtomicBoolean(false)
        val callbacksAfterClose = AtomicInteger(0)
        val output = AtomicReference<AndroidScanTimeTrialSubmissionV1?>()
        val host = ScanAsyncHost(
            parentScope = parentScope,
            controllerFactory = controllerFactory(
                ScanBurstProvider {
                    entered.countDown()
                    release.await(5, TimeUnit.SECONDS)
                    ScanCapturedBurst((0..4).toList(), 1_786_900_000_000)
                },
            ),
            onState = { if (closed.get()) callbacksAfterClose.incrementAndGet() },
            onSubmission = output::set,
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )

        try {
            assertTrue(host.startScan())
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            host.close()
            closed.set(true)
            release.countDown()
            assertFalse(host.startScan())
            assertFalse(host.isRunning())
            assertEquals(0, callbacksAfterClose.get())
            assertNull(output.get())
        } finally {
            host.close()
            parentScope.cancel()
            workerDispatcher.close()
            callbackDispatcher.close()
        }
    }
}
