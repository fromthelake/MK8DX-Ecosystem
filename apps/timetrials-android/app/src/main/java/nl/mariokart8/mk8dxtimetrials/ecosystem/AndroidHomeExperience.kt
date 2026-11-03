package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutVariants
import nl.mariokart8.mk8dxtimetrials.track.TrackAssetArtwork
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.ui.AndroidDutchPresentationCatalog
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.track.AndroidTrackCatalogEntry
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.track.TrackIdentityArtwork
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDialog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEditAction
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMark
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMarkSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxFactRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSegmentedControl
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTableHeader
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTierChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxToggleChip

private sealed interface HomeLoadState {
    data object Loading : HomeLoadState
    data class Ready(
        val value: AndroidHomeBootstrap,
        val totalStandings: Map<Int, List<AndroidRankStanding>>,
    ) : HomeLoadState
    data class Failed(val message: String) : HomeLoadState
}

/**
 * A01 Home — the personal hub (DESIGN_SYSTEM §5 HIGH), on the design system.
 *
 * The order of the page is the web's: who you are and where you stand, the
 * Journey and the focus that follow the one engine choice, what changed while
 * you were away, what is waiting in the inbox, and the activity feed. Every
 * number is [Mk8dxNumeric]'s, every surface is the system's, and the engine is
 * data: one switch replaces every value under it.
 */
@Composable
internal fun AndroidHomeExperience(
    client: AndroidTimeTrialsEcosystemDataSource?,
    signedInPlayerId: String?,
    onOpenTrack: (String) -> Unit,
    /** Changes when the local outbox gains or finishes work, so remote-derived
     * focus, mastery and activity cannot stay frozen after a publication. */
    refreshSignal: Int = 0,
    onOpenFocus: (AndroidTimeTrialTrackScope, Int, AndroidRankTrackFocus) -> Unit = { _, _, _ -> },
    onOpenTotalRanking: (Int) -> Unit = {},
    onSubmitTime: () -> Unit = {},
    onOpenRecords: () -> Unit = {},
    onOpenTournamentStanding: () -> Unit = {},
    onOpenMastery: () -> Unit = {},
    onOpenCombo: (List<String>) -> Unit = {},
    onOpenInbox: () -> Unit = {},
    /** Whether Home's own A4 is on screen, for the shell's docked action (§11). */
    onActionVisibility: (Boolean) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var refresh by remember { mutableIntStateOf(0) }
    var state by remember(client, refresh, refreshSignal) {
        mutableStateOf<HomeLoadState>(HomeLoadState.Loading)
    }
    LaunchedEffect(client, refresh, refreshSignal) {
        state = if (client == null) {
            HomeLoadState.Failed("Community data is unavailable in this build.")
        } else {
            withContext(Dispatchers.IO) {
                runCatching {
                    val home = client.home()
                    HomeLoadState.Ready(
                        home,
                        listOf(150, 200).associateWith { mode ->
                            runCatching { client.rankStandings(mode, "all") }.getOrDefault(emptyList())
                        },
                    )
                }.fold(
                    onSuccess = { it },
                    onFailure = {
                        HomeLoadState.Failed(
                            "Community updates are unavailable. Check your connection and retry; local Time Trial tools still work.",
                        )
                    },
                )
            }
        }
    }
    Column(
        modifier.fillMaxWidth().testTag("home-connected-experience"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        when (val current = state) {
            HomeLoadState.Loading -> Mk8dxStatusMessage("Loading your focus and community…")
            is HomeLoadState.Failed -> {
                Mk8dxStatusMessage(current.message, tone = Mk8dxStatusTone.Warning)
                Mk8dxButton(
                    androidText("Retry", "Opnieuw"),
                    { refresh += 1 },
                    variant = Mk8dxButtonVariant.Secondary,
                    tag = "home-retry",
                )
            }
            is HomeLoadState.Ready -> {
                val home = current.value
                // `signedInPlayerId` here is the header label, not a canonical
                // Player id, so it never matched a `trackBests` row and the
                // viewer's own times silently went missing - which also filed
                // the viewer's own runs under "rest of the community". The
                // bootstrap already names the viewer in `comeback.player`.
                val viewerPlayerId = home.comeback?.player?.playerId
                if (signedInPlayerId != null && home.comeback != null) {
                    val preference = home.focus?.modePreference ?: "all"
                    var mode by rememberSaveable(viewerPlayerId, preference) {
                        mutableIntStateOf(EngineContext.resolve(preference = preference).mode)
                    }
                    AndroidHomeHero(
                        home,
                        onSubmitTime,
                        onOpenRecords,
                        onOpenTournamentStanding,
                        onOpenMastery,
                        onActionVisibility = onActionVisibility,
                    )
                    AndroidTimeTrialJourney(
                        home,
                        mode,
                        { mode = it },
                        onOpenFocus,
                        current.totalStandings[mode].orEmpty(),
                        onOpenTotalRanking,
                    )
                    YourFocus(home, mode, onOpenTrack)
                    AndroidComebackStrip(home, onOpenTrack)
                    HomeInboxEntry(home.notifications, onOpenInbox)
                }
                val ownBests = viewerPlayerId?.let { playerId ->
                    home.trackBests?.players
                        ?.firstOrNull { it.playerId == playerId }
                        ?.bests.orEmpty()
                        .associate { "${it.trackId}#${it.mode}" to it.totalTimeMs }
                }.orEmpty()
                CommunityActivity(
                    home.stories?.stories.orEmpty(),
                    client,
                    ownBests,
                    viewerPlayerId,
                    signedInPlayerId != null,
                    home.comeback?.rivals.orEmpty().mapTo(mutableSetOf()) { it.playerId },
                    onOpenTrack,
                    onOpenCombo,
                )
            }
        }
    }
}

/**
 * The inbox from Home (W02). The bootstrap already carries the inbox, so this
 * costs no request: it says how many notifications are waiting and opens the
 * one screen that owns them. ADR-0200's polling and read model are untouched.
 */
@Composable
private fun HomeInboxEntry(inbox: AndroidNotificationInbox?, onOpenInbox: () -> Unit) {
    if (inbox == null) return
    val language = androidNumberLanguage()
    val unread = inbox.unreadCount
    Mk8dxPanel(
        androidText("INBOX", "INBOX"),
        modifier = Modifier.testTag("home-inbox"),
    ) {
        Text(
            if (unread > 0) {
                androidText(
                    Mk8dxNumeric.formatCount(unread.toLong(), language) + " unread notification" +
                        (if (unread == 1) "" else "s"),
                    Mk8dxNumeric.formatCount(unread.toLong(), language) + " ongelezen melding" +
                        (if (unread == 1) "" else "en"),
                )
            } else {
                androidText("You're all caught up.", "Je bent helemaal bij.")
            },
            style = Mk8dxTheme.type.body,
            color = Mk8dxTheme.colors.textBody,
        )
        Mk8dxButton(
            androidText("Open inbox", "Inbox openen"),
            onOpenInbox,
            variant = Mk8dxButtonVariant.Secondary,
            tag = "home-inbox-open",
        )
    }
}

@Composable
private fun YourFocus(
    home: AndroidHomeBootstrap,
    // The web has one engine-class choice on Home and both sections follow it.
    // A second pair of chips here made one page answer two questions.
    selectedMode: Int,
    onOpenTrack: (String) -> Unit,
) {
    val comeback = home.comeback ?: return
    val colors = Mk8dxTheme.colors
    val ownBests = home.trackBests?.players
        ?.firstOrNull { it.playerId == comeback.player.playerId }?.bests.orEmpty()
    var context by remember(comeback.player.playerId) {
        mutableStateOf(if (comeback.rivals.isEmpty()) AndroidFocusContext.GLOBAL else AndroidFocusContext.RIVALS)
    }
    val filteredBests = ownBests.filter { it.mode == selectedMode }
    val cards = remember(home, context, selectedMode) {
        if (context == AndroidFocusContext.RIVALS) {
            val filtered = home.trackBests?.copy(players = home.trackBests.players.map { player ->
                player.copy(bests = player.bests.filter { it.mode == selectedMode })
            })
            buildAndroidRivalFocus(comeback.player.playerId, comeback.rivals, filtered)
        } else {
            buildAndroidGlobalFocus(home.focus?.rows.orEmpty().filter { it.mode == selectedMode }, filteredBests)
        }
    }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Mk8dxSpacing.md)
            .testTag("your-focus"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Mk8dxSectionLabel(androidText("YOUR FOCUS", "JOUW FOCUS"))
        Mk8dxSegmentedControl(
            androidText("Focus scope", "Focusbereik"),
            listOf(
                AndroidFocusContext.RIVALS to androidText("Rivals", "Rivalen"),
                AndroidFocusContext.GLOBAL to androidText("Global", "Globaal"),
            ),
            context,
            { context = it },
            Modifier.testTag("focus-scope"),
        )
        if (context == AndroidFocusContext.RIVALS && comeback.rivals.isEmpty()) {
            Text(
                "Choose rivals on your website profile to personalize these battles. Global challenges are ready now.",
                style = Mk8dxTheme.type.bodyS,
                color = colors.textSecondary,
            )
        }
        if (cards.cards().isEmpty()) {
            Text(
                "Nobody is ahead on a shared track in this view.",
                style = Mk8dxTheme.type.bodyS,
                color = colors.textSecondary,
            )
        }
        cards.cards().forEach { card ->
            FocusCard(card, onOpenTrack)
        }
    }
}

/** What a focus card is about, in words as well as in its chip's tone. */
private fun focusKindTone(kind: AndroidFocusKind): Mk8dxChipTone = when (kind) {
    AndroidFocusKind.LOWEST_MASTERY -> Mk8dxChipTone.Neutral
    AndroidFocusKind.CLOSEST_BATTLE -> Mk8dxChipTone.Info
    AndroidFocusKind.BIGGEST_GAP -> Mk8dxChipTone.Warning
}

@Composable
private fun FocusCard(card: AndroidFocusCard, onOpenTrack: (String) -> Unit) {
    val track = Schema9AndroidTrackCatalog.find(card.trackId)
    val colors = Mk8dxTheme.colors
    Box(
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .clickable(role = Role.Button) { onOpenTrack(card.trackId) }
            .testTag("focus-${card.kind.name.lowercase()}"),
    ) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val artworkWidth = when {
                maxWidth >= 600.dp -> 160.dp
                maxWidth >= 420.dp -> 112.dp
                else -> 96.dp
            }
            Row(
                Modifier.padding(Mk8dxSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                if (track != null) {
                    TrackIdentityArtwork(
                        track.index,
                        card.mode,
                        track.displayName,
                        Modifier.width(artworkWidth).aspectRatio(16f / 9f),
                    )
                }
                FocusCardCopy(
                    card,
                    track?.displayName ?: card.trackId,
                    Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun FocusCardCopy(
    card: AndroidFocusCard,
    trackName: String,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val language = androidNumberLanguage()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        Mk8dxChip(card.kind.label, tone = focusKindTone(card.kind))
        Text(
            trackName,
            style = type.title,
            color = colors.textPrimary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        // The engine class is already on the artwork, exactly as on the web;
        // repeating it as a pill was the APK's own addition.
        Text(card.headline, style = type.bodyS, color = colors.textBody)
        card.masteryTier?.let { tier ->
            androidMasteryTierColor(tier)?.let { color ->
                Mk8dxTierChip(AndroidMasteryThresholds.tierLabels[tier], color)
            }
        }
        if (card.kind == AndroidFocusKind.LOWEST_MASTERY && card.masteryTier != null && card.masteryTier > 0 && card.myBestMs != null) {
            val nextTier = card.masteryTier - 1
            val threshold = AndroidMasteryThresholds.trackLadder(card.trackId, card.mode)?.getOrNull(nextTier)
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            ) {
                Text(
                    "Improve by ${formatAndroidGap((card.myBestMs - (threshold ?: card.myBestMs)).coerceAtLeast(0L))} to reach",
                    style = type.bodyS,
                    color = colors.textSecondary,
                    modifier = Modifier.weight(1f),
                )
                androidMasteryTierColor(nextTier)?.let { color ->
                    Mk8dxTierChip(AndroidMasteryThresholds.tierLabels[nextTier], color)
                }
            }
        } else {
            Text(card.context, style = type.bodyS, color = colors.textSecondary)
        }
        // The two times the card is about. The web prints them under the
        // context line; the APK had the values and showed only the gap.
        if (card.myBestMs != null && card.targetMs != null) {
            // One line per side, as the web prints them; side by side the
            // names had no room left and were cut to a single letter.
            listOf(
                androidText("You", "Jij") to card.myBestMs,
                card.headline to card.targetMs,
            ).forEach { (label, value) ->
                Mk8dxFactRow(label, Mk8dxNumeric.formatTime(value))
            }
        }
        card.gapMs?.let {
            Text(
                Mk8dxNumeric.formatDelta(it),
                style = type.data.copy(fontWeight = FontWeight.SemiBold),
                color = androidDeltaTokenColor(it),
                softWrap = false,
                maxLines = 1,
            )
        }
    }
}

/** The delta tokens: faster, slower, or neither — with the sign always printed. */
@Composable
internal fun androidDeltaTokenColor(deltaMs: Long): Color {
    val colors = Mk8dxTheme.colors
    return when {
        deltaMs < 0 -> colors.deltaFaster
        deltaMs > 0 -> colors.deltaSlower
        else -> colors.textSecondary
    }
}

/** The recovered Mastery ladder's own colour for a tier; product data (§6). */
internal fun androidMasteryTierColor(index: Int): Color? =
    AndroidMasteryThresholds.tierLabels.getOrNull(index)
        ?.let { AndroidMasteryThresholds.tierColors[it] }
        ?.let(::androidParseColor)

@Composable
private fun CommunityActivity(
    stories: List<AndroidActivityStory>,
    client: AndroidTimeTrialsEcosystemDataSource?,
    ownBests: Map<String, Long>,
    viewerPlayerId: String?,
    signedIn: Boolean,
    rivalPlayerIds: Set<String>,
    onOpenTrack: (String) -> Unit,
    onOpenCombo: (List<String>) -> Unit,
) {
    var scopeFilter by remember(viewerPlayerId) { mutableStateOf(AndroidActivityScopeFilter.ALL) }
    var modeFilter by remember(viewerPlayerId) { mutableStateOf(AndroidActivityModeFilter.ALL) }
    var selectedStory by remember { mutableStateOf<AndroidActivityFeedItem?>(null) }
    // The web's activity page is this same feed without the Home preview
    // limit, so "View all activity" lifts the limit rather than leaving the
    // app for a page that shows the same thing.
    var expanded by rememberSaveable { mutableStateOf(false) }
    val nowMs = remember(stories) { System.currentTimeMillis() }
    val sections = remember(stories, ownBests, viewerPlayerId, scopeFilter, modeFilter, rivalPlayerIds, nowMs, expanded) {
        val built = buildAndroidActivityFeed(
            stories = stories,
            ownBests = ownBests,
            viewerPlayerId = viewerPlayerId,
            scopeFilter = scopeFilter,
            modeFilter = modeFilter,
            rivalPlayerIds = rivalPlayerIds,
            nowMs = nowMs,
        )
        if (expanded) built else limitAndroidActivityFeed(built)
    }
    val visibleItemCount = sections.action.size + sections.rivals.size +
        sections.attention.size + sections.ownSessions.size + sections.community.size
    val reactionIds = remember(sections, viewerPlayerId) {
        (sections.action + sections.rivals + sections.attention + sections.ownSessions + sections.community)
            .filter { it.story.player.playerId != viewerPlayerId }
            .mapNotNull { item -> item.story.runDetails.minByOrNull { it.timeMs }?.resultId }
            .distinct().take(20)
    }
    var reactionRefresh by remember { mutableIntStateOf(0) }
    var reactionSummaries by remember { mutableStateOf<Map<String, AndroidReactionSummary>>(emptyMap()) }
    LaunchedEffect(client, reactionIds, reactionRefresh) {
        reactionSummaries = if (client == null || reactionIds.isEmpty()) emptyMap() else
            withContext(Dispatchers.IO) {
                runCatching { client.reactionSummaries(reactionIds).associateBy { it.resultId } }
                    .getOrDefault(emptyMap())
            }
    }
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Mk8dxSpacing.md)
            .testTag("community-activity"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        // The web pairs the heading with the route to the full feed;
        // without it a phone had no way out of the twelve-item preview.
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Mk8dxSectionLabel(
                androidText(language, "COMMUNITY ACTIVITY", "COMMUNITY-ACTIVITEIT"),
                Modifier.weight(1f),
            )
            Mk8dxButton(
                if (expanded) androidText(language, "Show less activity", "Minder activiteit")
                else androidText(language, "View all activity", "Alle activiteit"),
                { expanded = !expanded },
                variant = Mk8dxButtonVariant.Quiet,
                size = Mk8dxButtonSize.Sm,
                tag = "activity-view-all",
            )
        }
        Text(
            androidText(language, "What matters to you, your sessions and the community", "Wat voor jou telt, jouw sessies en de community"),
            style = type.bodyS,
            color = colors.textSecondary,
        )
        if (signedIn) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            ) {
                ActivityScopeChip("All", "Alles", AndroidActivityScopeFilter.ALL, scopeFilter) { scopeFilter = it }
                if (rivalPlayerIds.isNotEmpty()) {
                    ActivityScopeChip("Rivals", "Rivalen", AndroidActivityScopeFilter.RIVALS, scopeFilter) { scopeFilter = it }
                }
                ActivityScopeChip("My tracks", "Mijn circuits", AndroidActivityScopeFilter.MY_TRACKS, scopeFilter) { scopeFilter = it }
            }
        }
        // Engine as a filter over classes, not an engine context: "All cc" is
        // one of its three answers, and each row still names its own class.
        Mk8dxSegmentedControl(
            androidText(language, "Engine class filter", "Filter op motorklasse"),
            listOf(
                AndroidActivityModeFilter.ALL to androidText(language, "All cc", "Alle cc"),
                AndroidActivityModeFilter.CC150 to "150cc",
                AndroidActivityModeFilter.CC200 to "200cc",
            ),
            modeFilter,
            { modeFilter = it },
            Modifier.testTag("activity-filter-mode"),
        )
        if (stories.any { it.runRank == null }) {
            Text(
                androidText(
                    language,
                    "# is the position when published · — means no position was saved for older activity.",
                    "# is de positie bij publicatie · — betekent dat bij oudere activiteit geen positie is opgeslagen.",
                ),
                style = type.micro,
                color = colors.textSecondary,
            )
        }
        if (stories.isEmpty()) {
            Text(
                "No recent community activity yet — be the first.",
                style = type.body,
                color = colors.textBody,
            )
        } else if (visibleItemCount == 0) {
            Text(
                androidText(
                    language,
                    "Nothing matches this filter yet.",
                    "Nog niets dat bij dit filter past.",
                ),
                style = type.body,
                color = colors.textSecondary,
            )
        }
        if (sections.action.isNotEmpty()) {
            ActivitySectionHeading("NEEDS ACTION", "VRAAGT OM ACTIE")
            sections.action.forEach { item ->
                ActivityPrimaryCard(item, onOpenTrack, onOpenCombo, { selectedStory = item }) {
                    ActivityReactionAction(item, client, viewerPlayerId, signedIn,
                        reactionSummaries[item.story.runDetails.minByOrNull { it.timeMs }?.resultId]) { reactionRefresh += 1 }
                }
            }
        }
        if (sections.rivals.isNotEmpty()) {
            ActivitySectionHeading("RIVALS", "RIVALEN")
            sections.rivals.forEach { item ->
                ActivityCompactCard(item, onOpenTrack, onOpenCombo, { selectedStory = item }) {
                    ActivityReactionAction(item, client, viewerPlayerId, signedIn,
                        reactionSummaries[item.story.runDetails.minByOrNull { it.timeMs }?.resultId]) { reactionRefresh += 1 }
                }
            }
        }
        if (sections.attention.isNotEmpty()) {
            ActivitySectionHeading("CLOSE BEHIND", "VLAK ACHTER JE")
            sections.attention.forEach { item ->
                ActivityCompactCard(item, onOpenTrack, onOpenCombo, { selectedStory = item }) {
                    ActivityReactionAction(item, client, viewerPlayerId, signedIn,
                        reactionSummaries[item.story.runDetails.minByOrNull { it.timeMs }?.resultId]) { reactionRefresh += 1 }
                }
            }
        }
        if (sections.ownSessions.isNotEmpty()) {
            ActivitySectionHeading("MY SESSIONS", "MIJN SESSIES")
            sections.ownSessions.forEach { item ->
                ActivityCompactCard(item, onOpenTrack, onOpenCombo, { selectedStory = item }) {
                    ActivityReactionAction(item, client, viewerPlayerId, signedIn,
                        reactionSummaries[item.story.runDetails.minByOrNull { it.timeMs }?.resultId]) { reactionRefresh += 1 }
                }
            }
        }
        if (sections.community.isNotEmpty()) {
            ActivitySectionHeading("REST OF THE COMMUNITY", "REST VAN DE COMMUNITY")
            sections.community.forEach { item ->
                ActivityCommunityRow(item, onOpenTrack, onOpenCombo, { selectedStory = item }) {
                    ActivityReactionAction(item, client, viewerPlayerId, signedIn,
                        reactionSummaries[item.story.runDetails.minByOrNull { it.timeMs }?.resultId]) { reactionRefresh += 1 }
                }
            }
        }
    }
    var editingResultId by remember { mutableStateOf<String?>(null) }
    selectedStory?.let { item ->
        ActivityStoryDetailDialog(
            item,
            onDismiss = { selectedStory = null },
            onOpenTrack = onOpenTrack,
            viewerPlayerId = viewerPlayerId,
            onEdit = if (client == null) null else { resultId -> selectedStory = null; editingResultId = resultId },
        )
    }
    val editingClient = client
    editingResultId?.let { resultId ->
        if (editingClient != null) {
            AndroidManageResultOverlay(resultId, editingClient, viewerPlayerId, onClose = { editingResultId = null })
        }
    }
}

private val activityReactionChoices = listOf(
    "laugh" to "😂", "very_funny" to "🤣", "crying" to "😭", "nervous" to "😅",
    "wow" to "😮", "unbelievable" to "😱", "cool" to "😎", "competitive" to "😤",
    "watching" to "👀", "fire" to "🔥", "fast" to "⚡", "rocket" to "🚀",
    "strong" to "💪", "clap" to "👏", "thumbs_up" to "👍", "trophy" to "🏆",
    "gold" to "🥇", "crown" to "👑", "target" to "🎯", "heart" to "❤️",
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ActivityReactionAction(
    item: AndroidActivityFeedItem,
    client: AndroidTimeTrialsEcosystemDataSource?,
    viewerPlayerId: String?,
    signedIn: Boolean,
    summary: AndroidReactionSummary?,
    onChanged: () -> Unit,
) {
    val story = item.story
    if (!signedIn || client == null || viewerPlayerId == story.player.playerId) return
    val resultId = story.runDetails.minByOrNull { it.timeMs }?.resultId ?: return
    val language = LocalAndroidProductLanguage.current
    val scope = rememberCoroutineScope()
    var pickerOpen by remember(resultId) { mutableStateOf(false) }
    var busy by remember(resultId) { mutableStateOf(false) }
    var status by remember(resultId) { mutableStateOf("") }
    fun choose(kind: String) {
        if (busy) return
        busy = true
        scope.launch {
            runCatching { withContext(Dispatchers.IO) {
                if (summary?.mine == kind) client.removeReaction(resultId)
                else client.reactToRun(resultId, kind)
            } }.onSuccess {
                status = androidText(language,
                    if (summary?.mine == kind) "Reaction removed" else "Reaction sent",
                    if (summary?.mine == kind) "Reactie verwijderd" else "Reactie verstuurd")
                pickerOpen = false
                onChanged()
            }.onFailure {
                status = androidText(language, "Could not react right now", "Reageren lukt nu niet")
            }
            busy = false
        }
    }
    // A rule inside the card: the reactions are the bottom row of this run, not the next one's top.
    Box(Modifier.fillMaxWidth().height(1.dp).background(Mk8dxTheme.colors.borderSubtle))
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        activityReactionChoices.filter { (kind, _) -> (summary?.counts?.get(kind) ?: 0) > 0 }
            .forEach { (kind, emoji) ->
                Mk8dxButton("$emoji ${summary?.counts?.get(kind) ?: 0}", { choose(kind) },
                    variant = if (summary?.mine == kind) Mk8dxButtonVariant.Secondary else Mk8dxButtonVariant.Quiet,
                    size = Mk8dxButtonSize.Sm,
                    tag = "activity-reaction-$kind-$resultId")
            }
        Mk8dxButton(
            androidText(language, "🙂+ React", "🙂+ Reageer"),
            { pickerOpen = true },
            variant = Mk8dxButtonVariant.Quiet,
            size = Mk8dxButtonSize.Sm,
            tag = "activity-react-$resultId",
        )
    }
    if (status.isNotBlank()) Mk8dxStatusMessage(status)
    if (pickerOpen) {
        Mk8dxDialog(
            androidText(language, "React to this run", "Reageer op deze rit"),
            androidText(language, "Close", "Sluiten"),
            { pickerOpen = false },
        ) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                activityReactionChoices.forEach { (kind, emoji) ->
                    Mk8dxButton(
                        emoji,
                        { choose(kind) },
                        variant = Mk8dxButtonVariant.Secondary,
                        size = Mk8dxButtonSize.Sm,
                        disabledReason = if (busy) "…" else null,
                        disabledReasonShown = false,
                    )
                }
            }
        }
    }
}

@Composable
private fun <T> ActivityScopeChip(
    english: String,
    dutch: String,
    value: T,
    selected: T,
    onSelect: (T) -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    Mk8dxToggleChip(
        androidText(language, english, dutch),
        value == selected,
        { onSelect(value) },
        Modifier.testTag("activity-filter-scope-${(value as Enum<*>).name.lowercase()}"),
    )
}

@Composable
private fun ActivitySectionHeading(english: String, dutch: String) {
    val language = LocalAndroidProductLanguage.current
    Mk8dxSectionLabel(
        androidText(language, english, dutch),
        Modifier.padding(top = Mk8dxSpacing.sm),
    )
}

@Composable
private fun ActivityPrimaryCard(
    item: AndroidActivityFeedItem,
    onOpenTrack: (String) -> Unit,
    onOpenCombo: (List<String>) -> Unit,
    onOpenDetails: (AndroidActivityFeedItem) -> Unit,
    /** Drawn inside the card's border, so the reactions visibly belong to this run. */
    footer: @Composable () -> Unit = {},
) {
    val story = item.story
    val track = Schema9AndroidTrackCatalog.find(story.trackId)
    val language = LocalAndroidProductLanguage.current
    val numbers = androidNumberLanguage()
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Mk8dxPanel(
        null,
        modifier = Modifier
            .clickable(role = Role.Button) { onOpenDetails(item) }
            .testTag("activity-primary-${story.trackId}-${story.mode}"),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            track?.let {
                ActivityTrackThumb(
                    it, story.mode, activityBestRun(story),
                    Modifier.width(84.dp).clickable(role = Role.Button) { onOpenTrack(story.trackId) },
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Mk8dxChip(
                    androidText(language, "Overtaken", "Ingehaald"),
                    tone = Mk8dxChipTone.Warning,
                )
                Text(
                    track?.displayName ?: story.trackId,
                    style = type.title,
                    color = colors.textPrimary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            item.resultDeltaMs?.let { ActivityDelta(it) }
        }
        val rank = story.viewerOvertake?.recipientRank
        val nowMs = remember(story.latestAtMs) { System.currentTimeMillis() }
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            ActivityPublicationRank(story)
            Text(
                story.player.displayName,
                modifier = Modifier.weight(1f),
                style = type.body.copy(fontWeight = FontWeight.SemiBold),
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                Mk8dxNumeric.formatTime(story.bestMs),
                style = type.data.copy(fontWeight = FontWeight.SemiBold),
                color = colors.textPrimary,
                maxLines = 1,
                softWrap = false,
            )
        }
        Text(
            androidText(
                language,
                "${story.player.displayName} passed you" +
                    (rank?.let { " · you are now " + Mk8dxNumeric.formatRank(it, numbers) } ?: ""),
                "${story.player.displayName} passeerde je" +
                    (rank?.let { " · jij staat nu " + Mk8dxNumeric.formatRank(it, numbers) } ?: ""),
            ) + " · ${androidRelativeTime(story.latestAtMs, nowMs, language)}",
            style = type.bodyS,
            color = colors.textSecondary,
            maxLines = 2,
        )
        ActivityQuickMetrics(
            story,
            onOpenCombo,
            Modifier.fillMaxWidth().testTag("activity-metrics-${story.trackId}-${story.mode}"),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
            Mk8dxButton(
                androidText(language, "Race this track", "Circuit rijden"),
                { onOpenTrack(story.trackId) },
                variant = Mk8dxButtonVariant.Secondary,
                tag = "activity-race-${story.trackId}-${story.mode}",
                modifier = Modifier.weight(1f),
            )
            Mk8dxButton(
                androidText(language, "Compare", "Vergelijk"),
                { onOpenDetails(item) },
                variant = Mk8dxButtonVariant.Secondary,
                tag = "activity-compare-${story.trackId}-${story.mode}",
                modifier = Modifier.weight(1f),
            )
        }
        footer()
    }
}

/** A gap, in the system's one delta format: a true minus and always a sign. */
@Composable
private fun ActivityDelta(deltaMs: Long) {
    Text(
        Mk8dxNumeric.formatDelta(deltaMs),
        style = Mk8dxTheme.type.data.copy(fontWeight = FontWeight.SemiBold),
        color = androidDeltaTokenColor(deltaMs),
        softWrap = false,
        maxLines = 1,
    )
}

@Composable
private fun ActivityResultDelta(item: AndroidActivityFeedItem) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val delta = item.resultDeltaMs
    if (delta != null) {
        ActivityDelta(delta)
    } else if (item.story.personalBest) {
        Text(
            androidText(language, "First time", "Eerste tijd"),
            style = Mk8dxTheme.type.dataS.copy(fontWeight = FontWeight.SemiBold),
            color = colors.textSecondary,
            maxLines = 1,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ActivityCompactCard(
    item: AndroidActivityFeedItem,
    onOpenTrack: (String) -> Unit,
    onOpenCombo: (List<String>) -> Unit,
    onOpenDetails: (AndroidActivityFeedItem) -> Unit,
    /** Drawn inside the card's border, so the reactions visibly belong to this run. */
    footer: @Composable () -> Unit = {},
) {
    val story = item.story
    val track = Schema9AndroidTrackCatalog.find(story.trackId)
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val nowMs = remember(story.latestAtMs) { System.currentTimeMillis() }
    val whenText = androidRelativeTime(story.latestAtMs, nowMs, language)
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .activityOutcomeKeyline(item)
            .clickable(role = Role.Button) { onOpenDetails(item) }
            .padding(Mk8dxSpacing.sm)
            .testTag("activity-compact-${story.trackId}-${story.mode}"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            track?.let {
                ActivityTrackThumb(
                    it, story.mode, activityBestRun(story),
                    Modifier.width(106.dp).clickable(role = Role.Button) { onOpenTrack(story.trackId) },
                )
            }
            // Own sessions read exactly like the community rows - position,
            // Player, country, age, then the time - so the two groups can be
            // compared without re-learning the layout.
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                ActivityIdentityLine(story, whenText)
                // A time and its PB chip share a line while they fit and wrap
                // rather than clip when they do not - at font scale 2.0 the
                // chip used to be cut off at the panel edge (§10).
                FlowRow(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs, Alignment.End),
                    verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                ) {
                    Text(
                        Mk8dxNumeric.formatTime(story.bestMs),
                        style = type.data.copy(fontWeight = FontWeight.SemiBold),
                        color = colors.textPrimary,
                        maxLines = 1,
                        softWrap = false,
                    )
                    if (story.personalBest) ActivityPersonalBestBadge()
                    ActivityResultDelta(item)
                }
                Text(
                    activitySummary(item, language),
                    style = type.bodyS,
                    color = colors.textSecondary,
                    maxLines = 2,
                )
                if (story.runs > 1 && story.improvedMs != null) {
                    Text(
                        Mk8dxNumeric.formatTime(story.startMs) + " → " +
                            Mk8dxNumeric.formatTime(story.bestMs) + " · " +
                            Mk8dxNumeric.formatDelta(-story.improvedMs),
                        style = Mk8dxTheme.type.dataS,
                        color = colors.textSecondary,
                        maxLines = 1,
                    )
                }
                if (story.rank?.after == 1) {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                    ) {
                        Mk8dxChip(
                            Mk8dxNumeric.formatRank(1, androidNumberLanguage()),
                            tone = Mk8dxChipTone.Success,
                        )
                    }
                }
            }
        }
        ActivityQuickMetrics(
            story,
            onOpenCombo,
            Modifier.fillMaxWidth().testTag("activity-metrics-${story.trackId}-${story.mode}"),
        )
        footer()
    }
}

/**
 * How long ago a story's newest run happened, in the same buckets the web
 * product uses (`relativeDate` in activity-stories.ts), so both feeds give
 * the same sense of time.
 */
internal fun androidRelativeTime(
    latestAtMs: Long,
    nowMs: Long,
    language: AndroidProductLanguage,
): String {
    val difference = (nowMs - latestAtMs).coerceAtLeast(0)
    val minutes = difference / 60_000
    if (minutes < 60) {
        return if (minutes <= 1) {
            androidText(language, "just now", "zojuist")
        } else {
            androidText(language, "${minutes}m ago", "${minutes}m geleden")
        }
    }
    val hours = minutes / 60
    if (hours < 48) return androidText(language, "${hours}h ago", "${hours}u geleden")
    val days = hours / 24
    if (days < 60) return androidText(language, "${days}d ago", "${days}d geleden")
    return androidText(language, "${days / 30}mo ago", "${days / 30}mnd geleden")
}

private fun activitySummary(
    item: AndroidActivityFeedItem,
    language: AndroidProductLanguage,
): String {
    val story = item.story
    return when (item.relevance) {
        AndroidActivityRelevance.OVERTAKEN -> androidText(
            language,
            "${story.player.displayName} passed your PB",
            "${story.player.displayName} passeerde jouw PB",
        )
        AndroidActivityRelevance.THREATENED -> androidText(
            language,
            "${story.player.displayName} is close behind your PB",
            "${story.player.displayName} zit vlak achter jouw PB",
        )
        AndroidActivityRelevance.RIVAL -> androidText(
            language,
            "Recent rival activity from ${story.player.displayName}",
            "Recente rivalactiviteit van ${story.player.displayName}",
        )
        AndroidActivityRelevance.OWN_PR -> androidText(
            language,
            "${story.runs} ${if (story.runs == 1) "run" else "runs"} · personal best",
            "${story.runs} ${if (story.runs == 1) "rit" else "ritten"} · persoonlijk record",
        )
        else -> androidText(
            language,
            "${story.runs} ${if (story.runs == 1) "run" else "runs"}",
            "${story.runs} ${if (story.runs == 1) "rit" else "ritten"}",
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ActivityCommunityRow(
    item: AndroidActivityFeedItem,
    onOpenTrack: (String) -> Unit,
    onOpenCombo: (List<String>) -> Unit,
    onOpenDetails: (AndroidActivityFeedItem) -> Unit,
    /** Drawn inside the card's border, so the reactions visibly belong to this run. */
    footer: @Composable () -> Unit = {},
) {
    val story = item.story
    val track = Schema9AndroidTrackCatalog.find(story.trackId)
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val nowMs = remember(story.latestAtMs) { System.currentTimeMillis() }
    val whenText = androidRelativeTime(story.latestAtMs, nowMs, language)
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .activityOutcomeKeyline(item)
            .clickable(role = Role.Button) { onOpenDetails(item) }
            .padding(Mk8dxSpacing.sm)
            .testTag("activity-row-${story.trackId}-${story.mode}"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            track?.let {
                // The web names the track on the artwork itself, with its cup
                // under it and the submission source in the corner.
                ActivityTrackThumb(
                    it, story.mode, activityBestRun(story),
                    Modifier.width(106.dp).clickable(role = Role.Button) { onOpenTrack(story.trackId) },
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                ActivityIdentityLine(story, whenText)
                // A time and its PB chip share a line while they fit and wrap
                // rather than clip when they do not - at font scale 2.0 the
                // chip used to be cut off at the panel edge (§10).
                FlowRow(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs, Alignment.End),
                    verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                ) {
                    Text(
                        Mk8dxNumeric.formatTime(story.bestMs),
                        style = type.data.copy(fontWeight = FontWeight.SemiBold),
                        color = colors.textPrimary,
                        maxLines = 1,
                        softWrap = false,
                    )
                    if (story.personalBest) ActivityPersonalBestBadge()
                    ActivityResultDelta(item)
                }
            }
        }
        ActivityQuickMetrics(
            story,
            onOpenCombo,
            Modifier.fillMaxWidth().testTag("activity-metrics-${story.trackId}-${story.mode}"),
        )
        footer()
    }
}

/**
 * The Activity artwork as the web draws it: a 2 dp keyline in the engine
 * colour, the engine mark in one corner, the submission source in the other,
 * and the cup mark beside a small dark plate naming the track and its cup.
 *
 * The inbox uses it too, so a notification about a track looks like the rest of
 * the product. `run` is Activity's corner mark for the client that published a
 * run; nothing else has one.
 */
@Composable
internal fun ActivityTrackThumb(
    track: AndroidTrackCatalogEntry,
    mode: Int,
    run: AndroidActivityRun? = null,
    modifier: Modifier = Modifier,
) {
    val cup = Schema9AndroidTrackCatalog.cups.getOrNull(track.index / 4)
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val engine = if (mode == 200) colors.engine200 else colors.engine150
    BoxWithConstraints(
        modifier
            .aspectRatio(16f / 9f)
            .border(2.dp, engine),
    ) {
        // The badge row and the name plate share one column rather than being
        // stacked on top of each other: on a 106 dp thumbnail a two-line name
        // used to be drawn straight through the engine badge.
        val roomForTwoLines = maxHeight >= 72.dp
        // The plate is *printed on the artwork*, so it keeps its size relative
        // to the art rather than to the text scale: a 106 dp thumbnail cannot
        // grow, and letting the label scale to 200 % left three letters of the
        // track's name where the whole name fits now. Everything the reader
        // acts on - the Player, the time, the gap - scales normally.
        val density = LocalDensity.current
        val artLabel = with(density) { 11.dp.toSp() }
        val artCup = with(density) { 9.dp.toSp() }
        val artLine = with(density) { 13.dp.toSp() }
        TrackAssetArtwork(track.index, Modifier.fillMaxWidth().aspectRatio(16f / 9f), track.displayName)
        Column(
            Modifier.matchParentSize().padding(3.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Mk8dxEngineMark(mode, size = Mk8dxEngineMarkSize.Art)
                run?.let { ActivitySourceMark(it) }
            }
            // The plate hugs the copy instead of banding the whole image, so the
            // artwork stays readable and the name keeps its own surface.
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                ProductAssetImage(
                    path = "private-product/img/cup/${track.index / 4}.png",
                    fallback = "",
                    accent = colors.textSecondary,
                    modifier = Modifier.size(19.dp),
                )
                Column(
                    Modifier
                        // The plate can never be wider than the art it sits on:
                        // at font scale 2.0 it used to run off the thumbnail and
                        // cut the name mid-word instead of ellipsising it.
                        .weight(1f, fill = false)
                        .padding(start = Mk8dxSpacing.xs)
                        // §16's shade over artwork, in the drawn appearance.
                        .background(Mk8dxTheme.colors.surfaceApp.copy(alpha = .82f))
                        .padding(horizontal = 3.dp, vertical = 2.dp),
                ) {
                    Text(
                        androidText(language, track.displayName, AndroidDutchPresentationCatalog.translate(track.displayName)),
                        style = Mk8dxTheme.type.micro.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = artLabel, lineHeight = artLine,
                        ),
                        color = Mk8dxTheme.colors.textPrimary,
                        // A name ellipsises before anything else on the thumb;
                        // on a short one it gets one line, not two through the
                        // badge above it.
                        maxLines = if (roomForTwoLines) 2 else 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    cup?.let {
                        Text(
                            androidText(language, it.displayName, AndroidDutchPresentationCatalog.translate(it.displayName)),
                            style = Mk8dxTheme.type.micro.copy(fontSize = artCup, lineHeight = artLine),
                            color = Mk8dxTheme.colors.textSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

/** The corner mark: which client published the run, at icon size. */
@Composable
private fun ActivitySourceMark(run: AndroidActivityRun) {
    val (icon, description) = when {
        run.sourceKind.startsWith("android_") ->
            nl.mariokart8.mk8dxtimetrials.R.drawable.ic_android_platform to "Android"
        run.sourceKind.startsWith("livetrial_") ->
            nl.mariokart8.mk8dxtimetrials.R.drawable.ic_windows_platform to "Windows"
        run.sourceKind == "web_manual" ->
            nl.mariokart8.mk8dxtimetrials.R.drawable.ic_web_platform to "Web"
        else -> null to null
    }
    if (icon == null) return
    Box(
        Modifier
            .size(19.dp)
            .background(Mk8dxTheme.colors.surfaceApp)
            .border(1.dp, Mk8dxTheme.colors.borderSubtle),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painterResource(icon),
            contentDescription = description,
            tint = Color.Unspecified,
            modifier = Modifier.size(13.dp),
        )
    }
}

/** The web's PB chip. The historical change is the separate delta beside it. */
@Composable
private fun ActivityPersonalBestBadge(modifier: Modifier = Modifier) {
    Mk8dxChip(
        "PB",
        modifier.testTag("activity-pb"),
        tone = Mk8dxChipTone.Success,
    )
}

/**
 * The web's left keyline. Success says you are ahead here (or it is a personal
 * record); error says this run beat your best. A tie or nothing to compare
 * against draws no line at all - the absence is meaningful, and the words in
 * the row say the same thing.
 */
@Composable
private fun androidActivityOutcomeColor(outcome: AndroidActivityOutcome): Color? {
    val colors = Mk8dxTheme.colors
    return when (outcome) {
        AndroidActivityOutcome.WON, AndroidActivityOutcome.RECORD -> colors.statusSuccess
        AndroidActivityOutcome.LOST -> colors.statusError
        AndroidActivityOutcome.NONE -> null
    }
}

/** Draws that keyline down the leading edge of a row. */
@Composable
private fun Modifier.activityOutcomeKeyline(item: AndroidActivityFeedItem): Modifier {
    val color = androidActivityOutcomeColor(androidActivityOutcome(item)) ?: return this
    return drawBehind {
        val thickness = 3.dp.toPx()
        drawRect(color = color, topLeft = Offset.Zero, size = Size(thickness, size.height))
    }
}

/** Position, Player, country and age - the web row's first line. */
@Composable
private fun ActivityIdentityLine(story: AndroidActivityStory, whenText: String) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        ActivityPublicationRank(story)
        Text(
            story.player.displayName,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = type.body.copy(fontWeight = FontWeight.SemiBold),
            color = colors.textPrimary,
        )
        story.player.countryId?.let { countryId ->
            ProductAssetImage(
                "private-product/img/country/${countryId.substringAfter('.')}.png",
                "",
                colors.textSecondary,
                Modifier.width(22.dp).height(15.dp),
            )
        }
        Text(
            whenText,
            style = type.micro,
            color = colors.textSecondary,
            maxLines = 1,
            softWrap = false,
        )
    }
}

@Composable
private fun ActivityPublicationRank(story: AndroidActivityStory) {
    val numbers = androidNumberLanguage()
    Text(
        story.runRank?.let { Mk8dxNumeric.formatRank(it, numbers) } ?: "—",
        style = Mk8dxTheme.type.data,
        color = Mk8dxTheme.colors.textSecondary,
        maxLines = 1,
        softWrap = false,
        modifier = Modifier.testTag("activity-rank-${story.trackId}-${story.mode}"),
    )
}

private fun activityBestRun(story: AndroidActivityStory): AndroidActivityRun? =
    story.runDetails.minWithOrNull(compareBy<AndroidActivityRun> { it.timeMs }.thenBy { it.resultId })

internal fun activityLoadoutAsset(
    baseId: String?,
    variantId: String?,
    characterId: String?,
): Pair<String, String>? {
    AndroidLoadoutVariants.byId(variantId)?.let { return it.assetPath to it.name }
    val part = AndroidLoadoutCatalog.find(baseId) ?: return null
    val themed = if (characterId == null) null else AndroidLoadoutVariants.matched(part.id, characterId)
    return (themed?.assetPath ?: part.assetPath) to part.name
}

internal fun activityCurrencyAsset(trackId: String): Pair<String, String> = when (trackId) {
    "track.yoshis_island" -> "private-product/img/item/shine.png" to "Shine"
    "track.hyrule_circuit" -> "private-product/img/item/rupee.png" to "Rupees"
    "track.animal_crossing" -> "private-product/img/item/bell.png" to "Bells"
    else -> "private-product/img/item/coin.png" to "Coins"
}

@Composable
private fun ActivityQuickMetrics(
    story: AndroidActivityStory,
    onOpenCombo: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    val run = activityBestRun(story)
    val loadout = run?.loadout
    val characterAppearanceId = loadout?.characterVariantId ?: loadout?.characterId
    val loadoutAssets = listOf(
        activityLoadoutAsset(loadout?.characterId, loadout?.characterVariantId, characterAppearanceId),
        activityLoadoutAsset(loadout?.bodyId, loadout?.bodyVariantId, characterAppearanceId),
        activityLoadoutAsset(loadout?.tireId, null, characterAppearanceId),
        activityLoadoutAsset(loadout?.gliderId, loadout?.gliderVariantId, characterAppearanceId),
    )
    val laps = run?.laps?.sortedBy { it.lapNumber }.orEmpty()
    val mushroomValues = laps.map { it.mushroomsUsed }
    val coinValues = activityCoinDeltas(laps)
    val currency = activityCurrencyAsset(story.trackId)
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        // The web's combo summary is a link into Build. The APK drew the same
        // four parts and did nothing when they were tapped.
        val comboPartIds = listOfNotNull(
            loadout?.characterId, loadout?.bodyId, loadout?.tireId, loadout?.gliderId,
        )
        val comboIsComplete = comboPartIds.size == 4
        Row(
            Modifier
                .weight(1.45f)
                .heightIn(min = Mk8dxSpacing.xxl)
                .then(
                    if (comboIsComplete) {
                        Modifier
                            .clickable(role = Role.Button) { onOpenCombo(comboPartIds) }
                            .testTag("activity-combo-${story.trackId}-${story.mode}")
                    } else Modifier,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            if (loadoutAssets.all { it == null }) {
                Text("—", style = Mk8dxTheme.type.bodyS, color = colors.textSecondary)
            } else {
                loadoutAssets.forEach { asset ->
                    if (asset == null) {
                        Text(
                            "—",
                            modifier = Modifier.width(20.dp),
                            style = Mk8dxTheme.type.bodyS,
                            color = colors.textSecondary,
                        )
                    } else {
                        ProductAssetImage(
                            asset.first,
                            asset.second.take(1),
                            colors.textSecondary,
                            Modifier.width(22.dp).height(20.dp),
                            contentDescription = asset.second,
                        )
                    }
                }
            }
        }
        ActivityMetricPattern(
            "private-product/img/item/mushroom.png",
            "Mushrooms per lap",
            mushroomValues,
            Modifier.weight(.8f),
        )
        ActivityMetricPattern(currency.first, currency.second, coinValues, Modifier.weight(.8f))
    }
}

@Composable
private fun ActivityMetricPattern(
    assetPath: String,
    description: String,
    values: List<Int?>,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    Row(
        modifier.heightIn(min = Mk8dxSpacing.xxl),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        ProductAssetImage(
            assetPath,
            "",
            colors.textSecondary,
            Modifier.width(20.dp).height(18.dp),
            contentDescription = description,
        )
        Text(
            if (values.isEmpty()) "—" else values.joinToString("·") { it?.toString() ?: "—" },
            modifier = Modifier.padding(start = 3.dp),
            style = Mk8dxTheme.type.dataS,
            color = colors.textBody,
            maxLines = 1,
            softWrap = false,
        )
    }
}

@Composable
private fun ActivityStoryDetailDialog(
    item: AndroidActivityFeedItem,
    onDismiss: () -> Unit,
    onOpenTrack: (String) -> Unit,
    viewerPlayerId: String? = null,
    /** Opens one of the viewer's own runs in the edit form (owner 2026-09-29). */
    onEdit: ((String) -> Unit)? = null,
) {
    val story = item.story
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val track = Schema9AndroidTrackCatalog.find(story.trackId)
    Mk8dxDialog(
        track?.displayName ?: story.trackId,
        androidText(language, "Close", "Sluiten"),
        onDismiss,
        modifier = Modifier.testTag("activity-detail-dialog"),
    ) {
        Column(
            Modifier.heightIn(max = 640.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                track?.let {
                    ActivityTrackThumb(
                        it,
                        story.mode,
                        activityBestRun(story),
                        Modifier.width(104.dp),
                    )
                } ?: Mk8dxEngineMark(story.mode)
                val nowMs = remember(story.latestAtMs) { System.currentTimeMillis() }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        Mk8dxNumeric.formatTime(story.bestMs),
                        style = type.data,
                        color = colors.textPrimary,
                    )
                    Text(
                        "${story.player.displayName} · ${story.runs} ${if (story.runs == 1) "run" else "runs"} · " +
                            androidRelativeTime(story.latestAtMs, nowMs, language),
                        style = type.bodyS,
                        color = colors.textBody,
                    )
                }
            }
            item.resultDeltaMs?.let { delta ->
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                ) {
                    ActivityDelta(delta)
                    Text(
                        if (item.comparisonMs != null) {
                            androidText(language, "compared with your PB", "vergeleken met jouw PR")
                        } else {
                            androidText(
                                language,
                                "compared with this Player's previous PB",
                                "vergeleken met het vorige PR van deze speler",
                            )
                        },
                        style = type.bodyS,
                        color = colors.textSecondary,
                    )
                }
            }
            if (story.runDetails.isEmpty()) {
                Text(
                    androidText(language, "No detailed run data was recorded.", "Er zijn geen uitgebreide rundetails vastgelegd."),
                    style = type.body,
                    color = colors.textBody,
                )
            } else {
                // The fastest run is the cluster's head; the rest follow by
                // time, each with its gap to the head.
                val ordered = story.runDetails.sortedWith(
                    compareBy<AndroidActivityRun> { it.timeMs }.thenBy { it.atMs }.thenBy { it.resultId },
                )
                val head = ordered.first()
                val own = viewerPlayerId != null && story.player.playerId == viewerPlayerId
                ordered.forEachIndexed { index, run ->
                    ActivityRunDetails(
                        run,
                        index + 1,
                        note = if (index == 0) {
                            androidText(language, "Fastest", "Snelste")
                        } else {
                            Mk8dxNumeric.formatDelta(run.timeMs - head.timeMs)
                        },
                        head = index == 0,
                        trackId = story.trackId,
                        onEdit = if (own && onEdit != null) ({ onEdit(run.resultId) }) else null,
                    )
                }
            }
            Mk8dxButton(
                androidText(language, "Open leaderboard", "Open klassement"),
                { onDismiss(); onOpenTrack(story.trackId) },
                variant = Mk8dxButtonVariant.Primary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
internal fun ActivityRunDetails(
    run: AndroidActivityRun,
    number: Int,
    note: String? = null,
    head: Boolean = false,
    title: String? = null,
    trackId: String? = null,
    onEdit: (() -> Unit)? = null,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val language = LocalAndroidProductLanguage.current
    Mk8dxPanel(null) {
        // The run and its time on one line, what it is under it: on a phone the chips pushed the
        // time off the card (2026-09-29).
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                title ?: androidText(language, "Run $number", "Rit $number"),
                Modifier.weight(1f),
                style = type.title,
                color = colors.textPrimary,
            )
            Text(
                Mk8dxNumeric.formatTime(run.timeMs),
                style = type.data.copy(fontWeight = FontWeight.SemiBold),
                color = colors.textPrimary,
                softWrap = false,
                maxLines = 1,
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ActivitySourceBadge(run)
            note?.let {
                if (head) {
                    Mk8dxChip(it, tone = Mk8dxChipTone.Success)
                } else {
                    Text(it, style = type.dataS, color = colors.textSecondary)
                }
            }
        }
        if (run.laps.isEmpty()) {
            Text(
                "Lap times and coins not recorded.",
                style = type.bodyS,
                color = colors.textSecondary,
            )
        } else {
            val currency = activityCurrencyAsset(trackId.orEmpty())
            // The coins and mushrooms columns are named by their pictures, as on the board.
            Row(
                Modifier.fillMaxWidth().padding(bottom = Mk8dxSpacing.xs),
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(androidText(language, "Lap", "Ronde"), Modifier.weight(.14f), style = type.micro, color = colors.textSecondary)
                Text(androidText(language, "Lap time", "Rondetijd"), Modifier.weight(.34f), style = type.micro, color = colors.textSecondary)
                Box(Modifier.weight(.22f)) {
                    ProductAssetImage(currency.first, "", colors.textSecondary, Modifier.size(20.dp), contentDescription = currency.second)
                }
                Box(Modifier.weight(.30f)) {
                    ProductAssetImage(
                        "private-product/img/item/mushroom.png", "", colors.textSecondary, Modifier.size(20.dp),
                        contentDescription = androidText(language, "Mushrooms", "Paddenstoelen"),
                    )
                }
            }
            val coinDeltas = activityCoinDeltas(run.laps)
            run.laps.forEachIndexed { index, lap ->
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                ) {
                    Text("${lap.lapNumber}", Modifier.weight(.14f), style = type.data, color = colors.textBody)
                    Text(
                        Mk8dxNumeric.formatTime(lap.timeMs),
                        Modifier.weight(.34f),
                        style = type.data,
                        color = colors.textBody,
                        softWrap = false,
                        maxLines = 1,
                    )
                    Text(coinDeltas[index]?.toString() ?: "—", Modifier.weight(.22f), style = type.data, color = colors.textBody)
                    Text(lap.mushroomsUsed?.toString() ?: "—", Modifier.weight(.30f), style = type.data, color = colors.textBody)
                }
            }
        }
        val loadout = run.loadout
        val appearance = loadout?.characterVariantId ?: loadout?.characterId
        // One part per line: its name, then its picture (owner 2026-09-29: "Mario 🖼").
        val setup = listOf(
            activityVariantName(loadout?.characterId, loadout?.characterVariantId)?.let {
                (activityLoadoutAsset(loadout?.characterId, loadout?.characterVariantId, appearance)?.first ?: "") to it
            },
            activityVariantName(loadout?.bodyId, loadout?.bodyVariantId)?.let {
                (activityLoadoutAsset(loadout?.bodyId, loadout?.bodyVariantId, appearance)?.first ?: "") to it
            },
            activityPartName(loadout?.tireId)?.let {
                (activityLoadoutAsset(loadout?.tireId, null, appearance)?.first ?: "") to it
            },
            activityVariantName(loadout?.gliderId, loadout?.gliderVariantId)?.let {
                (activityLoadoutAsset(loadout?.gliderId, loadout?.gliderVariantId, appearance)?.first ?: "") to it
            },
        )
        if (setup.all { it == null }) {
            Text(
                androidText(language, "Character and kart setup not recorded.", "Personage en kartcombinatie niet vastgelegd."),
                style = type.bodyS,
                color = colors.textSecondary,
            )
        } else {
            AndroidPartLines(setup)
        }
        onEdit?.let {
            Mk8dxEditAction(
                androidText(language, "Edit", "Bewerken"),
                it,
                tag = "run-edit-${run.resultId}",
            )
        }
    }
}

@Composable
private fun ActivitySourceBadge(run: AndroidActivityRun) {
    val label = when {
        run.sourceKind.startsWith("android_") -> "Android"
        run.sourceKind.startsWith("livetrial_") -> "Windows"
        run.sourceKind == "web_manual" -> "Web"
        else -> androidText("Unknown source", "Onbekende bron")
    }
    Row(
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Mk8dxChip(label, tone = Mk8dxChipTone.Neutral)
        if (run.correctedFields.isNotEmpty()) {
            Mk8dxChip(
                androidText("Corrected", "Gecorrigeerd"),
                Modifier.testTag("activity-corrected"),
                tone = Mk8dxChipTone.Warning,
            )
        }
    }
}

internal fun activityCoinDeltas(
    laps: List<AndroidActivityLap>,
): List<Int?> {
    var previous = 0
    return laps.map { lap ->
        lap.coinsCollected?.let { current ->
            (current - previous).also { previous = current }
        }
    }
}

private fun activityPartName(id: String?): String? = id?.let { value ->
    AndroidLoadoutCatalog.find(value)?.name ?: value.substringAfter('.')
        .replace('_', ' ').split(' ').joinToString(" ") { word ->
            word.replaceFirstChar(Char::uppercase)
        }
}

private fun activityVariantName(baseId: String?, variantId: String?): String? {
    val base = activityPartName(baseId) ?: return null
    val variant = AndroidLoadoutVariants.byId(variantId) ?: return base
    return "$base · ${variant.name}"
}
