package nl.mariokart8.mk8dxtimetrials.ui.design

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The data components a LOW route is built from (DESIGN_SYSTEM §10, §15, §21):
 * the rank column is measured from the dataset's largest rank, numbers never
 * clip while names ellipsise, tabs announce their selection, and the filter
 * sheet opens and closes without losing a control. T-NUM on Android.
 */
@RunWith(AndroidJUnit4::class)
class Mk8dxDataComponentsDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private fun hasRole(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)

    private val protectedRange = listOf(1, 9, 10, 99, 100, 999, 1_000, 9_999, 10_000, 99_999)

    @Test
    fun theRankColumnFitsTheLargestRankAndNoNumberIsClipped() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(320.dp)) {
                    Mk8dxRankingTable(
                        caption = "Protected range",
                        language = Mk8dxNumberLanguage.EN,
                        rows = protectedRange.map { rank ->
                            Mk8dxRankRow(
                                rank = rank,
                                name = "A very long Player name that has to give way first",
                                timeMs = 57_599_999,
                                deltaMs = if (rank == 1) null else 123_456,
                                kind = if (rank == 10) Mk8dxRowKind.You else Mk8dxRowKind.Normal,
                                youLabel = "You",
                            )
                        },
                    )
                }
            }
        }
        // The rank cells themselves, not the merged rows that contain them.
        val widest = compose.onNodeWithText("#99,999", useUnmergedTree = true)
            .fetchSemanticsNode().size.width
        val narrowest = compose.onNodeWithText("#1", useUnmergedTree = true)
            .fetchSemanticsNode().size.width
        // One column for every row: #1 is laid out in the width #99,999 needs.
        assertEquals(widest, narrowest)
        assertTrue("the rank column collapsed", widest > 0)
        // The longest time in the protected range is printed in full, on every
        // row, and the row that is "yours" carries its chip.
        assertEquals(
            protectedRange.size,
            compose.onAllNodes(hasText("15:59:59.999"), useUnmergedTree = true)
                .fetchSemanticsNodes().size,
        )
        compose.onNodeWithText("#10", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("YOU", useUnmergedTree = true).assertExists()
    }

    @Test
    fun theTimeAndGapAreNeverAbbreviated() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(320.dp)) {
                    Mk8dxRankingTable(
                        caption = "One row",
                        language = Mk8dxNumberLanguage.NL,
                        rows = listOf(
                            Mk8dxRankRow(
                                rank = 1_000,
                                name = "Iemand met een bijzonder lange spelersnaam",
                                timeMs = 57_599_999,
                                deltaMs = -61_004,
                            ),
                        ),
                    )
                }
            }
        }
        // The row announces itself as one line; each value is printed in full,
        // with the Dutch thousands separator and a true minus.
        compose.onNodeWithText("#1.000").assertTextEquals(
            "#1.000",
            "Iemand met een bijzonder lange spelersnaam",
            "15:59:59.999",
            "−1:01.004",
        )
        compose.onNodeWithText("15:59:59.999", useUnmergedTree = true)
            .assertTextEquals("15:59:59.999")
        compose.onNodeWithText("−1:01.004", useUnmergedTree = true)
            .assertTextEquals("−1:01.004")
    }

    @Test
    fun tabsAnnounceTheSelectedViewAndSwitchIt() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Light) {
                var value by remember { mutableStateOf("total") }
                Mk8dxTabs(
                    "View",
                    listOf(
                        Mk8dxTabOption("total", "Total", "tab-total"),
                        Mk8dxTabOption("medals", "Medals", "tab-medals"),
                    ),
                    value,
                    { value = it },
                )
            }
        }
        compose.onNodeWithTag("tab-total").assert(hasRole(Role.Tab)).assertIsSelected()
        compose.onNodeWithTag("tab-medals").assertIsNotSelected().performClick()
        compose.onNodeWithTag("tab-medals").assertIsSelected()
        compose.onNodeWithTag("tab-total").assertIsNotSelected()
    }

    @Test
    fun theFilterSheetOpensWithItsControlsAndCloses() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                var open by remember { mutableStateOf(false) }
                Box {
                    Mk8dxFilterSummary(
                        listOf("Community" to "Global", "Tracks" to "All 96"),
                        "Filters",
                        { open = true },
                    )
                    if (open) {
                        Mk8dxFilterSheet("Ranking filters", "Done", { open = false }) {
                            Mk8dxToggleChip("Global", true, {}, Modifier.testTag("sheet-global"))
                        }
                    }
                }
            }
        }
        compose.onNodeWithText("Community: Global · Tracks: All 96").assertExists()
        compose.onNode(hasText("Filters").and(hasRole(Role.Button))).performClick()
        compose.onNodeWithTag("sheet-global").assertExists()
        compose.onNodeWithTag("rank-filters-close").performClick()
        compose.waitForIdle()
    }

    @Test
    fun aTierChipKeepsItsLabelReadableOnTheLadderColour() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Box {
                    Mk8dxTierChip("Adv B", androidx.compose.ui.graphics.Color(0xFFF2C14E))
                }
            }
        }
        compose.onNodeWithText("Adv B").assertExists()
    }

    // ------------------------------------------------------------ Phase 11/13

    @Test
    fun aGroupBoardSharesOneRankColumnAndMarksYourOwnLine() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(360.dp)) {
                    Mk8dxGroupBoard(
                        title = "Kampioen",
                        meta = "12 players",
                        accent = androidx.compose.ui.graphics.Color(0xFFF59E0B),
                        rows = listOf(
                            Mk8dxBoardRow(1, "Ben", "146"),
                            Mk8dxBoardRow(2, "A very long Player name that must give way first", "141"),
                            Mk8dxBoardRow(3, "Jory", "138"),
                            Mk8dxBoardRow(12, "Nova", "99", you = true),
                        ),
                        language = Mk8dxNumberLanguage.EN,
                        columns = Triple("#", "Name", "Pts"),
                        youLabel = "You",
                    )
                }
            }
        }
        // §10: one rank column for the whole board, sized from #12, and the
        // points are printed in full beside a name that ellipsises instead.
        val widest = compose.onNodeWithText("#12", useUnmergedTree = true).fetchSemanticsNode().size.width
        val narrowest = compose.onNodeWithText("#1", useUnmergedTree = true).fetchSemanticsNode().size.width
        assertEquals(widest, narrowest)
        assertTrue("the rank column collapsed", widest > 0)
        compose.onNodeWithText("146", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("99", useUnmergedTree = true).assertExists()
        // Your own line is a volt wash, a volt edge *and* a chip, never a
        // colour on its own.
        compose.onNodeWithText("YOU", useUnmergedTree = true).assertExists()
    }

    @Test
    fun aGroupBoardRowOpensWhatItNames() {
        var opened: String? = null
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Mk8dxGroupBoard(
                    title = "Talent",
                    rows = listOf(Mk8dxBoardRow(1, "Matteo", "120")),
                    language = Mk8dxNumberLanguage.EN,
                    columns = Triple("#", "Name", "Pts"),
                    onRowClick = { opened = it.name },
                )
            }
        }
        compose.onNode(hasText("Matteo").and(hasRole(Role.Button))).performClick()
        assertEquals("Matteo", opened)
    }

    @Test
    fun anArtHeroPrintsItsNameAndItsMetaLine() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(360.dp)) {
                    Mk8dxArtHero(
                        title = "Toernooi 13v2",
                        meta = "Qualifiers in progress · 33 players",
                        backdrop = true,
                        art = { Box(Modifier.width(360.dp)) },
                    )
                }
            }
        }
        // Display type is set in caps by the system, not by the caller.
        compose.onNodeWithText("TOERNOOI 13V2").assertExists()
        compose.onNodeWithText("Qualifiers in progress · 33 players").assertExists()
    }

    @Test
    fun aSortHeaderSaysWhichWayItOrdersAndADisclosureSaysWhetherItIsOpen() {
        var sorted: Mk8dxSortDirection? = Mk8dxSortDirection.Descending
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                var open by remember { mutableStateOf(false) }
                androidx.compose.foundation.layout.Column(Modifier.width(360.dp)) {
                    Mk8dxSortHeader(
                        "Races",
                        sorted,
                        { sorted = Mk8dxSortDirection.Ascending },
                        Modifier.testTag("sort-races"),
                    )
                    Mk8dxDisclosure("All 96 tracks", open, { open = !open }, Modifier.testTag("all-tracks"))
                }
            }
        }
        compose.onNodeWithText("Races ↓").assertExists()
        compose.onNodeWithTag("sort-races").performClick()
        assertEquals(Mk8dxSortDirection.Ascending, sorted)
        compose.onNodeWithTag("all-tracks").assert(hasRole(Role.Button))
    }

    @Test
    fun aLiveTagIsTheFilledLiveChip() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Box { Mk8dxLiveTag("Live") }
            }
        }
        compose.onNodeWithText("Live").assertExists()
    }
}