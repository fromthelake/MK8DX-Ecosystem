package nl.mariokart8.mk8dxtimetrials.auth

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import nl.mariokart8.mk8dxtimetrials.migrateSessionPreferences
import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidPreviousDefaultMigrationDeviceTest {
    @Test fun copiedEncryptedAccountLoadsFromNamespacedPreferences() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val id = UUID.randomUUID().toString()
        // Unique preferences avoid touching any real account on a connected device.
        val oldName = "mk8dx_migration_test_old_$id"
        val nextName = "mk8dx_migration_test_new_$id"
        try {
            val old = context.getSharedPreferences(oldName, Context.MODE_PRIVATE)
            val next = context.getSharedPreferences(nextName, Context.MODE_PRIVATE)
            val oldStore = AndroidSlottedNativeSessionStore(
                AndroidPreferencesSessionSlotDirectory(old), AndroidKeystoreSessionSecretVault(old),
            )
            val nextStore = AndroidSlottedNativeSessionStore(
                AndroidPreferencesSessionSlotDirectory(next), AndroidKeystoreSessionSecretVault(next),
            )
            val session = AndroidAuthenticatedNativeSession(
                bearerToken = "synthetic_migration_token_1234567890",
                expiresAtMs = 2_000_000,
                playerId = "player.synthetic_migration",
            )
            val slot = androidSessionSlotId(session.playerId)
            oldStore.save(slot, session)
            oldStore.setActiveSlotId(slot)

            migrateSessionPreferences(old, next)

            assertEquals(session, nextStore.load(slot, 1_000_000))
            assertEquals(slot, nextStore.activeSlotId())
            assertEquals(session, oldStore.load(slot, 1_000_000))
        } finally {
            context.deleteSharedPreferences(oldName)
            context.deleteSharedPreferences(nextName)
        }
    }
}
