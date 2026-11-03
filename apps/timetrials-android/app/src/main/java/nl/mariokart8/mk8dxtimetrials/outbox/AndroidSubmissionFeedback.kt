package nl.mariokart8.mk8dxtimetrials.outbox

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * What the site answered when a saved result reached it: better or worse than
 * the Player's own best and by how much, where it puts them, and whom they
 * passed - rivals first. The block only exists when this build asked for it
 * (`?feedback=v1`); it is presentation, so a malformed one is dropped and the
 * publication stands.
 */
internal data class AndroidSubmissionFeedbackPassedPlayer(
    val playerId: String,
    val username: String,
    val displayName: String,
    val bestMs: Long,
    val rival: Boolean,
)

internal data class AndroidSubmissionFeedbackLap(val lapNumber: Int, val timeMs: Long)

internal data class AndroidSubmissionFeedback(
    val trackId: String,
    val modeCc: Int,
    val totalTimeMs: Long,
    val previousBestMs: Long?,
    val deltaMs: Long?,
    val improved: Boolean,
    /** The previous best's laps (feedback v2), for a gap per lap. */
    val previousLaps: List<AndroidSubmissionFeedbackLap> = emptyList(),
    val rankAfter: Long,
    val rankBefore: Long?,
    val passed: List<AndroidSubmissionFeedbackPassedPlayer>,
    val passedCount: Long,
    val rivalsPassed: Long,
) {
    /** The headline: the time against the Player's own best. */
    fun personalBestText(language: AndroidProductLanguage): String {
        val time = androidFeedbackTime(totalTimeMs)
        val previous = previousBestMs
        val delta = deltaMs
        return when {
            previous == null || delta == null -> androidText(
                language,
                "First time on this track in ${modeCc}cc: $time.",
                "Eerste tijd op dit circuit in ${modeCc}cc: $time.",
            )
            delta == 0L -> androidText(
                language,
                "$time matches your personal best. This run is now your current PB with its added details.",
                "$time evenaart je persoonlijk record. Deze run is nu je actuele PR met de toegevoegde details.",
            )
            improved -> androidText(
                language,
                "New personal best: $time, ${androidFeedbackDelta(delta)} faster than your ${androidFeedbackTime(previous)}.",
                "Nieuw persoonlijk record: $time, ${androidFeedbackDelta(delta)} sneller dan je ${androidFeedbackTime(previous)}.",
            )
            else -> androidText(
                language,
                "$time, ${androidFeedbackDelta(delta)} behind your best of ${androidFeedbackTime(previous)}.",
                "$time, ${androidFeedbackDelta(delta)} achter je beste tijd van ${androidFeedbackTime(previous)}.",
            )
        }
    }

    fun rankText(language: AndroidProductLanguage): String {
        val before = rankBefore
        return when {
            before == null -> androidText(
                language,
                "You enter the leaderboard at #$rankAfter.",
                "Je komt het klassement binnen op #$rankAfter.",
            )
            rankAfter < before -> androidText(
                language,
                "Now #$rankAfter on the leaderboard, up from #$before.",
                "Nu #$rankAfter op het klassement, omhoog van #$before.",
            )
            else -> androidText(
                language,
                "You stay #$rankAfter on the leaderboard.",
                "Je blijft #$rankAfter op het klassement.",
            )
        }
    }

    /** Null when nobody was passed. */
    fun passedText(language: AndroidProductLanguage): String? {
        if (passedCount <= 0L) return null
        val names = passed.joinToString(", ") { player ->
            if (player.rival) {
                androidText(language, "${player.displayName} (rival)", "${player.displayName} (rivaal)")
            } else {
                player.displayName
            }
        }
        val remaining = passedCount - passed.size
        val tail = if (remaining > 0) {
            androidText(language, " and $remaining more", " en nog $remaining")
        } else {
            ""
        }
        val lead = when {
            rivalsPassed > 0 && passedCount == 1L ->
                androidText(language, "Passed a rival: ", "Ingehaald (een rivaal): ")
            rivalsPassed > 0 -> androidText(
                language,
                "Passed $passedCount players, $rivalsPassed of them rivals: ",
                "Ingehaald ($passedCount spelers, $rivalsPassed rivalen): ",
            )
            passedCount == 1L -> androidText(language, "Passed 1 player: ", "Ingehaald (1 speler): ")
            else -> androidText(language, "Passed $passedCount players: ", "Ingehaald ($passedCount spelers): ")
        }
        return "$lead$names$tail."
    }

    fun lines(language: AndroidProductLanguage): List<String> =
        listOfNotNull(personalBestText(language), rankText(language), passedText(language))
}

internal fun androidFeedbackTime(value: Long): String = "%d:%02d.%03d".format(
    value / 60_000,
    value % 60_000 / 1_000,
    value % 1_000,
)

internal fun androidFeedbackDelta(value: Long): String {
    val magnitude = kotlin.math.abs(value)
    return if (magnitude < 60_000) {
        "%d.%03ds".format(magnitude / 1_000, magnitude % 1_000)
    } else {
        androidFeedbackTime(magnitude)
    }
}

private val feedbackUsernamePattern = Regex("^[a-z0-9_-]{1,64}$")

private fun JsonObject.longField(name: String): Long? =
    (this[name] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull

private fun JsonObject.nullableLongField(name: String): Pair<Boolean, Long?> {
    val element = this[name] ?: return false to null
    if (element is JsonNull) return true to null
    val value = (element as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull
        ?: return false to null
    return true to value
}

private fun JsonObject.stringField(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

private fun JsonObject.booleanField(name: String): Boolean? =
    (this[name] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull

/** Strict shape check; anything off returns null so the block is dropped. */
internal fun androidSubmissionFeedbackOrNull(element: Any?): AndroidSubmissionFeedback? {
    val root = element as? JsonObject ?: return null
    if (root.keys != setOf("trackId", "modeCc", "totalTimeMs", "personalBest", "rank")) return null
    val trackId = root.stringField("trackId")?.takeIf { it.length in 1..128 } ?: return null
    val modeCc = root.longField("modeCc")?.toInt()?.takeIf { it == 150 || it == 200 } ?: return null
    val totalTimeMs = root.longField("totalTimeMs")?.takeIf { it >= 0 } ?: return null
    val personalBest = root["personalBest"] as? JsonObject ?: return null
    if (personalBest.keys - setOf("previousLaps") != setOf("previousBestMs", "deltaMs", "improved")) return null
    val previousLaps = (personalBest["previousLaps"] as? JsonArray)?.map { entry ->
        val lap = entry as? JsonObject ?: return null
        if (lap.keys != setOf("lapNumber", "timeMs")) return null
        AndroidSubmissionFeedbackLap(
            lapNumber = lap.longField("lapNumber")?.toInt()?.takeIf { it >= 1 } ?: return null,
            timeMs = lap.longField("timeMs")?.takeIf { it >= 0 } ?: return null,
        )
    } ?: emptyList()
    if (previousLaps.size > 7) return null
    val (previousOk, previousBestMs) = personalBest.nullableLongField("previousBestMs")
    val (deltaOk, deltaMs) = personalBest.nullableLongField("deltaMs")
    val improved = personalBest.booleanField("improved")
    if (!previousOk || !deltaOk || improved == null || (previousBestMs != null && previousBestMs < 0)) return null
    val rank = root["rank"] as? JsonObject ?: return null
    if (rank.keys != setOf("after", "before", "passed", "passedCount", "rivalsPassed")) return null
    val rankAfter = rank.longField("after")?.takeIf { it >= 1 } ?: return null
    val (beforeOk, rankBefore) = rank.nullableLongField("before")
    if (!beforeOk || (rankBefore != null && rankBefore < 1)) return null
    val passedCount = rank.longField("passedCount")?.takeIf { it >= 0 } ?: return null
    val rivalsPassed = rank.longField("rivalsPassed")?.takeIf { it >= 0 } ?: return null
    val passedArray = rank["passed"] as? JsonArray ?: return null
    if (passedArray.size > 5) return null
    val passed = passedArray.map { entry ->
        val player = entry as? JsonObject ?: return null
        if (player.keys != setOf("playerId", "username", "displayName", "bestMs", "rival")) return null
        AndroidSubmissionFeedbackPassedPlayer(
            playerId = player.stringField("playerId")?.takeIf { it.length in 8..135 } ?: return null,
            username = player.stringField("username")?.takeIf { feedbackUsernamePattern.matches(it) } ?: return null,
            displayName = player.stringField("displayName")?.takeIf { it.length in 1..128 } ?: return null,
            bestMs = player.longField("bestMs")?.takeIf { it >= 0 } ?: return null,
            rival = player.booleanField("rival") ?: return null,
        )
    }
    return AndroidSubmissionFeedback(
        trackId = trackId,
        modeCc = modeCc,
        totalTimeMs = totalTimeMs,
        previousBestMs = previousBestMs,
        deltaMs = deltaMs,
        improved = improved,
        previousLaps = previousLaps,
        rankAfter = rankAfter,
        rankBefore = rankBefore,
        passed = passed,
        passedCount = passedCount,
        rivalsPassed = rivalsPassed,
    )
}
