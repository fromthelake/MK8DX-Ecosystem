package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * Steps 6 and 10 of the source Manager: `Kwalificatie-uitslag export` and
 * `Eindgroep-uitslag export`.
 *
 * Both show the standings for their stage, share them, and offer the step's
 * own next action. The phone renders the same stage-specific PNG as the source
 * and keeps the standings text as an accessible copyable fallback.
 */

/** The standings the source draws into its shareable results image. */
// The chat export is the original Manager's, character for character; see
// AndroidTournamentWhatsAppExport.kt.
internal fun androidResultsShareText(
    document: AndroidTournamentDocument,
    stage: String,
    @Suppress("UNUSED_PARAMETER") title: String,
): String = androidTournamentWhatsAppText(document, stage, AndroidWhatsAppExportMode.RESULTS)

@Composable
internal fun TournamentResultsExportStep(
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
    // The source hands the workbook back at Step 6 and Step 10 ("Download Excel
    // stap 6" / "stap 10"). Here it is generated from the races the platform
    // holds, so a night entered by hand exports just as well as an imported one.
    onExportWorkbook: (() -> Unit)? = null,
    onExportQualifierWorkbook: (() -> Unit)? = null,
    onContinue: (() -> Unit)?,
    // Step 10 also owns finalization in this ecosystem; the source Manager
    // only exports, so finalization arrives as a slot.
    finalizeContent: (androidx.compose.foundation.lazy.LazyListScope.() -> Unit)? = null,
    modifier: Modifier,
) {
    val qualifier = stage != "final"
    val exportTitle = if (qualifier) {
        androidText("Qualifier result", "Kwalificatie-uitslag")
    } else {
        androidText("Final group results", "Eindgroep-uitslag")
    }
    val phaseLabel = if (qualifier) {
        androidText("Step 6 · Export results", "Stap 6 · Uitslag exporteren")
    } else {
        androidText("Step 10 · Share results", "Stap 10 · Uitslag delen")
    }
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
            .testTag("tournament-results-export-step"),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 5.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            TournamentStepHeader(
                backLabel = androidText("Back to Step ${stepNumber - 1}", "Terug naar Stap ${stepNumber - 1}"),
                phaseLabel = phaseLabel,
                tagPrefix = "tournament-results-export",
                onHome = onHome,
                onBack = onBack,
                menu = {
                    TournamentStepMenu(
                        tagPrefix = "tournament-results-export",
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
                    modifier = Modifier.fillMaxWidth().testTag("tournament-results-export-error"),
                ) {
                    Text(message, color = DangerRed, fontSize = 13.sp, modifier = Modifier.padding(10.dp))
                }
            }
        }

        item {
            Surface(
                color = PanelBackground,
                shape = RoundedCornerShape(10.dp),
                border = BorderStroke(1.dp, PanelBorder),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(11.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        androidText("Step $stepNumber: $exportTitle export", "Stap $stepNumber: $exportTitle export"),
                        fontSize = 14.sp,
                        lineHeight = 18.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Text(
                        androidText("Showing: ${androidExportCheckpointDisplayLabel(selectedCheckpoint)}", "Toont: ${androidExportCheckpointDisplayLabel(selectedCheckpoint)}"),
                        color = TextSoft,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        modifier = Modifier.testTag("tournament-results-export-shows"),
                    )
                    StepChoiceRow(
                        options = checkpoints.map { it.key to androidExportCheckpointDisplayLabel(it) },
                        selected = selectedCheckpoint.key,
                        enabled = !busy,
                        testTag = "tournament-results-export-tabs",
                        onSelect = { selectedKey = it },
                    )
                    Surface(
                        color = BoardBackground,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, BoardBorder),
                        modifier = Modifier.fillMaxWidth().testTag("tournament-results-export-preview"),
                    ) {
                        AndroidTournamentExportPreview(
                            document = document,
                            stage = selectedCheckpoint.stage,
                            mode = selectedCheckpoint.mode,
                            testTag = "tournament-results-export-preview-image",
                            modifier = Modifier.padding(10.dp),
                        )
                    }
                    SecondaryButton(
                        label = androidText("📲 Share image in WhatsApp", "📲 Deel afbeelding in WhatsApp"),
                        onClick = { onShareImage?.invoke(selectedCheckpoint) },
                        testTag = "tournament-results-export-share-image",
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !busy && onShareImage != null,
                    )
                    SecondaryButton(
                        label = "Download PNG",
                        onClick = { onDownloadImage?.invoke(selectedCheckpoint) },
                        testTag = "tournament-results-export-download-image",
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !busy && onDownloadImage != null,
                    )
                    SecondaryButton(
                        label = androidText("Share as text", "Deel als tekst"),
                        onClick = { onShare(shareText) },
                        testTag = "tournament-results-export-share",
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !busy,
                    )
                    onExportWorkbook?.let { export ->
                        SecondaryButton(
                            label = androidText("Download Excel Step $stepNumber", "Download Excel stap $stepNumber"),
                            onClick = export,
                            testTag = "tournament-results-export-workbook",
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !busy,
                        )
                    }
                    onExportQualifierWorkbook?.let { export ->
                        SecondaryButton(
                            label = androidText("Download Excel Step 6", "Download Excel stap 6"),
                            onClick = export,
                            testTag = "tournament-results-export-qualifier-workbook",
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !busy,
                        )
                    }
                }
            }
        }

        finalizeContent?.invoke(this)

        if (onContinue != null) {
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
                            .testTag("tournament-results-export-continue"),
                    ) {
                        Text(
                            androidText("Continue to Step 7: Create final groups", "Ga door naar Stap 7: Maak eindgroepen"),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Black,
                        )
                    }
                    Text(
                        androidText("Results checked? Create the final groups now.", "Uitslag gecontroleerd? Maak nu de eindgroepen."),
                        color = TextSoft,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                }
            }
        }
    }
}
