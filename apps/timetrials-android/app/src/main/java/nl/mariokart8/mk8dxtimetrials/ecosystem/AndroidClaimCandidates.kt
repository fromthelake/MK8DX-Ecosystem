package nl.mariokart8.mk8dxtimetrials.ecosystem

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

// ADR-0219: the Android twin of the website's "find yourself" list. The same
// two questions (Time Trial times on this site? a tournament listed here?)
// and the same public context per Player, read from
// /v1/native/claim-candidates (mk8dx.claim-candidates.v1).

@Serializable
internal data class AndroidClaimCandidateTimeTrials(
    val times: Int = 0,
    val lastAt: String? = null,
    val classes: List<Int> = emptyList(),
)

@Serializable
internal data class AndroidClaimCandidateLastNight(val name: String, val date: String? = null)

@Serializable
internal data class AndroidClaimCandidateTournaments(
    val nights: Int = 0,
    val directorNames: List<String> = emptyList(),
    val lastNight: AndroidClaimCandidateLastNight? = null,
)

@Serializable
internal data class AndroidClaimCandidate(
    val playerId: String,
    val username: String,
    val displayName: String,
    val aliases: List<String> = emptyList(),
    val claimed: Boolean = false,
    val matchesAnswers: Boolean = false,
    val timeTrials: AndroidClaimCandidateTimeTrials = AndroidClaimCandidateTimeTrials(),
    val tournaments: AndroidClaimCandidateTournaments = AndroidClaimCandidateTournaments(),
)

@Serializable
private data class AndroidClaimCandidatesDocument(
    val schemaVersion: String = "",
    val candidates: List<AndroidClaimCandidate> = emptyList(),
)

private val claimCandidateJson = Json { ignoreUnknownKeys = true; explicitNulls = false }

/** Parses `mk8dx.claim-candidates.v1`; anything else is refused. */
internal fun parseAndroidClaimCandidates(body: String): List<AndroidClaimCandidate> {
    val document = claimCandidateJson.decodeFromString<AndroidClaimCandidatesDocument>(body)
    if (document.schemaVersion != "mk8dx.claim-candidates.v1" || document.candidates.size > 20) {
        throw AndroidIdentityLinkException(message = "Unexpected answer from the server.")
    }
    return document.candidates
}

/** The Time Trial line: how many published times, the last one, the classes. */
internal fun androidClaimCandidateTimeTrialLine(
    timeTrials: AndroidClaimCandidateTimeTrials,
    language: AndroidProductLanguage,
): String {
    if (timeTrials.times == 0) {
        return androidText(language, "No published Time Trials", "Geen gepubliceerde Time Trials")
    }
    val count = timeTrials.times
    val parts = mutableListOf(
        if (count == 1) {
            androidText(language, "1 published Time Trial", "1 gepubliceerde Time Trial")
        } else {
            androidText(language, "$count published Time Trials", "$count gepubliceerde Time Trials")
        },
    )
    timeTrials.lastAt?.let { last -> parts += androidText(language, "last on $last", "laatste op $last") }
    val classes = timeTrials.classes.filter { it == 150 || it == 200 }.distinct().sorted()
    when (classes.size) {
        2 -> parts += androidText(language, "150cc and 200cc", "150cc en 200cc")
        1 -> parts += "${classes[0]}cc"
    }
    return parts.joinToString(" · ")
}

/** The tournament line: how many nights, their Directors, the last night. */
internal fun androidClaimCandidateTournamentLine(
    tournaments: AndroidClaimCandidateTournaments,
    language: AndroidProductLanguage,
): String {
    if (tournaments.nights == 0) {
        return androidText(language, "No tournament nights", "Geen toernooiavonden")
    }
    val count = tournaments.nights
    val parts = mutableListOf(
        if (count == 1) {
            androidText(language, "1 tournament night", "1 toernooiavond")
        } else {
            androidText(language, "$count tournament nights", "$count toernooiavonden")
        },
    )
    if (tournaments.directorNames.isNotEmpty()) {
        val directors = tournaments.directorNames.joinToString(", ")
        parts += androidText(language, "Directors: $directors", "Directeuren: $directors")
    }
    tournaments.lastNight?.let { last ->
        val night = last.name
        val date = last.date
        parts += if (date == null) {
            androidText(language, "last: $night", "laatst: $night")
        } else {
            androidText(language, "last: $night ($date)", "laatst: $night ($date)")
        }
    }
    return parts.joinToString(" · ")
}

/**
 * The list in the order the website shows it: the Players that fit the
 * answers first, then the others; with no "yes" there is one group.
 */
internal fun androidClaimCandidateGroups(
    candidates: List<AndroidClaimCandidate>,
    timeTrials: Boolean,
    tournaments: Boolean,
): List<Pair<Boolean?, List<AndroidClaimCandidate>>> {
    if (!timeTrials && !tournaments) return if (candidates.isEmpty()) emptyList() else listOf(null to candidates)
    return listOf(true to candidates.filter { it.matchesAnswers }, false to candidates.filterNot { it.matchesAnswers })
        .filter { it.second.isNotEmpty() }
}
