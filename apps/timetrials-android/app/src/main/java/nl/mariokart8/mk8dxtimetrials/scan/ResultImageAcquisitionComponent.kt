package nl.mariokart8.mk8dxtimetrials.scan

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color as AndroidColor
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.view.OrientationEventListener
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraControl
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executor
import kotlinx.coroutines.CoroutineScope
import nl.mariokart8.mk8dxtimetrials.ui.androidLocalizedPresentation
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTokens

internal fun interface ResultImageAsyncHostFactory {
    fun create(
        parentScope: CoroutineScope,
        onState: (ResultImageAcquisitionState) -> Unit,
        onSubmission: (AndroidScanTimeTrialSubmissionV1) -> Unit,
    ): ResultImageAsyncHost<Uri, Uri>
}

private data class BundledScanTestFixture(
    val assetName: String,
    val title: String,
    val detail: String,
    val lapCount: Int,
)

private val bundledScanTestFixtures = listOf(
    BundledScanTestFixture(
        "three-lap-community.jpg",
        "3-lap result A",
        "Known-good community screenshot",
        3,
    ),
    BundledScanTestFixture(
        "three-lap-alt.jpg",
        "3-lap result B",
        "Alternative lighting and result order",
        3,
    ),
    BundledScanTestFixture(
        "seven-lap-community.jpg",
        "7-lap result",
        "Known-good Baby Park layout",
        7,
    ),
)

@Composable
internal fun AndroidResultImageAcquisitionComponent(
    hostFactory: ResultImageAsyncHostFactory,
    onSubmission: (AndroidScanTimeTrialSubmissionV1) -> Unit,
    guideLapCount: Int = 3,
    initialLayout: ScanLayoutProfile? = null,
    lockLayout: Boolean = false,
    autoOpenCamera: Boolean = false,
    onCameraClosed: (() -> Unit)? = null,
    // Opened from Debug and test rather than from the scan screen, which no
    // longer offers a developer affordance beside Camera and Gallery.
    openTestChooser: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val parentScope = rememberCoroutineScope()
    val currentSubmission by rememberUpdatedState(onSubmission)
    var state by remember { mutableStateOf<ResultImageAcquisitionState>(ResultImageAcquisitionState.Ready) }
    var cameraVisible by remember { mutableStateOf(false) }
    var testChooserVisible by remember { mutableStateOf(openTestChooser) }
    var testFixturePending by remember { mutableStateOf(false) }
    var capturedSource by remember { mutableStateOf<File?>(null) }
    // Which MK8DX screen the scan is aimed at. Persisted like the scanner does,
    // because someone working through a stack of old records stays in the
    // Select-a-Ghost detail panel for the whole session.
    var layout by remember(context, initialLayout) {
        mutableStateOf(initialLayout ?: ScanLayoutPreference.read(context))
    }
    val availableTestFixtures = remember(context, guideLapCount) {
        val packaged = context.assets.list("scan-test-fixtures")?.toSet().orEmpty()
        bundledScanTestFixtures.filter { it.lapCount == guideLapCount && it.assetName in packaged }
    }
    val host = remember(parentScope, hostFactory) {
        hostFactory.create(
            parentScope,
            onState = { next ->
                state = next
                if (next is ResultImageAcquisitionState.Completed ||
                    next is ResultImageAcquisitionState.Failed ||
                    next is ResultImageAcquisitionState.Cancelled
                ) {
                    capturedSource?.delete()
                    capturedSource = null
                }
            },
            onSubmission = { submission ->
                val classified = if (testFixturePending) {
                    submission.copy(source = submission.source.copy(kind = "android_scan_test"))
                } else {
                    submission
                }
                testFixturePending = false
                currentSubmission(classified)
            },
        )
    }
    val galleryLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
        host::completeGallery,
    )
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        cameraVisible = granted
        if (!granted) state = ResultImageAcquisitionState.Failed(ResultImageFailureCode.PREPARATION_FAILURE)
    }

    var autoOpenHandled by remember { mutableStateOf(false) }
    LaunchedEffect(autoOpenCamera) {
        if (!autoOpenCamera || autoOpenHandled) return@LaunchedEffect
        autoOpenHandled = true
        testFixturePending = false
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            cameraVisible = true
        } else {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    DisposableEffect(host) {
        onDispose {
            capturedSource?.delete()
            host.close()
        }
    }

    if (ScanDebug.recorder != null) {
        // The debug bridge drives the same controls a Player would, so what it
        // proves is the product's own path.
        LaunchedEffect(host) {
            ScanDebug.commands.collect { command ->
                when (command) {
                    ScanDebugCommand.OpenCamera ->
                        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                            PackageManager.PERMISSION_GRANTED
                        ) {
                            testFixturePending = false
                            cameraVisible = true
                        } else {
                            permissionLauncher.launch(Manifest.permission.CAMERA)
                        }
                    ScanDebugCommand.CloseCamera -> cameraVisible = false
                    is ScanDebugCommand.SetLayout -> {
                        layout = command.layout
                        ScanLayoutPreference.write(context, command.layout)
                    }
                    is ScanDebugCommand.AnalyzeFile -> {
                        val prepared = runCatching { prepareDebugFile(context, command.file) }.getOrNull()
                        if (prepared != null && host.beginGallery()) {
                            testFixturePending = true
                            capturedSource = prepared.first
                            host.completeGallery(prepared.second)
                        } else {
                            prepared?.first?.delete()
                            ScanDebug.report("last_command_error", "analyze: not accepted in state ${state::class.simpleName}")
                        }
                    }
                    else -> Unit
                }
            }
        }
        val currentLapCount by rememberUpdatedState(guideLapCount)
        DisposableEffect(Unit) {
            ScanDebug.provide("scan_screen") {
                org.json.JSONObject()
                    .put("guide_lap_count", currentLapCount)
                    .put("layout", layout.engineValue)
                    .put("acquisition_state", state::class.simpleName)
                    .put("camera_visible", cameraVisible)
            }
            onDispose { ScanDebug.provide("scan_screen", null) }
        }
    }


    if (testChooserVisible) {
        BundledScanTestChooser(
            fixtures = availableTestFixtures,
            onDismiss = { testChooserVisible = false },
            onSelected = { fixture ->
                testChooserVisible = false
                val prepared = try {
                    prepareBundledTestFixture(context, fixture)
                } catch (_: Exception) {
                    state = ResultImageAcquisitionState.Failed(ResultImageFailureCode.PREPARATION_FAILURE)
                    null
                }
                if (prepared != null && host.beginGallery()) {
                    testFixturePending = true
                    capturedSource = prepared.first
                    host.completeGallery(prepared.second)
                } else {
                    prepared?.first?.delete()
                }
            },
        )
    }

    val analyzing = state as? ResultImageAcquisitionState.Analyzing
    val analyzingCamera = analyzing?.takeIf { it.source == ResultImageSource.CAMERA }
    // One stage for the whole camera scan: aim, shutter, freeze, read. The
    // captured frame stays on screen under the progress panel instead of the
    // camera closing and a second surface opening, which is what makes the
    // scanner feel like it is working on the shot you just took.
    if (cameraVisible || analyzingCamera != null) {
        FullScreenScanDialog(
            onDismissRequest = {
                if (analyzingCamera == null) {
                    cameraVisible = false
                    onCameraClosed?.invoke()
                }
            },
        ) {
            EmbeddedMk8dxCamera(
                guideLapCount = guideLapCount,
                layout = layout,
                onLayoutChanged = { next ->
                    layout = next
                    ScanLayoutPreference.write(context, next)
                },
                analyzing = analyzingCamera?.progress,
                frozenFrame = capturedSource,
                onGallery = {
                    testFixturePending = false
                    if (host.beginGallery()) {
                        galleryLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    }
                },
                onClose = {
                    cameraVisible = false
                    onCameraClosed?.invoke()
                },
                onCaptured = { file ->
                    cameraVisible = false
                    capturedSource = file
                    if (host.beginEmbeddedCamera()) {
                        val uri = FileProvider.getUriForFile(
                            context,
                            "${context.packageName}.result-image-provider",
                            file,
                        )
                        host.completeEmbeddedCamera(uri)
                    }
                },
                onFailure = {
                    cameraVisible = false
                    state = ResultImageAcquisitionState.Failed(ResultImageFailureCode.PREPARATION_FAILURE)
                },
            )
        }
        return
    }

    ResultImageAcquisitionComponent(
        state = state,
        onGalleryRequested = {
            testFixturePending = false
            if (host.beginGallery()) {
                galleryLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
        },
        onCameraRequested = {
            testFixturePending = false
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                cameraVisible = true
            } else {
                permissionLauncher.launch(Manifest.permission.CAMERA)
            }
        },
        onTestRequested = if (availableTestFixtures.isEmpty()) null else {
            { testChooserVisible = true }
        },
        guideLapCount = guideLapCount,
        layout = layout,
        onLayoutChanged = { next ->
            layout = next
            ScanLayoutPreference.write(context, next)
        },
        showLayoutSelector = !lockLayout,
        modifier = modifier,
    )
}

@Composable
internal fun ResultImageAcquisitionComponent(
    state: ResultImageAcquisitionState,
    onGalleryRequested: () -> Unit,
    onCameraRequested: () -> Unit,
    onTestRequested: (() -> Unit)? = null,
    guideLapCount: Int = 3,
    layout: ScanLayoutProfile = ScanLayoutProfile.ENDSCREEN,
    onLayoutChanged: (ScanLayoutProfile) -> Unit = {},
    showLayoutSelector: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val busy = state is ResultImageAcquisitionState.AwaitingGallery ||
        state is ResultImageAcquisitionState.AwaitingCamera ||
        state is ResultImageAcquisitionState.Analyzing
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = .96f),
        shape = RoundedCornerShape(20.dp),
        modifier = modifier.padding(16.dp).testTag("result-image-acquisition"),
    ) {
        Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.fillMaxWidth().aspectRatio(16f / 8f).background(Mk8dxTheme.colors.surfaceApp, RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center,
            ) {
                ScanAimingGuideOverlay(guideLapCount, layout, Modifier.fillMaxSize().padding(8.dp))
                if (state is ResultImageAcquisitionState.Analyzing) {
                    ScanProgressPanel(
                        progress = state.progress,
                        compact = true,
                        modifier = Modifier.fillMaxWidth(.94f),
                    )
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            "TT SCAN",
                            color = Mk8dxTheme.colors.actionPrimary,
                            style = Mk8dxTheme.type.display6,
                        )
                        Text(
                            if (layout == ScanLayoutProfile.GHOST_DETAIL) {
                                "Fill the frame with the Select-a-Ghost detail panel"
                            } else {
                                "Fill the frame with the MK8DX result screen"
                            },
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
            Text(
                state.statusText(),
                modifier = Modifier.padding(vertical = 11.dp).testTag("result-image-status"),
                color = when (state) {
                    is ResultImageAcquisitionState.Failed -> MaterialTheme.colorScheme.error
                    is ResultImageAcquisitionState.Completed -> Mk8dxTheme.colors.statusSuccess
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = onCameraRequested,
                    enabled = !busy,
                    modifier = Modifier.weight(1f).height(54.dp).testTag("result-image-camera"),
                ) { Text("Camera") }
                OutlinedButton(
                    onClick = onGalleryRequested,
                    enabled = !busy,
                    modifier = Modifier.weight(1f).height(54.dp).testTag("result-image-gallery"),
                ) { Text("Gallery") }
            }
            if (showLayoutSelector) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    listOf(
                        ScanLayoutProfile.ENDSCREEN to "Result screen",
                        ScanLayoutProfile.GHOST_DETAIL to "Ghost panel",
                    ).forEach { (option, label) ->
                        val active = layout == option
                        OutlinedButton(
                            onClick = { onLayoutChanged(option) },
                            enabled = !busy,
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (active) {
                                    Mk8dxTheme.tint(Mk8dxTheme.colors, Mk8dxTheme.colors.actionPrimary)
                                } else {
                                    Color.Transparent
                                },
                            ),
                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 4.dp),
                            modifier = Modifier.weight(1f).heightIn(min = 46.dp)
                                .testTag("result-image-layout-${option.engineValue}"),
                        ) {
                            Text(
                                label,
                                fontWeight = if (active) FontWeight.Black else FontWeight.Normal,
                                textAlign = TextAlign.Center,
                                maxLines = 2,
                            )
                        }
                    }
                }
                Text(
                    if (layout == ScanLayoutProfile.GHOST_DETAIL) {
                        "Reads one rider from the Select-a-Ghost detail panel — for a record whose end screen you can no longer bring up."
                    } else {
                        "Reads both cards from the Time Trial end screen."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Text(
                "The scanner runs locally. Nothing is saved until you review the result.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
    }
}

@Composable
private fun BundledScanTestChooser(
    fixtures: List<BundledScanTestFixture>,
    onDismiss: () -> Unit,
    onSelected: (BundledScanTestFixture) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Choose a test result", fontWeight = FontWeight.Black) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "This runs the real scanner and sync. The saved result is labelled as a test and expires after 24 hours.",
                    style = MaterialTheme.typography.bodySmall,
                )
                fixtures.forEach { fixture ->
                    OutlinedButton(
                        onClick = { onSelected(fixture) },
                        modifier = Modifier.fillMaxWidth().height(58.dp),
                    ) {
                        Column(Modifier.fillMaxWidth()) {
                            Text(fixture.title, fontWeight = FontWeight.Bold)
                            Text(fixture.detail, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { OutlinedButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private fun prepareBundledTestFixture(
    context: Context,
    fixture: BundledScanTestFixture,
): Pair<File, Uri> {
    val directory = File(context.cacheDir, "mk8dx-result-images/test-fixtures").apply {
        check(isDirectory || mkdirs())
    }
    val output = File(directory, "${UUID.randomUUID()}-${fixture.assetName}")
    context.assets.open("scan-test-fixtures/${fixture.assetName}").use { input ->
        FileOutputStream(output).use { target -> input.copyTo(target) }
    }
    val uri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.result-image-provider",
        output,
    )
    return output to uri
}

/** A file the debug bridge was given, copied where the gallery path reads from. */
private fun prepareDebugFile(context: Context, source: File): Pair<File, Uri> {
    val directory = File(context.cacheDir, "mk8dx-result-images/test-fixtures").apply {
        check(isDirectory || mkdirs())
    }
    val output = File(directory, "${UUID.randomUUID()}-debug-${source.name}")
    source.inputStream().use { input -> FileOutputStream(output).use { target -> input.copyTo(target) } }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.result-image-provider", output)
    return output to uri
}

// The stage follows the phone. It used to force landscape, which on a phone
// held upright showed a sideways stage and made a screen recording of the
// scan come out rotated. Now the Player turns the phone or does not, and the
// stage, the guide and the controls lay themselves out for the orientation
// the phone is actually in (see ScanFrameOrientation.kt for the frame side).
@Composable
private fun FullScreenScanDialog(
    onDismissRequest: () -> Unit,
    content: @Composable () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        val view = LocalView.current
        val window = (view.parent as? DialogWindowProvider)?.window
        SideEffect {
            window?.setBackgroundDrawable(ColorDrawable(AndroidColor.BLACK))
            window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            window?.let { WindowCompat.setDecorFitsSystemWindows(it, false) }
        }
        DisposableEffect(window, view) {
            val controller = window?.let { WindowCompat.getInsetsController(it, view) }
            controller?.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller?.hide(WindowInsetsCompat.Type.systemBars())
            onDispose { controller?.show(WindowInsetsCompat.Type.systemBars()) }
        }
        Surface(Modifier.fillMaxSize(), color = ScanStageBackground) { content() }
    }
}

@Composable
private fun CapturedFramePreview(file: File?) {
    val bitmap = remember(file) {
        file?.takeIf(File::isFile)?.let { decodeUprightResultImage(it, inSampleSize = 4) }
    }
    DisposableEffect(bitmap) {
        onDispose { bitmap?.recycle() }
    }
    bitmap?.let {
        Image(
            bitmap = it.asImageBitmap(),
            contentDescription = "Captured result screen",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun EmbeddedMk8dxCamera(
    guideLapCount: Int,
    layout: ScanLayoutProfile,
    onLayoutChanged: (ScanLayoutProfile) -> Unit,
    analyzing: ResultImageAnalysisProgress?,
    frozenFrame: File?,
    onGallery: () -> Unit,
    onClose: () -> Unit,
    onCaptured: (File) -> Unit,
    onFailure: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val portrait = LocalConfiguration.current.orientation == Configuration.ORIENTATION_PORTRAIT
    var imageCapture by remember { mutableStateOf<ImageCapture?>(null) }
    var cameraProvider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    var cameraControl by remember { mutableStateOf<CameraControl?>(null) }
    var zoomRatio by remember { mutableFloatStateOf(1f) }
    // Only read by the debug bridge: what the camera reports and what the
    // Player saw, so a scan can be checked against the guide afterwards.
    var cameraInfo by remember { mutableStateOf<CameraInfo?>(null) }
    var previewUseCase by remember { mutableStateOf<Preview?>(null) }
    var previewView by remember { mutableStateOf<PreviewView?>(null) }
    val executor: Executor = remember(context) { ContextCompat.getMainExecutor(context) }
    val captureRoot = remember(context) {
        File(context.cacheDir, "mk8dx-result-images/embedded-camera").apply { mkdirs() }
    }
    val frozen = analyzing != null

    // The activity handles rotation itself (configChanges), so CameraX is not
    // told about it: the capture is stamped from the orientation sensor, and
    // that stamp is what makes the saved frame upright whichever way the
    // phone is held - including reverse landscape.
    DisposableEffect(context) {
        val listener = object : OrientationEventListener(context) {
            override fun onOrientationChanged(orientation: Int) {
                val rotation = captureRotationFor(orientation) ?: return
                imageCapture?.targetRotation = rotation
            }
        }
        if (listener.canDetectOrientation()) listener.enable()
        onDispose { listener.disable() }
    }

    DisposableEffect(lifecycleOwner) {
        onDispose {
            cameraProvider?.unbindAll()
            cameraProvider = null
            imageCapture = null
            cameraControl = null
        }
    }
    // Nothing is read from the sensor while a shot is being recognized, so the
    // camera is released the moment the frame is frozen.
    DisposableEffect(frozen) {
        if (frozen) {
            cameraProvider?.unbindAll()
            imageCapture = null
            cameraControl = null
        }
        onDispose {}
    }

    // Black, not a surface token: this is the letterbox around a live video
    // frame, and anything lighter draws a visible border around the picture the
    // Player is aiming. The freeze dims that same frame.
    val stage: @Composable (Modifier) -> Unit = { stageModifier ->
        Box(stageModifier.background(Color.Black)) {
            if (frozen) {
                CapturedFramePreview(frozenFrame)
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .42f)))
            } else {
                AndroidView(
                    factory = { viewContext ->
                        PreviewView(viewContext).apply {
                            scaleType = PreviewView.ScaleType.FIT_CENTER
                            val future = ProcessCameraProvider.getInstance(viewContext)
                            future.addListener({
                                runCatching {
                                    val provider = future.get()
                                    cameraProvider = provider
                                    val preview = Preview.Builder().build()
                                        .also { it.surfaceProvider = surfaceProvider }
                                    val capture = ImageCapture.Builder()
                                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                                        .build()
                                    provider.unbindAll()
                                    val camera = provider.bindToLifecycle(
                                        lifecycleOwner,
                                        CameraSelector.DEFAULT_BACK_CAMERA,
                                        preview,
                                        capture,
                                    )
                                    imageCapture = capture
                                    cameraControl = camera.cameraControl
                                    cameraInfo = camera.cameraInfo
                                    // A rebound camera starts at its own default zoom.
                                    zoomRatio = 1f
                                    previewUseCase = preview
                                }.onFailure { onFailure() }
                            }, executor)
                        }.also { previewView = it }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
            ScanAimingGuideOverlay(guideLapCount, layout, Modifier.fillMaxSize(), portrait = portrait)
            ScanStatusPill(
                text = scanStatusLine(analyzing, layout),
                modifier = Modifier.align(Alignment.TopCenter)
                    .padding(horizontal = 16.dp, vertical = 6.dp),
            )
            if (analyzing != null) {
                ScanProgressPanel(
                    progress = analyzing,
                    modifier = Modifier.align(Alignment.BottomCenter)
                        .padding(bottom = 28.dp)
                        .widthIn(max = ScanProgressPanelWidth)
                        .fillMaxWidth(.92f),
                )
            }
        }
    }
    val shoot: () -> Unit = shoot@{
        val capture = imageCapture ?: return@shoot
        val file = File(captureRoot, "capture-" + UUID.randomUUID() + ".jpg")
        // Taken at the press, before anything moves: the guide as drawn and
        // the preview as shown, in the same pixels.
        val debugShot = ScanDebug.recorder?.let {
            scanDebugShot(previewView, previewUseCase, capture, cameraInfo, layout, guideLapCount, portrait, zoomRatio)
        }
        val debugPreview = debugShot?.let { runCatching { previewView?.bitmap }.getOrNull() }
        capture.takePicture(
            ImageCapture.OutputFileOptions.Builder(file).build(),
            executor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    if (debugShot != null) {
                        // What the camera reports after the shot as well: a
                        // zoom still settling shows up as two different values.
                        debugShot.put("zoom_after_capture", scanDebugZoom(cameraInfo))
                        ScanDebug.recorder?.cameraShot(file, debugShot, debugPreview)
                    }
                    onCaptured(file)
                }

                override fun onError(exception: ImageCaptureException) {
                    file.delete()
                    onFailure()
                }
            },
        )
    }
    val zoomTo: (Float) -> Unit = zoom@{ next ->
        val range = cameraInfo?.zoomState?.value ?: return@zoom
        val supported = next.coerceIn(range.minZoomRatio, range.maxZoomRatio)
        zoomRatio = supported
        cameraControl?.setZoomRatio(supported)
    }
    if (ScanDebug.recorder != null) {
        val currentShoot by rememberUpdatedState(shoot)
        val currentZoomTo by rememberUpdatedState(zoomTo)
        LaunchedEffect(Unit) {
            ScanDebug.commands.collect { command ->
                when (command) {
                    is ScanDebugCommand.SetZoom -> currentZoomTo(command.ratio)
                    ScanDebugCommand.Shutter -> if (!frozen) currentShoot()
                    else -> Unit
                }
            }
        }
        val currentPortrait by rememberUpdatedState(portrait)
        val currentFrozen by rememberUpdatedState(frozen)
        DisposableEffect(Unit) {
            ScanDebug.provide("camera") {
                org.json.JSONObject()
                    .put("ready", imageCapture != null)
                    .put("frozen", currentFrozen)
                    .put("portrait", currentPortrait)
                    .put("zoom_requested", zoomRatio.toDouble())
                    .put("zoom_reported", scanDebugZoom(cameraInfo))
            }
            onDispose { ScanDebug.provide("camera", null) }
        }
    }
    val controls: @Composable () -> Unit = {
        ScanControls(
            vertical = !portrait,
            busy = frozen,
            zoomRatio = zoomRatio,
            layout = layout,
            shutterEnabled = imageCapture != null,
            onShutter = shoot,
            onGallery = onGallery,
            onZoom = {
                // Skip steps this camera cannot reach, keeping the label and capture aligned.
                zoomTo(nextScannerZoom(zoomRatio, cameraInfo?.zoomState?.value?.maxZoomRatio ?: 1f))
            },
            onLayout = {
                onLayoutChanged(
                    if (layout == ScanLayoutProfile.GHOST_DETAIL) {
                        ScanLayoutProfile.ENDSCREEN
                    } else {
                        ScanLayoutProfile.GHOST_DETAIL
                    },
                )
            },
            onClose = onClose,
        )
    }
    val root = Modifier.fillMaxSize().background(ScanStageBackground)
        .windowInsetsPadding(WindowInsets.safeDrawing)
        .testTag("embedded-scan-camera")
    if (portrait) {
        // Upright: the stage on top, the controls in one row under the thumb.
        Column(root) {
            stage(Modifier.weight(1f).fillMaxWidth())
            controls()
        }
    } else {
        // Turned: the stage wide, the controls in a column beside it.
        Row(root) {
            stage(Modifier.weight(1f).fillMaxHeight())
            controls()
        }
    }
}

@Composable
private fun scanStatusLine(
    analyzing: ResultImageAnalysisProgress?,
    layout: ScanLayoutProfile,
): String = when {
    analyzing != null ->
        "MK8 | " + androidLocalizedPresentation(analyzing.phase).uppercase() +
            " | " + (analyzing.fraction * 100).toInt() + "%"
    layout == ScanLayoutProfile.GHOST_DETAIL ->
        "MK8 | " + androidText("Aim at the ghost panel", "Richt op het ghost-paneel").uppercase()
    else ->
        "MK8 | " + androidText("Aim at the result screen", "Richt op het resultaatscherm").uppercase()
}

/**
 * The scanner's controls: one thumb-reachable stack beside the stage in
 * landscape, one row under it in portrait, with the shutter as the only
 * bright thing on the screen either way.
 */
@Composable
private fun ScanControls(
    vertical: Boolean,
    busy: Boolean,
    zoomRatio: Float,
    layout: ScanLayoutProfile,
    shutterEnabled: Boolean,
    onShutter: () -> Unit,
    onGallery: () -> Unit,
    onZoom: () -> Unit,
    onLayout: () -> Unit,
    onClose: () -> Unit,
) {
    // The shutter, and the four others that share a stack or a row.
    val shutter: @Composable (slot: Modifier) -> Unit = { slot ->
        Button(
            onClick = onShutter,
            enabled = shutterEnabled && !busy,
            shape = RoundedCornerShape(18.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = ScanStageShutter,
                contentColor = ScanStageOnShutter,
            ),
            border = BorderStroke(2.dp, ScanStageInk),
            contentPadding = PaddingValues(3.dp),
            modifier = slot.height(52.dp).testTag("embedded-scan-shutter"),
        ) {
            Text(
                "📷\nSCAN",
                fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center,
                lineHeight = 16.sp,
            )
        }
    }
    val others: @Composable (slot: Modifier) -> Unit = { slot ->
        ScanColumnButton(
            "🖼\nGALLERY",
            enabled = !busy,
            onClick = onGallery,
            modifier = slot,
            testTag = "embedded-scan-gallery",
        )
        ScanColumnButton(
            "🔍 " + zoomLabel(zoomRatio),
            enabled = !busy,
            onClick = onZoom,
            modifier = slot,
            testTag = "embedded-scan-zoom",
        )
        ScanColumnButton(
            if (layout == ScanLayoutProfile.GHOST_DETAIL) {
                "👻\n" + androidText("Ghost panel", "Ghost-paneel").uppercase()
            } else {
                "🎴\n" + androidText("End screen", "Eindscherm").uppercase()
            },
            enabled = !busy,
            onClick = onLayout,
            modifier = slot,
            testTag = "embedded-scan-layout",
        )
        ScanColumnButton(
            "✕\n" + androidText("Close", "Sluiten").uppercase(),
            enabled = !busy,
            onClick = onClose,
            modifier = slot,
        )
    }
    if (vertical) {
        Column(
            Modifier.width(112.dp).fillMaxHeight()
                .background(ScanStageBar)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 6.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
        ) {
            shutter(Modifier.fillMaxWidth())
            others(Modifier.fillMaxWidth())
        }
    } else {
        // Upright, the Web scanner's composition, which the owner prefers:
        // the shutter across the full width, the four others in one row
        // beneath it with equal shares.
        Column(
            Modifier.fillMaxWidth()
                .background(ScanStageBar)
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            shutter(Modifier.fillMaxWidth())
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) { others(Modifier.weight(1f)) }
        }
    }
}

private fun zoomLabel(ratio: Float): String {
    val tenths = Math.round(ratio * 10f)
    return "${tenths / 10}.${tenths % 10}x"
}

internal fun nextScannerZoom(current: Float, maximum: Float): Float =
    floatArrayOf(1f, 1.5f, 2f, 2.5f, 3f)
        .firstOrNull { it > current + 0.05f && it <= maximum + 0.0001f } ?: 1f

@Composable
private fun ScanColumnButton(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier.fillMaxWidth(),
    testTag: String? = null,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, ScanStageControlEdge),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = ScanStageControl,
            contentColor = ScanStageInk,
        ),
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 3.dp),
        modifier = modifier.height(40.dp)
            .then(if (testTag == null) Modifier else Modifier.testTag(testTag)),
    ) {
        Text(
            label,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            lineHeight = 13.sp,
            textAlign = TextAlign.Center,
            // The words must survive, not the line count: a clipped "GALLE" is
            // worse than a wrapped label.
            softWrap = true,
            maxLines = 3,
        )
    }
}

@Composable
private fun ScanStatusPill(text: String, modifier: Modifier = Modifier) {
    Surface(
        color = ScanStagePill,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, ScanStagePillEdge),
        modifier = modifier.testTag("embedded-scan-status"),
    ) {
        Text(
            text,
            color = ScanStageBodyInk,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = .5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
        )
    }
}

/**
 * The camera stage's own chrome (DESIGN_SYSTEM §14 task mode). It is drawn over
 * a live video frame, so it cannot follow the app's appearance: a Light shell
 * over a camera preview is unreadable and would flare in a dark room. It is
 * still not a palette — every value below is a generated Dark token, pinned to
 * Dark on purpose rather than chosen by hand.
 */
private val ScanStageBackground = Mk8dxTokens.Dark.surfaceApp
private val ScanStageBar = Mk8dxTokens.Dark.surfaceApp.copy(alpha = .75f)
private val ScanStageShutter = Mk8dxTokens.Dark.actionPrimary
private val ScanStageOnShutter = Mk8dxTokens.Dark.actionOnPrimary
private val ScanStageInk = Mk8dxTokens.Dark.textPrimary
private val ScanStageBodyInk = Mk8dxTokens.Dark.textBody
private val ScanStageControl = Mk8dxTokens.Dark.surfaceRaised.copy(alpha = .86f)
private val ScanStageControlEdge = Mk8dxTokens.Dark.borderControl.copy(alpha = .38f)
private val ScanStagePill = Mk8dxTokens.Dark.surfaceRaised.copy(alpha = .92f)
private val ScanStagePillEdge = Mk8dxTokens.Dark.borderStrong.copy(alpha = .54f)

private fun ResultImageAcquisitionState.statusText(): String = when (this) {
    ResultImageAcquisitionState.Ready -> "Choose camera or a saved Switch screenshot"
    ResultImageAcquisitionState.AwaitingGallery -> "Waiting for a gallery image"
    ResultImageAcquisitionState.AwaitingCamera -> "Preparing captured frame"
    is ResultImageAcquisitionState.Analyzing -> "Recognition runs offline and may take a moment"
    is ResultImageAcquisitionState.Completed -> "Recognition complete — review required"
    is ResultImageAcquisitionState.Cancelled -> "No image selected"
    is ResultImageAcquisitionState.Failed -> when (code) {
        ResultImageFailureCode.EMPTY_IMAGE,
        ResultImageFailureCode.IMAGE_TOO_LARGE,
        ResultImageFailureCode.READ_FAILURE,
        -> "That image could not be read. Try another or enter manually."
        ResultImageFailureCode.PREPARATION_FAILURE -> "Camera is unavailable. Gallery still works."
        ResultImageFailureCode.SUBMISSION_STORE_FAILURE -> "The result was recognized but could not be saved."
        ResultImageFailureCode.ANALYZER_FAILURE,
        ResultImageFailureCode.EXECUTION_FAILURE,
        -> "No result screen found. Both the end screen and the ghost panel were tried, so check that the times are visible and the card fills the frame — or enter it manually."
    }
}
