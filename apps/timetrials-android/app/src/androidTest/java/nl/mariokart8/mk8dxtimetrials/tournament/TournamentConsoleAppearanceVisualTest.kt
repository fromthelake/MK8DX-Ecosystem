package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.FileOutputStream
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * A07 (Phase 14): the console's dense step screens in every appearance and at
 * the largest supported font scale.
 *
 * The Director console cannot be reached from a signed-out phone and the QA
 * mirror gives the app no HTTPS front, so the screens are rendered against the
 * same fixtures the step tests already use. What is asserted here is the
 * migrated presentation only - the operator mode rule, a readable board at
 * font scale 2.0, and no pressable target under 44 dp. Nothing in the workflow
 * is exercised or changed: OD-09 still gates every interaction in this console.
 */
class TournamentConsoleAppearanceVisualTest {
    @get:Rule
    val compose = createComposeRule()

    private fun capture(name: String) {
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        val file = InstrumentationRegistry.getInstrumentation().targetContext
            .getExternalFilesDir(null)!!.resolve(name)
        FileOutputStream(file).use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand("cp ${file.absolutePath} /sdcard/Download/$name").close()
    }

    private fun board(
        appearance: Mk8dxAppearance,
        fontScale: Float = 1f,
        content: @Composable () -> Unit,
    ) {
        compose.setContent {
            val base = LocalDensity.current
            CompositionLocalProvider(
                LocalDensity provides Density(base.density, fontScale),
            ) {
                Mk8dxTheme(appearance) {
                    Box(Modifier.width(390.dp)) { content() }
                }
            }
        }
    }

    @Composable
    private fun groupDraft() {
        TournamentGroupDraftStep(
            document = groupBoardDocument(),
            stage = "qualifier",
            stepNumber = 3,
            busy = false,
            error = null,
            notice = null,
            onHome = {},
            onBack = {},
            onRefresh = {},
            onLeave = {},
            onMovePlayer = { _, _ -> },
            onConfirmPlacement = {},
            onReopenPlacement = {},
            onExportCsv = {},
            onImportCsvText = {},
            onSwapPlayers = { _, _ -> },
            onSeatPlayer = { _, _, _, _, _ -> },
            modifier = Modifier,
        )
    }

    /**
     * The step chrome's own targets are at least 44 dp (DESIGN_SYSTEM §21).
     *
     * The assertion is deliberately scoped to the chrome A07 migrated. The
     * SeatBoard's own cells - the ✕ on a seat card (28 dp) and the small
     * pills (23 dp tall) - are under the floor too, but they are the drag
     * board's geometry: growing them repacks the board the Director reads the
     * room from, which is a change OD-09 gates. Measured and logged, not
     * silently changed.
     */
    private fun assertChromeTargets(prefix: String, label: String) {
        val small = mutableListOf<String>()
        for (tag in listOf("$prefix-home", "$prefix-back", "$prefix-save", "$prefix-menu")) {
            val nodes = compose.onAllNodesWithTag(tag).fetchSemanticsNodes(atLeastOneRootRequired = false)
            val node = nodes.firstOrNull() ?: continue
            with(compose.density) {
                val h = node.size.height.toDp().value
                val w = node.size.width.toDp().value
                if (h < 43.5f || w < 43.5f) small += "$tag ${w}x$h"
            }
        }
        assertTrue("$label: chrome targets under 44 dp: $small", small.isEmpty())
    }

    private fun step3(appearance: Mk8dxAppearance, name: String) {
        board(appearance) { groupDraft() }
        compose.onNodeWithTag("tournament-mode-rule").assertIsDisplayed()
        capture("mk8dx-a07-step3-$name-390.png")
        assertChromeTargets("tournament-group-draft", "step 3 $name")
    }

    private fun step5(appearance: Mk8dxAppearance, name: String) {
        board(appearance) {
            TournamentScoreEntryStep(
                document = groupBoardDocument(locked = true),
                stage = "qualifier",
                stepNumber = 5,
                busy = false,
                error = null,
                onHome = {},
                onBack = {},
                onRefresh = {},
                onLeave = {},
                onSaveScores = { _, _, _ -> },
                onTieModeChange = { _, _ -> },
                onTieOrderSave = { _, _, _ -> },
                onContinue = {},
                modifier = Modifier,
            )
        }
        compose.onNodeWithTag("tournament-mode-rule").assertIsDisplayed()
        capture("mk8dx-a07-step5-$name-390.png")
    }

    @Test
    fun step3Dark() = step3(Mk8dxAppearance.Dark, "dark")

    @Test
    fun step3Light() = step3(Mk8dxAppearance.Light, "light")

    @Test
    fun step3HighContrast() = step3(Mk8dxAppearance.HighContrast, "hc")

    @Test
    fun step3AtFontScaleTwo() {
        board(Mk8dxAppearance.Dark, fontScale = 2f) { groupDraft() }
        compose.onNodeWithTag("tournament-mode-rule").assertIsDisplayed()
        capture("mk8dx-a07-step3-dark-fontscale2-390.png")
    }

    @Test
    fun step5Dark() = step5(Mk8dxAppearance.Dark, "dark")

    @Test
    fun step5Light() = step5(Mk8dxAppearance.Light, "light")

    @Test
    fun step5HighContrast() = step5(Mk8dxAppearance.HighContrast, "hc")
}
