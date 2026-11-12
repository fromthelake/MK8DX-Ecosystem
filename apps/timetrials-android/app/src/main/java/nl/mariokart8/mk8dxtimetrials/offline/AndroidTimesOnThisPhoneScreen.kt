package nl.mariokart8.mk8dxtimetrials.offline

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.carry.LocalAndroidCopyCarryActions
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSegmentedControl
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTabOption
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTabs
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

private enum class TimesTab { SAVED, MINE }

/** The copied runs of one track and class, the best first. */
internal data class AndroidCopiedRunGroup(val trackId: String, val mode: Int, val runs: List<AndroidOfflineRun>)

internal fun androidCopiedRunGroups(copy: AndroidOfflineCopy, mode: Int?): List<AndroidCopiedRunGroup> =
    copy.runs.filter { it.active && (mode == null || it.mode == mode) }
        .groupBy { it.trackId to it.mode }
        .map { (key, runs) -> AndroidCopiedRunGroup(key.first, key.second, runs.sortedWith(compareBy({ it.totalTimeMs }, { it.createdAtMs }))) }
        .sortedWith(compareBy({ it.mode }, { trackOrder(it.trackId) }, { it.trackId }))

private fun trackOrder(trackId: String): Int =
    Schema9AndroidTrackCatalog.entries.indexOfFirst { it.id == trackId }.let { if (it < 0) Int.MAX_VALUE else it }

/**
 * Times on this phone (Settings -> Community server): what waits on this phone, and the Player's own times in
 * the active community from its copy (ADR-0225 amendment 2), each of which can be carried to another community.
 */
@Composable
internal fun AndroidTimesOnThisPhoneScreen(
    playerId: String?,
    activeOrigin: String,
    savedResults: @Composable () -> Unit,
) {
    var tab by rememberSaveable { mutableStateOf(TimesTab.SAVED) }
    Column(Modifier.fillMaxSize().background(Mk8dxTheme.colors.surfaceApp)) {
        Mk8dxTabs(
            label = androidText("Times on this phone", "Tijden op deze telefoon"),
            options = listOf(
                Mk8dxTabOption(TimesTab.SAVED, androidText("Saved on this phone", "Bewaard op deze telefoon"), "times-tab-saved"),
                Mk8dxTabOption(TimesTab.MINE, androidText("My times in this community", "Mijn tijden in deze community"), "times-tab-mine"),
            ),
            value = tab,
            onChange = { tab = it },
            modifier = Modifier.padding(horizontal = Mk8dxSpacing.gutterPhone, vertical = Mk8dxSpacing.sm),
        )
        Box(Modifier.weight(1f)) {
            when (tab) {
                TimesTab.SAVED -> savedResults()
                TimesTab.MINE -> AndroidMyCopiedTimes(playerId, activeOrigin)
            }
        }
    }
}

@Composable
private fun AndroidMyCopiedTimes(playerId: String?, activeOrigin: String) {
    val context = LocalContext.current
    var copy by remember(playerId, activeOrigin) { mutableStateOf<AndroidOfflineCopy?>(null) }
    var loaded by remember(playerId, activeOrigin) { mutableStateOf(false) }
    var mode by rememberSaveable { mutableStateOf(0) }
    LaunchedEffect(playerId, activeOrigin) {
        copy = withContext(Dispatchers.IO) { AndroidOfflineCopyStore.forOrigin(context, activeOrigin).readFor(playerId) }
        loaded = true
    }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val carry = LocalAndroidCopyCarryActions.current
    val current = copy
    val groups = remember(current, mode) { current?.let { androidCopiedRunGroups(it, mode.takeIf { m -> m != 0 }) }.orEmpty() }
    LazyColumn(
        Modifier.fillMaxSize().testTag("my-copied-times"),
        contentPadding = PaddingValues(Mk8dxSpacing.gutterPhone),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        if (current == null) {
            if (loaded) item {
                Mk8dxPanel(null) {
                    Text(
                        androidText(
                            "Sign in to keep your times in this community on this phone. You can then see them offline and carry them to another community.",
                            "Meld je aan om je tijden in deze community op deze telefoon te bewaren. Je ziet ze dan ook offline en kunt ze meenemen naar een andere community.",
                        ),
                        style = type.body,
                        color = colors.textBody,
                    )
                }
            }
            return@LazyColumn
        }
        item {
            val time = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(current.lastUpdatedAtMs))
            Mk8dxMetaLine(androidText("Last updated $time", "Laatst bijgewerkt $time"), Modifier.testTag("my-copied-times-updated"))
        }
        if (carry != null) item {
            Mk8dxButton(
                androidText("Carry my best times", "Mijn beste tijden meenemen"),
                carry.carryBestTimes,
                variant = Mk8dxButtonVariant.Primary,
                tag = "my-copied-times-carry-best",
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            Mk8dxSegmentedControl(
                label = androidText("Class", "Klasse"),
                choices = listOf(0 to androidText("All", "Alle"), 150 to "150cc", 200 to "200cc"),
                value = mode,
                onChange = { mode = it },
            )
        }
        if (groups.isEmpty()) item {
            Text(androidText("No times in this community yet.", "Nog geen tijden in deze community."), style = type.body, color = colors.textSecondary)
        }
        items(groups, key = { "${it.mode}|${it.trackId}" }) { group ->
            val track = Schema9AndroidTrackCatalog.find(group.trackId)?.displayName ?: group.trackId
            Mk8dxPanel("$track · ${group.mode}cc", modifier = Modifier.testTag("my-copied-group-${group.mode}-${group.trackId}")) {
                group.runs.forEachIndexed { index, run ->
                    Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                        Text(Mk8dxNumeric.formatTime(run.totalTimeMs), style = if (index == 0) type.title else type.body, color = colors.textPrimary)
                        if (index == 0) Mk8dxChip(androidText("Personal best", "Persoonlijk record"), tone = Mk8dxChipTone.Success)
                        val date = DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(run.createdAtMs))
                        Mk8dxMetaLine(date)
                        if (carry != null) Mk8dxButton(
                            androidText("Carry to another community", "Meenemen naar een andere community"),
                            { carry.carryRun(run) },
                            variant = Mk8dxButtonVariant.Quiet,
                            size = Mk8dxButtonSize.Sm,
                            tag = "my-copied-carry-${run.submissionId}",
                        )
                    }
                }
            }
        }
    }
}
