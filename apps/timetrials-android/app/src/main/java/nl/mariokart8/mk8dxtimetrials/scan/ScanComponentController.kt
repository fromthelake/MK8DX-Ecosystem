package nl.mariokart8.mk8dxtimetrials.scan

internal data class ScanCapturedBurst<Frame>(
    val frames: List<Frame>,
    val capturedAtMs: Long,
)

internal fun interface ScanBurstProvider<Frame> {
    fun captureBurst(): ScanCapturedBurst<Frame>
}

internal fun interface ScanCoordinatorFactory<Frame> {
    fun create(onState: (ScanCoordinatorState) -> Unit): ScanCoordinator<Frame>
}

internal enum class ScanComponentFailureCode {
    CAPTURE_FAILURE,
    INVALID_BURST_SIZE,
    ANALYZER_FAILURE,
    CONTEXT_UNAVAILABLE,
    INVALID_CANONICAL_RESULT,
    EXECUTION_FAILURE,
}

internal sealed interface ScanComponentState {
    data object Ready : ScanComponentState
    data object Capturing : ScanComponentState
    data object Cancelled : ScanComponentState

    data class Analyzing(
        val completedFrames: Int,
        val totalFrames: Int,
        val identityOnly: Boolean,
    ) : ScanComponentState

    data class Completed(
        val totalTimeMs: Long,
        val lapCount: Int,
    ) : ScanComponentState

    data class NeedsReposition(
        val framesProcessed: Int,
    ) : ScanComponentState

    data class Failed(
        val code: ScanComponentFailureCode,
    ) : ScanComponentState
}

internal class ScanComponentController<Frame>(
    private val burstProvider: ScanBurstProvider<Frame>,
    private val coordinatorFactory: ScanCoordinatorFactory<Frame>,
    private val contextProvider: () -> AndroidScanSubmissionContext,
    private val onSubmission: (AndroidScanTimeTrialSubmissionV1) -> Unit,
    private val onState: (ScanComponentState) -> Unit,
    private val stableAssets: ScanStableAssetResolver = Schema9ScanStableAssetResolver,
) {
    fun scan(shouldContinue: () -> Boolean = { true }): ScanComponentState {
        emit(ScanComponentState.Capturing)
        val burst = try {
            burstProvider.captureBurst()
        } catch (_: Exception) {
            return emit(ScanComponentState.Failed(ScanComponentFailureCode.CAPTURE_FAILURE))
        }
        if (!shouldContinue()) return emit(ScanComponentState.Cancelled)

        val coordinator = coordinatorFactory.create(::acceptCoordinatorState)
        return when (
            val outcome = coordinator.analyzeBurst(
                burst.frames,
                burst.capturedAtMs,
                shouldContinue,
            )
        ) {
            is ScanCoordinatorOutcome.Locked -> complete(outcome.encodedResult, shouldContinue)
            is ScanCoordinatorOutcome.NeedsReposition -> emit(
                ScanComponentState.NeedsReposition(outcome.framesProcessed),
            )
            is ScanCoordinatorOutcome.Cancelled -> emit(ScanComponentState.Cancelled)
            is ScanCoordinatorOutcome.Failed -> emit(
                ScanComponentState.Failed(outcome.code.toComponentFailure()),
            )
        }
    }

    private fun complete(
        encodedResult: String,
        shouldContinue: () -> Boolean,
    ): ScanComponentState {
        if (!shouldContinue()) return emit(ScanComponentState.Cancelled)
        val context = try {
            contextProvider()
        } catch (_: Exception) {
            return emit(ScanComponentState.Failed(ScanComponentFailureCode.CONTEXT_UNAVAILABLE))
        }
        val submission = try {
            createAndroidScanSubmissionFromCompactResult(
                encodedResult = encodedResult,
                context = context,
                stableAssets = stableAssets,
            )
        } catch (_: CompactScanResultException) {
            return emit(
                ScanComponentState.Failed(ScanComponentFailureCode.INVALID_CANONICAL_RESULT),
            )
        } catch (_: AndroidScanSubmissionException) {
            return emit(
                ScanComponentState.Failed(ScanComponentFailureCode.INVALID_CANONICAL_RESULT),
            )
        }
        if (!shouldContinue()) return emit(ScanComponentState.Cancelled)
        onSubmission(submission)
        return emit(ScanComponentState.Completed(submission.totalTimeMs, submission.laps.size))
    }

    private fun acceptCoordinatorState(state: ScanCoordinatorState) {
        when (state) {
            is ScanCoordinatorState.Analyzing -> emit(
                ScanComponentState.Analyzing(
                    completedFrames = state.completedFrames,
                    totalFrames = state.totalFrames,
                    identityOnly = state.identityOnly,
                ),
            )
            is ScanCoordinatorState.NeedsReposition,
            is ScanCoordinatorState.Failed,
            is ScanCoordinatorState.Locked,
            -> Unit
        }
    }

    private fun emit(state: ScanComponentState): ScanComponentState {
        onState(state)
        return state
    }
}

private fun ScanCoordinatorFailureCode.toComponentFailure(): ScanComponentFailureCode = when (this) {
    ScanCoordinatorFailureCode.INVALID_BURST_SIZE -> ScanComponentFailureCode.INVALID_BURST_SIZE
    ScanCoordinatorFailureCode.ANALYZER_FAILURE -> ScanComponentFailureCode.ANALYZER_FAILURE
}
