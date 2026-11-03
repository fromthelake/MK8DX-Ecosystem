package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.clickable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.track.TrackIdentityArtwork
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTierChip

/**
 * Where a Player is strong and where they should practise, on the phone.
 *
 * The same measure as the Web: a track is stated against that player's own
 * average finish as a share of the field, not as a raw average. Sixth place
 * means one thing in a group of twelve and another in a group of ten, and
 * something else again depending on which division somebody was in that
 * season - so "20% better than your usual" survives a move between divisions
 * where "average finish 3.1" does not.
 *
 * Two short lists rather than one long ranking, because a phone has room for
 * an answer and not for a table, and the question is really two questions.
 */

/** Below this a track has not been raced often enough to mean anything. */
internal const val ANDROID_MINIMUM_RACES_FOR_A_VERDICT = 3

private const val LIST_LENGTH = 4

internal fun androidTrackVerdict(
    share: Double, language: AndroidProductLanguage,
): String {
    val percent = Math.round(Math.abs(share) * 100).toInt()
    if (percent == 0) return androidText(language, "on par", "gelijk")
    return if (share < 0) {
        androidText(language, "$percent% better", "$percent% beter")
    } else {
        androidText(language, "$percent% worse", "$percent% slechter")
    }
}

internal fun androidTrackDisplayName(trackId: String): String =
    Schema9AndroidTrackCatalog.find(trackId)?.displayName ?: trackId

internal fun androidTrackIndex(trackId: String): Int? =
    Schema9AndroidTrackCatalog.find(trackId)?.index

/**
 * The share of the field a player finished ahead of, as a percentage: first is
 * 100, last is 0. A field of ten scores the same as a field of twelve, so
 * tenth of ten, eleventh of eleven and twelfth of twelve are all zero. The Web
 * states it the same way.
 */
internal fun androidWinPercentage(averageFieldShare: Double): Int =
    Math.round((1.0 - averageFieldShare) * 100).toInt()

/** Every track in the game, whether it was raced or not, in cup order. */
internal fun androidAllTrackRows(
    tracks: List<AndroidTournamentTrack>,
): List<AndroidTrackRow> {
    val raced = tracks.associateBy { it.trackId }
    val cupOf = Schema9AndroidTrackCatalog.cups
        .flatMap { cup -> cup.tracks.map { it.id to cup.displayName } }
        .toMap()
    return Schema9AndroidTrackCatalog.entries.map { entry ->
        val track = raced[entry.id]
        AndroidTrackRow(
            trackId = entry.id,
            trackIndex = entry.index,
            name = entry.displayName,
            races = track?.races ?: 0,
            wins = track?.wins ?: 0,
            winPercentage = track?.let { androidWinPercentage(it.averageFieldShare) },
            bestFinish = track?.bestFinish,
            averageFinish = track?.averageFinish,
            cupName = cupOf[entry.id] ?: "",
        )
    }
}

internal data class AndroidTrackRow(
    val trackId: String,
    val trackIndex: Int,
    val name: String,
    val races: Int,
    val wins: Int,
    /** Null where the track has never been raced. */
    val winPercentage: Int?,
    val bestFinish: Int?,
    val averageFinish: Double?,
    /** The cup the track belongs to, which is how a reader looks for it. */
    val cupName: String = "",
)

internal enum class AndroidTrackSort { TRACK, RACES, WINS, BEST, AVERAGE, WIN }

/**
 * The colour a win percentage reads in: 100 light green, 50 yellow, 0 red -
 * one hue sweep, so 75 is yellow-green and 25 orange. The same sweep the Web
 * uses, expressed as HSL and converted, so the two clients tint a figure
 * identically rather than approximately.
 */
internal fun androidWinPercentageColor(percentage: Int): Color {
    val bounded = percentage.coerceIn(0, 100)
    return Color.hsl(hue = bounded * 1.2f, saturation = 0.78f, lightness = 0.68f)
}

/** A track matches a typed filter on its name or its cup. */
internal fun androidTrackMatches(row: AndroidTrackRow, query: String): Boolean {
    val trimmed = query.trim()
    if (trimmed.isEmpty()) return true
    return row.name.contains(trimmed, ignoreCase = true) ||
        row.cupName.contains(trimmed, ignoreCase = true)
}

/**
 * One filter box per column, as the site has it. Track and Cup match on
 * "contains"; the number columns read an operator in front of a number -
 * `> 3`, `<= 2`, `= 1`, `<> 0` - and a bare number means "equals". A track
 * with no value in that column (never raced, no recorded finish) never matches
 * a number filter, so filtering on Win % hides the unraced tracks by itself.
 */
internal data class AndroidTrackFilters(
    val track: String = "",
    val cup: String = "",
    val races: String = "",
    val wins: String = "",
    val best: String = "",
    val average: String = "",
    val win: String = "",
) {
    fun of(column: AndroidTrackSort): String = when (column) {
        AndroidTrackSort.TRACK -> track
        AndroidTrackSort.RACES -> races
        AndroidTrackSort.WINS -> wins
        AndroidTrackSort.BEST -> best
        AndroidTrackSort.AVERAGE -> average
        AndroidTrackSort.WIN -> win
    }

    fun with(column: AndroidTrackSort, value: String): AndroidTrackFilters = when (column) {
        AndroidTrackSort.TRACK -> copy(track = value)
        AndroidTrackSort.RACES -> copy(races = value)
        AndroidTrackSort.WINS -> copy(wins = value)
        AndroidTrackSort.BEST -> copy(best = value)
        AndroidTrackSort.AVERAGE -> copy(average = value)
        AndroidTrackSort.WIN -> copy(win = value)
    }
}

internal data class AndroidNumericFilter(val operator: String, val value: Double)

private val NUMERIC_FILTER =
    Regex("^\\s*(>=|<=|<>|!=|=|>|<)?\\s*(-?\\d+(?:[.,]\\d+)?)\\s*%?\\s*$")

/** `>= 3` becomes (">=", 3); `3` becomes ("=", 3); an unreadable box filters nothing. */
internal fun androidParseNumericFilter(text: String): AndroidNumericFilter? {
    val match = NUMERIC_FILTER.find(text) ?: return null
    val value = match.groupValues[2].replace(',', '.').toDoubleOrNull() ?: return null
    if (!value.isFinite()) return null
    val typed = match.groupValues[1]
    val operator = when {
        typed.isEmpty() -> "="
        typed == "!=" -> "<>"
        else -> typed
    }
    return AndroidNumericFilter(operator, value)
}

private fun androidNumericMatches(candidate: Double?, filter: AndroidNumericFilter): Boolean {
    if (candidate == null) return false
    val rounded = Math.round(candidate * 10) / 10.0
    return when (filter.operator) {
        "=" -> rounded == filter.value
        "<>" -> rounded != filter.value
        ">" -> rounded > filter.value
        ">=" -> rounded >= filter.value
        "<" -> rounded < filter.value
        else -> rounded <= filter.value
    }
}

/** The value a number column filters on, or null where the track has none. */
private fun androidFilterValue(row: AndroidTrackRow, column: AndroidTrackSort): Double? =
    when (column) {
        AndroidTrackSort.RACES -> row.races.toDouble()
        AndroidTrackSort.WINS -> row.wins.toDouble()
        AndroidTrackSort.BEST -> row.bestFinish?.toDouble()
        AndroidTrackSort.AVERAGE -> row.averageFinish
        AndroidTrackSort.WIN -> row.winPercentage?.toDouble()
        AndroidTrackSort.TRACK -> null
    }

/** The columns that read a number rather than a piece of text. */
internal val ANDROID_NUMERIC_TRACK_COLUMNS = listOf(
    AndroidTrackSort.RACES,
    AndroidTrackSort.WINS,
    AndroidTrackSort.BEST,
    AndroidTrackSort.AVERAGE,
    AndroidTrackSort.WIN,
)

internal fun androidFilterTrackRows(
    rows: List<AndroidTrackRow>,
    filters: AndroidTrackFilters,
): List<AndroidTrackRow> {
    fun contains(haystack: String, needle: String): Boolean =
        needle.isBlank() || haystack.contains(needle.trim(), ignoreCase = true)
    val numeric = ANDROID_NUMERIC_TRACK_COLUMNS
        .mapNotNull { column ->
            androidParseNumericFilter(filters.of(column))?.let { column to it }
        }
    return rows.filter { row ->
        contains(row.name, filters.track) &&
            contains(row.cupName, filters.cup) &&
            numeric.all { (column, filter) ->
                androidNumericMatches(androidFilterValue(row, column), filter)
            }
    }
}

/**
 * Which way a column opens when it is first chosen: most races first, but the
 * best and average finish are positions, so the small number leads. The site's
 * own `SORT_OPENS_DESCENDING`.
 */
internal val ANDROID_SORT_OPENS_DESCENDING: Map<AndroidTrackSort, Boolean> = mapOf(
    AndroidTrackSort.TRACK to false,
    AndroidTrackSort.RACES to true,
    AndroidTrackSort.WINS to true,
    AndroidTrackSort.BEST to false,
    AndroidTrackSort.AVERAGE to false,
    AndroidTrackSort.WIN to true,
)

/**
 * A track nobody has raced sorts last whichever column is chosen. Letting it
 * count as zero would bury the tracks somebody is genuinely bad at underneath
 * the ones they have simply never seen.
 *
 * BEST and AVERAGE rank the other way round from the rest: a finishing
 * position is better when it is smaller, so a first place is a 1. A raced
 * track with no recorded finish sorts behind the ones that have one rather
 * than posing as a win. The Web sorts these columns exactly this way.
 */
internal fun androidSortTrackRows(
    rows: List<AndroidTrackRow>,
    sort: AndroidTrackSort,
    descending: Boolean = ANDROID_SORT_OPENS_DESCENDING[sort] ?: true,
): List<AndroidTrackRow> {
    if (sort == AndroidTrackSort.TRACK) {
        return if (descending) rows.sortedByDescending { it.trackIndex }
        else rows.sortedBy { it.trackIndex }
    }
    fun value(row: AndroidTrackRow): Double = when (sort) {
        AndroidTrackSort.RACES -> row.races.toDouble()
        AndroidTrackSort.WINS -> row.wins.toDouble()
        AndroidTrackSort.WIN -> (row.winPercentage ?: 0).toDouble()
        AndroidTrackSort.BEST -> row.bestFinish?.toDouble() ?: Double.MAX_VALUE
        AndroidTrackSort.AVERAGE -> row.averageFinish ?: Double.MAX_VALUE
        AndroidTrackSort.TRACK -> 0.0
    }
    // A raced track without a recorded finish sorts behind the ones that have
    // one, in either direction, rather than posing as a first place.
    val absent = sort == AndroidTrackSort.BEST || sort == AndroidTrackSort.AVERAGE
    return rows.sortedWith(
        compareByDescending<AndroidTrackRow> { it.races > 0 }
            .thenComparator { left, right ->
                val leftValue = value(left)
                val rightValue = value(right)
                when {
                    leftValue == rightValue -> 0
                    absent && leftValue == Double.MAX_VALUE -> 1
                    absent && rightValue == Double.MAX_VALUE -> -1
                    descending -> rightValue.compareTo(leftValue)
                    else -> leftValue.compareTo(rightValue)
                }
            }
            .thenBy { it.trackIndex },
    )
}

/** Strongest first; the service already ordered them, this only trims. */
internal fun androidJudgedTracks(
    tracks: List<AndroidTournamentTrack>,
): List<AndroidTournamentTrack> =
    tracks.filter { it.races >= ANDROID_MINIMUM_RACES_FOR_A_VERDICT }

@Composable
internal fun AndroidTournamentTrackSection(
    record: AndroidTournamentTrackRecord?,
    playerName: String,
    language: AndroidProductLanguage,
    loading: Boolean,
    error: Boolean,
    /** The view a shared address asked for, consumed once by the table. */
    request: AndroidRankingRequest? = null,
    /**
     * Opening a track: the site sends the reader to that track's own TrueSkill
     * page first, which links on to the time-trial board. The picture and the
     * name are the way in; the numbers beside them are not (owner,
     * 2026-09-16).
     */
    onOpenTrack: ((String) -> Unit)? = null,
) {
    Mk8dxPanel(title = androidText(language, "TRACKS", "BANEN")) {
        when {
            loading -> Text(
                androidText(language, "Loading track record…", "Baanrecord laden…"),
                style = MaterialTheme.typography.bodySmall,
            )
            error || record == null -> Text(
                androidText(
                    language,
                    "The track record is temporarily unavailable.",
                    "Het baanrecord is tijdelijk niet beschikbaar.",
                ),
                style = MaterialTheme.typography.bodySmall,
            )
            record.racesWithTrack == 0 -> Text(
                androidText(
                    language,
                    "No tournament race of $playerName was recorded on video, " +
                        "so there is no track detail yet.",
                    "Van $playerName is geen enkele toernooirace op video " +
                        "vastgelegd, dus er is nog geen baandetail.",
                ),
                style = MaterialTheme.typography.bodySmall,
            )
            else -> {
                val judged = androidJudgedTracks(record.tracks)
                if (judged.isEmpty()) {
                    Text(
                        androidText(
                            language,
                            "$playerName has not raced any track " +
                                "$ANDROID_MINIMUM_RACES_FOR_A_VERDICT times yet, " +
                                "which is too thin to call a strength.",
                            "$playerName heeft nog geen baan " +
                                "$ANDROID_MINIMUM_RACES_FOR_A_VERDICT keer gereden; " +
                                "dat is te weinig om er iets over te zeggen.",
                        ),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    return@Mk8dxPanel
                }
                TrackList(
                    heading = androidText(language, "Strongest", "Sterkste banen"),
                    tracks = judged.take(LIST_LENGTH),
                    strong = true,
                    language = language,
                    tag = "tournament-tracks-strong",
                    onOpenTrack = onOpenTrack,
                )
                Spacer(Modifier.height(12.dp))
                TrackList(
                    heading = androidText(
                        language, "Worth practising", "Hier valt te winnen"),
                    tracks = judged.takeLast(LIST_LENGTH).reversed(),
                    strong = false,
                    language = language,
                    tag = "tournament-tracks-weak",
                    onOpenTrack = onOpenTrack,
                )
                Spacer(Modifier.height(12.dp))
                AllTracks(record.tracks, language, request, onOpenTrack)
                Spacer(Modifier.height(10.dp))
                Text(
                    androidText(
                        language,
                        "Over ${record.racesWithTrack} races whose track is known" +
                            missingClause(record.racesWithoutTrack, language),
                        "Over ${record.racesWithTrack} races waarvan de baan bekend is" +
                            missingClause(record.racesWithoutTrack, language),
                    ),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * TN4-TN6 were never recorded and never will be, so a long career always has a
 * hole in it. An average over half a career should say which half.
 */
private fun missingClause(
    racesWithoutTrack: Int, language: AndroidProductLanguage,
): String = if (racesWithoutTrack == 0) {
    "."
} else {
    androidText(
        language,
        "; $racesWithoutTrack more have no recording.",
        "; van $racesWithoutTrack races bestaat geen opname.",
    )
}

@Composable
private fun TrackList(
    heading: String,
    tracks: List<AndroidTournamentTrack>,
    strong: Boolean,
    language: AndroidProductLanguage,
    tag: String,
    onOpenTrack: ((String) -> Unit)? = null,
) {
    Column(Modifier.fillMaxWidth().testTag(tag)) {
        Text(heading, fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(4.dp))
        for (track in tracks) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val open = onOpenTrack
                androidTrackIndex(track.trackId)?.let { index ->
                    TrackIdentityArtwork(
                        trackIndex = index,
                        // Every tournament so far has been run at 150cc.
                        mode = 150,
                        contentDescription = androidTrackDisplayName(track.trackId),
                        modifier = Modifier
                            .width(96.dp)
                            .aspectRatio(16f / 9f)
                            .let { base ->
                                if (open == null) base
                                else base.clickable { open(track.trackId) }
                            },
                    )
                    Spacer(Modifier.width(10.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        androidTrackDisplayName(track.trackId),
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Mk8dxTheme.colors.textPrimary,
                        // A link is marked the way the web marks one, with an
                        // underline rather than with colour alone.
                        textDecoration = if (open == null) null else TextDecoration.Underline,
                        modifier = if (open == null) {
                            Modifier
                        } else {
                            Modifier.clickable { open(track.trackId) }
                        },
                    )
                    Text(
                        androidText(
                            language,
                            "${track.races} races · average " +
                                String.format(Locale.US, "%.1f", track.averageFinish) +
                                if (track.wins > 0) " · ${track.wins} won" else "",
                            "${track.races} races · gemiddeld " +
                                String.format(Locale.US, "%.1f", track.averageFinish) +
                                if (track.wins > 0) " · ${track.wins}x gewonnen" else "",
                        ),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    androidTrackVerdict(track.relativeToOwnAverage, language),
                    // Better or worse than this Player's own average: the same
                    // pair of tokens a gap is drawn with.
                    color = if (strong) {
                        Mk8dxTheme.colors.deltaFaster
                    } else {
                        Mk8dxTheme.colors.deltaSlower
                    },
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

/**
 * Every track in the game, not only the ones raced. A record that lists only
 * what somebody has done cannot answer "which have I never touched", which is
 * often the more useful half. Collapsed by default: on a phone the answer
 * comes first and the full list is one tap away.
 */
@Composable
private fun AllTracks(
    tracks: List<AndroidTournamentTrack>,
    language: AndroidProductLanguage,
    request: AndroidRankingRequest? = null,
    onOpenTrack: ((String) -> Unit)? = null,
) {
    var open by remember { mutableStateOf(false) }
    var sort by rememberSaveable { mutableStateOf(AndroidTrackSort.RACES) }
    var descending by rememberSaveable {
        mutableStateOf(ANDROID_SORT_OPENS_DESCENDING[AndroidTrackSort.RACES] ?: true)
    }
    var filters by remember { mutableStateOf(AndroidTrackFilters()) }
    // A shared link opens the table the way the sender left it: open, on the
    // column they sorted, which way, with their filters in the boxes.
    LaunchedEffect(request) {
        val asked = request ?: return@LaunchedEffect
        if (asked.tracksOpen) open = true
        asked.trackSort?.let { column ->
            sort = column
            descending = asked.trackDescending
                ?: (ANDROID_SORT_OPENS_DESCENDING[column] ?: true)
        }
        filters = asked.trackFilters
    }
    val rows = remember(tracks) { androidAllTrackRows(tracks) }
    val raced = rows.count { it.races > 0 }

    TextButton(onClick = { open = !open }, modifier = Modifier.testTag("tournament-tracks-all")) {
        Text(
            androidText(
                language,
                (if (open) "Hide" else "Show") + " all ${rows.size} tracks \u2014 $raced raced",
                (if (open) "Verberg" else "Toon") + " alle ${rows.size} banen \u2014 $raced gereden",
            ),
            style = MaterialTheme.typography.labelLarge,
        )
    }
    if (!open) return

    // The site's own table: seven columns, each one sortable and each one with
    // its own filter box under the heading. Seven do not fit across a phone, so
    // the table scrolls sideways - which is exactly what the site does too,
    // because `.track-record__scroller` is `overflow-x: auto` at every width.
    val shown = androidFilterTrackRows(androidSortTrackRows(rows, sort, descending), filters)
    Text(
        if (shown.size == rows.size) {
            androidText(language, "${rows.size} tracks", "${rows.size} banen")
        } else {
            androidText(
                language,
                "${shown.size} of ${rows.size} tracks",
                "${shown.size} van ${rows.size} banen",
            )
        },
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(bottom = 4.dp).testTag("tournament-tracks-count"),
    )
    val table = rememberScrollState()
    Column(Modifier.fillMaxWidth().horizontalScroll(table)) {
        Row(verticalAlignment = Alignment.Bottom) {
            for (column in ANDROID_TRACK_COLUMNS) {
                Column(Modifier.width(androidTrackColumnWidth(column))) {
                    val active = sort == column.sort
                    TextButton(
                        onClick = {
                            if (sort == column.sort) {
                                descending = !descending
                            } else {
                                sort = column.sort
                                descending = ANDROID_SORT_OPENS_DESCENDING[column.sort] ?: true
                            }
                        },
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            horizontal = 4.dp,
                            vertical = 0.dp,
                        ),
                    ) {
                        Text(
                            androidText(language, column.english, column.dutch) +
                                if (active) (if (descending) " \u25bc" else " \u25b2") else "",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = if (active) FontWeight.Black else FontWeight.SemiBold,
                            color = if (active) {
                                Mk8dxTheme.colors.textPrimary
                            } else {
                                Mk8dxTheme.colors.textSecondary
                            },
                        )
                    }
                    // A number column reads an operator: "> 3", "<= 2", "= 1".
                    OutlinedTextField(
                        value = filters.of(column.sort),
                        onValueChange = { filters = filters.with(column.sort, it) },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.labelSmall,
                        placeholder = {
                            Text(
                                if (column.numeric) {
                                    "> 3"
                                } else {
                                    androidText(language, "contains\u2026", "bevat\u2026")
                                },
                                style = MaterialTheme.typography.labelSmall,
                            )
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 2.dp, vertical = 2.dp)
                            .testTag("tournament-tracks-filter-${column.sort.name.lowercase()}"),
                    )
                }
            }
        }
        if (shown.isEmpty()) {
            Text(
                androidText(language, "No track matches that.", "Geen baan komt overeen."),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 8.dp),
            )
        }
        for (row in shown) {
            Row(
                Modifier.padding(vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Track: the game's own picture beside the name, as the site
                // prints it.
                val open = onOpenTrack
                Row(
                    Modifier
                        .width(androidTrackColumnWidth(ANDROID_TRACK_COLUMNS[0]))
                        .let { base ->
                            // Picture and name together are the way in; the
                            // columns beside them stay plain figures.
                            if (open == null) base
                            else base.clickable { open(row.trackId) }
                        },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TrackIdentityArtwork(
                        trackIndex = row.trackIndex,
                        mode = if (row.races > 0) 150 else null,
                        contentDescription = row.name,
                        modifier = Modifier.width(52.dp).aspectRatio(16f / 9f),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        row.name,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = if (row.races > 0) {
                            Mk8dxTheme.colors.textPrimary
                        } else {
                            Mk8dxTheme.colors.textTertiary
                        },
                        textDecoration = if (open == null) null else TextDecoration.Underline,
                    )
                }
                TrackCell(row.cupName, ANDROID_TRACK_COLUMNS[1])
                TrackCell(if (row.races == 0) "\u2014" else "${row.races}", ANDROID_TRACK_COLUMNS[2])
                TrackCell(if (row.wins == 0) "\u2014" else "${row.wins}", ANDROID_TRACK_COLUMNS[3])
                TrackCell(row.bestFinish?.toString() ?: "\u2014", ANDROID_TRACK_COLUMNS[4])
                TrackCell(
                    row.averageFinish?.let { String.format(Locale.US, "%.1f", it) } ?: "\u2014",
                    ANDROID_TRACK_COLUMNS[5],
                )
                // Win % carries its own colour on the site: a figure you can
                // read across ninety-six rows without comparing numbers.
                Box(
                    Modifier.width(androidTrackColumnWidth(ANDROID_TRACK_COLUMNS[6])),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    val percentage = row.winPercentage
                    if (percentage == null) {
                        Text(
                            androidText(language, "never raced", "nooit gereden"),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        // The heat colour is the figure; the system's chip picks
                        // the readable foreground for it.
                        Mk8dxTierChip(
                            "$percentage%",
                            androidWinPercentageColor(percentage),
                            dense = true,
                        )
                    }
                }
            }
        }
    }
}

/** One column of the site's table: what it is called, and what it filters on. */
internal data class AndroidTrackColumn(
    val sort: AndroidTrackSort,
    val english: String,
    val dutch: String,
    val numeric: Boolean,
)

internal val ANDROID_TRACK_COLUMNS = listOf(
    AndroidTrackColumn(AndroidTrackSort.TRACK, "Track", "Baan", numeric = false),
    // The cup has no sort of its own on the site either: it rides with the
    // track column, which follows the game's own cup order.
    AndroidTrackColumn(AndroidTrackSort.TRACK, "Cup", "Cup", numeric = false),
    AndroidTrackColumn(AndroidTrackSort.RACES, "Raced", "Gereden", numeric = true),
    AndroidTrackColumn(AndroidTrackSort.WINS, "Won", "Gewonnen", numeric = true),
    AndroidTrackColumn(AndroidTrackSort.BEST, "Best", "Beste", numeric = true),
    AndroidTrackColumn(AndroidTrackSort.AVERAGE, "Average", "Gemiddeld", numeric = true),
    AndroidTrackColumn(AndroidTrackSort.WIN, "Win %", "Winst %", numeric = true),
)

private fun androidTrackColumnWidth(column: AndroidTrackColumn) = when (column.english) {
    "Track" -> 190.dp
    "Cup" -> 110.dp
    "Average" -> 88.dp
    "Win %" -> 104.dp
    else -> 76.dp
}

@Composable
private fun TrackCell(text: String, column: AndroidTrackColumn) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.width(androidTrackColumnWidth(column)).padding(horizontal = 4.dp),
    )
}
