package nl.mariokart8.mk8dxtimetrials.outbox

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

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
        if (refusalCode(body) == ANDROID_TIME_IMPLAUSIBLE_CODE) ANDROID_CANONICAL_TRANSPORT_TIME_IMPLAUSIBLE
        else ANDROID_CANONICAL_TRANSPORT_SUBMISSION_REJECTED,
    )
    401 -> fail(ANDROID_CANONICAL_TRANSPORT_NOT_AUTHENTICATED)
    403 -> fail(ANDROID_CANONICAL_TRANSPORT_NOT_AUTHORIZED)
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
internal fun androidSubmissionFailureMessage(code: String?, language: String): String? = when (code) {
    ANDROID_CANONICAL_TRANSPORT_TIME_IMPLAUSIBLE -> if (language == "nl") {
        "De voorgestelde tijd is zeer onwaarschijnlijk, controleer alle gegevens nog eens."
    } else {
        "The proposed time is highly unreasonable, please double check all information."
    }
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
