package nl.mariokart8.mk8dxtimetrials.scan

import android.content.Context
import android.net.Uri
import java.io.File
import kotlinx.coroutines.CoroutineScope
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSubmissionHost

internal fun interface ContextualResultImageAnalyzerFactory {
    fun create(
        contextProvider: () -> AndroidScanSubmissionContext,
    ): ResultImageAnalyzer
}

/**
 * Normal-build product composition for local acquisition, trusted canonical
 * context, offline analysis, and durable canonical outbox publication.
 * Recognition payload and outbox roots remain injected dependencies.
 */
internal class AndroidScanProductHostFactory(
    context: Context,
    private val analyzerFactory: ContextualResultImageAnalyzerFactory,
    private val contextProvider: () -> AndroidScanSubmissionContext,
    private val submissionHost: AndroidOutboxSubmissionHost? = null,
    private val previewSink: (AcquiredResultImage) -> Unit = {},
    private val sessionRoot: File = File(
        context.cacheDir,
        "mk8dx-result-images/product-sessions",
    ),
) : ResultImageAsyncHostFactory {
    private val applicationContext = context.applicationContext
    private val analyzer by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        analyzerFactory.create(contextProvider)
    }

    override fun create(
        parentScope: CoroutineScope,
        onState: (ResultImageAcquisitionState) -> Unit,
        onSubmission: (AndroidScanTimeTrialSubmissionV1) -> Unit,
    ): ResultImageAsyncHost<Uri, Uri> = ResultImageAsyncHost(
        parentScope = parentScope,
        acquisition = AndroidResultImageAcquisitionPort(
            applicationContext,
            sessionRoot,
        ),
        analyzer = analyzer,
        onState = onState,
        onSubmission = onSubmission,
        onPreview = previewSink,
        // Product scans are drafts until the Player has reviewed and accepted
        // every recognized field. A sink remains injectable for lower-level
        // migration tests, but the production review screen owns publication.
        submissionSink = submissionHost?.let { host ->
            ResultImageSubmissionSink(host::storeScan)
        } ?: ResultImageSubmissionSink {},
    )
}
