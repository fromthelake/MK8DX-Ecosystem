package nl.mariokart8.mk8dxtimetrials.scan

import android.graphics.Bitmap
import java.io.File
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import org.json.JSONObject

/**
 * The owner's scan debug bridge: proof of what the scanner really analysed,
 * and a way to drive it from the PC without tapping through the UI.
 *
 * Everything here is inert in a release build. Only the debug build type
 * installs a [ScanDebugRecorder] and a receiver for [ScanDebugCommand]s
 * (`src/debug`); without them the hooks below cost a null check. The owner's
 * question behind it (2026-09-18): is the region the Player frames with the
 * aiming guide, at the chosen zoom, the region the engine analyses?
 */
internal interface ScanDebugRecorder {
    /**
     * The shutter fired. [shot] carries the geometry of the stage, the guide
     * as drawn, and the zoom asked for and reported; [preview] is the preview
     * exactly as it was on screen, in the same pixels as the guide.
     */
    fun cameraShot(capture: File, shot: JSONObject, preview: Bitmap?)

    /**
     * The exact bitmap handed to the engine, after rotation and any crop;
     * [meta] says where it was cut from the upright frame.
     */
    fun engineInput(source: File, input: Bitmap, meta: JSONObject)

    /** One engine run: its full result and the per-frame artifact folder. */
    fun engineFrame(layout: String, frameIndex: Int, identityOnly: Boolean, result: JSONObject, outputDir: File?)

    /** The scan's end: a submission, or the terminal state it stopped in. */
    fun outcome(outcome: JSONObject)
}

/** A command from the PC, delivered by the debug build's receiver. */
internal sealed interface ScanDebugCommand {
    /** Open the scan screen for a track, as the track page's scan button does. */
    data class OpenScanner(val trackId: String) : ScanDebugCommand
    /** Leave a result's review for the scanner again, as its Rescan does. */
    data object Reset : ScanDebugCommand
    data object OpenCamera : ScanDebugCommand
    data object CloseCamera : ScanDebugCommand
    data class SetLayout(val layout: ScanLayoutProfile) : ScanDebugCommand
    data class SetZoom(val ratio: Float) : ScanDebugCommand
    data object Shutter : ScanDebugCommand

    /** Scan an image file the PC pushed, through the gallery path. */
    data class AnalyzeFile(val file: File) : ScanDebugCommand
}

private val scanDebugJson = kotlinx.serialization.json.Json { encodeDefaults = true; explicitNulls = false }

internal fun scanDebugSubmissionJson(submission: AndroidScanTimeTrialSubmissionV1): JSONObject =
    JSONObject(scanDebugJson.encodeToString(AndroidScanTimeTrialSubmissionV1.serializer(), submission))

internal object ScanDebug {
    @Volatile
    var recorder: ScanDebugRecorder? = null

    /**
     * Whether the engine also writes its images (overlays, digit crops). The
     * runner's "minimal artifacts" flag only decides which files are written,
     * never a result, so this is safe to turn on for a proof run.
     */
    @Volatile
    var engineImages: Boolean = false

    private val commandFlow = MutableSharedFlow<ScanDebugCommand>(extraBufferCapacity = 16)
    val commands: SharedFlow<ScanDebugCommand> = commandFlow.asSharedFlow()

    /** What the screens last reported, returned to the PC on `status`. */
    private val state = LinkedHashMap<String, Any?>()

    /**
     * Values read at the moment the PC asks, from the screen that owns them.
     * A value written from a recomposition goes stale when only a child
     * recomposes (the zoom button does, the camera stage does not).
     */
    private val live = LinkedHashMap<String, () -> Any?>()

    fun send(command: ScanDebugCommand): Boolean = commandFlow.tryEmit(command)

    /** Whether any screen is listening; a command nobody hears is an error. */
    fun listening(): Boolean = commandFlow.subscriptionCount.value > 0

    fun report(key: String, value: Any?) {
        if (recorder == null) return
        synchronized(state) { state[key] = value }
    }

    fun provide(key: String, value: (() -> Any?)?) {
        if (recorder == null) return
        synchronized(state) { if (value == null) live.remove(key) else live[key] = value }
    }

    fun status(): JSONObject = synchronized(state) {
        JSONObject().apply {
            state.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) }
            live.forEach { (key, value) -> put(key, runCatching { value() }.getOrNull() ?: JSONObject.NULL) }
        }
    }
}
