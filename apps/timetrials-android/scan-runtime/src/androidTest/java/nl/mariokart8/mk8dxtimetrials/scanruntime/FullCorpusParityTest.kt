package nl.mariokart8.mk8dxtimetrials.scanruntime

import android.graphics.BitmapFactory
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mk8dx.mobileocr.OfflineParityPackagedRunner
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FullCorpusParityTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val testAssets = instrumentation.context.assets

    private fun jsonAsset(path: String): JSONObject = testAssets.open(path)
        .bufferedReader()
        .use { JSONObject(it.readText()) }

    // The source APK numbered flags one-based (TT Scan); the staged engine reports the
    // schema-9 country index (ADR-0214), so a source flag number is one higher.
    private fun normalizedIdentity(slot: JSONObject?, kind: String, sourceNumbering: Boolean = false): String = when (kind) {
        "wheel" -> slot?.optInt("index", -1)?.toString() ?: "-1"
        "flag" -> slot?.optInt("index", -1)?.let { if (sourceNumbering && it > 0) it - 1 else it }?.toString() ?: "-1"
        else -> slot?.optString("family")?.takeIf { it.isNotEmpty() }
            ?: slot?.optString("id").orEmpty()
    }

    @Test
    fun allPinnedFramesMatchSourceTimeAndIdentityFamilySemantics() {
        val context = instrumentation.targetContext
        val runner = OfflineParityPackagedRunner(context)
        val frameNames = checkNotNull(testAssets.list("corpus/frames")).sorted()
        val identityGt = jsonAsset("corpus/gt_identity.json").getJSONObject("frames")
        val failures = mutableListOf<String>()
        var timeFieldsCompared = 0
        var identitySlotsCompared = 0
        // The parity target is what the source APK produced through the gallery
        // path. Seven entries in the v0.4.1 testkit are recorded run failures
        // rather than recognition outcomes ("geen 26-json (blocked of
        // timeout)", no fields, wall_ms null), so for exactly those frames the
        // comparison falls back to the source's own reference set, which is
        // byte-identical between the original snapshot and v0.4.1. Every frame
        // is still compared against pinned truth; none is skipped.
        var framesFromReference = 0

        assertEquals(58, frameNames.size)
        frameNames.forEachIndexed { index, frameName ->
            val frameId = frameName.substringBeforeLast('.')
            val pinnedApk = jsonAsset("corpus/results/$frameId.json")
            val apkRunUsable = pinnedApk.optBoolean("completed", false) &&
                pinnedApk.optJSONObject("fields")?.length() ?: 0 > 0 &&
                pinnedApk.has("kart_config")
            val expected = if (apkRunUsable) {
                pinnedApk
            } else {
                framesFromReference += 1
                jsonAsset("corpus/reference/$frameId.json")
            }
            val bitmap = testAssets.open("corpus/frames/$frameName")
                .use(BitmapFactory::decodeStream)
            val result = runner.runLiveBitmap(bitmap, false, frameId)
            bitmap.recycle()
            val envelope = JSONObject(ScanRuntimeFrameEnvelope.encode(result))

            if (result.status != "valid_decode" || !result.frameValid || result.lapSumOk != true) {
                failures += "$frameId status=${result.status} valid=${result.frameValid} lap=${result.lapSumOk}"
            }
            val expectedFields = expected.getJSONObject("fields")
            val actualFields = envelope.getJSONObject("fields")
            expectedFields.keys().forEach { key ->
                timeFieldsCompared += 1
                val expectedValue = expectedFields.getString(key)
                val actualValue = if (actualFields.has(key)) actualFields.getString(key) else null
                if (actualValue != expectedValue) {
                    failures += "$frameId field.$key expected=$expectedValue actual=$actualValue"
                }
            }

            val expectedKartConfig = expected.getJSONObject("kart_config")
            // Guard the fallback itself: a reference entry that is also
            // incomplete would silently weaken the gate.
            val actualOwners = envelope.optJSONObject("kart_config")?.optJSONObject("owners")
            val gtFrame = identityGt.getJSONObject(frameId)
            gtFrame.keys().forEach { owner ->
                val gtOwner = gtFrame.getJSONObject(owner)
                gtOwner.keys().forEach { kind ->
                    val gtSlot = gtOwner.getJSONObject(kind)
                    if (!gtSlot.optBoolean("unsure", false) && gtSlot.optString("name").isNotEmpty()) {
                        identitySlotsCompared += 1
                        val expectedValue = normalizedIdentity(
                            expectedKartConfig.optJSONObject(owner)?.optJSONObject(kind),
                            kind,
                            sourceNumbering = true,
                        )
                        val actualValue = normalizedIdentity(
                            actualOwners?.optJSONObject(owner)?.optJSONObject(kind),
                            kind,
                        )
                        if (actualValue != expectedValue) {
                            failures += "$frameId identity.$owner.$kind expected=$expectedValue actual=$actualValue"
                        }
                    }
                }
            }
            Log.i("MK8Parity", "frame=${index + 1}/58 id=$frameId ms=${result.totalRuntimeMs}")
        }

        Log.i(
            "MK8Parity",
            "summary frames=58 timeFields=$timeFieldsCompared " +
                "identitySlots=$identitySlotsCompared " +
                "fromReference=$framesFromReference failures=${failures.size}",
        )
        // The fallback is bounded on purpose. If it ever grows, the pinned APK
        // run has degraded further and that is a finding, not a detail.
        assertTrue(
            "frames compared against the reference set instead of the pinned " +
                "APK run: $framesFromReference (expected at most 7)",
            framesFromReference <= 7,
        )
        assertEquals(584, timeFieldsCompared)
        assertEquals(565, identitySlotsCompared)
        assertTrue(
            "timeFields=$timeFieldsCompared identitySlots=$identitySlotsCompared " +
                "failures=${failures.size}\n${failures.take(20).joinToString("\n")}",
            failures.isEmpty(),
        )
    }
}
