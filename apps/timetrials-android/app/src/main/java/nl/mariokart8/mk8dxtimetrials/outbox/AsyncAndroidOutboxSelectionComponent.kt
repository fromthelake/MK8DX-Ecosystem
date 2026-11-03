package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

@Composable
internal fun AsyncAndroidOutboxSelectionComponent(
    indexBinding: AndroidOutboxIndexBinding,
    selectionCoordinator: AndroidOutboxSelectionCoordinator,
    labelProvider: AndroidOutboxSelectionLabelProvider,
    onSelectionResult: (AndroidOutboxSelectionResult) -> Unit,
    onSubmitTimeTrial: () -> Unit = {},
    modifier: Modifier = Modifier,
    workerDispatcher: CoroutineDispatcher = Dispatchers.IO,
    callbackDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
    accountDisplayNames: Map<String, String> = emptyMap(),
) {
    AsyncAndroidOutboxIndexComponent(
        binding = indexBinding,
        workerDispatcher = workerDispatcher,
        callbackDispatcher = callbackDispatcher,
    ) { state, loadInProgress, onLoadRequested ->
        AndroidOutboxSelectionComponent(
            state = state,
            loadInProgress = loadInProgress,
            labelProvider = labelProvider,
            onLoadRequested = onLoadRequested,
            onEntrySelected = { entryKeyHash ->
                onSelectionResult(
                    selectionCoordinator.select(
                        indexState = state,
                        loadInProgress = loadInProgress,
                        entryKeyHash = entryKeyHash,
                    ),
                )
            },
            onSubmitTimeTrial = onSubmitTimeTrial,
            modifier = modifier,
            accountDisplayNames = accountDisplayNames,
        )
    }
}
