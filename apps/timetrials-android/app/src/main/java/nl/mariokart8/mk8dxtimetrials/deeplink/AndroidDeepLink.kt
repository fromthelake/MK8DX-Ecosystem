package nl.mariokart8.mk8dxtimetrials.deeplink

import java.net.URLDecoder
import java.net.URI
import nl.mariokart8.mk8dxtimetrials.BuildConfig
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog

/**
 * The product's own addresses, read on the phone.
 *
 * There is one link grammar for the whole product and it is the site's: the
 * Web already writes every view it can show into its address, and a link is
 * only worth sharing if it opens the same thing wherever it is opened. So the
 * phone does not invent a second scheme - it reads
 * `https://example.invalid/?...` itself and lands on the screen that
 * answers it.
 *
 * This file is deliberately pure: no Android types, no navigation, nothing but
 * the track catalog. It turns an address into an intention, and
 * `AndroidTimeTrialsProductComponent` is the only thing that acts on one. That
 * is what lets its tests read the same table of addresses the Web's router
 * dispatches.
 */
internal val ANDROID_PRODUCT_LINK_HOST: String = URI(BuildConfig.MK8DX_API_ORIGIN).host.lowercase()

internal sealed interface AndroidDeepLink {
    /** The site's front page, and the app's. */
    data object Home : AndroidDeepLink

    /** `?cups=1` - every track, which on the phone is the Tracks tab. */
    data object Tracks : AndroidDeepLink

    /** `?leaderboard=track.x&mode=150` - one track's standing. */
    /** `run` is a shared run's result id: its Details open on the board (2026-09-29). */
    data class Track(val trackId: String, val mode: Int?, val runId: String? = null) : AndroidDeepLink

    /** `?records=1` - your own records. */
    data object Records : AndroidDeepLink

    /** `?mystats=1` - My records & stats. */
    data object MyStats : AndroidDeepLink

    /** `?notifications=1`. */
    data object Notifications : AndroidDeepLink

    /** `?settings=1`, with or without a section. */
    data object Settings : AndroidDeepLink

    /** `?admin=1` - Administration, for whoever the server says may see it. */
    data object Administration : AndroidDeepLink

    /** `/device?user_code=...` and the sign-in address: the account screen. */
    data object Account : AndroidDeepLink

    /**
     * `?tournaments=1`, and the statistics panel underneath it.
     *
     * The whole panel view travels: which column it is sorted on, which way,
     * the filters, and the track whose own TrueSkill is open. A link that
     * names any of them is a link about the panel, so [statistics] is true and
     * the phone opens on it rather than at the top of the night list.
     */
    data class Tournaments(
        val statistics: Boolean = false,
        val statisticsSort: String? = null,
        val statisticsDescending: Boolean = true,
        val statisticsFilters: Map<String, String> = emptyMap(),
        val statisticsFocus: String? = null,
    ) : AndroidDeepLink

    /** `?tournaments=tournament.x`, `?tournament=`, `?night-report=`. */
    data class TournamentNight(val tournamentId: String) : AndroidDeepLink

    /**
     * `?ranking=tournament` or `?ranking=timetrials`, with the view the sender
     * had.
     *
     * [player] and [compare] are what the site writes: a **username** like
     * `evan`, or a Player id. Both clients resolve the name against the
     * standing they are showing, so a link written on the site opens the same
     * comparison here. The 96-track table travels with it - whether it is
     * open, the column it stands on, which way, and a filter per column.
     */
    data class Ranking(
        val tournament: Boolean,
        val player: String? = null,
        val compare: List<String> = emptyList(),
        val mode: Int? = null,
        val scope: String? = null,
        val tab: String? = null,
        val focus: String? = null,
        val tracksOpen: Boolean = false,
        val trackSort: String? = null,
        val trackDescending: Boolean? = null,
        val trackFilters: Map<String, String> = emptyMap(),
    ) : AndroidDeepLink

    /** `?player=player.x` - that Player's own page. */
    data class PlayerPage(val playerId: String) : AndroidDeepLink

    /** `?build=character.x,body.y,tire.z,glider.w`. */
    data class Build(val partIds: List<String>) : AndroidDeepLink

    /**
     * `?apps=1` - the page this app is downloaded from.
     *
     * It is one of ours to *receive*, because the app is the verified handler
     * for this host and a tap must never bounce between the app and a browser.
     * It is not one of ours to show: installing an APK happens in a browser,
     * so the app opens one.
     */
    data object Apps : AndroidDeepLink
}

private val tournamentIdPattern = Regex("^tournament\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")

/**
 * A name in a link: a username or a Player id, nothing else.
 *
 * The site writes `?player=evan`, not `?player=player.evan` - a username is
 * what a person can type. Refusing anything that was not a canonical id, which
 * this did at first, silently threw away the Player the link was about.
 */
private val playerReferencePattern = Regex("^[A-Za-z0-9._-]{1,140}$")
private val trackFocusPattern = Regex("^track\\.[a-z0-9_]{2,150}$")
private val buildPartPattern = Regex("^(?:character|body|tire|glider)\\.[a-z0-9_]{2,60}$")

/** The site's own sort names for the statistics table. */
private val statisticsSortNames = setOf(
    "track", "cup", "races", "players", "nights", "ghost", "time", "best",
)

/** `stats_track` and its four companions, keyed the way the panel keys them. */
private val statisticsFilterParameters = listOf(
    "track" to "stats_track",
    "cup" to "stats_cup",
    "races" to "stats_races",
    "players" to "stats_players",
    "nights" to "stats_nights",
)

/**
 * The Ranking's 96-track table, as `tournament-standing-link.ts` writes it:
 * `f_` and the column, `sort=win&dir=asc`, `tracks=open`. The sort column is
 * written the way it reads - "raced", not "races".
 */
private val trackFilterParameters = listOf(
    "track" to "f_track",
    "cup" to "f_cup",
    "races" to "f_raced",
    "wins" to "f_won",
    "best" to "f_best",
    "average" to "f_average",
    "win" to "f_win",
)
private val trackSortNames = setOf("track", "raced", "won", "best", "average", "win")

/** What `#alle-races` points at on the site. */
internal const val ANDROID_STATISTICS_ANCHOR = "alle-races"

private val shortTrackPattern = Regex("\\d{1,3}")

/**
 * The short leaderboard address, as the Web's `short-links.ts` reads it (ADR-0199, owner
 * 2026-09-29): a YouTube description shows a link as its text, so LiveTrial links `?lb=8&mode=150`
 * (the schema-9 track index). An unknown track number opens the tracks.
 */
/** A shared run as the link names it: an 8-character code, an id without its prefix, or a full id.
 *  The board finds the one result it names (`androidFindRun`), as the Web's `findRun` does. */
internal fun androidRunId(raw: String?): String? = raw?.trim()?.takeIf { it.isNotEmpty() && it.length <= 160 }

internal fun androidShortLink(query: Map<String, String>): AndroidDeepLink? {
    query["lb"]?.let { number ->
        val track = if (shortTrackPattern.matches(number)) {
            Schema9AndroidTrackCatalog.entries.firstOrNull { it.index == number.toInt() }
        } else {
            null
        }
        return if (track == null) {
            AndroidDeepLink.Tracks
        } else {
            AndroidDeepLink.Track(track.id, androidLinkMode(query["mode"]), androidRunId(query["run"]))
        }
    }
    return null
}

/**
 * One of ours, or nothing.
 *
 * Nothing is a real answer and the caller acts on it: an address on this host
 * that this app has no screen for - `/scanner/`, a download, a game asset -
 * belongs in a browser, and handing it back unparsed is how the phone knows to
 * open one instead of swallowing the tap.
 */
internal fun parseAndroidDeepLink(address: String?, allowedHost: String = ANDROID_PRODUCT_LINK_HOST): AndroidDeepLink? {
    val parsed = androidProductAddress(address, allowedHost) ?: return null
    val query = parsed.query
    androidShortLink(query)?.let { return it }

    // The site's own router order, so one address cannot mean two things on
    // two clients. A published edition's report, a public night and a night in
    // the Tournaments list all end at the same place here: the phone has one
    // night screen and it already shows a published night as the document.
    query["night-report"]?.let {
        if (tournamentIdPattern.matches(it)) return AndroidDeepLink.TournamentNight(it)
    }
    query["tournament"]?.let {
        return if (tournamentIdPattern.matches(it)) {
            AndroidDeepLink.TournamentNight(it)
        } else {
            AndroidDeepLink.Tournaments()
        }
    }
    val tournaments = query["tournaments"]
    if (tournaments != null) {
        if (tournamentIdPattern.matches(tournaments)) {
            return AndroidDeepLink.TournamentNight(tournaments)
        }
        val filters = buildMap {
            for ((key, name) in statisticsFilterParameters) {
                val filter = query[name]?.trim()?.take(40)
                if (!filter.isNullOrEmpty()) put(key, filter)
            }
        }
        val sort = query["stats_sort"]?.takeIf { statisticsSortNames.contains(it) }
        val focus = query["stats_focus"]?.takeIf { trackFocusPattern.matches(it) }
        // A link that names any of the panel's numbers is a link about them.
        val asked = parsed.fragment == ANDROID_STATISTICS_ANCHOR ||
            query["stats"] == "open" || sort != null || focus != null || filters.isNotEmpty()
        return AndroidDeepLink.Tournaments(
            statistics = asked,
            statisticsSort = sort,
            statisticsDescending = query["stats_dir"] != "asc",
            statisticsFilters = filters,
            statisticsFocus = focus,
        )
    }

    val ranking = query["ranking"]
    val player = query["player"]?.trim()?.takeIf { playerReferencePattern.matches(it) }
    if (ranking != null) {
        val filters = buildMap {
            for ((key, name) in trackFilterParameters) {
                val filter = query[name]?.trim()?.take(40)
                if (!filter.isNullOrEmpty()) put(key, filter)
            }
        }
        val sort = query["sort"]?.takeIf { trackSortNames.contains(it) }
        val direction = query["dir"]
        return AndroidDeepLink.Ranking(
            tournament = ranking == "tournament",
            player = player,
            compare = (query["compare"] ?: "").split(",").map { it.trim() }
                .filter { playerReferencePattern.matches(it) }.take(4),
            mode = androidLinkMode(query["mode"]),
            scope = query["scope"]?.takeIf { it == "base" || it == "bcp" || it == "all" },
            tab = query["tab"]?.takeIf {
                it == "total" || it == "medals" || it == "mastery" || it == "tracks"
            },
            focus = query["focus"]?.takeIf { it.isNotBlank() }?.take(40),
            // The table opens when the reader asked for it, and also when they
            // sent a link that only makes sense with it open.
            tracksOpen = query["tracks"] == "open" || sort != null || filters.isNotEmpty(),
            trackSort = sort,
            trackDescending = when (direction) {
                "asc" -> false
                "desc" -> true
                else -> null
            },
            trackFilters = filters,
        )
    }
    // `?player=x` on its own is that Player's page; with `?ranking=` it was the
    // ranking seen for them, which is why the site dispatches ranking first.
    if (player != null) return AndroidDeepLink.PlayerPage(player)

    query["leaderboard"]?.let { track ->
        val trackId = track.takeIf { Schema9AndroidTrackCatalog.find(it) != null }
        return if (trackId == null) {
            AndroidDeepLink.Tracks
        } else {
            AndroidDeepLink.Track(trackId, androidLinkMode(query["mode"]), androidRunId(query["run"]))
        }
    }
    if (query.containsKey("cups")) return AndroidDeepLink.Tracks
    // Comparing two Players is the Ranking's own comparison here.
    query["compare"]?.let { raw ->
        val ids = raw.split(",").map { it.trim() }
            .filter { playerReferencePattern.matches(it) }.take(2)
        if (ids.isNotEmpty()) return AndroidDeepLink.Ranking(tournament = false, compare = ids)
    }
    query["build"]?.let { raw ->
        val parts = raw.split(",").map { it.trim() }
            .filter { buildPartPattern.matches(it) }.distinct().take(4)
        if (parts.isNotEmpty()) return AndroidDeepLink.Build(parts)
    }
    if (query.containsKey("records")) return AndroidDeepLink.Records
    if (query.containsKey("mystats")) return AndroidDeepLink.MyStats
    if (query.containsKey("notifications")) return AndroidDeepLink.Notifications
    if (query.containsKey("settings")) return AndroidDeepLink.Settings
    if (query.containsKey("admin")) return AndroidDeepLink.Administration
    if (parsed.device || query.containsKey("signin")) return AndroidDeepLink.Account
    if (query.containsKey("apps")) return AndroidDeepLink.Apps
    // Community and activity have no screen of their own on the phone yet, and
    // Home is where both are summarized.
    return AndroidDeepLink.Home
}

private data class AndroidProductAddress(
    val query: Map<String, String>,
    val fragment: String?,
    val device: Boolean,
)

/**
 * The query and fragment of one of our own addresses.
 *
 * Accepts the full `https://example.invalid/?...` a shared link carries and
 * the bare `/?...` the notification rules produce, and refuses everything else
 * - another host, plain http, or a path this app has no screen for.
 */
private fun androidProductAddress(address: String?, allowedHost: String): AndroidProductAddress? {
    val raw = address?.trim().orEmpty()
    if (raw.isEmpty() || raw.length > 2048) return null
    var rest = raw
    if (!rest.startsWith("/")) {
        val separator = rest.indexOf("://")
        if (separator < 0) return null
        if (rest.substring(0, separator).lowercase() != "https") return null
        val authorityAndPath = rest.substring(separator + 3)
        val cut = authorityAndPath.indexOfFirst { it == '/' || it == '?' || it == '#' }
        val authority = (if (cut < 0) authorityAndPath else authorityAndPath.substring(0, cut))
            .substringAfterLast('@').substringBefore(':').lowercase()
        if (authority != allowedHost.lowercase() &&
            !(allowedHost == ANDROID_PRODUCT_LINK_HOST && authority == "www.$allowedHost")
        ) {
            return null
        }
        rest = if (cut < 0) "/" else authorityAndPath.substring(cut)
        if (!rest.startsWith("/")) rest = "/$rest"
    }
    val fragment = rest.substringAfter('#', "").takeIf { it.isNotEmpty() }
    val withoutFragment = rest.substringBefore('#')
    val path = withoutFragment.substringBefore('?')
    val device = path == "/device" || path == "/device/"
    if (path != "/" && path != "/index.html" && !device) return null
    val queryString = withoutFragment.substringAfter('?', "")
    val query = LinkedHashMap<String, String>()
    for (pair in queryString.split('&')) {
        if (pair.isEmpty()) continue
        val name = androidLinkDecode(pair.substringBefore('='))
        if (name.isEmpty() || query.containsKey(name)) continue
        query[name] = androidLinkDecode(pair.substringAfter('=', ""))
    }
    return AndroidProductAddress(query, fragment, device)
}

/** `URLSearchParams` decoding, including its `+` for a space. */
private fun androidLinkDecode(value: String): String =
    runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)

private fun androidLinkMode(value: String?): Int? =
    value?.toIntOrNull()?.takeIf { it == 150 || it == 200 }
