package nl.mariokart8.mk8dxtimetrials.scan

internal fun interface ScanFrameAnalyzer<Frame> {
    fun analyze(frame: Frame, frameIndex: Int, identityOnly: Boolean): ScanConsensusFrame
}

internal enum class ScanCoordinatorFailureCode {
    INVALID_BURST_SIZE,
    ANALYZER_FAILURE,
}

internal sealed interface ScanCoordinatorState {
    data class Analyzing(
        val frameIndex: Int,
        val completedFrames: Int,
        val totalFrames: Int,
        val identityOnly: Boolean,
    ) : ScanCoordinatorState

    data class Locked(
        val completedFrames: Int,
        val totalFrames: Int,
        val lockFrameIndex: Int,
        val acceptPath: String,
    ) : ScanCoordinatorState

    data class NeedsReposition(
        val completedFrames: Int,
        val totalFrames: Int,
    ) : ScanCoordinatorState

    data class Failed(
        val completedFrames: Int,
        val totalFrames: Int,
        val code: ScanCoordinatorFailureCode,
    ) : ScanCoordinatorState
}

internal sealed interface ScanCoordinatorOutcome {
    data class Locked(
        val encodedResult: String,
        val lockFrameIndex: Int,
        val framesProcessed: Int,
    ) : ScanCoordinatorOutcome

    data class NeedsReposition(val framesProcessed: Int) : ScanCoordinatorOutcome

    data class Cancelled(val framesProcessed: Int) : ScanCoordinatorOutcome

    data class Failed(
        val framesProcessed: Int,
        val code: ScanCoordinatorFailureCode,
    ) : ScanCoordinatorOutcome
}

internal class ScanCoordinator<Frame>(
    private val analyzer: ScanFrameAnalyzer<Frame>,
    private val onState: (ScanCoordinatorState) -> Unit = {},
    private val onLockedResult: (String) -> Unit = {},
) {
    fun analyzeBurst(
        frames: List<Frame>,
        capturedAtMs: Long,
        shouldContinue: () -> Boolean = { true },
    ): ScanCoordinatorOutcome {
        if (frames.size != ScanBurstPolicy.BURST_FRAMES) {
            val code = ScanCoordinatorFailureCode.INVALID_BURST_SIZE
            onState(ScanCoordinatorState.Failed(0, ScanBurstPolicy.BURST_FRAMES, code))
            return ScanCoordinatorOutcome.Failed(0, code)
        }

        val session = ScanConsensusSession()
        var lockFrameIndex = -1
        var processed = 0
        var previous: ScanConsensusFrame? = null
        for ((frameIndex, frame) in frames.withIndex()) {
            if (!shouldContinue()) return ScanCoordinatorOutcome.Cancelled(processed)
            val identityOnly = session.locked
            // A still image arrives as the same frame repeated (or as a few
            // sizes of it, each repeated), and the engine is deterministic: the
            // same frame can only give the same result. So it is not read again.
            // After a lock the earlier result still casts the identity vote;
            // before a lock it is reused only to confirm a lap sum the engine
            // closed with a repair (the path that has always locked such a
            // still). Anything else cannot change, so the frame is skipped: the
            // next different size is the second opinion, and when there is none
            // the other layout gets its turn.
            val repeat = frameIndex > 0 && frame === frames[frameIndex - 1] && previous != null
            if (repeat && !session.locked && previous?.lapSumAccepted != true) continue
            onState(
                ScanCoordinatorState.Analyzing(
                    frameIndex = frameIndex,
                    completedFrames = processed,
                    totalFrames = frames.size,
                    identityOnly = identityOnly,
                ),
            )
            val result = if (repeat) requireNotNull(previous) else try {
                analyzer.analyze(frame, frameIndex, identityOnly)
            } catch (_: Exception) {
                val code = ScanCoordinatorFailureCode.ANALYZER_FAILURE
                onState(ScanCoordinatorState.Failed(processed, frames.size, code))
                return ScanCoordinatorOutcome.Failed(processed, code)
            }
            previous = result
            val justLocked = session.consume(result)
            processed += 1
            if (justLocked) lockFrameIndex = frameIndex
            if (
                ScanBurstPolicy.shouldStopAfterFrame(
                    session,
                    currentFrameIndex = frameIndex,
                    lockedFrameIndex = lockFrameIndex,
                )
            ) {
                break
            }
        }

        if (!session.locked) {
            onState(ScanCoordinatorState.NeedsReposition(processed, frames.size))
            return ScanCoordinatorOutcome.NeedsReposition(processed)
        }
        val encoded = session.encodeCompactResult(capturedAtMs, lockFrameIndex)
        onLockedResult(encoded)
        onState(
            ScanCoordinatorState.Locked(
                completedFrames = processed,
                totalFrames = frames.size,
                lockFrameIndex = lockFrameIndex,
                acceptPath = session.acceptPath,
            ),
        )
        return ScanCoordinatorOutcome.Locked(encoded, lockFrameIndex, processed)
    }
}
