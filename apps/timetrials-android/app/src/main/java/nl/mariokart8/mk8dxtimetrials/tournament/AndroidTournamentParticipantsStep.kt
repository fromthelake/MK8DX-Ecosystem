package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme as Mk8dxDesignTheme
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.R
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * Step 2 of the source Manager flow ("Stap 2: Deelnemers en consoles").
 *
 * The reference is the running original at
 * `http://localhost/MK8DX%20Seating%20&%20Standings%20Manager/` rendered at a
 * Vivo X200 Pro phone viewport. That page keeps the whole step on one column:
 * explanation, collapsible guide, console legend, CSV block, the roster board
 * with an A/W/X segmented control per participant, the roster filter, the add
 * participant row, the collapsible settings and ranking blocks, and finally the
 * readiness checklist with the "Maak kwalificatiegroepen" gate.
 */

private const val SYSTEM_MAX_ACTIVE_PARTICIPANTS = 60

internal const val ATTENDANCE_PRESENT = "present"
internal const val ATTENDANCE_WAITING = "waiting"
internal const val ATTENDANCE_ABSENT = "absent"


/** Roster gate values, mirroring `getRosterGateMetrics()` in the source Manager. */
internal data class AndroidRosterGateMetrics(
    val activeCount: Int,
    val waitingCount: Int,
    val absentCount: Int,
    val ns1Count: Int,
    val ns2Count: Int,
    val totalConsoles: Int,
    val minConsoles: Int,
    val maxParticipants: Int?,
    val maxParticipantsExceeded: Boolean,
    val isReady: Boolean,
    val seedButtonMode: String,
    val readinessReason: String,
)

internal fun androidRosterGateMetrics(
    document: AndroidTournamentDocument,
    language: AndroidProductLanguage,
): AndroidRosterGateMetrics {
    val participants = document.participants
    val activeCount = participants.count { it.attendance == ATTENDANCE_PRESENT }
    val waitingCount = participants.count { it.attendance == ATTENDANCE_WAITING }
    val absentCount = participants.count { it.attendance == ATTENDANCE_ABSENT }
    val ns1Count = participants.count { it.hasSwitch1 }
    val ns2Count = participants.count { it.hasSwitch2 }
    val totalConsoles = ns1Count + ns2Count
    val minConsoles = (activeCount + 1) / 2
    val maxParticipants = document.summary.maxParticipants?.takeIf { it > 0 }
    val maxParticipantsExceeded = maxParticipants != null && activeCount > maxParticipants
    val enoughPlayers = activeCount > 0
    val withinSystemCap = activeCount <= SYSTEM_MAX_ACTIVE_PARTICIPANTS
    val enoughConsoles = totalConsoles >= minConsoles
    val isReady = enoughPlayers && withinSystemCap && enoughConsoles && !maxParticipantsExceeded
    val reason = when {
        isReady -> ""
        !enoughPlayers -> androidText(
            language,
            "Not ready: mark at least 1 participant as Present.",
            "Nog niet klaar: markeer minimaal 1 deelnemer als Aanwezig.",
        )
        !withinSystemCap -> {
            val reduceBy = (activeCount - SYSTEM_MAX_ACTIVE_PARTICIPANTS).coerceAtLeast(0)
            androidText(
                language,
                "Current status: $activeCount Present participants.\n" +
                    "Required: at most $SYSTEM_MAX_ACTIVE_PARTICIPANTS Present participants.\n" +
                    "Solution: move $reduceBy participants from Present to Waiting list or Absent.",
                "Huidige status: $activeCount Aanwezige Deelnemers.\n" +
                    "Benodigd: maximaal $SYSTEM_MAX_ACTIVE_PARTICIPANTS Aanwezige Deelnemers.\n" +
                    "Oplossing: verplaats $reduceBy deelnemers van Aanwezig naar Wachtlijst of Afwezig.",
            )
        }
        maxParticipantsExceeded -> {
            val limit = requireNotNull(maxParticipants)
            val reduceBy = (activeCount - limit).coerceAtLeast(0)
            androidText(
                language,
                "Current status: $activeCount Present participants, limit $limit.\n" +
                    "Required: Present must be <= $limit.\n" +
                    "Solution 1: move $reduceBy participants from Present to Waiting list or Absent.\n" +
                    "Solution 2: raise (or clear) Maximum places if the venue permits it.",
                "Huidige status: $activeCount Aanwezige Deelnemers, limiet $limit.\n" +
                    "Benodigd: Aanwezig moet <= $limit zijn.\n" +
                    "Oplossing 1: Verplaats $reduceBy deelnemers van Aanwezig naar Wachtlijst of Afwezig.\n" +
                    "Oplossing 2: Verhoog (of leeg) Max aantal plaatsen als de locatie dit toelaat.",
            )
        }
        else -> {
            val missing = (minConsoles - totalConsoles).coerceAtLeast(0)
            val capacity = totalConsoles * 2
            val reduceBy = (activeCount - capacity).coerceAtLeast(0)
            androidText(
                language,
                "Current status: $activeCount Present participants, $totalConsoles Nintendo Switches.\n" +
                    "Required: $minConsoles Nintendo Switches ($activeCount/2, rounded up).\n" +
                    "Solution 1: add $missing Nintendo Switches ($totalConsoles -> $minConsoles).\n" +
                    "Solution 2: reduce Present by $reduceBy participants ($activeCount -> $capacity, " +
                    "because ${totalConsoles}x2 = $capacity max).",
                "Huidige status: $activeCount Aanwezige Deelnemers, $totalConsoles Nintendo Switches.\n" +
                    "Benodigd: $minConsoles Nintendo Switches ($activeCount/2, afgerond naar boven).\n" +
                    "Oplossing 1: Voeg $missing Nintendo Switches toe ($totalConsoles -> $minConsoles).\n" +
                    "Oplossing 2: Verlaag Aanwezig met $reduceBy Deelnemers ($activeCount -> $capacity, " +
                    "want ${totalConsoles}x2 = $capacity max).",
            )
        }
    }
    return AndroidRosterGateMetrics(
        activeCount = activeCount,
        waitingCount = waitingCount,
        absentCount = absentCount,
        ns1Count = ns1Count,
        ns2Count = ns2Count,
        totalConsoles = totalConsoles,
        minConsoles = minConsoles,
        maxParticipants = maxParticipants,
        maxParticipantsExceeded = maxParticipantsExceeded,
        isReady = isReady,
        seedButtonMode = when {
            !enoughPlayers -> "disabled"
            isReady -> "active"
            else -> "ready"
        },
        readinessReason = reason,
    )
}

/** Source order: unknown-rank participants last, then rank, then display name. */
internal fun androidRosterRows(
    participants: List<AndroidTournamentParticipant>,
    hideInactiveAbsent: Boolean,
): List<AndroidTournamentParticipant> = participants
    .filter { !(hideInactiveAbsent && it.inactive && it.attendance == ATTENDANCE_ABSENT) }
    .sortedWith(
        compareBy<AndroidTournamentParticipant> { if (it.inactive) 1 else 0 }
            .thenBy { it.seedRank ?: Int.MAX_VALUE }
            .thenBy { it.displayName.lowercase(Locale.ROOT) },
    )

/**
 * SP is the canonical conservative TrueSkill score `mu - 3 * sigma`
 * (ADR-0154). A newly created Player starts at the engine's prior, mu 25 and
 * sigma 25/3, so their SP is 0,00 and they seed last (ADR-0177 decision 20).
 *
 * The source Manager's own `MANUAL_DEFAULT_SP = 25.0` is deliberately not
 * shown here: on this scale rated Players run from about 13 to 29, so 25,00
 * would present an unknown player as one of the strongest in the field. A
 * Player whose rating genuinely has not been read yet shows a dash rather
 * than a number that looks like a real score.
 */
private fun formatSkillScore(value: Double?): String =
    if (value == null) "-"
    else String.format(Locale.ROOT, "%.2f", value).replace('.', ',')

@Composable
internal fun TournamentParticipantsStep(
    document: AndroidTournamentDocument,
    busy: Boolean,
    error: String?,
    notice: String?,
    onBackToStart: () -> Unit,
    onRefresh: () -> Unit,
    onSetAttendance: (AndroidTournamentParticipant, String) -> Unit,
    onSetSwitches: (AndroidTournamentParticipant, Boolean, Boolean) -> Unit,
    onAddParticipant: (String) -> Unit,
    participantAddState: AndroidParticipantAdd?,
    onParticipantAddConfirm: () -> Unit,
    onParticipantAddCancel: () -> Unit,
    /** ADR-0218: the Director picked a candidate / chose "new Player" (true after the own-nights warning). */
    onParticipantPick: (AndroidRosterCandidate) -> Unit = {},
    onParticipantCreate: (Boolean) -> Unit = {},
    onAddRecentParticipants: () -> Unit,
    onAddHistoricalParticipants: () -> Unit,
    onMarkOwnersBulk: (Int, String) -> Unit,
    onSetAttendanceBulk: (List<String>, String) -> Unit = { _, _ -> },
    onExportCsv: (String) -> Unit,
    onImportCsvText: (String) -> Unit,
    importState: AndroidRosterImport?,
    onImportConfirm: () -> Unit,
    onImportCancel: () -> Unit,
    /** ADR-0218: the Director's choice for one import row. */
    onImportChoose: (Int, AndroidRosterChoice?) -> Unit = { _, _ -> },
    onCreateQualifierGroups: () -> Unit,
    /** The first value is the ADR-0221 seeding source (community_rating, director_nights, manual, random). */
    onUpdateSettings: (String, String, String, Int?) -> Unit,
    settingsLocked: Boolean,
    modifier: Modifier,
    /** ADR-0221: "only verified Players count for the rating"; editable until the night is finalized. */
    onUpdateVerifiedOnly: (Boolean) -> Unit = {},
    /** ADR-0222: the night's sign-ups, waiting list order and console warning, above the roster. */
    signupPanel: (@Composable () -> Unit)? = null,
) {
    var menuExpanded by remember { mutableStateOf(false) }
    var guideExpanded by remember { mutableStateOf(false) }
    var csvExpanded by remember { mutableStateOf(false) }
    var settingsExpanded by remember { mutableStateOf(false) }
    var rankingExpanded by remember { mutableStateOf(false) }
    var bulkExpanded by remember { mutableStateOf(false) }
    var statusBulkExpanded by remember { mutableStateOf(false) }
    var bulkCount by remember { mutableStateOf("12") }
    var bulkType by remember { mutableStateOf("ns1") }
    var bulkTypeExpanded by remember { mutableStateOf(false) }
    var statusBulkCount by remember { mutableStateOf("12") }
    var statusBulkSource by remember { mutableStateOf(ATTENDANCE_ABSENT) }
    var statusBulkTarget by remember { mutableStateOf(ATTENDANCE_PRESENT) }
    var statusBulkMode by remember { mutableStateOf("top") }
    var hideInactiveAbsent by remember { mutableStateOf(true) }
    var newParticipantName by remember { mutableStateOf("") }

    // Deploy 108 behaviour, kept: the source Manager seeds Step 2 from the
    // ranking, so an empty canonical roster reconciles once from Tournament
    // history instead of presenting the director an empty board.
    var attemptedAutomaticHistory by remember(document.summary.tournamentId) { mutableStateOf(false) }
    LaunchedEffect(document.summary.tournamentId, document.participants.size, busy) {
        if (!attemptedAutomaticHistory && !busy && document.participants.isEmpty()) {
            attemptedAutomaticHistory = true
            onAddHistoricalParticipants()
        }
    }

    val context = LocalContext.current
    val csvPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            val text = runCatching {
                context.contentResolver.openInputStream(uri)?.use { stream ->
                    stream.readBytes().decodeToString()
                }
            }.getOrNull()
            if (text != null) onImportCsvText(text)
        }
    }

    val metrics = androidRosterGateMetrics(document, LocalAndroidProductLanguage.current)
    val rows = androidRosterRows(document.participants, hideInactiveAbsent)
    val hiddenByFilter = document.participants.size - rows.size
    val boardHeight = (LocalConfiguration.current.screenHeightDp * 0.52f).dp
        .coerceAtLeast(300.dp)
        .coerceAtMost(520.dp)

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            // The step paints its own surface: a console screen is never
            // drawn over whatever is behind it (DESIGN_SYSTEM §6).
            .background(Mk8dxDesignTheme.colors.surfaceApp)
            .testTag("tournament-participants-step"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 5.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Box(Modifier.fillMaxWidth()) {
                    Text(
                        androidText("MK8DX LAN Tournament Board", "MK8DX LAN Toernooibord"),
                        fontSize = 16.sp,
                        lineHeight = 20.sp,
                        fontWeight = FontWeight.Black,
                        modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp),
                    )
                    Box(Modifier.align(Alignment.TopEnd)) {
                        Button(
                            onClick = { menuExpanded = true },
                            colors = ButtonDefaults.buttonColors(containerColor = ActionBlue, contentColor = TextMain),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                            shape = RoundedCornerShape(9.dp),
                            modifier = Modifier.size(42.dp).testTag("tournament-participants-menu"),
                        ) { Text("☰", fontSize = 20.sp) }
                        DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                            DropdownMenuItem(
                                text = { Text(androidText("Refresh", "Vernieuwen")) },
                                onClick = { menuExpanded = false; onRefresh() },
                            )
                            DropdownMenuItem(
                                text = { Text(androidText("Add recent participants", "Voeg recente deelnemers toe")) },
                                onClick = { menuExpanded = false; onAddRecentParticipants() },
                            )
                            DropdownMenuItem(
                                text = { Text(androidText("Add historical participants", "Voeg historische deelnemers toe")) },
                                onClick = { menuExpanded = false; onAddHistoricalParticipants() },
                            )
                            DropdownMenuItem(
                                text = { Text(androidText("Mark owners (bulk)", "Markeer eigenaren (bulk)")) },
                                onClick = { menuExpanded = false; bulkExpanded = true },
                            )
                            DropdownMenuItem(
                                text = { Text(androidText("Change statuses (bulk)", "Statussen wijzigen (bulk)")) },
                                onClick = { menuExpanded = false; statusBulkExpanded = true },
                            )
                        }
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = 4.dp),
                ) {
                    Button(
                        onClick = onBackToStart,
                        colors = ButtonDefaults.buttonColors(containerColor = ActionBlue, contentColor = TextMain),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                        shape = RoundedCornerShape(9.dp),
                        modifier = Modifier.size(42.dp).testTag("tournament-participants-home"),
                    ) { Text("🏠", fontSize = 14.sp) }
                    Button(
                        onClick = onBackToStart,
                        colors = ButtonDefaults.buttonColors(containerColor = ActionBlue, contentColor = TextMain),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp),
                        shape = RoundedCornerShape(9.dp),
                        modifier = Modifier.height(42.dp).testTag("tournament-participants-back"),
                    ) { Text(androidText("Back to Step 1", "Terug naar Stap 1"), fontSize = 13.sp, fontWeight = FontWeight.Bold) }
                    Button(
                        enabled = false,
                        onClick = {},
                        colors = ButtonDefaults.buttonColors(
                            disabledContainerColor = FieldBackground,
                            disabledContentColor = TextSoft,
                        ),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                        shape = RoundedCornerShape(9.dp),
                        modifier = Modifier.size(42.dp).testTag("tournament-participants-save"),
                    ) { Text("💾", fontSize = 14.sp) }
                    Surface(
                        color = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusSuccess),
                        shape = RoundedCornerShape(9.dp),
                        border = BorderStroke(1.dp, SuccessGreen),
                        modifier = Modifier.height(42.dp).testTag("tournament-participants-status"),
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 10.dp)) {
                            Text(androidText("✓ Saved", "✓ Opgeslagen"), color = SuccessGreen, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Surface(
                    color = PhaseBadgeBackground,
                    shape = RoundedCornerShape(24.dp),
                    border = BorderStroke(1.dp, PhaseBadgeBorder),
                    modifier = Modifier.padding(top = 6.dp),
                ) {
                    Text(
                        androidText("Step 2 · Select participants", "Stap 2 · Deelnemers selecteren"),
                        color = PhaseBadgeText,
                        fontSize = 14.sp,
                        lineHeight = 18.sp,
                        fontWeight = FontWeight.Black,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 5.dp),
                    )
                }
            }
        }
        if (signupPanel != null) {
            item { signupPanel() }
        }
        item {
            Surface(
                color = PanelBackground,
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, PanelBorder),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(androidText("Step 2: Participants and consoles", "Stap 2: Deelnemers en consoles"), fontSize = 16.sp, lineHeight = 21.sp, fontWeight = FontWeight.Black)
                    Text(
                        androidText(
                            "Follow this step to prepare the participant list.\n" +
                                "You can only continue once the Create qualifier groups button is green.",
                            "Volg deze stap om de deelnemerslijst klaar te zetten.\n" +
                                "Je kunt pas verder als de knop Maak kwalificatiegroepen groen is.",
                        ),
                        color = TextSoft,
                        fontSize = 14.sp,
                        lineHeight = 19.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp, lineHeight = 18.sp) }

                    StepCollapsible(
                        title = androidText("How does this step work?", "Hoe werkt deze stap?"),
                        expanded = guideExpanded,
                        onToggle = { guideExpanded = !guideExpanded },
                        testTag = "tournament-participants-guide",
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            GuideLine(
                                androidText("1. Check the names:", "1. Controleer de namen:"),
                                androidText(
                                    "the base list comes from mariokart8.nl/ranking. Is someone missing? Add them at the bottom under Add participant.",
                                    "de basislijst komt van mariokart8.nl/ranking. Mist er iemand? Voeg die onderaan toe bij Deelnemer toevoegen.",
                                ),
                            )
                            GuideLine(
                                androidText("2. Choose the right status for each person:", "2. Kies per persoon de juiste status:"),
                                androidText(
                                    "Present = playing now, Waiting list = not seated yet, Absent = not playing.",
                                    "Aanwezig = speelt mee nu, Wachtlijst = nog niet ingedeeld, Afwezig = speelt niet mee.",
                                ),
                            )
                            GuideLine(
                                androidText(
                                    "3. Tick for each participant which Switches they can bring to the tournament:",
                                    "3. Vink per deelnemer aan welke switches hij mee kan nemen naar het toernooi:",
                                ),
                                androidText(
                                    "NS1 and NS2. Only consoles of Present participants count for the layout. " +
                                        "Tip: use Mark owners (bulk) to add many Switches quickly.",
                                    "NS1 en NS2. Alleen consoles van Aanwezig tellen mee voor de indeling. " +
                                        "Tip: gebruik Markeer eigenaren (bulk) om snel veel switches toe te voegen.",
                                ),
                            )
                            GuideLine(
                                androidText("4. Optional:", "4. Optioneel:"),
                                androidText(
                                    "fill in Maximum places if there is a limit (leave empty = no limit).",
                                    "vul Max aantal plaatsen in als er een limiet is (leeg laten = geen limiet).",
                                ),
                            )
                            GuideLine(
                                androidText("5. Ready?", "5. Gereed?"),
                                androidText(
                                    "Press the \"Create qualifier groups\" button at the bottom of this page. " +
                                        "Watch the button colour: green = ready to continue, red = read the solution below the button.",
                                    "Druk op de \"Maak kwalificatiegroepen\" knop onderaan deze pagina. " +
                                        "Let op de knopkleur: groen = klaar om verder te gaan, rood = lees de oplossing onder de knop.",
                                ),
                            )
                        }
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SwitchChip("NS1", enabled = true, showLabel = true)
                        Text(" Nintendo Switch 1 · ", color = TextSoft, fontSize = 13.sp)
                        SwitchChip("NS2", enabled = true, showLabel = true)
                        Text(" Nintendo Switch 2.", color = TextSoft, fontSize = 13.sp)
                    }
                    Text(
                        androidText(
                            "Tip: tap A / W / X for each Player for Present, Waiting list, or Absent. " +
                                "Tournament setup and bulk actions are at the bottom under Settings and the ☰ Admin menu.",
                            "Tip: tik per speler op A / W / X voor Aanwezig, Wachtlijst of Afwezig. " +
                                "Toernooi-opzet en bulk-acties staan onderaan bij Instellingen en het ☰ Admin-menu.",
                        ),
                        color = TextSoft,
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                    )

                    StepCollapsible(
                        title = androidText("Import / export CSV (Step 2)", "Importeer / exporteer CSV (Stap 2)"),
                        expanded = csvExpanded,
                        onToggle = { csvExpanded = !csvExpanded },
                        testTag = "tournament-participants-csv",
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                SecondaryButton(
                                    label = androidText("Import CSV", "Importeer CSV"),
                                    onClick = {
                                        csvPicker.launch(arrayOf("text/csv", "text/comma-separated-values", "text/plain", "*/*"))
                                    },
                                    testTag = "tournament-participants-csv-import",
                                    modifier = Modifier.weight(1f),
                                )
                                SecondaryButton(
                                    label = androidText("Export CSV", "Exporteer CSV"),
                                    onClick = { onExportCsv(androidRosterCsv(document.participants)) },
                                    testTag = "tournament-participants-csv-export",
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            Text(
                                androidText(
                                    "CSV columns: Naam, Status, NS1, NS2 (or Name, Status, NS1, NS2). Status: Aanwezig/Wachtlijst/Afwezig " +
                                        "or Present/Waiting/Absent. NS1/NS2: ja/nee, yes/no or 1/0.",
                                    "CSV-kolommen: Naam, Status, NS1, NS2. Status: Aanwezig/Wachtlijst/Afwezig. NS1/NS2: ja/nee of 1/0.",
                                ),
                                color = TextSoft,
                                fontSize = 12.sp,
                                lineHeight = 16.sp,
                            )
                            RosterImportReport(
                                state = importState,
                                onConfirm = onImportConfirm,
                                onCancel = onImportCancel,
                                onChoose = onImportChoose,
                            )
                        }
                    }

                    Surface(
                        color = BoardBackground,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, BoardBorder),
                        modifier = Modifier.fillMaxWidth().height(boardHeight).testTag("tournament-participants-roster"),
                    ) {
                        Column {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(androidText("Present ${metrics.activeCount}", "Aanwezig ${metrics.activeCount}"), color = SuccessGreen, fontSize = 11.sp, fontWeight = FontWeight.Black)
                                Text(androidText("Waiting list ${metrics.waitingCount}", "Wachtlijst ${metrics.waitingCount}"), color = WarningAmber, fontSize = 11.sp, fontWeight = FontWeight.Black)
                                Text(androidText("Absent ${metrics.absentCount}", "Afwezig ${metrics.absentCount}"), color = DangerRed, fontSize = 11.sp, fontWeight = FontWeight.Black)
                            }
                            // The counters above are attendance. Activity is a separate
                            // thing, and the filter that hides inactive absentees sits far
                            // below the board, so say it here where the operator looks.
                            if (hiddenByFilter > 0) {
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable { hideInactiveAbsent = false }
                                        .padding(horizontal = 8.dp, vertical = 4.dp)
                                        .testTag("tournament-participants-hidden-note"),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        androidText("$hiddenByFilter inactive hidden", "$hiddenByFilter inactief verborgen"),
                                        color = ScoreMatchBlue,
                                        fontSize = 11.sp,
                                        lineHeight = 15.sp,
                                        fontWeight = FontWeight.Bold,
                                    )
                                    Spacer(Modifier.weight(1f))
                                    Text(
                                        androidText("Show", "Toon"),
                                        color = ScoreMatchBlue,
                                        fontSize = 11.sp,
                                        lineHeight = 15.sp,
                                        fontWeight = FontWeight.Black,
                                    )
                                }
                            }
                            Box(Modifier.fillMaxWidth().height(1.dp).background(PanelBorder))
                            if (rows.isEmpty()) {
                                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Column(
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.spacedBy(10.dp),
                                        modifier = Modifier.padding(horizontal = 18.dp),
                                    ) {
                                        if (hiddenByFilter > 0) {
                                            // The roster is not empty; the inactive filter hides
                                            // all of it. Saying "no participants" here would be a lie.
                                            Text(
                                                androidText(
                                                    "All $hiddenByFilter participants are inactive absentees " +
                                                        "and are therefore hidden.",
                                                    "Alle $hiddenByFilter deelnemers zijn inactieve afwezigen " +
                                                        "en staan daarom verborgen.",
                                                ),
                                                color = TextSoft,
                                                fontSize = 13.sp,
                                                lineHeight = 18.sp,
                                                textAlign = TextAlign.Center,
                                                modifier = Modifier.testTag("tournament-participants-all-hidden"),
                                            )
                                            SecondaryButton(
                                                label = androidText("Show inactive absentees", "Toon inactieve afwezigen"),
                                                onClick = { hideInactiveAbsent = false },
                                                testTag = "tournament-participants-show-inactive",
                                            )
                                        } else {
                                            Text(
                                                androidText(
                                                    "No participants yet. Add them at the bottom or use the ☰ Admin menu.",
                                                    "Nog geen deelnemers. Voeg ze onderaan toe of gebruik het ☰ Admin-menu.",
                                                ),
                                                color = TextSoft,
                                                fontSize = 13.sp,
                                                lineHeight = 18.sp,
                                                textAlign = TextAlign.Center,
                                            )
                                        }
                                    }
                                }
                            } else {
                                LazyColumn(
                                    modifier = Modifier.fillMaxSize().testTag("tournament-participants-roster-list"),
                                    contentPadding = androidx.compose.foundation.layout.PaddingValues(8.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    items(rows, key = { it.playerId }) { participant ->
                                        RosterRow(
                                            participant = participant,
                                            enabled = !busy,
                                            onSetAttendance = { onSetAttendance(participant, it) },
                                            onSetSwitches = { ns1, ns2 -> onSetSwitches(participant, ns1, ns2) },
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clickable { hideInactiveAbsent = !hideInactiveAbsent }
                            .testTag("tournament-participants-hide-inactive"),
                    ) {
                        CheckSquare(checked = hideInactiveAbsent)
                        Spacer(Modifier.width(6.dp))
                        Text(
                            if (hiddenByFilter > 0) {
                                androidText("Hide inactive absentees ($hiddenByFilter)", "Inactieve afwezigen verbergen ($hiddenByFilter)")
                            } else {
                                androidText("Hide inactive absentees", "Inactieve afwezigen verbergen")
                            },
                            fontSize = 14.sp,
                        )
                    }

                    if (bulkExpanded) {
                        Surface(
                            color = SettingsBackground,
                            shape = RoundedCornerShape(10.dp),
                            border = BorderStroke(1.dp, StrongLine),
                            modifier = Modifier.fillMaxWidth().testTag("tournament-participants-bulk"),
                        ) {
                            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(androidText("Mark owners (first N Present)", "Markeer eigenaren (eerste N Aanwezigen)"), color = TextSoft, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    OutlinedTextField(
                                        value = bulkCount,
                                        onValueChange = { value -> bulkCount = value.filter(Char::isDigit).take(3) },
                                        singleLine = true,
                                        colors = stepFieldColors(),
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.width(88.dp).testTag("tournament-participants-bulk-count"),
                                    )
                                    Box {
                                        SecondaryButton(
                                            label = bulkType.uppercase(Locale.ROOT),
                                            onClick = { bulkTypeExpanded = true },
                                            testTag = "tournament-participants-bulk-type",
                                        )
                                        DropdownMenu(expanded = bulkTypeExpanded, onDismissRequest = { bulkTypeExpanded = false }) {
                                            DropdownMenuItem(text = { Text("NS1") }, onClick = { bulkType = "ns1"; bulkTypeExpanded = false })
                                            DropdownMenuItem(text = { Text("NS2") }, onClick = { bulkType = "ns2"; bulkTypeExpanded = false })
                                        }
                                    }
                                    SecondaryButton(
                                        label = androidText("Mark owners", "Markeer eigenaren"),
                                        onClick = { onMarkOwnersBulk(bulkCount.toIntOrNull() ?: 0, bulkType) },
                                        testTag = "tournament-participants-bulk-apply",
                                        modifier = Modifier.weight(1f),
                                    )
                                }
                                Text(
                                    androidText(
                                        "Marks the first N Present participants (by ranking) as Switch owner.",
                                        "Markeert de eerste N Aanwezigen (op ranglijst) als Switch-eigenaar.",
                                    ),
                                    color = TextSoft,
                                    fontSize = 12.sp,
                                    lineHeight = 16.sp,
                                )
                            }
                        }
                    }

                    if (statusBulkExpanded) {
                        Surface(
                            color = SettingsBackground,
                            shape = RoundedCornerShape(10.dp),
                            border = BorderStroke(1.dp, StrongLine),
                            modifier = Modifier.fillMaxWidth().testTag("tournament-participants-status-bulk"),
                        ) {
                            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    androidText("Change statuses (bulk)", "Statussen wijzigen (bulk)"),
                                    color = TextSoft,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(androidText("Set all participants to:", "Zet alle deelnemers op:"), color = TextSoft, fontSize = 12.sp)
                                StepChoiceRow(
                                    options = listOf(
                                        ATTENDANCE_PRESENT to androidText("Present", "Aanwezig"),
                                        ATTENDANCE_WAITING to androidText("Waiting list", "Wachtlijst"),
                                        ATTENDANCE_ABSENT to androidText("Absent", "Afwezig"),
                                    ),
                                    selected = "",
                                    enabled = !busy,
                                    testTag = "tournament-participants-status-all",
                                    onSelect = { attendance ->
                                        onSetAttendanceBulk(document.participants.map { it.playerId }, attendance)
                                    },
                                )
                                Text(androidText("Move a selection:", "Verplaats een selectie:"), color = TextSoft, fontSize = 12.sp)
                                OutlinedTextField(
                                    value = statusBulkCount,
                                    onValueChange = { statusBulkCount = it.filter(Char::isDigit).take(3) },
                                    label = { Text(androidText("Number", "Aantal")) },
                                    singleLine = true,
                                    colors = stepFieldColors(),
                                    modifier = Modifier.fillMaxWidth().testTag("tournament-participants-status-count"),
                                )
                                Text(androidText("From", "Van"), color = TextSoft, fontSize = 12.sp)
                                StepChoiceRow(
                                    options = listOf(
                                        ATTENDANCE_PRESENT to androidText("Present", "Aanwezig"),
                                        ATTENDANCE_WAITING to androidText("Waiting list", "Wachtlijst"),
                                        ATTENDANCE_ABSENT to androidText("Absent", "Afwezig"),
                                    ),
                                    selected = statusBulkSource,
                                    enabled = !busy,
                                    testTag = "tournament-participants-status-source",
                                    onSelect = { statusBulkSource = it },
                                )
                                Text(androidText("To", "Naar"), color = TextSoft, fontSize = 12.sp)
                                StepChoiceRow(
                                    options = listOf(
                                        ATTENDANCE_PRESENT to androidText("Present", "Aanwezig"),
                                        ATTENDANCE_WAITING to androidText("Waiting list", "Wachtlijst"),
                                        ATTENDANCE_ABSENT to androidText("Absent", "Afwezig"),
                                    ),
                                    selected = statusBulkTarget,
                                    enabled = !busy,
                                    testTag = "tournament-participants-status-target",
                                    onSelect = { statusBulkTarget = it },
                                )
                                StepChoiceRow(
                                    options = listOf(
                                        "top" to androidText("Top", "Boven"),
                                        "bottom" to androidText("Bottom", "Onder"),
                                        "random" to androidText("Random", "Willekeurig"),
                                    ),
                                    selected = statusBulkMode,
                                    enabled = !busy,
                                    testTag = "tournament-participants-status-mode",
                                    onSelect = { statusBulkMode = it },
                                )
                                SecondaryButton(
                                    label = androidText("Move participants", "Verplaats deelnemers"),
                                    onClick = {
                                        if (statusBulkSource == statusBulkTarget) return@SecondaryButton
                                        val candidates = document.participants.filter { participant ->
                                            participant.attendance == statusBulkSource &&
                                                !(hideInactiveAbsent && statusBulkSource == ATTENDANCE_ABSENT && participant.inactive)
                                        }
                                        val ordered = when (statusBulkMode) {
                                            "bottom" -> candidates.sortedWith(
                                                compareByDescending<AndroidTournamentParticipant> { it.seedRank ?: Int.MAX_VALUE }
                                                    .thenByDescending { it.displayName.lowercase() },
                                            )
                                            "random" -> candidates.shuffled()
                                            else -> candidates.sortedWith(
                                                compareBy<AndroidTournamentParticipant> { it.seedRank ?: Int.MAX_VALUE }
                                                    .thenBy { it.displayName.lowercase() },
                                            )
                                        }
                                        val ids = ordered.take(statusBulkCount.toIntOrNull()?.coerceAtLeast(0) ?: 0)
                                            .map { it.playerId }
                                        if (ids.isNotEmpty()) onSetAttendanceBulk(ids, statusBulkTarget)
                                    },
                                    testTag = "tournament-participants-status-apply",
                                    modifier = Modifier.fillMaxWidth(),
                                    enabled = !busy && statusBulkSource != statusBulkTarget,
                                )
                                Text(
                                    androidText(
                                        "Top/Bottom follows the SP rank; Random picks from the source status. " +
                                            "Hidden inactive absentees are skipped.",
                                        "Boven/Onder volgt de SP-rang; Willekeurig kiest uit de bronstatus. " +
                                            "Verborgen inactieve afwezigen worden overgeslagen.",
                                    ),
                                    color = TextSoft,
                                    fontSize = 12.sp,
                                    lineHeight = 16.sp,
                                )
                            }
                        }
                    }

                    Text(androidText("New participant name", "Nieuwe deelnemersnaam"), color = TextSoft, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = newParticipantName,
                            onValueChange = { newParticipantName = it.take(96) },
                            singleLine = true,
                            colors = stepFieldColors(),
                            placeholder = { Text(androidText("Add participant…", "Deelnemer toevoegen…"), fontSize = 13.sp) },
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.weight(1f).testTag("tournament-participants-add-name"),
                        )
                        Button(
                            enabled = !busy && newParticipantName.trim().length >= 2,
                            onClick = { onAddParticipant(newParticipantName.trim()); newParticipantName = "" },
                            colors = ButtonDefaults.buttonColors(containerColor = ActionBlue, contentColor = TextMain),
                            shape = RoundedCornerShape(10.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp),
                            modifier = Modifier.heightIn(min = 44.dp).testTag("tournament-participants-add"),
                        ) { Text(androidText("Add participant", "Deelnemer toevoegen"), fontSize = 13.sp, fontWeight = FontWeight.Bold) }
                    }
                    notice?.let {
                        Text(it, color = TextSoft, fontSize = 12.sp, lineHeight = 16.sp, modifier = Modifier.testTag("tournament-participants-notice"))
                    }
                    ParticipantAddReport(
                        state = participantAddState,
                        onConfirm = onParticipantAddConfirm,
                        onCancel = onParticipantAddCancel,
                        onPick = onParticipantPick,
                        onCreate = onParticipantCreate,
                    )

                    StepCollapsible(
                        title = androidText("⚙️ Qualifier layout settings", "⚙️ Instellingen kwalificatie-indeling"),
                        expanded = settingsExpanded,
                        onToggle = { settingsExpanded = !settingsExpanded },
                        testTag = "tournament-participants-settings",
                        background = SettingsBackground,
                        border = StrongLine,
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(
                                androidText(
                                    "Controls what happens when qualifier groups are created. The defaults work for most tournaments.",
                                    "Bepaalt wat er gebeurt bij Maak kwalificatiegroepen. De standaardwaarden werken voor de meeste toernooien.",
                                ),
                                color = TextSoft,
                                fontSize = 12.sp,
                                lineHeight = 16.sp,
                            )
                            Text(androidText("Tournament setup", "Toernooi-opzet"), fontSize = 13.sp, fontWeight = FontWeight.Black)
                            SettingLimitField(
                                current = metrics.maxParticipants,
                                enabled = !busy && !settingsLocked,
                                onApply = { limit ->
                                    onUpdateSettings(
                                        document.summary.effectiveSeedingSource,
                                        document.summary.placementStrategy,
                                        document.summary.ownerSeatingMode,
                                        limit,
                                    )
                                },
                            )
                            SettingReadout(
                                label = androidText("Play qualifier rounds first?", "Kwalificatierondes eerst spelen?"),
                                value = androidText("Yes — qualifiers first, then final groups", "Ja — eerst kwalificatie, dan eindgroepen"),
                                help = androidText(
                                    "Fixed: the shortened workflow without qualifiers is historical only.",
                                    "Vast: de verkorte werkwijze zonder kwalificatie is alleen historisch.",
                                ),
                            )
                            Text(androidText("Layout & placement", "Indeling & plaatsing"), fontSize = 13.sp, fontWeight = FontWeight.Black)
                            SettingChoice(
                                label = androidText("Distribution across groups", "Verdeling over groepen"),
                                options = listOf(
                                    "balanced" to androidText("Balanced (default)", "Gebalanceerd (standaard)"),
                                    "minimal_move" to androidText("Minimal movement", "Minimale verschuiving"),
                                ),
                                selected = document.summary.placementStrategy,
                                enabled = !busy && !settingsLocked,
                                testTag = "tournament-participants-placement",
                                help = androidText(
                                    "Balanced = strength spread fairly. Minimal movement = " +
                                        "keep the current order (useful with final groups only).",
                                    "Gebalanceerd = sterkte eerlijk verdeeld. Minimale verschuiving = " +
                                        "huidige volgorde behouden (handig bij alleen eindgroepen).",
                                ),
                                onSelect = {
                                    onUpdateSettings(
                                        document.summary.effectiveSeedingSource, it,
                                        document.summary.ownerSeatingMode, metrics.maxParticipants,
                                    )
                                },
                            )
                            // ADR-0221: the seeding source.
                            val seedingSource = document.summary.effectiveSeedingSource
                            SettingChoice(
                                label = androidText("Placement order", "Plaatsingsvolgorde"),
                                options = buildList {
                                    add("community_rating" to androidText("By community rating (default)", "Op communityrating (standaard)"))
                                    add("director_nights" to androidText("By rating from my own nights", "Op rating uit mijn eigen avonden"))
                                    add("manual" to androidText("By hand: I arrange the groups", "Met de hand: ik deel de groepen in"))
                                    add("random" to androidText("Fully random", "Volledig willekeurig"))
                                },
                                selected = seedingSource,
                                enabled = !busy && !settingsLocked,
                                testTag = "tournament-participants-seed-order",
                                columns = 2,
                                help = when (seedingSource) {
                                    "director_nights" -> androidText(
                                        "Ranks by a rating from your own published nights only; Players new to your nights come last.",
                                        "Rangschikt op een rating uit alleen je eigen gepubliceerde avonden; spelers die nieuw zijn in jouw avonden komen achteraan.",
                                    )
                                    "manual" -> androidText(
                                        "The draw ignores ratings; move Players between groups on the board afterwards.",
                                        "De loting negeert ratings; verplaats spelers daarna op het bord tussen de groepen.",
                                    )
                                    else -> androidText("Base order before the distribution is applied.", "Basisvolgorde vóór de verdeling wordt toegepast.")
                                },
                                onSelect = {
                                    onUpdateSettings(
                                        it, document.summary.placementStrategy,
                                        document.summary.ownerSeatingMode, metrics.maxParticipants,
                                    )
                                },
                            )
                            SettingChoice(
                                label = androidText("Own Nintendo Switch", "Eigen Nintendo Switch"),
                                options = listOf(
                                    "owner_strict" to androidText("Strict (default)", "Strikt (standaard)"),
                                    "owner_soft" to androidText("Flexible", "Flexibel"),
                                ),
                                selected = document.summary.ownerSeatingMode,
                                enabled = !busy && !settingsLocked,
                                testTag = "tournament-participants-owner-seating",
                                help = androidText(
                                    "Strict = owner on their own Switch. Flexible = may differ if that " +
                                        "improves the layout. Only affects seat placement.",
                                    "Strikt = eigenaar op eigen Switch. Flexibel = mag afwijken als dat " +
                                        "de indeling verbetert. Raakt alleen de stoelplaatsing.",
                                ),
                                onSelect = {
                                    onUpdateSettings(
                                        document.summary.effectiveSeedingSource,
                                        document.summary.placementStrategy, it, metrics.maxParticipants,
                                    )
                                },
                            )
                            Text(androidText("Rating", "Rating"), fontSize = 13.sp, fontWeight = FontWeight.Black)
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    androidText("Only verified Players count for the rating", "Alleen geverifieerde spelers tellen mee voor de rating"),
                                    color = TextMain,
                                    fontSize = 13.sp,
                                    lineHeight = 18.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.weight(1f),
                                )
                                Switch(
                                    checked = document.summary.verifiedOnly,
                                    onCheckedChange = { onUpdateVerifiedOnly(it) },
                                    enabled = !busy && document.summary.stage != "finalized",
                                    modifier = Modifier.testTag("tournament-participants-verified-only"),
                                )
                            }
                            Text(
                                androidText(
                                    "Players without a verified claim still play and appear in the standings, but this night does not change their rating.",
                                    "Spelers zonder geverifieerde claim spelen mee en staan in de uitslag, maar deze avond verandert hun rating niet.",
                                ),
                                color = TextSoft,
                                fontSize = 11.sp,
                                lineHeight = 15.sp,
                            )
                            if (settingsLocked) {
                                Text(
                                    androidText(
                                        "The setup is locked once groups are created. Return to Step 2 " +
                                            "and remove the groups to change it.",
                                        "De opzet ligt vast zodra de groepen gemaakt zijn. Ga terug naar Stap 2 " +
                                            "en verwijder de groepen om dit nog te wijzigen.",
                                    ),
                                    color = WarningAmber,
                                    fontSize = 12.sp,
                                    lineHeight = 16.sp,
                                    modifier = Modifier.testTag("tournament-participants-settings-locked"),
                                )
                            }
                        }
                    }

                    StepCollapsible(
                        title = androidText("● Ranking status", "● Ranglijst-status"),
                        expanded = rankingExpanded,
                        onToggle = { rankingExpanded = !rankingExpanded },
                        testTag = "tournament-participants-ranking",
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                androidText(
                                    "Ranking check: rank and SP come from the central MK8DX server. " +
                                        "${document.participants.count { it.seedScore != null }} of ${document.participants.size} " +
                                        "participants have an SP value.",
                                    "Ranglijstcheck: rang en SP komen van de centrale MK8DX-server. " +
                                        "${document.participants.count { it.seedScore != null }} van ${document.participants.size} " +
                                        "deelnemers hebben een SP-waarde.",
                                ),
                                color = TextSoft,
                                fontSize = 12.sp,
                                lineHeight = 16.sp,
                            )
                            SecondaryButton(
                                label = androidText("Check now", "Nu checken"),
                                onClick = onRefresh,
                                testTag = "tournament-participants-ranking-refresh",
                            )
                        }
                    }

                    Surface(
                        color = FieldBackground,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, PanelBorder),
                        modifier = Modifier.fillMaxWidth().testTag("tournament-participants-readiness"),
                    ) {
                        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            ReadinessItem(metrics.activeCount > 0, androidText("Present: ${metrics.activeCount}", "Aanwezig: ${metrics.activeCount}"))
                            ReadinessItem(
                                metrics.totalConsoles >= metrics.minConsoles,
                                "Nintendo Switches: ${metrics.totalConsoles}/${metrics.minConsoles}",
                            )
                            ReadinessItem(
                                metrics.isReady,
                                if (metrics.isReady) {
                                    androidText("Ready to create groups", "Klaar om groepen te maken")
                                } else {
                                    androidText("Not ready yet", "Nog niet klaar")
                                },
                            )
                        }
                    }

                    val seedGreen = metrics.seedButtonMode == "active"
                    Button(
                        enabled = !busy && metrics.isReady,
                        onClick = onCreateQualifierGroups,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(2.dp, if (seedGreen) SuccessGreen else DangerRed),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusSuccess),
                            contentColor = TextMain,
                            disabledContainerColor = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusError),
                            disabledContentColor = TextMain,
                        ),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("tournament-participants-seed"),
                    ) {
                        Text(
                            if (metrics.seedButtonMode == "disabled") {
                                androidText("Create qualifier groups (not ready)", "Maak kwalificatiegroepen (nog niet klaar)")
                            } else {
                                androidText("Create qualifier groups", "Maak kwalificatiegroepen")
                            },
                            fontSize = 16.sp,
                            lineHeight = 21.sp,
                            fontWeight = FontWeight.Black,
                            textAlign = TextAlign.Center,
                        )
                    }
                    if (metrics.readinessReason.isNotBlank()) {
                        Text(
                            metrics.readinessReason,
                            color = TextSoft,
                            fontSize = 12.sp,
                            lineHeight = 17.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().testTag("tournament-participants-seed-reason"),
                        )
                    }
                }
            }
        }
    }
}

/**
 * ADR-0177 decisions 8 and 10 with ADR-0218: every row is chosen explicitly
 * (a candidate, new Player or skip); new Players take two confirmations and
 * a rejection writes nothing.
 */
@Composable
private fun RosterImportReport(
    state: AndroidRosterImport?,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    onChoose: (Int, AndroidRosterChoice?) -> Unit,
) {
    if (state == null) return
    val border = when (state) {
        is AndroidRosterImport.Failed -> DangerRed
        is AndroidRosterImport.Applied -> SuccessGreen
        else -> WarningAmber
    }
    Surface(
        color = FieldBackground,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, border),
        modifier = Modifier.fillMaxWidth().testTag("tournament-participants-import-report"),
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when (state) {
                is AndroidRosterImport.Working -> Text(state.message, fontSize = 13.sp, lineHeight = 18.sp)
                is AndroidRosterImport.Failed -> Text(
                    state.message,
                    color = DangerRed,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.testTag("tournament-participants-import-failed"),
                )
                is AndroidRosterImport.Applied -> Text(
                    androidText(
                        "Import succeeded: ${state.updated} updated, ${state.added} added, " +
                            "${state.created} new Players created.",
                        "Import geslaagd: ${state.updated} bijgewerkt, ${state.added} toegevoegd, " +
                            "${state.created} nieuwe spelers aangemaakt.",
                    ) +
                        if (state.remembered > 0) {
                            androidText(
                                " ${state.remembered} names remembered for your nights.",
                                " ${state.remembered} namen onthouden voor jouw avonden.",
                            )
                        } else {
                            ""
                        },
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.testTag("tournament-participants-import-applied"),
                )
                is AndroidRosterImport.Review -> TournamentRosterReview(
                    review = state,
                    onChoose = onChoose,
                    onConfirm = onConfirm,
                    onCancel = onCancel,
                )
            }
        }
    }
}

/**
 * ADR-0177 decision 11 with ADR-0218: the Players a typed name may mean, with
 * context, beside "new Player"; one confirmation, showing the display name
 * and the username it derives, before a free-text name becomes a Player.
 */
@Composable
private fun ParticipantAddReport(
    state: AndroidParticipantAdd?,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    onPick: (AndroidRosterCandidate) -> Unit,
    onCreate: (Boolean) -> Unit,
) {
    if (state == null) return
    val border = when (state) {
        is AndroidParticipantAdd.Failed -> DangerRed
        is AndroidParticipantAdd.Created -> SuccessGreen
        else -> WarningAmber
    }
    Surface(
        color = FieldBackground,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, border),
        modifier = Modifier.fillMaxWidth().testTag("tournament-participants-add-report"),
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when (state) {
                is AndroidParticipantAdd.Working -> Text(state.message, fontSize = 13.sp, lineHeight = 18.sp)
                is AndroidParticipantAdd.Failed -> Text(
                    state.message,
                    color = DangerRed,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.testTag("tournament-participants-add-failed"),
                )
                is AndroidParticipantAdd.Created -> Text(
                    androidText(
                        "${state.displayName} was created as @${state.username} and added.",
                        "${state.displayName} is aangemaakt als @${state.username} en toegevoegd.",
                    ),
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.testTag("tournament-participants-add-created"),
                )
                is AndroidParticipantAdd.Choose -> {
                    TournamentRosterChoiceList(
                        entry = state.entry,
                        pickLabel = { candidate -> androidText("Add ${candidate.displayName}", "${candidate.displayName} toevoegen") },
                        onPick = onPick,
                        onCreate = onCreate,
                        blockOnNight = true,
                    )
                    SecondaryButton(
                        label = androidText("Cancel", "Annuleren"),
                        onClick = onCancel,
                        testTag = "tournament-participants-add-cancel",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                is AndroidParticipantAdd.Confirm -> {
                    Text(
                        if (state.confirmSameName) {
                            androidText(
                                "Create another Player called \"${state.displayName}\"?",
                                "Nog een speler met de naam \"${state.displayName}\" aanmaken?",
                            )
                        } else {
                            androidText("\"${state.displayName}\" is not a Player yet.", "\"${state.displayName}\" is nog geen speler.")
                        },
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                    )
                    Text(
                        androidText(
                            "Creation assigns username @${state.username}, or the next free one (@${state.username}-2). " +
                                "The Player remains claimable by that person.",
                            "Aanmaken geeft de gebruikersnaam @${state.username}, of de eerstvolgende vrije (@${state.username}-2). " +
                                "De speler blijft claimbaar door de persoon zelf.",
                        ),
                        color = WarningAmber,
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SecondaryButton(
                            label = androidText("Create and add", "Aanmaken en toevoegen"),
                            onClick = onConfirm,
                            testTag = "tournament-participants-add-confirm",
                            modifier = Modifier.weight(1f),
                        )
                        SecondaryButton(
                            label = androidText("Cancel", "Annuleren"),
                            onClick = onCancel,
                            testTag = "tournament-participants-add-cancel",
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun GuideLine(lead: String, body: String) {
    Column {
        Text(lead, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Black)
        Text(body, color = TextSoft, fontSize = 13.sp, lineHeight = 18.sp)
    }
}

/** ADR-0177 decision 7: `Max aantal plaatsen`, empty meaning no limit. */
@Composable
private fun SettingLimitField(current: Int?, enabled: Boolean, onApply: (Int?) -> Unit) {
    var draft by remember(current) { mutableStateOf(current?.toString() ?: "") }
    val parsed = draft.trim().toIntOrNull()
    val valid = draft.isBlank() || (parsed != null && parsed >= 1)
    val changed = draft.trim() != (current?.toString() ?: "")
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(androidText("Maximum places", "Max aantal plaatsen"), color = TextSoft, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it.filter(Char::isDigit).take(3) },
                singleLine = true,
                colors = stepFieldColors(),
                placeholder = { Text(androidText("E.g. 36", "Bijv. 36"), fontSize = 13.sp) },
                shape = RoundedCornerShape(10.dp),
                enabled = enabled,
                modifier = Modifier.weight(1f).testTag("tournament-participants-max-participants"),
            )
            SecondaryButton(
                label = androidText("Save", "Opslaan"),
                onClick = { onApply(if (draft.isBlank()) null else parsed) },
                testTag = "tournament-participants-max-participants-save",
                enabled = enabled && valid && changed,
            )
        }
        Text(androidText("Leave empty = no limit.", "Leeg laten = geen limiet."), color = TextSoft, fontSize = 11.sp, lineHeight = 15.sp)
    }
}

/** One server-backed choice, rendered as the source's inline option row. */
@Composable
private fun SettingChoice(
    label: String,
    options: List<Pair<String, String>>,
    selected: String,
    enabled: Boolean,
    testTag: String,
    help: String,
    onSelect: (String) -> Unit,
    /** Options per row; four choices wrap into two rows on a phone (ADR-0221). */
    columns: Int = options.size,
) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, color = TextSoft, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag(testTag)) {
        options.chunked(columns.coerceAtLeast(1)).forEach { chunk ->
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            chunk.forEach { (value, text) ->
                val active = value == selected
                // A Material Surface swallows the touch before an enclosing
                // clickable sees it, so this follows AttendanceButton instead.
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (active) ActionBlue else FieldBackground)
                        .border(
                            1.dp,
                            if (active) ActionBlue else StrongLine,
                            RoundedCornerShape(10.dp),
                        )
                        .clickable(enabled = enabled && !active) { onSelect(value) }
                        .testTag("$testTag-$value"),
                ) {
                    Text(
                        text,
                        color = if (active) TextMain else TextSoft,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
                    )
                }
            }
        }
        }
        }
        Text(help, color = TextSoft, fontSize = 11.sp, lineHeight = 15.sp)
    }
}

@Composable
private fun SettingReadout(label: String, value: String, help: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, color = TextSoft, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Surface(
            color = FieldBackground,
            shape = RoundedCornerShape(10.dp),
            border = BorderStroke(1.dp, StrongLine),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(value, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp))
        }
        Text(help, color = TextSoft, fontSize = 11.sp, lineHeight = 15.sp)
    }
}

@Composable
private fun ReadinessItem(ok: Boolean, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(
            color = if (ok) Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusSuccess) else Color.Transparent,
            shape = RoundedCornerShape(9.dp),
            border = BorderStroke(1.dp, if (ok) SuccessGreen else WarningAmber),
            modifier = Modifier.size(18.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    if (ok) "✓" else "○",
                    color = if (ok) SuccessGreen else WarningAmber,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Black,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        Text(label, color = if (ok) TextMain else TextSoft, fontSize = 13.sp)
    }
}

@Composable
private fun CheckSquare(checked: Boolean) {
    Surface(
        color = if (checked) Mk8dxDesignTheme.colors.actionPrimary else Mk8dxDesignTheme.colors.surfaceControl,
        shape = RoundedCornerShape(3.dp),
        border = BorderStroke(1.dp, StrongLine),
        modifier = Modifier.size(18.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            if (checked) Text("✓", color = Mk8dxDesignTheme.colors.actionOnPrimary, fontSize = 11.sp, fontWeight = FontWeight.Black)
        }
    }
}

/**
 * The source shows a bordered icon box holding NS1.png / NS2.png, and repeats
 * the label beside it only in the legend. ADR-0177 adopts those two source
 * images on the owner's accepted provenance position.
 */
@Composable
private fun RosterRow(
    participant: AndroidTournamentParticipant,
    enabled: Boolean,
    onSetAttendance: (String) -> Unit,
    onSetSwitches: (Boolean, Boolean) -> Unit,
) {
    val cardBackground = when (participant.attendance) {
        ATTENDANCE_PRESENT -> Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusSuccess)
        ATTENDANCE_WAITING -> Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusWarning)
        else -> Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusError)
    }
    val cardBorder = when (participant.attendance) {
        ATTENDANCE_PRESENT -> SuccessGreen
        ATTENDANCE_WAITING -> WarningAmber
        else -> DangerRed
    }
    Row(
        Modifier.fillMaxWidth().height(68.dp).testTag("roster-row-${participant.playerId}"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            color = cardBackground,
            shape = RoundedCornerShape(8.dp),
            border = BorderStroke(1.dp, cardBorder),
            modifier = Modifier.weight(1f).fillMaxHeight(),
        ) {
            Column(
                Modifier.padding(start = 10.dp, end = 10.dp, top = 10.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                val labelled = participant.inactive || participant.isNew
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        participant.displayName,
                        // A label eats into the name column, so a labelled row
                        // gets a slightly smaller name instead of an ellipsis.
                        fontSize = if (labelled) 12.sp else 14.sp,
                        lineHeight = if (labelled) 16.sp else 18.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (participant.isNew) {
                        Surface(color = Mk8dxDesignTheme.colors.statusWarning, shape = RoundedCornerShape(999.dp)) {
                            Text(
                                androidText("New", "Nieuw"),
                                color = Mk8dxDesignTheme.colors.surfaceApp,
                                fontSize = 9.sp,
                                lineHeight = 12.sp,
                                modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp),
                            )
                        }
                        Spacer(Modifier.width(4.dp))
                    }
                    if (participant.inactive) {
                        Surface(color = Mk8dxDesignTheme.colors.statusInfo, shape = RoundedCornerShape(999.dp)) {
                            Text(
                                androidText("Inactive", "Inactief"),
                                color = Mk8dxDesignTheme.colors.surfaceApp,
                                fontSize = 9.sp,
                                lineHeight = 12.sp,
                                modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp),
                            )
                        }
                        Spacer(Modifier.width(4.dp))
                    }
                    Surface(color = Mk8dxDesignTheme.colors.surfaceControl, shape = RoundedCornerShape(999.dp)) {
                        Text(
                            "RANK ${participant.seedRank?.let { Mk8dxNumeric.formatRank(it, Mk8dxNumberLanguage.NL) } ?: "#?"}",
                            color = TextSoft,
                            fontSize = 10.sp,
                            lineHeight = 13.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SwitchToggle(
                        label = "NS1",
                        checked = participant.hasSwitch1,
                        enabled = enabled,
                        testTag = "roster-ns1-${participant.playerId}",
                        onToggle = { onSetSwitches(!participant.hasSwitch1, participant.hasSwitch2) },
                    )
                    Spacer(Modifier.width(6.dp))
                    SwitchToggle(
                        label = "NS2",
                        checked = participant.hasSwitch2,
                        enabled = enabled,
                        testTag = "roster-ns2-${participant.playerId}",
                        onToggle = { onSetSwitches(participant.hasSwitch1, !participant.hasSwitch2) },
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        "SP${if (participant.inactive) "*" else ""}: ${formatSkillScore(participant.seedScore)}",
                        color = TextSoft,
                        fontSize = 11.sp,
                        lineHeight = 14.sp,
                        maxLines = 1,
                    )
                }
            }
        }
        Row(
            Modifier
                .fillMaxHeight()
                .border(1.dp, StrongLine, RoundedCornerShape(9.dp))
                .clip(RoundedCornerShape(9.dp))
                .background(FieldBackground),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AttendanceButton("A", ATTENDANCE_PRESENT, participant, enabled, onSetAttendance)
            Box(Modifier.width(1.dp).fillMaxHeight().background(StrongLine))
            AttendanceButton("W", ATTENDANCE_WAITING, participant, enabled, onSetAttendance)
            Box(Modifier.width(1.dp).fillMaxHeight().background(StrongLine))
            AttendanceButton("X", ATTENDANCE_ABSENT, participant, enabled, onSetAttendance)
        }
    }
}

@Composable
private fun AttendanceButton(
    label: String,
    attendance: String,
    participant: AndroidTournamentParticipant,
    enabled: Boolean,
    onSetAttendance: (String) -> Unit,
) {
    val selected = participant.attendance == attendance
    val background = when {
        !selected -> FieldBackground
        attendance == ATTENDANCE_PRESENT -> SuccessGreen
        attendance == ATTENDANCE_WAITING -> WarningAmber
        else -> DangerRed
    }
    val content = when {
        !selected -> TextSoft
        attendance == ATTENDANCE_PRESENT -> Mk8dxDesignTheme.colors.surfaceApp
        attendance == ATTENDANCE_WAITING -> Mk8dxDesignTheme.colors.surfaceApp
        else -> Mk8dxDesignTheme.colors.surfaceApp
    }
    Box(
        Modifier
            .width(34.dp)
            .fillMaxHeight()
            .background(background)
            .clickable(enabled = enabled) { onSetAttendance(attendance) }
            .testTag("roster-$attendance-${participant.playerId}"),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = content, fontSize = 13.sp, fontWeight = FontWeight.Black)
    }
}

@Composable
private fun SwitchToggle(
    label: String,
    checked: Boolean,
    enabled: Boolean,
    testTag: String,
    onToggle: () -> Unit,
) {
    Row(
        Modifier.clickable(enabled = enabled, onClick = onToggle).testTag(testTag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CheckSquare(checked = checked)
        Spacer(Modifier.width(4.dp))
        SwitchChip(label, enabled = checked)
    }
}

@Preview(
    name = "Tournament · Stap 2 · telefoon",
    widthDp = 360,
    heightDp = 800,
    showBackground = true,
    backgroundColor = 0xFF09101E,
)
@Composable
internal fun TournamentParticipantsStepPreview() {
    Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
        Box(Modifier.background(Mk8dxDesignTheme.colors.surfaceApp)) {
            TournamentParticipantsStep(
                document = androidTournamentParticipantsPreviewDocument(),
                busy = false,
                error = null,
                notice = null,
                onBackToStart = {},
                onRefresh = {},
                onSetAttendance = { _, _ -> },
                onSetSwitches = { _, _, _ -> },
                onAddParticipant = {},
                participantAddState = null,
                onParticipantAddConfirm = {},
                onParticipantAddCancel = {},
                onAddRecentParticipants = {},
                onAddHistoricalParticipants = {},
                onMarkOwnersBulk = { _, _ -> },
                onSetAttendanceBulk = { _, _ -> },
                onExportCsv = {},
                onImportCsvText = {},
                importState = null,
                onImportConfirm = {},
                onImportCancel = {},
                onCreateQualifierGroups = {},
                onUpdateSettings = { _, _, _, _ -> },
                settingsLocked = false,
                modifier = Modifier,
            )
        }
    }
}

internal fun androidTournamentParticipantsPreviewDocument(): AndroidTournamentDocument {
    val seed = listOf(
        Triple("Matteo", 1, 30.31),
        Triple("Gideon", 2, 29.98),
        Triple("Moss HM", 3, 29.40),
        Triple("Ben", 4, 29.22),
        Triple("Evan", 5, 28.47),
        Triple("Valerio", 6, 28.31),
        Triple("Merle", 7, 27.63),
    )
    return AndroidTournamentDocument(
        schemaVersion = "mk8dx.native-tournament.v1",
        summary = AndroidTournamentSummary(
            tournamentId = "tournament.testtoernooi",
            name = "TestToernooi",
            eventDate = "2026-08-29",
            stage = "draft",
            workflowStep = 2,
            revision = 3,
            participantCount = seed.size,
            presentCount = 2,
            publicResults = false,
            affectsRating = false,
            updatedAtMs = 1_787_795_200_000,
        ),
        participants = seed.mapIndexed { index, (name, rank, score) ->
            AndroidTournamentParticipant(
                playerId = "player.${name.lowercase(Locale.ROOT).replace(" ", "")}",
                username = name.lowercase(Locale.ROOT).replace(" ", ""),
                displayName = name,
                attendance = when (index) {
                    0, 1 -> ATTENDANCE_PRESENT
                    2 -> ATTENDANCE_WAITING
                    else -> ATTENDANCE_ABSENT
                },
                hasSwitch1 = index % 2 == 0,
                hasSwitch2 = index == 1,
                inactive = index == 6,
                seedScore = score,
                seedRank = rank,
            )
        },
        stations = emptyList(),
        groups = emptyList(),
        overall = emptyList(),
        lifecycle = emptyList(),
    )
}
