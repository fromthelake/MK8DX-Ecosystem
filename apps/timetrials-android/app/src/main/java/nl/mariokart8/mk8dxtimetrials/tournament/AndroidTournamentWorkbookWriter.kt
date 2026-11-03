package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Writing the score workbook back out, the counterpart to
 * `AndroidTournamentWorkbookReader`.
 *
 * The source Manager keeps the imported sheets on the Tournament state and
 * rebuilds an `.xlsx` from them at Step 6 and Step 10
 * (`ScoreImportWorkbookExporter`). The canonical product does not need that
 * detour: the races it imported are stored as canonical race results, so the
 * workbook is generated from what the platform actually holds. That also means
 * a night entered by hand exports just as well as one that arrived as a file.
 *
 * An `.xlsx` is a ZIP of XML. This writes the smallest workbook Excel will open
 * - two sheets with inline strings, no shared string table and no styles - with
 * the source's own sheet names and column headers, so a file that goes out can
 * come back in.
 */

private fun xmlEscape(value: String): String = buildString(value.length) {
    value.forEach { character ->
        when (character) {
            '&' -> append("&amp;")
            '<' -> append("&lt;")
            '>' -> append("&gt;")
            '"' -> append("&quot;")
            '\'' -> append("&apos;")
            // Excel rejects most control characters outright.
            else -> if (character.code >= 0x20 || character == '\t') append(character)
        }
    }
}

private fun columnName(index: Int): String {
    var remaining = index
    val name = StringBuilder()
    while (true) {
        name.insert(0, ('A' + remaining % 26))
        remaining = remaining / 26 - 1
        if (remaining < 0) break
    }
    return name.toString()
}

private fun sheetXml(rows: List<List<String>>): String = buildString {
    append("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>""")
    append("""<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>""")
    rows.forEachIndexed { rowIndex, cells ->
        append("""<row r="${rowIndex + 1}">""")
        cells.forEachIndexed { cellIndex, value ->
            val reference = "${columnName(cellIndex)}${rowIndex + 1}"
            val numeric = value.toDoubleOrNull()
            if (numeric != null && value.isNotBlank()) {
                append("""<c r="$reference"><v>${xmlEscape(value)}</v></c>""")
            } else {
                append("""<c r="$reference" t="inlineStr"><is><t xml:space="preserve">""")
                append(xmlEscape(value))
                append("""</t></is></c>""")
            }
        }
        append("</row>")
    }
    append("</sheetData></worksheet>")
}

private const val CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"""

private const val ROOT_RELATIONSHIPS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""

private val WORKBOOK_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="$WORKBOOK_RESULTS_SHEET" sheetId="1" r:id="rId1"/>
<sheet name="$WORKBOOK_FINAL_STANDINGS_SHEET" sheetId="2" r:id="rId2"/>
</sheets>
</workbook>"""

private const val WORKBOOK_RELATIONSHIPS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"""

/** The recording name the source uses for a group: `<date>_<group>`. */
internal fun androidWorkbookVideoName(eventDate: String?, groupName: String): String {
    val date = eventDate?.filter(Char::isDigit)?.takeIf { it.length == 8 } ?: "00000000"
    return "${date}_${groupName.replace(" ", "")}"
}

/** The `Results` rows for one stage, in the source's column order. */
internal fun androidWorkbookResultRows(
    document: AndroidTournamentDocument,
    stage: String,
): List<List<String>> {
    val rows = mutableListOf<List<String>>(WORKBOOK_RESULTS_HEADERS)
    document.groups.filter { it.stage == stage }.sortedBy { it.sequence }.forEach { group ->
        val video = androidWorkbookVideoName(document.summary.eventDate, group.name)
        val running = mutableMapOf<String, Int>()
        val races = group.races.sortedBy { it.raceNumber }
        races.forEach { race ->
            val track = Schema9AndroidTrackCatalog.find(race.trackId)
            race.placements.sortedBy { it.finishPosition }.forEach { placement ->
                val before = running[placement.playerId] ?: 0
                val after = before + placement.racePoints
                running[placement.playerId] = after
                rows.add(
                    listOf(
                        video,
                        race.raceNumber.toString(),
                        track?.displayName ?: race.trackId,
                        "",
                        placement.finishPosition.toString(),
                        placement.displayName,
                        "",
                        placement.racePoints.toString(),
                        before.toString(),
                        after.toString(),
                        "",
                        if (race.countsTowardStandings) "" else "TRUE",
                        if (race.countsTowardStandings) "" else "Race telt niet mee",
                    ),
                )
            }
        }
        // The source also exports a re-importable workbook when totals were
        // entered by hand. In that path every connection segment becomes one
        // synthetic race row; the final standing remains authoritative.
        if (races.isEmpty() && group.manualScores.isNotEmpty()) {
            val standingByPlayer = group.standings.rows.associateBy { it.playerId }
            group.manualScores.forEach { score ->
                val standing = standingByPlayer[score.playerId]
                val name = standing?.displayName
                    ?: group.members.firstOrNull { it.playerId == score.playerId }?.displayName
                    ?: score.playerId
                val populated = score.segmentPoints.filterNotNull()
                val segments = if (group.manualScoreSegments <= 1) {
                    listOf(populated.sum())
                } else {
                    score.segmentPoints.map { it ?: 0 }
                }
                var before = 0
                segments.forEachIndexed { index, points ->
                    val after = before + points
                    rows.add(
                        listOf(
                            video,
                            (index + 1).toString(),
                            "",
                            "",
                            (standing?.rank ?: 0).toString(),
                            name,
                            "",
                            points.toString(),
                            before.toString(),
                            after.toString(),
                            "",
                            "",
                            "",
                        ),
                    )
                    before = after
                }
            }
        }
    }
    return rows
}

/** The `Final Standings` rows for one stage, in the source's column order. */
internal fun androidWorkbookStandingRows(
    document: AndroidTournamentDocument,
    stage: String,
): List<List<String>> {
    val rows = mutableListOf<List<String>>(WORKBOOK_FINAL_STANDINGS_HEADERS)
    document.groups.filter { it.stage == stage }.sortedBy { it.sequence }.forEach { group ->
        val video = androidWorkbookVideoName(document.summary.eventDate, group.name)
        val raceCount = group.races.count { it.countsTowardStandings }
        group.standings.rows.sortedBy { it.rank }.forEach { row ->
            rows.add(
                listOf(
                    video,
                    raceCount.toString(),
                    row.rank.toString(),
                    row.displayName,
                    row.points.toString(),
                    "",
                ),
            )
        }
    }
    return rows
}

/** The workbook for one stage, ready to be shared or saved. */
internal fun androidWriteWorkbook(
    document: AndroidTournamentDocument,
    stage: String,
): ByteArray {
    val output = ByteArrayOutputStream()
    ZipOutputStream(output).use { zip ->
        fun part(name: String, body: String) {
            zip.putNextEntry(ZipEntry(name))
            zip.write(body.toByteArray(Charsets.UTF_8))
            zip.closeEntry()
        }
        part("[Content_Types].xml", CONTENT_TYPES)
        part("_rels/.rels", ROOT_RELATIONSHIPS)
        part("xl/workbook.xml", WORKBOOK_XML)
        part("xl/_rels/workbook.xml.rels", WORKBOOK_RELATIONSHIPS)
        part("xl/worksheets/sheet1.xml", sheetXml(androidWorkbookResultRows(document, stage)))
        part("xl/worksheets/sheet2.xml", sheetXml(androidWorkbookStandingRows(document, stage)))
    }
    return output.toByteArray()
}

/** The name the source gives the file it hands back. */
internal fun androidWorkbookFileName(
    document: AndroidTournamentDocument,
    stage: String,
): String {
    val safeName = document.summary.name.replace(Regex("[^A-Za-z0-9_-]+"), "_").trim('_')
    val stageLabel = if (stage == "final") "eindgroepen" else "kwalificatie"
    return "${safeName.ifEmpty { "toernooi" }}_${stageLabel}_scores.xlsx"
}
