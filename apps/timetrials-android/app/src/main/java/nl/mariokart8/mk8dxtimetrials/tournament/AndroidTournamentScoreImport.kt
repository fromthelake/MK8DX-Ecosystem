package nl.mariokart8.mk8dxtimetrials.tournament

import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * Resolving the names in a score workbook to the Players in a group, ported
 * from the source Manager's `buildSuggestedScoreImportMapping`,
 * `scoreImportSimilarity` and `scoreImportConfidenceMeta` in `assets/app.js`.
 *
 * The workbook records the name each racer used in the game, which is often not
 * their tournament name: "Sounder" is Sander, "Mar-Kart-0" is Marco. The source
 * resolves those through a curated alias list; the canonical product resolves
 * them through the Player's aliases (migration 0049), which the operator can
 * now maintain from their profile.
 *
 * Nothing is applied on a suggestion alone. Every mapping starts unreviewed and
 * the operator confirms it, exactly as the source does - including the case the
 * owner called out: a name that matches nothing can still be pointed at a
 * Player by hand.
 */

/** Where a candidate name for a Player came from; higher wins a tie. */
internal enum class AndroidScoreNameSource(val priority: Int) {
    DISPLAY(1),
    ALIAS(3),
}

internal data class AndroidScoreCandidateName(
    val name: String,
    val source: AndroidScoreNameSource,
)

/** The source's `normalizedNameKey`. */
internal fun androidScoreNameKey(raw: String): String =
    raw.replace(Regex("\\s+"), " ").trim().lowercase(Locale.forLanguageTag("nl-NL"))

/**
 * The source's `scoreImportSimilarity`: exact, prefix, containment, then token
 * overlap. Deliberately not a Levenshtein distance - this is the scale the
 * confidence thresholds below were tuned against.
 */
internal fun androidScoreSimilarity(left: String, right: String): Double {
    val a = androidScoreNameKey(left)
    val b = androidScoreNameKey(right)
    if (a.isEmpty() || b.isEmpty()) return 0.0
    if (a == b) return 1.0
    if (a.startsWith(b) || b.startsWith(a)) return 0.93
    if (a.contains(b) || b.contains(a)) return 0.89
    val leftTokens = a.split(" ").filter { it.isNotEmpty() }.toSet()
    val rightTokens = b.split(" ").filter { it.isNotEmpty() }.toSet()
    val intersection = leftTokens.count { rightTokens.contains(it) }
    val union = (leftTokens + rightTokens).size
    return if (union == 0) 0.0 else intersection.toDouble() / union.toDouble()
}

/** Every name a Player answers to, display name first. */
internal fun androidScoreCandidateNames(
    displayName: String,
    aliases: List<String>,
): List<AndroidScoreCandidateName> {
    val seen = mutableSetOf<String>()
    val names = mutableListOf<AndroidScoreCandidateName>()
    fun add(value: String, source: AndroidScoreNameSource) {
        val key = androidScoreNameKey(value)
        if (key.isEmpty() || !seen.add(key)) return
        names.add(AndroidScoreCandidateName(value.trim(), source))
    }
    add(displayName, AndroidScoreNameSource.DISPLAY)
    aliases.forEach { add(it, AndroidScoreNameSource.ALIAS) }
    return names
}

/**
 * The source's confidence vocabulary and its severity, from
 * `scoreImportConfidenceMeta` and the `.score-import-suggestion-badge` rules:
 * an exact match and an alias match are green, a strong match blue, a likely
 * one amber, and anything left to check red.
 */
internal enum class AndroidScoreMatchTone { SETTLED, STRONG, LIKELY, ATTENTION }

internal data class AndroidScoreMatchMeta(
    val label: String,
    val tone: AndroidScoreMatchTone,
)

internal fun androidScoreMatchMeta(
    confidence: Double?,
    viaAlias: Boolean,
    manual: Boolean,
    language: AndroidProductLanguage,
): AndroidScoreMatchMeta = when {
    manual -> AndroidScoreMatchMeta(
        androidText(language, "Linked by hand", "Handmatig gekoppeld"),
        AndroidScoreMatchTone.SETTLED,
    )
    confidence == null -> AndroidScoreMatchMeta(
        androidText(language, "Review", "Controleren"),
        AndroidScoreMatchTone.ATTENTION,
    )
    viaAlias -> AndroidScoreMatchMeta(
        androidText(language, "Name match", "Naam-match"),
        AndroidScoreMatchTone.SETTLED,
    )
    confidence >= 0.999 -> AndroidScoreMatchMeta(
        androidText(language, "Exact match", "Exacte match"),
        AndroidScoreMatchTone.SETTLED,
    )
    confidence >= 0.93 -> AndroidScoreMatchMeta(
        androidText(language, "Very strong", "Zeer sterk"),
        AndroidScoreMatchTone.STRONG,
    )
    confidence >= 0.75 -> AndroidScoreMatchMeta(
        androidText(language, "Likely", "Waarschijnlijk"),
        AndroidScoreMatchTone.LIKELY,
    )
    else -> AndroidScoreMatchMeta(
        androidText(language, "Review", "Controleren"),
        AndroidScoreMatchTone.ATTENTION,
    )
}

/** The source shows the similarity beside the badge as a whole percentage. */
internal fun androidScoreConfidencePercent(
    confidence: Double?,
    manual: Boolean,
    language: AndroidProductLanguage,
): String? =
    if (manual || confidence == null) {
        null
    } else {
        androidText(language, "${(confidence * 100).toInt()}% similar", "${(confidence * 100).toInt()}% overeenkomst")
    }

/** A workbook name and the Player it is currently pointed at, if any. */
internal data class AndroidScoreMapping(
    val workbookName: String,
    val points: Int,
    val playerId: String?,
    val confidence: Double?,
    val viaAlias: Boolean,
    val manual: Boolean = false,
    /**
     * The Player name that actually matched. When that is an alias rather than
     * the display name, the row says so and names it: "Naam-match" alone left
     * the operator guessing why an unfamiliar in-game handle had been pointed
     * at a participant.
     */
    val matchedName: String? = null,
) {
    fun meta(language: AndroidProductLanguage): AndroidScoreMatchMeta =
        androidScoreMatchMeta(confidence, viaAlias, manual, language)
    fun label(language: AndroidProductLanguage): String = meta(language).label
    fun percent(language: AndroidProductLanguage): String? = androidScoreConfidencePercent(confidence, manual, language)

    /** A name nothing was pointed at yet. */
    val unresolved: Boolean get() = playerId == null
}

/** A Player in the group a workbook row could belong to. */
internal data class AndroidScoreTarget(
    val playerId: String,
    val displayName: String,
    val aliases: List<String>,
)

/** The source's `SCORE_IMPORT_MIN_SIMILARITY`: below this it is not a candidate. */
private const val MINIMUM_SIMILARITY = 0.34

private data class Candidate(
    val workbookName: String,
    val playerId: String,
    val score: Double,
    val viaAlias: Boolean,
    val matchedName: String,
)

/**
 * Suggests one Player per workbook name, greedily and one-to-one: the strongest
 * pair is taken first and both sides are then spent, so two racers can never be
 * resolved to the same Player. Ported from the source's candidate sort.
 */
internal fun androidSuggestScoreMapping(
    workbookRows: List<Pair<String, Int>>,
    targets: List<AndroidScoreTarget>,
): List<AndroidScoreMapping> {
    val candidates = mutableListOf<Candidate>()
    workbookRows.forEach { (workbookName, _) ->
        targets.forEach { target ->
            var best = 0.0
            var bestPriority = 0
            var bestViaAlias = false
            var bestName = target.displayName
            androidScoreCandidateNames(target.displayName, target.aliases).forEach { candidate ->
                val score = androidScoreSimilarity(workbookName, candidate.name)
                val priority = candidate.source.priority
                if (score > best || (score == best && priority > bestPriority)) {
                    best = score
                    bestPriority = priority
                    bestViaAlias = candidate.source == AndroidScoreNameSource.ALIAS
                    bestName = candidate.name
                }
            }
            if (best > MINIMUM_SIMILARITY) {
                candidates.add(Candidate(workbookName, target.playerId, best, bestViaAlias, bestName))
            }
        }
    }
    val ordered = candidates.sortedWith(
        compareByDescending<Candidate> { it.score }
            .thenByDescending { if (it.viaAlias) 1 else 0 }
            .thenBy { it.workbookName.lowercase(Locale.ROOT) },
    )
    val usedNames = mutableSetOf<String>()
    val usedPlayers = mutableSetOf<String>()
    val chosen = mutableMapOf<String, Candidate>()
    ordered.forEach { candidate ->
        if (usedNames.contains(candidate.workbookName)) return@forEach
        if (usedPlayers.contains(candidate.playerId)) return@forEach
        usedNames.add(candidate.workbookName)
        usedPlayers.add(candidate.playerId)
        chosen[candidate.workbookName] = candidate
    }
    return workbookRows.map { (workbookName, points) ->
        val candidate = chosen[workbookName]
        AndroidScoreMapping(
            workbookName = workbookName,
            points = points,
            playerId = candidate?.playerId,
            confidence = candidate?.score,
            viaAlias = candidate?.viaAlias ?: false,
            matchedName = candidate?.matchedName,
        )
    }
}

/**
 * Points a mapping at a Player by hand. The source deliberately does **not**
 * release whoever else holds that Player: it lets the duplicate stand and
 * shows it, in the picker and in the group's problem list, so the operator can
 * see what they did and fix the right row. Stealing silently would hide it.
 */
internal fun androidAssignScoreMapping(
    mappings: List<AndroidScoreMapping>,
    workbookName: String,
    playerId: String?,
): List<AndroidScoreMapping> = mappings.map { mapping ->
    if (mapping.workbookName != workbookName) {
        mapping
    } else {
        mapping.copy(
            playerId = playerId,
            confidence = null,
            viaAlias = false,
            manual = playerId != null,
        )
    }
}

/** How many workbook rows currently point at each Player. */
internal fun androidScoreSelectionCounts(
    mappings: List<AndroidScoreMapping>,
): Map<String, Int> {
    val counts = mutableMapOf<String, Int>()
    mappings.forEach { mapping ->
        val playerId = mapping.playerId ?: return@forEach
        counts[playerId] = (counts[playerId] ?: 0) + 1
    }
    return counts
}

/**
 * What still stands in the way of importing this group, in the operator's
 * words. The source shows exactly this beside its confirm control so the
 * problem can be fixed without hunting for it.
 */
internal fun androidScoreGroupProblems(
    mappings: List<AndroidScoreMapping>,
    targets: List<AndroidScoreTarget>,
    language: AndroidProductLanguage,
): List<String> {
    if (mappings.isEmpty()) {
        return listOf(androidText(language, "This group has no recording yet.", "Deze groep heeft nog geen opname."))
    }
    val problems = mutableListOf<String>()
    val unresolved = mappings.filter { it.unresolved }.map { it.workbookName }
    if (unresolved.isNotEmpty()) {
        problems.add(
            androidText(
                language,
                "Not linked yet: ${unresolved.joinToString(", ")}.",
                "Nog niet gekoppeld: ${unresolved.joinToString(", ")}.",
            ),
        )
    }
    val names = targets.associate { it.playerId to it.displayName }
    androidScoreSelectionCounts(mappings).filterValues { it > 1 }.forEach { (playerId, count) ->
        problems.add(
            androidText(
                language,
                "${names[playerId] ?: playerId} is chosen $count times.",
                "${names[playerId] ?: playerId} is $count keer gekozen.",
            ),
        )
    }
    val missing = targets.filter { target ->
        mappings.none { it.playerId == target.playerId }
    }.map { it.displayName }
    if (missing.isNotEmpty()) {
        problems.add(
            androidText(
                language,
                "Without a score: ${missing.joinToString(", ")}.",
                "Zonder score: ${missing.joinToString(", ")}.",
            ),
        )
    }
    return problems
}

/** A group may be confirmed once nothing stands in the way. */
internal fun androidScoreGroupReady(
    mappings: List<AndroidScoreMapping>,
    targets: List<AndroidScoreTarget>,
): Boolean = androidScoreGroupProblems(mappings, targets, AndroidProductLanguage.ENGLISH).isEmpty()

/** The character a workbook row says its racer drove. */
internal data class AndroidWorkbookCharacter(
    val label: String,
    val roster: String? = null,
)

/**
 * The character per racer, per recording. The workbook has named it all along
 * and the Web console has sent it since 2026-09-15; the phone read the column
 * only to check it existed, so a phone import left every group without a
 * character - the same hole TN13's finals fell into (owner, 2026-09-16).
 */
internal fun androidWorkbookStandingsCharacters(
    sheet: AndroidWorkbookSheet,
): Map<String, Map<String, AndroidWorkbookCharacter>> {
    val byVideo = linkedMapOf<String, MutableMap<String, AndroidWorkbookCharacter>>()
    sheet.rows.forEach { row ->
        val video = row["VideoName"]?.trim().orEmpty()
        val name = row["PlayerName"]?.trim().orEmpty()
        val label = row["Character"]?.trim().orEmpty()
        if (name.isEmpty() || label.isEmpty()) return@forEach
        val roster = row["CharacterRosterName"]?.trim()?.takeIf { it.isNotEmpty() }
        byVideo.getOrPut(video) { linkedMapOf() }[name] = AndroidWorkbookCharacter(label, roster)
    }
    return byVideo
}

/** A character, resolved to the Player the operator pointed its row at. */
internal data class AndroidResolvedCharacter(
    val playerId: String,
    val label: String,
    val characterKey: String?,
    val roster: String?,
)

/**
 * The characters a confirmed group will send: one per mapping that has both a
 * Player and a character in the file. A row still waiting for a Player simply
 * has no character to record - the name is never guessed at.
 */
internal fun androidResolvedCharacters(
    mappings: List<AndroidScoreMapping>,
    characters: Map<String, AndroidWorkbookCharacter>,
): List<AndroidResolvedCharacter> = mappings.mapNotNull { mapping ->
    val playerId = mapping.playerId ?: return@mapNotNull null
    val character = characters[mapping.workbookName]
        ?: characters.entries.firstOrNull {
            androidScoreNameKey(it.key) == androidScoreNameKey(mapping.workbookName)
        }?.value
        ?: return@mapNotNull null
    val label = character.label.trim().take(64)
    if (label.isEmpty()) return@mapNotNull null
    AndroidResolvedCharacter(
        playerId = playerId,
        label = label,
        characterKey = androidTournamentCharacterKey(label, character.roster),
        roster = character.roster?.trim()?.take(64)?.takeIf { it.isNotEmpty() },
    )
}

/**
 * Reads the `Final Standings` sheet into the per-group totals Step 5 and Step 9
 * already accept: one row per racer with the points they finished on.
 */
internal fun androidWorkbookStandingsRows(
    sheet: AndroidWorkbookSheet,
): Map<String, List<Pair<String, Int>>> {
    val byVideo = linkedMapOf<String, MutableList<Pair<String, Int>>>()
    sheet.rows.forEach { row ->
        val video = row["VideoName"]?.trim().orEmpty()
        val name = row["PlayerName"]?.trim().orEmpty()
        val points = row["TotalPoints"]?.trim()?.toDoubleOrNull()?.toInt()
        if (name.isEmpty() || points == null) return@forEach
        byVideo.getOrPut(video) { mutableListOf() }.add(name to points)
    }
    return byVideo
}
