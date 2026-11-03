package nl.mariokart8.mk8dxtimetrials.outbox

import java.io.File
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.scan.AcceptedPlayerScanObservation
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanSubmissionContext
import nl.mariokart8.mk8dxtimetrials.scan.ScanLegacyAssetResolver
import nl.mariokart8.mk8dxtimetrials.scan.ScanPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.scan.createAndroidScanSubmission
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AndroidExplicitOutboxDeliveryTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val createdAtMs = 1_786_900_500_000L
    private val attemptedAtMs = createdAtMs + 1_000
    private val slotA = "slot." + "a".repeat(32)
    private val slotB = "slot." + "b".repeat(32)

    private fun outbox(): AndroidLocalTimeTrialOutbox {
        val parent = temporary.newFolder()
        return AndroidLocalTimeTrialOutbox(
            File(parent, "canonical"),
            File(parent, "private"),
            AndroidProducedSubmissionValidator,
            AndroidExclusiveFileInstaller { source, target ->
                try {
                    Files.createLink(target.toPath(), source.toPath())
                } catch (_: FileAlreadyExistsException) {
                    throw AndroidLocalOutboxConflictException(
                        "Local outbox entry already exists.",
                    )
                }
            },
            AndroidDirectorySync {},
        )
    }

    private fun host(
        outbox: AndroidLocalTimeTrialOutbox,
        owningSlotId: String? = slotA,
    ) = AndroidOutboxSubmissionHost(
        outbox,
        AndroidOutboxClock { createdAtMs },
        scanPrivateEvidence = {
            buildJsonObject {
                put("sourceInput", "private://synthetic/result.png")
                put("debug", "private synthetic detail")
            }
        },
        owningSlot = { owningSlotId },
    )

    private fun resolver(
        transport: AndroidAuthenticatedCanonicalSubmissionTransport,
        forSlotId: String = slotA,
    ) = AndroidOwnedCanonicalSubmissionTransportResolver { owningSlotId ->
        transport.takeIf { owningSlotId == forSlotId }
    }

    private fun manualSubmission() = createAndroidManualSubmission(
        AndroidManualSubmissionContext(
            submissionId = "user_submission.time.ANDROIDDELIVERY01",
            revision = 1,
            trackId = "track.mario_kart_stadium",
            playerReference = ManualPlayerReferenceV1(
                "producer_local_profile",
                "delivery-manual-profile",
            ),
            createdAtMs = createdAtMs,
            producerVersion = "android-delivery-test",
        ),
        mode = 150,
        timeDigits = "123456",
    )

    private fun scanSubmission() = createAndroidScanSubmission(
        AcceptedPlayerScanObservation(
            totalTime = "1:46.784",
            lapTimes = listOf("0:37.121", "0:35.399", "0:34.264"),
            lapSumAccepted = true,
            capturedAtMs = createdAtMs,
        ),
        AndroidScanSubmissionContext(
            submissionId = "user_submission.time.ANDROIDDELIVERY02",
            revision = 1,
            mode = 150,
            trackId = "track.mario_kart_stadium",
            playerReference = ScanPlayerReferenceV1(
                "unresolved_observation",
                "delivery-scan-profile",
            ),
            createdAtMs = createdAtMs,
            producerVersion = "android-delivery-test",
            scanResultReference = "opaque/scan-result-01",
            scanResultSha256 = "3".repeat(64),
            scanResultMediaType = "image/png",
        ),
        object : ScanLegacyAssetResolver {
            override fun resolveTire(index: Int): String? = null
            override fun resolveCountry(index: Int): String? = null
        },
    )

    private fun acknowledgement(submission: JsonObject): JsonObject = buildJsonObject {
        put("submissionId", submission.getValue("submissionId"))
        put("revision", submission.getValue("revision"))
    }

    @Test
    fun reviewsOnlyCanonicalEvidenceAndMarksExactAcknowledgementSynced() {
        val outbox = outbox()
        val pending = host(outbox).storeScan(scanSubmission())
        val privateBefore = outbox.readPrivateEvidence(pending.entry.entryKey)
        val reviewed = mutableListOf<List<JsonObject>>()
        val transported = mutableListOf<JsonObject>()
        val coordinator = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            resolver(
                AndroidAuthenticatedCanonicalSubmissionTransport { submission ->
                    transported += submission
                    acknowledgement(submission)
                },
            ),
            AndroidReviewedEvidenceReferenceAllowlist { evidence ->
                reviewed += evidence
                true
            },
        )

        val result = coordinator.deliver(pending.entry.entryKey, attemptedAtMs)

        assertEquals("synced", result.state.state)
        assertEquals(2L, result.state.stateRevision)
        assertEquals(1L, result.state.attemptCount)
        assertEquals(attemptedAtMs, result.state.syncedAtMs)
        assertEquals(1, reviewed.single().size)
        assertEquals("opaque/scan-result-01", reviewed.single().single()["reference"]?.toString()?.trim('"'))
        assertEquals(pending.canonicalSubmission, transported.single())
        assertFalse(reviewed.toString().contains("private://"))
        assertFalse(transported.toString().contains("private://"))
        assertEquals(privateBefore, outbox.readPrivateEvidence(pending.entry.entryKey))
    }

    @Test
    fun noEvidenceStillRequiresReviewAndCanSync() {
        val outbox = outbox()
        val pending = host(outbox).storeManual(manualSubmission())
        val reviewed = mutableListOf<List<JsonObject>>()
        val coordinator = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            resolver(AndroidAuthenticatedCanonicalSubmissionTransport(::acknowledgement)),
            AndroidReviewedEvidenceReferenceAllowlist { evidence ->
                reviewed += evidence
                true
            },
        )

        assertEquals("synced", coordinator.deliver(pending.entry.entryKey, attemptedAtMs).state.state)
        assertEquals(listOf(emptyList<JsonObject>()), reviewed)
    }

    @Test
    fun canonicalRequestTransportFitsTheExplicitDeliveryCoordinator() {
        val outbox = outbox()
        val pending = host(outbox).storeManual(manualSubmission())
        val requests = mutableListOf<AndroidCanonicalSubmissionRequest>()
        val transport = createAndroidCanonicalSubmissionRequestTransport { request ->
            requests += request
            val body = acknowledgement(pending.canonicalSubmission)
                .toString()
                .toByteArray(Charsets.UTF_8)
            AndroidCanonicalSubmissionResponse(
                statusCode = 201,
                contentType = "application/json",
                declaredContentLength = body.size.toLong(),
                body = body,
            )
        }
        val coordinator = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            resolver(transport),
            AndroidReviewedEvidenceReferenceAllowlist { true },
        )

        val result = coordinator.deliver(pending.entry.entryKey, attemptedAtMs)

        assertEquals("synced", result.state.state)
        assertEquals(pending.canonicalSubmission, Json.parseToJsonElement(requests.single().body))
        assertEquals(ANDROID_CANONICAL_SUBMISSION_PATH, requests.single().path)
    }

    @Test
    fun deniedOrFailedEvidenceReviewNeverCallsTransport() {
        listOf(
            AndroidReviewedEvidenceReferenceAllowlist { false } to
                ANDROID_DELIVERY_FAILURE_EVIDENCE_NOT_ALLOWLISTED,
            AndroidReviewedEvidenceReferenceAllowlist {
                throw IllegalStateException("private review detail")
            } to ANDROID_DELIVERY_FAILURE_EVIDENCE_REVIEW_FAILED,
        ).forEachIndexed { index, (review, expectedCode) ->
            val outbox = outbox()
            val pending = host(outbox).storeScan(scanSubmission().copy(
                submissionId = "user_submission.time.ANDROIDREVIEW0${index + 1}",
            ))
            var transportCalls = 0
            val coordinator = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
                outbox,
                resolver(
                    AndroidAuthenticatedCanonicalSubmissionTransport {
                        transportCalls += 1
                        acknowledgement(it)
                    },
                ),
                review,
            )

            val result = coordinator.deliver(pending.entry.entryKey, attemptedAtMs)
            assertEquals("failed", result.state.state)
            assertEquals(expectedCode, result.state.failureCode)
            assertEquals(0, transportCalls)
        }
    }

    @Test
    fun transportFailuresStoreOnlyBoundedCodes() {
        val transports = listOf(
            AndroidAuthenticatedCanonicalSubmissionTransport {
                throw AndroidCanonicalDeliveryTransportException("http.unavailable")
            } to "http.unavailable",
            AndroidAuthenticatedCanonicalSubmissionTransport {
                throw AndroidCanonicalDeliveryTransportException("private/path must not leak")
            } to ANDROID_DELIVERY_FAILURE_TRANSPORT_FAILED,
            AndroidAuthenticatedCanonicalSubmissionTransport {
                throw IllegalStateException("private transport detail")
            } to ANDROID_DELIVERY_FAILURE_TRANSPORT_FAILED,
        )
        transports.forEachIndexed { index, (transport, expectedCode) ->
            val outbox = outbox()
            val pending = host(outbox).storeManual(manualSubmission().copy(
                submissionId = "user_submission.time.ANDROIDTRANSPORT0${index + 1}",
            ))
            val result = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
                outbox,
                resolver(transport),
                AndroidReviewedEvidenceReferenceAllowlist { true },
            ).deliver(pending.entry.entryKey, attemptedAtMs)

            assertEquals("failed", result.state.state)
            assertEquals(expectedCode, result.state.failureCode)
            assertFalse(result.state.toString().contains("private", ignoreCase = true))
        }
    }

    @Test
    fun widenedMismatchedAndNonIntegerAcknowledgementsFailClosed() {
        val responses = listOf<(JsonObject) -> JsonObject>(
            { submission -> buildJsonObject {
                put("submissionId", submission.getValue("submissionId"))
                put("revision", submission.getValue("revision"))
                put("privateResponse", "must not be accepted")
            } },
            { submission -> buildJsonObject {
                put("submissionId", submission.getValue("submissionId"))
                put("revision", 2)
            } },
            { submission -> buildJsonObject {
                put("submissionId", submission.getValue("submissionId"))
                put("revision", true)
            } },
        )
        responses.forEachIndexed { index, response ->
            val outbox = outbox()
            val pending = host(outbox).storeManual(manualSubmission().copy(
                submissionId = "user_submission.time.ANDROIDRESPONSE0${index + 1}",
            ))
            val result = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
                outbox,
                resolver(AndroidAuthenticatedCanonicalSubmissionTransport(response)),
                AndroidReviewedEvidenceReferenceAllowlist { true },
            ).deliver(pending.entry.entryKey, attemptedAtMs)
            assertEquals("failed", result.state.state)
            assertEquals(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID, result.state.failureCode)
        }
    }

    @Test
    fun failedEntryRequiresSeparateExplicitRetry() {
        val outbox = outbox()
        val pending = host(outbox).storeManual(manualSubmission())
        val key = pending.entry.entryKey
        outbox.markFailed(key, 1, attemptedAtMs, "network.unavailable")
        var transportCalls = 0
        val coordinator = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            resolver(
                AndroidAuthenticatedCanonicalSubmissionTransport { submission ->
                    transportCalls += 1
                    acknowledgement(submission)
                },
            ),
            AndroidReviewedEvidenceReferenceAllowlist { true },
        )

        assertThrows(AndroidCanonicalDeliveryStateException::class.java) {
            coordinator.deliver(key, attemptedAtMs + 1)
        }
        assertEquals(0, transportCalls)
        outbox.requestRetry(key, 2, attemptedAtMs + 2)
        val result = coordinator.deliver(key, attemptedAtMs + 3)
        assertEquals("synced", result.state.state)
        assertEquals(4L, result.state.stateRevision)
        assertEquals(2L, result.state.attemptCount)
        assertEquals(1, transportCalls)
    }

    @Test
    fun invalidOrRegressingAttemptStopsBeforeReviewAndTransport() {
        val outbox = outbox()
        val pending = host(outbox).storeManual(manualSubmission())
        var reviewCalls = 0
        var transportCalls = 0
        val coordinator = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            resolver(
                AndroidAuthenticatedCanonicalSubmissionTransport {
                    transportCalls += 1
                    acknowledgement(it)
                },
            ),
            AndroidReviewedEvidenceReferenceAllowlist {
                reviewCalls += 1
                true
            },
        )

        listOf(
            "bad" to attemptedAtMs,
            pending.entry.entryKey to -1L,
            pending.entry.entryKey to createdAtMs - 1,
        ).forEach { (key, timestamp) ->
            assertThrows(AndroidCanonicalDeliveryStateException::class.java) {
                coordinator.deliver(key, timestamp)
            }
        }
        assertEquals(0, reviewCalls)
        assertEquals(0, transportCalls)
        assertEquals(1L, outbox.read(pending.entry.entryKey).state.stateRevision)
    }

    @Test
    fun anEntryIsDeliveredWithItsOwnAccountAndNeverWithAnother() {
        val outbox = outbox()
        val pending = host(outbox, slotA).storeManual(manualSubmission())
        val requestedSlots = mutableListOf<String>()
        val coordinator = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            { owningSlotId ->
                requestedSlots += owningSlotId
                AndroidAuthenticatedCanonicalSubmissionTransport(::acknowledgement)
                    .takeIf { owningSlotId == slotA }
            },
            AndroidReviewedEvidenceReferenceAllowlist { true },
        )

        assertEquals(
            "synced",
            coordinator.deliver(pending.entry.entryKey, attemptedAtMs).state.state,
        )
        assertEquals(listOf(slotA), requestedSlots)
        assertEquals(slotA, outbox.read(pending.entry.entryKey).owner?.slotId)
    }

    @Test
    fun anExpiredOwnerFailsClosedAndNeverUsesTheOtherAccountToken() {
        val outbox = outbox()
        val pending = host(outbox, slotA).storeManual(manualSubmission())
        var otherAccountCalls = 0
        val coordinator = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            { owningSlotId ->
                // Only account B can authenticate; account A owns the entry.
                AndroidAuthenticatedCanonicalSubmissionTransport { submission ->
                    otherAccountCalls += 1
                    acknowledgement(submission)
                }.takeIf { owningSlotId == slotB }
            },
            AndroidReviewedEvidenceReferenceAllowlist { true },
        )

        val failed = coordinator.deliver(pending.entry.entryKey, attemptedAtMs)
        assertEquals("failed", failed.state.state)
        assertEquals(
            ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED,
            failed.state.failureCode,
        )
        assertEquals(0, otherAccountCalls)

        // The entry is not lost: an explicit retry puts it back in the queue.
        val retried = outbox.requestRetry(
            pending.entry.entryKey,
            failed.state.stateRevision,
            attemptedAtMs + 1,
        )
        assertEquals("pending", retried.state.state)
        assertEquals(slotA, retried.owner?.slotId)
    }

    @Test
    fun anEntryWithoutAnOwningAccountIsNeverSent() {
        val outbox = outbox()
        val pending = host(outbox, owningSlotId = null).storeManual(manualSubmission())
        var transportCalls = 0
        val result = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            {
                AndroidAuthenticatedCanonicalSubmissionTransport {
                    transportCalls += 1
                    acknowledgement(it)
                }
            },
            AndroidReviewedEvidenceReferenceAllowlist { true },
        ).deliver(pending.entry.entryKey, attemptedAtMs)

        assertEquals("failed", result.state.state)
        assertEquals(
            ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED,
            result.state.failureCode,
        )
        assertEquals(0, transportCalls)
    }

    @Test
    fun oneCoordinatorSerializesConcurrentAttemptsBeforeTransport() {
        val outbox = outbox()
        val pending = host(outbox).storeManual(manualSubmission())
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        var transportCalls = 0
        val coordinator = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            resolver(
                AndroidAuthenticatedCanonicalSubmissionTransport { submission ->
                    transportCalls += 1
                    started.countDown()
                    assertTrue(release.await(5, TimeUnit.SECONDS))
                    acknowledgement(submission)
                },
            ),
            AndroidReviewedEvidenceReferenceAllowlist { true },
        )
        val executor = Executors.newFixedThreadPool(2)
        try {
            val first = executor.submit<AndroidLocalOutboxRecord> {
                coordinator.deliver(pending.entry.entryKey, attemptedAtMs)
            }
            assertTrue(started.await(5, TimeUnit.SECONDS))
            val second = executor.submit<AndroidLocalOutboxRecord> {
                coordinator.deliver(pending.entry.entryKey, attemptedAtMs + 1)
            }
            release.countDown()
            assertEquals("synced", first.get(10, TimeUnit.SECONDS).state.state)
            assertTrue(
                runCatching { second.get(10, TimeUnit.SECONDS) }
                    .exceptionOrNull()
                    ?.cause is AndroidCanonicalDeliveryStateException,
            )
        } finally {
            executor.shutdownNow()
        }
        assertEquals(1, transportCalls)
        assertEquals(2L, outbox.read(pending.entry.entryKey).state.stateRevision)
    }
}
