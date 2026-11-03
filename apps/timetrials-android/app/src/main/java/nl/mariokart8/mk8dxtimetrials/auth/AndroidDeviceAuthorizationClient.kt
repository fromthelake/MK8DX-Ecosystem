package nl.mariokart8.mk8dxtimetrials.auth

import java.net.URI
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal const val ANDROID_AUTH_CLIENT_ID = "mk8dx.timetrials.android.v1"
internal const val ANDROID_AUTH_DEVICE_CODE_PATH = "/api/auth/device/code"
internal const val ANDROID_AUTH_DEVICE_TOKEN_PATH = "/api/auth/device/token"
// The v2 bootstrap names the Player (username + display name) so the app can
// stop presenting raw canonical identifiers. v1 remains served for
// already-installed builds whose parsers reject unknown keys.
internal const val ANDROID_AUTH_NATIVE_BOOTSTRAP_PATH =
    "/v1/time-trial-submissions/native-bootstrap-v2"
internal const val ANDROID_AUTH_SIGN_OUT_PATH = "/api/auth/sign-out"
internal const val ANDROID_AUTH_RESPONSE_MAX_BYTES = 16_384

private const val deviceGrantType = "urn:ietf:params:oauth:grant-type:device_code"
private val authJson = Json { ignoreUnknownKeys = false }
private val tokenPattern = Regex("^[A-Za-z0-9_-]{20,255}$")
private val userCodePattern = Regex("^[A-Za-z0-9-]{4,32}$")
private val deviceCodePattern = Regex("^[A-Za-z0-9_-]{20,255}$")
private val playerIdPattern = Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")
private val playerUsernamePattern = Regex("^[a-z0-9_-]{3,16}$")

internal data class AndroidAuthenticationRequest(
    val method: String,
    val path: String,
    val body: String?,
    val bearerToken: String?,
    val responseMaxBytes: Int = ANDROID_AUTH_RESPONSE_MAX_BYTES,
)

internal data class AndroidAuthenticationResponse(
    val statusCode: Int,
    val contentType: String?,
    val body: ByteArray,
)

internal fun interface AndroidAuthenticationRequestExecutor {
    fun execute(request: AndroidAuthenticationRequest): AndroidAuthenticationResponse
}

internal data class AndroidPendingDeviceAuthorization(
    val deviceCode: String,
    val userCode: String,
    val verificationUriComplete: URI,
    val expiresInSeconds: Long,
    val pollingIntervalSeconds: Long,
)

internal data class AndroidAuthenticatedNativeSession(
    val bearerToken: String,
    val expiresAtMs: Long,
    val playerId: String,
    /**
     * Public identity from the v2 bootstrap. Null only for sessions stored by
     * an older build; those fall back to the identifier until the Player
     * signs in again.
     */
    val username: String? = null,
    val displayName: String? = null,
)

private val uuidTail = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)

/**
 * The readable part of a canonical reference, and never a UUID: every Player
 * created through the API carries `player.<uuid>` as its identifier (the
 * migrated ones kept `player.<username>`), and a UUID on a screen reads as
 * an account without a name. When there is nothing readable, say "Player".
 */
internal fun androidReadableReference(reference: String): String {
    val tail = reference.substringAfterLast('.')
    return if (tail.isBlank() || uuidTail.matches(tail)) "Player" else tail
}

/** The name a person recognizes, never a raw canonical identifier. */
internal fun androidPlayerLabel(displayName: String?, playerId: String): String =
    displayName?.takeIf { it.isNotBlank() } ?: androidReadableReference(playerId)

internal sealed interface AndroidDeviceTokenPollResult {
    data object Pending : AndroidDeviceTokenPollResult
    data class SlowDown(val retryAfterSeconds: Long) : AndroidDeviceTokenPollResult
    data object Denied : AndroidDeviceTokenPollResult
    data object Expired : AndroidDeviceTokenPollResult
    data class Authorized(val bearerToken: String, val expiresInSeconds: Long) :
        AndroidDeviceTokenPollResult
}

internal open class AndroidAuthenticationException(message: String) : RuntimeException(message)

/**
 * The browser approval succeeded and the account is genuinely signed in, but
 * it has no verified Player yet — the one state a new person reaches on a
 * first APK sign-in. It carries the website's create-or-claim route so the
 * screen can hand the person to the one place that resolves it, instead of a
 * generic failure (the APK never invents a Player silently).
 */
internal class AndroidPlayerSetupRequiredException(val playerSetupUri: URI) :
    AndroidAuthenticationException("The signed-in account has no verified Player yet.")

internal class AndroidDeviceAuthorizationClient(
    private val origin: URI,
    private val executor: AndroidAuthenticationRequestExecutor,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    init {
        requireExactHttpsOrigin(origin)
    }

    fun requestDeviceAuthorization(): AndroidPendingDeviceAuthorization {
        val body = buildJsonObject { put("client_id", ANDROID_AUTH_CLIENT_ID) }.toString()
        val response = executor.execute(
            AndroidAuthenticationRequest(
                method = "POST",
                path = ANDROID_AUTH_DEVICE_CODE_PATH,
                body = body,
                bearerToken = null,
            ),
        )
        val document = response.document(200)
        if (document.keys != setOf(
                "device_code",
                "user_code",
                "verification_uri",
                "verification_uri_complete",
                "expires_in",
                "interval",
            )
        ) invalidResponse()
        val deviceCode = document.string("device_code")
        val userCode = document.string("user_code")
        val verification = document.string("verification_uri")
        val complete = document.string("verification_uri_complete")
        val expiresIn = document.positiveLong("expires_in", 60, 1_800)
        val interval = document.positiveLong("interval", 1, 60)
        if (!deviceCode.matches(deviceCodePattern) || !userCode.matches(userCodePattern)) {
            invalidResponse()
        }
        val verificationUri = parseUri(verification)
        val completeUri = parseUri(complete)
        if (verificationUri.scheme != "https" || verificationUri.authority != origin.authority ||
            verificationUri.path != "/device" || verificationUri.query != null ||
            completeUri.scheme != "https" || completeUri.authority != origin.authority ||
            completeUri.path != "/device" || completeUri.fragment != null ||
            !queryContainsUserCode(completeUri.rawQuery, userCode)) {
            invalidResponse()
        }
        return AndroidPendingDeviceAuthorization(
            deviceCode,
            userCode,
            completeUri,
            expiresIn,
            interval,
        )
    }

    fun poll(deviceCode: String): AndroidDeviceTokenPollResult {
        if (!deviceCode.matches(deviceCodePattern)) invalidInput()
        val response = executor.execute(
            AndroidAuthenticationRequest(
                method = "POST",
                path = ANDROID_AUTH_DEVICE_TOKEN_PATH,
                body = buildJsonObject {
                    put("grant_type", deviceGrantType)
                    put("device_code", deviceCode)
                    put("client_id", ANDROID_AUTH_CLIENT_ID)
                }.toString(),
                bearerToken = null,
            ),
        )
        if (response.statusCode == 200) {
            val document = response.document(200)
            if (document.keys != setOf("access_token", "token_type", "expires_in", "scope") ||
                document.string("token_type") != "Bearer") invalidResponse()
            val token = document.string("access_token")
            if (!token.matches(tokenPattern)) invalidResponse()
            return AndroidDeviceTokenPollResult.Authorized(
                token,
                document.positiveLong("expires_in", 60, 604_800),
            )
        }
        val error = response.document(400).string("error")
        return when (error) {
            "authorization_pending" -> AndroidDeviceTokenPollResult.Pending
            "slow_down" -> AndroidDeviceTokenPollResult.SlowDown(5)
            "access_denied" -> AndroidDeviceTokenPollResult.Denied
            "expired_token", "invalid_grant" -> AndroidDeviceTokenPollResult.Expired
            else -> invalidResponse()
        }
    }

    fun establishSession(token: String, expiresInSeconds: Long): AndroidAuthenticatedNativeSession {
        if (!token.matches(tokenPattern) || expiresInSeconds !in 60..604_800) invalidInput()
        val response = executor.execute(
            AndroidAuthenticationRequest(
                method = "GET",
                path = ANDROID_AUTH_NATIVE_BOOTSTRAP_PATH,
                body = null,
                bearerToken = token,
            ),
        )
        if (response.statusCode == 403 && response.errorCode() ==
            "native_time_trial_player_required") {
            throw AndroidPlayerSetupRequiredException(
                URI(origin.scheme, origin.authority, "/", "welcome=1", null),
            )
        }
        val document = response.document(200)
        if (document.keys != setOf("schemaVersion", "playerId", "username", "displayName") ||
            document.string("schemaVersion") != "mk8dx.native-time-trial-bootstrap.v2") {
            invalidResponse()
        }
        val playerId = document.string("playerId")
        if (playerId.length > 135 || !playerId.matches(playerIdPattern)) invalidResponse()
        val username = document.string("username")
        if (!username.matches(playerUsernamePattern)) invalidResponse()
        val displayName = document.string("displayName")
        if (displayName.isEmpty() || displayName.length > 64 ||
            displayName.any { it.code < 0x20 || it.code == 0x7f }) {
            invalidResponse()
        }
        val now = clock()
        val durationMs = try {
            Math.multiplyExact(expiresInSeconds, 1_000L)
        } catch (_: ArithmeticException) {
            invalidResponse()
        }
        val expiresAt = try {
            Math.addExact(now, durationMs)
        } catch (_: ArithmeticException) {
            invalidResponse()
        }
        if (now < 0 || expiresAt <= now) invalidResponse()
        return AndroidAuthenticatedNativeSession(token, expiresAt, playerId, username, displayName)
    }

    fun revoke(token: String) {
        if (!token.matches(tokenPattern)) invalidInput()
        val response = executor.execute(
            AndroidAuthenticationRequest(
                method = "POST",
                path = ANDROID_AUTH_SIGN_OUT_PATH,
                body = "{}",
                bearerToken = token,
            ),
        )
        val document = response.document(200)
        if (document.keys != setOf("success") ||
            (document["success"] as? JsonPrimitive)?.content != "true") {
            invalidResponse()
        }
    }
}

/** The `code` of a JSON error body, or null when there is none to read. */
private fun AndroidAuthenticationResponse.errorCode(): String? = try {
    (authJson.parseToJsonElement(body.toString(Charsets.UTF_8)) as? JsonObject)
        ?.get("code")
        ?.let { it as? JsonPrimitive }
        ?.takeIf { it.isString }
        ?.content
} catch (_: Exception) {
    null
}

private fun AndroidAuthenticationResponse.document(expectedStatus: Int): JsonObject {
    if (statusCode != expectedStatus ||
        contentType?.lowercase()?.matches(
            Regex("^application/json(?:\\s*;.*)?$"),
        ) != true || body.isEmpty() || body.size > ANDROID_AUTH_RESPONSE_MAX_BYTES) {
        invalidResponse()
    }
    return try {
        authJson.parseToJsonElement(body.toString(Charsets.UTF_8)) as JsonObject
    } catch (_: Exception) {
        invalidResponse()
    }
}

private fun JsonObject.string(name: String): String =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: invalidResponse()

private fun JsonObject.positiveLong(name: String, minimum: Long, maximum: Long): Long =
    (this[name] as? JsonPrimitive)
        ?.takeIf { !it.isString }
        ?.content
        ?.takeIf { it.matches(Regex("^[1-9][0-9]*$")) }
        ?.toLongOrNull()
        ?.takeIf { it in minimum..maximum }
        ?: invalidResponse()

private fun requireExactHttpsOrigin(origin: URI) {
    require(
        !origin.isOpaque && origin.scheme == "https" && !origin.host.isNullOrEmpty() &&
            origin.rawUserInfo == null && origin.rawPath in setOf("", "/") &&
            origin.rawQuery == null && origin.rawFragment == null &&
            (origin.port == -1 || origin.port in 1..65_535),
    )
}

private fun parseUri(value: String): URI = try {
    URI(value)
} catch (_: Exception) {
    invalidResponse()
}

private fun queryContainsUserCode(rawQuery: String?, code: String): Boolean = try {
    rawQuery?.split("&")?.any { part ->
        val pieces = part.split("=", limit = 2)
        pieces.size == 2 && pieces[0] == "user_code" &&
            java.net.URLDecoder.decode(pieces[1], Charsets.UTF_8.name()) == code
    } == true
} catch (_: IllegalArgumentException) {
    false
}

private fun invalidInput(): Nothing =
    throw AndroidAuthenticationException("Android authentication input is invalid.")

private fun invalidResponse(): Nothing =
    throw AndroidAuthenticationException("Android authentication response is invalid.")
