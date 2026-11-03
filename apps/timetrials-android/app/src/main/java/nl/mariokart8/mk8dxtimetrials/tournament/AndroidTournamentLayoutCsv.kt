package nl.mariokart8.mk8dxtimetrials.tournament

import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * The Step 3 and Step 7 layout file, matching the source Manager's own export:
 * `Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep`, one row per console.
 *
 * Reading it is the easy half. The names in the file are display names, which
 * may equally be aliases, so they are resolved through the same directory the
 * roster import uses before anything is sent - a layout that names somebody the
 * platform does not know is refused rather than half-applied.
 */

internal data class AndroidLayoutCsvSeat(
    val row: Int,
    val groupName: String,
    val stationOwnerName: String,
    val switchType: String?,
    val playerName: String,
    val seatNumber: Int,
)

internal sealed interface AndroidLayoutCsvParse {
    data class Parsed(val seats: List<AndroidLayoutCsvSeat>) : AndroidLayoutCsvParse
    data class Failed(val message: String) : AndroidLayoutCsvParse
}

private fun switchType(raw: String): String? = when (raw.trim().lowercase(Locale.ROOT)) {
    "ns1", "nintendo switch 1", "switch 1", "1" -> "ns1"
    "ns2", "nintendo switch 2", "switch 2", "2" -> "ns2"
    else -> null
}

internal fun androidParseLayoutCsv(
    text: String,
    language: AndroidProductLanguage = AndroidProductLanguage.DUTCH,
): AndroidLayoutCsvParse {
    val cleaned = text.removePrefix("\uFEFF")
    val lines = cleaned.split("\n").map { it.replace("\r", "") }.filter { it.isNotBlank() }
    if (cleaned.startsWith("PK") || cleaned.any { it.code in 1..8 }) {
        return AndroidLayoutCsvParse.Failed(
            androidText(
                language,
                "This does not look like a CSV file. An Excel workbook (.xlsx) belongs to " +
                    "entering the scores, not to this step.",
                "Dit lijkt geen CSV-bestand. Een Excel-werkmap (.xlsx) hoort bij het " +
                    "invullen van de scores, niet bij deze stap.",
            ),
        )
    }
    if (lines.isEmpty()) return AndroidLayoutCsvParse.Failed(androidText(language, "The CSV file is empty.", "Het CSV-bestand is leeg."))

    val header = lines.first()
    // A Dutch Excel writes `;`, an English one `,`, a paste from Sheets a tab.
    val delimiter = when {
        header.count { it == '\t' } > header.count { it == ';' } &&
            header.count { it == '\t' } > header.count { it == ',' } -> '\t'
        header.count { it == ',' } > header.count { it == ';' } -> ','
        else -> ';'
    }
    val headers = header.split(delimiter).map { headerKey(it.replace("\"", "")) }
    fun column(vararg names: String): Int = names.map(::headerKey).firstNotNullOfOrNull { wanted ->
        headers.indexOf(wanted).takeIf { it >= 0 }
    } ?: -1
    val ownerIndex = column("Switcheigenaar", "Switch owner", "Owner", "Eigenaar")
    val consoleIndex = column("Console", "Switch", "Type")
    val firstIndex = column("Deelnemer 1", "Participant 1", "Player 1", "Speler 1")
    val secondIndex = column("Deelnemer 2", "Participant 2", "Player 2", "Speler 2")
    val groupIndex = column("Groep", "Group", "Poule")
    val missing = buildList {
        if (ownerIndex < 0) add(androidText(language, "Switcheigenaar (or Switch owner)", "Switcheigenaar (of Switch owner)"))
        if (consoleIndex < 0) add("Console")
        if (firstIndex < 0) add(androidText(language, "Deelnemer 1 (or Player 1)", "Deelnemer 1 (of Player 1)"))
        if (secondIndex < 0) add(androidText(language, "Deelnemer 2 (or Player 2)", "Deelnemer 2 (of Player 2)"))
        if (groupIndex < 0) add(androidText(language, "Groep (or Group)", "Groep (of Group)"))
    }
    if (missing.isNotEmpty()) {
        return AndroidLayoutCsvParse.Failed(
            androidText(
                language,
                "Row 1: these columns are missing: ${missing.joinToString(", ")}. " +
                    "Columns may be separated by ; , or a tab.",
                "Regel 1: deze kolommen ontbreken: ${missing.joinToString(", ")}. " +
                    "Kolommen mogen gescheiden zijn door ; , of een tab.",
            ),
        )
    }

    val seats = mutableListOf<AndroidLayoutCsvSeat>()
    val seen = mutableSetOf<String>()
    lines.drop(1).forEachIndexed { offset, line ->
        val cells = line.split(delimiter).map { it.replace("\"", "").trim() }
        val rowNumber = offset + 2
        val groupName = cells.getOrNull(groupIndex).orEmpty()
        if (groupName.isEmpty()) return@forEachIndexed
        val owner = cells.getOrNull(ownerIndex).orEmpty()
        val consoleValue = cells.getOrNull(consoleIndex).orEmpty()
        val console = switchType(consoleValue)
        if (consoleValue.isNotBlank() && console == null) {
            return AndroidLayoutCsvParse.Failed(
                androidCsvIssue(rowNumber, "Console", consoleValue, androidText(language, "this is not a console.", "dit is geen console."), ANDROID_CSV_CONSOLE_WORDS, language),
            )
        }
        if (owner.isNotBlank() && consoleValue.isBlank()) {
            return AndroidLayoutCsvParse.Failed(
                androidCsvIssue(rowNumber, "Console", "", androidText(language, "a row with a Switch owner needs its console.", "een regel met een Switcheigenaar heeft ook de console nodig."), ANDROID_CSV_CONSOLE_WORDS, language),
            )
        }
        if (owner.isBlank() && consoleValue.isNotBlank()) {
            return AndroidLayoutCsvParse.Failed(
                androidCsvIssue(rowNumber, "Switcheigenaar", "", androidText(language, "a row with a console needs its Switch owner.", "een regel met een console heeft ook de Switcheigenaar nodig."), language = language),
            )
        }
        if (cells.getOrNull(firstIndex).orEmpty().isBlank() && cells.getOrNull(secondIndex).orEmpty().isNotBlank()) {
            return AndroidLayoutCsvParse.Failed(
                androidCsvIssue(rowNumber, "Deelnemer 1", "", androidText(language, "seat 2 is filled while seat 1 is empty.", "stoel 2 is gevuld terwijl stoel 1 leeg is."), language = language),
            )
        }
        listOf(firstIndex to 1, secondIndex to 2).forEach { (index, seatNumber) ->
            val playerName = cells.getOrNull(index).orEmpty()
            if (playerName.isEmpty()) return@forEach
            val key = playerName.lowercase(Locale.ROOT)
            if (!seen.add(key)) {
                seats.clear()
                return AndroidLayoutCsvParse.Failed(
                    androidCsvIssue(rowNumber, "Deelnemer $seatNumber", playerName, androidText(language, "this Player already appears earlier in the file.", "deze speler staat al eerder in het bestand."), language = language),
                )
            }
            seats.add(
                AndroidLayoutCsvSeat(
                    row = rowNumber,
                    groupName = groupName,
                    stationOwnerName = owner,
                    switchType = console,
                    playerName = playerName,
                    seatNumber = seatNumber,
                ),
            )
        }
    }
    if (seats.isEmpty()) {
        return AndroidLayoutCsvParse.Failed(androidText(language, "The CSV file contains no participants.", "Het CSV-bestand bevat geen deelnemers."))
    }
    return AndroidLayoutCsvParse.Parsed(seats)
}

internal data class AndroidLayoutSeatRequest(
    val playerId: String,
    val stationOwnerPlayerId: String?,
    val switchType: String?,
    val seatNumber: Int?,
)

internal data class AndroidLayoutStationRequest(
    val stationOwnerPlayerId: String,
    val switchType: String,
)

internal data class AndroidLayoutGroupRequest(
    val name: String,
    val seats: List<AndroidLayoutSeatRequest>,
    /** The consoles in slot order, including one with nobody seated yet. */
    val stations: List<AndroidLayoutStationRequest> = emptyList(),
)

/** The consoles in a group's slots: the stored order first, then any a seat still names. */
internal fun androidGroupSlots(group: AndroidTournamentGroup): List<AndroidLayoutStationRequest> {
    val ordered = linkedMapOf<String, AndroidLayoutStationRequest>()
    group.stations.sortedBy { it.slotIndex }.forEach { station ->
        ordered["${station.ownerPlayerId}|${station.switchType}"] =
            AndroidLayoutStationRequest(station.ownerPlayerId, station.switchType)
    }
    group.members.sortedBy { it.seatOrder }.mapNotNull { it.station }.forEach { station ->
        ordered.getOrPut("${station.ownerPlayerId}|${station.switchType}") {
            AndroidLayoutStationRequest(station.ownerPlayerId, station.switchType)
        }
    }
    return ordered.values.toList()
}

private fun androidLayoutSeat(member: AndroidTournamentMember): AndroidLayoutSeatRequest =
    AndroidLayoutSeatRequest(
        member.playerId, member.station?.ownerPlayerId, member.station?.switchType, member.station?.seatNumber,
    )

/**
 * A parked console into a slot of a group. Only the slot order changes:
 * the two seats of the console are still to be filled, so no membership moves.
 */
internal fun androidPlaceStationPlan(
    document: AndroidTournamentDocument,
    stage: String,
    ownerPlayerId: String,
    switchType: String,
    targetGroupId: String,
    slotIndex: Int,
): AndroidSeatMovePlan {
    val groups = document.groups.filter { it.stage == stage }.sortedBy { it.sequence }
    require(groups.any { it.groupId == targetGroupId }) { "The target group does not exist" }
    val key = "$ownerPlayerId|$switchType"
    val layout = groups.map { group ->
        val slots = androidGroupSlots(group).filter { "${it.stationOwnerPlayerId}|${it.switchType}" != key }.toMutableList()
        val seats = group.members.sortedBy { it.seatOrder }.map { member ->
            if (member.station != null && "${member.station.ownerPlayerId}|${member.station.switchType}" == key &&
                group.groupId != targetGroupId
            ) {
                AndroidLayoutSeatRequest(member.playerId, null, null, null)
            } else {
                androidLayoutSeat(member)
            }
        }
        if (group.groupId == targetGroupId) {
            slots.add(minOf(slotIndex, slots.size), AndroidLayoutStationRequest(ownerPlayerId, switchType))
        }
        AndroidLayoutGroupRequest(group.name, seats, slots)
    }
    val memberships = groups.map { group ->
        AndroidTournamentGroupMembership(group.groupId, group.members.map { it.playerId })
    }
    return AndroidSeatMovePlan(membershipChanged = false, memberships = memberships, layout = layout)
}

/** A console out of its group into parking; the Players seated at it go to Deelnemersparking. */
internal fun androidParkStationPlan(
    document: AndroidTournamentDocument,
    stage: String,
    ownerPlayerId: String,
    switchType: String,
): AndroidSeatMovePlan {
    val groups = document.groups.filter { it.stage == stage }.sortedBy { it.sequence }
    val key = "$ownerPlayerId|$switchType"
    val memberships = groups.map { group ->
        AndroidTournamentGroupMembership(
            group.groupId,
            group.members.filter { member ->
                member.station == null || "${member.station.ownerPlayerId}|${member.station.switchType}" != key
            }.map { it.playerId },
        )
    }
    val layout = groups.map { group ->
        AndroidLayoutGroupRequest(
            name = group.name,
            seats = group.members.sortedBy { it.seatOrder }.filter { member ->
                member.station == null || "${member.station.ownerPlayerId}|${member.station.switchType}" != key
            }.map { androidLayoutSeat(it) },
            stations = androidGroupSlots(group).filter { "${it.stationOwnerPlayerId}|${it.switchType}" != key },
        )
    }
    val changed = groups.any { group -> group.members.size != memberships.first { it.groupId == group.groupId }.members.size }
    return AndroidSeatMovePlan(membershipChanged = changed, memberships = memberships, layout = layout)
}

/** A Player out of their group into Deelnemersparking; the slots stay as they are. */
internal fun androidParkPlayerPlan(
    document: AndroidTournamentDocument,
    stage: String,
    playerId: String,
): AndroidSeatMovePlan {
    val groups = document.groups.filter { it.stage == stage }.sortedBy { it.sequence }
    val memberships = groups.map { group ->
        AndroidTournamentGroupMembership(group.groupId, group.members.filter { it.playerId != playerId }.map { it.playerId })
    }
    val layout = groups.map { group ->
        AndroidLayoutGroupRequest(
            name = group.name,
            seats = group.members.sortedBy { it.seatOrder }.filter { it.playerId != playerId }.map { androidLayoutSeat(it) },
            stations = androidGroupSlots(group),
        )
    }
    val changed = groups.any { group -> group.members.any { it.playerId == playerId } }
    return AndroidSeatMovePlan(membershipChanged = changed, memberships = memberships, layout = layout)
}

/** The source mobile ⇄ flow ends on one concrete Switch seat, never a vague group move. */
internal data class AndroidSeatMovePlan(
    val membershipChanged: Boolean,
    val memberships: List<AndroidTournamentGroupMembership>,
    val layout: List<AndroidLayoutGroupRequest>,
)

/**
 * Produces the two server requests behind the source Manager's exact-seat
 * action.  Group membership is changed first only when necessary; the layout
 * request then carries every Player in the stage exactly once, so the server
 * can validate and apply the visible board as one revisioned operation.
 */
internal fun androidSeatMovePlan(
    document: AndroidTournamentDocument,
    stage: String,
    playerId: String,
    targetGroupId: String,
    stationOwnerPlayerId: String,
    switchType: String,
    seatNumber: Int,
): AndroidSeatMovePlan {
    val groups = document.groups.filter { it.stage == stage }.sortedBy { it.sequence }
    require(groups.any { it.groupId == targetGroupId }) { "The target group does not exist" }
    val sourceGroup = groups.firstOrNull { group -> group.members.any { it.playerId == playerId } }
    val sourceMember = sourceGroup?.members?.firstOrNull { it.playerId == playerId }
    val targetGroup = requireNotNull(groups.firstOrNull { it.groupId == targetGroupId })
    val occupant = targetGroup.members.firstOrNull { member ->
        member.station?.ownerPlayerId == stationOwnerPlayerId &&
            member.station?.switchType == switchType && member.station?.seatNumber == seatNumber
    }
    require(occupant?.playerId != playerId) { "Choose a different seat" }

    val membersByGroup = groups.associate { group ->
        group.groupId to group.members.map { it.playerId }.toMutableList()
    }.toMutableMap()
    val sourceIds = sourceGroup?.let { membersByGroup.getValue(it.groupId) }
    val targetIds = membersByGroup.getValue(targetGroupId)
    when {
        sourceGroup == null && occupant == null -> targetIds.add(playerId)
        sourceGroup == null -> targetIds[targetIds.indexOf(requireNotNull(occupant).playerId)] = playerId
        occupant == null && sourceGroup.groupId != targetGroupId -> {
            sourceIds!!.remove(playerId)
            targetIds.add(playerId)
        }
        occupant != null && sourceGroup.groupId != targetGroupId -> {
            sourceIds!![sourceIds.indexOf(playerId)] = occupant.playerId
            targetIds[targetIds.indexOf(occupant.playerId)] = playerId
        }
    }
    require(targetIds.size <= 12) { "The target group is full" }

    val memberships = groups.map { group ->
        AndroidTournamentGroupMembership(group.groupId, membersByGroup.getValue(group.groupId).toList())
    }
    val membershipChanged = groups.any { group ->
        group.members.map { it.playerId } != membersByGroup.getValue(group.groupId)
    }
    val memberById = groups.flatMap { it.members }.associateBy { it.playerId }
    val targetStation = AndroidTournamentMemberStation(
        ownerPlayerId = stationOwnerPlayerId,
        ownerDisplayName = targetGroup.members.firstOrNull {
            it.station?.ownerPlayerId == stationOwnerPlayerId && it.station.switchType == switchType
        }?.station?.ownerDisplayName ?: stationOwnerPlayerId,
        switchType = switchType,
        seatNumber = seatNumber,
    )
    val occupantStation = sourceMember?.station
    val layout = groups.map { group ->
        AndroidLayoutGroupRequest(
            name = group.name,
            seats = membersByGroup.getValue(group.groupId).map { id ->
                val station = when (id) {
                    playerId -> targetStation
                    occupant?.playerId -> occupantStation
                    else -> memberById[id]?.station
                }
                AndroidLayoutSeatRequest(id, station?.ownerPlayerId, station?.switchType, station?.seatNumber)
            },
            stations = androidGroupSlots(group),
        )
    }
    return AndroidSeatMovePlan(membershipChanged, memberships, layout)
}

internal sealed interface AndroidLayoutResolution {
    data class Resolved(val groups: List<AndroidLayoutGroupRequest>) : AndroidLayoutResolution
    data class Failed(val message: String) : AndroidLayoutResolution
}

/**
 * Turns the names in the file into canonical Player ids, through display names
 * and aliases. Every name must resolve: a partly applied layout would silently
 * drop somebody from the night.
 */
internal fun androidResolveLayout(
    seats: List<AndroidLayoutCsvSeat>,
    directory: List<AndroidTournamentPlayerSearchResult>,
    language: AndroidProductLanguage = AndroidProductLanguage.DUTCH,
): AndroidLayoutResolution {
    val unresolved = seats.map { it.playerName }
        .filter { androidResolvePlayerByName(it, directory) == null }
        .distinct()
    if (unresolved.isNotEmpty()) {
        return AndroidLayoutResolution.Failed(
            androidText(
                language,
                "Unknown name in the layout: ${unresolved.joinToString(", ")}.",
                "Onbekende naam in de indeling: ${unresolved.joinToString(", ")}.",
            ),
        )
    }
    val grouped = linkedMapOf<String, MutableList<AndroidLayoutSeatRequest>>()
    seats.forEach { seat ->
        val player = androidResolvePlayerByName(seat.playerName, directory) ?: return@forEach
        val owner = androidResolvePlayerByName(seat.stationOwnerName, directory)
        grouped.getOrPut(seat.groupName) { mutableListOf() }.add(
            AndroidLayoutSeatRequest(
                playerId = player.playerId,
                stationOwnerPlayerId = owner?.playerId,
                switchType = seat.switchType,
                seatNumber = seat.seatNumber,
            ),
        )
    }
    return AndroidLayoutResolution.Resolved(
        grouped.map { (name, requests) -> AndroidLayoutGroupRequest(name, requests) },
    )
}
