package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.util.Calendar
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutVariants
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxArtHero
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineSelector
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxHeroRank
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSegmentedControl
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatBlock
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTierChip

// My records & stats on the phone (owner 2026-09-26): the same page as the Web's `?mystats=1`,
// built from the same documents - the record book (`/v1/me/player-insights`), the rank per track
// (`/v1/bootstrap` focus), the total standing, your last 100 runs (`/v1/me/player-activity`), your
// published results (dates and combos) and the Tournament track record. Mastery comes from the same
// thresholds as Ranking and Home. Only the record book is required; everything else leaves its part out.

// ---------------------------------------------------------------- the pure model (twin of ds-mystats.ts)

internal data class AndroidMyStatsBest(
    val timeMs: Long,
    val attempts: Int,
    val tier: Int,
    val label: String,
    /** The next Mastery level up and how much faster it asks for; null at the top. */
    val nextLabel: String?,
    val nextGapMs: Long?,
    val rank: Int?,
    val field: Int?,
    val setAtMs: Long?,
)

internal data class AndroidMyStatsCard(
    val trackId: String,
    val trackIndex: Int,
    val name: String,
    val cupIndex: Int,
    val cupName: String,
    val best: AndroidMyStatsBest?,
)

internal fun androidMyStatsCards(
    bests: List<AndroidPersonalBest>,
    mode: Int,
    focus: List<AndroidFocusRow>,
    results: List<AndroidPublicTimeTrialResult>,
): List<AndroidMyStatsCard> {
    val mine = bests.filter { it.modeCC == mode }.associateBy { it.trackId }
    val ranks = focus.filter { it.mode == mode }.associateBy { it.trackId }
    val labels = AndroidMasteryThresholds.tierLabels
    return Schema9AndroidTrackCatalog.cups.flatMap { cup ->
        cup.tracks.map { track ->
            val best = mine[track.id]
            AndroidMyStatsCard(
                track.id, track.index, track.displayName, cup.index, cup.displayName,
                best?.let {
                    val tier = AndroidMasteryThresholds.trackTier(track.id, mode, it.bestTimeMs) ?: (labels.size - 1)
                    val next = if (tier > 0) AndroidMasteryThresholds.trackLadder(track.id, mode)?.getOrNull(tier - 1) else null
                    val row = ranks[track.id]
                    AndroidMyStatsBest(
                        timeMs = it.bestTimeMs, attempts = it.attemptCount, tier = tier, label = labels[tier],
                        nextLabel = next?.let { labels[tier - 1] }, nextGapMs = next?.let { target -> maxOf(0L, it.bestTimeMs - target) },
                        rank = row?.myRank, field = row?.humanCount,
                        setAtMs = results.filter { result -> result.trackId == track.id && result.mode == mode && result.totalTimeMs == it.bestTimeMs }
                            .minOfOrNull { result -> result.resultAtMs }?.takeIf { at -> at > 0 },
                    )
                },
            )
        }
    }
}

/** How many tracks sit at each Mastery level, fastest first, and how many are not raced yet. */
internal fun androidMyStatsDistribution(cards: List<AndroidMyStatsCard>): Pair<List<Pair<String, Int>>, Int> {
    val counts = cards.mapNotNull { it.best?.label }.groupingBy { it }.eachCount()
    return AndroidMasteryThresholds.tierLabels.filter { it in counts }.map { it to counts.getValue(it) } to cards.count { it.best == null }
}

internal data class AndroidMyStatsMomentum(
    val weekStarts: List<Long>,
    val runsPerWeek: List<Int>,
    val recentPbs: Int,
    val latestTrackId: String?,
    val latestGainMs: Long?,
    val latestAtMs: Long?,
)

/**
 * Runs per week for the last twelve weeks, and the personal bests among them: a run faster than
 * every earlier run on its track in the window (only the last 100 runs are known).
 */
internal fun androidMyStatsMomentum(runs: List<AndroidOwnRun>, mode: Int, nowMs: Long): AndroidMyStatsMomentum {
    val week = 7L * 24 * 3_600_000
    val start = Calendar.getInstance().apply {
        timeInMillis = nowMs
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        add(Calendar.DAY_OF_MONTH, -((get(Calendar.DAY_OF_WEEK) + 5) % 7))
    }.timeInMillis
    val starts = (0 until 12).map { start - (11 - it) * week }
    val counts = IntArray(12)
    val since = nowMs - 30L * 24 * 3_600_000
    val bestSoFar = HashMap<String, Long>()
    var recent = 0
    var latest: Triple<String, Long, Long>? = null
    runs.filter { it.modeCC == mode }.sortedBy { it.atMs }.forEach { run ->
        val index = starts.indexOfLast { run.atMs >= it }
        if (index >= 0 && run.atMs < starts[index] + week) counts[index] += 1
        val previous = bestSoFar[run.trackId]
        if (previous == null || run.totalTimeMs < previous) {
            if (previous != null && run.atMs >= since) {
                recent += 1
                latest = Triple(run.trackId, previous - run.totalTimeMs, run.atMs)
            }
            bestSoFar[run.trackId] = run.totalTimeMs
        }
    }
    return AndroidMyStatsMomentum(starts, counts.toList(), recent, latest?.first, latest?.second, latest?.third)
}

/** "14/9": a week's first day, short enough never to wrap under a column. */
internal fun androidWeekLabel(atMs: Long): String {
    val calendar = Calendar.getInstance().apply { timeInMillis = atMs }
    return "${calendar.get(Calendar.DAY_OF_MONTH)}/${calendar.get(Calendar.MONTH) + 1}"
}

internal data class AndroidComboPart(val role: String, val assetPath: String, val name: String)

/** The combo most of your published runs at this engine used, with the character's own colours. */
internal fun androidFavouriteCombo(results: List<AndroidPublicTimeTrialResult>, mode: Int): Triple<List<AndroidComboPart>, Int, Int>? {
    val withLoadout = results.filter { it.mode == mode && it.loadout != null }
    val top = withLoadout.groupBy { listOf(it.loadout!!.characterId, it.loadout.bodyId, it.loadout.tireId, it.loadout.gliderId) }
        .maxByOrNull { it.value.size } ?: return null
    val loadout = top.value.first().loadout!!
    val appearance = loadout.characterVariantId ?: loadout.characterId
    fun part(role: String, baseId: String?, variantId: String?): AndroidComboPart? {
        AndroidLoadoutVariants.byId(variantId)?.let { variant ->
            val base = AndroidLoadoutCatalog.find(baseId)?.name ?: variant.name
            return AndroidComboPart(role, variant.assetPath, if (baseId?.startsWith("character.") == true) base else "$base · ${variant.name}")
        }
        val base = AndroidLoadoutCatalog.find(baseId) ?: return null
        val themed = if (appearance == null || base.id.startsWith("character.")) null else AndroidLoadoutVariants.matched(base.id, appearance)
        return AndroidComboPart(role, themed?.assetPath ?: base.assetPath, themed?.let { "${base.name} · ${it.name}" } ?: base.name)
    }
    val parts = listOfNotNull(
        part("character", loadout.characterId, loadout.characterVariantId),
        part("body", loadout.bodyId, loadout.bodyVariantId),
        part("tires", loadout.tireId, null),
        part("glider", loadout.gliderId, loadout.gliderVariantId),
    )
    return if (parts.isEmpty()) null else Triple(parts, top.value.size, withLoadout.size)
}

/** Where each tournament starts on the rating trajectory: (point index, "TN5"). The Web's ticks. */
internal fun androidRatingTicks(points: List<AndroidRatingPoint>): List<Pair<Int, String>> {
    var previous: Int? = null
    return points.mapIndexedNotNull { index, point ->
        if (point.tournamentNumber == previous) null else { previous = point.tournamentNumber; index to "TN${point.tournamentNumber}" }
    }
}

internal enum class AndroidRecordSort { CUP, NEXT, RANK, RECENT }

internal fun androidSortCards(cards: List<AndroidMyStatsCard>, sort: AndroidRecordSort): List<AndroidMyStatsCard> = when (sort) {
    AndroidRecordSort.CUP -> cards
    AndroidRecordSort.NEXT -> cards.filter { it.best != null }.sortedWith(compareBy({ it.best!!.nextGapMs ?: Long.MAX_VALUE }, { it.name }))
    AndroidRecordSort.RANK -> cards.filter { it.best != null }.sortedWith(compareBy({ it.best!!.rank ?: Int.MAX_VALUE }, { it.name }))
    AndroidRecordSort.RECENT -> cards.filter { it.best != null }.sortedWith(compareBy({ -(it.best!!.setAtMs ?: 0L) }, { it.name }))
}

// ---------------------------------------------------------------- the screen

private data class AndroidMyStatsData(
    val insights: AndroidPlayerInsights,
    val focus: List<AndroidFocusRow>,
    val runs: List<AndroidOwnRun>,
    val results: List<AndroidPublicTimeTrialResult>,
    val displayName: String?,
    val tournament: AndroidTournamentStandingEntry?,
    val tournamentOf: Int,
    val tracks: AndroidTournamentTrackRecord?,
    val rating: List<AndroidRatingPoint>,
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AndroidMyStatsScreen(
    client: AndroidTimeTrialsEcosystemDataSource,
    playerId: String?,
    onSignIn: () -> Unit,
    onManageResults: () -> Unit,
    onOpenTrack: (String, Int) -> Unit,
    onPostTime: (String, Int) -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val numbers = if (language == AndroidProductLanguage.DUTCH) Mk8dxNumberLanguage.NL else Mk8dxNumberLanguage.EN
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    var data by remember(client, playerId) { mutableStateOf<AndroidMyStatsData?>(null) }
    var failed by remember(client, playerId) { mutableStateOf(false) }
    var mode by remember { mutableStateOf(150) }
    var standings by remember(client, playerId) { mutableStateOf<Map<Int, List<AndroidRankStanding>>>(emptyMap()) }
    var sort by remember { mutableStateOf(AndroidRecordSort.CUP) }
    var level by remember(mode) { mutableStateOf<String?>(null) }

    LaunchedEffect(client, playerId) {
        if (playerId == null) return@LaunchedEffect
        withContext(Dispatchers.IO) {
            val insights = runCatching { client.playerInsights() }.getOrNull()
            if (insights == null) { failed = true; return@withContext }
            val home = runCatching { client.home() }.getOrNull()
            val tournament = runCatching { client.tournamentStanding() }.getOrDefault(emptyList())
            data = AndroidMyStatsData(
                insights = insights,
                focus = home?.focus?.rows.orEmpty(),
                runs = runCatching { client.ownRuns() }.getOrDefault(emptyList()),
                results = runCatching { client.playerResults(playerId) }.getOrDefault(emptyList()),
                displayName = home?.player?.displayName,
                tournament = tournament.firstOrNull { it.playerId == playerId },
                tournamentOf = tournament.size,
                tracks = runCatching { client.tournamentTrackRecord(playerId) }.getOrNull(),
                rating = runCatching { client.ratingHistory(playerId) }.getOrDefault(emptyList()),
            )
        }
    }
    LaunchedEffect(client, playerId, mode) {
        if (playerId == null || standings.containsKey(mode)) return@LaunchedEffect
        val loaded = withContext(Dispatchers.IO) { runCatching { client.rankStandings(mode) }.getOrDefault(emptyList()) }
        standings = standings + (mode to loaded)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(colors.surfaceApp).testTag("my-stats-screen"),
        contentPadding = PaddingValues(Mk8dxSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        if (playerId == null) {
            item {
                Mk8dxPanel(androidText(language, "My records & stats", "Mijn records en cijfers")) {
                    Text(androidText(language, "Sign in to see your records, Mastery and momentum.",
                        "Meld je aan om je records, Mastery en vorm te zien."), style = type.body, color = colors.textBody)
                    Mk8dxButton(androidText(language, "Sign in", "Aanmelden"), onSignIn, variant = Mk8dxButtonVariant.Primary)
                }
            }
            return@LazyColumn
        }
        val loaded = data
        if (loaded == null) {
            item {
                Text(if (failed) androidText(language, "Personal records are temporarily unavailable.", "Persoonlijke records zijn tijdelijk niet beschikbaar.")
                    else androidText(language, "Calculating your records…", "Je records worden berekend…"), style = type.body, color = colors.textSecondary)
            }
            return@LazyColumn
        }
        val cards = androidMyStatsCards(loaded.insights.timeTrials.personalBests, mode, loaded.focus, loaded.results)
        val raced = cards.filter { it.best != null }

        item { MyStatsHero(cards, raced, mode, loaded, standings[mode], numbers, language) { mode = it } }
        item { MyStatsMastery(cards, level) { level = if (level == it) null else it } }
        if (loaded.runs.isNotEmpty()) item { MyStatsMomentum(androidMyStatsMomentum(loaded.runs, mode, System.currentTimeMillis()), mode) }
        item { MyStatsHighlights(raced, loaded.results, mode, numbers, onOpenTrack) }

        item {
            Mk8dxPanel(androidText(language, "Record book", "Recordboek")) {
                Text(androidText(language, "${raced.size} of ${cards.size} tracks at ${mode}cc. Every card opens the track's leaderboard.",
                    "${raced.size} van ${cards.size} circuits op ${mode}cc. Elke kaart opent de ranglijst van het circuit."),
                    style = type.bodyS, color = colors.textSecondary)
                Mk8dxSegmentedControl(
                    androidText(language, "Order", "Volgorde"),
                    listOf(
                        AndroidRecordSort.CUP to androidText(language, "By cup", "Per cup"),
                        AndroidRecordSort.NEXT to androidText(language, "Next level", "Volgend niveau"),
                        AndroidRecordSort.RANK to androidText(language, "Best rank", "Beste positie"),
                        AndroidRecordSort.RECENT to androidText(language, "Recent", "Recent"),
                    ),
                    sort, { sort = it },
                )
                if (level != null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                        Text(androidText(language, "Showing ${if (level == OPEN) "tracks not raced yet" else level}.",
                            "Alleen ${if (level == OPEN) "nog niet gereden circuits" else level}."), style = type.bodyS, color = colors.textBody)
                        Mk8dxButton(androidText(language, "Show every track", "Toon alle circuits"), { level = null },
                            variant = Mk8dxButtonVariant.Quiet, size = Mk8dxButtonSize.Sm)
                    }
                }
            }
        }
        val shown = cards.filter { level == null || (if (level == OPEN) it.best == null else it.best?.label == level) }
        if (sort == AndroidRecordSort.CUP) {
            shown.groupBy { it.cupIndex }.forEach { (cupIndex, list) ->
                item(key = "cup-$cupIndex-$mode") {
                    Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                            ProductAssetImage("private-product/img/cup/$cupIndex.png", "", colors.textSecondary, Modifier.size(22.dp))
                            Text(list.first().cupName, style = type.title, color = colors.textPrimary)
                        }
                        list.forEach { MyStatsTrackCard(it, mode, numbers, onOpenTrack, onPostTime) }
                    }
                }
            }
        } else {
            androidSortCards(shown, sort).forEach { card -> item(key = "card-${card.trackId}-$mode-$sort") { MyStatsTrackCard(card, mode, numbers, onOpenTrack, onPostTime) } }
        }

        item { MyStatsTournaments(loaded, numbers, language) }
        item {
            val attempts = loaded.insights.timeTrials.personalBests.groupBy { it.modeCC }.mapValues { entry -> entry.value.sumOf { it.attemptCount } }
            val cells = loaded.insights.timeTrials.personalBests.groupingBy { it.modeCC }.eachCount()
            Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                Text(androidText(language,
                    "Totals: ${loaded.insights.timeTrials.submissionCount} runs submitted (150cc ${attempts[150] ?: 0} · 200cc ${attempts[200] ?: 0}) · ${loaded.insights.timeTrials.personalBests.size} personal bests (150cc ${cells[150] ?: 0} · 200cc ${cells[200] ?: 0})",
                    "Totalen: ${loaded.insights.timeTrials.submissionCount} ingezonden ritten (150cc ${attempts[150] ?: 0} · 200cc ${attempts[200] ?: 0}) · ${loaded.insights.timeTrials.personalBests.size} persoonlijke records (150cc ${cells[150] ?: 0} · 200cc ${cells[200] ?: 0})"),
                    style = type.micro, color = colors.textSecondary)
                Mk8dxButton(androidText(language, "Manage my results", "Mijn resultaten beheren"), onManageResults,
                    variant = Mk8dxButtonVariant.Secondary, size = Mk8dxButtonSize.Sm, tag = "my-stats-manage")
            }
        }
    }
}

private const val OPEN = "open"

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MyStatsHero(
    cards: List<AndroidMyStatsCard>, raced: List<AndroidMyStatsCard>, mode: Int, data: AndroidMyStatsData,
    standings: List<AndroidRankStanding>?, numbers: Mk8dxNumberLanguage, language: AndroidProductLanguage, onMode: (Int) -> Unit,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val totalMs = cards.sumOf { it.best?.timeMs ?: AndroidMasteryThresholds.UNPLAYED_FALLBACK_MS }
    val overall = AndroidMasteryThresholds.totalTier(mode, totalMs)
    val toNext = AndroidMasteryThresholds.nextTotalTierDeltaMs(mode, totalMs)
    val strongest = raced.minWithOrNull(compareBy({ it.best!!.tier }, { it.best!!.rank ?: 99 }))
    val mine = standings?.firstOrNull { it.playerId == data.insights.playerId }
    Mk8dxArtHero(
        androidText(language, "My records & stats", "Mijn records en cijfers"),
        meta = listOfNotNull("${mode}cc", data.displayName).joinToString(" · "),
        backdrop = strongest != null,
        art = strongest?.let { card -> { nl.mariokart8.mk8dxtimetrials.track.TrackAssetArtwork(card.trackIndex, Modifier.fillMaxSize()) } },
    ) {
        if (mine != null) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                Mk8dxHeroRank(mine.rank, numbers, androidText(language, "Time Trials rank", "Tijdritpositie"))
                Text(androidText(language, "of ${standings.size} · ${mode}cc total", "van ${standings.size} · ${mode}cc totaal"),
                    style = type.bodyS, color = colors.textSecondary, modifier = Modifier.padding(bottom = 6.dp))
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.lg), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(androidText(language, "Overall Mastery", "Totale Mastery"), style = type.bodyS, color = colors.textSecondary)
                val label = AndroidMasteryThresholds.tierLabels[overall]
                Mk8dxTierChip(label, androidMasteryTierColor(overall) ?: colors.textSecondary)
                if (toNext != null && overall > 0) {
                    Text(androidText(language, "${Mk8dxNumeric.formatDelta(-toNext)} to ${AndroidMasteryThresholds.tierLabels[overall - 1]}",
                        "${Mk8dxNumeric.formatDelta(-toNext)} tot ${AndroidMasteryThresholds.tierLabels[overall - 1]}"),
                        style = type.micro, color = colors.textSecondary)
                }
            }
            Mk8dxStatBlock(androidText(language, "Tracks raced", "Gereden circuits"), "${raced.size}/${cards.size}")
            Mk8dxStatBlock(androidText(language, "Top 3 on a track", "Top 3 op een circuit"), raced.count { (it.best?.rank ?: 99) <= 3 }.toString())
            if (strongest != null) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(androidText(language, "Strongest track", "Sterkste circuit"), style = type.bodyS, color = colors.textSecondary)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                        Text(strongest.name, style = type.title, color = colors.textPrimary)
                        Mk8dxTierChip(strongest.best!!.label, androidMasteryTierColor(strongest.best.tier) ?: colors.textSecondary, dense = true)
                    }
                }
            }
        }
        Mk8dxEngineSelector(androidText(language, "Engine class", "Motorklasse"), mode, onMode)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MyStatsMastery(cards: List<AndroidMyStatsCard>, selected: String?, onSelect: (String) -> Unit) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val (levels, open) = androidMyStatsDistribution(cards)
    val tierIndex = { label: String -> AndroidMasteryThresholds.tierLabels.indexOf(label) }
    Mk8dxPanel(androidText(language, "Mastery across your tracks", "Mastery over je circuits")) {
        Text(androidText(language, "Tap a level to see those tracks in the record book.", "Tik op een niveau om die circuits in het recordboek te zien."),
            style = Mk8dxTheme.type.bodyS, color = colors.textSecondary)
        Row(Modifier.fillMaxWidth().height(14.dp).background(colors.surfaceControl)
            .semantics { contentDescription = levels.joinToString(", ") { "${it.first} ${it.second}" } }) {
            levels.forEach { (label, count) ->
                Box(Modifier.weight(count.toFloat()).fillMaxHeight().background(androidMasteryTierColor(tierIndex(label)) ?: colors.textSecondary))
            }
            if (open > 0) Box(Modifier.weight(open.toFloat()).fillMaxHeight())
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
            levels.forEach { (label, count) ->
                Row(
                    Modifier.heightIn(min = Mk8dxSpacing.targetMin)
                        .border(1.dp, if (selected == label) colors.textPrimary else colors.borderSubtle)
                        .background(colors.surfaceControl).clickable { onSelect(label) }
                        .padding(horizontal = Mk8dxSpacing.sm).testTag("my-stats-level-$label"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                ) {
                    Mk8dxTierChip(label, androidMasteryTierColor(tierIndex(label)) ?: colors.textSecondary, dense = true)
                    Text(count.toString(), style = Mk8dxTheme.type.bodyS, color = colors.textPrimary)
                }
            }
            if (open > 0) {
                Row(
                    Modifier.heightIn(min = Mk8dxSpacing.targetMin)
                        .border(1.dp, if (selected == OPEN) colors.textPrimary else colors.borderSubtle)
                        .background(colors.surfaceControl).clickable { onSelect(OPEN) }.padding(horizontal = Mk8dxSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                ) {
                    Text(androidText(language, "Not raced", "Niet gereden"), style = Mk8dxTheme.type.micro, color = colors.textSecondary)
                    Text(open.toString(), style = Mk8dxTheme.type.bodyS, color = colors.textPrimary)
                }
            }
        }
    }
}

@Composable
private fun MyStatsMomentum(flow: AndroidMyStatsMomentum, mode: Int) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val highest = (flow.runsPerWeek.maxOrNull() ?: 0).coerceAtLeast(1)
    val latest = if (flow.latestTrackId != null && flow.latestGainMs != null && flow.latestAtMs != null) {
        val date = java.text.SimpleDateFormat("d MMM", language.locale)
            .format(java.util.Date(flow.latestAtMs))
        androidText(language, " · latest: ${androidTrackDisplayName(flow.latestTrackId)} ${Mk8dxNumeric.formatDelta(-flow.latestGainMs)} ($date)",
            " · laatste: ${androidTrackDisplayName(flow.latestTrackId)} ${Mk8dxNumeric.formatDelta(-flow.latestGainMs)} ($date)")
    } else ""
    Mk8dxPanel(androidText(language, "Momentum", "Vorm")) {
        Text(androidText(language, "Your ${mode}cc runs per week, last 12 weeks.", "Je ${mode}cc-ritten per week, laatste 12 weken."),
            style = Mk8dxTheme.type.bodyS, color = colors.textSecondary)
        Text(if (flow.recentPbs == 0) androidText(language, "No new personal bests in the last 30 days.", "Geen nieuwe persoonlijke records in de laatste 30 dagen.")
            else androidText(language, "${flow.recentPbs} personal ${if (flow.recentPbs == 1) "best" else "bests"} in the last 30 days", "${flow.recentPbs} persoonlijke ${if (flow.recentPbs == 1) "record" else "records"} in de laatste 30 dagen") + latest,
            style = Mk8dxTheme.type.body, color = colors.textBody, modifier = Modifier.testTag("my-stats-momentum"))
        Row(Modifier.fillMaxWidth().height(96.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            flow.runsPerWeek.forEachIndexed { index, runs ->
                Box(Modifier.weight(1f).fillMaxHeight(runs.toFloat() / highest).heightIn(min = 1.dp).background(Mk8dxTheme.colors.engine150)
                    .semantics { contentDescription = "${androidWeekLabel(flow.weekStarts[index])}: $runs" })
            }
        }
        // Every other week labelled, on one line each, so no two labels touch on a narrow phone.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            flow.weekStarts.forEachIndexed { index, start ->
                Text(if (index % 2 == 0) androidWeekLabel(start) else "", Modifier.weight(1f), style = Mk8dxTheme.type.micro,
                    color = colors.textSecondary, maxLines = 1, softWrap = false, overflow = TextOverflow.Visible)
            }
        }
    }
}

@Composable
private fun MyStatsHighlights(
    raced: List<AndroidMyStatsCard>, results: List<AndroidPublicTimeTrialResult>, mode: Int,
    numbers: Mk8dxNumberLanguage, onOpenTrack: (String, Int) -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val closest = raced.filter { it.best!!.nextGapMs != null }.minByOrNull { it.best!!.nextGapMs!! }
    val bestStanding = raced.filter { it.best!!.rank != null }.minWithOrNull(compareBy({ it.best!!.rank }, { it.best!!.tier }))
    val firsts = raced.count { it.best!!.rank == 1 }
    val busiest = raced.maxByOrNull { it.best!!.attempts }
    val combo = androidFavouriteCombo(results, mode)
    if (closest == null && bestStanding == null && busiest == null && combo == null) return
    Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        Mk8dxSectionLabel(androidText(language, "HIGHLIGHTS", "UITGELICHT"))
        @Composable
        fun Tile(label: String, card: AndroidMyStatsCard, headline: String, chip: Int?, detail: String) {
            Row(
                Modifier.fillMaxWidth().border(1.dp, colors.borderSubtle).background(colors.surfaceRaised)
                    .clickable { onOpenTrack(card.trackId, mode) }.padding(Mk8dxSpacing.sm),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                Schema9AndroidTrackCatalog.find(card.trackId)?.let { ActivityTrackThumb(it, mode, modifier = Modifier.width(96.dp)) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(label.uppercase(Locale.ROOT), style = Mk8dxTheme.type.micro, color = colors.textSecondary)
                    Text(card.name, style = Mk8dxTheme.type.title, color = colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                        Text(headline, style = Mk8dxTheme.type.body.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                        chip?.let { Mk8dxTierChip(AndroidMasteryThresholds.tierLabels[it], androidMasteryTierColor(it) ?: colors.textSecondary, dense = true) }
                    }
                    Text(detail, style = Mk8dxTheme.type.micro, color = colors.textSecondary)
                }
            }
        }
        closest?.let { card ->
            Tile(androidText(language, "Closest to the next level", "Dichtst bij het volgende niveau"), card,
                Mk8dxNumeric.formatDelta(-card.best!!.nextGapMs!!), card.best.tier - 1,
                androidText(language, "Now ${Mk8dxNumeric.formatTime(card.best.timeMs)} · ${card.best.label}", "Nu ${Mk8dxNumeric.formatTime(card.best.timeMs)} · ${card.best.label}"))
        }
        bestStanding?.let { card ->
            Tile(androidText(language, "Best standing", "Beste positie"), card,
                androidText(language, "#${card.best!!.rank} of ${card.best.field ?: "?"}", "#${card.best!!.rank} van ${card.best.field ?: "?"}"), null,
                if (firsts > 1) androidText(language, "You are #1 on $firsts tracks at ${mode}cc", "Je staat #1 op $firsts circuits in ${mode}cc")
                else "${Mk8dxNumeric.formatTime(card.best.timeMs)} · ${card.best.label}")
        }
        busiest?.let { card ->
            Tile(androidText(language, "Most attempts", "Meeste pogingen"), card,
                androidText(language, "${card.best!!.attempts} runs", "${card.best!!.attempts} ritten"), null,
                androidText(language, "Best ${Mk8dxNumeric.formatTime(card.best.timeMs)}", "Beste ${Mk8dxNumeric.formatTime(card.best.timeMs)}"))
        }
        combo?.let { (parts, runs, of) ->
            Column(
                Modifier.fillMaxWidth().border(1.dp, colors.borderSubtle).background(colors.surfaceRaised).padding(Mk8dxSpacing.sm)
                    .testTag("my-stats-combo"),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            ) {
                Text(androidText(language, "YOUR GO-TO COMBO", "JE FAVORIETE COMBINATIE"), style = Mk8dxTheme.type.micro, color = colors.textSecondary)
                parts.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                        pair.forEach { part ->
                            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                                ProductAssetImage(part.assetPath, part.name.take(1), colors.textSecondary, Modifier.size(40.dp), contentDescription = part.name)
                                Column {
                                    Text(when (part.role) {
                                        "character" -> androidText(language, "Character", "Personage")
                                        "body" -> androidText(language, "Body", "Kart")
                                        "tires" -> androidText(language, "Tires", "Banden")
                                        else -> androidText(language, "Glider", "Zweefvlieger")
                                    }, style = Mk8dxTheme.type.micro, color = colors.textSecondary)
                                    Text(part.name, style = Mk8dxTheme.type.bodyS.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                                }
                            }
                        }
                        if (pair.size == 1) Box(Modifier.weight(1f))
                    }
                }
                Text(androidText(language, "$runs of your last $of ${mode}cc runs", "$runs van je laatste $of ${mode}cc-ritten"),
                    style = Mk8dxTheme.type.micro, color = colors.textSecondary)
            }
        }
    }
}

@Composable
private fun MyStatsTrackCard(
    card: AndroidMyStatsCard, mode: Int, numbers: Mk8dxNumberLanguage,
    onOpenTrack: (String, Int) -> Unit, onPostTime: (String, Int) -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val best = card.best
    Row(
        Modifier.fillMaxWidth()
            .border(1.dp, colors.borderSubtle)
            .background(if (best == null) colors.surfaceApp else colors.surfaceRaised)
            .clickable { if (best == null) onPostTime(card.trackId, mode) else onOpenTrack(card.trackId, mode) }
            .padding(Mk8dxSpacing.xs)
            .testTag("my-stats-track-${card.trackId}"),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Schema9AndroidTrackCatalog.find(card.trackId)?.let { ActivityTrackThumb(it, mode, modifier = Modifier.width(96.dp)) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(card.name, style = Mk8dxTheme.type.title, color = if (best == null) colors.textSecondary else colors.textPrimary,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (best == null) {
                Text(androidText(language, "Not raced yet · post a time", "Nog niet gereden · plaats een tijd"), style = Mk8dxTheme.type.micro, color = colors.textSecondary)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                    Text(Mk8dxNumeric.formatTime(best.timeMs), style = Mk8dxTheme.type.data, color = colors.textPrimary)
                    Mk8dxTierChip(best.label, androidMasteryTierColor(best.tier) ?: colors.textSecondary, dense = true)
                }
                val date = best.setAtMs?.let {
                    java.text.SimpleDateFormat("d MMM", language.locale).format(java.util.Date(it))
                }
                Text(listOfNotNull(
                    best.rank?.let { androidText(language, "#$it of ${best.field ?: "?"}", "#$it van ${best.field ?: "?"}") },
                    if (best.nextGapMs == null) androidText(language, "Top level", "Hoogste niveau")
                    else androidText(language, "${Mk8dxNumeric.formatDelta(-best.nextGapMs)} to ${best.nextLabel}", "${Mk8dxNumeric.formatDelta(-best.nextGapMs)} tot ${best.nextLabel}"),
                    androidText(language, "${best.attempts} ${if (best.attempts == 1) "run" else "runs"}", "${best.attempts} ${if (best.attempts == 1) "rit" else "ritten"}"),
                    date,
                ).joinToString(" · "), style = Mk8dxTheme.type.micro, color = colors.textSecondary)
            }
        }
    }
}

@Composable
private fun MyStatsTournaments(data: AndroidMyStatsData, numbers: Mk8dxNumberLanguage, language: AndroidProductLanguage) {
    val colors = Mk8dxTheme.colors
    val totals = data.insights.tournaments
    Mk8dxPanel(androidText(language, "Tournaments", "Toernooien")) {
        Text(androidText(language, "Tournament figures count every race, whatever the engine class it was raced in.",
            "Toernooicijfers tellen elke race, in welke motorklasse die ook is gereden."), style = Mk8dxTheme.type.bodyS, color = colors.textSecondary)
        data.tournament?.let { entry ->
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                Mk8dxHeroRank(entry.rank, numbers, androidText(language, "Tournament standing", "Toernooipositie"))
                Text(androidText(language, "of ${data.tournamentOf} · rating ${entry.score?.let { String.format(Locale.US, "%.2f", it) } ?: "—"}",
                    "van ${data.tournamentOf} · rating ${entry.score?.let { String.format(Locale.US, "%.2f", it) } ?: "—"}"),
                    style = Mk8dxTheme.type.bodyS, color = colors.textSecondary, modifier = Modifier.padding(bottom = 6.dp))
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md)) {
            Mk8dxStatBlock(androidText(language, "Races", "Races"), totals.countedRaceCount.toString(), Modifier.weight(1f), large = true)
            Mk8dxStatBlock(androidText(language, "Wins", "Winst"), totals.wins.toString(), Modifier.weight(1f), large = true)
            Mk8dxStatBlock(androidText(language, "Podiums", "Podium"), totals.podiums.toString(), Modifier.weight(1f), large = true)
            Mk8dxStatBlock(androidText(language, "Avg finish", "Gem. finish"),
                if (totals.countedRaceCount == 0) "—" else String.format(Locale.US, "%.1f", totals.countedFinishPositionTotal.toDouble() / totals.countedRaceCount),
                Modifier.weight(1f), large = true)
        }
        if (totals.countedRaceCount > 0) {
            // How the counted races finished: wins, other podiums, the rest.
            Row(Modifier.fillMaxWidth().height(10.dp)) {
                listOf(totals.wins to colors.engine150, (totals.podiums - totals.wins) to colors.textSecondary,
                    (totals.countedRaceCount - totals.podiums) to colors.surfaceControl).forEach { (count, colour) ->
                    if (count > 0) Box(Modifier.weight(count.toFloat()).fillMaxHeight().background(colour))
                }
            }
        }
    }
    if (data.rating.size >= 2) {
        Column(Modifier.padding(top = Mk8dxSpacing.md)) { MyStatsRatingChart(data.rating, language) }
    }
    if (data.tracks != null) {
        Column(Modifier.padding(top = Mk8dxSpacing.md)) {
            AndroidTournamentTrackSection(record = data.tracks, playerName = data.displayName ?: "", language = language, loading = false, error = false)
        }
    }
}

/**
 * Tournament rating after every counted race, as on the Web profile (owner 2026-09-26): one line,
 * a hairline and "TN5" where each tournament starts, and a tap shows that race.
 */
@Composable
private fun MyStatsRatingChart(points: List<AndroidRatingPoint>, language: AndroidProductLanguage) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    var selected by remember(points) { mutableStateOf<Int?>(null) }
    val scores = points.map { it.score }
    val low = scores.min()
    val high = scores.max()
    val span = maxOf(high - low, 1.0)
    val ticks = androidRatingTicks(points)
    val tournaments = points.map { it.tournamentNumber }.distinct().size
    val last = points.last().score
    val lineColour = colors.engine150
    val gridColour = colors.borderSubtle
    val markColour = colors.textPrimary
    Mk8dxPanel(androidText(language, "Tournament rating", "Toernooirating")) {
        Text(androidText(language,
            "TrueSkill progression · ${points.size} races across $tournaments tournaments · now ${String.format(Locale.US, "%.2f", last)}",
            "TrueSkill-ontwikkeling · ${points.size} races in $tournaments toernooien · nu ${String.format(Locale.US, "%.2f", last)}"),
            style = type.bodyS, color = colors.textSecondary)
        BoxWithConstraints(Modifier.fillMaxWidth().testTag("my-stats-rating-chart")) {
            val widthDp = maxWidth
            Canvas(
                Modifier.fillMaxWidth().height(160.dp)
                    .semantics {
                        contentDescription = androidText(language,
                            "Rating from ${String.format(Locale.US, "%.2f", low)} to ${String.format(Locale.US, "%.2f", high)}, now ${String.format(Locale.US, "%.2f", last)}",
                            "Rating van ${String.format(Locale.US, "%.2f", low)} tot ${String.format(Locale.US, "%.2f", high)}, nu ${String.format(Locale.US, "%.2f", last)}")
                    }
                    .pointerInput(points) {
                        detectTapGestures { offset ->
                            val ratio = (offset.x / size.width).coerceIn(0f, 1f)
                            selected = (ratio * (points.size - 1)).toInt().coerceIn(0, points.size - 1)
                        }
                    },
            ) {
                val padY = 8.dp.toPx()
                val xOf = { index: Int -> index * size.width / (points.size - 1) }
                val yOf = { score: Double -> (size.height - padY - ((score - low) / span) * (size.height - 2 * padY)).toFloat() }
                ticks.forEach { (index, _) ->
                    drawLine(gridColour, Offset(xOf(index), 0f), Offset(xOf(index), size.height), strokeWidth = 1.dp.toPx())
                }
                val path = Path()
                points.forEachIndexed { index, point ->
                    if (index == 0) path.moveTo(xOf(index), yOf(point.score)) else path.lineTo(xOf(index), yOf(point.score))
                }
                drawPath(path, lineColour, style = Stroke(width = 2.dp.toPx()))
                selected?.let { index ->
                    drawCircle(markColour, radius = 4.dp.toPx(), center = Offset(xOf(index), yOf(points[index].score)))
                }
            }
            // Tournament labels under their hairline; a label is only drawn where it does not touch the previous one.
            var lastEnd = -1f
            ticks.forEach { (index, label) ->
                val x = widthDp.value * index / (points.size - 1)
                if (x > lastEnd) {
                    Text(label, Modifier.offset(x = x.dp, y = 162.dp), style = type.micro, color = colors.textSecondary,
                        maxLines = 1, softWrap = false)
                    lastEnd = x + 30f
                }
            }
        }
        Box(Modifier.height(18.dp))
        val detail = selected?.let { index ->
            val point = points[index]
            listOfNotNull(
                "TN${point.tournamentNumber} · ${point.sectionLabel} · ${androidText(language, "race", "race")} ${point.raceIndex}",
                "P${point.finishPosition} · ${androidText(language, "rating", "rating")} ${String.format(Locale.US, "%.2f", point.score)}",
                if (point.mu != null && point.sigma != null) "μ ${String.format(Locale.US, "%.2f", point.mu)} · σ ${String.format(Locale.US, "%.2f", point.sigma)}" else null,
            ).joinToString(" · ")
        } ?: androidText(language, "Tap the line to inspect a race.", "Tik op de lijn om een race te bekijken.")
        Text(detail, style = type.micro, color = colors.textSecondary, modifier = Modifier.testTag("my-stats-rating-detail"))
    }
}
