package nl.mariokart8.mk8dxtimetrials.scan

import android.content.Context
import android.graphics.Bitmap
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * Writes one folder per scan under the app's external files, where `adb pull`
 * reaches it without root:
 *
 * ```
 * scan-debug/<id>/shot.json          stage, guide rects, zoom, stream sizes (camera only)
 * scan-debug/<id>/preview.png        the preview as it was on screen (camera only)
 * scan-debug/<id>/capture.jpg        the file the camera wrote, EXIF included
 * scan-debug/<id>/engine-input.png   the exact bitmap the engine received
 * scan-debug/<id>/engine-input.json  where that bitmap was cut from the upright frame
 * scan-debug/<id>/frames/<layout>-<n>/result.json + the runner's own step JSON
 * scan-debug/<id>/outcome.json       submission or terminal state
 * ```
 *
 * Debug build only. The pictures are private evidence: they stay on the
 * device or in the owner's restricted folder, never in Git.
 */
internal class FileScanDebugRecorder(context: Context) : ScanDebugRecorder {
    val root: File = (context.getExternalFilesDir(null) ?: context.filesDir).resolve("scan-debug")
    private val writer = Executors.newSingleThreadExecutor()
    private val stamp = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.ROOT)

    @Volatile
    private var current: File? = null

    @Volatile
    var latest: String? = null
        private set

    @Synchronized
    private fun begin(): File {
        val folder = root.resolve(stamp.format(Date())).apply { mkdirs() }
        current = folder
        latest = folder.name
        ScanDebug.report("last_dossier", folder.name)
        return folder
    }

    @Synchronized
    private fun open(): File = current ?: begin()

    override fun cameraShot(capture: File, shot: JSONObject, preview: Bitmap?) {
        val folder = begin()
        // Copied now: the product deletes its capture when the scan ends.
        runCatching { capture.copyTo(folder.resolve("capture.jpg"), overwrite = true) }
        folder.resolve("shot.json").writeText(shot.toString(2))
        if (preview != null) {
            writer.execute {
                runCatching {
                    folder.resolve("preview.png").outputStream().use { preview.compress(Bitmap.CompressFormat.PNG, 100, it) }
                }
                preview.recycle()
            }
        }
    }

    override fun engineInput(source: File, input: Bitmap, meta: JSONObject) {
        val folder = open()
        if (!folder.resolve("capture.jpg").exists()) {
            // A gallery or pushed file: keep what was scanned as well.
            runCatching { source.copyTo(folder.resolve("capture.jpg"), overwrite = true) }
        }
        folder.resolve("engine-input.json").writeText(meta.toString(2))
        // Written before returning: the engine recycles this bitmap when the
        // scan ends, and a copy of a 12 MP frame is memory the phone lacks.
        folder.resolve("engine-input.png").outputStream().use { input.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    override fun engineFrame(layout: String, frameIndex: Int, identityOnly: Boolean, result: JSONObject, outputDir: File?) {
        val folder = open()
        val frame = folder.resolve("frames/$layout-${frameIndex + 1}${if (identityOnly) "-identity" else ""}").apply { mkdirs() }
        frame.resolve("result.json").writeText(result.toString(2))
        outputDir?.takeIf { it.isDirectory }?.walkTopDown()
            ?.filter { it.isFile && it.extension in setOf("json", "png") && it.length() < 8_000_000 }
            ?.forEach { file -> runCatching { file.copyTo(frame.resolve(file.relativeTo(outputDir).path), overwrite = true) } }
    }

    override fun outcome(outcome: JSONObject) {
        val folder = synchronized(this) { current.also { current = null } } ?: return
        folder.resolve("outcome.json").writeText(outcome.toString(2))
        ScanDebug.report("last_outcome", outcome.optString("result"))
    }
}
