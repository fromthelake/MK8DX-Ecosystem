package nl.mariokart8.mk8dxtimetrials.posttime

import java.net.URI
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedLapCounts
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedTimeTrial
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialCorrection
import nl.mariokart8.mk8dxtimetrials.rules.ValidatedPayload

// Manage a published result in the form of Post a Time (ADR-0211), as the Web's time-trial-management
// does: the form is filled from the result, the track and engine class stay fixed, and saving sends
// only what the Player changed, with the reason why.

/** The lifecycle's reason codes, in the order the Web offers them. */
internal val ANDROID_TIME_TRIAL_REASON_CODES = listOf(
    "incorrect_time", "wrong_track_or_mode", "duplicate", "test_result", "invalid_result", "other",
)

internal fun androidReasonLabel(code: String, dutch: Boolean): String = when (code) {
    "incorrect_time" -> if (dutch) "Een waarde klopte niet" else "A value was wrong"
    "wrong_track_or_mode" -> if (dutch) "Verkeerd circuit of verkeerde klasse" else "Wrong track or engine class"
    "duplicate" -> if (dutch) "Het is een dubbele" else "It is a duplicate"
    "test_result" -> if (dutch) "Het was een test" else "It was a test"
    "invalid_result" -> if (dutch) "Het resultaat is niet geldig" else "The result is not valid"
    else -> if (dutch) "Iets anders" else "Something else"
}

/** "145912" for 1:45.912. */
internal fun androidTimeMsToDigits(timeMs: Long): String {
    val minutes = timeMs / 60_000
    val seconds = (timeMs % 60_000) / 1_000
    val millis = timeMs % 1_000
    return "$minutes${seconds.toString().padStart(2, '0')}${millis.toString().padStart(3, '0')}"
}

/**
 * The Post a Time draft of a published result: its total and laps as digits, each lap's coin
 * balance turned back into the change during that lap, its mushrooms and its kart setup.
 */
internal fun androidEditDraftOf(result: AndroidManagedTimeTrial, lapCount: Int): AndroidPostTimeDraft {
    val current = result.current
    val base = createAndroidPostTimeDraft(current.trackId, current.modeCc, lapCount)
    var previous: Int? = 0
    val laps = base.laps.mapIndexed { index, blank ->
        val timeMs = current.laps.getOrNull(index)
        val counts = current.lapDetails?.getOrNull(index)
        val balance = counts?.coinsCollected
        val change = if (balance == null) {
            previous = null
            null
        } else {
            val before = previous
            previous = balance
            before?.let { balance - it }
        }
        if (timeMs == null) {
            blank
        } else {
            AndroidPostTimeLap(androidTimeMsToDigits(timeMs), change, counts?.mushroomsUsed)
        }
    }
    val loadout = current.loadout.orEmpty()
    return base.copy(
        totalDigits = androidTimeMsToDigits(current.totalTimeMs),
        laps = laps,
        loadout = ANDROID_LOADOUT_PART_KEYS.associateWith { loadout[it] },
    )
}

/**
 * The correction a saved edit sends, or null when nothing about the result changed. The laps'
 * coins and mushrooms travel only when one of them changed, the kart setup only when it did, so
 * an untouched part keeps what it recorded (a colour variant, the counts).
 */
internal fun androidCorrectionOf(
    original: AndroidPostTimeDraft,
    edited: AndroidPostTimeDraft,
    payload: ValidatedPayload,
    reasonCode: String,
    note: String? = null,
): AndroidTimeTrialCorrection? {
    val timesChanged = original.totalDigits != edited.totalDigits ||
        original.laps.map { it.timeDigits } != edited.laps.map { it.timeDigits }
    val countsChanged = original.laps.map { it.coinChange to it.mushroomsUsed } !=
        edited.laps.map { it.coinChange to it.mushroomsUsed }
    val setupChanged = ANDROID_LOADOUT_PART_KEYS.any { original.loadout[it] != edited.loadout[it] }
    if (!timesChanged && !countsChanged && !setupChanged) return null
    return AndroidTimeTrialCorrection(
        totalTimeMs = payload.totalTimeMs.toLong(),
        laps = payload.laps.map { it.timeMs.toLong() },
        lapDetails = if (countsChanged) {
            payload.laps.map { AndroidManagedLapCounts(it.coinsCollected, it.mushroomsUsed) }
        } else {
            null
        },
        loadout = if (setupChanged) payload.loadout.orEmpty() else null,
        reasonCode = reasonCode,
        note = note?.trim()?.takeIf { it.isNotEmpty() }?.take(256),
    )
}

private val YOUTUBE_ID = Regex("^[A-Za-z0-9_-]{11}$")
private val YOUTUBE_HOSTS = setOf("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be")

/** The video id of a YouTube link, or null: the Web's and the API's rule (youtube-link.ts). */
internal fun androidYouTubeVideoId(value: String): String? {
    val text = value.trim()
    if (text.isEmpty() || text.length > 512) return null
    val uri = runCatching {
        URI(if (Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:").containsMatchIn(text)) text else "https://$text")
    }.getOrNull() ?: return null
    if ((uri.scheme?.lowercase() != "https" && uri.scheme?.lowercase() != "http") || uri.rawUserInfo != null) return null
    val host = uri.host?.lowercase() ?: return null
    if (host !in YOUTUBE_HOSTS) return null
    val segments = uri.path.orEmpty().split('/').filter { it.isNotEmpty() }
    val id = when {
        host.endsWith("youtu.be") -> segments.singleOrNull()
        segments == listOf("watch") -> uri.rawQuery.orEmpty().split('&')
            .firstOrNull { it.startsWith("v=") }?.removePrefix("v=")
        segments.size == 2 && segments[0] in setOf("shorts", "live", "embed", "v") -> segments[1]
        else -> null
    }
    return id?.takeIf { YOUTUBE_ID.matches(it) }
}

/** "" (no video) is fine; anything else must be a YouTube link. */
internal fun androidVideoLinkProblem(value: String, dutch: Boolean): String? =
    if (value.isBlank() || androidYouTubeVideoId(value) != null) {
        null
    } else if (dutch) {
        "Plak een link naar de YouTube-video, bijvoorbeeld https://youtu.be/…"
    } else {
        "Paste a link to the YouTube video, for example https://youtu.be/…"
    }

/** The one form of a video link the site stores and shows. */
internal fun androidYouTubeWatchUrl(value: String): String? =
    androidYouTubeVideoId(value)?.let { "https://www.youtube.com/watch?v=$it" }

/** What a Manage edit needs from its caller: the result, and how to save a correction and a video. */
internal class AndroidPostTimeEdit(
    val result: AndroidManagedTimeTrial,
    /** Returns null when saved, or the sentence to show. */
    val saveCorrection: suspend (AndroidTimeTrialCorrection) -> String?,
    /** Returns null when saved, or the sentence to show; the argument null removes the video. */
    val saveVideo: suspend (String?) -> String?,
    val onClose: (saved: Boolean) -> Unit,
    /**
     * Withdraws the result with a reason (owner 2026-09-29: behind the edit screen, confirmed by a
     * swipe). Returns null when withdrawn, or the sentence to show.
     */
    val withdraw: (suspend (String) -> String?)? = null,
)

/** Why a result is withdrawn: the reasons My results offered, in the Player's words. */
internal val ANDROID_WITHDRAW_REASON_CODES = listOf("wrong_track_or_mode", "incorrect_time", "duplicate", "other")

internal fun androidWithdrawReasonLabel(code: String, dutch: Boolean): String = when (code) {
    "wrong_track_or_mode" -> if (dutch) "Verkeerd circuit of cc" else "Wrong track or cc"
    "incorrect_time" -> if (dutch) "Onjuiste tijd" else "Incorrect time"
    "duplicate" -> if (dutch) "Dubbel resultaat" else "Duplicate"
    else -> if (dutch) "Andere reden" else "Other reason"
}
