package nl.mariokart8.mk8dxtimetrials.tournament

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidTournamentUtpTest {
    private fun participant(id: String, ownsSwitch: Boolean = true) = AndroidTournamentParticipant(
        playerId = id,
        username = id,
        displayName = id.uppercase(),
        attendance = ATTENDANCE_PRESENT,
        hasSwitch1 = ownsSwitch,
        hasSwitch2 = false,
    )

    private fun member(player: String, owner: String, order: Int, legacyCable: Int) = AndroidTournamentMember(
        playerId = player,
        displayName = player.uppercase(),
        seatOrder = order,
        station = AndroidTournamentMemberStation(
            ownerPlayerId = owner,
            ownerDisplayName = owner.uppercase(),
            switchType = "ns1",
            seatNumber = 1,
            utpCableNumber = legacyCable,
        ),
    )

    private fun group(stage: String, sequence: Int, members: List<AndroidTournamentMember>) =
        AndroidTournamentGroup(
            groupId = "$stage.$sequence",
            stage = stage,
            sequence = sequence,
            name = if (stage == "qualifier") "Groep $sequence" else "Eindgroep $sequence",
            locked = true,
            manualScoreSegments = 1,
            members = members,
            races = emptyList(),
            manualScores = emptyList(),
            standings = AndroidTournamentStandings("none", emptyList()),
        )

    private fun document(groups: List<AndroidTournamentGroup>): AndroidTournamentDocument {
        val base = androidTournamentParticipantsPreviewDocument()
        val ids = groups.flatMap { group -> group.members.flatMap { listOf(it.playerId, it.station!!.ownerPlayerId) } }.distinct()
        return base.copy(participants = ids.map(::participant), groups = groups)
    }

    @Test
    fun `qualifier board assigns contiguous cables in group and station order`() {
        val document = document(
            listOf(
                group("qualifier", 1, listOf(member("b", "b", 2, 48), member("a", "a", 1, 91))),
                group("qualifier", 2, listOf(member("c", "c", 1, 7))),
            ),
        )

        val cables = androidUtpCableByStation(document)

        assertEquals(1, androidUtpCableNumber(cables, "a", "ns1"))
        assertEquals(2, androidUtpCableNumber(cables, "b", "ns1"))
        assertEquals(3, androidUtpCableNumber(cables, "c", "ns1"))
    }

    @Test
    fun `final groups retain qualifier cables and append a newly used station`() {
        val document = document(
            listOf(
                group("qualifier", 1, listOf(member("a", "a", 1, 91), member("b", "b", 2, 48))),
                group("final", 1, listOf(member("c", "c", 1, 2), member("b", "b", 2, 48))),
                group("final", 2, listOf(member("a", "a", 1, 91))),
            ),
        )

        val cables = androidUtpCableByStation(document)

        assertEquals(1, androidUtpCableNumber(cables, "a", "ns1"))
        assertEquals(2, androidUtpCableNumber(cables, "b", "ns1"))
        assertEquals(3, androidUtpCableNumber(cables, "c", "ns1"))
    }

    @Test
    fun `final UTP planner prefers one reciprocal cable swap`() {
        val qualifierA = member("a", "a", 1, 91)
        val qualifierB = member("b", "b", 1, 48)
        val document = document(
            listOf(
                group("qualifier", 1, listOf(qualifierA)),
                group("qualifier", 2, listOf(qualifierB)),
                group("final", 1, listOf(qualifierB)),
                group("final", 2, listOf(qualifierA)),
            ),
        )

        val audit = androidFinalLayoutAudit(document)

        assertEquals(1, audit.utpPlan.swapCount)
        assertEquals(0, audit.utpPlan.moveCount)
        assertEquals(0, audit.utpPlan.unresolved)
        assertEquals(AndroidUtpPlanStep("swap", 1, 2, "G1", "G2"), audit.utpPlan.steps.single())
    }

    @Test
    fun `final movement score is three per owner give-up plus one per station move`() {
        val document = document(
            listOf(
                group("qualifier", 1, listOf(member("a", "a", 1, 91), member("b", "b", 2, 48))),
                group("final", 1, listOf(member("a", "b", 1, 48), member("b", "a", 2, 91))),
            ),
        )

        val audit = androidFinalLayoutAudit(document)

        assertEquals(2, audit.ownerGiveUps.size)
        assertEquals(2, audit.participantMoves.size)
        assertEquals(8, audit.weightedScore)
    }
}
