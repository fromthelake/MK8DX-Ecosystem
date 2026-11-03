package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxFactRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * A14's other half — the wall a retired build hits (MINIMAL), on the design
 * system.
 *
 * It is deliberately a wall and not a reminder: the reason a build gets turned
 * off is that it is doing something the community should no longer be doing,
 * and a dismissible banner is a reminder people learn to dismiss. What it must
 * never do is frighten somebody about their own data, so it says plainly that
 * everything on the phone survives the update — which is true, because
 * installing over the top is the only supported path and never clears data.
 *
 * The floor itself is untouched by this migration: which builds are retired,
 * when the check runs and what it does with the answer are exactly as they
 * were. Only the surface, the type and the button are the system's, and the
 * critical message is the one filled thing on the page (§4: a critical state is
 * the one case a second A4 is allowed, and this page has only this).
 */
@Composable
internal fun AndroidUpdateRequiredScreen(
    retired: AndroidRetiredBuild,
    language: AndroidProductLanguage,
    unsynchronizedResultCount: Int,
    onOpenDownloadPage: () -> Unit,
) {
    Mk8dxTheme(Mk8dxTheme.appearance) {
        val colors = Mk8dxTheme.colors
        val type = Mk8dxTheme.type
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.surfaceApp)
                // Nothing else is on screen to push this clear of the status
                // bar and the gesture handle, so it does that itself.
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(Mk8dxSpacing.xxl)
                .testTag("update-required"),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            Mk8dxSectionLabel(androidText(language, "THIS BUILD", "DEZE VERSIE"))
            Mk8dxDisplayText(
                androidText(language, "Update Required", "Update vereist"),
                type.display4,
            )
            Mk8dxStatusMessage(
                androidText(
                    language,
                    "This version of MK8DX Time Trials has been switched off.",
                    "Deze versie van MK8DX Time Trials is uitgezet.",
                ),
                tone = Mk8dxStatusTone.Error,
            )
            retired.message?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = type.body, color = colors.textBody)
            }
            Mk8dxPanel(androidText(language, "VERSIONS", "VERSIES")) {
                Mk8dxFactRow(
                    androidText(language, "You have", "Je hebt"),
                    "${retired.installedVersionName} (${retired.installedBuild})",
                )
                if (retired.currentVersion.isNotBlank()) {
                    Mk8dxFactRow(
                        androidText(language, "Current version", "Huidige versie"),
                        retired.currentVersion,
                    )
                }
            }
            Mk8dxButton(
                androidText(language, "Get the latest version", "Haal de nieuwste versie"),
                onOpenDownloadPage,
                variant = Mk8dxButtonVariant.Primary,
                size = Mk8dxButtonSize.Lg,
                tag = "update-required-download",
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                androidText(
                    language,
                    "Sign in on the website, download the APK and install it over this one. " +
                        "Never uninstall first.",
                    "Meld je aan op de website, download de APK en installeer die over deze heen. " +
                        "Nooit eerst verwijderen.",
                ),
                style = type.body,
                color = colors.textBody,
            )
            Text(
                if (unsynchronizedResultCount > 0) {
                    androidText(
                        language,
                        "Your accounts and your $unsynchronizedResultCount unsent result" +
                            (if (unsynchronizedResultCount == 1) "" else "s") +
                            " stay on this phone and are kept by the update.",
                        "Je accounts en je $unsynchronizedResultCount niet-verzonden resultaat" +
                            (if (unsynchronizedResultCount == 1) "" else "en") +
                            " blijven op deze telefoon en blijven na de update bewaard.",
                    )
                } else {
                    androidText(
                        language,
                        "Your accounts, saved results and history stay on this phone and are " +
                            "kept by the update.",
                        "Je accounts, opgeslagen resultaten en geschiedenis blijven op deze " +
                            "telefoon en blijven na de update bewaard.",
                    )
                },
                style = type.bodyS,
                color = colors.textSecondary,
            )
        }
    }
}
