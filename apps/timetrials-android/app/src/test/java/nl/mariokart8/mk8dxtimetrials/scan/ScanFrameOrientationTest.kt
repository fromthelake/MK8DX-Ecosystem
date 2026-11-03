package nl.mariokart8.mk8dxtimetrials.scan

import android.view.OrientationEventListener
import android.view.Surface
import androidx.exifinterface.media.ExifInterface
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The scan follows the phone. What the engine receives must not depend on
 * which way the phone was held, so the two pure rules behind that are pinned
 * here: which rotation a capture is stamped with, and which part of an
 * upright frame is read.
 */
class ScanFrameOrientationTest {
    @Test
    fun captureRotationFollowsTheFourDeviceOrientationsWithCentredSectors() {
        assertNull(captureRotationFor(OrientationEventListener.ORIENTATION_UNKNOWN))
        // Upright, a little either way, stays upright.
        assertEquals(Surface.ROTATION_0, captureRotationFor(0))
        assertEquals(Surface.ROTATION_0, captureRotationFor(44))
        assertEquals(Surface.ROTATION_0, captureRotationFor(315))
        // Turned to the right (home button on the left) is landscape.
        assertEquals(Surface.ROTATION_270, captureRotationFor(90))
        assertEquals(Surface.ROTATION_270, captureRotationFor(45))
        assertEquals(Surface.ROTATION_270, captureRotationFor(134))
        // Upside down and reverse landscape are their own rotations, not the
        // nearest "normal" one: a frame taken that way must still come out
        // upright.
        assertEquals(Surface.ROTATION_180, captureRotationFor(180))
        assertEquals(Surface.ROTATION_90, captureRotationFor(270))
        assertEquals(Surface.ROTATION_90, captureRotationFor(314))
    }

    @Test
    fun landscapeFramesAreReadWholeAndPortraitFramesAsTheirCentred4by3Box() {
        assertArrayEquals(intArrayOf(0, 0, 1280, 720), uprightResultCrop(1280, 720))
        assertArrayEquals(intArrayOf(0, 0, 4000, 3000), uprightResultCrop(4000, 3000))
        assertArrayEquals(intArrayOf(0, 0, 100, 100), uprightResultCrop(100, 100))
        // A 3:4 portrait photo of the TV: the 4:3 box across the full width,
        // centred, the region the aiming guide covers on the preview.
        assertArrayEquals(intArrayOf(0, 875, 3000, 2250), uprightResultCrop(3000, 4000))
        assertArrayEquals(intArrayOf(0, 555, 1080, 810), uprightResultCrop(1080, 1920))
        // Never an empty band.
        assertArrayEquals(intArrayOf(0, 1, 1, 1), uprightResultCrop(1, 3))
    }

    @Test
    fun exifOrientationsMapToTheRotationThatMakesTheFrameUpright() {
        assertEquals(0, exifRotationDegrees(ExifInterface.ORIENTATION_NORMAL))
        assertEquals(0, exifRotationDegrees(ExifInterface.ORIENTATION_UNDEFINED))
        assertEquals(90, exifRotationDegrees(ExifInterface.ORIENTATION_ROTATE_90))
        assertEquals(180, exifRotationDegrees(ExifInterface.ORIENTATION_ROTATE_180))
        assertEquals(270, exifRotationDegrees(ExifInterface.ORIENTATION_ROTATE_270))
    }
}
