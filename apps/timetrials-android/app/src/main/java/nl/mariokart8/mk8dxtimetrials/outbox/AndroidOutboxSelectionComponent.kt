package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import nl.mariokart8.mk8dxtimetrials.carry.LocalAndroidCarryOffer
import nl.mariokart8.mk8dxtimetrials.carry.LocalAndroidCarriedRefusals
import nl.mariokart8.mk8dxtimetrials.carry.androidCarriedRefusalText
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.ui.androidLocalizedPresentation
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

internal const val ANDROID_OUTBOX_SELECTION_LABEL_MAX_CODE_POINTS = 80

internal fun interface AndroidOutboxSelectionLabelProvider {
    fun labelFor(entry: AndroidOutboxIndexEntry): String
}

/**
 * Saved results (A08), on the design system (Phase 12).
 *
 * The outbox itself is untouched: the same explicit load, the same order, the
 * same per-entry selection and the same words. What changed is that the list is
 * built from system panels, chips and buttons on token surfaces, so a result
 * waiting on this phone looks like the rest of the product.
 */
@Composable
internal fun AndroidOutboxSelectionComponent(
    state: AndroidOutboxIndexState,
    loadInProgress: Boolean,
    labelProvider: AndroidOutboxSelectionLabelProvider,
    onLoadRequested: () -> Unit,
    onEntrySelected: (entryKeyHash: String) -> Unit,
    synchronizationAvailable: Boolean = true,
    onSubmitTimeTrial: () -> Unit = {},
    modifier: Modifier = Modifier,
    accountDisplayNames: Map<String, String> = emptyMap(),
) {
    val colors = Mk8dxTheme.colors
    val scope = rememberCoroutineScope()
    Column(
        modifier
            .fillMaxWidth()
            .padding(Mk8dxSpacing.gutterPhone)
            .testTag("outbox-selection"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Mk8dxDisplayText(
            androidLocalizedPresentation("SAVED RESULTS"),
            Mk8dxTheme.type.display6,
        )
        Text(
            text = state.selectionStatusText(loadInProgress),
            style = Mk8dxTheme.type.body,
            color = colors.textBody,
            modifier = Modifier.testTag("outbox-selection-status"),
        )
        if (!synchronizationAvailable) {
            Text(
                text = "Sign in to synchronize saved results",
                style = Mk8dxTheme.type.bodyS,
                color = colors.textSecondary,
                modifier = Modifier.testTag("outbox-selection-auth-required"),
            )
        }
        if (state is AndroidOutboxIndexState.Ready && state.entries.isEmpty()) {
            Mk8dxPanel(null, modifier = Modifier.testTag("outbox-selection-empty")) {
                Text(
                    "NO SAVED RESULTS YET",
                    style = Mk8dxTheme.type.title,
                    color = colors.textPrimary,
                )
                Text(
                    "Enter a time manually or scan a Switch result. It is saved safely on this phone first, then synced to the website.",
                    style = Mk8dxTheme.type.bodyS,
                    color = colors.textSecondary,
                )
                Mk8dxButton(
                    androidLocalizedPresentation("Post a Time Trial"),
                    onSubmitTimeTrial,
                    variant = Mk8dxButtonVariant.Primary,
                    tag = "outbox-selection-submit",
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        Mk8dxButton(
            androidLocalizedPresentation(
                when {
                    loadInProgress -> "Loading saved results"
                    state is AndroidOutboxIndexState.Unloaded -> "Load saved results"
                    else -> "Refresh saved results"
                },
            ),
            onLoadRequested,
            variant = Mk8dxButtonVariant.Secondary,
            disabledReason = if (loadInProgress) {
                androidLocalizedPresentation("Loading saved results")
            } else {
                null
            },
            disabledReasonShown = false,
            tag = "outbox-selection-load",
            modifier = Modifier.fillMaxWidth(),
        )
        if (state is AndroidOutboxIndexState.Ready && state.entries.isNotEmpty()) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("outbox-selection-list"),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                itemsIndexed(state.entries) { index, entry ->
                    val label = safeSelectionLabel(labelProvider, entry)
                    Mk8dxPanel(
                        null,
                        modifier = Modifier.testTag("outbox-selection-row-$index"),
                    ) {
                        Text(
                            text = label ?: "Result label unavailable",
                            style = Mk8dxTheme.type.title,
                            color = colors.textPrimary,
                            modifier = Modifier.testTag("outbox-selection-row-label-$index"),
                        )
                        Mk8dxChip(
                            androidLocalizedPresentation(
                                entry.storedState.selectionRowStatusText(),
                            ),
                            tone = entry.storedState.tone(),
                            modifier = Modifier
                                .testTag("outbox-selection-row-status-$index")
                                .semantics(mergeDescendants = true) { },
                        )
                        if (entry.isTestResult) {
                            Mk8dxMetaLine(
                                text = androidLocalizedPresentation(
                                    "Test result · website copy expires after 24 hours",
                                ),
                                modifier = Modifier.testTag("outbox-selection-row-test-$index"),
                            )
                        }
                        Mk8dxMetaLine(
                            text = androidLocalizedPresentation(
                                androidOutboxSelectionRowAccountText(entry, accountDisplayNames),
                            ),
                            modifier = Modifier.testTag("outbox-selection-row-account-$index"),
                        )
                        val unavailable = when {
                            !synchronizationAvailable ->
                                androidLocalizedPresentation("Sign in to synchronize")
                            loadInProgress ->
                                androidLocalizedPresentation("Loading saved results")
                            label == null ->
                                androidLocalizedPresentation("Result label unavailable")
                            else -> null
                        }
                        Mk8dxButton(
                            androidLocalizedPresentation(
                                if (synchronizationAvailable) {
                                    "Open synchronization"
                                } else {
                                    "Sign in to synchronize"
                                },
                            ),
                            { onEntrySelected(entry.entryKeyHash) },
                            variant = Mk8dxButtonVariant.Secondary,
                            disabledReason = unavailable,
                            disabledReasonShown = false,
                            tag = "outbox-selection-select-$index",
                            modifier = Modifier.fillMaxWidth(),
                        )
                        val refusals = LocalAndroidCarriedRefusals.current
                        val refusal = refusals?.let {
                            androidCarriedRefusalText(LocalAndroidProductLanguage.current, it.communityName, entry.failureCode)
                        }
                        if (refusals != null && refusal != null && entry.storedState == AndroidOutboxStoredState.FAILED) {
                            Mk8dxStatusMessage(
                                refusal,
                                tone = Mk8dxStatusTone.Warning,
                                modifier = Modifier.testTag("outbox-selection-refused-$index"),
                            )
                            Mk8dxButton(
                                androidText("Remove", "Verwijderen"),
                                {
                                    scope.launch {
                                        withContext(Dispatchers.IO) { refusals.discard(entry.entryKeyHash) }
                                        onLoadRequested()
                                    }
                                },
                                variant = Mk8dxButtonVariant.Quiet,
                                tag = "outbox-selection-remove-refused-$index",
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        val carry = LocalAndroidCarryOffer.current
                        if (carry != null && entry.storedState == AndroidOutboxStoredState.SYNCED && !entry.isTestResult) {
                            Mk8dxButton(
                                androidText("Carry to another community", "Meenemen naar een andere community"),
                                { carry(entry.entryKeyHash) },
                                variant = Mk8dxButtonVariant.Quiet,
                                tag = "outbox-selection-carry-$index",
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun AndroidOutboxIndexState.selectionStatusText(
    loadInProgress: Boolean,
): String = when {
    loadInProgress -> "Loading saved results"
    this is AndroidOutboxIndexState.Unloaded -> "Saved results not loaded"
    this is AndroidOutboxIndexState.Unavailable -> "Saved results unavailable"
    this is AndroidOutboxIndexState.Ready && entries.isEmpty() -> "No saved results"
    this is AndroidOutboxIndexState.Ready -> "${entries.size} saved results"
    else -> "Saved results unavailable"
}

/**
 * Names the account a saved result belongs to. On a shared device the owner is
 * the only way to tell two people's identical-looking runs apart.
 */
internal fun androidOutboxSelectionRowAccountText(
    entry: AndroidOutboxIndexEntry,
    accountDisplayNames: Map<String, String> = emptyMap(),
): String {
    val reference = entry.playerReference
    return when {
        reference == null -> "Account unknown"
        reference.namespace == "player" ->
            "Account ${accountDisplayNames["player.${reference.value}"]
                ?: accountDisplayNames[reference.value]
                ?: reference.value}"
        else -> "This device only"
    }
}

private fun AndroidOutboxStoredState.selectionRowStatusText(): String = when (this) {
    AndroidOutboxStoredState.PENDING -> "Pending"
    AndroidOutboxStoredState.FAILED -> "Failed"
    AndroidOutboxStoredState.SYNCED -> "Synchronized"
}

/** The chip's tone; the word on it stays the state, never the colour alone. */
private fun AndroidOutboxStoredState.tone(): Mk8dxChipTone = when (this) {
    AndroidOutboxStoredState.PENDING -> Mk8dxChipTone.Info
    AndroidOutboxStoredState.FAILED -> Mk8dxChipTone.Error
    AndroidOutboxStoredState.SYNCED -> Mk8dxChipTone.Success
}

private fun safeSelectionLabel(
    provider: AndroidOutboxSelectionLabelProvider,
    entry: AndroidOutboxIndexEntry,
): String? = try {
    boundedAndroidOutboxSelectionLabel(provider.labelFor(entry))
} catch (_: Exception) {
    null
}

internal fun boundedAndroidOutboxSelectionLabel(label: String): String? =
    label.takeIf {
        it.isNotBlank() &&
            it.codePointCount(0, it.length) <=
            ANDROID_OUTBOX_SELECTION_LABEL_MAX_CODE_POINTS &&
            it.none(Char::isISOControl)
    }
