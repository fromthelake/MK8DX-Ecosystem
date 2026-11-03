package nl.mariokart8.mk8dxtimetrials.tournament

import kotlinx.serialization.Serializable
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.androidDisambiguatedName
import nl.mariokart8.mk8dxtimetrials.ui.androidRepeatedDisplayNames

/**
 * "Alle races tot nu toe", read on the phone.
 *
 * The same two public readings the site uses - one small table counted from
 * the corrected history, and one track's own TrueSkill - so both clients say
 * the same numbers about the same nights. The shapes here are the wire
 * contract's, named exactly as the server names them.
 */
@Serializable
internal data class AndroidTournamentStatisticsEdition(
    val editionNumber: Int,
    val eventDate: String? = null,
    val heldAtMs: Long? = null,
    val participantCount: Int,
    val races: Int,
    /** Everybody who had raced a tournament by the end of this night. */
    val cumulativePlayers: Int,
)

@Serializable
internal data class AndroidTournamentStatisticsTrack(
    val trackId: String,
    val races: Int,
    /** How many Players drove it, summed over its races. */
    val placements: Int,
    /** How many different nights it was raced on. */
    val nights: Int,
    val firstEdition: Int,
    val lastEdition: Int,
    val bestPlayerId: String? = null,
    val bestPlayerName: String? = null,
    /** ADR-0218: tells two leaders with the same name apart. */
    val bestPlayerUsername: String? = null,
    val bestScore: Double? = null,
)

@Serializable
internal data class AndroidTournamentStatisticsTotals(
    val editions: Int,
    val races: Int,
    val racesWithTrack: Int,
    val placements: Int,
    val players: Int,
    val tracksRaced: Int,
)

@Serializable
internal data class AndroidTournamentStatistics(
    val schemaVersion: String = "",
    val editions: List<AndroidTournamentStatisticsEdition> = emptyList(),
    val tracks: List<AndroidTournamentStatisticsTrack> = emptyList(),
    val totals: AndroidTournamentStatisticsTotals =
        AndroidTournamentStatisticsTotals(0, 0, 0, 0, 0, 0),
)

/** One Player's standing on one track, counted from a Score of zero. */
@Serializable
internal data class AndroidTrackSkillEntry(
    val rank: Int,
    val playerId: String,
    val displayName: String,
    val username: String? = null,
    val score: Double,
    val mu: Double,
    val sigma: Double,
    val races: Int,
    val wins: Int,
    val top3: Int,
    val bestFinish: Int,
    val averageFinish: Double,
)

@Serializable
internal data class AndroidTrackSkill(
    val schemaVersion: String = "",
    val trackId: String = "",
    val races: Int = 0,
    val racesSkipped: Int = 0,
    val players: List<AndroidTrackSkillEntry> = emptyList(),
)

/**
 * Nintendo's own ghost per race, the reference the racing time is built on.
 *
 * The site derives one figure the same way: a race takes as long as the ghost
 * of that track takes, and the racing time is that ghost once per driver. The
 * phone reads the ghost from the same catalog the leaderboards use, so a
 * number shown here and a number shown there cannot drift apart.
 */
internal fun androidStatisticsDriverMs(
    tracks: List<AndroidTournamentStatisticsTrack>,
    ghostMs: (String) -> Long?,
): Long = tracks.sumOf { track ->
    val ghost = ghostMs(track.trackId) ?: 0L
    ghost * track.placements
}

/**
 * "14d 1h 51m" - days, hours and minutes, the way the owner asked for it.
 *
 * The twin of `formatSpan` on the site, including its rounding: the site
 * rounds the minutes and this floored them, which is how the same total read
 * one minute apart on the two clients.
 */
internal fun androidStatisticsSpan(totalMs: Long, dutch: Boolean): String {
    val minutes = Math.round(totalMs / 60_000.0)
    val days = minutes / (60 * 24)
    val hours = (minutes % (60 * 24)) / 60
    val rest = minutes % 60
    if (days == 0L) {
        if (hours == 0L) return "$rest min"
        return if (dutch) "$hours u $rest m" else "${hours}h ${rest}m"
    }
    return if (dutch) "$days d $hours u $rest m" else "${days}d ${hours}h ${rest}m"
}

/** "1:52.318", the way every other time in the product is written. */
internal fun androidStatisticsLap(totalMs: Long): String = String.format(
    java.util.Locale.US, "%d:%02d.%03d",
    totalMs / 60_000, (totalMs % 60_000) / 1000, totalMs % 1000,
)

/** The columns the table can stand on, named as the site's address names them. */
internal enum class AndroidStatisticsSort(val key: String) {
    TRACK("track"),
    CUP("cup"),
    RACES("races"),
    PLAYERS("players"),
    NIGHTS("nights"),
    TIME("time"),
    GHOST("ghost"),
    BEST("best"),
    ;

    companion object {
        fun parse(value: String?): AndroidStatisticsSort? =
            entries.firstOrNull { it.key == value }
    }
}

/** Which way a column reads on its first click, exactly as on the site. */
internal val ANDROID_STATISTICS_SORT_OPENS_DESCENDING: Map<AndroidStatisticsSort, Boolean> = mapOf(
    AndroidStatisticsSort.TRACK to false,
    AndroidStatisticsSort.CUP to false,
    AndroidStatisticsSort.RACES to true,
    AndroidStatisticsSort.PLAYERS to true,
    AndroidStatisticsSort.NIGHTS to true,
    AndroidStatisticsSort.TIME to true,
    AndroidStatisticsSort.GHOST to true,
    AndroidStatisticsSort.BEST to true,
)

/** The columns a reader can filter, keyed the way the address keys them. */
internal enum class AndroidStatisticsFilter(val key: String) {
    TRACK("track"), CUP("cup"), RACES("races"), PLAYERS("players"), NIGHTS("nights"),
}

/**
 * One row of "Alle races tot nu toe", the twin of `buildStatisticsRows` on the
 * site: the track and its cup by name and by picture, what was raced on it,
 * and the racing that accounts for.
 */
internal data class AndroidStatisticsRow(
    val trackId: String,
    val trackIndex: Int?,
    val name: String,
    val cupName: String,
    val cupIndex: Int?,
    val races: Int,
    /** How many Players drove it, summed over its races. */
    val players: Int,
    val nights: Int,
    val ghostMs: Long?,
    /** The racing this track accounts for: the ghost once per driver. */
    val timeMs: Long?,
    val bestPlayerName: String?,
    val bestScore: Double?,
)

internal fun androidBuildStatisticsRows(
    tracks: List<AndroidTournamentStatisticsTrack>,
    ghostMs: (String) -> Long?,
): List<AndroidStatisticsRow> {
    // ADR-0218: equal leader names carry their usernames, as on the website.
    val repeated = androidRepeatedDisplayNames(tracks.mapNotNull { track ->
        val id = track.bestPlayerId
        val name = track.bestPlayerName
        if (id == null || name == null) null else id to name
    })
    return tracks.map { track ->
    val entry = Schema9AndroidTrackCatalog.find(track.trackId)
    val cup = Schema9AndroidTrackCatalog.cups.firstOrNull { cup ->
        cup.tracks.any { it.id == track.trackId }
    }
    val ghost = ghostMs(track.trackId)
    AndroidStatisticsRow(
        trackId = track.trackId,
        trackIndex = entry?.index,
        name = entry?.displayName ?: track.trackId,
        cupName = cup?.displayName ?: "\u2014",
        cupIndex = cup?.index,
        races = track.races,
        players = track.placements,
        nights = track.nights,
        ghostMs = ghost,
        timeMs = ghost?.let { it * track.placements },
        bestPlayerName = track.bestPlayerName?.let { androidDisambiguatedName(it, track.bestPlayerUsername, repeated) },
        bestScore = track.bestScore,
    )
    }
}

/** The table's order, on the column the reader asked for. */
internal fun androidSortStatisticsRows(
    rows: List<AndroidStatisticsRow>,
    sort: AndroidStatisticsSort,
    descending: Boolean,
): List<AndroidStatisticsRow> {
    // Sorting on the track sorts on its id, not on the name it is shown under:
    // the id groups a track with its console - every gba_ together, every
    // tour_ together - which a display name scatters. The owner asked for it.
    val byName = compareBy<AndroidStatisticsRow> { it.name }
    val ordered = when (sort) {
        AndroidStatisticsSort.TRACK -> rows.sortedWith(compareBy { it.trackId })
        AndroidStatisticsSort.CUP -> rows.sortedWith(compareBy<AndroidStatisticsRow> { it.cupName }.then(byName))
        AndroidStatisticsSort.RACES -> rows.sortedWith(compareBy<AndroidStatisticsRow> { it.races }.then(byName))
        AndroidStatisticsSort.PLAYERS -> rows.sortedWith(compareBy<AndroidStatisticsRow> { it.players }.then(byName))
        AndroidStatisticsSort.NIGHTS -> rows.sortedWith(compareBy<AndroidStatisticsRow> { it.nights }.then(byName))
        AndroidStatisticsSort.TIME -> rows.sortedWith(compareBy<AndroidStatisticsRow> { it.timeMs ?: -1L }.then(byName))
        AndroidStatisticsSort.GHOST -> rows.sortedWith(compareBy<AndroidStatisticsRow> { it.ghostMs ?: -1L }.then(byName))
        AndroidStatisticsSort.BEST -> rows.sortedWith(
            compareBy<AndroidStatisticsRow> { it.bestScore ?: Double.NEGATIVE_INFINITY }.then(byName),
        )
    }
    return if (descending) ordered.reversed() else ordered
}

private val statisticsNumericFilter = Regex("^(>=|<=|>|<|=)?\\s*(\\d+(?:[.,]\\d+)?)$")

/** `> 3`, `>=3`, `<2`, `=4`, `3` - and plain text for a name. */
internal fun androidStatisticsRowMatches(
    row: AndroidStatisticsRow,
    filters: Map<String, String>,
): Boolean {
    for ((key, raw) in filters) {
        val filter = raw.trim()
        if (filter.isEmpty()) continue
        if (key == AndroidStatisticsFilter.TRACK.key || key == AndroidStatisticsFilter.CUP.key) {
            val text = if (key == AndroidStatisticsFilter.TRACK.key) row.name else row.cupName
            if (!text.contains(filter, ignoreCase = true)) return false
            continue
        }
        val value = when (key) {
            AndroidStatisticsFilter.RACES.key -> row.races
            AndroidStatisticsFilter.PLAYERS.key -> row.players
            else -> row.nights
        }
        val match = statisticsNumericFilter.find(filter) ?: return false
        val wanted = match.groupValues[2].replace(',', '.').toDoubleOrNull() ?: return false
        val ok = when (match.groupValues[1]) {
            ">" -> value > wanted
            ">=" -> value >= wanted
            "<" -> value < wanted
            "<=" -> value <= wanted
            else -> value.toDouble() == wanted
        }
        if (!ok) return false
    }
    return true
}
