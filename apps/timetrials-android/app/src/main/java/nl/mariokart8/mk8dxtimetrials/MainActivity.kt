package nl.mariokart8.mk8dxtimetrials

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.ui.Modifier
import java.net.URI
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticationController
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticationHttpsExecutor
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticationScreen
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticationState
import nl.mariokart8.mk8dxtimetrials.auth.AndroidDeviceAuthorizationClient
import nl.mariokart8.mk8dxtimetrials.auth.AndroidHttpsConnectionOpener
import nl.mariokart8.mk8dxtimetrials.lan.AndroidOriginTrust
import nl.mariokart8.mk8dxtimetrials.auth.AndroidKeystoreNativeSessionStore
import nl.mariokart8.mk8dxtimetrials.auth.androidPlayerLabel
import nl.mariokart8.mk8dxtimetrials.auth.AndroidNativeSessionStore
import nl.mariokart8.mk8dxtimetrials.auth.AndroidSlotBoundSessionCanonicalConnectionFactory
import nl.mariokart8.mk8dxtimetrials.builds.AndroidBuildScreen
import nl.mariokart8.mk8dxtimetrials.carry.AndroidCarriedQueue
import nl.mariokart8.mk8dxtimetrials.carry.AndroidCarryHost
import nl.mariokart8.mk8dxtimetrials.carry.promoteAndroidCarriedTimes
import nl.mariokart8.mk8dxtimetrials.deeplink.AndroidDeepLink
import nl.mariokart8.mk8dxtimetrials.deeplink.parseAndroidDeepLink
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidClientSupportStore
import nl.mariokart8.mk8dxtimetrials.ecosystem.retires
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidRetiredBuild
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidUpdateRequiredScreen
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidEcosystemConnectionOpener
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidRankScreen
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidMyStatsScreen
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidProfileRecordsScreen
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidNotificationsScreen
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidSettingsScreen
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemClient
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.posttime.AndroidPostTimeTask
import nl.mariokart8.mk8dxtimetrials.track.AndroidTrackScreen
import nl.mariokart8.mk8dxtimetrials.manual.AndroidTrustedManualSubmissionContextFactory
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalTimeTrialOutbox
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxAccountAvailability
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidAutomaticSyncScheduler
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxAutomaticSyncScheduler
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxOwningSlotProvider
import nl.mariokart8.mk8dxtimetrials.outbox.androidOutboxCountsAsUnsent
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSubmissionHost
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSynchronizationClock
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidReviewedEvidenceReferenceAllowlist
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidSavedResultSynchronizationScreenDependencyFactory
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidProductLocalSavedResultsScreen
import nl.mariokart8.mk8dxtimetrials.outbox.createAndroidProductTimeTrialOutbox
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanProductScreen
import nl.mariokart8.mk8dxtimetrials.scan.AndroidTrustedScanSubmissionContextFactory
import nl.mariokart8.mk8dxtimetrials.scan.ScanPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.scan.ContextualResultImageAnalyzerFactory
import nl.mariokart8.mk8dxtimetrials.scan.loadBundledResultImageAnalyzerFactory
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentClient
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidIdentityLinkClient
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidAdministrationScreen
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidAdministrationClient
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidIdentityLinkScreen
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentConnectionOpener
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentScreen
import nl.mariokart8.mk8dxtimetrials.notifications.AndroidNotificationPermissionRequest
import nl.mariokart8.mk8dxtimetrials.ecosystem.androidAppearanceSync
import nl.mariokart8.mk8dxtimetrials.ui.design.mk8dxHydrateAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceHost
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceSettings
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceStore
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguageStore
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.notifications.AndroidCanonicalNotificationSync
import nl.mariokart8.mk8dxtimetrials.notifications.AndroidNotificationProjectionSettings
import nl.mariokart8.mk8dxtimetrials.notifications.AndroidNotificationTarget
import nl.mariokart8.mk8dxtimetrials.notifications.notificationTarget

class MainActivity : ComponentActivity() {
    private var showServerSetup by mutableStateOf(false)
    private val openedNotification = MutableStateFlow<AndroidNotificationTarget?>(null)
    private val openedLink = MutableStateFlow<AndroidDeepLink?>(null)
    private val localOutbox: AndroidLocalTimeTrialOutbox by lazy {
        createAndroidProductTimeTrialOutbox(applicationContext)
    }
    private val submissionHost: AndroidOutboxSubmissionHost by lazy {
        AndroidOutboxSubmissionHost(
            localOutbox,
            AndroidOutboxClock(System::currentTimeMillis),
            owningSlot = AndroidOutboxOwningSlotProvider { sessionStore.activeSlotId() },
            automaticSync = AndroidOutboxAutomaticSyncScheduler {
                AndroidAutomaticSyncScheduler.enqueue(applicationContext)
            },
        )
    }
    private val scanAnalyzerFactory: ContextualResultImageAnalyzerFactory? by lazy {
        if (!BuildConfig.MK8DX_SCAN_RUNTIME_ENABLED) {
            null
        } else {
            // Do not even reflectively load the private scanner classes while
            // Home/manual/saved/Tournament are starting. Model construction is
            // deferred until the first image actually enters analysis.
            ContextualResultImageAnalyzerFactory { contextProvider ->
                requireNotNull(loadBundledResultImageAnalyzerFactory(applicationContext)) {
                    "The bundled scanner runtime is unavailable."
                }.create(contextProvider)
            }
        }
    }
    private val sessionStore: AndroidNativeSessionStore by lazy {
        AndroidKeystoreNativeSessionStore(applicationContext)
    }
    private val httpsConnectionOpener = AndroidHttpsConnectionOpener { url ->
        AndroidOriginTrust.open(applicationContext, url)
    }
    private val authenticationController: AndroidAuthenticationController by lazy {
        AndroidAuthenticationController(
            AndroidDeviceAuthorizationClient(
                URI(requireNotNull(AndroidServerOrigin.current(applicationContext))),
                AndroidAuthenticationHttpsExecutor(
                    requireNotNull(AndroidServerOrigin.current(applicationContext)),
                    httpsConnectionOpener,
                ),
            ),
            sessionStore,
            onAccountRemoved = { slotId ->
                AndroidNotificationProjectionSettings.clearAccount(applicationContext, slotId)
            },
        )
    }
    private val localProfileId: String by lazy {
        AndroidLocalInstallationProfile(applicationContext).loadOrCreate()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // The splash is the app icon on the product's own surface, kept until
        // the first frame, on every supported release (DESIGN_SYSTEM §23).
        installSplashScreen()
        super.onCreate(savedInstanceState)
        // Edge to edge: the product draws behind the system bars and the shell
        // consumes the insets itself, so the backdrop reaches the screen edges
        // while nothing lands under a bar.
        enableEdgeToEdge()
        if (AndroidServerOrigin.current(applicationContext) != null) {
            AndroidAutomaticSyncScheduler.enqueue(applicationContext)
            AndroidCanonicalNotificationSync.schedule(applicationContext)
            AndroidCanonicalNotificationSync.enqueueImmediate(applicationContext)
        }
        readIntent(intent)
        setContent {
            val origin = AndroidServerOrigin.current(applicationContext)
            if (origin == null || showServerSetup) {
                // ADR-0225: adding a community keeps the one before it, with its account and unsent runs, in the
                // list under Settings; nothing is lost, so there is nothing to confirm.
                AndroidCommunitySetup(
                    origin,
                    onCancel = if (origin != null) ({ showServerSetup = false }) else null,
                ) { chosen ->
                    if (AndroidServerOrigin.save(applicationContext, chosen)) {
                        showServerSetup = false
                        recreate()
                    }
                }
                return@setContent
            }
            val target by openedNotification.collectAsState()
            val link by openedLink.collectAsState()
            // No theme is applied here. The appearance is not known until
            // Mk8dxAppearanceHost has read the device cache, and every screen
            // below carries the design system's own theme; wrapping the
            // activity would mean a first frame in the wrong appearance.
            AndroidTimeTrialsProductionRoot(
                localOutbox = localOutbox,
                submissionHost = submissionHost,
                scanAnalyzerFactory = scanAnalyzerFactory,
                authenticationController = authenticationController,
                sessionStore = sessionStore,
                apiOrigin = origin,
                httpsConnectionOpener = httpsConnectionOpener,
                localProfileId = localProfileId,
                notificationTarget = target,
                onNotificationHandled = { openedNotification.value = null },
                deepLink = link,
                onDeepLinkHandled = { openedLink.value = null },
                onChangeServer = { showServerSetup = true },
                onSwitchCommunity = { chosen ->
                    if (chosen != origin && AndroidServerOrigin.save(applicationContext, chosen)) recreate()
                },
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readIntent(intent)
    }

    /**
     * The two ways somebody arrives somewhere other than Home.
     *
     * A tapped notification is its own door and already carries its address,
     * so it is read first and no link is set beside it. `ACTION_VIEW` is a
     * link opened anywhere on the phone - a message, a browser, another app -
     * and only this product's own addresses are taken; anything else on the
     * host is handed back to a browser, which is where it belongs.
     */
    private fun readIntent(intent: Intent?) {
        val target = notificationTarget(intent)
        openedNotification.value = target
        if (target != null) {
            openedLink.value = null
            return
        }
        if (intent?.action != Intent.ACTION_VIEW) return
        val address = intent.dataString
        val parsed = AndroidServerOrigin.current(applicationContext)?.let {
            parseAndroidDeepLink(address, URI(it).host)
        }
        if (parsed == null) {
            // Not a screen this app has. Do not swallow it.
            if (address != null) openProductWebsite(this, address)
            return
        }
        openedLink.value = parsed
    }

    override fun onResume() {
        super.onResume()
        AndroidCanonicalNotificationSync.enqueueImmediate(applicationContext)
    }
}

@Composable
internal fun AndroidTimeTrialsProductionRoot(
    localOutbox: AndroidLocalTimeTrialOutbox,
    submissionHost: AndroidOutboxSubmissionHost,
    scanAnalyzerFactory: ContextualResultImageAnalyzerFactory?,
    authenticationController: AndroidAuthenticationController,
    sessionStore: AndroidNativeSessionStore,
    apiOrigin: String,
    httpsConnectionOpener: AndroidHttpsConnectionOpener,
    localProfileId: String,
    manualContextFactory: AndroidTrustedManualSubmissionContextFactory? = null,
    scanContextFactory: AndroidTrustedScanSubmissionContextFactory? = null,
    notificationTarget: AndroidNotificationTarget? = null,
    onNotificationHandled: () -> Unit = {},
    deepLink: AndroidDeepLink? = null,
    onDeepLinkHandled: () -> Unit = {},
    onChangeServer: () -> Unit = {},
    onSwitchCommunity: (String) -> Unit = {},
) {
    val activityContext = androidx.compose.ui.platform.LocalContext.current
    val applicationContext = activityContext.applicationContext
    val notificationScope = rememberCoroutineScope()
    var supportProbe by remember { mutableIntStateOf(0) }
    var appIsInFront by remember { mutableStateOf(true) }
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(lifecycleOwner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            when (event) {
                androidx.lifecycle.Lifecycle.Event.ON_RESUME -> {
                    appIsInFront = true
                    supportProbe++
                }
                androidx.lifecycle.Lifecycle.Event.ON_PAUSE -> appIsInFront = false
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    var retiredBuild by remember(applicationContext) {
        mutableStateOf(
            AndroidClientSupportStore.remembered(applicationContext, BuildConfig.VERSION_CODE)
                ?.copy(installedVersionName = BuildConfig.VERSION_NAME),
        )
    }
    var productLanguage by remember(applicationContext) {
        mutableStateOf(AndroidProductLanguageStore.read(applicationContext))
    }
    // Appearance (ADR-0205). The device cache is read before the first frame,
    // so there is no flash of an appearance the Player did not choose.
    val appearanceStore = remember(applicationContext) { Mk8dxAppearanceStore(applicationContext) }
    var appearanceSettings by remember(applicationContext) { mutableStateOf(appearanceStore.read()) }
    val applyAppearance: (Mk8dxAppearanceSettings) -> Unit = { updated ->
        appearanceSettings = updated
        appearanceStore.write(updated)
    }
    val authenticationState by authenticationController.state.collectAsState()
    val rememberedAccounts by authenticationController.accounts.collectAsState()
    val nativeSession = (authenticationState as? AndroidAuthenticationState.SignedIn)?.session
    // Ask for notifications the first time somebody is actually signed in:
    // that is the moment they mean anything, and it is the only moment Android
    // lets us ask at all.
    AndroidNotificationPermissionRequest(nativeSession?.playerId)
    var unsynchronizedResultCount by remember(localOutbox) { mutableIntStateOf(0) }
    // ADR-0225: times carried here from another community wait outside the outbox until somebody is signed in.
    val carriedQueue = remember(apiOrigin) { AndroidCarriedQueue.forOrigin(applicationContext, apiOrigin) }
    LaunchedEffect(localOutbox) {
        while (isActive) {
            unsynchronizedResultCount = withContext(Dispatchers.IO) {
                runCatching {
                    localOutbox.listIndex().count {
                        androidOutboxCountsAsUnsent(it.storedState, it.failureCode)
                    } + carriedQueue.size()
                }.getOrDefault(unsynchronizedResultCount)
            }
            delay(2_000)
        }
    }
    // The carried copies become this signed-in Player's runs here and are sent like any other.
    LaunchedEffect(nativeSession?.playerId, carriedQueue) {
        val playerId = nativeSession?.playerId ?: return@LaunchedEffect
        val moved = withContext(Dispatchers.IO) {
            runCatching {
                promoteAndroidCarriedTimes(
                    carriedQueue, localOutbox, playerId, sessionStore.activeSlotId(), System.currentTimeMillis(),
                )
            }.getOrDefault(0)
        }
        if (moved > 0) AndroidAutomaticSyncScheduler.enqueue(applicationContext)
    }
    LaunchedEffect(authenticationState) {
        if (authenticationState is AndroidAuthenticationState.SignedIn) {
            AndroidAutomaticSyncScheduler.enqueue(applicationContext)
            AndroidCanonicalNotificationSync.enqueueImmediate(applicationContext)
        }
    }
    // While somebody is actually looking at the app, read the inbox every
    // minute. Somebody taking your time on a track is news you want while you
    // are in here, not at the next background pass, and a phone with its
    // screen on and this app in front of it is not the place to save a request.
    LaunchedEffect(appIsInFront, authenticationState) {
        if (!appIsInFront) return@LaunchedEffect
        if (authenticationState !is AndroidAuthenticationState.SignedIn) return@LaunchedEffect
        while (isActive) {
            delay(60_000)
            AndroidCanonicalNotificationSync.enqueueImmediate(applicationContext)
        }
    }
    val ecosystemClient = remember(nativeSession, apiOrigin, httpsConnectionOpener) {
        AndroidTimeTrialsEcosystemClient(
            apiOrigin,
            nativeSession,
            AndroidEcosystemConnectionOpener(httpsConnectionOpener::open),
        )
    }
    // ADR-0205 §4 hydration, at the same moment as the rest of the account:
    // the account value is canonical unless this phone holds a newer explicit
    // change, and an account that has never held one leaves the local choice
    // alone. `androidAppearanceSync` is null while the account field is not
    // served, and then the choice simply stays on this phone.
    LaunchedEffect(ecosystemClient, nativeSession?.playerId) {
        val sync = androidAppearanceSync(ecosystemClient, nativeSession?.playerId)
            ?: return@LaunchedEffect
        val now = System.currentTimeMillis()
        val accountChoice = withContext(Dispatchers.IO) {
            runCatching { sync.readAccountChoice() }.getOrNull()
        }
        val hydrated = mk8dxHydrateAppearance(
            appearanceSettings.cache, accountChoice, appearanceSettings.hydratedAtMs, now,
        )
        var next = appearanceSettings.copy(cache = hydrated.cache, hydratedAtMs = now)
        hydrated.upload?.let { choice ->
            val stored = withContext(Dispatchers.IO) {
                runCatching { sync.writeAccountChoice(choice) }.getOrDefault(false)
            }
            // A failed send keeps `synced:false` and is retried on the next
            // hydration, which is what makes an offline change survive.
            if (stored) next = next.copy(cache = next.cache.copy(synced = true))
        }
        applyAppearance(next)
    }
    // ADR-0205 §5: an explicit change reaches the account straight away. A
    // failed send keeps `synced:false`, and the hydration above retries it.
    LaunchedEffect(appearanceSettings.cache, ecosystemClient, nativeSession?.playerId) {
        val cache = appearanceSettings.cache
        val choice = cache.choice
        if (cache.synced || choice == null) return@LaunchedEffect
        val sync = androidAppearanceSync(ecosystemClient, nativeSession?.playerId)
            ?: return@LaunchedEffect
        val stored = withContext(Dispatchers.IO) {
            runCatching { sync.writeAccountChoice(choice) }.getOrDefault(false)
        }
        if (stored) applyAppearance(appearanceSettings.copy(cache = cache.copy(synced = true)))
    }
    // Accounts and Players: offered only when there is a signed-in native
    // session to carry the bearer token; the screen itself withdraws for
    // anyone the server does not treat as an administrator.
    val identityLinkClient = remember(nativeSession, apiOrigin, httpsConnectionOpener) {
        nativeSession?.let {
            AndroidIdentityLinkClient(
                apiOrigin, it, AndroidTournamentConnectionOpener(httpsConnectionOpener::open),
            )
        }
    }
    // The administrator's numbers, for the same signed-in session; Settings
    // only offers the way in once the server has said yes.
    val administrationClient = remember(nativeSession, apiOrigin, httpsConnectionOpener) {
        nativeSession?.let {
            AndroidAdministrationClient(
                apiOrigin, it, AndroidTournamentConnectionOpener(httpsConnectionOpener::open),
            )
        }
    }
    val resolvedManualContextFactory = remember(
        manualContextFactory,
        nativeSession,
        localProfileId,
    ) {
        manualContextFactory
            ?: nativeSession?.manualContextFactory()
            ?: AndroidTrustedManualSubmissionContextFactory(
                playerReference = ManualPlayerReferenceV1(
                    "producer_local_profile",
                    localProfileId,
                ),
                producerVersion = "timetrials-android-v1",
            )
    }
    val resolvedScanContextFactory = remember(
        scanContextFactory,
        nativeSession,
        localProfileId,
    ) {
        scanContextFactory
            ?: nativeSession?.scanContextFactory()
            ?: AndroidTrustedScanSubmissionContextFactory(
                playerReference = ScanPlayerReferenceV1(
                    "producer_local_profile",
                    localProfileId,
                ),
                producerVersion = "timetrials-android-v1",
            )
    }
    // Delivery is wired per remembered account, so synchronization stays
    // available as long as any account exists, not only the active one.
    val synchronizationDependencies = remember(
        rememberedAccounts.accounts.isEmpty(),
        localOutbox,
    ) {
        if (rememberedAccounts.accounts.isEmpty()) {
            null
        } else {
            AndroidSavedResultSynchronizationScreenDependencyFactory(
                outbox = localOutbox,
                origin = apiOrigin,
                connectionFactoryProvider = { owningSlotId ->
                    AndroidSlotBoundSessionCanonicalConnectionFactory(
                        owningSlotId,
                        sessionStore,
                        httpsConnectionOpener,
                    ).takeIf {
                        sessionStore.load(owningSlotId, System.currentTimeMillis()) != null
                    }
                },
                reviewedEvidenceAllowlist = AndroidReviewedEvidenceReferenceAllowlist {
                    evidence -> evidence.isEmpty()
                },
                clock = AndroidOutboxSynchronizationClock(System::currentTimeMillis),
                accounts = AndroidOutboxAccountAvailability { owningSlotId, nowMs ->
                    sessionStore.load(owningSlotId, nowMs) != null
                },
            ).create()
        }
    }
    // Is this build still allowed to be used at all? Asked on every start,
    // **on every return to the app**, and then every fifteen minutes, against a
    // public endpoint that needs no session. Silence never blocks; a definite
    // "retired" is remembered so turning off the wifi does not undo it.
    //
    // The resume matters: a floor raised while somebody has the app open used
    // to take up to a quarter of an hour to reach them, so an app that was no
    // longer allowed carried on being used. Now anyone who switches away and
    // comes back is told at once, and the fifteen minutes are only for a phone
    // nobody touches.
    LaunchedEffect(ecosystemClient, supportProbe) {
        while (isActive) {
            val support = withContext(Dispatchers.IO) {
                runCatching { ecosystemClient.clientSupport() }.getOrNull()
            }
            if (support != null) {
                if (support.retires(BuildConfig.VERSION_CODE)) {
                    AndroidClientSupportStore.remember(
                        applicationContext, BuildConfig.VERSION_CODE, support,
                    )
                    retiredBuild = AndroidRetiredBuild(
                        installedVersionName = BuildConfig.VERSION_NAME,
                        installedBuild = BuildConfig.VERSION_CODE,
                        currentVersion = support.currentVersion,
                        downloadPagePath = support.downloadPagePath,
                        message = support.message,
                    )
                } else {
                    // The owner can let a build back in; a definite answer in
                    // either direction is the one that counts.
                    AndroidClientSupportStore.forget(applicationContext)
                    retiredBuild = null
                }
            }
            // How often to ask again, and why it is two numbers.
            //
            // While somebody is actually in the app, a minute: a build that has
            // just been switched off should stop being used about as fast as a
            // person notices anything, and the answer is a few hundred bytes
            // from a public endpoint - sixty of those an hour is nothing next
            // to one screen of the app.
            //
            // While the app is only alive in the background, a quarter of an
            // hour. This loop lives as long as the composition, so a minute
            // there would wake the radio all night for a question nobody is
            // waiting on - and would earn exactly the battery-manager
            // punishment the notification work just had to be dug out of.
            delay(if (appIsInFront) 60_000 else 900_000)
        }
    }
    retiredBuild?.let { retired ->
        CompositionLocalProvider(LocalAndroidProductLanguage provides productLanguage) {
            Mk8dxAppearanceHost(appearanceSettings) {
            AndroidUpdateRequiredScreen(
                retired = retired,
                language = productLanguage,
                unsynchronizedResultCount = unsynchronizedResultCount,
                onOpenDownloadPage = {
                    openProductWebsite(activityContext, apiOrigin + retired.downloadPagePath)
                },
            )
            }
        }
        return
    }
    CompositionLocalProvider(LocalAndroidProductLanguage provides productLanguage) {
    Mk8dxAppearanceHost(appearanceSettings) {
    AndroidTimeTrialsProductComponent(
        scanResultContent = { _, requestedTrackId, requestedMode, openTestChooser, onRecognized ->
            AndroidScanProductScreen(
                contextFactory = resolvedScanContextFactory,
                analyzerFactory = scanAnalyzerFactory,
                initialTrackId = requestedTrackId,
                initialMode = requestedMode,
                openTestChooser = openTestChooser,
                ecosystemClient = ecosystemClient,
                activePlayerLabel = nativeSession?.let {
                    androidPlayerLabel(it.displayName, it.playerId)
                },
                onRecognized = onRecognized,
            )
        },
        tracksContent = { _, requestedTrackId, requestedMode, actions ->
            AndroidTrackScreen(
                trackId = requestedTrackId,
                mode = requestedMode,
                ecosystemClient = ecosystemClient,
                signedInPlayerId = nativeSession?.playerId,
                onTrackChosen = actions.chooseTrack,
                onChangeTrack = actions.changeTrack,
                onModeChanged = actions.modeChanged,
                onPostTime = actions.postTime,
                onOpenCombo = actions.openCombo,
                onOpenPlayer = actions.openPlayer,
            )
        },
        postTimeContent = { requestedTrackId, requestedMode, pendingScan, actions ->
            AndroidPostTimeTask(
                trackId = requestedTrackId,
                mode = requestedMode,
                contextFactory = resolvedManualContextFactory,
                submissionHost = submissionHost,
                ecosystemClient = ecosystemClient,
                signedInPlayerId = nativeSession?.playerId,
                signedInPlayerLabel = nativeSession?.let {
                    androidPlayerLabel(it.displayName, it.playerId)
                },
                onTrackChosen = actions.chooseTrack,
                onChangeTrack = actions.changeTrack,
                onModeChanged = actions.modeChanged,
                onScan = actions.scan,
                pendingScan = pendingScan,
                onScanConsumed = actions.scanConsumed,
                onComplete = actions.complete,
                onSavedResults = actions.savedResults,
            )
        },
        savedResultsContent = { _, submitTimeTrial ->
            // Saved results name their owner by display name where a
            // v2-bootstrap session stored one; older slots keep the id.
            val accountDisplayNames = remember(nativeSession) {
                runCatching {
                    sessionStore.list(System.currentTimeMillis())
                        .mapNotNull { account ->
                            account.displayName?.let { account.playerId to it }
                        }
                        .toMap()
                }.getOrDefault(emptyMap())
            }
            AndroidCarryHost(apiOrigin, localOutbox) {
                AndroidProductLocalSavedResultsScreen(
                    localOutbox,
                    synchronizationDependencies,
                    onSubmitTimeTrial = submitTimeTrial,
                    accountDisplayNames = accountDisplayNames,
                )
            }
        },
        tournamentContent = { openAccount, request, onRequestHandled, openTrack ->
            // Built whether or not anybody is signed in: the Tournaments
            // overview is public reading, and only the console behind it needs
            // a session.
            val tournamentClient = remember(nativeSession, apiOrigin, httpsConnectionOpener) {
                AndroidTournamentClient(
                    apiOrigin,
                    nativeSession,
                    AndroidTournamentConnectionOpener(httpsConnectionOpener::open),
                )
            }
            AndroidTournamentScreen(
                tournamentClient,
                signedIn = nativeSession != null,
                viewerPlayerId = nativeSession?.playerId,
                onSignIn = openAccount,
                request = request,
                onRequestHandled = onRequestHandled,
                onOpenTrack = openTrack,
            )
        },
        rankContent = { openAccount, openTrack, openPlayerId, rankingRequest, onPlayerHandled, openTrackSkill ->
            AndroidRankScreen(
                client = ecosystemClient,
                signedInPlayerId = nativeSession?.playerId,
                onSignIn = openAccount,
                onOpenTrack = openTrack,
                requestedPlayerId = openPlayerId,
                request = rankingRequest,
                onPlayerHandled = onPlayerHandled,
                onOpenTrackSkill = openTrackSkill,
            )
        },
        buildContent = { requestedPartIds -> AndroidBuildScreen(apiOrigin, requestedPartIds) },
        authenticationContent = {
            AndroidAccountDestination(
                authenticationController,
                localOutbox,
                notificationTarget?.playerId?.takeIf { it != nativeSession?.playerId },
            )
        },
        profileContent = { openAccount, openTestScan ->
            AndroidProfileRecordsScreen(
                ecosystemClient,
                nativeSession?.playerId,
                openAccount,
                apiOrigin,
                playerLabel = nativeSession?.let {
                    androidPlayerLabel(it.displayName, it.playerId)
                },
                // Only where the scanner is actually bundled: a build without
                // it has nothing to test.
                onRunTestScan = openTestScan
                    ?.takeIf { BuildConfig.MK8DX_SCAN_RUNTIME_ENABLED },
                identityLinks = identityLinkClient?.let {
                    { AndroidIdentityLinkScreen(it) }
                },
            )
        },
        myStatsContent = { openAccount, manageResults, openTrack, postTime ->
            AndroidMyStatsScreen(
                ecosystemClient,
                nativeSession?.playerId,
                openAccount,
                manageResults,
                openTrack,
                postTime,
            )
        },
        notificationsContent = { openAccount, openTrack, openSavedResults ->
            AndroidNotificationsScreen(
                ecosystemClient, nativeSession?.playerId, openAccount, apiOrigin, openTrack,
                unsynchronizedResultCount = unsynchronizedResultCount,
                onOpenSavedResults = openSavedResults,
            )
        },
        settingsContent = { openAccount, openAdministration, openSavedResults ->
            AndroidSettingsScreen(
                ecosystemClient,
                nativeSession?.playerId,
                openAccount,
                apiOrigin,
                productLanguage,
                onLanguageChanged = { selected ->
                    AndroidProductLanguageStore.write(applicationContext, selected)
                    productLanguage = selected
                },
                playerLabel = nativeSession?.let {
                    androidPlayerLabel(it.displayName, it.playerId)
                },
                administration = administrationClient,
                onAdministration = openAdministration,
                onChangeServer = onChangeServer,
                onSavedResults = openSavedResults,
                onSwitchCommunity = onSwitchCommunity,
                appearance = appearanceSettings,
                onAppearanceChanged = applyAppearance,
            )
        },
        administrationContent = { back ->
            val client = administrationClient
            if (client != null) {
                AndroidAdministrationScreen(client, identityLinkClient, productLanguage, back)
            } else {
                AndroidSettingsScreen(
                    ecosystemClient, null, {}, apiOrigin, productLanguage,
                    onLanguageChanged = { selected ->
                        AndroidProductLanguageStore.write(applicationContext, selected)
                        productLanguage = selected
                    },
                    appearance = appearanceSettings,
                    onAppearanceChanged = applyAppearance,
                    onChangeServer = onChangeServer,
                    onSwitchCommunity = onSwitchCommunity,
                )
            }
        },
        activePlayerLabel = nativeSession?.let {
            androidPlayerLabel(it.displayName, it.playerId)
        },
        // Ranking keys its saved view by the canonical Player id. A Home tile
        // that handed over the display label wrote to a different file, so the
        // scope and tab it asked for never arrived.
        activePlayerId = nativeSession?.playerId,
        ecosystemClient = ecosystemClient,
        unsynchronizedResultCount = unsynchronizedResultCount,
        notificationTarget = notificationTarget,
        deepLink = deepLink,
        onDeepLinkHandled = onDeepLinkHandled,
        onNotificationOpened = { target ->
            AndroidNotificationProjectionSettings.queueRead(
                applicationContext, target.slotId, target.notificationId,
            )
            notificationScope.launch {
                runCatching {
                    withContext(Dispatchers.IO) {
                        ecosystemClient.markNotificationsRead(listOf(target.notificationId))
                    }
                }
                    .onSuccess {
                        AndroidNotificationProjectionSettings.clearQueuedRead(
                            applicationContext, target.slotId, target.notificationId,
                        )
                    }
                AndroidCanonicalNotificationSync.enqueueImmediate(applicationContext)
            }
            onNotificationHandled()
        },
    )
    }
    }
}

@Composable
private fun AndroidAccountDestination(
    authenticationController: AndroidAuthenticationController,
    localOutbox: AndroidLocalTimeTrialOutbox,
    notificationPlayerHint: String? = null,
) {
    var pendingByOwner by remember { mutableStateOf(emptyMap<String, Int>()) }
    LaunchedEffect(localOutbox, authenticationController) {
        authenticationController.refreshAccounts()
        pendingByOwner = withContext(Dispatchers.IO) {
            runCatching {
                localOutbox.listIndex()
                    .filter { androidOutboxCountsAsUnsent(it.storedState, it.failureCode) }
                    .mapNotNull { it.owningSlotId }
                    .groupingBy { it }
                    .eachCount()
            }.getOrDefault(emptyMap())
        }
    }
    AndroidAuthenticationScreen(
        controller = authenticationController,
        pendingEntryCount = { slotId -> pendingByOwner[slotId] ?: 0 },
        notificationPlayerHint = notificationPlayerHint,
    )
}

private fun AndroidAuthenticatedNativeSession.manualContextFactory() =
    AndroidTrustedManualSubmissionContextFactory(
        playerId = playerId,
        producerVersion = "timetrials-android-v1",
    )

private fun AndroidAuthenticatedNativeSession.scanContextFactory() =
    AndroidTrustedScanSubmissionContextFactory(
        playerId = playerId,
        producerVersion = "timetrials-android-v1",
    )
