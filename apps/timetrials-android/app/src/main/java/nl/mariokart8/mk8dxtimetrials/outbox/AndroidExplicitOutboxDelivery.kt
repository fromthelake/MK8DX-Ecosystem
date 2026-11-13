package nl.mariokart8.mk8dxtimetrials.outbox

import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal const val ANDROID_DELIVERY_FAILURE_EVIDENCE_NOT_ALLOWLISTED =
    "evidence.not_allowlisted"
internal const val ANDROID_DELIVERY_FAILURE_EVIDENCE_REVIEW_FAILED =
    "evidence.review_failed"
internal const val ANDROID_DELIVERY_FAILURE_TRANSPORT_FAILED = "transport.failed"
internal const val ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID = "response.invalid"
internal const val ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED =
    "account.reauthentication_required"

private const val MAX_DELIVERY_TIMESTAMP_MS = 253_402_300_799_999L
private val deliveryEntryKeyPattern = Regex("^[0-9a-f]{64}$")
private val deliveryFailureCodePattern = Regex("^[a-z0-9]+(?:[._-][a-z0-9]+)*$")

internal open class AndroidCanonicalDeliveryException(message: String) :
    RuntimeException(message)

internal class AndroidCanonicalDeliveryStateException(message: String) :
    AndroidCanonicalDeliveryException(message)

internal class AndroidCanonicalDeliveryTransportException(failureCode: String) :
    AndroidCanonicalDeliveryException("Canonical submission transport failed.") {
    val failureCode: String = failureCode.takeIf(::validFailureCode)
        ?: ANDROID_DELIVERY_FAILURE_TRANSPORT_FAILED
}

internal fun interface AndroidAuthenticatedCanonicalSubmissionTransport {
    fun submit(submission: JsonObject): JsonObject
}

/**
 * Produces the transport that carries exactly the credentials of [owningSlotId].
 * Returning null means that account must sign in again; there is deliberately no
 * way to express "use whoever is signed in instead".
 */
internal fun interface AndroidOwnedCanonicalSubmissionTransportResolver {
    fun resolve(owningSlotId: String): AndroidAuthenticatedCanonicalSubmissionTransport?
}

internal fun interface AndroidReviewedEvidenceReferenceAllowlist {
    fun allows(evidence: List<JsonObject>): Boolean
}

internal fun interface AndroidExplicitCanonicalOutboxDeliveryAction {
    fun deliver(entryKey: String, attemptedAtMs: Long): AndroidLocalOutboxRecord
}

internal class AndroidExplicitCanonicalOutboxDeliveryCoordinator(
    private val outbox: AndroidCanonicalOutboxDeliveryPort,
    private val transportResolver: AndroidOwnedCanonicalSubmissionTransportResolver,
    private val reviewedEvidenceAllowlist: AndroidReviewedEvidenceReferenceAllowlist,
) : AndroidExplicitCanonicalOutboxDeliveryAction {
    private val attemptLock = ReentrantLock()

    override fun deliver(entryKey: String, attemptedAtMs: Long): AndroidLocalOutboxRecord {
        if (
            !entryKey.matches(deliveryEntryKeyPattern) ||
            attemptedAtMs !in 0..MAX_DELIVERY_TIMESTAMP_MS
        ) {
            invalidInput()
        }

        return attemptLock.withLock {
            val record = outbox.read(entryKey)
            if (
                record.entry.entryKey != entryKey ||
                record.state.entryKey != entryKey ||
                record.state.state != "pending" ||
                record.state.stateRevision < 1 ||
                record.state.updatedAtMs !in 0..MAX_DELIVERY_TIMESTAMP_MS ||
                attemptedAtMs < record.state.updatedAtMs
            ) {
                invalidState()
            }
            val submission = record.canonicalSubmission
            val evidence = canonicalEvidence(submission)
            val stateRevision = record.state.stateRevision

            // Resolved from the entry's own immutable owner binding. An entry
            // whose account cannot authenticate is never sent with another
            // account's credentials; it fails closed and stays retryable.
            val owningSlotId = record.owner?.slotId
            val authenticatedTransport = owningSlotId?.let { slotId ->
                try {
                    transportResolver.resolve(slotId)
                } catch (_: Exception) {
                    null
                }
            }
            if (authenticatedTransport == null) {
                return@withLock outbox.markFailed(
                    entryKey,
                    stateRevision,
                    attemptedAtMs,
                    ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED,
                )
            }

            val allowed = try {
                reviewedEvidenceAllowlist.allows(evidence.map(::copyObject))
            } catch (_: Exception) {
                return@withLock outbox.markFailed(
                    entryKey,
                    stateRevision,
                    attemptedAtMs,
                    ANDROID_DELIVERY_FAILURE_EVIDENCE_REVIEW_FAILED,
                )
            }
            if (!allowed) {
                return@withLock outbox.markFailed(
                    entryKey,
                    stateRevision,
                    attemptedAtMs,
                    ANDROID_DELIVERY_FAILURE_EVIDENCE_NOT_ALLOWLISTED,
                )
            }

            val response = try {
                authenticatedTransport.submit(copyObject(submission))
            } catch (error: AndroidCanonicalDeliveryTransportException) {
                return@withLock outbox.markFailed(
                    entryKey,
                    stateRevision,
                    attemptedAtMs,
                    error.failureCode,
                )
            } catch (_: Exception) {
                return@withLock outbox.markFailed(
                    entryKey,
                    stateRevision,
                    attemptedAtMs,
                    ANDROID_DELIVERY_FAILURE_TRANSPORT_FAILED,
                )
            }

            if (!acknowledges(response, submission)) {
                return@withLock outbox.markFailed(
                    entryKey,
                    stateRevision,
                    attemptedAtMs,
                    ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID,
                )
            }
            outbox.markSynced(
                entryKey,
                stateRevision,
                attemptedAtMs,
                // ADR-0225 amendment 3: a carried copy that was already there, or that filled empty fields of
                // an equal run, is done; what happened is kept beside the state instead of the site's feedback.
                (response["feedback"] ?: response["carried"]) as? JsonObject,
            )
        }
    }

    private fun canonicalEvidence(submission: JsonObject): List<JsonObject> {
        val submissionId = submission.stringValue("submissionId")
        val revision = submission.integerValue("revision")
        if (submissionId.isNullOrEmpty() || revision == null || revision < 1) invalidState()
        val evidence = submission["evidence"] ?: return emptyList()
        return (evidence as? JsonArray)?.map { item ->
            copyObject(item as? JsonObject ?: invalidState())
        } ?: invalidState()
    }

    private fun acknowledges(response: JsonObject, submission: JsonObject): Boolean =
        response.keys - setOf("feedback", "carried") == setOf("submissionId", "revision") &&
            !(response.containsKey("feedback") && response.containsKey("carried")) &&
            (response["carried"] == null || androidCarriedOutcomeOrNull(response["carried"]) != null) &&
            (response["feedback"] == null || androidSubmissionFeedbackOrNull(response["feedback"]) != null) &&
            response.stringValue("submissionId") == submission.stringValue("submissionId") &&
            response.integerValue("revision") == submission.integerValue("revision")

    private fun invalidInput(): Nothing = throw AndroidCanonicalDeliveryStateException(
        "Canonical delivery input is invalid.",
    )

    private fun invalidState(): Nothing = throw AndroidCanonicalDeliveryStateException(
        "Canonical delivery requires a pending outbox entry.",
    )
}

private val deliveryJson = Json { ignoreUnknownKeys = false }

private fun copyObject(value: JsonObject): JsonObject =
    deliveryJson.parseToJsonElement(value.toString()) as JsonObject

private fun validFailureCode(value: String): Boolean =
    value.length in 1..64 && value.matches(deliveryFailureCodePattern)

private fun JsonObject.stringValue(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.integerValue(name: String): Long? =
    (this[name] as? JsonPrimitive)
        ?.takeIf { !it.isString }
        ?.content
        ?.takeIf { it.matches(Regex("^(0|[1-9][0-9]*)$")) }
        ?.toLongOrNull()
