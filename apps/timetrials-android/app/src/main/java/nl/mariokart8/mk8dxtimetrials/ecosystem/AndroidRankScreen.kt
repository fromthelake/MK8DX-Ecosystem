package nl.mariokart8.mk8dxtimetrials.ecosystem

import android.graphics.Color.parseColor
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidLocalizedPresentation
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.AndroidDutchPresentationCatalog
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind
import nl.mariokart8.mk8dxtimetrials.track.TrackIdentityArtwork
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxComparisonColumn
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxComparisonGrid
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDialog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMark
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMarkSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineSelector
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxFilterSheet
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxFilterSummary
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxHeroRank
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPodiumEntry
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPodiumStrip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxRankRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxRankingTable
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxRowKind
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSearchField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSortDirection
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatBlock
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTabOption
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTableHeader
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTabs
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTierChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxToggleChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxValueBar
import nl.mariokart8.mk8dxtimetrials.ui.design.mk8dxLeadColumnWidth

/**
 * Ranking has two halves. Time Trials answers "how fast are you" against a
 * clock; Tournament answers "how do you do against people". They share nothing
 * but the page, so the master tab switches the whole body rather than adding a
 * fifth tab to a row that is already about tracks.
 *
 * Migrated to the design system in Phase 6 (A04): a LOW-spectacle data screen —
 * calm token surfaces instead of the Race Control palette, one filter summary
 * with a sheet instead of four stacked control panels, ranking rows whose rank
 * column is measured from the dataset's largest rank, and tabular Plex Mono for
 * every number. The engine is a visible selector on the screen, and switching it
 * replaces every dependent value, exactly as before.
 */
private enum class AndroidRankSection(val english: String, val dutch: String) {
    TIME_TRIALS("Time Trials", "Time Trials"),
    TOURNAMENT("Tournament", "Toernooi"),
}

private enum class AndroidRankTab(val label: String) { TOTAL("Total"), MEDALS("Medals"), MASTERY("Mastery"), TRACKS("Delta per track") }
private enum class AndroidRankSort(val label: String) {
    TRACK("Track"), RANK("Position"), GAP("Delta"), MASTERY("Mastery")
}

/** The dictionary the rest of the screen's Dutch presentation comes from. */
@Composable
private fun localized(value: String): String = androidLocalizedPresentation(value)

@Composable
private fun numberLanguage(): Mk8dxNumberLanguage =
    if (LocalAndroidProductLanguage.current == AndroidProductLanguage.DUTCH) {
        Mk8dxNumberLanguage.NL
    } else {
        Mk8dxNumberLanguage.EN
    }

@Composable
internal fun AndroidRankScreen(
    client: AndroidTimeTrialsEcosystemDataSource?,
    signedInPlayerId: String?,
    onSignIn: () -> Unit,
    onOpenTrack: (String) -> Unit,
    /** A Player whose own page an address asked for, consumed once. */
    requestedPlayerId: String? = null,
    /**
     * The view a shared Ranking address asked for: whose record, who it is
     * compared against, and how the 96-track table under it stands.
     */
    request: AndroidRankingRequest? = null,
    onPlayerHandled: () -> Unit = {},
    /** A track from the tournament record opens its own TrueSkill page. */
    onOpenTrackSkill: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val viewStateStore = remember(context, signedInPlayerId) {
        AndroidRankViewStateStore(context, signedInPlayerId ?: "anonymous")
    }
    val restoredView = remember(viewStateStore) { viewStateStore.read() }
    var mode by remember { mutableIntStateOf(request?.mode ?: restoredView.mode) }
    // EngineContext (R7): the engine a link asked for outranks the account
    // preference, exactly as `?ranking=timetrials&mode=` does on the web.
    var explicitMode by remember { mutableStateOf(request?.mode) }
    LaunchedEffect(request) {
        request?.mode?.let {
            explicitMode = it
            mode = it
        }
    }
    // A Home journey tile opens Rank on the scope it was about, so the tile
    // and the destination agree the way the web link does.
    var trackScope by remember {
        mutableStateOf(
            AndroidTimeTrialTrackScope.entries.firstOrNull { it.apiValue == restoredView.scope }
                ?: AndroidTimeTrialTrackScope.ALL,
        )
    }
    var defaultTrackScope by remember { mutableStateOf(AndroidTimeTrialTrackScope.ALL) }
    var includeGlobal by remember { mutableStateOf(restoredView.includeGlobal) }
    var includeRivals by remember { mutableStateOf(restoredView.includeRivals) }
    var tab by remember { mutableStateOf(AndroidRankTab.entries.firstOrNull { it.name == restoredView.tab } ?: AndroidRankTab.TOTAL) }
    // A Home tile can open Ranking already narrowed to the tracks it counted.
    var trackFocus by remember { mutableStateOf(AndroidRankTrackFocus.parse(restoredView.trackFocus)) }
    var refresh by remember { mutableIntStateOf(0) }
    val language = LocalAndroidProductLanguage.current
    var section by remember {
        mutableStateOf(
            AndroidRankSection.entries.firstOrNull { it.name == restoredView.section }
                ?: AndroidRankSection.TIME_TRIALS,
        )
    }
    var tournamentEntries by remember(client) {
        mutableStateOf(emptyList<AndroidTournamentStandingEntry>())
    }
    var tournamentOpponents by remember(client) {
        mutableStateOf(emptyList<AndroidTournamentRivalry>())
    }
    var tournamentSelection by remember(client) { mutableStateOf(emptyList<String>()) }
    var tournamentLoading by remember(client) { mutableStateOf(false) }
    var tournamentError by remember(client) { mutableStateOf<String?>(null) }
    var tournamentTracks by remember(client) {
        mutableStateOf<AndroidTournamentTrackRecord?>(null)
    }
    var tournamentTracksLoading by remember(client) { mutableStateOf(false) }
    var tournamentTracksError by remember(client) { mutableStateOf(false) }
    // Whose tournament record the cards are about. Null is you; a value is
    // somebody you went to look at. Kept per screen rather than persisted:
    // coming back to Ranking should show your own record again.
    var tournamentFocusId by remember(client, signedInPlayerId) {
        mutableStateOf<String?>(null)
    }
    var tournamentTrackCache by remember(client) {
        mutableStateOf<Map<String, AndroidTournamentTrackRecord>>(emptyMap())
    }
    /** Set once somebody picks their own comparison; the default stops moving. */
    var tournamentSelectionChosen by remember(client) { mutableStateOf(false) }
    // The comparison's records over the races every compared Player finished,
    // and for whom; a comparison of careers set nights side by side that the
    // main Player never raced (owner, 2026-09-17).
    var tournamentShared by remember(client) {
        mutableStateOf<Pair<List<String>, AndroidTournamentSharedRaces?>?>(null)
    }
    var tournamentSharedCache by remember(client) {
        mutableStateOf<Map<List<String>, AndroidTournamentSharedRaces>>(emptyMap())
    }
    /** The Player whose own page is open, if a name was followed to it. */
    var openPlayerId by remember(client) { mutableStateOf<String?>(null) }
    // `/?player=player.x` is that Player's page, and the phone has one now.
    LaunchedEffect(requestedPlayerId) {
        val asked = requestedPlayerId ?: return@LaunchedEffect
        // The page is drawn in the Tournament section; a remembered Time
        // Trials section would otherwise swallow the request silently.
        section = AndroidRankSection.TOURNAMENT
        openPlayerId = asked
        onPlayerHandled()
    }
    // `?ranking=tournament&player=evan&compare=moss-hm,clementine` is the
    // standing seen for Evan beside those two. The names are usernames, and
    // they can only be resolved once the standing itself is here - so this
    // waits for it rather than dropping the link on the floor.
    var rankingRequest by remember(client) { mutableStateOf(request) }
    LaunchedEffect(request) { if (request != null) rankingRequest = request }
    LaunchedEffect(rankingRequest, tournamentEntries) {
        val asked = rankingRequest ?: return@LaunchedEffect
        if (asked.tournament) section = AndroidRankSection.TOURNAMENT
        if (tournamentEntries.isEmpty()) return@LaunchedEffect
        asked.player?.let { reference ->
            androidResolvePlayerReference(reference, tournamentEntries)?.let {
                tournamentFocusId = it
            }
        }
        val compared = asked.compare
            .mapNotNull { androidResolvePlayerReference(it, tournamentEntries) }
        if (compared.isNotEmpty()) {
            tournamentSelection = compared.take(3)
            tournamentSelectionChosen = true
        }
        // The table's own view stays on the request; it is handed to the
        // section below, which consumes it once.
        rankingRequest = asked.copy(player = null, compare = emptyList())
        onPlayerHandled()
    }
    var data by remember(client, refresh) { mutableStateOf<AndroidHomeBootstrap?>(null) }
    var error by remember(client, refresh) { mutableStateOf<String?>(null) }
    var selectedPlayerIds by remember(signedInPlayerId) {
        mutableStateOf(restoredView.selectedPlayerIds.ifEmpty { listOf(signedInPlayerId ?: ANDROID_NINTENDO_STAFF_REFERENCE_ID) })
    }
    var groups by remember { mutableStateOf(emptyList<AndroidSocialGroup>()) }
    var selectedGroupIds by remember { mutableStateOf(emptySet<String>()) }
    var playerQuery by remember { mutableStateOf(restoredView.playerQuery) }
    var trackQuery by remember { mutableStateOf(restoredView.trackQuery) }
    var trackSortPlayerId by remember { mutableStateOf(restoredView.trackSortPlayerId) }
    var trackSortDescending by remember { mutableStateOf(restoredView.trackSortDescending) }
    var directoryPlayers by remember { mutableStateOf(emptyList<AndroidDirectoryPlayer>()) }
    var knownPlayerNames by remember { mutableStateOf(emptyMap<String, String>()) }
    var extraPlayers by remember { mutableStateOf(emptyList<AndroidRankPlayerSummary>()) }
    var rankStandings by remember { mutableStateOf(emptyList<AndroidRankStanding>()) }
    var worldRecords by remember { mutableStateOf(emptyList<AndroidWorldRecord>()) }
    var scopeReady by remember { mutableStateOf(false) }
    /** The filter sheet: the controls the summary line stands for (W10). */
    var filtersOpen by remember { mutableStateOf(false) }
    LaunchedEffect(client, refresh) {
        if (client != null) {
            worldRecords = withContext(Dispatchers.IO) {
                runCatching { client.worldRecords() }.getOrDefault(emptyList())
            }
            worldRecords.takeIf { it.isNotEmpty() }?.let(AndroidMasteryThresholds::applyWorldRecords)
        }
        if (client != null && signedInPlayerId != null) {
            withContext(Dispatchers.IO) {
                runCatching {
                    Triple(
                        client.home(),
                        runCatching { client.socialGroups() }.getOrNull(),
                        runCatching { client.timeTrialPreferences() }.getOrNull(),
                    )
                }
            }.fold(
                onSuccess = { loaded ->
                    loaded.second?.let { (loadedGroups, preference) ->
                        groups = loadedGroups
                        selectedGroupIds = preference.groupIds.toSet()
                        includeGlobal = preference.global
                        includeRivals = preference.rivals
                        scopeReady = true
                    }
                    if (loaded.third?.trackAccess == "base_only") {
                        trackScope = AndroidTimeTrialTrackScope.BASE
                        defaultTrackScope = AndroidTimeTrialTrackScope.BASE
                    }
                    mode = androidRankEngineMode(explicitMode, mode, loaded.first.focus?.modePreference)
                    data = loaded.first; error = null
                },
                onFailure = { error = it.message ?: "Ranking is temporarily unavailable." },
            )
        }
    }
    LaunchedEffect(client, scopeReady, includeGlobal, includeRivals, selectedGroupIds) {
        if (client != null && scopeReady && (includeGlobal || includeRivals || selectedGroupIds.isNotEmpty())) {
            val preference = AndroidRankScopePreference(
                global = includeGlobal,
                rivals = includeRivals,
                groupIds = selectedGroupIds.sorted(),
            )
            withContext(Dispatchers.IO) { runCatching { client.saveRankScope(preference) } }
        }
    }
    LaunchedEffect(client, playerQuery) {
        val query = playerQuery.trim()
        directoryPlayers = if (client == null || query.length < 2) emptyList() else withContext(Dispatchers.IO) {
            runCatching { client.findPlayers(query) }.getOrDefault(emptyList())
        }
    }
    LaunchedEffect(client, mode, trackScope) {
        rankStandings = if (client == null) emptyList() else withContext(Dispatchers.IO) { runCatching { client.rankStandings(mode, trackScope.apiValue) }.getOrDefault(emptyList()) }
    }
    val groupMemberNames = groups.filter { it.groupId in selectedGroupIds && it.myStatus == "active" }
        .flatMap(AndroidSocialGroup::members).filter { it.status == "active" }.associate { it.playerId to it.displayName }
    val requestedExtraIds = (selectedPlayerIds + groupMemberNames.keys).distinct()
    LaunchedEffect(client, mode, trackScope, requestedExtraIds, worldRecords) {
        if (client != null) extraPlayers = withContext(Dispatchers.IO) {
            requestedExtraIds.mapNotNull { playerId ->
                if (playerId in ANDROID_RANK_REFERENCE_NAMES) {
                    return@mapNotNull buildAndroidRankReference(playerId, mode, worldRecords, trackScope)
                }
                val name = knownPlayerNames[playerId] ?: groupMemberNames[playerId] ?: return@mapNotNull null
                runCatching { buildAndroidRankPlayer(playerId, name, mode, client.playerResults(playerId), trackScope) }.getOrNull()
            }
        }
    }
    LaunchedEffect(data?.comeback?.player?.playerId, includeRivals) {
        val comeback = data?.comeback ?: return@LaunchedEffect
        if (restoredView.selectedPlayerIds.isEmpty() || (includeRivals && selectedPlayerIds == listOf(comeback.player.playerId))) {
            selectedPlayerIds = (listOf(comeback.player.playerId) +
                if (includeRivals) comeback.rivals.map(AndroidRivalComparison::playerId) else emptyList())
                .distinct().take(ANDROID_RANK_COMPARE_LIMIT)
        }
    }
    // Whom you follow, from the rivals endpoint the site reads for exactly
    // this. The phone had been taking the Time Trial comeback card's rivals
    // instead, which is a narrower list built for a different question - so a
    // signed-in reader's own comparison opened with whoever happened to be on
    // that card, or with nobody.
    var tournamentRivalIds by remember(client, signedInPlayerId) {
        mutableStateOf(emptySet<String>())
    }
    LaunchedEffect(client, signedInPlayerId) {
        val active = client
        if (active == null || signedInPlayerId == null) {
            tournamentRivalIds = emptySet()
            return@LaunchedEffect
        }
        tournamentRivalIds = withContext(Dispatchers.IO) {
            runCatching { active.rivals().map(AndroidRival::playerId).toSet() }
                .getOrDefault(emptySet())
        }
    }
    LaunchedEffect(client, section, refresh) {
        if (section != AndroidRankSection.TOURNAMENT || client == null) return@LaunchedEffect
        if (tournamentEntries.isNotEmpty()) return@LaunchedEffect
        tournamentLoading = true
        tournamentError = null
        val loaded = withContext(Dispatchers.IO) {
            runCatching { client.tournamentStanding() }.getOrNull()
        }
        if (loaded == null) {
            tournamentError = "The Tournament standing is temporarily unavailable."
        } else {
            tournamentEntries = loaded
            tournamentSelection = androidTournamentDefaultSelection(
                loaded, signedInPlayerId, tournamentRivalIds,
            )
        }
        tournamentLoading = false
    }
    // The standing and the Player's own rivals are two requests, and the
    // standing usually wins. The site waits for both before it chooses whom to
    // compare (one `Promise.all`); the phone had been choosing on whatever had
    // arrived, so a signed-in reader opened on their own column alone and the
    // rivals never joined it. Recompute once they land, unless the reader has
    // already picked for themselves.
    LaunchedEffect(tournamentEntries, tournamentRivalIds, signedInPlayerId) {
        if (tournamentSelectionChosen || tournamentEntries.isEmpty()) return@LaunchedEffect
        if (tournamentRivalIds.isEmpty()) return@LaunchedEffect
        if (tournamentFocusId != null && tournamentFocusId != signedInPlayerId) return@LaunchedEffect
        tournamentSelection = androidTournamentDefaultSelection(
            tournamentEntries, signedInPlayerId, tournamentRivalIds,
        )
    }
    // Yours if we know who you are, otherwise the Player at the top: a
    // signed-out visitor should still see what the section is for. Choosing
    // somebody else re-runs exactly this, which is why it is its own effect.
    val tournamentSubject = androidTournamentFocus(
        tournamentEntries, tournamentFocusId, signedInPlayerId,
    )
    LaunchedEffect(client, tournamentSubject?.playerId) {
        val client_ = client ?: return@LaunchedEffect
        val subject = tournamentSubject?.playerId ?: return@LaunchedEffect
        tournamentOpponents = withContext(Dispatchers.IO) {
            runCatching { client_.tournamentRivalries(subject) }.getOrDefault(emptyList())
        }
        // A page opened for somebody else compares them with the people they
        // actually race, not with the rivals the reader happens to follow.
        if (!tournamentSelectionChosen && subject != signedInPlayerId) {
            androidTournamentFocusSelection(tournamentEntries, subject, tournamentOpponents)
                .takeIf { it.isNotEmpty() }
                ?.let { tournamentSelection = it }
        }
        val cached = tournamentTrackCache[subject]
        if (cached != null) {
            tournamentTracks = cached
            tournamentTracksError = false
            return@LaunchedEffect
        }
        tournamentTracksLoading = true
        val record = withContext(Dispatchers.IO) {
            runCatching { client_.tournamentTrackRecord(subject) }.getOrNull()
        }
        if (record != null) tournamentTrackCache = tournamentTrackCache + (subject to record)
        tournamentTracks = record
        tournamentTracksError = record == null
        tournamentTracksLoading = false
    }
    val tournamentCompared = androidTournamentAnchoredSelection(
        tournamentSelection.filter { id -> tournamentEntries.any { it.playerId == id } },
        tournamentSubject?.playerId,
    )
    val tournamentComparisonKey = androidTournamentComparisonKey(tournamentEntries, tournamentCompared)
    LaunchedEffect(client, tournamentComparisonKey) {
        val client_ = client ?: return@LaunchedEffect
        val key = tournamentComparisonKey
        if (key.isEmpty()) {
            tournamentShared = null
            return@LaunchedEffect
        }
        tournamentSharedCache[key]?.let {
            tournamentShared = key to it
            return@LaunchedEffect
        }
        tournamentShared = null
        val loaded = withContext(Dispatchers.IO) {
            runCatching { client_.tournamentSharedRaces(key) }.getOrNull()
        }
        if (loaded != null) tournamentSharedCache = tournamentSharedCache + (key to loaded)
        tournamentShared = key to loaded
    }
    val pageScroll = rememberScrollState(restoredView.scrollPosition)
    LaunchedEffect(mode, tab, section, trackScope, selectedPlayerIds, playerQuery, trackQuery, trackSortPlayerId, trackSortDescending, pageScroll.value, includeGlobal, includeRivals) {
        viewStateStore.write(AndroidRankViewState(
            mode = mode,
            scope = trackScope.apiValue,
            tab = tab.name,
            section = section.name,
            trackFocus = trackFocus?.apiValue,
            selectedPlayerIds = selectedPlayerIds,
            playerQuery = playerQuery,
            trackQuery = trackQuery,
            trackSortPlayerId = trackSortPlayerId,
            trackSortDescending = trackSortDescending,
            scrollPosition = pageScroll.value,
            includeGlobal = includeGlobal,
            includeRivals = includeRivals,
        ))
    }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Column(
        modifier.fillMaxSize().background(colors.surfaceApp).verticalScroll(pageScroll)
            .padding(Mk8dxSpacing.lg).testTag("rank-screen"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Text(
            "RANK",
            color = colors.textSecondary,
            style = type.micro.copy(fontWeight = FontWeight.Bold),
        )
        Mk8dxDisplayText(
            if (section == AndroidRankSection.TOURNAMENT) {
                androidText(language, "Tournament skill & competitors", "Toernooiniveau & concurrenten")
            } else {
                localized("Time Trial standing & Mastery")
            },
            style = type.display6,
        )
        Text(
            if (section == AndroidRankSection.TOURNAMENT) {
                androidText(
                    language,
                    "TrueSkill, race record and head-to-head across finalized tournaments.",
                    "TrueSkill, racebalans en onderlinge duels over afgeronde toernooien.",
                )
            } else {
                localized("Public Base 48, BCP 48 and All 96 standings with direct comparisons.")
            },
            color = colors.textSecondary,
            style = type.bodyS,
        )
        Mk8dxTabs(
            label = androidText(language, "Ranking section", "Onderdeel"),
            options = AndroidRankSection.entries.map { candidate ->
                Mk8dxTabOption(
                    candidate,
                    androidText(language, candidate.english, candidate.dutch),
                    "rank-section-${candidate.name.lowercase()}",
                )
            },
            value = section,
            onChange = { section = it },
        )
        val opened = openPlayerId
        if (section == AndroidRankSection.TOURNAMENT && opened != null) {
            AndroidPlayerPage(
                client = client,
                playerId = opened,
                standing = tournamentEntries,
                language = language,
                onBack = { openPlayerId = null },
                onOpenPlayer = { openPlayerId = it },
                viewerPlayerId = signedInPlayerId,
            )
            return@Column
        }
        if (section == AndroidRankSection.TOURNAMENT) {
            AndroidTournamentStandingSection(
                entries = tournamentEntries,
                opponents = tournamentOpponents,
                selectedPlayerIds = tournamentCompared,
                sharedRaces = tournamentShared?.second,
                sharedFor = tournamentShared?.first.orEmpty(),
                sharedFailed = tournamentShared != null && tournamentShared?.second == null,
                viewerPlayerId = signedInPlayerId,
                focusPlayerId = tournamentSubject?.playerId,
                rivalPlayerIds = tournamentRivalIds,
                language = language,
                loading = tournamentLoading,
                error = tournamentError,
                onTogglePlayer = {
                    tournamentSelectionChosen = true
                    tournamentSelection = androidTournamentToggleSelection(
                        tournamentCompared, it, tournamentSubject?.playerId,
                    )
                },
                onFocusPlayer = { tournamentFocusId = it },
                onOpenPlayer = { openPlayerId = it },
                afterOwnCard = {
                    val focusName = tournamentSubject?.displayName
                    if (focusName != null) {
                        AndroidTournamentTrackSection(
                            record = tournamentTracks,
                            playerName = focusName,
                            language = language,
                            loading = tournamentTracksLoading,
                            error = tournamentTracksError,
                            request = rankingRequest,
                            onOpenTrack = onOpenTrackSkill,
                        )
                    }
                },
            )
            return@Column
        }
        if (client == null) {
            Text(localized("Ranking is temporarily unavailable."), color = colors.textBody, style = type.body)
            return@Column
        }
        if (signedInPlayerId == null) {
            Mk8dxPanel(localized("PUBLIC RANK")) {
                Text(
                    localized("Browse and compare without signing in. Nintendo Ghost is selected as the default reference."),
                    color = colors.textBody,
                    style = type.body,
                )
                Mk8dxButton(
                    localized("Sign in for rivals & Groups"),
                    onSignIn,
                    variant = Mk8dxButtonVariant.Secondary,
                    size = Mk8dxButtonSize.Sm,
                )
            }
        }
        error?.let {
            Mk8dxPanel(null) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(localized(it), modifier = Modifier.weight(1f), color = colors.statusError, style = type.body)
                    Mk8dxButton(
                        localized("Retry"), { refresh += 1 },
                        variant = Mk8dxButtonVariant.Secondary, size = Mk8dxButtonSize.Sm,
                        modifier = Modifier.testTag("rank-retry"),
                    )
                }
            }
        }
        val home = data
        if (signedInPlayerId != null && home == null && error == null) {
            Text(
                localized("Loading your standings…"),
                modifier = Modifier.testTag("rank-loading"),
                color = colors.textSecondary, style = type.body,
            )
            return@Column
        }
        val comeback = home?.comeback
        val modePreference = home?.focus?.modePreference ?: "all"
        // A link that asked for the other engine shows both, as on the web.
        val engineChoice = modePreference == "all" || explicitMode != null
        val players = (home?.let { buildAndroidRankPlayers(it, mode, trackScope) }.orEmpty() + extraPlayers).distinctBy(AndroidRankPlayerSummary::playerId)
        val scopeSummary = buildList {
            if (includeGlobal) add(localized("Global"))
            if (includeRivals) add(localized("Among rivals"))
            if (selectedGroupIds.isNotEmpty()) add(localized("Groups") + " (${selectedGroupIds.size})")
        }.joinToString(" + ").ifEmpty { localized("Global") }
        val trackScopeLabel = androidRankTrackScopeLabel(trackScope)
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // The engine is data, not a filter, so it stays on the screen: the
            // engine Ranking is showing is always visible (R8), and switching it
            // replaces every value below.
            if (engineChoice) {
                Mk8dxEngineSelector(
                    label = androidText(language, "Engine class", "Klasse"),
                    value = mode,
                    onChange = { candidate ->
                        mode = candidate
                        if (explicitMode != null) explicitMode = candidate
                    },
                    modifier = Modifier.testTag("rank-engine-selector"),
                )
            } else {
                Mk8dxEngineMark(mode, Modifier.testTag("rank-engine-mark"), Mk8dxEngineMarkSize.Lg)
            }
        }
        Mk8dxFilterSummary(
            facets = listOf(
                androidText(language, "Community", "Community") to scopeSummary,
                androidText(language, "Tracks", "Circuits") to trackScopeLabel,
                androidText(language, "Chosen", "Gekozen") to androidText(language, "${selectedPlayerIds.size} of 3", "${selectedPlayerIds.size} van 3"),
            ),
            actionLabel = androidText(language, "Filters", "Filters"),
            onOpen = { filtersOpen = true },
            modifier = Modifier.testTag("rank-filter-summary"),
        )
        // Who you are looking at is settled in the sheet; View is what you are
        // looking at, so it belongs directly above the table it changes.
        Mk8dxTabs(
            label = androidText(language, "View", "Weergave"),
            options = AndroidRankTab.entries.map { candidate ->
                Mk8dxTabOption(
                    candidate,
                    if (candidate == AndroidRankTab.TRACKS) {
                        localized("Delta per track")
                    } else {
                        localized(candidate.label)
                    },
                    "rank-tab-${candidate.name.lowercase()}",
                )
            },
            value = tab,
            // Choosing a view by hand leaves the Home tile's narrowing
            // behind, the way following a new link does on the web.
            onChange = { tab = it; trackFocus = null },
        )
        if (filtersOpen) {
            Mk8dxFilterSheet(
                title = androidText(language, "Ranking filters", "Ranglijstfilters"),
                closeLabel = androidText(language, "Done", "Klaar"),
                onDismiss = { filtersOpen = false },
            ) {
                RankFilterControls(
                    signedInPlayerId = signedInPlayerId,
                    includeGlobal = includeGlobal,
                    onIncludeGlobal = {
                        if (!includeGlobal || includeRivals || selectedGroupIds.isNotEmpty()) includeGlobal = !includeGlobal
                    },
                    includeRivals = includeRivals,
                    onIncludeRivals = {
                        if (!includeRivals || includeGlobal || selectedGroupIds.isNotEmpty()) {
                            includeRivals = !includeRivals
                            if (includeRivals) {
                                val viewer = data?.comeback?.player?.playerId ?: signedInPlayerId
                                selectedPlayerIds = (listOf(viewer) + data?.comeback?.rivals.orEmpty().map(AndroidRivalComparison::playerId))
                                    .filterNotNull().distinct().take(ANDROID_RANK_COMPARE_LIMIT)
                            }
                        }
                    },
                    groups = groups,
                    selectedGroupIds = selectedGroupIds,
                    onClearGroups = {
                        if (selectedGroupIds.isNotEmpty() && (includeGlobal || includeRivals)) selectedGroupIds = emptySet()
                    },
                    onToggleGroup = { group ->
                        selectedGroupIds = if (group.groupId in selectedGroupIds) {
                            if (includeGlobal || includeRivals || selectedGroupIds.size > 1) selectedGroupIds - group.groupId else selectedGroupIds
                        } else selectedGroupIds + group.groupId
                    },
                    trackScope = trackScope,
                    onTrackScope = { trackScope = it },
                    selectedPlayerIds = selectedPlayerIds,
                    onToggleReference = { selectedPlayerIds = updateAndroidRankSelection(selectedPlayerIds, it, signedInPlayerId) },
                    playerQuery = playerQuery,
                    onPlayerQuery = { playerQuery = it },
                    directoryPlayers = directoryPlayers,
                    onCompareDirectoryPlayer = { player ->
                        knownPlayerNames = knownPlayerNames + (player.playerId to player.displayName)
                        selectedPlayerIds = updateAndroidRankSelection(selectedPlayerIds, player.playerId, signedInPlayerId)
                        playerQuery = ""
                    },
                    rivalPlayers = players.filter {
                        it.playerId == comeback?.player?.playerId ||
                            comeback?.rivals.orEmpty().any { rival -> rival.playerId == it.playerId }
                    },
                    ownPlayerId = comeback?.player?.playerId,
                    onReset = {
                        explicitMode = null
                        mode = EngineContext.resolve(preference = modePreference).mode
                        trackScope = defaultTrackScope
                        tab = AndroidRankTab.TOTAL; includeGlobal = true; includeRivals = false
                        selectedGroupIds = emptySet(); selectedPlayerIds = listOf(signedInPlayerId ?: ANDROID_NINTENDO_STAFF_REFERENCE_ID)
                        playerQuery = ""; trackQuery = ""; trackSortPlayerId = null; trackSortDescending = true
                        viewStateStore.clear()
                    },
                )
            }
        }
        val own = players.firstOrNull { it.playerId == comeback?.player?.playerId }
        if (includeGlobal && tab == AndroidRankTab.MEDALS) {
            GlobalMedalStanding(rankStandings)
        } else if (includeGlobal && tab == AndroidRankTab.TOTAL) {
            GlobalRankContent(
                comeback = comeback,
                home = home,
                own = own,
                mode = mode,
                trackScope = trackScope,
                tab = tab,
                standings = rankStandings,
                trackFocus = trackFocus,
                onClearTrackFocus = { trackFocus = null },
                onOpenTrack = onOpenTrack,
            )
            players.filter { it.playerId in selectedPlayerIds }.take(ANDROID_RANK_COMPARE_LIMIT)
                .takeIf { it.isNotEmpty() }?.let { MedalAndTotalTables(it, showMedals = false, showTotals = true) }
        } else {
            val unionIds = androidRankUnionPlayerIds(
                viewerPlayerId = comeback?.player?.playerId,
                includeRivals = includeRivals,
                rivalPlayerIds = comeback?.rivals.orEmpty().map(AndroidRivalComparison::playerId),
                groupPlayerIds = groupMemberNames.keys,
                comparedPlayerIds = selectedPlayerIds,
            )
            val scopedPlayers = if (includeGlobal) players else players.filter { it.playerId in unionIds }
            RivalsRankContent(
                ownPlayerId = comeback?.player?.playerId,
                players = scopedPlayers,
                selectedPlayerIds = selectedPlayerIds,
                onOpenTrack = onOpenTrack,
                tab = tab,
                trackQuery = trackQuery,
                onTrackQueryChange = { trackQuery = it },
                trackSortPlayerId = trackSortPlayerId,
                onTrackSortPlayerChange = { trackSortPlayerId = it },
                trackSortDescending = trackSortDescending,
                onTrackSortDescendingChange = { trackSortDescending = it },
                focusRows = home?.focus?.rows.orEmpty(),
                trackFocus = trackFocus,
                onClearTrackFocus = { trackFocus = null },
            )
        }
    }
}

/** "Base 48" / "BCP 48" / "All 96" — the scope's own name, unchanged. */
private fun androidRankTrackScopeLabel(scope: AndroidTimeTrialTrackScope): String = when (scope) {
    AndroidTimeTrialTrackScope.BASE -> "Base 48"
    AndroidTimeTrialTrackScope.BCP -> "BCP 48"
    AndroidTimeTrialTrackScope.ALL -> "All 96"
}

/**
 * Every control the four stacked panels used to hold, gathered into the sheet
 * the summary line opens. Same controls, same rules, same test tags (W10).
 */
@Composable
private fun ColumnScope.RankFilterControls(
    signedInPlayerId: String?,
    includeGlobal: Boolean,
    onIncludeGlobal: () -> Unit,
    includeRivals: Boolean,
    onIncludeRivals: () -> Unit,
    groups: List<AndroidSocialGroup>,
    selectedGroupIds: Set<String>,
    onClearGroups: () -> Unit,
    onToggleGroup: (AndroidSocialGroup) -> Unit,
    trackScope: AndroidTimeTrialTrackScope,
    onTrackScope: (AndroidTimeTrialTrackScope) -> Unit,
    selectedPlayerIds: List<String>,
    onToggleReference: (String) -> Unit,
    playerQuery: String,
    onPlayerQuery: (String) -> Unit,
    directoryPlayers: List<AndroidDirectoryPlayer>,
    onCompareDirectoryPlayer: (AndroidDirectoryPlayer) -> Unit,
    rivalPlayers: List<AndroidRankPlayerSummary>,
    ownPlayerId: String?,
    onReset: () -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Mk8dxSectionLabel(androidText(language, "COMMUNITY", "COMMUNITY"))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
        Mk8dxToggleChip(
            localized("Global"), includeGlobal, onIncludeGlobal,
            Modifier.weight(1f).testTag("rank-scope-global"),
        )
        if (signedInPlayerId != null) {
            Mk8dxToggleChip(
                localized("Among rivals"), includeRivals, onIncludeRivals,
                Modifier.weight(1f).testTag("rank-scope-rivals"),
            )
            Mk8dxToggleChip(
                localized("Groups") + " (${selectedGroupIds.size})",
                selectedGroupIds.isNotEmpty(), onClearGroups,
                Modifier.weight(1f).testTag("rank-scope-groups"),
            )
        }
    }
    if (signedInPlayerId != null && groups.none { it.myStatus == "active" }) {
        Text(
            localized("No accepted private Groups yet. Manage invitations in Settings."),
            color = colors.textSecondary, style = type.bodyS,
        )
    }
    if (signedInPlayerId != null) {
        groups.filter { it.myStatus == "active" }.forEach { group ->
            Mk8dxToggleChip(
                group.name, group.groupId in selectedGroupIds, { onToggleGroup(group) },
                Modifier.fillMaxWidth(),
            )
        }
    }
    Mk8dxSectionLabel(androidText(language, "TRACKS", "CIRCUITS"))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
        AndroidTimeTrialTrackScope.entries.forEach { candidate ->
            Mk8dxToggleChip(
                androidRankTrackScopeLabel(candidate),
                trackScope == candidate,
                { onTrackScope(candidate) },
                Modifier.weight(1f).testTag("rank-track-scope-${candidate.apiValue}"),
            )
        }
    }
    Mk8dxSectionLabel(androidText(language, "REFERENCE PLAYERS", "REFERENTIESPELERS"))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
        ANDROID_RANK_REFERENCE_NAMES.forEach { (playerId, displayName) ->
            Mk8dxToggleChip(
                displayName, playerId in selectedPlayerIds, { onToggleReference(playerId) },
                Modifier.weight(1f).testTag("rank-reference-${playerId.substringAfterLast('.')}"),
            )
        }
    }
    Mk8dxSearchField(
        localized("Search player name"), playerQuery, onPlayerQuery,
        Modifier.testTag("rank-player-search"),
    )
    directoryPlayers.filter { it.playerId !in selectedPlayerIds }.take(8).forEach { player ->
        Mk8dxButton(
            localized("Compare") + " ${player.displayName}",
            { onCompareDirectoryPlayer(player) },
            variant = Mk8dxButtonVariant.Secondary,
            size = Mk8dxButtonSize.Sm,
            modifier = Modifier.fillMaxWidth(),
        )
    }
    if (signedInPlayerId != null && includeRivals && rivalPlayers.isNotEmpty()) {
        Mk8dxSectionLabel(androidText(language, "RIVAL FILTERS", "RIVALENFILTERS"))
        Text(
            localized("All rivals are in scope. Select up to $ANDROID_RANK_COMPARE_LIMIT columns for direct comparison."),
            color = colors.textSecondary, style = type.bodyS,
        )
        rivalPlayers.forEach { player ->
            Mk8dxToggleChip(
                player.displayName + if (player.playerId == ownPlayerId) " · " + localized("You") else "",
                player.playerId in selectedPlayerIds,
                { onToggleReference(player.playerId) },
                Modifier.fillMaxWidth().testTag("rank-rival-filter-${player.playerId}"),
            )
        }
    }
    Mk8dxButton(
        localized("Reset filters"), onReset,
        variant = Mk8dxButtonVariant.Secondary,
        modifier = Modifier.fillMaxWidth().testTag("rank-reset-filters"),
    )
}

@Composable
private fun GlobalRankContent(
    comeback: AndroidHomeComeback?,
    home: AndroidHomeBootstrap?,
    own: AndroidRankPlayerSummary?,
    mode: Int,
    trackScope: AndroidTimeTrialTrackScope,
    tab: AndroidRankTab,
    standings: List<AndroidRankStanding>,
    trackFocus: AndroidRankTrackFocus?,
    onClearTrackFocus: () -> Unit,
    onOpenTrack: (String) -> Unit,
) {
    var playerFilter by remember { mutableStateOf("") }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val numbers = numberLanguage()
    val trackCount = trackScope.trackCount
    val ownStanding = standings.firstOrNull { it.playerId == comeback?.player?.playerId }
    if (tab == AndroidRankTab.TOTAL) Mk8dxPanel(localized("GLOBAL TIME TRIAL STANDING")) {
        if (mode == 150 && trackScope == AndroidTimeTrialTrackScope.ALL) {
            // The bootstrap's headline standing is the 150cc all-96 one, so it
            // is labelled as exactly that and never stands unlabelled beside
            // another engine (R5).
            val standing = comeback?.timeTrials?.standing ?: 0
            if (standing > 0) {
                Mk8dxHeroRank(standing, numbers, localized("Global standing"))
            } else {
                Mk8dxDisplayText(localized("PUBLIC"), type.display5)
            }
            Text(
                comeback?.let {
                    localized("of") + " ${Mk8dxNumeric.formatCount(it.timeTrials.of.toLong(), numbers)} " +
                        localized("Players · total across 96 tracks")
                } ?: localized("Community ranking · no login required"),
                color = colors.textSecondary, style = type.bodyS,
            )
            Mk8dxEngineMark(150)
            comeback?.timeTrials?.previousStanding?.let { previous ->
                val movement = previous - comeback.timeTrials.standing
                Text(
                    when {
                        movement > 0 -> "↑ $movement " + localized("since last visit")
                        movement < 0 -> "↓ ${-movement} " + localized("since last visit")
                        else -> localized("No standing change")
                    },
                    color = if (movement >= 0) colors.statusSuccess else colors.statusError,
                    style = type.bodyS,
                )
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                Mk8dxEngineMark(mode)
                if (ownStanding != null) {
                    Mk8dxHeroRank(ownStanding.rank, numbers, localized("Global standing"))
                } else {
                    Mk8dxDisplayText(localized("Mastery"), type.display5)
                }
            }
            Text(
                localized("The global standing uses your total across") +
                    " $trackCount " + localized("tracks") + " (${trackScope.apiValue.uppercase()}).",
                color = colors.textSecondary, style = type.bodyS,
            )
        }
        Mk8dxPodiumStrip(
            standings.take(3).map {
                Mk8dxPodiumEntry(
                    it.rank, it.playerDisplayName, formatAndroidRankTotal(it.totalTimeMs),
                    you = it.playerId == comeback?.player?.playerId,
                )
            },
            numbers,
        )
        Mk8dxSearchField(localized("Filter player name"), playerFilter, { playerFilter = it })
        val rows = standings.filter { it.playerDisplayName.contains(playerFilter.trim(), ignoreCase = true) }.take(100)
        Mk8dxRankingTable(
            caption = localized("GLOBAL TIME TRIAL STANDING"),
            language = numbers,
            rows = androidRankStandingRows(rows, comeback?.player?.playerId, localized("You")),
            modifier = Modifier.testTag("rank-global-standing-table"),
        )
    }
    if (tab == AndroidRankTab.MASTERY) own?.let { MasterySummary(it) }
    if (tab == AndroidRankTab.MASTERY) own?.let {
        MasteryDistributionTable(listOf(it))
    }
    if (tab == AndroidRankTab.MEDALS) own?.let { MedalAndTotalTables(listOf(it), showMedals = true, showTotals = false) }
    if (tab == AndroidRankTab.TRACKS && home != null) own?.let {
        GlobalTrackBests(home, it, mode, trackFocus, onClearTrackFocus, onOpenTrack)
    }
    if (own == null && tab == AndroidRankTab.TRACKS) Mk8dxPanel(localized("PER-TRACK BESTS")) {
        Text(
            localized("No published ${mode}cc times yet — every track is still open."),
            color = colors.textSecondary, style = Mk8dxTheme.type.body,
        )
    }
}

@Composable
private fun MasterySummary(player: AndroidRankPlayerSummary) {
    val label = AndroidMasteryThresholds.tierLabels[player.masteryTier]
    val trackCount = player.scope.trackCount
    val nextDelta = AndroidMasteryThresholds.nextTotalTierDeltaMs(player.mode, player.totalMs, player.scope.trackIds)
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Mk8dxPanel(localized("MASTERY")) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Mk8dxEngineMark(player.mode)
            Mk8dxTierChip(label, masteryColor(player.masteryTier))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.lg)) {
            Mk8dxStatBlock(
                localized("Total"),
                formatAndroidRankTotal(player.totalMs),
                Modifier.weight(1f),
                large = true,
            )
            Mk8dxStatBlock(
                localized("Tracks"),
                "${player.playedTracks}/$trackCount",
                Modifier.weight(1f),
                hint = localized("average") + " " + Mk8dxNumeric.formatTime(player.totalMs / trackCount),
            )
        }
        nextDelta?.let {
            Text(
                Mk8dxNumeric.formatDelta(-it) + " " + localized("to") + " " +
                    AndroidMasteryThresholds.tierLabels[player.masteryTier - 1],
                color = colors.deltaFaster,
                style = type.data,
            )
        } ?: Text(
            localized("Top of the recovered 23-level Mastery ladder."),
            color = colors.textSecondary, style = type.bodyS,
        )
        if (player.playedTracks < trackCount) {
            Text(
                localized("Mastery total uses 10:00.000 for each track not yet driven."),
                style = type.bodyS,
                color = colors.textTertiary,
            )
        }
        Text(localized("Current level: ") + label, color = colors.textSecondary, style = type.bodyS)
    }
}

@Composable
private fun RivalsRankContent(
    ownPlayerId: String?,
    players: List<AndroidRankPlayerSummary>,
    selectedPlayerIds: List<String>,
    onOpenTrack: (String) -> Unit,
    tab: AndroidRankTab,
    trackQuery: String,
    onTrackQueryChange: (String) -> Unit,
    trackSortPlayerId: String?,
    onTrackSortPlayerChange: (String?) -> Unit,
    trackSortDescending: Boolean,
    onTrackSortDescendingChange: (Boolean) -> Unit,
    focusRows: List<AndroidFocusRow>,
    trackFocus: AndroidRankTrackFocus?,
    onClearTrackFocus: () -> Unit,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val numbers = numberLanguage()
    val standing = players.sortedWith(compareBy(AndroidRankPlayerSummary::totalMs, AndroidRankPlayerSummary::playerId))
    if (tab == AndroidRankTab.TOTAL) Mk8dxPanel(localized("SELECTED SCOPE TIME TRIAL STANDING")) {
        if (players.size <= 1) {
            Text(localized("No rivals chosen yet."), color = colors.textPrimary, style = type.title)
            Text(
                localized("Choose rivals in Settings on the configured website; your global and Mastery views remain available."),
                color = colors.textSecondary, style = type.bodyS,
            )
        } else {
            Mk8dxRankingTable(
                caption = localized("SELECTED SCOPE TIME TRIAL STANDING"),
                language = numbers,
                rows = androidRankScopeStandingRows(players, ownPlayerId, localized("You")),
                modifier = Modifier.testTag("rank-scope-standing-table"),
            )
            standing.forEach { player ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = Mk8dxSpacing.targetMinDense)
                        .semantics(mergeDescendants = true) { },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                ) {
                    Text(
                        player.displayName,
                        modifier = Modifier.weight(1f),
                        color = colors.textSecondary, style = type.bodyS,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        "${player.playedTracks}/${player.scope.trackCount}",
                        color = colors.textSecondary, style = type.dataS, softWrap = false,
                    )
                    Mk8dxTierChip(
                        AndroidMasteryThresholds.tierLabels[player.masteryTier],
                        masteryColor(player.masteryTier),
                        dense = true,
                    )
                }
            }
        }
    }
    if (players.isEmpty()) return
    if (tab == AndroidRankTab.MEDALS) {
        MedalAndTotalTables(
            players.filterNot { it.playerId in ANDROID_RANK_REFERENCE_NAMES },
            showMedals = true,
            showTotals = false,
        )
        return
    }
    val selected = players.filter { it.playerId in selectedPlayerIds }.take(ANDROID_RANK_COMPARE_LIMIT)
    if (selected.isEmpty()) return
    when (tab) {
        AndroidRankTab.TOTAL -> MedalAndTotalTables(selected, showMedals = false, showTotals = true)
        AndroidRankTab.MEDALS -> Unit
        AndroidRankTab.MASTERY -> MasteryDistributionTable(selected)
        AndroidRankTab.TRACKS -> RivalTrackComparison(
            players = selected,
            onOpenTrack = onOpenTrack,
            trackQuery = trackQuery,
            onTrackQueryChange = onTrackQueryChange,
            sortPlayerId = trackSortPlayerId,
            onSortPlayerChange = onTrackSortPlayerChange,
            sortDescending = trackSortDescending,
            onSortDescendingChange = onTrackSortDescendingChange,
            ownPlayerId = ownPlayerId,
            focusRows = focusRows,
            trackFocus = trackFocus,
            onClearTrackFocus = onClearTrackFocus,
        )
    }
}

@Composable
private fun MedalAndTotalTables(players: List<AndroidRankPlayerSummary>, showMedals: Boolean = true, showTotals: Boolean = true) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    if (showMedals) Mk8dxPanel(localized("MEDALS")) {
        Mk8dxTableHeader(listOf(localized("Player") to 1.6f, "🏆" to .5f, "🥈" to .5f, "🥉" to .5f))
        sortAndroidRankMedals(players).forEach { player ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = Mk8dxSpacing.targetMinDense)
                    .semantics(mergeDescendants = true) { },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                Text(
                    player.displayName, modifier = Modifier.weight(1.6f),
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = colors.textBody, style = type.body,
                )
                Text(player.gold.toString(), modifier = Modifier.weight(.5f), color = colors.textPrimary, style = type.data)
                Text(player.silver.toString(), modifier = Modifier.weight(.5f), color = colors.textBody, style = type.data)
                Text(player.bronze.toString(), modifier = Modifier.weight(.5f), color = colors.textBody, style = type.data)
            }
        }
    }
    val bestTotal = players.minOf(AndroidRankPlayerSummary::totalMs)
    if (showTotals) Mk8dxPanel(localized("TOTAL TIME & DELTA")) {
        players.sortedBy(AndroidRankPlayerSummary::totalMs).forEach { player ->
            val delta = player.totalMs - bestTotal
            Row(
                Modifier.fillMaxWidth().heightIn(min = Mk8dxSpacing.targetMin)
                    .semantics(mergeDescendants = true) { },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        player.displayName, color = colors.textPrimary, style = type.title,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        "${player.playedTracks}/${player.scope.trackCount} " + localized("tracks"),
                        color = colors.textSecondary, style = type.bodyS,
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        formatAndroidRankTotal(player.totalMs),
                        color = colors.textPrimary, style = type.dataM, softWrap = false, maxLines = 1,
                    )
                    Text(
                        Mk8dxNumeric.formatDelta(delta) + " · " + localized("avg") + " " +
                            Mk8dxNumeric.formatDelta(delta / player.scope.trackCount),
                        color = if (delta > 0) colors.deltaSlower else colors.deltaFaster,
                        style = type.dataS, softWrap = false, maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun GlobalMedalStanding(standings: List<AndroidRankStanding>) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val numbers = numberLanguage()
    Mk8dxPanel(localized("GLOBAL MEDALS")) {
        Mk8dxTableHeader(listOf("#" to .45f, localized("Player") to 1.6f, "🏆" to .5f, "🥈" to .5f, "🥉" to .5f))
        sortAndroidStandingMedals(standings).forEachIndexed { index, player ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = Mk8dxSpacing.targetMinDense)
                    .semantics(mergeDescendants = true) { },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                Text(
                    Mk8dxNumeric.formatRank(index + 1, numbers),
                    modifier = Modifier.weight(.45f), color = colors.textSecondary,
                    style = type.data, softWrap = false, maxLines = 1,
                )
                Text(
                    player.playerDisplayName,
                    modifier = Modifier.weight(1.6f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = colors.textBody, style = type.body,
                )
                Text(player.goldMedals.toString(), modifier = Modifier.weight(.5f), color = colors.textPrimary, style = type.data)
                Text(player.silverMedals.toString(), modifier = Modifier.weight(.5f), color = colors.textBody, style = type.data)
                Text(player.bronzeMedals.toString(), modifier = Modifier.weight(.5f), color = colors.textBody, style = type.data)
            }
        }
    }
}

@Composable
private fun MasteryDistributionTable(players: List<AndroidRankPlayerSummary>) {
    val orderedPlayers = sortAndroidRankMasteryColumns(players)
    val distributions = orderedPlayers.associate { it.playerId to it.masteryDistribution() }
    val largestGroup = distributions.values.flatMap { it.asIterable() }.maxOrNull()?.coerceAtLeast(1) ?: 1
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val language = LocalAndroidProductLanguage.current
    var showHelp by remember { mutableStateOf(false) }
    Mk8dxPanel(
        localized("MASTERY DISTRIBUTION"),
        trailing = {
            Mk8dxButton(
                androidText(language, "How does Mastery work?", "Hoe werkt Mastery?"),
                { showHelp = true },
                variant = Mk8dxButtonVariant.Quiet,
                size = Mk8dxButtonSize.Sm,
                tag = "rank-mastery-help",
            )
        },
    ) {
        Text(
            androidText(
                language,
                "23 levels · driven tracks per level · longer bars mean more tracks",
                "23 niveaus · gereden circuits per niveau · langere balken betekenen meer circuits",
            ),
            color = colors.textSecondary,
            style = type.bodyS,
        )
        Mk8dxComparisonGrid(
            caption = localized("MASTERY DISTRIBUTION"),
            leadColumn = Mk8dxComparisonColumn("level", localized("Level")),
            columns = orderedPlayers.map { Mk8dxComparisonColumn(it.playerId, it.displayName) },
            rowCount = AndroidMasteryThresholds.tierLabels.size,
            leadWidth = 82.dp,
            columnWidth = 112.dp,
            rowHeight = 42.dp,
            onColumnClick = { },
            modifier = Modifier.testTag("rank-mastery-table"),
            sortable = false,
            lead = { index ->
                Box(Modifier.padding(vertical = 2.dp), contentAlignment = Alignment.CenterStart) {
                    Mk8dxTierChip(
                        AndroidMasteryThresholds.tierLabels[index],
                        masteryColor(index),
                        dense = true,
                    )
                }
            },
            cell = { index, column ->
                val counts = distributions[column.key]
                val count = counts?.get(index) ?: 0
                Mk8dxValueBar(
                    fraction = count.toFloat() / largestGroup,
                    value = count.toString(),
                    color = masteryColor(index),
                    modifier = Modifier.fillMaxWidth().height(32.dp),
                )
            },
        )
    }
    if (showHelp) {
        AndroidMasteryHelpDialog { showHelp = false }
    }
}

internal fun androidMasteryTierOffsetPercent(tier: Int): Double? =
    AndroidMasteryThresholds.masteryWrRatios.getOrNull(tier)?.let { (it - 1.0) * 100.0 }

internal fun androidMasteryTierLimitMs(worldRecordMs: Long, tier: Int): Long? =
    AndroidMasteryThresholds.masteryWrRatios.getOrNull(tier)
        ?.let { kotlin.math.round(worldRecordMs * it / 100.0).toLong() * 100L }

@Composable
private fun AndroidMasteryHelpDialog(onDismiss: () -> Unit) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val families = listOf(
        "Deity" to listOf(0),
        "Myth" to listOf(1, 2, 3),
        "Titan" to listOf(4, 5, 6),
        "Hero" to listOf(7, 8, 9),
        "Exp" to listOf(10, 11, 12),
        "Adv" to listOf(13, 14, 15),
        "Int" to listOf(16, 17, 18),
        "Beg" to listOf(19, 20, 21),
    )
    fun percentage(tier: Int): String {
        val raw = String.format(java.util.Locale.ROOT, "+%.2f%%", androidMasteryTierOffsetPercent(tier))
        return if (language == AndroidProductLanguage.DUTCH) raw.replace('.', ',') else raw
    }
    val deityLimit = requireNotNull(androidMasteryTierLimitMs(90_000, 0))
    val intALimit = requireNotNull(androidMasteryTierLimitMs(90_000, 16))
    val intBLimit = requireNotNull(androidMasteryTierLimitMs(90_000, 17))
    Mk8dxDialog(
        title = androidText(language, "How does Mastery work?", "Hoe werkt Mastery?"),
        closeLabel = androidText(language, "Close", "Sluiten"),
        onDismiss = onDismiss,
        modifier = Modifier.testTag("rank-mastery-help-dialog"),
    ) {
        Column(
            Modifier.fillMaxWidth().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            Text(
                androidText(
                    language,
                    "Mastery shows how close a Player's best time is to the current WR for that track and engine. Every level above Noob uses its own fixed WR offset; the same offsets apply to every track and engine.",
                    "Mastery laat zien hoe dicht de beste tijd van een speler bij het actuele WR voor dat circuit en die klasse ligt. Elk niveau boven Noob gebruikt een eigen vaste WR-opslag; dezelfde opslagen gelden voor elk circuit en elke klasse.",
                ),
                style = type.bodyS,
                color = colors.textBody,
            )
            families.forEach { (name, tiers) ->
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                    verticalAlignment = Alignment.Top,
                ) {
                    Text(name, Modifier.width(54.dp), style = type.label, color = colors.textPrimary)
                    Text(
                        tiers.joinToString(" · ") { tier ->
                            if (tiers.size == 1) percentage(tier)
                            else "${AndroidMasteryThresholds.tierLabels[tier].substringAfter(' ')} ${percentage(tier)}"
                        },
                        Modifier.weight(1f),
                        style = type.dataS,
                        color = colors.textBody,
                    )
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                Text("Noob", Modifier.width(54.dp), style = type.label, color = colors.textPrimary)
                Text(
                    androidText(language, "anything slower", "alles wat langzamer is"),
                    style = type.bodyS,
                    color = colors.textBody,
                )
            }
            Text(
                androidText(
                    language,
                    "Tier limit = current WR × (1 + tier offset)",
                    "Niveaudrempel = actueel WR × (1 + niveau-opslag)",
                ),
                style = type.dataS.copy(fontWeight = FontWeight.SemiBold),
                color = colors.textPrimary,
            )
            Text(
                androidText(language, "Example · WR 1:30.000", "Voorbeeld · WR 1:30.000"),
                style = type.title,
                color = colors.textPrimary,
            )
            Text(
                androidText(
                    language,
                    "Deity: 1:30.000 × 1.021225… = 1:31.910…, rounded to ${Mk8dxNumeric.formatTime(deityLimit)}. So ${Mk8dxNumeric.formatTime(deityLimit)} or faster is Deity.",
                    "Deity: 1:30.000 × 1,021225… = 1:31.910…, afgerond op ${Mk8dxNumeric.formatTime(deityLimit)}. Dus ${Mk8dxNumeric.formatTime(deityLimit)} of sneller is Deity.",
                ),
                style = type.bodyS,
                color = colors.textBody,
            )
            Text(
                androidText(
                    language,
                    "Int B: Int A (${percentage(16)}) ends at ${Mk8dxNumeric.formatTime(intALimit)}; Int B (${percentage(17)}) ends at ${Mk8dxNumeric.formatTime(intBLimit)}. Int B is slower than ${Mk8dxNumeric.formatTime(intALimit)} and at or below ${Mk8dxNumeric.formatTime(intBLimit)}.",
                    "Int B: Int A (${percentage(16)}) eindigt op ${Mk8dxNumeric.formatTime(intALimit)}; Int B (${percentage(17)}) eindigt op ${Mk8dxNumeric.formatTime(intBLimit)}. Int B is langzamer dan ${Mk8dxNumeric.formatTime(intALimit)} en maximaal ${Mk8dxNumeric.formatTime(intBLimit)}.",
                ),
                style = type.bodyS,
                color = colors.textBody,
            )
            Text(
                androidText(
                    language,
                    "Offsets are shown to two decimals; limits use the full fixed ratios and are then rounded to 0.100 s. When a new WR is processed, every limit for that track and engine moves with it, so Mastery can change without a new personal best.",
                    "Opslagen worden met twee decimalen getoond; drempels gebruiken de volledige vaste verhoudingen en worden daarna afgerond op 0,100 s. Als een nieuw WR wordt verwerkt, schuift elke drempel voor dat circuit en die klasse mee; Mastery kan dus veranderen zonder nieuwe persoonlijke beste tijd.",
                ),
                style = type.bodyS,
                color = colors.textSecondary,
            )
        }
    }
}

/**
 * The narrowing a Home tile carried, stated plainly with the way out. The web
 * shows the same title, the same count and the same "Show all tracks" control.
 */
@Composable
private fun RankTrackFocusBanner(
    trackFocus: AndroidRankTrackFocus?,
    matchingCount: Int,
    mode: Int,
    onClear: () -> Unit,
) {
    if (trackFocus == null) return
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Row(
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceSelected)
            .padding(Mk8dxSpacing.sm)
            .testTag("rank-track-focus"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                androidText(language, trackFocus.english, trackFocus.dutch),
                color = colors.textPrimary, style = type.title,
            )
            Text(
                androidText(
                    language,
                    "$matchingCount matching track${if (matchingCount == 1) "" else "s"} · ${mode}cc",
                    "$matchingCount overeenkomend${if (matchingCount == 1) " circuit" else "e circuits"} · ${mode}cc",
                ),
                style = type.bodyS,
                color = colors.textSecondary,
            )
        }
        Mk8dxButton(
            androidText(language, "Show all tracks", "Alle circuits tonen"),
            onClear,
            variant = Mk8dxButtonVariant.Quiet,
            size = Mk8dxButtonSize.Sm,
        )
    }
}

@Composable
private fun GlobalTrackBests(
    home: AndroidHomeBootstrap,
    own: AndroidRankPlayerSummary,
    mode: Int,
    trackFocus: AndroidRankTrackFocus?,
    onClearTrackFocus: () -> Unit,
    onOpenTrack: (String) -> Unit,
) {
    var sort by remember { mutableStateOf(AndroidRankSort.TRACK) }
    var trackQuery by remember { mutableStateOf("") }
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val numbers = numberLanguage()
    val focus = home.focus?.rows.orEmpty().filter { it.mode == mode }.associateBy(AndroidFocusRow::trackId)
    val staffTimes = remember(mode) {
        AndroidBenchmarkCatalog.forKind(AndroidBenchmarkKind.NINTENDO_STAFF, mode)
            .associate { it.trackId to it.timeMs }
    }
    val named = own.scope.tracks.filter {
        it.displayName.contains(trackQuery.trim(), ignoreCase = true) ||
            AndroidDutchPresentationCatalog.translate(it.displayName)
                .contains(trackQuery.trim(), ignoreCase = true)
    }
    // Without a focus the list stays what it has always been: the tracks with
    // a published time. A focus asks about tracks that may have none yet, so
    // it is evaluated over every scoped track, exactly as the web does.
    val drivenTracks = if (trackFocus == null) {
        named.filter { it.id in own.bests }
    } else {
        named.filter { track ->
            val best = own.bests[track.id]
            matchesAndroidRankTrackFocus(
                trackFocus,
                AndroidRankTrackEvidence(
                    bestRank = best?.rank,
                    bestTimeMs = best?.totalTimeMs,
                    staffTimeMs = staffTimes[track.id],
                    leaderTimeMs = focus[track.id]?.leaderBestMs,
                ),
            )
        }
    }
    val rows = when (sort) {
        AndroidRankSort.TRACK -> drivenTracks
        AndroidRankSort.RANK -> drivenTracks.sortedBy { own.bests[it.id]?.rank ?: Int.MAX_VALUE }
        AndroidRankSort.GAP -> drivenTracks.sortedByDescending { track ->
            focus[track.id]?.let { row -> row.myBestMs - (row.above?.bestMs ?: row.leaderBestMs) } ?: Long.MIN_VALUE
        }
        AndroidRankSort.MASTERY -> drivenTracks.sortedBy { track ->
            own.bests[track.id]?.let { AndroidMasteryThresholds.trackTier(track.id, mode, it.totalTimeMs) } ?: Int.MAX_VALUE
        }
    }
    Mk8dxPanel(localized("PER-TRACK BESTS") + " · ${mode}CC") {
        RankTrackFocusBanner(trackFocus, rows.size, mode, onClearTrackFocus)
        Mk8dxSearchField(localized("Search track"), trackQuery, { trackQuery = it })
        Mk8dxTabs(
            label = androidText(language, "Sort", "Sorteren"),
            options = AndroidRankSort.entries.map {
                Mk8dxTabOption(it, localized(it.label), "rank-sort-${it.name.lowercase()}")
            },
            value = sort,
            onChange = { sort = it },
        )
        if (rows.isEmpty()) {
            Text(
                if (trackFocus == null) localized("No published ${mode}cc times yet.")
                else androidText(language, "No tracks match this focus.", "Geen circuits passen bij deze focus."),
                color = colors.textSecondary, style = type.body,
            )
        }
        rows.forEach { track ->
            val best = own.bests[track.id]
            val focusRow = focus[track.id]
            RankTrackRow(track.index, localized(track.displayName), onClick = { onOpenTrack(track.id) }) {
                if (best == null) {
                    Text(localized("Not driven"), color = colors.textTertiary, style = type.body)
                } else {
                    val tier = AndroidMasteryThresholds.trackTier(track.id, mode, best.totalTimeMs)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                    ) {
                        Text(
                            Mk8dxNumeric.formatRank(best.rank, numbers),
                            color = when (best.rank) {
                                1 -> colors.rankGold
                                2 -> colors.rankSilver
                                3 -> colors.rankBronze
                                else -> colors.textBody
                            },
                            style = type.data.copy(fontWeight = FontWeight.SemiBold),
                            softWrap = false, maxLines = 1,
                        )
                        tier?.let {
                            Mk8dxTierChip(AndroidMasteryThresholds.tierLabels[it], masteryColor(it), dense = true)
                        }
                        Text(
                            Mk8dxNumeric.formatTime(best.totalTimeMs),
                            color = colors.textPrimary, style = type.dataM, softWrap = false, maxLines = 1,
                        )
                    }
                    Text(
                        focusRow?.above?.let {
                            Mk8dxNumeric.formatDelta(focusRow.myBestMs - it.bestMs) + " " +
                                localized("to") + " " + it.displayName
                        } ?: if (best.rank == 1) localized("Community leader") else localized("Published best"),
                        style = type.bodyS,
                        color = colors.textSecondary,
                    )
                }
            }
        }
    }
}

@Composable
private fun RivalTrackComparison(
    players: List<AndroidRankPlayerSummary>,
    onOpenTrack: (String) -> Unit,
    trackQuery: String,
    onTrackQueryChange: (String) -> Unit,
    sortPlayerId: String?,
    onSortPlayerChange: (String?) -> Unit,
    sortDescending: Boolean,
    onSortDescendingChange: (Boolean) -> Unit,
    ownPlayerId: String?,
    focusRows: List<AndroidFocusRow>,
    trackFocus: AndroidRankTrackFocus?,
    onClearTrackFocus: () -> Unit,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val mode = players.first().mode
    val named = players.first().scope.tracks.filter { track ->
        track.displayName.contains(trackQuery.trim(), ignoreCase = true) ||
            AndroidDutchPresentationCatalog.translate(track.displayName)
                .contains(trackQuery.trim(), ignoreCase = true)
    }
    // A Home tile narrows this table the same way it narrows the per-track
    // bests: the question is about the viewer's own tracks either way.
    val ownBests = players.firstOrNull { it.playerId == ownPlayerId }?.bests.orEmpty()
    val staffTimes = remember(mode) {
        AndroidBenchmarkCatalog.forKind(AndroidBenchmarkKind.NINTENDO_STAFF, mode)
            .associate { it.trackId to it.timeMs }
    }
    val leaderTimes = focusRows.filter { it.mode == mode }.associate { it.trackId to it.leaderBestMs }
    val comparedTracks = if (trackFocus == null) {
        named.filter { track -> players.any { track.id in it.bests } }
    } else {
        named.filter { track ->
            val best = ownBests[track.id]
            matchesAndroidRankTrackFocus(
                trackFocus,
                AndroidRankTrackEvidence(
                    bestRank = best?.rank,
                    bestTimeMs = best?.totalTimeMs,
                    staffTimeMs = staffTimes[track.id],
                    leaderTimeMs = leaderTimes[track.id],
                ),
            )
        }
    }
    fun deltaFor(trackId: String, playerId: String): Long? {
        val times = players.mapNotNull { it.bests[trackId]?.totalTimeMs }
        val time = players.firstOrNull { it.playerId == playerId }?.bests?.get(trackId)?.totalTimeMs
        return if (time == null || times.isEmpty()) null else time - times.min()
    }
    val rows = sortPlayerId?.let { playerId ->
        comparedTracks.sortedWith { left, right ->
            val leftDelta = deltaFor(left.id, playerId) ?: Long.MAX_VALUE
            val rightDelta = deltaFor(right.id, playerId) ?: Long.MAX_VALUE
            val comparison = leftDelta.compareTo(rightDelta) * if (sortDescending) -1 else 1
            if (comparison != 0) comparison else left.displayName.compareTo(right.displayName)
        }
    } ?: comparedTracks
    Mk8dxPanel(localized("PER-TRACK COMPARISON") + " · ${mode}CC") {
        RankTrackFocusBanner(trackFocus, rows.size, mode, onClearTrackFocus)
        Mk8dxSearchField(localized("Search track"), trackQuery, onTrackQueryChange)
        Text(
            localized("Tap a Player column to sort by that Player's delta."),
            color = colors.textSecondary,
            style = type.bodyS,
        )
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val wide = maxWidth >= 600.dp
            val trackWidth = mk8dxLeadColumnWidth(wide)
            val fitted = (maxWidth - trackWidth) / players.size.coerceAtLeast(1)
            val playerWidth = if (wide) fitted.coerceAtLeast(132.dp)
            else fitted.coerceAtLeast(if (players.size <= 3) 78.dp else 70.dp)
            Mk8dxComparisonGrid(
                caption = localized("PER-TRACK COMPARISON"),
                leadColumn = Mk8dxComparisonColumn(
                    "track",
                    localized("Track"),
                    "rank-track-sort-canonical",
                    if (sortPlayerId == null) Mk8dxSortDirection.Ascending else null,
                ),
                columns = players.map { player ->
                    Mk8dxComparisonColumn(
                        player.playerId,
                        when (player.playerId) {
                            ANDROID_NINTENDO_STAFF_REFERENCE_ID -> localized("Nintendo Ghost")
                            ANDROID_WORLD_RECORD_REFERENCE_ID -> localized("World Record")
                            else -> player.displayName
                        } + " " + localized("gap"),
                        "rank-track-player-${player.playerId}",
                        when {
                            sortPlayerId != player.playerId -> null
                            sortDescending -> Mk8dxSortDirection.Descending
                            else -> Mk8dxSortDirection.Ascending
                        },
                    )
                },
                rowCount = rows.size,
                leadWidth = trackWidth,
                columnWidth = playerWidth,
                rowHeight = 68.dp,
                onColumnClick = { column ->
                    if (column.key == "track") {
                        onSortPlayerChange(null)
                        onSortDescendingChange(false)
                    } else if (sortPlayerId == column.key) {
                        onSortDescendingChange(!sortDescending)
                    } else {
                        onSortPlayerChange(column.key)
                        onSortDescendingChange(true)
                    }
                },
                modifier = Modifier.testTag("rank-track-table"),
                lead = { index ->
                    val track = rows[index]
                    Box(
                        Modifier.fillMaxWidth().height(68.dp)
                            .clickable { onOpenTrack(track.id) }
                            .testTag("rank-open-track-${track.id}"),
                    ) {
                        TrackIdentityArtwork(
                            trackIndex = track.index,
                            mode = mode,
                            modifier = Modifier.matchParentSize(),
                            contentDescription = localized(track.displayName),
                        )
                        Box(
                            Modifier.align(Alignment.BottomStart).fillMaxWidth()
                                // The plate over artwork is §16's shade: the
                                // app surface at the share that keeps the one
                                // track-name line readable in either appearance.
                                .background(colors.surfaceApp.copy(alpha = .78f))
                                .padding(horizontal = Mk8dxSpacing.xs, vertical = 3.dp),
                        ) {
                            Text(
                                localized(track.displayName),
                                color = colors.textPrimary,
                                style = type.micro.copy(fontWeight = FontWeight.SemiBold),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.testTag("rank-track-name-${track.id}"),
                            )
                        }
                    }
                },
                cell = { index, column ->
                    val track = rows[index]
                    val player = players.first { it.playerId == column.key }
                    val best = player.bests[track.id]
                    val fastest = players.mapNotNull { it.bests[track.id]?.totalTimeMs }.minOrNull()
                    Column(horizontalAlignment = Alignment.End) {
                        if (best == null) {
                            Text(
                                Mk8dxNumeric.TRUE_MINUS,
                                color = colors.textTertiary, style = type.dataS,
                            )
                        } else {
                            val tier = AndroidMasteryThresholds.trackTier(track.id, player.mode, best.totalTimeMs)
                            Text(
                                Mk8dxNumeric.formatTime(best.totalTimeMs),
                                color = colors.textPrimary, style = type.dataS,
                                softWrap = false, maxLines = 1,
                            )
                            fastest?.let {
                                val gap = best.totalTimeMs - it
                                Text(
                                    Mk8dxNumeric.formatDelta(gap),
                                    color = if (gap > 0) colors.deltaSlower else colors.deltaFaster,
                                    style = type.dataS, softWrap = false, maxLines = 1,
                                )
                            }
                            tier?.let {
                                Mk8dxTierChip(
                                    AndroidMasteryThresholds.tierLabels[it],
                                    masteryColor(it),
                                    dense = true,
                                )
                            }
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun RankTrackRow(
    trackIndex: Int,
    trackName: String,
    onClick: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceControl)
            .clickable(onClick = onClick)
            .padding(Mk8dxSpacing.sm)
            .semantics(mergeDescendants = true) { },
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            TrackIdentityArtwork(
                trackIndex = trackIndex,
                mode = null,
                modifier = Modifier.width(64.dp).height(46.dp),
                contentDescription = trackName,
            )
            Text(
                trackName,
                color = colors.textPrimary,
                style = Mk8dxTheme.type.title,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
        Column(Modifier.fillMaxWidth(), content = content)
    }
}

/**
 * The recovered Mastery ladder's own colours. They are product data (23 levels
 * with names and colours recovered from the original project), not design-system
 * tokens: the chip guarantees the label on them is readable, the value stays.
 */
internal fun masteryColor(index: Int): Color = Color(
    parseColor(AndroidMasteryThresholds.tierColors.getValue(AndroidMasteryThresholds.tierLabels[index])),
)
