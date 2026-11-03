package nl.mariokart8.mk8dxtimetrials.tournament

/**
 * What a Tournaments address asked for.
 *
 * Either one night, or the statistics panel with the view the sender had: the
 * column it was sorted on, which way, and the track whose own standing was
 * open. Nothing here is state the screen keeps - it is consumed once and
 * cleared, so pressing the tab afterwards is an ordinary visit.
 */
internal data class AndroidTournamentRequest(
    val nightId: String? = null,
    val statistics: Boolean = false,
    val statisticsSort: String? = null,
    val statisticsAscending: Boolean = false,
    val statisticsFocus: String? = null,
    /** The panel's own filter boxes, keyed as the address keys them. */
    val statisticsFilters: Map<String, String> = emptyMap(),
)
