package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.URL
import java.security.cert.Certificate
import java.util.TimeZone
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nl.mariokart8.mk8dxtimetrials.scan.AcceptedPlayerScanObservation
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanSubmissionContext
import nl.mariokart8.mk8dxtimetrials.scan.ScanLegacyAssetResolver
import nl.mariokart8.mk8dxtimetrials.scan.ScanPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.scan.createAndroidScanSubmission
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidOutboxSynchronizationSelectionScreenFilesystemDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun screenSynchronizesOneRealCanonicalEntryWithoutChangingPrivateBytes() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val canonicalRoot = File(context.filesDir, "outbox-screen-device-test-$suffix")
        val privateRoot = File(
            context.noBackupFilesDir,
            "outbox-screen-private-device-test-$suffix",
        )
        try {
            val privateMarker = "private://device/screen-result.png"
            val canonicalReference = "opaque/device-screen-result-01"
            val outbox = AndroidLocalTimeTrialOutbox(
                canonicalRoot,
                privateRoot,
                AndroidProducedSubmissionValidator,
            )
            val deviceSlotId = "slot." + "a".repeat(32)
            val pending = AndroidOutboxSubmissionHost(
                outbox,
                AndroidOutboxClock { 1_786_900_900_000 },
                scanPrivateEvidence = {
                    buildJsonObject { put("localReference", privateMarker) }
                },
                owningSlot = { deviceSlotId },
            ).storeScan(scanSubmission(canonicalReference))
            val privateFile = File(privateRoot, "${pending.entry.entryKey}.json")
            val privateBefore = privateFile.readBytes()
            val reviewed = mutableListOf<List<JsonObject>>()
            var connectionCalls = 0
            lateinit var connection: ScreenFakeHttpsURLConnection
            val screenDependencies = AndroidSavedResultSynchronizationScreenDependencyFactory(
                outbox = outbox,
                origin = "https://api.example.test",
                connectionFactoryProvider = { owningSlotId ->
                    assertEquals(deviceSlotId, owningSlotId)
                    AndroidAuthenticatedHttpsConnectionFactory { url ->
                        connectionCalls += 1
                        val acknowledgement = buildJsonObject {
                            put(
                                "submissionId",
                                pending.canonicalSubmission.getValue("submissionId"),
                            )
                            put("revision", pending.canonicalSubmission.getValue("revision"))
                        }
                        ScreenFakeHttpsURLConnection(
                            url,
                            acknowledgement.toString().toByteArray(),
                        ).also {
                            it.setRequestProperty(
                                "X-Test-Authentication",
                                "synthetic-screen-proof",
                            )
                            connection = it
                        }
                    }
                },
                reviewedEvidenceAllowlist =
                    AndroidReviewedEvidenceReferenceAllowlist { evidence ->
                        reviewed += evidence
                        true
                },
                clock = AndroidOutboxSynchronizationClock { 1_786_900_900_100 },
                accounts = AndroidOutboxAccountAvailability { _, _ -> true },
                timeZone = TimeZone.getTimeZone("UTC"),
            ).create()

            compose.setContent {
                MaterialTheme {
                    AndroidOutboxSynchronizationSelectionScreen(
                        dependencies = screenDependencies.synchronization,
                        labelProvider = screenDependencies.labelProvider,
                    )
                }
            }

            assertEquals(0, connectionCalls)
            assertEquals(emptyList<List<JsonObject>>(), reviewed)

            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Saved 2026-08-16 17:21:40")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("outbox-selection-select-0").performClick()
            compose.onNodeWithTag("outbox-synchronization-status")
                .assertTextEquals("Synchronization status not loaded")
            assertEquals(0, connectionCalls)
            assertEquals(emptyList<List<JsonObject>>(), reviewed)

            compose.onNodeWithTag("outbox-synchronization-load").performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Ready to synchronize")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("outbox-synchronization-deliver").performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Result synchronized")
                    .fetchSemanticsNodes().isNotEmpty()
            }

            compose.onNodeWithTag("outbox-synchronization-summary")
                .assertTextEquals("State revision 2 • Attempts 1")
            compose.onAllNodesWithText(pending.entry.entryKey).assertCountEquals(0)
            compose.onAllNodesWithText(privateMarker).assertCountEquals(0)
            assertEquals("synced", outbox.read(pending.entry.entryKey).state.state)
            assertEquals(
                canonicalReference,
                reviewed.single().single()["reference"]?.toString()?.trim('"'),
            )
            assertEquals(1, connectionCalls)
            assertEquals(
                "https://api.example.test/v1/time-trial-submissions?feedback=v2",
                connection.url.toString(),
            )
            assertEquals(
                "synthetic-screen-proof",
                connection.getRequestProperty("X-Test-Authentication"),
            )
            val transported = Json.parseToJsonElement(
                connection.writtenBody().decodeToString(),
            ) as JsonObject
            assertEquals(pending.canonicalSubmission, transported)
            assertFalse(reviewed.toString().contains(privateMarker))
            assertFalse(connection.writtenBody().decodeToString().contains(privateMarker))
            assertTrue(connection.disconnected)
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

    private fun scanSubmission(canonicalEvidenceReference: String) =
        createAndroidScanSubmission(
            AcceptedPlayerScanObservation(
                totalTime = "1:46.784",
                lapTimes = listOf("0:37.121", "0:35.399", "0:34.264"),
                lapSumAccepted = true,
                capturedAtMs = 1_786_900_900_000,
            ),
            AndroidScanSubmissionContext(
                submissionId = "user_submission.time.ANDROIDDEVICESCREEN01",
                revision = 1,
                mode = 150,
                trackId = "track.mario_kart_stadium",
                playerReference = ScanPlayerReferenceV1(
                    "unresolved_observation",
                    "device-screen-profile",
                ),
                createdAtMs = 1_786_900_900_000,
                producerVersion = "android-device-screen-test",
                scanResultReference = canonicalEvidenceReference,
            ),
            object : ScanLegacyAssetResolver {
                override fun resolveTire(index: Int): String? = null
                override fun resolveCountry(index: Int): String? = null
            },
        )
}

private class ScreenFakeHttpsURLConnection(
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

    override fun getCipherSuite(): String = "TLS_SYNTHETIC_SCREEN"

    override fun getLocalCertificates(): Array<Certificate>? = null

    override fun getServerCertificates(): Array<Certificate> = emptyArray()

    override fun getOutputStream(): OutputStream = output

    override fun getInputStream(): InputStream = ByteArrayInputStream(responseBody)

    override fun getResponseCode(): Int = 201

    override fun getContentType(): String = "application/json"

    override fun getContentLengthLong(): Long = responseBody.size.toLong()

    fun writtenBody(): ByteArray = output.toByteArray()
}
