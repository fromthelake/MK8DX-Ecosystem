package nl.mariokart8.mk8dxtimetrials.scan

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nl.mariokart8.iconmatcher.result.SequenceDecision

internal enum class ScanIdentityKind(val resultKey: String) {
    CHARACTER("character"),
    BODY("kart"),
    TIRE("wheel"),
    GLIDER("glider"),
    COUNTRY("flag"),
}

internal data class ScanIdentitySlotFrame(
    val id: String? = null,
    val index: Int? = null,
    val name: String = "",
    val assetReference: String = "",
    val cropPath: String = "",
    val score: Double = 0.0,
    val accepted: Boolean = false,
)

internal data class ScanIdentityOwnerFrame(
    val cardName: String = "",
    val slots: Map<ScanIdentityKind, ScanIdentitySlotFrame> = emptyMap(),
)

internal data class ScanConsensusFrame(
    val fields: Map<String, String> = emptyMap(),
    val lapSumAccepted: Boolean = false,
    val lapSumRepairs: Int = 0,
    val expectedFieldCount: Int = 0,
    val identityOwners: Map<String, ScanIdentityOwnerFrame>? = null,
)

internal object ScanBurstPolicy {
    const val BURST_FRAMES = 5
    const val BURST_GAP_MS = 150L
    const val IDENTITY_EXTRA_FRAMES = 3

    fun shouldStopAfterFrame(
        session: ScanConsensusSession,
        currentFrameIndex: Int,
        lockedFrameIndex: Int,
    ): Boolean {
        if (!session.locked || lockedFrameIndex < 0) return false
        val identityExtra = currentFrameIndex - lockedFrameIndex
        return identityExtra >= IDENTITY_EXTRA_FRAMES ||
            (identityExtra >= 1 && session.identitySettled())
    }
}

/**
 * The scan's sequence decision: the central specification (packages/icon-matcher java-result
 * SequenceDecision, the same rules as the Web scanner and Python; CENTRAL_RECOGNITION section 8.6,
 * phase 6). This class keeps the app's own frame types and its compact result encoding.
 */
internal class ScanConsensusSession {
    companion object {
        const val FIELD_MIN_SUPPORT = SequenceDecision.FIELD_MIN_SUPPORT
        const val FIELD_MIN_MARGIN = SequenceDecision.FIELD_MIN_MARGIN
    }

    private val decision = SequenceDecision()

    val locked: Boolean get() = decision.locked
    val acceptPath: String get() = decision.acceptPath
    val lockedFields: Map<String, String> get() = decision.lockedFields
    val framesAnalyzed: Int get() = decision.framesAnalyzed
    val acceptedFrames: Int get() = decision.acceptedFrames
    val identityFrames: Int get() = decision.identityFrames

    /** Mirrors the source activity: stop updating times after lock, but keep voting identity. */
    fun consume(frame: ScanConsensusFrame): Boolean {
        val justLocked = if (locked) {
            false
        } else {
            decision.updateTimes(
                frame.fields,
                frame.lapSumAccepted,
                frame.lapSumRepairs,
                frame.expectedFieldCount,
            )
        }
        frame.identityOwners?.let { owners -> decision.addIdentity(identityReads(owners)) }
        return justLocked
    }

    fun identitySettled(): Boolean = decision.identitySettled()

    fun encodeCompactResult(timestampMs: Long, lockedFrameIndex: Int): String =
        buildJsonObject {
            put("locked", locked)
            put("accept_path", acceptPath)
            put("locked_frame_index", lockedFrameIndex)
            put("frames_analyzed", framesAnalyzed)
            put("ok_frames", acceptedFrames)
            put("fields", JsonObject(lockedFields.mapValues { JsonPrimitive(it.value) }))
            put("identity", jsonOf(decision.identitySnapshot()))
            put("timestamp_ms", timestampMs)
        }.toString()

    private fun identityReads(owners: Map<String, ScanIdentityOwnerFrame>): Map<String, Any?> {
        val reads = LinkedHashMap<String, Any?>()
        owners.forEach { (owner, observation) ->
            val read = LinkedHashMap<String, Any?>()
            read["card_name"] = observation.cardName
            observation.slots.forEach { (kind, slot) ->
                read[kind.resultKey] = linkedMapOf<String, Any?>(
                    "id" to slot.id,
                    "index" to slot.index,
                    "name" to slot.name,
                    "asset_ref" to slot.assetReference,
                    "crop_path" to slot.cropPath,
                    "score" to slot.score,
                    "ok" to slot.accepted,
                )
            }
            reads[owner] = read
        }
        return reads
    }

    private fun jsonOf(value: Any?): JsonElement = when (value) {
        null -> JsonNull
        is String -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to jsonOf(v) })
        is List<*> -> JsonArray(value.map { jsonOf(it) })
        else -> JsonPrimitive(value.toString())
    }
}
