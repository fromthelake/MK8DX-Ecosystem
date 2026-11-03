package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Surface
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme as Mk8dxDesignTheme
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * Steps 4 and 8 of the source Manager: the layout export and its movement
 * audit (`renderMovementAuditHtml`, `computeQualifierOffOwnAudit`).
 *
 * Step 4 exports the qualifier layout, Step 8 the final layout. The source
 * shows a shareable PNG; the phone now renders that source-faithful board as
 * the primary WhatsApp image and keeps the text as a copyable fallback.
 */

internal data class AndroidLayoutAuditRow(
    val displayName: String,
    val groupName: String,
    val seatedStation: String,
    val ownStationSentence: String,
)

internal data class AndroidLayoutAudit(
    val movedCount: Int,
    val weightedScore: Int,
    val rows: List<AndroidLayoutAuditRow>,
)

/**
 * `computeQualifierOffOwnAudit`: a Player who brought a Nintendo Switch but is
 * not seated on one of their own consoles. The source scores this one per
 * Player, so the score equals the count.
 */
internal fun androidLayoutAudit(
    document: AndroidTournamentDocument,
    stage: String,
    language: AndroidProductLanguage,
): AndroidLayoutAudit {
    val cableByStation = androidUtpCableByStation(document)
    val groups = document.groups.filter { it.stage == stage }
    val owners = document.participants
        .filter { it.attendance == ATTENDANCE_PRESENT && (it.hasSwitch1 || it.hasSwitch2) }
        .associateBy { it.playerId }
    val rows = mutableListOf<AndroidLayoutAuditRow>()
    groups.forEach { group ->
        group.members.forEach { member ->
            val station = member.station ?: return@forEach
            if (member.playerId !in owners) return@forEach
            if (station.ownerPlayerId == member.playerId) return@forEach
            // Where did this Player's own console end up?
            val ownUsage = groups.firstNotNullOfOrNull { candidate ->
                candidate.members.firstOrNull { it.station?.ownerPlayerId == member.playerId }
                    ?.let { candidate.name to requireNotNull(it.station) }
            }
            val ownLabel = document.stations.firstOrNull { it.ownerPlayerId == member.playerId }
                ?.let { "${it.switchType.uppercase()} ${it.ownerDisplayName}" }
                ?: androidText(language, "Own Nintendo Switch", "Eigen Nintendo Switch")
            rows.add(
                AndroidLayoutAuditRow(
                    displayName = member.displayName,
                    groupName = group.name,
                    seatedStation = androidUtpCableNumber(
                        cableByStation,
                        station.ownerPlayerId,
                        station.switchType,
                    )?.let {
                        "UTP $it · ${station.switchType.uppercase()} ${station.ownerDisplayName}"
                    } ?: "${station.switchType.uppercase()} ${station.ownerDisplayName}",
                    ownStationSentence = if (ownUsage == null) {
                        androidText(language, "$ownLabel is currently empty or in parking.", "$ownLabel is momenteel onbezet of in parking.")
                    } else {
                        androidText(language, "$ownLabel is assigned to ${ownUsage.first}.", "$ownLabel afgestaan aan ${ownUsage.first}.")
                    },
                ),
            )
        }
    }
    return AndroidLayoutAudit(rows.size, rows.size, rows)
}

/** The layout the source draws as a PNG, shared as text from the phone. */
// The chat export is the original Manager's, character for character; see
// AndroidTournamentWhatsAppExport.kt. The UTP cable numbers moved back to the
// cable plan, where whoever wires up actually reads them.
internal fun androidLayoutShareText(
    document: AndroidTournamentDocument,
    stage: String,
    @Suppress("UNUSED_PARAMETER") title: String,
): String = androidTournamentWhatsAppText(document, stage, AndroidWhatsAppExportMode.LAYOUT)

@Composable
internal fun TournamentLayoutExportStep(
    document: AndroidTournamentDocument,
    stage: String,
    stepNumber: Int,
    busy: Boolean,
    error: String?,
    onHome: () -> Unit,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onLeave: () -> Unit,
    onDelete: (() -> Unit)? = null,
    onShare: (String) -> Unit,
    // The source shares a picture of the board, which is what actually
    // gets read in a WhatsApp group; the text stays beside it.
    onShareImage: ((AndroidTournamentExportCheckpoint) -> Unit)? = null,
    onDownloadImage: ((AndroidTournamentExportCheckpoint) -> Unit)? = null,
    onContinue: () -> Unit,
    modifier: Modifier,
) {
    val qualifier = stage != "final"
    val language = LocalAndroidProductLanguage.current
    val exportTitle = if (qualifier) {
        androidText("Qualifier layout", "Kwalificatie-indeling")
    } else {
        androidText("Final group layout", "Eindgroep-indeling")
    }
    val phaseLabel = if (qualifier) {
        androidText("Step 4 · Export qualifier layout", "Stap 4 · Kwalificatie-indeling exporteren")
    } else {
        androidText("Step 8 · Export final groups", "Stap 8 · Eindgroepen exporteren")
    }
    val continueLabel = if (qualifier) {
        androidText("Continue to Step 5: Qualifier scores", "Ga door naar Stap 5: Kwalificatiescores")
    } else {
        androidText("Continue to Step 9: Enter final-group scores", "Ga door naar Stap 9: Eindgroepscores invullen")
    }
    val continueHint = if (qualifier) {
        androidText(
            "Export reviewed? Continue with the qualifier scores.",
            "Export gecontroleerd? Ga nu door met het invullen van kwalificatiescores.",
        )
    } else {
        androidText(
            "Export reviewed? Continue with filling in final group scores.",
            "Export gecontroleerd? Ga nu door met het invullen van eindgroepscores.",
        )
    }
    val audit = androidLayoutAudit(document, stage, language)
    val finalAudit = if (qualifier) null else androidFinalLayoutAudit(document)
    val checkpoints = androidTournamentExportCheckpoints(stepNumber)
    var selectedKey by remember(stepNumber) {
        mutableStateOf(checkpoints.lastOrNull()?.key.orEmpty())
    }
    val selectedCheckpoint = checkpoints.firstOrNull { it.key == selectedKey }
        ?: checkpoints.last()
    val shareText = androidExportCheckpointShareText(document, selectedCheckpoint)

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            // The step paints its own surface: a console screen is never
            // drawn over whatever is behind it (DESIGN_SYSTEM §6).
            .background(Mk8dxDesignTheme.colors.surfaceApp)
            .testTag("tournament-layout-export-step"),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 5.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            TournamentStepHeader(
                backLabel = androidText("Back to Step ${stepNumber - 1}", "Terug naar Stap ${stepNumber - 1}"),
                phaseLabel = phaseLabel,
                tagPrefix = "tournament-layout-export",
                onHome = onHome,
                onBack = onBack,
                menu = {
                    TournamentStepMenu(
                        tagPrefix = "tournament-layout-export",
                        onRefresh = onRefresh,
                        onLeave = onLeave,
                        onDelete = onDelete,
                    )
                },
            )
        }

        error?.let { message ->
            item {
                Surface(
                    color = FieldBackground,
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, DangerRed),
                    modifier = Modifier.fillMaxWidth().testTag("tournament-layout-export-error"),
                ) {
                    Column(
                        modifier = Modifier.padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(message, color = DangerRed, fontSize = 13.sp)
                        SecondaryButton(
                            label = androidText("Refresh data safely", "Gegevens veilig verversen"),
                            onClick = onRefresh,
                            testTag = "tournament-layout-export-error-refresh",
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !busy,
                        )
                    }
                }
            }
        }

        item {
            ExportPanel(androidText("Step $stepNumber: $exportTitle export", "Stap $stepNumber: $exportTitle export")) {
                Text(
                    androidText("Showing: ${androidExportCheckpointDisplayLabel(selectedCheckpoint)}", "Toont: ${androidExportCheckpointDisplayLabel(selectedCheckpoint)}"),
                    color = TextSoft,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    modifier = Modifier.testTag("tournament-layout-export-shows"),
                )
                if (checkpoints.size > 1) {
                    StepChoiceRow(
                        options = checkpoints.map { it.key to androidExportCheckpointDisplayLabel(it) },
                        selected = selectedCheckpoint.key,
                        enabled = !busy,
                        testTag = "tournament-layout-export-tabs",
                        onSelect = { selectedKey = it },
                    )
                }
                Surface(
                    color = BoardBackground,
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, BoardBorder),
                    modifier = Modifier.fillMaxWidth().testTag("tournament-layout-export-preview"),
                ) {
                    AndroidTournamentExportPreview(
                        document = document,
                        stage = selectedCheckpoint.stage,
                        mode = selectedCheckpoint.mode,
                        testTag = "tournament-layout-export-preview-image",
                        modifier = Modifier.padding(10.dp),
                    )
                }
                SecondaryButton(
                    label = androidText("📲 Share image in WhatsApp", "📲 Deel afbeelding in WhatsApp"),
                    onClick = { onShareImage?.invoke(selectedCheckpoint) },
                    testTag = "tournament-layout-export-share-image",
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy && onShareImage != null,
                )
                SecondaryButton(
                    label = "Download PNG",
                    onClick = { onDownloadImage?.invoke(selectedCheckpoint) },
                    testTag = "tournament-layout-export-download-image",
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy && onDownloadImage != null,
                )
                SecondaryButton(
                    label = androidText("Share as text", "Deel als tekst"),
                    onClick = { onShare(shareText) },
                    testTag = "tournament-layout-export-share",
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy,
                )
            }
        }

        item {
            if (qualifier) {
                QualifierMovementAudit(audit, stepNumber)
            } else {
                FinalMovementAudit(requireNotNull(finalAudit), stepNumber)
            }
        }

        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Button(
                    onClick = onContinue,
                    enabled = !busy,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusSuccess),
                        contentColor = TextMain,
                    ),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, SuccessGreen),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp)
                        .testTag("tournament-layout-export-continue"),
                ) { Text(continueLabel, fontSize = 14.sp, fontWeight = FontWeight.Black) }
                Text(continueHint, color = TextSoft, fontSize = 12.sp, lineHeight = 16.sp)
            }
        }
    }
}

@Composable
private fun QualifierMovementAudit(audit: AndroidLayoutAudit, stepNumber: Int) {
    ExportPanel(androidText("Movement audit Step $stepNumber", "Verplaatsingsaudit Stap $stepNumber")) {
        Text(
            androidText(
                "Not on own Nintendo Switch: ${audit.movedCount} · Score: ${audit.weightedScore}",
                "Niet op eigen Nintendo Switch: ${audit.movedCount} · Score: ${audit.weightedScore}",
            ),
            color = TextSoft,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            modifier = Modifier.testTag("tournament-layout-export-audit"),
        )
        if (audit.rows.isEmpty()) {
            Text(
                androidText(
                    "Everyone with their own Nintendo Switch is seated at their own station.",
                    "Iedereen met eigen Nintendo Switch zit op een eigen station.",
                ),
                color = TextSoft,
                fontSize = 12.sp,
                lineHeight = 17.sp,
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                audit.rows.forEach { row ->
                    Text(
                        androidText(
                            "${row.displayName} is in ${androidGroupLabel(row.groupName, null, LocalAndroidProductLanguage.current)} on ${row.seatedStation}.",
                            "${row.displayName} zit in ${androidGroupLabel(row.groupName, null, LocalAndroidProductLanguage.current)} op ${row.seatedStation}.",
                        ) + " " + row.ownStationSentence,
                        color = TextMain,
                        fontSize = 12.sp,
                        lineHeight = 17.sp,
                        modifier = Modifier.testTag("tournament-layout-audit-${row.displayName}"),
                    )
                }
            }
        }
    }
}

@Composable
private fun FinalMovementAudit(audit: AndroidFinalLayoutAudit, stepNumber: Int) {
    ExportPanel(androidText("Movement audit Step $stepNumber", "Verplaatsingsaudit Stap $stepNumber")) {
        Text(
            androidText(
                "Switch owners giving up: ${audit.ownerGiveUps.size} · " +
                    "Participants changing stations: ${audit.participantMoves.size} · " +
                    "Weighted score: ${audit.weightedScore}",
                "Switch-eigenaren die afstaan: ${audit.ownerGiveUps.size} · " +
                    "Deelnemers met stationwissel: ${audit.participantMoves.size} · " +
                    "Gewogen score: ${audit.weightedScore}",
            ),
            color = TextSoft,
            fontSize = 12.sp,
            lineHeight = 17.sp,
            modifier = Modifier.testTag("tournament-layout-export-audit"),
        )
        Text(
            androidText(
                "= ${audit.ownerGiveUps.size}×3 give-up + ${audit.participantMoves.size}×1 move",
                "= ${audit.ownerGiveUps.size}×3 afstaan + ${audit.participantMoves.size}×1 wissel",
            ),
            color = TextSoft,
            fontSize = 11.sp,
        )
        Text(androidText("Switch owners giving up their Switch", "Switch-eigenaren die hun switch afstaan"), fontSize = 12.sp, fontWeight = FontWeight.Black)
        if (audit.ownerGiveUps.isEmpty()) {
            Text(androidText("Nobody needs to give up their own Nintendo Switch.", "Niemand hoeft een eigen Nintendo Switch af te staan."), color = TextSoft, fontSize = 12.sp)
        } else {
            audit.ownerGiveUps.forEach { row ->
                Text(
                    androidText(
                        "${row.displayName} is in ${androidGroupLabel(row.groupName, null, LocalAndroidProductLanguage.current)} on ${row.seatedStation}.",
                        "${row.displayName} zit in ${androidGroupLabel(row.groupName, null, LocalAndroidProductLanguage.current)} op ${row.seatedStation}.",
                    ),
                    color = TextMain,
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                )
            }
        }
        Text(androidText("Participants changing stations", "Deelnemers die van station wisselen"), fontSize = 12.sp, fontWeight = FontWeight.Black)
        if (audit.participantMoves.isEmpty()) {
            Text(androidText("No participants need to change stations.", "Geen deelnemers hoeven van station te wisselen."), color = TextSoft, fontSize = 12.sp)
        } else {
            audit.participantMoves.forEach { row ->
                Text(
                    "${row.displayName} · ${androidGroupLabel(row.fromGroup, null, LocalAndroidProductLanguage.current)} (${row.fromStation}) → " +
                        "${androidGroupLabel(row.toGroup, null, LocalAndroidProductLanguage.current)} (${row.toStation})",
                    color = TextMain,
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                )
            }
        }
        Text(androidText("UTP 2-cable swap plan", "UTP 2-kabel wisselplan"), fontSize = 12.sp, fontWeight = FontWeight.Black)
        Text(
            "Swaps: ${audit.utpPlan.swapCount} · Single moves: ${audit.utpPlan.moveCount}" +
                if (audit.utpPlan.unresolved > 0) {
                    androidText(" · Outstanding: ${audit.utpPlan.unresolved}", " · Openstaand: ${audit.utpPlan.unresolved}")
                } else {
                    ""
                },
            color = TextSoft,
            fontSize = 12.sp,
            modifier = Modifier.testTag("tournament-layout-utp-plan"),
        )
        if (audit.utpPlan.steps.isEmpty()) {
            Text(androidText("No UTP swaps needed; the layout already matches.", "Geen UTP-wissels nodig; indeling komt al overeen."), color = TextSoft, fontSize = 12.sp)
        } else {
            audit.utpPlan.steps.forEachIndexed { index, step ->
                val line = if (step.type == "swap") {
                    androidText(
                        "Step ${index + 1}: swap UTP ${step.cableX} (${step.from} → ${step.to}) with " +
                            "UTP ${step.cableY} (${step.to} → ${step.from}).",
                        "Stap ${index + 1}: wissel UTP ${step.cableX} (${step.from} → ${step.to}) met " +
                            "UTP ${step.cableY} (${step.to} → ${step.from}).",
                    )
                } else {
                    androidText(
                        "Step ${index + 1}: move UTP ${step.cableX} (${step.from} → ${step.to}).",
                        "Stap ${index + 1}: verplaats UTP ${step.cableX} (${step.from} → ${step.to}).",
                    )
                }
                Text(line, color = TextMain, fontSize = 12.sp, lineHeight = 17.sp)
            }
        }
    }
}

@Composable
private fun ExportPanel(title: String, content: @Composable () -> Unit) {
    Surface(
        color = PanelBackground,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, PanelBorder),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(11.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.Black)
            content()
        }
    }
}
