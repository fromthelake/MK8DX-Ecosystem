package nl.mariokart8.mk8dxtimetrials.track

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidHomeBootstrap
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidPublicTimeTrialResult
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * A02's first half on a device: the track chooser, and a track in context with
 * one engine class, one board and exactly one A4 — the action that opens the
 * canonical Post-a-Time task on that track and that class.
 */
class AndroidTrackScreenDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private val source = object : AndroidTimeTrialsEcosystemDataSource {
        override fun home() = AndroidHomeBootstrap("mk8dx.home-bootstrap.v1", false)
        override fun leaderboard(trackId: String, mode: Int) = listOf(
            AndroidPublicTimeTrialResult(
                "result.1", "player.rival", "rival", "Rival", trackId, mode,
                if (mode == 200) 81_500 else 91_500, 1,
                countryId = "country.de",
                sourceKind = "android_scan",
            ),
        )
    }

    @Test
    fun theChooserLeadsToATrackWithOneEngineAndOneAction() {
        var posted: Pair<String, Int>? = null
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                var trackId by remember { mutableStateOf<String?>(null) }
                var mode by remember { mutableStateOf<Int?>(150) }
                AndroidTrackScreen(
                    trackId = trackId,
                    mode = mode,
                    ecosystemClient = source,
                    signedInPlayerId = null,
                    onTrackChosen = { trackId = it },
                    onChangeTrack = { trackId = null },
                    onModeChanged = { mode = it },
                    onPostTime = { track, chosen -> posted = track to chosen },
                )
            }
        }

        // The chooser: 24 cups, then the cup's tracks, and a search that counts.
        compose.onNodeWithTag("track-selection-title").assertIsDisplayed()
        compose.onNodeWithTag("track-selection-search").performTextInput("Baby Park")
        compose.onNodeWithTag("track-selection-count").assertTextEquals("1 tracks")
        compose.onNodeWithTag("track-selection-search").performTextClearance()
        compose.onNodeWithTag("cup-selection-0").performClick()
        compose.onNodeWithTag("track-selection-row-0").performClick()

        // The track: one hero, one engine control, one primary action.
        compose.onNodeWithTag("track-screen-hero").assertIsDisplayed()
        compose.onNodeWithTag("track-screen-cup").assertIsDisplayed()
        // Exactly one engine control on the page (§7); the board's EngineMark
        // states the same class without being a second selector.
        assertEquals(1, compose.onAllNodesWithTag("track-screen-engine").fetchSemanticsNodes().size)
        val engineOption = { label: String ->
            compose.onNode(hasText(label) and hasAnyAncestor(hasTestTag("track-screen-engine")))
        }
        engineOption("150cc").assertIsSelected()
        compose.onNodeWithTag("track-screen-post-time").assertIsDisplayed()
        compose.onNodeWithText("Post your time · 150cc").assertIsDisplayed()

        // The class the page holds is the class the task opens on.
        engineOption("200cc").performClick()
        compose.onNodeWithText("Post your time · 200cc").assertIsDisplayed()
        compose.onNodeWithTag("track-screen-post-time").performClick()
        compose.runOnIdle { assertEquals("track.mario_kart_stadium" to 200, posted) }

        // And no entry form lives on this page any more.
        compose.onNodeWithTag("post-time-total").assertDoesNotExist()
        compose.onNodeWithTag("manual-entry-form").assertDoesNotExist()
    }

    @Test
    fun theBoardFollowsTheEngineTheTrackPageHolds() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                var mode by remember { mutableStateOf<Int?>(150) }
                AndroidTrackScreen(
                    trackId = "track.mario_kart_stadium",
                    mode = mode,
                    ecosystemClient = source,
                    signedInPlayerId = null,
                    onModeChanged = { mode = it },
                )
            }
        }

        // The 150cc leader is on the board and in the summary strip above it.
        compose.waitUntil(10_000) {
            compose.onAllNodesWithText("1:31.500").fetchSemanticsNodes().size == 2
        }
        compose.onNode(hasText("200cc") and hasAnyAncestor(hasTestTag("track-screen-engine")))
            .performClick()
        // 150 ↔ 200 replaces every dependent value on the page, not only a tint.
        compose.waitUntil(10_000) {
            compose.onAllNodesWithText("1:21.500").fetchSemanticsNodes().size == 2
        }
        compose.onAllNodesWithText("1:31.500").assertCountEquals(0)
        compose.onNodeWithTag("track-board-summary").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun aCommunityNameOnTheBoardOpensThatPlayersPage() {
        var opened: String? = null
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                AndroidTrackScreen(
                    trackId = "track.mario_kart_stadium",
                    mode = 150,
                    ecosystemClient = source,
                    signedInPlayerId = null,
                    onOpenPlayer = { opened = it },
                )
            }
        }

        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag("track-board-player-player.rival").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("track-board-player-player.rival").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("player.rival", opened) }
    }
}
