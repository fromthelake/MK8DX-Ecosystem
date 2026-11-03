package nl.mariokart8.mk8dxtimetrials.ui.design

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The CP1 components' rules that do not need a screen. */
class Mk8dxComponentLogicTest {
    @Test
    fun `the armed action confirms only on the second press and any change cancels`() {
        val action = Mk8dxArmedAction()
        assertFalse(action.press())
        assertTrue(action.armed)
        action.disarm()
        assertFalse(action.armed)
        assertFalse(action.press())
        assertTrue(action.press())
        assertFalse(action.armed)
    }

    @Test
    fun `time input keeps six digits from the left and announces the formatted time`() {
        assertEquals("145912", Mk8dxTimeInputRules.sanitize("1:45.9127"))
        assertEquals("", Mk8dxTimeInputRules.sanitize("abc"))
        assertEquals("1:45.912", Mk8dxTimeInputRules.valueText("145912"))
        assertEquals("1:40.000", Mk8dxTimeInputRules.valueText("14"))
        assertEquals("0:00.000", Mk8dxTimeInputRules.valueText(""))
    }

    @Test
    fun `the rank column is sized from the largest rank in the dataset`() {
        val rows = listOf(1, 99_999, 999).map { Mk8dxRankRow(rank = it, name = "P$it", timeMs = 100_000) }
        assertEquals(99_999, mk8dxLargestRank(rows))
        assertEquals(1, mk8dxLargestRank(emptyList()))
        assertEquals("#99.999".length, Mk8dxNumeric.rankColumnChars(mk8dxLargestRank(rows), Mk8dxNumberLanguage.NL))
    }

    @Test
    fun `typography maps each role to its family, tabular data and the synthesized display oblique`() {
        val phone = Mk8dxTypography.from(phone = true)
        val wide = Mk8dxTypography.from(phone = false)
        assertEquals(Mk8dxFonts.Data, phone.data.fontFamily)
        assertEquals("tnum", phone.data.fontFeatureSettings)
        assertEquals(Mk8dxFonts.Ui, phone.body.fontFamily)
        assertEquals(null, phone.body.fontFeatureSettings)
        assertEquals(Mk8dxFonts.Display, phone.display2.fontFamily)
        assertEquals(androidx.compose.ui.text.font.FontStyle.Italic, phone.display2.fontStyle)
        assertEquals(androidx.compose.ui.text.font.FontSynthesis.Style, phone.display2.fontSynthesis)
        assertEquals(androidx.compose.ui.text.font.FontWeight.ExtraBold, phone.display2.fontWeight)
        assertEquals(44f, phone.display2.fontSize.value)
        assertEquals(64f, wide.display2.fontSize.value)
        assertEquals(phone.display5, phone.heroRank(Mk8dxNumeric.heroRankStep(99_999)))
    }

    @Test
    fun `every appearance maps to its own token set`() {
        assertEquals(Mk8dxTokens.Dark, Mk8dxTheme.colorsFor(Mk8dxAppearance.Dark))
        assertEquals(Mk8dxTokens.Light, Mk8dxTheme.colorsFor(Mk8dxAppearance.Light))
        assertEquals(Mk8dxTokens.HighContrast, Mk8dxTheme.colorsFor(Mk8dxAppearance.HighContrast))
    }
}
