package nl.mariokart8.mk8dxtimetrials.outbox

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import nl.mariokart8.mk8dxtimetrials.carry.AndroidCarriedFromV1
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.manual.encodeAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** ADR-0225 amendment 3: the receiving community's answers to a carried copy it already has. */
class AndroidCarriedAnswersTest {
    @get:Rule val temporary = TemporaryFolder()
    private val slot = "slot." + "b".repeat(32)

    private fun submission(carried: Boolean) = createAndroidManualSubmission(
        AndroidManualSubmissionContext(
            submissionId = "user_submission.time.CARRIEDANSWER1",
            revision = 1,
            trackId = "track.mario_kart_stadium",
            playerReference = ManualPlayerReferenceV1("player", "player.receiver"),
            createdAtMs = 1_000,
            producerVersion = "android-test",
        ),
        150,
        "130000",
    ).let {
        if (carried) it.copy(carriedFrom = AndroidCarriedFromV1("https://club.example", null, "user_submission.time.ORIGINAL0001", 900)) else it
    }

    private fun json(carried: Boolean): JsonObject =
        Json.parseToJsonElement(encodeAndroidManualSubmission(submission(carried))).jsonObject

    private fun answering(status: Int, body: String, contentType: String? = null) =
        createAndroidCanonicalSubmissionRequestTransport {
            AndroidCanonicalSubmissionResponse(status, contentType, null, body.toByteArray())
        }

    @Test fun `a duplicate or nothing to fill is done for a carried copy`() {
        for (code in listOf("carried_duplicate", "carried_nothing_to_fill")) {
            val ack = answering(409, """{"code":"$code"}""").submit(json(carried = true))
            val outcome = androidCarriedOutcomeOrNull(ack["carried"])!!
            assertTrue(outcome.alreadyThere)
        }
    }

    @Test fun `a 409 for an ordinary run is still a conflict`() {
        val failure = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
            answering(409, """{"code":"carried_duplicate"}""").submit(json(carried = false))
        }
        assertEquals(ANDROID_CANONICAL_TRANSPORT_REVISION_CONFLICT, failure.failureCode)
        val other = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
            answering(409, """{"code":"something_else"}""").submit(json(carried = true))
        }
        assertEquals(ANDROID_CANONICAL_TRANSPORT_REVISION_CONFLICT, other.failureCode)
    }

    @Test fun `a filled equal run counts as sent and names its fields`() {
        val ack = answering(
            200,
            """{"schemaVersion":"mk8dx.carried-fill.v1","submissionId":"user_submission.time.EXISTING0001","filledFields":["characterId","characterVariantId","laps","nonsense"]}""",
            "application/json",
        ).submit(json(carried = true))
        val outcome = androidCarriedOutcomeOrNull(ack["carried"])!!
        assertFalse(outcome.alreadyThere)
        assertEquals(listOf("characterId", "characterVariantId", "laps"), outcome.filledFields)
        assertEquals("Filled in: character, lap times", androidCarriedOutcomeText(AndroidProductLanguage.ENGLISH, outcome))
        assertEquals("Aangevuld: personage, rondetijden", androidCarriedOutcomeText(AndroidProductLanguage.DUTCH, outcome))
        val invalid = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
            answering(200, """{"schemaVersion":"other"}""", "application/json").submit(json(carried = true))
        }
        assertEquals(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID, invalid.failureCode)
    }

    @Test fun `delivered as already there it is synced, not counted and shown as Already there`() {
        val outbox = AndroidLocalTimeTrialOutbox(
            File(temporary.root, "canonical"), File(temporary.root, "evidence"), AndroidProducedSubmissionValidator,
        )
        val stored = outbox.create(
            AndroidCanonicalSubmissionPayload("user_submission.time.CARRIEDANSWER1", 1, encodeAndroidManualSubmission(submission(true))),
            createdAtMs = 1_000,
            owningSlotId = slot,
        )
        val delivery = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            { answering(409, """{"code":"carried_duplicate"}""") },
            { true },
        )
        val record = delivery.deliver(stored.entry.entryKey, 2_000)
        assertEquals("synced", record.state.state)
        val entry = outbox.listIndex().single()
        assertFalse(androidOutboxCountsAsUnsent(entry.storedState, entry.failureCode))
        assertTrue(entry.carriedOutcome!!.alreadyThere)
        assertEquals("Already there", androidCarriedOutcomeText(AndroidProductLanguage.ENGLISH, entry.carriedOutcome!!))
    }
}
