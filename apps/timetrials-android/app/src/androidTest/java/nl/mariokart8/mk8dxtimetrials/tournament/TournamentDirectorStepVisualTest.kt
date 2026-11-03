package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.printToString
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.URL
import java.security.cert.Certificate
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.HttpsURLConnection
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TournamentDirectorStepVisualTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun initialStateProducesVisualAndSemanticsArtifacts() {
        setStep0Content()

        compose.onNodeWithText("MK8DX LAN Toernooibord").assertIsDisplayed()
        compose.onNodeWithText("Geen toernooi geladen").assertIsDisplayed()
        compose.onNodeWithText("Stap 0 · Directeur kiezen").assertIsDisplayed()
        compose.onAllNodesWithText("Stap 0: Toernooi Directeur", useUnmergedTree = true).assertCountEquals(2)
        compose.onNodeWithText("Kies de directeur voor wie je werkt").assertIsDisplayed()
        compose.onNodeWithTag("tournament-director-select").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag("tournament-director-continue").assertIsDisplayed().assertIsNotEnabled()
        // ADR-0177 decision 1: the PIN affordance is gone; access is account-bound.
        compose.onAllNodesWithTag("tournament-director-pin").assertCountEquals(0)
        compose.onNodeWithTag("tournament-director-access-note").assertIsDisplayed()
        compose.onNodeWithTag("tournament-director-home").assertIsDisplayed().assertIsEnabled().assertHasClickAction()
        compose.onNodeWithTag("tournament-director-save").assertIsDisplayed().assertIsNotEnabled()
        for (removedElement in listOf("Overview", "People", "Groups", "Standings", "Incoming", "Scores", "Community Cup")) {
            compose.onAllNodesWithText(removedElement).assertCountEquals(0)
        }

        val artifactDirectory = requireNotNull(
            InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("step0-test-artifacts"),
        )
        val semantics = compose.onRoot(useUnmergedTree = true).printToString(maxDepth = 16)
            .replace(Regex("@[0-9a-fA-F]+"), "@<runtime>")
        File(artifactDirectory, "step0-semantics.txt").writeText(semantics)
        assertTrue(semantics.contains("tournament-director-step"))
        assertTrue(semantics.contains("Verder naar Stap 1"))

        FileOutputStream(File(artifactDirectory, "step0.png")).use { output ->
            val compressed = compose.onNodeWithTag("tournament-director-step")
                .captureToImage()
                .asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
            assertTrue(compressed)
        }
    }

    @Test
    fun directorSelectionUnlocksOnlyTheNextStep() {
        val continueClicks = AtomicInteger(0)
        setStep0Content(onContinue = { continueClicks.incrementAndGet() })

        compose.onNodeWithTag("tournament-director-continue").assertIsNotEnabled()
        compose.onNodeWithTag("tournament-director-select").performClick()
        compose.onNodeWithText("Evan", useUnmergedTree = true).assertIsDisplayed()
        // Free text never becomes a director (ADR-0177 decision 3).
        compose.onAllNodesWithText("Nieuwe directeur…", useUnmergedTree = true).assertCountEquals(0)
        compose.onNodeWithText("Ben", useUnmergedTree = true).assertIsDisplayed().performClick()
        compose.onNodeWithText("Actieve directeur: Ben. Stap 1 toont alleen toernooien van deze directeur.").assertIsDisplayed()
        compose.onNodeWithTag("tournament-director-continue").assertIsEnabled().performClick()
        assertEquals(1, continueClicks.get())

        compose.onAllNodesWithText("Stap 2", substring = true).assertCountEquals(0)
    }

    @Test
    fun productionScreenLoadsOnlyStep0UntilBenContinues() {
        val requests = mutableListOf<String>()
        val client = AndroidTournamentClient(
            origin = "https://example.invalid",
            session = AndroidAuthenticatedNativeSession(
                bearerToken = "step0-admin-test-token",
                expiresAtMs = 1_800_000_000_000,
                playerId = "player.ben",
            ),
            opener = AndroidTournamentConnectionOpener { url ->
                synchronized(requests) { requests += url.path }
                val response = when (url.path) {
                    "/v1/native/tournaments" ->
                        """{"schemaVersion":"mk8dx.native-tournaments.v1","tournaments":[{"tournamentId":"tournament.demo","name":"Community Cup","stage":"draft","workflowStep":1,"qualifierRounds":true,"maxParticipants":32,"revision":1,"participantCount":0,"presentCount":0,"publicResults":false,"affectsRating":false,"updatedAtMs":1787420000000}]}"""
                    "/v1/native/tournament-directors" ->
                        """{"schemaVersion":"mk8dx.native-tournament-directors.v1","canActForOthers":true,"directors":[{"userAccountId":"user_account.ben","displayName":"Ben","isAdministrator":true},{"userAccountId":"user_account.evan","displayName":"Evan","isAdministrator":false}]}"""
                    else -> error("Unexpected Step 0 request: ${url.path}")
                }
                Step0FakeConnection(url, response)
            },
        )

        compose.setContent {
            DutchBoardTheme {
                Box { AndroidTournamentConsole(client = client, onSignIn = {}) }
            }
        }
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-director-step").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onAllNodesWithText("Community Cup").assertCountEquals(0)
        compose.onNodeWithTag("tournament-director-select").performClick()
        compose.onNodeWithText("Ben", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("tournament-director-continue").performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("tournament-start-step").fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals(
            // Step 0 no longer probes the Tournament list; it reads the director
            // directory, and only Step 1 lists that director's Tournaments.
            listOf("/v1/native/tournament-directors", "/v1/native/tournaments"),
            synchronized(requests) { requests.toList() },
        )
        assertTrue(synchronized(requests) { requests.none { it.contains("/tournament.demo") } })
    }

    private fun setStep0Content(onContinue: () -> Unit = {}) {
        compose.setContent {
            var selectedDirector by remember { mutableStateOf<String?>(null) }
            DutchBoardTheme {
                Box {
                    TournamentDirectorStep(
                        directors = listOf(
                            AndroidTournamentDirector("user_account.ben", "Ben", isAdministrator = true),
                            AndroidTournamentDirector("user_account.evan", "Evan"),
                        ),
                        canActForOthers = true,
                        selectedDirector = selectedDirector,
                        onDirectorSelected = { selectedDirector = it },
                        onContinue = onContinue,
                        modifier = Modifier,
                    )
                }
            }
        }
    }
}

private class Step0FakeConnection(
    url: URL,
    responseBody: String,
) : HttpsURLConnection(url) {
    private val response = responseBody.toByteArray()

    override fun connect() = Unit
    override fun disconnect() = Unit
    override fun usingProxy(): Boolean = false
    override fun getCipherSuite(): String = "TLS_SYNTHETIC"
    override fun getLocalCertificates(): Array<Certificate>? = null
    override fun getServerCertificates(): Array<Certificate> = emptyArray()
    override fun getResponseCode(): Int = 200
    override fun getInputStream(): InputStream = ByteArrayInputStream(response)
    override fun getOutputStream(): OutputStream = ByteArrayOutputStream()
}
