package nl.mariokart8.mk8dxtimetrials.scan

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanCoordinatorTest {
    private val fields = linkedMapOf(
        "player_total" to "1:00.000",
        "player_lap_1" to "0:20.000",
        "player_lap_2" to "0:19.500",
        "player_lap_3" to "0:20.500",
    )

    private fun identity() = mapOf(
        "player" to ScanIdentityOwnerFrame(
            cardName = "Driver",
            slots = mapOf(
                ScanIdentityKind.CHARACTER to ScanIdentitySlotFrame(
                    id = "character.mario",
                    accepted = true,
                ),
            ),
        ),
    )

    @Test
    fun locksCallsBackAndStopsAfterUnanimousIdentityFollowup() {
        val states = mutableListOf<ScanCoordinatorState>()
        val results = mutableListOf<String>()
        val identityOnlyCalls = mutableListOf<Boolean>()
        val coordinator = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Int> { _, _, identityOnly ->
                identityOnlyCalls += identityOnly
                ScanConsensusFrame(
                    fields = if (identityOnly) emptyMap() else fields,
                    lapSumAccepted = !identityOnly,
                    expectedFieldCount = 4,
                    identityOwners = identity(),
                )
            },
            onState = states::add,
            onLockedResult = results::add,
        )

        val outcome = coordinator.analyzeBurst((0..4).toList(), 1_786_900_000_000)

        assertTrue(outcome is ScanCoordinatorOutcome.Locked)
        outcome as ScanCoordinatorOutcome.Locked
        assertEquals(0, outcome.lockFrameIndex)
        assertEquals(2, outcome.framesProcessed)
        assertEquals(listOf(false, true), identityOnlyCalls)
        assertEquals(1, results.size)
        assertEquals(outcome.encodedResult, results.single())
        assertTrue(states.last() is ScanCoordinatorState.Locked)
        val root = Json.parseToJsonElement(outcome.encodedResult).jsonObject
        assertEquals("direct_lap_som", root.getValue("accept_path").jsonPrimitive.content)
        assertEquals("Driver", root.getValue("identity").jsonObject
            .getValue("player").jsonObject.getValue("card_name").jsonPrimitive.content)
    }

    @Test
    fun processesAllFiveFramesBeforeNeedsReposition() {
        val states = mutableListOf<ScanCoordinatorState>()
        var callbacks = 0
        val coordinator = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Int> { _, _, _ ->
                ScanConsensusFrame(
                    fields = fields + ("player_lap_3" to "0:20.50?"),
                    expectedFieldCount = 4,
                )
            },
            onState = states::add,
            onLockedResult = { callbacks += 1 },
        )

        val outcome = coordinator.analyzeBurst((0..4).toList(), 1)

        assertEquals(ScanCoordinatorOutcome.NeedsReposition(5), outcome)
        assertEquals(0, callbacks)
        assertEquals(5, states.filterIsInstance<ScanCoordinatorState.Analyzing>().size)
        assertTrue(states.last() is ScanCoordinatorState.NeedsReposition)
    }

    @Test
    fun stopsAfterThreeIdentityFramesWhenVotesNeverSettle() {
        val calls = mutableListOf<Boolean>()
        val coordinator = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Int> { _, frameIndex, identityOnly ->
                calls += identityOnly
                ScanConsensusFrame(
                    fields = if (identityOnly) emptyMap() else fields,
                    lapSumAccepted = !identityOnly,
                    expectedFieldCount = 4,
                    identityOwners = mapOf(
                        "player" to ScanIdentityOwnerFrame(
                            slots = mapOf(
                                ScanIdentityKind.CHARACTER to ScanIdentitySlotFrame(
                                    id = if (frameIndex % 2 == 0) {
                                        "character.mario"
                                    } else {
                                        "character.luigi"
                                    },
                                    accepted = true,
                                ),
                            ),
                        ),
                    ),
                )
            },
        )

        val outcome = coordinator.analyzeBurst((0..4).toList(), 1)

        assertTrue(outcome is ScanCoordinatorOutcome.Locked)
        assertEquals(4, (outcome as ScanCoordinatorOutcome.Locked).framesProcessed)
        assertEquals(listOf(false, true, true, true), calls)
    }

    // A still image is one frame object repeated; the engine never reads it twice.
    private val still = Any()

    @Test
    fun stillImageIsReadOnceAndItsResultCastsTheIdentityVote() {
        val calls = mutableListOf<Boolean>()
        val coordinator = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Any> { _, _, identityOnly ->
                calls += identityOnly
                ScanConsensusFrame(
                    fields = fields,
                    lapSumAccepted = true,
                    expectedFieldCount = 4,
                    identityOwners = identity(),
                )
            },
        )

        val outcome = coordinator.analyzeBurst(List(5) { still }, 1)

        assertTrue(outcome is ScanCoordinatorOutcome.Locked)
        assertEquals(2, (outcome as ScanCoordinatorOutcome.Locked).framesProcessed)
        assertEquals(listOf(false), calls)
    }

    @Test
    fun unreadableStillImageStopsAfterOneReadInsteadOfVotingCopies() {
        var calls = 0
        val states = mutableListOf<ScanCoordinatorState>()
        val coordinator = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Any> { _, _, _ ->
                calls += 1
                // Well-formed times whose laps do not add up: identical copies
                // used to out-vote the lap sum at the third frame.
                ScanConsensusFrame(
                    fields = fields + ("player_lap_3" to "0:20.600"),
                    lapSumAccepted = false,
                    expectedFieldCount = 4,
                )
            },
            onState = states::add,
        )

        val outcome = coordinator.analyzeBurst(List(5) { still }, 1)

        assertEquals(ScanCoordinatorOutcome.NeedsReposition(1), outcome)
        assertEquals(1, calls)
        assertTrue(states.last() is ScanCoordinatorState.NeedsReposition)
    }

    @Test
    fun aStillReadAtSeveralSizesTriesTheNextSizeWhenOneFailsAndReadsEachSizeOnce() {
        val first = Any()
        val second = Any()
        val third = Any()
        val read = mutableListOf<Any>()
        val coordinator = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Any> { frame, _, identityOnly ->
                read += frame
                if (frame === first) {
                    // The first size loses a digit: well-formed, lap sum open.
                    ScanConsensusFrame(
                        fields = fields + ("player_total" to "1:00.010"),
                        lapSumAccepted = false,
                        expectedFieldCount = 4,
                    )
                } else {
                    ScanConsensusFrame(
                        fields = if (identityOnly) emptyMap() else fields,
                        lapSumAccepted = !identityOnly,
                        expectedFieldCount = 4,
                        identityOwners = identity(),
                    )
                }
            },
        )

        val outcome = coordinator.analyzeBurst(listOf(first, first, second, second, third), 1)

        assertTrue(outcome is ScanCoordinatorOutcome.Locked)
        assertEquals(2, (outcome as ScanCoordinatorOutcome.Locked).lockFrameIndex)
        // The repeated sizes cost nothing, and the third size is never needed.
        assertEquals(listOf(first, second), read)
    }

    @Test
    fun repairedLapSumOnStillImageStillLocksWithoutASecondRead() {
        var calls = 0
        val coordinator = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Any> { _, _, _ ->
                calls += 1
                ScanConsensusFrame(
                    fields = fields,
                    lapSumAccepted = true,
                    lapSumRepairs = 1,
                    expectedFieldCount = 4,
                )
            },
        )

        val outcome = coordinator.analyzeBurst(List(5) { still }, 1)

        assertTrue(outcome is ScanCoordinatorOutcome.Locked)
        assertEquals(1, calls)
        assertEquals(
            "bevestigd_na_reparatie",
            Json.parseToJsonElement((outcome as ScanCoordinatorOutcome.Locked).encodedResult)
                .jsonObject.getValue("accept_path").jsonPrimitive.content,
        )
    }

    @Test
    fun invalidBurstAndAnalyzerFailureAreBounded() {
        var analyzerCalls = 0
        val invalid = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Int> { _, _, _ ->
                analyzerCalls += 1
                ScanConsensusFrame()
            },
        ).analyzeBurst(listOf(1), 1)
        assertEquals(
            ScanCoordinatorOutcome.Failed(0, ScanCoordinatorFailureCode.INVALID_BURST_SIZE),
            invalid,
        )
        assertEquals(0, analyzerCalls)

        val cancelled = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Int> { _, _, _ ->
                analyzerCalls += 1
                ScanConsensusFrame()
            },
        ).analyzeBurst((0..4).toList(), 1, shouldContinue = { false })
        assertEquals(ScanCoordinatorOutcome.Cancelled(0), cancelled)
        assertEquals(0, analyzerCalls)

        val states = mutableListOf<ScanCoordinatorState>()
        val failed = ScanCoordinator(
            analyzer = ScanFrameAnalyzer<Int> { _, frameIndex, _ ->
                if (frameIndex == 2) error("private analyzer detail")
                ScanConsensusFrame()
            },
            onState = states::add,
        ).analyzeBurst((0..4).toList(), 1)
        assertEquals(
            ScanCoordinatorOutcome.Failed(2, ScanCoordinatorFailureCode.ANALYZER_FAILURE),
            failed,
        )
        assertFalse(states.last().toString().contains("private analyzer detail"))
    }
}
