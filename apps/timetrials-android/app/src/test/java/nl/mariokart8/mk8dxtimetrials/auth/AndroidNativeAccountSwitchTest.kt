package nl.mariokart8.mk8dxtimetrials.auth

import java.net.URI
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A store with an account-device value, like the Keystore store. */
private class DeviceSessionStore : AndroidNativeSessionStore {
    val sessions = LinkedHashMap<String, AndroidAuthenticatedNativeSession>()
    private val labels = LinkedHashMap<String, String>()
    private var active: String? = null

    override fun list(nowMs: Long): List<AndroidRememberedAccount> =
        labels.map { (slotId, playerId) -> AndroidRememberedAccount(slotId, playerId, load(slotId, nowMs) == null) }

    override fun load(slotId: String, nowMs: Long): AndroidAuthenticatedNativeSession? =
        sessions[slotId]?.takeIf { it.expiresAtMs > nowMs }

    override fun save(slotId: String, session: AndroidAuthenticatedNativeSession) {
        sessions[slotId] = session
        labels[slotId] = session.playerId
    }

    override fun remove(slotId: String) {
        sessions.remove(slotId)
        labels.remove(slotId)
        if (active == slotId) active = null
    }

    override fun activeSlotId(): String? = active
    override fun setActiveSlotId(slotId: String?) { active = slotId?.takeIf { it in labels } }
    override fun accountDeviceValue(): String = DEVICE
    override fun dropCredential(slotId: String) { sessions.remove(slotId) }
}

private const val DEVICE = "D2vXq9yZk3mN8pR4tW6aB1cE5fH7jL0oQsUvYxZ0abc"

/** The server's rules in miniature: remembered entries per device, PINs, bearer sessions. */
private class FakeSwitchServer : AndroidAuthenticationRequestExecutor {
    data class Entry(val entryId: String, val playerId: String)

    val requests = mutableListOf<AndroidAuthenticationRequest>()
    val tokens = LinkedHashMap<String, String>() // token -> playerId
    val entries = mutableListOf<Entry>()
    val pins = mutableMapOf<String, String>() // playerId -> PIN
    val administrators = mutableSetOf<String>()
    private var issued = 0

    fun issue(playerId: String): String {
        issued += 1
        val token = "token${issued.toString().padStart(3, '0')}abcdefghijklmnopqrstuvwxyz"
        tokens[token] = playerId
        return token
    }

    override fun execute(request: AndroidAuthenticationRequest): AndroidAuthenticationResponse {
        requests += request
        val owner = request.bearerToken?.let { tokens[it] }
        val body = request.body?.let { Json.parseToJsonElement(it) as JsonObject }
        return when (request.path) {
            ANDROID_NATIVE_REMEMBER_PATH -> {
                require(request.accountDevice == DEVICE)
                if (owner == null) return error(401, "session_authentication_required")
                if (owner in administrators) return ok("""{"schemaVersion":"mk8dx.native-account-remember.v1","remembered":false}""")
                if (entries.none { it.playerId == owner }) entries += Entry("entry" + owner.takeLast(2).padStart(17, '0'), owner)
                ok("""{"schemaVersion":"mk8dx.native-account-remember.v1","remembered":true}""")
            }
            ANDROID_NATIVE_REMEMBERED_ACCOUNTS_PATH -> {
                require(request.accountDevice == DEVICE)
                val rows = entries.joinToString(",") { entry ->
                    """{"entryId":"${entry.entryId}","label":"${entry.playerId.removePrefix("player.")}","playerId":"${entry.playerId}","pinRequired":${entry.playerId in pins},"current":${entry.playerId == owner}}"""
                }
                ok("""{"schemaVersion":"mk8dx.native-remembered-accounts.v1","accounts":[$rows]}""")
            }
            ANDROID_NATIVE_ACCOUNT_SWITCH_PATH -> {
                require(request.accountDevice == DEVICE)
                val entry = entries.firstOrNull { it.entryId == body!!["entryId"]!!.jsonPrimitive.content }
                    ?: return error(404, "account_switch_unavailable")
                if (entry.playerId in administrators) return error(403, "account_switch_forbidden")
                pins[entry.playerId]?.let { pin ->
                    val given = body!!["pin"]?.jsonPrimitive?.content ?: return error(403, "account_switch_pin_required")
                    if (given != pin) return error(403, "account_switch_pin_invalid")
                }
                request.bearerToken?.let(tokens::remove)
                ok("""{"schemaVersion":"mk8dx.native-account-switch.v1","token":"${issue(entry.playerId)}","expiresIn":3600}""")
            }
            ANDROID_NATIVE_FORGET_PATH -> {
                val id = body!!["entryId"]!!.jsonPrimitive.content
                val removed = entries.removeAll { it.entryId == id }
                ok("""{"schemaVersion":"mk8dx.native-account-forget.v1","forgotten":$removed}""")
            }
            ANDROID_AUTH_NATIVE_BOOTSTRAP_PATH -> {
                val player = owner ?: return error(401, "session_authentication_required")
                ok("""{"schemaVersion":"mk8dx.native-time-trial-bootstrap.v2","playerId":"$player","username":"${player.removePrefix("player.")}","displayName":"${player.removePrefix("player.")}"}""")
            }
            ANDROID_AUTH_SIGN_OUT_PATH -> {
                if (!request.keepRemembered && request.accountDevice == DEVICE && owner != null) {
                    entries.removeAll { it.playerId == owner }
                }
                request.bearerToken?.let(tokens::remove)
                ok("""{"success":true}""")
            }
            else -> error(404, "not_found")
        }
    }

    private fun ok(body: String) = AndroidAuthenticationResponse(200, "application/json", body.toByteArray())
    private fun error(status: Int, code: String) = AndroidAuthenticationResponse(
        status, "application/json", """{"code":"$code","message":"x"}""".toByteArray(),
    )
}

class AndroidNativeAccountSwitchTest {
    private val now = 1_000_000L

    private fun session(server: FakeSwitchServer, player: String) =
        AndroidAuthenticatedNativeSession(server.issue(player), now + 3_600_000, player, player.removePrefix("player."), player.removePrefix("player."))

    private fun controller(server: FakeSwitchServer, store: DeviceSessionStore) = AndroidAuthenticationController(
        AndroidDeviceAuthorizationClient(URI("https://example.invalid"), server, clock = { now }),
        store,
        clock = { now },
    )

    @Test
    fun handsTokensHeldBeforeOverToTheServerAndKeepsOnlyTheActiveOne() {
        val server = FakeSwitchServer()
        val store = DeviceSessionStore()
        val ann = session(server, "player.ann")
        val bob = session(server, "player.bob")
        store.save(androidSessionSlotId(ann.playerId), ann)
        store.save(androidSessionSlotId(bob.playerId), bob)
        store.setActiveSlotId(androidSessionSlotId(bob.playerId))
        val controller = controller(server, store)

        val state = controller.syncServerAccounts()

        // Ann's old token: remembered on the server, signed out with "keep remembered", erased here.
        assertNull(store.sessions[androidSessionSlotId("player.ann")])
        assertFalse(ann.bearerToken in server.tokens)
        assertTrue(server.requests.any { it.path == ANDROID_AUTH_SIGN_OUT_PATH && it.keepRemembered })
        assertEquals(setOf("player.ann", "player.bob"), server.entries.map { it.playerId }.toSet())
        // Both still listed, both switchable, Bob active.
        assertTrue(state.accounts.all { !it.expired && it.entryId != null })
        assertEquals(androidSessionSlotId("player.bob"), state.activeSlotId)
        // The device value only ever goes to the switching routes and sign-out.
        assertTrue(server.requests.filter { it.accountDevice != null }.all {
            it.path in setOf(ANDROID_NATIVE_REMEMBER_PATH, ANDROID_NATIVE_REMEMBERED_ACCOUNTS_PATH,
                ANDROID_NATIVE_ACCOUNT_SWITCH_PATH, ANDROID_NATIVE_FORGET_PATH, ANDROID_AUTH_SIGN_OUT_PATH)
        })
    }

    @Test
    fun switchesThroughTheServerWithThePinItChecks() {
        val server = FakeSwitchServer()
        val store = DeviceSessionStore()
        val bob = session(server, "player.bob")
        store.save(androidSessionSlotId(bob.playerId), bob)
        store.setActiveSlotId(androidSessionSlotId(bob.playerId))
        server.entries += FakeSwitchServer.Entry("entry00000000000000ann", "player.ann")
        store.save(androidSessionSlotId("player.ann"), session(server, "player.ann"))
        store.dropCredential(androidSessionSlotId("player.ann"))
        server.pins["player.ann"] = "4821"
        val controller = controller(server, store)
        controller.syncServerAccounts()
        val annSlot = androidSessionSlotId("player.ann")
        assertTrue(controller.accounts.value.accounts.first { it.slotId == annSlot }.pinRequired)

        assertEquals(AndroidSwitchOutcome.PinRequired, controller.switchToRemembered(annSlot))
        assertEquals(AndroidSwitchOutcome.PinInvalid, controller.switchToRemembered(annSlot, "0000"))
        assertEquals(androidSessionSlotId("player.bob"), store.activeSlotId())
        assertEquals(AndroidSwitchOutcome.Switched, controller.switchToRemembered(annSlot, "4821"))

        assertEquals(annSlot, store.activeSlotId())
        assertEquals("player.ann", (controller.state.value as AndroidAuthenticationState.SignedIn).session.playerId)
        // Bob's session ended on the server and his stale token is gone here; he stays one tap away.
        assertNull(store.sessions[androidSessionSlotId("player.bob")])
        assertFalse(bob.bearerToken in server.tokens)
        assertTrue(controller.accounts.value.accounts.first { it.playerId == "player.bob" }.entryId != null)
    }

    @Test
    fun signingOutForgetsThisPhoneButAddingAnAccountKeepsTheCurrentOne() {
        val server = FakeSwitchServer()
        val store = DeviceSessionStore()
        val bob = session(server, "player.bob")
        store.save(androidSessionSlotId(bob.playerId), bob)
        store.setActiveSlotId(androidSessionSlotId(bob.playerId))
        val controller = controller(server, store)
        controller.syncServerAccounts()
        assertEquals(listOf("player.bob"), server.entries.map { it.playerId })

        assertTrue(controller.revoke())
        assertTrue(server.entries.isEmpty())
        val signOut = server.requests.last { it.path == ANDROID_AUTH_SIGN_OUT_PATH }
        assertEquals(DEVICE, signOut.accountDevice)
        assertFalse(signOut.keepRemembered)
    }

    @Test
    fun aSessionEndedOnTheServerSignsThePhoneOutAndKeepsTheOthersSwitchable() {
        val server = FakeSwitchServer()
        val store = DeviceSessionStore()
        val kind = session(server, "player.kind")
        store.save(androidSessionSlotId(kind.playerId), kind)
        store.setActiveSlotId(androidSessionSlotId(kind.playerId))
        server.entries += FakeSwitchServer.Entry("entry00000000000000oma", "player.oma")
        store.save(androidSessionSlotId("player.oma"), session(server, "player.oma"))
        store.dropCredential(androidSessionSlotId("player.oma"))
        // An administrator signed Kind out everywhere: the token and Kind's entries are gone.
        server.tokens.remove(kind.bearerToken)
        server.entries.removeAll { it.playerId == "player.kind" }
        val controller = controller(server, store)

        val state = controller.syncServerAccounts()

        assertEquals(AndroidAuthenticationState.SignedOut, controller.state.value)
        assertNull(store.activeSlotId())
        assertNull(store.sessions[androidSessionSlotId("player.kind")])
        val oma = state.accounts.first { it.playerId == "player.oma" }
        assertFalse(oma.expired)
        assertEquals("entry00000000000000oma", oma.entryId)
        assertTrue(state.accounts.first { it.playerId == "player.kind" }.expired)
    }

    @Test
    fun anAdministratorIsNeverOfferedForOneTap() {
        val server = FakeSwitchServer()
        val store = DeviceSessionStore()
        server.administrators += "player.root"
        val root = session(server, "player.root")
        store.save(androidSessionSlotId(root.playerId), root)
        store.setActiveSlotId(androidSessionSlotId(root.playerId))
        val state = controller(server, store).syncServerAccounts()
        assertTrue(server.entries.isEmpty())
        assertNull(state.accounts.single().entryId)
    }
}
