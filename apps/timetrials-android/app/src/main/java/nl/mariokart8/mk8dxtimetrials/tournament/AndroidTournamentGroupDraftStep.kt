package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Surface
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme as Mk8dxDesignTheme
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * Steps 3 and 7 of the source Manager: `renderGroupBoard` in `assets/app.js`.
 *
 * Step 3 draws the qualifier layout, Step 7 the final-group layout. The source
 * uses one board for both and only swaps the stage, labels and confirm action,
 * so this Composable does the same.
 */

private const val TOURNAMENT_GROUP_SEATS = 12
private const val TOURNAMENT_GROUP_SWITCHES = 6

internal data class AndroidGroupBoardStats(
    val switchesAssigned: Int,
    val seatedCount: Int,
    val seatCapacity: Int,
    val memberCount: Int,
    val unseatedCount: Int,
    val averageSkill: Double,
    val spreadPlus: Double,
    val spreadMinus: Double,
)

/**
 * `buildGroupBoardModel` plus the per-group `rankStats` the source header
 * shows. Seat capacity follows the source: two seats per assigned Switch,
 * never more than a full group of twelve.
 */
internal fun androidGroupBoardStats(
    group: AndroidTournamentGroup,
    participants: List<AndroidTournamentParticipant>,
): AndroidGroupBoardStats {
    val switches = group.members.mapNotNull { it.station }
        .map { it.ownerPlayerId to it.switchType }
        .distinct()
    val seated = group.members.count { it.station != null }
    val byId = participants.associateBy { it.playerId }
    val scores = group.members.mapNotNull { byId[it.playerId]?.seedScore }
    val average = if (scores.isEmpty()) 0.0 else scores.average()
    return AndroidGroupBoardStats(
        switchesAssigned = switches.size,
        seatedCount = seated,
        seatCapacity = minOf(TOURNAMENT_GROUP_SEATS, switches.size * 2),
        memberCount = group.members.size,
        unseatedCount = group.members.size - seated,
        averageSkill = average,
        spreadPlus = if (scores.isEmpty()) 0.0 else (scores.max() - average),
        spreadMinus = if (scores.isEmpty()) 0.0 else (average - scores.min()),
    )
}

/** The source's `Naam;Console;Deelnemer 1;Deelnemer 2;Groep` layout export. */
internal fun androidGroupBoardCsv(
    groups: List<AndroidTournamentGroup>,
): String {
    val builder = StringBuilder("\uFEFFSwitcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep\r\n")
    groups.forEach { group ->
        val stations = group.members.mapNotNull { member ->
            member.station?.let { it.ownerPlayerId to it.switchType }
        }.distinct()
        stations.forEach { (ownerId, switchType) ->
            val seats = group.members.filter {
                it.station?.ownerPlayerId == ownerId && it.station?.switchType == switchType
            }.sortedBy { it.station?.seatNumber ?: 0 }
            val owner = group.members.firstOrNull { it.station?.ownerPlayerId == ownerId }
                ?.station?.ownerDisplayName ?: ownerId
            builder.append(csvValue(owner)).append(';')
            builder.append(switchType.uppercase()).append(';')
            builder.append(csvValue(seats.getOrNull(0)?.displayName.orEmpty())).append(';')
            builder.append(csvValue(seats.getOrNull(1)?.displayName.orEmpty())).append(';')
            builder.append(csvValue(group.name)).append("\r\n")
        }
        group.members.filter { it.station == null }.forEach { member ->
            builder.append(";;").append(csvValue(member.displayName)).append(";;")
                .append(csvValue(group.name)).append("\r\n")
        }
    }
    return builder.toString()
}

private fun csvValue(value: String): String =
    if (value.any { it == ';' || it == '"' || it == '\n' || it == '\r' }) {
        "\"" + value.replace("\"", "\"\"") + "\""
    } else {
        value
    }

/**
 * A tier's on-screen name in the operator's language. The tier constants keep
 * their Dutch names because the export image uses them; only the board shows
 * them translated, the way the night page does ([androidGroupLabel]).
 */
private fun boardTierLabel(tier: AndroidTournamentTier, language: AndroidProductLanguage): String = when {
    language == AndroidProductLanguage.DUTCH -> tier.name
    tier.key == NewPlayerTier.key -> androidText(language, "New", "Nieuw")
    tier.key == UnknownTier.key -> androidText(language, "Unknown", "Onbekend")
    else -> androidGroupLabel(tier.name, tier.key, dutch = false)
}

@Composable
internal fun TournamentGroupDraftStep(
    document: AndroidTournamentDocument,
    stage: String,
    stepNumber: Int,
    busy: Boolean,
    error: String?,
    notice: String?,
    onHome: () -> Unit,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onLeave: () -> Unit,
    onDelete: (() -> Unit)? = null,
    onMovePlayer: (String, String?) -> Unit,
    onConfirmPlacement: () -> Unit,
    onReopenPlacement: () -> Unit,
    onExportCsv: (String) -> Unit,
    onImportCsvText: (String) -> Unit,
    allowFinalGroupOverride: Boolean = false,
    onSwapPlayers: (String, String) -> Unit = { _, _ -> },
    onSeatPlayer: (String, String, String, String, Int) -> Unit = { _, _, _, _, _ -> },
    onAddKnownPlayer: (AndroidSeatTarget, String, Boolean, Boolean, Boolean) -> Unit = { _, _, _, _, _ -> },
    onAddNewPlayer: (AndroidSeatTarget, String, Boolean, Boolean, Boolean) -> Unit = { _, _, _, _, _ -> },
    onPlaceStation: (String, Int, String, String) -> Unit = { _, _, _, _ -> },
    onAddNewStation: (String, Int, String, String, Boolean) -> Unit = { _, _, _, _, _ -> },
    onRemovePlayer: (String, Boolean) -> Unit = { _, _ -> },
    onRemoveStation: (String, String) -> Unit = { _, _ -> },
    onParkStation: (String, String) -> Unit = { _, _ -> },
    modifier: Modifier,
) {
    var csvExpanded by remember { mutableStateOf(false) }
    var adminExpanded by remember { mutableStateOf(false) }
    var selectedPlayerId by remember(document.summary.revision) { mutableStateOf<String?>(null) }
    var addTarget by remember(document.summary.revision) { mutableStateOf<AndroidAddTarget?>(null) }
    var pendingRemoval by remember(document.summary.revision) { mutableStateOf<AndroidBoardRemoval?>(null) }

    val context = LocalContext.current
    val csvPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val text = runCatching {
                context.contentResolver.openInputStream(uri)?.use { it.readBytes().decodeToString() }
            }.getOrNull()
            if (text != null) onImportCsvText(text)
        }
    }

    val groups = document.groups.filter { it.stage == stage }.sortedBy { it.sequence }
    val cableByStation = androidUtpCableByStation(document)
    val placementLocked = groups.isNotEmpty() && groups.all { it.locked }
    val seatedPlayerIds = groups.flatMap { group -> group.members.map { it.playerId } }.toSet()
    val parkedPlayers = document.participants
        .filter { it.attendance == ATTENDANCE_PRESENT && it.playerId !in seatedPlayerIds }
        .sortedBy { it.displayName.lowercase() }
    val slottedStationKeys = groups.flatMap { group -> androidGroupSlots(group).map { "${it.stationOwnerPlayerId}|${it.switchType}" } }.toSet()
    val parkedStations = document.stations.filter { "${it.ownerPlayerId}|${it.switchType}" !in slottedStationKeys }

    val statsByGroup = groups.associate { it.groupId to androidGroupBoardStats(it, document.participants) }
    val stageSwitches = statsByGroup.values.sumOf { it.switchesAssigned }
    val stageMembers = statsByGroup.values.sumOf { it.memberCount }
    val grandSwitches = stageSwitches + parkedStations.size
    val grandMembers = stageMembers + parkedPlayers.size

    // Stage-wide tier totals, so a group can show "4/11" the way the source does.
    val rankByPlayer = document.participants.associate { it.playerId to it.seedRank }
    val stageTierTotals = mutableMapOf<String, Int>()
    groups.forEach { group ->
        group.members.forEach { member ->
            val tier = tierForRank(rankByPlayer[member.playerId])
            stageTierTotals[tier.key] = (stageTierTotals[tier.key] ?: 0) + 1
        }
    }

    val stageLayoutTitle = if (stage == "final") {
        androidText("Final Groups layout", "Eindgroepen indeling")
    } else {
        androidText("Qualifier Groups layout", "Kwalificatie Groepen indeling")
    }
    val phaseLabel = if (stage == "final") {
        androidText("Step 7 · Check final groups", "Stap 7 · Eindgroepen controleren")
    } else {
        androidText("Step 3 · Create qualifier layout", "Stap 3 · Kwalificatie-indeling maken")
    }
    val confirmLabel = when {
        placementLocked && stage == "final" -> androidText("Reopen layout (Step 7)", "Indeling heropenen (Stap 7)")
        placementLocked -> androidText("Reopen layout", "Indeling heropenen")
        stage == "final" -> androidText("Confirm layout and go to Step 8", "Indeling bevestigen en ga naar Stap 8")
        else -> androidText("Confirm layout and continue", "Indeling bevestigen en doorgaan")
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            // The step paints its own surface: a console screen is never
            // drawn over whatever is behind it (DESIGN_SYSTEM §6).
            .background(Mk8dxDesignTheme.colors.surfaceApp)
            .testTag("tournament-group-draft-step"),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 5.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            TournamentStepHeader(
                backLabel = androidText("Back to Step ${stepNumber - 1}", "Terug naar Stap ${stepNumber - 1}"),
                phaseLabel = phaseLabel,
                tagPrefix = "tournament-group-draft",
                onHome = onHome,
                onBack = onBack,
                menu = {
                    TournamentStepMenu(
                        tagPrefix = "tournament-group-draft",
                        onRefresh = onRefresh,
                        onLeave = onLeave,
                        onDelete = onDelete,
                    )
                },
            )
        }

        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(androidText("Tap ", "Tik "), color = TextSoft, fontSize = 13.sp, lineHeight = 18.sp)
                StepBadge("⇄")
                Text(
                    if (stage == "final") {
                        androidText(
                            " on a card to swap two participants between final groups as an administrator.",
                            " op een kaart om als admin twee deelnemers tussen eindgroepen te wisselen.",
                        )
                    } else {
                        androidText(" on a card to place, swap, or park it.", " op een kaart om in te delen, te wisselen of te parkeren.")
                    },
                    color = TextSoft,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                )
            }
        }

        error?.let { message -> item { BoardNotice(message, DangerRed, "tournament-group-draft-error") } }
        notice?.let { message -> item { BoardNotice(message, TextSoft, "tournament-group-draft-notice") } }

        // The source hides the whole parking zone when nothing is parked.
        if (parkedStations.isNotEmpty()) {
            item {
                BoardPanel(androidText("Parked Nintendo Switches (${parkedStations.size})", "Geparkeerde Nintendo Switches (${parkedStations.size})")) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        parkedStations.forEach { station ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                SwitchChip(station.switchType.uppercase(), enabled = true)
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    "${station.ownerDisplayName} (${station.switchType.uppercase()})",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
            }
        }
        if (parkedPlayers.isNotEmpty()) {
            item {
                // A parked participant must be placeable again from here: tap
                // the row, then pick a group with room - the same interaction
                // the seated rows already have. Without this, parking was a
                // one-way street on the phone.
                BoardPanel(androidText("Parked participants (${parkedPlayers.size})", "Geparkeerde deelnemers (${parkedPlayers.size})")) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val parkedEditable = !placementLocked && !busy
                        parkedPlayers.forEach { participant ->
                            val tier = tierForRank(participant.seedRank)
                            val selected = selectedPlayerId == participant.playerId
                            Surface(
                                color = if (selected) ActionBlue else FieldBackground,
                                shape = RoundedCornerShape(8.dp),
                                border = BorderStroke(1.dp, if (selected) ActionBlue else StrongLine),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .then(
                                        if (parkedEditable) {
                                            Modifier.clickable {
                                                selectedPlayerId =
                                                    if (selected) null else participant.playerId
                                            }
                                        } else {
                                            Modifier
                                        },
                                    )
                                    .testTag("tournament-group-parked-${participant.playerId}"),
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                                ) {
                                    Text(tier.symbol, color = tier.color, fontSize = 13.sp)
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        participant.displayName,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.weight(1f),
                                    )
                                    StepBadge(participant.seedRank?.toString() ?: "?")
                                    if (parkedEditable) {
                                        Spacer(Modifier.width(6.dp))
                                        MoveArrowButton(
                                            displayName = participant.displayName,
                                            onClick = {
                                                selectedPlayerId = if (selected) null else participant.playerId
                                            },
                                            modifier = Modifier.testTag(
                                                "tournament-group-move-${participant.playerId}",
                                            ),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stageLayoutTitle, fontSize = 14.sp, fontWeight = FontWeight.Black)
                Text(
                    androidText("$grandSwitches Switches & $grandMembers participants", "$grandSwitches Switches & $grandMembers deelnemers"),
                    color = TextSoft,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    modifier = Modifier.testTag("tournament-group-draft-total"),
                )
            }
        }

        item {
            StepCollapsible(
                title = androidText("Import / export CSV (Step $stepNumber)", "Importeer / exporteer CSV (Stap $stepNumber)"),
                expanded = csvExpanded,
                onToggle = { csvExpanded = !csvExpanded },
                testTag = "tournament-group-draft-csv",
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SecondaryButton(
                            label = androidText("Import CSV", "Importeer CSV"),
                            onClick = {
                                csvPicker.launch(
                                    arrayOf("text/csv", "text/comma-separated-values", "text/plain", "*/*"),
                                )
                            },
                            testTag = "tournament-group-draft-csv-import",
                            modifier = Modifier.weight(1f),
                        )
                        SecondaryButton(
                            label = androidText("Export CSV", "Exporteer CSV"),
                            onClick = { onExportCsv(androidGroupBoardCsv(groups)) },
                            testTag = "tournament-group-draft-csv-export",
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Text(
                        androidText(
                            "CSV columns: Switcheigenaar, Console (NS1/NS2), Deelnemer 1, Deelnemer 2, Groep. " +
                                "Separated by ; , or a tab; Dutch and English header rows both work.",
                            "CSV kolommen: Switcheigenaar, Console (NS1/NS2), Deelnemer 1, Deelnemer 2, Groep. " +
                                "Gescheiden door ; , of een tab; Nederlandse en Engelse kopregels werken allebei.",
                        ),
                        color = TextSoft,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                }
            }
        }

        itemsIndexedGroups(groups) { index, group ->
            GroupColumn(
                group = group,
                groupIndex = index,
                stats = requireNotNull(statsByGroup[group.groupId]),
                rankByPlayer = rankByPlayer,
                stageTierTotals = stageTierTotals,
                cableByStation = cableByStation,
                selectedPlayerId = selectedPlayerId,
                editable = !placementLocked && !busy,
                onSelect = { selectedPlayerId = if (selectedPlayerId == it) null else it },
                onAddSeat = { target -> selectedPlayerId = null; addTarget = AndroidAddTarget.Seat(target) },
                onAddSlot = { slotIndex -> selectedPlayerId = null; addTarget = AndroidAddTarget.Slot(group.groupId, slotIndex) },
                onRemovePlayer = { member -> pendingRemoval = AndroidBoardRemoval.Player(member) },
                onRemoveStation = { station -> pendingRemoval = AndroidBoardRemoval.Station(station) },
                onParkStation = { station -> onParkStation(station.stationOwnerPlayerId, station.switchType) },
            )
        }

        item {
            AdminActionsPanel(
                document = document,
                stage = stage,
                stepNumber = stepNumber,
                expanded = adminExpanded,
                onToggle = { adminExpanded = !adminExpanded },
                allowFinalGroupOverride = allowFinalGroupOverride,
                editable = !placementLocked && !busy,
                onSwapPlayers = onSwapPlayers,
                onBack = onBack,
                onDelete = onDelete,
            )
        }

        item {
            val ready = parkedPlayers.isEmpty()
            val presentCount = document.participants.count { it.attendance == ATTENDANCE_PRESENT }
            Text(
                if (ready) {
                    androidText(
                        "All $presentCount participants are placed - ready to continue.",
                        "Alle $presentCount deelnemers ingedeeld - klaar om door te gaan.",
                    )
                } else {
                    androidText(
                        "${parkedPlayers.size} participants are not yet placed. " +
                            "Review the groups before continuing.",
                        "Nog ${parkedPlayers.size} deelnemers niet ingedeeld. " +
                            "Controleer de groepen voordat je doorgaat.",
                    )
                },
                color = if (ready) SuccessGreen else WarningAmber,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                modifier = Modifier.testTag("tournament-group-draft-status"),
            )
        }

        item {
            val ready = parkedPlayers.isEmpty()
            Button(
                onClick = { if (placementLocked) onReopenPlacement() else onConfirmPlacement() },
                enabled = !busy && (placementLocked || ready),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (placementLocked) ActionBlue else if (ready) Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusSuccess) else Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusError),
                    contentColor = TextMain,
                    disabledContainerColor = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusError),
                    disabledContentColor = TextSoft,
                ),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, if (placementLocked) StrongLine else if (ready) SuccessGreen else DangerRed),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp)
                    .testTag("tournament-group-draft-confirm"),
            ) { Text(confirmLabel, fontSize = 14.sp, fontWeight = FontWeight.Black) }
        }
    }

    val selected = (groups.flatMap { it.members }.firstOrNull { it.playerId == selectedPlayerId }
        ?: parkedPlayers.firstOrNull { it.playerId == selectedPlayerId }?.let { participant ->
            AndroidTournamentMember(participant.playerId, participant.displayName, Int.MAX_VALUE)
        })
    if (selected != null && !placementLocked && !busy) {
        MovePlayerSheet(
            selected = selected,
            groups = groups,
            stage = stage,
            allowFinalGroupOverride = allowFinalGroupOverride,
            onDismiss = { selectedPlayerId = null },
            onPark = {
                selectedPlayerId = null
                onMovePlayer(selected.playerId, null)
            },
            onSeat = { groupId, ownerId, targetSwitchType, targetSeatNumber ->
                selectedPlayerId = null
                onSeatPlayer(selected.playerId, groupId, ownerId, targetSwitchType, targetSeatNumber)
            },
        )
    }

    addTarget?.let { target ->
        AddSheet(
            target = target,
            document = document,
            stage = stage,
            parkedPlayers = parkedPlayers,
            parkedStations = parkedStations,
            onDismiss = { addTarget = null },
            onPlaceParkedPlayer = { seat, playerId ->
                addTarget = null
                onSeatPlayer(playerId, seat.groupId, seat.ownerPlayerId, seat.switchType, seat.seatNumber)
            },
            onAddKnownPlayer = { seat, playerId, ns1, ns2, park -> addTarget = null; onAddKnownPlayer(seat, playerId, ns1, ns2, park) },
            onAddNewPlayer = { seat, name, ns1, ns2, park -> addTarget = null; onAddNewPlayer(seat, name, ns1, ns2, park) },
            onPlaceStation = { groupId, slotIndex, ownerId, switchType -> addTarget = null; onPlaceStation(groupId, slotIndex, ownerId, switchType) },
            onAddNewStation = { groupId, slotIndex, ownerId, switchType, park -> addTarget = null; onAddNewStation(groupId, slotIndex, ownerId, switchType, park) },
        )
    }
    pendingRemoval?.let { removal ->
        RemovalDialog(
            removal = removal,
            document = document,
            onDismiss = { pendingRemoval = null },
            onRemovePlayer = { playerId, dropSwitches -> pendingRemoval = null; onRemovePlayer(playerId, dropSwitches) },
            onRemoveStation = { ownerId, switchType -> pendingRemoval = null; onRemoveStation(ownerId, switchType) },
        )
    }
}

/** LazyListScope helper so the group cards keep a stable key. */
private fun androidx.compose.foundation.lazy.LazyListScope.itemsIndexedGroups(
    groups: List<AndroidTournamentGroup>,
    content: @Composable (Int, AndroidTournamentGroup) -> Unit,
) {
    groups.forEachIndexed { index, group ->
        item(key = "group-${group.groupId}") { content(index, group) }
    }
}

@Composable
private fun BoardNotice(message: String, color: Color, testTag: String) {
    Surface(
        color = FieldBackground,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, color),
        modifier = Modifier.fillMaxWidth().testTag(testTag),
    ) {
        Text(message, color = color, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(10.dp))
    }
}

@Composable
private fun BoardPanel(title: String, content: @Composable () -> Unit) {
    Surface(
        color = PanelBackground,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, PanelBorder),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, fontSize = 13.sp, lineHeight = 17.sp, fontWeight = FontWeight.Black)
            content()
        }
    }
}

/**
 * The source Manager exposes this on every participant card on a phone.  It
 * deliberately remains a separate target from the row: a long tournament
 * board must still scroll reliably while its move action stays obvious.
 */
@Composable
private fun MoveArrowButton(
    displayName: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val moveDescription = androidText("Move $displayName", "Verplaats $displayName")
    Box(
        modifier = modifier
            .size(34.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(FieldBackground)
            .border(BorderStroke(1.dp, StrongLine), RoundedCornerShape(9.dp))
            .semantics { contentDescription = moveDescription }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text("⇄", color = TextSoft, fontSize = 15.sp, fontWeight = FontWeight.Black)
    }
}

/** The source phone sheet: first choose a group, then the exact Switch seat. */
@Composable
private fun MovePlayerSheet(
    selected: AndroidTournamentMember,
    groups: List<AndroidTournamentGroup>,
    stage: String,
    allowFinalGroupOverride: Boolean,
    onDismiss: () -> Unit,
    onPark: () -> Unit,
    onSeat: (groupId: String, ownerId: String, switchType: String, seatNumber: Int) -> Unit,
) {
    var targetGroupId by remember(selected.playerId) { mutableStateOf<String?>(null) }
    val sourceGroup = groups.firstOrNull { group -> group.members.any { it.playerId == selected.playerId } }
    val target = targetGroupId?.let { id -> groups.firstOrNull { it.groupId == id } }
    val dutch = LocalAndroidProductLanguage.current == AndroidProductLanguage.DUTCH
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            color = PanelBackground,
            shape = RoundedCornerShape(16.dp),
            border = BorderStroke(1.dp, StrongLine),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    if (target == null) {
                        androidText("Move ${selected.displayName}", "Verplaats ${selected.displayName}")
                    } else {
                        val targetName = androidGroupLabel(target.name, target.tierKey, dutch)
                        androidText("Choose a seat in $targetName", "Kies plek in $targetName")
                    },
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Black,
                )
                Text(
                    if (target == null) {
                        androidText(
                            "First choose a group. Then choose the exact seat: place on an empty seat or swap with the occupied seat.",
                            "Kies eerst een groep. Daarna kies je de exacte stoel: plaats op een lege plek of wissel met de bezette plek.",
                        )
                    } else {
                        androidText(
                            "An occupied seat swaps both participants; an empty seat places ${selected.displayName}.",
                            "Een bezette plek wisselt beide deelnemers; een lege plek plaatst ${selected.displayName}.",
                        )
                    },
                    color = TextSoft,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                )
                if (target == null) {
                    groups.forEach { group ->
                        val free = group.members.count { it.station == null } +
                            (group.members.mapNotNull { it.station }
                                .map { it.ownerPlayerId to it.switchType }.distinct().size * 2 -
                                group.members.count { it.station != null })
                        val crossFinal = stage == "final" && sourceGroup?.groupId != group.groupId
                        val groupName = androidGroupLabel(group.name, group.tierKey, dutch)
                        SecondaryButton(
                            label = if (free > 0) {
                                androidText("$groupName · $free free", "$groupName · $free vrij")
                            } else {
                                androidText("$groupName · full · swap", "$groupName · vol · wissel")
                            },
                            onClick = { targetGroupId = group.groupId },
                            enabled = !crossFinal || allowFinalGroupOverride,
                            testTag = "tournament-move-sheet-group-${group.groupId}",
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (stage == "final" && !allowFinalGroupOverride) {
                        Text(
                            androidText(
                                "Only an administrator can swap between final groups.",
                                "Tussen eindgroepen wisselen kan alleen door een administrator.",
                            ),
                            color = WarningAmber, fontSize = 12.sp, lineHeight = 16.sp,
                        )
                    }
                    if (sourceGroup != null) {
                        SecondaryButton(
                            label = androidText("Park", "Parkeer"),
                            onClick = onPark,
                            testTag = "tournament-move-sheet-park",
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                } else {
                    val stations = target.members.mapNotNull { member -> member.station }
                        .map { it.ownerPlayerId to it.switchType }.distinct()
                    stations.forEach { (ownerId, switchType) ->
                        Text("$ownerId (${switchType.uppercase()})", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        (1..2).forEach { seatNumber ->
                            val occupant = target.members.firstOrNull { member ->
                                member.station?.ownerPlayerId == ownerId &&
                                    member.station.switchType == switchType && member.station.seatNumber == seatNumber
                            }
                            val isOwnSeat = occupant?.playerId == selected.playerId
                            val crossFinal = stage == "final" && sourceGroup?.groupId != target.groupId
                            val allowed = !isOwnSeat && (!crossFinal || (allowFinalGroupOverride && occupant != null))
                            SecondaryButton(
                                label = occupant?.let { androidText("${it.displayName} · swap", "${it.displayName} · wissel") }
                                    ?: androidText("Empty seat · place", "Lege plek · plaats"),
                                onClick = { onSeat(target.groupId, ownerId, switchType, seatNumber) },
                                enabled = allowed,
                                testTag = "tournament-move-sheet-seat-${target.groupId}-${ownerId}-${switchType}-$seatNumber",
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                    SecondaryButton(
                        label = androidText("← Groups", "← Groepen"),
                        onClick = { targetGroupId = null },
                        testTag = "tournament-move-sheet-back",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                SecondaryButton(
                    label = androidText("Cancel", "Annuleren"),
                    onClick = onDismiss,
                    testTag = "tournament-move-sheet-cancel",
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun GroupColumn(
    group: AndroidTournamentGroup,
    groupIndex: Int,
    stats: AndroidGroupBoardStats,
    rankByPlayer: Map<String, Int?>,
    stageTierTotals: Map<String, Int>,
    cableByStation: Map<String, Int>,
    selectedPlayerId: String?,
    editable: Boolean,
    onSelect: (String) -> Unit,
    onAddSeat: (AndroidSeatTarget) -> Unit,
    onAddSlot: (Int) -> Unit,
    onRemovePlayer: (AndroidTournamentMember) -> Unit,
    onRemoveStation: (AndroidLayoutStationRequest) -> Unit,
    onParkStation: (AndroidLayoutStationRequest) -> Unit,
) {
    val accent = groupColorForIndex(groupIndex)
    val tierCounts = mutableMapOf<String, Int>()
    group.members.forEach { member ->
        val tier = tierForRank(rankByPlayer[member.playerId])
        tierCounts[tier.key] = (tierCounts[tier.key] ?: 0) + 1
    }
    val visibleTiers = (TournamentTiers + NewPlayerTier).filter { (tierCounts[it.key] ?: 0) > 0 }
    val dutch = LocalAndroidProductLanguage.current == AndroidProductLanguage.DUTCH
    val ownerNames = (group.stations.map { it.ownerPlayerId to it.ownerDisplayName } +
        group.members.mapNotNull { it.station }.map { it.ownerPlayerId to it.ownerDisplayName }).toMap()

    Surface(
        color = PanelBackground,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, accent),
        modifier = Modifier.fillMaxWidth().testTag("tournament-group-${group.groupId}"),
    ) {
        Column(Modifier.padding(11.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(12.dp).clip(RoundedCornerShape(6.dp)).background(accent))
                Spacer(Modifier.width(7.dp))
                Text(
                    androidGroupLabel(group.name, group.tierKey, dutch),
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.weight(1f),
                )
                StepBadge(
                    androidText(
                        "${stats.switchesAssigned}/$TOURNAMENT_GROUP_SWITCHES Switch · " +
                            "${stats.seatedCount}/${stats.seatCapacity} seats",
                        "${stats.switchesAssigned}/$TOURNAMENT_GROUP_SWITCHES Switch · " +
                            "${stats.seatedCount}/${stats.seatCapacity} plek",
                    ),
                )
            }

            if (visibleTiers.isEmpty()) {
                Text(androidText("No labels", "Geen labels"), color = TextSoft, fontSize = 11.sp)
            } else {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    visibleTiers.forEach { tier ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(tier.symbol, color = tier.color, fontSize = 12.sp)
                            Spacer(Modifier.width(3.dp))
                            Text(
                                "${boardTierLabel(tier, LocalAndroidProductLanguage.current)} ${tierCounts[tier.key] ?: 0}/${stageTierTotals[tier.key] ?: 0}",
                                color = TextSoft,
                                fontSize = 11.sp,
                                lineHeight = 15.sp,
                                softWrap = false,
                            )
                        }
                    }
                }
            }

            if (stats.unseatedCount > 0) {
                Text(
                    androidText("Not yet seated: ${stats.unseatedCount}", "Nog niet geplaatst: ${stats.unseatedCount}"),
                    color = WarningAmber,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                )
            }

            Text(
                androidText(
                    "Avg. SP: ${formatRankMetric(stats.averageSkill)} · Spread: " +
                        "+${formatRankMetric(stats.spreadPlus)} / -${formatRankMetric(stats.spreadMinus)}",
                    "Gem. SP: ${formatRankMetric(stats.averageSkill)} · Spreiding: " +
                        "+${formatRankMetric(stats.spreadPlus)} / -${formatRankMetric(stats.spreadMinus)}",
                ),
                color = TextSoft,
                fontSize = 11.sp,
                lineHeight = 15.sp,
            )

            // The stored slot order, six slots long: a console before anybody
            // sits at it, and a dashed "+ Switch toevoegen" for each empty slot.
            val slots = androidGroupSlots(group)
            (0 until TOURNAMENT_GROUP_SWITCHES).forEach { slotIndex ->
                val slot = slots.getOrNull(slotIndex)
                if (slot == null) {
                    if (editable) {
                        AddPlaceholder(
                            label = androidText("Add Switch", "Switch toevoegen"),
                            description = androidText("Add Switch", "Switch toevoegen"),
                            tall = true,
                            testTag = "tournament-group-add-slot-${group.groupId}-$slotIndex",
                            onClick = { onAddSlot(slotIndex) },
                        )
                    }
                } else {
                    val seats = group.members.filter {
                        it.station?.ownerPlayerId == slot.stationOwnerPlayerId && it.station?.switchType == slot.switchType
                    }
                    StationCard(
                        groupId = group.groupId,
                        station = slot,
                        ownerDisplayName = ownerNames[slot.stationOwnerPlayerId] ?: slot.stationOwnerPlayerId,
                        cableNumber = androidUtpCableNumber(cableByStation, slot.stationOwnerPlayerId, slot.switchType),
                        seats = seats,
                        rankByPlayer = rankByPlayer,
                        selectedPlayerId = selectedPlayerId,
                        editable = editable,
                        onSelect = onSelect,
                        onAddSeat = onAddSeat,
                        onRemovePlayer = onRemovePlayer,
                        onRemoveStation = onRemoveStation,
                        onParkStation = onParkStation,
                    )
                }
            }

            group.members.filter { it.station == null }.forEach { member ->
                SeatRow(
                    member = member,
                    seatNumber = null,
                    rankByPlayer = rankByPlayer,
                    selected = selectedPlayerId == member.playerId,
                    editable = editable,
                    onSelect = onSelect,
                    onRemove = { onRemovePlayer(member) },
                )
            }
        }
    }
}

@Composable
private fun StationCard(
    groupId: String,
    station: AndroidLayoutStationRequest,
    ownerDisplayName: String,
    cableNumber: Int?,
    seats: List<AndroidTournamentMember>,
    rankByPlayer: Map<String, Int?>,
    selectedPlayerId: String?,
    editable: Boolean,
    onSelect: (String) -> Unit,
    onAddSeat: (AndroidSeatTarget) -> Unit,
    onRemovePlayer: (AndroidTournamentMember) -> Unit,
    onRemoveStation: (AndroidLayoutStationRequest) -> Unit,
    onParkStation: (AndroidLayoutStationRequest) -> Unit,
) {
    Surface(
        color = BoardBackground,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, BoardBorder),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SwitchChip(station.switchType.uppercase(), enabled = true)
                Spacer(Modifier.width(6.dp))
                Text(
                    "$ownerDisplayName (${station.switchType.uppercase()})",
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f, fill = false),
                )
                cableNumber?.let {
                    Spacer(Modifier.width(6.dp))
                    UtpCableChip(it)
                }
                if (editable) {
                    Spacer(Modifier.weight(1f))
                    SmallPillButton(
                        label = androidText("Park", "Parkeer"),
                        description = androidText(
                            "Move $ownerDisplayName's Nintendo Switch to parking",
                            "Nintendo Switch van $ownerDisplayName naar parking",
                        ),
                        onClick = { onParkStation(station) },
                    )
                    Spacer(Modifier.width(4.dp))
                    RemoveButton(
                        description = androidText(
                            "Remove $ownerDisplayName's ${station.switchType.uppercase()}",
                            "${station.switchType.uppercase()} van $ownerDisplayName verwijderen",
                        ),
                        onClick = { onRemoveStation(station) },
                    )
                }
            }
            (1..2).forEach { seatNumber ->
                val member = seats.firstOrNull { it.station?.seatNumber == seatNumber }
                if (member != null) {
                    SeatRow(
                        member = member,
                        seatNumber = seatNumber,
                        rankByPlayer = rankByPlayer,
                        selected = selectedPlayerId == member.playerId,
                        editable = editable,
                        onSelect = onSelect,
                        onRemove = { onRemovePlayer(member) },
                    )
                } else if (editable) {
                    AddPlaceholder(
                        label = androidText("Participant", "Deelnemer"),
                        description = androidText("Add participant", "Deelnemer toevoegen"),
                        tall = false,
                        testTag = "tournament-group-add-seat-$groupId-${station.stationOwnerPlayerId}-${station.switchType}-$seatNumber",
                        onClick = {
                            onAddSeat(AndroidSeatTarget(groupId, station.stationOwnerPlayerId, station.switchType, seatNumber))
                        },
                    )
                } else {
                    Text(
                        androidText("Empty seat", "Lege plek"),
                        color = TextSoft,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        modifier = Modifier.padding(start = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun SeatRow(
    member: AndroidTournamentMember,
    seatNumber: Int?,
    rankByPlayer: Map<String, Int?>,
    selected: Boolean,
    editable: Boolean,
    onSelect: (String) -> Unit,
    onRemove: () -> Unit = {},
) {
    val tier = tierForRank(rankByPlayer[member.playerId])
    Surface(
        color = if (selected) ActionBlue else FieldBackground,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, if (selected) ActionBlue else StrongLine),
        modifier = Modifier
            .fillMaxWidth()
            .height(40.dp)
            .then(if (editable) Modifier.clickable { onSelect(member.playerId) } else Modifier)
            .testTag("tournament-group-player-${member.playerId}"),
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(tier.symbol, color = tier.color, fontSize = 12.sp)
            Spacer(Modifier.width(6.dp))
            Text(
                member.displayName,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            StepBadge(rankByPlayer[member.playerId]?.toString() ?: "?")
            if (editable) {
                Spacer(Modifier.width(6.dp))
                MoveArrowButton(
                    displayName = member.displayName,
                    onClick = { onSelect(member.playerId) },
                    modifier = Modifier.testTag("tournament-group-move-${member.playerId}"),
                )
                Spacer(Modifier.width(4.dp))
                RemoveButton(
                    description = androidText("Remove ${member.displayName} from the tournament", "${member.displayName} uit het toernooi halen"),
                    onClick = onRemove,
                    modifier = Modifier.testTag("tournament-group-remove-${member.playerId}"),
                )
            }
            if (seatNumber == null) {
                Spacer(Modifier.width(6.dp))
                StepBadge(androidText("No seat", "Geen plek"), color = WarningAmber)
            }
        }
    }
}

/** A seat or a Switch slot on the board that "Toevoegen" fills. */
internal data class AndroidSeatTarget(
    val groupId: String,
    val ownerPlayerId: String,
    val switchType: String,
    val seatNumber: Int,
)

internal sealed interface AndroidAddTarget {
    data class Seat(val seat: AndroidSeatTarget) : AndroidAddTarget
    data class Slot(val groupId: String, val slotIndex: Int) : AndroidAddTarget
}

internal sealed interface AndroidBoardRemoval {
    data class Player(val member: AndroidTournamentMember) : AndroidBoardRemoval
    data class Station(val station: AndroidLayoutStationRequest) : AndroidBoardRemoval
}

/** The dashed "+ Deelnemer" seat and "+ Switch toevoegen" slot. */
@Composable
private fun AddPlaceholder(label: String, description: String, tall: Boolean, testTag: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = if (tall) 84.dp else 44.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(AddSlotBackground)
            .border(BorderStroke(1.dp, StrongLine), RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .semantics { contentDescription = description }
            .testTag(testTag),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PlusGlyph()
            Spacer(Modifier.width(8.dp))
            Text(label, color = TextSoft, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun PlusGlyph() {
    Box(
        modifier = Modifier
            .size(20.dp)
            .clip(RoundedCornerShape(5.dp))
            .border(BorderStroke(1.dp, ActionBlue), RoundedCornerShape(5.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text("+", color = ActionBlue, fontSize = 13.sp, fontWeight = FontWeight.Black, lineHeight = 13.sp)
    }
}

/** The source's ✕ on a seat card and on a Switch card. */
@Composable
private fun RemoveButton(description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(28.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(RemoveBackground)
            .border(BorderStroke(1.dp, DangerRed), RoundedCornerShape(14.dp))
            .semantics { contentDescription = description }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text("✕", color = RemoveForeground, fontSize = 12.sp, fontWeight = FontWeight.Black)
    }
}

@Composable
private fun SmallPillButton(label: String, description: String, onClick: () -> Unit) {
    Surface(
        color = FieldBackground,
        shape = RoundedCornerShape(11.dp),
        border = BorderStroke(1.dp, StrongLine),
        modifier = Modifier.semantics { contentDescription = description }.clickable(onClick = onClick),
    ) {
        Text(label, color = TextMain, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
    }
}

private val AddSlotBackground: Color @Composable get() = Mk8dxDesignTheme.colors.surfaceControl
private val RemoveBackground: Color @Composable get() = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusError)
private val RemoveForeground: Color @Composable get() = Mk8dxDesignTheme.colors.statusError
private val SheetBackground: Color @Composable get() = Mk8dxDesignTheme.colors.surfaceRaised
/** The add-sheet's target pill: the step's one emphasis, on the action token. */
private val GroupPillRed: Color @Composable get() = Mk8dxDesignTheme.colors.actionPrimary

/** A drop-down field: the label above, the current choice in a bordered box. */
@Composable
private fun PickerField(
    label: String,
    options: List<Pair<String, String>>,
    selected: String?,
    onSelect: (String) -> Unit,
    testTag: String,
) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = TextSoft, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Box {
            Surface(
                color = FieldBackground,
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, StrongLine),
                modifier = Modifier.fillMaxWidth().clickable(enabled = options.isNotEmpty()) { open = true }.testTag(testTag),
            ) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        options.firstOrNull { it.first == selected }?.second ?: if (options.isEmpty()) androidText("Nothing available", "Niets beschikbaar") else androidText("Choose…", "Kies…"),
                        fontSize = 16.sp,
                        modifier = Modifier.weight(1f),
                    )
                    Text("⌄", color = TextSoft, fontSize = 16.sp)
                }
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { (value, text) ->
                    DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onSelect(value) })
                }
            }
        }
    }
}

@Composable
private fun SheetTab(label: String, glyph: String, active: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        color = if (active) ActionBlue else PanelBackground,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, if (active) ActionBlue else StrongLine),
        modifier = modifier.heightIn(min = 56.dp).clickable(onClick = onClick),
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Box(
                Modifier.size(20.dp).clip(RoundedCornerShape(5.dp)).background(FieldBackground),
                contentAlignment = Alignment.Center,
            ) { Text(glyph, color = TextMain, fontSize = 11.sp, fontWeight = FontWeight.Black) }
            Spacer(Modifier.width(6.dp))
            Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, lineHeight = 16.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

@Composable
private fun SwitchAvailableBox(ns1: Boolean, ns2: Boolean, onNs1: (Boolean) -> Unit, onNs2: (Boolean) -> Unit) {
    Surface(
        color = PanelBackground,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, PanelBorder),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(androidText("Nintendo Switch available", "Nintendo Switch beschikbaar"), color = TextSoft, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { onNs1(!ns1) }) {
                Checkbox(checked = ns1, onCheckedChange = onNs1)
                Text(androidText("Has NS1", "Heeft NS1"), fontSize = 15.sp)
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { onNs2(!ns2) }) {
                Checkbox(checked = ns2, onCheckedChange = onNs2)
                Text(androidText("Has NS2", "Heeft NS2"), fontSize = 15.sp)
            }
        }
    }
}

@Composable
private fun SheetPrimaryButton(label: String, enabled: Boolean, testTag: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = ActionBlue, contentColor = TextMain),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, StrongLine),
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag(testTag),
    ) { Text(label, fontSize = 17.sp, fontWeight = FontWeight.Black) }
}

/**
 * "Toevoegen": the sheet an empty seat or an empty Switch slot opens. A seat
 * takes a parked Player, a known Player who is not present tonight (present
 * from now, with the Switches they bring) or a new Player; a slot takes a
 * parked Switch or a new one on a present Player's name. "naar parkeerzone"
 * does the same without the placement.
 */
@Composable
private fun AddSheet(
    target: AndroidAddTarget,
    document: AndroidTournamentDocument,
    stage: String,
    parkedPlayers: List<AndroidTournamentParticipant>,
    parkedStations: List<AndroidTournamentStation>,
    onDismiss: () -> Unit,
    onPlaceParkedPlayer: (AndroidSeatTarget, String) -> Unit,
    onAddKnownPlayer: (AndroidSeatTarget, String, Boolean, Boolean, Boolean) -> Unit,
    onAddNewPlayer: (AndroidSeatTarget, String, Boolean, Boolean, Boolean) -> Unit,
    onPlaceStation: (String, Int, String, String) -> Unit,
    onAddNewStation: (String, Int, String, String, Boolean) -> Unit,
) {
    val groups = document.groups.filter { it.stage == stage }
    val dutch = LocalAndroidProductLanguage.current == AndroidProductLanguage.DUTCH
    val groupName = groups.firstOrNull {
        it.groupId == when (target) { is AndroidAddTarget.Seat -> target.seat.groupId; is AndroidAddTarget.Slot -> target.groupId }
    }?.let { androidGroupLabel(it.name, it.tierKey, dutch) } ?: androidText("Group", "Groep")
    val isSeat = target is AndroidAddTarget.Seat
    var tab by remember(target) {
        mutableStateOf(
            when {
                isSeat && parkedPlayers.isNotEmpty() -> "parking"
                isSeat -> "known"
                parkedStations.isNotEmpty() -> "parking"
                else -> "new"
            },
        )
    }
    val known = document.participants.filter { it.attendance != ATTENDANCE_PRESENT }.sortedBy { it.displayName.lowercase() }
    val owners = document.participants.filter { it.attendance == ATTENDANCE_PRESENT }.sortedBy { it.displayName.lowercase() }
    var parkedChoice by remember(target) { mutableStateOf(parkedPlayers.firstOrNull()?.playerId) }
    var knownChoice by remember(target) { mutableStateOf(known.firstOrNull()?.playerId) }
    var newName by remember(target) { mutableStateOf("") }
    var ns1 by remember(target) { mutableStateOf(false) }
    var ns2 by remember(target) { mutableStateOf(false) }
    var parkedStationChoice by remember(target) { mutableStateOf(parkedStations.firstOrNull()?.let { "${it.ownerPlayerId}|${it.switchType}" }) }
    var ownerChoice by remember(target) { mutableStateOf(owners.firstOrNull()?.playerId) }
    var newSwitchType by remember(target) { mutableStateOf("ns1") }
    LaunchedEffectOnce(knownChoice) {
        known.firstOrNull { it.playerId == knownChoice }?.let { ns1 = it.hasSwitch1; ns2 = it.hasSwitch2 }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            color = SheetBackground,
            shape = RoundedCornerShape(16.dp),
            border = BorderStroke(1.dp, StrongLine),
            modifier = Modifier.fillMaxWidth(0.96f).testTag("tournament-add-sheet"),
        ) {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Row(
                    Modifier.fillMaxWidth().background(PanelBackground).padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("+", color = ActionBlue, fontSize = 20.sp, fontWeight = FontWeight.Black)
                    Spacer(Modifier.width(12.dp))
                    Text(androidText("Add", "Toevoegen"), fontSize = 19.sp, fontWeight = FontWeight.Black, modifier = Modifier.weight(1f))
                    Text(if (isSeat) androidText("participant", "deelnemer") else "Nintendo Switch", color = TextSoft, fontSize = 15.sp)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        androidText("Close ✕", "Sluiten ✕"),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable(onClick = onDismiss).testTag("tournament-add-sheet-close"),
                    )
                }
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    // "→ Groep 1 plek 2 · naar parkeerzone"
                    Surface(
                        color = PanelBackground,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, PanelBorder),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("→", fontSize = 16.sp)
                            Spacer(Modifier.width(8.dp))
                            Surface(color = GroupPillRed, shape = RoundedCornerShape(999.dp)) {
                                Text(groupName, color = Mk8dxDesignTheme.colors.actionOnPrimary, fontSize = 14.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(
                                when (target) {
                                    is AndroidAddTarget.Seat -> androidText("seat ${target.seat.seatNumber}", "plek ${target.seat.seatNumber}")
                                    is AndroidAddTarget.Slot -> androidText("Switch slot", "Switch-plek")
                                },
                                fontSize = 14.sp,
                                maxLines = 1,
                                modifier = Modifier.weight(1f),
                            )
                            val parkEnabled = when (target) {
                                is AndroidAddTarget.Seat -> (tab == "known" && knownChoice != null) || (tab == "new" && newName.trim().length >= 2)
                                is AndroidAddTarget.Slot -> tab == "new" && ownerChoice != null
                            }
                            SecondaryButton(
                                label = androidText("to parking", "naar parkeerzone"),
                                enabled = parkEnabled,
                                testTag = "tournament-add-sheet-park",
                                onClick = {
                                    when (target) {
                                        is AndroidAddTarget.Seat -> if (tab == "known") {
                                            knownChoice?.let { onAddKnownPlayer(target.seat, it, ns1, ns2, true) }
                                        } else {
                                            onAddNewPlayer(target.seat, newName.trim(), ns1, ns2, true)
                                        }
                                        is AndroidAddTarget.Slot -> ownerChoice?.let {
                                            onAddNewStation(target.groupId, target.slotIndex, it, newSwitchType, true)
                                        }
                                    }
                                },
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.height(IntrinsicSize.Min)) {
                        if (isSeat) {
                            SheetTab(androidText("Parking\n(${parkedPlayers.size})", "Parkeerzone\n(${parkedPlayers.size})"), "P", tab == "parking", { tab = "parking" }, Modifier.weight(1f).testTag("tournament-add-sheet-tab-parking"))
                            SheetTab(androidText("Known Player", "Bekende speler"), "👤", tab == "known", { tab = "known" }, Modifier.weight(1f).testTag("tournament-add-sheet-tab-known"))
                            SheetTab(androidText("New Player", "Nieuwe speler"), "+", tab == "new", { tab = "new" }, Modifier.weight(1f).testTag("tournament-add-sheet-tab-new"))
                        } else {
                            SheetTab(androidText("From parking\n(${parkedStations.size})", "Uit parkeerzone\n(${parkedStations.size})"), "P", tab == "parking", { tab = "parking" }, Modifier.weight(1f).testTag("tournament-add-sheet-tab-parking"))
                            SheetTab(androidText("New Switch", "Nieuwe Switch"), "🎮", tab == "new", { tab = "new" }, Modifier.weight(1f).testTag("tournament-add-sheet-tab-new"))
                        }
                    }
                    when (target) {
                        is AndroidAddTarget.Seat -> when (tab) {
                            "parking" -> {
                                PickerField(
                                    label = androidText("Participant from parking", "Deelnemer uit parkeerzone"),
                                    options = parkedPlayers.map { it.playerId to it.displayName },
                                    selected = parkedChoice,
                                    onSelect = { parkedChoice = it },
                                    testTag = "tournament-add-sheet-parked-player",
                                )
                                SheetPrimaryButton(androidText("Place on this seat", "Plaats op deze plek"), parkedChoice != null, "tournament-add-sheet-place") {
                                    parkedChoice?.let { onPlaceParkedPlayer(target.seat, it) }
                                }
                            }
                            "known" -> {
                                PickerField(
                                    label = androidText("Known Player (not active in this tournament)", "Bekende speler (niet actief in dit toernooi)"),
                                    options = known.map { participant ->
                                        val state = if (participant.attendance == "waiting") {
                                            androidText("Waiting list", "Wachtlijst")
                                        } else {
                                            androidText("Absent", "Afwezig")
                                        }
                                        val inactive = if (participant.inactive) " · " + androidText("Inactive", "Inactief") else ""
                                        participant.playerId to "${participant.displayName} ($state$inactive)"
                                    },
                                    selected = knownChoice,
                                    onSelect = { knownChoice = it },
                                    testTag = "tournament-add-sheet-known-player",
                                )
                                SwitchAvailableBox(ns1, ns2, { ns1 = it }, { ns2 = it })
                                SheetPrimaryButton(androidText("Place on this seat", "Plaats op deze plek"), knownChoice != null, "tournament-add-sheet-place") {
                                    knownChoice?.let { onAddKnownPlayer(target.seat, it, ns1, ns2, false) }
                                }
                            }
                            else -> {
                                Text(androidText("New Player", "Nieuwe speler"), color = TextSoft, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                OutlinedTextField(
                                    value = newName,
                                    onValueChange = { newName = it },
                                    placeholder = { Text(androidText("e.g. New Player", "Bijv. Nieuwe Deelnemer")) },
                                    singleLine = true,
                                    colors = stepFieldColors(),
                                    modifier = Modifier.fillMaxWidth().testTag("tournament-add-sheet-new-name"),
                                )
                                Text(
                                    androidText(
                                        "A new Player is created on the roster and stays claimable.",
                                        "Een nieuwe speler wordt aangemaakt op de spelerslijst en blijft claimbaar.",
                                    ),
                                    color = TextSoft, fontSize = 12.sp, lineHeight = 16.sp,
                                )
                                SwitchAvailableBox(ns1, ns2, { ns1 = it }, { ns2 = it })
                                SheetPrimaryButton(androidText("Place on this seat", "Plaats op deze plek"), newName.trim().length >= 2, "tournament-add-sheet-place") {
                                    onAddNewPlayer(target.seat, newName.trim(), ns1, ns2, false)
                                }
                            }
                        }
                        is AndroidAddTarget.Slot -> if (tab == "parking") {
                            PickerField(
                                label = androidText("Switch from parking", "Switch uit parkeerzone"),
                                options = parkedStations.map { "${it.ownerPlayerId}|${it.switchType}" to "${it.ownerDisplayName} · ${it.switchType.uppercase()}" },
                                selected = parkedStationChoice,
                                onSelect = { parkedStationChoice = it },
                                testTag = "tournament-add-sheet-parked-station",
                            )
                            SheetPrimaryButton(androidText("Place Switch on this slot", "Plaats Switch op deze plek"), parkedStationChoice != null, "tournament-add-sheet-place") {
                                parkedStationChoice?.let { choice ->
                                    val (ownerId, switchType) = choice.split("|")
                                    onPlaceStation(target.groupId, target.slotIndex, ownerId, switchType)
                                }
                            }
                        } else {
                            PickerField(
                                label = androidText("Owner (present participant)", "Eigenaar (aanwezige deelnemer)"),
                                options = owners.map { it.playerId to it.displayName },
                                selected = ownerChoice,
                                onSelect = { ownerChoice = it },
                                testTag = "tournament-add-sheet-owner",
                            )
                            StepChoiceRow(
                                options = listOf("ns1" to "NS1", "ns2" to "NS2"),
                                selected = newSwitchType,
                                enabled = true,
                                testTag = "tournament-add-sheet-switch-type",
                                onSelect = { newSwitchType = it },
                            )
                            SheetPrimaryButton(androidText("Place Switch on this slot", "Plaats Switch op deze plek"), ownerChoice != null, "tournament-add-sheet-place") {
                                ownerChoice?.let { onAddNewStation(target.groupId, target.slotIndex, it, newSwitchType, false) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Runs [block] again whenever [key] changes - a remembered side effect without a coroutine. */
@Composable
private fun LaunchedEffectOnce(key: Any?, block: () -> Unit) {
    var seen by remember { mutableStateOf<Any?>(Unit) }
    if (seen != key) {
        seen = key
        block()
    }
}

/** The source's two confirmations before a Player or a Switch leaves the tournament. */
@Composable
private fun RemovalDialog(
    removal: AndroidBoardRemoval,
    document: AndroidTournamentDocument,
    onDismiss: () -> Unit,
    onRemovePlayer: (String, Boolean) -> Unit,
    onRemoveStation: (String, String) -> Unit,
) {
    when (removal) {
        is AndroidBoardRemoval.Player -> {
            val participant = document.participants.firstOrNull { it.playerId == removal.member.playerId }
            val ownsSwitch = participant?.let { it.hasSwitch1 || it.hasSwitch2 } ?: false
            var dropSwitches by remember(removal) { mutableStateOf(false) }
            AlertDialog(
                onDismissRequest = onDismiss,
                containerColor = PanelBackground,
                titleContentColor = TextMain,
                textContentColor = TextSoft,
                title = { Text(androidText("Take ${removal.member.displayName} out of Present", "${removal.member.displayName} uit Aanwezig halen"), fontSize = 16.sp, fontWeight = FontWeight.Black) },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            androidText(
                                "Are you sure you want to take ${removal.member.displayName} out of Present? The participant is set to Absent.",
                                "Weet je zeker dat je deelnemer ${removal.member.displayName} uit Aanwezig wilt halen? Deelnemer wordt naar Afwezig gezet.",
                            ),
                            fontSize = 13.sp, lineHeight = 18.sp,
                        )
                        if (ownsSwitch) {
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { dropSwitches = !dropSwitches }) {
                                Checkbox(checked = dropSwitches, onCheckedChange = { dropSwitches = it })
                                Text(
                                    androidText(
                                        "Also take ${removal.member.displayName}'s Nintendo Switch 1 and/or 2 out of the tournament",
                                        "Nintendo Switch 1 en/of 2 van ${removal.member.displayName} ook uit het toernooi halen",
                                    ),
                                    fontSize = 13.sp, lineHeight = 18.sp)
                            }
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { onRemovePlayer(removal.member.playerId, dropSwitches) }, modifier = Modifier.testTag("tournament-remove-player-confirm")) {
                        Text(androidText("Set to Absent", "Naar Afwezig"), color = DangerRed, fontWeight = FontWeight.Black)
                    }
                },
                dismissButton = { TextButton(onClick = onDismiss) { Text(androidText("Cancel", "Annuleren"), color = TextSoft) } },
            )
        }
        is AndroidBoardRemoval.Station -> {
            val owner = document.participants.firstOrNull { it.playerId == removal.station.stationOwnerPlayerId }?.displayName
                ?: removal.station.stationOwnerPlayerId
            val label = if (removal.station.switchType == "ns2") "Nintendo Switch 2" else "Nintendo Switch 1"
            AlertDialog(
                onDismissRequest = onDismiss,
                containerColor = PanelBackground,
                titleContentColor = TextMain,
                textContentColor = TextSoft,
                title = { Text(androidText("Remove $label", "$label verwijderen"), fontSize = 16.sp, fontWeight = FontWeight.Black) },
                text = {
                    Text(
                        androidText(
                            "Are you sure you want to remove $label from the tournament? $label is registered to $owner. It is removed from their profile as well.",
                            "Weet je zeker dat je $label wilt verwijderen uit het toernooi? $label staat op naam van $owner. Deze wordt ook uit diens profiel gehaald.",
                        ),
                        fontSize = 13.sp, lineHeight = 18.sp,
                    )
                },
                confirmButton = {
                    TextButton(onClick = { onRemoveStation(removal.station.stationOwnerPlayerId, removal.station.switchType) }, modifier = Modifier.testTag("tournament-remove-station-confirm")) {
                        Text(androidText("Yes, remove", "Ja, verwijderen"), color = DangerRed, fontWeight = FontWeight.Black)
                    }
                },
                dismissButton = { TextButton(onClick = onDismiss) { Text(androidText("Cancel", "Annuleren"), color = TextSoft) } },
            )
        }
    }
}

/**
 * The source footer "Admin Acties": the Step 7 override (two Players swapped
 * between final groups, an administrator's move), the data actions (back a
 * step, remove the Tournament) and the Tournament's own history.
 */
@Composable
private fun AdminActionsPanel(
    document: AndroidTournamentDocument,
    stage: String,
    stepNumber: Int,
    expanded: Boolean,
    onToggle: () -> Unit,
    allowFinalGroupOverride: Boolean,
    editable: Boolean,
    onSwapPlayers: (String, String) -> Unit,
    onBack: () -> Unit,
    onDelete: (() -> Unit)?,
) {
    StepCollapsible(title = androidText("Admin actions", "Admin Acties"), expanded = expanded, onToggle = onToggle, testTag = "tournament-group-draft-admin") {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                androidText(
                    "Management actions for tournament days. Unavailable actions always show the reason.",
                    "Beheer- en testacties voor toernooidagen. Niet-beschikbare acties tonen altijd de reden.",
                ),
                color = TextSoft, fontSize = 12.sp, lineHeight = 16.sp,
            )
            if (stage == "final") {
                val groups = document.groups.filter { it.stage == "final" }.sortedBy { it.sequence }
                val seated = groups.flatMap { group -> group.members.map { member -> Triple(group, member, "${member.displayName} · ${androidGroupLabel(group.name, group.tierKey, LocalAndroidProductLanguage.current)}") } }
                var first by remember { mutableStateOf(seated.firstOrNull()?.second?.playerId) }
                var second by remember { mutableStateOf(seated.getOrNull(1)?.second?.playerId) }
                val firstGroup = seated.firstOrNull { it.second.playerId == first }?.first
                val secondGroup = seated.firstOrNull { it.second.playerId == second }?.first
                val reason = when {
                    !allowFinalGroupOverride -> androidText(
                        "Only an administrator can swap between final groups.",
                        "Alleen een administrator kan tussen eindgroepen wisselen.",
                    )
                    !editable -> androidText(
                        "This action is only available while the final layout is open.",
                        "Deze actie is alleen beschikbaar zolang de eindgroep-indeling open staat.",
                    )
                    groups.count { it.members.isNotEmpty() } < 2 -> androidText(
                        "At least two final groups with Players are needed.",
                        "Minimaal twee eindgroepen met deelnemers nodig.",
                    )
                    first == null || second == null -> androidText("Choose two participants.", "Kies twee deelnemers.")
                    first == second -> androidText("Choose two different participants.", "Kies twee verschillende deelnemers.")
                    firstGroup?.groupId == secondGroup?.groupId -> androidText(
                        "Choose Players from two different final groups.",
                        "Kies spelers uit twee verschillende eindgroepen.",
                    )
                    else -> null
                }
                AdminCard(title = androidText("Step 7 Admin Override", "Stap 7 Admin Override"), badge = androidText("Active in Step 7", "Actief in Stap 7")) {
                    Text(
                        androidText(
                            "Swap two Players between different final groups. Only meant as a manual admin override; " +
                                "it changes nothing about the ordinary drag behaviour.",
                            "Wissel twee spelers tussen verschillende eindgroepen. Dit is alleen bedoeld als handmatige " +
                                "admin-override en verandert niets aan het normale sleepgedrag.",
                        ),
                        color = TextSoft, fontSize = 12.sp, lineHeight = 16.sp,
                    )
                    PickerField(androidText("Player from final group A", "Speler uit eindgroep A"), seated.map { it.second.playerId to it.third }, first, { first = it }, "tournament-admin-swap-a")
                    PickerField(androidText("Player from final group B", "Speler uit eindgroep B"), seated.map { it.second.playerId to it.third }, second, { second = it }, "tournament-admin-swap-b")
                    SecondaryButton(
                        label = androidText("Swap Players between final groups", "Wissel spelers tussen eindgroepen"),
                        enabled = reason == null,
                        testTag = "tournament-admin-swap",
                        onClick = { if (first != null && second != null) onSwapPlayers(first!!, second!!) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    reason?.let { Text(it, color = TextSoft, fontSize = 12.sp, lineHeight = 16.sp) }
                }
            }
            AdminCard(title = androidText("Tournament management", "Toernooibeheer"), badge = androidText("Data actions", "Data-acties")) {
                SecondaryButton(
                    label = androidText("Back to Step ${stepNumber - 1}", "Terug naar Stap ${stepNumber - 1}"),
                    onClick = onBack,
                    testTag = "tournament-admin-back",
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(androidText("Reopens the previous step. Work that depends on this step is reset.", "Heropent de vorige stap. Werk dat van deze stap afhangt wordt teruggezet."), color = TextSoft, fontSize = 12.sp, lineHeight = 16.sp)
                SecondaryButton(
                    label = androidText("Remove selected tournament", "Verwijder geselecteerd toernooi"),
                    onClick = { onDelete?.invoke() },
                    enabled = onDelete != null,
                    testTag = "tournament-admin-delete",
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    if (onDelete == null) {
                        androidText(
                            "Removal is no longer possible once races have been entered.",
                            "Verwijderen kan niet meer zodra er races zijn ingevoerd.",
                        )
                    } else {
                        androidText(
                            "Removal can be undone by an administrator; the audit trail stays.",
                            "Verwijderen kan een administrator ongedaan maken; het auditspoor blijft.",
                        )
                    },
                    color = TextSoft, fontSize = 12.sp, lineHeight = 16.sp,
                )
            }
            AdminCard(title = androidText("History", "Geschiedenis"), badge = null) {
                if (document.lifecycle.isEmpty()) {
                    Text(androidText("Nothing has happened yet.", "Er is nog niets gebeurd."), color = TextSoft, fontSize = 12.sp)
                }
                document.lifecycle.take(12).forEach { event ->
                    Text(
                        "${event.eventType}${event.detail?.let { " · $it" } ?: ""}",
                        color = TextSoft, fontSize = 12.sp, lineHeight = 16.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun AdminCard(title: String, badge: String?, content: @Composable () -> Unit) {
    Surface(
        color = BoardBackground,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, BoardBorder),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontSize = 14.sp, fontWeight = FontWeight.Black)
                badge?.let { Spacer(Modifier.width(6.dp)); StepBadge(it) }
            }
            content()
        }
    }
}
