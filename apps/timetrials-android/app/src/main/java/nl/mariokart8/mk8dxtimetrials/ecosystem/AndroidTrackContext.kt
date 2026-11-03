package nl.mariokart8.mk8dxtimetrials.ecosystem

import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.BuildConfig
import nl.mariokart8.mk8dxtimetrials.builds.AndroidBuildPartCategory
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutVariants
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEditAction
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMark
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMarkSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxIcons
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatBlock
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxYouChip

/**
 * **A02's board** — the track in context: the community's times, the Player's
 * own row, and the two official references, for one engine class.
 *
 * Migrated in Phase 9 onto the design system. The row is the §15 TimingRow: a
 * rank column measured from the largest rank on this board, the name as the one
 * cell that ellipsises, and the time in tabular Mono that never wraps at any
 * width. Your own row is the volt YouRow; the World Record and the Nintendo
 * staff ghost are ReferenceRows that consume no rank; their WR/NG mark says so.
 *
 * Everything the board carried keeps carrying: the five-cell summary, the
 * combo that drove each time, its age, which client recorded it, the per-lap
 * mushroom and coin patterns, the gap to your own time, the record's video and
 * the expandable lap detail.
 */
@Composable
internal fun AndroidTrackContext(
    trackId: String,
    mode: Int,
    playerId: String?,
    client: AndroidTimeTrialsEcosystemDataSource?,
    modifier: Modifier = Modifier,
    /** Opening a combo in Build is a Web action the board carries too. */
    onOpenCombo: ((List<String>) -> Unit)? = null,
    /** A community name opens that Player's page, as the Web board's name links do. */
    onOpenPlayer: ((String) -> Unit)? = null,
) {
    val language = LocalAndroidProductLanguage.current
    val numberLanguage = if (language.code == "nl") Mk8dxNumberLanguage.NL else Mk8dxNumberLanguage.EN
    val colors = Mk8dxTheme.colors
    val uriHandler = LocalUriHandler.current
    var refresh by remember { mutableIntStateOf(0) }
    var results by remember(trackId, mode, client, refresh) {
        mutableStateOf<List<AndroidPublicTimeTrialResult>?>(null)
    }
    var error by remember(trackId, mode, client, refresh) { mutableStateOf<String?>(null) }
    var worldRecord by remember(trackId, mode, client, refresh) { mutableStateOf<AndroidWorldRecord?>(null) }
    var readings by remember(trackId, mode, client, refresh) {
        mutableStateOf<List<AndroidReferenceGhostReading>>(emptyList())
    }
    // Your own run in the edit form (owner 2026-09-29), and a shared run's Details to open.
    val context = LocalContext.current
    // A shared run names its result by code or id; only one result on this board may match.
    val focusResultId = AndroidRunFocus.pendingFor(trackId)?.let { run ->
        results?.let { loaded -> androidFindRun(loaded.map { it.resultId }, run) }
    }
    var editing by remember(trackId, mode) { mutableStateOf<String?>(null) }
    LaunchedEffect(trackId, mode, client, refresh) {
        if (client == null) {
            error = androidText(
                language,
                "Community times are unavailable in this build.",
                "Communitytijden zijn niet beschikbaar in deze build.",
            )
        } else {
            withContext(Dispatchers.IO) {
                runCatching {
                    coroutineScope {
                        val leaderboard = async { client.leaderboard(trackId, mode) }
                        val records = async { client.worldRecords() }
                        // ADR-0212: what LiveTrial read from this track's staff and record ghosts.
                        val ghostReadings = async {
                            runCatching { client.referenceGhostReadings(trackId, mode) }.getOrDefault(emptyList())
                        }
                        Triple(
                            leaderboard.await(),
                            records.await().firstOrNull { it.trackId == trackId && it.mode == mode },
                            ghostReadings.await(),
                        )
                    }
                }
            }.fold(
                onSuccess = { results = it.first; worldRecord = it.second; readings = it.third; error = null },
                onFailure = {
                    error = it.message ?: androidText(
                        language, "Could not load community times.", "Kon de communitytijden niet laden.",
                    )
                },
            )
        }
    }

    Mk8dxPanel(
        androidText(language, "TRACK TIMES", "CIRCUITTIJDEN"),
        modifier.fillMaxWidth().padding(horizontal = Mk8dxSpacing.md).testTag("track-community-context"),
        trailing = { Mk8dxEngineMark(mode, size = Mk8dxEngineMarkSize.Md) },
    ) {
        Mk8dxMetaLine(
            if (playerId == null) {
                androidText(
                    language,
                    "Community and official references",
                    "Community en officiële referenties",
                )
            } else {
                androidText(
                    language,
                    "Community, your best and official references",
                    "Community, je beste tijd en officiële referenties",
                )
            },
        )
        error?.let {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(it, style = Mk8dxTheme.type.bodyS, color = colors.statusError, modifier = Modifier.weight(1f))
                Mk8dxButton(
                    androidText(language, "Retry", "Opnieuw"),
                    { refresh += 1 },
                    variant = Mk8dxButtonVariant.Secondary,
                    size = Mk8dxButtonSize.Sm,
                    tag = "track-board-retry",
                )
            }
        }
        if (results == null && error == null) {
            Text(
                androidText(language, "Loading track times…", "Circuittijden laden…"),
                style = Mk8dxTheme.type.bodyS,
                color = colors.textSecondary,
            )
        }
        val rows = results.orEmpty()
        val mine = playerId?.let { id -> rows.firstOrNull { it.playerId == id } }
        val nowMs = remember(results) { System.currentTimeMillis() }
        val lapCount = remember(trackId) { Schema9AndroidTrackCatalog.find(trackId)?.lapCount ?: 3 }
        val staffMs = remember(trackId, mode) {
            AndroidBenchmarkCatalog.forTrack(trackId, mode)
                .firstOrNull { it.kind == AndroidBenchmarkKind.NINTENDO_STAFF }?.timeMs
        }
        TrackContextSummary(
            worldRecordMs = worldRecord?.totalTimeMs
                ?: AndroidBenchmarkCatalog.forTrack(trackId, mode)
                    .firstOrNull { it.kind == AndroidBenchmarkKind.WORLD_RECORD }?.timeMs,
            leaderMs = rows.minOfOrNull { it.totalTimeMs },
            ownMs = mine?.totalTimeMs,
            staffMs = staffMs,
        )
        if (mine == null && playerId != null) {
            Mk8dxMetaLine(
                androidText(
                    language,
                    "Your published time is not on this board yet.",
                    "Je gepubliceerde tijd staat nog niet op dit bord.",
                ),
            )
        } else if (playerId == null) {
            Mk8dxMetaLine(
                androidText(
                    language,
                    "Sign in to compare these times with your PB.",
                    "Meld je aan om deze tijden met je PR te vergelijken.",
                ),
            )
        }
        val reference = mine?.totalTimeMs

        // §10: one rank column for this board, as wide as its own largest rank.
        val rankStyle = Mk8dxTheme.type.data.copy(fontWeight = FontWeight.SemiBold)
        val measurer = rememberTextMeasurer()
        val density = LocalDensity.current
        val largestRank = rows.mapIndexedNotNull { index, result -> result.rank ?: (index + 1) }.maxOrNull() ?: 1
        val rankWidth = with(density) {
            maxOf(
                measurer.measure(
                    Mk8dxNumeric.formatRank(largestRank, numberLanguage),
                    rankStyle, softWrap = false, maxLines = 1,
                ).size.width.toDp(),
                measurer.measure("WR", rankStyle, softWrap = false, maxLines = 1).size.width.toDp(),
            )
        } + 2.dp

        Row(
            Modifier.fillMaxWidth().padding(top = Mk8dxSpacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            val head = Mk8dxTheme.type.micro.copy(fontWeight = FontWeight.Bold)
            // The rank column is as wide as its own largest rank, so its head is
            // the numeral's own mark rather than a word that would wrap inside
            // it; the word is what a screen reader hears.
            val rankHeading = androidText(language, "Rank", "Plek")
            Text(
                "#",
                style = head,
                color = colors.textSecondary,
                softWrap = false,
                maxLines = 1,
                modifier = Modifier.width(rankWidth).semantics { contentDescription = rankHeading },
            )
            Text(
                androidText(language, "PLAYER", "SPELER"),
                style = head, color = colors.textSecondary, modifier = Modifier.weight(1f),
            )
            Text(
                androidText(language, "TIME", "TIJD"),
                style = head, color = colors.textSecondary,
                textAlign = TextAlign.End, modifier = Modifier.widthIn(min = 40.dp),
            )
        }

        worldRecord?.let { record ->
            val holders = record.holders.ifEmpty {
                listOf(
                    AndroidWorldRecordHolder(
                        record.playerName, record.videoUrl, record.lapTimesMs, record.coinsPerLap, record.mushroomsPerLap,
                        nationName = record.nationName, recordDate = record.recordDate, durationDays = record.durationDays,
                        characterName = record.characterName, bodyName = record.bodyName,
                        tireName = record.tireName, gliderName = record.gliderName,
                    ),
                )
            }
            val reading = androidReadingFor(readings, "world_record", record.totalTimeMs)
            holders.forEach { holder ->
                WorldRecordHolderRow(
                    androidHolderWithReading(holder, reading), record.totalTimeMs, reference, rankWidth,
                    uriHandler::openUri, onOpenCombo,
                )
            }
        }
        val benchmarks = AndroidBenchmarkCatalog.forTrack(trackId, mode)
            .filter { worldRecord == null || it.kind != AndroidBenchmarkKind.WORLD_RECORD }
            .map { androidBenchmarkWithReading(it, readings) }
        val humanPositions = rows.mapIndexed { index, result ->
            result.playerId to (result.rank ?: index + 1)
        }.toMap()
        val combined = buildList {
            rows.take(20).forEach { result ->
                add(TrackContextDisplayRow(result.totalTimeMs, human = result))
            }
            benchmarks.forEach { benchmark ->
                add(TrackContextDisplayRow(benchmark.timeMs, benchmark = benchmark))
            }
        }.sortedWith(
            compareBy<TrackContextDisplayRow> { it.timeMs }
                .thenBy { it.benchmark?.kind?.ordinal ?: Int.MAX_VALUE },
        )
        combined.forEach { display ->
            display.human?.let { result ->
                val position = humanPositions[result.playerId]
                val hasDetails = result.loadout != null || result.laps.isNotEmpty() ||
                    androidSourceLabel(result.sourceKind) != null || result.playerId == playerId
                val laps = result.laps.sortedBy { it.lapNumber }
                val loadout = result.loadout
                val buildIds = listOfNotNull(
                    loadout?.characterVariantId ?: loadout?.characterId,
                    loadout?.bodyVariantId ?: loadout?.bodyId,
                    loadout?.tireId,
                    loadout?.gliderVariantId ?: loadout?.gliderId,
                )
                val appearance = loadout?.characterVariantId ?: loadout?.characterId
                val buildParts = listOf(
                    activityLoadoutAsset(loadout?.characterId, loadout?.characterVariantId, appearance),
                    activityLoadoutAsset(loadout?.bodyId, loadout?.bodyVariantId, appearance),
                    activityLoadoutAsset(loadout?.tireId, null, appearance),
                    activityLoadoutAsset(loadout?.gliderId, loadout?.gliderVariantId, appearance),
                )
                TrackContextRow(
                    rankText = position?.let { Mk8dxNumeric.formatRank(it, numberLanguage) } ?: "",
                    rank = position,
                    player = result.playerDisplayName,
                    timeMs = result.totalTimeMs,
                    deltaMs = reference?.let { result.totalTimeMs - it },
                    kind = if (result.playerId == playerId) AndroidTrackRowKind.SELF else AndroidTrackRowKind.ORDINARY,
                    rankWidth = rankWidth,
                    isReference = result.playerId == playerId,
                    leader = position == 1 && reference != null && result.totalTimeMs == reference,
                    countryId = result.countryId,
                    buildIds = buildIds,
                    buildParts = buildParts,
                    mushrooms = androidLapPattern(laps.map { it.mushroomsUsed }, lapCount),
                    coins = androidLapPattern(androidLapCoinGains(laps.map { it.coinsCollected }), lapCount),
                    age = androidCompactAge(result.resultAtMs, nowMs),
                    sourceKind = result.sourceKind,
                    videoUrl = result.videoUrl,
                    onOpenVideo = uriHandler::openUri,
                    onOpenCombo = onOpenCombo,
                    onOpenPlayer = onOpenPlayer?.let { open -> { open(result.playerId) } },
                    playerTag = result.playerId,
                    initiallyExpanded = focusResultId == result.resultId,
                    onFocused = { AndroidRunFocus.opened() },
                    details = if (hasDetails) {
                        {
                            TrackResultDetails(
                                result, mine, buildParts,
                                onShareRun = {
                                    val shared = androidShareRun(
                                        context,
                                        androidRunShareModelOf(result, position, buildParts, nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin.current(context) ?: ""),
                                        androidText(language, "Share run", "Rit delen"),
                                    )
                                    if (!shared) {
                                        Toast.makeText(
                                            context,
                                            androidText(language, "The picture could not be made.", "De afbeelding kon niet worden gemaakt."),
                                            Toast.LENGTH_SHORT,
                                        ).show()
                                    }
                                },
                                onEdit = if (result.playerId == playerId && client != null) {
                                    { editing = result.resultId }
                                } else {
                                    null
                                },
                            )
                        }
                    } else {
                        null
                    },
                )
            }
            display.benchmark?.let { benchmark ->
                val isRecord = benchmark.kind == AndroidBenchmarkKind.WORLD_RECORD
                val buildIds = benchmark.loadout.orEmpty()
                val buildParts = buildIds.map(::androidBuildPartPresentation)
                val laps = benchmark.lapTimesMs.orEmpty()
                TrackContextRow(
                    rankText = if (isRecord) "WR" else "NG",
                    rank = null,
                    player = benchmark.name,
                    timeMs = benchmark.timeMs,
                    deltaMs = reference?.let { benchmark.timeMs - it },
                    kind = if (isRecord) AndroidTrackRowKind.WORLD_RECORD else AndroidTrackRowKind.STAFF,
                    rankWidth = rankWidth,
                    countryId = benchmark.countryId,
                    referenceIconPath = if (isRecord) null else "private-product/img/item/nintendo.png",
                    referenceIconDescription = if (isRecord) "World Record" else "Nintendo",
                    buildIds = buildIds,
                    buildParts = buildParts,
                    mushrooms = benchmark.mushroomsPerLap?.let { androidLapPattern(it, lapCount) },
                    coins = benchmark.coinsPerLap?.let { androidLapPattern(it, lapCount) },
                    onOpenCombo = onOpenCombo,
                    details = if (buildIds.isEmpty() && laps.isEmpty()) {
                        null
                    } else {
                        {
                            ReferenceDetails(
                                buildParts, laps, benchmark.coinsPerLap.orEmpty(), benchmark.mushroomsPerLap.orEmpty(),
                            )
                        }
                    },
                )
            }
        }
        if (rows.isEmpty() && results != null) {
            Text(
                androidText(
                    language,
                    "No verified community times yet. Your saved result can be the first.",
                    "Nog geen geverifieerde communitytijden. Jouw opgeslagen resultaat kan de eerste zijn.",
                ),
                style = Mk8dxTheme.type.bodyS,
                color = colors.textSecondary,
            )
        }
    }
    val editingClient = client
    editing?.let { resultId ->
        if (editingClient != null) {
            AndroidManageResultOverlay(resultId, editingClient, playerId, onClose = { saved ->
                editing = null
                if (saved) refresh += 1
            })
        }
    }
}

/**
 * The Web board's five-cell summary strip: the World Record, the community
 * leader, your own personal best, your gap to the leader and the Nintendo staff
 * ghost. It answers "where do I stand here" before a single row is read.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TrackContextSummary(
    worldRecordMs: Long?,
    leaderMs: Long?,
    ownMs: Long?,
    staffMs: Long?,
) {
    val language = LocalAndroidProductLanguage.current
    val gapMs = if (ownMs == null || leaderMs == null) null else ownMs - leaderMs
    val cells = listOf(
        (worldRecordMs?.let(Mk8dxNumeric::formatTime) ?: "—") to androidText(language, "World record", "Wereldrecord"),
        (leaderMs?.let(Mk8dxNumeric::formatTime) ?: "—") to androidText(language, "Community leader", "Communityleider"),
        (ownMs?.let(Mk8dxNumeric::formatTime) ?: "—") to androidText(language, "Your PB", "Jouw PR"),
        (gapMs?.let { if (it == 0L) androidText(language, "Leader", "Leider") else Mk8dxNumeric.formatDelta(it) } ?: "—")
            to androidText(language, "Your gap", "Jouw verschil"),
        (staffMs?.let(Mk8dxNumeric::formatTime) ?: "—") to androidText(language, "Staff ghost", "Staff ghost"),
    )
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        maxItemsInEachRow = 3,
        modifier = Modifier.fillMaxWidth().padding(top = Mk8dxSpacing.sm).testTag("track-board-summary"),
    ) {
        cells.forEach { (value, label) ->
            Mk8dxStatBlock(label, value, Modifier.widthIn(min = 92.dp))
        }
    }
}

/**
 * The four kinds of row the board draws: an ordinary community row, your own
 * (the volt YouRow), and the two references, which consume no rank.
 */
private enum class AndroidTrackRowKind { ORDINARY, SELF, WORLD_RECORD, STAFF }

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TrackContextRow(
    rankText: String,
    rank: Int?,
    player: String,
    timeMs: Long?,
    deltaMs: Long?,
    kind: AndroidTrackRowKind,
    rankWidth: androidx.compose.ui.unit.Dp,
    isReference: Boolean = false,
    leader: Boolean = false,
    countryId: String? = null,
    referenceIconPath: String? = null,
    referenceIconDescription: String? = null,
    /** " · staff ghost" and the like, printed after the name as the Web does. */
    qualifier: String? = null,
    /** The four part ids, in character/body/tire/glider order, when known. */
    buildIds: List<String> = emptyList(),
    /** The colour-matched icon/name for those four parts. */
    buildParts: List<Pair<String, String>?> = emptyList(),
    /** Per-lap mushrooms and coins, already formatted as "1-1-1" / "8-2-0". */
    mushrooms: String? = null,
    coins: String? = null,
    /** The Web's compact age: 1d, 3w, 9mo, 1y. */
    age: String? = null,
    sourceKind: String? = null,
    /** Proof of the record, shown on the row itself exactly as the Web does. */
    videoUrl: String? = null,
    onOpenVideo: ((String) -> Unit)? = null,
    onOpenCombo: ((List<String>) -> Unit)? = null,
    /** Opens this row's Player page; references (WR, staff ghost) have none. */
    onOpenPlayer: (() -> Unit)? = null,
    /** Identifies the name's link for tests. */
    playerTag: String? = null,
    details: (@Composable () -> Unit)? = null,
    /** A shared run's row (`&run=`): its Details open, and the board scrolls to it. */
    initiallyExpanded: Boolean = false,
    onFocused: () -> Unit = {},
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    var expanded by remember(player, timeMs) { mutableStateOf(false) }
    val bringIntoView = remember { BringIntoViewRequester() }
    LaunchedEffect(initiallyExpanded) {
        if (initiallyExpanded && details != null) {
            expanded = true
            // Let the opened Details lay out first, so the whole panel is scrolled to. The request
            // is cleared only afterwards: clearing it changes this effect's key and cancels it.
            kotlinx.coroutines.delay(250)
            bringIntoView.bringIntoView()
            onFocused()
        }
    }
    val you = kind == AndroidTrackRowKind.SELF
    val rankColor = when {
        you -> colors.personalAccent
        kind != AndroidTrackRowKind.ORDINARY -> colors.textTertiary
        rank == 1 -> colors.rankGold
        rank == 2 -> colors.rankSilver
        rank == 3 -> colors.rankBronze
        else -> colors.textSecondary
    }
    val edge: Pair<androidx.compose.ui.unit.Dp, Color>? = when {
        you -> 4.dp to colors.personalEdge
        kind != AndroidTrackRowKind.ORDINARY -> null
        rank == 1 -> 3.dp to colors.rankGold
        rank == 2 -> 3.dp to colors.rankSilver
        rank == 3 -> 3.dp to colors.rankBronze
        else -> null
    }
    Column(
        Modifier
            .bringIntoViewRequester(bringIntoView)
            .fillMaxWidth()
            .heightIn(min = 46.dp)
            .background(if (you) colors.personalWash else Color.Transparent)
            .border(1.dp, colors.borderSubtle)
            .drawBehind {
                if (edge != null) drawRect(edge.second, size = Size(edge.first.toPx(), size.height))
            }
            .then(
                if (details == null) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button) { expanded = !expanded }
                },
            )
            .padding(horizontal = Mk8dxSpacing.sm, vertical = Mk8dxSpacing.xs),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Box(Modifier.width(rankWidth), contentAlignment = Alignment.CenterStart) {
                if (referenceIconPath != null) {
                    ProductAssetImage(
                        path = referenceIconPath,
                        fallback = rankText,
                        accent = colors.textTertiary,
                        modifier = Modifier.size(20.dp),
                        contentDescription = referenceIconDescription,
                    )
                } else {
                    Text(
                        rankText,
                        style = type.data.copy(fontWeight = FontWeight.SemiBold),
                        color = rankColor,
                        softWrap = false,
                        maxLines = 1,
                    )
                }
            }
            ProductAssetImage(
                path = countryId?.takeIf { it.startsWith("country.") }
                    ?.let { "private-product/img/country/${it.substringAfter('.')}.png" }
                    ?: "private-product/img/country/unknown.png",
                fallback = "",
                accent = Color.Transparent,
                modifier = Modifier.width(24.dp).size(width = 24.dp, height = 16.dp),
                contentDescription = countryId?.substringAfter('.'),
            )
            // The name is the one cell that shrinks (§10); nothing else does. A
            // community name is a link to that Player's page; the rest of the
            // row still opens the lap detail.
            val openLabel = androidText(language, "Open $player's page", "Open de pagina van $player")
            Box(
                Modifier
                    .weight(1f)
                    .then(
                        if (onOpenPlayer == null) {
                            Modifier
                        } else {
                            Modifier
                                .clickable(role = Role.Button, onClickLabel = openLabel) { onOpenPlayer() }
                                .testTag("track-board-player-${playerTag ?: player}")
                        },
                    ),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text(
                    player,
                    style = type.body.copy(
                        fontWeight = if (you) FontWeight.SemiBold else FontWeight.Normal,
                        textDecoration = if (onOpenPlayer == null) null else TextDecoration.Underline,
                    ),
                    color = if (you) colors.textPrimary else colors.textBody,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (you) Mk8dxYouChip(androidText(language, "You", "Jij"))
            Text(
                timeMs?.let(Mk8dxNumeric::formatTime) ?: "—",
                style = type.data.copy(fontWeight = FontWeight.SemiBold),
                color = colors.textPrimary,
                softWrap = false,
                maxLines = 1,
                textAlign = TextAlign.End,
                modifier = Modifier.widthIn(min = 40.dp),
            )
        }
        qualifier?.let { Mk8dxMetaLine(it) }
        // The Web's second line: the combo that drove the time, how old the
        // result is and which client recorded it.
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        ) {
            TrackRowCellLabel(androidText(language, "BUILD", "BUILD"))
            if (buildIds.size == 4 && buildParts.size == 4 && buildParts.all { it != null }) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .then(
                            if (onOpenCombo == null) {
                                Modifier
                            } else {
                                Modifier.heightIn(min = Mk8dxSpacing.targetMin)
                                    .clickable(role = Role.Button) { onOpenCombo(buildIds) }
                            },
                        )
                        .testTag("track-board-combo"),
                ) {
                    buildParts.forEach { part ->
                        ProductAssetImage(
                            path = part!!.first,
                            fallback = "·",
                            accent = colors.borderStrong,
                            modifier = Modifier.size(18.dp),
                            contentDescription = part.second,
                        )
                    }
                }
            } else {
                TrackRowMissing()
            }
            Spacer(Modifier.weight(1f))
            TrackRowCellLabel(androidText(language, "AGE", "LEEFTIJD"))
            if (age == null) {
                TrackRowMissing()
            } else {
                Text(age, style = type.dataS, color = colors.textTertiary, softWrap = false, maxLines = 1)
            }
            // Evidence is only the run's video (owner 2026-09-29); which client recorded it is in
            // the Details.
            Box(Modifier.width(26.dp), contentAlignment = Alignment.CenterEnd) {
                if (videoUrl != null && onOpenVideo != null) {
                    TrackRowVideoMark(videoUrl, player, onOpenVideo)
                }
            }
        }
        // The Web's third line: the per-lap mushroom and coin patterns, and the
        // gap that the whole board is read for.
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        ) {
            TrackRowPattern(
                "private-product/img/item/mushroom.png",
                androidText(language, "Mushrooms", "Paddenstoelen"),
                mushrooms,
                Modifier.weight(1f),
            )
            TrackRowPattern(
                "private-product/img/item/coin.png",
                androidText(language, "Coins", "Munten"),
                coins,
                Modifier.weight(1f),
            )
            Box(contentAlignment = Alignment.CenterEnd) {
                when {
                    deltaMs == null -> TrackRowMissing()
                    leader -> Mk8dxChip(androidText(language, "Leader", "Leider"), tone = Mk8dxChipTone.Neutral)
                    isReference -> Mk8dxChip(androidText(language, "Your time", "Jouw tijd"), tone = Mk8dxChipTone.Neutral)
                    else -> Text(
                        Mk8dxNumeric.formatDelta(deltaMs),
                        style = type.dataS.copy(fontWeight = FontWeight.SemiBold),
                        color = if (deltaMs < 0) colors.deltaFaster else colors.deltaSlower,
                        softWrap = false,
                        maxLines = 1,
                    )
                }
            }
        }
        if (details != null && expanded) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(start = Mk8dxSpacing.lg, end = Mk8dxSpacing.xs, top = Mk8dxSpacing.xs)
                    .background(colors.surfaceControl)
                    .border(1.dp, colors.borderSubtle)
                    .padding(Mk8dxSpacing.sm)
                    .testTag("track-row-details"),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            ) {
                details()
            }
        }
    }
}

@Composable
private fun TrackRowCellLabel(text: String) {
    Text(
        text,
        style = Mk8dxTheme.type.micro,
        color = Mk8dxTheme.colors.textTertiary,
        softWrap = false,
        maxLines = 1,
    )
}

@Composable
private fun TrackRowMissing(modifier: Modifier = Modifier) {
    Text("–", style = Mk8dxTheme.type.dataS, color = Mk8dxTheme.colors.textTertiary, maxLines = 1, modifier = modifier)
}

/** The per-lap pattern cell: an item icon and "1-1-1" / "8-2-0". */
@Composable
private fun TrackRowPattern(
    iconPath: String,
    description: String,
    pattern: String?,
    modifier: Modifier = Modifier,
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        ProductAssetImage(
            path = iconPath,
            fallback = "",
            accent = Color.Transparent,
            modifier = Modifier.size(14.dp),
            contentDescription = description,
        )
        if (pattern == null) {
            TrackRowMissing()
        } else {
            Text(
                pattern,
                style = Mk8dxTheme.type.dataS,
                color = Mk8dxTheme.colors.textTertiary,
                softWrap = false,
                maxLines = 1,
            )
        }
    }
}

/**
 * The Web's video mark: a small outlined frame with a play triangle, sized for
 * a finger rather than a mouse.
 */
@Composable
private fun TrackRowVideoMark(
    videoUrl: String,
    playerName: String,
    onOpenVideo: (String) -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val label = androidText(language, "Watch $playerName's run on YouTube", "Bekijk de rit van $playerName op YouTube")
    Box(
        Modifier.size(Mk8dxSpacing.targetMin)
            .clickable(role = Role.Button, onClickLabel = label) { onOpenVideo(videoUrl) }
            .semantics { contentDescription = label }
            .testTag("track-board-video"),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Mk8dxIcons.Play,
            contentDescription = null,
            tint = Mk8dxTheme.colors.statusInfo,
            modifier = Modifier.size(18.dp),
        )
    }
}

/** Which client recorded the result, as the Web's evidence cell says it. */
@Composable
private fun TrackRowSourceMark(sourceKind: String?) {
    val mark = when {
        sourceKind == null -> null
        sourceKind.startsWith("android_") ->
            nl.mariokart8.mk8dxtimetrials.R.drawable.ic_android_platform to "Android evidence"
        sourceKind.startsWith("livetrial_") ->
            nl.mariokart8.mk8dxtimetrials.R.drawable.ic_windows_platform to "Windows evidence"
        sourceKind == "web_manual" ->
            nl.mariokart8.mk8dxtimetrials.R.drawable.ic_web_platform to "Web evidence"
        else -> null
    }
    if (mark == null) {
        TrackRowMissing()
    } else {
        Icon(
            painterResource(mark.first),
            contentDescription = mark.second,
            tint = Color.Unspecified,
            modifier = Modifier.size(14.dp),
        )
    }
}

/** The client that recorded a result, as the Details name it. */
internal fun androidSourceLabel(sourceKind: String?): String? = when {
    sourceKind == null -> null
    sourceKind.startsWith("android_") -> "Android"
    sourceKind.startsWith("livetrial_") -> "Windows"
    sourceKind == "web_manual" -> "Web"
    else -> null
}

/** The Web's compact age: 1d under a week, then 3w, 9mo, 1y. */
internal fun androidCompactAge(atMs: Long, nowMs: Long): String? {
    if (atMs <= 0L) return null
    return androidCompactAgeFromDays(maxOf(0L, (nowMs - atMs) / 86_400_000L))
}

internal fun androidCompactAgeFromDays(days: Long): String = when {
    days < 7 -> "${days}d"
    days < 35 -> "${days / 7}w"
    days < 365 -> "${days / 30}mo"
    else -> "${days / 365}y"
}

/** "1-1-1" for a three-lap track, "–" for a lap that was never recorded. */
internal fun androidLapPattern(values: List<Int?>, segmentCount: Int): String? {
    if (values.all { it == null }) return null
    if (segmentCount > 4) {
        return if (values.any { it == null }) null else values.filterNotNull().sum().toString()
    }
    return (0 until segmentCount).joinToString("-") { index ->
        values.getOrNull(index)?.toString() ?: "–"
    }
}

@Composable
private fun WorldRecordHolderRow(
    holder: AndroidWorldRecordHolder,
    totalTimeMs: Long,
    referenceTimeMs: Long?,
    rankWidth: androidx.compose.ui.unit.Dp,
    openUri: (String) -> Unit,
    onOpenCombo: ((List<String>) -> Unit)? = null,
) {
    val buildIds = androidBuildIdsForNames(
        holder.characterName, holder.bodyName, holder.tireName, holder.gliderName,
    )
    TrackContextRow(
        rankText = "WR",
        rank = null,
        player = holder.playerName,
        timeMs = totalTimeMs,
        deltaMs = referenceTimeMs?.let { totalTimeMs - it },
        kind = AndroidTrackRowKind.WORLD_RECORD,
        rankWidth = rankWidth,
        countryId = androidCountryIdForNation(holder.nationName),
        mushrooms = androidLapPattern(
            holder.mushroomsPerLap.map { it },
            holder.lapTimesMs.size.coerceAtLeast(3),
        ),
        coins = androidLapPattern(
            holder.coinsPerLap.map { it },
            holder.lapTimesMs.size.coerceAtLeast(3),
        ),
        age = holder.durationDays?.let { days -> androidCompactAgeFromDays(days.toLong()) },
        buildIds = buildIds,
        buildParts = buildIds.map(::androidBuildPartPresentation),
        videoUrl = holder.videoUrl,
        onOpenVideo = openUri,
        onOpenCombo = onOpenCombo,
        details = {
            ReferenceDetails(
                buildIds.map(::androidBuildPartPresentation), holder.lapTimesMs, holder.coinsPerLap, holder.mushroomsPerLap,
                fallbackBuild = listOfNotNull(holder.characterName, holder.bodyName, holder.tireName, holder.gliderName),
            )
        },
    )
}

@Composable
private fun TrackResultDetails(
    result: AndroidPublicTimeTrialResult,
    viewerBest: AndroidPublicTimeTrialResult?,
    buildParts: List<Pair<String, String>?>,
    onShareRun: (() -> Unit)? = null,
    onEdit: (() -> Unit)? = null,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val build = buildParts.mapNotNull { it?.second }
    androidSourceLabel(result.sourceKind)?.let { label ->
        Row(
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.testTag("track-row-source"),
        ) {
            Text(androidText(language, "Recorded with", "Vastgelegd met"), style = Mk8dxTheme.type.micro, color = colors.textSecondary)
            TrackRowSourceMark(result.sourceKind)
            Text(label, style = Mk8dxTheme.type.bodyS, color = colors.textBody)
        }
    }
    if (viewerBest != null && viewerBest.resultId != result.resultId) {
        val delta = result.totalTimeMs - viewerBest.totalTimeMs
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                androidText(language, "Compared with your PB", "Vergeleken met jouw PR"),
                style = Mk8dxTheme.type.bodyS,
                color = colors.textSecondary,
                modifier = Modifier.weight(1f),
            )
            Text(
                Mk8dxNumeric.formatDelta(delta),
                style = Mk8dxTheme.type.dataS.copy(fontWeight = FontWeight.SemiBold),
                color = androidDeltaTokenColor(delta),
            )
        }
    }
    if (build.isNotEmpty()) {
        AndroidPartLines(buildParts, Modifier.padding(top = Mk8dxSpacing.xs))
    }
    // Your own row is not compared with itself (every lap ±0.000), as on the Web.
    val viewerLaps = if (viewerBest?.resultId == result.resultId) emptyMap()
    else viewerBest?.laps.orEmpty().associateBy { it.lapNumber }
    val sortedLaps = result.laps.sortedBy { it.lapNumber }
    val gains = androidLapCoinGains(sortedLaps.map { it.coinsCollected })
    sortedLaps.forEachIndexed { index, lap ->
        val viewerLap = viewerLaps[lap.lapNumber]
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                androidText(language, "Lap ${lap.lapNumber}", "Ronde ${lap.lapNumber}"),
                style = Mk8dxTheme.type.micro,
                color = colors.textSecondary,
            )
            Text(
                Mk8dxNumeric.formatTime(lap.timeMs),
                style = Mk8dxTheme.type.dataS,
                color = colors.textPrimary,
            )
            viewerLap?.let {
                val lapDelta = lap.timeMs - it.timeMs
                Text(
                    Mk8dxNumeric.formatDelta(lapDelta),
                    style = Mk8dxTheme.type.dataS,
                    color = androidDeltaTokenColor(lapDelta),
                )
            }
            Text(
                androidText(
                    language,
                    "coins ${gains.getOrNull(index) ?: "—"} · mushrooms ${lap.mushroomsUsed ?: "—"}",
                    "munten ${gains.getOrNull(index) ?: "—"} · paddenstoelen ${lap.mushroomsUsed ?: "—"}",
                ),
                style = Mk8dxTheme.type.micro,
                color = colors.textSecondary,
                modifier = Modifier.weight(1f),
            )
        }
    }
    if (onShareRun != null || onEdit != null) {
        Row(
            Modifier.padding(top = Mk8dxSpacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Share run (owner 2026-09-29) replaced Open run: the run as a picture with its link.
            onShareRun?.let {
                Mk8dxButton(
                    androidText(language, "Share run", "Rit delen"),
                    it,
                    variant = Mk8dxButtonVariant.Secondary,
                    size = Mk8dxButtonSize.Sm,
                    tag = "track-row-share-run",
                )
            }
            onEdit?.let {
                Mk8dxEditAction(androidText(language, "Edit", "Bewerken"), it, tag = "track-row-edit")
            }
        }
    }
}

/**
 * The World Record feed names its parts rather than identifying them, so the
 * board resolves those names against the catalog the way the Web's
 * worldRecordComboCell does. All four have to resolve: a partial combo is not
 * the combo that drove the record.
 */
internal fun androidBuildIdsForNames(
    characterName: String?,
    bodyName: String?,
    tireName: String?,
    gliderName: String?,
): List<String> = listOf(
    characterName to AndroidBuildPartCategory.CHARACTER,
    bodyName to AndroidBuildPartCategory.BODY,
    tireName to AndroidBuildPartCategory.TIRE,
    gliderName to AndroidBuildPartCategory.GLIDER,
).map { (name, category) ->
    androidBuildIdForName(name, category) ?: return emptyList()
}

/**
 * The icon and name for a part id. A colour variant such as
 * "character_variant.yoshi.023_pink" is not in the base catalog, so resolving
 * only against that catalog drew the World Record's character as a blank
 * fallback circle.
 */
internal fun androidBuildPartPresentation(id: String): Pair<String, String> {
    AndroidLoadoutCatalog.find(id)?.let { return it.assetPath to it.name }
    AndroidLoadoutVariants.byId(id)?.let { variant ->
        val base = AndroidLoadoutCatalog.find(variant.baseId)
        return variant.assetPath to (base?.let { "${it.name} · ${variant.name}" } ?: variant.name)
    }
    return "" to id.substringAfter('.').replace('_', ' ')
}

private fun androidSimplifiedPartName(value: String): String =
    value.lowercase().replace(Regex("[^a-z0-9]+"), "")

private fun androidBuildIdForName(name: String?, category: AndroidBuildPartCategory): String? {
    val key = name?.let(::androidSimplifiedPartName)?.takeIf { it.isNotEmpty() } ?: return null
    AndroidLoadoutCatalog.parts(category)
        .firstOrNull { androidSimplifiedPartName(it.name) == key }
        ?.let { return it.id }
    // The record feed writes a colour variant as "Pink Yoshi"; the catalog
    // writes the same part as "Yoshi · Pink". Trying it both ways is what the
    // Web's namedPart does, and it is the difference between showing the combo
    // that set the record and showing a dash.
    val variants = when (category) {
        AndroidBuildPartCategory.CHARACTER -> AndroidLoadoutVariants.characters
        AndroidBuildPartCategory.BODY -> AndroidLoadoutVariants.bodies
        AndroidBuildPartCategory.GLIDER -> AndroidLoadoutVariants.gliders
        AndroidBuildPartCategory.TIRE -> emptyList()
    }
    variants.forEach { variant ->
        val base = AndroidLoadoutCatalog.find(variant.baseId) ?: return@forEach
        val combined = listOf(
            androidSimplifiedPartName(variant.name + base.name),
            androidSimplifiedPartName(base.name + variant.name),
        )
        if (key in combined) return variant.id
    }
    return null
}

internal fun androidCountryIdForNation(nationName: String?): String? = when (nationName?.trim()?.lowercase()) {
    "australia" -> "country.au"
    "canada" -> "country.ca"
    "colombia" -> "country.co"
    "france" -> "country.fr"
    "germany" -> "country.de"
    "japan" -> "country.jp"
    "netherlands", "the netherlands" -> "country.nl"
    "norway" -> "country.no"
    "spain" -> "country.es"
    "uk", "united kingdom", "great britain" -> "country.gb"
    "usa", "united states", "united states of america" -> "country.us"
    else -> null
}

/** Coins gained per lap from the HUD balances (ADR-0001): the first lap starts at zero. */
internal fun androidLapCoinGains(balances: List<Int?>): List<Int?> {
    var previous: Int? = 0
    return balances.map { balance ->
        val gain = if (balance == null || previous == null) null else balance - previous!!
        previous = balance
        gain
    }
}

/** The ghost reading of exactly this reference: the same kind and the same total time. */
internal fun androidReadingFor(
    readings: List<AndroidReferenceGhostReading>,
    kind: String,
    totalTimeMs: Long,
): AndroidReferenceGhostReading? = readings.firstOrNull { it.kind == kind && it.totalTimeMs == totalTimeMs }

/** What the reference knows, else what its ghost reading adds; never a replacement (ADR-0212). */
internal fun <T> androidFilledLaps(known: List<T>?, read: List<T>?): List<T>? =
    known?.takeIf { it.isNotEmpty() } ?: read?.takeIf { it.isNotEmpty() } ?: known

internal fun androidBenchmarkWithReading(
    benchmark: nl.mariokart8.mk8dxtimetrials.track.AndroidTrackBenchmark,
    readings: List<AndroidReferenceGhostReading>,
): nl.mariokart8.mk8dxtimetrials.track.AndroidTrackBenchmark {
    val kind = if (benchmark.kind == AndroidBenchmarkKind.WORLD_RECORD) "world_record" else "nintendo_staff"
    val reading = androidReadingFor(readings, kind, benchmark.timeMs) ?: return benchmark
    return benchmark.copy(
        lapTimesMs = androidFilledLaps(benchmark.lapTimesMs, reading.lapTimesMs),
        coinsPerLap = androidFilledLaps(benchmark.coinsPerLap, reading.coinsPerLap),
        mushroomsPerLap = androidFilledLaps(benchmark.mushroomsPerLap, reading.mushroomsPerLap),
    )
}

internal fun androidHolderWithReading(
    holder: AndroidWorldRecordHolder,
    reading: AndroidReferenceGhostReading?,
): AndroidWorldRecordHolder = if (reading == null) {
    holder
} else {
    holder.copy(
        lapTimesMs = androidFilledLaps(holder.lapTimesMs, reading.lapTimesMs).orEmpty(),
        coinsPerLap = androidFilledLaps(holder.coinsPerLap, reading.coinsPerLap).orEmpty(),
        mushroomsPerLap = androidFilledLaps(holder.mushroomsPerLap, reading.mushroomsPerLap).orEmpty(),
    )
}

/** A reference's Details, like a Player's: the kart setup, then each lap with its coins and mushrooms. */
@Composable
private fun ReferenceDetails(
    buildParts: List<Pair<String, String>>,
    lapTimesMs: List<Long>,
    coinsPerLap: List<Int>,
    mushroomsPerLap: List<Int>,
    fallbackBuild: List<String> = emptyList(),
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    if (buildParts.isNotEmpty()) {
        AndroidPartLines(buildParts, Modifier.padding(top = Mk8dxSpacing.xs))
    } else if (fallbackBuild.isNotEmpty()) {
        AndroidPartLines(fallbackBuild.map { "" to it }, Modifier.padding(top = Mk8dxSpacing.xs))
    }
    lapTimesMs.forEachIndexed { index, lap ->
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                androidText(language, "Lap ${index + 1}", "Ronde ${index + 1}"),
                style = Mk8dxTheme.type.micro,
                color = colors.textSecondary,
            )
            Text(Mk8dxNumeric.formatTime(lap), style = Mk8dxTheme.type.dataS, color = colors.textPrimary)
            Text(
                androidText(
                    language,
                    "coins ${coinsPerLap.getOrNull(index) ?: "—"} · mushrooms ${mushroomsPerLap.getOrNull(index) ?: "—"}",
                    "munten ${coinsPerLap.getOrNull(index) ?: "—"} · paddenstoelen ${mushroomsPerLap.getOrNull(index) ?: "—"}",
                ),
                style = Mk8dxTheme.type.micro,
                color = colors.textSecondary,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

private data class TrackContextDisplayRow(
    val timeMs: Long,
    val human: AndroidPublicTimeTrialResult? = null,
    val benchmark: nl.mariokart8.mk8dxtimetrials.track.AndroidTrackBenchmark? = null,
)
