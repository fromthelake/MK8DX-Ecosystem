package nl.mariokart8.mk8dxtimetrials.scan

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ScanCoordinatorDeviceTest {
    @Test
    fun syntheticBurstProducesLockedCompactResultOnDevice() {
        val fields = linkedMapOf(
            "player_total" to "1:00.000",
            "player_lap_1" to "0:20.000",
            "player_lap_2" to "0:19.500",
            "player_lap_3" to "0:20.500",
        )
        val coordinator = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Int> { _, _, identityOnly ->
                ScanConsensusFrame(
                    fields = if (identityOnly) emptyMap() else fields,
                    lapSumAccepted = !identityOnly,
                    expectedFieldCount = 4,
                    identityOwners = mapOf(
                        "player" to ScanIdentityOwnerFrame(
                            slots = mapOf(
                                ScanIdentityKind.CHARACTER to ScanIdentitySlotFrame(
                                    id = "character.mario",
                                    accepted = true,
                                ),
                            ),
                        ),
                    ),
                )
            },
        )

        val outcome = coordinator.analyzeBurst((0..4).toList(), 1_786_900_000_000)

        assertTrue(outcome is ScanCoordinatorOutcome.Locked)
        outcome as ScanCoordinatorOutcome.Locked
        assertEquals(2, outcome.framesProcessed)
        val result = Json.parseToJsonElement(outcome.encodedResult).jsonObject
        assertTrue(result.getValue("locked").jsonPrimitive.boolean)
        assertEquals("1:00.000", result.getValue("fields").jsonObject
            .getValue("player_total").jsonPrimitive.content)
    }
}
