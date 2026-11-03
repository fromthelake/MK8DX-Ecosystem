package nl.mariokart8.mk8dxtimetrials.scan

import java.io.File

internal fun interface ScanResultImageDecoder<Frame> {
    fun decode(file: File): Frame

    /** Decode knowing where the image came from; by default the source does not matter. */
    fun decode(file: File, source: ResultImageSource): Frame = decode(file)
}

internal fun interface ScanResultImageReleaser<Frame> {
    fun release(frame: Frame)
}

/**
 * How one still image becomes the five-frame burst. By default it is the same
 * frame five times, which the coordinator reads once. A guided camera still
 * can instead be read at several sizes, so a retry is a second opinion rather
 * than a copy; [release] frees whatever [burst] created besides the frame.
 */
internal interface ScanStillRenderings<Frame> {
    fun burst(frame: Frame, source: ResultImageSource): List<Frame>

    fun release(burst: List<Frame>, frame: Frame)
}

internal class ScanResultImageAnalysisException(
    val terminalState: ScanComponentState?,
) : RuntimeException("Result image recognition did not produce a canonical submission.")

internal data class ScanRuntimeStageProgress(
    val status: String,
    val stage: String,
    val completedStages: Int,
    val totalStages: Int,
    val elapsedMs: Long,
)

/**
 * A frame reader whose screen layout can be changed between bursts.
 *
 * The layout is not a preference the reader can ignore: it decides the step-01
 * ROI route, the canonical target box and the relative grid, so a burst aimed at
 * the wrong screen blocks immediately and reads nothing. Rather than leave that
 * as a silent trap in a toggle, a scan that finds nothing tries the other layout
 * before it gives up. A wrong layout blocks in well under a second per frame, so
 * the second attempt is cheap; a right one never happens because the first
 * attempt already succeeded.
 */
internal interface ScanLayoutAttempts {
    /** The layouts to try, in order: the chosen one first, then the other. */
    fun attempts(): List<ScanLayoutProfile>

    /** Point the reader at this layout for the next burst. */
    fun use(layout: ScanLayoutProfile)
}

internal interface ProgressiveScanFrameAnalyzer<Frame> : ScanFrameAnalyzer<Frame> {
    fun analyze(
        frame: Frame,
        frameIndex: Int,
        identityOnly: Boolean,
        onProgress: (ScanRuntimeStageProgress) -> Unit,
    ): ScanConsensusFrame

    override fun analyze(frame: Frame, frameIndex: Int, identityOnly: Boolean): ScanConsensusFrame =
        analyze(frame, frameIndex, identityOnly) {}
}

/**
 * Adapts one locally acquired still image to the existing five-frame scan
 * consensus/controller path. The concrete decoder and recognition runtime stay
 * outside the normal dependency graph.
 */
internal class ScanResultImageAnalyzer<Frame>(
    private val decoder: ScanResultImageDecoder<Frame>,
    private val frameAnalyzer: ScanFrameAnalyzer<Frame>,
    private val contextProvider: () -> AndroidScanSubmissionContext,
    private val capturedAtMsProvider: () -> Long,
    private val releaser: ScanResultImageReleaser<Frame> = ScanResultImageReleaser {},
    private val layoutAttempts: ScanLayoutAttempts? = null,
    private val renderings: ScanStillRenderings<Frame>? = null,
) : ProgressiveResultImageAnalyzer {
    private val lock = Any()

    override fun analyze(
        image: AcquiredResultImage,
        onProgress: (ResultImageAnalysisProgress) -> Unit,
    ): AndroidScanTimeTrialSubmissionV1 =
        synchronized(lock) {
            requireStableInput(image)
            onProgress(ResultImageAnalysisProgress.Starting)
            val frame = decoder.decode(image.file, image.source)
            // One burst for every layout attempt: a size read under one layout
            // is not rendered again for the other.
            val burst = renderings?.burst(frame, image.source) ?: List(ScanBurstPolicy.BURST_FRAMES) { frame }
            try {
                val layouts = layoutAttempts?.attempts()?.takeIf { it.isNotEmpty() }
                var failure: ScanResultImageAnalysisException? = null
                for ((index, layout) in (layouts ?: listOf(null)).withIndex()) {
                    if (layout != null) layoutAttempts?.use(layout)
                    if (index > 0) {
                        // Say so rather than restarting the bar in silence.
                        onProgress(
                            ResultImageAnalysisProgress(
                                phase = if (layout == ScanLayoutProfile.GHOST_DETAIL) {
                                    SCAN_PHASE_TRY_GHOST
                                } else {
                                    SCAN_PHASE_TRY_ENDSCREEN
                                },
                                fraction = .05f,
                                stage = "01_AutoCardROI",
                                completedStages = 0,
                                totalStages = 24,
                                attemptCount = ScanBurstPolicy.BURST_FRAMES,
                                attemptIndex = 1,
                            ),
                        )
                    }
                    try {
                        val submission = readBurst(burst, onProgress)
                        val withLayout = if (layout == null) {
                            submission
                        } else {
                            submission.copy(source = submission.source.copy(captureLayout = layout.submissionValue))
                        }
                        return@synchronized withLayout.also { recorded ->
                            ScanDebug.recorder?.outcome(
                                org.json.JSONObject()
                                    .put("result", "submission")
                                    .put("layout", layout?.engineValue ?: org.json.JSONObject.NULL)
                                    .put("submission", scanDebugSubmissionJson(recorded)),
                            )
                        }
                    } catch (error: ScanResultImageAnalysisException) {
                        failure = error
                    }
                }
                ScanDebug.recorder?.outcome(
                    org.json.JSONObject()
                        .put("result", "no_submission")
                        .put("terminal_state", failure?.terminalState?.toString() ?: org.json.JSONObject.NULL),
                )
                throw failure ?: ScanResultImageAnalysisException(null)
            } finally {
                renderings?.release(burst, frame)
                releaser.release(frame)
            }
        }

    private fun readBurst(
        burst: List<Frame>,
        onProgress: (ResultImageAnalysisProgress) -> Unit,
    ): AndroidScanTimeTrialSubmissionV1 {
        var submission: AndroidScanTimeTrialSubmissionV1? = null
        val reportingAnalyzer = ScanFrameAnalyzer<Frame> { analyzedFrame, frameIndex, identityOnly ->
            if (frameAnalyzer is ProgressiveScanFrameAnalyzer<Frame>) {
                frameAnalyzer.analyze(analyzedFrame, frameIndex, identityOnly) { stage ->
                    onProgress(stage.toProductProgress(frameIndex, identityOnly))
                }
            } else {
                onProgress(fallbackFrameProgress(frameIndex, identityOnly))
                frameAnalyzer.analyze(analyzedFrame, frameIndex, identityOnly)
            }
        }
        val terminalState = ScanComponentController(
            burstProvider = ScanBurstProvider {
                ScanCapturedBurst(
                    frames = burst,
                    capturedAtMs = capturedAtMsProvider(),
                )
            },
            coordinatorFactory = ScanCoordinatorFactory { onState ->
                ScanCoordinator(
                    analyzer = reportingAnalyzer,
                    onState = onState,
                )
            },
            contextProvider = contextProvider,
            onSubmission = { submission = it },
            onState = {},
        ).scan()
        submission?.also {
            onProgress(
                ResultImageAnalysisProgress(
                    phase = SCAN_PHASE_FINISH,
                    fraction = 1f,
                    stage = "complete",
                    completedStages = 24,
                    totalStages = 24,
                    attemptCount = ScanBurstPolicy.BURST_FRAMES,
                    attemptIndex = ScanBurstPolicy.BURST_FRAMES,
                    framePercent = 100,
                    identityOnly = true,
                ),
            )
        } ?: throw ScanResultImageAnalysisException(terminalState)
        return requireNotNull(submission)
    }

    private fun requireStableInput(image: AcquiredResultImage) {
        val actualBytes = try {
            if (!image.file.isFile) -1L else image.file.length()
        } catch (_: Exception) {
            -1L
        }
        if (image.byteCount < 1L || actualBytes != image.byteCount) {
            throw ScanResultImageAnalysisException(null)
        }
    }
}

internal fun ScanRuntimeStageProgress.toProductProgress(
    frameIndex: Int,
    identityOnly: Boolean,
): ResultImageAnalysisProgress {
    val stageNumber = stage.take(2).toIntOrNull()
    val (phase, fraction) = if (identityOnly) {
        val confirmationFrames = (ScanBurstPolicy.BURST_FRAMES - 1).coerceAtLeast(1)
        val withinFrame = if (totalStages > 0) {
            completedStages.toFloat().div(totalStages).coerceIn(.05f, .95f)
        } else {
            .5f
        }
        SCAN_PHASE_CONFIRM to (
            .78f + .21f * ((frameIndex - 1).coerceAtLeast(0) + withinFrame) / confirmationFrames
        ).coerceIn(.78f, .99f)
    } else when {
        stageNumber == null || stageNumber <= 2 ->
            SCAN_PHASE_CARD to if (stageNumber == 2) .25f else .10f
        stageNumber <= 21 -> {
            val within = ((stageNumber - 3) / 18f).coerceIn(0f, 1f)
            SCAN_PHASE_SLOTS to .25f + .25f * within
        }
        stageNumber <= 26 ->
            SCAN_PHASE_READ to if (stageNumber == 26) .60f else .54f
        else -> SCAN_PHASE_SETUP to .72f
    }
    val safeTotal = totalStages.coerceAtLeast(1)
    val done = completedStages.coerceIn(0, safeTotal)
    return ResultImageAnalysisProgress(
        phase = phase,
        fraction = fraction,
        stage = stage.ifBlank { status.ifBlank { "recognition" } },
        completedStages = done,
        totalStages = safeTotal,
        attemptIndex = (frameIndex + 1).coerceIn(1, ScanBurstPolicy.BURST_FRAMES),
        attemptCount = ScanBurstPolicy.BURST_FRAMES,
        framePercent = (done * 100 / safeTotal).coerceIn(0, 100),
        identityOnly = identityOnly,
        // Every frame of this burst is the same still image, so a second full
        // read means the first one did not close on the lap sum.
        difficultFrame = !identityOnly && frameIndex >= 1,
    )
}

// The scanner's own phase wording, so the APK and the scanner read as one
// product. Dutch comes from AndroidDutchUiCopy through LocalizedText.
internal const val SCAN_PHASE_CARD = "Finding card…"
internal const val SCAN_PHASE_SLOTS = "Finding time slots…"
internal const val SCAN_PHASE_READ = "Reading times…"
internal const val SCAN_PHASE_SETUP = "Identifying setup…"
internal const val SCAN_PHASE_CONFIRM = "Confirming setup…"
internal const val SCAN_PHASE_FINISH = "Finish!"
// Said out loud when the first layout read nothing and the other one is
// being tried, so the bar restarting has a reason the Player can see.
internal const val SCAN_PHASE_TRY_ENDSCREEN = "Trying the end screen\u2026"
internal const val SCAN_PHASE_TRY_GHOST = "Trying the ghost panel\u2026"

private fun fallbackFrameProgress(frameIndex: Int, identityOnly: Boolean) =
    ResultImageAnalysisProgress(
        phase = if (identityOnly) SCAN_PHASE_CONFIRM else SCAN_PHASE_READ,
        fraction = if (identityOnly) {
            (.78f + .2f * frameIndex / ScanBurstPolicy.BURST_FRAMES).coerceAtMost(.98f)
        } else {
            .12f
        },
        stage = "frame_${frameIndex + 1}",
        completedStages = frameIndex.coerceAtMost(ScanBurstPolicy.BURST_FRAMES),
        totalStages = ScanBurstPolicy.BURST_FRAMES,
        attemptIndex = (frameIndex + 1).coerceIn(1, ScanBurstPolicy.BURST_FRAMES),
        attemptCount = ScanBurstPolicy.BURST_FRAMES,
        framePercent = (frameIndex * 100 / ScanBurstPolicy.BURST_FRAMES).coerceIn(0, 100),
        identityOnly = identityOnly,
        difficultFrame = !identityOnly && frameIndex >= 1,
    )
