package nl.mariokart8.mk8dxtimetrials.auth

import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidNativeSessionStoreDeviceTest {
    @Test
    fun encryptsSeveralAccountsAndExpiresThemIndependently() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = AndroidKeystoreNativeSessionStore(context)
        store.list(1).forEach { store.remove(it.slotId) }
        val accountA = AndroidAuthenticatedNativeSession(
            bearerToken = "abcdefghijklmnopqrstuvwxyzABCDEF",
            expiresAtMs = 2_000_000,
            playerId = "player.synthetic_device_01",
        )
        val accountB = AndroidAuthenticatedNativeSession(
            bearerToken = "ZYXWVUTSRQPONMLKJIHGFEDCBA987654",
            expiresAtMs = 4_000_000,
            playerId = "player.synthetic_device_02",
        )
        val accountASlot = androidSessionSlotId(accountA.playerId)
        val accountBSlot = androidSessionSlotId(accountB.playerId)
        store.save(accountASlot, accountA)
        store.save(accountBSlot, accountB)
        store.setActiveSlotId(accountBSlot)

        assertEquals(accountA, store.load(accountASlot, 1_000_000))
        assertEquals(accountB, store.load(accountBSlot, 1_000_000))
        assertEquals(accountBSlot, store.activeSlotId())

        val preferencesRoot = File(context.applicationInfo.dataDir, "shared_prefs")
        val persisted = preferencesRoot.listFiles().orEmpty()
            .joinToString("\n") { it.readText() }
        assertFalse(persisted.contains(accountA.bearerToken))
        assertFalse(persisted.contains(accountA.playerId))
        assertFalse(persisted.contains(accountB.bearerToken))
        assertFalse(persisted.contains(accountB.playerId))

        // One account expiring must not disturb the other account.
        assertNull(store.load(accountASlot, 2_000_000))
        assertEquals(accountB, store.load(accountBSlot, 2_000_000))
        assertTrue(store.list(2_000_000).single { it.slotId == accountASlot }.expired)
        assertFalse(store.list(2_000_000).single { it.slotId == accountBSlot }.expired)

        store.remove(accountASlot)
        assertEquals(listOf(accountBSlot), store.list(1_000_000).map { it.slotId })
        store.remove(accountBSlot)
        assertEquals(emptyList<AndroidRememberedAccount>(), store.list(1_000_000))
    }
}
