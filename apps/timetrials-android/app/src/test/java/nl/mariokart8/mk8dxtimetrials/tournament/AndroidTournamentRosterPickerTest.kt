package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidDisambiguatedName
import nl.mariokart8.mk8dxtimetrials.ui.androidRepeatedDisplayNames
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** ADR-0218 on the phone: the same decisions as the website's picker. */
class AndroidTournamentRosterPickerTest {
    private val mal = AndroidRosterCandidate(
        playerId = "player.mal", username = "mal", displayName = "Mal", matchedBy = "display_name",
        claimed = true, inTournament = false, nights = 12, nightsWithDirector = 3,
        lastNightName = "TN13", lastNightDate = "2026-10-04", directorNames = listOf("Ben"),
    )
    private val otherMal = AndroidRosterCandidate(
        playerId = "player.mal_2", username = "mal-2", displayName = "Mal", matchedBy = "display_name",
        claimed = false, inTournament = false, nights = 2, nightsWithDirector = 0, directorNames = listOf("Evan"),
    )

    private fun entry(vararg candidates: AndroidRosterCandidate) =
        AndroidRosterNameCandidates("Mal", sameNameInOwnNights = false, candidates = candidates.toList())

    @Test
    fun onlyAnUnambiguousRowStartsWithASuggestion() {
        assertEquals(AndroidRosterChoice.New, androidRosterImportSuggestion(entry()))
        assertEquals(AndroidRosterChoice.Player("player.mal"), androidRosterImportSuggestion(entry(mal)))
        assertNull(androidRosterImportSuggestion(entry(otherMal)))
        assertNull(androidRosterImportSuggestion(entry(mal, otherMal)))
        assertEquals(
            AndroidRosterChoice.Player("player.mal_2"),
            androidRosterImportSuggestion(entry(mal, otherMal.copy(inTournament = true))),
        )
        assertEquals(AndroidRosterChoice.New, androidRosterImportSuggestion(entry(mal.copy(matchedBy = "partial"))))
    }

    @Test
    fun theReviewHoldsOneChoicePerFileRow() {
        val rows = listOf(
            AndroidRosterCsvRow(2, "Mal", ATTENDANCE_PRESENT, true, false),
            AndroidRosterCsvRow(3, "Nova", ATTENDANCE_ABSENT, false, false),
        )
        val review = androidRosterReview(rows, listOf(entry(mal, otherMal), entry().copy(name = "Nova")))
        assertEquals(mapOf(2 to null, 3 to AndroidRosterChoice.New), review.choices)
        assertEquals(1, review.openRows)
        assertEquals(1, review.creating)
    }

    @Test
    fun aSpellingIsRememberedOnlyWhenItIsNotAlreadyThePlayersName() {
        assertEquals(
            listOf("player.mal" to "Malie"),
            androidRosterAliasesToRemember(
                listOf(
                    "Malie" to mal.copy(matchedBy = "partial"),
                    "MAL" to mal,
                    "Malo" to otherMal.copy(matchedBy = "alias", aliasText = "Malo", aliasScope = "installation"),
                    "malie" to mal.copy(matchedBy = "partial"),
                ),
            ),
        )
    }

    @Test
    fun theContextLineTellsTwoMalsApart() {
        assertEquals(
            "@mal · 12 nights, 3 with this Director · last: TN13 (2026-10-04) · Directors: Ben · has an account",
            androidRosterCandidateContext(mal, AndroidProductLanguage.ENGLISH),
        )
        assertEquals(
            "@mal-2 · 2 avonden · Directeuren: Evan · nog geen account",
            androidRosterCandidateContext(otherMal, AndroidProductLanguage.DUTCH),
        )
    }

    @Test
    fun equalNamesOnOneScreenCarryTheirUsername() {
        val repeated = androidRepeatedDisplayNames(listOf("player.mal" to "Mal", "player.mal_2" to " mal", "player.nova" to "Nova"))
        assertEquals("Mal (@mal)", androidDisambiguatedName("Mal", "mal", repeated))
        assertEquals("Nova", androidDisambiguatedName("Nova", "nova", repeated))
        assertEquals("Mal", androidDisambiguatedName("Mal", "mal", androidRepeatedDisplayNames(listOf("player.mal" to "Mal", "player.mal" to "Mal"))))
    }

    @Test
    fun statisticsLeadersWithOneNameCarryTheirUsernames() {
        val rows = androidBuildStatisticsRows(
            listOf(
                AndroidTournamentStatisticsTrack("track.a", 1, 2, 1, 4, 4, "player.mal", "Mal", "mal", 3.0),
                AndroidTournamentStatisticsTrack("track.b", 1, 2, 1, 4, 4, "player.mal_2", "Mal", "mal-2", 2.0),
                AndroidTournamentStatisticsTrack("track.c", 1, 2, 1, 4, 4, "player.nova", "Nova", "nova", 1.0),
            ),
        ) { null }
        assertEquals(listOf("Mal (@mal)", "Mal (@mal-2)", "Nova"), rows.map { it.bestPlayerName })
    }
}
