package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidDisambiguatedName
import nl.mariokart8.mk8dxtimetrials.ui.androidRepeatedDisplayNames
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.track.AndroidCupCatalogEntry
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.track.TrackAssetArtwork
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxArtHero
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxColumnFilter
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisclosure
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSortDirection
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSortHeader
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatBlock
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * "Alle races tot nu toe", on the phone.
 *
 * The site's section, in the site's order: what the community has raced in
 * totals, the curve of who was there, the cups and the tracks with the game's
 * own art, the full table of every track raced, and a track's own TrueSkill on
 * a page of its own. The numbers are the server's - one reading, the same one
 * the site asks for - so the two clients cannot say different things about the
 * same nine nights.
 *
 * It is a section rather than a drawer, and it pages itself in behind the
 * night list: the overview already asks for several documents, and the host
 * allows about five requests a second per address.
 *
 * Phase 11 (A06) put it on the design system. Statistics is the LOW-spectacle
 * end of the Tournaments tab: calm panels, tabular figures, sortable heads,
 * and no colour doing a label's work.
 */
@Composable
internal fun AndroidTournamentStatisticsSection(
    client: AndroidTournamentClient?,
    dutch: Boolean,
    request: AndroidTournamentRequest? = null,
    /** From a track's own rating on to the time trials driven on it. */
    onOpenTrack: ((String) -> Unit)? = null,
    /** Who is reading: their own line in a track's standing is marked. */
    viewerPlayerId: String? = null,
    /** Where that line landed inside this section, so the page can go to it. */
    onViewerRowPlaced: ((String, Int) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    var statistics by remember(client) { mutableStateOf<AndroidTournamentStatistics?>(null) }
    var failure by remember(client) { mutableStateOf(false) }
    var sort by remember(client) { mutableStateOf(AndroidStatisticsSort.RACES) }
    var ascending by remember(client) { mutableStateOf(false) }
    var filters by remember(client) { mutableStateOf(emptyMap<String, String>()) }
    var allTracksOpen by remember(client) { mutableStateOf(false) }
    var allCupsOpen by remember(client) { mutableStateOf(false) }
    var openTrackId by remember(client) { mutableStateOf<String?>(null) }
    var skill by remember(client) { mutableStateOf<AndroidTrackSkill?>(null) }
    var skillFailure by remember(client) { mutableStateOf(false) }

    LaunchedEffect(client) {
        val active = client ?: return@LaunchedEffect
        runCatching { withContext(Dispatchers.IO) { active.statistics() } }
            .onSuccess { statistics = it; failure = false }
            .onFailure {
                android.util.Log.w("mk8dx-tournaments", "statistics failed", it)
                failure = true
            }
    }

    // A shared address opens exactly what the sender was looking at.
    LaunchedEffect(request) {
        val asked = request ?: return@LaunchedEffect
        if (!asked.statistics) return@LaunchedEffect
        // A link that names a column, a filter or a track is a link about the
        // table, so the table is open when it lands - the same rule the site
        // uses to decide the panel was asked for.
        AndroidStatisticsSort.parse(asked.statisticsSort)?.let {
            sort = it
            allTracksOpen = true
        }
        ascending = asked.statisticsAscending
        if (asked.statisticsFilters.isNotEmpty()) {
            filters = asked.statisticsFilters
            allTracksOpen = true
        }
        asked.statisticsFocus?.let {
            openTrackId = it
            allTracksOpen = true
        }
    }

    LaunchedEffect(openTrackId, client) {
        val active = client
        val trackId = openTrackId
        skill = null
        skillFailure = false
        if (active == null || trackId == null) return@LaunchedEffect
        runCatching { withContext(Dispatchers.IO) { active.trackSkill(trackId) } }
            .onSuccess { skill = it }
            .onFailure {
                android.util.Log.w("mk8dx-tournaments", "track skill failed", it)
                skillFailure = true
            }
    }

    val counted = statistics
    Column(
        modifier.fillMaxWidth().testTag("tournament-statistics"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Mk8dxSectionLabel(
            (if (dutch) "Alle races tot nu toe" else "Every race so far").uppercase(),
        )
        if (counted == null) {
            when {
                failure -> Mk8dxStatusMessage(
                    if (dutch) {
                        "De statistieken zijn tijdelijk niet beschikbaar."
                    } else {
                        "The statistics are temporarily unavailable."
                    },
                    tone = Mk8dxStatusTone.Error,
                )
                else -> Mk8dxMetaLine(if (dutch) "Tellen…" else "Counting…")
            }
            return@Column
        }
        val open = openTrackId
        if (open != null) {
            TrackSkillPage(
                trackId = open,
                skill = skill,
                failed = skillFailure,
                dutch = dutch,
                onBack = { openTrackId = null },
                onOpenTrack = onOpenTrack,
                viewerPlayerId = viewerPlayerId,
                onViewerRowPlaced = onViewerRowPlaced,
            )
            return@Column
        }

        Totals(counted, dutch)
        GrowthChart(counted.editions, dutch)
        CupTiles(
            counted.tracks, dutch,
            allOpen = allCupsOpen,
            onToggleAll = { allCupsOpen = !allCupsOpen },
        )
        TrackTiles(counted.tracks, dutch, onOpenTrack = { openTrackId = it })
        val rows = remember(counted) {
            androidBuildStatisticsRows(counted.tracks) { androidNintendoGhostMs(it) }
        }
        AllTracksBox(
            rows = rows,
            dutch = dutch,
            open = allTracksOpen,
            sort = sort,
            descending = !ascending,
            filters = filters,
            onToggle = { allTracksOpen = !allTracksOpen },
            onSort = { column ->
                if (sort == column) {
                    ascending = !ascending
                } else {
                    sort = column
                    ascending = !(ANDROID_STATISTICS_SORT_OPENS_DESCENDING[column] ?: true)
                }
            },
            onFilter = { key, value ->
                filters = filters.toMutableMap().apply {
                    if (value.isBlank()) remove(key) else put(key, value)
                }
            },
            onOpenTrack = { openTrackId = it },
        )
    }
}

/** Nintendo's own 150cc ghost, which is how long a race on this track takes. */
internal fun androidNintendoGhostMs(trackId: String): Long? =
    AndroidBenchmarkCatalog.forTrack(trackId, 150)
        .firstOrNull { it.kind == AndroidBenchmarkKind.NINTENDO_STAFF }?.timeMs

@Composable
private fun Totals(statistics: AndroidTournamentStatistics, dutch: Boolean) {
    val driverMs = remember(statistics) {
        androidStatisticsDriverMs(statistics.tracks) { androidNintendoGhostMs(it) }
    }
    Mk8dxPanel(title = null) {
        FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xl),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            Mk8dxStatBlock(if (dutch) "Avonden" else "Nights", statistics.totals.editions.toString())
            Mk8dxStatBlock(if (dutch) "Races" else "Races", statistics.totals.races.toString())
            Mk8dxStatBlock(if (dutch) "Spelers" else "Players", statistics.totals.players.toString())
            Mk8dxStatBlock(
                if (dutch) "Banen gereden" else "Tracks raced",
                "${statistics.totals.tracksRaced} / ${Schema9AndroidTrackCatalog.TRACK_COUNT}",
            )
            // Drivers times the ghost of the track they drove: how it is derived
            // is written down, and the tile says the number.
            Mk8dxStatBlock(
                if (dutch) "Totale racetijd" else "Total racing time",
                androidStatisticsSpan(driverMs, dutch),
            )
        }
    }
}

/**
 * Two lines: who was there that night, and everybody who had ever raced one by
 * then. A rule every ten, hairline, and every night's running total printed
 * along the second line - the point of it is how it climbed, and that is the
 * numbers on it.
 */
@Composable
private fun GrowthChart(
    editions: List<AndroidTournamentStatisticsEdition>, dutch: Boolean,
) {
    if (editions.size < 2) return
    val most = remember(editions) {
        maxOf(editions.maxOf { it.cumulativePlayers }, 10)
    }
    val colors = Mk8dxTheme.colors
    val everybody = colors.statusInfo
    val thatNight = colors.statusSuccess
    Mk8dxPanel(title = if (dutch) "Deelnemers per avond" else "Players per night") {
        Canvas(Modifier.fillMaxWidth().height(170.dp)) {
            val left = 26f
            val bottom = size.height - 18f
            val top = 10f
            val stepX = if (editions.size <= 1) 0f else (size.width - left - 8f) / (editions.size - 1)
            fun x(index: Int) = left + stepX * index
            fun y(value: Int) = bottom - (bottom - top) * (value.toFloat() / most)
            for (value in 0..most step 10) {
                drawLine(
                    color = colors.borderSubtle,
                    start = Offset(left, y(value)),
                    end = Offset(size.width - 4f, y(value)),
                    strokeWidth = 1f,
                )
            }
            fun line(values: List<Int>, color: Color) {
                for (index in 0 until values.size - 1) {
                    drawLine(
                        color = color,
                        start = Offset(x(index), y(values[index])),
                        end = Offset(x(index + 1), y(values[index + 1])),
                        strokeWidth = 3f,
                    )
                }
                values.forEachIndexed { index, value ->
                    drawCircle(color, radius = 4f, center = Offset(x(index), y(value)))
                }
            }
            line(editions.map { it.cumulativePlayers }, everybody)
            line(editions.map { it.participantCount }, thatNight)
        }
        // The numbers themselves are text rows under the drawing rather than
        // painted into it: a Canvas cannot lay out text the way the rest of the
        // product does, and a reader on a phone wants them selectable anyway.
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            editions.forEach { edition ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "TN${edition.editionNumber}",
                        style = Mk8dxTheme.type.micro,
                        color = colors.textSecondary,
                    )
                    Text(
                        edition.cumulativePlayers.toString(),
                        style = Mk8dxTheme.type.dataS.copy(fontWeight = FontWeight.SemiBold),
                        color = everybody,
                    )
                    Text(
                        edition.participantCount.toString(),
                        style = Mk8dxTheme.type.dataS.copy(fontWeight = FontWeight.SemiBold),
                        color = thatNight,
                    )
                }
            }
        }
        // The legend used to name the two colours ("Geel", "Cyaan"), which
        // stops being true the moment the appearance changes. It is a swatch
        // beside the words now, so the sentence says what the line means and
        // the colour only shows which line it is.
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        ) {
            ChartLegend(everybody, if (dutch) "Iedereen die ooit meedeed" else "Everybody so far")
            ChartLegend(thatNight, if (dutch) "Die avond" else "That night")
        }
    }
}

@Composable
private fun ChartLegend(color: Color, label: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        modifier = Modifier.semantics(mergeDescendants = true) { },
    ) {
        Box(Modifier.size(width = 14.dp, height = 3.dp).background(color))
        Text(label, style = Mk8dxTheme.type.micro, color = Mk8dxTheme.colors.textSecondary)
    }
}

/** The five most-raced cups on the game's own art, and a box with all of them. */
@Composable
private fun CupTiles(
    tracks: List<AndroidTournamentStatisticsTrack>,
    dutch: Boolean,
    allOpen: Boolean,
    onToggleAll: () -> Unit,
) {
    val totals = remember(tracks) { androidCupTotals(tracks) }
    if (totals.isEmpty()) return
    val colors = Mk8dxTheme.colors
    Mk8dxSectionLabel(if (dutch) "Meest gereden cups" else "Most raced cups")
    FlowRow(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        totals.take(5).forEach { (cup, races) ->
            Column(
                Modifier
                    .width(96.dp)
                    .background(colors.surfaceRaised)
                    .border(1.dp, colors.borderSubtle)
                    .padding(Mk8dxSpacing.sm)
                    .semantics(mergeDescendants = true) { },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            ) {
                ProductAssetImage(
                    path = "private-product/img/cup/${cup.index}.png",
                    fallback = cup.displayName.take(1),
                    accent = colors.textSecondary,
                    modifier = Modifier.size(40.dp),
                )
                Text(
                    cup.displayName,
                    style = Mk8dxTheme.type.micro,
                    color = colors.textPrimary,
                )
                Text(
                    if (dutch) "$races races" else "$races races",
                    style = Mk8dxTheme.type.dataS,
                    color = colors.textSecondary,
                )
            }
        }
    }
    Mk8dxDisclosure(
        label = if (dutch) "Alle cups (${totals.size})" else "All cups (${totals.size})",
        open = allOpen,
        onToggle = onToggleAll,
    )
    if (allOpen) {
        Column(
            Modifier.fillMaxWidth().padding(start = Mk8dxSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        ) {
            totals.forEach { (cup, races) ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = Mk8dxSpacing.targetMinDense)
                        .semantics(mergeDescendants = true) { },
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(cup.displayName, style = Mk8dxTheme.type.body, color = colors.textBody)
                    Text(
                        "$races",
                        style = Mk8dxTheme.type.data,
                        color = colors.textPrimary,
                        softWrap = false, maxLines = 1,
                    )
                }
            }
        }
    }
}

/** Races per cup, most first - one row per cup that was ever raced. */
internal fun androidCupTotals(
    tracks: List<AndroidTournamentStatisticsTrack>,
): List<Pair<AndroidCupCatalogEntry, Int>> {
    val races = tracks.associate { it.trackId to it.races }
    return Schema9AndroidTrackCatalog.cups
        .map { cup -> cup to cup.tracks.sumOf { races[it.id] ?: 0 } }
        .filter { it.second > 0 }
        .sortedByDescending { it.second }
}

@Composable
private fun TrackTiles(
    tracks: List<AndroidTournamentStatisticsTrack>,
    dutch: Boolean,
    onOpenTrack: (String) -> Unit,
) {
    val top = remember(tracks) { tracks.sortedByDescending { it.races }.take(5) }
    if (top.isEmpty()) return
    val colors = Mk8dxTheme.colors
    Mk8dxSectionLabel(if (dutch) "Meest gereden banen" else "Most raced tracks")
    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        top.forEach { track ->
            val entry = Schema9AndroidTrackCatalog.find(track.trackId)
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 62.dp)
                    .border(1.dp, colors.borderSubtle)
                    .clickable(role = Role.Button) { onOpenTrack(track.trackId) }
                    .semantics(mergeDescendants = true) { },
            ) {
                if (entry != null) {
                    TrackAssetArtwork(
                        trackIndex = entry.index,
                        modifier = Modifier.fillMaxWidth().height(62.dp),
                        contentDescription = null,
                    )
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(62.dp)
                        .background(colors.surfaceApp.copy(alpha = 0.82f)),
                )
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 62.dp)
                        .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        entry?.displayName ?: track.trackId,
                        style = Mk8dxTheme.type.body.copy(fontWeight = FontWeight.SemiBold),
                        color = colors.textPrimary,
                    )
                    Text(
                        "${track.races}x",
                        style = Mk8dxTheme.type.dataM,
                        color = colors.textPrimary,
                        softWrap = false, maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun AllTracksBox(
    rows: List<AndroidStatisticsRow>,
    dutch: Boolean,
    open: Boolean,
    sort: AndroidStatisticsSort,
    descending: Boolean,
    filters: Map<String, String>,
    onToggle: () -> Unit,
    onSort: (AndroidStatisticsSort) -> Unit,
    onFilter: (String, String) -> Unit,
    onOpenTrack: (String) -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Mk8dxDisclosure(
        label = if (dutch) {
            "Alle ${rows.size} gereden banen — sorteer en filter elke kolom"
        } else {
            "All ${rows.size} tracks raced — sort and filter every column"
        },
        open = open,
        onToggle = onToggle,
        modifier = Modifier.testTag("statistics-all-tracks"),
    )
    if (!open) return
    val shown = remember(rows, sort, descending, filters) {
        androidSortStatisticsRows(rows, sort, descending)
            .filter { androidStatisticsRowMatches(it, filters) }
    }
    Mk8dxMetaLine(
        if (shown.size == rows.size) {
            if (dutch) "${rows.size} banen" else "${rows.size} tracks"
        } else {
            if (dutch) "${shown.size} van ${rows.size} banen" else "${shown.size} of ${rows.size} tracks"
        },
    )
    // Six columns do not fit across a phone, so the table scrolls sideways -
    // which is what the site does too, at every width.
    val table = rememberScrollState()
    Column(Modifier.fillMaxWidth().horizontalScroll(table)) {
        Row(
            Modifier.background(colors.surfaceControl),
            verticalAlignment = Alignment.Bottom,
        ) {
            for (column in ANDROID_STATISTICS_COLUMNS) {
                Column(
                    Modifier
                        .width(androidStatisticsColumnWidth(column.sort))
                        .padding(horizontal = Mk8dxSpacing.xs),
                ) {
                    Mk8dxSortHeader(
                        label = androidStatisticsColumnLabel(column.sort, dutch).uppercase(),
                        sorted = if (sort != column.sort) {
                            null
                        } else if (descending) {
                            Mk8dxSortDirection.Descending
                        } else {
                            Mk8dxSortDirection.Ascending
                        },
                        onClick = { onSort(column.sort) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    // A column that can be filtered carries its own box, as on
                    // the site: "> 3" on a number, part of a name on a word.
                    if (column.filter != null) {
                        Mk8dxColumnFilter(
                            label = androidStatisticsColumnLabel(column.sort, dutch),
                            value = filters[column.filter.key].orEmpty(),
                            hint = if (column.numeric) "> 3" else if (dutch) "zoek" else "find",
                            onValueChange = { onFilter(column.filter.key, it.take(40)) },
                            modifier = Modifier.padding(bottom = Mk8dxSpacing.xs),
                        )
                    } else {
                        Spacer(Modifier.height(Mk8dxSpacing.targetMin))
                    }
                }
            }
        }
        shown.forEach { row ->
            Row(
                Modifier
                    .heightIn(min = 44.dp)
                    .clickable(role = Role.Button) { onOpenTrack(row.trackId) }
                    .drawWithContent {
                        drawContent()
                        drawRect(
                            colors.borderSubtle,
                            topLeft = Offset(0f, size.height - 1.dp.toPx()),
                            size = Size(size.width, 1.dp.toPx()),
                        )
                    }
                    .padding(vertical = Mk8dxSpacing.xs)
                    .semantics(mergeDescendants = true) { },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    Modifier
                        .width(androidStatisticsColumnWidth(AndroidStatisticsSort.TRACK))
                        .padding(horizontal = Mk8dxSpacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    row.trackIndex?.let {
                        TrackAssetArtwork(
                            trackIndex = it,
                            modifier = Modifier.width(34.dp).height(20.dp),
                            contentDescription = null,
                        )
                        Spacer(Modifier.width(Mk8dxSpacing.sm))
                    }
                    Text(
                        row.name,
                        style = Mk8dxTheme.type.bodyS,
                        color = colors.textPrimary,
                        maxLines = 2,
                    )
                }
                Row(
                    Modifier
                        .width(androidStatisticsColumnWidth(AndroidStatisticsSort.CUP))
                        .padding(horizontal = Mk8dxSpacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    row.cupIndex?.let {
                        ProductAssetImage(
                            path = "private-product/img/cup/$it.png",
                            fallback = row.cupName.take(1),
                            accent = colors.textSecondary,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(Mk8dxSpacing.xs))
                    }
                    Text(
                        row.cupName,
                        style = Mk8dxTheme.type.bodyS,
                        color = colors.textSecondary,
                        maxLines = 2,
                    )
                }
                StatisticsCell(row.races.toString(), AndroidStatisticsSort.RACES)
                StatisticsCell(row.nights.toString(), AndroidStatisticsSort.NIGHTS)
                StatisticsCell(
                    row.timeMs?.let { androidStatisticsSpan(it, dutch) } ?: "—",
                    AndroidStatisticsSort.TIME,
                )
                StatisticsCell(
                    row.bestPlayerName?.let {
                        "$it · " + String.format(java.util.Locale.US, "%.2f", row.bestScore ?: 0.0)
                    } ?: "—",
                    AndroidStatisticsSort.BEST,
                    numeric = false,
                )
            }
        }
    }
}

@Composable
private fun StatisticsCell(
    text: String,
    column: AndroidStatisticsSort,
    numeric: Boolean = true,
) {
    Text(
        text,
        style = if (numeric) Mk8dxTheme.type.data else Mk8dxTheme.type.bodyS,
        color = Mk8dxTheme.colors.textBody,
        maxLines = 2,
        modifier = Modifier
            .width(androidStatisticsColumnWidth(column))
            .padding(horizontal = Mk8dxSpacing.xs),
    )
}

/**
 * The site's own columns, in its own order, each with its filter.
 *
 * Drivers and the ghost time are what Racing time is made of, not columns of
 * their own: the owner asked for the answer, not its two factors, and the site
 * dropped both in deploy 243. They are still sorted and filtered through the
 * address - `stats_sort=players`, `stats_players=>100` - because the numbers
 * did not go anywhere.
 */
private data class AndroidStatisticsColumn(
    val sort: AndroidStatisticsSort,
    val filter: AndroidStatisticsFilter?,
    val numeric: Boolean,
)

private val ANDROID_STATISTICS_COLUMNS = listOf(
    AndroidStatisticsColumn(AndroidStatisticsSort.TRACK, AndroidStatisticsFilter.TRACK, false),
    AndroidStatisticsColumn(AndroidStatisticsSort.CUP, AndroidStatisticsFilter.CUP, false),
    AndroidStatisticsColumn(AndroidStatisticsSort.RACES, AndroidStatisticsFilter.RACES, true),
    AndroidStatisticsColumn(AndroidStatisticsSort.NIGHTS, AndroidStatisticsFilter.NIGHTS, true),
    AndroidStatisticsColumn(AndroidStatisticsSort.TIME, null, true),
    AndroidStatisticsColumn(AndroidStatisticsSort.BEST, null, false),
)

private fun androidStatisticsColumnWidth(column: AndroidStatisticsSort) = when (column) {
    AndroidStatisticsSort.TRACK -> 190.dp
    AndroidStatisticsSort.CUP -> 130.dp
    AndroidStatisticsSort.BEST -> 150.dp
    AndroidStatisticsSort.TIME -> 100.dp
    AndroidStatisticsSort.GHOST -> 80.dp
    else -> 74.dp
}

private fun androidStatisticsColumnLabel(column: AndroidStatisticsSort, dutch: Boolean) =
    when (column) {
        AndroidStatisticsSort.TRACK -> if (dutch) "Baan" else "Track"
        AndroidStatisticsSort.CUP -> "Cup"
        AndroidStatisticsSort.RACES -> "Races"
        AndroidStatisticsSort.PLAYERS -> if (dutch) "Deelnames" else "Drivers"
        AndroidStatisticsSort.NIGHTS -> if (dutch) "Avonden" else "Nights"
        AndroidStatisticsSort.GHOST -> "Ghost"
        AndroidStatisticsSort.TIME -> if (dutch) "Racetijd" else "Racing time"
        AndroidStatisticsSort.BEST -> if (dutch) "Beste speler" else "Best player"
    }

/**
 * One track's own standing: the product's own engine over that track's races
 * alone, everybody from a Score of zero, no inactivity decay. It is not the
 * general SP and it does not touch it.
 */
@Composable
private fun TrackSkillPage(
    trackId: String,
    skill: AndroidTrackSkill?,
    failed: Boolean,
    dutch: Boolean,
    onBack: () -> Unit,
    onOpenTrack: ((String) -> Unit)? = null,
    viewerPlayerId: String? = null,
    onViewerRowPlaced: ((String, Int) -> Unit)? = null,
) {
    val entry = Schema9AndroidTrackCatalog.find(trackId)
    val colors = Mk8dxTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
        Mk8dxButton(
            if (dutch) "← Terug naar alle races" else "← Back to every race",
            onBack,
            variant = Mk8dxButtonVariant.Quiet,
            size = Mk8dxButtonSize.Sm,
            tag = "statistics-track-back",
        )
        // A track is MEDIUM: its own art as a hero strip, no backdrop behind
        // the table that follows.
        Mk8dxArtHero(
            title = entry?.displayName ?: trackId,
            meta = if (dutch) {
                "TrueSkill op deze baan alleen, iedereen begint op 0."
            } else {
                "TrueSkill on this track alone, everybody starts at 0."
            },
            backdrop = entry != null,
            art = entry?.let { found ->
                {
                    TrackAssetArtwork(
                        trackIndex = found.index,
                        modifier = Modifier.fillMaxSize(),
                        contentDescription = null,
                    )
                }
            },
        )
        // The tournament side of this track is what this page is; the time
        // trials on it are one tap away, the order the site follows.
        onOpenTrack?.let { open ->
            Mk8dxButton(
                if (dutch) {
                    "Leaderboard (time trials) van ${entry?.displayName ?: trackId} →"
                } else {
                    "Time-trial leaderboard for ${entry?.displayName ?: trackId} →"
                },
                { open(trackId) },
                variant = Mk8dxButtonVariant.Secondary,
                tag = "statistics-track-board",
            )
        }
        when {
            failed -> Mk8dxStatusMessage(
                if (dutch) {
                    "Deze baanstand is tijdelijk niet beschikbaar."
                } else {
                    "This track standing is temporarily unavailable."
                },
                tone = Mk8dxStatusTone.Error,
            )
            skill == null -> Mk8dxMetaLine(if (dutch) "Berekenen…" else "Counting…")
            else -> {
                Mk8dxMetaLine(
                    if (dutch) {
                        "${skill.races} races · ${skill.players.size} spelers"
                    } else {
                        "${skill.races} races · ${skill.players.size} players"
                    },
                )
                // The site's own nine columns, scrolling sideways as they do
                // there: what a Player did on this track, and what the model
                // still does not know about them.
                val table = rememberScrollState()
                Column(Modifier.fillMaxWidth().horizontalScroll(table)) {
                    Row(
                        Modifier
                            .background(colors.surfaceControl)
                            .padding(vertical = Mk8dxSpacing.sm),
                    ) {
                        SkillHeading("#", 40.dp)
                        SkillHeading(if (dutch) "Speler" else "Player", 130.dp)
                        SkillHeading(if (dutch) "Baan-SP" else "Track SP", 76.dp)
                        SkillHeading("Races", 60.dp)
                        SkillHeading(if (dutch) "Winst" else "Wins", 60.dp)
                        SkillHeading("Top 3", 60.dp)
                        SkillHeading(if (dutch) "Gemiddeld" else "Average", 84.dp)
                        SkillHeading(if (dutch) "Beste" else "Best", 60.dp)
                        SkillHeading(if (dutch) "Zekerheid" else "Certainty", 84.dp)
                    }
                    // Your own line, marked and carried into view: on a
                    // track with forty names the reader should not have to
                    // hunt for themselves (owner, 2026-09-16).
                    val mine = skill.players.firstOrNull {
                        viewerPlayerId != null && it.playerId == viewerPlayerId
                    }
                    val repeatedNames = androidRepeatedDisplayNames(skill.players.map { it.playerId to it.displayName })
                    skill.players.forEach { player ->
                        val isYou = mine != null && player.playerId == mine.playerId
                        Row(
                            Modifier
                                .let { base ->
                                    if (onViewerRowPlaced == null || !isYou) base
                                    else base.onGloballyPositioned { placed ->
                                        onViewerRowPlaced(trackId, placed.positionInRoot().y.toInt())
                                    }
                                }
                                // Marked the way every table in the product
                                // marks your own row: the volt wash, a 4 dp
                                // volt edge, and the rank and the name in it.
                                .heightIn(min = Mk8dxSpacing.targetMinDense)
                                .background(if (isYou) colors.personalWash else Color.Transparent)
                                .drawWithContent {
                                    drawContent()
                                    if (isYou) {
                                        drawRect(colors.personalEdge, size = Size(4.dp.toPx(), size.height))
                                    }
                                }
                                .padding(vertical = Mk8dxSpacing.xs)
                                .semantics(mergeDescendants = true) { },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            SkillCell("#${player.rank}", 40.dp, if (isYou) colors.personalAccent else colors.textSecondary)
                            SkillCell(
                                androidDisambiguatedName(player.displayName, player.username, repeatedNames),
                                130.dp,
                                if (isYou) colors.personalAccent else colors.textPrimary,
                                numeric = false,
                            )
                            SkillCell(androidStatisticsDecimal(player.score, dutch), 76.dp, colors.textPrimary)
                            SkillCell(player.races.toString(), 60.dp)
                            SkillCell(player.wins.toString(), 60.dp)
                            SkillCell(player.top3.toString(), 60.dp)
                            SkillCell(androidStatisticsDecimal(player.averageFinish, dutch), 84.dp)
                            SkillCell(player.bestFinish.toString(), 60.dp)
                            SkillCell("± " + androidStatisticsDecimal(player.sigma, dutch), 84.dp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SkillHeading(label: String, width: androidx.compose.ui.unit.Dp) {
    Text(
        label.uppercase(),
        style = Mk8dxTheme.type.micro.copy(fontWeight = FontWeight.Bold),
        color = Mk8dxTheme.colors.textSecondary,
        modifier = Modifier.width(width).padding(horizontal = Mk8dxSpacing.xs),
    )
}

@Composable
private fun SkillCell(
    text: String,
    width: androidx.compose.ui.unit.Dp,
    color: Color = Mk8dxTheme.colors.textSecondary,
    numeric: Boolean = true,
) {
    Text(
        text,
        style = if (numeric) Mk8dxTheme.type.data else Mk8dxTheme.type.bodyS,
        color = color,
        maxLines = 1,
        modifier = Modifier.width(width).padding(horizontal = Mk8dxSpacing.xs),
    )
}

/** "24,52" in Dutch, "24.52" in English - the site's own reading. */
internal fun androidStatisticsDecimal(value: Double, dutch: Boolean): String {
    val text = String.format(java.util.Locale.US, "%.2f", value)
    return if (dutch) text.replace('.', ',') else text
}
