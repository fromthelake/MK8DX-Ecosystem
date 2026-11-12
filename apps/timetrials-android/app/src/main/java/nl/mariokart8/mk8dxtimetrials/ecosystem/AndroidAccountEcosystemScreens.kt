package nl.mariokart8.mk8dxtimetrials.ecosystem

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.Manifest
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import nl.mariokart8.mk8dxtimetrials.auth.androidReadableReference
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import nl.mariokart8.mk8dxtimetrials.ui.androidLocalizedPresentation
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceSection
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceSettings
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxArtHero
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxBoardRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxFactRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxGroupBoard
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatBlock
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTabOption
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTabs
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDialog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMark
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNotificationItem
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxOptionRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSearchField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSegmentedControl
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSelectField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTextField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxToggleRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.AndroidDutchPresentationCatalog
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.AndroidBuildPart
import nl.mariokart8.mk8dxtimetrials.builds.AndroidBuildPartCategory
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutVariants
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.BuildConfig
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.ui.AndroidPresentationCountry
import nl.mariokart8.mk8dxtimetrials.notifications.AndroidCanonicalNotificationSync
import nl.mariokart8.mk8dxtimetrials.notifications.AndroidNotificationBadge
import nl.mariokart8.mk8dxtimetrials.notifications.AndroidNotificationProjectionSettings
import nl.mariokart8.mk8dxtimetrials.notifications.permissionGranted
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AndroidProfileRecordsScreen(
    client: AndroidTimeTrialsEcosystemDataSource,
    playerId: String?,
    onSignIn: () -> Unit,
    apiOrigin: String,
    playerLabel: String? = null,
    // Developer affordances live here rather than beside Camera and Gallery,
    // where they were a step in submitting a time that nobody wanted to take.
    onRunTestScan: (() -> Unit)? = null,
    // Present only for an administrator with a signed-in native session; the
    // screen withdraws itself when the server says otherwise.
    identityLinks: (@Composable () -> Unit)? = null,
) {
    val context = LocalContext.current
    var showRecords by remember { mutableStateOf(false) }
    var results by remember(client, playerId) { mutableStateOf<List<AndroidPublicTimeTrialResult>?>(null) }
    var managedResults by remember(client, playerId) { mutableStateOf<List<AndroidManagedTimeTrial>?>(null) }
    var records by remember(client) { mutableStateOf<AndroidRecordBook?>(null) }
    var profile by remember(client, playerId) { mutableStateOf<AndroidProfilePlayer?>(null) }
    var error by remember(client, playerId) { mutableStateOf<String?>(null) }
    var refresh by remember(client, playerId) { mutableStateOf(0) }
    var pendingManagement by remember { mutableStateOf<Pair<AndroidManagedTimeTrial, Boolean>?>(null) }
    var managementReason by remember { mutableStateOf("wrong_track_or_mode") }
    var managementBusy by remember { mutableStateOf(false) }
    // ADR-0211: the result being fixed in the form of Post a Time.
    var editing by remember { mutableStateOf<AndroidManagedTimeTrial?>(null) }
    val scope = rememberCoroutineScope()
    val language = LocalAndroidProductLanguage.current
    LaunchedEffect(client, playerId, refresh) {
        if (playerId == null) return@LaunchedEffect
        withContext(Dispatchers.IO) {
            runCatching {
                AndroidProfileScreenData(
                    results = client.playerResults(playerId),
                    records = client.recordBook(),
                    profile = client.playerProfile(playerId),
                    managedResults = runCatching { client.managedTimeTrials() }
                        .getOrDefault(emptyList())
                        .filter { it.playerId == playerId },
                )
            }.onSuccess { loaded ->
                    results = loaded.results
                    records = loaded.records
                    profile = loaded.profile
                    managedResults = loaded.managedResults
                    error = null
                }
                .onFailure { error = "Your profile could not be loaded right now." }
        }
    }
    val colors = Mk8dxTheme.colors
    val numbers = if (language == AndroidProductLanguage.DUTCH) {
        Mk8dxNumberLanguage.NL
    } else {
        Mk8dxNumberLanguage.EN
    }
    // The same edit form My sessions and the leaderboards open (owner 2026-09-29); withdrawing
    // sits behind it, confirmed by a swipe.
    editing?.let { result ->
        AndroidManageResultOverlay(
            result.submissionId, client, playerId,
            onClose = { saved ->
                editing = null
                if (saved) refresh += 1
            },
            preloaded = result,
        )
    }
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .testTag("profile-records-screen"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(Mk8dxSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        item {
            // MEDIUM spectacle (§5): an identity strip with the Player's own
            // character beside the name, and no backdrop - the tabs under it
            // are data and stay calm.
            Mk8dxArtHero(
                title = profile?.displayName ?: playerLabel ?: androidText(language, "Profile & Records", "Profiel & records"),
                meta = androidText(
                    language,
                    "Your published Time Trials and the community record book.",
                    "Jouw gepubliceerde Time Trials en het recordboek van de community.",
                ),
                art = androidProfileAvatarPath(profile)?.let { path ->
                    {
                        ProductAssetImage(
                            path = path,
                            fallback = (profile?.displayName ?: "?").take(1),
                            accent = colors.textSecondary,
                            contentDescription = null,
                            modifier = Modifier.size(52.dp),
                        )
                    }
                },
            )
        }
        item {
            // The two halves were two buttons where the one you were reading
            // did nothing when pressed. They are tabs: the selected one is
            // announced, and a screen reader hears which view is open.
            Mk8dxTabs(
                label = androidText(language, "Profile view", "Profielweergave"),
                options = listOf(
                    Mk8dxTabOption(false, "My results", "profile-tab-results"),
                    Mk8dxTabOption(true, "Records", "profile-tab-records"),
                ),
                value = showRecords,
                onChange = { showRecords = it },
            )
        }
        if (playerId == null) {
            item {
                Mk8dxPanel(title = null) {
                    Text(
                        "Sign in to see your Player profile.",
                        style = Mk8dxTheme.type.body,
                        color = colors.textBody,
                    )
                    Mk8dxButton("Sign in", onSignIn, variant = Mk8dxButtonVariant.Primary)
                }
            }
            return@LazyColumn
        }
        if (!showRecords) item {
            val loaded = results
            Mk8dxPanel(title = androidText(language, "TIME TRIAL CAREER", "TIME TRIAL-CARRIÈRE")) {
                if (loaded == null && error == null) {
                    Text(
                        "Loading your results…",
                        style = Mk8dxTheme.type.body,
                        color = colors.textSecondary,
                    )
                } else {
                    // The same three numbers the sentence carried, as figures.
                    // Each engine count says which engine it counts with an
                    // EngineMark, so the class is never only a colour (§7).
                    val cc150 = loaded.orEmpty().count { it.mode == 150 }
                    val cc200 = loaded.orEmpty().count { it.mode == 200 }
                    FlowRow(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xl),
                        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
                    ) {
                        Mk8dxStatBlock(
                            androidText(language, "Published results", "Gepubliceerde resultaten"),
                            Mk8dxNumeric.formatCount(loaded.orEmpty().size.toLong(), numbers),
                        )
                        androidProfileEngineCount(150, cc150, numbers)
                        androidProfileEngineCount(200, cc200, numbers)
                    }
                }
                Mk8dxButton(
                    "Open full web profile",
                    // `?profile=` was never a route the Web reads: it landed
                    // on the signed-out marketing page. `?player=` is the one
                    // that opens a profile, and it takes a player id as
                    // readily as a screen name.
                    onClick = { openWebsite(context, "$apiOrigin/?player=${Uri.encode(playerId)}") },
                    variant = Mk8dxButtonVariant.Secondary,
                )
            }
        }
        if (!showRecords) profile?.let { loadedProfile ->
            item { PublicProfilePreferenceCard(loadedProfile) }
        }
        if (!showRecords && identityLinks != null) {
            item {
                Mk8dxSectionLabel("Accounts and Players")
                Mk8dxMetaLine(
                    "Link the address somebody signs in with to the Player whose history is theirs.",
                )
            }
            item { identityLinks() }
        }
        if (!showRecords && onRunTestScan != null) {
            item {
                Mk8dxPanel(title = "Debug and test") {
                    Text(
                        "Run a test scan",
                        style = Mk8dxTheme.type.title,
                        color = colors.textPrimary,
                    )
                    Mk8dxMetaLine(
                        "Tools for checking the app itself. Nothing here counts toward rankings " +
                            "or records. Puts a bundled result image through the real scanner and " +
                            "the real sync. The saved result is labelled as a test and expires " +
                            "after 24 hours.",
                    )
                    Mk8dxButton(
                        "Run a test scan",
                        onRunTestScan,
                        variant = Mk8dxButtonVariant.Secondary,
                        tag = "profile-run-test-scan",
                    )
                }
            }
        }
        if (!showRecords) error?.let { message ->
            item { Mk8dxStatusMessage(message, tone = Mk8dxStatusTone.Error) }
        }
        if (!showRecords) results?.take(12)?.let { latest ->
            item {
                Mk8dxSectionLabel("Latest Time Trials")
                Mk8dxMetaLine("Full lap, coin, mushroom and build details when recorded")
            }
            if (latest.isEmpty()) {
                item {
                    Mk8dxPanel(title = null) {
                        Text(
                            "No published Time Trials yet.",
                            style = Mk8dxTheme.type.body,
                            color = colors.textBody,
                        )
                    }
                }
            }
            items(latest, key = { "published-${it.resultId}" }) { result ->
                ResultDetailCard(
                    result,
                    managedResults.orEmpty().firstOrNull { it.submissionId == result.resultId },
                    onManage = {
                        managementReason = "wrong_track_or_mode"
                        pendingManagement = it to true
                    },
                    onFix = { editing = it },
                )
            }
            val retired = managedResults.orEmpty().filter { it.retirementState == "retired" }
            if (retired.isNotEmpty()) {
                item {
                    Mk8dxSectionLabel(
                        androidText(language, "Withdrawn results", "Ingetrokken resultaten"),
                    )
                    Mk8dxMetaLine(
                        androidText(
                            language,
                            "Kept in your audit history and restorable",
                            "Bewaard in je geschiedenis en herstelbaar",
                        ),
                    )
                }
                items(retired, key = { "retired-${it.submissionId}" }) { result ->
                    ManagedResultCard(result) { pendingManagement = result to false }
                }
            }
        }
        if (showRecords) records?.let { book ->
            item {
                Mk8dxSectionLabel("Community Records")
                Mk8dxMetaLine("The same community records as the website")
            }
            items(book.categories, key = AndroidRecordCategory::key) { category ->
                RecordCategoryCard(category, numbers, language)
            }
        }
        if (showRecords && records == null) {
            item {
                if (error == null) {
                    Text(
                        "Loading community records…",
                        style = Mk8dxTheme.type.body,
                        color = colors.textSecondary,
                    )
                } else {
                    Mk8dxStatusMessage(error!!, tone = Mk8dxStatusTone.Error)
                }
            }
        }
    }
    pendingManagement?.let { (result, retire) ->
        Mk8dxDialog(
            title = androidText(
                language,
                if (retire) "Withdraw this result?" else "Restore this result?",
                if (retire) "Dit resultaat intrekken?" else "Dit resultaat herstellen?",
            ),
            closeLabel = androidText(language, "Cancel", "Annuleren"),
            onDismiss = { if (!managementBusy) pendingManagement = null },
        ) {
            Text(
                androidText(
                    language,
                    if (retire) {
                        "It leaves standings and Community Activity, while its audit history is kept. Choose why you are withdrawing it."
                    } else {
                        "The result returns through the normal publication rules."
                    },
                    if (retire) {
                        "Het verdwijnt uit klassementen en Community Activity; de geschiedenis blijft bewaard. Kies waarom je het intrekt."
                    } else {
                        "Het resultaat keert terug via de normale publicatieregels."
                    },
                ),
                style = Mk8dxTheme.type.body,
                color = colors.textBody,
            )
            if (retire) {
                listOf(
                    "wrong_track_or_mode" to androidText(language, "Wrong track or cc", "Verkeerd circuit of cc"),
                    "incorrect_time" to androidText(language, "Incorrect time", "Onjuiste tijd"),
                    "duplicate" to androidText(language, "Duplicate", "Dubbel resultaat"),
                    "other" to androidText(language, "Other reason", "Andere reden"),
                ).forEach { (value, label) ->
                    // One reason is chosen, so the rows are radio options, not
                    // four independent filter chips that all looked pressable.
                    Mk8dxOptionRow(
                        label = label,
                        selected = managementReason == value,
                        onClick = { managementReason = value },
                        modifier = Modifier.testTag("retire-reason-$value"),
                    )
                }
            }
            Mk8dxButton(
                label = androidText(
                    language,
                    if (retire) "Withdraw" else "Restore",
                    if (retire) "Intrekken" else "Herstellen",
                ),
                onClick = {
                    managementBusy = true
                    scope.launch {
                        withContext(Dispatchers.IO) {
                            runCatching {
                                if (retire) client.retireTimeTrial(result.submissionId, managementReason)
                                else client.restoreTimeTrial(result.submissionId)
                            }
                        }.onSuccess {
                            pendingManagement = null
                            refresh += 1
                        }.onFailure {
                            error = androidText(
                                language,
                                "The result could not be updated.",
                                "Het resultaat kon niet worden bijgewerkt.",
                            )
                        }
                        managementBusy = false
                    }
                },
                variant = if (retire) Mk8dxButtonVariant.Danger else Mk8dxButtonVariant.Primary,
                loadingLabel = if (managementBusy) {
                    androidText(language, "Working…", "Bezig…")
                } else {
                    null
                },
                tag = if (retire) "confirm-retire-result" else "confirm-restore-result",
            )
        }
    }
}

private data class AndroidProfileScreenData(
    val results: List<AndroidPublicTimeTrialResult>,
    val records: AndroidRecordBook?,
    val profile: AndroidProfilePlayer?,
    val managedResults: List<AndroidManagedTimeTrial>,
)

/** The character a Player chose, as the art path the small hero draws. */
private fun androidProfileAvatarPath(profile: AndroidProfilePlayer?): String? {
    val avatarId = profile?.avatarId ?: return null
    val characters = AndroidLoadoutVariants.characterParts(
        AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.CHARACTER),
    )
    return characters.firstOrNull { it.id == avatarId }?.assetPath
}

/** One engine's count: the mark says the class, the figure is the number. */
@Composable
private fun androidProfileEngineCount(engine: Int, count: Int, numbers: Mk8dxNumberLanguage) {
    Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs)) {
        Mk8dxEngineMark(engine)
        Text(
            Mk8dxNumeric.formatCount(count.toLong(), numbers),
            style = Mk8dxTheme.type.dataM,
            color = Mk8dxTheme.colors.textPrimary,
            softWrap = false,
            maxLines = 1,
        )
    }
}

@Composable
private fun PublicProfilePreferenceCard(profile: AndroidProfilePlayer) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val country = AndroidDutchPresentationCatalog.countries.firstOrNull { it.id == profile.countryId }
    val characters = remember { AndroidLoadoutVariants.characterParts(AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.CHARACTER)) }
    val parts = listOfNotNull(
        characters.firstOrNull { it.id == profile.avatarId },
        AndroidLoadoutCatalog.find(profile.favoriteBodyId),
        AndroidLoadoutCatalog.find(profile.favoriteTireId),
        AndroidLoadoutCatalog.find(profile.favoriteGliderId),
    )
    Mk8dxPanel(
        title = androidText(language, "Public Player preferences", "Openbare spelervoorkeuren"),
    ) {
        Mk8dxFactRow(
            androidText(language, "Time Trials", "Time trials"),
            when (profile.timeTrialModePreference) {
                "150" -> "150cc"
                "200" -> "200cc"
                else -> "150cc + 200cc"
            },
        )
        country?.let {
            Row(
                Modifier.heightIn(min = Mk8dxSpacing.targetMinDense),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ProductAssetImage(
                    "private-product/img/country/${it.id.substringAfter('.')}.png",
                    it.english.take(1),
                    colors.textSecondary,
                    Modifier.size(30.dp),
                )
                Text(
                    if (language == AndroidProductLanguage.DUTCH) it.dutch else it.english,
                    Modifier.padding(start = Mk8dxSpacing.sm),
                    style = Mk8dxTheme.type.body,
                    color = colors.textBody,
                )
            }
        }
        parts.forEach { part ->
            Row(
                Modifier.heightIn(min = Mk8dxSpacing.targetMinDense),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ProductAssetImage(
                    part.assetPath,
                    part.name.take(1),
                    colors.textSecondary,
                    Modifier.size(38.dp),
                )
                Text(
                    androidText(language, part.name, AndroidDutchPresentationCatalog.translate(part.name)),
                    Modifier.padding(start = Mk8dxSpacing.sm),
                    style = Mk8dxTheme.type.body,
                    color = colors.textBody,
                )
            }
        }
    }
}

/**
 * Saved here, not sent yet. The count is honest about what it means: the times
 * are safe on this device and will go out by themselves, and the card opens the
 * list where a Player can look at them or push them through.
 */
@Composable
private fun UnsynchronizedResultsCard(
    count: Int,
    language: AndroidProductLanguage,
    onOpen: () -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .background(Mk8dxTheme.tint(colors, colors.statusWarning))
            .border(1.dp, colors.borderSubtle)
            .clickable(role = Role.Button, onClick = onOpen)
            .padding(Mk8dxSpacing.md)
            .semantics(mergeDescendants = true) { }
            .testTag("notifications-unsynchronized"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Text(
            if (count == 1) {
                androidText(language, "1 result is still only on this phone", "1 resultaat staat nog alleen op deze telefoon")
            } else {
                androidText(language, "$count results are still only on this phone", "$count resultaten staan nog alleen op deze telefoon")
            },
            color = colors.textPrimary,
            style = Mk8dxTheme.type.title,
        )
        Text(
            androidText(
                language,
                "They are saved and will sync by themselves once you are online and signed in. Tap to see them.",
                "Ze zijn opgeslagen en synchroniseren vanzelf zodra je online en aangemeld bent. Tik om ze te bekijken.",
            ),
            color = colors.textSecondary,
            style = Mk8dxTheme.type.bodyS,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AndroidNotificationsScreen(
    client: AndroidTimeTrialsEcosystemDataSource,
    playerId: String?,
    onSignIn: () -> Unit,
    apiOrigin: String,
    onOpenTrack: (String, Int) -> Unit = { _, _ -> },
    // Results that are saved on this device but have not reached the server.
    // A result that only exists on one phone is the one thing worth telling a
    // Player about that no server can send them a notification for.
    unsynchronizedResultCount: Int = 0,
    onOpenSavedResults: () -> Unit = {},
) {
    val context = LocalContext.current
    val language = LocalAndroidProductLanguage.current
    var inbox by remember(client, playerId) { mutableStateOf<AndroidNotificationInbox?>(null) }
    var engagements by remember(client, playerId) { mutableStateOf<AndroidPlayerEngagementsDocument?>(null) }
    var update by remember(client, playerId) { mutableStateOf<AndroidAvailableAppUpdate?>(null) }
    var error by remember(client, playerId) { mutableStateOf<String?>(null) }
    var marking by remember(client, playerId) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // Reading a notification and dismissing one are different intentions. A
    // world record you do not care about had no way to be cleared at all
    // without opening the track it happened on.
    fun markRead(action: () -> Unit) {
        if (marking) return
        marking = true
        scope.launch(Dispatchers.IO) {
            runCatching { action() }
            val refreshed = runCatching { client.notifications() }.getOrNull()
            withContext(Dispatchers.Main) {
                if (refreshed != null) inbox = refreshed
                marking = false
                // The bell is a different screen asking the same server; tell
                // it, or it keeps the number it last read.
                AndroidNotificationBadge.changed()
            }
        }
    }
    LaunchedEffect(client, playerId) {
        if (playerId == null) return@LaunchedEffect
        withContext(Dispatchers.IO) {
            runCatching { client.notifications() }
                .onSuccess { inbox = it }
                .onFailure { error = "Notifications are temporarily unavailable." }
            engagements = runCatching { client.playerEngagements() }.getOrNull()
            update = runCatching {
                client.latestAndroidRelease()?.availableAfter(BuildConfig.VERSION_CODE)
            }.getOrNull()
        }
    }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .testTag("notifications-screen"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(Mk8dxSpacing.gutterPhone),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                Mk8dxDisplayText(androidText(language, "Notifications", "Meldingen"), type.display6)
                Text(
                    androidText(language, "Times beaten, reactions, results and required app updates.", "Verslagen tijden, reacties, resultaten en vereiste app-updates."),
                    color = colors.textSecondary,
                    style = type.bodyS,
                )
            }
        }
        if (playerId == null) {
            item {
                Mk8dxPanel(null) {
                    Text(
                        "Sign in to read your notifications.",
                        color = colors.textBody, style = type.body,
                    )
                    Mk8dxButton(
                        androidLocalizedPresentation("Sign in"),
                        onSignIn,
                        variant = Mk8dxButtonVariant.Primary,
                    )
                }
            }
            return@LazyColumn
        }
        if (unsynchronizedResultCount > 0) {
            item {
                UnsynchronizedResultsCard(
                    count = unsynchronizedResultCount,
                    language = language,
                    onOpen = onOpenSavedResults,
                )
            }
        }
        error?.let { item { Mk8dxStatusMessage(it, tone = Mk8dxStatusTone.Error) } }
        inbox?.let { loaded ->
            item {
                val unread = loaded.unreadCount + if (update == null) 0 else 1
                // A flow row rather than a fixed one: at font scale 2.0 the
                // count and the action move under each other instead of
                // pushing the action off the screen.
                FlowRow(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                    verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                ) {
                    Mk8dxChip(
                        if (unread == 0) androidText(language, "You're all caught up", "Je bent helemaal bijgewerkt")
                        else androidText(language, "$unread unread", "$unread ongelezen"),
                        tone = if (unread == 0) Mk8dxChipTone.Success else Mk8dxChipTone.Warning,
                    )
                    if (loaded.unreadCount > 0) {
                        Mk8dxButton(
                            androidText(language, "Mark all read", "Alles gelezen"),
                            { markRead { client.markAllNotificationsRead() } },
                            variant = Mk8dxButtonVariant.Secondary,
                            size = Mk8dxButtonSize.Sm,
                            disabledReason = if (marking) {
                                androidText(language, "Working…", "Bezig…")
                            } else {
                                null
                            },
                            disabledReasonShown = false,
                            tag = "notifications-mark-all-read",
                        )
                    }
                }
            }
            update?.let { available ->
                item(key = "available-app-update") {
                    Mk8dxPanel(null) {
                        Text(
                            androidText(language, "Android update required", "Android-update vereist"),
                            style = type.title,
                            color = colors.textPrimary,
                        )
                        Text(
                            androidText(
                                language,
                                "Version ${available.version} is available. This reminder stays until you install that version.",
                                "Versie ${available.version} is beschikbaar. Deze herinnering blijft staan totdat je die versie installeert.",
                            ),
                            style = type.body,
                            color = colors.textBody,
                        )
                        Mk8dxButton(
                            androidText(language, "Open download", "Download openen"),
                            { openWebsite(context, "$apiOrigin/?apps=1") },
                            variant = Mk8dxButtonVariant.Primary,
                        )
                    }
                }
            }
            if (loaded.notifications.isEmpty()) {
                item {
                    Mk8dxPanel(null) {
                        Text("No notifications yet.", color = colors.textBody, style = type.body)
                    }
                }
            }
            items(loaded.notifications, key = AndroidNotification::notificationId) { notification ->
                // Most of what arrives here happened on a track, and the
                // artwork says which one faster than the sentence does. The
                // thumb carries the engine class itself; an entry without one
                // gets the EngineMark instead, so 150 and 200 are never left
                // to a colour or to nothing at all.
                val track = notification.trackId
                    ?.let { Schema9AndroidTrackCatalog.find(it) }
                Mk8dxNotificationItem(
                    title = notificationTitle(notification, withThumb = track != null),
                    unread = !notification.read,
                    unreadLabel = androidText(language, "Unread", "Ongelezen"),
                    meta = formatDate(notification.lastEventAtMs),
                    leading = track?.let {
                        {
                            ActivityTrackThumb(
                                track = it,
                                mode = notification.mode ?: 150,
                                modifier = Modifier.width(160.dp),
                            )
                        }
                    },
                ) {
                    if (track == null && notification.mode in setOf(150, 200)) {
                        Mk8dxEngineMark(requireNotNull(notification.mode))
                    }
                    if (notification.kind == "overtaken") {
                        val delta = notification.deltaMs?.let {
                            String.format(Locale.US, "%.3fs", -it / 1000.0)
                        }
                        Text(
                            listOfNotNull(
                                notification.mode?.let { "${it}cc" },
                                delta?.let { "$it sneller" },
                                notification.recipientRank?.let { "je staat nu #$it" },
                            ).joinToString(" · "),
                            style = type.body,
                            color = colors.textBody,
                        )
                    } else {
                        notification.detail?.takeIf {
                            it.isNotBlank() && it != "invite" && it != "result" && it != "challenge"
                        }?.let {
                            Text(it, style = type.body, color = colors.textBody)
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (notification.trackId != null && notification.mode in setOf(150, 200)) {
                            Mk8dxButton(
                                androidText(language, "Open track", "Open circuit"),
                                {
                                    if (!notification.read) {
                                        scope.launch(Dispatchers.IO) {
                                            runCatching { client.markNotificationsRead(listOf(notification.notificationId)) }
                                            AndroidNotificationBadge.changed()
                                        }
                                    }
                                    onOpenTrack(notification.trackId, requireNotNull(notification.mode))
                                },
                                variant = Mk8dxButtonVariant.Secondary,
                                size = Mk8dxButtonSize.Sm,
                            )
                        }
                        if (!notification.read) {
                            Mk8dxButton(
                                androidText(language, "Mark as read", "Markeer als gelezen"),
                                {
                                    markRead {
                                        client.markNotificationsRead(listOf(notification.notificationId))
                                    }
                                },
                                variant = Mk8dxButtonVariant.Quiet,
                                size = Mk8dxButtonSize.Sm,
                                disabledReason = if (marking) {
                                    androidText(language, "Working…", "Bezig…")
                                } else {
                                    null
                                },
                                disabledReasonShown = false,
                                tag = "notification-mark-read-${notification.notificationId}",
                            )
                        }
                    }
                    // An entry that counted more than one thing can be opened.
                    // The forty-eight World Records it did not name are the
                    // point of it; the summary alone used to be the end of the
                    // road. Fetched when opened, not with the inbox.
                    if (notification.count > 1) {
                        AndroidNotificationGroup(
                            client = client,
                            notification = notification,
                            language = language,
                        )
                    }
                }
            }
        }
        val games = engagements?.engagements.orEmpty().filter { it.kind != "poke" }.take(20)
        if (games.isNotEmpty()) {
            item { Mk8dxSectionLabel(androidText(language,
                "PLAYER GAMES AND CHALLENGES", "SPELLETJES EN UITDAGINGEN")) }
            engagements?.rpsStats?.let { stats ->
                item { Text(androidText(language,
                    "Rock-paper-scissors: ${stats.wins} wins · ${stats.losses} losses · ${stats.draws} draws",
                    "Steen-papier-schaar: ${stats.wins} winst · ${stats.losses} verlies · ${stats.draws} gelijk"),
                    style = type.bodyS, color = colors.textSecondary) }
            }
            items(games, key = AndroidPlayerEngagement::engagementId) { engagement ->
                AndroidPlayerEngagementCard(engagement, client, playerId, language, onOpenTrack) { answered ->
                    engagements = engagements?.copy(engagements = engagements?.engagements.orEmpty().map {
                        if (it.engagementId == answered.engagementId) answered else it
                    })
                    scope.launch {
                        val refreshed = withContext(Dispatchers.IO) {
                            runCatching { client.playerEngagements() }.getOrNull()
                        }
                        if (refreshed != null) engagements = refreshed
                    }
                }
            }
        }
        if (inbox == null && error == null) {
            item { Text("Loading notifications…", color = colors.textSecondary, style = type.body) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AndroidPlayerEngagementCard(
    engagement: AndroidPlayerEngagement,
    client: AndroidTimeTrialsEcosystemDataSource,
    viewerPlayerId: String?,
    language: AndroidProductLanguage,
    onOpenTrack: (String, Int) -> Unit,
    onAnswered: (AndroidPlayerEngagement) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var busy by remember(engagement.engagementId) { mutableStateOf(false) }
    var error by remember(engagement.engagementId) { mutableStateOf(false) }
    val detail = engagement.detail
    Mk8dxPanel(null) {
        when (engagement.kind) {
            "rock_paper_scissors" -> {
                Text(androidText(language, "Rock, paper, scissors", "Steen, papier, schaar"),
                    style = Mk8dxTheme.type.title, color = Mk8dxTheme.colors.textPrimary)
                if (detail?.outcome != null) {
                    val winner = when (detail.outcome) {
                        "draw" -> androidText(language, "Draw", "Gelijkspel")
                        "actor" -> engagement.actorDisplayName ?: engagement.actorPlayerId
                        else -> engagement.recipientDisplayName ?: engagement.recipientPlayerId
                    }
                    Text("${engagement.actorDisplayName}: ${detail.hand} · " +
                        "${engagement.recipientDisplayName}: ${detail.recipientHand} · " +
                        androidText(language, "Winner: $winner", "Winnaar: $winner"),
                        style = Mk8dxTheme.type.body, color = Mk8dxTheme.colors.textBody)
                } else if (detail == null) {
                    Text(androidText(language,
                        "${engagement.actorDisplayName ?: "A Player"} is waiting for your hand.",
                        "${engagement.actorDisplayName ?: "Een speler"} wacht op jouw zet."),
                        style = Mk8dxTheme.type.body, color = Mk8dxTheme.colors.textBody)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                        listOf(Triple("rock", "🪨 Rock", "🪨 Steen"),
                            Triple("paper", "📄 Paper", "📄 Papier"),
                            Triple("scissors", "✂️ Scissors", "✂️ Schaar")).forEach { (hand, en, nl) ->
                            Mk8dxButton(androidText(language, en, nl), {
                                if (!busy) {
                                    busy = true
                                    scope.launch {
                                        runCatching { withContext(Dispatchers.IO) {
                                            client.answerRps(engagement.engagementId, hand)
                                        } }.onSuccess { if (it != null) onAnswered(it) }
                                            .onFailure { error = true }
                                        busy = false
                                    }
                                }
                            }, variant = Mk8dxButtonVariant.Secondary, size = Mk8dxButtonSize.Sm,
                                disabledReason = if (busy) "…" else null, disabledReasonShown = false)
                        }
                    }
                    if (error) Mk8dxStatusMessage(androidText(language,
                        "Could not answer this game.", "Kon dit spel niet beantwoorden."),
                        tone = Mk8dxStatusTone.Error)
                } else {
                    Text(androidText(language,
                        "Waiting for ${engagement.recipientDisplayName ?: "the other Player"}.",
                        "Wachten op ${engagement.recipientDisplayName ?: "de andere speler"}."),
                        style = Mk8dxTheme.type.body, color = Mk8dxTheme.colors.textBody)
                }
            }
            "dice_roll" -> {
                Text(androidText(language, "Dice duel", "Dobbelsteenduel"),
                    style = Mk8dxTheme.type.title, color = Mk8dxTheme.colors.textPrimary)
                val mine = viewerPlayerId != null && engagement.actorPlayerId == viewerPlayerId
                val other = (if (mine) engagement.recipientDisplayName else engagement.actorDisplayName)
                    ?: androidText(language, "the other Player", "de andere speler")
                // The same sentence as the history on their page, from this Player's side.
                val line = viewerPlayerId?.let { androidDescribeEngagement(engagement, it, other, language) }
                Text(line?.let { listOfNotNull(it.text, it.status).joinToString(" · ") }
                    ?: "${engagement.actorDisplayName} → ${engagement.recipientDisplayName}: 🎲 ${detail?.face ?: "?"}",
                    style = Mk8dxTheme.type.body, color = Mk8dxTheme.colors.textBody)
                if (!mine && viewerPlayerId != null && androidIsOpenGame(engagement)) {
                    Mk8dxButton(androidText(language, "🎲 Roll back", "🎲 Gooi terug"), {
                        if (!busy) {
                            busy = true
                            scope.launch {
                                runCatching { withContext(Dispatchers.IO) {
                                    client.answerDice(engagement.engagementId)
                                } }.onSuccess { if (it != null) onAnswered(it) }
                                    .onFailure { error = true }
                                busy = false
                            }
                        }
                    }, variant = Mk8dxButtonVariant.Primary, size = Mk8dxButtonSize.Sm,
                        disabledReason = if (busy) "…" else null, disabledReasonShown = false,
                        tag = "engagement-roll-back-${engagement.engagementId}")
                    if (error) Mk8dxStatusMessage(androidText(language,
                        "Could not roll back. Try again.", "Teruggooien lukte niet. Probeer het opnieuw."),
                        tone = Mk8dxStatusTone.Error)
                }
            }
            "challenge" -> {
                Text(androidText(language, "Beat my time", "Versla mijn tijd"),
                    style = Mk8dxTheme.type.title, color = Mk8dxTheme.colors.textPrimary)
                val track = detail?.trackId?.let(Schema9AndroidTrackCatalog::find)
                Text("${engagement.actorDisplayName}: ${track?.displayName ?: detail?.trackId} · " +
                    "${detail?.mode}cc · ${detail?.totalTimeMs?.let(Mk8dxNumeric::formatTime)}",
                    style = Mk8dxTheme.type.body, color = Mk8dxTheme.colors.textBody)
                if (detail?.trackId != null && detail.mode != null) {
                    Mk8dxButton(androidText(language, "Open track", "Open circuit"),
                        { onOpenTrack(detail.trackId, detail.mode) },
                        variant = Mk8dxButtonVariant.Secondary, size = Mk8dxButtonSize.Sm)
                }
            }
        }
    }
}

@Composable
internal fun AndroidSettingsScreen(
    client: AndroidTimeTrialsEcosystemDataSource,
    playerId: String?,
    onPlayers: () -> Unit,
    apiOrigin: String,
    language: AndroidProductLanguage,
    onLanguageChanged: (AndroidProductLanguage) -> Unit,
    onChangeServer: () -> Unit = {},
    /** ADR-0225: make another remembered community the active one. */
    onSwitchCommunity: (String) -> Unit = {},
    playerLabel: String? = null,
    administration: AndroidAdministrationClient? = null,
    onAdministration: () -> Unit = {},
    /** Appearance (ADR-0205): the choice syncs, text size and motion stay here. */
    appearance: Mk8dxAppearanceSettings = Mk8dxAppearanceSettings(),
    onAppearanceChanged: (Mk8dxAppearanceSettings) -> Unit = {},
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    // Pending link requests, when the server treats this account as an
    // administrator; null keeps the Administration card off the screen.
    var administrationPending by remember(administration) { mutableStateOf<Int?>(null) }
    var rivals by remember(client, playerId) { mutableStateOf<List<AndroidRival>?>(null) }
    var ownBests by remember(client, playerId) { mutableStateOf(emptyList<AndroidTrackBest>()) }
    var preferences by remember(client, playerId) { mutableStateOf<AndroidTimeTrialPreferences?>(null) }
    var profilePreferences by remember(client, playerId) { mutableStateOf<AndroidPlayerProfilePreferences?>(null) }
    var notificationSettings by remember(client, playerId) { mutableStateOf<AndroidNotificationSettings?>(null) }
    var modeStatus by remember { mutableStateOf("") }
    var screenNameStatus by remember { mutableStateOf("") }
    var profileStatus by remember { mutableStateOf("") }
    LaunchedEffect(client, playerId) {
        if (playerId != null) {
            withContext(Dispatchers.IO) {
                rivals = runCatching { client.rivals() }.getOrNull()
                ownBests = runCatching { client.trackBestsFor(playerId) }.getOrDefault(emptyList())
                preferences = runCatching { client.timeTrialPreferences() }.getOrNull()
                profilePreferences = runCatching { client.playerProfilePreferences() }.getOrNull()
                notificationSettings = runCatching { client.notificationSettings() }.getOrNull()
            }
        }
    }
    LaunchedEffect(administration) {
        administrationPending = administration?.let { admin ->
            withContext(Dispatchers.IO) {
                runCatching { admin.overview().pending.playerClaims }
                    .onFailure { android.util.Log.w("MK8DXAdministration", "overview unavailable: ${it.message}", it) }
                    .getOrNull()
            }
        }
    }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .testTag("settings-screen"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(Mk8dxSpacing.gutterPhone),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                Mk8dxDisplayText(androidText(language, "Settings", "Instellingen"), type.display6)
                Text(
                    androidText(language, "Player, rivals and app preferences.", "Speler-, rivalen- en appvoorkeuren."),
                    color = colors.textSecondary,
                    style = type.bodyS,
                )
            }
        }
        item {
            nl.mariokart8.mk8dxtimetrials.AndroidCommunityServerPanel(
                apiOrigin = apiOrigin,
                language = language,
                onSwitch = onSwitchCommunity,
                onAdd = onChangeServer,
            )
        }
        item {
            // Phase 4 migrated this section on its own, inside a screen that
            // was still legacy; the whole screen is the design system's now,
            // so the section no longer carries a theme of its own.
            Mk8dxAppearanceSection(
                settings = appearance,
                onSettingsChanged = onAppearanceChanged,
                nl = language == AndroidProductLanguage.DUTCH,
                signedIn = playerId != null,
                syncPending = !appearance.cache.synced && appearance.cache.choice != null,
            )
        }
        item {
            Mk8dxPanel("Language / Taal") {
                Text(
                    androidText(language, "Choose the product language.", "Kies de taal van het product."),
                    style = type.body, color = colors.textBody,
                )
                Mk8dxSegmentedControl(
                    "Language / Taal",
                    AndroidProductLanguage.entries.map { it to it.displayName },
                    language,
                    onLanguageChanged,
                    Modifier.testTag("settings-language"),
                )
                Text(
                    androidText(
                        language,
                        "English and Dutch are reviewed; the other languages are machine-translated and not yet reviewed.",
                        "Engels en Nederlands zijn nagekeken; de andere talen zijn automatisch vertaald en nog niet nagekeken.",
                    ),
                    style = type.bodyS,
                    color = colors.textSecondary,
                )
            }
        }
        item {
            Mk8dxPanel(androidLocalizedPresentation("Player on this phone")) {
                Text(
                    playerLabel
                        ?: playerId?.let(::androidReadableReference)
                        ?: androidText(language, "Not signed in", "Niet aangemeld"),
                    style = type.title,
                    color = colors.textPrimary,
                )
                Mk8dxButton(
                    androidLocalizedPresentation(if (playerId == null) "Sign in" else "Switch Player"),
                    onPlayers,
                    variant = Mk8dxButtonVariant.Secondary,
                )
            }
        }
        administrationPending?.let { pending ->
            item {
                Mk8dxPanel(
                    androidText(language, "Administration", "Beheer"),
                    modifier = Modifier.testTag("settings-administration"),
                ) {
                    Text(
                        when {
                            pending == 0 -> androidText(language, "No link requests are waiting.", "Er wachten geen koppelverzoeken.")
                            pending == 1 -> androidText(language, "1 link request is waiting.", "Er wacht 1 koppelverzoek.")
                            else -> androidText(language, "$pending link requests are waiting.", "Er wachten $pending koppelverzoeken.")
                        },
                        style = type.body, color = colors.textBody,
                    )
                    Mk8dxButton(
                        androidText(language, "Open administration", "Beheer openen"),
                        onAdministration,
                        variant = Mk8dxButtonVariant.Secondary,
                        tag = "settings-open-administration",
                    )
                }
            }
        }
        item {
            AndroidNotificationSettingsCard(
                client = client,
                playerId = playerId,
                settings = notificationSettings,
                language = language,
                onSettingsChanged = { notificationSettings = it },
            )
        }
        if (playerId != null) {
            item {
                val current = preferences
                if (current != null) {
                    var selected by remember(current.modePreference) { mutableStateOf(current.modePreference) }
                    var trackAccess by remember(current.trackAccess) { mutableStateOf(current.trackAccess) }
                    Mk8dxPanel(androidText(language, "Time Trial preference", "Time Trial-voorkeur")) {
                        // A preference over engine classes, not an engine
                        // context: "All" is one of the three answers, so this
                        // stays a segmented control rather than becoming the
                        // two-option EngineSelector (logged, class A).
                        Mk8dxSegmentedControl(
                            androidText(language, "Time Trial preference", "Time Trial-voorkeur"),
                            listOf(
                                "all" to androidText(language, "All", "Alles"),
                                "150" to "150cc",
                                "200" to "200cc",
                            ),
                            selected,
                            { selected = it },
                            Modifier.testTag("settings-mode-preference"),
                        )
                        Text(
                            androidText(language, "Do you have the Booster Course Pass?", "Heb je de Circuit-uitbreidingspas?"),
                            style = type.body, color = colors.textBody,
                        )
                        Mk8dxSegmentedControl(
                            androidText(language, "Do you have the Booster Course Pass?", "Heb je de Circuit-uitbreidingspas?"),
                            listOf(
                                "base_and_bcp" to androidText(language, "Yes · all 96", "Ja · alle 96"),
                                "base_only" to androidText(language, "No · base 48", "Nee · basis 48"),
                            ),
                            trackAccess,
                            { trackAccess = it },
                            Modifier.testTag("settings-track-access"),
                        )
                        Text(
                            androidText(language, "This sets progress and Rank defaults; all public tracks stay available.", "Dit bepaalt standaard voortgang en Rank; alle openbare circuits blijven beschikbaar."),
                            style = type.bodyS,
                            color = colors.textSecondary,
                        )
                        Mk8dxButton(
                            androidText(language, "Save Time Trial preference", "Time Trial-voorkeur opslaan"),
                            {
                                modeStatus = androidText(language, "Saving…", "Opslaan…")
                                val next = current.copy(modePreference = selected, trackAccess = trackAccess)
                                coroutineScope.launch {
                                    withContext(Dispatchers.IO) { runCatching { client.saveTimeTrialPreferences(next) } }
                                        .onSuccess { preferences = it; modeStatus = androidText(language, "Saved", "Opgeslagen") }
                                        .onFailure { modeStatus = androidText(language, "Could not save", "Opslaan mislukt") }
                                }
                            },
                            variant = Mk8dxButtonVariant.Secondary,
                            modifier = Modifier.testTag("settings-save-mode-preference"),
                        )
                        Mk8dxStatusMessage(modeStatus, tone = settingsStatusTone(modeStatus, language))
                    }
                }
            }
            item {
                val current = preferences
                if (current != null) {
                    var screenName by remember(current.screenName) { mutableStateOf(current.screenName.orEmpty()) }
                    Mk8dxPanel(androidText(language, "Screen name", "Schermnaam")) {
                        Mk8dxTextField(
                            androidText(language, "Screen name", "Schermnaam"),
                            screenName,
                            { if (it.length <= 32) screenName = it },
                            Modifier.testTag("settings-screen-name"),
                        )
                        Mk8dxButton(
                            androidText(language, "Save screen name", "Schermnaam opslaan"),
                            {
                                screenNameStatus = androidText(language, "Saving…", "Opslaan…")
                                val next = current.copy(screenName = screenName.trim().ifBlank { null })
                                coroutineScope.launch {
                                    withContext(Dispatchers.IO) { runCatching { client.saveTimeTrialPreferences(next) } }
                                        .onSuccess { preferences = it; screenNameStatus = androidText(language, "Saved", "Opgeslagen") }
                                        .onFailure { screenNameStatus = androidText(language, "Could not save", "Opslaan mislukt") }
                                }
                            },
                            variant = Mk8dxButtonVariant.Secondary,
                            modifier = Modifier.testTag("settings-save-screen-name"),
                        )
                        Mk8dxStatusMessage(
                            screenNameStatus,
                            tone = settingsStatusTone(screenNameStatus, language),
                        )
                    }
                }
            }
            item {
                profilePreferences?.let { current ->
                    PlayerProfilePreferenceEditor(current, language, profileStatus) { next ->
                        profileStatus = androidText(language, "Saving…", "Opslaan…")
                        coroutineScope.launch {
                            withContext(Dispatchers.IO) { runCatching { client.savePlayerProfilePreferences(next) } }
                                .onSuccess { profilePreferences = it; profileStatus = androidText(language, "Saved and visible on your public profile.", "Opgeslagen en zichtbaar op je openbare profiel.") }
                                .onFailure { profileStatus = androidText(language, "Could not save", "Opslaan mislukt") }
                        }
                    }
                } ?: Text(
                    androidText(language, "Loading public Player preferences…", "Openbare spelervoorkeuren laden…"),
                    style = type.body, color = colors.textSecondary,
                )
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs)) {
                    Mk8dxSectionLabel(androidLocalizedPresentation("Rivals"))
                    Mk8dxMetaLine(
                        androidLocalizedPresentation("Used by Home focus and Among rivals standing"),
                    )
                }
            }
            if (rivals == null) {
                item { Text("Loading rivals…", style = type.body, color = colors.textSecondary) }
            }
            rivals?.let { loaded ->
                if (loaded.isEmpty()) {
                    item {
                        Mk8dxPanel(null) {
                            Text("No rivals chosen yet.", style = type.body, color = colors.textBody)
                        }
                    }
                }
                items(loaded, key = AndroidRival::playerId) { rival ->
                    Mk8dxPanel(null) {
                        // The display name is the name; the canonical identifier
                        // under it was a UUID for every self-service Player.
                        Text(rival.displayName, style = type.title, color = colors.textPrimary)
                        RivalInteractionsToggle(client, rival, playerId, language)
                    }
                }
            }
        }
        item {
            Mk8dxPanel(androidLocalizedPresentation("Full account settings")) {
                Text(
                    androidText(language, "Manage rivals, followed Players and visibility on the configured website.", "Beheer rivalen, gevolgde spelers en zichtbaarheid op de ingestelde website."),
                    style = type.body, color = colors.textBody,
                )
                Mk8dxButton(
                    androidLocalizedPresentation("Open website settings"),
                    { openWebsite(context, "$apiOrigin/?settings=1") },
                    variant = Mk8dxButtonVariant.Secondary,
                )
            }
        }
    }
}

/**
 * What a save line means: the three sentences Settings can show are its own
 * words, so the tone follows them rather than a status code.
 */
private fun settingsStatusTone(status: String, language: AndroidProductLanguage): Mk8dxStatusTone =
    when (status) {
        "" -> Mk8dxStatusTone.Neutral
        androidText(language, "Could not save", "Opslaan mislukt") -> Mk8dxStatusTone.Error
        androidText(language, "Saving…", "Opslaan…") -> Mk8dxStatusTone.Neutral
        else -> Mk8dxStatusTone.Success
    }

/**
 * A rival's interactions open the same "You and <Player>" panel as their page (owner 2026-09-26):
 * the rules, what is waiting for whom and the history, instead of fire-and-forget buttons.
 */
@Composable
private fun RivalInteractionsToggle(
    client: AndroidTimeTrialsEcosystemDataSource,
    rival: AndroidRival,
    viewerPlayerId: String,
    language: AndroidProductLanguage,
) {
    var open by remember(rival.playerId) { mutableStateOf(false) }
    Mk8dxButton(
        if (open) androidText(language, "Hide interactions", "Interacties verbergen")
        else androidText(language, "You and ${rival.displayName}", "Jij en ${rival.displayName}"),
        { open = !open },
        variant = Mk8dxButtonVariant.Secondary,
        size = Mk8dxButtonSize.Sm,
        tag = "rival-interactions-${rival.playerId}",
    )
    if (open) {
        AndroidPlayerInteractionsPanel(client, viewerPlayerId, rival.playerId, rival.displayName)
    }
}

/**
 * Why a notification can be late, and the one thing that helps.
 *
 * There is no push here by decision: the inbox is reconciled about every
 * fifteen minutes by WorkManager, and on start, resume and sign-in. That
 * "about" is Android's, not ours - a phone in Doze, or one of the makers whose
 * battery manager is famously aggressive, can hold a periodic job for hours,
 * and then the first thing a Player sees is the notification arriving as they
 * open the app. Exempting this app from battery optimisation is the only lever
 * an app has over that, so the card offers it and says plainly what it does.
 */
@Composable
private fun AndroidBackgroundDeliveryLine(language: AndroidProductLanguage) {
    val context = LocalContext.current
    var exempt by remember {
        mutableStateOf(
            runCatching {
                (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
                    .isIgnoringBatteryOptimizations(context.packageName)
            }.getOrDefault(true),
        )
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                exempt = runCatching {
                    (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
                        .isIgnoringBatteryOptimizations(context.packageName)
                }.getOrDefault(true)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    Text(
        androidText(
            language,
            "They arrive while the app is closed too - about every 15 minutes, " +
                "not the second something happens.",
            "Ze komen ook binnen als de app dicht is - ongeveer elk kwartier, " +
                "niet op de seconde dat er iets gebeurt.",
        ),
        style = Mk8dxTheme.type.bodyS,
        color = Mk8dxTheme.colors.textSecondary,
    )
    if (exempt) {
        Mk8dxChip(
            "✓ " + androidText(
                language,
                "Android does not hold this app back",
                "Android houdt deze app niet tegen",
            ),
            tone = Mk8dxChipTone.Success,
        )
        return
    }
    Text(
        androidText(
            language,
            "Android may delay them much longer to save battery. If they keep " +
                "arriving only when you open the app, allow this one through.",
            "Android mag ze veel langer uitstellen om batterij te sparen. Komen " +
                "ze pas binnen als je de app opent, laat deze er dan door.",
        ),
        style = Mk8dxTheme.type.bodyS,
        color = Mk8dxTheme.colors.textSecondary,
    )
    Mk8dxButton(
        androidText(language, "Do not delay notifications", "Meldingen niet uitstellen"),
        {
            // The direct request first, because it is one dialog; the list
            // screen as a fallback, because some builds refuse the direct one.
            val direct = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:${context.packageName}"),
            )
            runCatching { context.startActivity(direct) }.onFailure {
                runCatching {
                    context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                }
            }
        },
        variant = Mk8dxButtonVariant.Secondary,
    )
}

@Composable
private fun AndroidNotificationSettingsCard(
    client: AndroidTimeTrialsEcosystemDataSource,
    playerId: String?,
    settings: AndroidNotificationSettings?,
    language: AndroidProductLanguage,
    onSettingsChanged: (AndroidNotificationSettings) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var localEnabled by remember { mutableStateOf(AndroidNotificationProjectionSettings.enabled(context)) }
    var granted by remember { mutableStateOf(permissionGranted(context)) }
    var status by remember { mutableStateOf("") }
    var awaitingAndroidSettings by remember { mutableStateOf(false) }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                granted = permissionGranted(context)
                if (awaitingAndroidSettings && granted) {
                    AndroidNotificationProjectionSettings.enable(context)
                    localEnabled = true
                    awaitingAndroidSettings = false
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { accepted ->
        AndroidNotificationProjectionSettings.recordPermissionAsked(context)
        granted = accepted
        if (accepted) {
            AndroidNotificationProjectionSettings.enable(context)
            localEnabled = true
            status = androidText(language, "Notifications are enabled.", "Meldingen zijn ingeschakeld.")
        } else {
            localEnabled = false
            status = androidText(
                language,
                "Notifications are disabled in Android settings.",
                "Meldingen zijn uitgeschakeld in Android.",
            )
        }
    }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val on = androidText(language, "On", "Aan")
    val off = androidText(language, "Off", "Uit")
    Mk8dxPanel(androidText(language, "Notifications", "Meldingen")) {
        if (playerId == null) {
            Text(
                androidText(language, "Sign in to enable personal notifications.", "Meld je aan om persoonlijke meldingen in te schakelen."),
                style = type.body, color = colors.textBody,
            )
            return@Mk8dxPanel
        }
        Text(
            androidText(
                language,
                "Get notified when someone passes you or reacts to your result.",
                "Ontvang een melding wanneer iemand je inhaalt of op je resultaat reageert.",
            ),
            style = type.body, color = colors.textBody,
        )
        // The two gates stay independent and named (ADR-0200): Android's own
        // permission, and this app's switch on this phone. Neither one is
        // changed here; only the way they are drawn.
        when {
            granted && localEnabled -> {
                Mk8dxChip(
                    "✓ ${androidText(language, "Notifications are enabled", "Meldingen zijn ingeschakeld")}",
                    tone = Mk8dxChipTone.Success,
                )
                AndroidBackgroundDeliveryLine(language)
                Mk8dxButton(
                    androidText(language, "Disable on this phone", "Uitschakelen op deze telefoon"),
                    {
                        AndroidNotificationProjectionSettings.disable(context)
                        localEnabled = false
                    },
                    variant = Mk8dxButtonVariant.Secondary,
                )
            }
            granted -> Mk8dxButton(
                androidText(language, "Enable notifications", "Meldingen inschakelen"),
                {
                    AndroidNotificationProjectionSettings.enable(context)
                    localEnabled = true
                },
                variant = Mk8dxButtonVariant.Secondary,
            )
            // Either the question has been answered already, or this phone is
            // too old to have been asked one: both mean the app cannot turn
            // notifications on itself, and Android's own screen is where it is
            // done. Offering "Enable notifications" there would have been a
            // button that changes nothing.
            Build.VERSION.SDK_INT < 33 ||
                AndroidNotificationProjectionSettings.permissionAsked(context) -> {
                Text(
                    androidText(
                        language,
                        "Notifications are switched off for this app in Android.",
                        "Meldingen staan in Android uit voor deze app.",
                    ),
                    style = type.body, color = colors.textBody,
                )
                Mk8dxButton(
                    androidText(language, "Open Android settings", "Android-instellingen openen"),
                    {
                        awaitingAndroidSettings = true
                        context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                        })
                    },
                    variant = Mk8dxButtonVariant.Secondary,
                )
            }
            else -> Mk8dxButton(
                androidText(language, "Enable notifications", "Meldingen inschakelen"),
                {
                    if (Build.VERSION.SDK_INT >= 33) {
                        permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        AndroidNotificationProjectionSettings.enable(context)
                        granted = true
                        localEnabled = true
                    }
                },
                variant = Mk8dxButtonVariant.Secondary,
            )
        }
        Mk8dxStatusMessage(status, tone = settingsStatusTone(status, language))

        settings?.let { loaded ->
            Mk8dxSectionLabel(androidText(language, "Competitive", "Competitief"))
            Mk8dxToggleRow(
                androidText(language, "Someone passes me", "Iemand passeert mij"),
                loaded.preferences.competitiveOvertaken,
                {
                    val next = loaded.preferences.copy(
                        competitiveOvertaken = !loaded.preferences.competitiveOvertaken,
                    )
                    scope.launch {
                        runCatching { withContext(Dispatchers.IO) { client.saveNotificationPreferences(next) } }
                            .onSuccess { onSettingsChanged(loaded.copy(preferences = it)); AndroidCanonicalNotificationSync.enqueueImmediate(context) }
                            .onFailure { status = androidText(language, "Could not save", "Opslaan mislukt") }
                    }
                },
                onText = on,
                offText = off,
                modifier = Modifier.testTag("settings-notification-overtaken"),
            )
            Mk8dxSectionLabel(androidText(language, "Let me be poked by", "Laat mij porren door"))
            Mk8dxSegmentedControl(
                androidText(language, "Let me be poked by", "Laat mij porren door"),
                listOf(
                    "all" to androidText(language, "Anyone", "Iedereen"),
                    "rivals" to androidText(language, "Rivals", "Rivalen"),
                    "none" to androidText(language, "No one", "Niemand"),
                ),
                loaded.preferences.engagementAcceptScope,
                { value ->
                    val next = loaded.preferences.copy(engagementAcceptScope = value)
                    scope.launch {
                        runCatching { withContext(Dispatchers.IO) { client.saveNotificationPreferences(next) } }
                            .onSuccess { onSettingsChanged(loaded.copy(preferences = it)) }
                            .onFailure { status = androidText(language, "Could not save", "Opslaan mislukt") }
                    }
                },
                Modifier.testTag("settings-notification-poke-scope"),
            )
            Mk8dxSectionLabel(androidText(language, "Activity", "Activiteit"))
            Mk8dxToggleRow(
                androidText(language, "Reactions to my results", "Reacties op mijn resultaten"),
                loaded.preferences.activityReactions,
                {
                    val next = loaded.preferences.copy(activityReactions = !loaded.preferences.activityReactions)
                    scope.launch {
                        runCatching { withContext(Dispatchers.IO) { client.saveNotificationPreferences(next) } }
                            .onSuccess { onSettingsChanged(loaded.copy(preferences = it)); AndroidCanonicalNotificationSync.enqueueImmediate(context) }
                            .onFailure { status = androidText(language, "Could not save", "Opslaan mislukt") }
                    }
                },
                onText = on,
                offText = off,
                modifier = Modifier.testTag("settings-notification-reactions"),
            )
        }
        Text(
            androidText(
                language,
                "Background sync checks about every 15 minutes; this is not real-time push.",
                "Achtergrondsynchronisatie controleert ongeveer elke 15 minuten; dit is geen realtime push.",
            ),
            style = type.bodyS,
            color = colors.textSecondary,
        )
    }
}

@Composable
private fun PlayerProfilePreferenceEditor(
    saved: AndroidPlayerProfilePreferences,
    language: AndroidProductLanguage,
    status: String,
    onSave: (AndroidPlayerProfilePreferences) -> Unit,
) {
    var countryId by remember(saved.countryId) { mutableStateOf(saved.countryId) }
    var characterId by remember(saved.favoriteCharacterId) { mutableStateOf(saved.favoriteCharacterId) }
    var bodyId by remember(saved.favoriteBodyId) { mutableStateOf(saved.favoriteBodyId) }
    var tireId by remember(saved.favoriteTireId) { mutableStateOf(saved.favoriteTireId) }
    var gliderId by remember(saved.favoriteGliderId) { mutableStateOf(saved.favoriteGliderId) }
    var countryDialog by remember { mutableStateOf(false) }
    var partDialog by remember { mutableStateOf<AndroidBuildPartCategory?>(null) }
    val characters = remember { AndroidLoadoutVariants.characterParts(AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.CHARACTER)) }
    Mk8dxPanel(androidText(language, "Public Player preferences", "Openbare spelervoorkeuren")) {
        Text(
            androidText(language, "Country and favorites are shown on your public profile.", "Land en favorieten worden op je openbare profiel getoond."),
            style = Mk8dxTheme.type.body,
            color = Mk8dxTheme.colors.textBody,
        )
        SettingsSelectionButton(
            androidText(language, "Country", "Land"),
            AndroidDutchPresentationCatalog.countries.firstOrNull { it.id == countryId }?.let { if (language == AndroidProductLanguage.DUTCH) it.dutch else it.english }
                ?: androidText(language, "Not selected", "Niet geselecteerd"),
            countryId?.let { "private-product/img/country/${it.substringAfter('.')}.png" },
        ) { countryDialog = true }
        val selections = listOf(
            Triple(AndroidBuildPartCategory.CHARACTER, androidText(language, "Favorite character", "Favoriete coureur"), characterId),
            Triple(AndroidBuildPartCategory.BODY, androidText(language, "Favorite body", "Favoriet voertuig"), bodyId),
            Triple(AndroidBuildPartCategory.TIRE, androidText(language, "Favorite tires", "Favoriete banden"), tireId),
            Triple(AndroidBuildPartCategory.GLIDER, androidText(language, "Favorite glider", "Favoriet zweefvliegtuig"), gliderId),
        )
        selections.forEach { (category, label, selectedId) ->
            val part = (if (category == AndroidBuildPartCategory.CHARACTER) characters else AndroidLoadoutCatalog.parts(category)).firstOrNull { it.id == selectedId }
            SettingsSelectionButton(label, part?.let { androidText(language, it.name, AndroidDutchPresentationCatalog.translate(it.name)) } ?: androidText(language, "Not selected", "Niet geselecteerd"), part?.assetPath) { partDialog = category }
        }
        Mk8dxButton(
            androidText(language, "Save country and favorites", "Land en favorieten opslaan"),
            {
                onSave(
                    AndroidPlayerProfilePreferences(
                        countryId = countryId, favoriteCharacterId = characterId, favoriteBodyId = bodyId,
                        favoriteTireId = tireId, favoriteGliderId = gliderId,
                    ),
                )
            },
            variant = Mk8dxButtonVariant.Secondary,
            modifier = Modifier.testTag("settings-save-profile-preferences"),
        )
        Mk8dxStatusMessage(status, tone = settingsStatusTone(status, language))
    }
    if (countryDialog) SettingsCountryDialog(language, countryId, { countryDialog = false }) { countryId = it; countryDialog = false }
    partDialog?.let { category ->
        val parts = if (category == AndroidBuildPartCategory.CHARACTER) characters else AndroidLoadoutCatalog.parts(category)
        SettingsPartDialog(parts, language, { partDialog = null }) { selected ->
            when (category) {
                AndroidBuildPartCategory.CHARACTER -> characterId = selected.id
                AndroidBuildPartCategory.BODY -> bodyId = selected.id
                AndroidBuildPartCategory.TIRE -> tireId = selected.id
                AndroidBuildPartCategory.GLIDER -> gliderId = selected.id
            }
            partDialog = null
        }
    }
}

/** Select (§13): the label, the value and its art on one 44 dp target. */
@Composable
private fun SettingsSelectionButton(label: String, value: String, assetPath: String?, onClick: () -> Unit) {
    Mk8dxSelectField(
        label = label,
        value = value,
        onOpen = onClick,
        leading = assetPath?.let {
            {
                ProductAssetImage(
                    it, value.take(1), Mk8dxTheme.colors.personalAccent, Modifier.size(34.dp),
                )
            }
        },
    )
}

@Composable
private fun SettingsCountryDialog(language: AndroidProductLanguage, selected: String?, onDismiss: () -> Unit, onSelect: (String?) -> Unit) {
    var query by remember { mutableStateOf("") }
    val rows = AndroidDutchPresentationCatalog.countries.filter {
        query.isBlank() || it.english.contains(query, true) || it.dutch.contains(query, true)
    }
    SettingsSearchDialog(androidText(language, "Search country", "Land zoeken"), query, { query = it }, onDismiss) {
        item { SettingsCountryRow(null, androidText(language, "Not selected", "Niet geselecteerd"), selected == null) { onSelect(null) } }
        items(rows, key = AndroidPresentationCountry::id) { country ->
            SettingsCountryRow(country.id, if (language == AndroidProductLanguage.DUTCH) country.dutch else country.english, country.id == selected) { onSelect(country.id) }
        }
    }
}

@Composable
private fun SettingsCountryRow(id: String?, name: String, selected: Boolean, onClick: () -> Unit) {
    Mk8dxOptionRow(
        label = name,
        selected = selected,
        onClick = onClick,
        leading = id?.let {
            {
                ProductAssetImage(
                    "private-product/img/country/${it.substringAfter('.')}.png",
                    name.take(1),
                    Mk8dxTheme.colors.statusInfo,
                    Modifier.size(30.dp),
                )
            }
        },
    )
}

@Composable
private fun SettingsPartDialog(parts: List<AndroidBuildPart>, language: AndroidProductLanguage, onDismiss: () -> Unit, onSelect: (AndroidBuildPart) -> Unit) {
    var query by remember { mutableStateOf("") }
    val rows = parts.filter { query.isBlank() || it.name.contains(query, true) || AndroidDutchPresentationCatalog.translate(it.name).contains(query, true) }
    SettingsSearchDialog(androidText(language, "Search favorite", "Favoriet zoeken"), query, { query = it }, onDismiss) {
        items(rows, key = AndroidBuildPart::id) { part ->
            Mk8dxOptionRow(
                label = androidText(language, part.name, AndroidDutchPresentationCatalog.translate(part.name)),
                selected = false,
                onClick = { onSelect(part) },
                leading = {
                    ProductAssetImage(
                        part.assetPath, part.name.take(1),
                        Mk8dxTheme.colors.personalAccent, Modifier.size(38.dp),
                    )
                },
            )
        }
    }
}

@Composable
private fun SettingsSearchDialog(
    title: String,
    query: String,
    onQuery: (String) -> Unit,
    onDismiss: () -> Unit,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    Mk8dxDialog(
        title = title,
        closeLabel = androidLocalizedPresentation("Close"),
        onDismiss = onDismiss,
    ) {
        Mk8dxSearchField(title, query, onQuery)
        LazyColumn(
            Modifier.heightIn(max = 480.dp),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            content = content,
        )
    }
}

@Composable
private fun ResultDetailCard(
    result: AndroidPublicTimeTrialResult,
    managed: AndroidManagedTimeTrial? = null,
    onManage: (AndroidManagedTimeTrial) -> Unit = {},
    onFix: (AndroidManagedTimeTrial) -> Unit = {},
) {
    val language = LocalAndroidProductLanguage.current
    val numbers = if (language == AndroidProductLanguage.DUTCH) {
        Mk8dxNumberLanguage.NL
    } else {
        Mk8dxNumberLanguage.EN
    }
    val colors = Mk8dxTheme.colors
    val track = Schema9AndroidTrackCatalog.find(result.trackId)
    Mk8dxPanel(title = null) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
            Column(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            ) {
                Text(
                    track?.displayName ?: result.trackId,
                    style = Mk8dxTheme.type.title,
                    color = colors.textPrimary,
                )
                Mk8dxEngineMark(result.mode)
                Mk8dxMetaLine(formatDate(result.resultAtMs))
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    Mk8dxNumeric.formatTime(result.totalTimeMs),
                    style = Mk8dxTheme.type.dataM,
                    color = colors.textPrimary,
                    softWrap = false,
                    maxLines = 1,
                )
                result.rank?.let { rank ->
                    Text(
                        Mk8dxNumeric.formatRank(rank, numbers),
                        style = Mk8dxTheme.type.data,
                        color = when (rank) {
                            1 -> colors.rankGold
                            2 -> colors.rankSilver
                            3 -> colors.rankBronze
                            else -> colors.textSecondary
                        },
                        softWrap = false,
                        maxLines = 1,
                    )
                }
            }
        }
        if (result.laps.isNotEmpty()) {
            var previousCoins = 0
            result.laps.sortedBy { it.lapNumber }.forEach { lap ->
                val coinDelta = lap.coinsCollected?.minus(previousCoins)
                lap.coinsCollected?.let { previousCoins = it }
                // The lap's own time is the number, so it stays tabular and
                // whole; what happened on the lap is the row's label, which
                // may wrap at a large font scale.
                Mk8dxFactRow(
                    "Lap ${lap.lapNumber}" +
                        (coinDelta?.let { " · ${if (it > 0) "+" else ""}$it coins" } ?: "") +
                        (lap.mushroomsUsed?.let { " · $it mushrooms" } ?: ""),
                    Mk8dxNumeric.formatTime(lap.timeMs),
                )
            }
        }
        val partIds = listOfNotNull(
            result.loadout?.characterId,
            result.loadout?.bodyId,
            result.loadout?.tireId,
            result.loadout?.gliderId,
        )
        if (partIds.isNotEmpty()) {
            Mk8dxMetaLine(
                partIds.joinToString(" · ") {
                    AndroidLoadoutCatalog.find(it)?.name ?: it.substringAfter('.')
                },
            )
        }
        val video = managed?.videoUrl ?: result.videoUrl
        if (video != null) {
            val browser = androidx.compose.ui.platform.LocalUriHandler.current
            Mk8dxButton(
                androidText(language, "Watch this run on YouTube", "Bekijk deze rit op YouTube"),
                onClick = { browser.openUri(video) },
                variant = Mk8dxButtonVariant.Quiet,
                tag = "result-video-${result.resultId}",
            )
        }
        if (managed?.retirementState == "active") {
            // Manage (ADR-0211): Edit opens the form of Post a Time; Withdraw sits behind it.
            nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEditAction(
                androidText(language, "Edit", "Bewerken"),
                { onFix(managed) },
                tag = "fix-result-${result.resultId}",
            )
        }
    }
}

/** The sentence for a refused correction or video: the site's own words, the guard's in both languages. */
internal fun androidManageFailureMessage(failure: Throwable, dutch: Boolean): String {
    val refusal = failure as? AndroidEcosystemClientException
    return when {
        refusal?.code == "time_trial_time_implausible" -> if (dutch) {
            "De voorgestelde tijd is zeer onwaarschijnlijk, controleer alle gegevens nog eens."
        } else {
            "The proposed time is highly unreasonable, please double check all information."
        }
        refusal?.statusCode == 400 && refusal.message != null -> refusal.message!!
        dutch -> "Het resultaat kon niet worden bijgewerkt. Probeer het later opnieuw."
        else -> "The result could not be updated. Try again later."
    }
}

@Composable
private fun ManagedResultCard(result: AndroidManagedTimeTrial, onRestore: () -> Unit) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val track = Schema9AndroidTrackCatalog.find(result.current.trackId)
    Mk8dxPanel(title = null) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
            Column(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            ) {
                Text(
                    track?.displayName ?: result.current.trackId,
                    style = Mk8dxTheme.type.title,
                    color = colors.textPrimary,
                )
                Mk8dxEngineMark(result.current.modeCc)
                Mk8dxChip(
                    androidText(
                        language,
                        "Withdrawn · not in standings",
                        "Ingetrokken · niet in klassementen",
                    ),
                    tone = Mk8dxChipTone.Warning,
                )
            }
            Text(
                Mk8dxNumeric.formatTime(result.current.totalTimeMs),
                style = Mk8dxTheme.type.dataM,
                color = colors.textPrimary,
                softWrap = false,
                maxLines = 1,
            )
        }
        Mk8dxButton(
            androidText(language, "Restore result", "Resultaat herstellen"),
            onClick = onRestore,
            variant = Mk8dxButtonVariant.Secondary,
            tag = "restore-result-${result.submissionId}",
        )
    }
}

@Composable
private fun RecordCategoryCard(
    category: AndroidRecordCategory,
    numbers: Mk8dxNumberLanguage,
    language: AndroidProductLanguage,
) {
    val title = when (category.key) {
        // The web's words: these are leaderboard #1s, not World Records, and
        // coverage counts track·class combinations (up to 192), not tracks.
        "firsts" -> "Most leaderboard #1s"
        "podiums" -> "Most podiums"
        "published" -> "Most published times"
        "coverage" -> "Widest track coverage"
        else -> category.key
    }
    if (category.holders.isEmpty()) {
        Mk8dxPanel(title = title) {
            Text(
                "No record holder yet.",
                style = Mk8dxTheme.type.body,
                color = Mk8dxTheme.colors.textBody,
            )
        }
        return
    }
    // A record category is a small standing, so it is the same board the
    // tournament night draws: one rank column, the names, the numbers.
    Mk8dxGroupBoard(
        title = title,
        meta = when (category.key) {
            "coverage" -> androidText(
                language,
                "track·engine combinations · up to 192",
                "circuit·klasse-combinaties · maximaal 192",
            )
            "published" -> androidText(
                language,
                "Combined · 150cc + 200cc",
                "Gecombineerd · 150cc + 200cc",
            )
            else -> null
        },
        rows = category.holders.mapIndexed { index, holder ->
            Mk8dxBoardRow(
                rank = index + 1,
                name = holder.displayName,
                value = Mk8dxNumeric.formatCount(holder.value.toLong(), numbers),
                key = holder.playerId,
            )
        },
        language = numbers,
        columns = Triple("#", androidText(language, "Player", "Speler"), androidText(language, "Total", "Totaal")),
    )
}

/** The cluster underneath a grouped entry, opened on demand. */
@Composable
private fun AndroidNotificationGroup(
    client: AndroidTimeTrialsEcosystemDataSource,
    notification: AndroidNotification,
    language: AndroidProductLanguage,
) {
    var open by remember(notification.notificationId) { mutableStateOf(false) }
    var events by remember(notification.notificationId) {
        mutableStateOf<List<AndroidNotificationEvent>?>(null)
    }
    var failed by remember(notification.notificationId) { mutableStateOf(false) }
    LaunchedEffect(open, notification.notificationId) {
        if (!open || events != null) return@LaunchedEffect
        failed = false
        withContext(Dispatchers.IO) {
            runCatching { client.notificationEvents(notification.notificationId) }
                .onSuccess { events = it }
                .onFailure { failed = true }
        }
    }
    Mk8dxButton(
        if (open) androidText(language, "Hide", "Verberg")
        else androidText(language, "Show all ${notification.count}", "Toon alle ${notification.count}"),
        { open = !open },
        variant = Mk8dxButtonVariant.Quiet,
        size = Mk8dxButtonSize.Sm,
        tag = "notification-group-${notification.notificationId}",
    )
    if (!open) return
    val loaded = events
    when {
        failed -> Mk8dxMetaLine(
            androidText(language, "These could not be loaded.", "Deze konden niet worden geladen."),
        )
        loaded == null -> Mk8dxMetaLine(androidText(language, "Loading…", "Laden…"))
        // Honest rather than empty: entries counted before the members were
        // kept still show a truthful count and have nothing to open.
        loaded.isEmpty() -> Mk8dxMetaLine(
            androidText(
                language,
                "This entry was counted before the individual events were kept.",
                "Deze melding is geteld voordat de afzonderlijke gebeurtenissen werden bewaard.",
            ),
        )
        else -> Column(
            Modifier.fillMaxWidth().padding(start = Mk8dxSpacing.md, top = Mk8dxSpacing.xs),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs),
        ) {
            for (event in loaded) {
                val track = event.trackId?.let { Schema9AndroidTrackCatalog.find(it) }
                if (track != null) {
                    ActivityTrackThumb(
                        track = track,
                        mode = event.mode ?: notification.mode ?: 150,
                        modifier = Modifier.width(150.dp).padding(top = 2.dp),
                    )
                }
                // With the thumb naming the track, the cup and the engine
                // class, the line beside it says only what the thumb cannot -
                // which for a World Record is nothing at all.
                val line = if (track == null) {
                    androidNotificationEventLine(notification.kind, event)
                } else {
                    androidNotificationEventDetail(notification.kind, event)
                }
                if (line.isNotEmpty()) {
                    Text(
                        line,
                        style = Mk8dxTheme.type.bodyS,
                        color = Mk8dxTheme.colors.textBody,
                    )
                }
            }
            if (loaded.size < notification.count) {
                Mk8dxMetaLine(
                    androidText(
                        language,
                        "Showing the most recent ${loaded.size} of ${notification.count}.",
                        "De ${loaded.size} meest recente van ${notification.count} worden getoond.",
                    ),
                )
            }
        }
    }
}

/**
 * The line for one inbox entry.
 *
 * `withThumb` says the track artwork is already above this line naming the
 * track, the cup and the engine class. Repeating "on Mount Wario" under a
 * picture of Mount Wario labelled Mount Wario is noise.
 */
private fun notificationTitle(
    notification: AndroidNotification,
    withThumb: Boolean = false,
): String {
    val actor = notification.actorDisplayName ?: "Someone"
    val track = if (withThumb) {
        null
    } else {
        notification.trackId?.let { Schema9AndroidTrackCatalog.find(it)?.displayName }
    }
    return when (notification.kind) {
        "overtaken" -> "$actor passeerde je${track?.let { " op $it" } ?: ""}."
        "reaction_received" -> "$actor reacted to your result."
        "claim_decided" -> "Your Player claim was updated."
        "claim_requested" -> if (notification.detail == "reply") {
            "An answer about $actor."
        } else {
            "Somebody asks to be linked to $actor."
        }
        "host_requested" -> notification.actorDisplayName?.let { "$it asks to host Tournaments." }
            ?: "Somebody asks to host Tournaments."
        "host_request_decided" -> if (notification.detail == "approved") {
            "You are now a Director: you can host Tournaments."
        } else {
            "Your request to host was declined."
        }
        // ADR-0222: a change of the reader's own sign-up, naming the night.
        "tournament_signup_selected", "tournament_signup_moved_up", "tournament_signup_removed" ->
            "${nl.mariokart8.mk8dxtimetrials.notifications.androidSignupNotificationTitle(
                nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage.ENGLISH,
                notification.kind,
                notification.detail,
                notification.tournamentName,
            )}."
        "result_published" -> "Your result was published${track?.let { " on $it" } ?: ""}."
        // One entry counts every record broken since it was last read, so it
        // has to say how many rather than name one track as if it were the
        // only one - the same wording the website uses for the same entry.
        "world_record" -> if (withThumb) {
            if (notification.count > 1) {
                "${notification.count} new World Records · most recently"
            } else {
                "New World Record"
            }
        } else if (notification.count > 1) {
            "${notification.count} new World Records · most recently ${notification.mode ?: ""}cc${track?.let { " on $it" } ?: ""}"
        } else {
            "A new ${notification.mode ?: ""}cc World Record was set${track?.let { " on $it" } ?: ""}; Mastery has been recalculated."
        }
        "group_invited" -> "$actor invited you to ${notification.groupName ?: "a group"}."
        "group_joined" -> "$actor joined ${notification.groupName ?: "your group"}."
        "group_left" -> "$actor left ${notification.groupName ?: "your group"}."
        "group_removed" -> "A membership changed in ${notification.groupName ?: "your group"}."
        "group_role_changed" -> "A role changed in ${notification.groupName ?: "your group"}."
        "poke" -> "$actor poked you."
        "rock_paper_scissors" -> if (notification.detail == "result") "$actor answered your game." else "$actor challenged you to rock-paper-scissors."
        "dice_roll" -> "${nl.mariokart8.mk8dxtimetrials.notifications.androidDiceNotice(AndroidProductLanguage.ENGLISH, actor, notification.detail)}."
        "challenge" -> "$actor challenged you${track?.let { " on $it" } ?: ""}."
        else -> "Your MK8DX activity was updated."
    }
}

/** "1:59.317", or nothing when there is no time to show. */
private fun androidTimeText(totalMs: Int?): String {
    if (totalMs == null || totalMs <= 0) return ""
    return String.format(Locale.US, "%d:%02d.%03d", totalMs / 60_000, (totalMs % 60_000) / 1000, totalMs % 1000)
}

/**
 * One line of what an entry counted.
 *
 * The aggregate says "49 new World Records"; a member says which one. The same
 * three columns mean different things per kind, so the phrasing follows the
 * kind rather than printing the columns.
 */
internal fun androidNotificationEventLine(kind: String, event: AndroidNotificationEvent): String {
    val track = event.trackId?.let { Schema9AndroidTrackCatalog.find(it)?.displayName } ?: event.trackId
    val mode = event.mode?.let { "${it}cc" } ?: ""
    return when (kind) {
        "world_record" ->
            if (mode.isEmpty()) "New World Record on ${track ?: "a track"}"
            else "$mode · ${track ?: "a track"}"
        "overtaken" -> {
            val gap = if (event.actorTimeMs != null && event.recipientTimeMs != null) {
                String.format(Locale.US, "%.3fs faster", (event.recipientTimeMs - event.actorTimeMs) / 1000.0)
            } else null
            listOfNotNull(
                event.actorDisplayName ?: "Someone",
                track?.let { "on $it" },
                mode.takeIf(String::isNotEmpty),
                androidTimeText(event.actorTimeMs).takeIf(String::isNotEmpty),
                gap,
                event.recipientRank?.let { "you are now #$it" },
            ).joinToString(" · ")
        }
        "reaction_received" -> listOfNotNull(
            "${event.actorDisplayName ?: "A Player"} reacted",
            track?.let { "on $it" },
            mode.takeIf(String::isNotEmpty),
        ).joinToString(" · ")
        else -> listOfNotNull(
            event.actorDisplayName, track, mode.takeIf(String::isNotEmpty), event.detail,
        ).joinToString(" · ").ifEmpty { "One event" }
    }
}

/**
 * What the thumb cannot say.
 *
 * The artwork already carries the track, the cup and the engine class, so a
 * World Record member has nothing left to add and says nothing; an overtake
 * still owes you who, by how much and where you stand now.
 */
internal fun androidNotificationEventDetail(
    kind: String,
    event: AndroidNotificationEvent,
): String = when (kind) {
    "world_record" -> ""
    "overtaken" -> listOfNotNull(
        event.actorDisplayName ?: "Someone",
        androidTimeText(event.actorTimeMs).takeIf(String::isNotEmpty),
        if (event.actorTimeMs != null && event.recipientTimeMs != null) {
            String.format(
                Locale.US, "%.3fs faster",
                (event.recipientTimeMs - event.actorTimeMs) / 1000.0,
            )
        } else null,
        event.recipientRank?.let { "you are now #$it" },
    ).joinToString(" · ")
    "reaction_received" -> "${event.actorDisplayName ?: "A Player"} reacted"
    else -> listOfNotNull(event.actorDisplayName, event.detail).joinToString(" · ")
}

private fun formatDate(milliseconds: Long): String =
    if (milliseconds <= 0) "" else SimpleDateFormat("d MMM yyyy · HH:mm", Locale.getDefault()).format(Date(milliseconds))

/**
 * The product's own pages open in a browser, never back in this app: the app is
 * the verified handler for its host, so a plain `ACTION_VIEW` of "Open website
 * settings" landed on the app's own Settings.
 */
internal fun openWebsite(context: Context, url: String) {
    nl.mariokart8.mk8dxtimetrials.openProductWebsite(context, url)
}
