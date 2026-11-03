package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
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
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidLocalTimeTrialOutboxDeviceTest {
    private val deviceSlotId = "slot." + "a".repeat(32)

    @Test
    fun appOwnedRootsPersistCallbacksWithLockedAtomicInstallation() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val canonicalRoot = File(context.filesDir, "outbox-device-test-$suffix")
        val privateRoot = File(context.noBackupFilesDir, "outbox-evidence-device-test-$suffix")
        try {
            val outbox = AndroidLocalTimeTrialOutbox(
                canonicalRoot,
                privateRoot,
                AndroidProducedSubmissionValidator,
            )
            val host = AndroidOutboxSubmissionHost(
                outbox,
                AndroidOutboxClock { 1_786_900_300_000 },
                scanPrivateEvidence = {
                    buildJsonObject { put("captureKind", "synthetic_gallery") }
                },
            )
            val records = mutableListOf<AndroidLocalOutboxRecord>()

            host.manualCallback(records::add)(manualSubmission())
            host.scanCallback(records::add)(scanSubmission())
            val failed = outbox.markFailed(
                records.first().entry.entryKey,
                1,
                1_786_900_300_100,
                "device.synthetic_failure",
            )
            val retried = outbox.requestRetry(
                records.first().entry.entryKey,
                2,
                1_786_900_300_200,
            )

            assertEquals(2, outbox.list().size)
            assertEquals("failed", failed.state.state)
            assertEquals("pending", retried.state.state)
            assertFalse(records.first().entry.privateEvidencePresent)
            assertTrue(records.last().entry.privateEvidencePresent)
            assertEquals(
                "synthetic_gallery",
                outbox.readPrivateEvidence(records.last().entry.entryKey)
                    .privateEvidence["captureKind"]
                    ?.toString()
                    ?.trim('"'),
            )
            assertTrue(canonicalRoot.canonicalPath.startsWith(context.filesDir.canonicalPath))
            assertTrue(privateRoot.canonicalPath.startsWith(context.noBackupFilesDir.canonicalPath))
        } finally {
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    @Test
    fun explicitDeliveryUsesCanonicalEvidenceAndLeavesPrivateBytesUntouched() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val canonicalRoot = File(context.filesDir, "outbox-delivery-device-test-$suffix")
        val privateRoot = File(context.noBackupFilesDir, "outbox-delivery-private-test-$suffix")
        try {
            val outbox = AndroidLocalTimeTrialOutbox(
                canonicalRoot,
                privateRoot,
                AndroidProducedSubmissionValidator,
            )
            val host = AndroidOutboxSubmissionHost(
                outbox,
                AndroidOutboxClock { 1_786_900_400_000 },
                scanPrivateEvidence = {
                    buildJsonObject { put("localReference", "private://device/result.png") }
                },
                owningSlot = { deviceSlotId },
            )
            val pending = host.storeScan(scanSubmission("opaque/device-scan-result-01"))
            val privateFile = File(privateRoot, "${pending.entry.entryKey}.json")
            val privateBefore = privateFile.readBytes()
            val reviewed = mutableListOf<List<JsonObject>>()
            val transported = mutableListOf<JsonObject>()
            val coordinator = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
                outbox,
                {
                    AndroidAuthenticatedCanonicalSubmissionTransport { submission ->
                        transported += submission
                        buildJsonObject {
                            put("submissionId", submission.getValue("submissionId"))
                            put("revision", submission.getValue("revision"))
                        }
                    }
                },
                AndroidReviewedEvidenceReferenceAllowlist { evidence ->
                    reviewed += evidence
                    true
                },
            )

            val result = coordinator.deliver(
                pending.entry.entryKey,
                1_786_900_400_100,
            )

            assertEquals("synced", result.state.state)
            assertEquals("opaque/device-scan-result-01", reviewed.single().single()["reference"]?.toString()?.trim('"'))
            assertEquals(pending.canonicalSubmission, transported.single())
            assertFalse(reviewed.toString().contains("private://"))
            assertFalse(transported.toString().contains("private://"))
            assertTrue(privateBefore.contentEquals(privateFile.readBytes()))
            assertTrue(File(canonicalRoot, "${pending.entry.entryKey}/states/0000000002.json").isFile)
        } finally {
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    @Test
    fun canonicalIndexProjectsAppOwnedEntriesWithoutPrivateContent() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val canonicalRoot = File(context.filesDir, "outbox-index-device-test-$suffix")
        val privateRoot = File(context.noBackupFilesDir, "outbox-index-private-test-$suffix")
        try {
            val privateMarker = "private://device/index-result.png"
            val outbox = AndroidLocalTimeTrialOutbox(
                canonicalRoot,
                privateRoot,
                AndroidProducedSubmissionValidator,
            )
            val host = AndroidOutboxSubmissionHost(
                outbox,
                AndroidOutboxClock { 1_786_900_500_000 },
                scanPrivateEvidence = {
                    buildJsonObject { put("localReference", privateMarker) }
                },
            )
            val manual = host.storeManual(manualSubmission())
            val scan = host.storeScan(scanSubmission())
            val failed = outbox.markFailed(
                scan.entry.entryKey,
                1,
                1_786_900_500_100,
                "device.index_failure",
            )
            val privateFile = File(privateRoot, "${scan.entry.entryKey}.json")
            val privateBefore = privateFile.readBytes()
            val indexPort: AndroidCanonicalOutboxIndexPort = outbox

            val index = indexPort.listIndex().associateBy { it.entryKeyHash }

            assertEquals(2, index.size)
            assertEquals(
                AndroidOutboxStoredState.PENDING,
                index.getValue(manual.entry.entryKey).storedState,
            )
            assertEquals(
                AndroidOutboxStoredState.FAILED,
                index.getValue(scan.entry.entryKey).storedState,
            )
            assertEquals(
                failed.state.stateRevision,
                index.getValue(scan.entry.entryKey).stateRevision,
            )
            assertEquals("device.index_failure", index.getValue(scan.entry.entryKey).failureCode)
            assertFalse(index.toString().contains(privateMarker))
            assertFalse(index.toString().contains("submissionId"))
            assertTrue(privateBefore.contentEquals(privateFile.readBytes()))
        } finally {
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    @Test
    fun explicitIndexSelectionCreatesOneOpaqueSynchronizationBinding() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val canonicalRoot = File(context.filesDir, "outbox-selection-device-test-$suffix")
        val privateRoot = File(context.noBackupFilesDir, "outbox-selection-private-test-$suffix")
        try {
            val privateMarker = "private://device/selection-result.png"
            val outbox = AndroidLocalTimeTrialOutbox(
                canonicalRoot,
                privateRoot,
                AndroidProducedSubmissionValidator,
            )
            val pending = AndroidOutboxSubmissionHost(
                outbox,
                AndroidOutboxClock { 1_786_900_600_000 },
                scanPrivateEvidence = {
                    buildJsonObject { put("localReference", privateMarker) }
                },
                owningSlot = { deviceSlotId },
            ).storeScan(scanSubmission())
            val privateFile = File(privateRoot, "${pending.entry.entryKey}.json")
            val privateBefore = privateFile.readBytes()
            val indexState = AndroidOutboxIndexController(outbox, onState = {}).load()
            val selectedKeys = mutableListOf<String>()
            val coordinator = AndroidOutboxSelectionCoordinator { entryKeyHash ->
                selectedKeys += entryKeyHash
                AndroidOutboxSynchronizationBinding(
                    AndroidOutboxSynchronizationActionsFactory { onState ->
                        AndroidOutboxSynchronizationController(
                            entryKey = entryKeyHash,
                            outbox = outbox,
                            delivery = AndroidExplicitCanonicalOutboxDeliveryAction { _, _ ->
                                error("delivery must remain explicit")
                            },
                            clock = AndroidOutboxSynchronizationClock { 1_786_900_600_100 },
                            onState = onState,
                        )
                    },
                )
            }

            val selected = coordinator.select(
                indexState = indexState,
                loadInProgress = false,
                entryKeyHash = pending.entry.entryKey,
            ) as AndroidOutboxSelectionResult.Selected
            val synchronizationStates = mutableListOf<AndroidOutboxSynchronizationState>()
            val loaded = selected.binding.actionsFactory
                .create(synchronizationStates::add)
                .load() as AndroidOutboxSynchronizationState.Ready

            assertEquals(listOf(pending.entry.entryKey), selectedKeys)
            assertEquals(AndroidOutboxStoredState.PENDING, loaded.snapshot.storedState)
            assertEquals(listOf(loaded), synchronizationStates)
            assertFalse(indexState.toString().contains(privateMarker))
            assertFalse(selected.toString().contains(privateMarker))
            assertTrue(privateBefore.contentEquals(privateFile.readBytes()))
        } finally {
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    @Test
    fun dependencyFactoryComposesExplicitIndexSelectionAndDelivery() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val canonicalRoot = File(context.filesDir, "outbox-factory-device-test-$suffix")
        val privateRoot = File(context.noBackupFilesDir, "outbox-factory-private-test-$suffix")
        try {
            val privateMarker = "private://device/factory-result.png"
            val canonicalReference = "opaque/device-factory-result-01"
            val outbox = AndroidLocalTimeTrialOutbox(
                canonicalRoot,
                privateRoot,
                AndroidProducedSubmissionValidator,
            )
            val pending = AndroidOutboxSubmissionHost(
                outbox,
                AndroidOutboxClock { 1_786_900_800_000 },
                scanPrivateEvidence = {
                    buildJsonObject { put("localReference", privateMarker) }
                },
                owningSlot = { deviceSlotId },
            ).storeScan(scanSubmission(canonicalReference))
            val privateFile = File(privateRoot, "${pending.entry.entryKey}.json")
            val privateBefore = privateFile.readBytes()
            val reviewed = mutableListOf<List<JsonObject>>()
            val transported = mutableListOf<JsonObject>()

            val dependencies = AndroidOutboxSynchronizationSelectionDependencyFactory(
                outbox = outbox,
                transportResolver = {
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
                clock = AndroidOutboxSynchronizationClock { 1_786_900_800_100 },
            ).create()

            assertEquals("pending", outbox.read(pending.entry.entryKey).state.state)
            assertEquals(
                1,
                File(canonicalRoot, "${pending.entry.entryKey}/states")
                    .listFiles()
                    .orEmpty()
                    .count { it.name.matches(Regex("^[0-9]{10}\\.json$")) },
            )
            assertEquals(emptyList<JsonObject>(), transported)
            val index = dependencies.indexBinding.actionsFactory.create().load()
                as AndroidOutboxIndexState.Ready
            val selected = dependencies.selectionCoordinator.select(
                indexState = index,
                loadInProgress = false,
                entryKeyHash = pending.entry.entryKey,
            ) as AndroidOutboxSelectionResult.Selected

            val result = selected.binding.actionsFactory.create(onState = {}).deliver()
                as AndroidOutboxSynchronizationState.Ready

            assertEquals(AndroidOutboxStoredState.SYNCED, result.snapshot.storedState)
            assertEquals(
                canonicalReference,
                reviewed.single().single()["reference"]?.toString()?.trim('"'),
            )
            assertEquals(pending.canonicalSubmission, transported.single())
            assertFalse(reviewed.toString().contains(privateMarker))
            assertFalse(transported.toString().contains(privateMarker))
            assertTrue(privateBefore.contentEquals(privateFile.readBytes()))
            assertTrue(
                File(
                    canonicalRoot,
                    "${pending.entry.entryKey}/states/0000000002.json",
                ).isFile,
            )
        } finally {
            canonicalRoot.deleteRecursively()
            privateRoot.deleteRecursively()
        }
    }

    private fun manualSubmission() = createAndroidManualSubmission(
        AndroidManualSubmissionContext(
            submissionId = "user_submission.time.ANDROIDDEVICEOUTBOX01",
            revision = 1,
            trackId = "track.mario_kart_stadium",
            playerReference = ManualPlayerReferenceV1(
                "producer_local_profile",
                "device-manual-profile",
            ),
            createdAtMs = 1_786_900_300_000,
            producerVersion = "android-device-outbox-test",
        ),
        mode = 150,
        timeDigits = "123456",
    )

    private fun scanSubmission(canonicalEvidenceReference: String? = null) = createAndroidScanSubmission(
        AcceptedPlayerScanObservation(
            totalTime = "1:46.784",
            lapTimes = listOf("0:37.121", "0:35.399", "0:34.264"),
            lapSumAccepted = true,
            capturedAtMs = 1_786_900_300_000,
        ),
        AndroidScanSubmissionContext(
            submissionId = "user_submission.time.ANDROIDDEVICEOUTBOX02",
            revision = 1,
            mode = 150,
            trackId = "track.mario_kart_stadium",
            playerReference = ScanPlayerReferenceV1(
                "unresolved_observation",
                "device-scan-profile",
            ),
            createdAtMs = 1_786_900_300_000,
            producerVersion = "android-device-outbox-test",
            scanResultReference = canonicalEvidenceReference,
        ),
        object : ScanLegacyAssetResolver {
            override fun resolveTire(index: Int): String? = null
            override fun resolveCountry(index: Int): String? = null
        },
    )
}
