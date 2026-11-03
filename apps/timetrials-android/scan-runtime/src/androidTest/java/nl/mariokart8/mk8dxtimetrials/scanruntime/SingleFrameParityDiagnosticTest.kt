package nl.mariokart8.mk8dxtimetrials.scanruntime

import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mk8dx.mobileocr.OfflineParityPackagedRunner
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Opt-in diagnostic for one staged corpus frame.
 *
 * Pass `-Pandroid.testInstrumentationRunnerArguments.frameId=<id>` together
 * with a class filter. Without that argument this test is skipped, so the
 * committed full-corpus gate remains the release authority.
 */
@RunWith(AndroidJUnit4::class)
class SingleFrameParityDiagnosticTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val testAssets = instrumentation.context.assets

    // The source APK numbered flags one-based (TT Scan); the staged engine reports the
    // schema-9 country index (ADR-0214), so a source flag number is one higher.
    private fun normalizedIdentity(slot: JSONObject?, kind: String, sourceNumbering: Boolean = false): String = when (kind) {
        "wheel" -> slot?.optInt("index", -1)?.toString() ?: "-1"
        "flag" -> slot?.optInt("index", -1)?.let { if (sourceNumbering && it > 0) it - 1 else it }?.toString() ?: "-1"
        else -> slot?.optString("family")?.takeIf { it.isNotEmpty() }
            ?: slot?.optString("id").orEmpty()
    }

    @Test
    fun selectedFrameMatchesPinnedSourceResult() {
        val frameId = InstrumentationRegistry.getArguments().getString("frameId").orEmpty()
        assumeTrue("Pass frameId to run the single-frame diagnostic", frameId.isNotBlank())

        val frameName = checkNotNull(testAssets.list("corpus/frames"))
            .single { it.substringBeforeLast('.') == frameId }
        val expected = testAssets.open("corpus/results/$frameId.json")
            .bufferedReader()
            .use { JSONObject(it.readText()) }
        val identityGt = testAssets.open("corpus/gt_identity.json")
            .bufferedReader()
            .use { JSONObject(it.readText()).getJSONObject("frames").getJSONObject(frameId) }
        val bitmap = testAssets.open("corpus/frames/$frameName").use(BitmapFactory::decodeStream)
        val result = OfflineParityPackagedRunner(instrumentation.targetContext)
            .runLiveBitmap(bitmap, false, frameId)
        bitmap.recycle()
        val envelope = JSONObject(ScanRuntimeFrameEnvelope.encode(result))

        assertEquals("valid_decode", result.status)
        assertTrue(result.frameValid)
        assertEquals(true, result.lapSumOk)
        val expectedFields = expected.getJSONObject("fields")
        val actualFields = envelope.getJSONObject("fields")
        expectedFields.keys().forEach { key ->
            assertEquals("field.$key", expectedFields.getString(key), actualFields.getString(key))
        }

        val expectedOwners = expected.getJSONObject("kart_config")
        val actualOwners = envelope.getJSONObject("kart_config").getJSONObject("owners")
        identityGt.keys().forEach { owner ->
            val gtOwner = identityGt.getJSONObject(owner)
            gtOwner.keys().forEach { kind ->
                val gtSlot = gtOwner.getJSONObject(kind)
                if (!gtSlot.optBoolean("unsure", false) && gtSlot.optString("name").isNotEmpty()) {
                    assertEquals(
                        "identity.$owner.$kind",
                        normalizedIdentity(expectedOwners.optJSONObject(owner)?.optJSONObject(kind), kind, sourceNumbering = true),
                        normalizedIdentity(actualOwners.optJSONObject(owner)?.optJSONObject(kind), kind),
                    )
                }
            }
        }
    }
}
