package nl.mariokart8.mk8dxtimetrials.notifications

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Whether the app still owes a Player the notification question.
 *
 * This is the decision that was missing, not the dialog: Android 13 stopped
 * granting `POST_NOTIFICATIONS` at install, so an app that never asks is
 * silently unable to notify anybody. The rule has to hold on a real device
 * because it reads the platform's own permission state, which no JVM test can
 * stand in for.
 */
@RunWith(AndroidJUnit4::class)
class AndroidNotificationPermissionAskDeviceTest {

    private lateinit var context: Context

    @Before
    fun clean() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        // The instrumented app is installed without the permission granted and
        // the test starts from a phone that has never been asked.
        context.getSharedPreferences("mk8dx-canonical-notification-projection-v1", Context.MODE_PRIVATE)
            .edit().clear().commit()
    }

    @Test
    fun aPhoneThatHasNeverBeenAskedIsStillOwedTheQuestion() {
        assertFalse(
            "the test app must run without the permission for this to mean anything",
            permissionGranted(context),
        )
        assertTrue(AndroidNotificationProjectionSettings.shouldAskPermission(context))
    }

    @Test
    fun anAnswerIsAnAnswer() {
        AndroidNotificationProjectionSettings.recordPermissionAsked(context)
        // A refusal is recorded the same way a grant is, so nobody is nagged.
        assertFalse(AndroidNotificationProjectionSettings.shouldAskPermission(context))
    }

    @Test
    fun grantingAlsoSwitchesTheProjectionOn() {
        // The app keeps a second switch of its own, off by default. A Player
        // who says yes to Android and still sees nothing is the bug this
        // guards: the two gates are one question.
        assertFalse(AndroidNotificationProjectionSettings.enabled(context))
        AndroidNotificationProjectionSettings.enable(context)
        assertTrue(AndroidNotificationProjectionSettings.enabled(context))
    }
}
