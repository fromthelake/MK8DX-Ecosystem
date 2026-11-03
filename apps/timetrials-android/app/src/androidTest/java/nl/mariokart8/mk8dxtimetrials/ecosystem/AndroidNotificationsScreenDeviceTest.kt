package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * A notification you do not want to read must be dismissible without opening
 * it. Before this, only a notification carrying a track had any way to be
 * marked read, and only by navigating to that track.
 */
class AndroidNotificationsScreenDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private fun notification(id: String, kind: String, read: Boolean) = AndroidNotification(
        notificationId = id,
        kind = kind,
        trackId = if (kind == "world_record") "track.mount_wario" else null,
        mode = if (kind == "world_record") 150 else null,
        detail = "Pii set a new world record",
        count = 1,
        lastEventAtMs = 1_900_000_000_000,
        read = read,
    )

    private class RecordingSource(
        var notifications: MutableList<AndroidNotification>,
    ) : AndroidTimeTrialsEcosystemDataSource {
        val markedIndividually = mutableListOf<List<String>>()
        var markedAll = 0

        // The two members the interface leaves abstract; this screen reads
        // neither of them.
        override fun home() = AndroidHomeBootstrap(
            schemaVersion = "mk8dx.home-bootstrap.v1",
            authenticated = true,
        )

        override fun leaderboard(trackId: String, mode: Int) =
            emptyList<AndroidPublicTimeTrialResult>()

        override fun notifications() = AndroidNotificationInbox(
            schemaVersion = "mk8dx.notifications.v1",
            unreadCount = notifications.count { !it.read },
            notifications = notifications.toList(),
        )

        override fun markNotificationsRead(notificationIds: List<String>) {
            markedIndividually += notificationIds
            notifications = notifications
                .map { if (it.notificationId in notificationIds) it.copy(read = true) else it }
                .toMutableList()
        }

        override fun markAllNotificationsRead() {
            markedAll += 1
            notifications = notifications.map { it.copy(read = true) }.toMutableList()
        }
    }

    @Test
    fun clearsOneNotificationWithoutOpeningIt() {
        val source = RecordingSource(mutableListOf(
            notification("31", "world_record", read = false),
            notification("7", "reaction_received", read = false),
        ))
        var openedTrack: String? = null
        compose.setContent {
            MaterialTheme {
                AndroidNotificationsScreen(
                    client = source,
                    playerId = "player.ben",
                    onSignIn = {},
                    apiOrigin = "https://example.invalid",
                    onOpenTrack = { trackId, _ -> openedTrack = trackId },
                )
            }
        }

        compose.onNodeWithText("2 unread").assertIsDisplayed()
        compose.onNodeWithTag("notification-mark-read-31").performScrollTo().performClick()
        compose.waitForIdle()

        assertEquals(listOf(listOf("31")), source.markedIndividually)
        // Dismissing is not reading: the track was never opened.
        assertEquals(null, openedTrack)
        compose.onNodeWithText("1 unread").assertIsDisplayed()
    }

    /**
     * A11 on the design system (Phase 12): unread is a tag as well as an edge,
     * so the state survives a reading that ignores colour - and it goes away
     * when the entry is read.
     */
    @Test
    fun anUnreadEntryCarriesTheUnreadTagAndLosesItWhenRead() {
        val source = RecordingSource(mutableListOf(
            notification("31", "world_record", read = false),
            notification("7", "reaction_received", read = true),
        ))
        compose.setContent {
            MaterialTheme {
                AndroidNotificationsScreen(
                    client = source,
                    playerId = "player.ben",
                    onSignIn = {},
                    apiOrigin = "https://example.invalid",
                )
            }
        }

        compose.onAllNodesWithText("Unread").assertCountEquals(1)
        compose.onNodeWithTag("notification-mark-read-31").performScrollTo().performClick()
        compose.waitForIdle()
        compose.onAllNodesWithText("Unread").assertCountEquals(0)
    }

    @Test
    fun clearsEverythingAtOnce() {
        val source = RecordingSource(mutableListOf(
            notification("31", "world_record", read = false),
            notification("7", "reaction_received", read = false),
            notification("3", "reaction_received", read = true),
        ))
        compose.setContent {
            MaterialTheme {
                AndroidNotificationsScreen(
                    client = source,
                    playerId = "player.ben",
                    onSignIn = {},
                    apiOrigin = "https://example.invalid",
                )
            }
        }

        compose.onNodeWithTag("notifications-mark-all-read").performScrollTo().performClick()
        compose.waitForIdle()

        assertEquals(1, source.markedAll)
        assertEquals(emptyList<List<String>>(), source.markedIndividually)
        compose.onNodeWithText("You're all caught up").assertIsDisplayed()
    }
}
