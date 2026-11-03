package nl.mariokart8.mk8dxtimetrials.scan

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Test

class AndroidBundledScanRuntimeLoaderDeviceTest {
    @Test
    fun scannerEnabledArtifactLoadsItsBundledOfflineAnalyzerFactory() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertNotNull(loadBundledResultImageAnalyzerFactory(context))
    }
}
