package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TournamentResultsExportStepVisualTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun step6ShowsTheRenderedQualifierPngInsteadOfFlatText() {
        setContent("qualifier", 6, document())
        compose.onNodeWithTag("tournament-results-export-preview-image").assertIsDisplayed()
    }

    @Test
    fun step10ShowsTheRenderedFinalPngInsteadOfFlatText() {
        setContent("final", 10, document())
        compose.onNodeWithTag("tournament-results-export-preview-image").assertIsDisplayed()
    }

    @Test
    fun step10CanReviewAndDownloadEveryEarlierExportTab() {
        var downloaded: AndroidTournamentExportCheckpoint? = null
        setContent("final", 10, document(), onDownload = { downloaded = it })

        compose.onNodeWithText("Kwalificatie-indeling").performScrollTo().performClick()
        compose.onNodeWithText("Toont: Kwalificatie-indeling").assertIsDisplayed()
        compose.onNodeWithTag("tournament-results-export-download-image")
            .performScrollTo().performClick()

        assert(downloaded?.key == "qualifier-layout")
    }

    private fun document(): AndroidTournamentDocument {
        val base = groupBoardDocument(locked = true)
        return base.copy(groups = base.groups + base.groups.map { group ->
            group.copy(
                groupId = "final.${group.groupId}",
                stage = "final",
                name = "Eindgroep ${group.sequence}",
            )
        })
    }

    private fun setContent(
        stage: String,
        step: Int,
        document: AndroidTournamentDocument,
        onDownload: (AndroidTournamentExportCheckpoint) -> Unit = {},
    ) {
        // The board's source labels are Dutch; the test pins them in the Dutch product language.
        compose.setContent {
            CompositionLocalProvider(LocalAndroidProductLanguage provides AndroidProductLanguage.DUTCH) {
                Mk8dxTheme(Mk8dxAppearance.Dark) {
                    TournamentResultsExportStep(
                        document = document,
                        stage = stage,
                        stepNumber = step,
                        busy = false,
                        error = null,
                        onHome = {},
                        onBack = {},
                        onRefresh = {},
                        onLeave = {},
                        onShare = {},
                        onDownloadImage = onDownload,
                        onContinue = null,
                        modifier = Modifier,
                    )
                }
            }
        }
    }
}
