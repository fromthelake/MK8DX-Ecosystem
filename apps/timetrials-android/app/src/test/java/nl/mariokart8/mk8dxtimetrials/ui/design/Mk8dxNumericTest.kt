package nl.mariokart8.mk8dxtimetrials.ui.design

import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage.EN
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage.NL
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * T-NUM parity with apps/timetrials-web/test/ds-numeric.test.ts: the same
 * protected range (#1 … #99,999, totals to 16 h), the same answers.
 */
class Mk8dxNumericTest {
    @Test
    fun `formats every protected rank exactly, with the language's separator`() {
        val ranks = listOf(1, 9, 10, 99, 100, 999, 1_000, 9_999, 10_000, 99_999)
        assertEquals(
            listOf("#1", "#9", "#10", "#99", "#100", "#999", "#1,000", "#9,999", "#10,000", "#99,999"),
            ranks.map { Mk8dxNumeric.formatRank(it, EN) },
        )
        assertEquals(
            listOf("#1.000", "#9.999", "#10.000", "#99.999"),
            ranks.map { Mk8dxNumeric.formatRank(it, NL) }.drop(6),
        )
        assertEquals("12.345", Mk8dxNumeric.formatCount(12_345, NL))
        assertThrows(IllegalArgumentException::class.java) { Mk8dxNumeric.formatRank(0, EN) }
    }

    @Test
    fun `sizes the rank column from the largest rank in the dataset, separators included`() {
        assertEquals(2, Mk8dxNumeric.rankColumnChars(9, EN))
        assertEquals(4, Mk8dxNumeric.rankColumnChars(999, EN))
        assertEquals(6, Mk8dxNumeric.rankColumnChars(1_000, EN))
        assertEquals(7, Mk8dxNumeric.rankColumnChars(99_999, NL))
    }

    @Test
    fun `puts hero ranks on four fixed steps, never per value`() {
        assertEquals(List(3) { Mk8dxHeroRankStep.Display2 }, listOf(1, 12, 99).map(Mk8dxNumeric::heroRankStep))
        assertEquals(Mk8dxHeroRankStep.Display3, Mk8dxNumeric.heroRankStep(100))
        assertEquals(Mk8dxHeroRankStep.Display4, Mk8dxNumeric.heroRankStep(9_999))
        assertEquals(List(3) { Mk8dxHeroRankStep.Display5 }, listOf(10_000, 99_999, 123_456).map(Mk8dxNumeric::heroRankStep))
    }

    @Test
    fun `writes times as M_SS_mmm and, from an hour, H_MM_SS_mmm up to 16 h`() {
        assertEquals("0:00.001", Mk8dxNumeric.formatTime(1))
        assertEquals("9:59.999", Mk8dxNumeric.formatTime(599_999))
        assertEquals("1:45.912", Mk8dxNumeric.formatTime(105_912))
        assertEquals("1:00:00.000", Mk8dxNumeric.formatTime(3_600_000))
        assertEquals("15:59:59.999", Mk8dxNumeric.formatTime(16L * 3_600_000 - 1))
    }

    @Test
    fun `signs every delta with + or a true minus and names its direction`() {
        assertEquals("−0.412", Mk8dxNumeric.formatDelta(-412))
        assertEquals("+1:02.004", Mk8dxNumeric.formatDelta(62_004))
        assertEquals("±0.000", Mk8dxNumeric.formatDelta(0))
        assertEquals(
            listOf(Mk8dxDeltaDirection.Faster, Mk8dxDeltaDirection.Slower, Mk8dxDeltaDirection.Even),
            listOf(-1L, 1L, 0L).map(Mk8dxNumeric::deltaDirection),
        )
    }
}
