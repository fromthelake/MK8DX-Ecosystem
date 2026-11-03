package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import nl.mariokart8.mk8dxtimetrials.ui.androidLocalizedPresentation
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal const val ANDROID_OUTBOX_SELECTION_GENERIC_FAILURE_TEXT =
    "Saved result could not be opened"

internal fun androidOutboxBatchResultText(result: AndroidOutboxBatchResult): String = when {
    result.busy -> "Synchronization is already running"
    result.indexUnavailable -> "Saved results unavailable"
    result.items.isEmpty() -> "Nothing to synchronize"
    else -> buildString {
        append("${result.syncedCount} synchronized")
        if (result.failedCount > 0) append(", ${result.failedCount} failed")
        if (result.skippedCount > 0) {
            append(", ${result.skippedCount} waiting for their account to sign in again")
        }
    }
}

@Composable
private fun AndroidOutboxSyncAllAction(
    batch: AndroidOutboxBatchSynchronizationController,
    workerDispatcher: CoroutineDispatcher,
) {
    val scope = rememberCoroutineScope()
    var running by remember(batch) { mutableStateOf(false) }
    var summary by remember(batch) { mutableStateOf<String?>(null) }
    Mk8dxButton(
        androidLocalizedPresentation(
            if (running) "Synchronizing all saved results" else "Sync all",
        ),
        {
            if (!running) {
                running = true
                scope.launch {
                    val result = withContext(workerDispatcher) { batch.synchronizeAll() }
                    summary = androidOutboxBatchResultText(result)
                    running = false
                }
            }
        },
        variant = Mk8dxButtonVariant.Secondary,
        disabledReason = if (running) {
            androidLocalizedPresentation("Synchronizing all saved results")
        } else {
            null
        },
        disabledReasonShown = false,
        tag = "outbox-sync-all",
        modifier = Modifier.fillMaxWidth().padding(horizontal = Mk8dxSpacing.gutterPhone, vertical = Mk8dxSpacing.sm),
    )
    summary?.let { text ->
        Text(
            text = text,
            style = Mk8dxTheme.type.bodyS,
            color = Mk8dxTheme.colors.textBody,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = Mk8dxSpacing.gutterPhone)
                .testTag("outbox-sync-all-summary"),
        )
    }
}

internal fun androidOutboxSelectionFailureText(
    code: AndroidOutboxSelectionFailureCode,
): String = when (code) {
    AndroidOutboxSelectionFailureCode.INDEX_LOAD_IN_PROGRESS,
    AndroidOutboxSelectionFailureCode.INDEX_NOT_LOADED,
    AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE,
    AndroidOutboxSelectionFailureCode.ENTRY_NOT_FOUND,
    AndroidOutboxSelectionFailureCode.BINDING_UNAVAILABLE,
    -> ANDROID_OUTBOX_SELECTION_GENERIC_FAILURE_TEXT
}

@Composable
internal fun AndroidOutboxSynchronizationSelectionScreen(
    dependencies: AndroidOutboxSynchronizationSelectionDependencies,
    labelProvider: AndroidOutboxSelectionLabelProvider,
    onSubmitTimeTrial: () -> Unit = {},
    modifier: Modifier = Modifier,
    workerDispatcher: CoroutineDispatcher = Dispatchers.IO,
    accountDisplayNames: Map<String, String> = emptyMap(),
) {
    AndroidOutboxSynchronizationSelectionWorkflowComponent(dependencies) {
            state,
            onSelectionResult,
            onReturnToSelection,
        ->
        Column(modifier = modifier.testTag("outbox-synchronization-selection-screen")) {
            when (state) {
                is AndroidOutboxSynchronizationSelectionWorkflowState.Selecting -> {
                    state.failureCode?.let { code ->
                        Text(
                            text = androidOutboxSelectionFailureText(code),
                            style = Mk8dxTheme.type.body,
                            color = Mk8dxTheme.colors.statusError,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(
                                    horizontal = Mk8dxSpacing.gutterPhone,
                                    vertical = Mk8dxSpacing.sm,
                                )
                                .testTag("outbox-workflow-selection-failure"),
                        )
                    }
                    dependencies.batchSynchronization?.let { batch ->
                        AndroidOutboxSyncAllAction(
                            batch = batch,
                            workerDispatcher = workerDispatcher,
                        )
                    }
                    AsyncAndroidOutboxSelectionComponent(
                        indexBinding = dependencies.indexBinding,
                        selectionCoordinator = dependencies.selectionCoordinator,
                        labelProvider = labelProvider,
                        onSelectionResult = onSelectionResult,
                        onSubmitTimeTrial = onSubmitTimeTrial,
                        accountDisplayNames = accountDisplayNames,
                    )
                }
                is AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing -> {
                    Mk8dxButton(
                        androidLocalizedPresentation("Back to saved results"),
                        onReturnToSelection,
                        variant = Mk8dxButtonVariant.Secondary,
                        tag = "outbox-workflow-return-to-selection",
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(
                                horizontal = Mk8dxSpacing.gutterPhone,
                                vertical = Mk8dxSpacing.sm,
                            ),
                    )
                    AsyncAndroidOutboxSynchronizationComponent(
                        binding = state.binding,
                    )
                }
            }
        }
    }
}
