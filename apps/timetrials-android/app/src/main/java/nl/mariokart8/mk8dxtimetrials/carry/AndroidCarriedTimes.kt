package nl.mariokart8.mk8dxtimetrials.carry

import android.content.Context
import java.io.File
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidCanonicalSubmissionPayload
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalOutboxConflictException
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalOutboxRecord
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalTimeTrialOutbox
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidProducedSubmissionValidator
import nl.mariokart8.mk8dxtimetrials.outbox.androidOutboxOwningSlotIdPattern

private val opaqueIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")
private val carryJson = Json { ignoreUnknownKeys = false }

/**
 * A copy of a sent result for another community, still without its Player: the Player is the account the person
 * signs in with there, which this phone only knows once they have. It describes the same run - same source kind,
 * laps, loadout and the moment it was driven - under a new submission id. Evidence stays where it was taken.
 */
internal fun androidCarriedCopy(
    original: JsonObject,
    carriedFrom: AndroidCarriedFromV1,
    newOpaqueId: String,
    nowMs: Long,
): JsonObject {
    require(newOpaqueId.matches(opaqueIdPattern))
    val timestamps = original["timestamps"] as? JsonObject ?: throw IllegalArgumentException()
    val originalCreatedAtMs = (timestamps["createdAtMs"] as? JsonPrimitive)?.content?.toLongOrNull()
        ?: throw IllegalArgumentException()
    val copiedTimestamps = JsonObject(
        timestamps.toMutableMap().apply {
            // A scan keeps capturedAtMs; a typed time keeps when it was driven, which is when it was entered when
            // nothing else was recorded. Only the copy's own creation is new.
            if (!containsKey("capturedAtMs") && !containsKey("occurredAtMs")) {
                put("occurredAtMs", JsonPrimitive(originalCreatedAtMs))
            }
            put("createdAtMs", JsonPrimitive(nowMs))
        },
    )
    return JsonObject(
        original.toMutableMap().apply {
            remove("playerReference")
            remove("evidence")
            put("submissionId", JsonPrimitive("user_submission.time.$newOpaqueId"))
            put("revision", JsonPrimitive(1))
            put("timestamps", copiedTimestamps)
            // A run carried twice keeps the community it was first driven for.
            if (!containsKey("carriedFrom")) {
                put("carriedFrom", carryJson.encodeToJsonElement(AndroidCarriedFromV1.serializer(), carriedFrom))
            }
        },
    )
}

/** The staged copy with the signed-in Player of the receiving community: a complete, valid submission. */
internal fun androidCompletedCarriedSubmission(staged: JsonObject, playerId: String): JsonObject {
    val completed = JsonObject(
        staged.toMutableMap().apply {
            put("playerReference", buildJsonObject { put("namespace", "player"); put("value", playerId) })
        },
    )
    AndroidProducedSubmissionValidator.validate(completed)
    return completed
}

internal fun JsonObject.carriedFromOrNull(): AndroidCarriedFromV1? = (this["carriedFrom"] as? JsonObject)?.let {
    runCatching { Json { ignoreUnknownKeys = true }.decodeFromJsonElement(AndroidCarriedFromV1.serializer(), it) }
        .getOrNull()
}

/**
 * Copies waiting for the receiving community, kept in that community's own storage namespace. They move into its
 * outbox the first time the app runs there with somebody signed in, and are sent from there as usual.
 */
internal class AndroidCarriedQueue(private val file: File) {
    private val lock = Any()

    fun list(): List<JsonObject> = synchronized(lock) { read() }

    fun size(): Int = list().size

    fun add(staged: JsonObject) = synchronized(lock) {
        val current = read()
        require(current.size < MAX_ENTRIES)
        write(current + staged)
    }

    fun remove(submissionId: String) = synchronized(lock) {
        write(read().filterNot { (it["submissionId"] as? JsonPrimitive)?.content == submissionId })
    }

    private fun read(): List<JsonObject> = runCatching {
        if (!file.isFile) emptyList()
        else (Json.parseToJsonElement(file.readText(Charsets.UTF_8)) as JsonArray).filterIsInstance<JsonObject>()
    }.getOrDefault(emptyList())

    private fun write(entries: List<JsonObject>) {
        file.parentFile?.mkdirs()
        val temporary = File(file.parentFile, file.name + ".tmp")
        temporary.writeText(JsonArray(entries).toString(), Charsets.UTF_8)
        if (!temporary.renameTo(file)) {
            file.delete()
            check(temporary.renameTo(file))
        }
    }

    companion object {
        const val MAX_ENTRIES = 200

        fun forOrigin(context: Context, origin: String): AndroidCarriedQueue = AndroidCarriedQueue(
            File(context.filesDir, "time-trial-carried-v1" + AndroidServerOrigin.storageSuffix(origin) + ".json"),
        )
    }
}

internal sealed interface AndroidCarryOutcome {
    /** Waiting for the receiving community; [review] when an administrator there approves it first. */
    data class Queued(val review: Boolean) : AndroidCarryOutcome
    /** The receiving community does not take times from other communities. */
    data object Refused : AndroidCarryOutcome
    /** Its settings could not be read: nothing was queued. */
    data object Unreachable : AndroidCarryOutcome
    /** This run already waits for (or was already sent to) that community. */
    data object AlreadyCarried : AndroidCarryOutcome
    /** Not a sent, real result. */
    data object NotCarriable : AndroidCarryOutcome
}

/**
 * Carries one sent result of the active community to [targetOrigin] (ADR-0225 2.5). Asks the target first and
 * queues nothing when it says no or cannot be reached.
 */
internal fun carryAndroidResult(
    record: AndroidLocalOutboxRecord,
    sourceOrigin: String,
    sourceName: String?,
    targetOrigin: String,
    readPolicy: () -> AndroidCarriedTimesPolicy,
    queue: AndroidCarriedQueue,
    targetSubmissions: () -> List<JsonObject>,
    nowMs: Long,
    newOpaqueId: () -> String = { UUID.randomUUID().toString() },
): AndroidCarryOutcome {
    val submission = record.canonicalSubmission
    val kind = ((submission["source"] as? JsonObject)?.get("kind") as? JsonPrimitive)?.content
    if (record.state.state != "synced" || kind == "android_scan_test" || targetOrigin == sourceOrigin) {
        return AndroidCarryOutcome.NotCarriable
    }
    val originalId = (submission["submissionId"] as? JsonPrimitive)?.content ?: return AndroidCarryOutcome.NotCarriable
    val carriedFrom = submission.carriedFromOrNull() ?: AndroidCarriedFromV1(
        origin = sourceOrigin,
        communityName = sourceName?.trim()?.take(80)?.takeIf { it.isNotEmpty() },
        originalSubmissionId = originalId,
        originalSubmittedAtMs = record.state.syncedAtMs ?: record.entry.createdAtMs,
    )
    val already = (queue.list() + targetSubmissions()).any { other ->
        other.carriedFromOrNull()?.let {
            it.origin == carriedFrom.origin && it.originalSubmissionId == carriedFrom.originalSubmissionId
        } == true
    }
    if (already) return AndroidCarryOutcome.AlreadyCarried
    val policy = try {
        readPolicy()
    } catch (_: Exception) {
        return AndroidCarryOutcome.Unreachable
    }
    if (policy == AndroidCarriedTimesPolicy.OFF) return AndroidCarryOutcome.Refused
    val staged = try {
        androidCarriedCopy(submission, carriedFrom, newOpaqueId(), nowMs)
    } catch (_: Exception) {
        return AndroidCarryOutcome.NotCarriable
    }
    queue.add(staged)
    return AndroidCarryOutcome.Queued(review = policy == AndroidCarriedTimesPolicy.REVIEW)
}

/**
 * Moves the waiting copies into the active community's outbox for the signed-in [playerId], owned by
 * [owningSlotId] so delivery uses that account. Returns how many moved. A copy that can never become a valid
 * submission is dropped (the original stays in its own community).
 */
internal fun promoteAndroidCarriedTimes(
    queue: AndroidCarriedQueue,
    outbox: AndroidLocalTimeTrialOutbox,
    playerId: String,
    owningSlotId: String?,
    nowMs: Long,
): Int {
    if (owningSlotId == null || !owningSlotId.matches(androidOutboxOwningSlotIdPattern)) return 0
    var moved = 0
    queue.list().forEach { staged ->
        val submissionId = (staged["submissionId"] as? JsonPrimitive)?.content ?: return@forEach
        val completed = try {
            androidCompletedCarriedSubmission(staged, playerId)
        } catch (_: Exception) {
            queue.remove(submissionId)
            return@forEach
        }
        try {
            outbox.create(
                AndroidCanonicalSubmissionPayload(submissionId, 1, completed.toString()),
                createdAtMs = nowMs,
                owningSlotId = owningSlotId,
            )
            moved++
            queue.remove(submissionId)
        } catch (_: AndroidLocalOutboxConflictException) {
            queue.remove(submissionId)
        } catch (_: Exception) {
            // Kept for the next start.
        }
    }
    return moved
}
