package nl.mariokart8.mk8dxtimetrials.ecosystem

import java.util.Locale

import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind

internal enum class AndroidFocusKind(val label: String) {
    LOWEST_MASTERY("Lowest mastery"),
    // The web names this card "Closest rival"; the same card must not be
    // called two things on two clients.
    CLOSEST_BATTLE("Closest rival"),
    BIGGEST_GAP("Biggest gap"),
}

internal enum class AndroidFocusContext { RIVALS, GLOBAL }

internal data class AndroidFocusCard(
    val kind: AndroidFocusKind,
    val trackId: String,
    val mode: Int,
    val headline: String,
    val gapMs: Long?,
    val context: String,
    val myBestMs: Long?,
    val targetMs: Long?,
    val masteryTier: Int? = null,
)

internal data class AndroidFocusSet(
    val best: AndroidFocusCard?,
    val closest: AndroidFocusCard?,
    val biggest: AndroidFocusCard?,
) {
    fun cards(): List<AndroidFocusCard> = listOfNotNull(best, closest, biggest)
}

private data class FocusCandidate(
    val trackId: String,
    val mode: Int,
    val myBestMs: Long,
    val targetMs: Long,
    val targetName: String,
    val targetRank: Int,
    val myRank: Int,
    val humanCount: Int,
    val gapMs: Long,
    val score: Int,
    val upside: Int,
)

private fun closenessBucket(relativeGap: Double): Int = when {
    relativeGap <= .005 -> 0
    relativeGap <= .02 -> 1
    relativeGap <= .05 -> 2
    else -> 3
}

private fun difficultyPenalty(trackId: String, mode: Int, targetMs: Long): Int {
    val record = AndroidBenchmarkCatalog.forTrack(trackId, mode)
        .firstOrNull { it.kind == AndroidBenchmarkKind.WORLD_RECORD }?.timeMs
        ?: return 0
    return if (targetMs <= record * 1.01) 2 else 0
}

private fun FocusCandidate.card(kind: AndroidFocusKind): AndroidFocusCard {
    val position = "$targetName is #$targetRank here — you are #$myRank of $humanCount."
    return AndroidFocusCard(
        kind = kind,
        trackId = trackId,
        mode = mode,
        headline = targetName,
        gapMs = gapMs,
        context = position,
        myBestMs = myBestMs,
        targetMs = targetMs,
    )
}

internal fun buildAndroidGlobalFocus(
    rows: List<AndroidFocusRow>,
    ownBests: List<AndroidTrackBest>,
): AndroidFocusSet {
    val effectiveBests = ownBests.ifEmpty {
        rows.map { AndroidTrackBest(it.trackId, it.mode, it.myBestMs, it.myRank) }
    }
    val candidates = rows.mapNotNull { row ->
        val above = row.above ?: return@mapNotNull null
        val gap = row.myBestMs - above.bestMs
        if (gap <= 0) return@mapNotNull null
        FocusCandidate(
            trackId = row.trackId,
            mode = row.mode,
            myBestMs = row.myBestMs,
            targetMs = above.bestMs,
            targetName = above.displayName,
            targetRank = above.rank,
            myRank = row.myRank,
            humanCount = row.humanCount,
            gapMs = gap,
            score = closenessBucket(gap.toDouble() / above.bestMs) +
                difficultyPenalty(row.trackId, row.mode, above.bestMs),
            upside = if (above.rank == 1) 3 else if (above.rank <= 3) 2 else 0,
        )
    }
    return focusSet(candidates, effectiveBests)
}

internal fun buildAndroidRivalFocus(
    ownPlayerId: String,
    rivals: List<AndroidRivalComparison>,
    bests: AndroidTrackBestsDocument?,
): AndroidFocusSet {
    val grouped = bests?.players?.associate { it.playerId to it.bests }.orEmpty()
    val mine = grouped[ownPlayerId].orEmpty()
    val candidates = mine.flatMap { own ->
        rivals.mapNotNull { rival ->
            val target = grouped[rival.playerId]?.firstOrNull {
                it.trackId == own.trackId && it.mode == own.mode
            } ?: return@mapNotNull null
            val gap = own.totalTimeMs - target.totalTimeMs
            if (gap <= 0) return@mapNotNull null
            val passed = rivals.count { other ->
                grouped[other.playerId]?.firstOrNull {
                    it.trackId == own.trackId && it.mode == own.mode
                }?.totalTimeMs?.let { it in target.totalTimeMs until own.totalTimeMs } == true
            }
            FocusCandidate(
                trackId = own.trackId,
                mode = own.mode,
                myBestMs = own.totalTimeMs,
                targetMs = target.totalTimeMs,
                targetName = rival.displayName,
                targetRank = target.rank,
                myRank = own.rank,
                humanCount = maxOf(own.rank, target.rank),
                gapMs = gap,
                score = closenessBucket(gap.toDouble() / target.totalTimeMs) +
                    difficultyPenalty(own.trackId, own.mode, target.totalTimeMs),
                upside = passed * 2,
            )
        }
    }
    return focusSet(candidates, mine)
}

private fun focusSet(
    candidates: List<FocusCandidate>,
    ownBests: List<AndroidTrackBest>,
): AndroidFocusSet {
    val lowestMastery = lowestMasteryCard(ownBests)
    if (candidates.isEmpty()) {
        val fallback = lowestMastery ?: if (ownBests.isEmpty()) {
            AndroidFocusCard(
                AndroidFocusKind.LOWEST_MASTERY,
                "track.mario_kart_stadium",
                150,
                "Set your first time",
                null,
                "Every rivalry starts with a first lap.",
                null,
                null,
            )
        } else null
        return AndroidFocusSet(fallback, null, null)
    }
    val stable = compareBy<FocusCandidate>({ it.trackId }, { it.mode }, { it.targetName })
    val closest = candidates.sortedWith(compareBy<FocusCandidate> { it.gapMs }.then(stable)).first()
    val biggest = candidates.sortedWith(compareByDescending<FocusCandidate> { it.gapMs }.then(stable)).first()
    return AndroidFocusSet(
        lowestMastery,
        closest.card(AndroidFocusKind.CLOSEST_BATTLE),
        biggest.card(AndroidFocusKind.BIGGEST_GAP),
    )
}

private fun lowestMasteryCard(ownBests: List<AndroidTrackBest>): AndroidFocusCard? {
    val weakest = ownBests.mapNotNull { best ->
        val tier = AndroidMasteryThresholds.trackTier(best.trackId, best.mode, best.totalTimeMs)
            ?: return@mapNotNull null
        val ladder = AndroidMasteryThresholds.trackLadder(best.trackId, best.mode)
            ?: return@mapNotNull null
        val nextGap = if (tier > 0) {
            (best.totalTimeMs - ladder[tier - 1]).coerceAtLeast(0L)
        } else 0L
        Triple(best, tier, nextGap)
    }.sortedWith(
        compareByDescending<Triple<AndroidTrackBest, Int, Long>> { it.second }
            .thenByDescending { it.third }
            .thenBy { it.first.trackId }
            .thenBy { it.first.mode },
    ).firstOrNull() ?: return null
    val (best, tier, nextGap) = weakest
    val current = AndroidMasteryThresholds.tierLabels[tier]
    val context = if (tier == 0) {
        "This is already your strongest possible Mastery tier."
    } else {
        "Improve by ${formatAndroidGap(nextGap)} to reach ${AndroidMasteryThresholds.tierLabels[tier - 1]}."
    }
    return AndroidFocusCard(
        kind = AndroidFocusKind.LOWEST_MASTERY,
        trackId = best.trackId,
        mode = best.mode,
        headline = "Your lowest Mastery: $current",
        gapMs = null,
        context = context,
        myBestMs = best.totalTimeMs,
        targetMs = null,
        masteryTier = tier,
    )
}

internal fun formatAndroidGap(milliseconds: Long): String {
    val absolute = kotlin.math.abs(milliseconds).coerceAtMost(599_999L)
    return String.format(
        Locale.ROOT,
        "%d:%02d.%03d",
        absolute / 60_000,
        absolute % 60_000 / 1_000,
        absolute % 1_000,
    )
}
