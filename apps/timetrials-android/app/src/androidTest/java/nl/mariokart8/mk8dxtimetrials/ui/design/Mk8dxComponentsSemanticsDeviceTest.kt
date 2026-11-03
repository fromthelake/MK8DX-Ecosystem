package nl.mariokart8.mk8dxtimetrials.ui.design

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * What TalkBack is told by the CP1 components (DESIGN_SYSTEM §9, §7, §13):
 * the EngineSelector's options are radio buttons with a selected state, a
 * disabled button carries its reason, and the TimeInput states its time.
 */
@RunWith(AndroidJUnit4::class)
class Mk8dxComponentsSemanticsDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private fun hasRole(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)
    private fun hasState(text: String) = SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, text)

    @Test
    fun engineSelectorAnnouncesRadioButtonsAndTheSelectedEngine() {
        var chosen = 0
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                var engine by remember { mutableStateOf(150) }
                Mk8dxEngineSelector("Engine class", engine, { engine = it; chosen = it })
            }
        }
        val option150 = compose.onNode(hasText("150cc").and(hasRole(Role.RadioButton)), useUnmergedTree = false)
        val option200 = compose.onNode(hasText("200cc").and(hasRole(Role.RadioButton)), useUnmergedTree = false)
        option150.assertIsSelected()
        option200.assertIsNotSelected().performClick()
        option200.assertIsSelected()
        option150.assertIsNotSelected()
        assertEquals(200, chosen)
    }

    @Test
    fun disabledButtonIsDisabledAndCarriesItsReason() {
        var pressed = false
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Light) {
                Mk8dxButton(
                    "Publish", { pressed = true }, variant = Mk8dxButtonVariant.Primary,
                    disabledReason = "Publish · enter a total time first",
                )
            }
        }
        compose.onNode(hasText("Publish").and(hasRole(Role.Button)))
            .assertIsNotEnabled()
            .assert(hasState("Publish · enter a total time first"))
            .performClick()
        assertEquals(false, pressed)
    }

    @Test
    fun armedButtonNeedsTwoPressesAndAnnouncesTheNextStep() {
        var confirmed = 0
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.HighContrast) {
                Mk8dxArmedButton("Publish", "Press again to publish", "Publishes 1:45.912 at 150cc", { confirmed += 1 })
            }
        }
        compose.onNodeWithText("Publish").performClick()
        compose.onNode(hasText("Press again to publish").and(hasRole(Role.Button)))
            .assert(hasState("Publishes 1:45.912 at 150cc"))
            .performClick()
        assertEquals(1, confirmed)
    }

    /**
     * Phase 12 (A08, A12): a button whose reason is already written beside it
     * still carries the reason for TalkBack, and still prints nothing extra.
     */
    @Test
    fun disabledButtonCanKeepItsReasonWithoutPrintingItTwice() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Mk8dxButton(
                    "Sync now", {}, variant = Mk8dxButtonVariant.Primary,
                    disabledReason = "Result synchronized",
                    disabledReasonShown = false,
                )
            }
        }
        compose.onNode(hasText("Sync now").and(hasRole(Role.Button)))
            .assertIsNotEnabled()
            .assert(hasState("Result synchronized"))
        compose.onAllNodesWithText("Result synchronized").assertCountEquals(0)
    }

    /** A12: one preference, one 44 dp row, a switch that says on or off. */
    @Test
    fun toggleRowAnnouncesSwitchRoleAndItsState() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                var checked by remember { mutableStateOf(false) }
                Mk8dxToggleRow("Someone passes me", checked, { checked = it })
            }
        }
        val row = compose.onNode(hasText("Someone passes me").and(hasRole(Role.Switch)))
        row.assertIsOff().assertHeightIsAtLeast(44.dp).performClick()
        row.assertIsOn()
    }

    /** A12: the field is reachable by its label, and it takes what is typed. */
    @Test
    fun textFieldCarriesItsLabelAndAcceptsInput() {
        var value = ""
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Light) {
                var text by remember { mutableStateOf("") }
                Mk8dxTextField("Screen name", text, { text = it; value = it })
            }
        }
        compose.onNode(
            SemanticsMatcher.expectValue(SemanticsProperties.ContentDescription, listOf("Screen name")),
        ).performTextInput("Ben")
        compose.waitForIdle()
        assertEquals("Ben", value)
    }

    /** A12: a value that opens a picker is a button, at a full touch target. */
    @Test
    fun selectFieldIsAButtonAtTheTouchTargetFloor() {
        var opened = 0
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Mk8dxSelectField("Country", "Netherlands", { opened += 1 })
            }
        }
        compose.onNode(hasText("Netherlands").and(hasRole(Role.Button)))
            .assertHeightIsAtLeast(44.dp)
            .performClick()
        assertEquals(1, opened)
    }

    @Test
    fun timeInputStatesItsLabelAndFormattedTime() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Mk8dxTimeInput("Total time", "145912", {})
            }
        }
        compose.onNode(
            SemanticsMatcher.expectValue(SemanticsProperties.ContentDescription, listOf("Total time"))
                .and(hasState("1:45.912")),
        ).assertExists()
    }
}
