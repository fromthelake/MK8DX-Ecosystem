package nl.mariokart8.mk8dxtimetrials.ecosystem

import nl.mariokart8.mk8dxtimetrials.notifications.androidNotificationLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Engine-context defects on Android (ENGINE_CONTEXT_INVENTORY.md §3, R4 and
 * R7). Each was written as an expected failure first, like the web's
 * `it.fails`, confirmed to fail for the documented reason, and flipped with
 * its fix.
 */
class EngineContextDefectsTest {
    @Test
    fun `R7 a link's engine outranks a single-engine preference on Ranking`() {
        // `?ranking=timetrials&mode=200` for a Player whose preference is 150cc:
        // the web shows 200cc; Android overwrote it with the preference.
        assertEquals(200, androidRankEngineMode(explicit = 200, current = 200, preference = "150"))
    }

    @Test
    fun `R7 without a link Ranking follows the preference, as on the web`() {
        assertEquals(150, androidRankEngineMode(explicit = null, current = 200, preference = "150"))
        assertEquals(200, androidRankEngineMode(explicit = null, current = 200, preference = "all"))
    }

    @Test
    fun `R4 a notification without an engine does not invent 150cc in its link`() {
        val link = androidNotificationLink(
            AndroidNotification(
                notificationId = "7", kind = "overtaken", trackId = "track.mount_wario", mode = null,
                actorPlayerId = "player.floyd", count = 1, lastEventAtMs = 1_900_000_000_000, read = false,
            ),
        )
        assertFalse(link.orEmpty(), link.orEmpty().contains("mode=150"))
        assertEquals("/?leaderboard=track.mount_wario&notification=7", link)
    }

    @Test
    fun `R4 a track page without an engine starts on the viewer's single-engine preference`() {
        assertEquals(200, androidEntryStartMode(initialMode = null, preference = "200"))
    }

    @Test
    fun `R4 an engine the way in asked for is kept, and nothing known is 150`() {
        assertEquals(200, androidEntryStartMode(initialMode = 200, preference = "150"))
        assertEquals(150, androidEntryStartMode(initialMode = null, preference = "all"))
        assertEquals(150, androidEntryStartMode(initialMode = null, preference = null))
    }
}
