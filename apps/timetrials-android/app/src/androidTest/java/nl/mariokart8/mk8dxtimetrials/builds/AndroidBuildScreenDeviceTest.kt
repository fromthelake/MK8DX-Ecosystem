package nl.mariokart8.mk8dxtimetrials.builds

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Build (A05) on the design system: the four slots open the picker, the picker
 * filters and chooses, and the stats follow the choice. The catalogue is
 * bundled, so this needs neither a network nor a signed-in Player.
 */
@RunWith(AndroidJUnit4::class)
class AndroidBuildScreenDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun theSlotsOpenThePickerAndTheChoiceReachesTheStats() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                AndroidBuildScreen(requestedPartIds = listOf("character.mario"))
            }
        }

        compose.onNodeWithTag("build-screen").assertIsDisplayed()
        compose.onNodeWithTag("build-stats").assertIsDisplayed()
        compose.onNodeWithText("Mario").assertIsDisplayed()

        compose.onNodeWithTag("build-part-character").performClick()
        // The field itself, by the label it announces, not the box around it.
        compose.onNodeWithContentDescription("Search character").performTextInput("Toadette")
        compose.waitForIdle()
        // The tile, not the text now standing in the search field: a tile is a
        // selectable option, which is what the picker offers.
        compose.onNode(
            hasText("Toadette").and(
                SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton),
            ),
        ).performClick()
        compose.waitForIdle()

        // The picker closed on the choice, and the slot now names the part.
        compose.onNodeWithTag("build-part-character").assertIsDisplayed()
        compose.onNodeWithText("Toadette").assertIsDisplayed()
        // Both figures are named twice on the page - once as the stat block and
        // once as a row of the meter - so the first of each is the block.
        compose.onAllNodesWithText("Speed")[0].assertIsDisplayed()
        compose.onAllNodesWithText("Mini-Turbo")[0].assertIsDisplayed()
    }

    @Test
    fun everySlotAndTheShareActionMeetTheTouchTargetFloor() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Light) {
                AndroidBuildScreen()
            }
        }

        for (slot in listOf("character", "body", "tire", "glider")) {
            compose.onNodeWithTag("build-part-$slot").assertHeightIsAtLeast(44.dp)
        }
        compose.onNodeWithTag("build-share").performScrollTo().assertHeightIsAtLeast(44.dp)
    }
}
