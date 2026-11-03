package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.runtime.Composable
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/** One source Manager export tab that is available at a workflow checkpoint. */
internal data class AndroidTournamentExportCheckpoint(
    val key: String,
    val label: String,
    val stage: String,
    val mode: AndroidExportMode,
)

/** Keeps every reached source export available, with the active checkpoint last. */
internal fun androidTournamentExportCheckpoints(stepNumber: Int): List<AndroidTournamentExportCheckpoint> {
    val qualifierLayout = AndroidTournamentExportCheckpoint(
        "qualifier-layout", "Kwalificatie-indeling", "qualifier", AndroidExportMode.LAYOUT,
    )
    val qualifierResults = AndroidTournamentExportCheckpoint(
        "qualifier-results", "Kwalificatie-uitslag", "qualifier", AndroidExportMode.RESULTS,
    )
    val finalLayout = AndroidTournamentExportCheckpoint(
        "final-layout", "Eindgroep-indeling", "final", AndroidExportMode.LAYOUT,
    )
    val finalResults = AndroidTournamentExportCheckpoint(
        "final-results", "Eindgroep-uitslag", "final", AndroidExportMode.RESULTS,
    )
    return when (stepNumber) {
        4 -> listOf(qualifierLayout)
        6 -> listOf(qualifierLayout, qualifierResults)
        8 -> listOf(qualifierLayout, qualifierResults, finalLayout)
        10 -> listOf(qualifierLayout, qualifierResults, finalLayout, finalResults)
        else -> emptyList()
    }
}

internal fun androidExportCheckpointShareText(
    document: AndroidTournamentDocument,
    checkpoint: AndroidTournamentExportCheckpoint,
): String = when (checkpoint.mode) {
    AndroidExportMode.LAYOUT -> androidLayoutShareText(document, checkpoint.stage, checkpoint.label)
    AndroidExportMode.RESULTS -> androidResultsShareText(document, checkpoint.stage, checkpoint.label)
}

/**
 * The checkpoint's name on screen, in the product language. [AndroidTournamentExportCheckpoint.label]
 * stays Dutch: it is the title printed inside the exported image and share text.
 */
@Composable
internal fun androidExportCheckpointDisplayLabel(checkpoint: AndroidTournamentExportCheckpoint): String =
    when (checkpoint.key) {
        "qualifier-layout" -> androidText("Qualifier layout", "Kwalificatie-indeling")
        "qualifier-results" -> androidText("Qualifier result", "Kwalificatie-uitslag")
        "final-layout" -> androidText("Final group layout", "Eindgroep-indeling")
        "final-results" -> androidText("Final group results", "Eindgroep-uitslag")
        else -> checkpoint.label
    }
