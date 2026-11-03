package nl.mariokart8.mk8dxtimetrials.tournament

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** ADR-0177 decisions 8 to 12 and the source Manager's own file layout. */
class AndroidTournamentRosterCsvTest {
    private val ownerExport = """
        Naam;Status;NS1;NS2
        Anselm;Afwezig;nee;nee
        Ben;Aanwezig;ja;nee
        Damon D;Wachtlijst;nee;ja
    """.trimIndent().replace("\n", "\r\n")

    @Test
    fun `reads the semicolon export the source Manager writes`() {
        val parsed = androidParseRosterCsv(ownerExport)
        assertTrue(parsed is AndroidRosterCsvParse.Parsed)
        val rows = (parsed as AndroidRosterCsvParse.Parsed).rows
        assertEquals(3, rows.size)
        assertEquals(AndroidRosterCsvRow(2, "Anselm", ATTENDANCE_ABSENT, false, false), rows[0])
        assertEquals(AndroidRosterCsvRow(3, "Ben", ATTENDANCE_PRESENT, true, false), rows[1])
        assertEquals(AndroidRosterCsvRow(4, "Damon D", ATTENDANCE_WAITING, false, true), rows[2])
    }

    @Test
    fun `reads a comma export from a comma locale spreadsheet`() {
        val parsed = androidParseRosterCsv("Naam,Status,NS1,NS2\nBen,Aanwezig,ja,nee\n")
        assertEquals(
            listOf(AndroidRosterCsvRow(2, "Ben", ATTENDANCE_PRESENT, true, false)),
            (parsed as AndroidRosterCsvParse.Parsed).rows,
        )
    }

    @Test
    fun `names the row when a status is not recognised`() {
        val parsed = androidParseRosterCsv("Naam;Status;NS1;NS2\nBen;Misschien;ja;nee\n")
        assertTrue((parsed as AndroidRosterCsvParse.Failed).message.contains("Regel 2"))
    }

    @Test
    fun `rejects the file when one name repeats, naming both rows`() {
        val parsed = androidParseRosterCsv(
            "Naam;Status;NS1;NS2\nBen;Afwezig;nee;nee\nben;Aanwezig;ja;nee\n",
        )
        val message = (parsed as AndroidRosterCsvParse.Failed).message
        assertTrue(message.contains("Regel 3, kolom Naam"))
        assertTrue(message.contains("staat al op regel 2"))
    }

    @Test
    fun `rejects a file without the expected columns`() {
        val parsed = androidParseRosterCsv("Speler;Status\nBen;Aanwezig\n")
        val message = (parsed as AndroidRosterCsvParse.Failed).message
        assertTrue(message.contains("Regel 1"))
        assertTrue(message.contains("NS1"))
    }

    @Test
    fun `writes the source file layout back`() {
        val participants = listOf(
            participant("Damon D", ATTENDANCE_WAITING, hasSwitch2 = true),
            participant("Anselm", ATTENDANCE_ABSENT),
            participant("Ben", ATTENDANCE_PRESENT, hasSwitch1 = true),
        )
        // The byte-order mark keeps Excel from mangling an accent.
        assertEquals("\uFEFF" + ownerExport + "\r\n", androidRosterCsv(participants))
    }

    @Test
    fun `round trips its own export`() {
        val participants = listOf(participant("Moss HM", ATTENDANCE_PRESENT, hasSwitch1 = true))
        val parsed = androidParseRosterCsv(androidRosterCsv(participants))
        assertEquals(
            listOf(AndroidRosterCsvRow(2, "Moss HM", ATTENDANCE_PRESENT, true, false)),
            (parsed as AndroidRosterCsvParse.Parsed).rows,
        )
    }

    private fun participant(
        displayName: String,
        attendance: String,
        hasSwitch1: Boolean = false,
        hasSwitch2: Boolean = false,
    ) = AndroidTournamentParticipant(
        playerId = "player.${displayName.lowercase().replace(" ", "_")}",
        username = displayName.lowercase().replace(" ", "_"),
        displayName = displayName,
        attendance = attendance,
        hasSwitch1 = hasSwitch1,
        hasSwitch2 = hasSwitch2,
    )
}

/**
 * ADR-0177 decision 11. These are the same cases the API pins in
 * backend/api/test/roster-player-creation.test.ts, so the phone's preview
 * cannot drift away from the username the server actually allocates.
 */
class AndroidRosterUsernamePreviewTest {
    @Test
    fun `derives the same ADR-0151 usernames the API derives`() {
        assertEquals("moss_hm", androidRosterUsernameFor("Moss HM"))
        assertEquals("damon_d", androidRosterUsernameFor("Damon D"))
        assertEquals("bertvandegoei", androidRosterUsernameFor("BertvandeGoei"))
        assertEquals("jose", androidRosterUsernameFor("José"))
        assertNull(androidRosterUsernameFor("!!"))
    }

    @Test
    fun `truncates to sixteen characters and trims separators`() {
        assertEquals("nieuwespelereene", androidRosterUsernameFor("NieuweSpelerEenExtra"))
        assertEquals("jan_piet", androidRosterUsernameFor("  Jan-Piet  "))
        assertEquals("jan_piet", androidRosterUsernameFor("Jan Piet"))
    }

    @Test
    fun `refuses a name too short to be a username`() {
        assertNull(androidRosterUsernameFor("Jo"))
        assertNull(androidRosterUsernameFor(""))
    }

    @Test
    fun `reads an English header and a tab-separated paste`() {
        val english = androidParseRosterCsv("Name,Status,NS1,NS2\nBen,Present,yes,no\nNova,Waiting,no,no\n")
        assertEquals(
            listOf(
                AndroidRosterCsvRow(2, "Ben", ATTENDANCE_PRESENT, true, false),
                AndroidRosterCsvRow(3, "Nova", ATTENDANCE_WAITING, false, false),
            ),
            (english as AndroidRosterCsvParse.Parsed).rows,
        )
        val tabs = androidParseRosterCsv("Speler\tAanwezigheid\tSwitch 1\tSwitch 2\nBen\tAanwezig\tja\tnee\n")
        assertEquals(
            listOf(AndroidRosterCsvRow(2, "Ben", ATTENDANCE_PRESENT, true, false)),
            (tabs as AndroidRosterCsvParse.Parsed).rows,
        )
    }

    @Test
    fun `names the row, the column and what that column takes`() {
        val status = androidParseRosterCsv("Naam;Status;NS1;NS2\nBen;Misschien;ja;nee\n")
        val statusMessage = (status as AndroidRosterCsvParse.Failed).message
        assertTrue(statusMessage.contains("Regel 2, kolom Status"))
        assertTrue(statusMessage.contains("\"Misschien\""))
        assertTrue(statusMessage.contains("Toegestaan: Aanwezig"))

        val switch = androidParseRosterCsv("Naam;Status;NS1;NS2\nBen;Aanwezig;misschien;nee\n")
        val switchMessage = (switch as AndroidRosterCsvParse.Failed).message
        assertTrue(switchMessage.contains("Regel 2, kolom NS1"))
        assertTrue(switchMessage.contains("dit is geen ja of nee"))

        val missing = androidParseRosterCsv("Naam;NS1;NS2\nBen;ja;nee\n")
        val missingMessage = (missing as AndroidRosterCsvParse.Failed).message
        assertTrue(missingMessage.contains("Regel 1"))
        assertTrue(missingMessage.contains("Status"))

        val twice = androidParseRosterCsv("Naam;Status;NS1;NS2\nBen;Aanwezig;ja;nee\nben;Afwezig;nee;nee\n")
        val twiceMessage = (twice as AndroidRosterCsvParse.Failed).message
        assertTrue(twiceMessage.contains("Regel 3, kolom Naam"))
        assertTrue(twiceMessage.contains("regel 2"))
    }

    @Test
    fun `writes a file Excel opens with its accents intact`() {
        val text = androidRosterCsv(
            listOf(
                AndroidTournamentParticipant(
                    playerId = "player.a", username = "renee", displayName = "Renée",
                    attendance = ATTENDANCE_PRESENT, hasSwitch1 = true, hasSwitch2 = false,
                ),
            ),
        )
        assertTrue(text.startsWith("﻿Naam;Status;NS1;NS2\r\n"))
        assertTrue(text.contains("Renée;Aanwezig;ja;nee"))
        val parsed = androidParseRosterCsv(text)
        assertEquals(1, (parsed as AndroidRosterCsvParse.Parsed).rows.size)
    }
}
