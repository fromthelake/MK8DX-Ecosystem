package nl.mariokart8.mk8dxtimetrials.ecosystem

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMark
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/** The three tabs of You (owner 2026-11-13). */
internal enum class AndroidYouTab { MY_TIMES, RECORDS, RIVALS }

/** One track and class of the Player's own times: the personal best first, older runs after it. */
internal data class AndroidMyTimesGroup(
    val trackId: String,
    val mode: Int,
    val runs: List<AndroidManagedTimeTrial>,
) {
    val key: String get() = "$mode|$trackId"
    val best: AndroidManagedTimeTrial get() = runs.first()
}

/**
 * My times as one list: every active run of [playerId], grouped per track and class, the personal best
 * first; 150cc before 200cc, tracks in cup order.
 */
internal fun androidMyTimesGroups(results: List<AndroidManagedTimeTrial>, playerId: String?): List<AndroidMyTimesGroup> =
    results.filter { (playerId == null || it.playerId == playerId) && it.retirementState == "active" }
        .groupBy { it.current.trackId to it.current.modeCc }
        .map { (key, runs) ->
            AndroidMyTimesGroup(key.first, key.second, runs.sortedWith(compareBy({ it.current.totalTimeMs }, { it.current.createdAtMs })))
        }
        .sortedWith(compareBy({ it.mode }, { trackOrder(it.trackId) }, { it.trackId }))

private fun trackOrder(trackId: String): Int =
    Schema9AndroidTrackCatalog.entries.indexOfFirst { it.id == trackId }.let { if (it < 0) Int.MAX_VALUE else it }

/** A managed run as the result card shows it (laps, coins, mushrooms, build). */
internal fun AndroidManagedTimeTrial.asPublicResult(): AndroidPublicTimeTrialResult = AndroidPublicTimeTrialResult(
    resultId = submissionId,
    playerId = playerId,
    playerUsername = playerUsername,
    playerDisplayName = playerDisplayName,
    trackId = current.trackId,
    mode = current.modeCc,
    totalTimeMs = current.totalTimeMs,
    revision = current.revision,
    laps = current.laps.mapIndexed { index, timeMs ->
        val counts = current.lapDetails?.getOrNull(index)
        AndroidActivityLap(index + 1, timeMs, counts?.coinsCollected, counts?.mushroomsUsed)
    },
    loadout = current.loadout?.let {
        AndroidActivityLoadout(
            it["characterId"], it["characterVariantId"], it["bodyId"], it["bodyVariantId"],
            it["tireId"], it["gliderId"], it["gliderVariantId"],
        )
    },
    sourceKind = current.sourceKind,
    resultAtMs = current.occurredAtMs ?: current.createdAtMs,
    videoUrl = videoUrl,
)

/** One action of a run's ⋯ menu. */
internal data class AndroidRunMenuAction(val label: String, val tag: String, val onClick: () -> Unit)

/**
 * A track and class on one compact row: the track, its class and the personal best with its own ⋯ menu.
 * Tapping the row shows the older runs under it, each with the same menu (details, edit, withdraw, carry).
 */
@Composable
internal fun AndroidMyTimesGroupCard(
    group: AndroidMyTimesGroup,
    expanded: Boolean,
    onToggle: () -> Unit,
    actions: (AndroidManagedTimeTrial) -> List<AndroidRunMenuAction>,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val track = Schema9AndroidTrackCatalog.find(group.trackId)?.displayName ?: group.trackId
    val best = group.best
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .testTag("my-times-group-${group.mode}-${group.trackId}"),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, enabled = group.runs.size > 1, onClick = onToggle)
                .padding(start = Mk8dxSpacing.md, top = Mk8dxSpacing.sm, bottom = Mk8dxSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            // Line one: the track (and how many runs); line two: class, date and the personal best.
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs)) {
                Text(
                    if (group.runs.size > 1) androidText("$track · ${group.runs.size} runs", "$track · ${group.runs.size} ritten") else track,
                    style = type.body, color = colors.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                    Mk8dxEngineMark(group.mode)
                    Text(runDate(best), style = type.bodyS, color = colors.textSecondary, maxLines = 1,
                        overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text(Mk8dxNumeric.formatTime(best.current.totalTimeMs), style = type.dataM, color = colors.textPrimary, maxLines = 1)
                }
                if (best.publicationStatus != "published") {
                    Mk8dxChip(androidText("Not published", "Niet gepubliceerd"), tone = Mk8dxChipTone.Warning)
                }
            }
            if (group.runs.size > 1) {
                Icon(
                    if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                    contentDescription = null,
                    tint = colors.textSecondary,
                    modifier = Modifier.size(20.dp),
                )
            }
            AndroidRunMenu(best, actions(best))
        }
        if (expanded) {
            group.runs.drop(1).forEach { run ->
                Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
                Row(
                    Modifier.fillMaxWidth().padding(start = Mk8dxSpacing.lg).testTag("my-times-run-${run.submissionId}"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                ) {
                    Mk8dxMetaLine(runDate(run), Modifier.weight(1f))
                    if (run.publicationStatus != "published") {
                        Mk8dxChip(androidText("Not published", "Niet gepubliceerd"), tone = Mk8dxChipTone.Warning)
                    }
                    Text(Mk8dxNumeric.formatTime(run.current.totalTimeMs), style = type.body, color = colors.textBody)
                    AndroidRunMenu(run, actions(run))
                }
            }
        }
    }
}

private fun runDate(run: AndroidManagedTimeTrial): String =
    DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(run.current.occurredAtMs ?: run.current.createdAtMs))

/** A run's ⋯ menu. */
@Composable
private fun AndroidRunMenu(run: AndroidManagedTimeTrial, actions: List<AndroidRunMenuAction>) {
    if (actions.isEmpty()) return
    var menu by remember(run.submissionId) { mutableStateOf(false) }
    Box {
        val more = androidText("More actions", "Meer acties")
        IconButton(
            onClick = { menu = true },
            modifier = Modifier.semantics { contentDescription = more }.testTag("my-times-menu-${run.submissionId}"),
        ) {
            Icon(Icons.Filled.MoreVert, contentDescription = null, tint = Mk8dxTheme.colors.textSecondary)
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            actions.forEach { action ->
                DropdownMenuItem(
                    text = { Text(action.label, style = Mk8dxTheme.type.body) },
                    onClick = { menu = false; action.onClick() },
                    modifier = Modifier.testTag(action.tag),
                )
            }
        }
    }
}

/**
 * Rivals (moved from Settings): who you follow, their best times from this community's copy when offline,
 * and the "You and <Player>" panel. Choosing rivals happens on the website.
 */
@Composable
internal fun AndroidRivalsTab(
    client: AndroidTimeTrialsEcosystemDataSource,
    playerId: String,
    apiOrigin: String,
    interactions: @Composable (AndroidRival) -> Unit,
) {
    val context = LocalContext.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    var rivals by remember(client, playerId) { mutableStateOf<List<AndroidRival>?>(null) }
    LaunchedEffect(client, playerId) {
        rivals = withContext(Dispatchers.IO) { runCatching { client.rivals() }.getOrDefault(emptyList()) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md), modifier = Modifier.testTag("you-rivals")) {
        Mk8dxMetaLine(androidText("Used by Home focus and the Among rivals standing.", "Gebruikt door Home-focus en de stand Onder rivalen."))
        val loaded = rivals
        when {
            loaded == null -> Text(androidText("Loading rivals…", "Rivalen laden…"), style = type.body, color = colors.textSecondary)
            loaded.isEmpty() -> Mk8dxPanel(null) {
                Text(androidText("No rivals chosen yet.", "Nog geen rivalen gekozen."), style = type.body, color = colors.textBody)
            }
            else -> loaded.forEach { rival -> AndroidRivalCard(client, rival, interactions) }
        }
        Mk8dxButton(
            androidText("Choose rivals on the website", "Rivalen kiezen op de website"),
            { openRivalsWebsite(context, apiOrigin) },
            variant = Mk8dxButtonVariant.Secondary,
            tag = "you-rivals-choose",
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun AndroidRivalCard(
    client: AndroidTimeTrialsEcosystemDataSource,
    rival: AndroidRival,
    interactions: @Composable (AndroidRival) -> Unit,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    var open by remember(rival.playerId) { mutableStateOf(false) }
    var bests by remember(rival.playerId) { mutableStateOf<List<AndroidTrackBest>?>(null) }
    LaunchedEffect(open) {
        if (open && bests == null) {
            bests = withContext(Dispatchers.IO) { runCatching { client.trackBestsFor(rival.playerId) }.getOrDefault(emptyList()) }
        }
    }
    Mk8dxPanel(null, modifier = Modifier.testTag("you-rival-${rival.playerId}")) {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { open = !open },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(rival.displayName, style = type.title, color = colors.textPrimary)
                Mk8dxMetaLine(androidText("Best times", "Beste tijden"))
            }
            Icon(
                if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                contentDescription = null,
                tint = colors.textSecondary,
                modifier = Modifier.size(22.dp),
            )
        }
        if (open) {
            val loaded = bests
            when {
                loaded == null -> Mk8dxMetaLine(androidText("Loading…", "Laden…"))
                loaded.isEmpty() -> Mk8dxMetaLine(androidText("No best times known.", "Geen beste tijden bekend."))
                else -> loaded.sortedWith(compareBy({ it.mode }, { trackOrder(it.trackId) })).forEach { best ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            Schema9AndroidTrackCatalog.find(best.trackId)?.displayName ?: best.trackId,
                            style = type.bodyS, color = colors.textBody, modifier = Modifier.weight(1f),
                        )
                        Mk8dxEngineMark(best.mode)
                        Text("  " + Mk8dxNumeric.formatTime(best.totalTimeMs), style = type.dataS, color = colors.textPrimary)
                    }
                }
            }
        }
        interactions(rival)
    }
}

private fun openRivalsWebsite(context: Context, apiOrigin: String) =
    nl.mariokart8.mk8dxtimetrials.openProductWebsite(context, "$apiOrigin/?settings=1")
