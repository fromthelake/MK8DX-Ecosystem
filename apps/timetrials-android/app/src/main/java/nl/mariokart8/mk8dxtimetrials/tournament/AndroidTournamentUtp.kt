package nl.mariokart8.mk8dxtimetrials.tournament

import java.util.Locale

/**
 * Source Manager parity for `workflow.utpCableByStation` and the Step 8
 * `UTP 2-kabel wisselplan`.
 *
 * A UTP number is a Tournament wiring position, not a permanent number owned
 * by a Player's Switch. The qualifier board establishes 1..N in visible group
 * and station order. Final groups keep that mapping. A station first used in
 * the final groups is appended after N, matching the source's requirement that
 * newly added Step 7 stations participate once they have a group position.
 */

internal fun androidStationKey(ownerPlayerId: String, switchType: String): String =
    "$ownerPlayerId\u0000${switchType.lowercase(Locale.ROOT)}"

private fun AndroidTournamentMemberStation.key(): String =
    androidStationKey(ownerPlayerId, switchType)

private fun orderedStationKeys(groups: List<AndroidTournamentGroup>, stage: String): List<String> {
    val seen = linkedSetOf<String>()
    groups.filter { it.stage == stage }.sortedBy { it.sequence }.forEach { group ->
        group.members.sortedBy { it.seatOrder }.forEach { member ->
            member.station?.let { seen.add(it.key()) }
        }
    }
    return seen.toList()
}

internal fun androidUtpCableByStation(document: AndroidTournamentDocument): Map<String, Int> {
    val ordered = linkedSetOf<String>()
    ordered.addAll(orderedStationKeys(document.groups, "qualifier"))
    ordered.addAll(orderedStationKeys(document.groups, "final"))
    return ordered.mapIndexed { index, key -> key to index + 1 }.toMap()
}

internal fun androidUtpCableNumber(
    cableByStation: Map<String, Int>,
    ownerPlayerId: String,
    switchType: String,
): Int? = cableByStation[androidStationKey(ownerPlayerId, switchType)]

internal data class AndroidUtpPlanStep(
    val type: String,
    val cableX: Int,
    val cableY: Int? = null,
    val from: String,
    val to: String,
)

internal data class AndroidUtpPlan(
    val steps: List<AndroidUtpPlanStep>,
    val swapCount: Int,
    val moveCount: Int,
    val unresolved: Int,
)

private fun needMatrix(
    current: Map<Int, String>,
    target: Map<Int, String>,
): Map<String, Map<String, List<Int>>> {
    val need = linkedMapOf<String, MutableMap<String, MutableList<Int>>>()
    target.forEach { (cable, targetGroup) ->
        val from = current[cable] ?: "__unassigned__"
        if (from == targetGroup) return@forEach
        need.getOrPut(from) { linkedMapOf() }
            .getOrPut(targetGroup) { mutableListOf() }
            .add(cable)
    }
    return need.mapValues { (_, row) ->
        row.mapValues { (_, cables) -> cables.sorted() }
    }
}

/** Direct Kotlin port of source `planUtpSwapsAndMoves`. */
internal fun androidPlanUtpSwapsAndMoves(
    startCableToGroup: Map<Int, String>,
    targetCableToGroup: Map<Int, String>,
): AndroidUtpPlan {
    val current = targetCableToGroup.keys.associateWith { cable ->
        startCableToGroup[cable] ?: "__unassigned__"
    }.toMutableMap()
    val target = targetCableToGroup.toSortedMap()
    val steps = mutableListOf<AndroidUtpPlanStep>()
    val maxIterations = maxOf(16, target.size * 8)

    repeat(maxIterations) {
        val need = needMatrix(current, target)
        val pairs = need.flatMap { (from, row) ->
            row.mapNotNull { (to, cables) ->
                cables.takeIf { it.isNotEmpty() }?.let { Triple(from, to, it) }
            }
        }.sortedBy { (from, to) -> "$from|$to" }
        if (pairs.isEmpty()) return@repeat

        val reciprocal = pairs.firstNotNullOfOrNull { (from, to, cables) ->
            val reverse = need[to]?.get(from).orEmpty()
            val cableX = cables.firstOrNull()
            val cableY = reverse.firstOrNull()
            if (cableX == null || cableY == null || cableX == cableY) return@firstNotNullOfOrNull null
            val fromX = current[cableX] ?: "__unassigned__"
            val fromY = current[cableY] ?: "__unassigned__"
            if (fromX == fromY || fromX == "__unassigned__" || fromY == "__unassigned__") null
            else AndroidUtpPlanStep("swap", cableX, cableY, fromX, fromY)
        }
        if (reciprocal != null) {
            current[reciprocal.cableX] = reciprocal.to
            current[requireNotNull(reciprocal.cableY)] = reciprocal.from
            steps += reciprocal
            return@repeat
        }

        val (ignoredFrom, ignoredTo, cables) = pairs.first()
        @Suppress("UNUSED_VARIABLE") val ignored = ignoredFrom to ignoredTo
        val cableX = cables.first()
        val fromX = current[cableX] ?: "__unassigned__"
        val toX = target.getValue(cableX)
        val cableY = current.keys
            .filter { cable ->
                cable != cableX && current[cable] == toX && target[cable] != toX
            }
            .sorted()
            .firstOrNull()

        if (cableY != null && current[cableY] != fromX && fromX != "__unassigned__") {
            val fromY = current[cableY] ?: "__unassigned__"
            current[cableX] = fromY
            current[cableY] = fromX
            steps += AndroidUtpPlanStep("swap", cableX, cableY, fromX, fromY)
        } else {
            current[cableX] = toX
            steps += AndroidUtpPlanStep("move", cableX, null, fromX, toX)
        }
    }

    val unresolved = target.count { (cable, group) -> current[cable] != group }
    return AndroidUtpPlan(
        steps = steps,
        swapCount = steps.count { it.type == "swap" },
        moveCount = steps.count { it.type == "move" },
        unresolved = unresolved,
    )
}

internal data class AndroidFinalParticipantMove(
    val displayName: String,
    val fromGroup: String,
    val fromStation: String,
    val toGroup: String,
    val toStation: String,
)

internal data class AndroidFinalOwnerGiveUp(
    val displayName: String,
    val groupName: String,
    val seatedStation: String,
)

internal data class AndroidFinalLayoutAudit(
    val ownerGiveUps: List<AndroidFinalOwnerGiveUp>,
    val participantMoves: List<AndroidFinalParticipantMove>,
    val weightedScore: Int,
    val utpPlan: AndroidUtpPlan,
)

private data class StageSeat(
    val groupName: String,
    val groupKey: String,
    val station: AndroidTournamentMemberStation,
)

private fun stageSeats(document: AndroidTournamentDocument, stage: String): Map<String, StageSeat> =
    buildMap {
        document.groups.filter { it.stage == stage }.sortedBy { it.sequence }.forEach { group ->
            group.members.forEach { member ->
                member.station?.let { put(member.playerId, StageSeat(group.name, "G${group.sequence}", it)) }
            }
        }
    }

private fun cableGroups(
    document: AndroidTournamentDocument,
    stage: String,
    cableByStation: Map<String, Int>,
): Map<Int, String> = buildMap {
    document.groups.filter { it.stage == stage }.sortedBy { it.sequence }.forEach { group ->
        group.members.sortedBy { it.seatOrder }.forEach { member ->
            val station = member.station ?: return@forEach
            cableByStation[station.key()]?.let { put(it, "G${group.sequence}") }
        }
    }
}

private fun stationLabel(station: AndroidTournamentMemberStation, cable: Int?): String =
    listOfNotNull(cable?.let { "UTP $it" }, station.switchType.uppercase(Locale.ROOT), station.ownerDisplayName)
        .joinToString(" · ")

internal fun androidFinalLayoutAudit(document: AndroidTournamentDocument): AndroidFinalLayoutAudit {
    val qualifier = stageSeats(document, "qualifier")
    val finals = stageSeats(document, "final")
    val cableByStation = androidUtpCableByStation(document)
    val participants = document.participants.associateBy { it.playerId }

    val moves = finals.mapNotNull { (playerId, finalSeat) ->
        val firstSeat = qualifier[playerId] ?: return@mapNotNull null
        if (firstSeat.station.key() == finalSeat.station.key()) return@mapNotNull null
        AndroidFinalParticipantMove(
            displayName = participants[playerId]?.displayName ?: playerId,
            fromGroup = firstSeat.groupName,
            fromStation = stationLabel(firstSeat.station, cableByStation[firstSeat.station.key()]),
            toGroup = finalSeat.groupName,
            toStation = stationLabel(finalSeat.station, cableByStation[finalSeat.station.key()]),
        )
    }.sortedBy { it.displayName.lowercase(Locale.forLanguageTag("nl-NL")) }

    val giveUps = finals.mapNotNull { (playerId, finalSeat) ->
        val participant = participants[playerId] ?: return@mapNotNull null
        if (!participant.hasSwitch1 && !participant.hasSwitch2) return@mapNotNull null
        if (finalSeat.station.ownerPlayerId == playerId) return@mapNotNull null
        AndroidFinalOwnerGiveUp(
            displayName = participant.displayName,
            groupName = finalSeat.groupName,
            seatedStation = stationLabel(finalSeat.station, cableByStation[finalSeat.station.key()]),
        )
    }.sortedBy { it.displayName.lowercase(Locale.forLanguageTag("nl-NL")) }

    val plan = androidPlanUtpSwapsAndMoves(
        startCableToGroup = cableGroups(document, "qualifier", cableByStation),
        targetCableToGroup = cableGroups(document, "final", cableByStation),
    )
    return AndroidFinalLayoutAudit(giveUps, moves, giveUps.size * 3 + moves.size, plan)
}
