package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMark
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMarkSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineSelector
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxHiddenByPreference
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTierChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxValueBar

/**
 * "Your Time Trial journey" — the four completion tiles the web Home has
 * carried since ADR-0185, for each engine class.
 *
 * Every input is already in the APK: the viewer's own bests come from the
 * bootstrap's `trackBests`, the Nintendo Staff times from the bundled
 * [AndroidBenchmarkCatalog], and the Base/BCP split from
 * [AndroidTimeTrialTrackScope]. The web derives the same four numbers the same
 * way; this is the identical calculation, not a second source of truth.
 */
internal data class AndroidJourneyMetric(
    val scope: AndroidTimeTrialTrackScope,
    val scopeLabelEnglish: String,
    val scopeLabelDutch: String,
    val measureEnglish: String,
    val measureDutch: String,
    val value: Int,
    val total: Int,
    val tone: AndroidJourneyTone,
) {
    val progress: Float get() = if (total <= 0) 0f else value.toFloat() / total.toFloat()
    val percentage: Int get() = if (total <= 0) 0 else Math.round(progress * 100f)
    val complete: Boolean get() = total > 0 && value >= total
    val empty: Boolean get() = value <= 0
}

internal enum class AndroidJourneyTone { TIMES_SET, STAFF_GHOSTS }

internal data class AndroidJourneyTarget(
    val totalMs: Long,
    val masteryTier: Int,
    val masteryReductionMs: Long?,
    val standing: Int?,
    val rankReductionMs: Long?,
)

internal fun buildAndroidJourneyTarget(
    bests: List<AndroidTrackBest>,
    playerId: String,
    mode: Int,
    standings: List<AndroidRankStanding>,
): AndroidJourneyTarget {
    require(mode == 150 || mode == 200)
    val selected = bests.filter { it.mode == mode }
        .groupBy(AndroidTrackBest::trackId)
        .mapValues { (_, rows) -> rows.minOf(AndroidTrackBest::totalTimeMs) }
    val calculatedTotal = AndroidTimeTrialTrackScope.ALL.tracks.sumOf { track ->
        selected[track.id] ?: AndroidMasteryThresholds.UNPLAYED_FALLBACK_MS
    }
    val standing = standings.firstOrNull { it.playerId == playerId }
    val totalMs = standing?.totalTimeMs ?: calculatedTotal
    val masteryTier = AndroidMasteryThresholds.totalTier(
        mode,
        totalMs,
        AndroidTimeTrialTrackScope.ALL.trackIds,
    )
    val nextStanding = standing?.takeIf { it.rank > 1 }
        ?.let { own -> standings.firstOrNull { it.rank == own.rank - 1 } }
    return AndroidJourneyTarget(
        totalMs = totalMs,
        masteryTier = masteryTier,
        masteryReductionMs = AndroidMasteryThresholds.nextTotalTierDeltaMs(
            mode,
            totalMs,
            AndroidTimeTrialTrackScope.ALL.trackIds,
        ),
        standing = standing?.rank,
        rankReductionMs = nextStanding?.let { (totalMs - it.totalTimeMs + 1L).coerceAtLeast(1L) },
    )
}

/**
 * Counts, per scope, how many of that scope's tracks have a time in this engine
 * class and how many of those beat the Nintendo Staff Ghost. `total` is the
 * number of staff references in the scope, exactly as the web uses.
 */
internal fun buildAndroidJourney(
    bests: List<AndroidTrackBest>,
    mode: Int,
): List<AndroidJourneyMetric> {
    require(mode == 150 || mode == 200)
    val staffTimes = AndroidBenchmarkCatalog.forKind(AndroidBenchmarkKind.NINTENDO_STAFF, mode)
        .associate { it.trackId to it.timeMs }
    val modeBests = bests.filter { it.mode == mode }
        .groupBy(AndroidTrackBest::trackId)
        .mapValues { (_, duplicates) -> duplicates.minOf(AndroidTrackBest::totalTimeMs) }

    fun metrics(scope: AndroidTimeTrialTrackScope, english: String, dutch: String): List<AndroidJourneyMetric> {
        val trackIds = scope.trackIds
        val scopeStaff = staffTimes.filterKeys { it in trackIds }
        val driven = modeBests.keys.count { it in trackIds }
        val beaten = modeBests.count { (trackId, best) ->
            val staff = scopeStaff[trackId]
            staff != null && best < staff
        }
        return listOf(
            AndroidJourneyMetric(scope, english, dutch, "Times set", "Tijden gezet", driven, scopeStaff.size, AndroidJourneyTone.TIMES_SET),
            AndroidJourneyMetric(scope, english, dutch, "Staff ghosts defeated", "Staff ghosts verslagen", beaten, scopeStaff.size, AndroidJourneyTone.STAFF_GHOSTS),
        )
    }

    return metrics(AndroidTimeTrialTrackScope.BASE, "Base tracks", "Basiscircuits") +
        metrics(AndroidTimeTrialTrackScope.BCP, "DLC tracks", "DLC-circuits")
}

/** The four competitive counts the web shows under the journey tiles. */
internal data class AndroidCompetitiveCount(
    val english: String,
    val dutch: String,
    val value: Int,
    /** Where the cell leads, the same narrowing the web link carries. */
    val focus: AndroidRankTrackFocus,
)

internal fun buildAndroidCompetitive(
    bests: List<AndroidTrackBest>,
    rows: List<AndroidFocusRow>,
    mode: Int,
    scope: AndroidTimeTrialTrackScope,
): List<AndroidCompetitiveCount> {
    val trackIds = scope.trackIds
    val modeBests = bests.filter { it.mode == mode && it.trackId in trackIds }
    val leaderTimes = rows.filter { it.mode == mode && it.trackId in trackIds }
        .associate { it.trackId to it.leaderBestMs }
    val withinOneSecond = modeBests.count { best ->
        val leader = leaderTimes[best.trackId]
        best.rank > 1 && leader != null && best.totalTimeMs - leader <= 1_000
    }
    return listOf(
        AndroidCompetitiveCount("Within 1s of #1", "Binnen 1s van #1", withinOneSecond, AndroidRankTrackFocus.NEAR_RECORD),
        AndroidCompetitiveCount("Top 3 positions", "Top 3-posities", modeBests.count { it.rank in 1..3 }, AndroidRankTrackFocus.TOP_THREE),
        AndroidCompetitiveCount("Current #1s", "Huidige #1's", modeBests.count { it.rank == 1 }, AndroidRankTrackFocus.CURRENT_RECORDS),
        AndroidCompetitiveCount("Outside top 10", "Buiten de top 10", modeBests.count { it.rank > 10 }, AndroidRankTrackFocus.OUTSIDE_TOP_TEN),
    )
}

/**
 * The journey on the design system: the section name beside the engine control,
 * four completion cards whose bar always prints its own value, and the four
 * competitive counts under them. Each cell opens Ranking narrowed to exactly
 * the tracks it counted.
 *
 * The engine is data (§7): switching it replaces every number here and in the
 * focus below. Where the account's preference names a single engine, the other
 * one is *named as hidden* rather than drawn as zero, with a quiet local
 * override that reveals it for this visit only and never writes the preference.
 */
@Composable
internal fun AndroidTimeTrialJourney(
    home: AndroidHomeBootstrap,
    mode: Int,
    onModeChange: (Int) -> Unit,
    onOpenFocus: (AndroidTimeTrialTrackScope, Int, AndroidRankTrackFocus) -> Unit,
    totalStandings: List<AndroidRankStanding> = emptyList(),
    onOpenTotalRanking: (Int) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val comeback = home.comeback ?: return
    // The bootstrap names the viewer in `comeback.player`; the header label is
    // a display string and never matches a `trackBests` row.
    val bests = home.trackBests?.players
        ?.firstOrNull { it.playerId == comeback.player.playerId }
        ?.bests.orEmpty()
    val preference = home.focus?.modePreference ?: "all"
    val metrics = remember(bests, mode) { buildAndroidJourney(bests, mode) }
    val competitive = remember(bests, home.focus, mode) {
        buildAndroidCompetitive(
            bests,
            home.focus?.rows.orEmpty(),
            mode,
            AndroidTimeTrialTrackScope.ALL,
        )
    }
    val targets = remember(bests, comeback.player.playerId, mode, totalStandings) {
        buildAndroidJourneyTarget(bests, comeback.player.playerId, mode, totalStandings)
    }
    val language = androidNumberLanguage()

    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Mk8dxSpacing.md)
            .testTag("time-trial-journey"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Mk8dxSectionLabel(androidText("YOUR TIME TRIAL JOURNEY", "JOUW TIME TRIAL-REIS"))
        AndroidHomeEngineControl(mode, preference, onModeChange)
        // Two by two, as the web grid places them. Each cell is a surface with
        // its own hairline and grows with its words; nothing is a fixed height.
        metrics.chunked(2).forEach { pair ->
            Row(
                Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                pair.forEach { metric ->
                    JourneyTile(
                        metric,
                        mode,
                        language,
                        onOpenFocus,
                        Modifier.weight(1f).fillMaxHeight(),
                    )
                }
            }
        }
        competitive.chunked(2).forEach { pair ->
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                pair.forEach { count ->
                    CompetitiveCell(count, mode, language, onOpenFocus, Modifier.weight(1f))
                }
            }
        }
        JourneyMasteryTarget(targets, mode, onOpenTotalRanking)
        if (targets.standing != null) {
            JourneyRankTarget(targets, mode, onOpenTotalRanking)
        }
    }
}

/**
 * Home's one engine control (§7, R1). Both engines: the system's EngineSelector.
 * A preference that names one engine: that engine's mark, and the other named as
 * hidden with the local "Show … anyway" override. Choosing the revealed engine
 * changes what this visit shows and nothing that is stored.
 */
@Composable
internal fun AndroidHomeEngineControl(
    mode: Int,
    preference: String,
    onModeChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val allowed = listOf(150, 200).filter { preference == "all" || preference == it.toString() }
    var overridden by rememberSaveable(preference) { mutableStateOf(false) }
    if (allowed.size >= 2 || overridden) {
        Mk8dxEngineSelector(
            androidText("Engine class", "Motorklasse"),
            mode,
            onModeChange,
            modifier.testTag("journey-mode-selector"),
        )
        return
    }
    val shown = allowed.firstOrNull() ?: 150
    val hidden = if (shown == 150) 200 else 150
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        Mk8dxEngineMark(shown, size = Mk8dxEngineMarkSize.Lg)
        Mk8dxHiddenByPreference(
            androidText(
                "${hidden}cc is hidden by your Time Trial preference.",
                "${hidden}cc is verborgen door je Time Trial-voorkeur.",
            ),
            androidText("Show ${hidden}cc anyway", "Toch ${hidden}cc tonen"),
            {
                overridden = true
                onModeChange(hidden)
            },
            tag = "journey-show-hidden-engine",
        )
    }
}

@Composable
private fun JourneyTile(
    metric: AndroidJourneyMetric,
    mode: Int,
    language: Mk8dxNumberLanguage,
    onOpenFocus: (AndroidTimeTrialTrackScope, Int, AndroidRankTrackFocus) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val focus = if (metric.tone == AndroidJourneyTone.TIMES_SET) {
        AndroidRankTrackFocus.TRACKS_LEFT
    } else {
        AndroidRankTrackFocus.STAFF_LEFT
    }
    val scopeLabel = androidText(metric.scopeLabelEnglish, metric.scopeLabelDutch)
    val measure = androidText(metric.measureEnglish, metric.measureDutch)
    val counted = Mk8dxNumeric.formatCount(metric.value.toLong(), language) + "/" +
        Mk8dxNumeric.formatCount(metric.total.toLong(), language)
    Column(
        modifier
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .clickable(role = Role.Button) { onOpenFocus(metric.scope, mode, focus) }
            .padding(Mk8dxSpacing.md)
            .testTag(
                "journey-tile-" + metric.scope.apiValue + "-" +
                    (if (metric.tone == AndroidJourneyTone.TIMES_SET) "driven" else "staff"),
            ),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                (scopeLabel + " · " + measure).uppercase(),
                modifier = Modifier.weight(1f),
                style = type.micro,
                color = colors.textSecondary,
                // Every journey card reserves the same three-line title
                // block. A short "Times set" label must not pull its count
                // and bar above the neighbouring "Staff ghosts defeated".
                minLines = 3,
                maxLines = 3,
            )
            if (metric.complete) {
                Mk8dxChip(androidText("Complete", "Compleet"), tone = Mk8dxChipTone.Success)
            }
        }
        Text(
            counted,
            style = type.dataM.copy(fontWeight = FontWeight.SemiBold),
            color = colors.textPrimary,
            softWrap = false,
            maxLines = 1,
        )
        Mk8dxValueBar(
            metric.progress,
            metric.percentage.toString() + "%",
            if (metric.complete) colors.statusSuccess else colors.statusInfo,
            Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun CompetitiveCell(
    count: AndroidCompetitiveCount,
    mode: Int,
    language: Mk8dxNumberLanguage,
    onOpenFocus: (AndroidTimeTrialTrackScope, Int, AndroidRankTrackFocus) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Column(
        modifier
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .clickable(role = Role.Button) {
                onOpenFocus(AndroidTimeTrialTrackScope.ALL, mode, count.focus)
            }
            .padding(Mk8dxSpacing.md)
            .testTag("journey-competitive-" + count.focus.apiValue),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            Mk8dxNumeric.formatCount(count.value.toLong(), language),
            style = type.dataM.copy(fontWeight = FontWeight.SemiBold),
            color = colors.textPrimary,
            softWrap = false,
            maxLines = 1,
        )
        Text(
            androidText(count.english, count.dutch),
            style = type.bodyS,
            color = colors.textSecondary,
        )
    }
}

@Composable
private fun JourneyMasteryTarget(
    target: AndroidJourneyTarget,
    mode: Int,
    onOpenTotalRanking: (Int) -> Unit,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .clickable(role = Role.Button) { onOpenTotalRanking(mode) }
            .padding(Mk8dxSpacing.md)
            .testTag("journey-overall-mastery-target"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Text(
            androidText("OVERALL MASTERY TARGET", "DOEL TOTALE MASTERY"),
            style = type.micro,
            color = colors.textSecondary,
        )
        val reduction = target.masteryReductionMs
        if (reduction == null) {
            Text(
                androidText("Highest tier reached", "Hoogste niveau bereikt"),
                style = type.dataM.copy(fontWeight = FontWeight.SemiBold),
                color = colors.textPrimary,
            )
        } else {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    Mk8dxNumeric.TRUE_MINUS + Mk8dxNumeric.formatTime(reduction) + " →",
                    style = type.dataM.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.textPrimary,
                )
                val nextTier = (target.masteryTier - 1).coerceAtLeast(0)
                androidMasteryTierColor(nextTier)?.let { color ->
                    Mk8dxTierChip(AndroidMasteryThresholds.tierLabels[nextTier], color)
                }
            }
        }
        Text(
            androidText("Across all 96 tracks", "Over alle 96 circuits"),
            style = type.bodyS,
            color = colors.textSecondary,
        )
    }
}

@Composable
private fun JourneyRankTarget(
    target: AndroidJourneyTarget,
    mode: Int,
    onOpenTotalRanking: (Int) -> Unit,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val rank = requireNotNull(target.standing)
    val value = if (rank == 1) {
        androidText("You are #1", "Je staat #1")
    } else {
        target.rankReductionMs?.let {
            Mk8dxNumeric.TRUE_MINUS + Mk8dxNumeric.formatTime(it) + " → #" + (rank - 1)
        } ?: androidText("Not available", "Niet beschikbaar")
    }
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .clickable(role = Role.Button) { onOpenTotalRanking(mode) }
            .padding(Mk8dxSpacing.md)
            .testTag("journey-next-rank-target"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Text(androidText("NEXT RANK", "VOLGENDE POSITIE"), style = type.micro, color = colors.textSecondary)
        Text(value, style = type.dataM.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
        Text(
            androidText("${mode}cc total ranking", "${mode}cc-totaalklassement"),
            style = type.bodyS,
            color = colors.textSecondary,
        )
    }
}
