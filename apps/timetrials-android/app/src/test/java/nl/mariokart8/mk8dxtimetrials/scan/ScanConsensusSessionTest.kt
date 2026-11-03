package nl.mariokart8.mk8dxtimetrials.scan

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanConsensusSessionTest {
    private val fields = linkedMapOf(
        "player_total" to "1:00.000",
        "player_lap_1" to "0:20.000",
        "player_lap_2" to "0:19.500",
        "player_lap_3" to "0:20.500",
    )

    private fun frame(
        values: Map<String, String> = fields,
        accepted: Boolean = false,
        repairs: Int = 0,
        expected: Int = 4,
        owners: Map<String, ScanIdentityOwnerFrame>? = null,
    ) = ScanConsensusFrame(values, accepted, repairs, expected, owners)

    private fun playerOwner(
        character: ScanIdentitySlotFrame = ScanIdentitySlotFrame(
            id = "character.mario",
            name = "Mario",
            score = 0.8,
            accepted = true,
        ),
        cardName: String = "Player",
    ) = mapOf(
        "player" to ScanIdentityOwnerFrame(
            cardName = cardName,
            slots = mapOf(ScanIdentityKind.CHARACTER to character),
        ),
    )

    @Test
    fun rawLapSumLocksImmediatelyAndTimeUpdatesStopAfterLock() {
        val session = ScanConsensusSession()

        assertTrue(session.consume(frame(accepted = true)))
        assertTrue(session.locked)
        assertEquals("direct_lap_som", session.acceptPath)
        assertEquals(fields, session.lockedFields)
        assertEquals(1, session.framesAnalyzed)
        assertEquals(1, session.acceptedFrames)

        assertFalse(session.consume(frame(values = mapOf("player_total" to "9:59.999"))))
        assertEquals(1, session.framesAnalyzed)
        assertEquals(fields, session.lockedFields)
    }

    @Test
    fun repairedReadRequiresAnIdenticalAcceptedFollowup() {
        val repaired = linkedMapOf(
            "player_total" to "0:30.000",
            "player_lap_1" to "0:88.000",
            "player_lap_2" to "0:22.000",
        )
        val expectedLocked = repaired + ("player_lap_1" to "0:08.000")
        val session = ScanConsensusSession()

        assertFalse(session.consume(frame(repaired, accepted = true, repairs = 1, expected = 3)))
        assertTrue(session.consume(frame(repaired, accepted = true, repairs = 1, expected = 3)))
        assertEquals("bevestigd_na_reparatie", session.acceptPath)
        assertEquals(expectedLocked, session.lockedFields)
    }

    @Test
    fun impossibleSecondsWithoutExactProofAreExcluded() {
        val session = ScanConsensusSession()
        val invalid = linkedMapOf(
            "player_total" to "0:31.000",
            "player_lap_1" to "0:88.000",
            "player_lap_2" to "0:22.000",
        )

        assertFalse(session.consume(frame(invalid, accepted = true, expected = 3)))
        assertFalse(session.locked)
        assertEquals(1, session.acceptedFrames)
    }

    @Test
    fun weightedFieldVoteUsesSourceSupportAndMargin() {
        val session = ScanConsensusSession()
        assertFalse(session.consume(frame(accepted = true, repairs = 1, expected = 4)))
        assertTrue(session.consume(frame(expected = 4)))
        assertEquals("veld_stemming", session.acceptPath)

        val contested = ScanConsensusSession()
        val alternate = fields + ("player_lap_3" to "0:20.501")
        assertFalse(contested.consume(frame(expected = 4)))
        assertFalse(contested.consume(frame(alternate, accepted = true, repairs = 1)))
        assertFalse(contested.locked)
    }

    @Test
    fun identityVotingKeepsBestMetadataAndMarksTiesUncertain() {
        val session = ScanConsensusSession()
        val first = ScanIdentitySlotFrame(
            id = "character.mario",
            name = "Mario low",
            score = 0.7,
            accepted = true,
        )
        val better = first.copy(name = "Mario best", score = 0.9)
        val rival = ScanIdentitySlotFrame(
            id = "character.luigi",
            name = "Luigi",
            score = 0.95,
            accepted = true,
        )
        session.consume(frame(owners = playerOwner(first, "BENZor")))
        session.consume(frame(owners = playerOwner(better, "BEnZor")))
        session.consume(frame(owners = playerOwner(rival, "BENZor")))
        session.consume(frame(owners = playerOwner(rival, "BEnZor")))

        val encoded = Json.parseToJsonElement(session.encodeCompactResult(10, -1)).jsonObject
        val player = encoded.getValue("identity").jsonObject.getValue("player").jsonObject
        val character = player.getValue("character").jsonObject
        assertEquals("Mario best", character.getValue("name").jsonPrimitive.content)
        assertEquals(4, character.getValue("votes").jsonPrimitive.int)
        assertFalse(character.getValue("ok").jsonPrimitive.boolean)
        assertEquals("BENZor", player.getValue("card_name").jsonPrimitive.content)
        assertFalse(session.identitySettled())
    }

    @Test
    fun identitySettlesAfterTwoUnanimousAcceptedFrames() {
        val session = ScanConsensusSession()
        assertTrue(session.consume(frame(accepted = true, owners = playerOwner())))
        assertFalse(session.identitySettled())
        assertFalse(ScanBurstPolicy.shouldStopAfterFrame(session, 0, 0))
        session.consume(frame(owners = playerOwner()))

        assertEquals(2, session.identityFrames)
        assertTrue(session.identitySettled())
        assertTrue(ScanBurstPolicy.shouldStopAfterFrame(session, 1, 0))
        assertEquals(5, ScanBurstPolicy.BURST_FRAMES)
        assertEquals(150L, ScanBurstPolicy.BURST_GAP_MS)
        assertEquals(3, ScanBurstPolicy.IDENTITY_EXTRA_FRAMES)

        val unsettled = ScanConsensusSession()
        unsettled.consume(frame(accepted = true))
        assertTrue(ScanBurstPolicy.shouldStopAfterFrame(unsettled, 3, 0))
    }

    @Test
    fun lockedCompactOutputFeedsTheStrictPlayerTranslator() {
        val owners = mapOf(
            "player" to ScanIdentityOwnerFrame(
                cardName = "Driver",
                slots = linkedMapOf(
                    ScanIdentityKind.CHARACTER to ScanIdentitySlotFrame(
                        id = "character.mario",
                        score = 0.9,
                        accepted = true,
                    ),
                    ScanIdentityKind.BODY to ScanIdentitySlotFrame(
                        id = "body.standard_kart",
                        score = 0.8,
                        accepted = true,
                    ),
                    ScanIdentityKind.TIRE to ScanIdentitySlotFrame(
                        index = 13,
                        score = 0.7,
                        accepted = true,
                    ),
                    ScanIdentityKind.GLIDER to ScanIdentitySlotFrame(
                        id = "glider.super_glider",
                        score = 0.6,
                        accepted = true,
                    ),
                    ScanIdentityKind.COUNTRY to ScanIdentitySlotFrame(
                        index = 155,
                        score = 0.95,
                        accepted = true,
                    ),
                ),
            ),
            "ghost" to ScanIdentityOwnerFrame(
                slots = mapOf(
                    ScanIdentityKind.CHARACTER to ScanIdentitySlotFrame(
                        id = "character.luigi",
                        accepted = true,
                    ),
                ),
            ),
        )
        val session = ScanConsensusSession()
        assertTrue(session.consume(frame(accepted = true, owners = owners)))
        val encoded = session.encodeCompactResult(1_786_900_000_000, 0)

        val observation = translateCompactPlayerScanResult(
            encoded,
            Schema9ScanStableAssetResolver,
        )
        assertEquals("1:00.000", observation.totalTime)
        assertEquals(listOf("0:20.000", "0:19.500", "0:20.500"), observation.lapTimes)
        assertEquals("character.mario", observation.character?.assetId)
        assertEquals(13, observation.tire?.index)
        assertEquals(155, observation.country?.index)
        assertEquals("Driver", observation.observedPlayerName)
        assertFalse(encoded.contains("lapSumAccepted"))
    }
}
