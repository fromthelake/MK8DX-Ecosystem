package nl.mariokart8.mk8dxtimetrials

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidAppRelease
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidHomeBootstrap
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidPublicTimeTrialResult
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource
import androidx.test.platform.app.InstrumentationRegistry
import nl.mariokart8.mk8dxtimetrials.notifications.AndroidNotificationTarget
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class AndroidTimeTrialsProductComponentDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    /**
     * The product remembers the route it was last on, on the device, for the
     * Player's sake. That also means one test's last screen would otherwise be
     * the next test's first, so each test starts from a clean navigation.
     */
    @Before
    fun startFromACleanNavigation() {
        InstrumentationRegistry.getInstrumentation().targetContext
            .getSharedPreferences("mk8dx-product-navigation-v1", android.content.Context.MODE_PRIVATE)
            .edit().clear().commit()
    }

    @Test
    fun canonicalNotificationDeepLinkKeepsTrackModeAndAccountIsolation() {
        val target = AndroidNotificationTarget(
            notificationId = "9999999999999999999",
            playerId = "player.ben",
            slotId = "slot.00000000000000000000000000000000",
            trackId = "track.mario_circuit",
            mode = 150,
        )
        var opened = false
        val activePlayer = mutableStateOf("player.floyd")
        compose.setContent {
            MaterialTheme {
                AndroidTimeTrialsProductComponent(
                    scanResultContent = { _, _, _, _, _ -> },
                    tracksContent = { _, track, mode, _ -> Text("Deep link $track ${mode}cc") },
                    savedResultsContent = { _, _ -> },
                    authenticationContent = { Text("Choose Ben explicitly") },
                    activePlayerLabel = activePlayer.value,
                    notificationTarget = target,
                    onNotificationOpened = { opened = true },
                )
            }
        }
        compose.onNodeWithText("Choose Ben explicitly").assertIsDisplayed()
        assertFalse(opened)

        compose.runOnUiThread { activePlayer.value = "player.ben" }
        compose.onNodeWithText("Deep link track.mario_circuit 150cc").assertIsDisplayed()
        compose.runOnIdle { assertTrue(opened) }
    }

    @Test
    fun primaryDestinationsUsePersistentProductNavigation() {
        compose.setContent {
            MaterialTheme {
                AndroidTimeTrialsProductComponent(
                    scanResultContent = { _, _, _, _, _ -> Text("Injected scan destination") },
                    tracksContent = { _, _, _, actions ->
                        Text("Injected tracks destination")
                        Button(onClick = { actions.postTime("track.mario_kart_stadium", 200) }) {
                            Text("Post a time on this track")
                        }
                    },
                    postTimeContent = { _, _, _, actions ->
                        Text("Injected task destination")
                        Button(onClick = { actions.scan("track.mario_kart_stadium", 200) }) {
                            Text("Scan from the form")
                        }
                    },
                    savedResultsContent = { _, submitTimeTrial ->
                        Text("Injected saved destination")
                        Button(onClick = submitTimeTrial) { Text("Submit from saved") }
                    },
                    rankContent = { _, _, _, _, _, _ -> Text("Injected rank destination") },
                    buildContent = { Text("Injected build destination") },
                    authenticationContent = { Text("Injected account destination") },
                    unsynchronizedResultCount = 2,
                )
            }
        }

        compose.onNodeWithTag("time-trials-product-title").assertIsDisplayed()
        compose.onNodeWithTag("product-platform-android").assertIsDisplayed()
        compose.onNodeWithTag("product-sync-status").assertIsDisplayed()
        compose.onNodeWithTag("product-sync-count").assertIsDisplayed()
        compose.onNodeWithContentDescription("2 results waiting to sync").assertIsDisplayed()

        // Home's own A4 opens the canonical task, and the task is task mode.
        compose.onNodeWithTag("time-trials-open-manual").performClick()
        compose.onNodeWithText("Injected task destination").assertIsDisplayed()
        compose.onNodeWithTag("product-navigation").assertDoesNotExist()
        compose.onNodeWithTag("product-task-bar").assertIsDisplayed()
        // The scan is an action inside that task, and it is a task of its own.
        compose.onNodeWithText("Scan from the form").performClick()
        compose.onNodeWithText("Injected scan destination").assertIsDisplayed()
        compose.onNodeWithTag("product-navigation").assertDoesNotExist()
        compose.onNodeWithTag("product-task-bar").assertIsDisplayed()
        // One step back per press, exactly as the system Back key performs it.
        compose.onNodeWithTag("product-task-close").performClick()
        compose.onNodeWithText("Injected task destination").assertIsDisplayed()
        compose.onNodeWithTag("product-task-close").performClick()
        compose.onNodeWithTag("time-trials-product-title").assertIsDisplayed()
        // The Tracks tab is the track browser, and its action opens the task.
        compose.onNodeWithTag("product-nav-manual_entry").performClick()
        compose.onNodeWithText("Injected tracks destination").assertIsDisplayed()
        compose.onNodeWithText("Post a time on this track").performClick()
        compose.onNodeWithText("Injected task destination").assertIsDisplayed()
        compose.onNodeWithTag("product-task-close").performClick()
        compose.onNodeWithTag("product-nav-home").performClick()

        compose.onNodeWithTag("product-nav-rank").performClick()
        compose.onNodeWithText("Injected rank destination").assertIsDisplayed()
        compose.onNodeWithTag("product-home-logo").performClick()
        compose.onNodeWithTag("time-trials-product-title").assertIsDisplayed()
        // Home via the logo clears route history: Back must not reopen Rank.
        compose.onNodeWithTag("product-nav-build").performClick()
        compose.onNodeWithText("Injected build destination").assertIsDisplayed()
        compose.onNodeWithTag("product-nav-home").performClick()

        compose.onNodeWithTag("product-sync-status").performClick()
        compose.onNodeWithText("Injected saved destination").assertIsDisplayed()
        compose.onNodeWithText("Submit from saved").performClick()
        compose.onNodeWithText("Injected task destination").assertIsDisplayed()
        compose.onNodeWithTag("product-task-close").performClick()
        compose.onNodeWithTag("product-nav-home").performClick()
        compose.onNodeWithTag("product-profile").performClick()
        compose.onNodeWithText("Injected account destination").assertIsDisplayed()
        compose.onNodeWithTag("product-nav-home").performClick()
        compose.onNodeWithTag("time-trials-product-title").assertIsDisplayed()
    }

    @Test
    fun signedInHeaderKeepsProfileNotificationsAndSettingsOnEveryRoute() {
        compose.setContent {
            MaterialTheme {
                AndroidTimeTrialsProductComponent(
                    scanResultContent = { _, _, _, _, _ -> },
                    tracksContent = { _, _, _, _ -> },
                    savedResultsContent = { _, _ -> },
                    rankContent = { _, _, _, _, _, _ -> Text("Rank route") },
                    profileContent = { _, _ -> Text("Profile route") },
                    notificationsContent = { _, _, _ -> Text("Notifications route") },
                    settingsContent = { _, _ -> Text("Settings route") },
                    activePlayerLabel = "player.ben",
                )
            }
        }

        compose.onNodeWithTag("product-nav-rank").performClick()
        // The component shows the label it is handed. Production hands it the
        // readable one (`androidPlayerLabel`); this test hands it the id.
        compose.onNodeWithText("player.ben").assertIsDisplayed()
        compose.onNodeWithTag("product-profile").assertIsDisplayed().performClick()
        compose.onNodeWithText("Profile route").assertIsDisplayed()
        compose.onNodeWithTag("product-notifications").assertIsDisplayed().performClick()
        compose.onNodeWithText("Notifications route").assertIsDisplayed()
        compose.onNodeWithTag("product-settings").assertIsDisplayed().performClick()
        compose.onNodeWithText("Settings route").assertIsDisplayed()
    }

    @Test
    fun signedInHeaderSurfacesANewerHostedBuildWithoutTakingOverHome() {
        val source = object : AndroidTimeTrialsEcosystemDataSource {
            override fun home() = AndroidHomeBootstrap(
                schemaVersion = "mk8dx.home-bootstrap.v1",
                authenticated = true,
            )
            override fun leaderboard(trackId: String, mode: Int): List<AndroidPublicTimeTrialResult> = emptyList()
            override fun latestAndroidRelease() = AndroidAppRelease("2.99.0-build999", "2026-08-24")
        }
        compose.setContent {
            MaterialTheme {
                AndroidTimeTrialsProductComponent(
                    scanResultContent = { _, _, _, _, _ -> },
                    tracksContent = { _, _, _, _ -> },
                    savedResultsContent = { _, _ -> },
                    activePlayerLabel = "player.ben",
                    ecosystemClient = source,
                )
            }
        }

        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("product-notification-count").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("product-notification-count").assertIsDisplayed()
        compose.onNodeWithText("UPDATE ↓").assertDoesNotExist()
        compose.onNodeWithTag("product-navigation").assertIsDisplayed()
    }
}
