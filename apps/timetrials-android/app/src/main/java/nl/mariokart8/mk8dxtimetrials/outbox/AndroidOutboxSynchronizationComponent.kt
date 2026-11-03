package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidLocalizedPresentation
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * One saved result's synchronization (A08), on the design system (Phase 12).
 *
 * Sync and retry stay two separate intentions with the same preconditions they
 * had: delivery only from pending, retry only after a failure, and neither
 * while an action is running. A button that cannot be used now says why, in the
 * status line it sits under and in its own state description.
 */
@Composable
internal fun AndroidOutboxSynchronizationComponent(
    state: AndroidOutboxSynchronizationState,
    onLoadRequested: () -> Unit,
    onDeliveryRequested: () -> Unit,
    onRetryRequested: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val snapshot = state.presentationSnapshot()
    val actionInProgress = state is AndroidOutboxSynchronizationState.Working ||
        state is AndroidOutboxSynchronizationState.ActionFailed &&
        state.code == AndroidOutboxSynchronizationFailureCode.ACTION_IN_PROGRESS
    val canDeliver = !actionInProgress &&
        snapshot?.storedState == AndroidOutboxStoredState.PENDING
    val canRetry = !actionInProgress &&
        snapshot?.storedState == AndroidOutboxStoredState.FAILED
    val colors = Mk8dxTheme.colors
    val statusText = state.statusText()
    val reason = androidLocalizedPresentation(statusText)

    Column(
        modifier
            .fillMaxWidth()
            .padding(Mk8dxSpacing.gutterPhone)
            .testTag("outbox-synchronization"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Mk8dxDisplayText(
            androidLocalizedPresentation("Result synchronization"),
            Mk8dxTheme.type.display6,
        )
        Text(
            text = statusText,
            style = Mk8dxTheme.type.body,
            color = colors.textBody,
            modifier = Modifier.testTag("outbox-synchronization-status"),
        )
        snapshot?.let {
            Text(
                text = "State revision ${it.stateRevision} • Attempts ${it.attemptCount}",
                style = Mk8dxTheme.type.dataS,
                color = colors.textSecondary,
                modifier = Modifier.testTag("outbox-synchronization-summary"),
            )
            it.failureCode?.let { failureCode ->
                androidSubmissionFailureMessage(failureCode, LocalAndroidProductLanguage.current.code)?.let { message ->
                    Text(
                        text = message,
                        style = Mk8dxTheme.type.body,
                        color = colors.statusError,
                        modifier = Modifier.testTag("outbox-synchronization-failure-message"),
                    )
                }
                Text(
                    text = "Failure code: $failureCode",
                    style = Mk8dxTheme.type.dataS,
                    color = colors.statusError,
                    modifier = Modifier.testTag("outbox-synchronization-failure-code"),
                )
            }
            it.feedback?.let { feedback ->
                val language = LocalAndroidProductLanguage.current
                feedback.lines(language).forEachIndexed { index, line ->
                    Text(
                        text = line,
                        style = if (index == 0) Mk8dxTheme.type.body else Mk8dxTheme.type.bodyS,
                        color = if (index == 0) colors.textPrimary else colors.textSecondary,
                        modifier = Modifier.testTag("outbox-synchronization-feedback-$index"),
                    )
                }
            }
        }
        Mk8dxButton(
            androidLocalizedPresentation(
                if (state is AndroidOutboxSynchronizationState.Unloaded) {
                    "Load status"
                } else {
                    "Refresh status"
                },
            ),
            onLoadRequested,
            variant = Mk8dxButtonVariant.Secondary,
            disabledReason = if (actionInProgress) reason else null,
            disabledReasonShown = false,
            tag = "outbox-synchronization-load",
            modifier = Modifier.fillMaxWidth(),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Mk8dxButton(
                androidLocalizedPresentation("Sync now"),
                onDeliveryRequested,
                variant = Mk8dxButtonVariant.Primary,
                disabledReason = if (canDeliver) null else reason,
                disabledReasonShown = false,
                tag = "outbox-synchronization-deliver",
                modifier = Modifier.weight(1f),
            )
            Mk8dxButton(
                androidLocalizedPresentation("Prepare retry"),
                onRetryRequested,
                variant = Mk8dxButtonVariant.Secondary,
                disabledReason = if (canRetry) null else reason,
                disabledReasonShown = false,
                tag = "outbox-synchronization-retry",
                modifier = Modifier.weight(1f),
            )
        }
    }
}

private fun AndroidOutboxSynchronizationState.presentationSnapshot():
    AndroidOutboxSynchronizationSnapshot? = when (this) {
    AndroidOutboxSynchronizationState.Unloaded -> null
    is AndroidOutboxSynchronizationState.Ready -> snapshot
    is AndroidOutboxSynchronizationState.Working -> snapshot
    is AndroidOutboxSynchronizationState.ActionFailed -> snapshot
}

private fun AndroidOutboxSynchronizationState.statusText(): String = when (this) {
    AndroidOutboxSynchronizationState.Unloaded -> "Synchronization status not loaded"
    is AndroidOutboxSynchronizationState.Ready -> when (snapshot.storedState) {
        AndroidOutboxStoredState.PENDING -> "Ready to synchronize"
        AndroidOutboxStoredState.FAILED -> "Last synchronization attempt failed"
        AndroidOutboxStoredState.SYNCED -> "Result synchronized"
    }
    is AndroidOutboxSynchronizationState.Working -> when (action) {
        AndroidOutboxSynchronizationAction.DELIVER -> "Synchronizing result"
        AndroidOutboxSynchronizationAction.RETRY -> "Preparing retry"
    }
    is AndroidOutboxSynchronizationState.ActionFailed -> when (code) {
        AndroidOutboxSynchronizationFailureCode.ACTION_IN_PROGRESS ->
            "Another synchronization action is in progress"
        AndroidOutboxSynchronizationFailureCode.LOCAL_STATE_UNAVAILABLE ->
            "Could not read synchronization status"
        AndroidOutboxSynchronizationFailureCode.DELIVERY_REQUIRES_PENDING ->
            "This result is not pending"
        AndroidOutboxSynchronizationFailureCode.RETRY_REQUIRES_FAILED ->
            "Retry is not available"
        AndroidOutboxSynchronizationFailureCode.DELIVERY_UNAVAILABLE ->
            "Could not synchronize result"
        AndroidOutboxSynchronizationFailureCode.RETRY_UNAVAILABLE ->
            "Could not prepare retry"
    }
}
