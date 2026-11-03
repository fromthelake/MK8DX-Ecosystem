package nl.mariokart8.mk8dxtimetrials.ecosystem

/**
 * What a Ranking address asked for.
 *
 * The site writes its whole view into the address - whose record, who it is
 * compared against, whether the 96-track table is open, the column it stands
 * on and a filter per column - and a link is only worth sending if it opens
 * the same thing here. [player] and [compare] are what the site writes: a
 * username like `evan`, or a canonical Player id; they are resolved against
 * the standing this screen is showing.
 *
 * It is consumed once and cleared, so opening Ranking from the bar afterwards
 * is an ordinary visit.
 */
internal data class AndroidRankingRequest(
    val tournament: Boolean = false,
    val player: String? = null,
    val compare: List<String> = emptyList(),
    val tracksOpen: Boolean = false,
    val trackSort: AndroidTrackSort? = null,
    val trackDescending: Boolean? = null,
    val trackFilters: AndroidTrackFilters = AndroidTrackFilters(),
    /** The engine the link named (`&mode=`); it outranks the preference (R7). */
    val mode: Int? = null,
)

/** The sort column as a link writes it: "raced", not "races". */
internal fun androidTrackSortFromLink(name: String?): AndroidTrackSort? = when (name) {
    "track" -> AndroidTrackSort.TRACK
    "raced" -> AndroidTrackSort.RACES
    "won" -> AndroidTrackSort.WINS
    "best" -> AndroidTrackSort.BEST
    "average" -> AndroidTrackSort.AVERAGE
    "win" -> AndroidTrackSort.WIN
    else -> null
}

/** `f_raced` and its six companions, keyed the way the table keys them. */
internal fun androidTrackFiltersFromLink(filters: Map<String, String>): AndroidTrackFilters =
    AndroidTrackFilters(
        track = filters["track"].orEmpty(),
        cup = filters["cup"].orEmpty(),
        races = filters["races"].orEmpty(),
        wins = filters["wins"].orEmpty(),
        best = filters["best"].orEmpty(),
        average = filters["average"].orEmpty(),
        win = filters["win"].orEmpty(),
    )

/**
 * The Player a link names, found in the standing being shown.
 *
 * A link carries a username; the screen holds canonical ids. Matched on the
 * id, the username and finally the display name, all case-insensitively, so
 * `?player=evan`, `?player=Evan` and `?player=player.evan` are one Player.
 */
internal fun androidResolvePlayerReference(
    reference: String,
    entries: List<AndroidTournamentStandingEntry>,
): String? {
    val wanted = reference.trim()
    if (wanted.isEmpty()) return null
    return entries.firstOrNull { it.playerId.equals(wanted, ignoreCase = true) }?.playerId
        ?: entries.firstOrNull { it.username.equals(wanted, ignoreCase = true) }?.playerId
        ?: entries.firstOrNull { it.displayName.equals(wanted, ignoreCase = true) }?.playerId
}
