package nl.mariokart8.mk8dxtimetrials.tournament

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shareable picture's content, per step. The drawing itself needs a device,
 * but what goes into each of the four images does not - and the owner asked for
 * each step to be judged on its own, so each has its own columns and its own
 * expectations here.
 */
class AndroidTournamentExportImageTest {

    private fun member(playerId: String, name: String, owner: String, seat: Int, cable: Int?) =
        AndroidTournamentMember(
            playerId = playerId,
            displayName = name,
            seatOrder = seat,
            station = AndroidTournamentMemberStation(
                ownerPlayerId = owner,
                ownerDisplayName = if (owner == playerId) name else "Evan",
                switchType = "ns1",
                seatNumber = seat,
                utpCableNumber = cable,
            ),
        )

    private val document = androidTournamentParticipantsPreviewDocument().let { base ->
        val qualifier = AndroidTournamentGroup(
            groupId = "tournament_group.one",
            stage = "qualifier",
            sequence = 1,
            name = "Groep 1",
            locked = true,
            members = listOf(
                member("player.evan", "Evan", "player.evan", 1, 7),
                member("player.merle", "Merle", "player.evan", 2, 7),
            ),
            manualScoreSegments = 1,
            manualScores = emptyList(),
            races = emptyList(),
            standings = AndroidTournamentStandings(
                source = "manual",
                rows = listOf(
                    AndroidTournamentStanding(
                        rank = 1, playerId = "player.evan", displayName = "Evan",
                        points = 146, races = 12, wins = 4, bestRace = 1, complete = true,
                    ),
                    AndroidTournamentStanding(
                        rank = 2, playerId = "player.merle", displayName = "Merle",
                        points = 120, races = 12, wins = 2, bestRace = 1, complete = true,
                    ),
                ),
            ),
        )
        base.copy(
            summary = base.summary.copy(name = "PORTREF Stepport", eventDate = "2026-03-27"),
            groups = listOf(
                qualifier,
                qualifier.copy(
                    groupId = "tournament_group.final.one",
                    stage = "final",
                    name = "Kampioen",
                    tierKey = "champion",
                ),
            ),
        )
    }

    // Steps 4 and 8: the seating. The cable belongs here because this is the
    // sheet whoever is wiring reads.
    @Test
    fun `the layout image names the console, the cable and both seats`() {
        val model = androidLayoutImageModel(document, "qualifier", "Kwalificatie-indeling")
        assertEquals(
            listOf("Nintendo Switch", "UTP", "SP Rank", "Deelnemer 1", "SP Rank", "Deelnemer 2"),
            model.headers,
        )
        val row = model.groups.single().rows.single()
        assertEquals("Evan", row[0])
        // The source numbers the visible qualifier layout from 1 for every
        // Tournament; the legacy/global registry value 7 is deliberately ignored.
        assertEquals("1", row[1])
        assertEquals("Evan", row[3])
        assertEquals("Merle", row[5])
    }

    // Step 6 says where each Player is heading; step 10 has nowhere left to go.
    @Test
    fun `the qualifier image carries the destination column and the final one does not`() {
        val qualifier = androidResultsImageModel(document, "qualifier", "Kwalificatie-uitslag")
        assertEquals(
            listOf("Positie", "SP Rank", "Deelnemer", "Naar Eindgroep", "Score"),
            qualifier.headers,
        )
        val finals = androidResultsImageModel(document, "final", "Eindgroep-uitslag")
        assertEquals(listOf("Positie", "SP Rank", "Deelnemer", "Score"), finals.headers)
    }

    @Test
    fun `only final results carry their medal while both use podium positions`() {
        val qualifier = androidResultsImageModel(document, "qualifier", "Kwalificatie-uitslag")
        assertEquals("", qualifier.groups.single().rows[0].medal)
        assertEquals(1, qualifier.groups.single().rows[0].positionRank)
        val model = androidResultsImageModel(document, "final", "Eindgroep-uitslag")
        val rows = model.groups.single().rows
        assertEquals("🏆", rows[0].medal)
        assertEquals("🥈", rows[1].medal)
        assertEquals("146", rows[0].values.last())
    }

    @Test
    fun `the picture is titled with the Tournament and says which board it is`() {
        val model = androidLayoutImageModel(document, "qualifier", "Kwalificatie-indeling")
        assertEquals("🏁 Kwalificatie Indeling", model.title)
        assertEquals("PORTREF Stepport · 27 maart 2026", model.subtitle)
        assertEquals(2, model.groups.single().participantCount)
        assertTrue(model.groups.single().stats.contains("Gem. SP"))
    }

    // The source's own minimum column widths, which differ per board.
    @Test
    fun `each board keeps its own column minimums`() {
        assertEquals(listOf(84f, 36f, 42f, 72f, 42f, 72f), androidExportMinimums("layout", true))
        assertEquals(listOf(72f, 54f, 94f, 82f, 52f), androidExportMinimums("results", true))
        assertEquals(listOf(72f, 54f, 94f, 52f), androidExportMinimums("results", false))
    }

    @Test
    fun `a column grows to fit its widest cell`() {
        val model = AndroidExportImageModel(
            title = "T", subtitle = "S", headers = listOf("A"),
            groups = listOf(
                AndroidExportTable(
                    heading = "G", participantCount = 1,
                    averageSkill = 0.0, spreadPlus = 0.0, spreadMinus = 0.0,
                    borderStart = 0, borderEnd = 0,
                    rows = listOf(AndroidExportRow(listOf("een hele lange naam"))),
                ),
            ),
            mode = AndroidExportMode.LAYOUT,
            isQualifier = true,
        )
        val widths = androidExportColumnWidths(model, listOf(10f)) { text, _ -> text.length * 6f }
        assertTrue(widths.single() > 10f)
    }

    @Test
    fun `each board gets the source filename`() {
        assertEquals(
            "portref_stepport_kwalificatie_indeling.png",
            androidExportFileName(document, "qualifier", AndroidExportMode.LAYOUT),
        )
        assertEquals(
            "portref_stepport_eindgroepen_uitslag.png",
            androidExportFileName(document, "final", AndroidExportMode.RESULTS),
        )
    }

    /**
     * The twin of the site's "the frame the picture is drawn in" tests. The
     * numbers are written out rather than shared, because the point is that
     * two renderers agree without one importing the other.
     */
    @Test
    fun `the frame never comes out narrower than a qualifier's table`() {
        val stretched = androidExportStretchedWidths(listOf(72f, 54f, 94f, 52f))
        assertEquals(354f, stretched.sum(), 0f)
        assertEquals(stretched.max(), stretched[2], 0f)
        assertTrue(stretched.zip(listOf(72f, 54f, 94f, 52f)).all { (now, measured) -> now >= measured })
    }

    @Test
    fun `a wide table gets all the room it measured`() {
        val measured = listOf(120f, 100f, 90f, 80f)
        assertEquals(measured, androidExportStretchedWidths(measured))
    }

    @Test
    fun `the picture stays one column`() {
        // The owner's decision: a WhatsApp export is a single column, because
        // that is what reads on a phone.
        assertEquals(354f, ANDROID_EXPORT_MIN_TABLE_WIDTH, 0f)
    }

    /**
     * The twin of the site's "the message a shared picture travels with".
     * The picture carries the roster; the message only labels it. 18:00 UTC
     * in September is 20:00 in Amsterdam.
     */
    @Test
    fun `the shared picture's message says which night, when and which board`() {
        val dated = document.copy(
            summary = document.summary.copy(
                eventDate = "2026-09-11",
                startAtMs = 1_789_149_600_000L,
                timezone = "Europe/Amsterdam",
            ),
        )
        val when_ = "11 september 2026 \u00B7 20:00"
        assertEquals(
            dated.summary.name + "\n" + when_ + "\n\uD83C\uDFC1 Kwalificatie Indeling",
            androidExportShareCaption(dated, "qualifier", AndroidExportMode.LAYOUT),
        )
        assertEquals(
            dated.summary.name + "\n" + when_ + "\n\uD83C\uDFC1 Resultaat Kwalificatie",
            androidExportShareCaption(dated, "qualifier", AndroidExportMode.RESULTS),
        )
        assertEquals(
            dated.summary.name + "\n" + when_ + "\n\uD83C\uDFC1 Eind Groep Indeling",
            androidExportShareCaption(dated, "final", AndroidExportMode.LAYOUT),
        )
        assertEquals(
            dated.summary.name + "\n" + when_ + "\n\uD83C\uDFC1 Resultaat Eind Groep",
            androidExportShareCaption(dated, "final", AndroidExportMode.RESULTS),
        )
    }

    @Test
    fun `the shared picture's message carries no roster`() {
        val caption = androidExportShareCaption(document, "qualifier", AndroidExportMode.LAYOUT)
        assertTrue(caption.lines().size <= 3)
        assertTrue(!caption.contains("Evan"))
    }
}

