package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

internal class AndroidOutboxSynchronizationBinding(
    internal val actionsFactory: AndroidOutboxSynchronizationActionsFactory,
)

@Composable
internal fun AsyncAndroidOutboxSynchronizationComponent(
    binding: AndroidOutboxSynchronizationBinding,
    modifier: Modifier = Modifier,
    workerDispatcher: CoroutineDispatcher = Dispatchers.IO,
    callbackDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) {
    val parentScope = rememberCoroutineScope()
    val state = remember(binding) {
        mutableStateOf<AndroidOutboxSynchronizationState>(
            AndroidOutboxSynchronizationState.Unloaded,
        )
    }
    val host = remember(parentScope, binding, workerDispatcher, callbackDispatcher) {
        AndroidOutboxSynchronizationAsyncHost(
            parentScope = parentScope,
            actionsFactory = binding.actionsFactory,
            onState = { state.value = it },
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )
    }

    DisposableEffect(host) {
        onDispose(host::close)
    }
    AndroidOutboxSynchronizationComponent(
        state = state.value,
        onLoadRequested = { host.load() },
        onDeliveryRequested = { host.deliver() },
        onRetryRequested = { host.requestRetry() },
        modifier = modifier,
    )
}
