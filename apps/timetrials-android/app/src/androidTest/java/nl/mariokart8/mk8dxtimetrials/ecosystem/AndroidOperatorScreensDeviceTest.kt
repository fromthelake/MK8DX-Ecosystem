package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.FileOutputStream
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Rule
import org.junit.Test

/**
 * A13 Administration and A14's update wall, on a device.
 *
 * Neither can be reached from a signed-out phone — one needs an administrator
 * session, the other needs the server to retire this build — so both are
 * rendered here against fixtures. The floor check and the administrator check
 * are not touched by these tests; what is asserted is the migrated
 * presentation: the figures, their words, and the one action each page offers.
 */
class AndroidOperatorScreensDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private val overview = AndroidAdministrationOverview(
        registered = AndroidAdministrationRegistered(
            signInIdentities = 1_284,
            accounts = 1_190,
            players = 2_407,
            linkedPlayers = 1_106,
            administrators = 2,
        ),
        active = AndroidAdministrationActive(
            last24h = AndroidAdministrationWindow(signedIn = 42, submitted = 1_337),
            last7d = AndroidAdministrationWindow(signedIn = 310, submitted = 9_812),
            last30d = AndroidAdministrationWindow(signedIn = 902, submitted = 24_005),
        ),
        pending = AndroidAdministrationPending(playerClaims = 3),
    )

    private fun capture(name: String) {
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        val file = InstrumentationRegistry.getInstrumentation().targetContext
            .getExternalFilesDir(null)!!.resolve(name)
        FileOutputStream(file).use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand("cp ${file.absolutePath} /sdcard/Download/$name").close()
    }

    @Test
    fun administrationPrintsItsFiguresWithTheLanguagesSeparators() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(390.dp)) {
                    AndroidAdministrationContent(
                        overview, null, AndroidProductLanguage.ENGLISH, {}, {},
                    )
                }
            }
        }

        compose.onNodeWithTag("administration-screen").assertIsDisplayed()
        compose.onNodeWithTag("administration-pending-claims").assertIsDisplayed()
        compose.onNodeWithText("1,284", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("administration-active-24h").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("42 signed in · 1,337 submitted", useUnmergedTree = true)
            .assertIsDisplayed()
        compose.onNodeWithTag("administration-back").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("administration-refresh").performScrollTo().assertIsDisplayed()
        capture("mk8dx-administration-dark-390.png")
    }

    @Test
    fun administrationInDutchGroupsThousandsWithDots() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Light) {
                Box(Modifier.width(390.dp)) {
                    AndroidAdministrationContent(
                        overview, null, AndroidProductLanguage.DUTCH, {}, {},
                    )
                }
            }
        }

        compose.onNodeWithText("1.284", useUnmergedTree = true).assertIsDisplayed()
        // Display type is drawn in caps by the system (§3).
        compose.onNodeWithText("BEHEER", useUnmergedTree = true).assertIsDisplayed()
        capture("mk8dx-administration-light-nl-390.png")
    }

    @Test
    fun aRefusedOverviewSaysSoWithoutHidingTheWayBack() {
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(390.dp)) {
                    AndroidAdministrationContent(
                        null,
                        "Administrator access is required.",
                        AndroidProductLanguage.ENGLISH,
                        {},
                        {},
                    )
                }
            }
        }

        compose.onNodeWithText("Administrator access is required.").assertIsDisplayed()
        compose.onNodeWithTag("administration-back").assertIsDisplayed()
    }

    @Test
    fun theUpdateWallKeepsItsWordsAndItsOneAction() {
        val retired = AndroidRetiredBuild(
            installedVersionName = "3.14.0",
            installedBuild = 314,
            currentVersion = "3.15.0",
            downloadPagePath = "/?apps=1",
            message = "This build sent times without their engine class.",
        )
        compose.setContent {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(390.dp)) {
                    AndroidUpdateRequiredScreen(retired, AndroidProductLanguage.ENGLISH, 2) {}
                }
            }
        }

        compose.onNodeWithTag("update-required").assertIsDisplayed()
        compose.onNodeWithText("UPDATE REQUIRED").assertIsDisplayed()
        compose.onNodeWithText("This version of MK8DX Time Trials has been switched off.")
            .assertIsDisplayed()
        compose.onNodeWithText("This build sent times without their engine class.")
            .assertIsDisplayed()
        compose.onNodeWithText("3.14.0 (314)", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("3.15.0", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(
            "Your accounts and your 2 unsent results stay on this phone and are kept by the update.",
        ).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("update-required-download").performScrollTo().assertIsDisplayed()
        capture("mk8dx-update-required-dark-390.png")
    }
}
