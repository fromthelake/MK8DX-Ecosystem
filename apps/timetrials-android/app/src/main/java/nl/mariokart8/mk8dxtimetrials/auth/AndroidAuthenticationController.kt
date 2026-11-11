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

/** What a tap on "Switch" led to; the screen asks for a PIN or explains a refusal. */
internal sealed interface AndroidSwitchOutcome {
    data object Switched : AndroidSwitchOutcome
    data object PinRequired : AndroidSwitchOutcome
    data object PinInvalid : AndroidSwitchOutcome
    data object RateLimited : AndroidSwitchOutcome
    data object Refused : AndroidSwitchOutcome
    data object Unavailable : AndroidSwitchOutcome
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
    /** The server's list for this app device (ADR-0224 amendment); empty until fetched. */
    @Volatile
    private var serverAccounts: List<AndroidServerRememberedAccount> = emptyList()

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
            val remembered = serverAccounts
            AndroidRememberedAccountsState(
                store.list(validNow()).map { local ->
                    val entry = remembered.firstOrNull { it.playerId == local.playerId }
                    if (entry == null) local else local.copy(
                        // One tap away on the server: not "sign in again", even without a local token.
                        expired = false,
                        entryId = entry.entryId,
                        pinRequired = entry.pinRequired,
                    )
                },
                store.activeSlotId(),
            )
        } catch (_: Exception) {
            AndroidRememberedAccountsState()
        }
        mutableAccounts.value = next
        return next
    }

    /**
     * Brings the server's list for this phone up to date (network; call off the main thread).
     * Accounts this phone still holds a token for from before switching moved to the server are
     * handed over once: remembered there, their session ended, the local token erased. The phone
     * then holds only the active account's token.
     */
    fun syncServerAccounts(): AndroidRememberedAccountsState {
        val device = store.accountDeviceValue() ?: return refreshAccounts()
        try {
            val now = validNow()
            val active = store.activeSlotId()
            for (account in store.list(now)) {
                if (account.slotId == active) continue
                val held = store.load(account.slotId, now) ?: continue
                runCatching {
                    client.rememberOnServer(held.bearerToken, device)
                    client.revoke(held.bearerToken, device, keepRemembered = true)
                }
                store.dropCredential(account.slotId)
            }
            val activeSession = active?.let { store.load(it, now) }
            var listed = client.listRemembered(device, activeSession?.bearerToken)
            if (activeSession != null && listed.none { it.current } &&
                client.rememberOnServer(activeSession.bearerToken, device)) {
                listed = client.listRemembered(device, activeSession.bearerToken)
            }
            serverAccounts = listed
        } catch (error: Exception) {
            runCatching {
                diagnosticSink("syncServerAccounts failed: ${redactedAuthenticationCauseTypes(error)}")
            }
        }
        return refreshAccounts()
    }

    /** One tap (or the PIN) to become another Player remembered on this phone. */
    fun switchToRemembered(slotId: String, pin: String? = null): AndroidSwitchOutcome {
        val account = refreshAccounts().accounts.firstOrNull { it.slotId == slotId }
            ?: return AndroidSwitchOutcome.Unavailable
        val entryId = account.entryId
        val device = store.accountDeviceValue()
        if (entryId == null || device == null) {
            // A token still held locally (before the first server sync) switches as before.
            return if (switchTo(slotId)) AndroidSwitchOutcome.Switched else AndroidSwitchOutcome.Unavailable
        }
        val previousSlot = store.activeSlotId()
        val previous = previousSlot?.let { store.load(it, validNow()) }
        val result = try {
            client.switchOnServer(device, entryId, pin, previous?.bearerToken)
        } catch (_: Exception) {
            return AndroidSwitchOutcome.Unavailable
        }
        return when (result) {
            is AndroidNativeSwitchResult.Switched -> try {
                val session = client.establishSession(result.bearerToken, result.expiresInSeconds)
                val target = androidSessionSlotId(session.playerId)
                store.save(target, session)
                // The server ended the previous session; its stale token must not linger here.
                if (previousSlot != null && previousSlot != target) store.dropCredential(previousSlot)
                store.setActiveSlotId(target)
                mutableState.value = AndroidAuthenticationState.SignedIn(session)
                syncServerAccounts()
                AndroidSwitchOutcome.Switched
            } catch (setup: AndroidPlayerSetupRequiredException) {
                mutableState.value = AndroidAuthenticationState.Failed("player_setup", setup.playerSetupUri)
                AndroidSwitchOutcome.Unavailable
            } catch (_: Exception) {
                AndroidSwitchOutcome.Unavailable
            }
            AndroidNativeSwitchResult.PinRequired -> AndroidSwitchOutcome.PinRequired
            AndroidNativeSwitchResult.PinInvalid -> AndroidSwitchOutcome.PinInvalid
            is AndroidNativeSwitchResult.RateLimited -> AndroidSwitchOutcome.RateLimited
            AndroidNativeSwitchResult.Refused -> {
                syncServerAccounts()
                AndroidSwitchOutcome.Refused
            }
            AndroidNativeSwitchResult.Unavailable -> {
                syncServerAccounts()
                AndroidSwitchOutcome.Unavailable
            }
        }
    }

    /**
     * "Add account": the person now signed in stays one tap away (their session on this phone
     * ends, the server keeps them remembered), then a new device sign-in starts.
     */
    fun requestAdditionalAuthorization(): AndroidPendingDeviceAuthorization {
        val device = store.accountDeviceValue()
        val slot = store.activeSlotId()
        val current = (mutableState.value as? AndroidAuthenticationState.SignedIn)?.session
        if (device != null && slot != null && current != null) {
            runCatching {
                client.rememberOnServer(current.bearerToken, device)
                client.revoke(current.bearerToken, device, keepRemembered = true)
            }
            store.dropCredential(slot)
            store.setActiveSlotId(null)
            mutableState.value = AndroidAuthenticationState.SignedOut
        }
        return requestAuthorization()
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
                    // Remembered on the server for this phone (never an administrator).
                    store.accountDeviceValue()?.let { device ->
                        runCatching { client.rememberOnServer(session.bearerToken, device) }
                    }
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
        val device = store.accountDeviceValue()
        val entryId = mutableAccounts.value.accounts.firstOrNull { it.slotId == slotId }?.entryId
        if (device != null && entryId != null) {
            // "Remove" also takes it off the server's list for this phone.
            runCatching { client.forgetOnServer(device, entryId) }
            serverAccounts = serverAccounts.filterNot { it.entryId == entryId }
        }
        if (wasActive) {
            store.load(slotId, validNow())?.let { session ->
                runCatching { client.revoke(session.bearerToken, device) }
            }
        }
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
            // Signing out leaves this phone: the server forgets the account here too.
            client.revoke(current.session.bearerToken, store.accountDeviceValue())
            serverAccounts = serverAccounts.filterNot { it.playerId == current.session.playerId }
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
