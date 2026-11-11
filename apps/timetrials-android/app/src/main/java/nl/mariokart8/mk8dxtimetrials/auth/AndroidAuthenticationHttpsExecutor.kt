package nl.mariokart8.mk8dxtimetrials.auth

import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URL
import javax.net.ssl.HttpsURLConnection

internal const val ANDROID_AUTH_CONNECT_TIMEOUT_MS = 10_000
internal const val ANDROID_AUTH_READ_TIMEOUT_MS = 15_000

private val allowedRequests = setOf(
    "POST $ANDROID_AUTH_DEVICE_CODE_PATH",
    "POST $ANDROID_AUTH_DEVICE_TOKEN_PATH",
    "GET $ANDROID_AUTH_NATIVE_BOOTSTRAP_PATH",
    "POST $ANDROID_AUTH_SIGN_OUT_PATH",
    "POST $ANDROID_NATIVE_REMEMBER_PATH",
    "GET $ANDROID_NATIVE_REMEMBERED_ACCOUNTS_PATH",
    "POST $ANDROID_NATIVE_ACCOUNT_SWITCH_PATH",
    "POST $ANDROID_NATIVE_FORGET_PATH",
)
/** The routes that only exist for a remembered app device. */
private val accountDevicePaths = setOf(
    ANDROID_NATIVE_REMEMBER_PATH,
    ANDROID_NATIVE_REMEMBERED_ACCOUNTS_PATH,
    ANDROID_NATIVE_ACCOUNT_SWITCH_PATH,
    ANDROID_NATIVE_FORGET_PATH,
)
private val bearerPattern = Regex("^[A-Za-z0-9_-]{20,255}$")

internal fun interface AndroidHttpsConnectionOpener {
    fun open(url: URL): HttpsURLConnection
}

internal class AndroidAuthenticationHttpsExecutor(
    origin: String,
    private val opener: AndroidHttpsConnectionOpener,
    private val connectTimeoutMs: Int = ANDROID_AUTH_CONNECT_TIMEOUT_MS,
    private val readTimeoutMs: Int = ANDROID_AUTH_READ_TIMEOUT_MS,
) : AndroidAuthenticationRequestExecutor {
    private val origin = exactOrigin(origin)

    init {
        require(connectTimeoutMs in 1..60_000 && readTimeoutMs in 1..60_000)
    }

    override fun execute(request: AndroidAuthenticationRequest): AndroidAuthenticationResponse {
        validate(request)
        val target = origin.resolve(request.path)
        val connection = opener.open(target.toURL())
        try {
            if (connection.url.toURI() != target) invalidConfiguration()
            connection.requestMethod = request.method
            connection.instanceFollowRedirects = false
            connection.doInput = true
            connection.useCaches = false
            connection.allowUserInteraction = false
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.setRequestProperty("Accept", "application/json")
            request.bearerToken?.let {
                connection.setRequestProperty("Authorization", "Bearer $it")
            }
            request.accountDevice?.let {
                connection.setRequestProperty("X-MK8DX-Account-Device", it)
            }
            if (request.keepRemembered) {
                connection.setRequestProperty("X-MK8DX-Keep-Remembered", "1")
            }
            request.body?.let { body ->
                val bytes = body.toByteArray(Charsets.UTF_8)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            val declared = connection.contentLengthLong.takeUnless { it == -1L }
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = if (declared != null && declared > request.responseMaxBytes) {
                stream?.close()
                byteArrayOf()
            } else {
                stream?.use { readAtMost(it, request.responseMaxBytes + 1) } ?: byteArrayOf()
            }
            return AndroidAuthenticationResponse(status, connection.contentType, body)
        } finally {
            try {
                connection.disconnect()
            } catch (_: Exception) {
                // Cleanup detail is private and must not replace the bounded result.
            }
        }
    }
}

private fun validate(request: AndroidAuthenticationRequest) {
    if ("${request.method} ${request.path}" !in allowedRequests ||
        request.responseMaxBytes != ANDROID_AUTH_RESPONSE_MAX_BYTES ||
        request.body?.toByteArray(Charsets.UTF_8)?.size?.let { it !in 2..4_096 } == true ||
        request.bearerToken?.matches(bearerPattern) == false ||
        (request.path in setOf(ANDROID_AUTH_NATIVE_BOOTSTRAP_PATH, ANDROID_AUTH_SIGN_OUT_PATH,
            ANDROID_NATIVE_REMEMBER_PATH) && request.bearerToken == null) ||
        (request.path in setOf(ANDROID_AUTH_DEVICE_CODE_PATH, ANDROID_AUTH_DEVICE_TOKEN_PATH,
            ANDROID_NATIVE_FORGET_PATH) && request.bearerToken != null) ||
        request.accountDevice?.matches(androidAccountDevicePattern) == false ||
        (request.path in accountDevicePaths && request.accountDevice == null) ||
        (request.accountDevice != null && request.path !in accountDevicePaths &&
            request.path != ANDROID_AUTH_SIGN_OUT_PATH) ||
        (request.keepRemembered && request.path != ANDROID_AUTH_SIGN_OUT_PATH) ||
        (request.method == "GET") != (request.body == null)) {
        throw AndroidAuthenticationException("Android authentication request is invalid.")
    }
}

private fun exactOrigin(value: String): URI {
    val parsed = try {
        URI(value)
    } catch (_: Exception) {
        invalidConfiguration()
    }
    if (parsed.isOpaque || parsed.scheme != "https" || parsed.host.isNullOrEmpty() ||
        parsed.rawUserInfo != null || parsed.rawPath !in setOf("", "/") ||
        parsed.rawQuery != null || parsed.rawFragment != null ||
        parsed.port != -1 && parsed.port !in 1..65_535) {
        invalidConfiguration()
    }
    return URI("https", null, parsed.host, parsed.port, "/", null, null)
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

private fun invalidConfiguration(): Nothing =
    throw IllegalArgumentException("Invalid Android authentication HTTPS configuration")
