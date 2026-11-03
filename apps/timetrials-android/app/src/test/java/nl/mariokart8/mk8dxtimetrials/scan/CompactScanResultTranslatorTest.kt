package nl.mariokart8.mk8dxtimetrials.scan

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class CompactScanResultTranslatorTest {
    private val stableAssets = object : ScanStableAssetResolver {
        private val records = mapOf(
            "character.mario" to ScanStableAssetRecord(ScanStableAssetType.CHARACTER),
            "character.yoshi" to ScanStableAssetRecord(ScanStableAssetType.CHARACTER),
            "character_variant.yoshi.018_black" to ScanStableAssetRecord(
                ScanStableAssetType.CHARACTER_VARIANT,
                "character.yoshi",
            ),
            "body.standard_kart" to ScanStableAssetRecord(ScanStableAssetType.BODY),
            "glider.super_glider" to ScanStableAssetRecord(ScanStableAssetType.GLIDER),
        )

        override fun resolve(assetId: String): ScanStableAssetRecord? = records[assetId]
    }

    private fun resource(name: String): String = checkNotNull(
        javaClass.classLoader?.getResource(name),
    ).readText()

    private fun context(
        sevenLaps: Boolean = false,
    ) = AndroidScanSubmissionContext(
        submissionId = if (sevenLaps) {
            "user_submission.time.ANDROIDSCAN0002"
        } else {
            "user_submission.time.ANDROIDSCAN0001"
        },
        revision = 1,
        mode = if (sevenLaps) 200 else 150,
        trackId = if (sevenLaps) "track.baby_park" else "track.mario_kart_stadium",
        playerReference = if (sevenLaps) {
            ScanPlayerReferenceV1("unresolved_observation", "synthetic-scan-player")
        } else {
            ScanPlayerReferenceV1("producer_local_profile", "scan-local-profile")
        },
        createdAtMs = if (sevenLaps) 1_786_900_160_000 else 1_786_900_060_000,
        producerVersion = "tt-scan-adapter-test",
        localRecordId = if (sevenLaps) "synthetic-scan-7lap" else "synthetic-scan-3lap",
        scanResultReference = if (sevenLaps) null else "scan-result.synthetic-3lap.json",
        scanResultSha256 = if (sevenLaps) null else "a".repeat(64),
        scanResultMediaType = if (sevenLaps) null else "application/json",
    )

    private fun assertCompactError(code: CompactScanResultErrorCode, value: String) {
        val error = assertThrows(CompactScanResultException::class.java) {
            translateCompactPlayerScanResult(value, stableAssets)
        }
        assertEquals(code, error.code)
        assertEquals("TT Scan compact result is invalid.", error.message)
    }

    private fun assertOutputFixture(name: String, submission: AndroidScanTimeTrialSubmissionV1) {
        assertEquals(
            Json.parseToJsonElement(resource(name)),
            Json.parseToJsonElement(encodeAndroidScanSubmission(submission)),
        )
    }

    @Test
    fun translatesSourceShapedThreeLapResultThroughCanonicalAdapter() {
        val compact = resource("tt-scan-compact-3lap-result.example.json")
        val submission = createAndroidScanSubmissionFromCompactResult(
            compact,
            context(),
            stableAssets,
        )

        assertEquals("character.yoshi", submission.loadout?.characterId)
        assertEquals(
            "character_variant.yoshi.018_black",
            submission.loadout?.characterVariantId,
        )
        assertEquals("tire.azure_roller", submission.loadout?.tireId)
        assertEquals("country.nl", submission.countryId)
        assertOutputFixture("android-scan-3lap-submission-v1.example.json", submission)
        assertFalse(encodeAndroidScanSubmission(submission).contains("ghost"))
        assertFalse(encodeAndroidScanSubmission(submission).contains("crop_path"))
    }

    @Test
    fun defaultSchema9ResolversTranslateTheCompactBoundary() {
        val submission = createAndroidScanSubmissionFromCompactResult(
            resource("tt-scan-compact-3lap-result.example.json"),
            context(),
        )

        assertEquals("character.yoshi", submission.loadout?.characterId)
        assertEquals("body.standard_kart", submission.loadout?.bodyId)
        assertEquals("glider.super_glider", submission.loadout?.gliderId)
        assertEquals("tire.azure_roller", submission.loadout?.tireId)
        assertEquals("country.nl", submission.countryId)
    }

    @Test
    fun translatesSevenLapPlayerFieldsWithoutInventingIdentityFromGhost() {
        val submission = createAndroidScanSubmissionFromCompactResult(
            resource("tt-scan-compact-7lap-result.example.json"),
            context(sevenLaps = true),
            stableAssets,
        )

        assertNull(submission.loadout)
        assertNull(submission.observedPlayerName)
        assertEquals(7, submission.laps.size)
        assertOutputFixture("android-scan-7lap-submission-v1.example.json", submission)
    }

    @Test
    fun rejectsInvalidJsonUnlockedAndGhostOnlyResults() {
        assertCompactError(CompactScanResultErrorCode.INVALID_JSON, "not-json")
        assertCompactError(CompactScanResultErrorCode.INVALID_JSON, "[]")
        assertCompactError(
            CompactScanResultErrorCode.UNLOCKED_RESULT,
            """{"locked":false,"fields":{},"timestamp_ms":1}""",
        )
        assertCompactError(
            CompactScanResultErrorCode.MISSING_PLAYER_RESULT,
            """{"locked":true,"fields":{"ghost_total":"1:00.000"},"timestamp_ms":1}""",
        )
    }

    @Test
    fun rejectsGappedLapsAndWrongPrimitiveTypes() {
        assertCompactError(
            CompactScanResultErrorCode.INVALID_PLAYER_FIELDS,
            """{"locked":true,"fields":{"player_total":"1:00.000","player_lap_1":"0:20.000","player_lap_3":"0:40.000"},"timestamp_ms":1}""",
        )
        assertCompactError(
            CompactScanResultErrorCode.INVALID_PLAYER_FIELDS,
            """{"locked":true,"fields":{"player_total":"1:00.000","player_lap_1":"0:20.000","player_lap_2":"0:20.000","player_lap_3":"0:20.000","player_lap_8":"0:00.000"},"timestamp_ms":1}""",
        )
        assertCompactError(
            CompactScanResultErrorCode.INVALID_SHAPE,
            """{"locked":"true","fields":{},"timestamp_ms":1}""",
        )
        assertCompactError(
            CompactScanResultErrorCode.INVALID_PLAYER_FIELDS,
            """{"locked":true,"fields":{"player_total":60000,"player_lap_1":"0:20.000","player_lap_2":"0:20.000","player_lap_3":"0:20.000"},"timestamp_ms":1}""",
        )
    }

    @Test
    fun rejectsAcceptedIdentityWithUnknownTypeParentOrStringNumber() {
        val template = resource("tt-scan-compact-3lap-result.example.json")
        assertCompactError(
            CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY,
            template.replace("body.standard_kart", "tire.azure_roller"),
        )
        val missingParentAssets = object : ScanStableAssetResolver {
            override fun resolve(assetId: String): ScanStableAssetRecord? =
                if (assetId == "character_variant.yoshi.018_black") {
                    ScanStableAssetRecord(ScanStableAssetType.CHARACTER_VARIANT)
                } else {
                    stableAssets.resolve(assetId)
                }
        }
        val error = assertThrows(CompactScanResultException::class.java) {
            translateCompactPlayerScanResult(template, missingParentAssets)
        }
        assertEquals(CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY, error.code)
        assertCompactError(
            CompactScanResultErrorCode.INVALID_PLAYER_IDENTITY,
            template.replace("\"index\": 13", "\"index\": \"13\""),
        )
    }

    @Test
    fun rejectedIdentitySlotsDoNotResolveOrPropagateTheirPayload() {
        val compact = resource("tt-scan-compact-3lap-result.example.json")
            .replace(
                """"id": "body.standard_kart",
        "score": 0.88,
        "ok": true""",
                """"id": 44,
        "score": "wrong",
        "ok": false""",
            )
        val observation = translateCompactPlayerScanResult(compact, stableAssets)

        assertEquals(false, observation.body?.accepted)
    }

    @Test
    fun endToEndTranslationStillFailsClosedOnLapSumMismatch() {
        val compact = resource("tt-scan-compact-3lap-result.example.json")
            .replace("0:37.121", "0:37.122")
        val error = assertThrows(AndroidScanSubmissionException::class.java) {
            createAndroidScanSubmissionFromCompactResult(compact, context(), stableAssets)
        }
        assertEquals(AndroidScanSubmissionErrorCode.LAP_SUM_MISMATCH, error.code)
    }
}
