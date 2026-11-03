package nl.mariokart8.mk8dxtimetrials.ecosystem

import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxRankRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxRowKind

internal const val ANDROID_RANK_COMPARE_LIMIT = 3
internal const val ANDROID_NINTENDO_STAFF_REFERENCE_ID = "reference.nintendo_staff"
internal const val ANDROID_WORLD_RECORD_REFERENCE_ID = "reference.world_record"
internal enum class AndroidTimeTrialTrackScope(val apiValue: String) {
    BASE("base"), BCP("bcp"), ALL("all");

    val tracks get() = when (this) {
        BASE -> Schema9AndroidTrackCatalog.entries.take(48)
        BCP -> Schema9AndroidTrackCatalog.entries.drop(48)
        ALL -> Schema9AndroidTrackCatalog.entries
    }
    val trackIds get() = tracks.map { it.id }.toSet()
    val trackCount get() = tracks.size
}
internal val ANDROID_RANK_REFERENCE_NAMES = mapOf(
    ANDROID_NINTENDO_STAFF_REFERENCE_ID to "Nintendo Ghost",
    ANDROID_WORLD_RECORD_REFERENCE_ID to "World Record",
)

internal data class AndroidRankPlayerSummary(
    val playerId: String,
    val displayName: String,
    val mode: Int,
    val totalMs: Long,
    val playedTracks: Int,
    val masteryTier: Int,
    val gold: Int,
    val silver: Int,
    val bronze: Int,
    val bests: Map<String, AndroidTrackBest>,
    val scope: AndroidTimeTrialTrackScope = AndroidTimeTrialTrackScope.ALL,
)

internal fun buildAndroidRankPlayers(
    home: AndroidHomeBootstrap,
    mode: Int,
    scope: AndroidTimeTrialTrackScope = AndroidTimeTrialTrackScope.ALL,
): List<AndroidRankPlayerSummary> {
    require(mode == 150 || mode == 200)
    val comeback = home.comeback ?: return emptyList()
    val names = buildMap {
        put(comeback.player.playerId, comeback.player.displayName)
        comeback.rivals.forEach { putIfAbsent(it.playerId, it.displayName) }
    }
    val bestsByPlayer = home.trackBests?.players.orEmpty()
        .groupBy(AndroidTrackBestPlayer::playerId)
        .mapValues { (_, duplicates) ->
            duplicates.flatMap(AndroidTrackBestPlayer::bests)
                .filter { it.mode == mode && it.trackId in scope.trackIds }
                .groupBy(AndroidTrackBest::trackId)
                .mapValues { (_, bests) -> bests.minBy(AndroidTrackBest::totalTimeMs) }
        }
    val playerIds = buildList {
        add(comeback.player.playerId)
        addAll(comeback.rivals.map(AndroidRivalComparison::playerId))
    }.distinct()
    return playerIds.map { playerId ->
        val bests = bestsByPlayer[playerId].orEmpty()
        val totalMs = scope.tracks.sumOf { track ->
            bests[track.id]?.totalTimeMs
                ?: AndroidMasteryThresholds.UNPLAYED_FALLBACK_MS
        }
        AndroidRankPlayerSummary(
            playerId = playerId,
            displayName = names[playerId] ?: playerId.removePrefix("player."),
            mode = mode,
            totalMs = totalMs,
            playedTracks = bests.size,
            masteryTier = AndroidMasteryThresholds.totalTier(mode, totalMs, scope.trackIds),
            gold = bests.values.count { it.rank == 1 },
            silver = bests.values.count { it.rank == 2 },
            bronze = bests.values.count { it.rank == 3 },
            bests = bests,
            scope = scope,
        )
    }
}

internal fun buildAndroidRankPlayer(
    playerId: String,
    displayName: String,
    mode: Int,
    results: List<AndroidPublicTimeTrialResult>,
    scope: AndroidTimeTrialTrackScope = AndroidTimeTrialTrackScope.ALL,
): AndroidRankPlayerSummary {
    val bests = results.filter { it.mode == mode && it.trackId in scope.trackIds }.groupBy(AndroidPublicTimeTrialResult::trackId)
        .mapValues { (_, values) ->
            val result = values.minBy(AndroidPublicTimeTrialResult::totalTimeMs)
            AndroidTrackBest(result.trackId, result.mode, result.totalTimeMs, result.rank ?: Int.MAX_VALUE)
        }
    val totalMs = scope.tracks.sumOf { bests[it.id]?.totalTimeMs ?: AndroidMasteryThresholds.UNPLAYED_FALLBACK_MS }
    return AndroidRankPlayerSummary(playerId, displayName, mode, totalMs, bests.size,
        AndroidMasteryThresholds.totalTier(mode, totalMs, scope.trackIds), bests.values.count { it.rank == 1 },
        bests.values.count { it.rank == 2 }, bests.values.count { it.rank == 3 }, bests, scope)
}

internal fun buildAndroidRankReference(
    referenceId: String,
    mode: Int,
    worldRecords: List<AndroidWorldRecord> = emptyList(),
    scope: AndroidTimeTrialTrackScope = AndroidTimeTrialTrackScope.ALL,
): AndroidRankPlayerSummary {
    require(referenceId in ANDROID_RANK_REFERENCE_NAMES)
    require(mode == 150 || mode == 200)
    val times = if (referenceId == ANDROID_NINTENDO_STAFF_REFERENCE_ID) {
        AndroidBenchmarkCatalog.forKind(AndroidBenchmarkKind.NINTENDO_STAFF, mode)
            .associate { it.trackId to it.timeMs }
    } else {
        val live = worldRecords.filter { it.mode == mode }.associate { it.trackId to it.totalTimeMs }
        if (live.size == Schema9AndroidTrackCatalog.entries.size) live else
            AndroidBenchmarkCatalog.forKind(AndroidBenchmarkKind.WORLD_RECORD, mode)
                .associate { it.trackId to it.timeMs }
    }
    val bests = times.filterKeys { it in scope.trackIds }
        .mapValues { (trackId, timeMs) -> AndroidTrackBest(trackId, mode, timeMs, 1) }
    val totalMs = scope.tracks.sumOf { bests[it.id]?.totalTimeMs ?: AndroidMasteryThresholds.UNPLAYED_FALLBACK_MS }
    return AndroidRankPlayerSummary(
        referenceId, ANDROID_RANK_REFERENCE_NAMES.getValue(referenceId), mode, totalMs,
        bests.size, AndroidMasteryThresholds.totalTier(mode, totalMs, scope.trackIds), 0, 0, 0, bests, scope,
    )
}

internal fun AndroidRankPlayerSummary.masteryDistribution(): IntArray {
    val counts = IntArray(AndroidMasteryThresholds.tierLabels.size)
    bests.values.forEach { best ->
        AndroidMasteryThresholds.trackTier(best.trackId, mode, best.totalTimeMs)
            ?.let { counts[it] += 1 }
    }
    return counts
}

internal fun updateAndroidRankSelection(
    current: List<String>,
    playerId: String,
    viewerPlayerId: String? = null,
): List<String> {
    val unique = buildList {
        viewerPlayerId?.let(::add)
        addAll(current.filterNot { it == viewerPlayerId })
    }.distinct()
    return if (playerId in unique) {
        if (playerId == viewerPlayerId || unique.size == 1) unique else unique.filterNot { it == playerId }
    } else if (unique.size < ANDROID_RANK_COMPARE_LIMIT) {
        unique + playerId
    } else if (playerId in ANDROID_RANK_REFERENCE_NAMES && viewerPlayerId != null) {
        unique.take(ANDROID_RANK_COMPARE_LIMIT - 1) + playerId
    } else {
        unique
    }
}

internal fun sortAndroidRankMedals(players: List<AndroidRankPlayerSummary>): List<AndroidRankPlayerSummary> =
    players.sortedWith(
        compareByDescending<AndroidRankPlayerSummary> { it.gold }
            .thenByDescending { it.silver }
            .thenByDescending { it.bronze }
            .thenBy { it.displayName },
    )

internal fun sortAndroidStandingMedals(players: List<AndroidRankStanding>): List<AndroidRankStanding> =
    players.sortedWith(
        compareByDescending<AndroidRankStanding> { it.goldMedals }
            .thenByDescending { it.silverMedals }
            .thenByDescending { it.bronzeMedals }
            .thenBy { it.playerDisplayName },
    )

internal fun sortAndroidRankMasteryColumns(players: List<AndroidRankPlayerSummary>): List<AndroidRankPlayerSummary> =
    players.sortedWith(compareBy(AndroidRankPlayerSummary::totalMs, AndroidRankPlayerSummary::displayName))

internal fun androidRankUnionPlayerIds(
    viewerPlayerId: String?,
    includeRivals: Boolean,
    rivalPlayerIds: Iterable<String>,
    groupPlayerIds: Iterable<String>,
    comparedPlayerIds: Iterable<String>,
): Set<String> = buildSet {
    viewerPlayerId?.let(::add)
    if (includeRivals) addAll(rivalPlayerIds)
    addAll(groupPlayerIds)
    addAll(comparedPlayerIds)
}

internal fun formatAndroidRankTotal(milliseconds: Long): String {
    val absolute = kotlin.math.abs(milliseconds)
    val hours = absolute / 3_600_000
    val minutes = absolute % 3_600_000 / 60_000
    val seconds = absolute % 60_000 / 1_000
    val millis = absolute % 1_000
    return String.format(Locale.ROOT, "%d:%02d:%02d.%03d", hours, minutes, seconds, millis)
}

/**
 * The global standing as design-system ranking rows (Phase 6 / A04): the rank
 * the server gave the Player, their name, their total, and the one row that is
 * the reader's own — which the table then draws as the YouRow. The rank column
 * sizes itself from the largest rank in exactly this list, so a table that
 * reaches #99,999 makes room for it and a table of ten does not.
 */
internal fun androidRankStandingRows(
    standings: List<AndroidRankStanding>,
    viewerPlayerId: String?,
    youLabel: String,
): List<Mk8dxRankRow> = standings.map { row ->
    Mk8dxRankRow(
        rank = row.rank,
        name = row.playerDisplayName,
        timeMs = row.totalTimeMs,
        kind = if (viewerPlayerId != null && row.playerId == viewerPlayerId) {
            Mk8dxRowKind.You
        } else {
            Mk8dxRowKind.Normal
        },
        youLabel = youLabel,
    )
}

/**
 * The chosen scope's standing as ranking rows. The order is the one the screen
 * has always used (total, then Player id), the position is the place in that
 * order, and a reference Player (Nintendo Ghost, World Record) is a reference
 * row rather than a competitor.
 */
internal fun androidRankScopeStandingRows(
    players: List<AndroidRankPlayerSummary>,
    ownPlayerId: String?,
    youLabel: String,
): List<Mk8dxRankRow> = players
    .sortedWith(compareBy(AndroidRankPlayerSummary::totalMs, AndroidRankPlayerSummary::playerId))
    .mapIndexed { index, player ->
        Mk8dxRankRow(
            rank = index + 1,
            name = player.displayName,
            timeMs = player.totalMs,
            kind = when {
                ownPlayerId != null && player.playerId == ownPlayerId -> Mk8dxRowKind.You
                player.playerId in ANDROID_RANK_REFERENCE_NAMES -> Mk8dxRowKind.Reference
                else -> Mk8dxRowKind.Normal
            },
            youLabel = youLabel,
        )
    }

/*
 * The two signed formatters that used to live here went with Phase 6 (A04):
 * every gap on Ranking is now `Mk8dxNumeric.formatDelta`, the one signed format
 * both clients share (DESIGN_SYSTEM §10).
 */
