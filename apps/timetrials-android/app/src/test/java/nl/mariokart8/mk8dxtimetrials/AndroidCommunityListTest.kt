package nl.mariokart8.mk8dxtimetrials

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidCommunityListTest {
    private class MemoryStorage(var value: String? = null) : AndroidCommunityListStorage {
        override fun read(): String? = value
        override fun write(value: String): Boolean { this.value = value; return true }
    }

    private val club = "https://club.example"
    private val online = "https://online.example"
    private val lan = "https://192.168.1.50"

    private fun list(storage: AndroidCommunityListStorage) =
        AndroidCommunityList(storage) { AndroidServerOrigin.validate(it, allowLoopbackPort = true) }

    @Test fun `an install from before the list keeps its one origin as the only entry`() {
        val storage = MemoryStorage()
        val communities = list(storage).all(active = club, nowMs = 10)
        assertEquals(listOf(AndroidCommunity(club, "club.example", 10)), communities)
        // Written once, so it is there without the active origin as well.
        assertEquals(listOf(club), list(storage).all(active = null, nowMs = 20).map { it.origin })
    }

    @Test fun `no active origin and nothing stored is an empty list`() {
        assertTrue(list(MemoryStorage()).all(active = null, nowMs = 1).isEmpty())
    }

    @Test fun `saving a new origin adds it and puts it first`() {
        val storage = MemoryStorage()
        list(storage).all(active = club, nowMs = 10)
        val after = list(storage).markUsed(online, nowMs = 20)
        assertEquals(listOf(online, club), after.map { it.origin })
        assertEquals("online.example", after.first().name)
    }

    @Test fun `switching back marks the entry used without adding a second one`() {
        val storage = MemoryStorage()
        list(storage).markUsed(club, 10)
        list(storage).markUsed(online, 20)
        val after = list(storage).markUsed(club, 30)
        assertEquals(listOf(club, online), after.map { it.origin })
        assertEquals(2, after.size)
        assertEquals(30, after.first().lastUsedAtMs)
    }

    @Test fun `the name is the host, with a port when there is one`() {
        assertEquals("192.168.1.50", AndroidCommunityList.displayNameOf(lan))
        assertEquals("127.0.0.1:65262", AndroidCommunityList.displayNameOf("https://127.0.0.1:65262"))
    }

    @Test fun `remove is refused while the community still has unsent runs`() {
        val storage = MemoryStorage()
        list(storage).markUsed(club, 10)
        list(storage).markUsed(online, 20)
        assertEquals(AndroidCommunityRemoval.RefusedUnsent(2), list(storage).remove(club, active = online, unsent = 2))
        assertEquals(2, list(storage).all(online, 30).size)
    }

    @Test fun `the active community is never removed`() {
        val storage = MemoryStorage()
        list(storage).markUsed(club, 10)
        assertEquals(AndroidCommunityRemoval.RefusedActive, list(storage).remove(club, active = club, unsent = 0))
    }

    @Test fun `remove forgets an inactive community without unsent runs`() {
        val storage = MemoryStorage()
        list(storage).markUsed(club, 10)
        list(storage).markUsed(online, 20)
        assertEquals(AndroidCommunityRemoval.Removed, list(storage).remove(club, active = online, unsent = 0))
        assertEquals(listOf(online), list(storage).all(online, 30).map { it.origin })
        assertEquals(AndroidCommunityRemoval.Unknown, list(storage).remove(club, active = online, unsent = 0))
    }

    @Test fun `a damaged list is read as empty and the active origin comes back`() {
        val storage = MemoryStorage("not json")
        assertEquals(listOf(club), list(storage).all(club, 5).map { it.origin })
    }

    @Test fun `the storage namespace of any origin matches the active one's`() {
        assertEquals(24, AndroidServerOrigin.namespaceOf(club).length)
        assertEquals("", AndroidServerOrigin.storageSuffix(club, packaged = club))
        assertEquals("_" + AndroidServerOrigin.namespaceOf(online), AndroidServerOrigin.storageSuffix(online, packaged = club))
    }
}
