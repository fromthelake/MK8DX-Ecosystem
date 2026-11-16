package nl.mariokart8.mk8dxtimetrials

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidPreviousDefaultMigrationTest {
    private val old = "https://old.example"
    private val lan = "https://192.168.1.50"
    private val current = "https://example.invalid"

    @Test fun recordedPreviousDefaultWinsWithSeveralCommunities() {
        assertEquals(old, previousDefaultCandidate(current, old, listOf(lan, old, "https://other.example")) { it == lan })
    }

    @Test fun oneOnlineCommunityCanBeRecoveredBesideLan() {
        assertEquals(old, previousDefaultCandidate(current, null, listOf(lan, old)) { it == lan })
        assertNull(previousDefaultCandidate(current, null, listOf(lan, old, "https://other.example")) { it == lan })
    }

    @Test fun knownCurrentDefaultNeverTakesAnotherCommunity() {
        assertEquals(current, previousDefaultCandidate(current, current, listOf(old)) { false })
        assertNull(previousDefaultCandidate(current, "https://missing.example", listOf(old)) { false })
        assertEquals(old, previousDefaultCandidate(old, null, listOf(old, "https://other.example")) { false })
    }

    @Test fun encryptedSlotsMergeWithoutReplacingNewerAccount() {
        val oldSlot = "slot." + "a".repeat(32)
        val newSlot = "slot." + "b".repeat(32)
        val source = mapOf(
            "slots" to oldSlot, "active" to oldSlot,
            "ciphertext.label.$oldSlot" to "old label", "iv.label.$oldSlot" to "old label iv",
            "ciphertext.session.$oldSlot" to "old session", "iv.session.$oldSlot" to "old session iv",
        )
        val target = mapOf("slots" to newSlot, "active" to newSlot)
        val writes = legacySessionPreferenceWrites(source, target)
        assertEquals("$newSlot,$oldSlot", writes["slots"])
        assertEquals("old session", writes["ciphertext.session.$oldSlot"])
        assertFalse(writes.containsKey("active"))
        assertTrue(legacySessionPreferenceWrites(source, source).isEmpty())
    }

    @Test fun oldOutboxEntriesAreCopiedAndNewerEntriesStay() {
        val root = Files.createTempDirectory("mk8dx-default-migration-").toFile()
        try {
            val source = root.resolve("old")
            val target = root.resolve("new")
            val keyA = "a".repeat(64)
            val keyB = "b".repeat(64)
            source.resolve(keyA).mkdirs()
            source.resolve(keyB).mkdirs()
            target.resolve(keyB).mkdirs()
            source.resolve("$keyA/entry.json").writeText("old")
            source.resolve("$keyB/entry.json").writeText("old b")
            target.resolve("$keyB/entry.json").writeText("new b")
            copyMissingChildren(source, target, Regex("^[0-9a-f]{64}$"))
            assertEquals("old", target.resolve("$keyA/entry.json").readText())
            assertEquals("new b", target.resolve("$keyB/entry.json").readText())
            assertEquals("old", source.resolve("$keyA/entry.json").readText())
            assertFalse(target.resolve("ignored").exists())
        } finally {
            root.deleteRecursively()
        }
    }
}
