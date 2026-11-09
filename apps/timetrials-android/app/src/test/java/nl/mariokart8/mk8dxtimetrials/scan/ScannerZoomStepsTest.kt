package nl.mariokart8.mk8dxtimetrials.scan

import org.junit.Assert.assertEquals
import org.junit.Test

class ScannerZoomStepsTest {
    @Test
    fun cyclesThroughTwoPointFiveOnACapableCamera() {
        var zoom = 1f
        for (expected in floatArrayOf(1.5f, 2f, 2.5f, 3f, 1f)) {
            zoom = nextScannerZoom(zoom, 3f)
            assertEquals(expected, zoom, 0.001f)
        }
    }

    @Test
    fun skipsStepsBeyondTheCameraLimit() {
        assertEquals(2f, nextScannerZoom(1.5f, 2.2f), 0.001f)
        assertEquals(1f, nextScannerZoom(2f, 2.2f), 0.001f)
        assertEquals(1f, nextScannerZoom(2f, 2.49f), 0.001f)
        assertEquals(1f, nextScannerZoom(1f, 1f), 0.001f)
    }
}
