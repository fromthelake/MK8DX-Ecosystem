package nl.mariokart8.mk8dxtimetrials.outbox

import java.io.File
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.scan.AcceptedPlayerScanObservation
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanSubmissionContext
import nl.mariokart8.mk8dxtimetrials.scan.ScanLegacyAssetResolver
import nl.mariokart8.mk8dxtimetrials.scan.ScanPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.scan.createAndroidScanSubmission
import nl.mariokart8.mk8dxtimetrials.scan.encodeAndroidScanSubmission
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AndroidLocalTimeTrialOutboxTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val nioInstaller = AndroidExclusiveFileInstaller { source, target ->
        try {
            Files.createLink(target.toPath(), source.toPath())
        } catch (_: FileAlreadyExistsException) {
            throw AndroidLocalOutboxConflictException("Local outbox entry already exists.")
        }
    }
    private val noDirectorySync = AndroidDirectorySync {}
    private val ownerSlotId = "slot." + "d".repeat(32)

    private data class Fixture(
        val outbox: AndroidLocalTimeTrialOutbox,
        val canonicalRoot: File,
        val privateRoot: File,
    )

    private fun fixture(
        installer: AndroidExclusiveFileInstaller = nioInstaller,
    ): Fixture {
        val parent = temporary.newFolder()
        val canonical = File(parent, "canonical")
        val privateRoot = File(parent, "private")
        return Fixture(
            AndroidLocalTimeTrialOutbox(
                canonical,
                privateRoot,
                AndroidProducedSubmissionValidator,
                installer,
                noDirectorySync,
            ),
            canonical,
            privateRoot,
        )
    }

    private fun manualSubmission() = createAndroidManualSubmission(
        context = AndroidManualSubmissionContext(
            submissionId = "user_submission.time.ANDROIDLOCAL0001",
            revision = 1,
            trackId = "track.mario_kart_stadium",
            playerReference = ManualPlayerReferenceV1(
                "producer_local_profile",
                "local-profile-01",
            ),
            countryId = "country.nl",
            observedPlayerName = "Synthetic Racer",
            occurredAtMs = 1_786_900_000_000,
            createdAtMs = 1_786_900_060_000,
            producerVersion = "android-migration-test",
            localRecordId = "local-record-01",
        ),
        mode = 200,
        timeDigits = "123456",
    )

    private fun scanSubmission() = createAndroidScanSubmission(
        observation = AcceptedPlayerScanObservation(
            totalTime = "1:46.784",
            lapTimes = listOf("0:37.121", "0:35.399", "0:34.264"),
            lapSumAccepted = true,
            observedPlayerName = "Synthetic Scan",
            capturedAtMs = 1_786_900_100_000,
        ),
        context = AndroidScanSubmissionContext(
            submissionId = "user_submission.time.ANDROIDOUTBOXSCAN01",
            revision = 2,
            mode = 150,
            trackId = "track.mario_kart_stadium",
            playerReference = ScanPlayerReferenceV1(
                "unresolved_observation",
                "synthetic-scan",
            ),
            createdAtMs = 1_786_900_160_000,
            producerVersion = "android-outbox-test",
        ),
        assets = object : ScanLegacyAssetResolver {
            override fun resolveTire(index: Int): String? = null
            override fun resolveCountry(index: Int): String? = null
        },
    )

    @Test
    fun derivesTheLanguageNeutralEntryKey() {
        assertEquals(
            "670c54bf140b7fa905dee4ecbc78f49ac663bbb7e893aa8ca5ae4ffd8537e7d3",
            androidLocalOutboxEntryKey("user_submission.time.ANDROIDLOCAL0001", 1),
        )
    }

    @Test
    fun preservesExplicitEphemeralScanClassificationInTheSavedResultIndex() {
        val fixture = fixture()
        val host = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_170_000 },
        )

        host.storeScan(
            scanSubmission().copy(
                source = scanSubmission().source.copy(kind = "android_scan_test"),
            ),
        )

        assertTrue(fixture.outbox.listIndex().single().isTestResult)
    }

    @Test
    fun readsScanEntriesWrittenBeforeCaptureLayoutWasAdded() {
        val fixture = fixture()
        val current = scanSubmission()
        val currentJson = Json.parseToJsonElement(
            encodeAndroidScanSubmission(current),
        ).jsonObject
        val legacySource = JsonObject(currentJson.getValue("source").jsonObject - "captureLayout")
        val legacyJson = JsonObject(currentJson + ("source" to legacySource))

        fixture.outbox.create(
            AndroidCanonicalSubmissionPayload(
                current.submissionId,
                current.revision,
                legacyJson.toString(),
            ),
            createdAtMs = 1_786_900_170_000,
        )

        val indexed = fixture.outbox.listIndex().single()
        assertEquals(AndroidOutboxStoredState.PENDING, indexed.storedState)
        assertEquals(
            AndroidLocalOutboxPlayerReferenceV1("unresolved_observation", "synthetic-scan"),
            indexed.playerReference,
        )
    }

    @Test
    fun storesAnImmutablePendingManualEntryWithoutPrivateEvidence() {
        val fixture = fixture()
        val host = AndroidOutboxSubmissionHost(fixture.outbox, AndroidOutboxClock { 1_786_900_070_000 })

        val stored = host.storeManual(manualSubmission())

        assertEquals("pending", stored.state.state)
        assertEquals(1L, stored.state.stateRevision)
        assertEquals(0L, stored.state.attemptCount)
        assertFalse(stored.entry.privateEvidencePresent)
        assertEquals("android_manual", stored.canonicalSubmission["source"]?.let {
            (it as kotlinx.serialization.json.JsonObject)["kind"]?.jsonPrimitive?.content
        })
        val entryDirectory = File(fixture.canonicalRoot, stored.entry.entryKey)
        assertTrue(File(entryDirectory, "entry.json").isFile)
        assertTrue(File(entryDirectory, "submission.json").isFile)
        assertTrue(File(entryDirectory, "states/0000000001.json").isFile)
        assertFalse(File(fixture.privateRoot, "${stored.entry.entryKey}.json").exists())
        assertEquals(stored, fixture.outbox.list("pending").single())
    }

    @Test
    fun schedulesAutomaticSynchronizationOnlyAfterTheResultIsStored() {
        val fixture = fixture()
        var scheduled = 0
        val host = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_070_000 },
            automaticSync = AndroidOutboxAutomaticSyncScheduler {
                assertEquals(1, fixture.outbox.list("pending").size)
                scheduled += 1
            },
        )

        host.storeManual(manualSubmission())

        assertEquals(1, scheduled)
    }

    @Test
    fun aSchedulerFailureNeverMakesTheDurableSaveLookFailed() {
        val fixture = fixture()
        val host = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_070_000 },
            automaticSync = AndroidOutboxAutomaticSyncScheduler { error("scheduler unavailable") },
        )

        val stored = host.storeManual(manualSubmission())

        assertEquals("pending", stored.state.state)
        assertEquals(1, fixture.outbox.list("pending").size)
    }

    @Test
    fun keepsScanEvidenceInTheSeparatePrivateRoot() {
        val fixture = fixture()
        val evidence = buildJsonObject {
            put("captureKind", "synthetic_gallery")
            put("localReference", "private://synthetic/result.png")
        }
        val host = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_170_000 },
            scanPrivateEvidence = { evidence },
        )

        val stored = host.storeScan(scanSubmission())
        val privateRecord = fixture.outbox.readPrivateEvidence(stored.entry.entryKey)

        assertTrue(stored.entry.privateEvidencePresent)
        assertEquals(evidence, privateRecord.privateEvidence)
        assertFalse(stored.canonicalSubmission.toString().contains("private://"))
        assertTrue(File(fixture.privateRoot, "${stored.entry.entryKey}.json").isFile)
        assertFalse(File(fixture.canonicalRoot, "${stored.entry.entryKey}.json").exists())
    }

    @Test
    fun bindsEachEntryToTheAccountThatCreatedItAndNeverRebindsIt() {
        val fixture = fixture()
        val slotA = "slot." + "a".repeat(32)
        val slotB = "slot." + "b".repeat(32)
        var activeSlotId: String? = slotA
        val host = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_070_000 },
            owningSlot = { activeSlotId },
        )

        val first = host.storeManual(manualSubmission())
        assertEquals(slotA, first.owner?.slotId)

        // Switching accounts must not reach backwards into stored results.
        activeSlotId = slotB
        val second = host.storeManual(
            manualSubmission().copy(submissionId = "user_submission.time.ANDROIDLOCAL0002"),
        )
        assertEquals(slotB, second.owner?.slotId)
        assertEquals(slotA, fixture.outbox.read(first.entry.entryKey).owner?.slotId)

        fixture.outbox.markFailed(first.entry.entryKey, 1, 1_786_900_080_000, "transport.failed")
        fixture.outbox.requestRetry(first.entry.entryKey, 2, 1_786_900_090_000)
        assertEquals(slotA, fixture.outbox.read(first.entry.entryKey).owner?.slotId)
        assertEquals(
            AndroidLocalOutboxPlayerReferenceV1("producer_local_profile", "local-profile-01"),
            first.owner?.playerReference,
        )
    }

    @Test
    fun readsEntriesWrittenBeforeOwnerBindingWithAnUnknownOwner() {
        val fixture = fixture()
        val host = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_070_000 },
            owningSlot = { "slot." + "a".repeat(32) },
        )
        val stored = host.storeManual(manualSubmission())
        val ownerFile = File(File(fixture.canonicalRoot, stored.entry.entryKey), "owner.json")

        assertTrue(ownerFile.delete())
        val withoutOwner = fixture.outbox.read(stored.entry.entryKey)
        assertEquals(null, withoutOwner.owner)
        assertEquals("pending", withoutOwner.state.state)

        ownerFile.writeText("{ not json at all")
        val unparsable = fixture.outbox.read(stored.entry.entryKey)
        assertEquals(null, unparsable.owner)
        // The submission's own player reference still labels the row.
        assertEquals(
            AndroidLocalOutboxPlayerReferenceV1("producer_local_profile", "local-profile-01"),
            fixture.outbox.listIndex().single().playerReference,
        )
        assertEquals(null, fixture.outbox.listIndex().single().owningSlotId)
    }

    @Test
    fun exposesOnlyCanonicalSelectionMetadataThroughTheBoundedIndexPort() {
        val fixture = fixture()
        val privateMarker = "private://synthetic/result.png"
        val host = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_170_000 },
            scanPrivateEvidence = {
                buildJsonObject {
                    put("localReference", privateMarker)
                }
            },
            owningSlot = { ownerSlotId },
        )
        val manual = host.storeManual(manualSubmission())
        val scan = host.storeScan(scanSubmission())
        val failedScan = fixture.outbox.markFailed(
            scan.entry.entryKey,
            expectedStateRevision = 1,
            attemptedAtMs = 1_786_900_180_000,
            failureCode = "api.unavailable",
        )
        val privateFile = File(fixture.privateRoot, "${scan.entry.entryKey}.json")
        val privateBytes = privateFile.readBytes()
        File(fixture.canonicalRoot, ".entry-orphan").mkdir()
        val indexPort: AndroidCanonicalOutboxIndexPort = fixture.outbox

        val entries = indexPort.listIndex().associateBy { it.entryKeyHash }

        assertEquals(2, entries.size)
        assertEquals(
            AndroidCanonicalOutboxIndexRecord(
                entryKeyHash = manual.entry.entryKey,
                createdAtMs = manual.entry.createdAtMs,
                storedState = AndroidOutboxStoredState.PENDING,
                stateRevision = 1,
                attemptCount = 0,
                owningSlotId = ownerSlotId,
                playerReference = AndroidLocalOutboxPlayerReferenceV1(
                    "producer_local_profile",
                    "local-profile-01",
                ),
            ),
            entries.getValue(manual.entry.entryKey),
        )
        assertEquals(
            AndroidCanonicalOutboxIndexRecord(
                entryKeyHash = scan.entry.entryKey,
                createdAtMs = scan.entry.createdAtMs,
                storedState = AndroidOutboxStoredState.FAILED,
                stateRevision = failedScan.state.stateRevision,
                attemptCount = failedScan.state.attemptCount,
                failureCode = "api.unavailable",
                owningSlotId = ownerSlotId,
                playerReference = AndroidLocalOutboxPlayerReferenceV1(
                    "unresolved_observation",
                    "synthetic-scan",
                ),
            ),
            entries.getValue(scan.entry.entryKey),
        )
        assertFalse(entries.toString().contains(privateMarker))
        assertFalse(entries.toString().contains("submissionId"))
        assertFalse(entries.toString().contains("privateEvidencePresent"))
        assertTrue(privateBytes.contentEquals(privateFile.readBytes()))
    }

    @Test
    fun boundedIndexRejectsAnOversizedRootBeforeReadingPartialEntries() {
        val fixture = fixture()
        repeat(ANDROID_OUTBOX_INDEX_MAX_ENTRIES + 1) { index ->
            assertTrue(
                File(fixture.canonicalRoot, index.toString(16).padStart(64, '0')).mkdir(),
            )
        }

        assertThrows(AndroidLocalOutboxValidationException::class.java) {
            fixture.outbox.listIndex()
        }
    }

    @Test
    fun appendsFailedRetryAndSyncedStatesExplicitly() {
        val fixture = fixture()
        val record = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_070_000 },
        ).storeManual(manualSubmission())

        val failed = fixture.outbox.markFailed(
            record.entry.entryKey,
            expectedStateRevision = 1,
            attemptedAtMs = 1_786_900_080_000,
            failureCode = "api.unavailable",
        )
        val pending = fixture.outbox.requestRetry(
            record.entry.entryKey,
            expectedStateRevision = 2,
            requestedAtMs = 1_786_900_090_000,
        )
        val synced = fixture.outbox.markSynced(
            record.entry.entryKey,
            expectedStateRevision = 3,
            attemptedAtMs = 1_786_900_100_000,
            feedback = buildJsonObject { put("rank", buildJsonObject { put("after", 2) }) },
        )
        assertEquals(
            buildJsonObject { put("rank", buildJsonObject { put("after", 2) }) },
            fixture.outbox.read(record.entry.entryKey).state.feedback,
        )

        assertEquals("failed", failed.state.state)
        assertEquals("api.unavailable", failed.state.failureCode)
        assertEquals("pending", pending.state.state)
        assertEquals(1L, pending.state.attemptCount)
        assertEquals("synced", synced.state.state)
        assertEquals(2L, synced.state.attemptCount)
        assertEquals(1_786_900_100_000, synced.state.syncedAtMs)
        assertEquals(4, File(fixture.canonicalRoot, "${record.entry.entryKey}/states").listFiles()?.size)
    }

    @Test
    fun rejectsDuplicateEntriesAndStaleStateWritersWithoutOverwrite() {
        val fixture = fixture()
        val host = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_070_000 },
        )
        val record = host.storeManual(manualSubmission())
        val submissionFile = File(fixture.canonicalRoot, "${record.entry.entryKey}/submission.json")
        val originalBytes = submissionFile.readBytes()

        assertThrows(AndroidLocalOutboxConflictException::class.java) {
            host.storeManual(manualSubmission())
        }
        fixture.outbox.markFailed(record.entry.entryKey, 1, 1_786_900_080_000, "offline")
        assertThrows(AndroidLocalOutboxConflictException::class.java) {
            fixture.outbox.markSynced(record.entry.entryKey, 1, 1_786_900_080_001)
        }

        assertTrue(originalBytes.contentEquals(submissionFile.readBytes()))
        assertEquals(2L, fixture.outbox.read(record.entry.entryKey).state.stateRevision)
    }

    @Test
    fun concurrentStateWritersCannotOverwriteTheSameRevision() {
        val barrier = CyclicBarrier(2)
        val installer = AndroidExclusiveFileInstaller { source, target ->
            barrier.await(5, TimeUnit.SECONDS)
            AndroidLockedRenameExclusiveFileInstaller.install(source, target)
        }
        val fixture = fixture(installer)
        val record = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_070_000 },
        ).storeManual(manualSubmission())
        val executor = Executors.newFixedThreadPool(2)
        try {
            val futures = listOf("offline.one", "offline.two").mapIndexed { index, code ->
                executor.submit<Any> {
                    fixture.outbox.markFailed(
                        record.entry.entryKey,
                        1,
                        1_786_900_080_000 + index,
                        code,
                    )
                }
            }
            val outcomes = futures.map { future ->
                runCatching { future.get(10, TimeUnit.SECONDS) }.exceptionOrNull()?.cause
            }

            assertEquals(1, outcomes.count { it == null })
            assertEquals(1, outcomes.count { it is AndroidLocalOutboxConflictException })
            assertEquals(2L, fixture.outbox.read(record.entry.entryKey).state.stateRevision)
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun detectsCanonicalByteMutationBeforeReturningData() {
        val fixture = fixture()
        val record = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_070_000 },
        ).storeManual(manualSubmission())
        val submissionFile = File(fixture.canonicalRoot, "${record.entry.entryKey}/submission.json")
        submissionFile.appendText(" ")

        assertThrows(AndroidLocalOutboxValidationException::class.java) {
            fixture.outbox.read(record.entry.entryKey)
        }
    }

    @Test
    fun rejectsNestedCanonicalAndPrivateRoots() {
        val canonical = temporary.newFolder("canonical")
        val nested = File(canonical, "private")

        val error = assertThrows(AndroidLocalOutboxValidationException::class.java) {
            AndroidLocalTimeTrialOutbox(
                canonical,
                nested,
                AndroidProducedSubmissionValidator,
                nioInstaller,
                noDirectorySync,
            )
        }

        assertEquals("Local outbox configuration is invalid.", error.message)
    }

    @Test
    fun composesManualAndScanCallbacksIntoOneHost() {
        val fixture = fixture()
        val stored = mutableListOf<AndroidLocalOutboxRecord>()
        val host = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_200_000 },
            scanPrivateEvidence = {
                buildJsonObject { put("captureKind", "synthetic_gallery") }
            },
        )

        host.manualCallback(stored::add)(manualSubmission())
        host.scanCallback(stored::add)(scanSubmission())

        assertEquals(2, stored.size)
        assertEquals(2, fixture.outbox.list().size)
        assertEquals(setOf(false, true), stored.map { it.entry.privateEvidencePresent }.toSet())
        assertNotNull(fixture.outbox.readPrivateEvidence(stored.last().entry.entryKey))
    }

    @Test
    fun manifestAndStateMatchTheSharedJsonFixtures() {
        val fixture = fixture()
        val record = AndroidOutboxSubmissionHost(
            fixture.outbox,
            AndroidOutboxClock { 1_786_900_070_000 },
            manualPrivateEvidence = {
                buildJsonObject { put("sourceInput", "synthetic://manual") }
            },
        ).storeManual(manualSubmission())
        val entryDirectory = File(fixture.canonicalRoot, record.entry.entryKey)
        val names = listOf(
            "android-local-outbox-entry-v1.example.json" to File(entryDirectory, "entry.json"),
            "android-local-outbox-state-v1.example.json" to
                File(entryDirectory, "states/0000000001.json"),
            "android-local-private-evidence-v1.example.json" to
                File(fixture.privateRoot, "${record.entry.entryKey}.json"),
        )

        names.forEach { (resource, actual) ->
            val expected = checkNotNull(javaClass.classLoader?.getResource(resource)).readText()
            assertEquals(
                Json.parseToJsonElement(expected),
                Json.parseToJsonElement(actual.readText()),
            )
        }
    }
}
