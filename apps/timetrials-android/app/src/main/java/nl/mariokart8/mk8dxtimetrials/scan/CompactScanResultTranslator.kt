package nl.mariokart8.mk8dxtimetrials.scan

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import nl.mariokart8.iconmatcher.result.ScanResult
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

internal enum class ScanStableAssetType {
    CHARACTER,
    CHARACTER_VARIANT,
    BODY,
    BODY_VARIANT,
    GLIDER,
    GLIDER_VARIANT,
}

internal data class ScanStableAssetRecord(
    val type: ScanStableAssetType,
    val parentId: String? = null,
)

internal interface ScanStableAssetResolver {
    fun resolve(assetId: String): ScanStableAssetRecord?
}

internal enum class CompactScanResultErrorCode {
    INVALID_JSON,
    INVALID_SHAPE,
    UNLOCKED_RESULT,
    MISSING_PLAYER_RESULT,
    INVALID_PLAYER_FIELDS,
    INVALID_PLAYER_IDENTITY,
}

internal class CompactScanResultException(
    val code: CompactScanResultErrorCode,
) : IllegalArgumentException("TT Scan compact result is invalid.")

private val parser = Json { ignoreUnknownKeys = false }
private val playerLapPattern = Regex("^player_lap_([1-7])$")

private fun fail(code: CompactScanResultErrorCode): Nothing =
    throw CompactScanResultException(code)

private fun JsonObject.requiredObject(
    key: String,
    code: CompactScanResultErrorCode,
): JsonObject = this[key] as? JsonObject ?: fail(code)

private fun JsonObject.requiredString(
    key: String,
    code: CompactScanResultErrorCode,
): String {
    val primitive = this[key] as? JsonPrimitive ?: fail(code)
    if (!primitive.isString) fail(code)
    return primitive.contentOrNull ?: fail(code)
}

private fun parseStableSlot(
    owner: JsonObject?,
    key: String,
    baseType: ScanStableAssetType,
    variantType: ScanStableAssetType,
    assets: ScanStableAssetResolver,
): ScanStableIdentityObservation? {
    val value = owner?.get(key) ?: return null
    val slot = value as? JsonObject ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    val acceptedPrimitive = slot["ok"] as? JsonPrimitive
        ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    if (acceptedPrimitive.isString) fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    val accepted = acceptedPrimitive.booleanOrNull
        ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    if (!accepted) return ScanStableIdentityObservation(accepted = false)
    val assetId = slot.requiredString(
        "id",
        CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY,
    )
    val record = assets.resolve(assetId)
        ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    if (record.type != baseType && record.type != variantType) {
        fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    }
    val familyId = if (record.type == variantType) {
        record.parentId ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    } else {
        if (record.parentId != null) fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
        null
    }
    val scoreValue = slot["score"]
    val score = if (scoreValue == null) {
        null
    } else {
        val primitive = scoreValue as? JsonPrimitive
            ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
        if (primitive.isString) fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
        primitive.doubleOrNull ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    }
    return ScanStableIdentityObservation(
        accepted = true,
        assetId = assetId,
        familyId = familyId,
        score = score,
    )
}

private fun parseLegacySlot(
    owner: JsonObject?,
    key: String,
): ScanLegacyIdentityObservation? {
    val value = owner?.get(key) ?: return null
    val slot = value as? JsonObject ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    val acceptedPrimitive = slot["ok"] as? JsonPrimitive
        ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    if (acceptedPrimitive.isString) fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    val accepted = acceptedPrimitive.booleanOrNull
        ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    if (!accepted) return ScanLegacyIdentityObservation(accepted = false)
    val indexPrimitive = slot["index"] as? JsonPrimitive
        ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    if (indexPrimitive.isString) fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    val index = indexPrimitive.intOrNull
        ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    val scoreValue = slot["score"]
    val score = if (scoreValue == null) {
        null
    } else {
        val primitive = scoreValue as? JsonPrimitive
            ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
        if (primitive.isString) fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
        primitive.doubleOrNull ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    }
    return ScanLegacyIdentityObservation(
        accepted = true,
        index = index,
        score = score,
    )
}

/** The parsed JSON as plain maps, lists and values, for the central scan result (Java). */
private fun plainJson(element: JsonElement): Any? = when (element) {
    is JsonNull -> null
    is JsonObject -> LinkedHashMap<String, Any?>().also { map -> element.forEach { (k, v) -> map[k] = plainJson(v) } }
    is JsonArray -> element.map { plainJson(it) }
    is JsonPrimitive -> when {
        element.isString -> element.content
        element.booleanOrNull != null -> element.booleanOrNull
        element.content.any { it == '.' || it == 'e' || it == 'E' } -> element.content.toDouble()
        else -> element.content.toLongOrNull() ?: element.content.toDouble()
    }
}

internal fun translateCompactPlayerScanResult(
    encodedResult: String,
    stableAssets: ScanStableAssetResolver,
): AcceptedPlayerScanObservation {
    val root = try {
        parser.parseToJsonElement(encodedResult) as? JsonObject
            ?: fail(CompactScanResultErrorCode.INVALID_JSON)
    } catch (error: CompactScanResultException) {
        throw error
    } catch (_: Exception) {
        fail(CompactScanResultErrorCode.INVALID_JSON)
    }
    val lockedPrimitive = root["locked"] as? JsonPrimitive
        ?: fail(CompactScanResultErrorCode.INVALID_SHAPE)
    if (lockedPrimitive.isString) fail(CompactScanResultErrorCode.INVALID_SHAPE)
    val locked = lockedPrimitive.booleanOrNull
        ?: fail(CompactScanResultErrorCode.INVALID_SHAPE)
    if (!locked) fail(CompactScanResultErrorCode.UNLOCKED_RESULT)
    val fields = root.requiredObject("fields", CompactScanResultErrorCode.INVALID_SHAPE)
    if ("player_total" !in fields) {
        fail(CompactScanResultErrorCode.MISSING_PLAYER_RESULT)
    }
    val totalTime = fields.requiredString(
        "player_total",
        CompactScanResultErrorCode.INVALID_PLAYER_FIELDS,
    )
    if (fields.keys.any { key ->
            key.startsWith("player_lap_") && !playerLapPattern.matches(key)
        }
    ) {
        fail(CompactScanResultErrorCode.INVALID_PLAYER_FIELDS)
    }
    val lapNumbers = fields.keys.mapNotNull { key ->
        playerLapPattern.matchEntire(key)?.groupValues?.get(1)?.toInt()
    }.sorted()
    if (lapNumbers != (1..lapNumbers.size).toList() ||
        (lapNumbers.size != 3 && lapNumbers.size != 7)
    ) {
        fail(CompactScanResultErrorCode.INVALID_PLAYER_FIELDS)
    }
    val lapTimes = lapNumbers.map { lapNumber ->
        fields.requiredString(
            "player_lap_$lapNumber",
            CompactScanResultErrorCode.INVALID_PLAYER_FIELDS,
        )
    }
    val timestampPrimitive = root["timestamp_ms"] as? JsonPrimitive
        ?: fail(CompactScanResultErrorCode.INVALID_SHAPE)
    if (timestampPrimitive.isString) fail(CompactScanResultErrorCode.INVALID_SHAPE)
    val capturedAtMs = timestampPrimitive.longOrNull
        ?: fail(CompactScanResultErrorCode.INVALID_SHAPE)

    val identity = when (val value = root["identity"]) {
        null -> null
        is JsonObject -> value
        else -> fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    }
    val playerIdentity = when (val value = identity?.get("player")) {
        null -> null
        is JsonObject -> value
        else -> fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
    }
    val observedName = playerIdentity?.get("card_name")?.let { value ->
        val primitive = value as? JsonPrimitive
            ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
        if (!primitive.isString) fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
        val name = primitive.contentOrNull
            ?: fail(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY)
        name.takeIf { it.isNotEmpty() }
    }

    // The central scan result (packages/icon-matcher java-result, the same rules as the Web
    // scanner; CENTRAL_RECOGNITION section 8.6, phase 4) decides whether the laps add up and which
    // printed name counts. The checks above stay as this translator's own shape guard.
    @Suppress("UNCHECKED_CAST")
    val central = ScanResult.compose(plainJson(root) as Map<String, Any?>, null)

    return AcceptedPlayerScanObservation(
        totalTime = totalTime,
        lapTimes = lapTimes,
        lapSumAccepted = central.lapSumMatches == true,
        character = parseStableSlot(
            playerIdentity,
            "character",
            ScanStableAssetType.CHARACTER,
            ScanStableAssetType.CHARACTER_VARIANT,
            stableAssets,
        ),
        body = parseStableSlot(
            playerIdentity,
            "kart",
            ScanStableAssetType.BODY,
            ScanStableAssetType.BODY_VARIANT,
            stableAssets,
        ),
        tire = parseLegacySlot(playerIdentity, "wheel"),
        glider = parseStableSlot(
            playerIdentity,
            "glider",
            ScanStableAssetType.GLIDER,
            ScanStableAssetType.GLIDER_VARIANT,
            stableAssets,
        ),
        country = parseLegacySlot(playerIdentity, "flag"),
        observedPlayerName = observedName?.let { central.observedPlayerName },
        capturedAtMs = capturedAtMs,
    )
}

internal fun createAndroidScanSubmissionFromCompactResult(
    encodedResult: String,
    context: AndroidScanSubmissionContext,
    stableAssets: ScanStableAssetResolver = Schema9ScanStableAssetResolver,
    legacyAssets: ScanLegacyAssetResolver = Schema9ScanLegacyAssetResolver,
): AndroidScanTimeTrialSubmissionV1 = createAndroidScanSubmission(
    observation = translateCompactPlayerScanResult(encodedResult, stableAssets),
    context = context,
    assets = legacyAssets,
)
