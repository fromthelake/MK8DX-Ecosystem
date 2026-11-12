package nl.mariokart8.mk8dxtimetrials.outbox

import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal const val LOCAL_OUTBOX_ENTRY_SCHEMA_VERSION =
    "mk8dx.local-time-trial-outbox-entry.v1"
internal const val LOCAL_OUTBOX_ENTRY_OWNER_SCHEMA_VERSION =
    "mk8dx.local-outbox-entry-owner.v1"
internal const val LOCAL_OUTBOX_STATE_SCHEMA_VERSION =
    "mk8dx.local-time-trial-outbox-state.v1"
internal const val LOCAL_PRIVATE_EVIDENCE_SCHEMA_VERSION =
    "mk8dx.local-private-evidence.v1"
internal const val TIME_TRIAL_SUBMISSION_SCHEMA_VERSION =
    "mk8dx.time-trial-submission.v1"
internal const val LOCAL_OUTBOX_MAX_SUBMISSION_BYTES = 64 * 1024
internal const val LOCAL_OUTBOX_MAX_PRIVATE_EVIDENCE_BYTES = 1024 * 1024
internal const val LOCAL_OUTBOX_MAX_STATE_REVISIONS = 10_000

private const val MAX_TIMESTAMP_MS = 253_402_300_799_999L
private const val MAX_STATE_DOCUMENT_BYTES = 4 * 1024
private const val MAX_MANIFEST_BYTES = 4 * 1024
private const val MAX_OWNER_DOCUMENT_BYTES = 4 * 1024
private val entryKeyPattern = Regex("^[0-9a-f]{64}$")
private val stateFilePattern = Regex("^[0-9]{10}\\.json$")
private val failureCodePattern = Regex("^[a-z0-9]+(?:[._-][a-z0-9]+)*$")

internal open class AndroidLocalOutboxException(message: String) : RuntimeException(message)

internal class AndroidLocalOutboxValidationException(message: String) :
    AndroidLocalOutboxException(message)

internal class AndroidLocalOutboxConflictException(message: String) :
    AndroidLocalOutboxException(message)

internal class AndroidLocalOutboxNotFoundException(message: String) :
    AndroidLocalOutboxException(message)

internal class AndroidLocalOutboxIoException(message: String) :
    AndroidLocalOutboxException(message)

internal fun interface AndroidCanonicalSubmissionValidator {
    fun validate(submission: JsonObject)
}

internal fun interface AndroidExclusiveFileInstaller {
    fun install(temporary: File, target: File)
}

internal fun interface AndroidDirectorySync {
    fun sync(directory: File)
}

internal object AndroidLockedRenameExclusiveFileInstaller : AndroidExclusiveFileInstaller {
    private val processLocks = Array(64) { ReentrantLock() }

    override fun install(temporary: File, target: File) {
        val parent = target.parentFile
            ?: throw AndroidLocalOutboxIoException("Local outbox write failed.")
        val lockFile = File(parent, ".state-${target.name}.lock")
        try {
            val index = (target.absolutePath.hashCode() and Int.MAX_VALUE) % processLocks.size
            processLocks[index].withLock {
                RandomAccessFile(lockFile, "rw").use { randomAccess ->
                    randomAccess.channel.use { channel ->
                        channel.lock().use {
                            if (target.exists()) {
                                throw AndroidLocalOutboxConflictException(
                                    "Local outbox entry already exists.",
                                )
                            }
                            if (!temporary.renameTo(target)) {
                                if (target.exists()) {
                                    throw AndroidLocalOutboxConflictException(
                                        "Local outbox entry already exists.",
                                    )
                                }
                                throw AndroidLocalOutboxIoException("Local outbox write failed.")
                            }
                        }
                    }
                }
            }
        } catch (error: AndroidLocalOutboxException) {
            throw error
        } catch (_: Exception) {
            throw AndroidLocalOutboxIoException("Local outbox write failed.")
        }
    }
}

internal object AndroidOsDirectorySync : AndroidDirectorySync {
    override fun sync(directory: File) {
        try {
            val descriptor = Os.open(
                directory.absolutePath,
                OsConstants.O_RDONLY,
                0,
            )
            try {
                Os.fsync(descriptor)
            } finally {
                Os.close(descriptor)
            }
        } catch (_: Exception) {
            // Directory fsync is best-effort on filesystems which do not expose it.
        }
    }
}

@Serializable
internal data class AndroidLocalOutboxEntryV1(
    val schemaVersion: String = LOCAL_OUTBOX_ENTRY_SCHEMA_VERSION,
    val entryKey: String,
    val submissionSha256: String,
    val createdAtMs: Long,
    val privateEvidencePresent: Boolean,
)

@Serializable
internal data class AndroidLocalOutboxStateV1(
    val schemaVersion: String = LOCAL_OUTBOX_STATE_SCHEMA_VERSION,
    val entryKey: String,
    val stateRevision: Long,
    val state: String,
    val attemptCount: Long,
    val updatedAtMs: Long,
    val lastAttemptAtMs: Long? = null,
    val failureCode: String? = null,
    val syncedAtMs: Long? = null,
    /** The site's answer at delivery (personal best, rank, players passed). */
    val feedback: JsonObject? = null,
)

@Serializable
internal data class AndroidLocalOutboxPlayerReferenceV1(
    val namespace: String,
    val value: String,
)

/**
 * Immutable sidecar recorded next to the closed `entry.json` schema. It binds the
 * entry to the account that produced it so a shared device can never deliver one
 * person's result with another person's credentials. Nothing rewrites it.
 */
@Serializable
internal data class AndroidLocalOutboxEntryOwnerV1(
    val schemaVersion: String = LOCAL_OUTBOX_ENTRY_OWNER_SCHEMA_VERSION,
    val slotId: String? = null,
    val playerReference: AndroidLocalOutboxPlayerReferenceV1,
    val createdAtMs: Long,
)

@Serializable
internal data class AndroidLocalPrivateEvidenceV1(
    val schemaVersion: String = LOCAL_PRIVATE_EVIDENCE_SCHEMA_VERSION,
    val entryKey: String,
    val createdAtMs: Long,
    val privateEvidence: JsonObject,
)

internal data class AndroidLocalOutboxRecord(
    val entry: AndroidLocalOutboxEntryV1,
    val canonicalSubmission: JsonObject,
    val state: AndroidLocalOutboxStateV1,
    val owner: AndroidLocalOutboxEntryOwnerV1? = null,
)

internal data class AndroidCanonicalSubmissionPayload(
    val submissionId: String,
    val revision: Int,
    val json: String,
)

internal interface AndroidCanonicalOutboxDeliveryPort {
    fun read(entryKey: String): AndroidLocalOutboxRecord

    fun markFailed(
        entryKey: String,
        expectedStateRevision: Long,
        attemptedAtMs: Long,
        failureCode: String,
    ): AndroidLocalOutboxRecord

    fun markSynced(
        entryKey: String,
        expectedStateRevision: Long,
        attemptedAtMs: Long,
        feedback: JsonObject? = null,
    ): AndroidLocalOutboxRecord
}

internal interface AndroidCanonicalOutboxSynchronizationPort {
    fun read(entryKey: String): AndroidLocalOutboxRecord

    fun requestRetry(
        entryKey: String,
        expectedStateRevision: Long,
        requestedAtMs: Long,
    ): AndroidLocalOutboxRecord
}

private val outboxJson = Json {
    encodeDefaults = true
    explicitNulls = false
    ignoreUnknownKeys = false
}

// The owner sidecar keeps an explicit null slotId (signed-out entries) and stays
// tolerant on read so a future field never costs an entry its owner.
private val ownerJson = Json {
    encodeDefaults = true
    explicitNulls = true
    ignoreUnknownKeys = true
}

private fun submissionPlayerReference(
    submission: JsonObject,
): AndroidLocalOutboxPlayerReferenceV1? {
    val reference = submission["playerReference"] as? JsonObject ?: return null
    val namespace = reference.stringValue("namespace") ?: return null
    val value = reference.stringValue("value") ?: return null
    return AndroidLocalOutboxPlayerReferenceV1(namespace, value)
        .takeIf(::isValidAndroidOutboxPlayerReference)
}

private fun validOwner(owner: AndroidLocalOutboxEntryOwnerV1): Boolean =
    owner.schemaVersion == LOCAL_OUTBOX_ENTRY_OWNER_SCHEMA_VERSION &&
        (owner.slotId == null || owner.slotId.matches(androidOutboxOwningSlotIdPattern)) &&
        isValidAndroidOutboxPlayerReference(owner.playerReference) &&
        owner.createdAtMs in 0..MAX_TIMESTAMP_MS

internal fun androidLocalOutboxEntryKey(submissionId: String, revision: Int): String {
    if (submissionId.isEmpty() || revision < 1) {
        throw AndroidLocalOutboxValidationException("Local outbox input is invalid.")
    }
    return sha256(
        submissionId.toByteArray(Charsets.UTF_8) +
            byteArrayOf(0) +
            revision.toString().toByteArray(Charsets.US_ASCII),
    )
}

internal class AndroidLocalTimeTrialOutbox(
    canonicalRoot: File,
    privateEvidenceRoot: File,
    private val validateSubmission: AndroidCanonicalSubmissionValidator,
    private val exclusiveFileInstaller: AndroidExclusiveFileInstaller =
        AndroidLockedRenameExclusiveFileInstaller,
    private val directorySync: AndroidDirectorySync = AndroidOsDirectorySync,
) : AndroidCanonicalOutboxSynchronizationSelectionPort {
    private val canonicalRoot: File
    private val privateEvidenceRoot: File

    init {
        try {
            val canonical = canonicalRoot.canonicalFile
            val privateRoot = privateEvidenceRoot.canonicalFile
            if (sameOrNested(canonical, privateRoot) || sameOrNested(privateRoot, canonical)) {
                invalidConfiguration()
            }
            if ((!canonical.exists() && !canonical.mkdirs()) || !canonical.isDirectory) {
                invalidConfiguration()
            }
            if ((!privateRoot.exists() && !privateRoot.mkdirs()) || !privateRoot.isDirectory) {
                invalidConfiguration()
            }
            this.canonicalRoot = canonical.canonicalFile
            this.privateEvidenceRoot = privateRoot.canonicalFile
        } catch (error: AndroidLocalOutboxException) {
            throw error
        } catch (_: Exception) {
            invalidConfiguration()
        }
    }

    fun create(
        payload: AndroidCanonicalSubmissionPayload,
        createdAtMs: Long,
        privateEvidence: JsonObject? = null,
        owningSlotId: String? = null,
    ): AndroidLocalOutboxRecord {
        if (
            owningSlotId != null &&
            !owningSlotId.matches(androidOutboxOwningSlotIdPattern)
        ) {
            invalidInput()
        }
        validTimestamp(createdAtMs, input = true)
        val submissionBytes = payload.json.toByteArray(Charsets.UTF_8)
        if (submissionBytes.isEmpty() || submissionBytes.size > LOCAL_OUTBOX_MAX_SUBMISSION_BYTES) {
            invalidInput()
        }
        val submission = parseObject(submissionBytes, input = true)
        if (
            submission.stringValue("schemaVersion") !=
            TIME_TRIAL_SUBMISSION_SCHEMA_VERSION ||
            submission.stringValue("submissionId") != payload.submissionId ||
            submission.integerValue("revision") != payload.revision.toLong()
        ) {
            invalidInput()
        }
        try {
            validateSubmission.validate(submission)
        } catch (error: AndroidLocalOutboxException) {
            throw error
        } catch (_: Exception) {
            invalidInput()
        }

        val entryKey = androidLocalOutboxEntryKey(payload.submissionId, payload.revision)
        val target = File(canonicalRoot, entryKey)
        val evidenceTarget = File(privateEvidenceRoot, "$entryKey.json")
        if (target.exists()) conflict()

        val evidenceBytes = privateEvidence?.let { evidence ->
            if (evidence.size > 64) invalidInput()
            encodeInputDocument(
                AndroidLocalPrivateEvidenceV1(
                    entryKey = entryKey,
                    createdAtMs = createdAtMs,
                    privateEvidence = evidence,
                ),
            ).also {
                if (it.size > LOCAL_OUTBOX_MAX_PRIVATE_EVIDENCE_BYTES) invalidInput()
            }
        }
        if (evidenceBytes == null && evidenceTarget.exists()) conflict()

        val entry = AndroidLocalOutboxEntryV1(
            entryKey = entryKey,
            submissionSha256 = sha256(submissionBytes),
            createdAtMs = createdAtMs,
            privateEvidencePresent = evidenceBytes != null,
        )
        val initialState = AndroidLocalOutboxStateV1(
            entryKey = entryKey,
            stateRevision = 1,
            state = "pending",
            attemptCount = 0,
            updatedAtMs = createdAtMs,
        )
        val owner = AndroidLocalOutboxEntryOwnerV1(
            slotId = owningSlotId,
            playerReference = submissionPlayerReference(submission) ?: invalidInput(),
            createdAtMs = createdAtMs,
        )

        var evidenceCreated = false
        var temporaryDirectory: File? = null
        var published = false
        try {
            if (evidenceBytes != null) {
                installExclusive(evidenceTarget, evidenceBytes)
                evidenceCreated = true
            }
            temporaryDirectory = newTemporaryEntryDirectory()
            val states = File(temporaryDirectory, "states")
            if (!states.mkdir()) writeFailed()
            writeNew(File(temporaryDirectory, "entry.json"), encodeDocument(entry))
            writeNew(File(temporaryDirectory, "owner.json"), encodeOwnerDocument(owner))
            writeNew(File(temporaryDirectory, "submission.json"), submissionBytes)
            writeNew(File(states, "0000000001.json"), encodeDocument(initialState))
            directorySync.sync(states)
            directorySync.sync(temporaryDirectory)
            if (!temporaryDirectory.renameTo(target)) {
                if (target.exists()) conflict() else writeFailed()
            }
            published = true
            directorySync.sync(canonicalRoot)
        } finally {
            if (!published) temporaryDirectory?.deleteRecursively()
            if (evidenceCreated && !published) {
                evidenceTarget.delete()
                directorySync.sync(privateEvidenceRoot)
            }
        }
        return read(entryKey)
    }

    override fun read(entryKey: String): AndroidLocalOutboxRecord {
        requireEntryKey(entryKey)
        val entryDirectory = File(canonicalRoot, entryKey)
        if (!entryDirectory.exists()) {
            throw AndroidLocalOutboxNotFoundException("Local outbox entry was not found.")
        }
        requireDirectDirectory(entryDirectory)
        val manifestObject = parseObject(readRegular(File(entryDirectory, "entry.json"), MAX_MANIFEST_BYTES))
        requireExactKeys(
            manifestObject,
            setOf(
                "schemaVersion",
                "entryKey",
                "submissionSha256",
                "createdAtMs",
                "privateEvidencePresent",
            ),
        )
        val manifest = decode<AndroidLocalOutboxEntryV1>(manifestObject)
        validateManifest(manifest, entryKey)

        val submissionBytes = readRegular(
            File(entryDirectory, "submission.json"),
            LOCAL_OUTBOX_MAX_SUBMISSION_BYTES,
        )
        if (sha256(submissionBytes) != manifest.submissionSha256) invalidData()
        val submission = parseObject(submissionBytes)
        try {
            validateSubmission.validate(submission)
        } catch (_: Exception) {
            invalidData()
        }
        val submissionId = submission.stringValue("submissionId") ?: invalidData()
        val revisionValue = submission.integerValue("revision") ?: invalidData()
        if (revisionValue !in 1..Int.MAX_VALUE.toLong()) invalidData()
        val revision = revisionValue.toInt()
        if (
            submission.stringValue("schemaVersion") !=
            TIME_TRIAL_SUBMISSION_SCHEMA_VERSION ||
            androidLocalOutboxEntryKey(submissionId, revision) != entryKey
        ) {
            invalidData()
        }

        val evidencePresent = File(privateEvidenceRoot, "$entryKey.json").exists()
        if (evidencePresent != manifest.privateEvidencePresent) invalidData()
        val states = readStates(entryDirectory, entryKey, manifest.createdAtMs)
        return AndroidLocalOutboxRecord(
            manifest,
            submission,
            states.last(),
            readOwner(entryDirectory),
        )
    }

    /**
     * Entries written before owner binding existed have no sidecar. They stay
     * readable with an unknown owner rather than becoming undeliverable garbage.
     */
    private fun readOwner(entryDirectory: File): AndroidLocalOutboxEntryOwnerV1? = try {
        val file = File(entryDirectory, "owner.json")
        if (!file.isFile) {
            null
        } else {
            ownerJson.decodeFromString<AndroidLocalOutboxEntryOwnerV1>(
                readRegular(file, MAX_OWNER_DOCUMENT_BYTES).toString(Charsets.UTF_8),
            ).takeIf(::validOwner)
        }
    } catch (_: Exception) {
        null
    }

    fun readPrivateEvidence(entryKey: String): AndroidLocalPrivateEvidenceV1 {
        val record = read(entryKey)
        if (!record.entry.privateEvidencePresent) {
            throw AndroidLocalOutboxNotFoundException("Local private evidence was not found.")
        }
        val objectValue = parseObject(
            readRegular(
                File(privateEvidenceRoot, "$entryKey.json"),
                LOCAL_OUTBOX_MAX_PRIVATE_EVIDENCE_BYTES,
            ),
        )
        requireExactKeys(
            objectValue,
            setOf("schemaVersion", "entryKey", "createdAtMs", "privateEvidence"),
        )
        val evidence = decode<AndroidLocalPrivateEvidenceV1>(objectValue)
        if (
            evidence.schemaVersion != LOCAL_PRIVATE_EVIDENCE_SCHEMA_VERSION ||
            evidence.entryKey != entryKey ||
            evidence.createdAtMs != record.entry.createdAtMs ||
            evidence.privateEvidence.size > 64
        ) {
            invalidData()
        }
        return evidence
    }

    /**
     * ADR-0225: removes a carried copy that the receiving community refused for good, and nothing else. Every
     * other entry - an original, a run that failed for another reason, a pending copy - is left alone.
     */
    fun discardRefusedCarried(entryKey: String): Boolean {
        val record = read(entryKey)
        if (
            record.state.state != "failed" ||
            record.state.failureCode !in ANDROID_CARRIED_REFUSAL_FAILURES ||
            record.canonicalSubmission["carriedFrom"] !is JsonObject
        ) {
            return false
        }
        // Moved aside first: a half-deleted directory under its own name would read as a damaged entry.
        val discarded = File(canonicalRoot, ".entry-discard-$entryKey")
        if (!File(canonicalRoot, entryKey).renameTo(discarded)) return false
        discarded.deleteRecursively()
        File(privateEvidenceRoot, "$entryKey.json").delete()
        directorySync.sync(canonicalRoot)
        return true
    }

    fun list(state: String? = null): List<AndroidLocalOutboxRecord> {
        if (state != null && state !in setOf("pending", "failed", "synced")) invalidInput()
        return listedEntryDirectories().mapNotNull { child ->
            read(child.name).takeIf { state == null || it.state.state == state }
        }
    }

    override fun listIndex(): List<AndroidCanonicalOutboxIndexRecord> {
        val children = listedEntryDirectories()
        if (children.size > ANDROID_OUTBOX_INDEX_MAX_ENTRIES) invalidData()
        return children.map { child ->
            val record = read(child.name)
            AndroidCanonicalOutboxIndexRecord(
                entryKeyHash = record.entry.entryKey,
                createdAtMs = record.entry.createdAtMs,
                storedState = when (record.state.state) {
                    "pending" -> AndroidOutboxStoredState.PENDING
                    "failed" -> AndroidOutboxStoredState.FAILED
                    "synced" -> AndroidOutboxStoredState.SYNCED
                    else -> invalidData()
                },
                stateRevision = record.state.stateRevision,
                attemptCount = record.state.attemptCount,
                failureCode = record.state.failureCode,
                owningSlotId = record.owner?.slotId,
                playerReference = record.owner?.playerReference
                    ?: submissionPlayerReference(record.canonicalSubmission),
                isTestResult = (record.canonicalSubmission["source"] as? JsonObject)
                    ?.stringValue("kind") == "android_scan_test",
                carriedOutcome = record.state.feedback
                    ?.takeIf { record.state.state == "synced" }
                    ?.let(::androidCarriedOutcomeOrNull),
            )
        }
    }

    override fun markFailed(
        entryKey: String,
        expectedStateRevision: Long,
        attemptedAtMs: Long,
        failureCode: String,
    ): AndroidLocalOutboxRecord {
        if (failureCode.length !in 1..64 || !failureCode.matches(failureCodePattern)) {
            invalidInput()
        }
        return transition(entryKey, expectedStateRevision, attemptedAtMs, "failed", failureCode)
    }

    override fun requestRetry(
        entryKey: String,
        expectedStateRevision: Long,
        requestedAtMs: Long,
    ): AndroidLocalOutboxRecord =
        transition(entryKey, expectedStateRevision, requestedAtMs, "pending", null)

    override fun markSynced(
        entryKey: String,
        expectedStateRevision: Long,
        attemptedAtMs: Long,
        feedback: JsonObject?,
    ): AndroidLocalOutboxRecord =
        transition(entryKey, expectedStateRevision, attemptedAtMs, "synced", null, feedback)

    private fun transition(
        entryKey: String,
        expectedStateRevision: Long,
        updatedAtMs: Long,
        targetState: String,
        failureCode: String?,
        feedback: JsonObject? = null,
    ): AndroidLocalOutboxRecord {
        if (expectedStateRevision < 1) invalidInput()
        validTimestamp(updatedAtMs, input = true)
        val current = read(entryKey).state
        if (current.stateRevision != expectedStateRevision) {
            throw AndroidLocalOutboxConflictException("Local outbox state changed.")
        }
        if (updatedAtMs < current.updatedAtMs) invalidInput()
        val nextRevision = expectedStateRevision + 1
        if (nextRevision > LOCAL_OUTBOX_MAX_STATE_REVISIONS) {
            throw AndroidLocalOutboxValidationException("Local outbox state limit was reached.")
        }
        val next = when {
            current.state == "pending" && targetState == "failed" ->
                AndroidLocalOutboxStateV1(
                    entryKey = entryKey,
                    stateRevision = nextRevision,
                    state = "failed",
                    attemptCount = current.attemptCount + 1,
                    updatedAtMs = updatedAtMs,
                    lastAttemptAtMs = updatedAtMs,
                    failureCode = failureCode ?: invalidInput(),
                )
            current.state == "pending" && targetState == "synced" ->
                AndroidLocalOutboxStateV1(
                    entryKey = entryKey,
                    stateRevision = nextRevision,
                    state = "synced",
                    attemptCount = current.attemptCount + 1,
                    updatedAtMs = updatedAtMs,
                    lastAttemptAtMs = updatedAtMs,
                    syncedAtMs = updatedAtMs,
                    feedback = feedback,
                )
            current.state == "failed" && targetState == "pending" ->
                AndroidLocalOutboxStateV1(
                    entryKey = entryKey,
                    stateRevision = nextRevision,
                    state = "pending",
                    attemptCount = current.attemptCount,
                    updatedAtMs = updatedAtMs,
                )
            else -> throw AndroidLocalOutboxValidationException(
                "Local outbox transition is invalid.",
            )
        }
        val states = File(File(canonicalRoot, entryKey), "states")
        requireDirectDirectory(states)
        installExclusive(File(states, stateFileName(nextRevision)), encodeDocument(next))
        return read(entryKey)
    }

    private fun readStates(
        entryDirectory: File,
        entryKey: String,
        createdAtMs: Long,
    ): List<AndroidLocalOutboxStateV1> {
        val stateDirectory = File(entryDirectory, "states")
        requireDirectDirectory(stateDirectory)
        val files = stateDirectory.listFiles()?.sortedBy { it.name } ?: readFailed()
        val visible = files.filterNot {
            it.name.startsWith(".state-") || it.name.endsWith(".tmp")
        }
        if (
            visible.isEmpty() ||
            visible.size > LOCAL_OUTBOX_MAX_STATE_REVISIONS ||
            visible.any { !it.name.matches(stateFilePattern) }
        ) {
            invalidData()
        }
        val states = visible.mapIndexed { index, file ->
            val revision = index + 1L
            if (file.name != stateFileName(revision)) invalidData()
            val objectValue = parseObject(readRegular(file, MAX_STATE_DOCUMENT_BYTES))
            val stateName = objectValue.stringValue("state") ?: invalidData()
            val optional = when (stateName) {
                "pending" -> emptySet()
                "failed" -> setOf("lastAttemptAtMs", "failureCode")
                "synced" -> setOf("lastAttemptAtMs", "syncedAtMs")
                else -> invalidData()
            }
            // The site's feedback rides on a synced state when the build that
            // delivered it asked for one; states written before that have none.
            val present = if (stateName == "synced") setOf("feedback") else emptySet()
            requireExactKeys(
                JsonObject(objectValue - present),
                setOf(
                    "schemaVersion",
                    "entryKey",
                    "stateRevision",
                    "state",
                    "attemptCount",
                    "updatedAtMs",
                ) + optional,
            )
            decode<AndroidLocalOutboxStateV1>(objectValue).also {
                validateState(it, entryKey, revision)
            }
        }
        validateStateChain(states, createdAtMs)
        return states
    }

    private fun validateState(
        state: AndroidLocalOutboxStateV1,
        entryKey: String,
        revision: Long,
    ) {
        if (
            state.schemaVersion != LOCAL_OUTBOX_STATE_SCHEMA_VERSION ||
            state.entryKey != entryKey ||
            state.stateRevision != revision ||
            state.attemptCount !in 0..9_999_999_999L
        ) {
            invalidData()
        }
        validTimestamp(state.updatedAtMs)
        when (state.state) {
            "pending" -> if (
                state.lastAttemptAtMs != null ||
                state.failureCode != null ||
                state.syncedAtMs != null
            ) invalidData()
            "failed" -> {
                validTimestamp(state.lastAttemptAtMs ?: invalidData())
                val code = state.failureCode ?: invalidData()
                if (code.length !in 1..64 || !code.matches(failureCodePattern)) invalidData()
                if (state.syncedAtMs != null) invalidData()
            }
            "synced" -> {
                validTimestamp(state.lastAttemptAtMs ?: invalidData())
                validTimestamp(state.syncedAtMs ?: invalidData())
                if (state.failureCode != null) invalidData()
            }
            else -> invalidData()
        }
    }

    private fun validateStateChain(states: List<AndroidLocalOutboxStateV1>, createdAtMs: Long) {
        val first = states.first()
        if (first.state != "pending" || first.attemptCount != 0L || first.updatedAtMs != createdAtMs) {
            invalidData()
        }
        states.zipWithNext().forEach { (previous, current) ->
            if (current.updatedAtMs < previous.updatedAtMs) invalidData()
            when {
                previous.state == "pending" && current.state in setOf("failed", "synced") -> {
                    if (
                        current.attemptCount != previous.attemptCount + 1 ||
                        current.lastAttemptAtMs != current.updatedAtMs ||
                        (current.state == "synced" && current.syncedAtMs != current.updatedAtMs)
                    ) invalidData()
                }
                previous.state == "failed" && current.state == "pending" ->
                    if (current.attemptCount != previous.attemptCount) invalidData()
                else -> invalidData()
            }
        }
    }

    private fun validateManifest(entry: AndroidLocalOutboxEntryV1, expectedKey: String) {
        if (
            entry.schemaVersion != LOCAL_OUTBOX_ENTRY_SCHEMA_VERSION ||
            entry.entryKey != expectedKey ||
            !entry.submissionSha256.matches(entryKeyPattern)
        ) {
            invalidData()
        }
        validTimestamp(entry.createdAtMs)
    }

    private fun listedEntryDirectories(): List<File> {
        val children = canonicalRoot.listFiles()?.sortedBy { it.name } ?: readFailed()
        return children.filterNot { child ->
            child.name.startsWith(".entry-")
        }.onEach { child ->
            requireEntryKey(child.name)
        }
    }

    private fun newTemporaryEntryDirectory(): File {
        repeat(10) {
            val candidate = File(canonicalRoot, ".entry-${UUID.randomUUID().toString().replace("-", "")}")
            if (candidate.mkdir()) return candidate
        }
        writeFailed()
    }

    private fun installExclusive(target: File, bytes: ByteArray) {
        val temporary = File(
            target.parentFile,
            ".${target.name}.${UUID.randomUUID().toString().replace("-", "")}.tmp",
        )
        try {
            writeNew(temporary, bytes)
            exclusiveFileInstaller.install(temporary, target)
            directorySync.sync(checkNotNull(target.parentFile))
        } finally {
            temporary.delete()
        }
    }

    private fun writeNew(file: File, bytes: ByteArray) {
        var created = false
        try {
            if (!file.createNewFile()) conflict()
            created = true
            FileOutputStream(file).use { output ->
                output.write(bytes)
                output.flush()
                output.fd.sync()
            }
            file.setReadable(false, false)
            file.setWritable(false, false)
            file.setReadable(true, true)
            file.setWritable(true, true)
        } catch (error: AndroidLocalOutboxException) {
            if (created) file.delete()
            throw error
        } catch (_: IOException) {
            if (created) file.delete()
            writeFailed()
        }
    }

    private fun readRegular(file: File, maximumBytes: Int): ByteArray {
        try {
            requireDirectFile(file)
            val length = file.length()
            if (length !in 1..maximumBytes.toLong()) invalidData()
            return file.readBytes().also { if (it.size.toLong() != length) invalidData() }
        } catch (error: AndroidLocalOutboxException) {
            throw error
        } catch (_: IOException) {
            readFailed()
        }
    }

    private fun requireDirectFile(file: File) {
        if (!file.isFile || file.canonicalPath != file.absolutePath) invalidData()
    }

    private fun requireDirectDirectory(file: File) {
        if (!file.isDirectory || file.canonicalPath != file.absolutePath) invalidData()
    }

    private fun parseObject(bytes: ByteArray, input: Boolean = false): JsonObject {
        try {
            return outboxJson.parseToJsonElement(bytes.toString(Charsets.UTF_8)) as? JsonObject
                ?: if (input) invalidInput() else invalidData()
        } catch (error: AndroidLocalOutboxException) {
            throw error
        } catch (_: Exception) {
            if (input) invalidInput() else invalidData()
        }
    }

    private inline fun <reified T> decode(value: JsonObject): T = try {
        outboxJson.decodeFromString(value.toString())
    } catch (_: Exception) {
        invalidData()
    }

    private inline fun <reified T> encodeDocument(value: T): ByteArray =
        (outboxJson.encodeToString(value) + "\n").toByteArray(Charsets.UTF_8)

    private fun encodeOwnerDocument(owner: AndroidLocalOutboxEntryOwnerV1): ByteArray = try {
        (ownerJson.encodeToString(owner) + "\n").toByteArray(Charsets.UTF_8)
            .also { if (it.size > MAX_OWNER_DOCUMENT_BYTES) invalidInput() }
    } catch (error: AndroidLocalOutboxException) {
        throw error
    } catch (_: Exception) {
        invalidInput()
    }

    private inline fun <reified T> encodeInputDocument(value: T): ByteArray = try {
        encodeDocument(value)
    } catch (_: Exception) {
        invalidInput()
    }

    private fun requireExactKeys(value: JsonObject, expected: Set<String>) {
        if (value.keys != expected) invalidData()
    }

    private fun requireEntryKey(entryKey: String) {
        if (!entryKey.matches(entryKeyPattern)) invalidInput()
    }

    private fun validTimestamp(value: Long, input: Boolean = false) {
        if (value !in 0..MAX_TIMESTAMP_MS) {
            if (input) invalidInput() else invalidData()
        }
    }

    private fun invalidConfiguration(): Nothing =
        throw AndroidLocalOutboxValidationException("Local outbox configuration is invalid.")

    private fun invalidInput(): Nothing =
        throw AndroidLocalOutboxValidationException("Local outbox input is invalid.")

    private fun invalidData(): Nothing =
        throw AndroidLocalOutboxValidationException("Local outbox data is invalid.")

    private fun conflict(): Nothing =
        throw AndroidLocalOutboxConflictException("Local outbox entry already exists.")

    private fun writeFailed(): Nothing =
        throw AndroidLocalOutboxIoException("Local outbox write failed.")

    private fun readFailed(): Nothing =
        throw AndroidLocalOutboxIoException("Local outbox read failed.")
}

private fun JsonObject.stringValue(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.integerValue(name: String): Long? =
    (this[name] as? JsonPrimitive)
        ?.takeIf { !it.isString }
        ?.content
        ?.takeIf { it.matches(Regex("^(0|[1-9][0-9]*)$")) }
        ?.toLongOrNull()

private fun stateFileName(revision: Long): String =
    revision.toString().padStart(10, '0') + ".json"

private fun sameOrNested(parent: File, child: File): Boolean {
    val parentPath = parent.path.trimEnd(File.separatorChar)
    val childPath = child.path.trimEnd(File.separatorChar)
    return childPath == parentPath || childPath.startsWith(parentPath + File.separator)
}

private fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString(separator = "") { "%02x".format(it) }
