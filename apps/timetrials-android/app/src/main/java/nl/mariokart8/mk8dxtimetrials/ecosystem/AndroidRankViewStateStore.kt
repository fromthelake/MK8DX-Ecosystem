package nl.mariokart8.mk8dxtimetrials.ecosystem

import android.content.Context

internal data class AndroidRankViewState(
    val mode: Int = 150,
    val scope: String = "all",
    val tab: String = "TOTAL",
    /* Which half of Ranking is open: the Time Trial standing, or Tournament. */
    val section: String = "TIME_TRIALS",
    // A Home tile opens Ranking already narrowed, exactly as the web link
    // does with `&focus=`.
    val trackFocus: String? = null,
    val selectedPlayerIds: List<String> = emptyList(),
    val playerQuery: String = "",
    val trackQuery: String = "",
    val trackSortPlayerId: String? = null,
    val trackSortDescending: Boolean = true,
    val scrollPosition: Int = 0,
    /* Which community the standing is read against. Every other control was
       already remembered, so returning to Ranking silently reset only this
       one - "Among rivals" became "Global" again. */
    val includeGlobal: Boolean = true,
    val includeRivals: Boolean = false,
)

internal class AndroidRankViewStateStore(context: Context, ownerKey: String) {
    private val preferences = context.getSharedPreferences("mk8dx-rank-view-v2:$ownerKey", Context.MODE_PRIVATE)

    fun read(): AndroidRankViewState = AndroidRankViewState(
        mode = preferences.getInt("mode", 150).takeIf { it == 150 || it == 200 } ?: 150,
        scope = preferences.getString("scope", "all")
            ?.takeIf { it == "base" || it == "bcp" || it == "all" } ?: "all",
        tab = preferences.getString("tab", "TOTAL") ?: "TOTAL",
        section = preferences.getString("section", "TIME_TRIALS")
            ?.takeIf { it == "TIME_TRIALS" || it == "TOURNAMENT" } ?: "TIME_TRIALS",
        trackFocus = preferences.getString("trackFocus", null)
            ?.let { value -> AndroidRankTrackFocus.parse(value)?.apiValue },
        selectedPlayerIds = preferences.getString("selectedPlayerIds", "").orEmpty()
            .split('|').filter(String::isNotBlank).distinct().take(3),
        playerQuery = preferences.getString("playerQuery", "").orEmpty().take(80),
        trackQuery = preferences.getString("trackQuery", "").orEmpty().take(80),
        trackSortPlayerId = preferences.getString("trackSortPlayerId", null),
        trackSortDescending = preferences.getBoolean("trackSortDescending", true),
        scrollPosition = preferences.getInt("scrollPosition", 0).coerceAtLeast(0),
        includeGlobal = preferences.getBoolean("includeGlobal", true),
        includeRivals = preferences.getBoolean("includeRivals", false),
    )

    fun write(state: AndroidRankViewState) {
        preferences.edit()
            .putInt("mode", state.mode)
            .putString("scope", state.scope)
            .putString("tab", state.tab)
            .putString("section", state.section)
            .putString("trackFocus", state.trackFocus)
            .putString("selectedPlayerIds", state.selectedPlayerIds.distinct().take(3).joinToString("|"))
            .putString("playerQuery", state.playerQuery.take(80))
            .putString("trackQuery", state.trackQuery.take(80))
            .putString("trackSortPlayerId", state.trackSortPlayerId)
            .putBoolean("trackSortDescending", state.trackSortDescending)
            .putInt("scrollPosition", state.scrollPosition.coerceAtLeast(0))
            .putBoolean("includeGlobal", state.includeGlobal)
            .putBoolean("includeRivals", state.includeRivals)
            .apply()
    }

    fun clear() = preferences.edit().clear().apply()
}
