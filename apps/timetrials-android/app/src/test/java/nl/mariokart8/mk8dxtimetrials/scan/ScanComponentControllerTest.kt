package nl.mariokart8.mk8dxtimetrials.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanComponentControllerTest {
    private val validFields = linkedMapOf(
        "player_total" to "1:00.000",
        "player_lap_1" to "0:20.000",
        "player_lap_2" to "0:19.500",
        "player_lap_3" to "0:20.500",
    )

    private fun context() = AndroidScanSubmissionContext(
        submissionId = "user_submission.time.ANDROIDSCANUI01",
        revision = 1,
        mode = 150,
        trackId = "track.mario_kart_stadium",
        playerReference = ScanPlayerReferenceV1(
            namespace = "producer_local_profile",
            value = "scan-component-profile",
        ),
        createdAtMs = 1_786_900_000_100,
        producerVersion = "scan-component-test",
        localRecordId = "scan-component-record",
    )

    private fun factory(
        analyze: (Int, Int, Boolean) -> ScanConsensusFrame,
    ) = ScanCoordinatorFactory<Int> { onState ->
        ScanCoordinator(
            analyzer = ScanFrameAnalyzer(analyze),
            onState = onState,
        )
    }

    @Test
    fun lockedBurstResolvesContextOnceAndEmitsOneCanonicalSubmission() {
        val states = mutableListOf<ScanComponentState>()
        val submissions = mutableListOf<AndroidScanTimeTrialSubmissionV1>()
        var contextCalls = 0
        val controller = ScanComponentController(
            burstProvider = ScanBurstProvider {
                ScanCapturedBurst((0..4).toList(), 1_786_900_000_000)
            },
            coordinatorFactory = factory { _, _, identityOnly ->
                ScanConsensusFrame(
                    fields = if (identityOnly) emptyMap() else validFields,
                    lapSumAccepted = !identityOnly,
                    expectedFieldCount = 4,
                )
            },
            contextProvider = {
                contextCalls += 1
                context()
            },
            onSubmission = submissions::add,
            onState = states::add,
        )

        val outcome = controller.scan()

        assertEquals(ScanComponentState.Completed(60_000, 3), outcome)
        assertEquals(outcome, states.last())
        assertEquals(1, contextCalls)
        assertEquals(1, submissions.size)
        assertEquals("android_scan", submissions.single().source.kind)
        assertEquals(4, states.filterIsInstance<ScanComponentState.Analyzing>().size)
        assertTrue(states.filterIsInstance<ScanComponentState.Analyzing>().drop(1)
            .all { it.identityOnly })
    }

    @Test
    fun unlockedBurstRequestsRepositionWithoutResolvingContext() {
        val states = mutableListOf<ScanComponentState>()
        var contextCalls = 0
        var submission: AndroidScanTimeTrialSubmissionV1? = null
        val controller = ScanComponentController(
            burstProvider = ScanBurstProvider { ScanCapturedBurst((0..4).toList(), 1) },
            coordinatorFactory = factory { _, _, _ ->
                ScanConsensusFrame(
                    fields = validFields + ("player_lap_3" to "0:20.50?"),
                    expectedFieldCount = 4,
                )
            },
            contextProvider = {
                contextCalls += 1
                context()
            },
            onSubmission = { submission = it },
            onState = states::add,
        )

        assertEquals(ScanComponentState.NeedsReposition(5), controller.scan())
        assertEquals(0, contextCalls)
        assertNull(submission)
        assertEquals(1, states.count { it is ScanComponentState.NeedsReposition })
    }

    @Test
    fun captureAndAnalyzerFailuresAreBounded() {
        var coordinatorCreated = false
        val captureStates = mutableListOf<ScanComponentState>()
        val captureFailure = ScanComponentController(
            burstProvider = ScanBurstProvider<Int> { error("private capture detail") },
            coordinatorFactory = ScanCoordinatorFactory {
                coordinatorCreated = true
                ScanCoordinator(ScanFrameAnalyzer { _, _, _ -> ScanConsensusFrame() }, it)
            },
            contextProvider = ::context,
            onSubmission = {},
            onState = captureStates::add,
        ).scan()
        assertEquals(
            ScanComponentState.Failed(ScanComponentFailureCode.CAPTURE_FAILURE),
            captureFailure,
        )
        assertFalse(coordinatorCreated)
        assertFalse(captureStates.last().toString().contains("private capture detail"))

        val invalidBurst = ScanComponentController(
            burstProvider = ScanBurstProvider { ScanCapturedBurst(listOf(1), 1) },
            coordinatorFactory = factory { _, _, _ -> ScanConsensusFrame() },
            contextProvider = ::context,
            onSubmission = {},
            onState = {},
        ).scan()
        assertEquals(
            ScanComponentState.Failed(ScanComponentFailureCode.INVALID_BURST_SIZE),
            invalidBurst,
        )

        val analyzerStates = mutableListOf<ScanComponentState>()
        val analyzerFailure = ScanComponentController(
            burstProvider = ScanBurstProvider { ScanCapturedBurst((0..4).toList(), 1) },
            coordinatorFactory = factory { _, frameIndex, _ ->
                if (frameIndex == 1) error("private analyzer detail")
                ScanConsensusFrame()
            },
            contextProvider = ::context,
            onSubmission = {},
            onState = analyzerStates::add,
        ).scan()
        assertEquals(
            ScanComponentState.Failed(ScanComponentFailureCode.ANALYZER_FAILURE),
            analyzerFailure,
        )
        assertFalse(analyzerStates.last().toString().contains("private analyzer detail"))
    }

    @Test
    fun canonicalContextFailureIsBoundedAfterLock() {
        var outputCalls = 0
        val outcome = ScanComponentController(
            burstProvider = ScanBurstProvider {
                ScanCapturedBurst((0..4).toList(), 1_786_900_000_000)
            },
            coordinatorFactory = factory { _, _, identityOnly ->
                ScanConsensusFrame(
                    fields = if (identityOnly) emptyMap() else validFields,
                    lapSumAccepted = !identityOnly,
                    expectedFieldCount = 4,
                )
            },
            contextProvider = { error("private context detail") },
            onSubmission = { outputCalls += 1 },
            onState = {},
        ).scan()

        assertEquals(
            ScanComponentState.Failed(ScanComponentFailureCode.CONTEXT_UNAVAILABLE),
            outcome,
        )
        assertEquals(0, outputCalls)

        val invalidCanonical = ScanComponentController(
            burstProvider = ScanBurstProvider {
                ScanCapturedBurst((0..4).toList(), 1_786_900_000_000)
            },
            coordinatorFactory = factory { _, _, identityOnly ->
                ScanConsensusFrame(
                    fields = if (identityOnly) emptyMap() else validFields,
                    lapSumAccepted = !identityOnly,
                    expectedFieldCount = 4,
                )
            },
            contextProvider = { context().copy(mode = 100) },
            onSubmission = { outputCalls += 1 },
            onState = {},
        ).scan()
        assertEquals(
            ScanComponentState.Failed(ScanComponentFailureCode.INVALID_CANONICAL_RESULT),
            invalidCanonical,
        )
        assertEquals(0, outputCalls)
    }
}
