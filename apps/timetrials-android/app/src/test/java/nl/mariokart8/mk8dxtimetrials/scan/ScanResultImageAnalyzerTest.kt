package nl.mariokart8.mk8dxtimetrials.scan

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ScanResultImageAnalyzerTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val validFields = linkedMapOf(
        "player_total" to "1:00.000",
        "player_lap_1" to "0:20.000",
        "player_lap_2" to "0:19.500",
        "player_lap_3" to "0:20.500",
    )

    /**
     * A layout aimed at the wrong MK8DX screen blocks in step 01 and reads
     * nothing at all. That used to end the scan with a bare "Scan failed" while
     * the image was perfectly readable under the other layout - the toggle was a
     * silent trap, and it cost a released build. A burst that finds nothing now
     * tries the other layout before it gives up.
     */
    private class FakeLayoutReader(
        private val readableUnder: ScanLayoutProfile,
        private val chosen: ScanLayoutProfile,
        private val fields: Map<String, String>,
    ) : ScanFrameAnalyzer<Any>, ScanLayoutAttempts {
        val used = mutableListOf<ScanLayoutProfile>()
        private var current: ScanLayoutProfile? = null

        override fun attempts(): List<ScanLayoutProfile> =
            listOf(chosen) + ScanLayoutProfile.entries.filter { it != chosen }

        override fun use(layout: ScanLayoutProfile) {
            current = layout
            used += layout
        }

        override fun analyze(
            frame: Any,
            frameIndex: Int,
            identityOnly: Boolean,
        ): ScanConsensusFrame {
            if (current != readableUnder) {
                // What a blocked step 01 produces: nothing.
                return ScanConsensusFrame(
                    fields = emptyMap(),
                    lapSumAccepted = false,
                    expectedFieldCount = 4,
                )
            }
            return ScanConsensusFrame(
                fields = if (identityOnly) emptyMap() else fields,
                lapSumAccepted = !identityOnly,
                expectedFieldCount = 4,
            )
        }
    }

    @Test
    fun aScanAimedAtTheWrongScreenTriesTheOtherOneBeforeGivingUp() {
        val reader = FakeLayoutReader(
            readableUnder = ScanLayoutProfile.ENDSCREEN,
            chosen = ScanLayoutProfile.GHOST_DETAIL,
            fields = validFields,
        )
        val imageFile = imageFile()
        val analyzer = ScanResultImageAnalyzer(
            decoder = ScanResultImageDecoder { Any() },
            frameAnalyzer = reader,
            contextProvider = ::context,
            capturedAtMsProvider = { 1_786_900_000_000 },
            layoutAttempts = reader,
        )

        val submission = analyzer.analyze(acquired(imageFile))

        assertEquals(60_000, submission.totalTimeMs)
        // The Player's own choice is tried first, and only then the other one.
        assertEquals(
            listOf(ScanLayoutProfile.GHOST_DETAIL, ScanLayoutProfile.ENDSCREEN),
            reader.used,
        )
        // Provenance follows the layout that actually succeeded, not the Player's first choice.
        assertEquals("time_trial_result", submission.source.captureLayout)
    }

    @Test
    fun aScanThatReadsUnderTheChosenLayoutNeverTriesTheOther() {
        val reader = FakeLayoutReader(
            readableUnder = ScanLayoutProfile.ENDSCREEN,
            chosen = ScanLayoutProfile.ENDSCREEN,
            fields = validFields,
        )
        val analyzer = ScanResultImageAnalyzer(
            decoder = ScanResultImageDecoder { Any() },
            frameAnalyzer = reader,
            contextProvider = ::context,
            capturedAtMsProvider = { 1_786_900_000_000 },
            layoutAttempts = reader,
        )

        val submission = analyzer.analyze(acquired(imageFile()))

        assertEquals(listOf(ScanLayoutProfile.ENDSCREEN), reader.used)
        assertEquals("time_trial_result", submission.source.captureLayout)
    }

    @Test
    fun aGhostPanelRecordsTheCanonicalGhostCaptureLayout() {
        val reader = FakeLayoutReader(
            readableUnder = ScanLayoutProfile.GHOST_DETAIL,
            chosen = ScanLayoutProfile.GHOST_DETAIL,
            fields = validFields,
        )
        val analyzer = ScanResultImageAnalyzer(
            decoder = ScanResultImageDecoder { Any() },
            frameAnalyzer = reader,
            contextProvider = ::context,
            capturedAtMsProvider = { 1_786_900_000_000 },
            layoutAttempts = reader,
        )

        val submission = analyzer.analyze(acquired(imageFile()))

        assertEquals(listOf(ScanLayoutProfile.GHOST_DETAIL), reader.used)
        assertEquals("ghost_details", submission.source.captureLayout)
    }

    @Test
    fun anImageNeitherLayoutCanReadStillFailsAndReleasesTheFrame() {
        val reader = FakeLayoutReader(
            // Readable under nothing: both attempts block.
            readableUnder = ScanLayoutProfile.ENDSCREEN,
            chosen = ScanLayoutProfile.GHOST_DETAIL,
            fields = emptyMap(),
        )
        var released = 0
        val analyzer = ScanResultImageAnalyzer(
            decoder = ScanResultImageDecoder { Any() },
            frameAnalyzer = reader,
            contextProvider = ::context,
            capturedAtMsProvider = { 1_786_900_000_000 },
            releaser = ScanResultImageReleaser { released += 1 },
            layoutAttempts = reader,
        )

        assertThrows(ScanResultImageAnalysisException::class.java) {
            analyzer.analyze(acquired(imageFile()))
        }
        assertEquals(
            listOf(ScanLayoutProfile.GHOST_DETAIL, ScanLayoutProfile.ENDSCREEN),
            reader.used,
        )
        // Once, however many layouts were tried: the frame is decoded once.
        assertEquals(1, released)
    }

    /**
     * One still image goes through the five-frame policy, but the engine reads
     * it once: the same frame can only give the same result, so the later
     * frames reuse it instead of paying for identical reads (2026-09-18).
     */
    @Test
    fun oneStableImageIsReadOnceThroughFiveFramePolicyAndReturnsCanonicalSubmission() {
        val imageFile = imageFile()
        val decodedFrame = Any()
        val analyzedFrames = mutableListOf<Any>()
        val analyzedIndices = mutableListOf<Int>()
        var capturedAtCalls = 0
        var released: Any? = null
        val analyzer = ScanResultImageAnalyzer(
            decoder = ScanResultImageDecoder { file ->
                assertEquals(imageFile, file)
                decodedFrame
            },
            frameAnalyzer = ScanFrameAnalyzer { frame, frameIndex, identityOnly ->
                analyzedFrames += frame
                analyzedIndices += frameIndex
                ScanConsensusFrame(
                    fields = if (identityOnly) emptyMap() else validFields,
                    lapSumAccepted = !identityOnly,
                    expectedFieldCount = 4,
                )
            },
            contextProvider = ::context,
            capturedAtMsProvider = {
                capturedAtCalls += 1
                1_786_900_000_000
            },
            releaser = ScanResultImageReleaser { released = it },
        )

        val submission = analyzer.analyze(acquired(imageFile))

        assertEquals(60_000, submission.totalTimeMs)
        assertEquals(3, submission.laps.size)
        assertEquals("android_scan", submission.source.kind)
        assertEquals(1, capturedAtCalls)
        assertEquals(listOf(0), analyzedIndices)
        analyzedFrames.forEach { assertSame(decodedFrame, it) }
        assertSame(decodedFrame, released)
    }

    @Test
    fun progressiveRuntimeStagesReachSourceBasedProductPhases() {
        val imageFile = imageFile()
        val progress = mutableListOf<ResultImageAnalysisProgress>()
        val analyzer = ScanResultImageAnalyzer(
            decoder = ScanResultImageDecoder { Any() },
            frameAnalyzer = object : ProgressiveScanFrameAnalyzer<Any> {
                override fun analyze(
                    frame: Any,
                    frameIndex: Int,
                    identityOnly: Boolean,
                    onProgress: (ScanRuntimeStageProgress) -> Unit,
                ): ScanConsensusFrame {
                    onProgress(ScanRuntimeStageProgress("running", "01_auto_card_roi", 1, 24, 10))
                    onProgress(ScanRuntimeStageProgress("running", "24_seven_segment_ocr", 20, 24, 20))
                    onProgress(ScanRuntimeStageProgress("running", "27_identity", 24, 24, 30))
                    return ScanConsensusFrame(
                        fields = if (identityOnly) emptyMap() else validFields,
                        lapSumAccepted = !identityOnly,
                        expectedFieldCount = 4,
                    )
                }
            },
            contextProvider = ::context,
            capturedAtMsProvider = { 1_786_900_000_000 },
        )

        analyzer.analyze(acquired(imageFile), progress::add)

        assertEquals(ResultImageAnalysisProgress.Starting, progress.first())
        assertTrue(progress.any { it.phase == SCAN_PHASE_CARD })
        assertTrue(progress.any { it.phase == SCAN_PHASE_READ })
        assertTrue(progress.any { it.phase == SCAN_PHASE_SETUP })
        assertEquals(1f, progress.last().fraction)
        assertEquals(SCAN_PHASE_FINISH, progress.last().phase)
        // The progress panel names the frame it is on, so the Player can see a
        // burst is still running rather than only a bar that stopped moving.
        val reading = progress.first { it.phase == SCAN_PHASE_READ }
        assertEquals(1, reading.attemptIndex)
        assertEquals(ScanBurstPolicy.BURST_FRAMES, reading.attemptCount)
        assertFalse(reading.identityOnly)
        // A still image is read once: its identity comes from that read, so no
        // identity-only pass runs and the bar goes from reading to finished.
        assertFalse(progress.filter { it.phase != SCAN_PHASE_FINISH }.any { it.identityOnly })
    }

    @Test
    fun nonLockingRecognitionIsBoundedAndStillReleasesFrame() {
        val imageFile = imageFile()
        val frame = Any()
        var releaseCalls = 0
        val analyzer = ScanResultImageAnalyzer(
            decoder = ScanResultImageDecoder { frame },
            frameAnalyzer = ScanFrameAnalyzer { _, _, _ ->
                ScanConsensusFrame(
                    fields = validFields + ("player_lap_3" to "0:20.50?"),
                    expectedFieldCount = 4,
                )
            },
            contextProvider = ::context,
            capturedAtMsProvider = { 1 },
            releaser = ScanResultImageReleaser {
                assertSame(frame, it)
                releaseCalls += 1
            },
        )

        val error = assertThrows(ScanResultImageAnalysisException::class.java) {
            analyzer.analyze(acquired(imageFile))
        }

        // One read: four identical copies cannot turn "?" into a digit.
        assertEquals(ScanComponentState.NeedsReposition(1), error.terminalState)
        assertEquals(1, releaseCalls)
    }

    @Test
    fun changedOrMissingInputIsRejectedBeforeDecode() {
        val imageFile = imageFile()
        var decodeCalls = 0
        val analyzer = ScanResultImageAnalyzer(
            decoder = ScanResultImageDecoder<Any> {
                decodeCalls += 1
                Any()
            },
            frameAnalyzer = ScanFrameAnalyzer { _, _, _ -> ScanConsensusFrame() },
            contextProvider = ::context,
            capturedAtMsProvider = { 1 },
        )

        assertThrows(ScanResultImageAnalysisException::class.java) {
            analyzer.analyze(acquired(imageFile).copy(byteCount = imageFile.length() + 1))
        }
        assertEquals(0, decodeCalls)

        imageFile.delete()
        assertThrows(ScanResultImageAnalysisException::class.java) {
            analyzer.analyze(acquired(imageFile).copy(byteCount = 1))
        }
        assertEquals(0, decodeCalls)
    }

    private fun imageFile(): File = temporary.newFile("result.image").apply {
        writeBytes(byteArrayOf(1, 2, 3, 4))
    }

    private fun acquired(file: File) = AcquiredResultImage(
        source = ResultImageSource.GALLERY,
        file = file,
        byteCount = file.length(),
    )

    private fun context() = AndroidScanSubmissionContext(
        submissionId = "user_submission.time.RESULTIMAGE001",
        revision = 1,
        mode = 150,
        trackId = "track.mario_kart_stadium",
        playerReference = ScanPlayerReferenceV1(
            namespace = "producer_local_profile",
            value = "result-image-profile",
        ),
        createdAtMs = 1_786_900_000_100,
        producerVersion = "result-image-test",
        localRecordId = "result-image-record",
    )
}
