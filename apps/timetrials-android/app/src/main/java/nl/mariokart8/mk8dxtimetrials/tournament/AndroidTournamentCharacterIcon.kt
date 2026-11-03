package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.builds.AndroidBuildPartCategory
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutVariants
import java.text.Normalizer
import java.util.Locale

/**
 * The picture of the character a Player drove.
 *
 * The site resolves this in `tournament-character.ts`: a recorded label - which
 * comes from a score workbook and is written by hand - is folded to letters and
 * digits, looked up by name, and failing that split into a colour and a base
 * character so that "Pink Yoshi" finds the pink variant of Yoshi. This is the
 * same resolution against the phone's own catalog, so the two clients put the
 * same face beside the same name.
 *
 * The artwork is already in the APK; only the resolver was missing, which is
 * why the phone printed the label as text where the site drew the character.
 */

private fun fold(value: String): String = Normalizer
    .normalize(value, Normalizer.Form.NFKD)
    .replace(Regex("\\p{Mn}+"), "")
    .lowercase(Locale.ROOT)
    .replace(Regex("[^a-z0-9]"), "")

private val characterParts by lazy {
    AndroidLoadoutCatalog.parts.filter { it.category == AndroidBuildPartCategory.CHARACTER }
}

private val byName by lazy { characterParts.associateBy { fold(it.name) } }

private val byId by lazy { characterParts.associateBy { it.id } }

/**
 * The recording cannot tell a Mii's weight class, so a bare "Mii" is the medium
 * one (the owner's decision of 2026-09-08); the label stays "Mii". The
 * Processor also names the two Villagers differently from the catalog.
 */
private val nameAliases = mapOf(
    "mii" to fold("Mii (Medium)"),
    "villagermale" to fold("Villager (Boy)"),
    "villagerfemale" to fold("Villager (Girl)"),
)

private val variantsById by lazy { AndroidLoadoutVariants.characters.associateBy { it.id } }

private val variantColours by lazy {
    AndroidLoadoutVariants.characters
        .flatMap { listOf(fold(it.colorFamily), fold(it.name)) }
        .toSet()
        .filter { it.length > 2 }
        .sortedByDescending { it.length }
}

/**
 * The catalog identifier for a recorded character, or null when nothing in the
 * catalog answers to that name.
 */
internal fun androidTournamentCharacterKey(label: String, roster: String? = null): String? {
    val wanted = fold(label)
    if (wanted.isEmpty()) return null
    val aliased = nameAliases[wanted] ?: wanted
    byName[aliased]?.let { return it.id }

    // "Pink Yoshi" with roster "Yoshi" is the pink variant of Yoshi. The colour
    // is taken off the front or the back and the remainder looked up again.
    for (colour in variantColours) {
        if (!wanted.contains(colour)) continue
        val base = wanted.replace(colour, "")
        val baseId = byName[base]?.id ?: roster?.let { byName[fold(it)]?.id }
        if (baseId != null) {
            val variant = AndroidLoadoutVariants.characters.firstOrNull { candidate ->
                candidate.baseId == baseId &&
                    (fold(candidate.colorFamily) == colour || fold(candidate.name) == colour)
            }
            if (variant != null) return variant.id
        }
    }
    // A roster column alone still identifies the base character.
    return roster?.let { byName[fold(it)]?.id }
}

/**
 * The asset path for a recorded character, in the phone's own private product
 * assets, or null when the catalog does not know that name.
 */
internal fun androidTournamentCharacterAsset(
    character: AndroidPublicCharacter?,
): String? {
    if (character == null) return null
    val key = character.key ?: androidTournamentCharacterKey(character.label, character.roster)
        ?: return null
    variantsById[key]?.let { return it.assetPath }
    // The part knows its own asset path, override included.
    return byId[key]?.assetPath
}

/**
 * The picture beside a name in a report: the character the night recorded. (A maintainer's own installation may
 * carry a one-off exception for one historical night; the public tree has none.)
 */
@Suppress("UNUSED_PARAMETER")
internal fun androidReportCharacterAsset(
    editionNumber: Int?,
    displayName: String,
    character: AndroidPublicCharacter?,
): String? = androidTournamentCharacterAsset(character)
