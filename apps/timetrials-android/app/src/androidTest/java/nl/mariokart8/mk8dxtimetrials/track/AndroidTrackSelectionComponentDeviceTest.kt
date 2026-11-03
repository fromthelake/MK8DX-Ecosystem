package nl.mariokart8.mk8dxtimetrials.track

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * The chooser on the design system (Phase 7/9). The catalogue behaviour is the
 * one the legacy grid had — search across both languages and the id, a cup's
 * four tracks, the exact stable entry — and the count is now announced.
 */
class AndroidTrackSelectionComponentDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun searchesAndSelectsOnlyTheExactStableCatalogEntry() {
        val selected = mutableListOf<AndroidTrackCatalogEntry>()
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                AndroidTrackChooser(onTrackSelected = selected::add)
            }
        }

        // Display type is drawn in caps (§3), which is what the heading is.
        compose.onNodeWithTag("track-selection-title").assertTextEquals("CHOOSE A CUP")
        compose.onAllNodesWithTag("cup-selection-0").assertCountEquals(1)
        compose.onNodeWithTag("track-selection-search").performTextInput("baby park")
        compose.onNodeWithTag("track-selection-count").assertTextEquals("1 tracks")
        compose.onAllNodesWithTag("track-selection-row-40").assertCountEquals(1)
        compose.onNodeWithTag("track-selection-row-40").performClick()

        assertEquals(listOf(Schema9AndroidTrackCatalog.find("track.gcn_baby_park")), selected)
    }

    @Test
    fun selectedCupShowsItsIconAndItsFourTracksInOneGrid() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                AndroidTrackChooser(onTrackSelected = {})
            }
        }

        compose.onNodeWithTag("cup-selection-0").performClick()
        compose.onNodeWithContentDescription("Mushroom Cup").fetchSemanticsNode()
        val widths = (0..3).map { index ->
            compose.onNodeWithTag("track-selection-row-$index")
                .fetchSemanticsNode().boundsInRoot.width
        }
        // Two columns of equal width (to the pixel the grid rounds to); the tile
        // grows with its own words rather than being a fixed box that would clip
        // them at font scale 2.0.
        val spread = widths.max() - widths.min()
        check(spread <= 1f) { "The track tiles are not one grid: $widths" }
    }
}
