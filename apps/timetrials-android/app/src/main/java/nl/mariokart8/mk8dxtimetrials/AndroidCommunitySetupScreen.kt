package nl.mariokart8.mk8dxtimetrials

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.core.graphics.drawable.toBitmap
import nl.mariokart8.mk8dxtimetrials.lan.AndroidLanPairingFlow
import nl.mariokart8.mk8dxtimetrials.lan.AndroidLanPairingStore
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguageStore
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceHost
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceStore
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxBrandLockup
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTextField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * The first screen of a new install, and the one "Change server" opens: which community this app talks to.
 *
 * It used to be bare Material on a white page, in two languages at once and under the status bar (owner,
 * 2026-11-12: "helemaal niet in thema van de app"). It now runs in the design system like every other screen:
 * the brand lockup, the device's appearance, insets kept clear, and the phone's own language until a language
 * is chosen. Home or club (A2) comes first, because that route needs nothing typed.
 */
@Composable
internal fun AndroidCommunitySetup(current: String?, onSave: (String) -> Unit) {
    val context = LocalContext.current
    // Saveable: turning the phone or switching light/dark recreates the activity, and the first version then
    // dropped the person back here halfway through pairing (found on the emulator, 2026-11-12).
    var address by rememberSaveable { mutableStateOf(current.orEmpty()) }
    var error by rememberSaveable { mutableStateOf(false) }
    var pairing by rememberSaveable { mutableStateOf(false) }
    var paired by remember { mutableStateOf(AndroidLanPairingStore.load(context)?.origin) }
    val language = remember(context) { AndroidProductLanguageStore.readForFirstStart(context) }
    val appearance = remember(context) { Mk8dxAppearanceStore(context).read() }
    fun t(english: String, dutch: String) = androidText(language, english, dutch)
    Mk8dxAppearanceHost(appearance) {
        if (pairing) {
            AndroidLanPairingFlow(onPaired = { origin -> pairing = false; onSave(origin) }, onCancel = { pairing = false })
            return@Mk8dxAppearanceHost
        }
        Mk8dxTheme(Mk8dxTheme.appearance) {
            val colors = Mk8dxTheme.colors
            val type = Mk8dxTheme.type
            val appIcon = remember(context) {
                context.applicationInfo.loadIcon(context.packageManager).toBitmap(192, 192).asImageBitmap()
            }
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(colors.surfaceApp)
                    // This screen has no shell around it: it keeps itself clear of the status bar and the
                    // gesture handle (the first version drew its title under the clock).
                    .safeDrawingPadding()
                    .verticalScroll(rememberScrollState())
                    .padding(Mk8dxSpacing.xxl)
                    .testTag("community-setup"),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.lg),
            ) {
                Mk8dxBrandLockup(appIcon, platform = "ANDROID")
                Mk8dxSectionLabel(if (current == null) t("FIRST START", "EERSTE START") else t("SERVER", "SERVER"))
                Mk8dxDisplayText(t("Choose your community", "Kies je community"), type.display4)
                Text(
                    t(
                        "MK8DX works with the website of your own community. Choose how you reach it.",
                        "MK8DX werkt met de website van je eigen community. Kies hoe je die bereikt.",
                    ),
                    style = type.body,
                    color = colors.textBody,
                )
                Mk8dxPanel(t("AT HOME OR AT THE CLUB", "THUIS OF BIJ DE CLUB")) {
                    Text(
                        t(
                            "Scan the setup QR code that MK8DX beheer shows on the computer that hosts it. No internet needed.",
                            "Scan de setup-QR-code die MK8DX beheer laat zien op de computer waar het op draait. Geen internet nodig.",
                        ),
                        style = type.body,
                        color = colors.textBody,
                    )
                    Mk8dxButton(
                        t("Scan the QR code", "Scan de QR-code"),
                        { pairing = true },
                        variant = Mk8dxButtonVariant.Primary,
                        size = Mk8dxButtonSize.Lg,
                        camera = true,
                        tag = "community-setup-scan",
                        modifier = Modifier.fillMaxWidth(),
                    )
                    paired?.let { origin ->
                        Mk8dxStatusMessage(t("Paired with $origin", "Gekoppeld met $origin"), tone = Mk8dxStatusTone.Success)
                        Mk8dxButton(
                            t("Forget this installation", "Deze installatie vergeten"),
                            { AndroidLanPairingStore.forget(context); paired = null },
                            variant = Mk8dxButtonVariant.Quiet,
                            tag = "community-setup-forget",
                        )
                    }
                }
                Mk8dxPanel(t("ONLINE COMMUNITY", "ONLINE COMMUNITY")) {
                    Mk8dxTextField(
                        label = t("Website address", "Adres van de website"),
                        value = address,
                        onValueChange = { address = it; error = false },
                        placeholder = "https://www.example.org",
                        hint = t("The exact https address your community gave you.", "Het precieze https-adres dat je van je community kreeg."),
                        keyboardType = KeyboardType.Uri,
                        invalid = error,
                        tag = "community-setup-address",
                    )
                    if (error) {
                        Mk8dxStatusMessage(
                            t("Use one https address without a final slash, path or port.", "Gebruik één https-adres zonder slash aan het eind, pad of poort."),
                            tone = Mk8dxStatusTone.Error,
                        )
                    }
                    Mk8dxButton(
                        t("Save", "Opslaan"),
                        {
                            val valid = AndroidServerOrigin.validate(address)
                            if (valid == null) error = true else onSave(valid)
                        },
                        variant = Mk8dxButtonVariant.Secondary,
                        size = Mk8dxButtonSize.Lg,
                        tag = "community-setup-save",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (current != null) {
                    Text(
                        t(
                            "Existing accounts and waiting runs stay with the old server.",
                            "Bestaande accounts en wachtende ritten blijven bij de oude server.",
                        ),
                        style = type.body,
                        color = colors.textSecondary,
                    )
                }
            }
        }
    }
}
