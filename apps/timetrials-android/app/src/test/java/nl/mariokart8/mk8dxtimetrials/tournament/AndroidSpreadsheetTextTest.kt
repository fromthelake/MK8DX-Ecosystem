package nl.mariokart8.mk8dxtimetrials.tournament

import java.io.ByteArrayInputStream
import java.io.File
import java.util.zip.ZipInputStream
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Names that reach a CSV or XLSX export stay text in a spreadsheet, and the
 * phone's own imports read the real names back. The vectors are the file the
 * Web and Python test against too.
 */
class AndroidSpreadsheetTextTest {
    private val vectors: JsonObject = generateSequence(File(System.getProperty("user.dir")!!).absoluteFile) { it.parentFile }
        .map { File(it, "packages/domain/policies/spreadsheet-text-v1.json") }
        .firstOrNull { it.isFile }
        ?.let { Json.parseToJsonElement(it.readText()).jsonObject }
        ?: error("packages/domain/policies/spreadsheet-text-v1.json not found above ${System.getProperty("user.dir")}")

    private fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content

    // Trimmed and distinct, the way a roster keeps them.
    private val names = listOf("=1+1", "@Sander", "-Zoë", "+Сергей", "'=マリオ", "\uFF1D김민준", "'t Hoofd", "李雷", "-5", "مريم", "🍄Toad")
    private val formulaStart = Regex("^[ \u00A0\u3000]*[=+\\-@\uFF1D\uFF0B\uFF0D\uFF20\t\r\n]")

    @Test
    fun `follows every shared vector both ways`() {
        vectors.getValue("cases").jsonArray.map { it.jsonObject }.forEach { case ->
            val value = case.string("value")
            val csv = case.string("csv")
            assertEquals(value, csv, androidCsvLiteralText(value))
            assertEquals(csv, value, androidCsvImportedText(csv))
        }
        vectors.getValue("importOnlyCases").jsonArray.map { it.jsonObject }.forEach { case ->
            assertEquals(case.string("value"), androidCsvImportedText(case.string("csv")))
        }
    }

    @Test
    fun `writes the shared semicolon document lines byte for byte`() {
        vectors.getValue("documentCases").jsonArray.map { it.jsonObject }
            .filter { it.string("delimiter") == ";" }
            .forEach { case ->
                val cells = case.getValue("cells").jsonArray.map { it.jsonPrimitive.content }
                assertEquals(case.string("line"), cells.joinToString(";") { androidCsvCell(it) })
            }
    }

    @Test
    fun `the roster export protects formula-like names and the roster import reads them back`() {
        val participants = names.mapIndexed { index, name ->
            AndroidTournamentParticipant("player.p$index", "p$index", name, ATTENDANCE_PRESENT, index % 2 == 0, false)
        }
        val csv = androidRosterCsv(participants)
        val lines = csv.removePrefix("﻿").split("\r\n").drop(1).filter { it.isNotEmpty() }
        assertEquals(names.size, lines.size)
        lines.filterNot { it.startsWith("-5;") }.forEach { line ->
            assertFalse(line, formulaStart.containsMatchIn(line.removePrefix("\"")))
        }
        assertTrue(csv.contains("\r\n'=1+1;Aanwezig;ja;nee\r\n"))
        assertTrue(csv.contains("\r\n-5;Aanwezig;"))
        val parsed = androidParseRosterCsv(csv) as AndroidRosterCsvParse.Parsed
        assertEquals(names.sorted(), parsed.rows.map { it.displayName }.sorted())
    }

    @Test
    fun `the layout export protects names and the layout import reads them back`() {
        val station = { seat: Int -> AndroidTournamentMemberStation("player.p0", "=1+1", "ns1", seat) }
        val group = AndroidTournamentGroup(
            groupId = "tournament_group.one", stage = "qualifier", sequence = 1, name = "@Groep 1",
            locked = false, manualScoreSegments = 1,
            members = listOf(
                AndroidTournamentMember("player.p0", "=1+1", 1, station(1)),
                AndroidTournamentMember("player.p1", "+Сергей", 2, station(2)),
                AndroidTournamentMember("player.p2", "-Zoë", 3),
            ),
            races = emptyList(), manualScores = emptyList(),
            standings = AndroidTournamentStandings("none", emptyList()),
        )
        val csv = androidGroupBoardCsv(listOf(group))
        assertTrue(csv, csv.contains("\r\n'=1+1;NS1;'=1+1;'+Сергей;'@Groep 1\r\n"))
        assertTrue(csv, csv.contains("\r\n;;'-Zoë;;'@Groep 1\r\n"))
        val seats = (androidParseLayoutCsv(csv) as AndroidLayoutCsvParse.Parsed).seats
        assertEquals(listOf("=1+1", "+Сергей", "-Zoë"), seats.map { it.playerName })
        assertEquals(setOf("@Groep 1"), seats.map { it.groupName }.toSet())
        assertEquals("=1+1", seats.first().stationOwnerName)
    }

    @Test
    fun `the workbook writes names as inline strings and points as numbers`() {
        val awkward = listOf("=1+1", "@SUM(A1:A2)", "Infinity", "007", "NaN", "1e5")
        val placements = awkward.mapIndexed { index, name -> AndroidTournamentPlacement(index + 1, "player.p$index", name, 15 - index) }
        val document = androidTournamentParticipantsPreviewDocument().copy(
            groups = listOf(
                AndroidTournamentGroup(
                    groupId = "tournament_group.one", stage = "qualifier", sequence = 1, name = "=Groep",
                    locked = true, members = emptyList(), manualScoreSegments = 1, manualScores = emptyList(),
                    races = listOf(
                        AndroidTournamentRace(
                            raceNumber = 1, raceResultId = "tournament_race_result.one", revision = 1,
                            trackId = "track.toad_harbour", countsTowardStandings = true, placements = placements,
                        ),
                    ),
                    standings = AndroidTournamentStandings("races", emptyList()),
                ),
            ),
        )
        val sheet = sheetXml(androidWriteWorkbook(document, "qualifier"), "xl/worksheets/sheet1.xml")
        assertFalse(sheet.contains("<f>") || sheet.contains("<f "))
        awkward.forEach { name ->
            val escaped = name.replace("&", "&amp;").replace("<", "&lt;")
            assertTrue(name, sheet.contains("""t="inlineStr"><is><t xml:space="preserve">$escaped</t>"""))
            assertFalse(name, sheet.contains("<v>$escaped</v>"))
        }
        // The points of the first placement are a number cell.
        assertTrue(sheet.contains(Regex("""<c r="H2"><v>15</v></c>""")))
    }

    private fun sheetXml(bytes: ByteArray, entryName: String): String {
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (entry.name == entryName) return zip.readBytes().toString(Charsets.UTF_8)
                zip.closeEntry()
            }
        }
        error("$entryName missing")
    }
}
