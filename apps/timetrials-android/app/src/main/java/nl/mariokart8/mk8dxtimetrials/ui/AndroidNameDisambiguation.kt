package nl.mariokart8.mk8dxtimetrials.ui

import java.util.Locale

// ADR-0218: display names may repeat; usernames stay unique. Where two equal
// names meet on one screen - a ranking, a statistics table - the username is
// added to those names only, exactly as the website does.

private fun nameKey(value: String): String = value.trim().lowercase(Locale.ROOT)

/** The display names that more than one Player in the list carries. (playerId, displayName) pairs. */
internal fun androidRepeatedDisplayNames(entries: List<Pair<String, String>>): Set<String> =
    entries.groupBy({ nameKey(it.second) }, { it.first })
        .filterValues { players -> players.toSet().size > 1 }
        .keys

/** "Marc" stays "Marc" unless another Marc is on the same screen: then "Marc (@marc-2)". */
internal fun androidDisambiguatedName(displayName: String, username: String?, repeated: Set<String>): String =
    if (!username.isNullOrEmpty() && nameKey(displayName) in repeated) "$displayName (@$username)" else displayName
