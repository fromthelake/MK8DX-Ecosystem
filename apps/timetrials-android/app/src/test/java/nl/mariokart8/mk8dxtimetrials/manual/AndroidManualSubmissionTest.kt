package nl.mariokart8.mk8dxtimetrials.manual

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidManualSubmissionTest {
    private fun context(
        submissionId: String = "user_submission.time.ANDROIDLOCAL0001",
        revision: Int = 1,
        trackId: String = "track.mario_kart_stadium",
        playerReference: ManualPlayerReferenceV1 = ManualPlayerReferenceV1(
            "producer_local_profile",
            "local-profile-01",
        ),
        countryId: String? = "country.nl",
        observedPlayerName: String? = "Synthetic Racer",
        occurredAtMs: Long? = 1_786_900_000_000,
        createdAtMs: Long = 1_786_900_060_000,
        producerVersion: String = "android-migration-test",
        localRecordId: String? = "local-record-01",
    ) = AndroidManualSubmissionContext(
        submissionId = submissionId,
        revision = revision,
        trackId = trackId,
        playerReference = playerReference,
        countryId = countryId,
        observedPlayerName = observedPlayerName,
        occurredAtMs = occurredAtMs,
        createdAtMs = createdAtMs,
        producerVersion = producerVersion,
        localRecordId = localRecordId,
    )

    private fun assertError(
        expected: AndroidManualSubmissionErrorCode,
        block: () -> Any?,
    ) {
        val error = assertThrows(AndroidManualSubmissionException::class.java) {
            block()
            Unit
        }
        assertEquals(expected, error.code)
        assertEquals("Android manual Time Trial input is invalid.", error.message)
    }

    @Test
    fun parsesExactDisplayedTimeDigits() {
        assertEquals(83_456, parseAndroidManualTimeDigits("123456"))
        assertEquals(599_999, parseAndroidManualTimeDigits("959999"))
    }

    @Test
    fun rejectsMalformedZeroAndInvalidSecondTimesUniformly() {
        listOf("", "12345", "1234567", "12A456", "060000", "000000").forEach {
            assertError(AndroidManualSubmissionErrorCode.INVALID_TIME) {
                parseAndroidManualTimeDigits(it)
            }
        }
    }

    @Test
    fun createsAnAndroidManualV1WithoutLaps() {
        val playerReference = ManualPlayerReferenceV1(
            namespace = "producer_local_profile",
            value = "local-profile-01",
        )
        val submission = createAndroidManualSubmission(
            context(playerReference = playerReference),
            mode = 200,
            timeDigits = "123456",
        )

        assertEquals("mk8dx.time-trial-submission.v1", submission.schemaVersion)
        assertEquals("android_manual", submission.source.kind)
        assertEquals(83_456, submission.totalTimeMs)
        assertEquals(emptyList<ManualLapV1>(), submission.laps)
        assertEquals(playerReference, submission.playerReference)
        assertNotSame(playerReference, submission.playerReference)
    }

    @Test
    fun serializedOutputMatchesTheCrossLanguageContractFixture() {
        val submission = createAndroidManualSubmission(
            context = context(),
            mode = 200,
            timeDigits = "123456",
        )
        val expected = checkNotNull(
            javaClass.classLoader?.getResource(
                "android-manual-submission-v1.example.json",
            ),
        ).readText()

        assertEquals(
            Json.parseToJsonElement(expected),
            Json.parseToJsonElement(encodeAndroidManualSubmission(submission)),
        )
    }

    @Test
    fun omitsAbsentOptionalValuesRatherThanWritingNulls() {
        val submission = createAndroidManualSubmission(
            context = context(
                countryId = null,
                observedPlayerName = null,
                occurredAtMs = null,
                localRecordId = null,
            ),
            mode = 150,
            timeDigits = "100001",
        )
        val json = Json.parseToJsonElement(encodeAndroidManualSubmission(submission)).toString()

        assertEquals(false, json.contains("countryId"))
        assertEquals(false, json.contains("observedPlayerName"))
        assertEquals(false, json.contains("occurredAtMs"))
        assertEquals(false, json.contains("localRecordId"))
    }

    @Test
    fun serializesOptionalLapCoinsAndKartSetupUsingTheCanonicalFields() {
        val submission = createAndroidManualSubmission(
            context = context(),
            mode = 150,
            timeDigits = "130000",
        ).copy(
            laps = listOf(
                ManualLapV1(1, 30_000, 4, 1),
                ManualLapV1(2, 30_000, null),
                ManualLapV1(3, 30_000, 3, 2),
            ),
            loadout = ManualLoadoutV1(
                characterId = "character.mario",
                bodyId = "body.standard_kart",
                tireId = "tire.standard",
                gliderId = "glider.super_glider",
            ),
        )

        val json = Json.parseToJsonElement(encodeAndroidManualSubmission(submission)).jsonObject

        assertEquals("4", json.getValue("laps").jsonArray[0].jsonObject.getValue("coinsCollected").jsonPrimitive.content)
        assertEquals("1", json.getValue("laps").jsonArray[0].jsonObject.getValue("mushroomsUsed").jsonPrimitive.content)
        assertEquals(false, json.getValue("laps").jsonArray[1].jsonObject.containsKey("coinsCollected"))
        assertEquals("2", json.getValue("laps").jsonArray[2].jsonObject.getValue("mushroomsUsed").jsonPrimitive.content)
        assertEquals("character.mario", json.getValue("loadout").jsonObject.getValue("characterId").jsonPrimitive.content)
        assertEquals("body.standard_kart", json.getValue("loadout").jsonObject.getValue("bodyId").jsonPrimitive.content)
        assertEquals("tire.standard", json.getValue("loadout").jsonObject.getValue("tireId").jsonPrimitive.content)
        assertEquals("glider.super_glider", json.getValue("loadout").jsonObject.getValue("gliderId").jsonPrimitive.content)
    }

    @Test
    fun acceptsEachContractPlayerNamespaceWithoutReconcilingIt() {
        listOf(
            ManualPlayerReferenceV1("player", "player.synthetic_android_01"),
            ManualPlayerReferenceV1("legacy_firebase_user", "legacy-hash"),
            ManualPlayerReferenceV1("producer_local_profile", "local-profile"),
            ManualPlayerReferenceV1("unresolved_observation", "observed-name"),
        ).forEach { reference ->
            val submission = createAndroidManualSubmission(
                context = context(playerReference = reference),
                mode = 150,
                timeDigits = "123456",
            )
            assertEquals(reference, submission.playerReference)
        }
    }

    @Test
    fun reportsEachInvalidContextCategoryWithoutEchoingInput() {
        val cases = listOf(
            AndroidManualSubmissionErrorCode.INVALID_SUBMISSION_ID to
                { createAndroidManualSubmission(context(submissionId = "raw"), 150, "123456") },
            AndroidManualSubmissionErrorCode.INVALID_REVISION to
                { createAndroidManualSubmission(context(revision = 0), 150, "123456") },
            AndroidManualSubmissionErrorCode.INVALID_MODE to
                { createAndroidManualSubmission(context(), 100, "123456") },
            AndroidManualSubmissionErrorCode.INVALID_TRACK to
                { createAndroidManualSubmission(context(trackId = "00_MarioKartStadium"), 150, "123456") },
            AndroidManualSubmissionErrorCode.INVALID_PLAYER_REFERENCE to
                {
                    createAndroidManualSubmission(
                        context(playerReference = ManualPlayerReferenceV1("player", "not-player")),
                        150,
                        "123456",
                    )
                },
            AndroidManualSubmissionErrorCode.INVALID_COUNTRY to
                { createAndroidManualSubmission(context(countryId = "country.NL"), 150, "123456") },
            AndroidManualSubmissionErrorCode.INVALID_OBSERVED_NAME to
                { createAndroidManualSubmission(context(observedPlayerName = ""), 150, "123456") },
            AndroidManualSubmissionErrorCode.INVALID_TIMESTAMPS to
                { createAndroidManualSubmission(context(createdAtMs = -1), 150, "123456") },
            AndroidManualSubmissionErrorCode.INVALID_SOURCE to
                { createAndroidManualSubmission(context(producerVersion = ""), 150, "123456") },
        )

        cases.forEach { (code, block) -> assertError(code, block) }
    }

    @Test
    fun countsUnicodeCodePointsForContractStringBounds() {
        val sixtyFourSupplementaryCharacters = "😀".repeat(64)
        createAndroidManualSubmission(
            context = context(observedPlayerName = sixtyFourSupplementaryCharacters),
            mode = 150,
            timeDigits = "123456",
        )

        assertError(AndroidManualSubmissionErrorCode.INVALID_OBSERVED_NAME) {
            createAndroidManualSubmission(
                context = context(observedPlayerName = "😀".repeat(65)),
                mode = 150,
                timeDigits = "123456",
            )
        }
    }
}
