package nl.mariokart8.mk8dxtimetrials.auth

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

private class QueueExecutor(
    responses: List<AndroidAuthenticationResponse>,
) : AndroidAuthenticationRequestExecutor {
    val requests = mutableListOf<AndroidAuthenticationRequest>()
    private val queue = ArrayDeque(responses)

    override fun execute(request: AndroidAuthenticationRequest): AndroidAuthenticationResponse {
        requests += request
        return queue.removeFirst()
    }
}

internal fun response(status: Int, body: String) = AndroidAuthenticationResponse(
    statusCode = status,
    contentType = "application/json; charset=utf-8",
    body = body.toByteArray(),
)

internal const val token = "abcdefghijklmnopqrstuvwxyzABCDEF"
internal const val deviceCode = "abcdefghijklmnopqrstuvwxyz1234567890ABCD"

class AndroidDeviceAuthorizationClientTest {
    @Test
    fun requestsAllowlistedBrowserDeviceAuthorization() {
        val executor = QueueExecutor(
            listOf(
                response(
                    200,
                    """{"device_code":"$deviceCode","user_code":"ABCD-1234","verification_uri":"https://example.invalid/device","verification_uri_complete":"https://example.invalid/device?user_code=ABCD-1234","expires_in":600,"interval":5}""",
                ),
            ),
        )
        val client = AndroidDeviceAuthorizationClient(
            URI("https://example.invalid"),
            executor,
        )
        val pending = client.requestDeviceAuthorization()

        assertEquals("ABCD-1234", pending.userCode)
        assertEquals(600, pending.expiresInSeconds)
        assertEquals(ANDROID_AUTH_DEVICE_CODE_PATH, executor.requests.single().path)
        assertEquals(
            """{"client_id":"mk8dx.timetrials.android.v1"}""",
            executor.requests.single().body,
        )
    }

    @Test
    fun rejectsBrowserHandoffOutsideConfiguredOrigin() {
        val executor = QueueExecutor(
            listOf(
                response(
                    200,
                    """{"device_code":"$deviceCode","user_code":"ABCD-1234","verification_uri":"https://example.invalid/device","verification_uri_complete":"https://evil.example/device?user_code=ABCD-1234","expires_in":600,"interval":5}""",
                ),
            ),
        )
        assertThrows(AndroidAuthenticationException::class.java) {
            AndroidDeviceAuthorizationClient(
                URI("https://example.invalid"),
                executor,
            ).requestDeviceAuthorization()
        }
    }

    @Test
    fun rejectsMalformedBrowserQueryAsABoundedAuthenticationFailure() {
        val executor = QueueExecutor(
            listOf(
                response(
                    200,
                    """{"device_code":"$deviceCode","user_code":"ABCD-1234","verification_uri":"https://example.invalid/device","verification_uri_complete":"https://example.invalid/device?user_code=%ZZ","expires_in":600,"interval":5}""",
                ),
            ),
        )
        assertThrows(AndroidAuthenticationException::class.java) {
            AndroidDeviceAuthorizationClient(
                URI("https://example.invalid"),
                executor,
            ).requestDeviceAuthorization()
        }
    }

    @Test
    fun mapsPendingSlowDeniedExpiredAndAuthorizedPolling() {
        val executor = QueueExecutor(
            listOf(
                response(400, """{"error":"authorization_pending","error_description":"pending"}"""),
                response(400, """{"error":"slow_down","error_description":"slow"}"""),
                response(400, """{"error":"access_denied","error_description":"denied"}"""),
                response(400, """{"error":"expired_token","error_description":"expired"}"""),
                response(
                    200,
                    """{"access_token":"$token","token_type":"Bearer","expires_in":3600,"scope":""}""",
                ),
            ),
        )
        val client = AndroidDeviceAuthorizationClient(
            URI("https://example.invalid"),
            executor,
        )
        assertTrue(client.poll(deviceCode) is AndroidDeviceTokenPollResult.Pending)
        assertTrue(client.poll(deviceCode) is AndroidDeviceTokenPollResult.SlowDown)
        assertTrue(client.poll(deviceCode) is AndroidDeviceTokenPollResult.Denied)
        assertTrue(client.poll(deviceCode) is AndroidDeviceTokenPollResult.Expired)
        assertEquals(
            AndroidDeviceTokenPollResult.Authorized(token, 3600),
            client.poll(deviceCode),
        )
    }

    @Test
    fun establishesOnlyAClaimedPlayerSessionAndRevokesIt() {
        val executor = QueueExecutor(
            listOf(
                response(
                    200,
                    """{"schemaVersion":"mk8dx.native-time-trial-bootstrap.v2","playerId":"player.synthetic_01","username":"synthetic01","displayName":"Synthetic 01"}""",
                ),
                response(200, """{"success":true}"""),
            ),
        )
        val client = AndroidDeviceAuthorizationClient(
            URI("https://example.invalid"),
            executor,
            clock = { 1_000_000 },
        )
        assertEquals(
            AndroidAuthenticatedNativeSession(
                token, 4_600_000, "player.synthetic_01", "synthetic01", "Synthetic 01",
            ),
            client.establishSession(token, 3600),
        )
        client.revoke(token)
        assertEquals("Bearer", "Bearer")
        assertEquals(token, executor.requests[0].bearerToken)
        assertEquals(token, executor.requests[1].bearerToken)
    }

    @Test
    fun rejectsUnclaimedOrMalformedBootstrapWithoutPersistableSession() {
        for (candidate in listOf(
            response(403, """{"code":"native_time_trial_player_required","message":"required"}"""),
            response(
                200,
                """{"schemaVersion":"mk8dx.native-time-trial-bootstrap.v2","playerId":"bad","username":"synthetic01","displayName":"Synthetic 01"}""",
            ),
        )) {
            val client = AndroidDeviceAuthorizationClient(
                URI("https://example.invalid"),
                QueueExecutor(listOf(candidate)),
                clock = { 1_000_000 },
            )
            assertThrows(AndroidAuthenticationException::class.java) {
                client.establishSession(token, 3600)
            }
        }
    }

    @Test
    fun namesTheMissingPlayerStateAndHandsOverTheWebsiteSetupRoute() {
        // An authenticated account without a verified Player is not a generic
        // failure: it carries the website's create-or-claim route so the
        // screen can hand the person to the one place that resolves it.
        val client = AndroidDeviceAuthorizationClient(
            URI("https://example.invalid"),
            QueueExecutor(listOf(
                response(403, """{"code":"native_time_trial_player_required","message":"required"}"""),
            )),
            clock = { 1_000_000 },
        )
        val setup = assertThrows(AndroidPlayerSetupRequiredException::class.java) {
            client.establishSession(token, 3600)
        }
        assertEquals(URI("https://example.invalid/?welcome=1"), setup.playerSetupUri)
    }

    @Test
    fun keepsOtherForbiddenBootstrapAnswersAsGenericFailures() {
        val client = AndroidDeviceAuthorizationClient(
            URI("https://example.invalid"),
            QueueExecutor(listOf(
                response(403, """{"code":"forbidden","message":"no"}"""),
            )),
            clock = { 1_000_000 },
        )
        val failure = assertThrows(AndroidAuthenticationException::class.java) {
            client.establishSession(token, 3600)
        }
        assertTrue(failure !is AndroidPlayerSetupRequiredException)
    }
}
