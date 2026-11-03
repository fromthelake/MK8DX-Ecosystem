package nl.mariokart8.mk8dxtimetrials.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.AndroidLocalInstallationProfile
import nl.mariokart8.mk8dxtimetrials.BuildConfig
import nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin
import nl.mariokart8.mk8dxtimetrials.MainActivity
import nl.mariokart8.mk8dxtimetrials.R
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession
import nl.mariokart8.mk8dxtimetrials.auth.AndroidKeystoreNativeSessionStore
import nl.mariokart8.mk8dxtimetrials.auth.androidPlayerLabel
import nl.mariokart8.mk8dxtimetrials.auth.androidSessionSlotId
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidEcosystemConnectionOpener
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidNotification
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidNotificationPreferences
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemClient
import nl.mariokart8.mk8dxtimetrials.ecosystem.availableAfter
import nl.mariokart8.mk8dxtimetrials.deeplink.parseAndroidDeepLink
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguageStore
import nl.mariokart8.mk8dxtimetrials.ui.androidText

internal const val EXTRA_CANONICAL_NOTIFICATION_ID = "mk8dx.notification.id"
internal const val EXTRA_NOTIFICATION_PLAYER_ID = "mk8dx.notification.player"
internal const val EXTRA_NOTIFICATION_SLOT_ID = "mk8dx.notification.slot"
internal const val EXTRA_NOTIFICATION_TRACK_ID = "mk8dx.notification.track"
internal const val EXTRA_NOTIFICATION_MODE = "mk8dx.notification.mode"
/** The site address this notification is about; see [androidNotificationLink]. */
internal const val EXTRA_NOTIFICATION_LINK = "mk8dx.notification.link"

private const val settingsName = "mk8dx-canonical-notification-projection-v1"
private const val enabledKey = "enabled"
private const val enabledAtKey = "enabled-at-ms"
private const val permissionAskedKey = "permission-asked"
private const val turnedOffKey = "turned-off"
private const val shownReleaseKey = "shown-release-build"
private const val shownPrefix = "shown."
private const val pendingReadPrefix = "pending-read."
private const val periodicWork = "mk8dx-canonical-notification-sync-periodic-v1"
private const val immediateWork = "mk8dx-canonical-notification-sync-immediate-v1"
private const val followUpWork = "mk8dx-canonical-notification-sync-follow-up-v1"

/**
 * How soon the inbox is read again after a pass, when the app is not open.
 *
 * WorkManager will not schedule *periodic* work more often than every fifteen
 * minutes - that is the platform's floor, not a number this app chose - and
 * fifteen minutes is a long time to wait to hear that somebody took your time
 * on a track. So each pass also asks for one more, five minutes out, under its
 * own unique name; the periodic one stays as the net that catches the chain
 * whenever Android drops it.
 *
 * Five and not one: the chain is a wake-up with a network request on it, and a
 * phone that has not been given the battery exemption will have it batched or
 * refused anyway. Below five the cost is real and the gain is the OS's to
 * give. Instant delivery is push, and push here means the UnifiedPush
 * direction in `AGENTS.md`, not a shorter timer.
 */
private const val FOLLOW_UP_MINUTES = 5L
// The channels carry a version in their id, and this is why.
//
// A channel's importance belongs to the person, not to the app: once a channel
// exists, `createNotificationChannel` may change its name and its description
// and nothing else. The first two were created at IMPORTANCE_DEFAULT, which on
// Android means the shade and a sound but **no banner over what you are
// doing** - so an overtake arrived silently, and the owner reasonably read
// that as "no pop-up". Raising them in place is not possible; a new id is the
// only way to offer a phone the better default. The old two are deleted so
// Android's own settings do not list four channels for two kinds of news.
private const val competitiveChannel = "mk8dx_competitive_v2"
private const val activityChannel = "mk8dx_activity_v2"
private val retiredChannels = listOf("mk8dx_competitive", "mk8dx_activity")

internal data class AndroidNotificationTarget(
    val notificationId: String,
    val playerId: String,
    val slotId: String,
    val trackId: String?,
    val mode: Int?,
    /**
     * Where this notification points, as one of the product's own addresses.
     *
     * A tap used to land on manual entry for the track the notification named,
     * whatever the notification was about: a link request opened the entry form
     * for no track at all. The address is decided once, by the same rule the
     * site uses, and the phone routes on it.
     */
    val link: String? = null,
)

internal object AndroidNotificationProjectionSettings {
    fun enabled(context: Context): Boolean = preferences(context).getBoolean(enabledKey, false)

    fun enable(context: Context, nowMs: Long = System.currentTimeMillis()) {
        require(nowMs >= 0)
        preferences(context).edit().putBoolean(enabledKey, true)
            .putBoolean(turnedOffKey, false)
            .putLong(enabledAtKey, nowMs).apply()
        AndroidCanonicalNotificationSync.enqueueImmediate(context)
    }

    fun disable(context: Context) {
        // Remembered as a decision, not just a value: the app switches itself
        // on when Android says it may notify, and it must not undo somebody
        // who deliberately turned it off.
        preferences(context).edit().putBoolean(enabledKey, false)
            .putBoolean(turnedOffKey, true).apply()
        clearAll(context)
    }

    /**
     * Switch the projection on where nobody has said otherwise.
     *
     * There are two gates: Android's own permission, and this app's switch.
     * Granting the permission switches this on - but only through the question
     * the app asks. A Player who had already granted it (from the button in
     * Settings, before the app asked on its own) was never taken through that
     * path, so the second gate stayed shut and the phone stayed silent while
     * the header still counted unread entries. That is the defect the owner
     * saw: "ik zie ongelezen maar niet gelijk het bericht", and no pop-up at
     * all with the app closed.
     *
     * The stamp is set two days back rather than to now, so an entry that
     * arrived while the app was mute still reaches the phone once.
     */
    fun ensureEnabled(context: Context, nowMs: Long = System.currentTimeMillis()) {
        val preferences = preferences(context)
        if (preferences.getBoolean(enabledKey, false)) return
        if (preferences.getBoolean(turnedOffKey, false)) return
        if (!permissionGranted(context)) return
        preferences.edit().putBoolean(enabledKey, true)
            .putLong(enabledAtKey, (nowMs - 2 * 86_400_000L).coerceAtLeast(0L)).apply()
        AndroidCanonicalNotificationSync.enqueueImmediate(context)
    }

    /** Whether somebody deliberately turned notifications off. */
    fun silenced(context: Context): Boolean =
        preferences(context).getBoolean(turnedOffKey, false)

    /** The newest build this phone has already been told about. */
    fun shownRelease(context: Context): Int = preferences(context).getInt(shownReleaseKey, 0)

    fun recordShownRelease(context: Context, versionCode: Int) {
        preferences(context).edit().putInt(shownReleaseKey, versionCode).apply()
    }

    fun permissionAsked(context: Context): Boolean = preferences(context).getBoolean(permissionAskedKey, false)

    /**
     * Whether the app still owes a signed-in Player the question.
     *
     * Android 13 stopped granting `POST_NOTIFICATIONS` at install: an app that
     * only declares it is silently unable to notify anybody until it asks, and
     * this one only ever asked from a button inside Settings that a Player had
     * to go and find. So it was installed, signed in, and quietly mute.
     *
     * Asked once, and only once - a refusal is an answer, and the Settings
     * card is where somebody changes their mind.
     */
    fun shouldAskPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT >= 33 &&
            !permissionAsked(context) &&
            !permissionGranted(context)
    fun recordPermissionAsked(context: Context) {
        preferences(context).edit().putBoolean(permissionAskedKey, true).apply()
    }

    fun clearAccount(context: Context, slotId: String) {
        val preferences = preferences(context)
        val prefix = "$shownPrefix$slotId."
        val editor = preferences.edit()
        preferences.all.keys.filter { it.startsWith(prefix) }.forEach { key ->
            val notificationId = key.substringAfterLast('.')
            NotificationManagerCompat.from(context).cancel(notificationTag(slotId, notificationId), notificationCode(slotId, notificationId))
            editor.remove(key)
        }
        preferences.all.keys.filter { it.startsWith("$pendingReadPrefix$slotId.") }.forEach(editor::remove)
        editor.apply()
    }

    fun queueRead(context: Context, slotId: String, notificationId: String) {
        preferences(context).edit().putBoolean("$pendingReadPrefix$slotId.$notificationId", true).apply()
        AndroidCanonicalNotificationSync.enqueueImmediate(context)
    }

    fun clearQueuedRead(context: Context, slotId: String, notificationId: String) {
        preferences(context).edit().remove("$pendingReadPrefix$slotId.$notificationId").apply()
        NotificationManagerCompat.from(context).cancel(
            notificationTag(slotId, notificationId), notificationCode(slotId, notificationId),
        )
    }

    internal fun queuedReads(context: Context, slotId: String): List<String> {
        val prefix = "$pendingReadPrefix$slotId."
        return preferences(context).all.keys.filter { it.startsWith(prefix) }
            .map { it.removePrefix(prefix) }.filter { it.matches(Regex("^[0-9]{1,19}$")) }
    }

    internal fun enabledAtMs(context: Context): Long = preferences(context).getLong(enabledAtKey, Long.MAX_VALUE)
    internal fun shownRevision(context: Context, slotId: String, notificationId: String): Int =
        preferences(context).getInt(shownKey(slotId, notificationId), 0)
    internal fun recordShown(context: Context, slotId: String, notificationId: String, revision: Int) {
        preferences(context).edit().putInt(shownKey(slotId, notificationId), revision).apply()
    }

    private fun clearAll(context: Context) {
        val preferences = preferences(context)
        val editor = preferences.edit()
        preferences.all.keys.filter { it.startsWith(shownPrefix) }.forEach { key ->
            val fields = key.removePrefix(shownPrefix).split('.', limit = 3)
            if (fields.size == 3) {
                val slotId = "${fields[0]}.${fields[1]}"
                val notificationId = fields[2]
                NotificationManagerCompat.from(context).cancel(notificationTag(slotId, notificationId), notificationCode(slotId, notificationId))
            }
            editor.remove(key)
        }
        editor.apply()
    }

    private fun shownKey(slotId: String, notificationId: String) = "$shownPrefix$slotId.$notificationId"
    private fun preferences(context: Context) = context.getSharedPreferences(settingsName, Context.MODE_PRIVATE)
}

internal object AndroidCanonicalNotificationSync {
    private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedule(context: Context) {
        val work = PeriodicWorkRequestBuilder<AndroidCanonicalNotificationWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            periodicWork, ExistingPeriodicWorkPolicy.KEEP, work,
        )
    }

    fun enqueueImmediate(context: Context) {
        val work = OneTimeWorkRequestBuilder<AndroidCanonicalNotificationWorker>()
            .setConstraints(constraints).build()
        WorkManager.getInstance(context).enqueueUniqueWork(immediateWork, ExistingWorkPolicy.REPLACE, work)
    }

    /** One more pass in five minutes; REPLACE, so there is only ever one. */
    fun enqueueFollowUp(context: Context) {
        val work = OneTimeWorkRequestBuilder<AndroidCanonicalNotificationWorker>()
            .setConstraints(constraints)
            .setInitialDelay(FOLLOW_UP_MINUTES, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(followUpWork, ExistingWorkPolicy.REPLACE, work)
    }
}

internal class AndroidCanonicalNotificationWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(appContext, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val server = AndroidServerOrigin.current(applicationContext) ?: return@withContext Result.success()
        createChannels(applicationContext)
        val store = AndroidKeystoreNativeSessionStore(applicationContext)
        val now = System.currentTimeMillis()
        // A new build of the app is news about the app rather than about
        // anybody's inbox, so it is not behind the inbox switch - only behind
        // Android's permission and nobody having turned notifications off. It
        // does need a session, because the download catalog is not public.
        store.list(now).filterNot { it.expired }
            .firstNotNullOfOrNull { store.load(it.slotId, now) }
            ?.let { session -> runCatching { projectAvailableUpdate(applicationContext, session) } }
        if (!AndroidNotificationProjectionSettings.enabled(applicationContext) || !permissionGranted(applicationContext)) {
            return@withContext Result.success()
        }
        var temporaryFailure = false
        store.list(now).filterNot { it.expired }.forEach { account ->
            val session = store.load(account.slotId, now) ?: return@forEach
            val client = AndroidTimeTrialsEcosystemClient(
                server,
                session,
                AndroidEcosystemConnectionOpener { url -> url.openConnection() as HttpsURLConnection },
            )
            // Which build this phone runs, said on the same pass that reads the
            // inbox: one small request, and the only place the server can
            // learn it from.
            runCatching {
                client.checkInClient(
                    installationId = AndroidLocalInstallationProfile(applicationContext)
                        .loadOrCreate(),
                    version = BuildConfig.VERSION_NAME,
                    build = BuildConfig.VERSION_CODE,
                    deviceModel = Build.MODEL,
                )
            }
            val settings = runCatching { client.notificationSettings() }
                .onFailure { temporaryFailure = true }
                .getOrNull()
            if (settings != null) {
                runCatching { client.notifications() }.onSuccess { inbox ->
                    inbox?.notifications?.filter { notification ->
                        androidDeliveryAllowed(notification, settings.preferences)
                    }?.forEach { notification ->
                        project(applicationContext, account.slotId, account.playerId, notification)
                    }
                }.onFailure { temporaryFailure = true }
            }
            val pendingReads = AndroidNotificationProjectionSettings.queuedReads(applicationContext, account.slotId)
            if (pendingReads.isNotEmpty()) {
                runCatching { client.markNotificationsRead(pendingReads) }
                    .onSuccess {
                        pendingReads.forEach {
                            AndroidNotificationProjectionSettings.clearQueuedRead(applicationContext, account.slotId, it)
                        }
                    }
                    .onFailure { temporaryFailure = true }
            }
        }
        // Ask again before the periodic pass would: five minutes rather than
        // fifteen. Only where there is something to ask for - a phone with the
        // projection off has nothing to reconcile and should not be woken.
        if (AndroidNotificationProjectionSettings.enabled(applicationContext)) {
            AndroidCanonicalNotificationSync.enqueueFollowUp(applicationContext)
        }
        if (temporaryFailure) Result.retry() else Result.success()
    }
}

internal fun androidDeliveryAllowed(
    notification: AndroidNotification,
    preferences: AndroidNotificationPreferences,
): Boolean = when (notification.kind) {
    "overtaken" -> preferences.competitiveOvertaken
    "reaction_received" -> preferences.activityReactions
    else -> true
}

private fun project(context: Context, slotId: String, playerId: String, notification: AndroidNotification) {
    val manager = NotificationManagerCompat.from(context)
    val tag = notificationTag(slotId, notification.notificationId)
    val code = notificationCode(slotId, notification.notificationId)
    if (notification.read) {
        manager.cancel(tag, code)
        return
    }
    if (notification.lastEventAtMs < AndroidNotificationProjectionSettings.enabledAtMs(context) ||
        notification.count <= AndroidNotificationProjectionSettings.shownRevision(context, slotId, notification.notificationId)
    ) return

    val targetIntent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        putExtra(EXTRA_CANONICAL_NOTIFICATION_ID, notification.notificationId)
        putExtra(EXTRA_NOTIFICATION_PLAYER_ID, playerId)
        putExtra(EXTRA_NOTIFICATION_SLOT_ID, slotId)
        notification.trackId?.let { putExtra(EXTRA_NOTIFICATION_TRACK_ID, it) }
        notification.mode?.let { putExtra(EXTRA_NOTIFICATION_MODE, it) }
        androidNotificationLink(notification)?.let { putExtra(EXTRA_NOTIFICATION_LINK, it) }
    }
    val contentIntent = PendingIntent.getActivity(
        context, code, targetIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val text = androidNotificationPresentation(
        notification, AndroidProductLanguageStore.read(context),
    )
    val accountStore = AndroidKeystoreNativeSessionStore(context)
    val activeAccount = accountStore.activeSlotId()
    val accountDisplayName = runCatching {
        accountStore.list(System.currentTimeMillis())
            .firstOrNull { it.slotId == slotId }
            ?.displayName
    }.getOrNull()
    val accountPrefix = if (activeAccount == slotId) {
        ""
    } else {
        androidText(
            AndroidProductLanguageStore.read(context),
            "For ${androidPlayerLabel(accountDisplayName, playerId)} · ",
            "Voor ${androidPlayerLabel(accountDisplayName, playerId)} · ",
        )
    }
    val built = NotificationCompat.Builder(context, if (notification.kind == "overtaken") competitiveChannel else activityChannel)
        .setSmallIcon(R.drawable.ic_nav_home)
        .setContentTitle(text.title)
        .setContentText(accountPrefix + text.body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(accountPrefix + text.body))
        .setContentIntent(contentIntent)
        .setAutoCancel(true)
        .setOnlyAlertOnce(notification.count > 1)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setDefaults(NotificationCompat.DEFAULT_ALL)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setCategory(NotificationCompat.CATEGORY_SOCIAL)
        .build()
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS,
        ) != PackageManager.PERMISSION_GRANTED
    ) return
    try {
        manager.notify(tag, code, built)
    } catch (_: SecurityException) {
        return
    }
    AndroidNotificationProjectionSettings.recordShown(context, slotId, notification.notificationId, notification.count)
    // If the app is open behind this, the bell should gain the one that just
    // arrived rather than wait out its own timer.
    AndroidNotificationBadge.changed()
}

/**
 * "MK8DX Time Trials 2.66.0 staat klaar" - once per version.
 *
 * It never reached anybody before: a new build only ever showed as a quiet
 * mark in the app's own header, which whoever was not already looking at the
 * app never saw. The owner asked why the phone stays silent about an update,
 * and this is the answer.
 *
 * The download page is a web page and installing an APK happens in a browser,
 * so the tap opens the site. It travels as one of the product's own addresses
 * like every other notification here; the app turns that one into a browser
 * rather than a screen, because it cannot install itself.
 */
private fun projectAvailableUpdate(
    context: Context,
    session: AndroidAuthenticatedNativeSession,
) {
    val language = AndroidProductLanguageStore.read(context)
    // The download catalog is not public - `/v1/app-downloads` refuses an
    // anonymous reader - so this asks as whoever is signed in on this phone.
    val client = AndroidTimeTrialsEcosystemClient(
        AndroidServerOrigin.current(context) ?: return,
        session,
        AndroidEcosystemConnectionOpener { url -> url.openConnection() as HttpsURLConnection },
    )
    val update = runCatching {
        client.latestAndroidRelease()?.availableAfter(BuildConfig.VERSION_CODE)
    }.getOrNull() ?: return
    if (update.versionCode <= AndroidNotificationProjectionSettings.shownRelease(context)) return
    if (!permissionGranted(context) || AndroidNotificationProjectionSettings.silenced(context)) return
    val targetIntent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        putExtra(EXTRA_NOTIFICATION_LINK, "/?apps=1")
    }
    val contentIntent = PendingIntent.getActivity(
        context, update.versionCode, targetIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val built = NotificationCompat.Builder(context, activityChannel)
        .setSmallIcon(R.drawable.ic_nav_home)
        .setContentTitle(
            androidText(
                language,
                "MK8DX Time Trials ${update.version} is ready",
                "MK8DX Time Trials ${update.version} staat klaar",
            ),
        )
        .setContentText(
            androidText(
                language,
                "You have ${BuildConfig.VERSION_NAME} \u00b7 tap to open the download page",
                "Jij hebt ${BuildConfig.VERSION_NAME} \u00b7 tik om de downloadpagina te openen",
            ),
        )
        .setContentIntent(contentIntent)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
        .build()
    try {
        NotificationManagerCompat.from(context).notify("mk8dx-update", update.versionCode, built)
    } catch (_: SecurityException) {
        return
    }
    AndroidNotificationProjectionSettings.recordShownRelease(context, update.versionCode)
}

internal fun notificationTarget(intent: Intent?): AndroidNotificationTarget? {
    val notificationId = intent?.getStringExtra(EXTRA_CANONICAL_NOTIFICATION_ID)
    val playerId = intent?.getStringExtra(EXTRA_NOTIFICATION_PLAYER_ID)
    val slotId = intent?.getStringExtra(EXTRA_NOTIFICATION_SLOT_ID)
    if (notificationId == null || !notificationId.matches(Regex("^[0-9]{1,19}$")) ||
        playerId == null || !playerId.matches(Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")) ||
        slotId == null || !slotId.matches(Regex("^slot\\.[0-9a-f]{32}$")) ||
        slotId != androidSessionSlotId(playerId)) return null
    val trackId = intent.getStringExtra(EXTRA_NOTIFICATION_TRACK_ID)?.takeIf {
        Schema9AndroidTrackCatalog.find(it) != null
    }
    val mode = intent.getIntExtra(EXTRA_NOTIFICATION_MODE, 0).takeIf { it in setOf(150, 200) }
    // Only an address this build can actually parse travels on: an extra is
    // attacker-reachable in principle, and the parser refuses anything that is
    // not this product's own host and path.
    val link = intent.getStringExtra(EXTRA_NOTIFICATION_LINK)
        ?.takeIf { parseAndroidDeepLink(it) != null }
    return AndroidNotificationTarget(notificationId, playerId, slotId, trackId, mode, link)
}

/**
 * Whether this phone will actually show what the app posts.
 *
 * Two different things, and both have to be true. From Android 13 there is a
 * runtime permission; on every version there is the switch in the phone's own
 * app settings, which somebody can turn off at any time. Only the permission
 * was ever asked about, so on an older phone - or on a newer one where the
 * whole app was silenced rather than the permission revoked - the app believed
 * it was notifying and `notify` dropped everything without a word.
 */
internal fun permissionGranted(context: Context): Boolean {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
    return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
        context, Manifest.permission.POST_NOTIFICATIONS,
    ) == PackageManager.PERMISSION_GRANTED
}

private fun createChannels(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannels(listOf(
        NotificationChannel(competitiveChannel, "Competitief", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Meldingen wanneer iemand je inhaalt"
            enableVibration(true)
            setShowBadge(true)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        },
        NotificationChannel(activityChannel, "Activiteit", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Reacties, uitdagingen, porren en een nieuwe versie van de app"
            enableVibration(true)
            setShowBadge(true)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        },
    ))
    // Whoever had the first two keeps their own choices about them until they
    // are gone; deleting leaves the app with one channel per kind of news.
    retiredChannels.forEach { runCatching { manager.deleteNotificationChannel(it) } }
}

private fun notificationTag(slotId: String, notificationId: String) = "mk8dx:$slotId:$notificationId"
private fun notificationCode(slotId: String, notificationId: String) = (slotId + notificationId).hashCode()
