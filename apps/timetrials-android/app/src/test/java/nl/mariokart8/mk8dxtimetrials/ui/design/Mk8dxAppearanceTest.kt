package nl.mariokart8.mk8dxtimetrials.ui.design

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ADR-0205 and DESIGN_SYSTEM §19 as tests: the choice is what travels, the
 * device resolves it, and high contrast is never stored.
 */
class Mk8dxAppearanceTest {
    @Test
    fun `a device on System follows its own OS, and an explicit choice does not`() {
        assertEquals(
            Mk8dxAppearance.Dark,
            mk8dxResolveAppearance(Mk8dxAppearanceChoice.System, systemDark = true, highContrast = false),
        )
        assertEquals(
            Mk8dxAppearance.Light,
            mk8dxResolveAppearance(Mk8dxAppearanceChoice.System, systemDark = false, highContrast = false),
        )
        assertEquals(
            Mk8dxAppearance.Light,
            mk8dxResolveAppearance(Mk8dxAppearanceChoice.Light, systemDark = true, highContrast = false),
        )
        assertEquals(
            Mk8dxAppearance.Dark,
            mk8dxResolveAppearance(Mk8dxAppearanceChoice.Dark, systemDark = false, highContrast = false),
        )
    }

    @Test
    fun `high contrast follows the OS and wins over every choice`() {
        for (choice in Mk8dxAppearanceChoice.entries) {
            assertEquals(
                Mk8dxAppearance.HighContrast,
                mk8dxResolveAppearance(choice, systemDark = false, highContrast = true),
            )
            assertEquals(
                Mk8dxAppearance.HighContrast,
                mk8dxResolveAppearance(choice, systemDark = true, highContrast = true),
            )
        }
    }

    @Test
    fun `never chosen follows the phone without pretending a choice was made`() {
        val cache = Mk8dxAppearanceCache()
        assertNull(cache.choice)
        // Phase 17: every product screen is on the tokens, so "never chosen"
        // is ADR-0205's System again. It is still not a stored choice.
        assertEquals(Mk8dxAppearanceChoice.System, MK8DX_DEFAULT_APPEARANCE_CHOICE)
        assertEquals(MK8DX_DEFAULT_APPEARANCE_CHOICE, cache.effectiveChoice)
        assertEquals(
            Mk8dxAppearance.Light,
            mk8dxResolveAppearance(cache.effectiveChoice, systemDark = false, highContrast = false),
        )
        assertEquals(
            Mk8dxAppearance.Dark,
            mk8dxResolveAppearance(cache.effectiveChoice, systemDark = true, highContrast = false),
        )
    }

    @Test
    fun `the account value is canonical and replaces a differing cache`() {
        val cache = Mk8dxAppearanceCache(Mk8dxAppearanceChoice.System, updatedAtMs = 10, synced = true)
        val hydrated = mk8dxHydrateAppearance(cache, Mk8dxAppearanceChoice.Dark, lastHydrationAtMs = 20, nowMs = 30)
        assertEquals(Mk8dxAppearanceChoice.Dark, hydrated.cache.choice)
        assertTrue(hydrated.cache.synced)
        assertNull(hydrated.upload)
    }

    @Test
    fun `an offline explicit change newer than the last hydration is uploaded instead`() {
        val cache = Mk8dxAppearanceCache(Mk8dxAppearanceChoice.Light, updatedAtMs = 50, synced = false)
        val hydrated = mk8dxHydrateAppearance(cache, Mk8dxAppearanceChoice.Dark, lastHydrationAtMs = 20, nowMs = 60)
        assertEquals(Mk8dxAppearanceChoice.Light, hydrated.cache.choice)
        assertEquals(Mk8dxAppearanceChoice.Light, hydrated.upload)
    }

    @Test
    fun `an unsynced change older than the last hydration loses to the account`() {
        val cache = Mk8dxAppearanceCache(Mk8dxAppearanceChoice.Light, updatedAtMs = 10, synced = false)
        val hydrated = mk8dxHydrateAppearance(cache, Mk8dxAppearanceChoice.Dark, lastHydrationAtMs = 20, nowMs = 60)
        assertEquals(Mk8dxAppearanceChoice.Dark, hydrated.cache.choice)
        assertNull(hydrated.upload)
    }

    @Test
    fun `an account with no value leaves the local choice local and uploads nothing`() {
        val cache = Mk8dxAppearanceCache(Mk8dxAppearanceChoice.Light, updatedAtMs = 10, synced = true)
        val hydrated = mk8dxHydrateAppearance(cache, accountChoice = null, lastHydrationAtMs = 20, nowMs = 60)
        assertEquals(Mk8dxAppearanceChoice.Light, hydrated.cache.choice)
        assertNull(hydrated.upload)
    }

    @Test
    fun `an explicit change that never landed is retried even on an empty account`() {
        val cache = Mk8dxAppearanceCache(Mk8dxAppearanceChoice.Light, updatedAtMs = 50, synced = false)
        val hydrated = mk8dxHydrateAppearance(cache, accountChoice = null, lastHydrationAtMs = 20, nowMs = 60)
        assertEquals(Mk8dxAppearanceChoice.Light, hydrated.upload)
        assertFalse(hydrated.cache.synced)
    }

    @Test
    fun `an agreeing account marks the cache synced without changing the choice`() {
        val cache = Mk8dxAppearanceCache(Mk8dxAppearanceChoice.Dark, updatedAtMs = 10, synced = false)
        val hydrated = mk8dxHydrateAppearance(cache, Mk8dxAppearanceChoice.Dark, lastHydrationAtMs = 5, nowMs = 60)
        assertEquals(Mk8dxAppearanceChoice.Dark, hydrated.cache.choice)
        assertTrue(hydrated.cache.synced)
        assertNull(hydrated.upload)
    }

    @Test
    fun `two devices on System resolve differently from the same account choice`() {
        val account = Mk8dxAppearanceChoice.System
        assertEquals(Mk8dxAppearance.Dark, mk8dxResolveAppearance(account, systemDark = true, highContrast = false))
        assertEquals(Mk8dxAppearance.Light, mk8dxResolveAppearance(account, systemDark = false, highContrast = false))
    }

    @Test
    fun `the wire values are the ones the account field stores`() {
        assertEquals("system", Mk8dxAppearanceChoice.System.wireValue)
        assertEquals("light", Mk8dxAppearanceChoice.Light.wireValue)
        assertEquals("dark", Mk8dxAppearanceChoice.Dark.wireValue)
        assertEquals(Mk8dxAppearanceChoice.Dark, Mk8dxAppearanceChoice.ofWire("dark"))
        assertNull(Mk8dxAppearanceChoice.ofWire("sepia"))
        assertNull(Mk8dxAppearanceChoice.ofWire(null))
    }

    @Test
    fun `text size is device local and defaults to 100 percent`() {
        assertEquals(1f, Mk8dxTextSize.ofWire(null).scale, 0f)
        assertEquals(1.15f, Mk8dxTextSize.ofWire("115").scale, 0f)
        assertEquals(1.30f, Mk8dxTextSize.ofWire("130").scale, 0f)
        assertEquals(Mk8dxTextSize.Normal, Mk8dxTextSize.ofWire("200"))
    }

    @Test
    fun `reduced motion defaults to following the system`() {
        assertEquals(Mk8dxMotionPreference.System, Mk8dxMotionPreference.ofWire(null))
        assertEquals(Mk8dxMotionPreference.Reduced, Mk8dxMotionPreference.ofWire("reduced"))
    }

    @Test
    fun `signed out sync keeps the choice on the device`() {
        assertNull(Mk8dxNoAppearanceSync.readAccountChoice())
        assertFalse(Mk8dxNoAppearanceSync.writeAccountChoice(Mk8dxAppearanceChoice.Dark))
    }
}
