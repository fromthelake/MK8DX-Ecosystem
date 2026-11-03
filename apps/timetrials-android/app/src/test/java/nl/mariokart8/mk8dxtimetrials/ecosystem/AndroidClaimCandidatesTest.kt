package nl.mariokart8.mk8dxtimetrials.ecosystem

import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** ADR-0219 on the phone: the same candidate document and context lines as the website. */
class AndroidClaimCandidatesTest {
    private val document = """
        {"schemaVersion":"mk8dx.claim-candidates.v1","candidates":[
          {"playerId":"player.mal_tt","username":"mal_tt","displayName":"Mal","aliases":[],"claimed":false,
           "matchesAnswers":true,"timeTrials":{"times":42,"lastAt":"2026-10-30","classes":[150,200]},
           "tournaments":{"nights":0,"directorNames":[],"lastNight":null}},
          {"playerId":"player.mal","username":"mal","displayName":"Mal","aliases":["Malie"],"claimed":true,
           "matchesAnswers":false,"timeTrials":{"times":0,"lastAt":null,"classes":[]},
           "tournaments":{"nights":7,"directorNames":["Ben","Evan"],"lastNight":{"name":"TN13","date":"2026-10-04"}}}
        ]}
    """.trimIndent()

    @Test
    fun parsesTheCandidateDocument() {
        val candidates = parseAndroidClaimCandidates(document)
        assertEquals(listOf("player.mal_tt", "player.mal"), candidates.map { it.playerId })
        assertEquals(listOf(150, 200), candidates[0].timeTrials.classes)
        assertEquals("TN13", candidates[1].tournaments.lastNight?.name)
        assertEquals(true, candidates[1].claimed)
        assertThrows(AndroidIdentityLinkException::class.java) {
            parseAndroidClaimCandidates("""{"schemaVersion":"mk8dx.player-directory.v1","candidates":[]}""")
        }
    }

    @Test
    fun writesTheSameContextLinesAsTheWebsite() {
        val (tt, nights) = parseAndroidClaimCandidates(document)
        assertEquals(
            "42 published Time Trials · last on 2026-10-30 · 150cc and 200cc",
            androidClaimCandidateTimeTrialLine(tt.timeTrials, AndroidProductLanguage.ENGLISH),
        )
        assertEquals(
            "42 gepubliceerde Time Trials · laatste op 2026-10-30 · 150cc en 200cc",
            androidClaimCandidateTimeTrialLine(tt.timeTrials, AndroidProductLanguage.DUTCH),
        )
        assertEquals(
            "No published Time Trials",
            androidClaimCandidateTimeTrialLine(nights.timeTrials, AndroidProductLanguage.ENGLISH),
        )
        assertEquals(
            "7 tournament nights · Directors: Ben, Evan · last: TN13 (2026-10-04)",
            androidClaimCandidateTournamentLine(nights.tournaments, AndroidProductLanguage.ENGLISH),
        )
        assertEquals(
            "1 toernooiavond · laatst: TN4",
            androidClaimCandidateTournamentLine(
                AndroidClaimCandidateTournaments(1, emptyList(), AndroidClaimCandidateLastNight("TN4")),
                AndroidProductLanguage.DUTCH,
            ),
        )
        assertEquals(
            "No tournament nights",
            androidClaimCandidateTournamentLine(tt.tournaments, AndroidProductLanguage.ENGLISH),
        )
    }

    @Test
    fun groupsTheCandidatesThatFitTheAnswersFirst() {
        val candidates = parseAndroidClaimCandidates(document)
        assertEquals(
            listOf(true to listOf("player.mal_tt"), false to listOf("player.mal")),
            androidClaimCandidateGroups(candidates, timeTrials = true, tournaments = false)
                .map { (fits, group) -> fits to group.map { it.playerId } },
        )
        assertEquals(
            listOf(null to listOf("player.mal_tt", "player.mal")),
            androidClaimCandidateGroups(candidates, timeTrials = false, tournaments = false)
                .map { (fits, group) -> fits to group.map { it.playerId } },
        )
        assertEquals(emptyList<Any>(), androidClaimCandidateGroups(emptyList(), timeTrials = true, tournaments = true))
    }
}
