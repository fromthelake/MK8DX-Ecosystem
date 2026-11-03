package nl.mariokart8.mk8dxtimetrials.scanruntime

import android.graphics.BitmapFactory
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mk8dx.mobileocr.OfflineParityPackagedRunner
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Opt-in benchmark: the preserved engine over a list of images at several
 * input sizes, one JSON line per run. Skipped unless a manifest is passed:
 *
 * ```
 * adb shell am instrument -w -e class nl.mariokart8.mk8dxtimetrials.scanruntime.ScanInputBenchmarkTest \
 *   -e manifest /data/local/tmp/mk8bench/manifest.json \
 *   nl.mariokart8.mk8dxtimetrials.scanruntime.test/androidx.test.runner.AndroidJUnitRunner
 * ```
 *
 * The manifest is `{"out": "<name>.jsonl", "variants": [0, 1920, 1280, 960],
 * "images": [{"id": ..., "path": ..., "layout": "endscreen|ghost_detail"}]}`;
 * a variant is the longest side handed to the engine (0 = as decoded), made
 * with [ScanInputScale]. Input files are read through the shell, so they can
 * live in /data/local/tmp; the result lands in this test app's external files,
 * where `adb pull` reaches it. Truth is scored on the PC, never here.
 */
@RunWith(AndroidJUnit4::class)
class ScanInputBenchmarkTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun shellBytes(path: String): ByteArray {
        val descriptor = instrumentation.uiAutomation.executeShellCommand("cat $path")
        return ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
    }

    @Test
    fun runManifest() {
        val manifestPath = InstrumentationRegistry.getArguments().getString("manifest").orEmpty()
        assumeTrue("Pass manifest to run the input benchmark", manifestPath.isNotBlank())
        val manifest = JSONObject(String(shellBytes(manifestPath)))
        val context = instrumentation.targetContext
        val runner = OfflineParityPackagedRunner(context)
        val out = File(context.getExternalFilesDir(null), manifest.optString("out", "benchmark.jsonl"))
        out.parentFile?.mkdirs()
        out.writeText("")
        val variants = manifest.optJSONArray("variants") ?: JSONArray().put(0)
        val images = manifest.getJSONArray("images")
        for (i in 0 until images.length()) {
            val image = images.getJSONObject(i)
            val bytes = shellBytes(image.getString("path"))
            for (v in 0 until variants.length()) {
                val longSide = variants.getInt(v)
                val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                if (decoded == null) {
                    out.appendText(JSONObject().put("id", image.getString("id")).put("error", "undecodable").toString() + "\n")
                    break
                }
                val input = ScanInputScale.toLongSide(decoded, longSide)
                if (input !== decoded) decoded.recycle()
                val started = System.currentTimeMillis()
                val result = runner.runLiveBitmap(
                    input, true, "bench", null, false, image.optString("layout", "endscreen"),
                )
                val elapsed = System.currentTimeMillis() - started
                val line = JSONObject()
                    .put("id", image.getString("id"))
                    .put("layout", image.optString("layout", "endscreen"))
                    .put("variant", longSide)
                    .put("width", input.width)
                    .put("height", input.height)
                    .put("ms", elapsed)
                    .put("status", result.status)
                    .put("first_blocking_stage", result.firstBlockingStage)
                    .put("message", result.message)
                    .put("lap_sum_ok", result.lapSumOk ?: JSONObject.NULL)
                    .put("lap_sum_repairs", result.lapSumRepairs)
                    .put("fields", JSONObject(result.fields as Map<*, *>))
                input.recycle()
                // The engine's own shrink into its working image, per run.
                val align = File(result.outputDir, "18_canonical_player_box_align_geometry.json")
                if (align.isFile) {
                    val geometry = JSONObject(align.readText())
                    line.put("step18_scale", geometry.optDouble("scale_x"))
                        .put("step18_current_box", geometry.optJSONArray("current_box") ?: JSONObject.NULL)
                        .put("antialias_factor", geometry.optDouble("antialias_factor", 1.0))
                        .put("registration", geometry.optJSONObject("ghost_panel_registration") ?: JSONObject.NULL)
                }
                // The identity cards with their chosen text script/locale and row text
                // evidence, for the console-language checks.
                val kartConfig = File(result.outputDir, "27_kart_config.json")
                if (kartConfig.isFile) {
                    line.put("kart_config", JSONObject(kartConfig.readText()))
                }
                // Which seed produced the read, and the tilt the deskew seed used
                // (written by the ADR-0203 overlay; absent in the preserved engine).
                val warp = File(result.outputDir, "17_perspective_warp_geometry.json")
                if (warp.isFile) {
                    val geometry = JSONObject(warp.readText())
                    line.put("seed", geometry.optString("seed", ""))
                        .put("deskew_degrees", geometry.optDouble("ghost_detail_deskew_degrees", 0.0))
                }
                // Per-digit reads of the decoded grid, for lock-rule studies.
                val slots = File(result.outputDir, "24_slot_details_evidence.json")
                if (slots.isFile) {
                    val digits = JSONObject()
                    val fields = JSONObject(slots.readText()).optJSONArray("fields") ?: JSONArray()
                    for (f in 0 until fields.length()) {
                        val field = fields.getJSONObject(f)
                        val reads = JSONArray()
                        val fieldSlots = field.optJSONArray("slots") ?: JSONArray()
                        for (s in 0 until fieldSlots.length()) {
                            val slot = fieldSlots.getJSONObject(s)
                            if (slot.optString("slot_type") == "digit") {
                                reads.put(JSONArray().put(slot.optString("char")).put(slot.optDouble("confidence", 0.0)))
                            }
                        }
                        digits.put(field.optString("field_name"), reads)
                    }
                    line.put("digits", digits)
                }
                out.appendText(line.toString() + "\n")
                Log.i("MK8Bench", "${i + 1}/${images.length()} ${image.getString("id")} v=$longSide ${result.status} lap=${result.lapSumOk} ${elapsed}ms")
            }
        }
        Log.i("MK8Bench", "done ${out.absolutePath}")
    }
}
