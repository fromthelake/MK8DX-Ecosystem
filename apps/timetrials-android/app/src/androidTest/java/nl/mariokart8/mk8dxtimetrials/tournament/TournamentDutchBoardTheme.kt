package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * The dark board in Dutch: the visual tests assert the board's Dutch texts, and the board follows the
 * product language (English by default) since it speaks all 15 languages.
 */
@Composable
internal fun DutchBoardTheme(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalAndroidProductLanguage provides AndroidProductLanguage.DUTCH) {
        Mk8dxTheme(Mk8dxAppearance.Dark, content)
    }
}
