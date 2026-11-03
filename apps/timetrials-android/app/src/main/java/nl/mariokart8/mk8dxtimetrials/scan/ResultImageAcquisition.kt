package nl.mariokart8.mk8dxtimetrials.scan

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal const val RESULT_IMAGE_MAX_BYTES = 32 * 1024 * 1024
private const val RESULT_IMAGE_DIRECTORY = "mk8dx-result-images"

internal enum class ResultImageSource {
    GALLERY,
    CAMERA,
}

internal enum class ResultImageFailureCode {
    PREPARATION_FAILURE,
    READ_FAILURE,
    EMPTY_IMAGE,
    IMAGE_TOO_LARGE,
    ANALYZER_FAILURE,
    SUBMISSION_STORE_FAILURE,
    EXECUTION_FAILURE,
}

internal data class ResultImageAnalysisProgress(
    val phase: String,
    val fraction: Float,
    val stage: String,
    val completedStages: Int,
    val totalStages: Int,
    // Which frame of the burst is being read and how far into it, so the
    // progress panel can say "attempt 2/5 - 40%" rather than only moving a bar.
    val attemptIndex: Int = 0,
    val attemptCount: Int = 0,
    val framePercent: Int = 0,
    val identityOnly: Boolean = false,
    // A frame the reader had to work at: an earlier full read did not close on
    // the lap sum, so the burst is still going.
    val difficultFrame: Boolean = false,
) {
    init {
        require(phase.isNotBlank())
        require(fraction in 0f..1f)
        require(completedStages >= 0 && totalStages > 0 && completedStages <= totalStages)
        require(framePercent in 0..100)
    }

    companion object {
        val Starting = ResultImageAnalysisProgress("Finding card…", 0.02f, "00_InputImage", 0, 24)
    }
}

internal sealed interface ResultImageAcquisitionState {
    data object Ready : ResultImageAcquisitionState
    data object AwaitingGallery : ResultImageAcquisitionState
    data object AwaitingCamera : ResultImageAcquisitionState
    data class Analyzing(
        val source: ResultImageSource,
        val progress: ResultImageAnalysisProgress = ResultImageAnalysisProgress.Starting,
    ) : ResultImageAcquisitionState
    data class Completed(val source: ResultImageSource) : ResultImageAcquisitionState
    data class Cancelled(val source: ResultImageSource) : ResultImageAcquisitionState
    data class Failed(val code: ResultImageFailureCode) : ResultImageAcquisitionState
}

internal class ResultImageAcquisitionException(
    val code: ResultImageFailureCode,
) : RuntimeException("Result image acquisition failed.")

internal data class AcquiredResultImage(
    val source: ResultImageSource,
    val file: File,
    val byteCount: Long,
)

internal data class PreparedCameraCapture<Destination>(
    val destination: Destination,
    val localFile: File,
)

internal interface ResultImageAcquisitionPort<GallerySelection, CameraDestination> {
    fun importGallery(selection: GallerySelection): AcquiredResultImage
    fun prepareCamera(): PreparedCameraCapture<CameraDestination>
    fun completeCamera(
        prepared: PreparedCameraCapture<CameraDestination>,
        success: Boolean,
    ): AcquiredResultImage?
    fun discard(file: File)
}

internal fun interface ResultImageAnalyzer {
    fun analyze(image: AcquiredResultImage): AndroidScanTimeTrialSubmissionV1
}

internal interface ProgressiveResultImageAnalyzer : ResultImageAnalyzer {
    fun analyze(
        image: AcquiredResultImage,
        onProgress: (ResultImageAnalysisProgress) -> Unit,
    ): AndroidScanTimeTrialSubmissionV1

    override fun analyze(image: AcquiredResultImage): AndroidScanTimeTrialSubmissionV1 =
        analyze(image) {}
}

internal fun interface ResultImageSubmissionSink {
    fun store(submission: AndroidScanTimeTrialSubmissionV1)
}

internal class LocalResultImageStore(
    root: File,
    private val maximumBytes: Int = RESULT_IMAGE_MAX_BYTES,
) {
    private val root: File

    init {
        if (maximumBytes < 1) fail(ResultImageFailureCode.PREPARATION_FAILURE)
        try {
            val canonical = root.canonicalFile
            if ((!canonical.exists() && !canonical.mkdirs()) || !canonical.isDirectory) {
                fail(ResultImageFailureCode.PREPARATION_FAILURE)
            }
            this.root = canonical
        } catch (error: ResultImageAcquisitionException) {
            throw error
        } catch (_: Exception) {
            fail(ResultImageFailureCode.PREPARATION_FAILURE)
        }
    }

    fun importGallery(openInput: () -> InputStream): AcquiredResultImage {
        val temporary = newFile(".gallery-", ".tmp")
        val completed = File(root, "gallery-${token()}.image")
        try {
            val byteCount = writeBounded(temporary, openInput)
            if (!temporary.renameTo(completed)) fail(ResultImageFailureCode.READ_FAILURE)
            return AcquiredResultImage(ResultImageSource.GALLERY, completed, byteCount)
        } catch (error: ResultImageAcquisitionException) {
            throw error
        } catch (_: Exception) {
            fail(ResultImageFailureCode.READ_FAILURE)
        } finally {
            temporary.delete()
        }
    }

    fun prepareCameraFile(): File = newFile("camera-", ".jpg")

    fun completeCamera(file: File, success: Boolean): AcquiredResultImage? {
        requireOwnedFile(file)
        if (!success) {
            file.delete()
            return null
        }
        val length = file.length()
        when {
            length < 1 -> {
                file.delete()
                fail(ResultImageFailureCode.EMPTY_IMAGE)
            }
            length > maximumBytes -> {
                file.delete()
                fail(ResultImageFailureCode.IMAGE_TOO_LARGE)
            }
        }
        return AcquiredResultImage(ResultImageSource.CAMERA, file, length)
    }

    fun discard(file: File) {
        try {
            if (file.canonicalFile.parentFile == root) file.delete()
        } catch (_: Exception) {
            // Best-effort cleanup of ephemeral acquisition input.
        }
    }

    private fun writeBounded(file: File, openInput: () -> InputStream): Long {
        var count = 0L
        try {
            openInput().use { input ->
                FileOutputStream(file).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        if (read == 0) continue
                        count += read
                        if (count > maximumBytes) fail(ResultImageFailureCode.IMAGE_TOO_LARGE)
                        output.write(buffer, 0, read)
                    }
                    if (count == 0L) fail(ResultImageFailureCode.EMPTY_IMAGE)
                    output.flush()
                    output.fd.sync()
                }
            }
        } catch (error: ResultImageAcquisitionException) {
            throw error
        } catch (_: Exception) {
            fail(ResultImageFailureCode.READ_FAILURE)
        }
        return count
    }

    private fun newFile(prefix: String, suffix: String): File {
        repeat(10) {
            val candidate = File(root, "$prefix${token()}$suffix")
            try {
                if (candidate.createNewFile()) return candidate
            } catch (_: Exception) {
                fail(ResultImageFailureCode.PREPARATION_FAILURE)
            }
        }
        fail(ResultImageFailureCode.PREPARATION_FAILURE)
    }

    private fun requireOwnedFile(file: File) {
        try {
            if (file.canonicalFile.parentFile != root || !file.isFile) {
                fail(ResultImageFailureCode.PREPARATION_FAILURE)
            }
        } catch (error: ResultImageAcquisitionException) {
            throw error
        } catch (_: Exception) {
            fail(ResultImageFailureCode.PREPARATION_FAILURE)
        }
    }

    private fun token(): String = UUID.randomUUID().toString().replace("-", "")
}

internal class AndroidResultImageAcquisitionPort(
    context: Context,
    sessionRoot: File = File(context.cacheDir, "$RESULT_IMAGE_DIRECTORY/sessions"),
    maximumBytes: Int = RESULT_IMAGE_MAX_BYTES,
) : ResultImageAcquisitionPort<Uri, Uri> {
    private val applicationContext = context.applicationContext
    private val store: LocalResultImageStore
    private val authority = "${context.packageName}.result-image-provider"

    init {
        val allowedRoot = File(context.cacheDir, RESULT_IMAGE_DIRECTORY).canonicalFile
        val candidate = sessionRoot.canonicalFile
        if (candidate != allowedRoot && candidate.parentFile != allowedRoot) {
            fail(ResultImageFailureCode.PREPARATION_FAILURE)
        }
        store = LocalResultImageStore(candidate, maximumBytes)
    }

    override fun importGallery(selection: Uri): AcquiredResultImage =
        store.importGallery {
            applicationContext.contentResolver.openInputStream(selection)
                ?: fail(ResultImageFailureCode.READ_FAILURE)
        }

    override fun prepareCamera(): PreparedCameraCapture<Uri> {
        val file = store.prepareCameraFile()
        try {
            return PreparedCameraCapture(
                FileProvider.getUriForFile(applicationContext, authority, file),
                file,
            )
        } catch (_: Exception) {
            store.discard(file)
            fail(ResultImageFailureCode.PREPARATION_FAILURE)
        }
    }

    override fun completeCamera(
        prepared: PreparedCameraCapture<Uri>,
        success: Boolean,
    ): AcquiredResultImage? = store.completeCamera(prepared.localFile, success)

    override fun discard(file: File) = store.discard(file)
}

internal class ResultImageAsyncHost<GallerySelection, CameraDestination>(
    parentScope: CoroutineScope,
    private val acquisition: ResultImageAcquisitionPort<GallerySelection, CameraDestination>,
    private val analyzer: ResultImageAnalyzer,
    private val onState: (ResultImageAcquisitionState) -> Unit,
    private val onSubmission: (AndroidScanTimeTrialSubmissionV1) -> Unit,
    private val onPreview: (AcquiredResultImage) -> Unit = {},
    private val submissionSink: ResultImageSubmissionSink = ResultImageSubmissionSink {},
    private val workerDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val callbackDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) : AutoCloseable {
    private val lock = Any()
    private val lifecycleJob = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + lifecycleJob)
    private val tokenSequence = AtomicLong(0)
    private var activeToken: Long? = null
    private var pendingCamera: PreparedCameraCapture<CameraDestination>? = null
    private var closed = false

    fun beginGallery(): Boolean {
        val token = begin() ?: return false
        emitIfCurrent(token, ResultImageAcquisitionState.AwaitingGallery)
        return true
    }

    fun completeGallery(selection: GallerySelection?) {
        val token = synchronized(lock) {
            activeToken?.takeIf { pendingCamera == null } ?: return
        }
        if (selection == null) {
            finish(token, ResultImageAcquisitionState.Cancelled(ResultImageSource.GALLERY))
            return
        }
        analyze(token, ResultImageSource.GALLERY) { acquisition.importGallery(selection) }
    }

    /** Imports an image captured by the embedded CameraX surface. */
    fun beginEmbeddedCamera(): Boolean {
        val token = begin() ?: return false
        emitIfCurrent(token, ResultImageAcquisitionState.AwaitingCamera)
        return true
    }

    fun completeEmbeddedCamera(selection: GallerySelection?) {
        val token = synchronized(lock) {
            activeToken?.takeIf { pendingCamera == null } ?: return
        }
        if (selection == null) {
            finish(token, ResultImageAcquisitionState.Cancelled(ResultImageSource.CAMERA))
            return
        }
        // The embedded camera's file arrives through the gallery import, which
        // stamps it GALLERY; it is a guided camera still, and the decoder sizes
        // those for the engine (CAMERA_STILL_LONG_SIDE), so say so.
        analyze(token, ResultImageSource.CAMERA) {
            acquisition.importGallery(selection).copy(source = ResultImageSource.CAMERA)
        }
    }

    fun beginCamera(): CameraDestination? {
        val token = begin() ?: return null
        val prepared = try {
            acquisition.prepareCamera()
        } catch (_: Exception) {
            finish(token, ResultImageAcquisitionState.Failed(ResultImageFailureCode.PREPARATION_FAILURE))
            return null
        }
        synchronized(lock) {
            if (!acceptsLocked(token)) {
                acquisition.discard(prepared.localFile)
                return null
            }
            pendingCamera = prepared
        }
        emitIfCurrent(token, ResultImageAcquisitionState.AwaitingCamera)
        return prepared.destination
    }

    fun completeCamera(success: Boolean) {
        val pair = synchronized(lock) {
            val token = activeToken ?: return
            val prepared = pendingCamera ?: return
            pendingCamera = null
            token to prepared
        }
        if (!success) {
            try {
                acquisition.completeCamera(pair.second, false)
                finish(pair.first, ResultImageAcquisitionState.Cancelled(ResultImageSource.CAMERA))
            } catch (error: ResultImageAcquisitionException) {
                finish(pair.first, ResultImageAcquisitionState.Failed(error.code))
            } catch (_: Exception) {
                finish(
                    pair.first,
                    ResultImageAcquisitionState.Failed(ResultImageFailureCode.EXECUTION_FAILURE),
                )
            }
            return
        }
        analyze(pair.first, ResultImageSource.CAMERA) {
            acquisition.completeCamera(pair.second, true)
                ?: fail(ResultImageFailureCode.READ_FAILURE)
        }
    }

    fun isRunning(): Boolean = synchronized(lock) { activeToken != null }

    override fun close() {
        val camera = synchronized(lock) {
            if (closed) return
            closed = true
            activeToken = null
            pendingCamera.also { pendingCamera = null }
        }
        camera?.let { acquisition.discard(it.localFile) }
        lifecycleJob.cancel()
    }

    private fun analyze(
        token: Long,
        source: ResultImageSource,
        acquire: () -> AcquiredResultImage,
    ) {
        emitIfCurrent(token, ResultImageAcquisitionState.Analyzing(source))
        scope.launch(workerDispatcher) {
            var image: AcquiredResultImage? = null
            try {
                image = try {
                    acquire()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: ResultImageAcquisitionException) {
                    throw error
                } catch (_: Exception) {
                    fail(ResultImageFailureCode.EXECUTION_FAILURE)
                }
                onPreview(image)
                val submission = try {
                    if (analyzer is ProgressiveResultImageAnalyzer) {
                        analyzer.analyze(image) { progress ->
                            scope.launch(callbackDispatcher) {
                                if (accepts(token)) {
                                    onState(ResultImageAcquisitionState.Analyzing(source, progress))
                                }
                            }
                        }
                    } else {
                        analyzer.analyze(image)
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    fail(ResultImageFailureCode.ANALYZER_FAILURE)
                }
                try {
                    submissionSink.store(submission)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    fail(ResultImageFailureCode.SUBMISSION_STORE_FAILURE)
                }
                acquisition.discard(image.file)
                image = null
                withContext(callbackDispatcher) {
                    if (accepts(token)) {
                        onSubmission(submission)
                        finish(token, ResultImageAcquisitionState.Completed(source))
                    }
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: ResultImageAcquisitionException) {
                withContext(callbackDispatcher) {
                    finish(token, ResultImageAcquisitionState.Failed(error.code))
                }
            } catch (_: Exception) {
                withContext(callbackDispatcher) {
                    finish(token, ResultImageAcquisitionState.Failed(ResultImageFailureCode.EXECUTION_FAILURE))
                }
            } finally {
                image?.let { acquisition.discard(it.file) }
            }
        }
    }

    private fun begin(): Long? = synchronized(lock) {
        if (closed || activeToken != null) return null
        tokenSequence.incrementAndGet().also { activeToken = it }
    }

    private fun finish(token: Long, state: ResultImageAcquisitionState) {
        val deliver = synchronized(lock) {
            if (!acceptsLocked(token)) return
            activeToken = null
            true
        }
        if (deliver) onState(state)
    }

    private fun emitIfCurrent(token: Long, state: ResultImageAcquisitionState) {
        if (accepts(token)) onState(state)
    }

    private fun accepts(token: Long): Boolean = synchronized(lock) { acceptsLocked(token) }

    private fun acceptsLocked(token: Long): Boolean = !closed && activeToken == token
}

private fun fail(code: ResultImageFailureCode): Nothing =
    throw ResultImageAcquisitionException(code)
