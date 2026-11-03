package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.posttime.AndroidPostTimeEdit
import nl.mariokart8.mk8dxtimetrials.posttime.AndroidPostTimeTask
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text

/**
 * A kart setup in a Details panel or a run's pop-up: one part per line, its name and then its
 * picture (owner 2026-09-29: "Mario 🖼"). `parts` are (asset path, name) pairs; an unknown part is
 * left out, and an empty asset path prints the name alone.
 */
@Composable
internal fun AndroidPartLines(parts: List<Pair<String, String>?>, modifier: Modifier = Modifier) {
    val colors = Mk8dxTheme.colors
    Column(modifier.testTag("run-part-lines"), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        parts.filterNotNull().forEach { (asset, name) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(name, style = Mk8dxTheme.type.bodyS, color = colors.textBody)
                if (asset.isNotEmpty()) {
                    ProductAssetImage(asset, "·", colors.borderStrong, Modifier.size(28.dp), contentDescription = null)
                }
            }
        }
    }
}

/**
 * Your own published result in the form of Post a Time, opened from wherever it is shown
 * (My sessions, a leaderboard, My results). Withdrawing sits behind it, confirmed by a swipe.
 */
@Composable
internal fun AndroidManageResultOverlay(
    resultId: String,
    client: AndroidTimeTrialsEcosystemDataSource,
    playerId: String?,
    onClose: (saved: Boolean) -> Unit,
    preloaded: AndroidManagedTimeTrial? = null,
) {
    val language = LocalAndroidProductLanguage.current
    val dutch = language == AndroidProductLanguage.DUTCH
    val colors = Mk8dxTheme.colors
    var result by remember(resultId) { mutableStateOf(preloaded) }
    var missing by remember(resultId) { mutableStateOf(false) }
    LaunchedEffect(resultId) {
        if (result != null) return@LaunchedEffect
        result = withContext(Dispatchers.IO) {
            runCatching {
                client.managedTimeTrials().firstOrNull { it.submissionId == resultId && it.retirementState == "active" }
            }.getOrNull()
        }
        missing = result == null
    }
    val refused: (Throwable) -> String = { androidManageFailureMessage(it, dutch) }
    Dialog(onDismissRequest = { onClose(false) }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(colors.surfaceApp).testTag("manage-result-overlay")) {
            val loaded = result
            when {
                loaded != null -> AndroidPostTimeTask(
                    trackId = loaded.current.trackId,
                    mode = loaded.current.modeCc,
                    contextFactory = null,
                    submissionHost = null,
                    signedInPlayerId = playerId,
                    manage = AndroidPostTimeEdit(
                        result = loaded,
                        saveCorrection = { correction ->
                            runCatching { client.correctTimeTrial(loaded.submissionId, correction) }.fold({ null }, refused)
                        },
                        saveVideo = { videoUrl ->
                            runCatching { client.setTimeTrialVideo(loaded.submissionId, videoUrl) }.fold({ null }, refused)
                        },
                        withdraw = { reason ->
                            runCatching { client.retireTimeTrial(loaded.submissionId, reason) }.fold({ null }, refused)
                        },
                        onClose = onClose,
                    ),
                )
                missing -> Column(
                    Modifier.fillMaxWidth().padding(Mk8dxSpacing.lg),
                    verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
                ) {
                    Text(
                        androidText(
                            language,
                            "This result cannot be edited here. Open it from My results.",
                            "Dit resultaat kan hier niet worden bewerkt. Open het via Mijn resultaten.",
                        ),
                        style = Mk8dxTheme.type.body,
                        color = colors.textBody,
                    )
                    Mk8dxButton(androidText(language, "Close", "Sluiten"), { onClose(false) }, variant = Mk8dxButtonVariant.Secondary)
                }
                else -> Text(
                    androidText(language, "Loading your result…", "Je resultaat laden…"),
                    Modifier.padding(Mk8dxSpacing.lg),
                    style = Mk8dxTheme.type.body,
                    color = colors.textSecondary,
                )
            }
        }
    }
}
