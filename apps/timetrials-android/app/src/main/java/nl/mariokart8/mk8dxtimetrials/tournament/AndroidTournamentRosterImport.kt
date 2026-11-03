package nl.mariokart8.mk8dxtimetrials.tournament

import java.text.Normalizer
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * The Step 2 CSV import flow: ADR-0177 decisions 8 and 10, revised by ADR-0218
 * (a name is never an identity), the same walk as the website.
 *
 * Every row shows the Players its name may mean, with context, beside "new
 * Player" and "skip". Only an unambiguous row starts with a suggestion and
 * nothing is written until the Director applies the list. New Players still
 * take two confirmations; a rejection writes nothing and names the rows.
 */
internal sealed interface AndroidRosterImport {
    /** The file's rows with their candidates and the Director's choice per row (null = still open). */
    data class Review(
        val rows: List<AndroidRosterCsvRow>,
        val entries: List<AndroidRosterNameCandidates>,
        val choices: Map<Int, AndroidRosterChoice?>,
        val secondConfirmation: Boolean,
    ) : AndroidRosterImport {
        val openRows: Int get() = choices.values.count { it == null }
        val creating: Int get() = choices.values.count { it == AndroidRosterChoice.New }
    }

    data class Working(val message: String) : AndroidRosterImport
    data class Failed(val message: String) : AndroidRosterImport
    data class Applied(val updated: Int, val created: Int, val added: Int, val remembered: Int = 0) : AndroidRosterImport
}

/** What the Director chose for one import row. */
internal sealed interface AndroidRosterChoice {
    data class Player(val playerId: String) : AndroidRosterChoice
    data object New : AndroidRosterChoice
    data object Skip : AndroidRosterChoice
}

internal fun androidRosterNameKey(displayName: String): String =
    displayName.trim().lowercase(Locale.ROOT)

private fun fold(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFKD)
        .replace(Regex("\\p{M}"), "")
        .lowercase(Locale.ROOT)
        .replace(Regex("[^a-z0-9]"), "")

/**
 * What an import row starts as, exactly as the website decides it: the one
 * Player of this night's list who carries the name, or the one Player of this
 * Director's own nights who does; a name nobody carries starts as "new
 * Player". Everything else waits for a choice (null).
 */
internal fun androidRosterImportSuggestion(entry: AndroidRosterNameCandidates): AndroidRosterChoice? {
    val exact = entry.candidates.filter { it.matchedBy != "partial" }
    if (exact.isEmpty()) return AndroidRosterChoice.New
    val onNight = exact.filter { it.inTournament }
    if (onNight.size == 1) return AndroidRosterChoice.Player(onNight.single().playerId)
    if (onNight.size > 1) return null
    val own = exact.filter { it.nightsWithDirector > 0 || (it.matchedBy == "alias" && it.aliasScope == "director") }
    if (exact.size == 1 && own.size == 1) return AndroidRosterChoice.Player(own.single().playerId)
    return null
}

/** The review for a parsed file and the server's candidates, one entry per row in order. */
internal fun androidRosterReview(
    rows: List<AndroidRosterCsvRow>,
    entries: List<AndroidRosterNameCandidates>,
): AndroidRosterImport.Review = AndroidRosterImport.Review(
    rows = rows,
    entries = entries,
    choices = rows.mapIndexed { index, row ->
        row.row to entries.getOrNull(index)?.let(::androidRosterImportSuggestion)
    }.toMap(),
    secondConfirmation = false,
)

/**
 * The spellings worth keeping as the Director's own alias: the file named the
 * Player differently from their display name and username, and not by a name
 * they already answer to. (playerId, name) pairs.
 */
internal fun androidRosterAliasesToRemember(
    rows: List<Pair<String, AndroidRosterCandidate>>,
): List<Pair<String, String>> {
    val seen = mutableSetOf<String>()
    val keep = mutableListOf<Pair<String, String>>()
    rows.forEach { (name, candidate) ->
        val key = fold(name)
        if (key.isEmpty() || key == fold(candidate.displayName) || key == fold(candidate.username)) return@forEach
        if (candidate.matchedBy == "alias") return@forEach
        if (!seen.add("${candidate.playerId}\n$key")) return@forEach
        keep += candidate.playerId to name.trim()
    }
    return keep
}

/** One line of context that tells two equal names apart; the same words as the website. */
internal fun androidRosterCandidateContext(candidate: AndroidRosterCandidate, language: AndroidProductLanguage): String {
    fun nights(count: Int): String = if (count == 1) {
        androidText(language, "1 night", "1 avond")
    } else {
        androidText(language, "$count nights", "$count avonden")
    }
    val parts = mutableListOf("@${candidate.username}")
    if (candidate.matchedBy == "alias" && candidate.aliasText != null) {
        val alias = candidate.aliasText
        parts += if (candidate.aliasScope == "director") {
            androidText(language, "your name for them: $alias", "jouw naam voor deze speler: $alias")
        } else {
            androidText(language, "also known as $alias", "ook bekend als $alias")
        }
    }
    parts += when {
        candidate.nights == 0 -> androidText(language, "no nights yet", "nog geen avonden")
        candidate.nightsWithDirector > 0 -> {
            val total = nights(candidate.nights)
            val own = candidate.nightsWithDirector
            androidText(language, "$total, $own with this Director", "$total, $own bij deze Directeur")
        }
        else -> nights(candidate.nights)
    }
    candidate.lastNightName?.let { last ->
        val date = candidate.lastNightDate
        parts += if (date == null) {
            androidText(language, "last: $last", "laatst: $last")
        } else {
            androidText(language, "last: $last ($date)", "laatst: $last ($date)")
        }
    }
    if (candidate.directorNames.isNotEmpty()) {
        val directors = candidate.directorNames.joinToString(", ")
        parts += androidText(language, "Directors: $directors", "Directeuren: $directors")
    }
    parts += if (candidate.claimed) {
        androidText(language, "has an account", "heeft een account")
    } else {
        androidText(language, "no account yet", "nog geen account")
    }
    if (candidate.inTournament) parts += androidText(language, "on this night's list", "staat op de lijst van deze avond")
    return parts.joinToString(" · ")
}

internal fun androidRosterRejectionMessage(
    rejections: List<AndroidRosterRejection>,
    language: AndroidProductLanguage = AndroidProductLanguage.DUTCH,
): String {
    if (rejections.isEmpty()) return androidText(language, "The import was rejected.", "De import is afgewezen.")
    val detail = rejections.joinToString("; ") { rejection ->
        val reason = when (rejection.reason) {
            "invalid_display_name" -> androidText(language, "unusable name", "onbruikbare naam")
            "duplicate_display_name_in_file" ->
                androidText(language, "name appears twice in the file", "naam staat dubbel in het bestand")
            "display_name_taken" -> androidText(
                language,
                "this name already exists in your nights; confirm that it is someone else",
                "deze naam bestaat al in jouw avonden; bevestig dat het iemand anders is",
            )
            "username_taken" -> androidText(language, "username is taken", "gebruikersnaam is bezet")
            else -> rejection.reason
        }
        androidText(
            language,
            "row ${rejection.row} \"${rejection.displayName}\": $reason",
            "regel ${rejection.row} \"${rejection.displayName}\": $reason",
        )
    }
    return androidText(language, "Nothing was imported. $detail.", "Er is niets geïmporteerd. $detail.")
}

/**
 * ADR-0177 decision 11 with ADR-0218: the single `Deelnemer toevoegen` field
 * shows the Players a name may mean beside "new Player"; creating one shows
 * the derived username once, after a warning when the name is already in the
 * Director's own nights.
 */
internal sealed interface AndroidParticipantAdd {
    /** The Players the typed name may mean; nothing is added until the Director picks one. */
    data class Choose(val entry: AndroidRosterNameCandidates) : AndroidParticipantAdd

    /** Creating a new Player needs the operator to agree; `confirmSameName` after the own-nights warning. */
    data class Confirm(
        val displayName: String,
        val username: String,
        val confirmSameName: Boolean = false,
    ) : AndroidParticipantAdd

    data class Working(val message: String) : AndroidParticipantAdd
    data class Failed(val message: String) : AndroidParticipantAdd
    data class Created(val displayName: String, val username: String) : AndroidParticipantAdd
}

/** ADR-0218: the board's pending "new Player" for a name Players already carry. */
internal data class AndroidBoardRosterChoice(
    val stage: String,
    val seat: AndroidSeatTarget,
    val ns1: Boolean,
    val ns2: Boolean,
    val park: Boolean,
    val entry: AndroidRosterNameCandidates,
)

/**
 * Maps a name from an imported group-layout file onto the canonical Player it
 * belongs to, by display name first and then by alias. Returns null when
 * nothing matches. (Step 3/7 layout files only; ADR-0218 leaves them as they are.)
 */
internal fun androidResolvePlayerByName(
    name: String,
    players: List<AndroidTournamentPlayerSearchResult>,
): AndroidTournamentPlayerSearchResult? {
    val key = androidRosterNameKey(name)
    if (key.isEmpty()) return null
    players.firstOrNull { androidRosterNameKey(it.displayName) == key }?.let { return it }
    return players.firstOrNull { player ->
        player.aliases.any { androidRosterNameKey(it) == key }
    }
}

private val ROSTER_USERNAME_ALLOWED = Regex("^[a-z0-9_-]{3,16}$")

/**
 * Mirrors `rosterUsernameFor` in the API's player onboarding service so the
 * operator sees the username before agreeing to it. This is a preview only:
 * the server derives and allocates the real username (the next free suffix,
 * `marc-2`, when the plain one is taken) and a created Player reports back
 * the username it actually received.
 */
internal fun androidRosterUsernameFor(displayName: String): String? {
    val normalized = Normalizer.normalize(displayName, Normalizer.Form.NFKD)
        .replace(Regex("[̀-ͯ]"), "")
        .lowercase(Locale.ROOT)
        .replace(Regex("[^a-z0-9]+"), "_")
        .replace(Regex("_+"), "_")
        .trim('_')
        .take(16)
    return if (ROSTER_USERNAME_ALLOWED.matches(normalized)) normalized else null
}
