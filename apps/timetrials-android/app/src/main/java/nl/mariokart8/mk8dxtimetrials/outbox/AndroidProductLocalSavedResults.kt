package nl.mariokart8.mk8dxtimetrials.outbox

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import java.io.File
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin

internal const val ANDROID_PRODUCT_CANONICAL_OUTBOX_DIRECTORY =
    "time-trial-canonical-outbox-v1"
internal const val ANDROID_PRODUCT_PRIVATE_EVIDENCE_DIRECTORY =
    "time-trial-private-evidence-v1"

internal fun createAndroidProductTimeTrialOutbox(
    context: Context,
): AndroidLocalTimeTrialOutbox = AndroidLocalTimeTrialOutbox(
    canonicalRoot = File(
        context.filesDir,
        ANDROID_PRODUCT_CANONICAL_OUTBOX_DIRECTORY +
            (if (AndroidServerOrigin.usesPackagedDefault(context)) "" else "_" + AndroidServerOrigin.namespace(context)),
    ),
    privateEvidenceRoot = File(
        context.noBackupFilesDir,
        ANDROID_PRODUCT_PRIVATE_EVIDENCE_DIRECTORY +
            (if (AndroidServerOrigin.usesPackagedDefault(context)) "" else "_" + AndroidServerOrigin.namespace(context)),
    ),
    validateSubmission = AndroidProducedSubmissionValidator,
)

@Composable
internal fun AndroidProductLocalSavedResultsScreen(
    outbox: AndroidCanonicalOutboxSynchronizationSelectionPort,
    synchronizationDependencies: AndroidSavedResultSynchronizationScreenDependencies? = null,
    onSubmitTimeTrial: () -> Unit = {},
    modifier: Modifier = Modifier,
    accountDisplayNames: Map<String, String> = emptyMap(),
) {
    // A08 is migrated: the page itself carries the design system's app surface,
    // so the shell's backdrop stops at the edge of a data screen.
    // No scroll of its own: the list inside is a LazyColumn, and a scrolling
    // parent measures it with an unbounded height and crashes.
    val page = modifier.fillMaxSize().background(Mk8dxTheme.colors.surfaceApp)
    if (synchronizationDependencies != null) {
        AndroidOutboxSynchronizationSelectionScreen(
            dependencies = synchronizationDependencies.synchronization,
            labelProvider = synchronizationDependencies.labelProvider,
            onSubmitTimeTrial = onSubmitTimeTrial,
            modifier = page,
            accountDisplayNames = accountDisplayNames,
        )
        return
    }
    val orderedIndex = remember(outbox) {
        AndroidNewestFirstSynchronizationSelectionPort(outbox)
    }
    val indexBinding = remember(orderedIndex) {
        AndroidOutboxIndexBinding(
            AndroidOutboxIndexActionsFactory {
                AndroidOutboxIndexController(
                    index = orderedIndex,
                    onState = {},
                )
            },
        )
    }
    val labelProvider = remember { AndroidSavedResultTimestampLabelProvider() }

    AsyncAndroidOutboxIndexComponent(binding = indexBinding) {
            state,
            loadInProgress,
            onLoadRequested,
        ->
        AndroidOutboxSelectionComponent(
            state = state,
            loadInProgress = loadInProgress,
            labelProvider = labelProvider,
            onLoadRequested = onLoadRequested,
            onEntrySelected = {},
            synchronizationAvailable = false,
            onSubmitTimeTrial = onSubmitTimeTrial,
            modifier = page,
            accountDisplayNames = accountDisplayNames,
        )
    }
}
