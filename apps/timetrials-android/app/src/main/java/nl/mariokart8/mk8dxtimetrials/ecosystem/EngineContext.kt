package nl.mariokart8.mk8dxtimetrials.ecosystem

import java.net.URLEncoder

/** Why a surface shows the engine class it shows (the web's `EngineSource`). */
internal enum class EngineSource { EXPLICIT, SURFACE, PREFERENCE, DEFAULT }

internal data class ResolvedEngine(val mode: Int, val source: EngineSource)

/**
 * EngineContext (docs/design-system/ENGINE_CONTEXT_INVENTORY.md §4): one way to
 * decide which engine class (150cc / 200cc) a surface shows, and one way to put
 * it into a link. The twin of the web's `engine-context.ts`.
 *
 * Precedence, identical on web and Android: an explicit task or link `mode`
 * wins; then the surface's own last choice (where a surface keeps one); then
 * the account's Time Trial preference when it names a single engine;
 * otherwise 150.
 */
internal object EngineContext {
    /** Strict parse: only 150 / 200 (number or string). Anything else is not an engine. */
    fun parseMode(value: Any?): Int? = when (value) {
        150, "150" -> 150
        200, "200" -> 200
        else -> null
    }

    /** The engine a saved preference names, or null for "all", nothing or garbage. */
    fun preferredMode(preference: String?): Int? = when (preference) {
        "150" -> 150
        "200" -> 200
        else -> null
    }

    fun resolve(
        explicit: Int? = null,
        surface: Int? = null,
        preference: String? = null,
    ): ResolvedEngine {
        parseMode(explicit)?.let { return ResolvedEngine(it, EngineSource.EXPLICIT) }
        parseMode(surface)?.let { return ResolvedEngine(it, EngineSource.SURFACE) }
        preferredMode(preference)?.let { return ResolvedEngine(it, EngineSource.PREFERENCE) }
        return ResolvedEngine(150, EngineSource.DEFAULT)
    }

    /**
     * Link to a track leaderboard. With a known engine the link carries it;
     * without one the link leaves the engine to the track page, which resolves
     * it (never an invented 150).
     */
    fun leaderboardLink(
        trackId: String,
        mode: Int?,
        extra: List<Pair<String, String>> = emptyList(),
    ): String {
        val parts = mutableListOf("leaderboard=${encodeComponent(trackId)}")
        parseMode(mode)?.let { parts += "mode=$it" }
        for ((key, value) in extra) parts += "${encodeComponent(key)}=${encodeComponent(value)}"
        return "/?" + parts.joinToString("&")
    }

    /** JavaScript's `encodeURIComponent`, so both clients write the same address. */
    private fun encodeComponent(value: String): String =
        URLEncoder.encode(value, Charsets.UTF_8.name())
            .replace("+", "%20")
            .replace("%21", "!")
            .replace("%27", "'")
            .replace("%28", "(")
            .replace("%29", ")")
            .replace("%7E", "~")
}

/**
 * The engine Ranking shows once the account preference has loaded: [explicit]
 * is the engine a link asked for, [current] the one the screen is on (its
 * stored last choice, or a chip the Player tapped).
 */
internal fun androidRankEngineMode(explicit: Int?, current: Int, preference: String?): Int {
    // Like the web, the selector offers only the preferred engine unless a link
    // asked for the other one, so a stored choice it cannot show is no choice.
    val preferred = EngineContext.preferredMode(preference)
    return EngineContext.resolve(
        explicit = explicit,
        surface = current.takeIf { preferred == null || it == preferred },
        preference = preference,
    ).mode
}

/**
 * The engine a track page or the scanner starts on: [initialMode] is the one
 * the way in asked for (a link, the track screen's own chip), [preference] the
 * viewer's saved Time Trial preference.
 */
internal fun androidEntryStartMode(initialMode: Int?, preference: String?): Int =
    EngineContext.resolve(explicit = initialMode, preference = preference).mode
