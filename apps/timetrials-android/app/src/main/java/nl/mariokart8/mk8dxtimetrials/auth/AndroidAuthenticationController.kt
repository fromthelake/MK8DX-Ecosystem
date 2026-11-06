package nl.mariokart8.mk8dxtimetrials.auth

import java.net.URI
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

internal sealed interface AndroidAuthenticationState {
    data object SignedOut : AndroidAuthenticationState
    data object Working : AndroidAuthenticationState
    data class AwaitingApproval(
        val authorization: AndroidPendingDeviceAuthorization,
        val nextPollAtMs: Long,
    ) : AndroidAuthenticationState
    data class SignedIn(val session: AndroidAuthenticatedNativeSession) :
        AndroidAuthenticationState
    data class Failed(
        val operation: String,
        /** Present only for `player_setup`: the website's create-or-claim route. */
        val playerSetupUri: URI? = null,
    ) : AndroidAuthenticationState
}

/** Every account this device remembers, plus which one new results belong to. */
internal data class AndroidRememberedAccountsState(
    val accounts: List<AndroidRememberedAccount> = emptyList(),
    val activeSlotId: String? = null,
)

/** Class names only: exception messages and stack traces may contain URLs or credentials. */
internal fun redactedAuthenticationCauseTypes(error: Throwable): String {
    val types = mutableListOf<String>()
    var current: Throwable? = error
    while (current != null && types.size < 4) {
        types += current.javaClass.simpleName.takeIf { it.matches(Regex("[A-Za-z0-9_$]{1,80}")) }
            ?: "Throwable"
        current = current.cause
    }
    return types.joinToString(" > ")
}

internal class AndroidAuthenticationController(
    private val client: AndroidDeviceAuthorizationClient,
    private val store: AndroidNativeSessionStore,
    private val clock: () -> Long = System::currentTimeMillis,
    private val onAccountRemoved: (String) -> Unit = {},
    private val diagnosticSink: (String) -> Unit = { message ->
        android.util.Log.w("MK8DXAuth", message)
    },
) {
    private val mutableAccounts = MutableStateFlow(AndroidRememberedAccountsState())
    val accounts: StateFlow<AndroidRememberedAccountsState> = mutableAccounts.asStateFlow()

    private val mutableState = MutableStateFlow(initialState())
    val state: StateFlow<AndroidAuthenticationState> = mutableState.asStateFlow()

    /** The slot new submissions are bound to. Null while signed out. */
    fun activeSlotId(): String? = try {
        store.activeSlotId()
    } catch (_: Exception) {
        null
    }

    fun refreshAccounts(): AndroidRememberedAccountsState {
        val next = try {
            AndroidRememberedAccountsState(store.list(validNow()), store.activeSlotId())
        } catch (_: Exception) {
            AndroidRememberedAccountsState()
        }
        mutableAccounts.value = next
        return next
    }

    fun requestAuthorization(): AndroidPendingDeviceAuthorization {
        mutableState.value = AndroidAuthenticationState.Working
        return try {
            val authorization = client.requestDeviceAuthorization()
            val now = validNow()
            mutableState.value = AndroidAuthenticationState.AwaitingApproval(
                authorization,
                Math.addExact(now, authorization.pollingIntervalSeconds * 1_000L),
            )
            authorization
        } catch (error: Exception) {
            runCatching {
                diagnosticSink("requestAuthorization failed: ${redactedAuthenticationCauseTypes(error)}")
            }
            mutableState.value = AndroidAuthenticationState.Failed("request")
            throw AndroidAuthenticationException("Android authorization request failed.")
        }
    }

    fun poll(): AndroidAuthenticationState {
        val current = mutableState.value as? AndroidAuthenticationState.AwaitingApproval
            ?: throw AndroidAuthenticationException("No Android authorization is pending.")
        val now = validNow()
        if (now < current.nextPollAtMs) return current
        mutableState.value = AndroidAuthenticationState.Working
        val next = try {
            when (val result = client.poll(current.authorization.deviceCode)) {
                AndroidDeviceTokenPollResult.Pending -> current.copy(
                    nextPollAtMs = Math.addExact(
                        now,
                        current.authorization.pollingIntervalSeconds * 1_000L,
                    ),
                )
                is AndroidDeviceTokenPollResult.SlowDown -> current.copy(
                    nextPollAtMs = Math.addExact(now, result.retryAfterSeconds * 1_000L),
                )
                AndroidDeviceTokenPollResult.Denied -> AndroidAuthenticationState.Failed("denied")
                AndroidDeviceTokenPollResult.Expired -> AndroidAuthenticationState.Failed("expired")
                is AndroidDeviceTokenPollResult.Authorized -> {
                    val session = client.establishSession(
                        result.bearerToken,
                        result.expiresInSeconds,
                    )
                    // Re-authorizing an already remembered Player reuses its slot,
                    // so entries it already owns become deliverable again.
                    val slotId = androidSessionSlotId(session.playerId)
                    store.save(slotId, session)
                    store.setActiveSlotId(slotId)
                    refreshAccounts()
                    AndroidAuthenticationState.SignedIn(session)
                }
            }
        } catch (setup: AndroidPlayerSetupRequiredException) {
            // The person is authenticated; only the Player is missing. Naming
            // that state lets the screen offer the website's one-step setup
            // instead of a generic failure.
            AndroidAuthenticationState.Failed("player_setup", setup.playerSetupUri)
        } catch (_: Exception) {
            AndroidAuthenticationState.Failed("poll")
        }
        mutableState.value = next
        return next
    }

    fun switchTo(slotId: String): Boolean {
        val session = try {
            store.load(slotId, validNow())
        } catch (_: Exception) {
            null
        } ?: run {
            refreshAccounts()
            return false
        }
        store.setActiveSlotId(slotId)
        mutableState.value = AndroidAuthenticationState.SignedIn(session)
        refreshAccounts()
        return true
    }

    /**
     * Forgets one account's stored credentials. Outbox entries this account owns
     * are untouched: they keep their binding and wait for it to sign in again.
     */
    fun forget(slotId: String): Boolean {
        val wasActive = activeSlotId() == slotId
        return try {
            store.remove(slotId)
            onAccountRemoved(slotId)
            if (wasActive) mutableState.value = AndroidAuthenticationState.SignedOut
            refreshAccounts()
            true
        } catch (_: Exception) {
            refreshAccounts()
            false
        }
    }

    fun revoke(): Boolean {
        val current = mutableState.value as? AndroidAuthenticationState.SignedIn
            ?: return false
        val slotId = activeSlotId() ?: return false
        mutableState.value = AndroidAuthenticationState.Working
        return try {
            client.revoke(current.session.bearerToken)
            store.remove(slotId)
            onAccountRemoved(slotId)
            mutableState.value = AndroidAuthenticationState.SignedOut
            refreshAccounts()
            true
        } catch (_: Exception) {
            mutableState.value = current
            false
        }
    }

    fun dismissFailure() {
        if (mutableState.value is AndroidAuthenticationState.Failed) {
            mutableState.value = AndroidAuthenticationState.SignedOut
        }
    }

    fun reportBrowserHandoffFailure() {
        if (mutableState.value is AndroidAuthenticationState.AwaitingApproval) {
            mutableState.value = AndroidAuthenticationState.Failed("browser")
        }
    }

    private fun initialState(): AndroidAuthenticationState {
        refreshAccounts()
        val session = try {
            store.activeSlotId()?.let { store.load(it, validNow()) }
        } catch (_: Exception) {
            null
        }
        return session?.let(AndroidAuthenticationState::SignedIn)
            ?: AndroidAuthenticationState.SignedOut
    }

    private fun validNow(): Long = clock().takeIf { it >= 0 }
        ?: throw AndroidAuthenticationException("Android authentication clock is invalid.")
}
