package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.printToString
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TournamentStartStepVisualTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun sourceStateProducesVisualAndSemanticsArtifacts() {
        setStep1Content(initialName = "TestToernooi", initialEventDate = "2026-08-29", initialStartTime = "19:30")

        compose.onNodeWithText("MK8DX LAN Toernooibord").assertIsDisplayed()
        compose.onNodeWithText("Stap 1 · Toernooi starten").assertIsDisplayed()
        compose.onNodeWithText("Stap 1: Toernooi starten").assertIsDisplayed()
        compose.onNodeWithText("Nieuw toernooi").assertIsDisplayed()
        compose.onNodeWithText("TestToernooi").assertIsDisplayed()
        compose.onNodeWithText("29-08-2026").assertIsDisplayed()
        compose.onNodeWithText("Starttijd (optioneel)").assertIsDisplayed()
        compose.onNodeWithTag("tournament-start-time").assertIsDisplayed()
        compose.onNodeWithText("19:30").assertIsDisplayed()
        compose.onNodeWithTag("tournament-start-create").assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithText("Bestaand toernooi laden").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Supertest2026 · Ben (v7)").assertIsDisplayed()
        compose.onNodeWithTag("tournament-start-load").assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithTag("tournament-start-back").assertHasClickAction()
        for (removedElement in listOf("Overview", "People", "Groups", "Standings", "Incoming", "Scores")) {
            compose.onAllNodesWithText(removedElement).assertCountEquals(0)
        }

        val artifactDirectory = requireNotNull(
            InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("step1-test-artifacts"),
        )
        val semantics = compose.onRoot(useUnmergedTree = true).printToString(maxDepth = 18)
            .replace(Regex("@[0-9a-fA-F]+"), "@<runtime>")
        File(artifactDirectory, "step1-semantics.txt").writeText(semantics)
        assertTrue(semantics.contains("tournament-start-step"))
        assertTrue(semantics.contains("Laad geselecteerd toernooi"))
        FileOutputStream(File(artifactDirectory, "step1.png")).use { output ->
            val compressed = compose.onNodeWithTag("tournament-start-step")
                .captureToImage()
                .asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
            assertTrue(compressed)
        }
    }

    @Test
    fun onlyValidRouteActionsAdvanceFromStep1() {
        val created = AtomicReference<List<String>>()
        val loaded = AtomicReference<String>()
        val backs = AtomicInteger(0)
        setStep1Content(
            onBack = { backs.incrementAndGet() },
            onCreate = { name, date, time -> created.set(listOf(name, date, time)) },
            onLoad = { loaded.set(it.tournamentId) },
        )

        compose.onNodeWithTag("tournament-start-create").assertIsNotEnabled()
        compose.onNodeWithTag("tournament-start-name").performTextInput("Zaterdagtoernooi")
        compose.onNodeWithTag("tournament-start-create").assertIsEnabled().performClick()
        assertEquals("Zaterdagtoernooi", created.get()[0])
        assertTrue(created.get()[1].matches(Regex("\\d{4}-\\d{2}-\\d{2}")))
        assertTrue(created.get()[2].matches(Regex("\\d{2}:\\d{2}")))

        compose.onNodeWithTag("tournament-start-select").performScrollTo().performClick()
        compose.onNodeWithText("Avondcup · Ben (v3)", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("tournament-start-load").performClick()
        assertEquals("tournament.evening", loaded.get())
        compose.onNodeWithTag("tournament-start-back").performClick()
        assertEquals(1, backs.get())
    }

    private fun setStep1Content(
        initialName: String = "",
        initialEventDate: String = "",
        initialStartTime: String = "",
        onBack: () -> Unit = {},
        onCreate: (String, String, String) -> Unit = { _, _, _ -> },
        onLoad: (AndroidTournamentSummary) -> Unit = {},
    ) {
        compose.setContent {
            DutchBoardTheme {
                Box {
                    TournamentStartStep(
                        tournaments = listOf(
                            summary("tournament.supertest2026", "Supertest2026", 7),
                            summary("tournament.evening", "Avondcup", 3),
                        ),
                        busy = false,
                        error = null,
                        directorDisplayName = "Ben",
                        onBackToDirector = onBack,
                        onRefresh = {},
                        onSelectTournament = onLoad,
                        onCreateTournament = onCreate,
                        modifier = Modifier,
                        initialName = initialName,
                        initialEventDate = initialEventDate,
                        initialStartTime = initialStartTime,
                    )
                }
            }
        }
    }

    private fun summary(id: String, name: String, revision: Int) = AndroidTournamentSummary(
        tournamentId = id,
        name = name,
        stage = "draft",
        workflowStep = 1,
        revision = revision,
        participantCount = 0,
        presentCount = 0,
        publicResults = false,
        affectsRating = false,
        updatedAtMs = 1_787_795_200_000,
    )
}
