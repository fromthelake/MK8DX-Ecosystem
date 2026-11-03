package nl.mariokart8.mk8dxtimetrials.outbox

internal sealed interface AndroidOutboxSynchronizationSelectionWorkflowState {
    data class Selecting(
        val failureCode: AndroidOutboxSelectionFailureCode? = null,
    ) : AndroidOutboxSynchronizationSelectionWorkflowState

    data class Synchronizing(
        val binding: AndroidOutboxSynchronizationBinding,
    ) : AndroidOutboxSynchronizationSelectionWorkflowState
}

internal class AndroidOutboxSynchronizationSelectionWorkflowController(
    private val onState: (AndroidOutboxSynchronizationSelectionWorkflowState) -> Unit,
) {
    private val lock = Any()
    private var state: AndroidOutboxSynchronizationSelectionWorkflowState =
        AndroidOutboxSynchronizationSelectionWorkflowState.Selecting()

    fun currentState(): AndroidOutboxSynchronizationSelectionWorkflowState = synchronized(lock) {
        state
    }

    fun acceptSelectionResult(
        result: AndroidOutboxSelectionResult,
    ): AndroidOutboxSynchronizationSelectionWorkflowState = synchronized(lock) {
        if (state is AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing) {
            return state
        }
        val next = when (result) {
            is AndroidOutboxSelectionResult.Selected ->
                AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing(
                    result.binding,
                )
            is AndroidOutboxSelectionResult.Failed ->
                AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(result.code)
        }
        state = next
        onState(next)
        next
    }

    fun returnToSelection(): AndroidOutboxSynchronizationSelectionWorkflowState =
        synchronized(lock) {
            val next = AndroidOutboxSynchronizationSelectionWorkflowState.Selecting()
            if (state == next) return state
            state = next
            onState(next)
            next
        }
}
