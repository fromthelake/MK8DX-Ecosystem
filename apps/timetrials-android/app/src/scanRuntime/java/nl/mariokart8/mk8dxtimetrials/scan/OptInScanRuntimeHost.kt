package nl.mariokart8.mk8dxtimetrials.scan

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.mk8dx.mobileocr.OfflineParityPackagedRunner
import java.io.File
import nl.mariokart8.mk8dxtimetrials.scanruntime.ScanInputScale
import nl.mariokart8.mk8dxtimetrials.scanruntime.ScanRuntimeFrameEnvelope
import org.json.JSONObject

private const val MAX_RESULT_IMAGE_PIXELS = 32L * 1024 * 1024

/**
 * The sizes (longest side) a guided camera still is read at, in order; a size
 * that repeats is read once (ADR-0203). A still from the scanner's own camera is
 * framed by the aiming guide, so its cards are several times the size the
 * engine was validated on (960x540 live frames, 1080p stills); read whole, both
 * card finding and the stage-18 warp suffer, and slowly. No single size is best
 * for every screen: on 12 MP photos of a 7-lap card 1920 and 2560 read where
 * 1280 lost a digit, on the parity set enlarged to 12 MP size 1280 read best.
 * So the still is read at 1920 first and, only if that does not close its lap
 * sum, at 1280 and then 2560 - a second opinion instead of a copy. A gallery
 * image has unknown framing (its cards may be small in a wide shot) and is read
 * once as it is, like the original scanner did.
 */
internal val CAMERA_STILL_SIZES = listOf(1920, 1920, 1280, 1280, 2560)

internal class OptInStillRenderings : ScanStillRenderings<Bitmap> {
    override fun burst(frame: Bitmap, source: ResultImageSource): List<Bitmap> =
        if (source == ResultImageSource.CAMERA) {
            SizedStillBurst(frame, CAMERA_STILL_SIZES)
        } else {
            List(ScanBurstPolicy.BURST_FRAMES) { frame }
        }

    override fun release(burst: List<Bitmap>, frame: Bitmap) {
        (burst as? SizedStillBurst)?.releaseCreated()
    }
}

/**
 * The still at each size, made only when the coordinator reaches it and made
 * once per size, so a repeated size is the same frame (and is not read again).
 */
internal class SizedStillBurst(
    private val frame: Bitmap,
    private val sizes: List<Int>,
) : AbstractList<Bitmap>() {
    private val created = LinkedHashMap<Int, Bitmap>()

    override val size: Int get() = sizes.size

    override fun get(index: Int): Bitmap = synchronized(created) {
        created.getOrPut(sizes[index]) { ScanInputScale.toLongSide(frame, sizes[index]) }
    }

    fun releaseCreated() = synchronized(created) {
        created.values.forEach { if (it !== frame && !it.isRecycled) it.recycle() }
        created.clear()
    }
}

internal class OptInBundledResultImageAnalyzerFactory(
    context: Context,
) : ContextualResultImageAnalyzerFactory {
    private val delegate = createOptInResultImageAnalyzerFactory(context)

    override fun create(
        contextProvider: () -> AndroidScanSubmissionContext,
    ): ResultImageAnalyzer = delegate.create(contextProvider)
}

/**
 * One engine per process. Each runner loads its own ONNX session (about 500 MB
 * native with its arena) and nothing closes it, so a runner per scan screen
 * leaked that much every time the camera reopened (Vivo, 2026-10-25: 5.3 GB
 * after ten photos, then Android ended the app). Scans run one at a time.
 */
internal object SharedPackagedRunner {
    @Volatile
    private var instance: OfflineParityPackagedRunner? = null

    fun get(context: Context): OfflineParityPackagedRunner =
        instance ?: synchronized(this) {
            instance ?: OfflineParityPackagedRunner(context.applicationContext).also { instance = it }
        }
}

/**
 * The layout the Player aimed at reaches the engine here. It is read per frame
 * rather than captured at construction, because the analyzer is built once for
 * the product host while the choice belongs to the scan in front of the Player.
 */
internal class OptInScanRuntimeAnalyzer(
    context: Context,
    private val layoutProvider: () -> ScanLayoutProfile = {
        ScanLayoutPreference.read(context.applicationContext)
    },
) : ProgressiveScanFrameAnalyzer<Bitmap>, ScanLayoutAttempts {
    private val appContext = context.applicationContext
    private val runner = SharedPackagedRunner.get(appContext)

    // Set for the duration of one burst; the Player's own choice decides the
    // order the layouts are tried in.
    @Volatile
    private var current: ScanLayoutProfile? = null

    override fun attempts(): List<ScanLayoutProfile> {
        val chosen = layoutProvider()
        return listOf(chosen) + ScanLayoutProfile.entries.filter { it != chosen }
    }

    override fun use(layout: ScanLayoutProfile) {
        current = layout
    }

    override fun analyze(
        frame: Bitmap,
        frameIndex: Int,
        identityOnly: Boolean,
        onProgress: (ScanRuntimeStageProgress) -> Unit,
    ): ScanConsensusFrame {
        val layout = current ?: layoutProvider()
        val result = synchronized(runner) { runner.runLiveBitmap(
            frame,
            // The debug bridge can ask for the engine's images as well; the
            // flag changes which files are written, not what is read.
            !(ScanDebug.recorder != null && ScanDebug.engineImages),
            "target_scan_frame_${frameIndex + 1}",
            { status, stage, completedStages, totalStages, elapsedMs ->
                onProgress(
                    ScanRuntimeStageProgress(
                        status = status.orEmpty(),
                        stage = stage.orEmpty(),
                        completedStages = completedStages,
                        totalStages = totalStages,
                        elapsedMs = elapsedMs,
                    ),
                )
            },
            identityOnly,
            layout.engineValue,
        ).also { result ->
            ScanDebug.recorder?.let { recorder ->
                // Before the next frame: the runner wipes its artifact folder at
                // the start of every run, so only now is this frame's ROI there.
                runCatching {
                    recorder.engineFrame(
                        layout.engineValue,
                        frameIndex,
                        identityOnly,
                        result.toJson(),
                        result.outputDir.takeIf { it.isNotEmpty() }?.let(::File),
                    )
                }
            }
        } }
        val frame = translateRunnerScanFrame(ScanRuntimeFrameEnvelope.encode(result))
        return if (layout == ScanLayoutProfile.GHOST_DETAIL) frame.ghostPanelAsPlayer() else frame
    }
}

internal class OptInResultImageBitmapDecoder(
    private val maximumPixels: Long = MAX_RESULT_IMAGE_PIXELS,
) : ScanResultImageDecoder<Bitmap> {
    override fun decode(file: File): Bitmap = decode(file, ResultImageSource.GALLERY)

    /** Upright and cropped, at full size; [OptInStillRenderings] sizes camera stills. */
    override fun decode(file: File, source: ResultImageSource): Bitmap {
        val (cropped, crop, upright) = decodeCropped(file)
        recordEngineInput(file, cropped, crop, upright.first, upright.second, source)
        return cropped
    }

    private fun decodeCropped(file: File): Triple<Bitmap, IntArray, Pair<Int, Int>> {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        val pixels = bounds.outWidth.toLong() * bounds.outHeight.toLong()
        if (bounds.outWidth < 1 || bounds.outHeight < 1 || pixels !in 1..maximumPixels) {
            throw ScanResultImageAnalysisException(null)
        }
        // Upright first, the way the Player saw it, whichever way the phone was
        // held. A portrait frame is then cut to the centred 4:3 box the aiming
        // guide covered, so the engine reads the picture the Player framed
        // rather than a sideways or squashed one.
        val decoded = decodeUprightResultImage(file)
            ?: throw ScanResultImageAnalysisException(null)
        val crop = uprightResultCrop(decoded.width, decoded.height)
        val uprightWidth = decoded.width
        val uprightHeight = decoded.height
        val upright = uprightWidth to uprightHeight
        if (crop[0] == 0 && crop[1] == 0 && crop[2] == decoded.width && crop[3] == decoded.height) {
            return Triple(decoded, crop, upright)
        }
        return try {
            val cropped = Bitmap.createBitmap(decoded, crop[0], crop[1], crop[2], crop[3])
            if (cropped !== decoded) decoded.recycle()
            Triple(cropped, crop, upright)
        } catch (error: Exception) {
            decoded.recycle()
            throw error
        }
    }

    private fun recordEngineInput(
        file: File,
        input: Bitmap,
        crop: IntArray,
        uprightWidth: Int,
        uprightHeight: Int,
        source: ResultImageSource,
    ) {
        val recorder = ScanDebug.recorder ?: return
        runCatching {
            recorder.engineInput(
                file,
                input,
                org.json.JSONObject()
                    .put("source", source.name)
                    .put("upright_width", uprightWidth)
                    .put("upright_height", uprightHeight)
                    .put("crop_ltwh_in_upright", org.json.JSONArray().put(crop[0]).put(crop[1]).put(crop[2]).put(crop[3]))
                    .put("camera_still_sizes", if (source == ResultImageSource.CAMERA) org.json.JSONArray(CAMERA_STILL_SIZES.distinct()) else JSONObject.NULL)
                    .put("input_width", input.width)
                    .put("input_height", input.height),
            )
        }
    }
}

internal fun createOptInResultImageAnalyzer(
    context: Context,
    contextProvider: () -> AndroidScanSubmissionContext,
    capturedAtMsProvider: () -> Long = System::currentTimeMillis,
): ResultImageAnalyzer {
    val analyzer = OptInScanRuntimeAnalyzer(context)
    return ScanResultImageAnalyzer(
        decoder = OptInResultImageBitmapDecoder(),
        frameAnalyzer = analyzer,
        contextProvider = contextProvider,
        capturedAtMsProvider = capturedAtMsProvider,
        releaser = ScanResultImageReleaser(Bitmap::recycle),
        // A burst that reads nothing tries the other MK8DX screen before it
        // gives up, so the layout toggle is a hint and never a dead end.
        layoutAttempts = analyzer,
        renderings = OptInStillRenderings(),
    )
}

internal fun createOptInResultImageAnalyzerFactory(
    context: Context,
    capturedAtMsProvider: () -> Long = System::currentTimeMillis,
): ContextualResultImageAnalyzerFactory = ContextualResultImageAnalyzerFactory { contextProvider ->
    createOptInResultImageAnalyzer(
        context = context,
        contextProvider = contextProvider,
        capturedAtMsProvider = capturedAtMsProvider,
    )
}

internal fun createOptInScanRuntimeCoordinator(
    context: Context,
    onState: (ScanCoordinatorState) -> Unit = {},
    onLockedResult: (String) -> Unit = {},
): ScanCoordinator<Bitmap> = ScanCoordinator(
    analyzer = OptInScanRuntimeAnalyzer(context),
    onState = onState,
    onLockedResult = onLockedResult,
)

internal fun createOptInScanRuntimeAsyncControllerFactory(
    context: Context,
    burstProvider: ScanBurstProvider<Bitmap>,
    contextProvider: () -> AndroidScanSubmissionContext,
): ScanAsyncControllerFactory<Bitmap> {
    val analyzer = OptInScanRuntimeAnalyzer(context)
    return ScanAsyncControllerFactory { onState, onSubmission ->
        ScanComponentController(
            burstProvider = burstProvider,
            coordinatorFactory = ScanCoordinatorFactory { coordinatorState ->
                ScanCoordinator(
                    analyzer = analyzer,
                    onState = coordinatorState,
                )
            },
            contextProvider = contextProvider,
            onSubmission = onSubmission,
            onState = onState,
        )
    }
}
