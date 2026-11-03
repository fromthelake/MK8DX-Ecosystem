package nl.mariokart8.mk8dxtimetrials.scan

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

@Composable
internal fun <Frame> AsyncScanComponent(
    controllerFactory: ScanAsyncControllerFactory<Frame>,
    onSubmission: (AndroidScanTimeTrialSubmissionV1) -> Unit,
    modifier: Modifier = Modifier,
    workerDispatcher: CoroutineDispatcher = Dispatchers.Default,
    callbackDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) {
    val parentScope = rememberCoroutineScope()
    val currentFactory by rememberUpdatedState(controllerFactory)
    val currentSubmissionCallback by rememberUpdatedState(onSubmission)
    var state by remember { mutableStateOf<ScanComponentState>(ScanComponentState.Ready) }
    val host = remember(parentScope, workerDispatcher, callbackDispatcher) {
        ScanAsyncHost(
            parentScope = parentScope,
            controllerFactory = ScanAsyncControllerFactory { onState, onOutput ->
                currentFactory.create(onState, onOutput)
            },
            onState = { state = it },
            onSubmission = { currentSubmissionCallback(it) },
            workerDispatcher = workerDispatcher,
            callbackDispatcher = callbackDispatcher,
        )
    }

    DisposableEffect(host) {
        onDispose(host::close)
    }
    ScanComponent(
        state = state,
        onScanRequested = { host.startScan() },
        modifier = modifier,
    )
}
