package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The score-workbook name resolution, against the cases the owner's own data
 * produces: the workbook records in-game names, and the alias baseline from
 * migration 0049 is what turns them back into participants.
 */
class AndroidTournamentScoreImportTest {

    private val sadler = AndroidScoreTarget("player.sadler", "Sadler", listOf("Soudler"))
    private val malo = AndroidScoreTarget("player.malo", "Malo", listOf("Mar-Kart-0"))
    private val merle = AndroidScoreTarget("player.merle", "Merle", emptyList())
    private val mosshm = AndroidScoreTarget("player.mosshm", "Moss HM", emptyList())
    private val targets = listOf(sadler, malo, merle)

    @Test
    fun `an in-game name resolves through the alias`() {
        val mappings = androidSuggestScoreMapping(
            listOf("Soudler" to 42, "Mar-Kart-0" to 37, "Merle" to 30),
            targets,
        )
        assertEquals("player.sadler", mappings.first { it.workbookName == "Soudler" }.playerId)
        assertEquals("player.malo", mappings.first { it.workbookName == "Mar-Kart-0" }.playerId)
        assertEquals("player.merle", mappings.first { it.workbookName == "Merle" }.playerId)
    }

    @Test
    fun `an alias match is labelled as one and an exact display name is not`() {
        val mappings = androidSuggestScoreMapping(listOf("Soudler" to 42, "Merle" to 30), targets)
        assertEquals("Naam-match", mappings.first { it.workbookName == "Soudler" }.label(AndroidProductLanguage.DUTCH))
        assertEquals("Exacte match", mappings.first { it.workbookName == "Merle" }.label(AndroidProductLanguage.DUTCH))
    }

    // The source paints an exact and an alias match green, a strong match blue,
    // a likely one amber, and anything left to check red.
    @Test
    fun `an exact and an alias match are both settled, not warnings`() {
        val mappings = androidSuggestScoreMapping(listOf("Soudler" to 42, "Merle" to 30), targets)
        assertEquals(
            AndroidScoreMatchTone.SETTLED,
            mappings.first { it.workbookName == "Soudler" }.meta(AndroidProductLanguage.DUTCH).tone,
        )
        assertEquals(
            AndroidScoreMatchTone.SETTLED,
            mappings.first { it.workbookName == "Merle" }.meta(AndroidProductLanguage.DUTCH).tone,
        )
        assertEquals(
            AndroidScoreMatchTone.ATTENTION,
            androidScoreMatchMeta(null, viaAlias = false, manual = false, language = AndroidProductLanguage.DUTCH).tone,
        )
    }

    @Test
    fun `the similarity is offered as a whole percentage`() {
        val mappings = androidSuggestScoreMapping(listOf("Moss" to 20), listOf(mosshm))
        assertEquals("93% overeenkomst", mappings.single().percent(AndroidProductLanguage.DUTCH))
    }

    @Test
    fun `a group is not ready while a name is unresolved`() {
        val mappings = androidSuggestScoreMapping(
            listOf("Volstrekt Onbekend" to 12, "Merle" to 30, "Soudler" to 1, "Mar-Kart-0" to 2),
            targets,
        )
        assertFalse(androidScoreGroupReady(mappings, targets))
        assertTrue(
            androidScoreGroupProblems(mappings, targets, AndroidProductLanguage.DUTCH)
                .any { it.contains("Volstrekt Onbekend") },
        )
    }

    // The owner's requirement: an unmatched name must still be linkable by
    // hand, and the operator's choice is the confirmation.
    @Test
    fun `the operator can point an unmatched name at a Player by hand`() {
        val mappings = androidSuggestScoreMapping(
            listOf("Volstrekt Onbekend" to 12, "Soudler" to 1, "Mar-Kart-0" to 2), targets,
        )
        val assigned = androidAssignScoreMapping(mappings, "Volstrekt Onbekend", "player.merle")
        val row = assigned.first { it.workbookName == "Volstrekt Onbekend" }
        assertEquals("player.merle", row.playerId)
        assertTrue(row.manual)
        assertEquals("Handmatig gekoppeld", row.label(AndroidProductLanguage.DUTCH))
        assertTrue(androidScoreGroupReady(assigned, targets))
    }

    // The source lets a duplicate stand and shows it, rather than silently
    // taking the Player away from the row that already had them.
    @Test
    fun `choosing a Player twice is reported, not silently corrected`() {
        val mappings = androidSuggestScoreMapping(
            listOf("Merle" to 30, "Soudler" to 1, "Mar-Kart-0" to 2), targets,
        )
        val assigned = androidAssignScoreMapping(mappings, "Soudler", "player.merle")
        assertEquals("player.merle", assigned.first { it.workbookName == "Merle" }.playerId)
        assertEquals(2, androidScoreSelectionCounts(assigned)["player.merle"])
        assertFalse(androidScoreGroupReady(assigned, targets))
        val problems = androidScoreGroupProblems(assigned, targets, AndroidProductLanguage.DUTCH)
        assertTrue(problems.any { it.contains("Merle") && it.contains("2 keer") })
        assertTrue(problems.any { it.contains("Zonder score") && it.contains("Sadler") })
    }

    @Test
    fun `the picker count says how often each Player is already chosen`() {
        val mappings = androidSuggestScoreMapping(
            listOf("Merle" to 30, "Soudler" to 1, "Mar-Kart-0" to 2), targets,
        )
        val counts = androidScoreSelectionCounts(mappings)
        assertEquals(1, counts["player.merle"])
        assertEquals(1, counts["player.sadler"])
    }

    @Test
    fun `two workbook names never resolve to the same Player by suggestion`() {
        val mappings = androidSuggestScoreMapping(
            listOf("Soudler" to 42, "Sande" to 20),
            listOf(sadler),
        )
        assertEquals(1, mappings.count { it.playerId == "player.sadler" })
    }

    @Test
    fun `similarity follows the source ladder`() {
        assertEquals(1.0, androidScoreSimilarity("Merle", "merle"), 0.0001)
        assertEquals(0.93, androidScoreSimilarity("Moss HM", "Moss"), 0.0001)
        assertEquals(0.0, androidScoreSimilarity("Sadler", "Valerio"), 0.0001)
    }

    @Test
    fun `clearing a mapping puts it back on the operator's list`() {
        val mappings = androidSuggestScoreMapping(listOf("Merle" to 30), targets)
        val cleared = androidAssignScoreMapping(mappings, "Merle", null)
        assertNull(cleared.single().playerId)
        assertTrue(cleared.single().unresolved)
        assertFalse(androidScoreGroupReady(cleared, targets))
    }

    @Test
    fun `a column reference resolves past the first alphabet`() {
        assertEquals(0, androidWorkbookColumnIndex("A1"))
        assertEquals(25, androidWorkbookColumnIndex("Z9"))
        assertEquals(26, androidWorkbookColumnIndex("AA1"))
        assertEquals(27, androidWorkbookColumnIndex("AB12"))
    }

    @Test
    fun `a plain text file is not mistaken for a workbook`() {
        assertFalse(androidLooksLikeWorkbook("Naam;Status;NS1;NS2".toByteArray()))
        assertTrue(androidLooksLikeWorkbook(byteArrayOf(0x50, 0x4B, 0x03, 0x04, 0x00)))
    }

    private fun standingsSheet(): AndroidWorkbookSheet = AndroidWorkbookSheet(
        name = WORKBOOK_FINAL_STANDINGS_SHEET,
        headers = WORKBOOK_FINAL_STANDINGS_HEADERS + "CharacterRosterName",
        rows = listOf(
            mapOf(
                "VideoName" to "Kampioen", "PlayerName" to "Soudler",
                "TotalPoints" to "42", "Character" to "Yoshi",
                "CharacterRosterName" to "Yoshi (Light)",
            ),
            mapOf(
                "VideoName" to "Kampioen", "PlayerName" to "Merle",
                "TotalPoints" to "30", "Character" to "  ",
            ),
            mapOf(
                "VideoName" to "Talent", "PlayerName" to "Mar-Kart-0",
                "TotalPoints" to "21", "Character" to "Mario",
            ),
        ),
    )

    @Test
    fun `the character column is read per recording`() {
        val characters = androidWorkbookStandingsCharacters(standingsSheet())
        assertEquals(setOf("Kampioen", "Talent"), characters.keys)
        assertEquals("Yoshi", characters["Kampioen"]?.get("Soudler")?.label)
        assertEquals("Yoshi (Light)", characters["Kampioen"]?.get("Soudler")?.roster)
        // A blank character is not a character; nothing is invented for Merle.
        assertNull(characters["Kampioen"]?.get("Merle"))
        assertEquals("Mario", characters["Talent"]?.get("Mar-Kart-0")?.label)
    }

    @Test
    fun `only a row with both a Player and a character is sent`() {
        val characters = androidWorkbookStandingsCharacters(standingsSheet())["Kampioen"].orEmpty()
        val mappings = androidSuggestScoreMapping(listOf("Soudler" to 42, "Merle" to 30), targets)
        val resolved = androidResolvedCharacters(mappings, characters)
        assertEquals(1, resolved.size)
        assertEquals("player.sadler", resolved.single().playerId)
        assertEquals("Yoshi", resolved.single().label)
        assertEquals("Yoshi (Light)", resolved.single().roster)
    }

    @Test
    fun `a name still waiting for a Player carries no character`() {
        val characters = androidWorkbookStandingsCharacters(standingsSheet())["Kampioen"].orEmpty()
        val mappings = androidAssignScoreMapping(
            androidSuggestScoreMapping(listOf("Soudler" to 42), targets),
            "Soudler",
            null,
        )
        assertTrue(androidResolvedCharacters(mappings, characters).isEmpty())
    }
}
