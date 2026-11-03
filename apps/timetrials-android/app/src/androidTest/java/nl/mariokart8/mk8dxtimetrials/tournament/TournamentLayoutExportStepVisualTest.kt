package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Step 4 against the source's layout export and `Verplaatsingsaudit Stap 4`. */
@RunWith(AndroidJUnit4::class)
class TournamentLayoutExportStepVisualTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun theExportPanelUsesTheSourceTitleAndStatusLine() {
        setContent()

        compose.onNodeWithText("Stap 4: Kwalificatie-indeling export").assertIsDisplayed()
        compose.onNodeWithTag("tournament-layout-export-shows").assertIsDisplayed()
        compose.onNodeWithText("Toont: Kwalificatie-indeling").assertIsDisplayed()
        compose.onNodeWithTag("tournament-layout-export-preview-image").assertIsDisplayed()
        compose.onNodeWithTag("tournament-layout-export-share").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun step8ShowsTheRenderedFinalPngAndUtpPlan() {
        val base = groupBoardDocument()
        val document = base.copy(groups = base.groups + base.groups.map { group ->
            group.copy(groupId = "final.${group.groupId}", stage = "final")
        })
        setContent(document = document, stage = "final", stepNumber = 8)

        compose.onNodeWithTag("tournament-layout-export-preview-image").assertIsDisplayed()
        compose.onNodeWithTag("tournament-layout-export-step")
            .performScrollToNode(hasTestTag("tournament-layout-utp-plan"))
        compose.onNodeWithTag("tournament-layout-utp-plan").assertIsDisplayed()
    }

    @Test
    fun theAuditNamesEveryPlayerWhoIsNotOnTheirOwnConsole() {
        setContent(document = offOwnConsoleDocument())

        compose.onNodeWithTag("tournament-layout-export-step")
            .performScrollToNode(hasTestTag("tournament-layout-export-audit"))
        // Swapping two console owners moves both of them off their own Switch.
        compose.onNodeWithText("Niet op eigen Nintendo Switch: 2 · Score: 2").assertIsDisplayed()
        compose.onNodeWithText(
            "Gideon zit in Groep 1 op UTP 1 · NS2 Moss HM. NS1 Gideon afgestaan aan Groep 1.",
        ).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(
            "Moss HM zit in Groep 1 op UTP 2 · NS1 Gideon. NS2 Moss HM afgestaan aan Groep 1.",
        ).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun anUnmovedLayoutReportsTheSourceAllClearLine() {
        setContent()

        compose.onNodeWithTag("tournament-layout-export-step")
            .performScrollToNode(hasTestTag("tournament-layout-export-audit"))
        compose.onNodeWithText("Niet op eigen Nintendo Switch: 0 · Score: 0").assertIsDisplayed()
        compose.onNodeWithText("Iedereen met eigen Nintendo Switch zit op een eigen station.")
            .assertIsDisplayed()
    }

    @Test
    fun theContinueActionCarriesTheSourceLabelAndHint() {
        var advanced = 0
        setContent(onContinue = { advanced += 1 })

        compose.onNodeWithTag("tournament-layout-export-step")
            .performScrollToNode(hasTestTag("tournament-layout-export-continue"))
        compose.onNodeWithText("Ga door naar Stap 5: Kwalificatiescores").assertIsDisplayed()
        compose.onNodeWithText(
            "Export gecontroleerd? Ga nu door met het invullen van kwalificatiescores.",
        ).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("tournament-layout-export-continue").performClick()

        assertEquals(1, advanced)
    }

    @Test
    fun theSharedTextListsEveryConsoleAndItsSeats() {
        val text = androidLayoutShareText(groupBoardDocument(), "qualifier", "Kwalificatie-indeling")

        assertTrue(text.startsWith("Kwalificatiegroep 1"))
        assertTrue(text.contains("— [NS1] Nintendo Switch van Gideon: #1 Gideon & #2 Ewald"))
        assertTrue(text.contains("— [NS2] Nintendo Switch van Moss HM: #1 Moss HM & #2 Nieuwkomer"))
    }

    private fun setContent(
        document: AndroidTournamentDocument = groupBoardDocument(),
        stage: String = "qualifier",
        stepNumber: Int = 4,
        onContinue: () -> Unit = {},
    ) {
        // The board's source labels are Dutch; the test pins them in the Dutch product language.
        compose.setContent {
            CompositionLocalProvider(LocalAndroidProductLanguage provides AndroidProductLanguage.DUTCH) {
                Mk8dxTheme(Mk8dxAppearance.Dark) {
                    TournamentLayoutExportStep(
                        document = document,
                        stage = stage,
                        stepNumber = stepNumber,
                        busy = false,
                        error = null,
                        onHome = {},
                        onBack = {},
                        onRefresh = {},
                        onLeave = {},
                        onShare = {},
                        onContinue = onContinue,
                        modifier = Modifier,
                    )
                }
            }
        }
    }
}

/** Gideon owns NS1 but sits on Moss HM's NS2, which the audit must report. */
private fun offOwnConsoleDocument(): AndroidTournamentDocument {
    val base = groupBoardDocument()
    val group = base.groups.first()
    val swapped = group.copy(
        members = group.members.map { member ->
            when (member.playerId) {
                "player.one" -> member.copy(
                    station = AndroidTournamentMemberStation(
                        ownerPlayerId = "player.three", ownerDisplayName = "Moss HM",
                        switchType = "ns2", seatNumber = 1, utpCableNumber = null,
                    ),
                )
                "player.three" -> member.copy(
                    station = AndroidTournamentMemberStation(
                        ownerPlayerId = "player.one", ownerDisplayName = "Gideon",
                        switchType = "ns1", seatNumber = 1, utpCableNumber = null,
                    ),
                )
                else -> member
            }
        },
    )
    return base.copy(groups = listOf(swapped) + base.groups.drop(1))
}
