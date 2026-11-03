package nl.mariokart8.mk8dxtimetrials.scan

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

internal enum class RunnerScanFrameErrorCode {
    INVALID_JSON,
    INVALID_SHAPE,
    INVALID_FIELDS,
    INVALID_IDENTITY,
}

internal class RunnerScanFrameException(
    val code: RunnerScanFrameErrorCode,
) : IllegalArgumentException("TT Scan runner frame is invalid.")

private val runnerFrameParser = Json { ignoreUnknownKeys = false }

private fun runnerFrameFailure(code: RunnerScanFrameErrorCode): Nothing =
    throw RunnerScanFrameException(code)

private fun JsonObject.requiredInt(key: String): Int {
    val value = this[key] as? JsonPrimitive
        ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_SHAPE)
    if (value.isString) runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_SHAPE)
    return value.intOrNull ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_SHAPE)
}

private fun optionalString(value: kotlinx.serialization.json.JsonElement?): String {
    if (value == null) return ""
    val primitive = value as? JsonPrimitive
        ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
    if (!primitive.isString) runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
    return primitive.contentOrNull ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
}

private fun parseIdentitySlot(value: kotlinx.serialization.json.JsonElement): ScanIdentitySlotFrame {
    val slot = value as? JsonObject
        ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
    val id = when (val raw = slot["id"]) {
        null, JsonNull -> null
        is JsonPrimitive -> {
            if (!raw.isString) runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
            raw.contentOrNull
        }
        else -> runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
    }
    val index = when (val raw = slot["index"]) {
        null, JsonNull -> null
        is JsonPrimitive -> {
            if (raw.isString) runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
            raw.intOrNull ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
        }
        else -> runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
    }
    fun optionalDouble(key: String): Double {
        val raw = slot[key] ?: return 0.0
        val primitive = raw as? JsonPrimitive
            ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
        if (primitive.isString) runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
        return primitive.doubleOrNull
            ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
    }
    fun optionalBoolean(key: String): Boolean {
        val raw = slot[key] ?: return false
        val primitive = raw as? JsonPrimitive
            ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
        if (primitive.isString) runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
        return primitive.booleanOrNull
            ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
    }
    return ScanIdentitySlotFrame(
        id = id,
        index = index,
        name = optionalString(slot["name"]),
        assetReference = optionalString(slot["asset_ref"]),
        cropPath = optionalString(slot["crop_path"]),
        score = optionalDouble("score"),
        accepted = optionalBoolean("ok"),
    )
}

internal fun translateRunnerScanFrame(encodedFrame: String): ScanConsensusFrame {
    val root = try {
        runnerFrameParser.parseToJsonElement(encodedFrame) as? JsonObject
            ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_JSON)
    } catch (error: RunnerScanFrameException) {
        throw error
    } catch (_: Exception) {
        runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_JSON)
    }
    val fieldsObject = root["fields"] as? JsonObject
        ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_FIELDS)
    val fields = linkedMapOf<String, String>()
    fieldsObject.forEach { (key, value) ->
        val primitive = value as? JsonPrimitive
            ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_FIELDS)
        if (!primitive.isString) runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_FIELDS)
        fields[key] = primitive.contentOrNull
            ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_FIELDS)
    }
    val lapSumAccepted = when (val value = root["lap_sum_ok"]) {
        JsonNull -> false
        is JsonPrimitive -> {
            if (value.isString) runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_SHAPE)
            value.booleanOrNull ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_SHAPE)
        }
        else -> runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_SHAPE)
    }
    val repairs = root.requiredInt("lap_sum_repairs")
    val expected = root.requiredInt("expected_field_count")
    if (repairs < 0 || expected < 0) runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_SHAPE)

    val identityOwners = when (val kartConfig = root["kart_config"]) {
        JsonNull -> null
        is JsonObject -> {
            val owners = kartConfig["owners"]
            if (owners == null) {
                null
            } else {
                val ownersObject = owners as? JsonObject
                    ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
                linkedMapOf<String, ScanIdentityOwnerFrame>().apply {
                    ownersObject.forEach { (owner, value) ->
                        val ownerObject = value as? JsonObject
                            ?: runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
                        val slots = linkedMapOf<ScanIdentityKind, ScanIdentitySlotFrame>()
                        ScanIdentityKind.entries.forEach { kind ->
                            ownerObject[kind.resultKey]?.let {
                                slots[kind] = parseIdentitySlot(it)
                            }
                        }
                        put(
                            owner,
                            ScanIdentityOwnerFrame(
                                cardName = optionalString(ownerObject["card_name"]),
                                slots = slots,
                            ),
                        )
                    }
                }
            }
        }
        else -> runnerFrameFailure(RunnerScanFrameErrorCode.INVALID_IDENTITY)
    }
    return ScanConsensusFrame(
        fields = fields,
        lapSumAccepted = lapSumAccepted,
        lapSumRepairs = repairs,
        expectedFieldCount = expected,
        identityOwners = identityOwners,
    )
}

/**
 * The Select-a-Ghost detail panel shows one rider, and the engine reports that
 * rider as `ghost_*` because the panel is the ghost screen. The record being
 * scanned is that rider's own time, so the submission reads it as the
 * player's. Without this every ghost-panel read was thrown away for lacking a
 * `player_total` and the Player was told no result screen was found
 * (camera QA, 2026-09-17). A frame that already carries player fields is left
 * alone.
 */
internal fun ScanConsensusFrame.ghostPanelAsPlayer(): ScanConsensusFrame {
    if (fields.keys.any { it.startsWith("player_") }) return this
    val renamed = LinkedHashMap<String, String>()
    fields.forEach { (key, value) ->
        renamed[if (key.startsWith("ghost_")) "player_" + key.removePrefix("ghost_") else key] = value
    }
    val owners = identityOwners?.let { current ->
        if ("player" in current) {
            current
        } else {
            LinkedHashMap<String, ScanIdentityOwnerFrame>().apply {
                current.forEach { (owner, frame) -> put(if (owner == "ghost") "player" else owner, frame) }
            }
        }
    }
    return copy(fields = renamed, identityOwners = owners)
}
