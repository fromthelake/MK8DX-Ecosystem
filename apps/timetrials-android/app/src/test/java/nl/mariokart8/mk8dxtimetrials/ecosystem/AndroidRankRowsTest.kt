package nl.mariokart8.mk8dxtimetrials.ecosystem

import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxRowKind
import nl.mariokart8.mk8dxtimetrials.ui.design.mk8dxLargestRank
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Phase 6 (A04): what the Ranking tables hand to the design system's table.
 * The rows carry the standing's own ranks and totals, the reader's own row is
 * the YouRow, a reference Player consumes no competitor's place, and the rank
 * column is measured from the largest rank in the dataset — the protected
 * range #1 … #99,999 of DESIGN_SYSTEM §10.
 */
class AndroidRankRowsTest {
    private fun standing(rank: Int, playerId: String, name: String, total: Long) =
        AndroidRankStanding(
            rank = rank, playerId = playerId, playerDisplayName = name, mode = 150,
            totalTimeMs = total, averageTimeMs = total / 96, playedTracks = 96,
            goldMedals = 0, silverMedals = 0, bronzeMedals = 0,
        )

    @Test
    fun theGlobalStandingKeepsItsRanksAndMarksTheReadersOwnRow() {
        val rows = androidRankStandingRows(
            listOf(
                standing(1, "player.leader", "Leader", 11_000_000),
                standing(2, "player.ben", "Ben", 12_000_000),
                standing(99_999, "player.last", "Last", 90_000_000),
            ),
            viewerPlayerId = "player.ben",
            youLabel = "You",
        )
        assertEquals(listOf(1, 2, 99_999), rows.map { it.rank })
        assertEquals(listOf("Leader", "Ben", "Last"), rows.map { it.name })
        assertEquals(Mk8dxRowKind.Normal, rows[0].kind)
        assertEquals(Mk8dxRowKind.You, rows[1].kind)
        assertEquals("You", rows[1].youLabel)
        // The widest rank the column must hold is the dataset's own maximum.
        assertEquals(99_999, mk8dxLargestRank(rows))
        assertEquals("#99,999", Mk8dxNumeric.formatRank(mk8dxLargestRank(rows), Mk8dxNumberLanguage.EN))
        assertEquals("#99.999", Mk8dxNumeric.formatRank(mk8dxLargestRank(rows), Mk8dxNumberLanguage.NL))
    }

    @Test
    fun aSignedOutReaderHasNoOwnRow() {
        val rows = androidRankStandingRows(
            listOf(standing(1, "player.leader", "Leader", 11_000_000)),
            viewerPlayerId = null,
            youLabel = "You",
        )
        assertEquals(Mk8dxRowKind.Normal, rows.single().kind)
    }

    private fun summary(playerId: String, name: String, total: Long) = AndroidRankPlayerSummary(
        playerId = playerId, displayName = name, mode = 150, totalMs = total,
        playedTracks = 96, masteryTier = 4, gold = 0, silver = 0, bronze = 0, bests = emptyMap(),
    )

    @Test
    fun theChosenScopeIsOrderedByTotalWithReferencesAsReferenceRows() {
        val rows = androidRankScopeStandingRows(
            listOf(
                summary("player.ben", "Ben", 12_000_000),
                summary(ANDROID_WORLD_RECORD_REFERENCE_ID, "World Record", 9_000_000),
                summary("player.rival", "Rival", 11_000_000),
            ),
            ownPlayerId = "player.ben",
            youLabel = "You",
        )
        assertEquals(listOf("World Record", "Rival", "Ben"), rows.map { it.name })
        assertEquals(listOf(1, 2, 3), rows.map { it.rank })
        assertEquals(Mk8dxRowKind.Reference, rows[0].kind)
        assertEquals(Mk8dxRowKind.Normal, rows[1].kind)
        assertEquals(Mk8dxRowKind.You, rows[2].kind)
    }

    @Test
    fun equalTotalsAreOrderedByPlayerIdSoTheTableNeverJumps() {
        val rows = androidRankScopeStandingRows(
            listOf(
                summary("player.zoe", "Zoe", 12_000_000),
                summary("player.alex", "Alex", 12_000_000),
            ),
            ownPlayerId = null,
            youLabel = "You",
        )
        assertEquals(listOf("Alex", "Zoe"), rows.map { it.name })
    }
}
