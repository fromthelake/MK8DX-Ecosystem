package nl.mariokart8.mk8dxtimetrials.scan

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private const val MAX_EPOCH_MILLISECONDS = 253_402_300_799_999L
private val submissionIdPattern =
    Regex("^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")
private val trackIdPattern = Regex("^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$")
private val playerIdPattern = Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")
private val characterIdPattern = Regex("^character\\.[a-z0-9]+(?:_[a-z0-9]+)*$")
private val characterVariantIdPattern =
    Regex("^character_variant\\.[a-z0-9]+(?:_[a-z0-9]+)*\\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$")
private val bodyIdPattern = Regex("^body\\.[a-z0-9]+(?:_[a-z0-9]+)*$")
private val bodyVariantIdPattern =
    Regex("^body_variant\\.[a-z0-9]+(?:_[a-z0-9]+)*\\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$")
private val tireIdPattern = Regex("^tire\\.[a-z0-9]+(?:_[a-z0-9]+)*$")
private val gliderIdPattern = Regex("^glider\\.[a-z0-9]+(?:_[a-z0-9]+)*$")
private val gliderVariantIdPattern =
    Regex("^glider_variant\\.[a-z0-9]+(?:_[a-z0-9]+)*\\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$")
private val countryIdPattern = Regex("^country\\.[a-z]{2}$")
private val sha256Pattern = Regex("^[a-f0-9]{64}$")
private val mediaTypePattern =
    Regex("^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")
private val scanTimePattern = Regex("^[0-9]:[0-5][0-9]\\.[0-9]{3}$")

internal enum class AndroidScanSubmissionErrorCode {
    INVALID_SUBMISSION_ID,
    INVALID_REVISION,
    INVALID_MODE,
    INVALID_TRACK,
    INVALID_PLAYER_REFERENCE,
    INVALID_TIME_FIELDS,
    LAP_SUM_MISMATCH,
    INVALID_IDENTITY,
    UNKNOWN_LEGACY_ASSET,
    INVALID_NAME,
    INVALID_TIMESTAMPS,
    INVALID_SOURCE,
    INVALID_EVIDENCE,
}

internal class AndroidScanSubmissionException(
    val code: AndroidScanSubmissionErrorCode,
) : IllegalArgumentException("Android scan Time Trial input is invalid.")

internal interface ScanLegacyAssetResolver {
    fun resolveTire(index: Int): String?
    fun resolveCountry(index: Int): String?
}

internal data class ScanStableIdentityObservation(
    val accepted: Boolean,
    val assetId: String? = null,
    val familyId: String? = null,
    val score: Double? = null,
)

internal data class ScanLegacyIdentityObservation(
    val accepted: Boolean,
    val index: Int? = null,
    val score: Double? = null,
)

internal data class AcceptedPlayerScanObservation(
    val totalTime: String,
    val lapTimes: List<String>,
    val lapSumAccepted: Boolean,
    val character: ScanStableIdentityObservation? = null,
    val body: ScanStableIdentityObservation? = null,
    val tire: ScanLegacyIdentityObservation? = null,
    val glider: ScanStableIdentityObservation? = null,
    val country: ScanLegacyIdentityObservation? = null,
    val observedPlayerName: String? = null,
    val capturedAtMs: Long,
)

@Serializable
internal data class ScanPlayerReferenceV1(val namespace: String, val value: String)

internal data class AndroidScanSubmissionContext(
    val submissionId: String,
    val revision: Int,
    val mode: Int,
    val trackId: String,
    val playerReference: ScanPlayerReferenceV1,
    val createdAtMs: Long,
    val producerVersion: String,
    val localRecordId: String? = null,
    val scanResultReference: String? = null,
    val scanResultSha256: String? = null,
    val scanResultMediaType: String? = null,
)

@Serializable
internal data class ScanLapV1(
    val lapNumber: Int,
    val timeMs: Long,
    val coinsCollected: Int? = null,
    val mushroomsUsed: Int? = null,
)

@Serializable
internal data class ScanLoadoutV1(
    val characterId: String? = null,
    val characterVariantId: String? = null,
    val bodyId: String? = null,
    val bodyVariantId: String? = null,
    val tireId: String? = null,
    val gliderId: String? = null,
    val gliderVariantId: String? = null,
)

@Serializable
internal data class ScanSourceV1(
    val kind: String = "android_scan",
    val captureLayout: String = "time_trial_result",
    val producerVersion: String,
    val localRecordId: String? = null,
)

@Serializable
internal data class ScanTimestampsV1(val capturedAtMs: Long, val createdAtMs: Long)

@Serializable
internal data class ScanEvidenceV1(
    val kind: String = "scan_result",
    val reference: String,
    val sha256: String? = null,
    val mediaType: String? = null,
)

@Serializable
internal data class ScanFieldConfidenceV1(
    val character: Double? = null,
    val characterVariant: Double? = null,
    val body: Double? = null,
    val tire: Double? = null,
    val glider: Double? = null,
    val country: Double? = null,
)

@Serializable
internal data class ScanVerificationV1(
    val status: String = "producer_check_passed",
    val method: String = "tt_scan_lap_sum_v1",
    val lapSumMatches: Boolean = true,
    val fieldConfidence: ScanFieldConfidenceV1? = null,
    val correctedFields: List<String>? = null,
)

@Serializable
internal data class AndroidScanTimeTrialSubmissionV1(
    val schemaVersion: String = "mk8dx.time-trial-submission.v1",
    val submissionId: String,
    val revision: Int,
    val mode: Int,
    val trackId: String,
    val totalTimeMs: Long,
    val laps: List<ScanLapV1>,
    val loadout: ScanLoadoutV1? = null,
    val countryId: String? = null,
    val playerReference: ScanPlayerReferenceV1,
    val observedPlayerName: String? = null,
    val source: ScanSourceV1,
    val timestamps: ScanTimestampsV1,
    val evidence: List<ScanEvidenceV1>? = null,
    val verification: ScanVerificationV1,
)

private val canonicalJson = Json { encodeDefaults = true; explicitNulls = false }

private fun fail(code: AndroidScanSubmissionErrorCode): Nothing =
    throw AndroidScanSubmissionException(code)

private fun String.hasCodePointLength(minimum: Int, maximum: Int): Boolean =
    codePointCount(0, length) in minimum..maximum

private fun parseScanTime(value: String): Long {
    if (!value.matches(scanTimePattern)) fail(AndroidScanSubmissionErrorCode.INVALID_TIME_FIELDS)
    val minutes = value.substring(0, 1).toLong()
    val seconds = value.substring(2, 4).toLong()
    val milliseconds = value.substring(5, 8).toLong()
    val result = minutes * 60_000 + seconds * 1_000 + milliseconds
    if (result !in 1..599_999) fail(AndroidScanSubmissionErrorCode.INVALID_TIME_FIELDS)
    return result
}

private fun validPlayerReference(reference: ScanPlayerReferenceV1): Boolean =
    when (reference.namespace) {
        "player" -> reference.value.length <= 135 && reference.value.matches(playerIdPattern)
        "legacy_firebase_user", "producer_local_profile", "unresolved_observation" ->
            reference.value.hasCodePointLength(1, 128)
        else -> false
    }

private fun validScore(score: Double?): Boolean =
    score == null || (score.isFinite() && score in 0.0..1.0)

private data class StableProjection(
    val baseId: String? = null,
    val variantId: String? = null,
    val confidence: Double? = null,
)

private fun projectStable(
    observation: ScanStableIdentityObservation?,
    basePattern: Regex,
    variantPattern: Regex,
): StableProjection {
    if (observation == null || !observation.accepted) return StableProjection()
    if (!validScore(observation.score)) fail(AndroidScanSubmissionErrorCode.INVALID_IDENTITY)
    val assetId = observation.assetId ?: fail(AndroidScanSubmissionErrorCode.INVALID_IDENTITY)
    return when {
        assetId.matches(basePattern) -> {
            if (observation.familyId != null && observation.familyId != assetId) {
                fail(AndroidScanSubmissionErrorCode.INVALID_IDENTITY)
            }
            StableProjection(baseId = assetId, confidence = observation.score)
        }
        assetId.matches(variantPattern) -> {
            val familyId = observation.familyId
                ?: fail(AndroidScanSubmissionErrorCode.INVALID_IDENTITY)
            if (!familyId.matches(basePattern)) fail(AndroidScanSubmissionErrorCode.INVALID_IDENTITY)
            StableProjection(familyId, assetId, observation.score)
        }
        else -> fail(AndroidScanSubmissionErrorCode.INVALID_IDENTITY)
    }
}

private fun resolveLegacy(
    observation: ScanLegacyIdentityObservation?,
    resolve: (Int) -> String?,
    expectedPattern: Regex,
): Pair<String?, Double?> {
    if (observation == null || !observation.accepted) return null to null
    if (!validScore(observation.score)) fail(AndroidScanSubmissionErrorCode.INVALID_IDENTITY)
    val index = observation.index ?: fail(AndroidScanSubmissionErrorCode.INVALID_IDENTITY)
    if (index < 0) fail(AndroidScanSubmissionErrorCode.INVALID_IDENTITY)
    val id = resolve(index) ?: fail(AndroidScanSubmissionErrorCode.UNKNOWN_LEGACY_ASSET)
    if (!id.matches(expectedPattern)) fail(AndroidScanSubmissionErrorCode.INVALID_IDENTITY)
    return id to observation.score
}

internal fun createAndroidScanSubmission(
    observation: AcceptedPlayerScanObservation,
    context: AndroidScanSubmissionContext,
    assets: ScanLegacyAssetResolver,
): AndroidScanTimeTrialSubmissionV1 {
    if (!context.submissionId.matches(submissionIdPattern)) {
        fail(AndroidScanSubmissionErrorCode.INVALID_SUBMISSION_ID)
    }
    if (context.revision < 1) fail(AndroidScanSubmissionErrorCode.INVALID_REVISION)
    if (context.mode != 150 && context.mode != 200) fail(AndroidScanSubmissionErrorCode.INVALID_MODE)
    if (context.trackId.length > 255 || !context.trackId.matches(trackIdPattern)) {
        fail(AndroidScanSubmissionErrorCode.INVALID_TRACK)
    }
    if (!validPlayerReference(context.playerReference)) {
        fail(AndroidScanSubmissionErrorCode.INVALID_PLAYER_REFERENCE)
    }

    val totalTimeMs = parseScanTime(observation.totalTime)
    if (observation.lapTimes.size != 3 && observation.lapTimes.size != 7) {
        fail(AndroidScanSubmissionErrorCode.INVALID_TIME_FIELDS)
    }
    val laps = observation.lapTimes.mapIndexed { index, value ->
        ScanLapV1(index + 1, parseScanTime(value))
    }
    if (!observation.lapSumAccepted || laps.sumOf { it.timeMs } != totalTimeMs) {
        fail(AndroidScanSubmissionErrorCode.LAP_SUM_MISMATCH)
    }

    val character = projectStable(observation.character, characterIdPattern, characterVariantIdPattern)
    val body = projectStable(observation.body, bodyIdPattern, bodyVariantIdPattern)
    val glider = projectStable(observation.glider, gliderIdPattern, gliderVariantIdPattern)
    val (tireId, tireConfidence) = resolveLegacy(observation.tire, assets::resolveTire, tireIdPattern)
    val (countryId, countryConfidence) = resolveLegacy(
        observation.country,
        assets::resolveCountry,
        countryIdPattern,
    )
    val loadout = ScanLoadoutV1(
        characterId = character.baseId,
        characterVariantId = character.variantId,
        bodyId = body.baseId,
        bodyVariantId = body.variantId,
        tireId = tireId,
        gliderId = glider.baseId,
        gliderVariantId = glider.variantId,
    ).takeIf { value ->
        listOf(
            value.characterId,
            value.characterVariantId,
            value.bodyId,
            value.bodyVariantId,
            value.tireId,
            value.gliderId,
            value.gliderVariantId,
        ).any { it != null }
    }
    val observedName = observation.observedPlayerName
    if (observedName != null && !observedName.hasCodePointLength(1, 64)) {
        fail(AndroidScanSubmissionErrorCode.INVALID_NAME)
    }
    if (observation.capturedAtMs !in 0..MAX_EPOCH_MILLISECONDS ||
        context.createdAtMs !in 0..MAX_EPOCH_MILLISECONDS
    ) {
        fail(AndroidScanSubmissionErrorCode.INVALID_TIMESTAMPS)
    }
    if (!context.producerVersion.hasCodePointLength(1, 64) ||
        (context.localRecordId != null && !context.localRecordId.hasCodePointLength(1, 128))
    ) {
        fail(AndroidScanSubmissionErrorCode.INVALID_SOURCE)
    }
    val evidence = context.scanResultReference?.let { reference ->
        if (!reference.hasCodePointLength(1, 512) ||
            (context.scanResultSha256 != null && !context.scanResultSha256.matches(sha256Pattern)) ||
            (context.scanResultMediaType != null && !context.scanResultMediaType.matches(mediaTypePattern))
        ) {
            fail(AndroidScanSubmissionErrorCode.INVALID_EVIDENCE)
        }
        listOf(
            ScanEvidenceV1(
                reference = reference,
                sha256 = context.scanResultSha256,
                mediaType = context.scanResultMediaType,
            ),
        )
    }
    if (context.scanResultReference == null &&
        (context.scanResultSha256 != null || context.scanResultMediaType != null)
    ) {
        fail(AndroidScanSubmissionErrorCode.INVALID_EVIDENCE)
    }
    val confidence = ScanFieldConfidenceV1(
        character = character.confidence.takeIf { character.variantId == null },
        characterVariant = character.confidence.takeIf { character.variantId != null },
        body = body.confidence,
        tire = tireConfidence,
        glider = glider.confidence,
        country = countryConfidence,
    ).takeIf { value ->
        listOf(
            value.character,
            value.characterVariant,
            value.body,
            value.tire,
            value.glider,
            value.country,
        ).any { it != null }
    }

    return AndroidScanTimeTrialSubmissionV1(
        submissionId = context.submissionId,
        revision = context.revision,
        mode = context.mode,
        trackId = context.trackId,
        totalTimeMs = totalTimeMs,
        laps = laps,
        loadout = loadout,
        countryId = countryId,
        playerReference = context.playerReference.copy(),
        observedPlayerName = observedName,
        source = ScanSourceV1(
            producerVersion = context.producerVersion,
            localRecordId = context.localRecordId,
        ),
        timestamps = ScanTimestampsV1(observation.capturedAtMs, context.createdAtMs),
        evidence = evidence,
        verification = ScanVerificationV1(fieldConfidence = confidence),
    )
}

internal fun encodeAndroidScanSubmission(submission: AndroidScanTimeTrialSubmissionV1): String =
    canonicalJson.encodeToString(submission)
