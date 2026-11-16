package nl.mariokart8.mk8dxtimetrials.auth

import java.net.URI
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import nl.mariokart8.mk8dxtimetrials.lan.AndroidOfflineInvitationCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val ORIGIN = "https://192.168.1.174"
private const val DEVICE = "D2vXq9yZk3mN8pR4tW6aB1cE5fH7jL0oQsUvYxZ0abc"
private const val TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"

private class InvitationStore : AndroidNativeSessionStore {
    val sessions = LinkedHashMap<String, AndroidAuthenticatedNativeSession>()
    private var active: String? = null
    override fun list(nowMs: Long): List<AndroidRememberedAccount> = emptyList()
    override fun load(slotId: String, nowMs: Long) = sessions[slotId]
    override fun save(slotId: String, session: AndroidAuthenticatedNativeSession) { sessions[slotId] = session }
    override fun remove(slotId: String) { sessions.remove(slotId) }
    override fun activeSlotId(): String? = active
    override fun setActiveSlotId(slotId: String?) { active = slotId }
    override fun accountDeviceValue(): String = DEVICE
}

/** The installation's two card routes in miniature; a card works once. */
private class CardServer(private val answer: Int = 200, private val code: String? = null) : AndroidAuthenticationRequestExecutor {
    val requests = mutableListOf<AndroidAuthenticationRequest>()
    private var used = false

    override fun execute(request: AndroidAuthenticationRequest): AndroidAuthenticationResponse {
        requests += request
        val body = request.body?.let { Json.parseToJsonElement(it) as JsonObject }
        return when (request.path) {
            ANDROID_NATIVE_INVITATION_PREVIEW_PATH, ANDROID_NATIVE_INVITATION_REDEEM_PATH -> {
                require(request.accountDevice == DEVICE && request.bearerToken == null)
                require(body!!.keys == setOf("token", "origin") && body["origin"]!!.jsonPrimitive.content == ORIGIN)
                if (answer != 200) return error(answer, code!!)
                if (body["token"]!!.jsonPrimitive.content != TOKEN || used) return error(401, "native_invitation_unavailable")
                if (request.path == ANDROID_NATIVE_INVITATION_PREVIEW_PATH) {
                    ok("""{"schemaVersion":"mk8dx.native-invitation-preview.v1","displayLabel":"Oma"}""")
                } else {
                    used = true
                    ok("""{"schemaVersion":"mk8dx.native-invitation-session.v1","token":"sessiontokenabcdefghijklmnop","expiresIn":604800}""")
                }
            }
            ANDROID_AUTH_NATIVE_BOOTSTRAP_PATH -> {
                require(request.bearerToken == "sessiontokenabcdefghijklmnop")
                ok("""{"schemaVersion":"mk8dx.native-time-trial-bootstrap.v2","playerId":"player.oma","username":"oma","displayName":"Oma"}""")
            }
            ANDROID_NATIVE_REMEMBER_PATH -> ok("""{"schemaVersion":"mk8dx.native-account-remember.v1","remembered":true}""")
            else -> error(404, "not_found")
        }
    }

    private fun ok(body: String) = AndroidAuthenticationResponse(200, "application/json", body.toByteArray())
    private fun error(status: Int, code: String) =
        AndroidAuthenticationResponse(status, "application/json", """{"code":"$code","message":"x"}""".toByteArray())
}

class AndroidInvitationSignInTest {
    private val now = 1_000_000L
    private val card = AndroidOfflineInvitationCard(ORIGIN, TOKEN)

    private fun controller(server: CardServer, store: InvitationStore) = AndroidAuthenticationController(
        AndroidDeviceAuthorizationClient(URI(ORIGIN), server, clock = { now }), store, clock = { now },
        diagnosticSink = {},
    )

    @Test fun previewThenSignInGivesTheSameSessionADeviceApprovalWould() {
        val server = CardServer()
        val store = InvitationStore()
        val controller = controller(server, store)
        assertEquals(AndroidInvitationResult.Preview("Oma"), controller.previewInvitation(card))
        val result = controller.signInWithInvitation(card)
        assertTrue(result is AndroidInvitationResult.Redeemed)
        val state = controller.state.value as AndroidAuthenticationState.SignedIn
        assertEquals("player.oma", state.session.playerId)
        assertEquals(androidSessionSlotId("player.oma"), store.activeSlotId())
        assertEquals(now + 604_800_000L, state.session.expiresAtMs)
        // Remembered on the server for this phone, exactly as after a device approval.
        assertTrue(server.requests.any { it.path == ANDROID_NATIVE_REMEMBER_PATH })
        // The card is used up.
        assertEquals(AndroidInvitationResult.Unavailable, controller.signInWithInvitation(card))
        assertTrue(controller.state.value is AndroidAuthenticationState.SignedIn)
    }

    @Test fun aCardOfAnotherInstallationIsNeverSent() {
        val server = CardServer()
        val controller = controller(server, InvitationStore())
        val foreign = AndroidOfflineInvitationCard("https://192.168.1.175", TOKEN)
        assertEquals(AndroidInvitationResult.OtherInstallation, controller.previewInvitation(foreign))
        assertEquals(AndroidInvitationResult.OtherInstallation, controller.signInWithInvitation(foreign))
        assertTrue(server.requests.isEmpty())
        assertTrue(controller.state.value is AndroidAuthenticationState.SignedOut)
    }

    @Test fun refusalsLeaveThePhoneSignedOut() {
        for ((status, code, expected) in listOf(
            Triple(401, "native_invitation_unavailable", AndroidInvitationResult.Unavailable),
            Triple(429, "native_invitation_rate_limited", AndroidInvitationResult.RateLimited),
            Triple(403, "native_invitation_origin_invalid", AndroidInvitationResult.OtherInstallation),
        )) {
            val store = InvitationStore()
            val controller = controller(CardServer(status, code), store)
            assertEquals(expected, controller.signInWithInvitation(card))
            assertTrue(controller.state.value is AndroidAuthenticationState.SignedOut)
            assertNull(store.activeSlotId())
        }
    }

    @Test fun theHttpsExecutorAllowsTheCardRoutesOnlyWithoutABearer() {
        val executor = AndroidAuthenticationHttpsExecutor(ORIGIN, { error("no network in this test") })
        val body = """{"token":"$TOKEN","origin":"$ORIGIN"}"""
        val withBearer = AndroidAuthenticationRequest("POST", ANDROID_NATIVE_INVITATION_REDEEM_PATH, body,
            "sessiontokenabcdefghijklmnop", accountDevice = DEVICE)
        val error = runCatching { executor.execute(withBearer) }.exceptionOrNull()
        assertTrue(error is AndroidAuthenticationException)
        val withoutDevice = AndroidAuthenticationRequest("POST", ANDROID_NATIVE_INVITATION_REDEEM_PATH, body, null)
        assertTrue(runCatching { executor.execute(withoutDevice) }.exceptionOrNull() is AndroidAuthenticationException)
        // A valid request passes validation and reaches the connection opener.
        val valid = AndroidAuthenticationRequest("POST", ANDROID_NATIVE_INVITATION_REDEEM_PATH, body, null, accountDevice = DEVICE)
        assertTrue(runCatching { executor.execute(valid) }.exceptionOrNull() is IllegalStateException)
    }
}
