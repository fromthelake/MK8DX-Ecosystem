package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Rule
import org.junit.Test
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * A10 Profile & Records on a device, with a Player who has results.
 *
 * The phone cannot sign in here - the device-approval page wants the owner's
 * password - so the halves that need a session are proven the way the Ranking
 * tests prove theirs: the real screen, the real components, a fake data source.
 * These are the lines Phase 13 changed the drawing of and not the wording:
 * the tabs, the counts, a published result with its laps, and the community
 * record book as the same board a tournament night uses.
 */
class AndroidProfileRecordsDeviceTest {

    @get:Rule
    val compose = createComposeRule()

    private val source = object : AndroidTimeTrialsEcosystemDataSource {
        override fun home() = AndroidHomeBootstrap("mk8dx.home-bootstrap.v1", true)

        override fun leaderboard(trackId: String, mode: Int) = emptyList<AndroidPublicTimeTrialResult>()

        override fun playerResults(playerId: String) = listOf(
            AndroidPublicTimeTrialResult(
                resultId = "user_submission.time.ONE",
                playerId = "player.ben",
                playerUsername = "ben",
                playerDisplayName = "Ben",
                trackId = "track.mario_kart_stadium",
                mode = 150,
                totalTimeMs = 92_345,
                rank = 1,
                laps = listOf(
                    AndroidActivityLap(1, 31_000, coinsCollected = 3, mushroomsUsed = 1),
                    AndroidActivityLap(2, 30_500, coinsCollected = 7),
                    AndroidActivityLap(3, 30_845, coinsCollected = 10),
                ),
                sourceKind = "android_scan",
                resultAtMs = 1_900_000_000_000,
            ),
            AndroidPublicTimeTrialResult(
                resultId = "user_submission.time.TWO",
                playerId = "player.ben",
                playerUsername = "ben",
                playerDisplayName = "Ben",
                trackId = "track.baby_park",
                mode = 200,
                totalTimeMs = 3_601_234,
                sourceKind = "android_manual",
                resultAtMs = 1_900_000_000_000,
            ),
        )

        override fun managedTimeTrials() = emptyList<AndroidManagedTimeTrial>()

        override fun playerProfile(playerId: String) =
            AndroidProfilePlayer("player.ben", AndroidUsername("ben"), "Ben")

        override fun recordBook() = AndroidRecordBook(
            "mk8dx.public-record-book.v1",
            listOf(
                AndroidRecordCategory(
                    key = "firsts",
                    holders = listOf(
                        AndroidRecordHolder("player.ben", "Ben", 1_234),
                        AndroidRecordHolder("player.nova", "Nova", 96),
                        AndroidRecordHolder("player.jory", "Jory", 7),
                    ),
                ),
            ),
        )
    }

    private fun open() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                AndroidProfileRecordsScreen(source, "player.ben", {}, "https://example.test")
            }
        }
        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithText("Published results").fetchSemanticsNode() }.isSuccess
        }
    }

    @Test
    fun theResultsHalfCountsEachEngineAndPrintsEveryTimeInFull() {
        open()
        // The sentence became three figures; the two engine counts carry an
        // EngineMark, so the class is never only a colour.
        compose.onNodeWithText("Published results").assertIsDisplayed()
        // Both engines are named twice - the count's mark and the result's -
        // so this asks for the first of each rather than exactly one.
        compose.onAllNodesWithText("150cc").onFirst().assertIsDisplayed()
        compose.onAllNodesWithText("200cc").onFirst().assertIsDisplayed()
        // Times through Mk8dxNumeric: below an hour and past an hour, exact.
        compose.onNodeWithText("1:32.345").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("1:00:01.234").performScrollTo().assertIsDisplayed()
        // The rank is the design system's formatted rank, not "#1" by hand.
        compose.onNodeWithText("#1").performScrollTo().assertIsDisplayed()
        // A lap is a FactRow: what happened is the label, the time is the value.
        compose.onNodeWithText("Lap 1 · +3 coins · 1 mushrooms").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("0:31.000").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun theRecordBookIsTheSameBoardAsANightAndGroupsItsThousands() {
        open()
        compose.onNodeWithTag("profile-tab-records").performClick()
        compose.waitUntil(5_000) {
            // The board's heading is display type, which the system sets in caps.
            runCatching {
                compose.onNodeWithText("MOST LEADERBOARD #1S").fetchSemanticsNode()
            }.isSuccess
        }
        // The board's own columns, the ranks it derives, and a count that is
        // grouped for the reader's language rather than printed raw.
        compose.onNodeWithText("MOST LEADERBOARD #1S").assertIsDisplayed()
        compose.onNodeWithText("1,234").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Ben").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Nova").performScrollTo().assertIsDisplayed()
    }
}
