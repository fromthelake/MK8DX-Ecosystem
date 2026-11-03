package nl.mariokart8.mk8dxtimetrials.tournament

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Step 3 / Step 7 layout file, against the shape the source Manager writes:
 * `Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep`, one row per console.
 */
class AndroidTournamentLayoutCsvTest {

    private val file = listOf(
        "Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep",
        "Evan;NS1;Evan;Merle;Groep 1",
        "Sadler;NS1;Soudler;Leonora;Groep 1",
        "Gideon;NS2;Gideon;Xavier;Groep 2",
    ).joinToString("\r\n")

    private fun player(id: String, name: String, aliases: List<String> = emptyList()) =
        AndroidTournamentPlayerSearchResult(id, name.lowercase(), name, aliases)

    private val directory = listOf(
        player("player.evan", "Evan"),
        player("player.merle", "Merle"),
        player("player.sadler", "Sadler", listOf("Soudler")),
        player("player.leonora", "Leonora"),
        player("player.gideon", "Gideon"),
        player("player.xavier", "Xavier"),
    )

    @Test
    fun `each console row becomes two seats in its group`() {
        val parsed = androidParseLayoutCsv(file)
        assertTrue(parsed is AndroidLayoutCsvParse.Parsed)
        val seats = (parsed as AndroidLayoutCsvParse.Parsed).seats
        assertEquals(6, seats.size)
        assertEquals(listOf(1, 2, 1, 2, 1, 2), seats.map { it.seatNumber })
        assertEquals("Groep 1", seats.first().groupName)
        assertEquals("ns2", seats.last().switchType)
    }

    @Test
    fun `an in-game name in the layout resolves through the alias`() {
        val parsed = androidParseLayoutCsv(file) as AndroidLayoutCsvParse.Parsed
        val resolved = androidResolveLayout(parsed.seats, directory)
        assertTrue(resolved is AndroidLayoutResolution.Resolved)
        val groups = (resolved as AndroidLayoutResolution.Resolved).groups
        assertEquals(listOf("Groep 1", "Groep 2"), groups.map { it.name })
        // "Soudler" is Sadler; the station owner resolves the same way.
        val sadler = groups.first().seats.first { it.playerId == "player.sadler" }
        assertEquals("player.sadler", sadler.stationOwnerPlayerId)
        assertEquals("ns1", sadler.switchType)
    }

    @Test
    fun `a layout naming somebody unknown is refused whole`() {
        val parsed = androidParseLayoutCsv(
            file.replace("Xavier", "Iemand Anders"),
        ) as AndroidLayoutCsvParse.Parsed
        val resolved = androidResolveLayout(parsed.seats, directory)
        assertTrue(resolved is AndroidLayoutResolution.Failed)
        assertTrue(
            (resolved as AndroidLayoutResolution.Failed).message.contains("Iemand Anders"),
        )
    }

    @Test
    fun `the same Player twice is rejected before anything is sent`() {
        val duplicated = listOf(
            "Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep",
            "Evan;NS1;Evan;Merle;Groep 1",
            "Sadler;NS1;Evan;Leonora;Groep 1",
        ).joinToString("\r\n")
        val parsed = androidParseLayoutCsv(duplicated)
        assertTrue(parsed is AndroidLayoutCsvParse.Failed)
        val message = (parsed as AndroidLayoutCsvParse.Failed).message
        assertTrue(message.contains("Regel 3, kolom Deelnemer 1"))
        assertTrue(message.contains("staat al eerder in het bestand"))
    }

    // A workbook dropped into a CSV import used to be reported as a missing
    // column, which sends the operator looking at the wrong thing.
    @Test
    fun `an Excel workbook is named as such, not blamed on a column`() {
        val workbook = "PK" + "\u0003" + "\u0004" + "binaire troep"
        val layout = androidParseLayoutCsv(workbook)
        assertTrue(layout is AndroidLayoutCsvParse.Failed)
        assertTrue((layout as AndroidLayoutCsvParse.Failed).message.contains(".xlsx"))
        val roster = androidParseRosterCsv(workbook)
        assertTrue(roster is AndroidRosterCsvParse.Failed)
        assertTrue((roster as AndroidRosterCsvParse.Failed).message.contains(".xlsx"))
    }

    @Test
    fun `a roster file is not mistaken for a layout`() {
        val roster = "Naam;Status;NS1;NS2\r\nEvan;Aanwezig;Ja;nee"
        val parsed = androidParseLayoutCsv(roster)
        assertTrue(parsed is AndroidLayoutCsvParse.Failed)
        val message = (parsed as AndroidLayoutCsvParse.Failed).message
        assertTrue(message.contains("Regel 1"))
        assertTrue(message.contains("Switcheigenaar"))
    }

    @Test
    fun `a console left empty still yields a seated Player`() {
        val single = listOf(
            "Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep",
            "Evan;NS1;Evan;;Groep 1",
        ).joinToString("\r\n")
        val parsed = androidParseLayoutCsv(single) as AndroidLayoutCsvParse.Parsed
        assertEquals(1, parsed.seats.size)
        assertEquals("Evan", parsed.seats.single().playerName)
    }

    private fun station(owner: String, type: String, seat: Int) = AndroidTournamentMemberStation(
        ownerPlayerId = "player.$owner", ownerDisplayName = owner.replaceFirstChar { it.uppercase() },
        switchType = type, seatNumber = seat,
    )

    private fun member(name: String, order: Int, at: AndroidTournamentMemberStation? = null) = AndroidTournamentMember(
        playerId = "player.$name", displayName = name.replaceFirstChar { it.uppercase() }, seatOrder = order, station = at,
    )

    private fun groupWith(
        members: List<AndroidTournamentMember>,
        stations: List<AndroidTournamentGroupStation> = emptyList(),
    ) = AndroidTournamentGroup(
        groupId = "tournament_group.slots_g1", stage = "qualifier", sequence = 1, name = "Groep 1",
        locked = false, manualScoreSegments = 1, members = members, stations = stations,
        races = emptyList(), manualScores = emptyList(),
        standings = AndroidTournamentStandings(source = "none", rows = emptyList(), tieGroups = emptyList()),
    )

    private fun documentWith(group: AndroidTournamentGroup) = AndroidTournamentDocument(
        schemaVersion = "mk8dx.tournament-operation.v1",
        summary = AndroidTournamentSummary(
            tournamentId = "tournament.slots", name = "Slots", stage = "qualifiers", revision = 3,
            participantCount = 3, presentCount = 3, publicResults = false, affectsRating = false, updatedAtMs = 1L,
        ),
        participants = emptyList(), stations = emptyList(), groups = listOf(group), overall = emptyList(), lifecycle = emptyList(),
    )

    @Test
    fun `the stored slot order comes first, an empty console included, then any a seat still names`() {
        val group = groupWith(
            members = listOf(member("alpha", 1, station("alpha", "ns2", 1)), member("carl", 2, station("carl", "ns1", 1))),
            stations = listOf(
                AndroidTournamentGroupStation(1, "player.bravo", "Bravo", "ns1"),
                AndroidTournamentGroupStation(2, "player.alpha", "Alpha", "ns2"),
            ),
        )
        assertEquals(
            listOf("player.bravo|ns1", "player.alpha|ns2", "player.carl|ns1"),
            androidGroupSlots(group).map { "${it.stationOwnerPlayerId}|${it.switchType}" },
        )
    }

    @Test
    fun `a parked console lands in the asked slot and every layout carries the slot order`() {
        val document = documentWith(groupWith(
            members = listOf(member("alpha", 1, station("alpha", "ns2", 1))),
            stations = listOf(AndroidTournamentGroupStation(1, "player.alpha", "Alpha", "ns2")),
        ))
        val placed = androidPlaceStationPlan(document, "qualifier", "player.bravo", "ns1", "tournament_group.slots_g1", 0)
        assertEquals(false, placed.membershipChanged)
        assertEquals(
            listOf(AndroidLayoutStationRequest("player.bravo", "ns1"), AndroidLayoutStationRequest("player.alpha", "ns2")),
            placed.layout.single().stations,
        )
        assertEquals(listOf("player.alpha"), placed.layout.single().seats.map { it.playerId })
        val parked = androidParkStationPlan(document, "qualifier", "player.alpha", "ns2")
        assertEquals(true, parked.membershipChanged)
        assertEquals(emptyList<AndroidLayoutStationRequest>(), parked.layout.single().stations)
        assertEquals(emptyList<String>(), parked.memberships.single().members)
        val playerOut = androidParkPlayerPlan(document, "qualifier", "player.alpha")
        assertEquals(true, playerOut.membershipChanged)
        assertEquals(listOf(AndroidLayoutStationRequest("player.alpha", "ns2")), playerOut.layout.single().stations)
        assertEquals(emptyList<String>(), playerOut.memberships.single().members)
    }
}
