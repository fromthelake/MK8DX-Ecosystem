package nl.mariokart8.mk8dxtimetrials.scanruntime

import android.graphics.BitmapFactory
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mk8dx.mobileocr.CleanAssetsMatcher
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.Mat
import org.opencv.imgproc.Imgproc
import java.security.MessageDigest

/** Runs the staged private, visually checked crops through the unchanged APK matcher. */
@RunWith(AndroidJUnit4::class)
class CorrectRoiMatcherBaselineTest {
    @Test
    fun scorePrivateCorrectRoiCharacters() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val assets = instrumentation.context.assets
        val context = instrumentation.targetContext
        assertTrue("OpenCV failed to initialize", OpenCVLoader.initDebug())
        val manifest = assets.open("roi-baseline/cases.json").bufferedReader().use { JSONObject(it.readText()) }
        assertEquals("mk8dx.private-tt-roi-apk-cases.v1", manifest.getString("schema"))
        val cases = manifest.getJSONArray("cases")
        assertTrue("No staged ROI cases", cases.length() > 0)
        val matcher = CleanAssetsMatcher(context)
        val scored = JSONArray()
        for (index in 0 until cases.length()) {
            val item = cases.getJSONObject(index)
            val cropBytes = assets.open("roi-baseline/${item.getString("cropFile")}")
                .use { it.readBytes() }
            val cropHash = MessageDigest.getInstance("SHA-256").digest(cropBytes)
                .joinToString("") { "%02x".format(it.toInt() and 0xff) }
            assertEquals(item.getString("cropSha256"), cropHash)
            val bitmap = BitmapFactory.decodeByteArray(cropBytes, 0, cropBytes.size)
            val rgba = Mat()
            val bgr = Mat()
            try {
                Utils.bitmapToMat(bitmap, rgba)
                Imgproc.cvtColor(rgba, bgr, Imgproc.COLOR_RGBA2BGR)
                val started = System.nanoTime()
                val result = matcher.identifyCrop(bgr, "characters", null, null, 8)
                scored.put(JSONObject()
                    .put("caseId", item.getString("caseId"))
                    .put("truth", item.getString("truth"))
                    .put("groupId", item.getString("groupId"))
                    .put("owner", item.getString("owner"))
                    .put("cropSha256", item.getString("cropSha256"))
                    .put("status", "ok")
                    .put("id", result.optString("id"))
                    .put("score", result.optDouble("score"))
                    .put("margin", result.optDouble("margin"))
                    .put("margin_ext", result.optDouble("margin_ext"))
                    .put("top3", result.optJSONArray("top3"))
                    .put("topk", result.optJSONArray("topk"))
                    .put("runtimeMs", (System.nanoTime() - started) / 1_000_000.0))
            } finally {
                rgba.release()
                bgr.release()
                bitmap.recycle()
            }
        }
        val report = JSONObject()
            .put("schema", "mk8dx.private-tt-correct-roi-matcher-baseline.v1")
            .put("product", "Android Time Trial scanner")
            .put("model", "CleanAssetsMatcher.identifyCrop characters, no context/text/temporal rules")
            .put("roiManifestSha256", manifest.getString("roiManifestSha256"))
            .put("cases", scored)
        context.openFileOutput("roi-baseline-results.json", 0).bufferedWriter().use { it.write(report.toString()) }
        Log.i("MK8RoiBaseline", "scored=${scored.length()} output=roi-baseline-results.json")
        assertEquals(cases.length(), scored.length())
    }
}
