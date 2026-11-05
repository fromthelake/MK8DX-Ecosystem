package nl.mariokart8.mk8dxtimetrials.scanruntime

import android.graphics.BitmapFactory
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mk8dx.mobileocr.OfflineParityPackagedRunner
import com.mk8dx.mobileocr.OfflineParityNativePipeline
import java.io.File
import java.security.MessageDigest
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/** QA-only capture: JSON metrics and stage-file hashes, no source images. */
@RunWith(AndroidJUnit4::class)
class OpenCvQualificationMetricsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(65536)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    /** One representative from the already staged, private staff corpus. */
    @Test
    fun captureOneGhostPhotoStage() {
        val source = InstrumentationRegistry.getArguments().getString("opencv.source") ?: "phone"
        require(source in setOf("phone", "hdmi", "webcam"))
        val corpus = File("/data/local/tmp/mk8-ghost-select")
        val index = JSONArray(File(corpus, "index.json").readText())
        val entry = (0 until index.length()).asSequence().map(index::getJSONObject)
            .first { it.getString("name").endsWith("_${source}") }
        val name = entry.getString("name")
        val bitmap = checkNotNull(BitmapFactory.decodeFile(File(corpus, entry.getString("file")).path))
        val runner = OfflineParityPackagedRunner(instrumentation.targetContext)
        val result = runner.runLiveBitmap(bitmap, false, "opencv-ghost-$source", null, false,
            OfflineParityNativePipeline.LAYOUT_GHOST_DETAIL)
        bitmap.recycle()
        val destination = File(instrumentation.targetContext.cacheDir,
            "opencv_ghost_stage_${source}_${System.currentTimeMillis()}")
        check(destination.mkdirs())
        val hashes = JSONObject()
        File(result.outputDir).listFiles()?.forEach { file ->
            if (file.isFile && file.extension == "json") {
                file.copyTo(File(destination, file.name))
            } else if (file.isFile && file.extension == "png") {
                hashes.put(file.name, sha256(file))
                file.copyTo(File(destination, file.name))
            }
        }
        File(destination, "stage_png_sha256.json").writeText(hashes.toString(2))
        File(destination, "case.json").writeText(JSONObject()
            .put("name_sha256", MessageDigest.getInstance("SHA-256")
                .digest(name.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 0xff) })
            .put("source", source)
            .put("status", result.status)
            .toString(2))
        Log.i("MK8Cv5QA", "ghost_source=$source status=${result.status} root=${destination.absolutePath}")
    }

    @Test
    fun captureAllPinnedFrameMetrics() {
        val context = instrumentation.targetContext
        val assets = instrumentation.context.assets
        val names = checkNotNull(assets.list("corpus/frames")).sorted()
        assertEquals(58, names.size)
        val root = File(context.cacheDir, "opencv_qualification_${System.currentTimeMillis()}")
        check(root.mkdirs())
        val runner = OfflineParityPackagedRunner(context)
        names.forEachIndexed { index, name ->
            val bitmap = assets.open("corpus/frames/$name").use(BitmapFactory::decodeStream)
            val result = runner.runLiveBitmap(bitmap, false, name.substringBeforeLast('.'))
            bitmap.recycle()
            val source = File(result.outputDir)
            val destination = File(root, "%03d".format(index + 1))
            check(destination.mkdirs())
            val hashes = JSONObject()
            source.listFiles()?.forEach { file ->
                if (file.isFile && file.extension == "json") {
                    file.copyTo(File(destination, file.name))
                } else if (file.isFile && file.extension == "png") {
                    hashes.put(file.name, sha256(file))
                }
            }
            File(destination, "stage_png_sha256.json").writeText(hashes.toString(2))
            File(destination, "case.json").writeText(JSONObject()
                .put("name_sha256", MessageDigest.getInstance("SHA-256")
                    .digest(name.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 0xff) })
                .put("status", result.status)
                .put("frame_valid", result.frameValid)
                .put("lap_sum_ok", result.lapSumOk)
                .put("field_count", result.fields.size)
                .toString(2))
            Log.i("MK8Cv5QA", "frame=${index + 1}/58 status=${result.status} fields=${result.fields.size}")
        }
        Log.i("MK8Cv5QA", "root=${root.absolutePath}")
    }
}
