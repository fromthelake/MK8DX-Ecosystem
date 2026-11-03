package nl.mariokart8.mk8dxtimetrials.scan

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import android.Manifest
import androidx.test.platform.app.InstrumentationRegistry
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Rule
import org.junit.Test

/**
 * A03 after the migration: the scan screen is the camera, the gallery and the
 * engine. It has no review of its own — what it recognises is handed to the
 * canonical Post-a-Time task — and it keeps the track and the class explicit,
 * which is what stops a 200cc ghost being saved as a 150cc time.
 */
class AndroidScanProductScreenDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun selectedTrackAndModeRemainExplicitBeforeAuthenticationAndRuntime() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) { AndroidScanProductScreen() }
        }

        compose.onNodeWithTag("cup-selection-0").performClick()
        compose.onNodeWithTag("track-selection-row-0").performClick()
        compose.onNodeWithTag("scan-product-selected-track").assertIsDisplayed()
        compose.onNodeWithText("150cc").assertIsSelected()
        compose.onNodeWithText("200cc").performClick()
        compose.onNodeWithText("200cc").assertIsSelected()
        compose.onNodeWithText("Sign in before saving").assertIsDisplayed()
        compose.onNodeWithTag("scan-product-change-track").performClick()
        compose.onNodeWithTag("track-selection-title").assertIsDisplayed()
    }

    @Test
    fun theClassChosenOnTheTrackScreenIsTheScansClass() {
        // A 200cc track opened the scanner on 150cc and a 200cc ghost was saved
        // as 150cc (owner, 2026-09-18).
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                AndroidScanProductScreen(initialTrackId = "track.snes_mario_circuit_3", initialMode = 200)
            }
        }

        compose.onNodeWithTag("scan-product-selected-track").assertIsDisplayed()
        compose.onNodeWithText("200cc").assertIsSelected()
    }

    @Test
    fun trustedContextAndOfflineAnalyzerChooseLayoutThenOpenCameraDirectly() {
        val contextFactory = AndroidTrustedScanSubmissionContextFactory(
            playerId = "player.owner_01",
            producerVersion = "android-scan-device-test",
            opaqueIdProvider = { "scan-product-device-0001" },
            clock = nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock { 1_786_918_000_000 },
        )
        val analyzerFactory = ContextualResultImageAnalyzerFactory {
            ResultImageAnalyzer { error("Recognition must stay lazy until image selection") }
        }
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                AndroidScanProductScreen(
                    contextFactory = contextFactory,
                    analyzerFactory = analyzerFactory,
                )
            }
        }

        compose.onNodeWithTag("cup-selection-0").performClick()
        compose.onNodeWithTag("track-selection-row-0").performClick()
        compose.onNodeWithTag("scan-layout-picker").assertIsDisplayed()
        compose.onNodeWithText("The end time(s) shown directly after a run.").assertIsDisplayed()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.grantRuntimePermission(
            instrumentation.targetContext.packageName,
            Manifest.permission.CAMERA,
        )
        compose.onNodeWithTag("scan-layout-choice-endscreen").performClick()
        compose.onNodeWithTag("embedded-scan-camera").assertIsDisplayed()
        compose.onNodeWithTag("result-image-acquisition").assertDoesNotExist()
        // The scan-only review is gone: nothing here saves a result.
        compose.onNodeWithTag("scan-review").assertDoesNotExist()
    }
}
