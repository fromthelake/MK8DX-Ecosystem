package nl.mariokart8.mk8dxtimetrials

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.rememberUpdatedState
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanDebug
import nl.mariokart8.mk8dxtimetrials.scan.ScanDebugCommand
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.core.graphics.drawable.toBitmap
import nl.mariokart8.mk8dxtimetrials.builds.AndroidBuildPartCategory
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutVariants
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidHomeExperience
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidAvailableAppUpdate
import nl.mariokart8.mk8dxtimetrials.ecosystem.availableAfter
import nl.mariokart8.mk8dxtimetrials.deeplink.AndroidDeepLink
import nl.mariokart8.mk8dxtimetrials.deeplink.parseAndroidDeepLink
import nl.mariokart8.mk8dxtimetrials.notifications.AndroidNotificationBadge
import nl.mariokart8.mk8dxtimetrials.notifications.AndroidNotificationTarget
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentRequest
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialTrackScope
import nl.mariokart8.mk8dxtimetrials.ecosystem.ANDROID_NINTENDO_STAFF_REFERENCE_ID
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidRankTrackFocus
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidRankViewStateStore
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidRankingRequest
import nl.mariokart8.mk8dxtimetrials.ecosystem.androidTrackFiltersFromLink
import nl.mariokart8.mk8dxtimetrials.ecosystem.androidTrackSortFromLink
import nl.mariokart8.mk8dxtimetrials.ecosystem.androidReportVisibility
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxBottomTabs
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxBrandLockup
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDockedAction
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxGlobalActionLevel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTabDestination
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTaskBar
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTopBar
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

private enum class AndroidTimeTrialsProductRoute(val label: String, val iconRes: Int? = null) {
    HOME("Home", R.drawable.ic_nav_home),
    MANUAL_ENTRY("Tracks", R.drawable.ic_nav_submit),
    /** The canonical Post-a-Time task (A02's form half); a task, not a tab. */
    POST_TIME("Post a time"),
    SCAN_RESULT("Scan"),
    RANK("Rank", R.drawable.ic_nav_rank),
    BUILD("Build", R.drawable.ic_nav_build),
    SAVED_RESULTS("Saved"),
    // Keep startup independent of the large color-emoji font; the original
    // app also used its own product marks rather than platform emoji.
    TOURNAMENT("Tournament", R.drawable.ic_nav_tournament),
    ACCOUNT("Players"),
    PROFILE("Profile"),
    /** My records & stats (owner 2026-09-26): the Web's `?mystats=1` page on the phone. */
    MY_STATS("My records"),
    NOTIFICATIONS("Notifications"),
    SETTINGS("Settings"),
    ADMINISTRATION("Administration"),
}

private val productNavigation = listOf(
    AndroidTimeTrialsProductRoute.HOME,
    AndroidTimeTrialsProductRoute.MANUAL_ENTRY,
    AndroidTimeTrialsProductRoute.RANK,
    AndroidTimeTrialsProductRoute.BUILD,
    AndroidTimeTrialsProductRoute.TOURNAMENT,
)

/** What A02's track screen can ask the shell for (Phase 7/9). */
internal data class AndroidTracksActions(
    val chooseTrack: (String) -> Unit,
    val changeTrack: () -> Unit,
    val modeChanged: (Int) -> Unit,
    val postTime: (trackId: String, mode: Int) -> Unit,
    val openCombo: (List<String>) -> Unit,
    /** A name on the track's board opens that Player's page, as `/?player=` does. */
    val openPlayer: (String) -> Unit = {},
)

/** What the Post-a-Time task can ask the shell for (Phase 7/8, A02 + A03). */
internal data class AndroidPostTimeActions(
    val chooseTrack: (String) -> Unit,
    val changeTrack: () -> Unit,
    val modeChanged: (Int) -> Unit,
    val scan: (trackId: String, mode: Int) -> Unit,
    val scanConsumed: () -> Unit,
    val complete: () -> Unit,
    val savedResults: () -> Unit,
)

@Composable
internal fun AndroidTimeTrialsProductComponent(
    scanResultContent: @Composable (
        openAccount: () -> Unit,
        requestedTrackId: String?,
        requestedMode: Int?,
        openTestChooser: Boolean,
        onRecognized: (AndroidScanTimeTrialSubmissionV1) -> Unit,
    ) -> Unit,
    tracksContent: @Composable (
        openAccount: () -> Unit,
        requestedTrackId: String?,
        requestedMode: Int?,
        actions: AndroidTracksActions,
    ) -> Unit,
    postTimeContent: @Composable (
        requestedTrackId: String?,
        requestedMode: Int?,
        pendingScan: AndroidScanTimeTrialSubmissionV1?,
        actions: AndroidPostTimeActions,
    ) -> Unit = { _, _, _, _ -> },
    savedResultsContent: @Composable (
        openAccount: () -> Unit,
        submitTimeTrial: () -> Unit,
    ) -> Unit,
    tournamentContent: @Composable (
        openAccount: () -> Unit,
        request: AndroidTournamentRequest?,
        onRequestHandled: () -> Unit,
        openTrack: (String) -> Unit,
    ) -> Unit = { _, _, _, _ -> },
    rankContent: @Composable (
        openAccount: () -> Unit,
        openTrack: (String) -> Unit,
        openPlayerId: String?,
        request: AndroidRankingRequest?,
        onPlayerHandled: () -> Unit,
        openTrackSkill: (String) -> Unit,
    ) -> Unit = { _, _, _, _, _, _ -> },
    buildContent: @Composable (requestedPartIds: List<String>) -> Unit = {},
    authenticationContent: @Composable () -> Unit = {},
    profileContent: @Composable (
        openAccount: () -> Unit,
        openTestScan: (() -> Unit)?,
    ) -> Unit = { _, _ -> },
    myStatsContent: @Composable (
        openAccount: () -> Unit,
        manageResults: () -> Unit,
        openTrack: (String, Int) -> Unit,
        postTime: (String, Int) -> Unit,
    ) -> Unit = { _, _, _, _ -> },
    notificationsContent: @Composable (
        openAccount: () -> Unit,
        openTrack: (String, Int) -> Unit,
        openSavedResults: () -> Unit,
    ) -> Unit = { _, _, _ -> },
    settingsContent: @Composable (openAccount: () -> Unit, openAdministration: () -> Unit, openSavedResults: () -> Unit) -> Unit = { _, _, _ -> },
    administrationContent: @Composable (back: () -> Unit) -> Unit = {},
    activePlayerLabel: String? = null,
    /** The canonical Player id, which is what Ranking keys its view state by. */
    activePlayerId: String? = null,
    ecosystemClient: AndroidTimeTrialsEcosystemDataSource? = null,
    unsynchronizedResultCount: Int = 0,
    notificationTarget: AndroidNotificationTarget? = null,
    onNotificationOpened: (AndroidNotificationTarget) -> Unit = {},
    /** A link somebody opened, already parsed; see `AndroidDeepLink`. */
    deepLink: AndroidDeepLink? = null,
    onDeepLinkHandled: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val language = LocalAndroidProductLanguage.current
    val context = LocalContext.current
    val navigationPreferences = remember(context) {
        context.getSharedPreferences("mk8dx-product-navigation-v1", android.content.Context.MODE_PRIVATE)
    }
    var routeName by rememberSaveable {
        mutableStateOf(navigationPreferences.getString("route", AndroidTimeTrialsProductRoute.HOME.name)
            ?: AndroidTimeTrialsProductRoute.HOME.name)
    }
    var requestedTrackId by rememberSaveable {
        mutableStateOf(navigationPreferences.getString("trackId", null))
    }
    // A test scan is reached from Debug and test under the profile; the scan
    // screen opens its chooser once and then behaves normally.
    var requestedTestScan by rememberSaveable { mutableStateOf(false) }
    var requestedMode by rememberSaveable {
        mutableStateOf(navigationPreferences.getInt("mode", 0).takeIf { it in setOf(150, 200) })
    }
    // An Activity combo opens Build on that combo, the way the web combo
    // summary links to `/?build=character.x,body.y,tire.z,glider.w`. It is a
    // navigation intent, not saved state, so a plain Build tab visit clears it.
    var requestedBuildPartIds by rememberSaveable { mutableStateOf(emptyList<String>()) }
    // What a Tournaments link asked for: one night, or the statistics panel
    // and the view of it the sender had. Held as plain values so it survives a
    // rotation the way every other navigation intent here does.
    var requestedNightId by rememberSaveable { mutableStateOf<String?>(null) }
    var requestedStatistics by rememberSaveable { mutableStateOf(false) }
    var requestedStatisticsSort by rememberSaveable { mutableStateOf<String?>(null) }
    var requestedStatisticsAscending by rememberSaveable { mutableStateOf(false) }
    var requestedStatisticsFocus by rememberSaveable { mutableStateOf<String?>(null) }
    // The panel's filter boxes, as "races=>3|cup=Blad": a map is not saveable
    // and this survives a rotation the way the rest of the request does.
    var requestedStatisticsFilters by rememberSaveable { mutableStateOf("") }
    var requestedPlayerId by rememberSaveable { mutableStateOf<String?>(null) }
    var requestedRanking by remember { mutableStateOf<AndroidRankingRequest?>(null) }
    // A recognised scan on its way into the canonical form. It is a handover,
    // not saved state: the evidence lives in the scan session, and a process
    // death leaves the Player with the kept draft instead.
    var pendingScan by remember { mutableStateOf<AndroidScanTimeTrialSubmissionV1?>(null) }
    LaunchedEffect(activePlayerLabel, notificationTarget) {
        if (notificationTarget != null) return@LaunchedEffect
        if (activePlayerLabel != null &&
            navigationPreferences.getString("profile-onboarding-player", null) != activePlayerLabel
        ) {
            routeName = AndroidTimeTrialsProductRoute.SETTINGS.name
            navigationPreferences.edit()
                .putString("route", AndroidTimeTrialsProductRoute.SETTINGS.name)
                .putString("profile-onboarding-player", activePlayerLabel)
                .apply()
        }
    }
    val route = AndroidTimeTrialsProductRoute.entries.firstOrNull { it.name == routeName }
        ?: AndroidTimeTrialsProductRoute.HOME
    // Going back means going back to where you were, with what you were
    // looking at. The handler used to send every screen to Home, so opening a
    // leaderboard from Ranking and pressing back lost the Ranking and the
    // filters that produced it. Each step remembers its route and the track
    // context that route was showing; Ranking's own filters already survive in
    // its saved view state, so restoring the route restores the view.
    var backStack by rememberSaveable { mutableStateOf(emptyList<String>()) }
    val navigate = { target: AndroidTimeTrialsProductRoute ->
        if (target.name != routeName) {
            backStack = (backStack + "$routeName|${requestedTrackId ?: ""}|${requestedMode ?: 0}")
                .takeLast(ANDROID_BACK_STACK_DEPTH)
        }
        routeName = target.name
        navigationPreferences.edit().putString("route", target.name)
            .putString("trackId", requestedTrackId)
            .putInt("mode", requestedMode ?: 0).apply()
    }
    val goHome: () -> Unit = {
        backStack = emptyList()
        requestedTrackId = null
        requestedMode = null
        pendingScan = null
        routeName = AndroidTimeTrialsProductRoute.HOME.name
        navigationPreferences.edit()
            .putString("route", routeName)
            .remove("trackId")
            .putInt("mode", 0)
            .apply()
    }

    // One step back, whoever asks for it: the system Back key, predictive back,
    // and the task bar's way out all run this and nothing else, so the Back
    // model is exactly what it was before the shell was migrated. Per-tab back
    // stacks remain undecided (OD-10) and are deliberately not introduced.
    val goBack: () -> Unit = {
        val previous = backStack.lastOrNull()
        if (previous == null) {
            routeName = AndroidTimeTrialsProductRoute.HOME.name
            navigationPreferences.edit().putString("route", routeName).apply()
        } else {
            backStack = backStack.dropLast(1)
            val parts = previous.split("|")
            routeName = parts.getOrNull(0) ?: AndroidTimeTrialsProductRoute.HOME.name
            requestedTrackId = parts.getOrNull(1)?.takeIf { it.isNotEmpty() }
            requestedMode = parts.getOrNull(2)?.toIntOrNull()?.takeIf { it in setOf(150, 200) }
            navigationPreferences.edit().putString("route", routeName)
                .putString("trackId", requestedTrackId)
                .putInt("mode", requestedMode ?: 0).apply()
        }
    }
    BackHandler(enabled = route != AndroidTimeTrialsProductRoute.HOME || backStack.isNotEmpty()) {
        goBack()
    }
    if (ScanDebug.recorder != null) {
        // Debug build only: the PC opens a track's scanner the way its scan
        // button does, which works whichever way the phone is held.
        val currentNavigate by rememberUpdatedState(navigate)
        LaunchedEffect(Unit) {
            ScanDebug.commands.collect { command ->
                if (command is ScanDebugCommand.OpenScanner) {
                    requestedTrackId = command.trackId
                    requestedTestScan = false
                    pendingScan = null
                    currentNavigate(AndroidTimeTrialsProductRoute.SCAN_RESULT)
                }
                // Reset means "leave this result and scan again", which is now
                // leaving the canonical form for the scanner.
                if (command == ScanDebugCommand.Reset && routeName == AndroidTimeTrialsProductRoute.POST_TIME.name) {
                    pendingScan = null
                    currentNavigate(AndroidTimeTrialsProductRoute.SCAN_RESULT)
                }
            }
        }
        SideEffect {
            ScanDebug.report("route", route.name)
            ScanDebug.report("track_id", requestedTrackId)
        }
    }
    val openAccount = { navigate(AndroidTimeTrialsProductRoute.ACCOUNT) }
    // One place turns an address into a screen. Both doors use it: a link
    // somebody opened, and a notification tapped on the lock screen, which
    // carries an address of the same kind, decided by the rule the site uses.
    val applyDeepLink: (AndroidDeepLink) -> Unit = { link ->
        when (link) {
            is AndroidDeepLink.Home -> navigate(AndroidTimeTrialsProductRoute.HOME)
            is AndroidDeepLink.Tracks -> {
                requestedTrackId = null
                requestedMode = null
                navigate(AndroidTimeTrialsProductRoute.MANUAL_ENTRY)
            }
            is AndroidDeepLink.Track -> {
                requestedTrackId = link.trackId
                requestedMode = link.mode
                nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidRunFocus.request(link.trackId, link.runId)
                navigate(AndroidTimeTrialsProductRoute.MANUAL_ENTRY)
            }
            is AndroidDeepLink.Records -> navigate(AndroidTimeTrialsProductRoute.PROFILE)
            is AndroidDeepLink.MyStats -> navigate(AndroidTimeTrialsProductRoute.MY_STATS)
            is AndroidDeepLink.Notifications -> navigate(
                if (activePlayerLabel == null) AndroidTimeTrialsProductRoute.ACCOUNT
                else AndroidTimeTrialsProductRoute.NOTIFICATIONS,
            )
            is AndroidDeepLink.Settings -> navigate(AndroidTimeTrialsProductRoute.SETTINGS)
            is AndroidDeepLink.Administration -> navigate(
                if (activePlayerLabel == null) AndroidTimeTrialsProductRoute.ACCOUNT
                else AndroidTimeTrialsProductRoute.ADMINISTRATION,
            )
            is AndroidDeepLink.Account -> navigate(AndroidTimeTrialsProductRoute.ACCOUNT)
            is AndroidDeepLink.TournamentNight -> {
                requestedNightId = link.tournamentId
                requestedStatistics = false
                navigate(AndroidTimeTrialsProductRoute.TOURNAMENT)
            }
            is AndroidDeepLink.Tournaments -> {
                requestedNightId = null
                requestedStatistics = link.statistics
                requestedStatisticsSort = link.statisticsSort
                requestedStatisticsAscending = !link.statisticsDescending
                requestedStatisticsFocus = link.statisticsFocus
                requestedStatisticsFilters = link.statisticsFilters.entries
                    .joinToString("|") { "${it.key}=${it.value}" }
                navigate(AndroidTimeTrialsProductRoute.TOURNAMENT)
            }
            is AndroidDeepLink.PlayerPage -> {
                requestedRanking = null
                requestedPlayerId = link.playerId
                navigate(AndroidTimeTrialsProductRoute.RANK)
            }
            is AndroidDeepLink.Ranking -> {
                val store = AndroidRankViewStateStore(context, activePlayerId ?: "anonymous")
                val current = store.read()
                store.write(
                    current.copy(
                        section = if (link.tournament) "TOURNAMENT" else "TIME_TRIALS",
                        mode = link.mode ?: current.mode,
                        scope = link.scope ?: current.scope,
                        tab = link.tab?.uppercase() ?: current.tab,
                        trackFocus = link.focus ?: current.trackFocus,
                    ),
                )
                requestedPlayerId = null
                requestedRanking = AndroidRankingRequest(
                    tournament = link.tournament,
                    player = link.player,
                    compare = link.compare,
                    tracksOpen = link.tracksOpen,
                    trackSort = androidTrackSortFromLink(link.trackSort),
                    trackDescending = link.trackDescending,
                    trackFilters = androidTrackFiltersFromLink(link.trackFilters),
                    mode = link.mode,
                )
                navigate(AndroidTimeTrialsProductRoute.RANK)
            }
            is AndroidDeepLink.Build -> {
                requestedBuildPartIds = link.partIds
                navigate(AndroidTimeTrialsProductRoute.BUILD)
            }
            // The app cannot install itself: the download page belongs in a
            // browser, and `openProductWebsite` makes sure it reaches one.
            is AndroidDeepLink.Apps -> openProductWebsite(
                context, "${AndroidServerOrigin.current(context)}/?apps=1",
            )
        }
    }
    LaunchedEffect(deepLink) {
        val link = deepLink ?: return@LaunchedEffect
        applyDeepLink(link)
        onDeepLinkHandled()
    }
    LaunchedEffect(notificationTarget, activePlayerLabel) {
        val target = notificationTarget ?: return@LaunchedEffect
        if (activePlayerLabel != target.playerId) {
            routeName = AndroidTimeTrialsProductRoute.ACCOUNT.name
            navigationPreferences.edit().putString("route", routeName).apply()
            return@LaunchedEffect
        }
        // Where a notification goes is the address it carries, so a tap on
        // the phone lands where the same tap lands in a browser. A build that
        // posted its notifications before there were addresses still has the
        // track and the class, and a track is a leaderboard.
        val link = parseAndroidDeepLink(target.link)
            ?: target.trackId?.let { AndroidDeepLink.Track(it, target.mode) }
            ?: AndroidDeepLink.Notifications
        applyDeepLink(link)
        onNotificationOpened(target)
    }

    // Task mode (DESIGN_SYSTEM §11): posting a time and the camera are tasks,
    // so the tabs step aside for a title and a way out. The way out is the same
    // Back the system key performs, so the Back model itself is untouched.
    val taskMode = route == AndroidTimeTrialsProductRoute.SCAN_RESULT ||
        route == AndroidTimeTrialsProductRoute.POST_TIME
    // The global action steps down by context (§4): filled where the route
    // carries no primary of its own, hidden where it does - Tracks *is* posting
    // a time, and a task never offers a second errand.
    //
    // Home carries its own A4, so the dock is scroll-aware there (§11): while
    // Home's own "Post a time" is on screen the dock stays away, and once it
    // has scrolled out of view the global action takes over, so a long feed is
    // never a page without the one thing to do. Home reports its own action's
    // visibility; nothing else has to measure the page.
    var homeActionVisible by remember { mutableStateOf(true) }
    // Leaving Home resets it, so coming back to the top of Home never starts
    // with a docked action over a hero that is showing its own.
    LaunchedEffect(route) {
        if (route != AndroidTimeTrialsProductRoute.HOME) homeActionVisible = true
    }
    val postATimeLevel = when (route) {
        AndroidTimeTrialsProductRoute.RANK,
        AndroidTimeTrialsProductRoute.BUILD,
        AndroidTimeTrialsProductRoute.TOURNAMENT,
        -> Mk8dxGlobalActionLevel.Filled
        AndroidTimeTrialsProductRoute.HOME ->
            if (homeActionVisible) Mk8dxGlobalActionLevel.Hidden else Mk8dxGlobalActionLevel.Filled
        else -> Mk8dxGlobalActionLevel.Hidden
    }

    // Phase 17: the product sits under one theme. The legacy backdrop (its
    // gradient, its checker and its blue bloom) and the Race Control palette
    // that nested inside it are retired; every screen draws its own surfaces
    // from the tokens, and the app surface behind them is flat.
    Mk8dxTheme(Mk8dxTheme.appearance) {
        Box(
            modifier
                .testTag("time-trials-product")
                .fillMaxSize()
                .background(Mk8dxTheme.colors.surfaceApp),
        ) {
        Scaffold(
            containerColor = Color.Transparent,
            // Stated, not derived: a transparent container has no content
            // colour of its own, and the backdrop that used to provide one is
            // gone. Without this every unstyled Text falls back to black, which
            // is invisible on the Dark surface.
            contentColor = Mk8dxTheme.colors.textBody,
            contentWindowInsets = WindowInsets(0),
            topBar = {
                Mk8dxProductHeader(
                    activePlayerLabel,
                    onHome = goHome,
                    onProfile = {
                        navigate(
                            if (activePlayerLabel == null) AndroidTimeTrialsProductRoute.ACCOUNT
                            else AndroidTimeTrialsProductRoute.PROFILE,
                        )
                    },
                    onNotifications = {
                        navigate(
                            if (activePlayerLabel == null) AndroidTimeTrialsProductRoute.ACCOUNT
                            else AndroidTimeTrialsProductRoute.NOTIFICATIONS,
                        )
                    },
                    onSettings = { navigate(AndroidTimeTrialsProductRoute.SETTINGS) },
                    onSavedResults = { navigate(AndroidTimeTrialsProductRoute.SAVED_RESULTS) },
                    onApps = { openProductWebsite(context, "${AndroidServerOrigin.current(context)}/?apps=1") },
                    ecosystemClient = ecosystemClient,
                    unsynchronizedResultCount = unsynchronizedResultCount,
                )
            },
            bottomBar = {
                Column {
                    // The global action, docked above the bar rather than
                    // floating over the page: the Scaffold reserves its height,
                    // so it never covers the last row of a list.
                    Mk8dxDockedAction(
                        androidText(language, "Post a time", "Tijd plaatsen"),
                        {
                            // The global action opens the canonical task itself;
                            // without a track it starts on the task's own
                            // TrackSelector (POST_A_TIME §9), which is what the
                            // web's "Post a time" does at `/?post=1`.
                            requestedTrackId = null
                            requestedMode = null
                            pendingScan = null
                            navigate(AndroidTimeTrialsProductRoute.POST_TIME)
                        },
                        postATimeLevel,
                    )
                    if (taskMode) {
                        Mk8dxTaskBar(
                            title = if (route == AndroidTimeTrialsProductRoute.POST_TIME) {
                                androidText(language, "Post a time", "Tijd plaatsen")
                            } else {
                                androidText(language, "Scan a result", "Resultaat scannen")
                            },
                            onClose = goBack,
                            closeLabel = androidText(language, "Close", "Sluiten"),
                        )
                    } else {
                        Mk8dxBottomTabs(
                            destinations = productNavigation.map { destination ->
                                Mk8dxTabDestination(
                                    key = destination.name,
                                    // The destinations are unchanged; the wording follows the
                                    // web product's approved phone bar so the same route is not
                                    // named two different things on two clients.
                                    label = when (destination) {
                                        AndroidTimeTrialsProductRoute.HOME -> androidText(language, "Home", "Home")
                                        AndroidTimeTrialsProductRoute.MANUAL_ENTRY -> androidText(language, "Tracks", "Circuits")
                                        AndroidTimeTrialsProductRoute.RANK -> androidText(language, "Ranking", "Ranglijst")
                                        AndroidTimeTrialsProductRoute.BUILD -> androidText(language, "Build", "Build")
                                        AndroidTimeTrialsProductRoute.TOURNAMENT -> androidText(language, "Tournaments", "Toernooien")
                                        else -> destination.label
                                    },
                                    icon = painterResource(requireNotNull(destination.iconRes)),
                                )
                            },
                            selectedKey = route.name,
                            onSelect = { destination ->
                                val target = AndroidTimeTrialsProductRoute.valueOf(destination.key)
                                if (target == AndroidTimeTrialsProductRoute.MANUAL_ENTRY) {
                                    requestedTrackId = null
                                    requestedMode = null
                                }
                                if (target == AndroidTimeTrialsProductRoute.BUILD) {
                                    requestedBuildPartIds = emptyList()
                                }
                                navigate(target)
                            },
                            navigationLabel = androidText(language, "Main navigation", "Hoofdnavigatie"),
                        )
                    }
                }
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
                Box(Modifier.widthIn(max = 960.dp).fillMaxSize()) {
                when (route) {
                    AndroidTimeTrialsProductRoute.HOME -> AndroidTimeTrialsProductHome(
                        activePlayerLabel,
                        ecosystemClient,
                        // Home's own A4 is posting a time, so it opens the task
                        // itself — the task's TrackSelector is the way in when no
                        // track is named, exactly as on the web (`/?post=1`).
                        onManualEntry = {
                            requestedTrackId = null
                            requestedMode = null
                            pendingScan = null
                            navigate(AndroidTimeTrialsProductRoute.POST_TIME)
                        },
                        onAccount = openAccount,
                        onOpenTrack = { trackId ->
                            requestedTrackId = trackId
                            requestedMode = null
                            navigate(AndroidTimeTrialsProductRoute.MANUAL_ENTRY)
                        },
                        // A journey or competitive tile opens Ranking already
                        // narrowed to the scope, engine class and tracks it
                        // counted - the same place the web tile links to.
                        onOpenFocus = { scope, mode, focus ->
                            val owner = activePlayerId ?: "anonymous"
                            val store = AndroidRankViewStateStore(context, owner)
                            // A staff-ghost tile asks one question - you against
                            // the Nintendo Ghost - so it opens that comparison
                            // and nothing else. Leaving the rivals selected
                            // answered a different question than the tile asked.
                            val columns =
                                if (focus == AndroidRankTrackFocus.STAFF_LEFT && activePlayerId != null) {
                                    listOf(activePlayerId, ANDROID_NINTENDO_STAFF_REFERENCE_ID)
                                } else {
                                    store.read().selectedPlayerIds
                                }
                            store.write(
                                store.read().copy(
                                    section = "TIME_TRIALS",
                                    scope = scope.apiValue,
                                    mode = mode,
                                    tab = "TRACKS",
                                    trackFocus = focus.apiValue,
                                    selectedPlayerIds = columns,
                                ),
                            )
                            navigate(AndroidTimeTrialsProductRoute.RANK)
                        },
                        onOpenTotalRanking = { mode ->
                            val owner = activePlayerId ?: "anonymous"
                            val store = AndroidRankViewStateStore(context, owner)
                            store.write(
                                store.read().copy(
                                    section = "TIME_TRIALS",
                                    scope = "all",
                                    mode = mode,
                                    tab = "TOTAL",
                                    trackFocus = null,
                                ),
                            )
                            navigate(AndroidTimeTrialsProductRoute.RANK)
                        },
                        onOpenRecords = { navigate(AndroidTimeTrialsProductRoute.MY_STATS) },
                        // Rating and tier are Tournament facts, so the tile
                        // opens the place that explains them: the Tournament
                        // half of Rank.
                        onOpenTournamentStanding = {
                            val owner = activePlayerId ?: "anonymous"
                            val store = AndroidRankViewStateStore(context, owner)
                            store.write(store.read().copy(section = "TOURNAMENT"))
                            navigate(AndroidTimeTrialsProductRoute.RANK)
                        },
                        // Mastery is per track, so its tile opens the Mastery
                        // view of Rank where every track and tier is listed.
                        onOpenMastery = {
                            val owner = activePlayerId ?: "anonymous"
                            val store = AndroidRankViewStateStore(context, owner)
                            store.write(
                                store.read().copy(
                                    section = "TIME_TRIALS",
                                    tab = "MASTERY",
                                    trackFocus = null,
                                ),
                            )
                            navigate(AndroidTimeTrialsProductRoute.RANK)
                        },
                        onOpenCombo = { partIds ->
                            requestedBuildPartIds = partIds
                            navigate(AndroidTimeTrialsProductRoute.BUILD)
                        },
                        // Home's inbox entry opens the inbox itself; signed out
                        // there is no inbox, and the account is the way in.
                        onOpenInbox = {
                            navigate(
                                if (activePlayerLabel == null) AndroidTimeTrialsProductRoute.ACCOUNT
                                else AndroidTimeTrialsProductRoute.NOTIFICATIONS,
                            )
                        },
                        onActionVisibility = { visible -> homeActionVisible = visible },
                        unsynchronizedResultCount = unsynchronizedResultCount,
                    )
                    // A03: the scanner is the camera and the engine only. What it
                    // recognises returns into the canonical task's form.
                    AndroidTimeTrialsProductRoute.SCAN_RESULT -> Mk8dxTheme(Mk8dxTheme.appearance) {
                        scanResultContent(
                            openAccount, requestedTrackId, requestedMode, requestedTestScan,
                        ) { submission ->
                            pendingScan = submission
                            requestedTrackId = submission.trackId
                            requestedMode = submission.mode
                            requestedTestScan = false
                            navigate(AndroidTimeTrialsProductRoute.POST_TIME)
                        }
                    }
                    // A02's first half: the track chooser and the track in context.
                    AndroidTimeTrialsProductRoute.MANUAL_ENTRY -> Mk8dxTheme(Mk8dxTheme.appearance) {
                        tracksContent(
                            openAccount,
                            requestedTrackId,
                            requestedMode,
                            AndroidTracksActions(
                                chooseTrack = { trackId -> requestedTrackId = trackId },
                                changeTrack = { requestedTrackId = null },
                                modeChanged = { mode -> requestedMode = mode },
                                postTime = { trackId, mode ->
                                    requestedTrackId = trackId
                                    // The class chosen on the track screen is the
                                    // class the task opens on: a 200cc track used
                                    // to open the scanner on 150cc and a 200cc
                                    // ghost was saved as 150cc (owner 2026-09-18).
                                    requestedMode = mode
                                    pendingScan = null
                                    navigate(AndroidTimeTrialsProductRoute.POST_TIME)
                                },
                                openCombo = { partIds ->
                                    requestedBuildPartIds = partIds
                                    navigate(AndroidTimeTrialsProductRoute.BUILD)
                                },
                                openPlayer = { playerId ->
                                    requestedRanking = null
                                    requestedPlayerId = playerId
                                    navigate(AndroidTimeTrialsProductRoute.RANK)
                                },
                            ),
                        )
                    }
                    // A02's second half: the one canonical Post-a-Time task.
                    AndroidTimeTrialsProductRoute.POST_TIME -> Mk8dxTheme(Mk8dxTheme.appearance) {
                        postTimeContent(
                            requestedTrackId,
                            requestedMode,
                            pendingScan,
                            AndroidPostTimeActions(
                                chooseTrack = { trackId -> requestedTrackId = trackId },
                                changeTrack = { requestedTrackId = null },
                                modeChanged = { mode -> requestedMode = mode },
                                scan = { trackId, mode ->
                                    requestedTrackId = trackId
                                    requestedMode = mode
                                    navigate(AndroidTimeTrialsProductRoute.SCAN_RESULT)
                                },
                                scanConsumed = { pendingScan = null },
                                complete = {
                                    pendingScan = null
                                    backStack = emptyList()
                                    routeName = AndroidTimeTrialsProductRoute.HOME.name
                                    navigationPreferences.edit()
                                        .putString("route", routeName)
                                        .apply()
                                },
                                savedResults = {
                                    pendingScan = null
                                    navigate(AndroidTimeTrialsProductRoute.SAVED_RESULTS)
                                },
                            ),
                        )
                    }
                    // Saved results is migrated (A08): the outbox behaviour is
                    // untouched, the presentation is the design system's.
                    AndroidTimeTrialsProductRoute.SAVED_RESULTS -> Mk8dxTheme(Mk8dxTheme.appearance) {
                        savedResultsContent(
                            openAccount,
                            {
                                requestedTrackId = null
                                requestedMode = null
                                pendingScan = null
                                navigate(AndroidTimeTrialsProductRoute.POST_TIME)
                            },
                        )
                    }
                    AndroidTimeTrialsProductRoute.TOURNAMENT -> tournamentContent(
                        openAccount,
                        remember(
                            requestedNightId, requestedStatistics, requestedStatisticsSort,
                            requestedStatisticsAscending, requestedStatisticsFocus,
                            requestedStatisticsFilters,
                        ) {
                            if (requestedNightId == null && !requestedStatistics) {
                                null
                            } else {
                                AndroidTournamentRequest(
                                    nightId = requestedNightId,
                                    statistics = requestedStatistics,
                                    statisticsSort = requestedStatisticsSort,
                                    statisticsAscending = requestedStatisticsAscending,
                                    statisticsFocus = requestedStatisticsFocus,
                                    statisticsFilters = requestedStatisticsFilters
                                        .split("|").filter { it.contains("=") }
                                        .associate {
                                            it.substringBefore("=") to it.substringAfter("=")
                                        },
                                )
                            }
                        },
                        {
                            requestedNightId = null
                            requestedStatistics = false
                            requestedStatisticsSort = null
                            requestedStatisticsFocus = null
                            requestedStatisticsFilters = ""
                        },
                        // And on from that track to the time trials on it.
                        { trackId ->
                            requestedTrackId = trackId
                            requestedMode = null
                            navigate(AndroidTimeTrialsProductRoute.MANUAL_ENTRY)
                        },
                    )
                    // Ranking is migrated (A04): it runs in the design system's
                    // own theme, in the appearance the Player chose, instead of
                    // the Race Control palette the unmigrated routes still use.
                    AndroidTimeTrialsProductRoute.RANK -> Mk8dxTheme(Mk8dxTheme.appearance) {
                    rankContent(
                        openAccount,
                        { trackId ->
                            requestedTrackId = trackId
                            requestedMode = null
                            navigate(AndroidTimeTrialsProductRoute.MANUAL_ENTRY)
                        },
                        requestedPlayerId,
                        requestedRanking,
                        {
                            requestedPlayerId = null
                            requestedRanking = null
                        },
                        // A track from the tournament record opens that
                        // track's own TrueSkill page, exactly as the site
                        // does with ?tournaments=1&stats_focus=track.x
                        // (owner, 2026-09-16).
                        { trackId ->
                            requestedNightId = null
                            requestedStatistics = true
                            requestedStatisticsFocus = trackId
                            navigate(AndroidTimeTrialsProductRoute.TOURNAMENT)
                        },
                    )
                    }
                    // Build is migrated (A05), like Ranking: the design system's
                    // own theme in the appearance the Player chose.
                    AndroidTimeTrialsProductRoute.BUILD -> Mk8dxTheme(Mk8dxTheme.appearance) {
                        buildContent(requestedBuildPartIds)
                    }
                    // Account · Players is migrated (A09).
                    AndroidTimeTrialsProductRoute.ACCOUNT -> Mk8dxTheme(Mk8dxTheme.appearance) {
                        authenticationContent()
                    }
                    // Profile & Records is migrated (A10): the same results,
                    // the same record book and the same management workflow,
                    // in the design system's own theme.
                    AndroidTimeTrialsProductRoute.PROFILE -> Mk8dxTheme(Mk8dxTheme.appearance) {
                        profileContent(
                            openAccount,
                            {
                                requestedTestScan = true
                                navigate(AndroidTimeTrialsProductRoute.SCAN_RESULT)
                            },
                        )
                    }
                    AndroidTimeTrialsProductRoute.MY_STATS -> Mk8dxTheme(Mk8dxTheme.appearance) {
                        myStatsContent(
                            openAccount,
                            { navigate(AndroidTimeTrialsProductRoute.PROFILE) },
                            { trackId, mode ->
                                requestedTrackId = trackId
                                requestedMode = mode
                                navigate(AndroidTimeTrialsProductRoute.MANUAL_ENTRY)
                            },
                            { trackId, mode ->
                                requestedTrackId = trackId
                                requestedMode = mode
                                pendingScan = null
                                navigate(AndroidTimeTrialsProductRoute.POST_TIME)
                            },
                        )
                    }
                    // Notifications (A11) and Settings (A12) are migrated: the
                    // inbox and every preference behave as they did, drawn in
                    // the design system's own theme.
                    AndroidTimeTrialsProductRoute.NOTIFICATIONS -> Mk8dxTheme(Mk8dxTheme.appearance) {
                        notificationsContent(
                            openAccount,
                            { trackId, mode ->
                                requestedTrackId = trackId
                                requestedMode = mode
                                navigate(AndroidTimeTrialsProductRoute.MANUAL_ENTRY)
                            },
                            { navigate(AndroidTimeTrialsProductRoute.SAVED_RESULTS) },
                        )
                    }
                    AndroidTimeTrialsProductRoute.SETTINGS -> Mk8dxTheme(Mk8dxTheme.appearance) {
                        settingsContent(
                            openAccount,
                            { navigate(AndroidTimeTrialsProductRoute.ADMINISTRATION) },
                            { navigate(AndroidTimeTrialsProductRoute.SAVED_RESULTS) },
                        )
                    }
                    AndroidTimeTrialsProductRoute.ADMINISTRATION -> administrationContent {
                        navigate(AndroidTimeTrialsProductRoute.SETTINGS)
                    }
                }
                }
            }
        }
        }
    }
}

@Composable
private fun Mk8dxProductHeader(
    playerLabel: String?,
    onHome: () -> Unit,
    onProfile: () -> Unit,
    onNotifications: () -> Unit,
    onSettings: () -> Unit,
    onSavedResults: () -> Unit,
    onApps: () -> Unit,
    ecosystemClient: AndroidTimeTrialsEcosystemDataSource?,
    unsynchronizedResultCount: Int,
) {
    val context = LocalContext.current
    var availableUpdate by remember(ecosystemClient, playerLabel) {
        mutableStateOf<AndroidAvailableAppUpdate?>(null)
    }
    var unreadNotifications by remember(ecosystemClient, playerLabel) { mutableIntStateOf(0) }
    // Reading the inbox used to leave this number alone for up to five
    // minutes: "You're all caught up" on one screen and "3" on the bell above
    // it. The revision says when to ask again; the server still owns the count.
    val badgeRevision by AndroidNotificationBadge.revision.collectAsState()
    var avatarCharacterId by remember(ecosystemClient, playerLabel) { mutableStateOf<String?>(null) }
    LaunchedEffect(ecosystemClient, playerLabel, badgeRevision) {
        while (isActive) {
            if (ecosystemClient == null || playerLabel == null) {
                availableUpdate = null
                unreadNotifications = 0
                avatarCharacterId = null
            } else {
                withContext(Dispatchers.IO) {
                    runCatching { ecosystemClient.playerProfilePreferences()?.favoriteCharacterId }
                        .getOrNull()
                }?.let { avatarCharacterId = it }
                // A failed read leaves whatever was found before standing: a
                // network or catalog blip must not make the reminder vanish. A
                // *successful* read is an answer either way, so it can also
                // clear it - `getOrNull` used to collapse the two, and the bell
                // kept its extra one long after the update was installed.
                val release = withContext(Dispatchers.IO) {
                    runCatching { ecosystemClient.latestAndroidRelease() }
                }
                if (release.isSuccess) {
                    availableUpdate = release.getOrNull()
                        ?.availableAfter(BuildConfig.VERSION_CODE)
                }
                withContext(Dispatchers.IO) {
                    runCatching { ecosystemClient.notifications()?.unreadCount ?: 0 }.getOrNull()
                }?.let { unreadNotifications = it }
            }
            // Updates are intentionally sticky once discovered, while the poll itself stays
            // infrequent so the shared-IP hosting request budget is not needlessly consumed.
            delay(300_000)
        }
    }
    val appIcon = remember(context) {
        context.applicationInfo.loadIcon(context.packageManager).toBitmap(192, 192).asImageBitmap()
    }
    val colors = Mk8dxTheme.colors
    Mk8dxTopBar(
        brand = {
            // The owner's app icon is the mark, unchanged: the wordmark and
            // the product line around it are the design system's display face.
            Mk8dxBrandLockup(
                appIcon,
                Modifier.weight(1f, fill = false),
                platform = "ANDROID",
                onClick = onHome,
            )
        },
        actions = {
            // The web hides its passive sync indicator on a phone: it spends
            // a scarce slot without offering an action. A local-first client
            // must not lose the fact, so the APK keeps it exactly when it
            // says something - there is something still waiting to sync.
            if (unsynchronizedResultCount > 0) Box {
                IconButton(onClick = onSavedResults, modifier = Modifier.testTag("product-sync-status")) {
                    Icon(
                        painterResource(R.drawable.ic_sync_status),
                        contentDescription = "$unsynchronizedResultCount results waiting to sync",
                        tint = colors.statusWarning,
                    )
                }
                CountBadge(
                    unsynchronizedResultCount,
                    Modifier.align(Alignment.TopEnd).testTag("product-sync-count"),
                    colors.statusWarning,
                    colors.surfaceApp,
                )
            }
            // "Get the app" is an offer rather than a place, so the web keeps
            // it beside the account actions on every width. The APK opens the
            // same hosted page; the offer covers the desktop and web clients
            // too, so it is not redundant inside the Android app.
            IconButton(onClick = onApps, modifier = Modifier.testTag("product-apps")) {
                Icon(
                    painterResource(R.drawable.ic_nav_apps),
                    contentDescription = androidText(
                        LocalAndroidProductLanguage.current,
                        "Get the MK8DX app", "Download de MK8DX-app",
                    ),
                    tint = colors.textSecondary,
                )
            }
            // The web identity chip is the avatar next to the display name.
            // A generic person glyph over a username was the APK's own
            // invention and read as a different product.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .clickable(onClick = onProfile)
                    .padding(horizontal = Mk8dxSpacing.xs, vertical = Mk8dxSpacing.sm)
                    .testTag("product-profile"),
            ) {
                if (playerLabel == null) {
                    Icon(
                        Icons.Filled.Person,
                        contentDescription = "Sign in",
                        tint = colors.textSecondary,
                        modifier = Modifier.size(28.dp).padding(2.dp),
                    )
                } else {
                    val avatarPart = avatarCharacterId?.let { id ->
                        AndroidLoadoutVariants.characterParts(
                            AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.CHARACTER),
                        ).firstOrNull { it.id == id }
                    }
                    if (avatarPart != null) {
                        ProductAssetImage(
                            avatarPart.assetPath,
                            playerLabel.take(1),
                            colors.personalAccent,
                            Modifier.size(28.dp),
                            contentDescription = "Profile for $playerLabel",
                        )
                    } else {
                        Icon(
                            Icons.Filled.Person,
                            contentDescription = "Profile for $playerLabel",
                            tint = colors.textSecondary,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                    Text(
                        playerLabel,
                        style = Mk8dxTheme.type.label,
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .padding(start = 5.dp)
                            .widthIn(max = 72.dp)
                            .testTag("product-account-name"),
                    )
                }
            }
            Box {
                val notificationCount = unreadNotifications + if (availableUpdate == null) 0 else 1
                IconButton(onClick = onNotifications, modifier = Modifier.testTag("product-notifications")) {
                    Icon(
                        Icons.Filled.Notifications,
                        contentDescription = if (notificationCount > 0) "$notificationCount notifications" else "Notifications",
                        tint = if (notificationCount > 0) colors.actionPrimary else colors.textSecondary,
                    )
                }
                if (notificationCount > 0) {
                    CountBadge(
                        notificationCount,
                        Modifier.align(Alignment.TopEnd).testTag("product-notification-count"),
                        colors.statusError,
                        colors.surfaceApp,
                    )
                }
            }
            IconButton(onClick = onSettings, modifier = Modifier.testTag("product-settings")) {
                Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = colors.textSecondary)
            }
        },
    )
}

/** Opens a hosted product page; the app itself keeps working offline. */
/**
 * Open one of the product's own pages in a **browser**.
 *
 * Since the app became the verified handler for `example.invalid`, a plain
 * `ACTION_VIEW` comes straight back to this app - so the Apps button, the
 * download page and the retired-build screen would all have opened Home
 * instead of the page they name. The browser is resolved explicitly and this
 * package is excluded, which is the only way to say "not me" to an intent.
 */
internal fun openProductWebsite(context: android.content.Context, url: String) {
    val intent = android.content.Intent(
        android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url),
    ).addCategory(android.content.Intent.CATEGORY_BROWSABLE)
    val browser = runCatching {
        context.packageManager.queryIntentActivities(
            android.content.Intent(
                android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://example.com"),
            ).addCategory(android.content.Intent.CATEGORY_BROWSABLE),
            0,
        ).map { it.activityInfo.packageName }
            .firstOrNull { it != context.packageName }
    }.getOrNull()
    runCatching {
        context.startActivity(browser?.let { intent.setPackage(it) } ?: intent)
    }.onFailure {
        // No browser would take it: better the app than nothing.
        runCatching { context.startActivity(intent.setPackage(null)) }
    }
}

@Composable
private fun CountBadge(count: Int, modifier: Modifier, background: Color, foreground: Color) {
    Surface(color = background, contentColor = foreground, shape = RoundedCornerShape(50), modifier = modifier) {
        Text(
            count.coerceAtMost(99).toString(),
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp),
        )
    }
}

/**
 * A01 Home, inside the design system's own theme (Phase 10).
 *
 * Signed out it is the product's invitation — the one A4 that opens the track
 * browser — and signed in it is [AndroidHomeExperience]'s personal hub. Either
 * way exactly one filled action is on the page, and the shell's docked "Post a
 * time" appears only once that action has scrolled away.
 */
@Composable
private fun AndroidTimeTrialsProductHome(
    activePlayerLabel: String?,
    ecosystemClient: AndroidTimeTrialsEcosystemDataSource?,
    onManualEntry: () -> Unit,
    onAccount: () -> Unit,
    onOpenTrack: (String) -> Unit,
    onOpenFocus: (AndroidTimeTrialTrackScope, Int, AndroidRankTrackFocus) -> Unit,
    onOpenTotalRanking: (Int) -> Unit,
    onOpenTournamentStanding: () -> Unit = {},
    onOpenMastery: () -> Unit = {},
    onOpenRecords: () -> Unit,
    onOpenCombo: (List<String>) -> Unit,
    onOpenInbox: () -> Unit = {},
    onActionVisibility: (Boolean) -> Unit = {},
    unsynchronizedResultCount: Int,
) {
    val language = LocalAndroidProductLanguage.current
    Mk8dxTheme(Mk8dxTheme.appearance) {
        val colors = Mk8dxTheme.colors
        val type = Mk8dxTheme.type
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.surfaceApp)
                .verticalScroll(rememberScrollState())
                .padding(vertical = Mk8dxSpacing.md),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            if (activePlayerLabel == null) {
                Column(
                    Modifier.padding(horizontal = Mk8dxSpacing.md),
                    verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                ) {
                    Mk8dxDisplayText(
                        androidText(language, "Race. Record. Improve.", "Rijden. Vastleggen. Verbeteren."),
                        type.display3,
                        Modifier.testTag("time-trials-product-title"),
                    )
                    Text(
                        androidText(
                            language,
                            "Explore all 96 tracks, compare times with the community and record your Mario Kart 8 Deluxe results: manually, with your phone camera or fully automatically through a capture card.",
                            "Verken alle 96 circuits, vergelijk tijden met de community en leg je Mario Kart 8 Deluxe-tijden vast: handmatig, met de camera van je telefoon of volledig automatisch via een capturekaart.",
                        ),
                        style = type.body,
                        color = colors.textBody,
                    )
                    Mk8dxButton(
                        androidText(language, "Post a Time Trial", "Time Trial plaatsen"),
                        onManualEntry,
                        variant = Mk8dxButtonVariant.Primary,
                        size = Mk8dxButtonSize.Lg,
                        stopwatch = true,
                        tag = "time-trials-open-manual",
                        modifier = Modifier
                            .fillMaxWidth()
                            .androidReportVisibility(onActionVisibility),
                    )
                    Text(
                        androidText(
                            language,
                            "Choose a cup and track, then type the result or scan it with the camera.",
                            "Kies een beker en circuit en voer het resultaat in of scan het met de camera.",
                        ),
                        style = type.bodyS,
                        color = colors.textSecondary,
                    )
                }
            }
            AndroidHomeExperience(
                client = ecosystemClient,
                signedInPlayerId = activePlayerLabel,
                refreshSignal = unsynchronizedResultCount,
                onOpenTrack = onOpenTrack,
                onOpenFocus = onOpenFocus,
                onOpenTotalRanking = onOpenTotalRanking,
                // The web hero's primary action opens the canonical cup/track
                // browser, exactly like its "Post a time" link.
                onSubmitTime = onManualEntry,
                onOpenRecords = onOpenRecords,
                onOpenTournamentStanding = onOpenTournamentStanding,
                onOpenMastery = onOpenMastery,
                onOpenCombo = onOpenCombo,
                onOpenInbox = onOpenInbox,
                // Signed out the invitation above is the page's A4; signed in
                // the hero's own action is, and it reports for itself.
                onActionVisibility = if (activePlayerLabel == null) {
                    {}
                } else {
                    onActionVisibility
                },
            )
            if (activePlayerLabel == null) {
                Mk8dxPanel(
                    androidText(language, "BRING YOUR PROGRESS WITH YOU", "NEEM JE VOORTGANG MEE"),
                    modifier = Modifier.padding(horizontal = Mk8dxSpacing.md),
                ) {
                    Text(
                        androidText(
                            language,
                            "Sign in to sync results to your Player profile. You can explore the app first.",
                            "Meld je aan om resultaten met je spelersprofiel te synchroniseren. Je kunt de app eerst verkennen.",
                        ),
                        style = type.body,
                        color = colors.textBody,
                    )
                    Mk8dxButton(
                        androidText(language, "Sign in", "Aanmelden"),
                        onAccount,
                        variant = Mk8dxButtonVariant.Secondary,
                        tag = "time-trials-open-account",
                    )
                }
            }
        }
    }
}

@Composable
internal fun AndroidUnavailableProductFeature(
    title: String,
    explanation: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp).testTag("time-trials-feature-unavailable"),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))
        Text(explanation)
    }
}

/* Deep enough for any real path through the product, shallow enough that a
   saved instance state stays small. */
private const val ANDROID_BACK_STACK_DEPTH = 12
