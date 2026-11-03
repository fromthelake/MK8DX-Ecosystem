package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Rule
import org.junit.Test

/** One publication is one visible card even when it unlocks several outcomes. */
class AndroidComebackStripDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun groupsRunOutcomesIntoOneCardWithCompactSecondaryResults() {
        val staff = AndroidBenchmarkCatalog.forKind(AndroidBenchmarkKind.NINTENDO_STAFF, 150).first()
        val now = System.currentTimeMillis()
        val best = staff.timeMs - 500
        val home = AndroidHomeBootstrap(
            schemaVersion = "mk8dx.home-bootstrap.v1",
            authenticated = true,
            comeback = AndroidHomeComeback(
                schemaVersion = "mk8dx.home-comeback.v1",
                player = AndroidHomePlayer("player.ben", "Ben"),
                timeTrials = AndroidTimeTrialStanding(1, 8, 1_000_000),
                rivals = listOf(AndroidRivalComparison(
                    playerId = "player.valerio",
                    displayName = "Valerio",
                    tracksAhead = 1,
                    tracksBehind = 0,
                    sharedCombos = 1,
                    totalDeltaMs = 500,
                )),
                sinceMs = now - 86_400_000,
            ),
            trackBests = AndroidTrackBestsDocument(
                "mk8dx.public-track-bests.v1",
                listOf(
                    AndroidTrackBestPlayer("player.ben", listOf(AndroidTrackBest(staff.trackId, 150, best, 1))),
                    AndroidTrackBestPlayer("player.valerio", listOf(AndroidTrackBest(staff.trackId, 150, best + 500, 2))),
                ),
            ),
            stories = AndroidActivityStoriesDocument(
                "mk8dx.activity-stories.v1",
                listOf(AndroidActivityStory(
                    player = AndroidActivityPlayer("player.ben", "Ben"),
                    trackId = staff.trackId,
                    mode = 150,
                    runs = 1,
                    startMs = best,
                    bestMs = best,
                    personalBest = true,
                    rank = AndroidActivityRank(after = 1, before = 2, passed = emptyList(), passedCount = 0),
                    latestAtMs = now - 1_000,
                    runDetails = listOf(AndroidActivityRun(
                        resultId = "result.grouped",
                        timeMs = best,
                        atMs = now - 1_000,
                        sourceKind = "manual",
                    )),
                    personalBestDeltaMs = 4_000,
                )),
            ),
        )

        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Light) {
                AndroidComebackStrip(home = home, onOpenTrack = {})
            }
        }

        compose.onNodeWithTag("home-away").assertIsDisplayed()
        compose.onAllNodesWithText(Schema9AndroidTrackCatalog.find(staff.trackId)!!.displayName)
            .assertCountEquals(1)
        compose.onNodeWithText("Passed Valerio ✓ · lead 0.500s.").assertIsDisplayed()
        compose.onNodeWithText("Nintendo Ghost defeated ✓").assertIsDisplayed()
        compose.onNodeWithText("Track rank: #2 → 🏆 #1.").assertIsDisplayed()
        compose.onNodeWithText("PB improvement: −4.000 →", substring = true).assertIsDisplayed()
        compose.onAllNodesWithText("•", useUnmergedTree = true).assertCountEquals(4)
    }
}
