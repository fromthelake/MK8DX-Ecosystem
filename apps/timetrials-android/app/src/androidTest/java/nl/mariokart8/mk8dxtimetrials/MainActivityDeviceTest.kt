package nl.mariokart8.mk8dxtimetrials

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import nl.mariokart8.mk8dxtimetrials.outbox.ANDROID_PRODUCT_CANONICAL_OUTBOX_DIRECTORY
import nl.mariokart8.mk8dxtimetrials.outbox.ANDROID_PRODUCT_PRIVATE_EVIDENCE_DIRECTORY
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test

/**
 * The launcher's own journey, walked through the migrated product (Phase 7/8):
 * Home's one action opens the canonical Post-a-Time task, the task carries the
 * scan as an action of its own, a time published without a session is queued in
 * the local outbox, and Saved results says so.
 *
 * It replaces the journey that pinned the retired entry screen ("SUBMIT TIME
 * TRIAL", `submit-auto-camera`) and the sync-status icon that a phone with an
 * empty outbox never shows — the reason this test had been failing since before
 * this run. It now creates its own pending result through the product and
 * removes it again, so it leaves the phone as it found it.
 */
class MainActivityDeviceTest {
    companion object {
        /**
         * The product remembers where it was, so the launcher test has to say
         * where it starts from: otherwise the previous test's last screen is
         * this test's first one. It runs before the activity is launched.
         */
        @JvmStatic
        @BeforeClass
        fun startFromACleanNavigation() {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            context.getSharedPreferences("mk8dx-product-navigation-v1", android.content.Context.MODE_PRIVATE)
                .edit().clear().commit()
            context.getSharedPreferences("mk8dx-post-time-draft-v1", android.content.Context.MODE_PRIVATE)
                .edit().clear().commit()
        }
    }

    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    /** Press Publish until the state it asks for is there. */
    private fun press(until: () -> Boolean) {
        repeat(5) {
            compose.onNodeWithTag("post-time-publish").performScrollTo().performClick()
            compose.waitForIdle()
            val deadline = System.currentTimeMillis() + 3_000
            while (System.currentTimeMillis() < deadline) {
                if (until()) return
                Thread.sleep(150)
                compose.waitForIdle()
            }
        }
        assertTrue("Publish never reached the state this step waits for", until())
    }

    @Test
    fun launcherMountsHomeTheCanonicalTaskAndRealLocalSavedResults() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val canonicalRoot = File(context.filesDir, ANDROID_PRODUCT_CANONICAL_OUTBOX_DIRECTORY).canonicalFile
        val privateRoot = File(context.noBackupFilesDir, ANDROID_PRODUCT_PRIVATE_EVIDENCE_DIRECTORY).canonicalFile
        val before = canonicalRoot.listFiles()?.map { it.name }.orEmpty().toSet()
        try {
            compose.onNodeWithTag("time-trials-product-title").assertIsDisplayed()
            compose.onNodeWithText("Android migration baseline").assertDoesNotExist()

            // Home's A4 opens the task; without a track it asks which one.
            compose.onNodeWithTag("time-trials-open-manual").performClick()
            compose.onNodeWithText("WHICH TRACK?").assertIsDisplayed()
            compose.onNodeWithTag("cup-selection-0").performClick()
            compose.onNodeWithTag("track-selection-row-0").performClick()
            compose.onNodeWithText("Mario Kart Stadium").assertIsDisplayed()

            // The scan is an action inside the form, and a task of its own.
            compose.onNodeWithTag("post-time-scan").performScrollTo().performClick()
            compose.waitForIdle()
            // The included scanner first asks which result-screen layout is shown.
            compose.onNodeWithTag("scan-layout-picker").assertIsDisplayed()
            compose.onNodeWithTag("product-navigation").assertDoesNotExist()
            compose.onNodeWithTag("product-task-bar").assertIsDisplayed()
            compose.onNodeWithTag("product-task-close").performClick()
            // The way back from the scanner is the same form, not a new one.
            compose.waitUntil(5_000) {
                compose.onAllNodesWithTag("post-time-total").fetchSemanticsNodes().isNotEmpty()
            }

            // Back in the same form: a total is enough to publish, and without a
            // session the publication is queued on this phone.
            // A six-digit field is full once it holds a time, so a run that
            // inherits one clears it before typing its own.
            compose.onNodeWithTag("post-time-total").performScrollTo().performTextClearance()
            compose.onNodeWithTag("post-time-total").performTextInput("145912")
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Everything checks out.").fetchSemanticsNodes().isNotEmpty()
            }
            // The panel answers before the publication is armed: the board it
            // predicts from arrives over the network, and the page settles once
            // it has (or once it has said it could not read it).
            compose.waitUntil(15_000) {
                compose.onAllNodesWithText("Predicted position", substring = true)
                    .fetchSemanticsNodes().isNotEmpty() ||
                    compose.onAllNodesWithText("Outside the top 100.").fetchSemanticsNodes().isNotEmpty() ||
                    compose.onAllNodesWithText("needs the leaderboard", substring = true)
                        .fetchSemanticsNodes().isNotEmpty()
            }
            // The task keeps loading while the Player works — the leaderboard it
            // predicts from arrives whenever the network answers — so a press is
            // repeated until the state it asks for is there, rather than assumed
            // to have landed on the first attempt.
            press(until = {
                compose.onAllNodesWithText("Confirm and publish · 150cc").fetchSemanticsNodes().isNotEmpty()
            })
            press(until = {
                (canonicalRoot.listFiles()?.map { it.name }.orEmpty().toSet() - before).size == 1
            })
            compose.onNodeWithTag("post-time-status").performScrollTo().assertIsDisplayed()

            // The header now carries what is waiting, and Saved results is real.
            // The count is polled, so the icon appears a moment after the save.
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("product-sync-status").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("product-sync-status").performClick()
            compose.onNodeWithText("Sign in to synchronize saved results").assertIsDisplayed()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Pending").fetchSemanticsNodes().isNotEmpty()
            }

            assertTrue(canonicalRoot.isDirectory)
            assertTrue(privateRoot.isDirectory)
            assertFalse(canonicalRoot.path.startsWith(privateRoot.path + File.separator))
            assertFalse(privateRoot.path.startsWith(canonicalRoot.path + File.separator))
        } finally {
            canonicalRoot.listFiles().orEmpty()
                .filter { it.name !in before }
                .forEach { it.deleteRecursively() }
        }
    }
}
