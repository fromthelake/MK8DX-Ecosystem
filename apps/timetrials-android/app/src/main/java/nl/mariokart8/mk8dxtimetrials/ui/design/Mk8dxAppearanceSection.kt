package nl.mariokart8.mk8dxtimetrials.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Settings → Appearance (DESIGN_SYSTEM §19, IMPLEMENTATION_PLAN Phase 4).
 *
 * The appearance **choice** is what a signed-in account keeps (ADR-0205); text
 * size and reduced motion are device-local. The section is a migrated island:
 * it is drawn in the chosen appearance with design-system components, inside a
 * Settings screen that is still legacy until Phase 12.
 */
@Composable
fun Mk8dxAppearanceSection(
    settings: Mk8dxAppearanceSettings,
    onSettingsChanged: (Mk8dxAppearanceSettings) -> Unit,
    nl: Boolean,
    modifier: Modifier = Modifier,
    signedIn: Boolean = false,
    /** True while the account has not taken this device's choice yet. */
    syncPending: Boolean = false,
) {
    fun t(en: String, dutch: String) = if (nl) dutch else en
    val appearance = Mk8dxTheme.appearance
    val colors = Mk8dxTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .testTag("settings-appearance"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Mk8dxSegmentedControl(
            t("Appearance", "Weergave"),
            listOf(
                Mk8dxAppearanceChoice.System to t("System", "Systeem"),
                Mk8dxAppearanceChoice.Light to t("Light", "Licht"),
                Mk8dxAppearanceChoice.Dark to t("Dark", "Donker"),
            ),
            settings.cache.effectiveChoice,
            { choice ->
                onSettingsChanged(
                    settings.copy(
                        cache = Mk8dxAppearanceCache(
                            choice = choice,
                            updatedAtMs = System.currentTimeMillis(),
                            synced = false,
                        ),
                    ),
                )
            },
            Modifier.testTag("appearance-choice"),
        )
        Text(
            when {
                appearance == Mk8dxAppearance.HighContrast -> t(
                    "Your phone asks for high contrast, so the product uses the high-contrast appearance.",
                    "Je telefoon vraagt om hoog contrast, dus het product gebruikt de hoogcontrastweergave.",
                )
                signedIn && syncPending -> t(
                    "Saved on this phone. It reaches your account when the product can reach it.",
                    "Opgeslagen op deze telefoon. Het bereikt je account zodra het product erbij kan.",
                )
                signedIn -> t(
                    "Your choice travels with your account; each device still follows its own System setting.",
                    "Je keuze reist mee met je account; elk apparaat volgt nog steeds zijn eigen systeeminstelling.",
                )
                else -> t(
                    "Saved on this phone. Sign in to keep it across your devices.",
                    "Opgeslagen op deze telefoon. Meld je aan om hem op al je apparaten te houden.",
                )
            },
            style = Mk8dxTheme.type.bodyS,
            color = colors.textSecondary,
            modifier = Modifier.testTag("appearance-explanation"),
        )
        Text(
            t("Text size", "Tekstgrootte"),
            style = Mk8dxTheme.type.label,
            color = colors.textBody,
        )
        Mk8dxSegmentedControl(
            t("Text size", "Tekstgrootte"),
            Mk8dxTextSize.entries.map { it to "${it.wireValue} %" },
            settings.textSize,
            { size -> onSettingsChanged(settings.copy(textSize = size)) },
            Modifier.testTag("appearance-text-size"),
        )
        Text(
            t("Motion", "Beweging"),
            style = Mk8dxTheme.type.label,
            color = colors.textBody,
        )
        Mk8dxSegmentedControl(
            t("Motion", "Beweging"),
            listOf(
                Mk8dxMotionPreference.System to t("Follow the phone", "Volg de telefoon"),
                Mk8dxMotionPreference.Reduced to t("Reduce motion", "Beperk beweging"),
            ),
            settings.motion,
            { motion -> onSettingsChanged(settings.copy(motion = motion)) },
            Modifier.testTag("appearance-motion"),
        )
        Text(
            t(
                "Text size and motion stay on this phone.",
                "Tekstgrootte en beweging blijven op deze telefoon.",
            ),
            style = Mk8dxTheme.type.bodyS,
            color = colors.textSecondary,
        )
    }
}
