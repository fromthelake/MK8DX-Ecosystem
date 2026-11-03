package nl.mariokart8.mk8dxtimetrials.notifications

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext

/**
 * Asks a signed-in Player, once, whether the app may notify them.
 *
 * Android 13 stopped granting `POST_NOTIFICATIONS` at install time. Declaring
 * it in the manifest is no longer enough: until the app asks, every
 * notification it posts is dropped without a word, which is exactly what was
 * happening here - installed, signed in, and silently mute. The app did have
 * the question, but only behind a button in Settings that somebody had to go
 * and find.
 *
 * It is asked when a Player is signed in and not before, because that is when
 * a notification means anything: the inbox is personal, and a phone with
 * nobody signed in has nothing to be told about. The answer is recorded
 * whichever way it goes, so a refusal is never asked twice; Settings is where
 * somebody changes their mind, and it already offers the way into Android's
 * own settings when the answer was no.
 *
 * Granting it also switches the projection on. Without that a Player who said
 * yes to Android would still have seen nothing, because this app keeps its own
 * second switch, off by default - two gates, one question.
 */
@Composable
internal fun AndroidNotificationPermissionRequest(playerId: String?) {
    if (Build.VERSION.SDK_INT < 33) { return }
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { accepted ->
        AndroidNotificationProjectionSettings.recordPermissionAsked(context)
        if (accepted) { AndroidNotificationProjectionSettings.enable(context) }
    }
    LaunchedEffect(playerId) {
        if (playerId == null) { return@LaunchedEffect }
        if (!AndroidNotificationProjectionSettings.shouldAskPermission(context)) {
            // Already answered - and if the answer was yes, this app's own
            // switch has to follow, or the phone stays silent behind a
            // permission that was granted.
            AndroidNotificationProjectionSettings.ensureEnabled(context)
            return@LaunchedEffect
        }
        launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
