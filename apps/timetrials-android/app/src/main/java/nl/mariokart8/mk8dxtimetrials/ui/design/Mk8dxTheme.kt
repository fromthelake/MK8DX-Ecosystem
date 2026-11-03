package nl.mariokart8.mk8dxtimetrials.ui.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontSynthesis
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.em
import nl.mariokart8.mk8dxtimetrials.R

/**
 * The design-system theme bridge (DESIGN_SYSTEM.md §3, §23). Built from the
 * generated [Mk8dxTokens] and [Mk8dxType]. Phase 17: this is the only theme
 * the app has — the legacy `ui/Mk8dxTheme.kt` palette and its backdrop were
 * deleted, and every product screen renders inside this one.
 */
enum class Mk8dxAppearance { Dark, Light, HighContrast }

/** The three roles as bundled static instances (res/font, upstream files unmodified). */
object Mk8dxFonts {
    /** Saira Condensed 700/800. There is no upstream italic: the approved look is the synthesized oblique. */
    val Display = FontFamily(
        Font(R.font.saira_condensed_bold, FontWeight.Bold),
        Font(R.font.saira_condensed_extrabold, FontWeight.ExtraBold),
    )
    val Ui = FontFamily(
        Font(R.font.ibm_plex_sans_regular, FontWeight.Normal),
        Font(R.font.ibm_plex_sans_medium, FontWeight.Medium),
        Font(R.font.ibm_plex_sans_semibold, FontWeight.SemiBold),
        Font(R.font.ibm_plex_sans_bold, FontWeight.Bold),
    )
    val Data = FontFamily(
        Font(R.font.ibm_plex_mono_medium, FontWeight.Medium),
        Font(R.font.ibm_plex_mono_semibold, FontWeight.SemiBold),
    )

    fun of(role: Mk8dxFontRole): FontFamily = when (role) {
        Mk8dxFontRole.Display -> Display
        Mk8dxFontRole.Ui -> Ui
        Mk8dxFontRole.Data -> Data
    }
}

/** The whole type scale as text styles (sp only; the phone column below 600 dp). */
@Immutable
data class Mk8dxTypography(
    val display1: TextStyle,
    val display2: TextStyle,
    val display3: TextStyle,
    val display4: TextStyle,
    val display5: TextStyle,
    val display6: TextStyle,
    val title: TextStyle,
    val body: TextStyle,
    val bodyS: TextStyle,
    val label: TextStyle,
    val micro: TextStyle,
    val dataXl: TextStyle,
    val dataL: TextStyle,
    val dataM: TextStyle,
    val data: TextStyle,
    val dataS: TextStyle,
) {
    fun heroRank(step: Mk8dxHeroRankStep): TextStyle = when (step) {
        Mk8dxHeroRankStep.Display2 -> display2
        Mk8dxHeroRankStep.Display3 -> display3
        Mk8dxHeroRankStep.Display4 -> display4
        Mk8dxHeroRankStep.Display5 -> display5
    }

    companion object {
        fun from(phone: Boolean): Mk8dxTypography = Mk8dxTypography(
            display1 = style(Mk8dxType.display1, phone),
            display2 = style(Mk8dxType.display2, phone),
            display3 = style(Mk8dxType.display3, phone),
            display4 = style(Mk8dxType.display4, phone),
            display5 = style(Mk8dxType.display5, phone),
            display6 = style(Mk8dxType.display6, phone),
            title = style(Mk8dxType.title, phone),
            body = style(Mk8dxType.body, phone),
            bodyS = style(Mk8dxType.bodyS, phone),
            label = style(Mk8dxType.label, phone),
            micro = style(Mk8dxType.micro, phone),
            dataXl = style(Mk8dxType.dataXl, phone),
            dataL = style(Mk8dxType.dataL, phone),
            dataM = style(Mk8dxType.dataM, phone),
            data = style(Mk8dxType.data, phone),
            dataS = style(Mk8dxType.dataS, phone),
        )

        /** One token as a TextStyle: family per role, tabular figures for data, oblique caps for display. */
        fun style(token: Mk8dxTypeToken, phone: Boolean): TextStyle = TextStyle(
            fontFamily = Mk8dxFonts.of(token.family),
            fontWeight = FontWeight(token.weight),
            fontStyle = if (token.italic) FontStyle.Italic else FontStyle.Normal,
            // Display synthesizes its oblique from the upright face; UI and data never synthesize.
            fontSynthesis = if (token.italic) FontSynthesis.Style else FontSynthesis.None,
            fontSize = if (phone) token.phoneSize else token.size,
            lineHeight = token.lineHeight.em,
            lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
            fontFeatureSettings = if (token.family == Mk8dxFontRole.Data || token.family == Mk8dxFontRole.Display) "tnum" else null,
        )
    }
}

val LocalMk8dxColors = staticCompositionLocalOf { Mk8dxTokens.Dark }
val LocalMk8dxTypography = staticCompositionLocalOf { Mk8dxTypography.from(phone = true) }
val LocalMk8dxAppearance = staticCompositionLocalOf { Mk8dxAppearance.Dark }

object Mk8dxTheme {
    val colors: Mk8dxColorTokens
        @Composable get() = LocalMk8dxColors.current
    val type: Mk8dxTypography
        @Composable get() = LocalMk8dxTypography.current
    val appearance: Mk8dxAppearance
        @Composable get() = LocalMk8dxAppearance.current

    fun colorsFor(appearance: Mk8dxAppearance): Mk8dxColorTokens = when (appearance) {
        Mk8dxAppearance.Dark -> Mk8dxTokens.Dark
        Mk8dxAppearance.Light -> Mk8dxTokens.Light
        Mk8dxAppearance.HighContrast -> Mk8dxTokens.HighContrast
    }

    /** A semantic colour mixed into surfaceRaised at the appearance's tint share (tinted chips, selected engine). */
    fun tint(colors: Mk8dxColorTokens, color: Color): Color =
        lerp(colors.surfaceRaised, color, colors.tintPercent / 100f)

    /**
     * The readable ink for a label printed *on* a product-data colour (a tier,
     * a part category, a win-percentage heat value). Those colours are data,
     * not tokens, so the system cannot know their contrast in advance: it
     * measures each one and answers with near-black or near-white. This is the
     * one place in the app that decides it.
     */
    fun inkOn(color: Color): Color =
        if (color.luminance() > 0.42f) Color(0xFF0B0D12) else Color(0xFFFFFFFF)
}

/** The appearance the system asks for when the Player has not chosen one (HC is always explicit). */
@Composable
fun mk8dxSystemAppearance(): Mk8dxAppearance =
    if (isSystemInDarkTheme()) Mk8dxAppearance.Dark else Mk8dxAppearance.Light

/**
 * `Mk8dxTheme(appearance)`: design-system colours, type, a content colour and a
 * Material colour scheme mapped from the same tokens, for components that still
 * lean on Material. The whole product runs inside it (Phase 17).
 */
@Composable
fun Mk8dxTheme(
    appearance: Mk8dxAppearance,
    content: @Composable () -> Unit,
) {
    val colors = Mk8dxTheme.colorsFor(appearance)
    val phone = LocalConfiguration.current.screenWidthDp < 600
    val type = Mk8dxTypography.from(phone)
    CompositionLocalProvider(
        LocalMk8dxColors provides colors,
        LocalMk8dxTypography provides type,
        LocalMk8dxAppearance provides appearance,
        // A Text that states no colour must read in this appearance. Material
        // only sets the content colour inside a Surface, and a transparent one
        // sets nothing, which left unstyled text black on the Dark surface.
        LocalContentColor provides colors.textBody,
    ) {
        MaterialTheme(
            colorScheme = materialScheme(colors, appearance),
            typography = Typography(
                bodyLarge = type.body,
                bodyMedium = type.body,
                bodySmall = type.bodyS,
                titleMedium = type.title,
                labelLarge = type.label,
                labelMedium = type.label,
                labelSmall = type.micro,
            ),
            content = content,
        )
    }
}

private fun materialScheme(colors: Mk8dxColorTokens, appearance: Mk8dxAppearance): ColorScheme {
    val base = if (appearance == Mk8dxAppearance.Light) lightColorScheme() else darkColorScheme()
    return base.copy(
        primary = colors.actionPrimary,
        onPrimary = colors.actionOnPrimary,
        secondary = colors.personalAccent,
        onSecondary = colors.personalOnAccent,
        background = colors.surfaceApp,
        onBackground = colors.textPrimary,
        surface = colors.surfaceRaised,
        onSurface = colors.textPrimary,
        surfaceVariant = colors.surfaceControl,
        onSurfaceVariant = colors.textSecondary,
        outline = colors.borderStrong,
        outlineVariant = colors.borderSubtle,
        error = colors.statusError,
        scrim = colors.scrim,
    )
}
