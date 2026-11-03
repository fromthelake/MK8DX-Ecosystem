package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reading the workbook's races. This is what makes a workbook-scored night
 * count: manual totals never reach TrueSkill, because only a race result can be
 * published and only a publication is rated.
 */
class AndroidTournamentWorkbookRacesTest {

    private fun sheet(rows: List<Map<String, String>>) =
        AndroidWorkbookSheet("Results", WORKBOOK_RACE_HEADERS, rows)

    private fun row(video: String, race: Int, track: String, position: Int, player: String) =
        mapOf(
            "Video" to video, "Race" to race.toString(), "Track" to track,
            "Position" to position.toString(), "Player" to player,
        )

    @Test
    fun `rows become one race per recording and race number, in finishing order`() {
        val races = androidWorkbookRaces(sheet(listOf(
            row("20250103_Groep1", 1, "Toad Harbour", 2, "Merle"),
            row("20250103_Groep1", 1, "Toad Harbour", 1, "Evan"),
            row("20250103_Groep1", 2, "Water Park", 1, "Merle"),
            row("20250103_Groep1", 2, "Water Park", 2, "Evan"),
        )))
        val group1 = races.getValue("20250103_Groep1")
        assertEquals(2, group1.size)
        assertEquals(listOf("Evan", "Merle"), group1.first().finishOrder)
        assertEquals(listOf("Merle", "Evan"), group1.last().finishOrder)
        assertEquals(listOf(1, 2), group1.map { it.raceNumber })
    }

    // The Processor writes its own spelling; the canonical catalogue says
    // "Toad Harbor". A letter must not cost a race.
    @Test
    fun `a track name is resolved forgivingly`() {
        assertEquals("track.toad_harbour", androidResolveTrackId("Toad Harbour"))
        assertEquals("track.toad_harbour", androidResolveTrackId("Toad Harbor"))
        assertEquals("track.mario_kart_stadium", androidResolveTrackId("mario kart stadium"))
        assertNull(androidResolveTrackId("Iets Wat Geen Baan Is"))
    }

    @Test
    fun `races resolve onto the Players the operator confirmed`() {
        val races = androidWorkbookRaces(sheet(listOf(
            row("v", 1, "Water Park", 1, "Soudler"),
            row("v", 1, "Water Park", 2, "Merle"),
        ))).getValue("v")
        val mappings = listOf(
            AndroidScoreMapping("Soudler", 84, "player.sadler", 1.0, viaAlias = true),
            AndroidScoreMapping("Merle", 30, "player.merle", 1.0, viaAlias = false),
        )
        val resolved = androidResolveRaces(races, mappings, AndroidProductLanguage.DUTCH)
        assertTrue(resolved is AndroidRaceResolution.Resolved)
        val race = (resolved as AndroidRaceResolution.Resolved).races.single()
        assertEquals(listOf("player.sadler", "player.merle"), race.finishOrder)
        assertEquals("track.water_park", race.trackId)
    }

    // A partly imported night would be scored wrong rather than obviously
    // unfinished, so nothing is sent unless every race resolves.
    @Test
    fun `an unmapped racer stops the whole import and is named`() {
        val races = androidWorkbookRaces(sheet(listOf(
            row("v", 1, "Water Park", 1, "Soudler"),
            row("v", 1, "Water Park", 2, "Onbekend"),
        ))).getValue("v")
        val mappings = listOf(
            AndroidScoreMapping("Soudler", 84, "player.sadler", 1.0, viaAlias = true),
        )
        val resolved = androidResolveRaces(races, mappings, AndroidProductLanguage.DUTCH)
        assertTrue(resolved is AndroidRaceResolution.Failed)
        assertTrue((resolved as AndroidRaceResolution.Failed).message.contains("Onbekend"))
    }

    @Test
    fun `an unrecognised track stops the import and is named`() {
        val races = androidWorkbookRaces(sheet(listOf(
            row("v", 1, "Geen Baan", 1, "Merle"),
            row("v", 1, "Geen Baan", 2, "Evan"),
        ))).getValue("v")
        val mappings = listOf(
            AndroidScoreMapping("Merle", 30, "player.merle", 1.0, viaAlias = false),
            AndroidScoreMapping("Evan", 20, "player.evan", 1.0, viaAlias = false),
        )
        val resolved = androidResolveRaces(races, mappings, AndroidProductLanguage.DUTCH)
        assertTrue(resolved is AndroidRaceResolution.Failed)
        assertTrue((resolved as AndroidRaceResolution.Failed).message.contains("Geen Baan"))
    }

    @Test
    fun `a race with a single finisher is not a race`() {
        val races = androidWorkbookRaces(sheet(listOf(
            row("v", 1, "Water Park", 1, "Merle"),
        )))
        assertTrue(races.isEmpty())
    }

    @Test
    fun `an unusable row is skipped without shifting the rest`() {
        val races = androidWorkbookRaces(sheet(listOf(
            row("v", 1, "Water Park", 1, "Evan"),
            mapOf("Video" to "v", "Race" to "1", "Track" to "Water Park", "Position" to "", "Player" to "Kapot"),
            row("v", 1, "Water Park", 2, "Merle"),
        ))).getValue("v")
        assertEquals(listOf("Evan", "Merle"), races.single().finishOrder)
    }
}
