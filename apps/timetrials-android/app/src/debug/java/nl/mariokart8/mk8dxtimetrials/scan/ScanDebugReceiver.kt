package nl.mariokart8.mk8dxtimetrials.scan

import android.content.BroadcastReceiver
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import java.io.File
import org.json.JSONObject

/**
 * The PC's handle on the scanner, debug build only. Guarded by the DUMP
 * permission, which the adb shell holds and apps do not:
 *
 * ```
 * adb shell am broadcast -n <pkg>/nl.mariokart8.mk8dxtimetrials.scan.ScanDebugReceiver \
 *     -a nl.mariokart8.mk8dxtimetrials.debug.SCAN --es cmd <command> [...]
 * ```
 *
 * Commands: `status`; `open --es track track.x`; `reset` (leave a result's
 * review); `camera`; `close`;
 * `layout --es value endscreen|ghost_detail`; `zoom --ef value 2.0`;
 * `shutter`; `artifacts --es value on|off` (the engine also writes its
 * images); `analyze --es path <file>` (relative names are read from
 * `scan-debug/inbox`). The answer comes back as JSON in the broadcast's
 * result data, which `am broadcast` prints.
 */
internal class ScanDebugReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val recorder = ScanDebug.recorder as? FileScanDebugRecorder
        val command = intent.getStringExtra("cmd").orEmpty()
        val answer = JSONObject().put("cmd", command)
        val parsed: ScanDebugCommand? = when (command) {
            "status" -> null
            "open" -> intent.getStringExtra("track")?.let { ScanDebugCommand.OpenScanner(it) }
            "reset" -> ScanDebugCommand.Reset
            "camera" -> ScanDebugCommand.OpenCamera
            "close" -> ScanDebugCommand.CloseCamera
            "shutter" -> ScanDebugCommand.Shutter
            "layout" -> ScanLayoutProfile.entries.firstOrNull { it.engineValue == intent.getStringExtra("value") }
                ?.let { ScanDebugCommand.SetLayout(it) }
            "zoom" -> intent.getFloatExtra("value", Float.NaN).takeIf { !it.isNaN() }?.let { ScanDebugCommand.SetZoom(it) }
            "analyze" -> intent.getStringExtra("path")?.let { path ->
                val file = File(path).takeIf { it.isAbsolute } ?: recorder?.root?.resolve("inbox/$path")
                file?.takeIf { it.isFile }?.let { ScanDebugCommand.AnalyzeFile(it) }
            }
            else -> null
        }
        if (command == "artifacts") ScanDebug.engineImages = intent.getStringExtra("value") == "on"
        val ok = when {
            command == "status" || command == "artifacts" -> true
            parsed == null -> false.also { answer.put("error", "unknown command or missing/invalid argument") }
            !ScanDebug.listening() -> false.also { answer.put("error", "no screen is listening; is the app in front?") }
            else -> ScanDebug.send(parsed)
        }
        answer.put("ok", ok)
            .put("root", recorder?.root?.absolutePath ?: JSONObject.NULL)
            .put("latest", recorder?.latest ?: JSONObject.NULL)
            .put("engine_images", ScanDebug.engineImages)
            .put("status", ScanDebug.status())
        resultCode = if (ok) 1 else 0
        resultData = answer.toString()
    }
}

/** Installs the recorder when the debug build's process starts. */
internal class ScanDebugInstaller : ContentProvider() {
    override fun onCreate(): Boolean {
        val context = context ?: return false
        ScanDebug.recorder = FileScanDebugRecorder(context.applicationContext)
        return true
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
