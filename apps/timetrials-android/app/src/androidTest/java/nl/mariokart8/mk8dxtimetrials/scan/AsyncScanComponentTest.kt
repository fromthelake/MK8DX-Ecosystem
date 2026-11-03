package nl.mariokart8.mk8dxtimetrials.scan

import android.os.Looper
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AsyncScanComponentTest {
    @get:Rule
    val compose = createComposeRule()

    private val validFields = linkedMapOf(
        "player_total" to "1:00.000",
        "player_lap_1" to "0:20.000",
        "player_lap_2" to "0:19.500",
        "player_lap_3" to "0:20.500",
    )

    private fun context() = AndroidScanSubmissionContext(
        submissionId = "user_submission.time.ANDROIDASYNC002",
        revision = 1,
        mode = 150,
        trackId = "track.mario_kart_stadium",
        playerReference = ScanPlayerReferenceV1(
            namespace = "unresolved_observation",
            value = "async-component-device",
        ),
        createdAtMs = 1_786_900_000_100,
        producerVersion = "async-component-device",
        localRecordId = "async-component-device",
    )

    private fun factory(
        burstProvider: ScanBurstProvider<Int>,
        analyzerCalls: AtomicInteger = AtomicInteger(0),
    ) = ScanAsyncControllerFactory<Int> { onState, onSubmission ->
        ScanComponentController(
            burstProvider = burstProvider,
            coordinatorFactory = ScanCoordinatorFactory { coordinatorState ->
                ScanCoordinator(
                    analyzer = ScanFrameAnalyzer { _, _, identityOnly ->
                        analyzerCalls.incrementAndGet()
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
    fun componentRunsAnalysisOffMainAndReturnsCanonicalOutputOnMain() {
        val analyzedOffMain = AtomicBoolean(false)
        val callbackOnMain = AtomicBoolean(false)
        val output = AtomicReference<AndroidScanTimeTrialSubmissionV1?>()
        compose.setContent {
            MaterialTheme {
                AsyncScanComponent(
                    controllerFactory = factory(
                        ScanBurstProvider {
                            analyzedOffMain.set(Looper.myLooper() != Looper.getMainLooper())
                            ScanCapturedBurst((0..4).toList(), 1_786_900_000_000)
                        },
                    ),
                    onSubmission = {
                        callbackOnMain.set(Looper.myLooper() == Looper.getMainLooper())
                        output.set(it)
                    },
                )
            }
        }

        compose.onNodeWithTag("scan-action").performClick()
        compose.waitUntil(timeoutMillis = 5_000) { output.get() != null }
        compose.onNodeWithTag("scan-status").assertTextEquals("Saved 3-lap result")
        compose.runOnIdle {
            assertTrue(analyzedOffMain.get())
            assertTrue(callbackOnMain.get())
            assertEquals("android_scan", output.get()?.source?.kind)
        }
    }

    @Test
    fun captureFailureBecomesBoundedRetryUi() {
        val output = AtomicReference<AndroidScanTimeTrialSubmissionV1?>()
        compose.setContent {
            MaterialTheme {
                AsyncScanComponent(
                    controllerFactory = factory(
                        ScanBurstProvider { error("private device capture detail") },
                    ),
                    onSubmission = output::set,
                )
            }
        }

        compose.onNodeWithTag("scan-action").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            runCatching {
                compose.onNodeWithTag("scan-action").assertTextEquals("Try again")
            }.isSuccess
        }
        compose.onNodeWithTag("scan-status").assertTextEquals("Could not capture the result screen")
        compose.onNodeWithTag("scan-action").assertTextEquals("Try again")
        compose.runOnIdle { assertNull(output.get()) }
    }

    @Test
    fun disposalCancelsBlockedCaptureWithoutOutput() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val analyzerCalls = AtomicInteger(0)
        val output = AtomicReference<AndroidScanTimeTrialSubmissionV1?>()
        lateinit var hide: () -> Unit
        compose.setContent {
            var shown by remember { mutableStateOf(true) }
            hide = { shown = false }
            if (shown) {
                MaterialTheme {
                    AsyncScanComponent(
                        controllerFactory = factory(
                            ScanBurstProvider {
                                entered.countDown()
                                release.await(5, TimeUnit.SECONDS)
                                ScanCapturedBurst((0..4).toList(), 1_786_900_000_000)
                            },
                            analyzerCalls,
                        ),
                        onSubmission = output::set,
                    )
                }
            }
        }

        compose.onNodeWithTag("scan-action").performClick()
        assertTrue(entered.await(5, TimeUnit.SECONDS))
        compose.runOnIdle(hide)
        compose.waitForIdle()
        release.countDown()
        compose.waitForIdle()
        assertEquals(0, analyzerCalls.get())
        assertNull(output.get())
    }

    @Test
    fun hostRejectsDuplicateStartAndDropsOutputAfterClose() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val output = AtomicReference<AndroidScanTimeTrialSubmissionV1?>()
        val parentScope = CoroutineScope(SupervisorJob())
        val host = ScanAsyncHost(
            parentScope = parentScope,
            controllerFactory = factory(
                ScanBurstProvider {
                    entered.countDown()
                    release.await(5, TimeUnit.SECONDS)
                    ScanCapturedBurst((0..4).toList(), 1_786_900_000_000)
                },
            ),
            onState = {},
            onSubmission = output::set,
        )

        assertTrue(host.startScan())
        assertTrue(entered.await(5, TimeUnit.SECONDS))
        assertFalse(host.startScan())
        host.close()
        parentScope.cancel()
        release.countDown()
        assertFalse(host.startScan())
        assertNull(output.get())
    }
}
