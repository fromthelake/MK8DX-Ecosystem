package nl.mariokart8.mk8dxtimetrials.lan

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticationController
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticationState
import nl.mariokart8.mk8dxtimetrials.auth.AndroidInvitationResult
import nl.mariokart8.mk8dxtimetrials.auth.androidPlayerLabel
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguageStore
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTextField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/** Whether the onboarding steps should show for [origin] before the app itself (called before composition). */
internal fun androidLanOnboardingWanted(context: android.content.Context, origin: String): Boolean =
    AndroidLanPairingStore.loadFor(context, origin) != null &&
        !AndroidLanOnboardingStore.completed(context, origin) &&
        !AndroidLanOnboardingStore.isLater(origin)

/**
 * After "Connect" to a home or club installation: 1 Connect ✓, 2 Let your phone trust the installation,
 * 3 Sign in. Shown at each start until done; "Later" says what does not work yet and hides it until the next
 * start. [onLeave] returns to the app.
 */
@Composable
internal fun AndroidLanOnboardingScreen(
    origin: String,
    controller: AndroidAuthenticationController,
    onLeave: () -> Unit,
) {
    val context = LocalContext.current
    val language = remember { AndroidProductLanguageStore.readForFirstStart(context) }
    CompositionLocalProvider(LocalAndroidProductLanguage provides language) {
        Mk8dxTheme(Mk8dxTheme.appearance) {
            OnboardingContent(origin, controller, language, onLeave)
        }
    }
}

@Composable
private fun OnboardingContent(
    origin: String,
    controller: AndroidAuthenticationController,
    language: AndroidProductLanguage,
    onLeave: () -> Unit,
) {
    val context = LocalContext.current
    fun t(en: String, nl: String) = androidText(language, en, nl)
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val scope = rememberCoroutineScope()
    val pairing = remember(origin) { AndroidLanPairingStore.loadFor(context, origin) }
    val authState by controller.state.collectAsState()
    var trust by remember { mutableStateOf(AndroidSystemTrust.Unknown) }
    var trustCheck by remember { mutableIntStateOf(0) }
    var opened by rememberSaveable { mutableStateOf<AndroidLanOnboardingStep?>(null) }
    // The phone's own store is asked again on every return: after installing in Settings, the step turns green.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) trustCheck++ }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(trustCheck) {
        trust = AndroidSystemTrust.Unknown
        trust = withContext(Dispatchers.IO) { AndroidSystemTrustProbe.create().check(origin) }
    }
    val signedIn = authState is AndroidAuthenticationState.SignedIn
    val plan = AndroidLanOnboardingRules.plan(
        AndroidLanOnboardingFacts(
            paired = pairing != null,
            systemTrust = trust,
            signedIn = signedIn,
            completedBefore = false,
            laterThisStart = false,
        ),
    )
    LaunchedEffect(plan.complete) { if (plan.complete) AndroidLanOnboardingStore.markCompleted(context, origin) }
    val currentStep = plan.steps.firstOrNull { it.second == AndroidLanStepStatus.Current }?.first
    val expanded = opened ?: currentStep

    Column(
        Modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(Mk8dxSpacing.xxl)
            .testTag("lan-onboarding"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.lg),
    ) {
        Mk8dxSectionLabel(t("HOME OR CLUB", "THUIS OF CLUB"))
        Mk8dxDisplayText(t("Almost ready", "Bijna klaar"), type.display4)
        Text(
            t(
                "Three steps for this phone. You only do them once.",
                "Drie stappen voor deze telefoon. Je doet ze maar één keer.",
            ),
            style = type.body,
            color = colors.textBody,
        )
        plan.steps.forEachIndexed { index, (step, status) ->
            StepHeader(
                number = index + 1,
                title = when (step) {
                    AndroidLanOnboardingStep.Connect -> t("Connect", "Verbinden")
                    AndroidLanOnboardingStep.Trust -> t("Let your phone trust the installation", "Je telefoon laten vertrouwen")
                    AndroidLanOnboardingStep.SignIn -> t("Sign in", "Inloggen")
                },
                status = status,
                onClick = { if (step != AndroidLanOnboardingStep.Connect) opened = step },
                tag = "lan-onboarding-step-${index + 1}",
            )
            if (expanded == step && step == AndroidLanOnboardingStep.Trust && pairing != null) {
                TrustStep(origin, pairing, trust, language, onCheckAgain = { trustCheck++ })
            }
            if (expanded == step && step == AndroidLanOnboardingStep.SignIn) {
                val session = (authState as? AndroidAuthenticationState.SignedIn)?.session
                if (session != null) {
                    val player = androidPlayerLabel(session.displayName, session.playerId)
                    Mk8dxStatusMessage(
                        t("Signed in as $player.", "Aangemeld als $player."),
                        tone = Mk8dxStatusTone.Success,
                    )
                } else {
                    AndroidInvitationSignIn(origin, controller, language)
                }
            }
        }
        if (plan.complete) {
            Mk8dxStatusMessage(t("All set. Enjoy racing!", "Alles klaar. Veel raceplezier!"), tone = Mk8dxStatusTone.Success)
            Mk8dxButton(
                t("Done", "Klaar"),
                onLeave,
                variant = Mk8dxButtonVariant.Primary,
                tag = "lan-onboarding-done",
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            Text(
                t(
                    "Later? The app already works on this phone. Until step 2 is done, the website in your browser shows a security warning; until step 3, your times stay on this phone. These steps come back at the next start.",
                    "Later? De app werkt al op deze telefoon. Tot stap 2 klaar is, geeft de website in je browser een beveiligingswaarschuwing; tot stap 3 blijven je tijden op deze telefoon. Deze stappen komen terug bij de volgende start.",
                ),
                style = type.bodyS,
                color = colors.textSecondary,
            )
            Mk8dxButton(
                t("Later", "Later"),
                { AndroidLanOnboardingStore.later(origin); onLeave() },
                variant = Mk8dxButtonVariant.Quiet,
                tag = "lan-onboarding-later",
            )
        }
    }
}

@Composable
private fun StepHeader(number: Int, title: String, status: AndroidLanStepStatus, onClick: () -> Unit, tag: String) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val done = status == AndroidLanStepStatus.Done
    val current = status == AndroidLanStepStatus.Current
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(36.dp)
                .background(if (done) colors.statusSuccess else colors.surfaceRaised, CircleShape)
                .border(Mk8dxSpacing.xxs, if (current) colors.statusInfo else colors.borderStrong, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(if (done) "✓" else number.toString(), style = type.label, color = if (done) colors.surfaceApp else colors.textPrimary)
        }
        Text(
            title,
            style = if (current) type.label.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold) else type.label,
            color = if (status == AndroidLanStepStatus.Todo) colors.textSecondary else colors.textPrimary,
        )
    }
}

@Composable
private fun TrustStep(
    origin: String,
    pairing: AndroidLanPairing,
    trust: AndroidSystemTrust,
    language: AndroidProductLanguage,
    onCheckAgain: () -> Unit,
) {
    val context = LocalContext.current
    fun t(en: String, nl: String) = androidText(language, en, nl)
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    var saved by rememberSaveable { mutableStateOf<String?>(null) }
    var saveFailed by rememberSaveable { mutableStateOf(false) }
    val brand = remember { AndroidCertificateInstallRoute.brand(Build.MANUFACTURER, Build.BRAND) }
    val route = AndroidCertificateInstallRoute.steps(brand)
    Mk8dxPanel(null, modifier = Modifier.testTag("lan-onboarding-trust")) {
        Text(
            t(
                "This app already trusts the installation. Your phone itself does not yet: the website in the browser and signing in through the browser need it. Save the certificate, then install it in Settings as a CA certificate.",
                "Deze app vertrouwt de installatie al. Je telefoon zelf nog niet: de website in de browser en inloggen via de browser hebben dat nodig. Sla het certificaat op en installeer het daarna in Instellingen als CA-certificaat.",
            ),
            style = type.body,
            color = colors.textBody,
        )
        Mk8dxButton(
            t("Save certificate", "Certificaat opslaan"),
            {
                val name = AndroidLanCertificateFileName.of(pairing.root)
                when (val result = AndroidLanCertificateSaver.save(context, pairing.root, name)) {
                    is AndroidCertificateSaveResult.Saved -> { saved = result.fileName; saveFailed = false }
                    AndroidCertificateSaveResult.Failed -> { saved = null; saveFailed = true }
                }
            },
            variant = if (saved == null) Mk8dxButtonVariant.Primary else Mk8dxButtonVariant.Secondary,
            tag = "lan-onboarding-save-certificate",
            modifier = Modifier.fillMaxWidth(),
        )
        saved?.let {
            Mk8dxStatusMessage(t("Saved in Downloads as $it.", "Opgeslagen in Downloads als $it."), tone = Mk8dxStatusTone.Success)
        }
        if (saveFailed) {
            Mk8dxStatusMessage(t("The certificate could not be saved. Try again.", "Het certificaat kon niet worden opgeslagen. Probeer opnieuw."), tone = Mk8dxStatusTone.Error)
        }
        Mk8dxButton(
            t("Open Settings", "Instellingen openen"),
            { AndroidCertificateSettings.open(context) },
            variant = if (saved != null) Mk8dxButtonVariant.Primary else Mk8dxButtonVariant.Secondary,
            tag = "lan-onboarding-open-settings",
            modifier = Modifier.fillMaxWidth(),
        )
        Text(t("On this phone:", "Op deze telefoon:"), style = type.bodyS, color = colors.textSecondary)
        Text(t(route.first, route.second), style = type.bodyS, color = colors.textBody, modifier = Modifier.testTag("lan-onboarding-route"))
        when (trust) {
            AndroidSystemTrust.Unknown -> Mk8dxStatusMessage(t("Checking…", "Controleren…"), tone = Mk8dxStatusTone.Info)
            AndroidSystemTrust.Trusted -> Mk8dxStatusMessage(
                t("Your phone trusts this installation.", "Je telefoon vertrouwt deze installatie."),
                tone = Mk8dxStatusTone.Success,
                modifier = Modifier.testTag("lan-onboarding-trusted"),
            )
            AndroidSystemTrust.NotTrusted -> Mk8dxStatusMessage(
                t("Not trusted by your phone yet.", "Nog niet vertrouwd door je telefoon."),
                tone = Mk8dxStatusTone.Warning,
                modifier = Modifier.testTag("lan-onboarding-not-trusted"),
            )
            AndroidSystemTrust.Unreachable -> Mk8dxStatusMessage(
                t("The installation cannot be reached right now. Check the Wi-Fi.", "De installatie is nu niet bereikbaar. Controleer de wifi."),
                tone = Mk8dxStatusTone.Warning,
            )
        }
        Mk8dxButton(t("Check again", "Opnieuw controleren"), onCheckAgain, variant = Mk8dxButtonVariant.Quiet, tag = "lan-onboarding-check-trust")
    }
}

private sealed interface InvitationStep {
    data object Idle : InvitationStep
    data object Scanning : InvitationStep
    data class Confirm(val card: AndroidOfflineInvitationCard, val label: String) : InvitationStep
    data object Working : InvitationStep
}

/**
 * Sign in with the personal sign-in card, inside the app: scan it with the app's own scanner, see who it signs in
 * as, confirm. The card's token goes only to the installation it was printed for (the one this phone is connected
 * to, over the pinned connection) and is never stored.
 */
@Composable
internal fun AndroidInvitationSignIn(
    origin: String,
    controller: AndroidAuthenticationController,
    language: AndroidProductLanguage,
) {
    fun t(en: String, nl: String) = androidText(language, en, nl)
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf<InvitationStep>(InvitationStep.Idle) }
    var message by remember { mutableStateOf<Pair<String, Mk8dxStatusTone>?>(null) }
    var pasted by remember { mutableStateOf("") }

    fun explain(result: AndroidInvitationResult): String = when (result) {
        AndroidInvitationResult.Unavailable -> t(
            "This card can no longer be used (it is valid once, for 15 minutes). Ask your administrator for a new one.",
            "Deze kaart kan niet meer gebruikt worden (hij werkt één keer, 15 minuten lang). Vraag je beheerder om een nieuwe.",
        )
        AndroidInvitationResult.OtherInstallation -> t(
            "This card belongs to another installation than the one this phone is connected to.",
            "Deze kaart hoort bij een andere installatie dan die waarmee deze telefoon verbonden is.",
        )
        AndroidInvitationResult.RateLimited -> t("Too many attempts. Wait a moment, then try again.", "Te veel pogingen. Wacht even en probeer opnieuw.")
        else -> t("Signing in did not work. Try again.", "Aanmelden lukte niet. Probeer opnieuw.")
    }

    fun take(text: String) {
        when (val parsed = AndroidOfflineInvitationCardParser.parse(text, origin)) {
            AndroidInvitationCardParse.NotACard -> message = t(
                "This is not a personal sign-in card.",
                "Dit is geen persoonlijke inlogkaart.",
            ) to Mk8dxStatusTone.Error
            is AndroidInvitationCardParse.OtherInstallation -> {
                step = InvitationStep.Idle
                message = explain(AndroidInvitationResult.OtherInstallation) to Mk8dxStatusTone.Error
            }
            is AndroidInvitationCardParse.Card -> {
                step = InvitationStep.Working
                message = null
                scope.launch {
                    val result = withContext(Dispatchers.IO) { runCatching { controller.previewInvitation(parsed.card) }.getOrNull() }
                    if (result is AndroidInvitationResult.Preview) {
                        step = InvitationStep.Confirm(parsed.card, result.displayLabel)
                    } else {
                        step = InvitationStep.Idle
                        message = (result?.let(::explain)
                            ?: t("The installation could not be reached. Check the Wi-Fi.", "De installatie is niet bereikbaar. Controleer de wifi.")) to
                            Mk8dxStatusTone.Error
                    }
                }
            }
        }
    }

    Mk8dxPanel(null, modifier = Modifier.testTag("lan-onboarding-sign-in")) {
        when (val current = step) {
            InvitationStep.Idle -> {
                Text(
                    t(
                        "Scan the personal sign-in card your administrator made for you. The card works once, for 15 minutes.",
                        "Scan de persoonlijke inlogkaart die je beheerder voor je maakte. De kaart werkt één keer, 15 minuten lang.",
                    ),
                    style = type.body,
                    color = colors.textBody,
                )
                Mk8dxButton(
                    t("Scan sign-in card", "Inlogkaart scannen"),
                    { message = null; step = InvitationStep.Scanning },
                    variant = Mk8dxButtonVariant.Primary,
                    camera = true,
                    tag = "invitation-scan",
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            InvitationStep.Scanning -> {
                QrCameraPreview(
                    onText = ::take,
                    label = t("Use the camera", "Camera gebruiken"),
                    accepts = { AndroidOfflineInvitationCardParser.parse(it, origin) is AndroidInvitationCardParse.Card },
                    tag = "invitation-camera",
                )
                Mk8dxTextField(
                    label = t("Or paste the sign-in link", "Of plak de inloglink"),
                    value = pasted,
                    onValueChange = { pasted = it },
                    tag = "invitation-link",
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                    Mk8dxButton(t("Cancel", "Annuleren"), { step = InvitationStep.Idle; pasted = "" }, variant = Mk8dxButtonVariant.Quiet, tag = "invitation-cancel")
                    Mk8dxButton(
                        t("Next", "Volgende"),
                        { take(pasted) },
                        variant = Mk8dxButtonVariant.Primary,
                        disabledReason = if (pasted.isBlank()) t("Paste the sign-in link first", "Plak eerst de inloglink") else null,
                        disabledReasonShown = false,
                        tag = "invitation-next",
                    )
                }
            }
            is InvitationStep.Confirm -> {
                Text(t("You sign in as:", "Je meldt je aan als:"), style = type.body, color = colors.textBody)
                Text(current.label, style = type.display6, color = colors.textPrimary, modifier = Modifier.testTag("invitation-label"))
                Text(
                    t(
                        "Not you? Then do not sign in; the card stays valid for the right person.",
                        "Ben jij dit niet? Meld je dan niet aan; de kaart blijft geldig voor de juiste persoon.",
                    ),
                    style = type.bodyS,
                    color = colors.textSecondary,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                    Mk8dxButton(t("Cancel", "Annuleren"), { step = InvitationStep.Idle }, variant = Mk8dxButtonVariant.Quiet, tag = "invitation-cancel")
                    Mk8dxButton(
                        t("Sign in", "Aanmelden"),
                        {
                            step = InvitationStep.Working
                            scope.launch {
                                val result = withContext(Dispatchers.IO) {
                                    runCatching { controller.signInWithInvitation(current.card) }.getOrNull()
                                }
                                step = InvitationStep.Idle
                                message = when {
                                    result is AndroidInvitationResult.Redeemed &&
                                        controller.state.value is AndroidAuthenticationState.SignedIn -> null
                                    result is AndroidInvitationResult.Redeemed -> t(
                                        "The card was used, but this account has no Player yet. Finish the Player setup on the website.",
                                        "De kaart is gebruikt, maar dit account heeft nog geen speler. Rond de spelersinstelling af op de website.",
                                    ) to Mk8dxStatusTone.Error
                                    result == null -> t("Signing in did not work. Try again.", "Aanmelden lukte niet. Probeer opnieuw.") to Mk8dxStatusTone.Error
                                    else -> explain(result) to Mk8dxStatusTone.Error
                                }
                            }
                        },
                        variant = Mk8dxButtonVariant.Primary,
                        tag = "invitation-confirm",
                    )
                }
            }
            InvitationStep.Working -> Mk8dxStatusMessage(t("Contacting the installation…", "Contact met de installatie…"), tone = Mk8dxStatusTone.Info)
        }
        message?.let { (text, tone) -> Mk8dxStatusMessage(text, tone = tone, modifier = Modifier.testTag("invitation-message")) }
    }
}
