package nl.mariokart8.mk8dxtimetrials.manual

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private const val MAX_EPOCH_MILLISECONDS = 253_402_300_799_999L

private val submissionIdPattern =
    Regex("^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")
private val trackIdPattern = Regex("^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$")
private val countryIdPattern = Regex("^country\\.[a-z]{2}$")
private val playerIdPattern = Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")

internal enum class AndroidManualSubmissionErrorCode {
    INVALID_SUBMISSION_ID,
    INVALID_REVISION,
    INVALID_MODE,
    INVALID_TRACK,
    INVALID_TIME,
    INVALID_PLAYER_REFERENCE,
    INVALID_COUNTRY,
    INVALID_OBSERVED_NAME,
    INVALID_TIMESTAMPS,
    INVALID_SOURCE,
}

internal class AndroidManualSubmissionException(
    val code: AndroidManualSubmissionErrorCode,
) : IllegalArgumentException("Android manual Time Trial input is invalid.")

@Serializable
internal data class ManualPlayerReferenceV1(
    val namespace: String,
    val value: String,
)

internal data class AndroidManualSubmissionContext(
    val submissionId: String,
    val revision: Int,
    val trackId: String,
    val playerReference: ManualPlayerReferenceV1,
    val countryId: String? = null,
    val observedPlayerName: String? = null,
    val occurredAtMs: Long? = null,
    val createdAtMs: Long,
    val producerVersion: String,
    val localRecordId: String? = null,
)

@Serializable
internal data class ManualLapV1(
    val lapNumber: Int,
    val timeMs: Long,
    val coinsCollected: Int? = null,
    val mushroomsUsed: Int? = null,
)

@Serializable
internal data class ManualLoadoutV1(
    val characterId: String? = null,
    val bodyId: String? = null,
    val tireId: String? = null,
    val gliderId: String? = null,
)

@Serializable
internal data class AndroidManualSourceV1(
    val kind: String = "android_manual",
    val producerVersion: String,
    val localRecordId: String? = null,
)

@Serializable
internal data class ManualTimestampsV1(
    val occurredAtMs: Long? = null,
    val createdAtMs: Long,
)

@Serializable
internal data class AndroidManualTimeTrialSubmissionV1(
    val schemaVersion: String = "mk8dx.time-trial-submission.v1",
    val submissionId: String,
    val revision: Int,
    val mode: Int,
    val trackId: String,
    val totalTimeMs: Long,
    val laps: List<ManualLapV1> = emptyList(),
    val loadout: ManualLoadoutV1? = null,
    val countryId: String? = null,
    val playerReference: ManualPlayerReferenceV1,
    val observedPlayerName: String? = null,
    val source: AndroidManualSourceV1,
    val timestamps: ManualTimestampsV1,
)

private val canonicalJson = Json {
    encodeDefaults = true
    explicitNulls = false
}

private fun fail(code: AndroidManualSubmissionErrorCode): Nothing =
    throw AndroidManualSubmissionException(code)

private fun String.hasCodePointLength(minimum: Int, maximum: Int): Boolean {
    val count = codePointCount(0, length)
    return count in minimum..maximum
}

internal fun parseAndroidManualTimeDigits(value: String): Long {
    if (!value.matches(Regex("^[0-9]{6}$"))) {
        fail(AndroidManualSubmissionErrorCode.INVALID_TIME)
    }
    val minutes = value.substring(0, 1).toLong()
    val seconds = value.substring(1, 3).toLong()
    val milliseconds = value.substring(3, 6).toLong()
    val total = minutes * 60_000 + seconds * 1_000 + milliseconds
    if (seconds > 59 || total !in 1..599_999) {
        fail(AndroidManualSubmissionErrorCode.INVALID_TIME)
    }
    return total
}

private fun validPlayerReference(reference: ManualPlayerReferenceV1): Boolean =
    when (reference.namespace) {
        "player" -> reference.value.length <= 135 &&
            reference.value.matches(playerIdPattern)
        "legacy_firebase_user", "producer_local_profile", "unresolved_observation" ->
            reference.value.hasCodePointLength(1, 128)
        else -> false
    }

internal fun createAndroidManualSubmission(
    context: AndroidManualSubmissionContext,
    mode: Int,
    timeDigits: String,
): AndroidManualTimeTrialSubmissionV1 {
    if (!context.submissionId.matches(submissionIdPattern)) {
        fail(AndroidManualSubmissionErrorCode.INVALID_SUBMISSION_ID)
    }
    if (context.revision < 1) {
        fail(AndroidManualSubmissionErrorCode.INVALID_REVISION)
    }
    if (mode != 150 && mode != 200) {
        fail(AndroidManualSubmissionErrorCode.INVALID_MODE)
    }
    if (context.trackId.length > 255 || !context.trackId.matches(trackIdPattern)) {
        fail(AndroidManualSubmissionErrorCode.INVALID_TRACK)
    }
    val totalTimeMs = parseAndroidManualTimeDigits(timeDigits)
    if (!validPlayerReference(context.playerReference)) {
        fail(AndroidManualSubmissionErrorCode.INVALID_PLAYER_REFERENCE)
    }
    if (context.countryId != null && !context.countryId.matches(countryIdPattern)) {
        fail(AndroidManualSubmissionErrorCode.INVALID_COUNTRY)
    }
    if (context.observedPlayerName != null &&
        !context.observedPlayerName.hasCodePointLength(1, 64)
    ) {
        fail(AndroidManualSubmissionErrorCode.INVALID_OBSERVED_NAME)
    }
    if (context.createdAtMs !in 0..MAX_EPOCH_MILLISECONDS ||
        (context.occurredAtMs != null &&
            context.occurredAtMs !in 0..MAX_EPOCH_MILLISECONDS)
    ) {
        fail(AndroidManualSubmissionErrorCode.INVALID_TIMESTAMPS)
    }
    if (!context.producerVersion.hasCodePointLength(1, 64) ||
        (context.localRecordId != null &&
            !context.localRecordId.hasCodePointLength(1, 128))
    ) {
        fail(AndroidManualSubmissionErrorCode.INVALID_SOURCE)
    }

    return AndroidManualTimeTrialSubmissionV1(
        submissionId = context.submissionId,
        revision = context.revision,
        mode = mode,
        trackId = context.trackId,
        totalTimeMs = totalTimeMs,
        countryId = context.countryId,
        playerReference = context.playerReference.copy(),
        observedPlayerName = context.observedPlayerName,
        source = AndroidManualSourceV1(
            producerVersion = context.producerVersion,
            localRecordId = context.localRecordId,
        ),
        timestamps = ManualTimestampsV1(
            occurredAtMs = context.occurredAtMs,
            createdAtMs = context.createdAtMs,
        ),
    )
}

internal fun encodeAndroidManualSubmission(
    submission: AndroidManualTimeTrialSubmissionV1,
): String = canonicalJson.encodeToString(submission)
