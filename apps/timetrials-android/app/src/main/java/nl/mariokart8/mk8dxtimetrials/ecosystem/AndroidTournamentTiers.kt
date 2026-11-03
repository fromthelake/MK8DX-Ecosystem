package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.ui.graphics.Color
import nl.mariokart8.mk8dxtimetrials.tournament.androidTournamentTierColor
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * The all-time Tournament ranking badge, identical to the web's
 * `tournament-tiers.ts` (`TOURNAMENT_RANKING_BANDS`): recovered from the
 * Manager's `tierByStanding()`, fixed bands of twelve, now eleven of them
 * (ranks 1-132), with the same owner-approved names and the same badge
 * colours. A rank outside the bands has no label, and the pages then show no
 * badge - exactly as the web does.
 *
 * Only the ranking badge reads this list. A night's final groups stay the
 * five tiers of the console's own `TournamentTiers`.
 *
 * This is a TOURNAMENT concept and must never be mixed with Time Trial
 * Mastery.
 */
internal data class AndroidTournamentTier(
    val key: String,
    val name: String,
    val dutchName: String,
    val minRank: Int,
    val maxRank: Int,
    val color: Color,
)

/**
 * Phase 17: the five group tiers' colours are read from the product's one
 * definition of them, `androidTournamentTierColor`, rather than repeated here.
 * A tier key always has a colour there, so the fallback never fires; it only
 * keeps this list total.
 */
private fun tierColor(key: String): Color =
    androidTournamentTierColor(key) ?: Color.Unspecified

internal val ANDROID_TOURNAMENT_TIERS = listOf(
    AndroidTournamentTier("champion", "Champion", "Kampioen", 1, 12, tierColor("champion")),
    AndroidTournamentTier("talent", "Talent", "Talent", 13, 24, tierColor("talent")),
    AndroidTournamentTier("wild", "Wild", "Wild", 25, 36, tierColor("wild")),
    AndroidTournamentTier("adventure", "Adventure", "Avontuur", 37, 48, tierColor("adventure")),
    AndroidTournamentTier("feest", "Party", "Feest", 49, 60, tierColor("feest")),
    // The six ranking-only bands: never a final group. Their colours are a
    // proposal awaiting owner approval, one line each, and live only here.
    AndroidTournamentTier("mushroom", "Mushroom", "Paddenstoel", 61, 72, Color(0xFFEF4444)),
    AndroidTournamentTier("squid", "Squid", "Inktvis", 73, 84, Color(0xFF14B8A6)),
    AndroidTournamentTier("shield", "Shield", "Schild", 85, 96, Color(0xFF1D4ED8)),
    AndroidTournamentTier("cloud", "Cloud", "Wolk", 97, 108, Color(0xFFE2E8F0)),
    AndroidTournamentTier("tourist", "Tourist", "Toerist", 109, 120, Color(0xFFA3E635)),
    AndroidTournamentTier("coin", "Coin", "Munt", 121, 132, Color(0xFF9A3412)),
)

internal fun androidTournamentTierByRank(rank: Int): AndroidTournamentTier? =
    if (rank <= 0) null else ANDROID_TOURNAMENT_TIERS.firstOrNull { rank in it.minRank..it.maxRank }

/**
 * A tier's or band's name in the reader's language. Each name is its own
 * literal `androidText` call so the message extraction (and so every product
 * language's catalog) carries it. Null for a key that is no tier.
 */
internal fun androidTournamentTierLabel(key: String, language: AndroidProductLanguage): String? = when (key) {
    "champion" -> androidText(language, "Champion", "Kampioen")
    "talent" -> androidText(language, "Talent", "Talent")
    "wild" -> androidText(language, "Wild", "Wild")
    "adventure" -> androidText(language, "Adventure", "Avontuur")
    "feest" -> androidText(language, "Party", "Feest")
    "mushroom" -> androidText(language, "Mushroom", "Paddenstoel")
    "squid" -> androidText(language, "Squid", "Inktvis")
    "shield" -> androidText(language, "Shield", "Schild")
    "cloud" -> androidText(language, "Cloud", "Wolk")
    "tourist" -> androidText(language, "Tourist", "Toerist")
    "coin" -> androidText(language, "Coin", "Munt")
    else -> null
}

/** The badge text: the band's name in the reader's language, in capitals as the chips print it. */
internal fun androidTournamentTierBadge(tier: AndroidTournamentTier, language: AndroidProductLanguage): String =
    (androidTournamentTierLabel(tier.key, language) ?: tier.name).uppercase(language.locale)
