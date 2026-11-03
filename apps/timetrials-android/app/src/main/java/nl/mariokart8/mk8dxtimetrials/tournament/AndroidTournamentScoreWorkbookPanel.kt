package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Surface
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Reading a Tournament Processor score workbook into Step 5 or Step 9, following
 * the source Manager's `renderScoreImportPanel` (`assets/app.js`).
 *
 * The shape is the source's: every group is on screen at once as its own card,
 * each picks its own recording, and each is confirmed **as a whole** rather than
 * row by row. A row's picker shows how often each participant has already been
 * chosen - green at one, red at two or more - so a mistake is visible where it
 * is made instead of being silently corrected. The confirm and import controls
 * name what is still wrong, so it can be fixed without hunting.
 *
 * Names resolve through display names and the Player's aliases (migration
 * 0049). A name that matches nothing is not a dead end: it gets an empty picker,
 * the operator points it at a participant by hand, and that is recorded as a
 * hand-made link rather than dressed up as a match.
 */

internal data class WorkbookVideo(
    val video: String,
    val rows: List<Pair<String, Int>>,
    /**
     * The races the Processor recorded for this video. These, not the totals,
     * are what the platform stores and what TrueSkill is applied from.
     */
    val races: List<AndroidWorkbookRace> = emptyList(),
    /** The character each workbook name drove, when the file named one. */
    val characters: Map<String, AndroidWorkbookCharacter> = emptyMap(),
)

/** One group's import state: which recording, the mappings, and whether it is locked. */
internal class AndroidScoreGroupImport {
    val video = mutableStateOf<String?>(null)
    val mappings = mutableStateOf<List<AndroidScoreMapping>>(emptyList())
    val confirmed = mutableStateOf(false)
}

/**
 * The panel's state, owned by the step so that scrolling cannot discard a review
 * in progress.
 */
internal class AndroidScoreWorkbookState {
    val failure = mutableStateOf<String?>(null)
    val videos = mutableStateOf<List<WorkbookVideo>>(emptyList())
    private val groups = mutableMapOf<String, AndroidScoreGroupImport>()

    fun forGroup(groupId: String): AndroidScoreGroupImport =
        groups.getOrPut(groupId) { AndroidScoreGroupImport() }

    fun reset() {
        groups.clear()
    }
}

@Composable
private fun toneColor(tone: AndroidScoreMatchTone): Color = when (tone) {
    // The source's badge palette: an exact or alias match is green, a strong
    // match blue, a likely one amber, anything left to check red.
    AndroidScoreMatchTone.SETTLED -> SuccessGreen
    AndroidScoreMatchTone.STRONG -> ScoreMatchBlue
    AndroidScoreMatchTone.LIKELY -> WarningAmber
    AndroidScoreMatchTone.ATTENTION -> DangerRed
}

@Composable
internal fun TournamentScoreWorkbookPanel(
    groups: List<AndroidTournamentGroup>,
    busy: Boolean,
    state: AndroidScoreWorkbookState,
    onApply: (
        groupId: String,
        races: List<AndroidResolvedRace>,
        characters: List<AndroidResolvedCharacter>,
    ) -> Unit,
    playerAliases: Map<String, List<String>>,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val language = LocalAndroidProductLanguage.current
    var failure by state.failure
    var videos by state.videos

    fun targetsFor(group: AndroidTournamentGroup): List<AndroidScoreTarget> =
        group.members.map { member ->
            AndroidScoreTarget(
                playerId = member.playerId,
                displayName = member.displayName,
                aliases = playerAliases[member.playerId].orEmpty(),
            )
        }

    fun suggest(group: AndroidTournamentGroup, video: String?) {
        val entry = state.forGroup(group.groupId)
        val rows = videos.firstOrNull { it.video == video }?.rows.orEmpty()
        entry.mappings.value = if (rows.isEmpty()) {
            emptyList()
        } else {
            androidSuggestScoreMapping(rows, targetsFor(group))
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        failure = null
        val parsed = runCatching {
            context.contentResolver.openInputStream(uri)?.use { stream ->
                // Both sheets: the standings name the field, the races are what
                // is actually stored and rated.
                androidParseWorkbook(
                    stream,
                    listOf(WORKBOOK_FINAL_STANDINGS_SHEET, WORKBOOK_RESULTS_SHEET),
                    language,
                )
            }
        }.getOrNull()
        when (parsed) {
            null -> failure = androidText(language, "The file could not be opened.", "Het bestand kon niet worden geopend.")
            is AndroidWorkbookParse.Failed -> failure = parsed.message
            is AndroidWorkbookParse.Parsed -> {
                val sheet = parsed.sheets[WORKBOOK_FINAL_STANDINGS_SHEET]
                val missing = sheet?.let {
                    androidWorkbookMissingHeaders(it, WORKBOOK_FINAL_STANDINGS_HEADERS)
                }.orEmpty()
                if (sheet == null || missing.isNotEmpty()) {
                    failure = androidText(
                        language,
                        "The Final Standings sheet is missing columns: ${missing.joinToString(", ")}.",
                        "Het tabblad Final Standings mist kolommen: ${missing.joinToString(", ")}.",
                    )
                } else {
                    val byVideo = androidWorkbookStandingsRows(sheet)
                    val results = parsed.sheets[WORKBOOK_RESULTS_SHEET]
                    val missingRaceHeaders = results?.let {
                        androidWorkbookMissingHeaders(it, WORKBOOK_RACE_HEADERS)
                    }.orEmpty()
                    val racesByVideo = if (results == null || missingRaceHeaders.isNotEmpty()) {
                        emptyMap()
                    } else {
                        androidWorkbookRaces(results)
                    }
                    val charactersByVideo = androidWorkbookStandingsCharacters(sheet)
                    if (byVideo.isEmpty()) {
                        failure = androidText(language, "This workbook has no results.", "Deze werkmap bevat geen uitslagen.")
                    } else if (racesByVideo.isEmpty()) {
                        failure = androidText(
                            language,
                            "The Results sheet has no races. Without races " +
                                "the result does not count for TrueSkill.",
                            "Het tabblad Results bevat geen races. Zonder races " +
                                "telt de uitslag niet mee voor TrueSkill.",
                        )
                    } else {
                        state.reset()
                        videos = byVideo.map { (video, rows) ->
                            WorkbookVideo(
                                video,
                                rows,
                                racesByVideo[video].orEmpty(),
                                charactersByVideo[video].orEmpty(),
                            )
                        }
                        // A recording usually carries its group in its name, so
                        // the obvious pairing is offered and stays changeable.
                        groups.forEach { group ->
                            val best = videos.maxByOrNull {
                                androidScoreSimilarity(it.video, group.name)
                            }?.video
                            state.forGroup(group.groupId).video.value = best
                            suggest(group, best)
                        }
                    }
                }
            }
        }
    }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            androidText(
                "Read in the Tournament Processor's results. Names from the game " +
                    "are recognised through the names in the profile; whatever is not " +
                    "recognised, you link yourself. You confirm each group.",
                "Lees de uitslag van de Tournament Processor in. Namen uit de game " +
                    "worden herkend via de namen in het profiel; wat niet herkend " +
                    "wordt, koppel je zelf. Je bevestigt per groep.",
            ),
            color = TextSoft,
            fontSize = 12.sp,
            lineHeight = 17.sp,
        )
        SecondaryButton(
            label = androidText("Choose workbook (.xlsx)", "Kies werkmap (.xlsx)"),
            onClick = {
                picker.launch(
                    arrayOf(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "application/octet-stream",
                        "*/*",
                    ),
                )
            },
            testTag = "tournament-score-workbook-pick",
            modifier = Modifier.fillMaxWidth(),
            enabled = !busy,
        )

        failure?.let { message ->
            Surface(
                color = FieldBackground,
                shape = RoundedCornerShape(10.dp),
                border = BorderStroke(1.dp, DangerRed),
                modifier = Modifier.fillMaxWidth().testTag("tournament-score-workbook-error"),
            ) {
                Text(
                    message,
                    color = DangerRed,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.padding(10.dp),
                )
            }
        }

        if (videos.isNotEmpty()) {
            val ready = groups.count {
                androidScoreGroupReady(state.forGroup(it.groupId).mappings.value, targetsFor(it))
            }
            val confirmed = groups.count { state.forGroup(it.groupId).confirmed.value }
            val suggested = groups.sumOf { group ->
                state.forGroup(group.groupId).mappings.value.count { !it.manual && it.playerId != null }
            }
            val attention = groups.mapNotNull { group ->
                val entry = state.forGroup(group.groupId)
                val problems = androidScoreGroupProblems(entry.mappings.value, targetsFor(group), language)
                if (entry.confirmed.value || problems.isEmpty()) null else androidGroupLabel(group.name, group.tierKey, language) to problems.first()
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxWidth().testTag("tournament-score-workbook-summary"),
            ) {
                StepBadge(androidText("${videos.size} recording(s)", "${videos.size} opname(s)"))
                StepBadge(androidText("$confirmed of ${groups.size} confirmed", "$confirmed van ${groups.size} bevestigd"))
                StepBadge(androidText("$ready ready", "$ready klaar"))
                StepBadge(androidText("${attention.size} need attention", "${attention.size} met aandacht"))
                if (suggested > 0) {
                    StepBadge(androidText("$suggested suggested links", "$suggested suggestie-koppelingen"))
                }
            }
            if (attention.isNotEmpty()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                    modifier = Modifier.testTag("tournament-score-workbook-attention"),
                ) {
                    attention.forEach { (name, problem) ->
                        Text(
                            "$name: $problem",
                            color = WarningAmber,
                            fontSize = 12.sp,
                            lineHeight = 16.sp,
                        )
                    }
                }
            }

            groups.forEach { group ->
                GroupImportCard(
                    group = group,
                    entry = state.forGroup(group.groupId),
                    videos = videos,
                    targets = targetsFor(group),
                    busy = busy,
                    onVideo = { video ->
                        state.forGroup(group.groupId).video.value = video
                        suggest(group, video)
                    },
                    onResuggest = { suggest(group, state.forGroup(group.groupId).video.value) },
                )
            }

            val unconfirmed = groups.filter { !state.forGroup(it.groupId).confirmed.value }
            val confirmedGroups = groups.filter { state.forGroup(it.groupId).confirmed.value }
            Text(
                when {
                    unconfirmed.isEmpty() -> androidText(
                        "All groups confirmed — ready to import.",
                        "Alle groepen bevestigd — klaar om te importeren.",
                    )
                    confirmedGroups.isEmpty() -> androidText(
                        "Still to confirm: ${unconfirmed.joinToString(", ") { it.name }}",
                        "Nog te bevestigen: ${unconfirmed.joinToString(", ") { it.name }}",
                    )
                    // The Web console takes the groups that are ready and leaves
                    // the rest for the hand matching; so does this, rather than
                    // holding a finished group hostage (owner, 2026-09-16).
                    else -> androidText(
                        "Ready: ${confirmedGroups.joinToString(", ") { it.name }} · " +
                            "still to confirm: ${unconfirmed.joinToString(", ") { it.name }}",
                        "Klaar: ${confirmedGroups.joinToString(", ") { it.name }} · " +
                            "nog te bevestigen: ${unconfirmed.joinToString(", ") { it.name }}",
                    )
                },
                color = if (unconfirmed.isEmpty()) SuccessGreen else WarningAmber,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.testTag("tournament-score-workbook-apply-hint"),
            )
            SecondaryButton(
                label = when (confirmedGroups.size) {
                    0 -> androidText("Take over scores", "Scores overnemen")
                    groups.size -> androidText("Take over all ${groups.size} groups", "Alle ${groups.size} groepen overnemen")
                    1 -> androidText("Take over ${confirmedGroups.single().name}", "${confirmedGroups.single().name} overnemen")
                    else -> androidText("Take over ${confirmedGroups.size} groups", "${confirmedGroups.size} groepen overnemen")
                },
                onClick = {
                    groups.forEach { group ->
                        val entry = state.forGroup(group.groupId)
                        if (!entry.confirmed.value) return@forEach
                        val races = videos.firstOrNull { it.video == entry.video.value }?.races
                            ?: return@forEach
                        val characters = videos.firstOrNull { it.video == entry.video.value }
                            ?.characters.orEmpty()
                        when (val resolved = androidResolveRaces(races, entry.mappings.value, language)) {
                            is AndroidRaceResolution.Failed -> { failure = resolved.message }
                            is AndroidRaceResolution.Resolved -> onApply(
                                group.groupId,
                                resolved.races,
                                androidResolvedCharacters(entry.mappings.value, characters),
                            )
                        }
                    }
                },
                testTag = "tournament-score-workbook-apply",
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && confirmedGroups.isNotEmpty(),
            )
        }
    }
}

@Composable
private fun GroupImportCard(
    group: AndroidTournamentGroup,
    entry: AndroidScoreGroupImport,
    videos: List<WorkbookVideo>,
    targets: List<AndroidScoreTarget>,
    busy: Boolean,
    onVideo: (String) -> Unit,
    onResuggest: () -> Unit,
) {
    var confirmed by entry.confirmed
    val mappings by entry.mappings
    val video by entry.video
    val problems = androidScoreGroupProblems(mappings, targets, LocalAndroidProductLanguage.current)
    val counts = androidScoreSelectionCounts(mappings)

    Surface(
        color = PanelBackground,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, if (confirmed) SuccessGreen else PanelBorder),
        modifier = Modifier.fillMaxWidth()
            .testTag("tournament-score-workbook-group-${group.groupId}"),
    ) {
        Column(Modifier.padding(11.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    androidGroupLabel(group.name, group.tierKey, LocalAndroidProductLanguage.current),
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.weight(1f),
                )
                StepBadge(
                    if (confirmed) {
                        androidText("✓ Confirmed", "✓ Bevestigd")
                    } else {
                        androidText("${group.members.size} players", "${group.members.size} spelers")
                    },
                )
            }

            PickerRow(
                label = androidText("Recording", "Opname"),
                value = video ?: androidText("Choose recording", "Kies opname"),
                options = videos.map { it.video to "${it.video} (${it.rows.size})" },
                enabled = !confirmed && !busy,
                testTag = "tournament-score-workbook-video-${group.groupId}",
                onSelect = onVideo,
            )

            mappings.forEach { mapping ->
                MappingRow(
                    mapping = mapping,
                    targets = targets,
                    counts = counts,
                    enabled = !confirmed && !busy,
                    onSelect = { playerId ->
                        entry.mappings.value = androidAssignScoreMapping(
                            entry.mappings.value, mapping.workbookName, playerId,
                        )
                    },
                )
            }

            if (problems.isNotEmpty()) {
                Surface(
                    color = FieldBackground,
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, WarningAmber),
                    modifier = Modifier.fillMaxWidth()
                        .testTag("tournament-score-workbook-problems-${group.groupId}"),
                ) {
                    Column(Modifier.padding(9.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        problems.forEach { problem ->
                            Text(problem, color = WarningAmber, fontSize = 12.sp, lineHeight = 16.sp)
                        }
                    }
                }
            }

            if (mappings.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (confirmed) {
                        SecondaryButton(
                            label = androidText("🔓 Change group", "🔓 Wijzig groep"),
                            onClick = { confirmed = false },
                            testTag = "tournament-score-workbook-unlock-${group.groupId}",
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !busy,
                        )
                    } else {
                        SecondaryButton(
                            label = androidText("↻ Suggest again", "↻ Suggesties opnieuw"),
                            onClick = onResuggest,
                            testTag = "tournament-score-workbook-resuggest-${group.groupId}",
                            modifier = Modifier.weight(1f),
                            enabled = !busy,
                        )
                        SecondaryButton(
                            label = androidText("🔒 Confirm group", "🔒 Bevestig groep"),
                            onClick = { confirmed = true },
                            testTag = "tournament-score-workbook-confirm-${group.groupId}",
                            modifier = Modifier.weight(1f),
                            enabled = !busy && problems.isEmpty(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PickerRow(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    enabled: Boolean,
    testTag: String,
    onSelect: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = TextSoft, fontSize = 12.sp, modifier = Modifier.width(70.dp))
        Box(Modifier.weight(1f)) {
            SecondaryButton(
                label = value,
                onClick = { open = true },
                testTag = testTag,
                modifier = Modifier.fillMaxWidth(),
                enabled = enabled,
            )
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { (id, text) ->
                    DropdownMenuItem(
                        text = { Text(text, fontSize = 13.sp) },
                        onClick = { open = false; onSelect(id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun MappingRow(
    mapping: AndroidScoreMapping,
    targets: List<AndroidScoreTarget>,
    counts: Map<String, Int>,
    enabled: Boolean,
    onSelect: (String?) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val language = LocalAndroidProductLanguage.current
    val resolved = targets.firstOrNull { it.playerId == mapping.playerId }
    val meta = mapping.meta(language)
    val duplicated = (counts[mapping.playerId] ?: 0) > 1
    val border = when {
        mapping.unresolved || duplicated -> DangerRed
        else -> toneColor(meta.tone)
    }
    Surface(
        color = FieldBackground,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, border),
        modifier = Modifier.fillMaxWidth()
            .testTag("tournament-score-workbook-row-${mapping.workbookName}"),
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    mapping.workbookName,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                Text(androidText("${mapping.points} pts", "${mapping.points} ptn"), color = TextSoft, fontSize = 12.sp)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    color = FieldBackground,
                    shape = RoundedCornerShape(999.dp),
                    border = BorderStroke(1.dp, toneColor(meta.tone)),
                ) {
                    Text(
                        meta.label,
                        color = toneColor(meta.tone),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Black,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
                mapping.percent(language)?.let { percent ->
                    Spacer(Modifier.width(6.dp))
                    Text(percent, color = TextSoft, fontSize = 11.sp)
                }
            }
            // Naming the alias that matched is the whole point of having them:
            // "Naam-match" alone leaves the operator guessing why an unfamiliar
            // in-game handle was pointed at this participant.
            if (mapping.viaAlias && mapping.matchedName != null && resolved != null) {
                Text(
                    androidText(
                        "via alias \"${mapping.matchedName}\" of ${resolved.displayName}",
                        "via alias \"${mapping.matchedName}\" van ${resolved.displayName}",
                    ),
                    color = TextSoft,
                    fontSize = 11.sp,
                    lineHeight = 15.sp,
                    modifier = Modifier.testTag("tournament-score-workbook-alias-${mapping.workbookName}"),
                )
            }
            Box {
                SecondaryButton(
                    label = resolved?.displayName ?: androidText("Choose participant", "Kies deelnemer"),
                    onClick = { open = true },
                    testTag = "tournament-score-workbook-target-${mapping.workbookName}",
                    modifier = Modifier.fillMaxWidth(),
                    enabled = enabled,
                )
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    targets.forEach { target ->
                        val count = counts[target.playerId] ?: 0
                        // The source colours the option by how often it is
                        // already taken: green once, red twice or more.
                        val tint = when {
                            count >= 2 -> DangerRed
                            count == 1 -> SuccessGreen
                            else -> TextMain
                        }
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text("${target.displayName} [$count]", fontSize = 13.sp, color = tint)
                                    if (target.aliases.isNotEmpty()) {
                                        Text(
                                            androidText(
                                                "also: ${target.aliases.joinToString(", ")}",
                                                "ook: ${target.aliases.joinToString(", ")}",
                                            ),
                                            color = TextSoft,
                                            fontSize = 11.sp,
                                            lineHeight = 14.sp,
                                        )
                                    }
                                }
                            },
                            onClick = { open = false; onSelect(target.playerId) },
                        )
                    }
                    if (mapping.playerId != null) {
                        DropdownMenuItem(
                            text = { Text(androidText("Clear link", "Koppeling wissen"), fontSize = 13.sp, color = DangerRed) },
                            onClick = { open = false; onSelect(null) },
                        )
                    }
                }
            }
        }
    }
}
