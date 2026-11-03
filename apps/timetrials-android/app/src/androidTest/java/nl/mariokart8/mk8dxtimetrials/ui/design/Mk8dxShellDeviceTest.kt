package nl.mariokart8.mk8dxtimetrials.ui.design

import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.content.ContextCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.content.Context
import android.content.res.Configuration
import nl.mariokart8.mk8dxtimetrials.R
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The shell (Phase 5): what the five tabs tell a screen reader, what task mode
 * replaces them with, when the global action is filled, and that the splash
 * background really is the product surface token.
 */
@RunWith(AndroidJUnit4::class)
class Mk8dxShellDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private fun hasRole(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun theFiveTabsAreAnnouncedAsTabsWithOneSelected() {
        var chosen: String? = null
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Mk8dxBottomTabs(
                    destinations = listOf(
                        Mk8dxTabDestination("HOME", "Home", painterResource(R.drawable.ic_nav_home)),
                        Mk8dxTabDestination("MANUAL_ENTRY", "Tracks", painterResource(R.drawable.ic_nav_submit)),
                        Mk8dxTabDestination("RANK", "Ranking", painterResource(R.drawable.ic_nav_rank)),
                        Mk8dxTabDestination("BUILD", "Build", painterResource(R.drawable.ic_nav_build)),
                        Mk8dxTabDestination("TOURNAMENT", "Tournaments", painterResource(R.drawable.ic_nav_tournament)),
                    ),
                    selectedKey = "RANK",
                    onSelect = { chosen = it.key },
                )
            }
        }
        compose.onNode(hasText("Ranking").and(hasRole(Role.Tab))).assertIsSelected()
        compose.onNode(hasText("Home").and(hasRole(Role.Tab))).assertIsNotSelected()
        // Every destination is a named tab: nothing is a nameless icon.
        for (label in listOf("Home", "Tracks", "Ranking", "Build", "Tournaments")) {
            compose.onNode(hasText(label).and(hasRole(Role.Tab))).assertExists()
        }
        compose.onNode(hasText("Tournaments").and(hasRole(Role.Tab))).performClick()
        assertEquals("TOURNAMENT", chosen)
    }

    @Test
    fun taskModeOffersATitleAndOneWayOut() {
        var closed = 0
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Mk8dxTaskBar("Scan a result", { closed += 1 }, "Close")
            }
        }
        compose.onNodeWithTag("product-task-title").assertExists()
        compose.onNodeWithText("Scan a result").assertExists()
        compose.onNodeWithTag("product-task-close").performClick()
        assertEquals(1, closed)
    }

    @Test
    fun theGlobalActionIsFilledOnlyWhereTheRouteHasNoPrimaryOfItsOwn() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Mk8dxDockedAction("Post a time", {}, Mk8dxGlobalActionLevel.Hidden)
            }
        }
        compose.onNodeWithTag("product-docked-action").assertDoesNotExist()
    }

    @Test
    fun theDockedActionCarriesTheStopwatchAction() {
        var pressed = 0
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Mk8dxDockedAction("Post a time", { pressed += 1 }, Mk8dxGlobalActionLevel.Filled)
            }
        }
        compose.onNodeWithTag("product-docked-action").assertExists()
        compose.onNode(hasText("Post a time").and(hasRole(Role.Button))).performClick()
        assertEquals(1, pressed)
    }

    /**
     * Phase 17: the default appearance is System, so the splash follows the
     * phone's night mode. Both halves must still be the generated surface
     * token for that appearance - there is no token adapter for resource XML.
     */
    @Test
    fun theSplashBackgroundIsTheProductSurfaceTokenForBothNightModes() {
        val night = context.resources.configuration.uiMode and
            Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        val expected =
            if (night) Mk8dxTokens.Dark.surfaceApp else Mk8dxTokens.Light.surfaceApp
        assertEquals(
            expected.toArgb(),
            ContextCompat.getColor(context, R.color.mk8dx_splash_background),
        )
        // And the other half is the other token, read through a configuration
        // the test flips itself rather than by turning the device over.
        val other = Configuration(context.resources.configuration).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
                if (night) Configuration.UI_MODE_NIGHT_NO else Configuration.UI_MODE_NIGHT_YES
        }
        val flipped = context.createConfigurationContext(other)
        assertEquals(
            (if (night) Mk8dxTokens.Light.surfaceApp else Mk8dxTokens.Dark.surfaceApp).toArgb(),
            ContextCompat.getColor(flipped, R.color.mk8dx_splash_background),
        )
    }
}
