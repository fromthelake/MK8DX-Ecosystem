package nl.mariokart8.mk8dxtimetrials.outbox

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

internal const val ANDROID_CANONICAL_SUBMISSION_PATH = "/v1/time-trial-submissions"
internal const val ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES = 8 * 1024
/**
 * Asks the API for the feedback block beside the acknowledgement. Opt-in on
 * the wire: builds before 2.53.0 check the answer for exactly two keys.
 */
internal const val ANDROID_CANONICAL_SUBMISSION_FEEDBACK_QUERY = "feedback=v2"

internal const val ANDROID_CANONICAL_TRANSPORT_NOT_AUTHENTICATED =
    "transport.not_authenticated"
internal const val ANDROID_CANONICAL_TRANSPORT_NOT_AUTHORIZED =
    "transport.not_authorized"
internal const val ANDROID_CANONICAL_TRANSPORT_REVISION_CONFLICT =
    "transport.revision_conflict"
internal const val ANDROID_CANONICAL_TRANSPORT_SUBMISSION_REJECTED =
    "transport.submission_rejected"
internal const val ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE =
    "transport.unavailable"
/**
 * The website refused a time more than 12 % faster than the World Record. Like any
 * other refusal it is never retried automatically: the Player checks the numbers.
 */
internal const val ANDROID_CANONICAL_TRANSPORT_TIME_IMPLAUSIBLE =
    "transport.time_implausible"
/** ADR-0225: the receiving community does not take times carried from another one (403). */
internal const val ANDROID_CANONICAL_TRANSPORT_CARRIED_TIMES_DISABLED =
    "transport.carried_times_disabled"
/** ADR-0225: a time carried to the community it came from (400). */
internal const val ANDROID_CANONICAL_TRANSPORT_CARRIED_FROM_SELF =
    "transport.carried_from_self"
/**
 * The two answers with which a receiving community refuses a carried copy for good. Such a copy is not waiting
 * to be sent: it is shown as not accepted, can be removed, and never blocks forgetting that community.
 */
internal val ANDROID_CARRIED_REFUSAL_FAILURES = setOf(
    ANDROID_CANONICAL_TRANSPORT_CARRIED_TIMES_DISABLED,
    ANDROID_CANONICAL_TRANSPORT_CARRIED_FROM_SELF,
)

/** Whether a saved result still waits to reach its community (ADR-0225: refused carried copies do not). */
internal fun androidOutboxCountsAsUnsent(state: AndroidOutboxStoredState, failureCode: String?): Boolean =
    state != AndroidOutboxStoredState.SYNCED &&
        !(state == AndroidOutboxStoredState.FAILED && failureCode in ANDROID_CARRIED_REFUSAL_FAILURES)

internal const val ANDROID_CANONICAL_REFUSAL_MAX_BYTES = 1_024
private const val ANDROID_TIME_IMPLAUSIBLE_CODE = "time_trial_time_implausible"

internal data class AndroidCanonicalSubmissionRequest(
    val method: String,
    val path: String,
    val headers: Map<String, String>,
    val body: String,
    val responseMaxBytes: Int,
    val followRedirects: Boolean,
    val automaticRetryAllowed: Boolean,
)

internal data class AndroidCanonicalSubmissionResponse(
    val statusCode: Int,
    val contentType: String?,
    val declaredContentLength: Long?,
    val body: ByteArray,
)

internal fun interface AndroidAuthenticatedCanonicalSubmissionRequestExecutor {
    fun execute(request: AndroidCanonicalSubmissionRequest): AndroidCanonicalSubmissionResponse
}

internal fun createAndroidCanonicalSubmissionRequestTransport(
    executor: AndroidAuthenticatedCanonicalSubmissionRequestExecutor,
): AndroidAuthenticatedCanonicalSubmissionTransport =
    AndroidCanonicalSubmissionRequestTransport(executor)

private class AndroidCanonicalSubmissionRequestTransport(
    private val executor: AndroidAuthenticatedCanonicalSubmissionRequestExecutor,
) : AndroidAuthenticatedCanonicalSubmissionTransport {
    override fun submit(submission: JsonObject): JsonObject {
        val canonical = try {
            AndroidProducedSubmissionValidator.validate(submission)
            requestJson.parseToJsonElement(submission.toString()) as JsonObject
        } catch (_: Exception) {
            fail(ANDROID_DELIVERY_FAILURE_TRANSPORT_FAILED)
        }
        val body = canonical.toString()
        if (body.toByteArray(Charsets.UTF_8).size > LOCAL_OUTBOX_MAX_SUBMISSION_BYTES) {
            fail(ANDROID_DELIVERY_FAILURE_TRANSPORT_FAILED)
        }
        val request = AndroidCanonicalSubmissionRequest(
            method = "POST",
            path = ANDROID_CANONICAL_SUBMISSION_PATH,
            headers = mapOf(
                "Accept" to "application/json",
                "Content-Type" to "application/json",
            ),
            body = body,
            responseMaxBytes = ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES,
            followRedirects = false,
            automaticRetryAllowed = false,
        )
        val response = try {
            executor.execute(request)
        } catch (_: Exception) {
            fail(ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE)
        }
        if (response.statusCode == 200) return parseCarriedFill(response, canonical)
        if (response.statusCode == 409) carriedAlreadyThere(response.body, canonical)?.let { return it }
        if (response.statusCode != 201) mapStatus(response.statusCode, response.body)
        return parseAcknowledgement(response, canonical)
    }
}

private val requestJson = Json { ignoreUnknownKeys = false }
private val jsonContentTypePattern = Regex(
    "^application/json(?:[ ]*;[\\x20-\\x7e]+)?$",
    RegexOption.IGNORE_CASE,
)
private val positiveIntegerPattern = Regex("^[1-9][0-9]*$")

private fun parseAcknowledgement(
    response: AndroidCanonicalSubmissionResponse,
    expected: JsonObject,
): JsonObject {
    if (
        response.contentType?.let {
            it.length <= 256 && it.matches(jsonContentTypePattern)
        } != true ||
        response.declaredContentLength?.let {
            it < 0 || it > ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES
        } == true ||
        response.body.isEmpty() ||
        response.body.size > ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES
    ) {
        fail(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID)
    }
    val text = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(response.body))
            .toString()
    } catch (_: Exception) {
        fail(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID)
    }
    val acknowledgement = try {
        requestJson.parseToJsonElement(text) as JsonObject
    } catch (_: Exception) {
        fail(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID)
    }
    val submissionId = acknowledgement.stringValue("submissionId")
    val revision = acknowledgement.positiveIntegerValue("revision")
    if (
        acknowledgement.keys - setOf("feedback") != setOf("submissionId", "revision") ||
        submissionId != expected.stringValue("submissionId") ||
        revision != expected.positiveIntegerValue("revision")
    ) {
        fail(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID)
    }
    // The feedback block is presentation only: a malformed one is dropped
    // rather than failing a publication the site has already accepted.
    val feedback = acknowledgement["feedback"]
        ?.takeIf { androidSubmissionFeedbackOrNull(it) != null } as? JsonObject
    return JsonObject(
        buildMap {
            put("submissionId", acknowledgement.getValue("submissionId"))
            put("revision", acknowledgement.getValue("revision"))
            if (feedback != null) put("feedback", feedback)
        },
    )
}

private fun mapStatus(statusCode: Int, body: ByteArray = byteArrayOf()): Nothing = when (statusCode) {
    400 -> fail(
        when (refusalCode(body)) {
            ANDROID_TIME_IMPLAUSIBLE_CODE -> ANDROID_CANONICAL_TRANSPORT_TIME_IMPLAUSIBLE
            "carried_from_self" -> ANDROID_CANONICAL_TRANSPORT_CARRIED_FROM_SELF
            else -> ANDROID_CANONICAL_TRANSPORT_SUBMISSION_REJECTED
        },
    )
    401 -> fail(ANDROID_CANONICAL_TRANSPORT_NOT_AUTHENTICATED)
    403 -> fail(
        if (refusalCode(body) == "carried_times_disabled") ANDROID_CANONICAL_TRANSPORT_CARRIED_TIMES_DISABLED
        else ANDROID_CANONICAL_TRANSPORT_NOT_AUTHORIZED,
    )
    409 -> fail(ANDROID_CANONICAL_TRANSPORT_REVISION_CONFLICT)
    404, 413, 415 -> fail(ANDROID_CANONICAL_TRANSPORT_SUBMISSION_REJECTED)
    408, 425, 429 -> fail(ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE)
    in 500..599 -> fail(ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE)
    else -> fail(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID)
}

/** The `code` of a refusal's JSON body, or null for anything that is not one. */
private fun refusalCode(body: ByteArray): String? = try {
    if (body.isEmpty() || body.size > ANDROID_CANONICAL_REFUSAL_MAX_BYTES) null
    else ((requestJson.parseToJsonElement(body.toString(Charsets.UTF_8)) as? JsonObject)
        ?.get("code") as? JsonPrimitive)?.takeIf { it.isString }?.content
} catch (_: Exception) {
    null
}

/** The Player-facing sentence for a delivery failure that has one (the Web's words). */
internal fun androidSubmissionFailureMessage(code: String?, language: String): String? {
    val product = AndroidProductLanguage.fromCode(language) ?: AndroidProductLanguage.ENGLISH
    return androidSubmissionFailureMessage(code, language, product)
}

private fun androidSubmissionFailureMessage(code: String?, language: String, product: AndroidProductLanguage): String? = when (code) {
    ANDROID_CANONICAL_TRANSPORT_TIME_IMPLAUSIBLE -> if (language == "nl") {
        "De voorgestelde tijd is zeer onwaarschijnlijk, controleer alle gegevens nog eens."
    } else {
        "The proposed time is highly unreasonable, please double check all information."
    }
    ANDROID_CANONICAL_TRANSPORT_CARRIED_TIMES_DISABLED -> androidText(
        product,
        "This community does not accept times from other communities.",
        "Deze community neemt geen tijden van andere communities aan.",
    )
    ANDROID_CANONICAL_TRANSPORT_CARRIED_FROM_SELF -> androidText(
        product,
        "This time already comes from this community.",
        "Deze tijd komt al uit deze community.",
    )
    else -> null
}

private fun fail(code: String): Nothing =
    throw AndroidCanonicalDeliveryTransportException(code)

private fun JsonObject.stringValue(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.positiveIntegerValue(name: String): Long? =
    (this[name] as? JsonPrimitive)
        ?.takeIf { !it.isString }
        ?.content
        ?.takeIf { it.matches(positiveIntegerPattern) }
        ?.toLongOrNull()

/** ADR-0225 amendment 3: the two 409 answers that mean a carried copy is already there. */
internal const val ANDROID_CARRIED_DUPLICATE_CODE = "carried_duplicate"
internal const val ANDROID_CARRIED_NOTHING_TO_FILL_CODE = "carried_nothing_to_fill"
internal const val ANDROID_CARRIED_FILL_SCHEMA = "mk8dx.carried-fill.v1"

/** The fields an equal run may have had filled in, in the order the site names them. */
internal val ANDROID_CARRIED_FILLABLE_FIELDS = listOf(
    "characterId", "characterVariantId", "bodyId", "bodyVariantId", "tireId", "gliderId", "gliderVariantId",
    "laps", "coins", "mushrooms",
)

/** What became of a carried copy that the receiving community did not store as a new run. */
internal data class AndroidCarriedOutcome(val alreadyThere: Boolean, val filledFields: List<String>)

internal fun androidCarriedOutcomeOrNull(element: Any?): AndroidCarriedOutcome? {
    val root = element as? JsonObject ?: return null
    return when ((root["carriedOutcome"] as? JsonPrimitive)?.takeIf { it.isString }?.content) {
        "already_there" -> AndroidCarriedOutcome(true, emptyList())
        "filled" -> AndroidCarriedOutcome(
            false,
            (root["filledFields"] as? kotlinx.serialization.json.JsonArray).orEmpty()
                .mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
                .filter { it in ANDROID_CARRIED_FILLABLE_FIELDS },
        )
        else -> null
    }
}

private fun carriedAcknowledgement(expected: JsonObject, carried: JsonObject): JsonObject = JsonObject(
    mapOf(
        "submissionId" to expected.getValue("submissionId"),
        "revision" to expected.getValue("revision"),
        "carried" to carried,
    ),
)

/** A 409 duplicate or nothing-to-fill for a carried copy is done, not failed. */
private fun carriedAlreadyThere(body: ByteArray, expected: JsonObject): JsonObject? {
    if (expected["carriedFrom"] !is JsonObject) return null
    val code = refusalCode(body)
    if (code != ANDROID_CARRIED_DUPLICATE_CODE && code != ANDROID_CARRIED_NOTHING_TO_FILL_CODE) return null
    return carriedAcknowledgement(expected, JsonObject(mapOf(
        "carriedOutcome" to JsonPrimitive("already_there"), "code" to JsonPrimitive(code),
    )))
}

/** 200 `mk8dx.carried-fill.v1`: the carried copy filled the empty fields of an equal run; it counts as sent. */
private fun parseCarriedFill(response: AndroidCanonicalSubmissionResponse, expected: JsonObject): JsonObject {
    if (expected["carriedFrom"] !is JsonObject ||
        response.body.isEmpty() || response.body.size > ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES
    ) {
        fail(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID)
    }
    val document = try {
        requestJson.parseToJsonElement(response.body.toString(Charsets.UTF_8)) as JsonObject
    } catch (_: Exception) {
        fail(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID)
    }
    if (document.stringValue("schemaVersion") != ANDROID_CARRIED_FILL_SCHEMA) fail(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID)
    val named = (document["filledFields"] ?: document["filled"]) as? kotlinx.serialization.json.JsonArray
    val fields = named.orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
        .filter { it in ANDROID_CARRIED_FILLABLE_FIELDS }.distinct()
    return carriedAcknowledgement(expected, JsonObject(mapOf(
        "carriedOutcome" to JsonPrimitive("filled"),
        "filledFields" to kotlinx.serialization.json.JsonArray(fields.map(::JsonPrimitive)),
    )))
}
