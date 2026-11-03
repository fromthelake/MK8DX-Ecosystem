package nl.mariokart8.mk8dxtimetrials.tournament

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream

/**
 * The workbook handed back at Step 6 and Step 10. It is generated from the
 * races the platform holds rather than from a stored copy of whatever file came
 * in, so a night entered by hand exports exactly like an imported one.
 */
class AndroidTournamentWorkbookWriterTest {

    private fun placement(position: Int, playerId: String, name: String, points: Int) =
        AndroidTournamentPlacement(position, playerId, name, points)

    private val document = androidTournamentParticipantsPreviewDocument().let { base ->
        base.copy(
            groups = listOf(
                AndroidTournamentGroup(
                    groupId = "tournament_group.one",
                    stage = "qualifier",
                    sequence = 1,
                    name = "Groep 1",
                    locked = true,
                    members = emptyList(),
                    manualScoreSegments = 1,
                    manualScores = emptyList(),
                    races = listOf(
                        AndroidTournamentRace(
                            raceNumber = 1,
                            raceResultId = "tournament_race_result.one",
                            revision = 1,
                            trackId = "track.toad_harbour",
                            countsTowardStandings = true,
                            placements = listOf(
                                placement(1, "player.evan", "Evan", 15),
                                placement(2, "player.merle", "Merle", 12),
                            ),
                        ),
                        AndroidTournamentRace(
                            raceNumber = 2,
                            raceResultId = "tournament_race_result.two",
                            revision = 1,
                            trackId = "track.water_park",
                            countsTowardStandings = true,
                            placements = listOf(
                                placement(1, "player.merle", "Merle", 15),
                                placement(2, "player.evan", "Evan", 12),
                            ),
                        ),
                    ),
                    standings = AndroidTournamentStandings(
                        source = "races",
                        rows = listOf(
                            AndroidTournamentStanding(
                                rank = 1, playerId = "player.evan", displayName = "Evan",
                                points = 27, races = 2, wins = 1, bestRace = 1, complete = true,
                            ),
                            AndroidTournamentStanding(
                                rank = 2, playerId = "player.merle", displayName = "Merle",
                                points = 27, races = 2, wins = 1, bestRace = 1, complete = true,
                            ),
                        ),
                    ),
                ),
            ),
        )
    }

    @Test
    fun `the results sheet carries every placement with a running total`() {
        val rows = androidWorkbookResultRows(document, "qualifier")
        assertEquals(WORKBOOK_RESULTS_HEADERS, rows.first())
        assertEquals(5, rows.size)
        val evanSecondRace = rows.first { it[1] == "2" && it[5] == "Evan" }
        // 15 in race one, 12 in race two: the workbook records both sides of it.
        assertEquals("12", evanSecondRace[7])
        assertEquals("15", evanSecondRace[8])
        assertEquals("27", evanSecondRace[9])
    }

    @Test
    fun `manual connection segments are exported as re-importable race rows`() {
        val manual = document.copy(
            groups = listOf(
                document.groups.single().copy(
                    members = listOf(
                        AndroidTournamentMember("player.evan", "Evan", 1),
                        AndroidTournamentMember("player.merle", "Merle", 2),
                    ),
                    races = emptyList(),
                    manualScoreSegments = 2,
                    manualScores = listOf(
                        AndroidTournamentManualScore("player.evan", listOf(48, 52)),
                        AndroidTournamentManualScore("player.merle", listOf(44, 45)),
                    ),
                    standings = AndroidTournamentStandings(
                        "manual",
                        listOf(
                            AndroidTournamentStanding(1, "player.evan", "Evan", 100, 2, 0, 0, true),
                            AndroidTournamentStanding(2, "player.merle", "Merle", 89, 2, 0, 0, true),
                        ),
                    ),
                ),
            ),
        )

        val rows = androidWorkbookResultRows(manual, "qualifier")

        assertEquals(5, rows.size)
        assertEquals(listOf("48", "52"), rows.filter { it[5] == "Evan" }.map { it[7] })
        assertEquals("100", rows.first { it[5] == "Evan" && it[1] == "2" }[9])
    }

    @Test
    fun `the track is written under its catalogue name, not its id`() {
        val rows = androidWorkbookResultRows(document, "qualifier")
        assertTrue(rows.any { it.getOrNull(2) == "Toad Harbor" })
        assertTrue(rows.none { it.getOrNull(2)?.startsWith("track.") == true })
    }

    @Test
    fun `the standings sheet mirrors the source's columns`() {
        val rows = androidWorkbookStandingRows(document, "qualifier")
        assertEquals(WORKBOOK_FINAL_STANDINGS_HEADERS, rows.first())
        assertEquals(3, rows.size)
        assertEquals("2", rows[1][1])
        assertEquals("Evan", rows[1][3])
        assertEquals("27", rows[1][4])
    }

    @Test
    fun `the recording name pairs the date with the group`() {
        assertEquals("20250103_Groep1", androidWorkbookVideoName("2025-01-03", "Groep 1"))
        assertEquals("00000000_Groep1", androidWorkbookVideoName(null, "Groep 1"))
    }

    @Test
    fun `the workbook is a zip an office suite can open`() {
        val bytes = androidWriteWorkbook(document, "qualifier")
        assertTrue(androidLooksLikeWorkbook(bytes))
        val entries = mutableListOf<String>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                entries.add(entry.name)
                zip.closeEntry()
            }
        }
        assertTrue(entries.contains("[Content_Types].xml"))
        assertTrue(entries.contains("xl/workbook.xml"))
        assertTrue(entries.contains("xl/worksheets/sheet1.xml"))
        assertTrue(entries.contains("xl/worksheets/sheet2.xml"))
    }

    @Test
    fun `a name with an ampersand does not break the sheet`() {
        val awkward = document.copy(
            groups = document.groups.map { group ->
                group.copy(
                    races = group.races.map { race ->
                        race.copy(
                            placements = race.placements.map {
                                it.copy(displayName = "Evan & <Merle>")
                            },
                        )
                    },
                )
            },
        )
        val bytes = androidWriteWorkbook(awkward, "qualifier")
        val xml = String(bytes)
        // The raw characters must never reach the XML.
        assertTrue(androidLooksLikeWorkbook(bytes))
        assertTrue(xml.isNotEmpty())
    }

    @Test
    fun `the file is named after the Tournament and the stage`() {
        val name = androidWorkbookFileName(document, "final")
        assertTrue(name.endsWith("_eindgroepen_scores.xlsx"))
        assertTrue(androidWorkbookFileName(document, "qualifier").contains("kwalificatie"))
    }
}
