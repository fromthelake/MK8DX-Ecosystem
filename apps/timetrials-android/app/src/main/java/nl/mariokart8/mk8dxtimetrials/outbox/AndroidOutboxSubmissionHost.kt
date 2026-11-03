package nl.mariokart8.mk8dxtimetrials.outbox

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.manual.encodeAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.scan.encodeAndroidScanSubmission

internal fun interface AndroidOutboxClock {
    fun nowMs(): Long
}

/** Resolves the account that owns whatever is stored right now. */
internal fun interface AndroidOutboxOwningSlotProvider {
    fun owningSlotId(): String?
}

internal fun interface AndroidOutboxAutomaticSyncScheduler {
    fun schedule()
}

internal class AndroidOutboxSubmissionHost(
    private val outbox: AndroidLocalTimeTrialOutbox,
    private val clock: AndroidOutboxClock,
    private val manualPrivateEvidence: (AndroidManualTimeTrialSubmissionV1) -> JsonObject? = { null },
    private val scanPrivateEvidence: (AndroidScanTimeTrialSubmissionV1) -> JsonObject? = { null },
    private val owningSlot: AndroidOutboxOwningSlotProvider =
        AndroidOutboxOwningSlotProvider { null },
    private val automaticSync: AndroidOutboxAutomaticSyncScheduler =
        AndroidOutboxAutomaticSyncScheduler {},
) {
    fun storeManual(submission: AndroidManualTimeTrialSubmissionV1): AndroidLocalOutboxRecord =
        stored(
            outbox.create(
                payload = AndroidCanonicalSubmissionPayload(
                    submission.submissionId,
                    submission.revision,
                    encodeAndroidManualSubmission(submission),
                ),
                createdAtMs = clock.nowMs(),
                privateEvidence = manualPrivateEvidence(submission),
                owningSlotId = currentOwningSlotId(),
            ),
        )

    fun storeScan(submission: AndroidScanTimeTrialSubmissionV1): AndroidLocalOutboxRecord =
        stored(
            outbox.create(
                payload = AndroidCanonicalSubmissionPayload(
                    submission.submissionId,
                    submission.revision,
                    encodeAndroidScanSubmission(submission),
                ),
                createdAtMs = clock.nowMs(),
                privateEvidence = scanPrivateEvidence(submission),
                owningSlotId = currentOwningSlotId(),
            ),
        )

    private fun stored(record: AndroidLocalOutboxRecord): AndroidLocalOutboxRecord =
        record.also { runCatching { automaticSync.schedule() } }

    /**
     * The site's answer once the automatic sync delivered a stored result, or
     * null while it is still on its way or when it failed.
     */
    fun publishedFeedback(entryKey: String): AndroidSubmissionFeedback? = try {
        val state = outbox.read(entryKey).state
        if (state.state == "synced") androidSubmissionFeedbackOrNull(state.feedback) else null
    } catch (_: Exception) {
        null
    }

    fun synchronizationState(entryKey: String): String? = try {
        outbox.read(entryKey).state.state
    } catch (_: Exception) {
        null
    }

    /** Why the delivery failed, once it has. */
    fun failureCode(entryKey: String): String? = try {
        outbox.read(entryKey).state.failureCode
    } catch (_: Exception) {
        null
    }

    // Resolved at store time: the binding must record who was signed in when the
    // result was produced, not who is signed in when it is finally delivered.
    private fun currentOwningSlotId(): String? = try {
        owningSlot.owningSlotId()
    } catch (_: Exception) {
        null
    }

    fun manualCallback(onStored: (AndroidLocalOutboxRecord) -> Unit = {}):
        (AndroidManualTimeTrialSubmissionV1) -> Unit = { submission ->
        onStored(storeManual(submission))
    }

    fun scanCallback(onStored: (AndroidLocalOutboxRecord) -> Unit = {}):
        (AndroidScanTimeTrialSubmissionV1) -> Unit = { submission ->
        onStored(storeScan(submission))
    }
}

private val producerJson = Json {
    encodeDefaults = true
    explicitNulls = false
    ignoreUnknownKeys = false
}

internal object AndroidProducedSubmissionValidator : AndroidCanonicalSubmissionValidator {
    override fun validate(submission: JsonObject) {
        val sourceKind = ((submission["source"] as? JsonObject)?.get("kind") as? JsonPrimitive)
            ?.takeIf { it.isString }
            ?.content
            ?: throw IllegalArgumentException()
        val encoded = when (sourceKind) {
            "android_manual" -> producerJson.encodeToJsonElement(
                AndroidManualTimeTrialSubmissionV1.serializer(),
                producerJson.decodeFromString<AndroidManualTimeTrialSubmissionV1>(submission.toString()),
            )
            "android_scan", "android_scan_test" -> producerJson.encodeToJsonElement(
                AndroidScanTimeTrialSubmissionV1.serializer(),
                producerJson.decodeFromString<AndroidScanTimeTrialSubmissionV1>(submission.toString()),
            )
            else -> throw IllegalArgumentException()
        }
        if (encoded != compatibleProducerShape(submission, sourceKind)) {
            throw IllegalArgumentException()
        }
    }
}

/**
 * `source.captureLayout` became an optional scan provenance field after Android
 * had already written durable outbox entries. The serializer supplies
 * `time_trial_result` while decoding those entries and, because producer JSON
 * encodes defaults, a direct equality check would then reject the unchanged
 * legacy document and prevent every newer entry from synchronizing as well.
 *
 * Normalise only that one documented legacy omission. Unknown keys and every
 * other producer-shape mismatch remain rejected by the strict decoder and the
 * equality check above.
 */
private fun compatibleProducerShape(submission: JsonObject, sourceKind: String): JsonObject {
    if (sourceKind != "android_scan" && sourceKind != "android_scan_test") return submission
    val source = submission["source"] as? JsonObject ?: return submission
    if ("captureLayout" in source) return submission
    return JsonObject(
        submission + (
            "source" to JsonObject(
                source + ("captureLayout" to JsonPrimitive("time_trial_result")),
            )
        ),
    )
}
