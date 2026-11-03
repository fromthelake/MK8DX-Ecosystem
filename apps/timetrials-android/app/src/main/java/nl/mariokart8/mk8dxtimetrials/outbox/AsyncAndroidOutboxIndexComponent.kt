package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

internal class AndroidOutboxIndexBinding(
    internal val actionsFactory: AndroidOutboxIndexActionsFactory,
)

@Composable
internal fun AsyncAndroidOutboxIndexComponent(
    binding: AndroidOutboxIndexBinding,
    workerDispatcher: CoroutineDispatcher = Dispatchers.IO,
    callbackDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
    content: @Composable (
        state: AndroidOutboxIndexState,
        loadInProgress: Boolean,
        onLoadRequested: () -> Unit,
    ) -> Unit,
) {
    val parentScope = rememberCoroutineScope()
    val state = remember(binding) {
        mutableStateOf<AndroidOutboxIndexState>(AndroidOutboxIndexState.Unloaded)
    }
    val loadInProgress = remember(binding) { mutableStateOf(false) }
    val host = remember(parentScope, binding, workerDispatcher, callbackDispatcher) {
        AndroidOutboxIndexAsyncHost(
            parentScope = parentScope,
            actionsFactory = binding.actionsFactory,
            onState = {
                state.value = it
                loadInProgress.value = false
            },
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )
    }

    DisposableEffect(host) {
        onDispose(host::close)
    }
    LaunchedEffect(host) {
        if (!loadInProgress.value) {
            loadInProgress.value = true
            if (!host.load()) loadInProgress.value = false
        }
    }
    content(
        state.value,
        loadInProgress.value,
    ) {
        if (!loadInProgress.value) {
            loadInProgress.value = true
            if (!host.load()) loadInProgress.value = false
        }
    }
}
