package nl.mariokart8.mk8dxtimetrials.carry

import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSourceV1
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.manual.ManualLapV1
import nl.mariokart8.mk8dxtimetrials.manual.ManualLoadoutV1
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.manual.ManualTimestampsV1
import nl.mariokart8.mk8dxtimetrials.manual.encodeAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.offline.AndroidOfflineCopy
import nl.mariokart8.mk8dxtimetrials.offline.AndroidOfflineRun

private val opaqueIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")

/** Where a run of the copy comes from: the community it was driven for, unless it was carried there itself. */
internal fun androidCarriedFromOf(run: AndroidOfflineRun, sourceOrigin: String, sourceName: String?): AndroidCarriedFromV1 =
    run.carriedFrom ?: AndroidCarriedFromV1(
        origin = sourceOrigin,
        communityName = sourceName?.trim()?.take(80)?.takeIf { it.isNotEmpty() },
        originalSubmissionId = run.submissionId,
        originalSubmittedAtMs = run.createdAtMs,
    )

/**
 * A run of the copy as a carried submission without its Player (ADR-0225 amendment 2). The copy holds what the
 * community holds, so a time entered on the website or before this install can be carried as well; it travels
 * as a manual Android submission with its laps (coins, mushrooms) and build, driven when it was entered there.
 */
internal fun androidStagedFromCopiedRun(
    run: AndroidOfflineRun,
    carriedFrom: AndroidCarriedFromV1,
    newOpaqueId: String,
    nowMs: Long,
): JsonObject {
    require(newOpaqueId.matches(opaqueIdPattern) && run.active)
    val laps = if (run.laps.size == 3 || run.laps.size == 7) run.laps.mapIndexed { index, timeMs ->
        val counts = run.lapDetails?.getOrNull(index)
        ManualLapV1(index + 1, timeMs, counts?.coinsCollected, counts?.mushroomsUsed)
    } else emptyList()
    val loadout = run.loadout?.let {
        ManualLoadoutV1(it["characterId"], it["bodyId"], it["tireId"], it["gliderId"])
    }?.takeIf { it.characterId != null || it.bodyId != null || it.tireId != null || it.gliderId != null }
    val submission = AndroidManualTimeTrialSubmissionV1(
        submissionId = "user_submission.time.$newOpaqueId",
        revision = 1,
        mode = run.mode,
        trackId = run.trackId,
        totalTimeMs = run.totalTimeMs,
        laps = laps,
        loadout = loadout,
        playerReference = ManualPlayerReferenceV1("player", "player.placeholder"),
        source = AndroidManualSourceV1(producerVersion = "timetrials-android-v1"),
        timestamps = ManualTimestampsV1(occurredAtMs = run.createdAtMs, createdAtMs = nowMs),
        carriedFrom = carriedFrom,
    )
    val staged = JsonObject(
        Json.parseToJsonElement(encodeAndroidManualSubmission(submission)).jsonObject - "playerReference",
    )
    // The same check a completed copy passes before it may enter an outbox.
    androidCompletedCarriedSubmission(staged, "player.placeholder")
    return staged
}

internal sealed interface AndroidCopiedCarryOutcome {
    data class Queued(val queued: Int, val alreadyCarried: Int, val review: Boolean) : AndroidCopiedCarryOutcome
    data object Refused : AndroidCopiedCarryOutcome
    data object Unreachable : AndroidCopiedCarryOutcome
}

/**
 * Queues copies of [runs] for [targetOrigin] after asking the target (with its own trust) whether it takes
 * carried times. A run already waiting for or sent to the target is counted, not queued again.
 */
internal fun carryAndroidCopiedRuns(
    runs: List<AndroidOfflineRun>,
    sourceOrigin: String,
    sourceName: String?,
    targetOrigin: String,
    readPolicy: () -> AndroidCarriedTimesPolicy,
    queue: AndroidCarriedQueue,
    targetSubmissions: () -> List<JsonObject>,
    nowMs: Long,
    newOpaqueId: () -> String = { UUID.randomUUID().toString() },
): AndroidCopiedCarryOutcome {
    val policy = try {
        readPolicy()
    } catch (_: Exception) {
        return AndroidCopiedCarryOutcome.Unreachable
    }
    if (policy == AndroidCarriedTimesPolicy.OFF) return AndroidCopiedCarryOutcome.Refused
    val known = (queue.list() + targetSubmissions()).mapNotNull { it.carriedFromOrNull() }
        .map { it.origin to it.originalSubmissionId }.toMutableSet()
    var queued = 0
    var already = 0
    runs.filter { it.active && targetOrigin != sourceOrigin }.forEach { run ->
        val from = androidCarriedFromOf(run, sourceOrigin, sourceName)
        if (from.origin == targetOrigin || !known.add(from.origin to from.originalSubmissionId)) {
            already++
            return@forEach
        }
        val staged = runCatching { androidStagedFromCopiedRun(run, from, newOpaqueId(), nowMs) }.getOrNull()
            ?: return@forEach
        runCatching { queue.add(staged) }.onSuccess { queued++ }
    }
    return AndroidCopiedCarryOutcome.Queued(queued, already, policy == AndroidCarriedTimesPolicy.REVIEW)
}

/** "Carry my best times": what goes, and what stays because the target already has a better time. */
internal data class AndroidBestTimesPlan(
    val toCarry: List<AndroidOfflineRun>,
    val skipped: List<AndroidOfflineRun>,
)

/**
 * The best time per track and class from the source copy. A track and class where the target's own copy holds
 * a strictly better time is skipped; an equal time is sent, because the target then fills in what it lacks
 * (laps, build) without a second run (coordinator 2026-11-12: equal is not skipped).
 */
internal fun planAndroidBestTimes(source: AndroidOfflineCopy, target: AndroidOfflineCopy): AndroidBestTimesPlan {
    val targetBests = target.personalBests().associate { (it.trackId to it.mode) to it.totalTimeMs }
    val (skipped, toCarry) = source.personalBests().partition { best ->
        val there = targetBests[best.trackId to best.mode]
        there != null && there < best.totalTimeMs
    }
    val order = compareBy<AndroidOfflineRun>({ it.mode }, { it.trackId })
    return AndroidBestTimesPlan(toCarry.sortedWith(order), skipped.sortedWith(order))
}
