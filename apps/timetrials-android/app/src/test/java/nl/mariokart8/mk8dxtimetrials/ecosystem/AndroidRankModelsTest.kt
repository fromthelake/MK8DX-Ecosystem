package nl.mariokart8.mk8dxtimetrials.ecosystem

import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidRankModelsTest {
    @Test
    fun totalFormatterPreservesHoursAndMilliseconds() {
        assertEquals("3:25:45.678", formatAndroidRankTotal(12_345_678))
        // Phase 6 (A04): Ranking's own signed-total formatter is gone; a gap on
        // this screen is now the design system's delta — a true minus, no empty
        // hours below an hour, and "±0.000" when there is no gap at all.
        assertEquals("−0.637", Mk8dxNumeric.formatDelta(-637))
        assertEquals("±0.000", Mk8dxNumeric.formatDelta(0))
        assertEquals("+3:25:45.678", Mk8dxNumeric.formatDelta(12_345_678))
    }

    @Test
    fun rankTimeNotationStaysStableOnDutchPhones() {
        synchronized(Locale::class.java) {
            val original = Locale.getDefault()
            try {
                Locale.setDefault(Locale.forLanguageTag("nl-NL"))
                assertEquals("0:02.095", formatAndroidGap(2_095))
                assertEquals("3:13:00.277", formatAndroidRankTotal(11_580_277))
            } finally {
                Locale.setDefault(original)
            }
        }
    }

    @Test
    fun rankPlayersDeduplicateOverlappingAudiencesAndUseHistoricalFallback() {
        val home = AndroidHomeBootstrap(
            schemaVersion = "mk8dx.home-bootstrap.v1",
            authenticated = true,
            comeback = AndroidHomeComeback(
                "mk8dx.home-comeback.v1",
                AndroidHomePlayer("player.me", "Me"),
                AndroidTimeTrialStanding(1, 2, 0),
                listOf(
                    AndroidRivalComparison("player.friend", "Friend", 0, 0, 0, 0),
                    AndroidRivalComparison("player.friend", "Duplicate", 0, 0, 0, 0),
                ),
            ),
            trackBests = AndroidTrackBestsDocument(
                "mk8dx.public-track-bests.v1",
                listOf(
                    AndroidTrackBestPlayer(
                        "player.me",
                        listOf(AndroidTrackBest("track.mario_kart_stadium", 150, 100_000, 1)),
                    ),
                    AndroidTrackBestPlayer(
                        "player.friend",
                        listOf(AndroidTrackBest("track.mario_kart_stadium", 150, 101_000, 2)),
                    ),
                    AndroidTrackBestPlayer(
                        "player.friend",
                        listOf(AndroidTrackBest("track.water_park", 150, 99_000, 1)),
                    ),
                ),
            ),
        )

        val players = buildAndroidRankPlayers(home, 150)

        assertEquals(listOf("player.me", "player.friend"), players.map { it.playerId })
        assertEquals(100_000L + 95 * 600_000L, players.first().totalMs)
        assertEquals(2, players.last().playedTracks)
        assertEquals(1, players.first().gold)
    }

    @Test
    fun comparisonSelectionIsBoundedAndNeverBecomesEmpty() {
        var selected = listOf("player.a")
        selected = updateAndroidRankSelection(selected, "player.b")
        selected = updateAndroidRankSelection(selected, "player.c")
        assertEquals(3, selected.size)
        assertEquals(selected, updateAndroidRankSelection(selected, "player.d"))
        assertEquals(listOf("player.b", "player.c"), updateAndroidRankSelection(selected, "player.a"))
        assertEquals(listOf("player.a"), updateAndroidRankSelection(listOf("player.a"), "player.a"))
    }

    @Test
    fun signedInReferenceSelectionKeepsViewerAndReplacesAFullRivalSlot() {
        assertEquals(
            listOf("player.me", ANDROID_NINTENDO_STAFF_REFERENCE_ID),
            updateAndroidRankSelection(listOf("player.me"), ANDROID_NINTENDO_STAFF_REFERENCE_ID, "player.me"),
        )
        assertEquals(
            listOf("player.me", "player.rival", ANDROID_WORLD_RECORD_REFERENCE_ID),
            updateAndroidRankSelection(
                listOf("player.me", "player.rival", "player.other"),
                ANDROID_WORLD_RECORD_REFERENCE_ID,
                "player.me",
            ),
        )
    }

    @Test
    fun medalsAndMasteryColumnsUseCompetitiveOrder() {
        fun player(name: String, total: Long, gold: Int, silver: Int, bronze: Int) =
            AndroidRankPlayerSummary(
                "player.${name.lowercase()}", name, 150, total, 96, 0,
                gold, silver, bronze, emptyMap(),
            )
        val silver = player("Silver", 300, 2, 9, 0)
        val bronze = player("Bronze", 200, 2, 9, 4)
        val gold = player("Gold", 100, 3, 0, 0)

        assertEquals(listOf("Gold", "Bronze", "Silver"), sortAndroidRankMedals(listOf(silver, bronze, gold)).map { it.displayName })
        assertEquals(listOf("Gold", "Bronze", "Silver"), sortAndroidRankMasteryColumns(listOf(silver, gold, bronze)).map { it.displayName })
        fun standing(name: String, gold: Int, silver: Int, bronze: Int) = AndroidRankStanding(
            1, "player.${name.lowercase()}", name, 150, 1, 1, 1, gold, silver, bronze,
        )
        assertEquals(
            listOf("Gold", "Bronze", "Silver"),
            sortAndroidStandingMedals(
                listOf(standing("Silver", 2, 9, 0), standing("Gold", 3, 0, 0), standing("Bronze", 2, 9, 4)),
            ).map { it.playerDisplayName },
        )
    }

    @Test
    fun publicNintendoAndWorldRecordReferencesCoverAllTracks() {
        val nintendo = buildAndroidRankReference(ANDROID_NINTENDO_STAFF_REFERENCE_ID, 150)
        val worldRecord = buildAndroidRankReference(ANDROID_WORLD_RECORD_REFERENCE_ID, 200)

        assertEquals("Nintendo Ghost", nintendo.displayName)
        assertEquals("World Record", worldRecord.displayName)
        assertEquals(96, nintendo.playedTracks)
        assertEquals(96, worldRecord.playedTracks)
        assertEquals(96, nintendo.bests.size)
        assertEquals(96, worldRecord.bests.size)
    }

    @Test
    fun baseAndBoosterScopesSplitAtCanonicalTrackFortyEight() {
        assertEquals(48, AndroidTimeTrialTrackScope.BASE.trackCount)
        assertEquals(48, AndroidTimeTrialTrackScope.BCP.trackCount)
        assertEquals("track.big_blue", AndroidTimeTrialTrackScope.BASE.tracks.last().id)
        assertEquals("track.tour_paris_promenade", AndroidTimeTrialTrackScope.BCP.tracks.first().id)
        val baseGhost = buildAndroidRankReference(
            ANDROID_NINTENDO_STAFF_REFERENCE_ID,
            150,
            scope = AndroidTimeTrialTrackScope.BASE,
        )
        val bcpGhost = buildAndroidRankReference(
            ANDROID_NINTENDO_STAFF_REFERENCE_ID,
            150,
            scope = AndroidTimeTrialTrackScope.BCP,
        )
        assertEquals(48, baseGhost.playedTracks)
        assertEquals(48, bcpGhost.playedTracks)
        assertEquals(AndroidTimeTrialTrackScope.BASE, baseGhost.scope)
        assertEquals(AndroidTimeTrialTrackScope.BCP, bcpGhost.scope)
    }

    @Test
    fun rankScopeFormsOneDeduplicatedUnion() {
        assertEquals(
            setOf("player.me", "player.rival", "player.group", "player.other"),
            androidRankUnionPlayerIds(
                viewerPlayerId = "player.me",
                includeRivals = true,
                rivalPlayerIds = listOf("player.rival", "player.group"),
                groupPlayerIds = listOf("player.group", "player.me"),
                comparedPlayerIds = listOf("player.other", "player.rival"),
            ),
        )
    }

    @Test
    fun generatedMasteryKeepsTheRecoveredTwentyThreeLevelLadder() {
        val ladder = requireNotNull(
            AndroidMasteryThresholds.trackLadder("track.mario_kart_stadium", 150),
        )
        assertEquals(23, ladder.size)
        assertEquals("Deity", AndroidMasteryThresholds.tierLabels.first())
        assertEquals("Adv B", AndroidMasteryThresholds.tierLabels[14])
        assertEquals("Noob", AndroidMasteryThresholds.tierLabels.last())
        assertTrue(ladder.indices.drop(1).all { ladder[it - 1] <= ladder[it] })
    }
}
