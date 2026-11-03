package nl.mariokart8.mk8dxtimetrials.outbox

import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

internal const val ANDROID_CANONICAL_HTTPS_DEFAULT_CONNECT_TIMEOUT_MS = 10_000
internal const val ANDROID_CANONICAL_HTTPS_DEFAULT_READ_TIMEOUT_MS = 15_000

private const val ANDROID_CANONICAL_HTTPS_MAX_ORIGIN_CHARACTERS = 2_048
private const val ANDROID_CANONICAL_HTTPS_MAX_TIMEOUT_MS = 60_000
private const val ANDROID_CANONICAL_HTTPS_INVALID_CONFIGURATION =
    "Invalid canonical submission HTTPS configuration"
private const val ANDROID_CANONICAL_HTTPS_INVALID_REQUEST =
    "Invalid canonical submission HTTPS request"

private val httpsRequestJson = Json { ignoreUnknownKeys = false }

internal fun interface AndroidAuthenticatedHttpsConnectionFactory {
    fun open(url: URL): HttpsURLConnection
}

internal class AndroidCanonicalSubmissionHttpsExecutor(
    origin: String,
    private val connectionFactory: AndroidAuthenticatedHttpsConnectionFactory,
    private val connectTimeoutMs: Int = ANDROID_CANONICAL_HTTPS_DEFAULT_CONNECT_TIMEOUT_MS,
    private val readTimeoutMs: Int = ANDROID_CANONICAL_HTTPS_DEFAULT_READ_TIMEOUT_MS,
) : AndroidAuthenticatedCanonicalSubmissionRequestExecutor {
    private val targetUri = canonicalSubmissionTarget(origin)

    init {
        if (
            connectTimeoutMs !in 1..ANDROID_CANONICAL_HTTPS_MAX_TIMEOUT_MS ||
            readTimeoutMs !in 1..ANDROID_CANONICAL_HTTPS_MAX_TIMEOUT_MS
        ) {
            invalidConfiguration()
        }
    }

    override fun execute(
        request: AndroidCanonicalSubmissionRequest,
    ): AndroidCanonicalSubmissionResponse {
        val body = validateRequest(request)
        val connection = connectionFactory.open(targetUri.toURL())
        try {
            if (connection.url.toURI() != targetUri) invalidConfiguration()
            configure(connection, request, body.size)
            connection.outputStream.use { output ->
                output.write(body)
            }
            val statusCode = connection.responseCode
            if (statusCode != 201) {
                // A 400 carries the refusal's code (the 12 % World Record guard names itself), so up
                // to 1 KB of it is kept; every other error body is still ignored.
                val refusal = if (statusCode == 400) readErrorStream(connection) else {
                    closeErrorStream(connection)
                    byteArrayOf()
                }
                return AndroidCanonicalSubmissionResponse(
                    statusCode = statusCode,
                    contentType = null,
                    declaredContentLength = null,
                    body = refusal,
                )
            }

            val contentType = connection.contentType
            val declaredLength = connection.contentLengthLong.takeUnless { it == -1L }
            val responseBody = if (
                declaredLength != null &&
                declaredLength > request.responseMaxBytes
            ) {
                byteArrayOf()
            } else {
                connection.inputStream.use { input ->
                    readAtMost(input, request.responseMaxBytes + 1)
                }
            }
            return AndroidCanonicalSubmissionResponse(
                statusCode = statusCode,
                contentType = contentType,
                declaredContentLength = declaredLength,
                body = responseBody,
            )
        } finally {
            try {
                connection.disconnect()
            } catch (_: Exception) {
                // Cleanup detail must not replace the bounded transport result.
            }
        }
    }

    private fun configure(
        connection: HttpsURLConnection,
        request: AndroidCanonicalSubmissionRequest,
        bodySize: Int,
    ) {
        connection.requestMethod = request.method
        connection.instanceFollowRedirects = false
        connection.doInput = true
        connection.doOutput = true
        connection.useCaches = false
        connection.allowUserInteraction = false
        connection.connectTimeout = connectTimeoutMs
        connection.readTimeout = readTimeoutMs
        request.headers.forEach(connection::setRequestProperty)
        connection.setFixedLengthStreamingMode(bodySize)
    }
}

private fun canonicalSubmissionTarget(origin: String): URI {
    if (
        origin.isEmpty() ||
        origin.length > ANDROID_CANONICAL_HTTPS_MAX_ORIGIN_CHARACTERS
    ) {
        invalidConfiguration()
    }
    val parsed = try {
        URI(origin)
    } catch (_: Exception) {
        invalidConfiguration()
    }
    if (
        parsed.isOpaque ||
        !parsed.scheme.equals("https", ignoreCase = true) ||
        parsed.host.isNullOrEmpty() ||
        parsed.rawUserInfo != null ||
        parsed.rawQuery != null ||
        parsed.rawFragment != null ||
        parsed.rawPath !in setOf("", "/") ||
        parsed.port != -1 && parsed.port !in 1..65_535
    ) {
        invalidConfiguration()
    }
    return try {
        URI(
            "https",
            null,
            parsed.host,
            parsed.port,
            ANDROID_CANONICAL_SUBMISSION_PATH,
            ANDROID_CANONICAL_SUBMISSION_FEEDBACK_QUERY,
            null,
        )
    } catch (_: Exception) {
        invalidConfiguration()
    }
}

private fun validateRequest(request: AndroidCanonicalSubmissionRequest): ByteArray {
    if (
        request.method != "POST" ||
        request.path != ANDROID_CANONICAL_SUBMISSION_PATH ||
        request.headers != mapOf(
            "Accept" to "application/json",
            "Content-Type" to "application/json",
        ) ||
        request.responseMaxBytes != ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES ||
        request.followRedirects ||
        request.automaticRetryAllowed
    ) {
        invalidRequest()
    }
    val body = request.body.toByteArray(Charsets.UTF_8)
    if (body.isEmpty() || body.size > LOCAL_OUTBOX_MAX_SUBMISSION_BYTES) invalidRequest()
    val canonical = try {
        httpsRequestJson.parseToJsonElement(request.body) as JsonObject
    } catch (_: Exception) {
        invalidRequest()
    }
    try {
        AndroidProducedSubmissionValidator.validate(canonical)
    } catch (_: Exception) {
        invalidRequest()
    }
    if (canonical.toString() != request.body) invalidRequest()
    return body
}

private fun readAtMost(input: java.io.InputStream, limit: Int): ByteArray {
    val output = ByteArrayOutputStream(minOf(limit, 1_024))
    val buffer = ByteArray(1_024)
    while (output.size() < limit) {
        val count = input.read(buffer, 0, minOf(buffer.size, limit - output.size()))
        if (count <= 0) break
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}

private fun readErrorStream(connection: HttpsURLConnection): ByteArray = try {
    connection.errorStream?.use { readAtMost(it, ANDROID_CANONICAL_REFUSAL_MAX_BYTES) } ?: byteArrayOf()
} catch (_: Exception) {
    byteArrayOf()
}

private fun closeErrorStream(connection: HttpsURLConnection) {
    try {
        connection.errorStream?.close()
    } catch (_: Exception) {
        // Error bodies and their failure detail are deliberately ignored.
    }
}

private fun invalidConfiguration(): Nothing =
    throw IllegalArgumentException(ANDROID_CANONICAL_HTTPS_INVALID_CONFIGURATION)

private fun invalidRequest(): Nothing =
    throw IllegalArgumentException(ANDROID_CANONICAL_HTTPS_INVALID_REQUEST)
