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
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguageStore
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceHost
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceStore
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxBrandLockup
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDialog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSelectField
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
internal fun AndroidCommunitySetup(
    current: String?,
    /** Back to the app without a change; only when a community is already active ("Add a community"). */
    onCancel: (() -> Unit)? = null,
    onSave: (String) -> Unit,
) {
    val context = LocalContext.current
    // Saveable: turning the phone or switching light/dark recreates the activity, and the first version then
    // dropped the person back here halfway through pairing (found on the emulator, 2026-11-12).
    // Adding a community starts from an empty address; the active one is already in the list.
    var address by rememberSaveable { mutableStateOf(if (onCancel != null) "" else current.orEmpty()) }
    var error by rememberSaveable { mutableStateOf(false) }
    var pairing by rememberSaveable { mutableStateOf(false) }
    var paired by remember { mutableStateOf(AndroidLanPairingStore.load(context)?.origin) }
    // The phone's language until somebody picks one here. Whatever this screen shows is written when the
    // community is chosen, so the app does not switch to English right after a Dutch (or Japanese) first start.
    var language by remember(context) { mutableStateOf(AndroidProductLanguageStore.readForFirstStart(context)) }
    var choosingLanguage by rememberSaveable { mutableStateOf(false) }
    fun choose(origin: String) {
        AndroidProductLanguageStore.write(context, language)
        onSave(origin)
    }
    androidx.activity.compose.BackHandler(enabled = onCancel != null && !pairing) { onCancel?.invoke() }
    val appearance = remember(context) { Mk8dxAppearanceStore(context).read() }
    fun t(english: String, dutch: String) = androidText(language, english, dutch)
    Mk8dxAppearanceHost(appearance) {
        if (pairing) {
            AndroidLanPairingFlow(onPaired = { origin -> pairing = false; choose(origin) }, onCancel = { pairing = false })
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
                // Someone who cannot read the phone's language must find this without reading it: the label is
                // in English and Dutch, the value is the language's own name, and a globe marks it.
                Mk8dxSelectField(
                    label = "Language / Taal",
                    value = language.displayName,
                    onOpen = { choosingLanguage = true },
                    modifier = Modifier.testTag("community-setup-language"),
                    leading = { Text("🌐", style = type.body) },
                )
                Mk8dxSectionLabel(if (current == null) t("FIRST START", "EERSTE START") else t("SERVER", "SERVER"))
                Mk8dxDisplayText(t("Choose your community", "Kies je community"), type.display4)
                Text(
                    t(
                        "This app works with your own community: a club, a group of friends or an online community. Pick the way you play below. Not sure? Ask the person who runs your community.",
                        "Deze app werkt met je eigen community: een club, een vriendengroep of een online community. Kies hieronder hoe jullie spelen. Weet je het niet? Vraag het aan wie je community beheert.",
                    ),
                    style = type.body,
                    color = colors.textBody,
                )
                Mk8dxPanel(t("AT HOME OR AT THE CLUB", "THUIS OF BIJ DE CLUB")) {
                    Text(
                        t(
                            "MK8DX runs on a computer at home or at the club. Scan the Prepare a device card your administrator shows or hands out. No internet needed.",
                            "MK8DX draait op een computer thuis of bij de club. Scan de kaart Apparaat voorbereiden die je beheerder laat zien of uitdeelt. Geen internet nodig.",
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
                    // Adding a community is about the new one: the active installation's pairing is managed in the
                    // community list ("Remove from this phone"), not offered for forgetting here (emulator, 12-11).
                    paired?.takeIf { onCancel == null }?.let { origin ->
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
                    Text(
                        t(
                            "Your community has a website on the internet. Enter the address you open it with in the browser.",
                            "Je community heeft een website op internet. Vul het adres in waarmee je die in de browser opent.",
                        ),
                        style = type.body,
                        color = colors.textBody,
                    )
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
                            if (valid == null) error = true else choose(valid)
                        },
                        variant = Mk8dxButtonVariant.Secondary,
                        size = Mk8dxButtonSize.Lg,
                        tag = "community-setup-save",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (choosingLanguage) {
                    Mk8dxDialog(
                        title = "Language / Taal",
                        closeLabel = t("Close", "Sluiten"),
                        onDismiss = { choosingLanguage = false },
                    ) {
                        Column(
                            Modifier.verticalScroll(rememberScrollState()),
                            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                        ) {
                            AndroidProductLanguage.entries.forEach { option ->
                                Mk8dxButton(
                                    option.displayName,
                                    {
                                        language = option
                                        AndroidProductLanguageStore.write(context, option)
                                        choosingLanguage = false
                                    },
                                    variant = if (option == language) Mk8dxButtonVariant.Primary else Mk8dxButtonVariant.Secondary,
                                    tag = "community-setup-language-${option.code}",
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        }
                    }
                }
                if (current != null) {
                    Text(
                        t(
                            "Each community keeps its own account and unsent times. You switch between them under Settings.",
                            "Elke community houdt haar eigen account en niet verzonden tijden. Je wisselt ertussen bij Instellingen.",
                        ),
                        style = type.body,
                        color = colors.textSecondary,
                    )
                }
                onCancel?.let { cancel ->
                    Mk8dxButton(
                        t("Back", "Terug"),
                        cancel,
                        variant = Mk8dxButtonVariant.Quiet,
                        tag = "community-setup-cancel",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}
