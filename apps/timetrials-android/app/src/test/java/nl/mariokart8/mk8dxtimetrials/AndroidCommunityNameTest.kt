package nl.mariokart8.mk8dxtimetrials

import nl.mariokart8.mk8dxtimetrials.tournament.AndroidInstallationSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The community's own name (public installation settings) and the waiting lines of a community tile. */
class AndroidCommunityNameTest {
    private class MemoryStorage(var value: String? = null) : AndroidCommunityListStorage {
        override fun read(): String? = value
        override fun write(value: String): Boolean { this.value = value; return true }
    }

    private val club = "https://club.example"
    private val lan = "https://192.168.1.50"

    private fun list(storage: AndroidCommunityListStorage) =
        AndroidCommunityList(storage) { AndroidServerOrigin.validate(it, allowLoopbackPort = true) }

    private fun nameOf(storage: AndroidCommunityListStorage, origin: String) =
        list(storage).all(null, 0).single { it.origin == origin }.name

    private fun settings(extra: String) = AndroidInstallationSettings.decode(
        """{"schemaVersion":"mk8dx.installation-settings.v1","playerCreation":"self_only","ratingEligibility":"all_players"$extra}""",
    ).communityName

    @Test fun `the settings name is read, trimmed to 60 and never empty`() {
        assertEquals("Club Noord", settings(""","communityName":"  Club Noord  """"))
        assertEquals("x".repeat(60), settings(""","communityName":"${"x".repeat(75)}""""))
        assertNull(settings(""))
        assertNull(settings(""","communityName":null"""))
        assertNull(settings(""","communityName":"   """"))
        assertNull(settings(""","communityName":42"""))
    }

    @Test fun `the community entry takes the server's name and goes back to the host without one`() {
        val storage = MemoryStorage()
        list(storage).markUsed(club, 10)
        list(storage).markUsed(lan, 20)
        assertEquals("club.example", nameOf(storage, club))

        list(storage).applyServerName(club, "Club Noord")
        assertEquals("Club Noord", nameOf(storage, club))
        assertEquals("192.168.1.50", nameOf(storage, lan))

        // A name change on the server is taken over on the next read.
        list(storage).applyServerName(club, "Club Noord-West")
        assertEquals("Club Noord-West", nameOf(storage, club))

        // No name (older server, null, blank): the host again, never an empty string.
        list(storage).applyServerName(club, null)
        assertEquals("club.example", nameOf(storage, club))
        list(storage).applyServerName(club, "  ")
        assertEquals("club.example", nameOf(storage, club))
    }

    @Test fun `a name for an unknown origin changes nothing`() {
        val storage = MemoryStorage()
        list(storage).markUsed(club, 10)
        list(storage).applyServerName(lan, "Thuis")
        assertEquals(listOf(club), list(storage).all(null, 0).map { it.origin })
    }

    @Test fun `the chip and the tiles show the stored name`() {
        val storage = MemoryStorage()
        list(storage).markUsed(club, 10)
        list(storage).applyServerName(club, "Club Noord")
        assertEquals("Club Noord", androidCommunityChipLabel(list(storage).all(null, 0), club))
    }

    @Test fun `a tile counts outbox runs apart from carried copies waiting for sign-in`() {
        val nothing = AndroidCommunityWaiting(outboxRuns = 0, carriedCopies = 0)
        assertTrue(nothing.nothing)
        assertNull(nothing.runsLine)

        val onlyCarried = AndroidCommunityWaiting(outboxRuns = 0, carriedCopies = 111)
        assertFalse(onlyCarried.nothing)
        assertNull(onlyCarried.runsLine)

        val both = AndroidCommunityWaiting(outboxRuns = 2, carriedCopies = 5)
        assertFalse(both.nothing)
        assertEquals(2, both.runsLine)

        val onlyRuns = AndroidCommunityWaiting(outboxRuns = 1, carriedCopies = 0)
        assertEquals(1, onlyRuns.runsLine)
    }
}
