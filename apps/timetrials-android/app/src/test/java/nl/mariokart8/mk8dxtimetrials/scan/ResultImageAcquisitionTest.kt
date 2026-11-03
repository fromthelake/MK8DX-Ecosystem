package nl.mariokart8.mk8dxtimetrials.scan

import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ResultImageAcquisitionTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private fun submission() = createAndroidScanSubmission(
        AcceptedPlayerScanObservation(
            totalTime = "1:46.784",
            lapTimes = listOf("0:37.121", "0:35.399", "0:34.264"),
            lapSumAccepted = true,
            capturedAtMs = 1_786_900_400_000,
        ),
        AndroidScanSubmissionContext(
            submissionId = "user_submission.time.ANDROIDIMAGEHOST01",
            revision = 1,
            mode = 150,
            trackId = "track.mario_kart_stadium",
            playerReference = ScanPlayerReferenceV1(
                "unresolved_observation",
                "synthetic-image-host",
            ),
            createdAtMs = 1_786_900_400_100,
            producerVersion = "result-image-test",
        ),
        object : ScanLegacyAssetResolver {
            override fun resolveTire(index: Int): String? = null
            override fun resolveCountry(index: Int): String? = null
        },
    )

    @Test
    fun galleryCopyIsBoundedFlushedAndExplicitlyDiscarded() {
        val root = temporary.newFolder("gallery")
        val store = LocalResultImageStore(root, maximumBytes = 8)

        val image = store.importGallery { ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)) }

        assertEquals(ResultImageSource.GALLERY, image.source)
        assertEquals(4L, image.byteCount)
        assertTrue(image.file.readBytes().contentEquals(byteArrayOf(1, 2, 3, 4)))
        assertFalse(image.file.name.endsWith(".tmp"))
        store.discard(image.file)
        assertFalse(image.file.exists())
    }

    @Test
    fun galleryRejectsEmptyAndOversizedInputWithoutRetainingBytes() {
        listOf(
            ByteArray(0) to ResultImageFailureCode.EMPTY_IMAGE,
            ByteArray(5) { 1 } to ResultImageFailureCode.IMAGE_TOO_LARGE,
        ).forEachIndexed { index, (bytes, expected) ->
            val root = temporary.newFolder("invalid-$index")
            val store = LocalResultImageStore(root, maximumBytes = 4)
            val error = assertThrows(ResultImageAcquisitionException::class.java) {
                store.importGallery { ByteArrayInputStream(bytes) }
            }
            assertEquals(expected, error.code)
            assertEquals("Result image acquisition failed.", error.message)
            assertTrue(root.listFiles()?.isEmpty() == true)
        }
    }

    @Test
    fun cameraPreparationSupportsCancelAndValidLocalCompletion() {
        val root = temporary.newFolder("camera")
        val store = LocalResultImageStore(root, maximumBytes = 8)
        val cancelled = store.prepareCameraFile()
        assertTrue(cancelled.exists())
        assertEquals(null, store.completeCamera(cancelled, success = false))
        assertFalse(cancelled.exists())

        val completed = store.prepareCameraFile()
        completed.writeBytes(byteArrayOf(9, 8, 7))
        val image = checkNotNull(store.completeCamera(completed, success = true))

        assertEquals(ResultImageSource.CAMERA, image.source)
        assertEquals(3L, image.byteCount)
        store.discard(image.file)
        assertTrue(root.listFiles()?.isEmpty() == true)
    }

    @Test
    fun emptyCameraOutputFailsClosedAndIsRemoved() {
        val root = temporary.newFolder("empty-camera")
        val store = LocalResultImageStore(root)
        val file = store.prepareCameraFile()

        val error = assertThrows(ResultImageAcquisitionException::class.java) {
            store.completeCamera(file, success = true)
        }

        assertEquals(ResultImageFailureCode.EMPTY_IMAGE, error.code)
        assertFalse(file.exists())
    }

    @Test
    fun asyncGalleryRunsAnalyzerOnWorkerAndSubmissionOnCallbackDispatcher() {
        val root = temporary.newFolder("async-gallery")
        val port = ByteArrayPort(LocalResultImageStore(root))
        val worker = Executors.newSingleThreadExecutor { Thread(it, "image-worker") }
            .asCoroutineDispatcher()
        val callback = Executors.newSingleThreadExecutor { Thread(it, "image-callback") }
            .asCoroutineDispatcher()
        val scope = CoroutineScope(SupervisorJob())
        val completed = CountDownLatch(1)
        val analyzerThread = AtomicReference<String>()
        val sinkThread = AtomicReference<String>()
        val callbackThread = AtomicReference<String>()
        val sequence = mutableListOf<String>()
        val output = AtomicReference<AndroidScanTimeTrialSubmissionV1?>()
        val host = ResultImageAsyncHost(
            scope,
            port,
            ResultImageAnalyzer {
                analyzerThread.set(Thread.currentThread().name)
                synchronized(sequence) { sequence += "analyze" }
                assertTrue(it.file.exists())
                submission()
            },
            onState = {
                callbackThread.set(Thread.currentThread().name)
                if (it is ResultImageAcquisitionState.Completed) completed.countDown()
            },
            onSubmission = {
                synchronized(sequence) { sequence += "callback" }
                output.set(it)
            },
            submissionSink = ResultImageSubmissionSink {
                sinkThread.set(Thread.currentThread().name)
                synchronized(sequence) { sequence += "store" }
            },
            workerDispatcher = worker,
            callbackDispatcher = callback,
        )

        try {
            assertTrue(host.beginGallery())
            assertFalse(host.beginGallery())
            host.completeGallery(byteArrayOf(1, 2, 3))
            assertTrue(completed.await(5, TimeUnit.SECONDS))
            assertTrue(analyzerThread.get().startsWith("image-worker"))
            assertTrue(sinkThread.get().startsWith("image-worker"))
            assertTrue(callbackThread.get().startsWith("image-callback"))
            assertEquals(
                listOf("analyze", "store", "callback"),
                synchronized(sequence) { sequence.toList() },
            )
            assertEquals("android_scan", output.get()?.source?.kind)
            assertFalse(host.isRunning())
            assertEquals(1, port.discardCalls.get())
        } finally {
            host.close()
            scope.cancel()
            worker.close()
            callback.close()
        }
    }

    /**
     * The embedded camera hands its file over through the gallery import. The
     * analyzer must still know it is a guided camera still, because only those
     * are sized for the engine; found on the phone on 2026-09-18, when every
     * camera scan arrived as GALLERY and was read at full 12 MP.
     */
    @Test
    fun embeddedCameraStillReachesTheAnalyzerAsACameraImage() {
        val root = temporary.newFolder("embedded-camera")
        val scope = CoroutineScope(SupervisorJob())
        val completed = CountDownLatch(1)
        val seen = AtomicReference<ResultImageSource?>()
        val worker = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val callback = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val host = ResultImageAsyncHost(
            scope,
            ByteArrayPort(LocalResultImageStore(root)),
            ResultImageAnalyzer {
                seen.set(it.source)
                submission()
            },
            onState = { if (it is ResultImageAcquisitionState.Completed) completed.countDown() },
            onSubmission = {},
            submissionSink = ResultImageSubmissionSink {},
            workerDispatcher = worker,
            callbackDispatcher = callback,
        )
        try {
            assertTrue(host.beginEmbeddedCamera())
            host.completeEmbeddedCamera(byteArrayOf(7, 8, 9))
            assertTrue(completed.await(5, TimeUnit.SECONDS))
            assertEquals(ResultImageSource.CAMERA, seen.get())
        } finally {
            host.close()
            scope.cancel()
            worker.close()
            callback.close()
        }
    }

    @Test
    fun submissionSinkFailureIsBoundedAndPreventsUiCallback() {
        val root = temporary.newFolder("sink-failure")
        val port = ByteArrayPort(LocalResultImageStore(root))
        val scope = CoroutineScope(SupervisorJob())
        val state = AtomicReference<ResultImageAcquisitionState>()
        val outputCalls = AtomicInteger(0)
        val host = ResultImageAsyncHost(
            scope,
            port,
            ResultImageAnalyzer { submission() },
            onState = state::set,
            onSubmission = { outputCalls.incrementAndGet() },
            submissionSink = ResultImageSubmissionSink {
                error("private durable store detail")
            },
            workerDispatcher = Dispatchers.Unconfined,
            callbackDispatcher = Dispatchers.Unconfined,
        )

        try {
            assertTrue(host.beginGallery())
            host.completeGallery(byteArrayOf(1, 2, 3))
            assertEquals(
                ResultImageAcquisitionState.Failed(
                    ResultImageFailureCode.SUBMISSION_STORE_FAILURE,
                ),
                state.get(),
            )
            assertFalse(state.get().toString().contains("private durable store detail"))
            assertEquals(0, outputCalls.get())
            assertEquals(1, port.discardCalls.get())
            assertTrue(root.listFiles()?.isEmpty() == true)
        } finally {
            host.close()
            scope.cancel()
        }
    }

    @Test
    fun optionalCameraCancelDoesNotAnalyzeOrEmitSubmission() {
        val root = temporary.newFolder("async-camera")
        val port = ByteArrayPort(LocalResultImageStore(root))
        val scope = CoroutineScope(SupervisorJob())
        val state = AtomicReference<ResultImageAcquisitionState>()
        val analyzerCalls = AtomicInteger(0)
        val outputCalls = AtomicInteger(0)
        val host = ResultImageAsyncHost(
            scope,
            port,
            ResultImageAnalyzer {
                analyzerCalls.incrementAndGet()
                submission()
            },
            onState = state::set,
            onSubmission = { outputCalls.incrementAndGet() },
        )

        try {
            assertEquals("synthetic-camera-destination", host.beginCamera())
            assertFalse(host.beginGallery())
            host.completeCamera(success = false)

            assertEquals(
                ResultImageAcquisitionState.Cancelled(ResultImageSource.CAMERA),
                state.get(),
            )
            assertEquals(0, analyzerCalls.get())
            assertEquals(0, outputCalls.get())
            assertFalse(host.isRunning())
        } finally {
            host.close()
            scope.cancel()
        }
    }

    @Test
    fun analyzerFailureIsBoundedAndCloseDropsPendingCamera() {
        val root = temporary.newFolder("failure")
        val port = ByteArrayPort(LocalResultImageStore(root))
        val worker = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val callback = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val scope = CoroutineScope(SupervisorJob())
        val failed = CountDownLatch(1)
        val state = AtomicReference<ResultImageAcquisitionState>()
        val host = ResultImageAsyncHost(
            scope,
            port,
            ResultImageAnalyzer { error("private analyzer detail") },
            onState = {
                state.set(it)
                if (it is ResultImageAcquisitionState.Failed) failed.countDown()
            },
            onSubmission = {},
            workerDispatcher = worker,
            callbackDispatcher = callback,
        )

        try {
            assertTrue(host.beginGallery())
            host.completeGallery(byteArrayOf(1))
            assertTrue(failed.await(5, TimeUnit.SECONDS))
            assertEquals(
                ResultImageAcquisitionState.Failed(ResultImageFailureCode.ANALYZER_FAILURE),
                state.get(),
            )
            assertFalse(state.get().toString().contains("private analyzer detail"))

            assertEquals("synthetic-camera-destination", host.beginCamera())
            val pending = checkNotNull(port.lastPrepared.get())
            host.close()
            assertFalse(pending.exists())
            assertFalse(host.isRunning())
            assertEquals(null, host.beginCamera())
        } finally {
            host.close()
            scope.cancel()
            worker.close()
            callback.close()
        }
    }

    @Test
    fun unexpectedAcquisitionFailureUsesTheBoundedExecutionCode() {
        val scope = CoroutineScope(SupervisorJob())
        val failed = CountDownLatch(1)
        val state = AtomicReference<ResultImageAcquisitionState>()
        val port = object : ResultImageAcquisitionPort<String, String> {
            override fun importGallery(selection: String): AcquiredResultImage =
                error("private resolver failure")

            override fun prepareCamera(): PreparedCameraCapture<String> =
                error("not used")

            override fun completeCamera(
                prepared: PreparedCameraCapture<String>,
                success: Boolean,
            ): AcquiredResultImage? = error("not used")

            override fun discard(file: File) = Unit
        }
        val host = ResultImageAsyncHost(
            scope,
            port,
            ResultImageAnalyzer { submission() },
            onState = {
                state.set(it)
                if (it is ResultImageAcquisitionState.Failed) failed.countDown()
            },
            onSubmission = {},
            workerDispatcher = Dispatchers.Unconfined,
            callbackDispatcher = Dispatchers.Unconfined,
        )

        try {
            assertTrue(host.beginGallery())
            host.completeGallery("synthetic")
            assertTrue(failed.await(5, TimeUnit.SECONDS))
            assertEquals(
                ResultImageAcquisitionState.Failed(ResultImageFailureCode.EXECUTION_FAILURE),
                state.get(),
            )
            assertFalse(state.get().toString().contains("private resolver failure"))
        } finally {
            host.close()
            scope.cancel()
        }
    }

    private class ByteArrayPort(
        private val store: LocalResultImageStore,
    ) : ResultImageAcquisitionPort<ByteArray, String> {
        val discardCalls = AtomicInteger(0)
        val lastPrepared = AtomicReference<File?>()

        override fun importGallery(selection: ByteArray): AcquiredResultImage =
            store.importGallery { ByteArrayInputStream(selection) }

        override fun prepareCamera(): PreparedCameraCapture<String> {
            val file = store.prepareCameraFile()
            lastPrepared.set(file)
            return PreparedCameraCapture("synthetic-camera-destination", file)
        }

        override fun completeCamera(
            prepared: PreparedCameraCapture<String>,
            success: Boolean,
        ): AcquiredResultImage? {
            if (success) prepared.localFile.writeBytes(byteArrayOf(4, 5, 6))
            return store.completeCamera(prepared.localFile, success)
        }

        override fun discard(file: File) {
            discardCalls.incrementAndGet()
            store.discard(file)
        }
    }
}
