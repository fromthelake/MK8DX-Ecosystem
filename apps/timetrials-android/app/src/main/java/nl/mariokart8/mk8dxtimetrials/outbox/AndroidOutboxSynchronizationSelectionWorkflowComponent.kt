package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember

@Composable
internal fun AndroidOutboxSynchronizationSelectionWorkflowComponent(
    dependencies: AndroidOutboxSynchronizationSelectionDependencies,
    content: @Composable (
        state: AndroidOutboxSynchronizationSelectionWorkflowState,
        onSelectionResult: (AndroidOutboxSelectionResult) -> Unit,
        onReturnToSelection: () -> Unit,
    ) -> Unit,
) {
    val state = remember(
        dependencies.indexBinding,
        dependencies.selectionCoordinator,
    ) {
        mutableStateOf<AndroidOutboxSynchronizationSelectionWorkflowState>(
            AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(),
        )
    }
    val controller = remember(
        dependencies.indexBinding,
        dependencies.selectionCoordinator,
    ) {
        AndroidOutboxSynchronizationSelectionWorkflowController { state.value = it }
    }

    content(
        state.value,
        controller::acceptSelectionResult,
        controller::returnToSelection,
    )
}
