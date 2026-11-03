package nl.mariokart8.mk8dxtimetrials.scan

import android.os.Looper
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalTimeTrialOutbox
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSubmissionHost
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidProducedSubmissionValidator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ResultImageAcquisitionDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun surfaceKeepsGalleryPrimaryAndCameraSeparate() {
        val galleryCalls = AtomicInteger(0)
        val cameraCalls = AtomicInteger(0)
        lateinit var setState: (ResultImageAcquisitionState) -> Unit
        compose.setContent {
            var state by androidx.compose.runtime.remember {
                mutableStateOf<ResultImageAcquisitionState>(ResultImageAcquisitionState.Ready)
            }
            setState = { state = it }
            MaterialTheme {
                ResultImageAcquisitionComponent(
                    state,
                    onGalleryRequested = galleryCalls::incrementAndGet,
                    onCameraRequested = cameraCalls::incrementAndGet,
                )
            }
        }

        compose.onNodeWithTag("result-image-status")
            .assertTextEquals("Choose camera or a saved Switch screenshot")
        compose.onNodeWithTag("result-image-gallery").assertIsEnabled().performClick()
        compose.onNodeWithTag("result-image-camera").assertIsEnabled().performClick()
        compose.runOnIdle {
            assertEquals(1, galleryCalls.get())
            assertEquals(1, cameraCalls.get())
            setState(ResultImageAcquisitionState.Analyzing(ResultImageSource.GALLERY))
        }
        compose.onNodeWithTag("result-image-gallery").assertIsNotEnabled()
        compose.onNodeWithTag("result-image-camera").assertIsNotEnabled()
        compose.onNodeWithTag("result-image-status")
            .assertTextEquals("Recognition runs offline and may take a moment")
        compose.onNodeWithTag("scan-rainbow-progress").assertIsDisplayed()
        compose.runOnIdle {
            setState(
                ResultImageAcquisitionState.Failed(
                    ResultImageFailureCode.SUBMISSION_STORE_FAILURE,
                ),
            )
        }
        compose.onNodeWithTag("result-image-status")
            .assertTextEquals("The result was recognized but could not be saved.")
    }

    @Test
    fun androidPortProcessesSyntheticGalleryAndCameraImagesOffMain() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val allowedRoot = File(context.cacheDir, "mk8dx-result-images")
        val sessionRoot = File(allowedRoot, "device-${UUID.randomUUID()}")
        val gallerySource = File(allowedRoot, "gallery-${UUID.randomUUID()}.png")
        allowedRoot.mkdirs()
        gallerySource.writeBytes(SYNTHETIC_PNG)
        val galleryUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.result-image-provider",
            gallerySource,
        )
        val port = AndroidResultImageAcquisitionPort(context, sessionRoot)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val completions = CountDownLatch(2)
        val analyzerOffMain = AtomicBoolean(true)
        val callbacksOnMain = AtomicBoolean(true)
        val sources = mutableListOf<ResultImageSource>()
        val outputs = AtomicInteger(0)
        val host = ResultImageAsyncHost(
            scope,
            port,
            ResultImageAnalyzer { image ->
                analyzerOffMain.set(
                    analyzerOffMain.get() && Looper.myLooper() != Looper.getMainLooper(),
                )
                synchronized(sources) { sources += image.source }
                assertTrue(image.file.readBytes().contentEquals(SYNTHETIC_PNG))
                submission(outputs.get() + 1)
            },
            onState = {
                callbacksOnMain.set(
                    callbacksOnMain.get() && Looper.myLooper() == Looper.getMainLooper(),
                )
                if (it is ResultImageAcquisitionState.Completed) completions.countDown()
            },
            onSubmission = { outputs.incrementAndGet() },
        )

        try {
            instrumentation.runOnMainSync {
                assertTrue(host.beginGallery())
                host.completeGallery(galleryUri)
            }
            assertTrue(waitUntil(5_000) { outputs.get() == 1 })

            val cameraUri = AtomicReference<android.net.Uri>()
            instrumentation.runOnMainSync {
                cameraUri.set(checkNotNull(host.beginCamera()))
            }
            context.contentResolver.openOutputStream(cameraUri.get(), "w").use { output ->
                checkNotNull(output).write(SYNTHETIC_PNG)
            }
            instrumentation.runOnMainSync { host.completeCamera(success = true) }

            assertTrue(completions.await(5, TimeUnit.SECONDS))
            assertEquals(2, outputs.get())
            assertEquals(
                listOf(ResultImageSource.GALLERY, ResultImageSource.CAMERA),
                synchronized(sources) { sources.toList() },
            )
            assertTrue(analyzerOffMain.get())
            assertTrue(callbacksOnMain.get())
            assertTrue(sessionRoot.listFiles()?.isEmpty() == true)
            val permissions = context.packageManager.getPackageInfo(
                context.packageName,
                android.content.pm.PackageManager.GET_PERMISSIONS,
            ).requestedPermissions?.toList().orEmpty()
            assertTrue(permissions.contains(android.Manifest.permission.INTERNET))
            assertTrue(permissions.contains(android.Manifest.permission.CAMERA))
            assertFalse(permissions.contains(android.Manifest.permission.READ_MEDIA_IMAGES))
            assertFalse(permissions.contains(android.Manifest.permission.READ_EXTERNAL_STORAGE))
        } finally {
            host.close()
            scope.cancel()
            gallerySource.delete()
            sessionRoot.deleteRecursively()
        }
    }

    @Test
    fun productFactoryStoresCanonicalResultBeforeMainCallback() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val suffix = UUID.randomUUID().toString()
        val allowedRoot = File(context.cacheDir, "mk8dx-result-images")
        val gallerySource = File(allowedRoot, "product-gallery-$suffix.png")
        val sessionRoot = File(allowedRoot, "product-session-$suffix")
        val canonicalRoot = File(context.filesDir, "product-outbox-$suffix")
        val privateRoot = File(context.noBackupFilesDir, "product-private-$suffix")
        allowedRoot.mkdirs()
        gallerySource.writeBytes(SYNTHETIC_PNG)
        val galleryUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.result-image-provider",
            gallerySource,
        )
        val outbox = AndroidLocalTimeTrialOutbox(
            canonicalRoot,
            privateRoot,
            AndroidProducedSubmissionValidator,
        )
        val contextOffMain = AtomicBoolean(false)
        val analyzerOffMain = AtomicBoolean(false)
        val callbackOnMain = AtomicBoolean(false)
        val analyzerFactoryCalls = AtomicInteger(0)
        val completed = CountDownLatch(1)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val factory = AndroidScanProductHostFactory(
            context = context,
            analyzerFactory = ContextualResultImageAnalyzerFactory { contextProvider ->
                analyzerFactoryCalls.incrementAndGet()
                ResultImageAnalyzer { image ->
                    analyzerOffMain.set(Looper.myLooper() != Looper.getMainLooper())
                    assertTrue(image.file.readBytes().contentEquals(SYNTHETIC_PNG))
                    submission(contextProvider())
                }
            },
            contextProvider = {
                contextOffMain.set(Looper.myLooper() != Looper.getMainLooper())
                AndroidScanSubmissionContext(
                    submissionId = "user_submission.time.ANDROIDPRODUCT01",
                    revision = 1,
                    mode = 150,
                    trackId = "track.mario_kart_stadium",
                    playerReference = ScanPlayerReferenceV1(
                        "producer_local_profile",
                        "product-device-profile",
                    ),
                    createdAtMs = 1_786_900_600_100,
                    producerVersion = "scan-product-device-test",
                    localRecordId = "scan-product-device-record",
                )
            },
            submissionHost = AndroidOutboxSubmissionHost(
                outbox,
                AndroidOutboxClock { 1_786_900_600_200 },
            ),
            sessionRoot = sessionRoot,
        )
        val host = factory.create(
            parentScope = scope,
            onState = {
                if (it is ResultImageAcquisitionState.Completed) completed.countDown()
            },
            onSubmission = {
                callbackOnMain.set(Looper.myLooper() == Looper.getMainLooper())
            },
        )
        val secondHost = factory.create(scope, onState = {}, onSubmission = {})

        try {
            secondHost.close()
            assertEquals(1, analyzerFactoryCalls.get())
            instrumentation.runOnMainSync {
                assertTrue(host.beginGallery())
                host.completeGallery(galleryUri)
            }
            assertTrue(completed.await(5, TimeUnit.SECONDS))

            val record = outbox.list().single()
            assertEquals("pending", record.state.state)
            val source = record.canonicalSubmission["source"] as JsonObject
            assertEquals(JsonPrimitive("android_scan"), source["kind"])
            assertTrue(analyzerOffMain.get())
            assertTrue(contextOffMain.get())
            assertTrue(callbackOnMain.get())
            assertTrue(sessionRoot.listFiles()?.isEmpty() == true)
            assertTrue(privateRoot.listFiles()?.isEmpty() == true)
        } finally {
            secondHost.close()
            host.close()
            scope.cancel()
            gallerySource.delete()
            sessionRoot.deleteRecursively()
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    private fun submission(number: Int) = createAndroidScanSubmission(
        AcceptedPlayerScanObservation(
            totalTime = "1:46.784",
            lapTimes = listOf("0:37.121", "0:35.399", "0:34.264"),
            lapSumAccepted = true,
            capturedAtMs = 1_786_900_500_000 + number,
        ),
        AndroidScanSubmissionContext(
            submissionId = "user_submission.time.ANDROIDIMAGEDEVICE0$number",
            revision = 1,
            mode = 150,
            trackId = "track.mario_kart_stadium",
            playerReference = ScanPlayerReferenceV1(
                "unresolved_observation",
                "synthetic-device-image",
            ),
            createdAtMs = 1_786_900_500_100 + number,
            producerVersion = "result-image-device-test",
        ),
        object : ScanLegacyAssetResolver {
            override fun resolveTire(index: Int): String? = null
            override fun resolveCountry(index: Int): String? = null
        },
    )

    private fun submission(context: AndroidScanSubmissionContext) =
        createAndroidScanSubmission(
            AcceptedPlayerScanObservation(
                totalTime = "1:46.784",
                lapTimes = listOf("0:37.121", "0:35.399", "0:34.264"),
                lapSumAccepted = true,
                capturedAtMs = 1_786_900_600_000,
            ),
            context,
            object : ScanLegacyAssetResolver {
                override fun resolveTire(index: Int): String? = null
                override fun resolveCountry(index: Int): String? = null
            },
        )

    private fun waitUntil(timeoutMs: Long, predicate: () -> Boolean): Boolean {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (System.nanoTime() < deadline) {
            if (predicate()) return true
            Thread.sleep(10)
        }
        return predicate()
    }

    private companion object {
        val SYNTHETIC_PNG = byteArrayOf(
            -119, 80, 78, 71, 13, 10, 26, 10,
            0, 0, 0, 13, 73, 72, 68, 82,
            0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, -60,
            -119,
        )
    }
}
