package nl.mariokart8.mk8dxtimetrials.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The aiming guide tells the Player where to hold the phone, and the engine
 * reads the frame that produces. If the two drift apart the scan misses without
 * anything looking wrong, so the card geometry is pinned here against the
 * recognition source it was taken from.
 */
class ScanAimingGuideTest {
    @Test
    fun endScreenGuideFramesBothCardsInTheEngineSourceSpace() {
        val three = scanGuideCards(ScanLayoutProfile.ENDSCREEN, 3)
        assertEquals(2, three.size)
        assertEquals(listOf(218f, 77f, 844f, 276f), three[0].toList())
        assertEquals(listOf(218f, 368f, 844f, 275f), three[1].toList())

        val seven = scanGuideCards(ScanLayoutProfile.ENDSCREEN, 7)
        assertEquals(2, seven.size)
        assertEquals(listOf(276f, 41f, 724f, 313f), seven[0].toList())
        assertEquals(listOf(276f, 366f, 724f, 313f), seven[1].toList())
    }

    @Test
    fun ghostDetailGuideFramesOnePanelPerLapProfile() {
        val three = scanGuideCards(ScanLayoutProfile.GHOST_DETAIL, 3)
        assertEquals(1, three.size)
        assertEquals(listOf(314f, 60f, 653f, 600f), three[0].toList())

        val seven = scanGuideCards(ScanLayoutProfile.GHOST_DETAIL, 7)
        assertEquals(1, seven.size)
        assertEquals(listOf(365f, 50f, 551f, 620f), seven[0].toList())
    }

    @Test
    fun ghostDetailFramesCarryThePanelAspectOfTheReferenceScreens() {
        // 3 laps was calibrated on a 1375x1264 panel, 7 laps on 691x777. The
        // frame the Player fills has to have that shape or the panel lands
        // outside the canonical target box.
        val three = scanGuideCards(ScanLayoutProfile.GHOST_DETAIL, 3)[0]
        assertAspect(1375f / 1264f, three[2] / three[3])
        val seven = scanGuideCards(ScanLayoutProfile.GHOST_DETAIL, 7)[0]
        assertAspect(691f / 777f, seven[2] / seven[3])
    }

    @Test
    fun everyGuideCardStaysInsideTheSourceFrame() {
        for (layout in ScanLayoutProfile.entries) {
            for (laps in listOf(3, 7)) {
                scanGuideCards(layout, laps).forEach { card ->
                    assertTrue(card[0] >= 0f && card[1] >= 0f)
                    assertTrue(card[0] + card[2] <= 1280f)
                    assertTrue(card[1] + card[3] <= 720f)
                }
            }
        }
    }

    private fun assertAspect(expected: Float, actual: Float) {
        assertTrue(
            "expected aspect $expected but was $actual",
            kotlin.math.abs(expected - actual) < .005f,
        )
    }

    @Test
    fun portraitGuideFillsNearlyTheWholeWidthInsideTheBoxTheEngineReads() {
        // A 1080-wide upright stage: the engine reads the centred 1080x810 box.
        val width = 1080f
        val height = 1700f
        val boxTop = (height - 810f) / 2f
        for (layout in ScanLayoutProfile.entries) {
            for (laps in listOf(3, 7)) {
                val (rects, _) = scanGuideRects(layout, laps, width, height, portrait = true)
                val left = rects.minOf { it[0] }
                val right = rects.maxOf { it[2] }
                val top = rects.minOf { it[1] }
                val bottom = rects.maxOf { it[3] }
                assertTrue(left >= 0f && right <= width)
                assertTrue(top >= boxTop - 0.5f && bottom <= boxTop + 810f + 0.5f)
                val widthFill = (right - left) / width
                val heightFill = (bottom - top) / 810f
                assertTrue(widthFill <= PORTRAIT_GUIDE_FILL + 0.001f)
                assertTrue(heightFill <= PORTRAIT_GUIDE_FILL_HEIGHT + 0.001f)
                // One of the two limits is reached.
                assertTrue(
                    kotlin.math.abs(widthFill - PORTRAIT_GUIDE_FILL) < 0.001f ||
                        kotlin.math.abs(heightFill - PORTRAIT_GUIDE_FILL_HEIGHT) < 0.001f,
                )
            }
        }
        // The end screen's cards are now well wider than the old two thirds.
        val (endScreen, _) = scanGuideRects(ScanLayoutProfile.ENDSCREEN, 3, width, height, portrait = true)
        assertTrue(endScreen.maxOf { it[2] } - endScreen.minOf { it[0] } > 0.75f * width)
    }

    @Test
    fun landscapeGuideKeepsTheEngineGeometry() {
        val (rects, scale) = scanGuideRects(ScanLayoutProfile.ENDSCREEN, 3, 1280f, 720f, portrait = false)
        assertEquals(1f, scale, 0.0001f)
        assertEquals(listOf(218f, 77f, 1062f, 353f), rects[0].toList())
    }
}
