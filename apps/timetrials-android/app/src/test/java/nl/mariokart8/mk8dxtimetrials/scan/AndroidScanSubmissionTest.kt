package nl.mariokart8.mk8dxtimetrials.scan

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidScanSubmissionTest {
    private val assets = Schema9ScanLegacyAssetResolver
    private val wrongTypeAssets = object : ScanLegacyAssetResolver {
        override fun resolveTire(index: Int): String? = "country.nl"
        override fun resolveCountry(index: Int): String? = "tire.azure_roller"
    }

    private fun context(
        submissionId: String = "user_submission.time.ANDROIDSCAN0001",
        revision: Int = 1,
        mode: Int = 150,
        trackId: String = "track.mario_kart_stadium",
        playerReference: ScanPlayerReferenceV1 = ScanPlayerReferenceV1(
            "producer_local_profile",
            "scan-local-profile",
        ),
        createdAtMs: Long = 1_786_900_060_000,
        producerVersion: String = "tt-scan-adapter-test",
        localRecordId: String? = "synthetic-scan-3lap",
        scanResultReference: String? = "scan-result.synthetic-3lap.json",
        scanResultSha256: String? = "a".repeat(64),
        scanResultMediaType: String? = "application/json",
    ) = AndroidScanSubmissionContext(
        submissionId,
        revision,
        mode,
        trackId,
        playerReference,
        createdAtMs,
        producerVersion,
        localRecordId,
        scanResultReference,
        scanResultSha256,
        scanResultMediaType,
    )

    private fun threeLapObservation() = AcceptedPlayerScanObservation(
        totalTime = "1:46.784",
        lapTimes = listOf("0:37.121", "0:35.399", "0:34.264"),
        lapSumAccepted = true,
        character = ScanStableIdentityObservation(
            true,
            "character_variant.yoshi.018_black",
            "character.yoshi",
            0.91,
        ),
        body = ScanStableIdentityObservation(true, "body.standard_kart", score = 0.88),
        tire = ScanLegacyIdentityObservation(true, 13, 0.85),
        glider = ScanStableIdentityObservation(true, "glider.super_glider", score = 0.83),
        country = ScanLegacyIdentityObservation(true, 155, 0.95),
        observedPlayerName = "Synthetic Driver",
        capturedAtMs = 1_786_900_000_000,
    )

    private fun assertError(code: AndroidScanSubmissionErrorCode, block: () -> Any?) {
        val error = assertThrows(AndroidScanSubmissionException::class.java) {
            block()
            Unit
        }
        assertEquals(code, error.code)
        assertEquals("Android scan Time Trial input is invalid.", error.message)
    }

    private fun assertFixture(name: String, submission: AndroidScanTimeTrialSubmissionV1) {
        val expected = checkNotNull(javaClass.classLoader?.getResource(name)).readText()
        assertEquals(
            Json.parseToJsonElement(expected),
            Json.parseToJsonElement(encodeAndroidScanSubmission(submission)),
        )
    }

    @Test
    fun mapsRepresentativeThreeLapObservationWithTypedAssetsAndEvidence() {
        val submission = createAndroidScanSubmission(threeLapObservation(), context(), assets)

        assertEquals("android_scan", submission.source.kind)
        assertEquals(106_784L, submission.totalTimeMs)
        assertEquals("character.yoshi", submission.loadout?.characterId)
        assertEquals("tire.azure_roller", submission.loadout?.tireId)
        assertEquals("country.nl", submission.countryId)
        assertFixture("android-scan-3lap-submission-v1.example.json", submission)
    }

    @Test
    fun mapsRepresentativeSevenLapObservationWithoutInventingOptionalIdentity() {
        val observation = AcceptedPlayerScanObservation(
            totalTime = "1:10.128",
            lapTimes = listOf(
                "0:12.584", "0:10.100", "0:09.875", "0:09.615",
                "0:09.812", "0:09.042", "0:09.100",
            ),
            lapSumAccepted = true,
            capturedAtMs = 1_786_900_100_000,
        )
        val scanContext = context(
            submissionId = "user_submission.time.ANDROIDSCAN0002",
            mode = 200,
            trackId = "track.baby_park",
            playerReference = ScanPlayerReferenceV1(
                "unresolved_observation",
                "synthetic-scan-player",
            ),
            createdAtMs = 1_786_900_160_000,
            localRecordId = "synthetic-scan-7lap",
            scanResultReference = null,
            scanResultSha256 = null,
            scanResultMediaType = null,
        )
        val submission = createAndroidScanSubmission(observation, scanContext, assets)

        assertNull(submission.loadout)
        assertNull(submission.countryId)
        assertNull(submission.observedPlayerName)
        assertEquals(7, submission.laps.size)
        assertFixture("android-scan-7lap-submission-v1.example.json", submission)
    }

    @Test
    fun rejectsNonAcceptedOrMismatchingLapEvidence() {
        assertError(AndroidScanSubmissionErrorCode.LAP_SUM_MISMATCH) {
            createAndroidScanSubmission(
                threeLapObservation().copy(lapSumAccepted = false),
                context(),
                assets,
            )
        }
        assertError(AndroidScanSubmissionErrorCode.LAP_SUM_MISMATCH) {
            createAndroidScanSubmission(
                threeLapObservation().copy(lapTimes = listOf("0:37.122", "0:35.399", "0:34.264")),
                context(),
                assets,
            )
        }
    }

    @Test
    fun rejectsMalformedTimesAndUnsupportedLapCounts() {
        listOf("1:60.000", "1:2.000", "0:00.000", "10:00.000").forEach { value ->
            assertError(AndroidScanSubmissionErrorCode.INVALID_TIME_FIELDS) {
                createAndroidScanSubmission(threeLapObservation().copy(totalTime = value), context(), assets)
            }
        }
        assertError(AndroidScanSubmissionErrorCode.INVALID_TIME_FIELDS) {
            createAndroidScanSubmission(
                threeLapObservation().copy(lapTimes = listOf("0:53.392", "0:53.392")),
                context(),
                assets,
            )
        }
    }

    @Test
    fun omitsRejectedRecognitionSlotsEvenWhenTheirPayloadIsMalformed() {
        val observation = threeLapObservation().copy(
            character = ScanStableIdentityObservation(false, "raw-name", score = 9.0),
            tire = ScanLegacyIdentityObservation(false, -1, 9.0),
            country = ScanLegacyIdentityObservation(false, -1, 9.0),
        )
        val submission = createAndroidScanSubmission(observation, context(), assets)

        assertNull(submission.loadout?.characterId)
        assertNull(submission.loadout?.characterVariantId)
        assertNull(submission.loadout?.tireId)
        assertNull(submission.countryId)
    }

    @Test
    fun requiresVariantFamiliesAndTypedKnownLegacyAssets() {
        assertError(AndroidScanSubmissionErrorCode.INVALID_IDENTITY) {
            createAndroidScanSubmission(
                threeLapObservation().copy(
                    character = ScanStableIdentityObservation(
                        true,
                        "character_variant.yoshi.018_black",
                        familyId = null,
                    ),
                ),
                context(),
                assets,
            )
        }
        assertError(AndroidScanSubmissionErrorCode.UNKNOWN_LEGACY_ASSET) {
            createAndroidScanSubmission(
                threeLapObservation().copy(tire = ScanLegacyIdentityObservation(true, 404)),
                context(),
                assets,
            )
        }
        assertError(AndroidScanSubmissionErrorCode.INVALID_IDENTITY) {
            createAndroidScanSubmission(
                threeLapObservation().copy(tire = ScanLegacyIdentityObservation(true, 99)),
                context(),
                wrongTypeAssets,
            )
        }
    }

    @Test
    fun validatesContextAndEvidenceWithoutEchoingValues() {
        val cases = listOf(
            AndroidScanSubmissionErrorCode.INVALID_SUBMISSION_ID to context(submissionId = "raw"),
            AndroidScanSubmissionErrorCode.INVALID_REVISION to context(revision = 0),
            AndroidScanSubmissionErrorCode.INVALID_MODE to context(mode = 100),
            AndroidScanSubmissionErrorCode.INVALID_TRACK to context(trackId = "00_MarioKartStadium"),
            AndroidScanSubmissionErrorCode.INVALID_PLAYER_REFERENCE to context(
                playerReference = ScanPlayerReferenceV1("player", "raw"),
            ),
            AndroidScanSubmissionErrorCode.INVALID_TIMESTAMPS to context(createdAtMs = -1),
            AndroidScanSubmissionErrorCode.INVALID_SOURCE to context(producerVersion = ""),
            AndroidScanSubmissionErrorCode.INVALID_SOURCE to context(localRecordId = ""),
            AndroidScanSubmissionErrorCode.INVALID_EVIDENCE to context(scanResultSha256 = "bad"),
            AndroidScanSubmissionErrorCode.INVALID_EVIDENCE to context(scanResultMediaType = "JSON"),
        )
        cases.forEach { (code, invalidContext) ->
            assertError(code) { createAndroidScanSubmission(threeLapObservation(), invalidContext, assets) }
        }
        assertError(AndroidScanSubmissionErrorCode.INVALID_EVIDENCE) {
            createAndroidScanSubmission(
                threeLapObservation(),
                context(scanResultReference = null, scanResultSha256 = "a".repeat(64)),
                assets,
            )
        }
    }

    @Test
    fun validatesObservedMetadataAndAcceptedConfidence() {
        assertError(AndroidScanSubmissionErrorCode.INVALID_NAME) {
            createAndroidScanSubmission(
                threeLapObservation().copy(observedPlayerName = ""),
                context(),
                assets,
            )
        }
        assertError(AndroidScanSubmissionErrorCode.INVALID_NAME) {
            createAndroidScanSubmission(
                threeLapObservation().copy(observedPlayerName = "😀".repeat(65)),
                context(),
                assets,
            )
        }
        assertError(AndroidScanSubmissionErrorCode.INVALID_TIMESTAMPS) {
            createAndroidScanSubmission(
                threeLapObservation().copy(capturedAtMs = -1),
                context(),
                assets,
            )
        }
        assertError(AndroidScanSubmissionErrorCode.INVALID_IDENTITY) {
            createAndroidScanSubmission(
                threeLapObservation().copy(
                    body = ScanStableIdentityObservation(
                        accepted = true,
                        assetId = "body.standard_kart",
                        score = Double.NaN,
                    ),
                ),
                context(),
                assets,
            )
        }
    }

    @Test
    fun preservesEveryPlayerNamespaceAndObservedTextWithoutReconciliation() {
        listOf(
            ScanPlayerReferenceV1("player", "player.synthetic_scan_01"),
            ScanPlayerReferenceV1("legacy_firebase_user", "legacy-hash"),
            ScanPlayerReferenceV1("producer_local_profile", "local-profile"),
            ScanPlayerReferenceV1("unresolved_observation", "ocr-observation"),
        ).forEach { reference ->
            val submission = createAndroidScanSubmission(
                threeLapObservation().copy(observedPlayerName = "Same Name"),
                context(playerReference = reference),
                assets,
            )
            assertEquals(reference, submission.playerReference)
            assertEquals("Same Name", submission.observedPlayerName)
        }
    }
}
