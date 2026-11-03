package nl.mariokart8.mk8dxtimetrials.scan

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable
internal fun ScanComponent(
    state: ScanComponentState,
    onScanRequested: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val busy = state is ScanComponentState.Capturing || state is ScanComponentState.Analyzing
    val status = state.statusText()
    val action = when (state) {
        is ScanComponentState.Completed -> "Scan another result"
        ScanComponentState.Cancelled,
        is ScanComponentState.NeedsReposition,
        is ScanComponentState.Failed,
        -> "Try again"
        else -> "Scan result"
    }

    Surface(modifier = modifier.testTag("scan-component")) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = "Scan Time Trial",
                style = MaterialTheme.typography.headlineSmall,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = status,
                modifier = Modifier.testTag("scan-status"),
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = onScanRequested,
                enabled = !busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("scan-action"),
            ) {
                Text(action)
            }
        }
    }
}

private fun ScanComponentState.statusText(): String = when (this) {
    ScanComponentState.Ready -> "Ready to scan a result screen"
    ScanComponentState.Capturing -> "Capturing five frames"
    ScanComponentState.Cancelled -> "Scan cancelled"
    is ScanComponentState.Analyzing -> if (identityOnly) {
        "Confirming driver and kart (${completedFrames + 1} of $totalFrames)"
    } else {
        "Reading times (${completedFrames + 1} of $totalFrames)"
    }
    is ScanComponentState.Completed -> "Saved $lapCount-lap result"
    is ScanComponentState.NeedsReposition -> "Reposition the result screen and try again"
    is ScanComponentState.Failed -> when (code) {
        ScanComponentFailureCode.CAPTURE_FAILURE -> "Could not capture the result screen"
        ScanComponentFailureCode.CONTEXT_UNAVAILABLE -> "Result details are not ready"
        ScanComponentFailureCode.INVALID_BURST_SIZE,
        ScanComponentFailureCode.ANALYZER_FAILURE,
        ScanComponentFailureCode.INVALID_CANONICAL_RESULT,
        ScanComponentFailureCode.EXECUTION_FAILURE,
        -> "Could not read a complete result"
    }
}
