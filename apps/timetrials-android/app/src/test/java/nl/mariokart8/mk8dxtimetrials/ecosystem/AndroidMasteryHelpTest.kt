package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AndroidMasteryHelpTest {
    @Test
    fun helpUsesTheCanonicalFixedRatiosAndTenthSecondRounding() {
        assertEquals(2.1225129463068986, androidMasteryTierOffsetPercent(0)!!, 0.0000000001)
        assertEquals(91_900L, androidMasteryTierLimitMs(90_000, 0))
        assertEquals(107_100L, androidMasteryTierLimitMs(90_000, 16))
        assertEquals(109_200L, androidMasteryTierLimitMs(90_000, 17))
        assertNull(androidMasteryTierOffsetPercent(22))
    }
}
