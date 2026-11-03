package nl.mariokart8.mk8dxtimetrials.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import java.net.URI
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.ui.androidLocalizedPresentation
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatBlock
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * Account · Players (A09), on the design system (Phase 12).
 *
 * Who is racing on this phone, and the way in for somebody who is not signed in
 * yet. Nothing about the device-code flow changes here: the same controller
 * calls, the same explicit approval in a browser, the same one check on resume,
 * the same words. Only the surfaces, the type and the buttons are the system's.
 */
@Composable
internal fun AndroidAuthenticationScreen(
    controller: AndroidAuthenticationController,
    modifier: Modifier = Modifier,
    workerDispatcher: CoroutineDispatcher = Dispatchers.IO,
    openBrowser: ((URI) -> Unit)? = null,
    pendingEntryCount: (slotId: String) -> Int = { 0 },
    notificationPlayerHint: String? = null,
) {
    val context = LocalContext.current
    // The approval page must open in a browser: the app is the verified
    // handler for /device, so a plain ACTION_VIEW brought it straight back here
    // and the approval page never appeared.
    val browser = openBrowser ?: { uri: URI ->
        nl.mariokart8.mk8dxtimetrials.openProductWebsite(context, uri.toString())
    }
    val state by controller.state.collectAsState()
    val accounts by controller.accounts.collectAsState()
    val scope = rememberCoroutineScope()
    val openApproval = { uri: URI ->
        try {
            browser(uri)
        } catch (_: Exception) {
            controller.reportBrowserHandoffFailure()
        }
    }
    // Set after a manual or resume check that found the request still
    // unapproved, so tapping Check approval never reads as doing nothing.
    var notApprovedYet by remember { mutableStateOf(false) }
    val checkApproval = {
        scope.launch {
            val result = withContext(workerDispatcher) {
                runCatching { controller.poll() }.getOrNull()
            }
            notApprovedYet = result is AndroidAuthenticationState.AwaitingApproval
        }
        Unit
    }
    val startDeviceAuthorization = {
        notApprovedYet = false
        scope.launch {
            val authorization = withContext(workerDispatcher) {
                runCatching { controller.requestAuthorization() }.getOrNull()
            }
            authorization?.let { openApproval(it.verificationUriComplete) }
        }
        Unit
    }
    // Coming back from the browser is the natural "I approved it" moment, so
    // returning to the app checks once by itself. Explicit approval in the
    // browser stays required; this only spares the extra tap afterwards.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME &&
                controller.state.value is AndroidAuthenticationState.AwaitingApproval
            ) {
                checkApproval()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .verticalScroll(rememberScrollState())
            .padding(Mk8dxSpacing.gutterPhone)
            .testTag("android-authentication-screen"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
            Mk8dxSectionLabel("PLAYERS")
            Mk8dxDisplayText(androidLocalizedPresentation("Who is racing?"), type.display6)
            Text(
                "Switch Player quickly on a shared phone. Every saved result keeps the Player who created it.",
                color = colors.textSecondary,
                style = type.bodyS,
            )
        }
        notificationPlayerHint?.let { player ->
            val hintLabel = androidPlayerLabel(
                accounts.accounts.firstOrNull { it.playerId == player }?.displayName,
                player,
            )
            Mk8dxStatusMessage(
                androidLocalizedPresentation(
                    "Select $hintLabel to open this notification. The app never switches Player silently.",
                ),
                tone = Mk8dxStatusTone.Warning,
            )
        }
        AndroidRememberedAccountsSection(
            accounts = accounts,
            pendingEntryCount = pendingEntryCount,
            onSwitch = { slotId ->
                scope.launch { withContext(workerDispatcher) { controller.switchTo(slotId) } }
                Unit
            },
            onRemove = { slotId ->
                scope.launch { withContext(workerDispatcher) { controller.forget(slotId) } }
                Unit
            },
            // An expired Player signs in again from its own card: one tap starts
            // the device request and opens the approval page in the browser.
            // Approving the same account reuses this Player's slot.
            onSignInAgain = startDeviceAuthorization,
            signInAgainEnabled = state !is AndroidAuthenticationState.Working,
        )
        when (val current = state) {
            AndroidAuthenticationState.SignedOut -> {
                Mk8dxPanel(null) {
                    Text(
                        "Manual entry and scanning still work on this phone without signing in.",
                        style = type.body,
                        color = colors.textBody,
                    )
                    Mk8dxButton(
                        androidLocalizedPresentation(
                            when {
                                accounts.accounts.isEmpty() -> "Sign in to synchronize"
                                accounts.accounts.all { it.expired } -> "Sign in again"
                                else -> "Add account"
                            },
                        ),
                        startDeviceAuthorization,
                        variant = Mk8dxButtonVariant.Primary,
                        tag = "android-authentication-sign-in",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            AndroidAuthenticationState.Working -> Mk8dxStatusMessage(
                androidLocalizedPresentation("Contacting the authentication service…"),
                modifier = Modifier.testTag("android-authentication-working"),
            )
            is AndroidAuthenticationState.AwaitingApproval -> {
                Mk8dxPanel(null) {
                    // The code itself is data: tabular, exact, never abbreviated
                    // and never shortened by a layout, at any font scale.
                    Mk8dxStatBlock(
                        androidLocalizedPresentation("Device code"),
                        current.authorization.userCode,
                        large = true,
                    )
                    Text(
                        "Approve this request in your browser, then check it here.",
                        style = type.body,
                        color = colors.textBody,
                    )
                    if (notApprovedYet) {
                        Mk8dxStatusMessage(
                            androidLocalizedPresentation(
                                "Not approved yet. Approve the request in your browser, then check again.",
                            ),
                            tone = Mk8dxStatusTone.Warning,
                            modifier = Modifier.testTag("android-authentication-not-approved"),
                        )
                    }
                    Mk8dxButton(
                        androidLocalizedPresentation("Open approval page"),
                        { openApproval(current.authorization.verificationUriComplete) },
                        variant = Mk8dxButtonVariant.Primary,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Mk8dxButton(
                        androidLocalizedPresentation("Check approval"),
                        checkApproval,
                        variant = Mk8dxButtonVariant.Secondary,
                        tag = "android-authentication-check",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            is AndroidAuthenticationState.SignedIn -> {
                Mk8dxPanel(null) {
                    Text(
                        "Signed in and ready to synchronize.",
                        style = type.body,
                        color = colors.textBody,
                        modifier = Modifier.testTag("android-authentication-signed-in"),
                    )
                    Text(
                        "Scanned evidence stays private on this device.",
                        style = type.bodyS,
                        color = colors.textSecondary,
                    )
                    Mk8dxButton(
                        androidLocalizedPresentation("Add account"),
                        startDeviceAuthorization,
                        variant = Mk8dxButtonVariant.Secondary,
                        tag = "android-account-add",
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Mk8dxButton(
                        androidLocalizedPresentation("Sign out"),
                        {
                            scope.launch { withContext(workerDispatcher) { controller.revoke() } }
                        },
                        variant = Mk8dxButtonVariant.Secondary,
                        tag = "android-authentication-sign-out",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            is AndroidAuthenticationState.Failed -> {
                Mk8dxPanel(null) {
                    Mk8dxStatusMessage(
                        androidLocalizedPresentation(
                            when (current.operation) {
                                "denied" -> "The device request was denied."
                                "expired" -> "The device code expired."
                                "player_setup" ->
                                    "You're signed in, but this account has no Player yet. " +
                                        "Finish the one-step Player setup on the website, " +
                                        "then sign in here again."
                                else -> "Authentication could not be completed."
                            },
                        ),
                        tone = Mk8dxStatusTone.Error,
                        modifier = Modifier.testTag("android-authentication-failed"),
                    )
                    current.playerSetupUri?.let { setupUri ->
                        Mk8dxButton(
                            androidLocalizedPresentation("Finish Player setup on the website"),
                            { openApproval(setupUri) },
                            variant = Mk8dxButtonVariant.Primary,
                            tag = "android-authentication-player-setup",
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    Mk8dxButton(
                        androidLocalizedPresentation("Try again"),
                        controller::dismissFailure,
                        variant = Mk8dxButtonVariant.Secondary,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

@Composable
private fun AndroidRememberedAccountsSection(
    accounts: AndroidRememberedAccountsState,
    pendingEntryCount: (slotId: String) -> Int,
    onSwitch: (String) -> Unit,
    onRemove: (String) -> Unit,
    onSignInAgain: () -> Unit,
    signInAgainEnabled: Boolean,
) {
    if (accounts.accounts.isEmpty()) {
        Text(
            "No accounts are remembered on this device.",
            style = Mk8dxTheme.type.bodyS,
            color = Mk8dxTheme.colors.textSecondary,
            modifier = Modifier.testTag("android-account-list-empty"),
        )
        return
    }
    Mk8dxSectionLabel(androidLocalizedPresentation("PLAYERS ON THIS PHONE"))
    Column(
        modifier = Modifier.testTag("android-account-list"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        accounts.accounts.forEachIndexed { index, account ->
            AndroidRememberedAccountRow(
                index = index,
                account = account,
                active = account.slotId == accounts.activeSlotId,
                pendingEntries = runCatching { pendingEntryCount(account.slotId) }
                    .getOrDefault(0),
                onSwitch = { onSwitch(account.slotId) },
                onRemove = { onRemove(account.slotId) },
                onSignInAgain = onSignInAgain,
                signInAgainEnabled = signInAgainEnabled,
            )
        }
    }
}

@Composable
private fun AndroidRememberedAccountRow(
    index: Int,
    account: AndroidRememberedAccount,
    active: Boolean,
    pendingEntries: Int,
    onSwitch: () -> Unit,
    onRemove: () -> Unit,
    onSignInAgain: () -> Unit,
    signInAgainEnabled: Boolean,
) {
    var confirmingRemoval by remember(account.slotId) { mutableStateOf(false) }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Mk8dxPanel(null, modifier = Modifier.testTag("android-account-row-$index")) {
        Text(
            text = androidPlayerLabel(account.displayName, account.playerId),
            style = type.title,
            color = colors.textPrimary,
            modifier = Modifier.testTag("android-account-player-$index"),
        )
        if (active) {
            // The Player this phone is signed in as is you: the volt accent,
            // with the words that say so, never the colour on its own.
            Text(
                text = "ACTIVE PLAYER " +
                    androidPlayerLabel(account.displayName, account.playerId).uppercase(),
                style = type.micro,
                color = colors.personalAccent,
                modifier = Modifier.testTag("android-account-active-$index"),
            )
        }
        if (account.expired) {
            Text(
                text = "Expired — sign in again to synchronize",
                style = type.bodyS,
                color = colors.statusWarning,
                modifier = Modifier.testTag("android-account-expired-$index"),
            )
            Mk8dxButton(
                androidLocalizedPresentation("Sign in again"),
                onSignInAgain,
                variant = Mk8dxButtonVariant.Primary,
                disabledReason = if (signInAgainEnabled) {
                    null
                } else {
                    androidLocalizedPresentation("Contacting the authentication service…")
                },
                disabledReasonShown = false,
                tag = "android-account-sign-in-again-$index",
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Mk8dxButton(
            androidLocalizedPresentation("Switch"),
            onSwitch,
            variant = Mk8dxButtonVariant.Secondary,
            disabledReason = when {
                account.expired -> androidLocalizedPresentation("Expired — sign in again to synchronize")
                active -> androidLocalizedPresentation("ACTIVE PLAYER")
                else -> null
            },
            disabledReasonShown = false,
            tag = "android-account-switch-$index",
            modifier = Modifier.fillMaxWidth(),
        )
        if (confirmingRemoval) {
            Text(
                // Removing credentials must never read as deleting results.
                text = "$pendingEntries saved results still belong to this " +
                    "account. They stay on this device; only the stored " +
                    "sign-in is removed.",
                style = type.bodyS,
                color = colors.textBody,
                modifier = Modifier.testTag("android-account-remove-warning-$index"),
            )
            Mk8dxButton(
                androidLocalizedPresentation("Remove anyway"),
                {
                    confirmingRemoval = false
                    onRemove()
                },
                variant = Mk8dxButtonVariant.Danger,
                tag = "android-account-remove-confirm-$index",
                modifier = Modifier.fillMaxWidth(),
            )
            Mk8dxButton(
                androidLocalizedPresentation("Keep account"),
                { confirmingRemoval = false },
                variant = Mk8dxButtonVariant.Secondary,
                tag = "android-account-remove-cancel-$index",
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            Mk8dxButton(
                androidLocalizedPresentation("Remove"),
                { if (pendingEntries > 0) confirmingRemoval = true else onRemove() },
                variant = Mk8dxButtonVariant.Danger,
                tag = "android-account-remove-$index",
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
