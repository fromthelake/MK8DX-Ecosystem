package nl.mariokart8.mk8dxtimetrials.scan

import android.graphics.Bitmap
import android.os.Looper
import android.os.SystemClock
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalTimeTrialOutbox
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSubmissionHost
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidProducedSubmissionValidator
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OptInScanRuntimeComponentTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun acquiredGoldenImageRunsOffMainThroughConsensusAndCanonicalOutput() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val assets = instrumentation.context.assets
        val frames = checkNotNull(assets.list("corpus/frames")).sorted()
        assumeTrue("Optional private OCR corpus is absent from the public build", frames.isNotEmpty())
        val frameName = frames.first()
        val frameId = frameName.substringBeforeLast('.')
        val expected = assets.open("corpus/results/$frameId.json")
            .bufferedReader()
            .use { JSONObject(it.readText()) }
        val context = instrumentation.targetContext
        val suffix = UUID.randomUUID().toString()
        val allowedRoot = File(context.cacheDir, "mk8dx-result-images")
        val importedFile = File(allowedRoot, "opt-in-$frameName")
        val sessionRoot = File(allowedRoot, "opt-in-session-$suffix")
        val canonicalRoot = File(context.filesDir, "opt-in-outbox-$suffix")
        val privateRoot = File(context.noBackupFilesDir, "opt-in-private-$suffix")
        allowedRoot.mkdirs()
        assets.open("corpus/frames/$frameName").use { input ->
            importedFile.outputStream().use(input::copyTo)
        }
        val galleryUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.result-image-provider",
            importedFile,
        )
        val outbox = AndroidLocalTimeTrialOutbox(
            canonicalRoot,
            privateRoot,
            AndroidProducedSubmissionValidator,
        )
        val contextOffMain = AtomicBoolean(false)
        val callbackOnMain = AtomicBoolean(false)
        val output = AtomicReference<AndroidScanTimeTrialSubmissionV1?>()

        try {
            val factory = AndroidScanProductHostFactory(
                context = context,
                analyzerFactory = createOptInResultImageAnalyzerFactory(
                    context = context,
                    capturedAtMsProvider = { 1_786_900_000_000 },
                ),
                contextProvider = {
                    contextOffMain.set(Looper.myLooper() != Looper.getMainLooper())
                    AndroidScanSubmissionContext(
                        submissionId = "user_submission.time.OPTINSCANUI001",
                        revision = 1,
                        mode = 200,
                        trackId = "track.baby_park",
                        playerReference = ScanPlayerReferenceV1(
                            namespace = "unresolved_observation",
                            value = "opt-in-runtime-component",
                        ),
                        createdAtMs = 1_786_900_000_100,
                        producerVersion = "opt-in-runtime-component-test",
                        localRecordId = "opt-in-runtime-component-burst",
                    )
                },
                submissionHost = AndroidOutboxSubmissionHost(
                    outbox,
                    AndroidOutboxClock { 1_786_900_000_200 },
                ),
                sessionRoot = sessionRoot,
            )
            compose.setContent {
                MaterialTheme {
                    val scope = rememberCoroutineScope()
                    var state by remember {
                        mutableStateOf<ResultImageAcquisitionState>(ResultImageAcquisitionState.Ready)
                    }
                    val host = remember {
                        factory.create(
                            parentScope = scope,
                            onState = { state = it },
                            onSubmission = {
                                callbackOnMain.set(Looper.myLooper() == Looper.getMainLooper())
                                output.set(it)
                            },
                        )
                    }
                    DisposableEffect(host) {
                        onDispose(host::close)
                    }
                    ResultImageAcquisitionComponent(
                        state = state,
                        onGalleryRequested = {
                            if (host.beginGallery()) host.completeGallery(galleryUri)
                        },
                        onCameraRequested = {},
                    )
                }
            }

            val startedAt = SystemClock.elapsedRealtime()
            compose.onNodeWithTag("result-image-gallery").performClick()
            compose.waitUntil(timeoutMillis = 5_000) {
                runCatching {
                    compose.onNodeWithTag("result-image-status")
                        .assertTextEquals("Recognition runs offline and may take a moment")
                }.isSuccess
            }
            compose.onNodeWithTag("result-image-gallery").assertIsNotEnabled()
            compose.runOnIdle {
                assertTrue(SystemClock.elapsedRealtime() - startedAt < 5_000)
            }

            compose.waitUntil(timeoutMillis = 45_000) { output.get() != null }
            compose.onNodeWithTag("result-image-status")
                .assertTextEquals("Recognition complete — review required")
            compose.runOnIdle {
                assertTrue(contextOffMain.get())
                assertTrue(callbackOnMain.get())
                assertTrue(importedFile.exists())
                assertTrue(sessionRoot.listFiles()?.isEmpty() == true)
                assertTrue(privateRoot.listFiles()?.isEmpty() == true)
                assertEquals("pending", outbox.list().single().state.state)
                assertEquals("android_scan", output.get()?.source?.kind)
                assertEquals(7, output.get()?.laps?.size)
                val expectedFields = expected.getJSONObject("fields")
                assertEquals(
                    expectedFields.getString("player_total"),
                    output.get()?.totalTimeMs?.let(::formatTime),
                )
                assertEquals(
                    (1..7).map { expectedFields.getString("player_lap_$it") },
                    output.get()?.laps?.map { formatTime(it.timeMs) },
                )
            }
        } finally {
            importedFile.delete()
            sessionRoot.deleteRecursively()
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    @Test
    fun bitmapDecoderReadsThe4by3BoxOfAPortraitFrameAndRejectsOversizedBounds() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        // A portrait photo of the TV, held upright: the engine gets the
        // centred 4:3 box the aiming guide covered (2026-09-17), not a
        // sideways frame.
        val source = Bitmap.createBitmap(160, 320, Bitmap.Config.ARGB_8888)
        val file = File(instrumentation.targetContext.cacheDir, "portrait-result.png")
        try {
            file.outputStream().use { source.compress(Bitmap.CompressFormat.PNG, 100, it) }
            val decoded = OptInResultImageBitmapDecoder().decode(file)
            try {
                assertEquals(160, decoded.width)
                assertEquals(120, decoded.height)
            } finally {
                decoded.recycle()
            }
            assertThrows(ScanResultImageAnalysisException::class.java) {
                OptInResultImageBitmapDecoder(maximumPixels = 5).decode(file)
            }
        } finally {
            source.recycle()
            file.delete()
        }
    }

    @Test
    fun aGuidedCameraStillIsReadAtTheEngineSizesAndAGalleryImageAsItIs() {
        // A landscape 12 MP-class still: from the scanner's own camera the burst
        // is its CAMERA_STILL_SIZES, each size made once; from the gallery it is
        // the image itself, five times.
        val still = Bitmap.createBitmap(4000, 3000, Bitmap.Config.ARGB_8888)
        val renderings = OptInStillRenderings()
        try {
            val camera = renderings.burst(still, ResultImageSource.CAMERA)
            try {
                assertEquals(CAMERA_STILL_SIZES, camera.map { it.width })
                assertEquals(1440, camera[0].height)
                assertTrue(camera[0] === camera[1])
                assertTrue(camera[2] === camera[3])
            } finally {
                renderings.release(camera, still)
            }
            assertTrue(!still.isRecycled)
            val gallery = renderings.burst(still, ResultImageSource.GALLERY)
            assertEquals(ScanBurstPolicy.BURST_FRAMES, gallery.size)
            assertTrue(gallery.all { it === still })
        } finally {
            still.recycle()
        }
    }

    @Test
    fun bitmapDecoderAppliesTheExifOrientationACameraStoredBesideThePixels() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        // A landscape shot stored sideways with "rotate 90" in EXIF, the way
        // CameraX writes a capture taken with the phone turned: upright it is
        // landscape again and is read whole. The left edge is marked so the
        // rotation direction is proven, not just the shape.
        val source = Bitmap.createBitmap(90, 160, Bitmap.Config.ARGB_8888).apply {
            eraseColor(android.graphics.Color.BLUE)
            for (y in 0 until 8) for (x in 0 until 90) setPixel(x, y, android.graphics.Color.RED)
        }
        val file = File(instrumentation.targetContext.cacheDir, "sideways-result.jpg")
        try {
            file.outputStream().use { source.compress(Bitmap.CompressFormat.JPEG, 100, it) }
            androidx.exifinterface.media.ExifInterface(file.absolutePath).apply {
                setAttribute(
                    androidx.exifinterface.media.ExifInterface.TAG_ORIENTATION,
                    androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_90.toString(),
                )
                saveAttributes()
            }
            val decoded = OptInResultImageBitmapDecoder().decode(file)
            try {
                assertEquals(160, decoded.width)
                assertEquals(90, decoded.height)
                // The marked top rows of the stored image are the right-hand
                // columns after a 90 degree clockwise rotation.
                assertTrue(android.graphics.Color.red(decoded.getPixel(156, 45)) > 150)
                assertTrue(android.graphics.Color.blue(decoded.getPixel(4, 45)) > 150)
            } finally {
                decoded.recycle()
            }
        } finally {
            source.recycle()
            file.delete()
        }
    }

    private fun formatTime(value: Long): String {
        val minutes = value / 60_000
        val remainder = value % 60_000
        return "%d:%02d.%03d".format(minutes, remainder / 1_000, remainder % 1_000)
    }
}
