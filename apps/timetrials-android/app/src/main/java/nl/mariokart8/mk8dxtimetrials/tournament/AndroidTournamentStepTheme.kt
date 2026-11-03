package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.TextFieldColors
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.R
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme as Mk8dxDesignTheme

/**
 * Shared chrome for the source-faithful Tournament steps.
 *
 * Step 2 established this palette and these building blocks; Steps 3 to 10
 * reuse them, so they live here instead of being copied per step.
 *
 * Phase 14 (A07) replaced the navy step palette with the generated design
 * tokens. The names are unchanged - every step screen keeps reading the same
 * role - but each one now resolves against the appearance the operator chose,
 * so the console answers Light and high contrast like every other screen.
 * Nothing about the workflow moved: OD-09 still gates every interaction
 * change in this console until the Director walkthrough is recorded.
 */

internal val PanelBackground: Color @Composable get() = Mk8dxDesignTheme.colors.surfaceRaised
internal val PanelBorder: Color @Composable get() = Mk8dxDesignTheme.colors.borderSubtle
internal val CollapsibleBackground: Color @Composable get() = Mk8dxDesignTheme.colors.surfaceControl
internal val SettingsBackground: Color @Composable get() = Mk8dxDesignTheme.colors.surfaceControl
internal val StrongLine: Color @Composable get() = Mk8dxDesignTheme.colors.borderStrong
internal val BoardBackground: Color @Composable get() = Mk8dxDesignTheme.colors.surfaceApp
internal val BoardBorder: Color @Composable get() = Mk8dxDesignTheme.colors.borderStrong
internal val FieldBackground: Color @Composable get() = Mk8dxDesignTheme.colors.surfaceControl
/** The secondary action fill (DESIGN_SYSTEM §9: surface.control + a border.strong hairline). */
internal val ActionBlue: Color @Composable get() = Mk8dxDesignTheme.colors.surfaceControl
internal val TextSoft: Color @Composable get() = Mk8dxDesignTheme.colors.textSecondary
internal val TextMain: Color @Composable get() = Mk8dxDesignTheme.colors.textPrimary
internal val SuccessGreen: Color @Composable get() = Mk8dxDesignTheme.colors.statusSuccess
/** The source's `.score-import-suggestion-badge.is-strong` blue, now `status.info`. */
internal val ScoreMatchBlue: Color @Composable get() = Mk8dxDesignTheme.colors.statusInfo
internal val WarningAmber: Color @Composable get() = Mk8dxDesignTheme.colors.statusWarning
internal val DangerRed: Color @Composable get() = Mk8dxDesignTheme.colors.statusError

/**
 * The operator mode rule (DESIGN_SYSTEM §5/§6, `mode.raceDirection`). The
 * source's orange `Stap N` badge was already this signal; it now reads the
 * token, and the same token draws the 4 px rule above the console.
 */
internal val PhaseBadgeText: Color @Composable get() = Mk8dxDesignTheme.colors.modeRaceDirection
internal val PhaseBadgeBackground: Color
    @Composable get() = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.modeRaceDirection)
internal val PhaseBadgeBorder: Color @Composable get() = Mk8dxDesignTheme.colors.modeRaceDirection

/** The 4 px Race Direction rule the console wears instead of normal chrome emphasis. */
@Composable
internal fun RaceDirectionRule(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(4.dp)
            .background(Mk8dxDesignTheme.colors.modeRaceDirection)
            .testTag("tournament-mode-rule"),
    )
}

/** `GROUP_COLORS` in the source `assets/app.js`. */
internal val GroupColors = listOf(
    Color(0xFFDC2626), Color(0xFF0D9488), Color(0xFF475569),
    Color(0xFF1D4ED8), Color(0xFFB45309),
)

internal fun groupColorForIndex(index: Int): Color =
    GroupColors[((index % GroupColors.size) + GroupColors.size) % GroupColors.size]

/**
 * `FIXED_TIER_DEFINITIONS`, `TIER_COLORS` and `TIER_SYMBOLS` in the source. A
 * Player without a rank is `Nieuw`, which the source treats as its own tier.
 */
internal data class AndroidTournamentTier(
    val key: String,
    val name: String,
    val symbol: String,
    val color: Color,
)

/**
 * Phase 17: the five ladder colours come from the product's one definition of
 * them, [androidTournamentTierColor], instead of a second copy here. Every key
 * below has one there, so the fallback never fires; it only keeps this total.
 * Nieuw and Onbekend are the console's own and exist nowhere else.
 */
private fun tierColor(key: String): Color =
    androidTournamentTierColor(key) ?: Color.Unspecified

internal val TournamentTiers = listOf(
    AndroidTournamentTier("champion", "Kampioen", "★︎", tierColor("champion")),
    AndroidTournamentTier("talent", "Talent", "♦︎", tierColor("talent")),
    AndroidTournamentTier("wild", "Wild", "♠︎", tierColor("wild")),
    AndroidTournamentTier("adventure", "Avontuur", "♣︎", tierColor("adventure")),
    AndroidTournamentTier("feest", "Feest", "♥︎", tierColor("feest")),
)

internal val NewPlayerTier =
    AndroidTournamentTier("new", "Nieuw", "★︎", Color(0xFFF97316))

internal val UnknownTier =
    AndroidTournamentTier("unknown", "Onbekend", "●︎", Color(0xFF94A3B8))

/** The source's fixed rank windows: 1-12, 13-24, 25-36, 37-48, 49-60. */
internal fun tierForRank(seedRank: Int?): AndroidTournamentTier {
    val rank = seedRank ?: return NewPlayerTier
    if (rank < 1) return NewPlayerTier
    val index = (rank - 1) / 12
    return TournamentTiers.getOrNull(index) ?: UnknownTier
}

/** `formatRankMetric`: two decimals, Dutch comma. */
internal fun formatRankMetric(value: Double?): String =
    String.format(Locale.ROOT, "%.2f", value ?: 0.0).replace('.', ',')

@Composable
internal fun StepCollapsible(
    title: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    testTag: String,
    background: Color = CollapsibleBackground,
    border: Color = PanelBorder,
    content: @Composable () -> Unit,
) {
    Surface(
        color = background,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, border),
        modifier = Modifier.fillMaxWidth().testTag(testTag),
    ) {
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = Mk8dxSpacing.targetMin)
                    .clickable(onClick = onToggle)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // The chevron is decoration: the row already says expanded or
                // collapsed through its own semantics.
                Text(
                    if (expanded) "▾" else "▸",
                    color = Mk8dxDesignTheme.colors.textSecondary,
                    fontSize = 12.sp,
                    modifier = Modifier.clearAndSetSemantics { },
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    title,
                    style = Mk8dxDesignTheme.type.label.copy(fontSize = 14.sp, fontWeight = FontWeight.Bold),
                    color = Mk8dxDesignTheme.colors.textPrimary,
                )
            }
            if (expanded) {
                Box(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) { content() }
            }
        }
    }
}

@Composable
internal fun SecondaryButton(
    label: String,
    onClick: () -> Unit,
    testTag: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = ActionBlue, contentColor = TextMain),
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, StrongLine),
        contentPadding = PaddingValues(horizontal = 12.dp),
        modifier = modifier.heightIn(min = Mk8dxSpacing.targetMin).testTag(testTag),
    ) {
        Text(
            label,
            style = Mk8dxDesignTheme.type.label.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The source shows a bordered icon box holding NS1.png / NS2.png, and repeats
 * the label beside it only in the legend. ADR-0177 adopts those two source
 * images on the owner's accepted provenance position.
 */
@Composable
internal fun SwitchChip(label: String, enabled: Boolean, showLabel: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(
            color = if (enabled) {
                Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusSuccess)
            } else {
                Mk8dxDesignTheme.colors.surfaceControl
            },
            shape = RoundedCornerShape(6.dp),
            border = BorderStroke(
                1.dp,
                if (enabled) Mk8dxDesignTheme.colors.statusSuccess else Mk8dxDesignTheme.colors.borderStrong,
            ),
            modifier = Modifier.size(20.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Image(
                    painter = painterResource(
                        if (label == "NS2") R.drawable.mk8dx_ns2 else R.drawable.mk8dx_ns1,
                    ),
                    contentDescription = label,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
        if (showLabel) {
            Spacer(Modifier.width(4.dp))
            Text(label, color = TextMain, fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Black)
        }
    }
}

/** Source `.utp-chip`: Ethernet.png followed by the Tournament cable number. */
@Composable
internal fun UtpCableChip(number: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(
            painter = painterResource(R.drawable.mk8dx_ethernet),
            contentDescription = "UTP-kabel",
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.width(4.dp))
        Text(
            "#$number",
            color = WarningAmber,
            fontSize = 11.sp,
            lineHeight = 15.sp,
            fontWeight = FontWeight.Black,
        )
    }
}

/** The orange `Stap N · ...` marker the source puts under the header buttons. */
@Composable
internal fun StepPhaseMarker(label: String, testTag: String) {
    Surface(
        color = PhaseBadgeBackground,
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, PhaseBadgeBorder),
        modifier = Modifier.testTag(testTag),
    ) {
        Text(
            label,
            color = PhaseBadgeText,
            style = Mk8dxDesignTheme.type.micro.copy(fontSize = 13.sp, fontWeight = FontWeight.Black),
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
        )
    }
}

/**
 * A small pill, used for the source's group count badge and rank pills.
 * `numeric` prints the value in the data face, so ranks and counts line up
 * digit for digit (DESIGN_SYSTEM §10).
 */
@Composable
internal fun StepBadge(
    text: String,
    color: Color = TextSoft,
    background: Color = FieldBackground,
    numeric: Boolean = false,
) {
    Surface(color = background, shape = RoundedCornerShape(7.dp), border = BorderStroke(1.dp, StrongLine)) {
        Text(
            text,
            color = color,
            style = (if (numeric) Mk8dxDesignTheme.type.dataS else Mk8dxDesignTheme.type.micro)
                .copy(fontSize = 11.sp, fontWeight = FontWeight.Bold),
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
        )
    }
}

/** Token colours for the console's text fields (the console has eight). */
@Composable
internal fun stepFieldColors(): TextFieldColors = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Mk8dxDesignTheme.colors.textPrimary,
    unfocusedTextColor = Mk8dxDesignTheme.colors.textPrimary,
    focusedContainerColor = Mk8dxDesignTheme.colors.surfaceControl,
    unfocusedContainerColor = Mk8dxDesignTheme.colors.surfaceControl,
    focusedBorderColor = Mk8dxDesignTheme.colors.focusRing,
    unfocusedBorderColor = Mk8dxDesignTheme.colors.borderControl,
    cursorColor = Mk8dxDesignTheme.colors.actionPrimary,
)

/** One inline choice row, matching the source's segmented option controls. */
@Composable
internal fun StepChoiceRow(
    options: List<Pair<String, String>>,
    selected: String,
    enabled: Boolean,
    testTag: String,
    onSelect: (String) -> Unit,
) {
    val colors = Mk8dxDesignTheme.colors
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.selectableGroup().testTag(testTag),
    ) {
        options.forEach { (value, text) ->
            val active = value == selected
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = Mk8dxSpacing.targetMin)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (active) colors.surfaceSelected else colors.surfaceControl)
                    .border(
                        1.dp,
                        if (active) colors.actionPrimary else colors.borderStrong,
                        RoundedCornerShape(10.dp),
                    )
                    // Same gate as before (a selected option is not re-selectable);
                    // only the role the screen reader hears is new.
                    .selectable(
                        selected = active,
                        enabled = enabled && !active,
                        role = Role.RadioButton,
                        onClick = { onSelect(value) },
                    )
                    .testTag("$testTag-$value"),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text(
                    text,
                    color = if (active) colors.textPrimary else colors.textSecondary,
                    style = Mk8dxDesignTheme.type.micro.copy(
                        fontSize = 12.sp,
                        fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
                    ),
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
                )
            }
        }
    }
}

/**
 * The source's phone header: board title, admin menu, and the
 * home / back / save / save-status row, with the orange phase marker under it.
 */
@Composable
internal fun TournamentStepHeader(
    backLabel: String,
    phaseLabel: String,
    tagPrefix: String,
    onHome: () -> Unit,
    onBack: () -> Unit,
    menu: @Composable (() -> Unit)? = null,
) {
    val colors = Mk8dxDesignTheme.colors
    val secondary = ButtonDefaults.buttonColors(
        containerColor = colors.surfaceControl,
        contentColor = colors.textPrimary,
    )
    val hairline = BorderStroke(1.dp, colors.borderStrong)
    val homeDescription = androidText("To the tournament overview", "Naar het toernooioverzicht")
    val saveDescription = androidText("Save", "Opslaan")
    val savedState = androidText("Everything is already saved", "Alles is al opgeslagen")
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        // The Race Direction rule: this console is operator chrome, not a
        // public page (DESIGN_SYSTEM §5, §11).
        RaceDirectionRule()
        Box(Modifier.fillMaxWidth()) {
            Text(
                androidText("MK8DX LAN Tournament Board", "MK8DX LAN Toernooibord"),
                style = Mk8dxDesignTheme.type.title.copy(fontSize = 16.sp, fontWeight = FontWeight.Black),
                color = colors.textPrimary,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 8.dp)
                    .semantics { heading() },
            )
            if (menu != null) Box(Modifier.align(Alignment.TopEnd)) { menu() }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(top = 4.dp),
        ) {
            Button(
                onClick = onHome,
                colors = secondary,
                border = hairline,
                contentPadding = PaddingValues(0.dp),
                shape = RoundedCornerShape(9.dp),
                modifier = Modifier
                    .size(Mk8dxSpacing.targetMin)
                    .testTag("$tagPrefix-home")
                    // An emoji is not an accessible name: say what the button does.
                    .semantics { contentDescription = homeDescription },
            ) { Text("🏠", fontSize = 14.sp) }
            Button(
                onClick = onBack,
                colors = secondary,
                border = hairline,
                contentPadding = PaddingValues(horizontal = 10.dp),
                shape = RoundedCornerShape(9.dp),
                modifier = Modifier.height(Mk8dxSpacing.targetMin).testTag("$tagPrefix-back"),
            ) {
                Text(
                    backLabel,
                    style = Mk8dxDesignTheme.type.label.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold),
                )
            }
            Button(
                enabled = false,
                onClick = {},
                colors = ButtonDefaults.buttonColors(
                    disabledContainerColor = colors.surfaceControl,
                    disabledContentColor = colors.textSecondary,
                ),
                border = hairline,
                contentPadding = PaddingValues(0.dp),
                shape = RoundedCornerShape(9.dp),
                modifier = Modifier
                    .size(Mk8dxSpacing.targetMin)
                    .testTag("$tagPrefix-save")
                    // §9: never disabled without a reason. The reason is the
                    // status beside it, and TalkBack now hears it too.
                    .semantics {
                        contentDescription = saveDescription
                        stateDescription = savedState
                    },
            ) { Text("💾", fontSize = 14.sp) }
            Surface(
                color = Mk8dxDesignTheme.tint(colors, colors.statusSuccess),
                shape = RoundedCornerShape(9.dp),
                border = BorderStroke(1.dp, colors.statusSuccess),
                modifier = Modifier.height(Mk8dxSpacing.targetMin).testTag("$tagPrefix-status"),
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 10.dp)) {
                    Text(
                        androidText("✓ Saved", "✓ Opgeslagen"),
                        color = colors.statusSuccess,
                        style = Mk8dxDesignTheme.type.micro.copy(fontSize = 12.sp, fontWeight = FontWeight.Bold),
                    )
                }
            }
        }
        Box(Modifier.padding(top = 6.dp)) { StepPhaseMarker(phaseLabel, "$tagPrefix-phase") }
    }
}

/**
 * The source's admin menu, kept on every ported step so the operator does not
 * lose refresh, leave and delete when a step replaces the old workbench.
 */
@Composable
internal fun TournamentStepMenu(
    tagPrefix: String,
    onRefresh: () -> Unit,
    onLeave: () -> Unit,
    onDelete: (() -> Unit)? = null,
) {
    var expanded by remember { mutableStateOf(false) }
    val colors = Mk8dxDesignTheme.colors
    val menuDescription = androidText("Tournament menu", "Toernooimenu")
    Button(
        onClick = { expanded = true },
        colors = ButtonDefaults.buttonColors(
            containerColor = colors.surfaceControl,
            contentColor = colors.textPrimary,
        ),
        border = BorderStroke(1.dp, colors.borderStrong),
        contentPadding = PaddingValues(0.dp),
        shape = RoundedCornerShape(9.dp),
        modifier = Modifier
            .size(Mk8dxSpacing.targetMin)
            .testTag("$tagPrefix-menu")
            .semantics { contentDescription = menuDescription },
    ) { Text("☰", fontSize = 20.sp) }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
        DropdownMenuItem(
            text = { Text(androidText("Refresh", "Vernieuwen")) },
            onClick = { expanded = false; onRefresh() },
            modifier = Modifier.testTag("$tagPrefix-refresh"),
        )
        DropdownMenuItem(
            text = { Text(androidText("Leave tournament", "Verlaat toernooi")) },
            onClick = { expanded = false; onLeave() },
            modifier = Modifier.testTag("$tagPrefix-leave"),
        )
        if (onDelete != null) {
            DropdownMenuItem(
                text = { Text(androidText("Remove tournament", "Verwijder toernooi")) },
                onClick = { expanded = false; onDelete() },
                modifier = Modifier.testTag("$tagPrefix-delete"),
            )
        }
    }
}

/**
 * The source Manager guards every backward step with its own `window.confirm`,
 * naming exactly what is undone (`assets/app.js`, the `Terug naar Stap N?`
 * prompts). The canonical server already performs that invalidation on
 * rollback - dropping the qualifier and final groups from step 3, reopening a
 * locked layout from step 4 and 8, dropping the final groups from step 7 - so
 * the phone owes the operator the same warning before it happens.
 *
 * Earlier-step data is deliberately preserved: rolling back to step 2 removes
 * the groups, never the roster, its attendance or its Nintendo Switch owners.
 */
internal fun rollbackConfirmationMessage(targetStep: Int, language: AndroidProductLanguage): String = when (targetStep) {
    2 -> androidText(
        language,
        "Return to Step 2? Qualifier groups and all later data will be removed. " +
            "The participant list, attendance and Switch owners remain.",
        "Terug naar Stap 2? Kwalificatiegroepen en alle vervolgdata worden " +
            "verwijderd. De deelnemerslijst, aanwezigheid en Switch-eigenaren blijven staan.",
    )
    3 -> androidText(language, "Return to Step 3? The qualifier layout will reopen.", "Terug naar Stap 3? De kwalificatie-indeling wordt heropend.")
    4 -> androidText(language, "Return to Step 4? You can review the qualifier export again.", "Terug naar Stap 4? Je kunt de kwalificatie-export opnieuw controleren.")
    5 -> androidText(language, "Return to Step 5? You can adjust the qualifier scores again.", "Terug naar Stap 5? Je kunt de kwalificatiescores opnieuw aanpassen.")
    6 -> androidText(
        language,
        "Return to Step 6? Final groups and final-group placement will be removed " +
            "so you can adjust qualifier scores and the qualifier result export.",
        "Terug naar Stap 6? Eindgroepen en eindgroepplaatsing worden verwijderd " +
            "zodat je kwalificatiescores en kwalificatie-uitslag export kunt aanpassen.",
    )
    7 -> androidText(language, "Return to Step 7? The final-group layout will reopen.", "Terug naar Stap 7? De eindgroep-indeling wordt heropend.")
    8 -> androidText(language, "Return to Step 8? Review the final-group layout export checkpoint first.", "Terug naar Stap 8? Controleer eerst de export-checkpoint van de eindgroep-indeling.")
    9 -> androidText(language, "Return to Step 9? You can adjust the final scores again.", "Terug naar Stap 9? Je kunt de eindgroepscores opnieuw aanpassen.")
    else -> androidText(
        language,
        "Are you sure you want to return to Step $targetStep? Later step data will be rolled back.",
        "Weet je zeker dat je terug wilt naar Stap $targetStep? Latere stapdata wordt teruggedraaid.",
    )
}

/** True when the canonical rollback from `currentStep` destroys generated data. */
internal fun rollbackDiscardsData(currentStep: Int): Boolean =
    currentStep == 3 || currentStep == 7

@Composable
internal fun TournamentRollbackDialog(
    targetStep: Int,
    currentStep: Int,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val destructive = rollbackDiscardsData(currentStep)
    val language = LocalAndroidProductLanguage.current
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = PanelBackground,
        titleContentColor = TextMain,
        textContentColor = TextSoft,
        title = {
            Text(
                androidText("Back to Step $targetStep", "Terug naar Stap $targetStep"),
                fontSize = 16.sp,
                fontWeight = FontWeight.Black,
                modifier = Modifier.testTag("tournament-rollback-title"),
            )
        },
        text = {
            Text(
                rollbackConfirmationMessage(targetStep, language),
                fontSize = 13.sp,
                lineHeight = 18.sp,
                modifier = Modifier.testTag("tournament-rollback-message"),
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.testTag("tournament-rollback-confirm")) {
                Text(
                    if (destructive) androidText("Yes, roll back", "Ja, terugdraaien") else androidText("Yes, go back", "Ja, terug"),
                    color = if (destructive) DangerRed else SuccessGreen,
                    fontWeight = FontWeight.Black,
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("tournament-rollback-cancel")) {
                Text(androidText("Cancel", "Annuleren"), color = TextSoft)
            }
        },
        modifier = Modifier.testTag("tournament-rollback-dialog"),
    )
}

/**
 * Removing a Tournament hides it rather than destroying it (owner decision
 * 2026-08-28), so the operator is told exactly that: it leaves the lists, the
 * standings and TrueSkill, and an administrator can bring it back. The source
 * Manager really deleted; this deliberately does not, and saying so is what
 * makes the button safe to press.
 */
@Composable
internal fun TournamentRemoveDialog(
    tournamentName: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = PanelBackground,
        titleContentColor = TextMain,
        textContentColor = TextSoft,
        title = {
            Text(
                androidText("Remove $tournamentName", "$tournamentName verwijderen"),
                fontSize = 16.sp,
                fontWeight = FontWeight.Black,
                modifier = Modifier.testTag("tournament-remove-title"),
            )
        },
        text = {
            Text(
                androidText(
                    "The tournament disappears from every list, from the standings and from " +
                        "TrueSkill. It is not destroyed: an administrator can restore it " +
                        "and choose whether it counts again for the standings and " +
                        "for TrueSkill.",
                    "Het toernooi verdwijnt uit alle lijsten, uit de uitslagen en uit " +
                        "TrueSkill. Het wordt niet vernietigd: een beheerder kan het " +
                        "terugzetten en daarbij kiezen of het weer meetelt voor de " +
                        "uitslagen en voor TrueSkill.",
                ),
                fontSize = 13.sp,
                lineHeight = 18.sp,
                modifier = Modifier.testTag("tournament-remove-message"),
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.testTag("tournament-remove-confirm")) {
                Text(androidText("Yes, remove", "Ja, verwijderen"), color = DangerRed, fontWeight = FontWeight.Black)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("tournament-remove-cancel")) {
                Text(androidText("Cancel", "Annuleren"), color = TextSoft)
            }
        },
        modifier = Modifier.testTag("tournament-remove-dialog"),
    )
}
