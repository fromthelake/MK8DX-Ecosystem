package nl.mariokart8.mk8dxtimetrials.tournament

import java.util.Locale

/**
 * The WhatsApp export the Manager has always produced.
 *
 * This is a faithful port of `RulesEngine::exportWhatsApp` from the original
 * project (`MK8DX Seating & Standings Manager`): the group title, the em-dash
 * seat lines with their `[NS1]`/`[NS2]` marker and "Nintendo Switch van
 * <owner>", the blank line before "Uitslag:", the `#n Name (score pt)` rows and
 * the Dutch empty-state sentences.
 *
 * The text is pasted into a group chat where people already read this shape by
 * heart, so it is not ours to restyle. The UTP cable numbers the APK used to
 * put on these lines are operational wiring information; they stay on the
 * cable plan, which is where whoever wires up actually looks.
 */
internal enum class AndroidWhatsAppExportMode { LAYOUT, RESULTS, AUTO }

/** The original writes the score without trailing zeros: 42, 38.5, 7.25. */
internal fun androidWhatsAppScoreText(points: Double?): String {
    if (points == null) return "-"
    return String.format(Locale.ROOT, "%.2f", points).trimEnd('0').trimEnd('.')
}

/** "Nintendo Switch van Bas", never doubling a prefix the name already has. */
internal fun androidWhatsAppStationLabel(ownerDisplayName: String): String {
    val owner = ownerDisplayName
        .replace(Regex("^(Nintendo Switch van|Switch van|Console)\\s+", RegexOption.IGNORE_CASE), "")
        .trim()
    return if (owner.isEmpty()) "Nintendo Switch" else "Nintendo Switch van $owner"
}

private fun groupTitle(name: String, stage: String): String {
    val index = name.replace(Regex("\\D+"), "")
    val prefix = if (stage == "final") "Eindgroep " else "Kwalificatiegroep "
    return prefix + index.ifEmpty { name }
}

internal fun androidTournamentWhatsAppText(
    document: AndroidTournamentDocument,
    stage: String?,
    mode: AndroidWhatsAppExportMode,
): String {
    val includeSeating = mode == AndroidWhatsAppExportMode.LAYOUT || mode == AndroidWhatsAppExportMode.AUTO
    val includeResults = mode == AndroidWhatsAppExportMode.RESULTS || mode == AndroidWhatsAppExportMode.AUTO
    val groups = document.groups
        .filter { stage == null || it.stage == stage }
        .sortedBy { it.sequence }
    val chunks = mutableListOf<String>()
    for (group in groups) {
        val lines = mutableListOf(groupTitle(group.name, group.stage))
        var hasSeatingLines = false
        if (includeSeating) {
            val stations = group.members.mapNotNull { it.station }
                .map { it.ownerPlayerId to it.switchType }
                .distinct()
            for ((ownerId, switchType) in stations) {
                val seats = group.members
                    .filter { it.station?.ownerPlayerId == ownerId && it.station?.switchType == switchType }
                    .sortedBy { it.station?.seatNumber ?: 0 }
                if (seats.isEmpty()) continue
                val owner = seats.firstOrNull()?.station?.ownerDisplayName ?: ownerId
                val marker = if (switchType.lowercase(Locale.ROOT) == "ns2") "[NS2]" else "[NS1]"
                val entries = seats.map { member ->
                    "#${member.station?.seatNumber ?: 1} ${member.displayName}"
                }
                lines += "— $marker ${androidWhatsAppStationLabel(owner)}: ${entries.joinToString(" & ")}"
                hasSeatingLines = true
            }
            if (!hasSeatingLines && mode == AndroidWhatsAppExportMode.LAYOUT) {
                lines += "— Nog geen plaatsing"
            }
        }
        if (includeResults) {
            val rows = group.standings.rows.sortedBy { it.rank }
            if (rows.isNotEmpty()) {
                if (hasSeatingLines && includeSeating) lines += ""
                lines += "Uitslag:"
                rows.forEachIndexed { index, row ->
                    lines += "#${index + 1} ${row.displayName} (${androidWhatsAppScoreText(row.points.toDouble())} pt)"
                }
            } else if (mode == AndroidWhatsAppExportMode.RESULTS) {
                lines += "Uitslag: nog niet beschikbaar"
            }
        }
        chunks += lines.joinToString("\n")
    }
    if (chunks.isEmpty()) {
        val isFinal = stage == "final"
        val isQualifier = stage == "qualifier"
        return when (mode) {
            AndroidWhatsAppExportMode.LAYOUT -> when {
                isFinal -> "Geen eindgroep-indeling gevonden."
                isQualifier -> "Geen kwalificatie-indeling gevonden."
                else -> "Geen indelingen gevonden."
            }
            AndroidWhatsAppExportMode.RESULTS -> when {
                isFinal -> "Geen eindgroep-uitslagen gevonden."
                isQualifier -> "Geen kwalificatie-uitslagen gevonden."
                else -> "Geen uitslagen gevonden."
            }
            AndroidWhatsAppExportMode.AUTO -> when {
                isFinal -> "Geen eindgroepen gevonden."
                isQualifier -> "Geen kwalificatiegroepen gevonden."
                else -> "Geen groepen gevonden."
            }
        }
    }
    return chunks.joinToString("\n\n")
}
