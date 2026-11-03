package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * Reading the workbook's `Results` sheet as races rather than reading
 * `Final Standings` as totals.
 *
 * This is the difference between a night that counts and one that does not.
 * Finalisation only publishes **race results**, and only a publication reaches
 * TrueSkill, so a Tournament scored from manual totals can never be rated. The
 * Processor already writes every race it saw - `Video, Race, Track, Cup,
 * Position, Player, Race Points, ...` - so those rows are what the platform
 * should take in.
 *
 * The track name in the workbook is the Processor's own spelling and does not
 * always match the canonical catalogue ("Toad Harbour" against "Toad Harbor"),
 * so it is resolved forgivingly rather than exactly.
 */

/** The source's `REQUIRED_RESULTS_HEADERS` subset this import needs. */
internal val WORKBOOK_RACE_HEADERS = listOf("Video", "Race", "Track", "Position", "Player")

internal data class AndroidWorkbookRace(
    val video: String,
    val raceNumber: Int,
    val trackName: String,
    /** Workbook player names, best finish first. */
    val finishOrder: List<String>,
)

/** A race resolved onto the canonical catalogue and the group's Players. */
internal data class AndroidResolvedRace(
    val raceNumber: Int,
    val trackId: String,
    val finishOrder: List<String>,
)

/**
 * The catalogue names a track answers to: the name the catalogue shows and the one its identifier
 * keeps. The first is American, the second European, and the Manager writes European
 * ("Toad Harbour", "3DS Piranha Plant Pipeway").
 */
private val workbookTrackVocabulary: List<Map.Entry<String, String>> by lazy {
    Schema9AndroidTrackCatalog.entries.flatMap { entry ->
        listOf(
            java.util.AbstractMap.SimpleEntry("${entry.id}#en-US", entry.displayName),
            java.util.AbstractMap.SimpleEntry("${entry.id}#id", entry.id.removePrefix("track.").replace('_', ' ')),
        )
    }
}

/**
 * Resolves the Processor's track name onto the canonical catalogue with the central title matcher
 * (packages/icon-matcher NameMatch.matchTitle, the same rule as LiveTrial and Tournament): words in
 * any order, a clipped name, a misspelling with a clear lead; a name it cannot place stays unresolved
 * instead of becoming the first near track.
 */
internal fun androidResolveTrackId(trackName: String): String? {
    if (trackName.isBlank()) return null
    val found = nl.mariokart8.iconmatcher.NameMatch.matchTitle(trackName, workbookTrackVocabulary)
    return found.key?.substringBefore('#')
}

/**
 * Groups the `Results` rows into races: one race per recording and race number,
 * with the Players in finishing order. A row without a usable position or name
 * is skipped rather than shifting everybody else's placing.
 */
internal fun androidWorkbookRaces(sheet: AndroidWorkbookSheet): Map<String, List<AndroidWorkbookRace>> {
    data class Entry(val position: Int, val player: String)

    val byVideoAndRace = linkedMapOf<Pair<String, Int>, MutableList<Entry>>()
    val trackOf = mutableMapOf<Pair<String, Int>, String>()
    sheet.rows.forEach { row ->
        val video = row["Video"]?.trim().orEmpty()
        val raceNumber = row["Race"]?.trim()?.toDoubleOrNull()?.toInt() ?: return@forEach
        val position = row["Position"]?.trim()?.toDoubleOrNull()?.toInt() ?: return@forEach
        val player = row["Player"]?.trim().orEmpty()
        if (player.isEmpty() || raceNumber < 1 || position < 1) return@forEach
        val key = video to raceNumber
        byVideoAndRace.getOrPut(key) { mutableListOf() }.add(Entry(position, player))
        row["Track"]?.trim()?.takeIf { it.isNotEmpty() }?.let { trackOf.putIfAbsent(key, it) }
    }

    val races = linkedMapOf<String, MutableList<AndroidWorkbookRace>>()
    byVideoAndRace.forEach { (key, entries) ->
        val (video, raceNumber) = key
        val ordered = entries.sortedBy { it.position }.map { it.player }.distinct()
        if (ordered.size < 2) return@forEach
        races.getOrPut(video) { mutableListOf() }.add(
            AndroidWorkbookRace(
                video = video,
                raceNumber = raceNumber,
                trackName = trackOf[key].orEmpty(),
                finishOrder = ordered,
            ),
        )
    }
    return races.mapValues { (_, list) -> list.sortedBy { it.raceNumber } }
}

internal sealed interface AndroidRaceResolution {
    data class Resolved(val races: List<AndroidResolvedRace>) : AndroidRaceResolution
    data class Failed(val message: String) : AndroidRaceResolution
}

/**
 * Turns workbook races into canonical ones, using the mapping the operator has
 * already confirmed for this group. Nothing is sent unless every race resolves:
 * a partly imported night would be scored wrong rather than obviously unfinished.
 */
internal fun androidResolveRaces(
    races: List<AndroidWorkbookRace>,
    mappings: List<AndroidScoreMapping>,
    language: AndroidProductLanguage,
): AndroidRaceResolution {
    if (races.isEmpty()) {
        return AndroidRaceResolution.Failed(
            androidText(language, "This recording has no races.", "Deze opname bevat geen races."),
        )
    }
    val playerByName = mappings.mapNotNull { mapping ->
        mapping.playerId?.let { androidScoreNameKey(mapping.workbookName) to it }
    }.toMap()

    val unknownNames = races.flatMap { it.finishOrder }
        .filter { !playerByName.containsKey(androidScoreNameKey(it)) }
        .distinct()
    if (unknownNames.isNotEmpty()) {
        return AndroidRaceResolution.Failed(
            androidText(
                language,
                "These names from the races are not linked yet: ${unknownNames.joinToString(", ")}.",
                "Deze namen uit de races zijn nog niet gekoppeld: ${unknownNames.joinToString(", ")}.",
            ),
        )
    }

    val unknownTracks = races.map { it.trackName }
        .filter { androidResolveTrackId(it) == null }
        .distinct()
    if (unknownTracks.isNotEmpty()) {
        return AndroidRaceResolution.Failed(
            androidText(
                language,
                "These tracks were not recognised: ${unknownTracks.joinToString(", ")}.",
                "Deze banen zijn niet herkend: ${unknownTracks.joinToString(", ")}.",
            ),
        )
    }

    return AndroidRaceResolution.Resolved(
        races.map { race ->
            AndroidResolvedRace(
                raceNumber = race.raceNumber,
                trackId = requireNotNull(androidResolveTrackId(race.trackName)),
                finishOrder = race.finishOrder.map {
                    requireNotNull(playerByName[androidScoreNameKey(it)])
                },
            )
        },
    )
}
