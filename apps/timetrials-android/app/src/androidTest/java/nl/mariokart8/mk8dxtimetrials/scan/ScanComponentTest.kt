package nl.mariokart8.mk8dxtimetrials.scan

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ScanComponentTest {
    @get:Rule
    val compose = createComposeRule()

    private val validFields = linkedMapOf(
        "player_total" to "1:00.000",
        "player_lap_1" to "0:20.000",
        "player_lap_2" to "0:19.500",
        "player_lap_3" to "0:20.500",
    )

    private fun context() = AndroidScanSubmissionContext(
        submissionId = "user_submission.time.ANDROIDSCANUI02",
        revision = 1,
        mode = 150,
        trackId = "track.mario_kart_stadium",
        playerReference = ScanPlayerReferenceV1(
            namespace = "unresolved_observation",
            value = "scan-component-instrumentation",
        ),
        createdAtMs = 1_786_900_000_100,
        producerVersion = "scan-component-instrumentation",
        localRecordId = "scan-component-device",
    )

    private fun factory(
        analyzer: ScanFrameAnalyzer<Int>,
    ) = ScanCoordinatorFactory<Int> { onState -> ScanCoordinator(analyzer, onState) }

    @Test
    fun scanActionReachesCanonicalSubmissionAndCompletedState() {
        val contextCalls = AtomicInteger(0)
        val output = AtomicReference<AndroidScanTimeTrialSubmissionV1?>(null)
        compose.setContent {
            var state by remember { mutableStateOf<ScanComponentState>(ScanComponentState.Ready) }
            val controller = remember {
                ScanComponentController(
                    burstProvider = ScanBurstProvider {
                        ScanCapturedBurst((0..4).toList(), 1_786_900_000_000)
                    },
                    coordinatorFactory = factory(
                        ScanFrameAnalyzer { _, _, identityOnly ->
                            ScanConsensusFrame(
                                fields = if (identityOnly) emptyMap() else validFields,
                                lapSumAccepted = !identityOnly,
                                expectedFieldCount = 4,
                            )
                        },
                    ),
                    contextProvider = {
                        contextCalls.incrementAndGet()
                        context()
                    },
                    onSubmission = output::set,
                    onState = { state = it },
                )
            }
            MaterialTheme {
                ScanComponent(state = state, onScanRequested = controller::scan)
            }
        }

        compose.onNodeWithTag("scan-status").assertTextEquals("Ready to scan a result screen")
        compose.onNodeWithTag("scan-action").assertIsEnabled().performClick()
        compose.onNodeWithTag("scan-status").assertTextEquals("Saved 3-lap result")
        compose.onNodeWithTag("scan-action").assertTextEquals("Scan another result")
        compose.runOnIdle {
            assertEquals(1, contextCalls.get())
            assertEquals("android_scan", output.get()?.source?.kind)
            assertEquals(60_000L, output.get()?.totalTimeMs)
        }
    }

    @Test
    fun incompleteBurstShowsRepositionAndDoesNotResolveContext() {
        val contextCalls = AtomicInteger(0)
        val output = AtomicReference<AndroidScanTimeTrialSubmissionV1?>(null)
        compose.setContent {
            var state by remember { mutableStateOf<ScanComponentState>(ScanComponentState.Ready) }
            val controller = remember {
                ScanComponentController(
                    burstProvider = ScanBurstProvider { ScanCapturedBurst((0..4).toList(), 1) },
                    coordinatorFactory = factory(
                        ScanFrameAnalyzer { _, _, _ ->
                            ScanConsensusFrame(
                                fields = validFields + ("player_lap_3" to "0:20.50?"),
                                expectedFieldCount = 4,
                            )
                        },
                    ),
                    contextProvider = {
                        contextCalls.incrementAndGet()
                        context()
                    },
                    onSubmission = output::set,
                    onState = { state = it },
                )
            }
            MaterialTheme {
                ScanComponent(state = state, onScanRequested = controller::scan)
            }
        }

        compose.onNodeWithTag("scan-action").performClick()
        compose.onNodeWithTag("scan-status")
            .assertTextEquals("Reposition the result screen and try again")
        compose.onNodeWithTag("scan-action").assertTextEquals("Try again").assertIsEnabled()
        compose.runOnIdle {
            assertEquals(0, contextCalls.get())
            assertNull(output.get())
        }
    }
}
