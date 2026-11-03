package nl.mariokart8.mk8dxtimetrials.ui.design

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Settings → Appearance on a device (Phase 4): the three choices are announced
 * as a selected radio group, the choice is written to the ADR-0205 cache, and
 * text size and motion stay device-local.
 */
@RunWith(AndroidJUnit4::class)
class Mk8dxAppearanceDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private fun hasRole(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Before
    fun clearTheCache() {
        context.getSharedPreferences(Mk8dxAppearanceStore.NAME, Context.MODE_PRIVATE)
            .edit().clear().commit()
    }

    @Test
    fun theAppearanceChoiceIsAnnouncedAndStoredWithItsSyncState() {
        var stored: Mk8dxAppearanceSettings? = null
        compose.setContent {
            var settings by remember { mutableStateOf(Mk8dxAppearanceSettings()) }
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Mk8dxAppearanceSection(
                    settings = settings,
                    onSettingsChanged = { settings = it; stored = it },
                    nl = false,
                )
            }
        }
        val system = compose.onNode(hasText("System").and(hasRole(Role.RadioButton)))
        val light = compose.onNode(hasText("Light").and(hasRole(Role.RadioButton)))
        // Nobody has chosen yet, so the section shows ADR-0205's default: the
        // product follows the phone (Phase 17; it was Dark while the screens
        // were dark-only).
        system.assertIsSelected()
        light.assertIsNotSelected().performClick()
        light.assertIsSelected()
        assertEquals(Mk8dxAppearanceChoice.Light, stored?.cache?.choice)
        // An explicit change is not synced until the account has taken it.
        assertFalse(stored!!.cache.synced)
    }

    @Test
    fun textSizeAndMotionStayOnTheDevice() {
        var stored: Mk8dxAppearanceSettings? = null
        compose.setContent {
            var settings by remember { mutableStateOf(Mk8dxAppearanceSettings()) }
            Mk8dxTheme(Mk8dxAppearance.Light) {
                Mk8dxAppearanceSection(
                    settings = settings,
                    onSettingsChanged = { settings = it; stored = it },
                    nl = false,
                )
            }
        }
        compose.onNodeWithTag("appearance-text-size").assertExists()
        compose.onNode(hasText("115 %").and(hasRole(Role.RadioButton))).performClick()
        assertEquals(Mk8dxTextSize.Large, stored?.textSize)
        assertNull(stored?.cache?.choice)
        compose.onNode(hasText("Reduce motion").and(hasRole(Role.RadioButton))).performClick()
        assertEquals(Mk8dxMotionPreference.Reduced, stored?.motion)
    }

    @Test
    fun theDeviceCacheRoundTripsTheAdr0205Fields() {
        val store = Mk8dxAppearanceStore(context)
        assertNull(store.read().cache.choice)
        val settings = Mk8dxAppearanceSettings(
            cache = Mk8dxAppearanceCache(Mk8dxAppearanceChoice.Dark, updatedAtMs = 1_234, synced = false),
            textSize = Mk8dxTextSize.Largest,
            motion = Mk8dxMotionPreference.Reduced,
            hydratedAtMs = 99,
        )
        store.write(settings)
        assertEquals(settings, Mk8dxAppearanceStore(context).read())
    }

    @Test
    fun theDutchSectionUsesTheDutchWords() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Mk8dxAppearanceSection(
                    settings = Mk8dxAppearanceSettings(),
                    onSettingsChanged = {},
                    nl = true,
                )
            }
        }
        compose.onNode(hasText("Systeem").and(hasRole(Role.RadioButton))).assertIsSelected()
        compose.onNode(hasText("Donker").and(hasRole(Role.RadioButton))).assertIsNotSelected()
    }
}
