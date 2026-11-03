package nl.mariokart8.mk8dxtimetrials.auth

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

internal class MemorySessionStore : AndroidNativeSessionStore {
    private val sessions = LinkedHashMap<String, AndroidAuthenticatedNativeSession>()
    private val labels = LinkedHashMap<String, String>()
    private var active: String? = null
    var saves = 0
    var removals = 0

    constructor()

    constructor(initial: AndroidAuthenticatedNativeSession, active: Boolean = true) {
        val slotId = androidSessionSlotId(initial.playerId)
        save(slotId, initial)
        saves = 0
        if (active) setActiveSlotId(slotId)
    }

    val session: AndroidAuthenticatedNativeSession?
        get() = active?.let { sessions[it] }

    override fun list(nowMs: Long): List<AndroidRememberedAccount> =
        labels.map { (slotId, playerId) ->
            AndroidRememberedAccount(slotId, playerId, load(slotId, nowMs) == null)
        }

    override fun load(slotId: String, nowMs: Long): AndroidAuthenticatedNativeSession? =
        sessions[slotId]?.takeIf { it.expiresAtMs > nowMs }

    override fun save(slotId: String, session: AndroidAuthenticatedNativeSession) {
        require(slotId == androidSessionSlotId(session.playerId))
        sessions[slotId] = session
        labels[slotId] = session.playerId
        saves += 1
    }

    override fun remove(slotId: String) {
        sessions.remove(slotId)
        labels.remove(slotId)
        if (active == slotId) active = null
        removals += 1
    }

    override fun activeSlotId(): String? = active

    override fun setActiveSlotId(slotId: String?) {
        active = slotId?.takeIf { it in labels }
    }
}

private class MutableExecutor : AndroidAuthenticationRequestExecutor {
    val responses = ArrayDeque<AndroidAuthenticationResponse>()
    override fun execute(request: AndroidAuthenticationRequest): AndroidAuthenticationResponse =
        responses.removeFirst()
}

class AndroidAuthenticationControllerTest {
    @Test
    fun restoresOnlyANonExpiredProtectedSession() {
        val stored = AndroidAuthenticatedNativeSession(
            "abcdefghijklmnopqrstuvwxyzABCDEF",
            2_000_000,
            "player.synthetic_01",
        )
        val controller = AndroidAuthenticationController(
            AndroidDeviceAuthorizationClient(
                URI("https://example.invalid"),
                MutableExecutor(),
            ),
            MemorySessionStore(stored),
            clock = { 1_000_000 },
        )
        assertEquals(AndroidAuthenticationState.SignedIn(stored), controller.state.value)
    }

    @Test
    fun completesExplicitRequestPollBootstrapAndProtectedSave() {
        var now = 1_000_000L
        val executor = MutableExecutor()
        executor.responses += response(
            200,
            """{"device_code":"$deviceCode","user_code":"ABCD-1234","verification_uri":"https://example.invalid/device","verification_uri_complete":"https://example.invalid/device?user_code=ABCD-1234","expires_in":600,"interval":5}""",
        )
        executor.responses += response(
            200,
            """{"access_token":"$token","token_type":"Bearer","expires_in":3600,"scope":""}""",
        )
        executor.responses += response(
            200,
            """{"schemaVersion":"mk8dx.native-time-trial-bootstrap.v2","playerId":"player.synthetic_01","username":"synthetic01","displayName":"Synthetic 01"}""",
        )
        val store = MemorySessionStore()
        val controller = AndroidAuthenticationController(
            AndroidDeviceAuthorizationClient(
                URI("https://example.invalid"),
                executor,
                clock = { now },
            ),
            store,
            clock = { now },
        )
        controller.requestAuthorization()
        assertTrue(controller.state.value is AndroidAuthenticationState.AwaitingApproval)
        assertTrue(controller.poll() is AndroidAuthenticationState.AwaitingApproval)
        now += 5_000
        assertTrue(controller.poll() is AndroidAuthenticationState.SignedIn)
        assertEquals(1, store.saves)
        assertEquals("player.synthetic_01", store.session?.playerId)
    }

    @Test
    fun reportsAnAuthenticatedAccountWithoutAPlayerAsItsOwnRecoverableState() {
        var now = 1_000_000L
        val executor = MutableExecutor()
        executor.responses += response(
            200,
            """{"device_code":"$deviceCode","user_code":"ABCD-1234","verification_uri":"https://example.invalid/device","verification_uri_complete":"https://example.invalid/device?user_code=ABCD-1234","expires_in":600,"interval":5}""",
        )
        executor.responses += response(
            200,
            """{"access_token":"$token","token_type":"Bearer","expires_in":3600,"scope":""}""",
        )
        executor.responses += response(
            403,
            """{"code":"native_time_trial_player_required","message":"required"}""",
        )
        val store = MemorySessionStore()
        val controller = AndroidAuthenticationController(
            AndroidDeviceAuthorizationClient(
                URI("https://example.invalid"),
                executor,
                clock = { now },
            ),
            store,
            clock = { now },
        )
        controller.requestAuthorization()
        now += 5_000
        assertEquals(
            AndroidAuthenticationState.Failed(
                "player_setup",
                URI("https://example.invalid/?welcome=1"),
            ),
            controller.poll(),
        )
        // Nothing half-authenticated may be persisted.
        assertEquals(0, store.saves)
        controller.dismissFailure()
        assertEquals(AndroidAuthenticationState.SignedOut, controller.state.value)
    }

    @Test
    fun keepsLocalSessionWhenRemoteRevocationFailsAndClearsAfterSuccess() {
        val stored = AndroidAuthenticatedNativeSession(
            token,
            2_000_000,
            "player.synthetic_01",
        )
        val executor = MutableExecutor()
        executor.responses += response(500, """{"error":"server_error"}""")
        executor.responses += response(200, """{"success":true}""")
        val store = MemorySessionStore(stored)
        val controller = AndroidAuthenticationController(
            AndroidDeviceAuthorizationClient(
                URI("https://example.invalid"),
                executor,
            ),
            store,
            clock = { 1_000_000 },
        )
        assertFalse(controller.revoke())
        assertEquals(stored, store.session)
        assertTrue(controller.revoke())
        assertEquals(null, store.session)
        assertEquals(1, store.removals)
        assertEquals(emptyList<AndroidRememberedAccount>(), store.list(1_000_000))
    }

    @Test
    fun remembersEveryAccountAndBindsSubmissionsToTheActiveOne() {
        val accountA = AndroidAuthenticatedNativeSession(token, 3_000_000, "player.account_a")
        val accountB = AndroidAuthenticatedNativeSession(token, 3_000_000, "player.account_b")
        val store = MemorySessionStore(accountA)
        val controller = AndroidAuthenticationController(
            AndroidDeviceAuthorizationClient(
                URI("https://example.invalid"),
                MutableExecutor(),
            ),
            store,
            clock = { 1_000_000 },
        )
        val sonSlotId = androidSessionSlotId(accountB.playerId)
        store.save(sonSlotId, accountB)

        assertEquals(androidSessionSlotId(accountA.playerId), controller.activeSlotId())
        assertTrue(controller.switchTo(sonSlotId))
        assertEquals(sonSlotId, controller.activeSlotId())
        assertEquals(
            listOf("player.account_a", "player.account_b"),
            controller.accounts.value.accounts.map { it.playerId },
        )

        // Forgetting one account leaves the other signed in and usable.
        assertTrue(controller.forget(androidSessionSlotId(accountA.playerId)))
        assertEquals(listOf(sonSlotId), controller.accounts.value.accounts.map { it.slotId })
        assertEquals(sonSlotId, controller.activeSlotId())
    }

    @Test
    fun reportsAnExpiredAccountWithoutTouchingTheOtherAccount() {
        val expired = AndroidAuthenticatedNativeSession(token, 1_500_000, "player.account_a")
        val live = AndroidAuthenticatedNativeSession(token, 3_000_000, "player.account_b")
        val store = MemorySessionStore(live)
        store.save(androidSessionSlotId(expired.playerId), expired)
        val controller = AndroidAuthenticationController(
            AndroidDeviceAuthorizationClient(
                URI("https://example.invalid"),
                MutableExecutor(),
            ),
            store,
            clock = { 2_000_000 },
        )

        val accounts = controller.refreshAccounts().accounts.associateBy { it.playerId }
        assertEquals(true, accounts.getValue("player.account_a").expired)
        assertEquals(false, accounts.getValue("player.account_b").expired)
        assertFalse(controller.switchTo(androidSessionSlotId(expired.playerId)))
        assertEquals(
            AndroidAuthenticationState.SignedIn(live),
            controller.state.value,
        )
    }

    @Test
    fun convertsDelegatedBrowserFailureToBoundedState() {
        val executor = MutableExecutor()
        executor.responses += response(
            200,
            """{"device_code":"$deviceCode","user_code":"ABCD-1234","verification_uri":"https://example.invalid/device","verification_uri_complete":"https://example.invalid/device?user_code=ABCD-1234","expires_in":600,"interval":5}""",
        )
        val controller = AndroidAuthenticationController(
            AndroidDeviceAuthorizationClient(
                URI("https://example.invalid"),
                executor,
            ),
            MemorySessionStore(),
            clock = { 1_000_000 },
        )
        controller.requestAuthorization()
        controller.reportBrowserHandoffFailure()
        assertEquals(AndroidAuthenticationState.Failed("browser"), controller.state.value)
    }
}
