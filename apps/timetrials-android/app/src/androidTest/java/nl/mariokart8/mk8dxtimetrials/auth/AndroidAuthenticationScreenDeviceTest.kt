package nl.mariokart8.mk8dxtimetrials.auth

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import java.net.URI
import java.util.Collections
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

private class DeviceMemorySessionStore : AndroidNativeSessionStore {
    private val sessions = LinkedHashMap<String, AndroidAuthenticatedNativeSession>()
    private var active: String? = null

    val session: AndroidAuthenticatedNativeSession?
        get() = active?.let { sessions[it] }

    override fun list(nowMs: Long): List<AndroidRememberedAccount> =
        sessions.map { (slotId, session) ->
            AndroidRememberedAccount(slotId, session.playerId, session.expiresAtMs <= nowMs)
        }

    override fun load(slotId: String, nowMs: Long): AndroidAuthenticatedNativeSession? =
        sessions[slotId]?.takeIf { it.expiresAtMs > nowMs }

    override fun save(slotId: String, session: AndroidAuthenticatedNativeSession) {
        sessions[slotId] = session
    }

    override fun remove(slotId: String) {
        sessions.remove(slotId)
        if (active == slotId) active = null
    }

    override fun activeSlotId(): String? = active

    override fun setActiveSlotId(slotId: String?) {
        active = slotId
    }
}

private class DeviceQueueExecutor(
    responses: List<AndroidAuthenticationResponse>,
) : AndroidAuthenticationRequestExecutor {
    private val queue = ArrayDeque(responses)
    override fun execute(request: AndroidAuthenticationRequest): AndroidAuthenticationResponse =
        synchronized(queue) { queue.removeFirst() }
}

private fun deviceResponse(status: Int, body: String) = AndroidAuthenticationResponse(
    status,
    "application/json",
    body.toByteArray(),
)

class AndroidAuthenticationScreenDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun delegatesBrowserApprovalAndStoresClaimedSessionWithoutPasswordInput() {
        var now = 1_000_000L
        val token = "abcdefghijklmnopqrstuvwxyzABCDEF"
        val deviceCode = "abcdefghijklmnopqrstuvwxyz1234567890ABCD"
        val store = DeviceMemorySessionStore()
        val client = AndroidDeviceAuthorizationClient(
            URI("https://example.invalid"),
            DeviceQueueExecutor(
                listOf(
                    deviceResponse(
                        200,
                        """{"device_code":"$deviceCode","user_code":"ABCD-1234","verification_uri":"https://example.invalid/device","verification_uri_complete":"https://example.invalid/device?user_code=ABCD-1234","expires_in":600,"interval":5}""",
                    ),
                    deviceResponse(
                        200,
                        """{"access_token":"$token","token_type":"Bearer","expires_in":3600,"scope":""}""",
                    ),
                    deviceResponse(
                        200,
                        """{"schemaVersion":"mk8dx.native-time-trial-bootstrap.v2","playerId":"player.synthetic_device_01","username":"syntheticdevice","displayName":"Synthetic Device"}""",
                    ),
                ),
            ),
            clock = { now },
        )
        val controller = AndroidAuthenticationController(client, store, clock = { now })
        val opened = Collections.synchronizedList(mutableListOf<URI>())
        compose.setContent {
            MaterialTheme {
                AndroidAuthenticationScreen(
                    controller = controller,
                    openBrowser = opened::add,
                )
            }
        }

        compose.onNodeWithText("Sign in to synchronize").performClick()
        compose.waitUntil(5_000) { opened.isNotEmpty() }
        // The code is data with a label of its own (Phase 16): the label names
        // it and the code itself is printed in full, never abbreviated.
        compose.onNodeWithText("Device code", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("ABCD-1234", useUnmergedTree = true).assertIsDisplayed()
        assertEquals(
            URI("https://example.invalid/device?user_code=ABCD-1234"),
            opened.single(),
        )
        now += 5_000
        compose.onNodeWithTag("android-authentication-check").performClick()
        compose.waitUntil(5_000) {
            store.session?.playerId == "player.synthetic_device_01"
        }
        compose.onNodeWithTag("android-authentication-signed-in").assertIsDisplayed()
        compose.onNodeWithText("Password").assertDoesNotExist()
    }

    @Test
    fun anExpiredPlayerSignsInAgainFromItsOwnCardInOneTap() {
        var now = 5_000_000L
        val deviceCode = "abcdefghijklmnopqrstuvwxyz1234567890ABCD"
        val store = DeviceMemorySessionStore()
        val slotId = androidSessionSlotId("player.synthetic_device_01")
        store.save(
            slotId,
            AndroidAuthenticatedNativeSession(
                bearerToken = "abcdefghijklmnopqrstuvwxyzABCDEF",
                expiresAtMs = now - 1,
                playerId = "player.synthetic_device_01",
                displayName = "Synthetic Device",
            ),
        )
        store.setActiveSlotId(slotId)
        val client = AndroidDeviceAuthorizationClient(
            URI("https://example.invalid"),
            DeviceQueueExecutor(
                listOf(
                    deviceResponse(
                        200,
                        """{"device_code":"$deviceCode","user_code":"WXYZ-5678","verification_uri":"https://example.invalid/device","verification_uri_complete":"https://example.invalid/device?user_code=WXYZ-5678","expires_in":600,"interval":5}""",
                    ),
                ),
            ),
            clock = { now },
        )
        val controller = AndroidAuthenticationController(client, store, clock = { now })
        val opened = Collections.synchronizedList(mutableListOf<URI>())
        compose.setContent {
            MaterialTheme {
                AndroidAuthenticationScreen(
                    controller = controller,
                    openBrowser = opened::add,
                )
            }
        }

        compose.onNodeWithTag("android-account-expired-0").assertIsDisplayed()
        compose.onNodeWithText("Add account").assertDoesNotExist()
        compose.onNodeWithTag("android-account-sign-in-again-0").performClick()
        compose.waitUntil(5_000) { opened.isNotEmpty() }
        assertEquals(
            URI("https://example.invalid/device?user_code=WXYZ-5678"),
            opened.single(),
        )
        compose.onNodeWithText("Device code", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("WXYZ-5678", useUnmergedTree = true).assertIsDisplayed()
    }
}
