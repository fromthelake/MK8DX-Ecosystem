package nl.mariokart8.mk8dxtimetrials.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** In-memory stand-ins for the Keystore/SharedPreferences adapters. */
private class MemorySlotDirectory : AndroidSessionSlotDirectory {
    val slots = mutableListOf<String>()
    var active: String? = null

    override fun slotIds(): List<String> = slots.toList()

    override fun addSlotId(slotId: String) {
        if (slotId !in slots) slots += slotId
    }

    override fun removeSlotId(slotId: String) {
        slots -= slotId
    }

    override fun activeSlotId(): String? = active

    override fun setActiveSlotId(slotId: String?) {
        active = slotId
    }
}

private class MemorySecretVault : AndroidSessionSecretVault {
    val records = LinkedHashMap<String, String>()

    override fun read(slotId: String, purpose: String): String? = records["$purpose/$slotId"]

    override fun write(slotId: String, purpose: String, plaintext: String) {
        records["$purpose/$slotId"] = plaintext
    }

    override fun erase(slotId: String, purpose: String) {
        records.remove("$purpose/$slotId")
    }
}

private class FakeLegacySource(
    private val session: AndroidAuthenticatedNativeSession?,
) : AndroidLegacySingleSessionSource {
    var discarded = false

    override fun readLegacySession(): AndroidAuthenticatedNativeSession? = session

    override fun discardLegacySession() {
        discarded = true
    }
}

class AndroidSlottedNativeSessionStoreTest {
    private val token = "abcdefghijklmnopqrstuvwxyzABCDEF"
    private val otherToken = "ZYXWVUTSRQPONMLKJIHGFEDCBA987654"
    private val accountA = AndroidAuthenticatedNativeSession(token, 2_000_000, "player.account_a")
    private val accountB = AndroidAuthenticatedNativeSession(otherToken, 3_000_000, "player.account_b")

    private fun store(
        directory: MemorySlotDirectory = MemorySlotDirectory(),
        vault: MemorySecretVault = MemorySecretVault(),
        legacy: AndroidLegacySingleSessionSource = AndroidAbsentLegacySingleSessionSource,
    ) = AndroidSlottedNativeSessionStore(directory, vault, legacy)

    @Test
    fun roundTripsThePublicIdentityAndListsAccountsByDisplayName() {
        val named = AndroidAuthenticatedNativeSession(
            token, 2_000_000, "player.account_a", "account_a", "Account A",
        )
        val subject = store()
        val slotId = androidSessionSlotId(named.playerId)
        subject.save(slotId, named)

        assertEquals(named, subject.load(slotId, 1_000_000))
        val listed = subject.list(1_000_000).single()
        assertEquals("Account A", listed.displayName)
        assertEquals("player.account_a", listed.playerId)
    }

    @Test
    fun stillLoadsAndListsPreIdentityRecordsWrittenByOlderBuilds() {
        // A build-57-or-earlier slot: three session fields, id-only label.
        val directory = MemorySlotDirectory()
        val vault = MemorySecretVault()
        val slotId = androidSessionSlotId("player.account_a")
        vault.write(
            slotId,
            ANDROID_SESSION_VAULT_PURPOSE_SESSION,
            listOf(token, "2000000", "player.account_a").joinToString("\n"),
        )
        vault.write(slotId, ANDROID_SESSION_VAULT_PURPOSE_LABEL, "player.account_a")
        directory.addSlotId(slotId)

        val subject = store(directory, vault)
        assertEquals(accountA, subject.load(slotId, 1_000_000))
        val listed = subject.list(1_000_000).single()
        assertEquals("player.account_a", listed.playerId)
        assertNull(listed.displayName)
    }

    @Test
    fun derivesAStableSlotIdFromThePlayerId() {
        assertEquals(
            androidSessionSlotId(accountA.playerId),
            androidSessionSlotId(accountA.playerId),
        )
        assertNotEquals(
            androidSessionSlotId(accountA.playerId),
            androidSessionSlotId(accountB.playerId),
        )
        assertTrue(isAndroidSessionSlotId(androidSessionSlotId(accountA.playerId)))
        assertTrue(
            androidSessionSlotId(accountA.playerId).matches(Regex("^slot\\.[0-9a-f]{32}$")),
        )
        assertFalse(androidSessionSlotId(accountA.playerId).contains(accountA.playerId))
    }

    @Test
    fun remembersSeveralAccountsSideBySide() {
        val store = store()
        val accountASlot = androidSessionSlotId(accountA.playerId)
        val accountBSlot = androidSessionSlotId(accountB.playerId)

        store.save(accountASlot, accountA)
        store.save(accountBSlot, accountB)
        store.setActiveSlotId(accountBSlot)

        assertEquals(accountA, store.load(accountASlot, 1_000_000))
        assertEquals(accountB, store.load(accountBSlot, 1_000_000))
        assertEquals(accountBSlot, store.activeSlotId())
        assertEquals(
            listOf(
                AndroidRememberedAccount(accountASlot, "player.account_a", expired = false),
                AndroidRememberedAccount(accountBSlot, "player.account_b", expired = false),
            ),
            store.list(1_000_000),
        )
        assertFalse(store.list(1_000_000).toString().contains(token))
    }

    @Test
    fun oneExpiredAccountKeepsItsRowAndLeavesTheOtherAccountIntact() {
        val store = store()
        val accountASlot = androidSessionSlotId(accountA.playerId)
        val accountBSlot = androidSessionSlotId(accountB.playerId)
        store.save(accountASlot, accountA)
        store.save(accountBSlot, accountB)

        // The accountA's session expired at 2_000_000; the accountB's has not.
        assertNull(store.load(accountASlot, 2_500_000))
        assertEquals(accountB, store.load(accountBSlot, 2_500_000))
        assertEquals(
            listOf(
                AndroidRememberedAccount(accountASlot, "player.account_a", expired = true),
                AndroidRememberedAccount(accountBSlot, "player.account_b", expired = false),
            ),
            store.list(2_500_000),
        )
        // Re-authorizing reuses the slot the pending entries are bound to.
        val renewed = accountA.copy(expiresAtMs = 4_000_000)
        store.save(androidSessionSlotId(renewed.playerId), renewed)
        assertEquals(renewed, store.load(accountASlot, 2_500_000))
    }

    @Test
    fun expiryDropsOnlyTheExpiredSlotSecret() {
        val vault = MemorySecretVault()
        val store = store(vault = vault)
        val accountASlot = androidSessionSlotId(accountA.playerId)
        val accountBSlot = androidSessionSlotId(accountB.playerId)
        store.save(accountASlot, accountA)
        store.save(accountBSlot, accountB)

        store.load(accountASlot, 2_500_000)

        assertNull(vault.records["$ANDROID_SESSION_VAULT_PURPOSE_SESSION/$accountASlot"])
        assertEquals(
            accountB.bearerToken,
            vault.records["$ANDROID_SESSION_VAULT_PURPOSE_SESSION/$accountBSlot"]
                ?.substringBefore('\n'),
        )
        assertEquals(
            "player.account_a",
            vault.records["$ANDROID_SESSION_VAULT_PURPOSE_LABEL/$accountASlot"],
        )
    }

    @Test
    fun removingOneAccountLeavesTheOthers() {
        val directory = MemorySlotDirectory()
        val store = store(directory = directory)
        val accountASlot = androidSessionSlotId(accountA.playerId)
        val accountBSlot = androidSessionSlotId(accountB.playerId)
        store.save(accountASlot, accountA)
        store.save(accountBSlot, accountB)
        store.setActiveSlotId(accountASlot)

        store.remove(accountASlot)

        assertNull(store.load(accountASlot, 1_000_000))
        assertNull(store.activeSlotId())
        assertEquals(
            listOf(AndroidRememberedAccount(accountBSlot, "player.account_b", expired = false)),
            store.list(1_000_000),
        )
        assertEquals(listOf(accountBSlot), directory.slots)
    }

    @Test
    fun migratesTheSingleSlotV1RecordIntoItsOwnSlot() {
        val legacy = FakeLegacySource(accountA)
        val store = store(legacy = legacy)
        val accountASlot = androidSessionSlotId(accountA.playerId)

        assertEquals(accountA, store.load(accountASlot, 1_000_000))
        assertEquals(accountASlot, store.activeSlotId())
        assertEquals(
            listOf(AndroidRememberedAccount(accountASlot, "player.account_a", expired = false)),
            store.list(1_000_000),
        )
        assertTrue(legacy.discarded)
    }

    @Test
    fun migrationNeverThrowsOnAnUnusableV1Record() {
        val broken = object : AndroidLegacySingleSessionSource {
            override fun readLegacySession(): AndroidAuthenticatedNativeSession =
                throw IllegalStateException("unreadable v1 record")
            override fun discardLegacySession() = Unit
        }
        val invalid = FakeLegacySource(
            AndroidAuthenticatedNativeSession("short", 2_000_000, "player.account_a"),
        )

        assertEquals(emptyList<AndroidRememberedAccount>(), store(legacy = broken).list(1_000))
        assertEquals(emptyList<AndroidRememberedAccount>(), store(legacy = invalid).list(1_000))
        assertTrue(invalid.discarded)
    }

    @Test
    fun anAccountAlreadyPresentIsNotOverwrittenByMigration() {
        val directory = MemorySlotDirectory()
        val vault = MemorySecretVault()
        val accountASlot = androidSessionSlotId(accountA.playerId)
        store(directory, vault).save(accountASlot, accountA.copy(expiresAtMs = 9_000_000))

        val migrated = AndroidSlottedNativeSessionStore(
            directory,
            vault,
            FakeLegacySource(accountA),
        )

        assertEquals(9_000_000L, migrated.load(accountASlot, 1_000_000)?.expiresAtMs)
    }
}
