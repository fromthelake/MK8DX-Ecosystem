package nl.mariokart8.mk8dxtimetrials.outbox

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidOutboxSynchronizationSelectionFactoryTest {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = false
    }
    private val entryKey = "a".repeat(64)
    private val createdAtMs = 1_786_900_700_000L
    private val actionAtMs = createdAtMs + 100
    private val ownerSlotId = "slot." + "c".repeat(32)

    @Test
    fun constructionIsPassiveAndExplicitSelectionReachesExactCanonicalDelivery() {
        val outbox = FakeCanonicalOutbox(record())
        val reviewed = mutableListOf<List<JsonObject>>()
        val transported = mutableListOf<JsonObject>()
        var clockCalls = 0

        val dependencies = AndroidOutboxSynchronizationSelectionDependencyFactory(
            outbox = outbox,
            transportResolver = { owningSlotId ->
                assertEquals(ownerSlotId, owningSlotId)
                AndroidAuthenticatedCanonicalSubmissionTransport { submission ->
                    transported += submission
                    buildJsonObject {
                        put("submissionId", submission.getValue("submissionId"))
                        put("revision", submission.getValue("revision"))
                    }
                }
            },
            reviewedEvidenceAllowlist = AndroidReviewedEvidenceReferenceAllowlist { evidence ->
                reviewed += evidence
                true
            },
            clock = AndroidOutboxSynchronizationClock {
                clockCalls += 1
                actionAtMs
            },
        ).create()

        assertEquals(0, outbox.indexCalls)
        assertEquals(0, outbox.readCalls)
        assertEquals(0, clockCalls)
        assertEquals(emptyList<JsonObject>(), transported)

        val index = dependencies.indexBinding.actionsFactory.create().load()
            as AndroidOutboxIndexState.Ready
        assertEquals(listOf(entryKey), index.entries.map { it.entryKeyHash })
        assertEquals(1, outbox.indexCalls)
        assertEquals(0, outbox.readCalls)

        val selected = dependencies.selectionCoordinator.select(
            indexState = index,
            loadInProgress = false,
            entryKeyHash = entryKey,
        ) as AndroidOutboxSelectionResult.Selected
        val states = mutableListOf<AndroidOutboxSynchronizationState>()
        val actions = selected.binding.actionsFactory.create(states::add)
        assertEquals(0, outbox.readCalls)
        assertEquals(0, clockCalls)

        val result = actions.deliver() as AndroidOutboxSynchronizationState.Ready

        assertEquals(AndroidOutboxStoredState.SYNCED, result.snapshot.storedState)
        assertEquals(2, result.snapshot.stateRevision)
        assertEquals(1, result.snapshot.attemptCount)
        assertEquals(1, clockCalls)
        assertEquals(entryKey, outbox.syncedKey)
        assertEquals(1L, outbox.syncedExpectedRevision)
        assertEquals(actionAtMs, outbox.syncedAtMs)
        assertEquals(
            "opaque/test-evidence",
            reviewed.single().single().getValue("reference").toString().trim('"'),
        )
        assertEquals(outbox.current.canonicalSubmission, transported.single())
        assertFalse(reviewed.toString().contains("private://"))
        assertFalse(transported.toString().contains("private://"))
        assertEquals(2, states.size)
    }

    @Test
    fun selectedFailedEntryUsesInjectedClockForRetryWithoutTransport() {
        val failed = record(
            state = "failed",
            stateRevision = 2,
            attemptCount = 1,
            failureCode = "transport.failed",
        )
        val outbox = FakeCanonicalOutbox(failed)
        var transportCalls = 0
        var reviewCalls = 0
        val dependencies = AndroidOutboxSynchronizationSelectionDependencyFactory(
            outbox = outbox,
            transportResolver = {
                AndroidAuthenticatedCanonicalSubmissionTransport {
                    transportCalls += 1
                    error("transport must remain separate from retry")
                }
            },
            reviewedEvidenceAllowlist = AndroidReviewedEvidenceReferenceAllowlist {
                reviewCalls += 1
                true
            },
            clock = AndroidOutboxSynchronizationClock { actionAtMs },
        ).create()
        val index = dependencies.indexBinding.actionsFactory.create().load()
            as AndroidOutboxIndexState.Ready
        val selected = dependencies.selectionCoordinator.select(index, false, entryKey)
            as AndroidOutboxSelectionResult.Selected

        val result = selected.binding.actionsFactory.create(onState = {}).requestRetry()
            as AndroidOutboxSynchronizationState.Ready

        assertEquals(AndroidOutboxStoredState.PENDING, result.snapshot.storedState)
        assertEquals(3, result.snapshot.stateRevision)
        assertEquals(1, result.snapshot.attemptCount)
        assertEquals(entryKey, outbox.retryKey)
        assertEquals(2L, outbox.retryExpectedRevision)
        assertEquals(actionAtMs, outbox.retryAtMs)
        assertEquals(0, transportCalls)
        assertEquals(0, reviewCalls)
    }

    @Test
    fun httpsCompositionIsPassiveUntilExplicitDeliveryAndKeepsCanonicalCapabilitiesNarrow() {
        val withoutEvidence = record().let { current ->
            current.copy(
                canonicalSubmission = JsonObject(current.canonicalSubmission - "evidence"),
            )
        }
        val outbox = FakeCanonicalOutbox(withoutEvidence)
        var connectionCalls = 0
        var clockCalls = 0
        lateinit var connection: FactoryFakeHttpsURLConnection
        val dependencies = AndroidHttpsOutboxSynchronizationSelectionDependencyFactory(
            outbox = outbox,
            origin = "https://api.example.test",
            connectionFactoryProvider = { owningSlotId ->
                assertEquals(ownerSlotId, owningSlotId)
                AndroidAuthenticatedHttpsConnectionFactory { url ->
                    connectionCalls += 1
                    val acknowledgement = buildJsonObject {
                        put(
                            "submissionId",
                            outbox.current.canonicalSubmission.getValue("submissionId"),
                        )
                        put("revision", outbox.current.canonicalSubmission.getValue("revision"))
                    }
                    FactoryFakeHttpsURLConnection(
                        url = url,
                        responseBody = acknowledgement.toString().toByteArray(),
                    ).also {
                        it.setRequestProperty("X-Test-Authentication", "synthetic-factory-proof")
                        connection = it
                    }
                }
            },
            reviewedEvidenceAllowlist = AndroidReviewedEvidenceReferenceAllowlist { true },
            clock = AndroidOutboxSynchronizationClock {
                clockCalls += 1
                actionAtMs
            },
        ).create()

        assertEquals(0, outbox.indexCalls)
        assertEquals(0, outbox.readCalls)
        assertEquals(0, connectionCalls)
        assertEquals(0, clockCalls)

        val index = dependencies.indexBinding.actionsFactory.create().load()
            as AndroidOutboxIndexState.Ready
        val selected = dependencies.selectionCoordinator.select(index, false, entryKey)
            as AndroidOutboxSelectionResult.Selected
        val result = selected.binding.actionsFactory.create(onState = {}).deliver()
            as AndroidOutboxSynchronizationState.Ready

        assertEquals(AndroidOutboxStoredState.SYNCED, result.snapshot.storedState)
        assertEquals(1, connectionCalls)
        assertEquals(1, clockCalls)
        assertEquals(
            "https://api.example.test/v1/time-trial-submissions?feedback=v2",
            connection.url.toString(),
        )
        assertEquals("synthetic-factory-proof", connection.getRequestProperty("X-Test-Authentication"))
        assertEquals("application/json", connection.getRequestProperty("Content-Type"))
        assertArrayEquals(
            outbox.current.canonicalSubmission.toString().toByteArray(),
            connection.writtenBody(),
        )
        assertTrue(connection.disconnected)
    }

    private fun record(
        state: String = "pending",
        stateRevision: Long = 1,
        attemptCount: Long = 0,
        failureCode: String? = null,
        syncedAtMs: Long? = null,
    ) = AndroidLocalOutboxRecord(
        entry = AndroidLocalOutboxEntryV1(
            entryKey = entryKey,
            submissionSha256 = "b".repeat(64),
            createdAtMs = createdAtMs,
            privateEvidencePresent = true,
        ),
        canonicalSubmission = canonicalSubmission(),
        state = AndroidLocalOutboxStateV1(
            entryKey = entryKey,
            stateRevision = stateRevision,
            state = state,
            attemptCount = attemptCount,
            updatedAtMs = createdAtMs,
            lastAttemptAtMs = createdAtMs.takeIf { attemptCount > 0 },
            failureCode = failureCode,
            syncedAtMs = syncedAtMs,
        ),
        owner = AndroidLocalOutboxEntryOwnerV1(
            slotId = ownerSlotId,
            playerReference = AndroidLocalOutboxPlayerReferenceV1(
                "producer_local_profile",
                "factory-profile",
            ),
            createdAtMs = createdAtMs,
        ),
    )

    private fun canonicalSubmission(): JsonObject {
        val value = createAndroidManualSubmission(
            AndroidManualSubmissionContext(
                submissionId = "user_submission.time.FACTORYTEST01",
                revision = 1,
                trackId = "track.mario_kart_stadium",
                playerReference = ManualPlayerReferenceV1(
                    "producer_local_profile",
                    "factory-profile",
                ),
                createdAtMs = createdAtMs,
                producerVersion = "factory-test",
            ),
            mode = 150,
            timeDigits = "123456",
        )
        val canonical = json.parseToJsonElement(
            json.encodeToString(AndroidManualTimeTrialSubmissionV1.serializer(), value),
        ) as JsonObject
        return JsonObject(
            canonical + (
                "evidence" to buildJsonArray {
                    add(buildJsonObject { put("reference", "opaque/test-evidence") })
                }
            ),
        )
    }

    private class FakeCanonicalOutbox(
        var current: AndroidLocalOutboxRecord,
    ) : AndroidCanonicalOutboxSynchronizationSelectionPort {
        var indexCalls = 0
        var readCalls = 0
        var syncedKey: String? = null
        var syncedExpectedRevision: Long? = null
        var syncedAtMs: Long? = null
        var retryKey: String? = null
        var retryExpectedRevision: Long? = null
        var retryAtMs: Long? = null

        override fun listIndex(): List<AndroidCanonicalOutboxIndexRecord> {
            indexCalls += 1
            return listOf(
                AndroidCanonicalOutboxIndexRecord(
                    entryKeyHash = current.entry.entryKey,
                    createdAtMs = current.entry.createdAtMs,
                    storedState = when (current.state.state) {
                        "pending" -> AndroidOutboxStoredState.PENDING
                        "failed" -> AndroidOutboxStoredState.FAILED
                        "synced" -> AndroidOutboxStoredState.SYNCED
                        else -> error("unexpected test state")
                    },
                    stateRevision = current.state.stateRevision,
                    attemptCount = current.state.attemptCount,
                    failureCode = current.state.failureCode,
                ),
            )
        }

        override fun read(entryKey: String): AndroidLocalOutboxRecord {
            readCalls += 1
            assertEquals(current.entry.entryKey, entryKey)
            return current
        }

        override fun markFailed(
            entryKey: String,
            expectedStateRevision: Long,
            attemptedAtMs: Long,
            failureCode: String,
        ): AndroidLocalOutboxRecord = error("failure is not expected")

        override fun markSynced(
            entryKey: String,
            expectedStateRevision: Long,
            attemptedAtMs: Long,
            feedback: kotlinx.serialization.json.JsonObject?,
        ): AndroidLocalOutboxRecord {
            syncedKey = entryKey
            syncedExpectedRevision = expectedStateRevision
            syncedAtMs = attemptedAtMs
            current = current.copy(
                state = current.state.copy(
                    stateRevision = expectedStateRevision + 1,
                    state = "synced",
                    attemptCount = current.state.attemptCount + 1,
                    updatedAtMs = attemptedAtMs,
                    lastAttemptAtMs = attemptedAtMs,
                    syncedAtMs = attemptedAtMs,
                ),
            )
            return current
        }

        override fun requestRetry(
            entryKey: String,
            expectedStateRevision: Long,
            requestedAtMs: Long,
        ): AndroidLocalOutboxRecord {
            retryKey = entryKey
            retryExpectedRevision = expectedStateRevision
            retryAtMs = requestedAtMs
            current = current.copy(
                state = current.state.copy(
                    stateRevision = expectedStateRevision + 1,
                    state = "pending",
                    updatedAtMs = requestedAtMs,
                    lastAttemptAtMs = null,
                    failureCode = null,
                ),
            )
            return current
        }
    }
}

private class FactoryFakeHttpsURLConnection(
    url: URL,
    private val responseBody: ByteArray,
) : HttpsURLConnection(url) {
    private val output = ByteArrayOutputStream()
    var disconnected = false
        private set

    override fun connect() = Unit

    override fun disconnect() {
        disconnected = true
    }

    override fun usingProxy(): Boolean = false

    override fun getCipherSuite(): String = "TLS_SYNTHETIC_FACTORY"

    override fun getLocalCertificates(): Array<Certificate>? = null

    override fun getServerCertificates(): Array<Certificate> = emptyArray()

    override fun getOutputStream(): OutputStream = output

    override fun getInputStream(): InputStream = ByteArrayInputStream(responseBody)

    override fun getResponseCode(): Int = 201

    override fun getContentType(): String = "application/json"

    override fun getContentLengthLong(): Long = responseBody.size.toLong()

    fun writtenBody(): ByteArray = output.toByteArray()
}
