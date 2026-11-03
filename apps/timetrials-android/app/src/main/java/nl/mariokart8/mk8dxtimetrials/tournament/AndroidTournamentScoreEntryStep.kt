package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme as Mk8dxDesignTheme
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * Steps 5 and 9 of the source Manager: `Kwalificatiescores invullen` and
 * `Eindgroepscores invullen`.
 *
 * The source enters one total per Player per group and splits that total into
 * parts when the group had connection errors. The canonical API models exactly
 * that as manual score segments, so this step drives `setManualScores`.
 */
@Composable
internal fun TournamentScoreEntryStep(
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
    onSaveScores: (String, Int, Map<String, List<Int?>>) -> Unit,
    onTieModeChange: (String, String) -> Unit,
    onTieOrderSave: (String, Int, List<String>) -> Unit,
    // Public aliases per Player, so an in-game name in the workbook resolves.
    playerAliases: Map<String, List<String>> = emptyMap(),
    // Applies the races a workbook carried, so the night can be rated.
    onImportRaces: (
        String,
        List<AndroidResolvedRace>,
        List<AndroidResolvedCharacter>,
    ) -> Unit = { _, _, _ -> },
    onExportWorkbook: (() -> Unit)? = null,
    onContinue: () -> Unit,
    // The ecosystem mounts the Live/Processor evidence inside this step;
    // the source Manager has no equivalent, so it is a slot rather than
    // something this Composable knows about.
    incomingContent: (androidx.compose.foundation.lazy.LazyListScope.() -> Unit)? = null,
    modifier: Modifier,
) {
    var tieExpanded by remember { mutableStateOf(false) }
    var excelExpanded by remember { mutableStateOf(false) }
    // Survives scrolling: the panel itself is a LazyColumn item.
    val workbookState = remember { AndroidScoreWorkbookState() }

    val qualifier = stage != "final"
    val scoreLabel = if (qualifier) {
        androidText("Qualifier scores", "Kwalificatiescores")
    } else {
        androidText("Final scores", "Eindgroepscores")
    }
    // The label inside a sentence: its own text, since not every language lower-cases a noun.
    val scoreLabelInSentence = if (qualifier) {
        androidText("qualifier scores", "kwalificatiescores")
    } else {
        androidText("final scores", "eindgroepscores")
    }
    val phaseLabel = if (qualifier) {
        androidText("Step 5 · Enter qualifier scores", "Stap 5 · Kwalificatiescores invullen")
    } else {
        androidText("Step 9 · Enter final-group scores", "Stap 9 · Eindgroepscores invullen")
    }
    val continueLabel = if (qualifier) {
        androidText("Continue to Step 6: Qualifier results export", "Ga door naar Stap 6: Kwalificatie-uitslag export")
    } else {
        androidText("Continue to Step 10: Final group results export", "Ga door naar Stap 10: Eindgroep-uitslag export")
    }
    val groups = document.groups.filter { it.stage == stage }.sortedBy { it.sequence }
    val tieMode = if (qualifier) document.summary.qualifierTieBreakMode else document.summary.finalTieBreakMode
    val unresolvedTies = groups.flatMap { group -> group.standings.tieGroups.filter { !it.resolved } }
    val everyGroupComplete = groups.isNotEmpty() && groups.all { group ->
        group.members.isNotEmpty() && group.standings.rows.size == group.members.size &&
            group.standings.rows.all { it.complete }
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            // The step paints its own surface: a console screen is never
            // drawn over whatever is behind it (DESIGN_SYSTEM §6).
            .background(Mk8dxDesignTheme.colors.surfaceApp)
            .testTag("tournament-score-entry-step"),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 5.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            TournamentStepHeader(
                backLabel = androidText("Back to Step ${stepNumber - 1}", "Terug naar Stap ${stepNumber - 1}"),
                phaseLabel = phaseLabel,
                tagPrefix = "tournament-score-entry",
                onHome = onHome,
                onBack = onBack,
                menu = {
                    TournamentStepMenu(
                        tagPrefix = "tournament-score-entry",
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
                    modifier = Modifier.fillMaxWidth().testTag("tournament-score-entry-error"),
                ) {
                    Text(message, color = DangerRed, fontSize = 13.sp, modifier = Modifier.padding(10.dp))
                }
            }
        }

        item {
            Surface(
                color = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusInfo),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, ScoreMatchBlue),
                modifier = Modifier.fillMaxWidth().testTag("tournament-live-score-guide"),
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    LocalizedText(
                        "Recommended on race day: Tournament Live",
                        color = ScoreMatchBlue,
                        fontWeight = FontWeight.Black,
                        fontSize = 14.sp,
                    )
                    LocalizedText(
                        "Before Start, the capture operator selects this Tournament and maps every sticker-named card to a " +
                            "different ${if (qualifier) "qualifier" else "final"} group. After race 1, a strong exact roster " +
                            "match may open the public View. Scores count only after Stop, Player matching and complete group approval here.",
                        color = TextMain,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                    LocalizedText(
                        "Linking creates pending evidence only. Scores count after Player, Track, order and group are reviewed " +
                            "and accepted. Excel and manual entry remain available.",
                        color = TextSoft,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                }
            }
        }

        // Connected evidence is the recommended race-night route, so it must
        // be visible before the much longer optional Excel/manual controls.
        incomingContent?.invoke(this)

        item {
            StepCollapsible(
                title = androidText(
                    "Tie-break setting for equal $scoreLabelInSentence (Step $stepNumber)",
                    "Instelling voor gelijke $scoreLabelInSentence (Stap $stepNumber)",
                ),
                expanded = tieExpanded,
                onToggle = { tieExpanded = !tieExpanded },
                testTag = "tournament-score-tie-settings",
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        androidText(
                            "For equal total scores, only the selected method decides. " +
                                "Wins and best race are shown only as context.",
                            "Na een gelijke totaalscore beslist alleen de gekozen methode. " +
                                "Overwinningen en beste race worden uitsluitend als context getoond.",
                        ),
                        color = TextSoft,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                    Text(
                        androidText("How do we resolve an exact tie?", "Wat doen we bij exact gelijke stand?"),
                        color = TextSoft,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    listOf(
                        "sp" to androidText("SP · highest SP, then SP Rank", "SP · hoogste SP, daarna SP Rank"),
                        "lottery" to androidText(
                            "Lottery · random and fixed for this tournament",
                            "Loting · willekeurig en vast voor dit toernooi",
                        ),
                        "manual" to androidText(
                            "Manual · set the order for each tie",
                            "Handmatig · bepaal de volgorde per gelijk spel",
                        ),
                    ).forEach { (mode, label) ->
                        Button(
                            onClick = { onTieModeChange(stage, mode) },
                            enabled = !busy && tieMode != mode,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (tieMode == mode) Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusSuccess) else FieldBackground,
                                contentColor = TextMain,
                                disabledContainerColor = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusSuccess),
                                disabledContentColor = TextMain,
                            ),
                            border = BorderStroke(1.dp, if (tieMode == mode) SuccessGreen else StrongLine),
                            modifier = Modifier.fillMaxWidth().testTag("tournament-tie-mode-$mode"),
                        ) { Text(label, fontSize = 12.sp) }
                    }
                    if (tieMode == "manual") {
                        val tieCount = groups.sumOf { it.standings.tieGroups.size }
                        Text(
                            if (tieCount == 0) {
                                androidText("No equal complete scores found yet.", "Nog geen gelijke volledige scores gevonden.")
                            } else {
                                androidText(
                                    "$tieCount tied score group(s) found. Save each order you want.",
                                    "$tieCount gelijke scoregroep(en) gevonden. Sla iedere gewenste volgorde op.",
                                )
                            },
                            color = if (unresolvedTies.isEmpty()) SuccessGreen else WarningAmber,
                            fontSize = 12.sp,
                            lineHeight = 16.sp,
                        )
                    }
                }
            }
        }

        if (tieMode == "manual") {
            groups.forEach { group ->
                group.standings.tieGroups.forEach { tie ->
                    item(key = "tie-${group.groupId}-${tie.points}") {
                        ManualTieOrderCard(
                            group = group,
                            tie = tie,
                            busy = busy,
                            onSave = { order -> onTieOrderSave(group.groupId, tie.points, order) },
                        )
                    }
                }
            }
        }

        item {
            StepCollapsible(
                title = androidText("Import scores from Excel (optional)", "Scores importeren uit Excel (optioneel)"),
                expanded = excelExpanded,
                onToggle = { excelExpanded = !excelExpanded },
                testTag = "tournament-score-excel",
            ) {
                TournamentScoreWorkbookPanel(
                    groups = groups,
                    state = workbookState,
                    busy = busy,
                    playerAliases = playerAliases,
                    // Races, not totals: only a race result can be published, and
                    // only a publication reaches TrueSkill.
                    onApply = onImportRaces,
                )
            }
        }

        item {
            val hasScores = groups.any { group ->
                group.races.isNotEmpty() || group.manualScores.any { score ->
                    score.segmentPoints.any { it != null }
                }
            }
            SecondaryButton(
                label = androidText("Export scores as Excel (Step $stepNumber)", "Exporteer scores als Excel (Stap $stepNumber)"),
                onClick = { onExportWorkbook?.invoke() },
                testTag = "tournament-score-export-workbook",
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && hasScores && onExportWorkbook != null,
            )
            if (!hasScores) {
                Text(
                    androidText("Enter scores first before exporting.", "Vul eerst scores in om te kunnen exporteren."),
                    color = TextSoft,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                )
            }
        }

        groups.forEach { group ->
            item(key = "score-${group.groupId}") {
                GroupScoreCard(
                    group = group,
                    revision = document.summary.revision,
                    scoreLabel = scoreLabel,
                    busy = busy,
                    onSaveScores = onSaveScores,
                )
            }
        }

        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Button(
                    onClick = onContinue,
                    enabled = !busy && everyGroupComplete && unresolvedTies.isEmpty(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusSuccess),
                        contentColor = TextMain,
                        disabledContainerColor = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusError),
                        disabledContentColor = TextSoft,
                    ),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, if (everyGroupComplete) SuccessGreen else DangerRed),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp)
                        .testTag("tournament-score-entry-continue"),
                ) {
                    Text(
                        if (everyGroupComplete && unresolvedTies.isEmpty()) {
                            continueLabel
                        } else {
                            androidText("$continueLabel (not ready)", "$continueLabel (nog niet klaar)")
                        },
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Black,
                    )
                }
                if (!everyGroupComplete || unresolvedTies.isNotEmpty()) {
                    Text(
                        if (unresolvedTies.isNotEmpty()) {
                            androidText("Resolve every manual tie first.", "Los eerst iedere handmatige gelijke eindscore op.")
                        } else {
                            androidText(
                                "Enter and save all $scoreLabelInSentence for every group first.",
                                "Vul eerst voor elke groep alle $scoreLabelInSentence in en sla ze op.",
                            )
                        },
                        color = TextSoft,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun ManualTieOrderCard(
    group: AndroidTournamentGroup,
    tie: AndroidTournamentTieGroup,
    busy: Boolean,
    onSave: (List<String>) -> Unit,
) {
    val order = remember(group.groupId, tie.points, tie.players.map { it.playerId }) {
        mutableStateListOf<AndroidTournamentTiePlayer>().apply { addAll(tie.players) }
    }
    Surface(
        color = PanelBackground,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, if (tie.resolved) SuccessGreen else WarningAmber),
        modifier = Modifier.fillMaxWidth().testTag("tournament-manual-tie-${group.groupId}-${tie.points}"),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val tieStatus = if (tie.resolved) {
                androidText("resolved", "opgelost")
            } else {
                androidText("choice needed", "keuze nodig")
            }
            Text(
                androidText(
                    "${androidGroupLabel(group.name, group.tierKey, LocalAndroidProductLanguage.current)} · ${tie.points} points · $tieStatus",
                    "${androidGroupLabel(group.name, group.tierKey, LocalAndroidProductLanguage.current)} · ${tie.points} punten · $tieStatus",
                ),
                fontWeight = FontWeight.Black,
                fontSize = 13.sp,
            )
            Text(
                androidText(
                    "Put the Player who should finish higher at the top. Wins and best race are informational only.",
                    "Zet de speler die hoger moet eindigen bovenaan. Winst en beste race zijn alleen informatie.",
                ),
                color = TextSoft,
                fontSize = 11.sp,
                lineHeight = 15.sp,
            )
            order.forEachIndexed { index, player ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "${index + 1}.",
                        style = Mk8dxDesignTheme.type.data.copy(fontWeight = FontWeight.Black),
                        modifier = Modifier.width(24.dp),
                    )
                    Column(Modifier.weight(1f)) {
                        Text(player.displayName, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        if (player.wins > 0 || player.bestRace > 0) {
                            Text(
                                androidText(
                                    "For consideration: ${player.wins} win(s) · best race ${player.bestRace}",
                                    "Ter afweging: ${player.wins} winst(en) · beste race ${player.bestRace}",
                                ),
                                color = TextSoft,
                                fontSize = 10.sp,
                            )
                        }
                    }
                    Button(
                        onClick = { if (index > 0) order.add(index - 1, order.removeAt(index)) },
                        enabled = !busy && index > 0,
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    ) { Text("↑") }
                    Button(
                        onClick = { if (index < order.lastIndex) order.add(index + 1, order.removeAt(index)) },
                        enabled = !busy && index < order.lastIndex,
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    ) { Text("↓") }
                }
            }
            Button(
                onClick = { onSave(order.map { it.playerId }) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().testTag("tournament-manual-tie-save-${group.groupId}-${tie.points}"),
            ) { Text(androidText("Save order", "Volgorde opslaan")) }
        }
    }
}

@Composable
private fun GroupScoreCard(
    group: AndroidTournamentGroup,
    revision: Int,
    scoreLabel: String,
    busy: Boolean,
    onSaveScores: (String, Int, Map<String, List<Int?>>) -> Unit,
) {
    val focusManager = LocalFocusManager.current
    var connectionErrors by remember(group.groupId, revision) {
        mutableIntStateOf((group.manualScoreSegments - 1).coerceIn(0, 3))
    }
    val segments = connectionErrors + 1
    // With races in the group the totals come from those races, exactly as the
    // Web console fills them: the first part carries the standing, so an import
    // shows up here instead of leaving the table empty (owner, 2026-09-16).
    val fromRaces = group.races.isNotEmpty()
    val values = remember(group.groupId, revision, segments) {
        mutableStateListOf<String>().apply {
            group.members.forEach { member ->
                val existing = group.manualScores.firstOrNull { it.playerId == member.playerId }
                val standing = group.standings.rows.firstOrNull { it.playerId == member.playerId }
                repeat(segments) { index ->
                    val value = if (fromRaces && index == 0) {
                        standing?.points
                    } else {
                        existing?.segmentPoints?.getOrNull(index)
                    }
                    add(value?.toString().orEmpty())
                }
            }
        }
    }

    Surface(
        color = PanelBackground,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, PanelBorder),
        modifier = Modifier.fillMaxWidth().testTag("tournament-score-group-${group.groupId}"),
    ) {
        Column(Modifier.padding(11.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(androidGroupLabel(group.name, group.tierKey, LocalAndroidProductLanguage.current), fontSize = 15.sp, fontWeight = FontWeight.Black, modifier = Modifier.weight(1f))
                StepBadge(androidText("${group.members.size} participants", "${group.members.size} deelnemers"), numeric = true)
            }
            Text(scoreLabel, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Text(
                if (fromRaces) {
                    androidText(
                        "The totals below come from the races. Change one to correct it; the races themselves " +
                            "are left as they were, and the standing says it was corrected.",
                        "De totalen hieronder komen uit de races. Pas er een aan om te corrigeren; " +
                            "de races zelf blijven zoals ze waren en de stand vermeldt dat er " +
                            "gecorrigeerd is.",
                    )
                } else {
                    androidText(
                        "Enter each Player's total score. The table updates automatically when you leave the " +
                            "field or press Enter.",
                        "Vul per speler de totaalscore in. De tabel werkt automatisch bij zodra je het " +
                            "veld verlaat of op Enter drukt.",
                    )
                },
                color = TextSoft,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            )

            Text(androidText("Connection errors (group):", "Connection errors (groep):"), color = TextSoft, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            StepChoiceRow(
                options = (0..3).map { it.toString() to it.toString() },
                selected = connectionErrors.toString(),
                enabled = !busy,
                testTag = "tournament-score-errors-${group.groupId}",
                onSelect = { connectionErrors = it.toIntOrNull() ?: 0 },
            )

            // The source orders the table by the running total, highest first.
            val totals = group.members.mapIndexed { index, member ->
                member to (0 until segments).sumOf {
                    values.getOrNull(index * segments + it)?.toIntOrNull() ?: 0
                }
            }
            val order = totals.sortedWith(
                compareByDescending<Pair<AndroidTournamentMember, Int>> { it.second }
                    .thenBy { it.first.displayName.lowercase() },
            ).map { it.first.playerId }

            // The source renders the table in standing order and re-sorts it as
            // soon as a score is entered, so the number beside a name is the
            // position rather than a fixed row number. The badge sits in a
            // fixed-width box so the names stay in one column whether the rank
            // is #1 or #12.
            order.forEachIndexed { position, playerId ->
                val memberIndex = group.members.indexOfFirst { it.playerId == playerId }
                if (memberIndex < 0) return@forEachIndexed
                val member = group.members[memberIndex]
                val rank = position + 1
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(44.dp), contentAlignment = Alignment.CenterStart) {
                        StepBadge(Mk8dxNumeric.formatRank(rank, Mk8dxNumberLanguage.NL), numeric = true)
                    }
                    // The character the workbook brought, right where the
                    // Director can see whether it came along at all.
                    androidTournamentCharacterAsset(member.character)?.let { asset ->
                        Spacer(Modifier.width(6.dp))
                        nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage(
                            path = asset,
                            fallback = member.character?.label?.take(1) ?: "?",
                            accent = TextSoft,
                            contentDescription = member.character?.label ?: "",
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    Column(Modifier.padding(horizontal = 8.dp).weight(1f)) {
                        Text(
                            member.displayName,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        // A standing the Director already corrected says what
                        // the races said, as the site prints beside the row.
                        val corrected = group.standings.rows
                            .firstOrNull { it.playerId == member.playerId }?.correctedFromRaces
                        if (corrected != null) {
                            Text(
                                androidText("corrected · races: $corrected", "gecorrigeerd · races: $corrected"),
                                color = WarningAmber,
                                fontSize = 11.sp,
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        repeat(segments) { segment ->
                            val index = memberIndex * segments + segment
                            OutlinedTextField(
                                value = values[index],
                                onValueChange = { values[index] = it.filter(Char::isDigit).take(4) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                shape = RoundedCornerShape(8.dp),
                                textStyle = Mk8dxDesignTheme.type.data,
                                colors = stepFieldColors(),
                                modifier = Modifier
                                    .width(if (segments == 1) 84.dp else 66.dp)
                                    .testTag(
                                        "tournament-score-${group.groupId}-${member.playerId}-${segment + 1}",
                                    ),
                            )
                        }
                    }
                }
            }

            val valid = values.isNotEmpty() && values.all { it.toIntOrNull() != null }
            SecondaryButton(
                label = if (fromRaces) {
                    androidText("Save corrections", "Correcties opslaan")
                } else {
                    androidText("Update table now", "Update tabel nu")
                },
                onClick = {
                    focusManager.clearFocus()
                    val scores = group.members.mapIndexed { memberIndex, member ->
                        member.playerId to (0 until segments).map {
                            values[memberIndex * segments + it].toIntOrNull()
                        }
                    }.toMap()
                    onSaveScores(group.groupId, segments, scores)
                },
                testTag = "tournament-save-scores-${group.groupId}",
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && valid,
            )
        }
    }
}
